import { type Sql, sql } from "../std/sql_utils";
import type { EndpointStatements } from "std/statements";

/**
 * Builds compatibility route variants for legacy controller/action APIs.
 *
 * The result includes `/api` and root prefixes plus original/lowercase
 * controller and action spellings. Register each returned path against the
 * same handler when replacing older case-insensitive HTTP stacks.
 */
export function legacyRouteVariants(
  controller: string,
  action: string,
): string[] {
  const controllers = [controller, controller.toLowerCase()];
  const actions = [action, action.toLowerCase()];
  const prefixes = ["/api", ""];
  return [
    ...new Set(
      prefixes.flatMap((prefix) =>
        controllers.flatMap((c) => actions.map((a) => `${prefix}/${c}/${a}`))
      ),
    ),
  ];
}

/**
 * Options for {@link requireHeaderApiKey}.
 */
export interface HeaderApiKeyOptions {
  /** Header to read. Defaults to `X-Api-Key`. */
  headerName?: string;
  /** Procedure scalar name for the received header. Defaults to `api_key`. */
  scalarName?: string;
  /**
   * SQL query returning allowed keys as a single `value` column.
   * If the query returns no rows, all non-empty keys are rejected.
   */
  allowedKeys: Sql;
  /** Status returned when the key is missing. Defaults to 401. */
  missingStatus?: number;
  /** Status returned when the key is present but not allowed. Defaults to 403. */
  unauthorizedStatus?: number;
  /** Response body for a missing key. */
  missingMessage?: Sql;
  /** Response body for an unauthorized key. */
  unauthorizedMessage?: Sql;
}

/**
 * Adds a header API-key guard to an endpoint procedure.
 *
 * The helper reads a header into a scalar, rejects blank values, and then
 * checks the value against an allowed-keys query. It mirrors
 * common legacy API-key schemes where allowed keys are stored in a config row.
 */
export function requireHeaderApiKey(
  s: EndpointStatements,
  opts: HeaderApiKeyOptions,
) {
  const headerName = opts.headerName ?? "X-Api-Key";
  const scalarName = opts.scalarName ?? "api_key";
  const keyRef = sql.ref(scalarName);

  s.getHeader(sql.lit(headerName), scalarName);
  s.if(sql`${keyRef} is null or ${keyRef} = ''`, (s) => {
    s.setHttpStatus(opts.missingStatus ?? 401);
    s.return(opts.missingMessage ?? sql.lit`API key is missing.`);
  });
  s.if(
    sql`not exists (
        select 1
        from (${opts.allowedKeys}) allowed_keys
        where value = ${keyRef}
      )`,
    (s) => {
      s.setHttpStatus(opts.unauthorizedStatus ?? 403);
      s.return(opts.unauthorizedMessage ?? sql.lit`Unauthorized client.`);
    },
  );
}

/**
 * Builds a SQL expression that resolves to the client's IP address from
 * the standard reverse-proxy headers.
 *
 * Inspects `X-Forwarded-For` first (taking the left-most entry, which is
 * the original client) and falls back to the connecting-IP header, then
 * to a caller-supplied default. Use this in API handlers that sit behind
 * a load balancer or CDN.
 *
 * Read the headers into scalars first via `s.getHeader(...)`, then
 * pass those scalar references in.
 *
 * @param xForwardedFor   Sql expression for the `X-Forwarded-For`
 *                        header value.
 * @param connectingIp    Sql expression for the connecting-IP header
 *                        (e.g. `CF-Connecting-IP` on Cloudflare).
 * @param fallback        Returned when both inputs are null/empty.
 *
 * @example
 * s.getHeader(sql.lit`X-Forwarded-For`, "x_forwarded_for");
 * s.getHeader(sql.lit`CF-Connecting-IP`, "cf_connecting_ip");
 * const ip = forwardedClientIp(sql`x_forwarded_for`, sql`cf_connecting_ip`);
 */
export function forwardedClientIp(
  xForwardedFor: Sql,
  connectingIp: Sql,
  fallback: Sql = sql.lit``,
): Sql {
  return sql`coalesce(
    nullif((select trim(value) from string.split(${xForwardedFor}, ',') where ordinal = 0), ''),
    nullif(${connectingIp}, ''),
    ${fallback}
  )`;
}

/**
 * Wraps the built-in `uri.form_url_decode(...)` SQL function — URL-decodes
 * a percent-encoded string (e.g. `Hello%20World` → `Hello World`,
 * `%26` → `&`).
 *
 * Use on individual `application/x-www-form-urlencoded` parameter values
 * after you've split them out of the request body, or on any other
 * percent-encoded text you need to inspect.
 *
 * @example
 * import { formUrlDecode } from "services/http";
 * import { sql } from "std/sql_utils";
 *
 * s.defScalar("decoded_xml", formUrlDecode(sql`encoded_request`));
 */
export function formUrlDecode(value: Sql): Sql {
  return sql`uri.form_url_decode(${value})`;
}
