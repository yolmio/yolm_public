import type { Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";

/** Validate the entire list before dispatch; both providers accept comma-separated To addresses. */
export function prepareEmailTestRecipients<T extends IServerBaseStatements>(
  s: T,
  input: Sql,
) {
  s.defTable(
    "test_addresses",
    sql`select lower(trim(value)) as email, min(ordinal) as first_ordinal
      from string.split(coalesce(${input}, ''), ',')
      group by lower(trim(value))`,
  );
  s.throwErrorIf(
    sql`exists(select 1 from test_addresses where regex.is_match(email, '[[:space:]<>()"]'))`,
    sql
      .lit`Enter plain email addresses, such as name@example.com, without display names, comments, or quotation marks.`,
  );
  s.throwErrorIf(
    sql`not exists(select 1 from test_addresses)
      or exists(select 1 from test_addresses where not coalesce(string.is_valid_email(email), false))`,
    sql
      .lit`Enter valid test email addresses separated by commas. Remove empty entries.`,
  );
  s.throwErrorIf(
    sql`(select count(*) from test_addresses) > 10`,
    sql.lit`Send a test to at most 10 different email addresses.`,
  );
  return sql`(select string_agg(email, ',' order by first_ordinal) from test_addresses)`;
}
