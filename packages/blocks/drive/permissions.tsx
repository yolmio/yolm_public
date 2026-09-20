import { Button } from "components/button";
import { Chip } from "components/chip";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import { system } from "std/system";
import type { UiServerStatements } from "std/statements";
import { Each, Show } from "std/ui";
import type { DriveBlockContract, DriveSpaceType } from "./types.ts";

export interface FileSpacePermissionsPanelProps {
  files: DriveBlockContract;
  type: DriveSpaceType;
  spaceId: AnyExpr;
}

/**
 * Direct sharing for standalone spaces (and contextual providers that
 * explicitly opt in). Record-bound spaces otherwise explain where inherited
 * access is managed.
 */
export function FileSpacePermissionsPanel(
  props: FileSpacePermissionsPanelProps,
) {
  const userTable = system.db.tables.sys_users;
  const userDisplayName = (record: Sql) =>
    userTable.recordDisplayName
      ? userTable.getRecordDisplayNameExpr(record)
      : sql`'User #' || cast(${record}.id as string)`;
  const authPermissions = Object.values(system.enums.auth_permission.values);
  const authPermissionRows = authPermissions.length === 0
    ? sql`
      select '' as permission, '' as display_name
      where false
    `
    : authPermissions
      .map((permission) =>
        sql`select ${sql.lit(permission.name)} as permission,
                   ${sql.lit(permission.displayName ?? permission.name)}
                     as display_name`
      )
      .reduce((a, b) => sql`${a} union all ${b}`);
  return (
    <Data
      procedure={(s) => {
        s.if(
          sql`
            not (${
            props.files.accessSql(
              props.type,
              props.spaceId as Sql,
              sql`current_user`,
              "read",
            )
          })
          `,
          (s) =>
            s.throwError(
              sql.lit`You cannot view access for this file space.`,
            ),
        );
        s.defScalar(
          "files_permissions_can_manage",
          props.files.accessSql(
            props.type,
            props.spaceId as Sql,
            sql`current_user`,
            "manage",
          ),
        );
        if (props.type.grants?.users) {
          s.defTable(
            "file_user_grants",
            sql`
              select
                grant_row.id,
                grant_row.sys_user_id,
                grant_row.access_level,
                ${userDisplayName(sql`user_record`)} as display_name
              from db.file_space_user_grants grant_row
              join db.sys_users user_record
                on user_record.id = grant_row.sys_user_id
              where grant_row.file_space_id = ${props.spaceId}
              order by display_name collate nocase
            `,
          );
          s.defTable(
            "file_ungranted_users",
            sql`
              select
                user_record.id,
                ${userDisplayName(sql`user_record`)} as display_name
              from db.sys_users user_record
              where user_record.id <> current_user
                and not exists (
                  select 1
                  from db.file_space_user_grants grant_row
                  where grant_row.file_space_id = ${props.spaceId}
                    and grant_row.sys_user_id = user_record.id
                )
              order by display_name collate nocase
              limit 20
            `,
          );
        }
        if (props.type.grants?.permissions) {
          s.defTable(
            "file_permission_grants",
            sql`
              select
                grant_row.id,
                cast(grant_row.permission as string) as permission,
                grant_row.access_level,
                permission_meta.display_name
              from db.file_space_permission_grants grant_row
              join (${authPermissionRows}) permission_meta
                on permission_meta.permission =
                  cast(grant_row.permission as string)
              where grant_row.file_space_id = ${props.spaceId}
              order by permission_meta.display_name collate nocase
            `,
          );
          s.defTable(
            "file_ungranted_permissions",
            sql`
              select
                permission_meta.permission,
                permission_meta.display_name
              from (${authPermissionRows}) permission_meta
              where not exists (
                select 1
                from db.file_space_permission_grants grant_row
                where grant_row.file_space_id = ${props.spaceId}
                  and cast(grant_row.permission as string) =
                    permission_meta.permission
              )
              order by permission_meta.display_name collate nocase
            `,
          );
        }
      }}
    >
      <section className="rounded-lg border border-divider bg-surface p-4">
        <Typography level="title-md" startIcon="Group">
          Access
        </Typography>
        {props.type.grants?.users || props.type.grants?.permissions
          ? (
            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              {props.type.grants?.users
                ? (
                  <GrantColumn
                    files={props.files}
                    type={props.type}
                    kind="user"
                    spaceId={props.spaceId}
                    canManage={sql`files_permissions_can_manage`}
                  />
                )
                : null}
              {props.type.grants?.permissions
                ? (
                  <GrantColumn
                    files={props.files}
                    type={props.type}
                    kind="permission"
                    spaceId={props.spaceId}
                    canManage={sql`files_permissions_can_manage`}
                  />
                )
                : null}
            </div>
          )
          : (
            <p className="mt-3 text-sm text-secondary">
              Access is defined by this space type and is managed on its owning
              record or through Auth permissions.
            </p>
          )}
      </section>
    </Data>
  );
}

