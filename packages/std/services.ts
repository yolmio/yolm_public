import { sql, valuesRow } from "./sql_utils";
import type { AnyExpr, Sql } from "./sql_utils";
import type {
  EndpointStatements,
  IServerBaseStatements,
  RequestHeader,
} from "./statements";

/**
 * SQL expression that decrypts the value of the static secret named
 * `name` (stored in `db.sys_static_secrets`). Use this when a service
 * integration needs to read an API key without exposing it to clients.
 */
export function getStaticSecret(name: Sql) {
  return sql`(select crypto.decrypt(value, 'static secret ' || ${name}) from db.sys_static_secrets where name = ${name})`;
}

/** Callback type for procedures attached to an endpoint. */
export type EndpointStatementHandler = (s: EndpointStatements) => void;

/**
 * Build a percent-encoded query string (without the leading `?`) from a
 * record of values. Array values are repeated for the same key; `undefined`
 * values are skipped.
 *
 * @example
 *   queryParamsString({ q: "hello world", tag: ["a", "b"] })
 *   // → "q=hello%20world&tag=a&tag=b" (as a SQL expression)
 */
export function queryParamsString(
  params: Record<string, string | AnyExpr | AnyExpr[] | undefined>,
) {
  const rows = Object.entries(params).flatMap(([k, v]) => {
    if (v === undefined) {
      return [];
    }
    if (Array.isArray(v)) {
      return v.map((v) => valuesRow(queryParam(k, v)));
    }
    return [valuesRow(queryParam(k, v))];
  });
  if (rows.length === 0) {
    return sql.lit``;
  }
  return sql`(select coalesce(string_agg(param, '&'), '') from (values ${rows}) as t(param))`;
}

function queryParam(key: string, value: AnyExpr | string) {
  if (typeof value === "number" || typeof value === "boolean") {
    return sql.lit`${key}=${value}`;
  }
  if (typeof value === "string") {
    return sql.concat(
      sql.lit`${key}=`,
      sql`uri.encode_component(${sql.lit(value)})`,
    );
  }
  return sql.concat(
    sql.lit`${key}=`,
    sql`uri.encode_component(cast(${value} as string))`,
  );
}

/**
 * SQL predicate that returns `true` when `lowerHostExpr` (a lowercased
 * host string) is a localhost address — used to scope dev/test behaviors
 * to local hosts.
 */
export function isLocalhostHost(lowerHostExpr: AnyExpr): Sql {
  return sql`${lowerHostExpr} like 'localhost%' or ${lowerHostExpr} like '127.0.0.1%' or ${lowerHostExpr} like '[::1]%' or ${lowerHostExpr} like '::1%' or ${lowerHostExpr} like '%.localhost%'`;
}

/**
 * SQL expression that picks `'http://'` for localhost hosts and
 * `'https://'` for everything else. Useful for assembling self-referential
 * URLs that work in both local development and production.
 */
export function localhostAwareScheme(lowerHostExpr: AnyExpr): Sql {
  return sql`case when ${
    isLocalhostHost(lowerHostExpr)
  } then 'http://' else 'https://' end`;
}

/** MIME type for form-url-encoded payloads. */
export const FORM_URL_ENCODED_CONTENT_TYPE =
  "application/x-www-form-urlencoded";

/** Ready-made `Content-Type: application/x-www-form-urlencoded` header. */
export const FORM_URL_ENCODED_HEADER: RequestHeader = {
  name: sql.lit`Content-Type`,
  value: sql.lit`${FORM_URL_ENCODED_CONTENT_TYPE}`,
};

/**
 * Build a form-url-encoded body for a POST request. Currently an alias
 * for {@link queryParamsString} since the encoding rules are identical.
 */
export function formUrlEncodedParams(
  params: Record<string, AnyExpr | AnyExpr[] | undefined>,
) {
  return queryParamsString(params);
}

/**
Creates a signed request with HMAC signature using a static secret

@category Service Helper Function
*/
export function signedJsonRequest<T extends IServerBaseStatements>(
  s: T,
  opts: {
    secretName: Sql;
    payload: Sql;
    url: Sql;
    method?: Sql;
  },
) {
  s.block((s) => {
    s.defScalar("timestamp", sql`now()`);
    s.defScalar("secret_key", getStaticSecret(opts.secretName));
    s.defScalar(
      "signature",
      sql`crypto.hmac_sha256(
          ${opts.payload} || timestamp,
          secret_key
        )`,
    );
    s.request({
      method: opts.method ?? sql.lit`POST`,
      uri: opts.url,
      headers: [
        {
          name: sql.lit`X-Timestamp`,
          value: sql`timestamp`,
        },
        {
          name: sql.lit`X-Signature`,
          value: sql`signature`,
        },
        {
          name: sql.lit`Content-Type`,
          value: sql.lit`application/json`,
        },
      ],
      json: opts.payload,
      responseRecord: "response",
    });
    s.if(sql`response.status != 200`, (s) => {
      s.debugExpr(
        sql`'signed request failed with status: ' || response.status`,
      );
      s.throwError(
        sql`'Signed request failed with status: ' || response.status`,
      );
    });
  });
}
