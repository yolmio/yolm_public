import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import type { WorkforceBlock } from "blocks/workforce";
import { isAccessAdministrator } from "./access_policy";
import type { AuthBlock } from "./index";

export function accessRuleSourceHref(source: Sql, sourceRecordId: Sql) {
  const workforce = system.blockNamedOptional<WorkforceBlock>("WorkforceBlock");
  if (!workforce?.authRoleMappingsTable) return sql`null::string`;
  return sql`case when ${source} = 'workforce_auth_role_mapping'
    and ${
    system.blockNamed<AuthBlock>("AuthBlock").opts.accessPolicy
      ? isAccessAdministrator()
      : sql.true
  }
    then ${
    sql.lit(workforce.routes.authRoleRulesPath)
  } || '?rule_id=' || ${sourceRecordId}::string
    else null end`;
}

export function accessRuleSourceLabel(source: Sql, sourceRecordId: Sql) {
  return sql`case
    when ${source} = 'workforce_auth_role_mapping'
      then 'Workforce access rule #' || cast(${sourceRecordId} as string)
    else replace(${source}, '_', ' ') || ' #' || cast(${sourceRecordId} as string)
  end`;
}
