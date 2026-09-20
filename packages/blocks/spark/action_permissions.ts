import { userHasPermission } from "blocks/auth";
import { type Sql, sql } from "std/sql_utils";
import type { RegisterReactorsOpts } from "./agent";
import { hasSparkPermissionGate } from "./permissions";

/** Current application permission for an exact session action; used by UI and executor. */
export function sparkSessionActionAllowed(
  opts: Pick<RegisterReactorsOpts, "capabilities" | "accessPermission">,
  user: Sql,
  session: Sql,
  actionName: Sql,
  selectedAction?: string,
): Sql {
  const allowed: Sql[] = [];
  for (const cap of opts.capabilities) {
    for (const action of cap.actions ?? []) {
      if (selectedAction && selectedAction !== `${cap.name}.${action.name}`) {
        continue;
      }
      allowed.push(
        sql`(${actionName} = ${sql.lit(`${cap.name}.${action.name}`)} and (${
          hasSparkPermissionGate(cap.permission, cap.permissions, user)
        }) and (${
          hasSparkPermissionGate(action.permission, action.permissions, user)
        }) and exists(select 1 from db.spark_conversations c where c.id = ${session} and c.capabilities_json @> json_build_array(${
          sql.lit(cap.name)
        })))`,
      );
    }
  }
  return sql`(${
    sql.or(false, ...allowed)
  }) and exists(select 1 from db.sys_users u where u.id = ${user} and not u.disabled) and (${
    userHasPermission(sql.lit(opts.accessPermission ?? "can_use_spark"), user)
  })`;
}
