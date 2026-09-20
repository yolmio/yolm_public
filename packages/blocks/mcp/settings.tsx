import { Select } from "components/select";
import { Button } from "components/button";
import type { Node } from "std/ui";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { Each, Show } from "std/ui";
import { sql } from "std/sql_utils";
import { queryParamsString } from "std/services";
import {
  mcpHash,
  mcpPermission,
  mcpRandom,
  type TenantMcpOptions,
} from "./index";

/** Render inside the application's existing authenticated route tree. */
export function McpSettings(
  { options, children }: { options: TenantMcpOptions; children?: Node },
) {
  const label = options.surface === "forge" ? "Forge" : "Spark";
  const access = options.surface === "forge"
    ? "Inspect and edit application versions, query production, run validation and tests, use previews and permitted issue and Edge operations. Deployment is unavailable."
    : "Read your authorized Spark data and files, use skills and enabled functions, and execute registered reversible actions. Approval-required actions wait for review in Spark.";
  return (
    <Data
      queryParams={{
        request: {
          type: { type: "String", maxLength: 64 },
          default: sql.lit``,
        },
      }}
      procedure={(s) => {
        s.defScalar("mcp_callback_url", {
          type: { type: "String", maxLength: 4096 },
        });
        s.defScalar(
          "mcp_visible_capabilities",
          options.capabilities(sql`current_user`),
        );
        s.defScalar(
          "mcp_can_connect",
          sql`current_user is not null and (${
            mcpPermission(options, sql`current_user`, sql.lit`read`)
          })`,
        );
        s.defRecord(
          "pending_connection",
          sql`select a.id, a.resource, a.access, coalesce(a.gateway_client_name, c.name) as name, a.redirect_uri from db.mcp_connections a left join db.mcp_clients c on c.id = a.client_id where a.request_hash = ${
            mcpHash(sql`request`)
          } and a.surface = ${
            sql.lit(options.surface)
          } and a.revoked_at is null and a.expires_at > now() and a.sys_user_id is null and a.consumed_at is null`,
        );
        s.defScalar(
          "mcp_can_write",
          mcpPermission(options, sql`current_user`, sql.lit`write`),
        );
        s.defScalar("mcp_selected_access", sql`'read'`);
        s.defTable(
          "assistant_connections",
          sql`select c.id, coalesce(c.gateway_client_name, client.name) as name, c.created_at, c.last_used_at, c.resource, c.capabilities, c.access from db.mcp_connections c left join db.mcp_clients client on client.id = c.client_id where c.sys_user_id = current_user and c.surface = ${
            sql.lit(options.surface)
          } and c.revoked_at is null and c.consumed_at is not null
            and ((c.access_hash is not null and c.access_expires_at > now())
              or (c.refresh_hash is not null and c.refresh_expires_at > now())
              or (c.gateway_control_hash is not null and c.gateway_access_hash is not null))
            order by c.created_at desc`,
        );
      }}
    >
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <a
          className="underline"
          href={options.surface === "forge" ? "/" : options.settingsPath.slice(
            0,
            options.settingsPath.lastIndexOf("/"),
          ) || "/"}
        >
          Back to {label}
        </a>
        <h1 className="text-2xl font-semibold">
          Connected assistants · {label}
        </h1>
        <p>{access}</p>
        <Show when={sql`not mcp_can_connect`}>
          <p>You do not have access to connect this application.</p>
        </Show>
        <Show when={sql`mcp_can_connect`}>
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">Connect an assistant</h2>
            <p>
              Add this MCP server URL in your assistant, then sign in here and
              review access.
            </p>
            <code className="block break-all">
              {sql`case when regex.is_match(location.host, '^(localhost|127[.]0[.]0[.]1)(:[0-9]+)?$') then 'http://' else 'https://' end || location.host || ${
                sql.lit(options.path)
              }`}
            </code>
            <Button
              variant="outlined"
              onClick={(s) =>
                s.clipboard.writeText(
                  sql`case when regex.is_match(location.host, '^(localhost|127[.]0[.]0[.]1)(:[0-9]+)?$') then 'http://' else 'https://' end || location.host || ${
                    sql.lit(options.path)
                  }`,
                )}
            >
              Copy MCP URL
            </Button>
            <p>
              This connection covers this{" "}
              {label === "Forge" ? "Forge instance" : "system"}. Connect other
              systems separately.
            </p>
            <p>
              To connect several Yolm systems through one assistant connection,
              {" "}
              <a
                className="underline"
                href={sql`'https://mcp.yolm.ai/connect?' || ${
                  queryParamsString({
                    domain: sql`location.host`,
                    surface: sql.lit(options.surface),
                  })
                }`}
              >
                connect through Yolm MCP
              </a>.
            </p>
            <p>Your current access: {sql`mcp_visible_capabilities::string`}</p>
          </section>
          <Show when={sql`request != ''`}>
            <Show when={sql`pending_connection.id is null`}>
              <p>
                This connection request expired or has already been handled.
                Restart connecting from your assistant.
              </p>
            </Show>
            <Show when={sql`pending_connection.id is not null`}>
              <section className="space-y-3 rounded-lg border p-4">
                <h2 className="font-semibold">
                  Allow {sql`pending_connection.name`} to use {label}?
                </h2>
                <p>{sql`pending_connection.resource`}</p>
                <Select
                  value={sql`mcp_selected_access`}
                  onChange={(s) =>
                    s.setScalar("mcp_selected_access", sql`target_value`)}
                >
                  <Select.Option value="read">Read only</Select.Option>
                  <Show
                    when={sql`pending_connection.access = 'write' and mcp_can_write`}
                  >
                    <Select.Option value="write">
                      {label === "Forge" ? "Develop" : "Read and act"}
                    </Select.Option>
                  </Show>
                </Select>
                <Show when={sql`mcp_selected_access = 'read'`}>
                  <p>
                    Read permitted information. This connection cannot modify
                    application data, propose actions or save work.
                  </p>
                </Show>
                <Show when={sql`mcp_selected_access = 'write'`}>
                  <p>{access}</p>
                </Show>
                <p>
                  Your permissions are checked on every request. You can revoke
                  access here.
                </p>
                <p className="break-all">
                  Return address: {sql`pending_connection.redirect_uri`}
                </p>
                <ActionButton
                  errorDisplay="inline"
                  refetch={false}
                  afterSuccessClient={(s) =>
                    s.location.assign(sql`mcp_callback_url`)}
                  action={(s) => {
                    s.if(
                      sql`current_user is null or not (${
                        mcpPermission(options, sql`current_user`, sql.lit`read`)
                      })`,
                      (s) => s.throwError(sql.lit`Not authorized.`),
                    );
                    s.startTransaction();
                    s.defRecord(
                      "consent",
                      sql`select * from db.mcp_connections where request_hash = ${
                        mcpHash(sql`request`)
                      } and surface = ${
                        sql.lit(options.surface)
                      } and revoked_at is null and expires_at > now() and sys_user_id is null and consumed_at is null`,
                    );
                    s.if(sql`consent.id is null`, (s) =>
                      s.throwError(
                        sql.lit`Connection request expired or already handled.`,
                      ));
                    s.if(
                      sql`mcp_selected_access not in ('read','write') or (mcp_selected_access = 'write' and consent.access != 'write') or not (${
                        mcpPermission(
                          options,
                          sql`current_user`,
                          sql`mcp_selected_access`,
                        )
                      })`,
                      (s) =>
                        s.throwError(
                          sql
                            .lit`You cannot grant this connection's requested access.`,
                        ),
                    );
                    s.defScalar("consent_code", mcpRandom());
                    s.modify(
                      sql`update db.mcp_connections set sys_user_id = current_user, access = mcp_selected_access, capabilities = ${
                        options.capabilities(sql`current_user`)
                      }, code_hash = ${
                        mcpHash(sql`consent_code`)
                      }, expires_at = date.add(minute, 2, now()) where id = consent.id`,
                    );
                    s.commitTransaction();
                    s.setScalar(
                      "mcp_callback_url",
                      sql`consent.redirect_uri || case when position('?' in consent.redirect_uri) > 0 then '&' else '?' end || ${
                        queryParamsString({
                          code: sql`consent_code`,
                          state: sql`consent.state`,
                        })
                      }`,
                    );
                  }}
                >
                  Allow access
                </ActionButton>
                <ActionButton
                  variant="outlined"
                  refetch={false}
                  afterSuccessClient={(s) =>
                    s.location.assign(sql`mcp_callback_url`)}
                  action={(s) => {
                    s.startTransaction();
                    s.defRecord(
                      "cancel_consent",
                      sql`select * from db.mcp_connections where request_hash = ${
                        mcpHash(sql`request`)
                      } and surface = ${
                        sql.lit(options.surface)
                      } and revoked_at is null and expires_at > now() and sys_user_id is null and consumed_at is null`,
                    );
                    s.if(sql`cancel_consent.id is null`, (s) =>
                      s.throwError(
                        sql.lit`Connection request expired or already handled.`,
                      ));
                    s.modify(
                      sql`update db.mcp_connections set consumed_at = now() where id = cancel_consent.id`,
                    );
                    s.commitTransaction();
                    s.setScalar(
                      "mcp_callback_url",
                      sql`cancel_consent.redirect_uri || case when position('?' in cancel_consent.redirect_uri) > 0 then '&' else '?' end || ${
                        queryParamsString({
                          error: sql.lit`access_denied`,
                          state: sql`cancel_consent.state`,
                        })
                      }`,
                    );
                  }}
                >
                  Cancel
                </ActionButton>
              </section>
            </Show>
          </Show>
        </Show>
        <section className="space-y-3">
          <h2 className="font-semibold">Your connected assistants</h2>
          <Show when={sql`not exists(select 1 from assistant_connections)`}>
            <p>No assistants connected.</p>
          </Show>
          <Each table="assistant_connections" recordName="assistant_connection">
            <article className="space-y-2 rounded-lg border p-4">
              <h3 className="font-semibold">
                {sql`assistant_connection.name`}
              </h3>
              <p>
                Granted access: {sql`assistant_connection.access::string`} ·
                {" "}
                {sql`assistant_connection.capabilities::string`}
              </p>
              <p>
                Last used:{" "}
                {sql`coalesce(assistant_connection.last_used_at::string, 'Not used yet')`}
              </p>
              <ActionButton
                color="danger"
                variant="outlined"
                action={(s) => {
                  s.startTransaction();
                  s.modify(
                    sql`update db.mcp_connections set revoked_at = now() where id = assistant_connection.id and sys_user_id = current_user and surface = ${
                      sql.lit(options.surface)
                    }`,
                  );
                  s.commitTransaction();
                }}
              >
                Revoke
              </ActionButton>
            </article>
          </Each>
        </section>
        {children}
      </main>
    </Data>
  );
}
