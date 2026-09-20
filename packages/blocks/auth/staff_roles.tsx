import { Chip } from "components/chip";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Conditional, Each, Show } from "std/ui";
import { AuthBlock } from "./index";
import { accessRuleSourceLabel } from "./access_sources";
import {
  assertOriginalAccessActor,
  canAssignStaffRole,
  canManageStaffUser,
  isAccessAdministrator,
} from "./access_policy";

/** One role list for assigned access and permitted staff-management actions. */
export function UserRoles(props: {
  beforeMutation?: (s: UiServerStatements, userId: Sql) => void;
}) {
  const policy = system.block(AuthBlock).opts.accessPolicy;
  const changeRole = (s: UiServerStatements, assign: boolean) => {
    s.startTransaction();
    assertOriginalAccessActor(s);
    props.beforeMutation?.(s, sql`ui.record_id`);
    s.callStoredProcedure("auth_change_staff_role", {
      inputScalars: {
        p_actor_id: sql`current_user`,
        p_user_id: sql`ui.record_id`,
        p_role_id: sql`user_role.id`,
        p_assign: assign,
      },
    });
    s.commitTransaction();
  };
  return (
    <Data
      local
      noRefetch
      procedure={(s) => s.defScalar("user_role_search", sql.lit``)}
    >
      <Data
        procedure={(s) => {
          s.defScalar(
            "can_edit_staff_roles",
            policy
              ? sql.and(
                sql.not(isAccessAdministrator()),
                canManageStaffUser(sql`current_user`, sql`ui.record_id`),
              )
              : sql.false,
          );
          s.defTable(
            "user_role_sources",
            sql`select distinct auth_role_id,
          ${
              accessRuleSourceLabel(sql`source`, sql`source_record_id`)
            } as source_label
          from db.auth_user_role_sources where sys_user_id = ui.record_id`,
          );
          s.defTable(
            "user_roles",
            sql`select role.id, role.name,
          exists (select 1 from db.auth_user_roles assignment
            where assignment.auth_role_id = role.id and assignment.sys_user_id = ui.record_id) as assigned,
          exists (select 1 from user_role_sources source where source.auth_role_id = role.id) as rule_managed,
          ${
              policy
                ? sql.and(
                  sql`can_edit_staff_roles`,
                  canAssignStaffRole(sql`current_user`, sql`role.id`),
                )
                : sql.false
            } as assignable
          from db.auth_roles role
          where exists (select 1 from db.auth_user_roles assignment
            where assignment.auth_role_id = role.id and assignment.sys_user_id = ui.record_id)
            or exists (select 1 from user_role_sources source where source.auth_role_id = role.id)
            or ${
              policy
                ? sql.and(
                  sql`can_edit_staff_roles`,
                  canAssignStaffRole(sql`current_user`, sql`role.id`),
                )
                : sql.false
            }
          order by assigned desc, rule_managed desc, role.name`,
          );
        }}
      >
        <div className="min-w-0">
          <Show when={sql`can_edit_staff_roles`}>
            <Typography level="body-sm" className="mb-3 text-secondary">
              Assign approved roles. Rule-managed access is changed through the
              workforce rule.
            </Typography>
            <Input
              size="sm"
              startIcon="Search"
              placeholder="Search roles..."
              value={sql`user_role_search`}
              onInput={(s) =>
                s.setScalar("user_role_search", sql`target_value`)}
              className="mb-3 w-full"
            />
          </Show>
          <div className="divide-y divide-divider">
            <Each
              table="user_roles"
              recordName="user_role"
              where={sql`contains(lower(user_role.name), lower(user_role_search))`}
            >
              <div
                role="group"
                aria-label={sql`user_role.name || ' role'`}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <MaterialIcon
                    icon="ShieldOutlined"
                    className="shrink-0 text-primary-500"
                  />
                  <Typography className="font-medium">
                    {sql`user_role.name`}
                  </Typography>
                  <Show when={sql`user_role.assigned`}>
                    <Chip size="sm" variant="outlined" color="neutral">
                      Manual
                    </Chip>
                  </Show>
                  <Each
                    table="user_role_sources"
                    recordName="role_source"
                    where={sql`role_source.auth_role_id = user_role.id`}
                  >
                    <Chip
                      size="sm"
                      variant="outlined"
                      color="neutral"
                      startIcon="RuleOutlined"
                    >
                      Rule · {sql`role_source.source_label`}
                    </Chip>
                  </Each>
                </div>
                {policy && (
                  <Show when={sql`user_role.assignable`}>
                    <Conditional
                      when={sql`user_role.assigned`}
                      then={
                        <ActionButton
                          size="sm"
                          variant="plain"
                          color="danger"
                          startIcon="RemoveCircleOutline"
                          action={(s) => changeRole(s, false)}
                        >
                          Remove role
                        </ActionButton>
                      }
                      else={
                        <ActionButton
                          size="sm"
                          variant="soft"
                          color="primary"
                          startIcon="AddCircleOutline"
                          action={(s) => changeRole(s, true)}
                        >
                          Assign role
                        </ActionButton>
                      }
                    />
                  </Show>
                )}
              </div>
            </Each>
          </div>
          <Show when={sql`not exists (select 1 from user_roles)`}>
            <Typography level="body-sm" className="text-secondary">
              No roles found
            </Typography>
          </Show>
          <Show
            when={sql`exists (select 1 from user_roles) and not exists (
            select 1 from user_roles where contains(lower(name), lower(user_role_search)))`}
          >
            <Typography
              level="body-sm"
              className="py-4 text-center text-secondary"
            >
              No roles match your search.
            </Typography>
          </Show>
        </div>
      </Data>
    </Data>
  );
}
