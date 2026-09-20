import { registerSignedBlobDownload } from "./transfers";
import { userHasPermission } from "blocks/auth";
import { type Sql, sql } from "std/sql_utils";
import { system } from "std/system";
import type { EndpointStatements } from "std/statements";
import { queryParamsString } from "std/services";

export interface TenantMcpOptions {
  domain: string;
  domainAliases?: string[];
  surface: "forge" | "spark";
  path: string;
  settingsPath: string;
  permission: (user: Sql) => Sql;
  capabilities: (user: Sql) => Sql;
}
let initialized = false;
/** All new tables are additive. Credentials are stored as SHA-256 hashes. */
export function mcpScope(surface: "forge" | "spark", access: "read" | "write") {
  return `${surface}:${
    access === "read" ? "read" : surface === "forge" ? "develop" : "act"
  }`;
}

export function mcpPermission(
  opts: TenantMcpOptions,
  user: Sql,
  access: Sql,
): Sql {
  const read = userHasPermission(sql.lit`can_connect_mcp_read`, user);
  const write = userHasPermission(
    sql.lit(
      opts.surface === "forge"
        ? "can_connect_mcp_develop"
        : "can_connect_mcp_act",
    ),
    user,
  );
  return sql`(${
    opts.permission(user)
  }) and (case when ${access} = 'write' then (${write} ${
    opts.surface === "forge"
      ? sql`and ${userHasPermission(sql.lit`edit_code`, user)}`
      : sql``
  }) else (${read} or ${write}) end)`;
}

export function initializeMcpConnections() {
  if (initialized) return;
  initialized = true;
  system.enum_({ name: "mcp_surface", values: ["forge", "spark"] });
  system.enum_({ name: "mcp_access", values: ["read", "write"] });
  system.db.table("mcp_clients", (t) => {
    t.string("client_id", 64).notNull().unique();
    t.string("name", 200).notNull();
    t.json("redirect_uris").notNull();
    t.timestampUtc("created_at").notNull().default(sql`now()`);
  });
  // One row progresses from a pending consent request to a live connection.
  system.db.table("mcp_connections", (t) => {
    // Direct OAuth rows reference a DCR client; gateway rows do not.
    t.fk("client_id", "mcp_clients");
    t.fk("sys_user_id", "sys_users");
    t.enum("surface", "mcp_surface").notNull();
    t.enum("access", "mcp_access").notNull().default(sql`'read'`);
    t.string("resource", 2048).notNull();
    t.json("capabilities");
    t.string("request_hash", 64).notNull().unique();
    t.string("redirect_uri", 2048).notNull();
    t.string("state", 2048).notNull();
    t.string("challenge", 43).notNull();
    t.timestampUtc("expires_at").notNull();
    t.string("code_hash", 64);
    t.timestampUtc("consumed_at");
    t.string("access_hash", 64).unique();
    t.string("refresh_hash", 64).unique();
    t.timestampUtc("access_expires_at");
    t.timestampUtc("refresh_expires_at");
    // Retain spent refresh hashes until expiry so replay revokes the family.
    t.json("spent_refresh_tokens");
    t.timestampUtc("created_at").notNull().default(sql`now()`);
    t.timestampUtc("last_used_at");
    t.timestampUtc("revoked_at");
    // Gateway credentials are scoped to this tenant and central connection.
    // Store hashes only; the control hash is stable across access-key rotation.
    t.string("gateway_client_name", 200);
    t.string("gateway_control_hash", 64);
    t.string("gateway_access_hash", 64);
    t.string("gateway_access_hash_next", 64);
    t.string("gateway_access_version", 32);
    t.string("gateway_access_version_next", 32);
  });
}
export const mcpHash = (value: Sql) =>
  sql`bytes.to_hex(crypto.sha256(string.to_utf8(${value})))`;
/** Hash gateway credentials as raw UTF-8 bytes, matching the worker. */
export const mcpGatewayHash = (value: Sql) =>
  sql`bytes.to_hex(crypto.sha256(${value}))`;
export const mcpRandom = () => sql`bytes.to_hex(crypto.random_bytes(32))`;

export function mcpRequestOrigin(
  s: EndpointStatements,
  opts: TenantMcpOptions,
  withResource = true,
) {
  s.noCaching();
  s.getHeader(sql.lit`host`, { defScalar: "mcp_routing_host" });
  // Both the dev domain listener and the production worker overwrite this
  // header at their trusted routing boundary; Host can be the internal domain.
  s.getHeader(sql.lit`yolm-origin-domain`, { defScalar: "mcp_public_host" });
  s.defScalar(
    "mcp_host",
    sql`coalesce(nullif(mcp_public_host, ''), mcp_routing_host)`,
  );
  s.getHeader(sql.lit`origin`, { defScalar: "mcp_origin_header" });
  const allowedHost = (host: Sql) => {
    let valid: Sql = sql`lower(${host}) = ${
      sql.lit(opts.domain.toLowerCase())
    }`;
    for (const alias of opts.domainAliases ?? []) {
      valid = sql`(${valid}) or lower(${host}) = ${
        sql.lit(alias.toLowerCase())
      }`;
    }
    if (opts.surface === "forge") {
      valid =
        sql`(${valid}) or regex.is_match(lower(${host}), '^[a-z0-9-]+[.]yolmforge[.]ai$')`;
    }
    return sql`(${valid}) or regex.is_match(lower(${host}), '^(localhost|127[.]0[.]0[.]1)(:[0-9]+)?$')`;
  };
  s.defScalar(
    "mcp_loopback",
    sql`regex.is_match(lower(mcp_host), '^(localhost|127[.]0[.]0[.]1)(:[0-9]+)?$')`,
  );
  s.if(
    sql`not (${allowedHost(sql`mcp_host`)}) or not (${
      allowedHost(sql`mcp_routing_host`)
    })`,
    (s) => {
      s.setHttpStatus(403);
      s.return(sql.lit`Invalid MCP Host`);
    },
  );
  s.defScalar(
    "mcp_origin",
    sql`case when mcp_loopback then 'http://' else 'https://' end || lower(mcp_host)`,
  );
  s.if(
    sql`nullif(mcp_origin_header, '') is not null and mcp_origin_header != mcp_origin`,
    (s) => {
      s.setHttpStatus(403);
      s.return(sql.lit`Invalid Origin`);
    },
  );
  if (withResource) {
    s.defScalar("mcp_resource", sql`mcp_origin || ${sql.lit(opts.path)}`);
  }
}

