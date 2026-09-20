import { userHasPermission } from "../auth/index";
import { type Sql, sql } from "../../std/sql_utils";

type PermissionList = readonly [string, ...string[]];

export type SparkPermissionRequirement =
  | { any: PermissionList; all?: never }
  | { all: PermissionList; any?: never };

export function hasSparkPermissionGate(
  permission: string | undefined,
  requirement: SparkPermissionRequirement | undefined,
  userId: Sql,
): Sql {
  if (permission !== undefined && requirement) {
    throw new Error(
      "Spark permission gate cannot define both permission and permissions",
    );
  }
  if (permission !== undefined) {
    return userHasPermission(sql.lit(permission), userId);
  }
  if (!requirement) return sql`true`;
  let result: Sql = requirement.any ? sql`false` : sql`true`;
  for (const permission of requirement.any ?? requirement.all) {
    const permitted = userHasPermission(sql.lit(permission), userId);
    result = requirement.any
      ? sql`${result} or ${permitted}`
      : sql`${result} and ${permitted}`;
  }
  return sql`(${result})`;
}
