import { userHasPermission } from "blocks/auth";
import { type Sql, sql } from "std/sql_utils";
import type { RegisterReactorsOpts } from "./agent";
import {
  hasSparkPermissionGate,
  hasSparkPermissionGateDescriptor,
  sparkPermissionGateDescriptor,
} from "./permissions";

/** Current application permission for an exact session action; used by UI and executor. */
export function sparkSessionActionAllowed(
  opts: Pick<RegisterReactorsOpts, "capabilities" | "accessPermission">,
  user: Sql,
  session: Sql,
  actionName: Sql,
  selectedAction?: string,
): Sql {
  // A leaf already knows its action; receipt tools instead scan static data.
  if (!selectedAction) {
    const catalog = opts.capabilities.flatMap((capability) =>
      (capability.actions ?? []).map((action) => ({
        actionName: `${capability.name}.${action.name}`,
        capability: capability.name,
        capabilityGate: sparkPermissionGateDescriptor(
          capability.permission,
          capability.permissions,
        ),
        actionGate: sparkPermissionGateDescriptor(
          action.permission,
          action.permissions,
        ),
      }))
    );
    const allowed = sql`exists(
      select 1 from json.array_each(${
      sql.lit(JSON.stringify(catalog))
    }::json) spark_action
      where spark_action.value->>'actionName' = ${actionName}
        and exists(
          select 1 from db.spark_conversations conversation
          where conversation.id = ${session}
            and conversation.capabilities_json @> json_build_array(
              spark_action.value->>'capability'
            )
        )
        and ${
      hasSparkPermissionGateDescriptor(
        sql`spark_action.value->'capabilityGate'`,
        user,
      )
    }
        and ${
      hasSparkPermissionGateDescriptor(
        sql`spark_action.value->'actionGate'`,
        user,
      )
    }
    )`;
    return sql`(${allowed})
      and exists(select 1 from db.sys_users u where u.id = ${user} and not u.disabled)
      and (${
      userHasPermission(sql.lit(opts.accessPermission ?? "can_use_spark"), user)
    })`;
  }
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