function GrantColumn(props: {
  files: DriveBlockContract;
  type: DriveSpaceType;
  kind: "user" | "permission";
  spaceId: AnyExpr;
  canManage: Sql;
}) {
  const grants = props.kind === "user"
    ? "file_user_grants"
    : "file_permission_grants";
  const candidates = props.kind === "user"
    ? "file_ungranted_users"
    : "file_ungranted_permissions";
  const table = props.kind === "user"
    ? "file_space_user_grants"
    : "file_space_permission_grants";
  const field = props.kind === "user" ? "sys_user_id" : "permission";
  const candidateValue = props.kind === "user"
    ? sql`file_candidate.id`
    : sql`file_candidate.permission::enums.auth_permission`;
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase text-secondary">
        {props.kind === "user" ? "People" : "Permissions"}
      </div>
      <div className="space-y-2">
        <Each table={grants} recordName="file_grant">
          <div className="flex items-center gap-2 rounded-md border border-divider p-2">
            <span className="min-w-0 flex-1 truncate text-sm">
              {sql`file_grant.display_name`}
            </span>
            <Button
              size="xs"
              variant="plain"
              color="neutral"
              disabled={sql`not ${props.canManage}`}
              onClick={(s) => {
                s.server((s) => {
                  assertCanManageDirectGrants(s, props);
                  s.startTransaction();
                  s.modify(sql`
                    update db.${sql.ref(table)}
                    set access_level = case access_level
                      when 'viewer' then 'editor'
                      when 'editor' then 'manager'
                      else 'viewer'
                    end
                    where id = file_grant.id
                      and file_space_id = ${props.spaceId}
                  `);
                  s.commitTransaction();
                });
                s.refetch();
              }}
            >
              {sql`file_grant.access_level`}
            </Button>
            <Button
              size="xs"
              variant="plain"
              color="danger"
              disabled={sql`not ${props.canManage}`}
              onClick={(s) => {
                s.server((s) => {
                  assertCanManageDirectGrants(s, props);
                  s.startTransaction();
                  s.modify(sql`
                    delete from db.${sql.ref(table)}
                    where id = file_grant.id
                      and file_space_id = ${props.spaceId}
                  `);
                  s.commitTransaction();
                });
                s.refetch();
              }}
            >
              Remove
            </Button>
          </div>
        </Each>
      </div>
      <Show when={props.canManage}>
        <div className="mt-3 max-h-48 space-y-1 overflow-auto rounded-md bg-level1 p-2">
          <Each table={candidates} recordName="file_candidate">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-surface"
              onClick={(s) => {
                s.server((s) => {
                  assertCanManageDirectGrants(s, props);
                  s.startTransaction();
                  s.modify(sql`
                    insert into db.${sql.ref(table)} (
                      file_space_id,
                      ${sql.ref(field)},
                      access_level
                    ) values (
                      ${props.spaceId},
                      ${candidateValue},
                      'viewer'
                    )
                  `);
                  s.commitTransaction();
                });
                s.refetch();
              }}
            >
              <span className="truncate">
                {sql`file_candidate.display_name`}
              </span>
              <Chip size="sm" variant="outlined">Add viewer</Chip>
            </button>
          </Each>
        </div>
      </Show>
    </div>
  );
}

function assertCanManageDirectGrants(
  s: UiServerStatements,
  props: {
    files: DriveBlockContract;
    type: DriveSpaceType;
    kind: "user" | "permission";
    spaceId: AnyExpr;
  },
) {
  s.if(
    sql`
      not (${
      props.files.accessSql(
        props.type,
        props.spaceId as Sql,
        sql`current_user`,
        "manage",
      )
    })
    `,
    (s) => s.throwError(sql.lit`You cannot manage access to this file space.`),
  );
}