export function authenticateMcp(s: EndpointStatements, opts: TenantMcpOptions) {
  mcpRequestOrigin(s, opts);
  s.getHeader(sql.lit`authorization`, { defScalar: "mcp_authorization" });
  s.defRecord(
    "mcp_grant",
    sql`select c.id, c.sys_user_id, c.capabilities, c.access from db.mcp_connections c join db.sys_users u on u.id = c.sys_user_id where lower(substring(mcp_authorization from 1 for 7)) = 'bearer ' and c.revoked_at is null and not u.disabled and c.surface = ${
      sql.lit(opts.surface)
    } and ((c.gateway_control_hash is null and c.access_hash = ${
      mcpHash(sql`substring(mcp_authorization from 8)`)
    } and c.access_expires_at > now() and c.resource = mcp_resource) or (c.gateway_control_hash is not null and c.resource = mcp_resource and (c.gateway_access_hash = ${
      mcpGatewayHash(sql`substring(mcp_authorization from 8)`)
    } or c.gateway_access_hash_next = ${
      mcpGatewayHash(sql`substring(mcp_authorization from 8)`)
    }) and c.consumed_at is not null and split_part(substring(mcp_authorization from 8), '.', 1) in (c.gateway_access_version, c.gateway_access_version_next)))`,
  );
  s.if(sql`mcp_grant.id is null`, (s) => {
    s.setHttpStatus(401);
    s.setHeader("content-type", sql.lit`application/json`);
    // A missing gateway grant needs consent; a revoked/disabled grant remains
    // an access denial. Never turn execution into implicit attachment.
    s.if(
      sql`regex.is_match(substring(mcp_authorization from 8), '^v[1-9][0-9]{0,8}[.][A-Za-z0-9_-]{43}$') and not exists(select 1 from db.mcp_connections c where c.surface = ${
        sql.lit(opts.surface)
      } and c.resource = mcp_resource and (c.gateway_access_hash = ${
        mcpGatewayHash(sql`substring(mcp_authorization from 8)`)
      } or c.gateway_access_hash_next = ${
        mcpGatewayHash(sql`substring(mcp_authorization from 8)`)
      }))`,
      (s) =>
        s.return(sql`json_build_object('error', 'YOLM_SYSTEM_NOT_ATTACHED')`),
    );
    s.setHeader(
      "www-authenticate",
      sql`'Bearer resource_metadata="' || mcp_origin || '/.well-known/oauth-protected-resource' || ${
        sql.lit(opts.path)
      } || '"'`,
    );
    s.return(sql`json_build_object('error', 'invalid_token')`);
  });
  s.if(
    sql`not (${
      mcpPermission(opts, sql`mcp_grant.sys_user_id`, sql`mcp_grant.access`)
    })`,
    (s) => {
      s.setHttpStatus(403);
      s.return(sql`json_build_object('error', 'insufficient_scope')`);
    },
  );
  s.defScalar("mcp_connection_id", sql`mcp_grant.id`);
  s.defScalar("mcp_user_id", sql`mcp_grant.sys_user_id`);
  s.setCurrentUser(sql`mcp_user_id`);
  s.startTransaction();
  s.modify(
    sql`update db.mcp_connections set last_used_at = now() where id = mcp_connection_id`,
  );
  s.commitTransaction();
}

function oauthError(s: EndpointStatements, error: string) {
  s.setHttpStatus(400);
  s.return(sql`json_build_object('error', ${sql.lit(error)})`);
}
function oauthBusy(s: EndpointStatements, retryAfter: number) {
  s.throwError(sql.lit(`oauth_admission_busy_${retryAfter}`));
}
function oauthAdmission(
  s: EndpointStatements,
  body: (s: EndpointStatements) => void,
) {
  s.try({
    body,
    errorName: "oauth_admission_error",
    catch: (s) => {
      s.rollbackTransaction();
      s.if(
        sql`oauth_admission_error.message != 'oauth_admission_busy_600'`,
        (s) => s.throwError(sql`oauth_admission_error.message`),
      );
      s.setHttpStatus(429);
      s.setHeader("retry-after", sql.lit`600`);
      s.return(sql`json_build_object('error', 'temporarily_unavailable')`);
    },
  });
}
function formBody(s: EndpointStatements) {
  s.getHeader(sql.lit`content-type`, { defScalar: "oauth_content_type" });
  s.if(
    sql`octet_length(oauth_body) > 16384 or oauth_content_type not like 'application/x-www-form-urlencoded%'`,
    (s) => oauthError(s, "invalid_request"),
  );
  s.defTable(
    "oauth_form",
    sql`select uri.form_url_decode(split_part(value, '=', 1)) as name, uri.form_url_decode(substring(value from position('=' in value) + 1)) as value from string.split(oauth_body, '&')`,
  );
  s.if(
    sql`exists(select name from oauth_form group by name having count(*) > 1)`,
    (s) => oauthError(s, "invalid_request"),
  );
}
const param = (name: string) =>
  sql`(select value from oauth_form where name = ${sql.lit(name)})`;

const gatewayField = (name: string) => sql`gateway_json->>${sql.lit(name)}`;

function gatewayJsonBody(s: EndpointStatements) {
  s.getHeader(sql.lit`content-type`, { defScalar: "gateway_content_type" });
  s.setHeader("content-type", sql.lit`application/json`);
  s.defScalar("gateway_json", sql`try_cast(gateway_body as json)`);
  s.if(
    sql`gateway_body is null or coalesce(gateway_content_type, '') not like 'application/json%' or octet_length(gateway_body) > 16384 or coalesce(json_typeof(gateway_json), '') != 'object'`,
    (s) => oauthError(s, "invalid_request"),
  );
}

function gatewayControlBearer(s: EndpointStatements) {
  s.getHeader(sql.lit`authorization`, { defScalar: "gateway_authorization" });
  s.defScalar(
    "gateway_control_token_hash",
    mcpGatewayHash(sql`substring(gateway_authorization from 8)`),
  );
  s.if(
    sql`lower(substring(gateway_authorization from 1 for 7)) != 'bearer ' or not regex.is_match(substring(gateway_authorization from 8), '^mgmt[.]v[1-9][0-9]{0,8}[.][A-Za-z0-9_-]{43}$')`,
    (s) => oauthError(s, "invalid_request"),
  );
}

