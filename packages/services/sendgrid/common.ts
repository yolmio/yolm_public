import { getStaticSecret } from "std/services";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import type { RequestHeader } from "std/statements";

/** Base URL of the SendGrid v3 REST API. */
export const BASE_URL = "https://api.sendgrid.com/v3";

/** Options for constructing a custom {@link SendGrid} client. */
export interface SendGridOptions {
  /**
   * Name of the static secret holding the SendGrid API key. Defaults to
   * `sendgrid_api_key` if omitted.
   */
  apiKey?: Sql;
}
/** Internal, fully-resolved options used by {@link authHeader}. */
export interface SendGridInternalOptions {
  /** Name of the static secret holding the API key. */
  apiKey: Sql;
}

/** Build the `Authorization: Bearer …` header expected by SendGrid. */
export function authHeader(opts: SendGridInternalOptions): RequestHeader {
  return {
    name: sql.lit`Authorization`,
    value: sql.concat("Bearer ", getStaticSecret(opts.apiKey)),
  };
}
