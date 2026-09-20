import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { createICtxKey, useOptionalICtx } from "std/ui";
import { system } from "std/system";
import { getCapabilities } from "std/yolm_gen_api";
import {
  AuthBlock,
  getRolePermissions,
  getUserPermissions,
  userHasPermission,
} from "./index";

export const AccessActorICtxKey = createICtxKey<{
  assertOriginalActor(s: UiServerStatements): void;
}>("AccessActor");

/** No client-supplied identity is accepted for administrative operations. */
export function assertOriginalAccessActor(s: UiServerStatements) {
  if (!system.block(AuthBlock).opts.accessPolicy) return;
  // Explicit preview/dev auth bypass has no session cookie to compare.
  if (getCapabilities()?.blocks?.AuthBlock?.authEnabled === false) return;
  const ctx = useOptionalICtx(AccessActorICtxKey);
  if (!ctx) {
    s.throwError(sql.lit`Access management requires an authenticated session.`);
    return;
  }
  s.block((s) => ctx.assertOriginalActor(s));
}

/** Effective authority is always resolved by AuthBlock, including overrides. */
export function isAccessAdministrator(user: NumericExpr = sql`current_user`) {
  const policy = system.block(AuthBlock).opts.accessPolicy;
  return policy
    ? userHasPermission(sql.lit(policy.sysadminPermission), user)
    : sql.false;
}

export function canManageStaffAccess(user: NumericExpr = sql`current_user`) {
  return sql`(${isAccessAdministrator(user)} or ${
    userHasPermission(sql.lit`can_manage_staff_access`, user)
  })`;
}

export function canViewStaffAccess(user: NumericExpr = sql`current_user`) {
  return sql`(${canManageStaffAccess(user)} or ${
    userHasPermission(sql.lit`can_impersonate_users`, user)
  })`;
}

export function userAccessWithinActor(actor: NumericExpr, target: NumericExpr) {
  return sql`not exists (
    select 1 from (${getUserPermissions(target)}) target_permission
    where not exists (
      select 1 from (${getUserPermissions(actor)}) actor_permission
      where actor_permission.permission = target_permission.permission
    )
  )`;
}

export function canImpersonateUser(actor: NumericExpr, target: NumericExpr) {
  const auth = system.block(AuthBlock);
  const eligible = auth.opts.disableDisabled
    ? sql`exists (select 1 from db.sys_users where id = ${actor})
      and exists (select 1 from db.sys_users where id = ${target})`
    : sql`exists (select 1 from db.sys_users where id = ${actor} and not disabled)
      and exists (select 1 from db.sys_users where id = ${target} and not disabled)`;
  return sql`case
    when ${actor} is null or ${target} is null or ${actor} = ${target} then false
    when not (${eligible}) then false
    when ${isAccessAdministrator(actor)} then true
    when ${userHasPermission(sql.lit`can_impersonate_users`, actor)}
      then ${userAccessWithinActor(actor, target)}
    else false
  end`;
}

export function protectedAccessPermission(permission: Sql) {
  const policy = system.block(AuthBlock).opts.accessPolicy;
  return sql.inList(permission, [
    sql.lit`can_manage_staff_access`,
    sql.lit`can_impersonate_users`,
    ...(policy ? [sql.lit(policy.sysadminPermission)] : []),
  ]);
}

/** Approval is checked against the role's current inherited grants as well as its name. */
export function canAssignStaffRole(actor: NumericExpr, role: NumericExpr) {
  const policy = system.block(AuthBlock).opts.accessPolicy;
  const names = policy?.assignableRoles;
  const approved = names === undefined
    ? sql.true
    : names.length
    ? sql`exists (select 1 from db.auth_roles where id = ${role}
        and ${sql.inList(sql`name`, names.map(sql.lit))})`
    : sql.false;
  return sql`(${isAccessAdministrator(actor)} or (
    ${canManageStaffAccess(actor)} and ${approved}
    and not exists (
      select 1 from (${getRolePermissions(role)}) granted
      where ${protectedAccessPermission(sql`granted.permission`)}
    )
  ))`;
}

export function canManageStaffUser(actor: NumericExpr, target: NumericExpr) {
  return sql`(${isAccessAdministrator(actor)} or (
    ${canManageStaffAccess(actor)} and ${actor} != ${target}
    and exists (select 1 from db.sys_users where id = ${target})
    and not exists (
      select 1 from (${getUserPermissions(target)}) granted
      where ${protectedAccessPermission(sql`granted.permission`)}
    )
  ))`;
}

export function assertAccessAdministrator(s: UiServerStatements) {
  if (!system.block(AuthBlock).opts.accessPolicy) return;
  s.throwErrorIf(
    sql`${isAccessAdministrator()} is not true`,
    sql.lit`System administration is required to change access definitions.`,
  );
}
