import { userHasPermission } from "../auth/index";
import { type Sql, sql } from "../../std/sql_utils";

type PermissionList = readonly [string, ...string[]];

export type SparkPermissionRequirement =
  | { any: PermissionList; all?: never }
  | { all: PermissionList; any?: never };

/** Generation-static data, never supplied by a tool caller. */
export type SparkPermissionGateDescriptor =
  | { readonly mode: "all"; readonly permissions: readonly string[] }
  | { readonly mode: "any"; readonly permissions: PermissionList };

export function sparkPermissionGateDescriptor(
  permission: string | undefined,
  requirement: SparkPermissionRequirement | undefined,
): SparkPermissionGateDescriptor {
  if (permission !== undefined && requirement) {
    throw new Error(
      "Spark permission gate cannot define both permission and permissions",
    );
  }
  if (permission !== undefined) {
    return { mode: "all", permissions: [permission] };
  }
  if (!requirement) return { mode: "all", permissions: [] };
  return requirement.any
    ? { mode: "any", permissions: requirement.any }
    : { mode: "all", permissions: requirement.all };
}

/** Fixed-shape evaluation of a gate in a static metadata catalog. */
export function hasSparkPermissionGateDescriptor(
  descriptor: Sql,
  userId: Sql,
): Sql {
  const permissions = sql`(${descriptor})->'permissions'`;
  const permitted = userHasPermission(
    sql`try_cast(spark_permission.value #>> '{}' as enums.auth_permission)`,
    userId,
  );
  return sql`case (${descriptor})->>'mode'
    when 'all' then not exists(
      select 1 from json.array_each(${permissions}) spark_permission
      where not ${permitted}
    )
    when 'any' then exists(
      select 1 from json.array_each(${permissions}) spark_permission
      where ${permitted}
    )
    else false
  end`;
}

export function hasSparkPermissionGate(
  permission: string | undefined,
  requirement: SparkPermissionRequirement | undefined,
  userId: Sql,
): Sql {
  const gate = sparkPermissionGateDescriptor(permission, requirement);
  if (permission !== undefined) {
    return userHasPermission(sql.lit(permission), userId);
  }
  let result: Sql = gate.mode === "any" ? sql`false` : sql`true`;
  for (const permission of gate.permissions) {
    const permitted = userHasPermission(sql.lit(permission), userId);
    result = gate.mode === "any"
      ? sql`${result} or ${permitted}`
      : sql`${result} and ${permitted}`;
  }
  return gate.permissions.length === 0 ? result : sql`(${result})`;
}
