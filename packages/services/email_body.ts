import type { Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";

/** Normalizes provider email content before it is written to a system table. */
export function leanEmailBodyForStorage(body: Sql): Sql {
  return sql`html.lean_email(${body})`;
}