function gatewayAccessBearer(s: EndpointStatements) {
  s.getHeader(sql.lit`authorization`, { defScalar: "gateway_authorization" });
  s.defScalar(
    "gateway_access_token_hash",
    mcpGatewayHash(sql`substring(gateway_authorization from 8)`),
  );
  s.defScalar(
    "gateway_access_token_version",
    sql`split_part(substring(gateway_authorization from 8), '.', 1)`,
  );
  s.if(
    sql`lower(substring(gateway_authorization from 1 for 7)) != 'bearer ' or not regex.is_match(substring(gateway_authorization from 8), '^v[1-9][0-9]{0,8}[.][A-Za-z0-9_-]{43}$')`,
    (s) => oauthError(s, "invalid_request"),
  );
}

export function registerMcpOAuth(opts: TenantMcpOptions) {
  registerSignedBlobDownload(opts.domain);
  const api = system.api({
    domain: opts.domain,
    domainAliases: opts.domainAliases,
    prefix: "",
  });
  const issuerPath = `/oauth/${opts.surface}`;
  const issuer = sql`mcp_origin || ${sql.lit(issuerPath)}`;
  api.get(`${issuerPath}/gateway/authorize`, {
    query: [
      "state",
      "surface",
      "client_name",
      "redirect_uri",
      "code_challenge",
      "control_hash",
    ].map((name) => ({
      name,
      type: { type: "String" as const, maxLength: 2048 },
      default: "''",
    })),
    procedure: (s) => {
      mcpRequestOrigin(s, opts, false);
      s.setHeader("content-type", sql.lit`application/json`);
      s.if(
        sql`surface != ${
          sql.lit(opts.surface)
        } or not regex.is_match(state, '^[A-Za-z0-9_-]{43}$') or length(client_name) not between 1 and 200 or not regex.is_match(code_challenge, '^[A-Za-z0-9_-]{43}$') or not regex.is_match(control_hash, '^[0-9a-f]{64}$') or not regex.is_match(redirect_uri, '^https://mcp[.]yolm[.]ai/(callback|attach/callback)$')`,
        (s) => oauthError(s, "invalid_request"),
      );
      s.defScalar("gateway_authorization_request_hash", mcpHash(sql`state`));
      const requestHash = sql`gateway_authorization_request_hash`;
      const resume = (s: EndpointStatements) => {
        s.defRecord(
          "gateway_request",
          sql`select * from db.mcp_connections where request_hash = ${requestHash}`,
        );
        s.if(
          sql`gateway_request.id is null or gateway_request.surface != ${
            sql.lit(opts.surface)
          } or gateway_request.resource != (mcp_origin || ${
            sql.lit(opts.path)
          }) or gateway_request.redirect_uri != redirect_uri or gateway_request.state != state or gateway_request.challenge != code_challenge or (gateway_request.gateway_client_name is distinct from client_name) or (gateway_request.gateway_control_hash is distinct from control_hash)`,
          (s) => oauthError(s, "invalid_request"),
        );
        s.if(
          sql`gateway_request.expires_at <= now() or gateway_request.consumed_at is not null or gateway_request.revoked_at is not null`,
          (s) => oauthError(s, "invalid_state"),
        );
        s.setHttpStatus(302);
        s.setHeader(
          "location",
          sql`mcp_origin || ${sql.lit(opts.settingsPath)} || '?' || ${
            queryParamsString({ request: sql`state` })
          }`,
        );
        s.return();
      };
      // Repeated browser navigation resumes the same consent without extending
      // its lifetime or changing its identity, permissions, or PKCE binding.
      s.if(
        sql`exists(select 1 from db.mcp_connections where request_hash = ${requestHash})`,
        resume,
      );
      oauthAdmission(s, (s) => {
        s.try({
          body: (s) => {
            s.startTransaction();
            s.modify(
              sql`delete from db.mcp_connections where gateway_control_hash is not null and consumed_at is null and expires_at <= now()`,
            );
            s.if(
              sql`(select count(*) from db.mcp_connections where gateway_control_hash is not null and consumed_at is null and expires_at > now()) >= 32 or (select count(*) from db.mcp_connections where consumed_at is null and expires_at > now()) >= 1024`,
              (s) => oauthBusy(s, 600),
            );
            s.modify(
              sql`insert into db.mcp_connections (surface, access, resource, request_hash, redirect_uri, state, challenge, expires_at, gateway_client_name, gateway_control_hash) values (${
                sql.lit(opts.surface)
              }, 'write', mcp_origin || ${
                sql.lit(opts.path)
              }, ${requestHash}, redirect_uri, state, code_challenge, date.add(minute, 10, now()), client_name, control_hash) on conflict (request_hash) do nothing`,
            );
            s.commitTransaction();
          },
          errorName: "gateway_authorize_error",
          catch: (s) => {
            s.rollbackTransaction();
            // A concurrent request may have committed this same state first.
            // Resume only after the full binding checks below; other errors
            // still propagate through admission/error handling.
            s.if(
              sql`not exists(select 1 from db.mcp_connections where request_hash = ${requestHash})`,
              (s) => s.throwError(sql`gateway_authorize_error.message`),
            );
          },
        });
        resume(s);
      });
    },
  });
  api.post(`${issuerPath}/gateway/exchange`, {
    textBodyScalar: "gateway_body",
    procedure: (s) => {
      mcpRequestOrigin(s, opts);
      gatewayAccessBearer(s);
      gatewayJsonBody(s);
      s.defScalar("gateway_code", gatewayField("code"));
      s.defScalar("gateway_verifier", gatewayField("code_verifier"));
      s.defScalar("gateway_redirect_uri", gatewayField("redirect_uri"));
      s.defScalar("gateway_state", gatewayField("state"));
      s.defScalar("gateway_surface", gatewayField("surface"));
      s.defScalar("gateway_requested_client_name", gatewayField("client_name"));
      s.defScalar("gateway_management_token", gatewayField("management_token"));
      s.defScalar("gateway_next_token", gatewayField("next_token"));
      s.defScalar(
        "gateway_management_token_hash",
        mcpGatewayHash(sql`gateway_management_token`),
      );
      s.defScalar(
        "gateway_next_token_hash",
        mcpGatewayHash(sql`gateway_next_token`),
      );
      s.defScalar(
        "gateway_next_token_version",
        sql`split_part(gateway_next_token, '.', 1)`,
      );
      s.if(
        sql`not regex.is_match(coalesce(gateway_code, ''), '^[0-9a-f]{64}$') or not regex.is_match(coalesce(gateway_verifier, ''), '^[A-Za-z0-9_-]{43}$') or not regex.is_match(coalesce(gateway_state, ''), '^[A-Za-z0-9_-]{43}$') or gateway_surface != ${
          sql.lit(opts.surface)
        } or length(gateway_requested_client_name) not between 1 and 200 or gateway_redirect_uri not in ('https://mcp.yolm.ai/callback', 'https://mcp.yolm.ai/attach/callback') or not regex.is_match(coalesce(gateway_management_token, ''), '^mgmt[.]v[1-9][0-9]{0,8}[.][A-Za-z0-9_-]{43}$') or not regex.is_match(coalesce(gateway_next_token, ''), '^$|^v[1-9][0-9]{0,8}[.][A-Za-z0-9_-]{43}$') or (coalesce(gateway_next_token, '') != '' and try_cast(substring(gateway_next_token_version from 2) as bigint) <= try_cast(substring(gateway_access_token_version from 2) as bigint)) or gateway_json - 'code' - 'code_verifier' - 'redirect_uri' - 'state' - 'surface' - 'client_name' - 'management_token' - 'next_token' != '{}'::json`,
        (s) => oauthError(s, "invalid_request"),
      );
      s.defRecord(
        "gateway_replayed",
        sql`select c.* from db.mcp_connections c join db.sys_users u on u.id = c.sys_user_id where c.request_hash = ${
          mcpHash(sql`gateway_state`)
        } and c.gateway_control_hash = gateway_management_token_hash and c.code_hash = ${
          mcpHash(sql`gateway_code`)
        } and c.challenge = encode.base64_url_safe(crypto.sha256(gateway_verifier)) and c.redirect_uri = gateway_redirect_uri and c.surface = gateway_surface and c.gateway_client_name = gateway_requested_client_name and c.resource = mcp_resource and c.gateway_access_hash = gateway_access_token_hash and (coalesce(gateway_next_token, '') = '' or c.gateway_access_hash_next = gateway_next_token_hash or (c.gateway_access_version_next is not null and try_cast(substring(c.gateway_access_version_next from 2) as bigint) > try_cast(substring(gateway_next_token_version from 2) as bigint))) and c.consumed_at is not null and c.revoked_at is null and not u.disabled and (${
          mcpPermission(opts, sql`c.sys_user_id`, sql`c.access`)
        })`,
      );
      s.if(sql`gateway_replayed.id is not null`, (s) => {
        s.return(
          sql`json_build_object('attached', true, 'domain', mcp_host, 'surface', gateway_replayed.surface, 'display_name', mcp_host)`,
        );
      });
      s.try({
        body: (s) => {
          s.startTransaction();
          s.defRecord(
            "gateway_pending",
            sql`select c.* from db.mcp_connections c join db.sys_users u on u.id = c.sys_user_id where c.request_hash = ${
              mcpHash(sql`gateway_state`)
            } and c.gateway_control_hash = gateway_management_token_hash and c.code_hash = ${
              mcpHash(sql`gateway_code`)
            } and c.challenge = encode.base64_url_safe(crypto.sha256(gateway_verifier)) and c.redirect_uri = gateway_redirect_uri and c.surface = gateway_surface and c.resource = mcp_resource and c.gateway_client_name = gateway_requested_client_name and c.sys_user_id is not null and c.consumed_at is null and c.expires_at > now() and c.revoked_at is null and not u.disabled and (${
              mcpPermission(opts, sql`c.sys_user_id`, sql`c.access`)
            })`,
          );
          s.if(
            sql`gateway_pending.id is null`,
            (s) => s.throwError(sql.lit`invalid_grant`),
          );
          s.if(
            sql`gateway_pending.gateway_access_version is not null and try_cast(substring(gateway_access_token_version from 2) as bigint) < try_cast(substring(gateway_pending.gateway_access_version from 2) as bigint)`,
            (s) => s.throwError(sql.lit`invalid_grant`),
          );
          s.if(
            sql`coalesce(gateway_next_token, '') != '' and gateway_pending.gateway_access_version_next = gateway_next_token_version and gateway_pending.gateway_access_hash_next is distinct from gateway_next_token_hash`,
            (s) => s.throwError(sql.lit`invalid_grant`),
          );
          s.if(
            sql`gateway_pending.gateway_access_version_next is not null and try_cast(substring(gateway_pending.gateway_access_version_next from 2) as bigint) = try_cast(substring(gateway_access_token_version from 2) as bigint) and gateway_pending.gateway_access_hash_next is distinct from gateway_access_token_hash`,
            (s) => s.throwError(sql.lit`invalid_grant`),
          );
          s.defRecord(
            "gateway_existing",
            sql`select c.* from db.mcp_connections c where c.gateway_control_hash = gateway_management_token_hash and c.resource = mcp_resource and c.surface = gateway_pending.surface and c.consumed_at is not null and c.gateway_access_hash is not null and c.revoked_at is null order by c.id desc limit 1`,
          );
          // A re-consent must not reinstall a credential that rotation has
          // already retired. After explicit revocation there is no active
          // row, so a fresh consent may provision a new credential.
          s.if(
            sql`gateway_existing.id is not null and ((gateway_existing.gateway_access_hash != gateway_access_token_hash and coalesce(gateway_existing.gateway_access_hash_next, '') != gateway_access_token_hash) or (gateway_existing.gateway_access_hash = gateway_access_token_hash and gateway_existing.gateway_access_hash_next is not null and (gateway_pending.gateway_access_hash_next is null or gateway_pending.gateway_access_hash_next != gateway_existing.gateway_access_hash_next) and (coalesce(gateway_next_token, '') = '' or gateway_existing.gateway_access_hash_next != gateway_next_token_hash)))`,
            (s) => s.throwError(sql.lit`invalid_grant`),
          );
          s.defScalar("gateway_consumed_id", { type: "BigInt" });
          s.modify(
            sql`update db.mcp_connections set consumed_at = now() where id = gateway_pending.id and consumed_at is null returning id into gateway_consumed_id`,
          );
          s.if(
            sql`gateway_consumed_id is null`,
            (s) => s.throwError(sql.lit`invalid_grant`),
          );
          s.defScalar("gateway_installed_id", { type: "BigInt" });
          // Re-consent invalidates an older active grant only after the new
          // code, PKCE proof, management token and local permissions pass.
          s.modify(
            sql`update db.mcp_connections set revoked_at = now() where gateway_control_hash = gateway_pending.gateway_control_hash and resource = mcp_resource and surface = gateway_pending.surface and id != gateway_consumed_id and consumed_at is not null and revoked_at is null`,
          );
          s.modify(
            sql`update db.mcp_connections set gateway_access_hash = gateway_access_token_hash, gateway_access_version = gateway_access_token_version, gateway_access_hash_next = case when coalesce(gateway_next_token, '') != '' then case when gateway_access_version_next is not null and try_cast(substring(gateway_access_version_next from 2) as bigint) > try_cast(substring(gateway_next_token_version from 2) as bigint) then gateway_access_hash_next else gateway_next_token_hash end when gateway_access_version_next is not null and try_cast(substring(gateway_access_version_next from 2) as bigint) > try_cast(substring(gateway_access_token_version from 2) as bigint) then gateway_access_hash_next else null end, gateway_access_version_next = case when coalesce(gateway_next_token, '') != '' then case when gateway_access_version_next is not null and try_cast(substring(gateway_access_version_next from 2) as bigint) > try_cast(substring(gateway_next_token_version from 2) as bigint) then gateway_access_version_next else gateway_next_token_version end when gateway_access_version_next is not null and try_cast(substring(gateway_access_version_next from 2) as bigint) > try_cast(substring(gateway_access_token_version from 2) as bigint) then gateway_access_version_next else null end where id = gateway_consumed_id and gateway_access_hash is null and (gateway_access_version is null or try_cast(substring(gateway_access_version from 2) as bigint) <= try_cast(substring(gateway_access_token_version from 2) as bigint)) and not (coalesce(gateway_next_token, '') != '' and gateway_access_version_next is not null and gateway_access_version_next = gateway_next_token_version and gateway_access_hash_next is distinct from gateway_next_token_hash) and not (gateway_access_version_next is not null and gateway_access_version_next = gateway_access_token_version and gateway_access_hash_next is distinct from gateway_access_token_hash) returning id into gateway_installed_id`,
          );
          s.if(
            sql`gateway_installed_id is null`,
            (s) => s.throwError(sql.lit`invalid_grant`),
          );
          s.commitTransaction();
          s.return(
            sql`json_build_object('attached', true, 'domain', mcp_host, 'surface', gateway_pending.surface, 'display_name', mcp_host)`,
          );
        },
        errorName: "gateway_exchange_error",
        catch: (s) => {
          s.rollbackTransaction();
          oauthError(s, "invalid_grant");
        },
      });
    },
  });
  api.post(`${issuerPath}/gateway/credentials`, {
    textBodyScalar: "gateway_body",
    procedure: (s) => {
      mcpRequestOrigin(s, opts);
      gatewayControlBearer(s);
      gatewayJsonBody(s);
      s.defScalar("gateway_next_token", gatewayField("next_token"));
      s.defScalar("gateway_rotation_mode", gatewayField("mode"));
      s.defScalar("gateway_expected_version", gatewayField("expected_version"));
      s.defScalar(
        "gateway_next_token_hash",
        mcpGatewayHash(sql`gateway_next_token`),
      );
      s.defScalar(
        "gateway_next_token_version",
        sql`split_part(gateway_next_token, '.', 1)`,
      );
      s.if(
        sql`not regex.is_match(coalesce(gateway_next_token, ''), '^v[1-9][0-9]{0,8}[.][A-Za-z0-9_-]{43}$') or coalesce(gateway_rotation_mode, '') not in ('stage', 'promote') or not regex.is_match(coalesce(gateway_expected_version, ''), '^v[1-9][0-9]{0,8}$') or try_cast(substring(gateway_next_token_version from 2) as bigint) <= try_cast(substring(gateway_expected_version from 2) as bigint) or gateway_json - 'next_token' - 'mode' - 'expected_version' != '{}'::json`,
        (s) => oauthError(s, "invalid_request"),
      );
      s.try({
        body: (s) => {
          s.startTransaction();
          s.defRecord(
            "gateway_credentials",
            sql`select c.* from db.mcp_connections c where c.gateway_control_hash = gateway_control_token_hash and c.resource = mcp_resource and c.surface = ${
              sql.lit(opts.surface)
            } and c.gateway_control_hash is not null and c.consumed_at is not null and c.gateway_access_hash is not null and c.revoked_at is null order by c.id desc limit 1`,
          );
          s.if(
            sql`gateway_credentials.id is null and not exists(select 1 from db.mcp_connections where gateway_control_hash = gateway_control_token_hash and resource = mcp_resource and surface = ${
              sql.lit(opts.surface)
            } and gateway_control_hash is not null and sys_user_id is not null and consumed_at is null and gateway_access_hash is null and revoked_at is null)`,
            (s) => s.throwError(sql.lit`gateway_credentials_skipped`),
          );
          s.defScalar("gateway_updated_id", { type: "BigInt" });
          s.modify(
            sql`update db.mcp_connections set gateway_access_hash = case when gateway_rotation_mode = 'promote' and gateway_access_hash_next is not null then gateway_access_hash_next else gateway_access_hash end, gateway_access_version = case when gateway_rotation_mode = 'promote' and gateway_access_version_next is not null then gateway_access_version_next else gateway_access_version end, gateway_access_hash_next = case when gateway_rotation_mode = 'promote' then null else gateway_next_token_hash end, gateway_access_version_next = case when gateway_rotation_mode = 'promote' then null else gateway_next_token_version end where id = gateway_credentials.id and revoked_at is null and ((gateway_rotation_mode = 'stage' and gateway_expected_version = gateway_access_version and try_cast(substring(gateway_next_token_version from 2) as bigint) > try_cast(substring(gateway_access_version from 2) as bigint) and (gateway_access_version_next is null or try_cast(substring(gateway_next_token_version from 2) as bigint) > try_cast(substring(gateway_access_version_next from 2) as bigint) or (gateway_access_version_next = gateway_next_token_version and gateway_access_hash_next = gateway_next_token_hash))) or (gateway_rotation_mode = 'promote' and ((gateway_expected_version = gateway_access_version and gateway_access_hash_next = gateway_next_token_hash and gateway_access_version_next = gateway_next_token_version) or (gateway_access_version = gateway_next_token_version and gateway_access_hash = gateway_next_token_hash and gateway_access_hash_next is null)))) returning id into gateway_updated_id`,
          );
          s.if(sql`gateway_updated_id is null`, (s) => {
            s.if(
              sql`gateway_credentials.id is not null or not exists(select 1 from db.mcp_connections where gateway_control_hash = gateway_control_token_hash and resource = mcp_resource and surface = ${
                sql.lit(opts.surface)
              } and gateway_control_hash is not null and sys_user_id is not null and consumed_at is null and gateway_access_hash is null and revoked_at is null)`,
              (s) => s.throwError(sql.lit`rotation_conflict`),
            );
          });
          s.modify(
            sql`update db.mcp_connections set gateway_access_version = case when gateway_access_version is null or try_cast(substring(gateway_access_version from 2) as bigint) < try_cast(substring(case when gateway_rotation_mode = 'promote' then gateway_next_token_version else gateway_expected_version end from 2) as bigint) then case when gateway_rotation_mode = 'promote' then gateway_next_token_version else gateway_expected_version end else gateway_access_version end, gateway_access_hash_next = case when gateway_access_version_next is null or try_cast(substring(gateway_next_token_version from 2) as bigint) > try_cast(substring(gateway_access_version_next from 2) as bigint) then gateway_next_token_hash else gateway_access_hash_next end, gateway_access_version_next = case when gateway_access_version_next is null or try_cast(substring(gateway_next_token_version from 2) as bigint) > try_cast(substring(gateway_access_version_next from 2) as bigint) then gateway_next_token_version else gateway_access_version_next end where gateway_control_hash = gateway_control_token_hash and resource = mcp_resource and surface = ${
              sql.lit(opts.surface)
            } and gateway_control_hash is not null and sys_user_id is not null and consumed_at is null and gateway_access_hash is null and revoked_at is null and (gateway_access_version_next is null or try_cast(substring(gateway_next_token_version from 2) as bigint) > try_cast(substring(gateway_access_version_next from 2) as bigint) or (gateway_access_version_next = gateway_next_token_version and gateway_access_hash_next = gateway_next_token_hash))`,
          );
          s.if(
            sql`exists(select 1 from db.mcp_connections where gateway_control_hash = gateway_control_token_hash and resource = mcp_resource and surface = ${
              sql.lit(opts.surface)
            } and gateway_control_hash is not null and sys_user_id is not null and consumed_at is null and gateway_access_hash is null and revoked_at is null and gateway_access_version_next = gateway_next_token_version and gateway_access_hash_next is distinct from gateway_next_token_hash)`,
            (s) => s.throwError(sql.lit`rotation_conflict`),
          );
          s.commitTransaction();
          s.return(sql`json_build_object('ok', true)`);
        },
        errorName: "gateway_credentials_error",
        catch: (s) => {
          s.rollbackTransaction();
          s.if(
            sql`gateway_credentials_error.message = 'gateway_credentials_skipped'`,
            (s) =>
              s.return(sql`json_build_object('ok', true, 'skipped', true)`),
          );
          s.if(
            sql`gateway_credentials_error.message = 'rotation_conflict'`,
            (s) => oauthError(s, "rotation_conflict"),
          );
          s.throwError(sql`gateway_credentials_error.message`);
        },
      });
    },
  });
  api.post(`${issuerPath}/gateway/revoke`, {
    textBodyScalar: "gateway_body",
    procedure: (s) => {
      mcpRequestOrigin(s, opts);
      gatewayControlBearer(s);
      gatewayJsonBody(s);
      s.if(
        sql`gateway_json != '{}'::json`,
        (s) => oauthError(s, "invalid_request"),
      );
      s.startTransaction();
      s.modify(
        sql`update db.mcp_connections set revoked_at = coalesce(revoked_at, now()) where gateway_control_hash = gateway_control_token_hash and surface = ${
          sql.lit(opts.surface)
        } and resource = mcp_resource and gateway_control_hash is not null`,
      );
      s.commitTransaction();
      s.return(
        sql`json_build_object('revoked', true, 'domain', mcp_host, 'surface', ${
          sql.lit(opts.surface)
        })`,
      );
    },
  });
  api.get(`/.well-known/oauth-protected-resource${opts.path}`, {
    procedure: (s) => {
      mcpRequestOrigin(s, opts);
      s.setHeader("content-type", sql.lit`application/json`);
      s.return(
        sql`json_build_object('resource', mcp_resource, 'authorization_servers', json_build_array(${issuer}), 'scopes_supported', json_build_array(${
          sql.lit(mcpScope(opts.surface, "read"))
        }, ${
          sql.lit(mcpScope(opts.surface, "write"))
        }), 'bearer_methods_supported', json_build_array('header'))`,
      );
    },
  });
  api.get(`/.well-known/oauth-authorization-server${issuerPath}`, {
    procedure: (s) => {
      mcpRequestOrigin(s, opts, false);
      s.setHeader("content-type", sql.lit`application/json`);
      s.return(
        sql`json_build_object('issuer', ${issuer}, 'authorization_endpoint', ${issuer} || '/authorize', 'token_endpoint', ${issuer} || '/token', 'registration_endpoint', ${issuer} || '/register', 'revocation_endpoint', ${issuer} || '/revoke', 'response_types_supported', json_build_array('code'), 'grant_types_supported', json_build_array('authorization_code', 'refresh_token'), 'code_challenge_methods_supported', json_build_array('S256'), 'token_endpoint_auth_methods_supported', json_build_array('none'), 'scopes_supported', json_build_array(${
          sql.lit(mcpScope(opts.surface, "read"))
        }, ${sql.lit(mcpScope(opts.surface, "write"))}))`,
      );
    },
  });
  api.post(`${issuerPath}/register`, {
    textBodyScalar: "oauth_body",
    procedure: (s) => {
      mcpRequestOrigin(s, opts, false);
      s.setHeader("content-type", sql.lit`application/json`);
      s.defScalar("registration", sql`try_cast(oauth_body as json)`);
      s.if(
        sql`octet_length(oauth_body) > 16384 or coalesce(json_typeof(registration), '') != 'object' or coalesce(json_typeof(registration->'redirect_uris'), '') != 'array' or coalesce(json_array_length(registration->'redirect_uris'), 0) not between 1 and 10 or coalesce(length(registration->>'client_name'), 0) not between 1 and 200 or coalesce(registration->>'token_endpoint_auth_method', 'none') != 'none'`,
        (s) => oauthError(s, "invalid_client_metadata"),
      );
      s.if(
        sql`exists(select 1 from json.array_each(registration->'redirect_uris') r where json_typeof(r.value) != 'string' or length(r.value::string) > 2048 or not regex.is_match(r.value::string, '^(https://[a-zA-Z0-9.-]+(:[0-9]+)?/|http://(127[.]0[.]0[.]1|localhost)(:[0-9]+)?/)[^#]*$'))`,
        (s) => oauthError(s, "invalid_redirect_uri"),
      );
      oauthAdmission(s, (s) => {
        s.defScalar("new_client_id", mcpRandom());
        s.startTransaction();
        // Tenant-wide setup budget: an anonymous caller cannot evade it by
        // rotating client IDs or IP addresses. Existing connections keep working.
        s.if(
          sql`(select count(*) from db.mcp_clients where created_at > date.add(minute, -10, now())) >= 32`,
          (s) => oauthBusy(s, 600),
        );
        s.modify(
          sql`delete from db.mcp_connections where gateway_control_hash is null and expires_at <= now() and access_hash is null`,
        );
        s.modify(
          sql`delete from db.mcp_clients where created_at < date.add(day, -30, now())
        and not exists (select 1 from db.mcp_connections c where c.client_id = mcp_clients.id)`,
        );
        s.modify(
          sql`insert into db.mcp_clients (client_id, name, redirect_uris) values (new_client_id, registration->>'client_name', registration->'redirect_uris')`,
        );
        s.commitTransaction();
        s.setHttpStatus(201);
        s.return(
          sql`json_build_object('client_id', new_client_id, 'client_name', registration->>'client_name', 'redirect_uris', registration->'redirect_uris', 'token_endpoint_auth_method', 'none', 'grant_types', json_build_array('authorization_code', 'refresh_token'), 'response_types', json_build_array('code'))`,
        );
      });
    },
  });
  api.get(`${issuerPath}/authorize`, {
    query: [
      "client_id",
      "redirect_uri",
      "response_type",
      "code_challenge",
      "code_challenge_method",
      "state",
      "scope",
      "resource",
    ].map((name) => ({
      name,
      type: { type: "String" as const, maxLength: 2048 },
      default: "''",
    })),
    procedure: (s) => {
      mcpRequestOrigin(s, opts);
      s.setHeader("content-type", sql.lit`application/json`);
      s.defScalar("requested_client_id", sql`client_id`);
      s.defRecord(
        "oauth_client",
        sql`select * from db.mcp_clients c where c.client_id = requested_client_id`,
      );
      // Qualify the persisted client_id; request parameters occupy procedure scope.
      s.if(
        sql`oauth_client.id is null or not (oauth_client.redirect_uris @> json_build_array(redirect_uri)) or response_type != 'code' or code_challenge_method != 'S256' or not regex.is_match(code_challenge, '^[A-Za-z0-9_-]{43}$') or resource != mcp_resource or exists(select 1 from string.split(scope, ' ') where value not in ('', ${
          sql.lit(mcpScope(opts.surface, "read"))
        }, ${sql.lit(mcpScope(opts.surface, "write"))}))`,
        (s) => oauthError(s, "invalid_request"),
      );
      oauthAdmission(s, (s) => {
        s.defScalar("oauth_request", mcpRandom());
        s.startTransaction();
        s.modify(
          sql`delete from db.mcp_connections where gateway_control_hash is null and expires_at <= now() and access_hash is null`,
        );
        s.if(
          sql`(select count(*) from db.mcp_connections where client_id = oauth_client.id and consumed_at is null and expires_at > now()) >= 32
        or (select count(*) from db.mcp_connections where consumed_at is null and expires_at > now()) >= 1024`,
          (s) => oauthBusy(s, 600),
        );
        s.modify(
          sql`insert into db.mcp_connections (request_hash, client_id, surface, access, resource, redirect_uri, state, challenge, expires_at) values (${
            mcpHash(sql`oauth_request`)
          }, oauth_client.id, ${
            sql.lit(opts.surface)
          }, case when exists(select 1 from string.split(scope, ' ') where value = ${
            sql.lit(mcpScope(opts.surface, "write"))
          }) then 'write'::enums.mcp_access else 'read'::enums.mcp_access end, mcp_resource, redirect_uri, state, code_challenge, date.add(minute, 10, now()))`,
        );
        s.commitTransaction();
        s.setHttpStatus(302);
        s.setHeader(
          "location",
          sql`mcp_origin || ${sql.lit(opts.settingsPath)} || '?' || ${
            queryParamsString({ request: sql`oauth_request` })
          }`,
        );
        s.return();
      });
    },
  });
  api.post(`${issuerPath}/token`, {
    textBodyScalar: "oauth_body",
    procedure: (s) => {
      mcpRequestOrigin(s, opts);
      s.setHeader("content-type", sql.lit`application/json`);
      formBody(s);
      s.defScalar("token_client_id", param("client_id"));
      s.defScalar("token_resource", param("resource"));
      s.defScalar("token_grant_type", param("grant_type"));
      s.defScalar("token_connection_id", { type: "BigInt" });
      s.if(
        sql`token_resource != mcp_resource or token_resource is null`,
        (s) => oauthError(s, "invalid_target"),
      );
      s.if(
        sql`token_grant_type = 'refresh_token' and exists(select 1 from db.mcp_connections c join db.mcp_clients client on client.id = c.client_id where client.client_id = token_client_id and c.resource = mcp_resource and exists(select 1 from json.array_each(c.spent_refresh_tokens) spent where spent.value->>'hash' = ${
          mcpHash(param("refresh_token"))
        } and try_cast(spent.value->>'expiresAt' as timestamp) > now()))`,
        (s) => {
          s.startTransaction();
          s.modify(
            sql`update db.mcp_connections set revoked_at = now() where resource = mcp_resource and client_id = (select id from db.mcp_clients where client_id = token_client_id) and exists(select 1 from json.array_each(spent_refresh_tokens) spent where spent.value->>'hash' = ${
              mcpHash(param("refresh_token"))
            } and try_cast(spent.value->>'expiresAt' as timestamp) > now())`,
          );
          s.commitTransaction();
          oauthError(s, "invalid_grant");
        },
      );
      s.try({
        body: (s) => {
          s.startTransaction();
          s.if(sql`token_grant_type = 'authorization_code'`, (s) => {
            s.defScalar("verifier", param("code_verifier"));
            s.defRecord(
              "authorization",
              sql`select a.* from db.mcp_connections a join db.mcp_clients c on c.id = a.client_id where a.code_hash = ${
                mcpHash(param("code"))
              } and c.client_id = token_client_id and a.sys_user_id is not null and a.consumed_at is null and a.expires_at > now() and a.resource = mcp_resource and a.redirect_uri = ${
                param("redirect_uri")
              }`,
            );
            s.if(
              sql`authorization.id is null or not regex.is_match(coalesce(verifier, ''), '^[A-Za-z0-9._~-]{43,128}$') or encode.base64_url_safe(crypto.sha256(verifier)) != authorization.challenge`,
              (s) => s.throwError(sql.lit`invalid_grant`),
            );
            s.modify(
              sql`update db.mcp_connections set consumed_at = now() where id = authorization.id`,
            );
            s.setScalar(
              "token_connection_id",
              sql`authorization.id`,
            );
          }).elseIf(sql`token_grant_type = 'refresh_token'`, (s) => {
            s.defRecord(
              "refresh",
              sql`select c.* from db.mcp_connections c join db.mcp_clients client on client.id = c.client_id where c.refresh_hash = ${
                mcpHash(param("refresh_token"))
              } and client.client_id = token_client_id and c.resource = mcp_resource`,
            );
            s.if(
              sql`refresh.id is null or refresh.refresh_expires_at <= now()`,
              (s) => s.throwError(sql.lit`invalid_grant`),
            );
            s.setScalar("token_connection_id", sql`refresh.id`);
          }).else((s) => s.throwError(sql.lit`unsupported_grant_type`));
          s.if(
            sql`not exists(select 1 from db.mcp_connections c join db.sys_users u on u.id = c.sys_user_id where c.id = token_connection_id and c.revoked_at is null and not u.disabled and (${
              mcpPermission(opts, sql`c.sys_user_id`, sql`c.access`)
            }))`,
            (s) => s.throwError(sql.lit`invalid_grant`),
          );
          s.defScalar("access_token", mcpRandom());
          s.defScalar("refresh_token", mcpRandom());
          // Bound per-connection replay history. Reconnect after 1,024 rotations
          // within the 30-day refresh lifetime rather than dropping replay checks.
          s.modify(
            sql`update db.mcp_connections set spent_refresh_tokens = coalesce((select json_array_agg(value) from json.array_each(spent_refresh_tokens) where try_cast(value->>'expiresAt' as timestamp) > now()), '[]'::json) where id = token_connection_id`,
          );
          s.if(
            sql`(select json_array_length(spent_refresh_tokens) from db.mcp_connections where id = token_connection_id) >= 1024`,
            (s) => s.throwError(sql.lit`invalid_grant`),
          );
          s.modify(sql`update db.mcp_connections set
            spent_refresh_tokens = spent_refresh_tokens || case when refresh_hash is null then '[]'::json else json_build_array(json_build_object('hash', refresh_hash, 'expiresAt', refresh_expires_at)) end,
            access_hash = ${mcpHash(sql`access_token`)},
            refresh_hash = ${mcpHash(sql`refresh_token`)},
            access_expires_at = date.add(hour, 1, now()),
            refresh_expires_at = date.add(day, 30, now())
            where id = token_connection_id`);
          s.defScalar(
            "issued_scope",
            sql`case when (select access from db.mcp_connections where id = token_connection_id) = 'write' then ${
              sql.lit(mcpScope(opts.surface, "write"))
            } else ${sql.lit(mcpScope(opts.surface, "read"))} end`,
          );
          s.commitTransaction();
          s.return(
            sql`json_build_object('access_token', access_token, 'refresh_token', refresh_token, 'token_type', 'Bearer', 'expires_in', 3600, 'scope', issued_scope)`,
          );
        },
        errorName: "oauth_token_error",
        catch: (s) => {
          s.rollbackTransaction();
          s.if(sql`oauth_token_error.message = 'oauth_rate_limited'`, (s) => {
            s.setHttpStatus(429);
            s.setHeader("retry-after", sql.lit`60`);
            s.return(
              sql`json_build_object('error', 'temporarily_unavailable')`,
            );
          });
          s.setHttpStatus(400);
          s.return(
            sql`json_build_object('error', case when oauth_token_error.message = 'unsupported_grant_type' then 'unsupported_grant_type' else 'invalid_grant' end)`,
          );
        },
      });
    },
  });
  api.post(`${issuerPath}/revoke`, {
    textBodyScalar: "oauth_body",
    procedure: (s) => {
      mcpRequestOrigin(s, opts);
      s.setHeader("content-type", sql.lit`application/json`);
      formBody(s);
      s.startTransaction();
      s.modify(
        sql`update db.mcp_connections set revoked_at = now() where resource = mcp_resource and client_id = (select id from db.mcp_clients where client_id = ${
          param("client_id")
        }) and (access_hash = ${mcpHash(param("token"))} or refresh_hash = ${
          mcpHash(param("token"))
        })`,
      );
      s.commitTransaction();
      s.return(sql`json_build_object()`);
    },
  });
}
