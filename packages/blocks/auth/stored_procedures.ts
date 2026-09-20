import { sql } from "std/sql_utils";
import { system } from "std/system";
import { canAssignStaffRole, canManageStaffUser } from "./access_policy";

export function registerStaffAccessProcedure() {
  system.storedProcedure({
    name: "auth_change_staff_role",
    transaction: "caller",
    inputScalars: [
      { name: "p_actor_id", type: "BigInt" },
      { name: "p_user_id", type: "BigInt" },
      { name: "p_role_id", type: "BigInt" },
      { name: "p_assign", type: "Bool", notNull: true },
    ],
    procedure: (s) => {
      // The caller verifies the original session and binds its current_user.
      // Recheck authority against the database inside the write transaction.
      s.throwErrorIf(
        sql`${canManageStaffUser(sql`p_actor_id`, sql`p_user_id`)} is not true`,
        sql.lit`You cannot change your own access or a protected account.`,
      );
      s.throwErrorIf(
        sql`${canAssignStaffRole(sql`p_actor_id`, sql`p_role_id`)} is not true`,
        sql.lit`This role requires system administration.`,
      );
      s.if(sql`p_assign`, (s) => {
        s.modify(sql`insert into db.auth_user_roles (sys_user_id, auth_role_id)
          select p_user_id, p_role_id where not exists (
            select 1 from db.auth_user_roles
            where sys_user_id = p_user_id and auth_role_id = p_role_id
          )`);
      }, (s) => {
        // An explicit removal stays a removal even when the UI is stale.
        s.modify(sql`delete from db.auth_user_roles
          where sys_user_id = p_user_id and auth_role_id = p_role_id`);
      });
    },
  });
}
