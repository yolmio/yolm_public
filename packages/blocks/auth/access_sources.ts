import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

export function accessRuleSourceLabel(source: Sql, sourceRecordId: Sql) {
  return sql`case
    when ${source} = 'workforce_auth_role_mapping'
      then 'Workforce access rule #' || cast(${sourceRecordId} as string)
    else replace(${source}, '_', ' ') || ' #' || cast(${sourceRecordId} as string)
  end`;
}
