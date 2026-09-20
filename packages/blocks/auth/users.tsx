import { Button } from "components/button";
import { Card, CardHeader } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip, ChipDelete } from "components/chip";
import { DataTable } from "components/data_table";
import type { ColumnsBuilder } from "components/data_table";
import { Divider } from "components/divider";
import { FormHelperText } from "components/form_helper_text";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { List, ListItem } from "components/list";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { ModalDialog } from "components/modal";
import { PageHeader } from "components/page_header";
import { Snackbar } from "components/snackbar";
import { TableRecordSelect } from "components/table_record_select";
import { InlineRecordDisplay } from "components/inline_record_display";
import { Typography } from "components/typography";
import { CurrentRefetchICtxKey, FormICtxKey } from "std/ictx";
import { Data } from "std/data";
import { singularize } from "std/inflectors";
import { buildSearchExpression } from "std/search_utils";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type { Style } from "std/style_types";
import { baseGridStyles, containerStyles } from "std/style_utils";
import { system, useBlock } from "std/system";
import type { RankedSearchTable, UiServerStatements } from "std/statements";
import type { Node } from "std/ui";
import { Conditional, Each, Show, useApp, useICtx, usePhase } from "std/ui";
import {
  Form,
  useCurrentTableHelper,
  useCursorHelper,
  useFieldHelper,
} from "std/form";
import { FormControl as JoyFormControl } from "components/form_control";
import { FormLabel as JoyFormLabel } from "components/form_label";
import { Alert } from "components/alert";
import { RecordPage } from "pages/record_page";
import { AuthBlock, getUserPermissions, userHasPermission } from "./index";
import { PermissionFormEntries, PermissionListCard } from "./permissions";
import { RoleSelector } from "./role_selector";
import { accessRuleSourceLabel } from "./access_sources";
import { UserRoles } from "./staff_roles";
import { AccessCheck } from "./access_check";
import {
  assertAccessAdministrator,
  assertOriginalAccessActor,
  canImpersonateUser,
  isAccessAdministrator,
} from "./access_policy";

export function UserForm(props: { isNew?: boolean; cards?: Node }) {
  if (usePhase() !== "gather" && system.block(AuthBlock).opts.accessPolicy) {
    useICtx(FormICtxKey).registerAuthorization((s) => {
      assertOriginalAccessActor(s);
      assertAccessAdministrator(s);
    });
  }
  return (
    <div sx={[containerStyles(), baseGridStyles, { gap: 6 }]}>
      <PageHeader>
        <div>
          <Typography level="h3">
            {props.isNew ? "Create Login" : "Edit Login & Access"}
          </Typography>
          <Typography level="body-sm">
            {props.isNew
              ? "Create a login and assign its access"
              : "Manage account status, roles, and direct permission overrides"}
          </Typography>
        </div>
        <Form.Field field="disabled">
          {!props.isNew && <DisableButton />}
        </Form.Field>
        <PageHeader.Grow />
        <PageHeader.Actions>
          <Button
            variant="outlined"
            color="neutral"
            startIcon="Close"
            href={props.isNew
              ? "/users"
              : sql.concat("/users/", sql`ui.record_id`)}
          >
            Cancel
          </Button>
          <Form.SubmitButton startIcon="Save">
            {props.isNew ? "Create Login" : "Save Access"}
          </Form.SubmitButton>
        </PageHeader.Actions>
      </PageHeader>

      <Form.ErrorAlert sx={{ gridColumnSpan: 12 }} />

      {props.cards}
      <Card variant="outlined" sx={{ gridColumnSpan: 12 }}>
        <CardHeader>
          <Typography level="title-lg">Roles</Typography>
        </CardHeader>
        <div className="py-4 flex flex-col">
          <UserRolesFormControl isNew={props.isNew} />
        </div>
      </Card>
      <PermissionsFormCard
        isNew={props.isNew}
        sx={{ gridColumnSpan: 12 }}
      />
    </div>
  );
}

function DisableButton() {
  if (usePhase() === "gather") {
    return null;
  }
  const field = useFieldHelper();
  return (
    <Conditional
      when={sql`${field.value} is true`}
      then={
        <Button
          variant="outlined"
          color="success"
          startIcon="CheckCircle"
          size="sm"
          onClick={(s) => {
            field.setValue(s, false);
          }}
        >
          Enable this user
        </Button>
      }
      else={
        <Button
          variant="outlined"
          color="danger"
          startIcon="Close"
          size="sm"
          onClick={(s) => {
            field.setValue(s, true);
          }}
        >
          Disable this user
        </Button>
      }
    />
  );
}

interface UserRolesFormControlProps {
  isNew?: boolean;
}

function RuleManagedUserRoles() {
  return (
    <Data
      pendingFallback={null}
      procedure={(s) => {
        s.defTable(
          "rule_managed_user_roles",
          sql`
            select role.name as role_name,
                   ${
            accessRuleSourceLabel(
              sql`source.source`,
              sql`source.source_record_id`,
            )
          } as source_label
            from db.auth_user_role_sources source
            join db.auth_roles role on role.id = source.auth_role_id
            where source.sys_user_id = ui.record_id
            order by role.name, source.source, source.source_record_id
          `,
        );
      }}
    >
      <Show when={sql`exists (select 1 from rule_managed_user_roles)`}>
        <Divider inset="none" className="my-4" />
        <Typography level="title-sm" className="mb-2">
          Rule-managed roles
        </Typography>
        <Typography level="body-sm" className="text-neutral-500 mb-3">
          These roles are read-only here. Change the rule that assigned them.
        </Typography>
        <div className="flex flex-col gap-2">
          <Each table="rule_managed_user_roles" recordName="sourced_role">
            <div className="flex flex-wrap items-center gap-2">
              <Chip
                variant="soft"
                color="primary"
                startIcon="ShieldOutlined"
              >
                {sql`sourced_role.role_name`}
              </Chip>
              <Chip
                variant="outlined"
                color="neutral"
                size="sm"
                startIcon="RuleOutlined"
              >
                {sql`sourced_role.source_label`}
              </Chip>
            </div>
          </Each>
        </div>
      </Show>
    </Data>
  );
}

function UserRolesFormControl(props: UserRolesFormControlProps) {
  return (
    <>
      <Form.Relation
        table="auth_user_roles"
        field="sys_user_id"
        many
        fields={["auth_role_id"]}
        dontInitialize={props.isNew}
      >
        <Typography level="title-sm" className="mb-2">
          Manually assigned roles
        </Typography>
        <div
          sx={{
            display: "flex",
            gap: 2,
            flexDirection: "row",
            flexWrap: "wrap",
            "&:not(&:empty)": {
              pb: 4,
            },
          }}
        >
          <Form.Each recordName="role">
            <Data
              watch={sql`role.write_ui_id`}
              procedure={(s) => {
                s.defScalar(
                  "role_name",
                  sql`(select name from auth_roles where id = role.auth_role_id)`,
                );
              }}
            >
              <Chip
                variant="soft"
                startDecorator={<MaterialIcon icon="ShieldOutlined" />}
                endDecorator={
                  <ChipDelete
                    aria-label={sql`'Remove manually assigned role ' || role_name`}
                    onClick={(s) => {
                      const helper = useCursorHelper();
                      helper.delete(s);
                    }}
                  />
                }
              >
                {sql`role_name`}
              </Chip>
            </Data>
          </Form.Each>
        </div>
        <RoleSelector
          selected={(role) =>
            sql`exists (
            select 1 from write_auth_user_roles where auth_role_id = ${role}
          )`}
          onSelect={(s, role) => {
            const table = useCurrentTableHelper();
            table.addRecord(s, { auth_role_id: role });
          }}
        />
      </Form.Relation>
      {!props.isNew && <RuleManagedUserRoles />}
    </>
  );
}

interface UsersListProps {
  columns?: (b: ColumnsBuilder) => void;
  /** Additional SELECT columns to add to the query, e.g. `sql`e.email as employee_email`` */
  additionalColumns?: Sql;
  /** Additional FROM/JOIN clauses, e.g. `sql`left join db.employees e on e.id = u.employee_id`` */
  additionalFrom?: Sql;
  disableAddButton?: boolean;
  backHomeButton?: boolean;
  /** Restrict which identities appear. The callback receives dt_base.id. */
  userFilter?: (userId: Sql) => BooleanExpr;
}

function hasSearchFields(config: RankedSearchTable | undefined) {
  return !!config &&
    ((config.fields?.length ?? 0) > 0 ||
      (config.fieldGroups?.length ?? 0) > 0);
}

export function UsersList({
  columns: extraColumns,
  additionalColumns,
  additionalFrom,
  disableAddButton,
  backHomeButton,
  userFilter,
}: UsersListProps) {
  const permissionsEnum = system.enums.auth_permission;
  const permissionDisplayCaseParts = permissionsEnum.valuesMap.values()
    .map((p) =>
      sql`when up.permission = ${sql.lit(p.name)} then ${
        sql.lit(p.displayName ?? p.name)
      }`
    )
    .reduce((a, b) => sql`${a} ${b}`);
  const permissionDisplayCase =
    sql`case ${permissionDisplayCaseParts} else cast(up.permission as string) end`;

  // Join each user-type table and expose its display + email fields as
  // aliased columns so DataTable can search them. Without this the search
  // input has no string columns to match against (sys_users itself doesn't
  // carry the user's name/email — those live on the user-type tables).
  const authBlock = useBlock(AuthBlock);
  const userTypeJoins: Sql[] = [];
  const userTypeSelects: Sql[] = [];
  const userTypeDisplayNames: Sql[] = [];
  const searchFields: string[] = [];
  const sysUsersTable = system.db.tables.sys_users;
  const sysUsersSearchConfig = sysUsersTable.getSearchConfig();
  if (hasSearchFields(sysUsersSearchConfig)) {
    const colAlias = "sys_user_search_text";
    userTypeSelects.push(
      sql`${buildSearchExpression(sysUsersSearchConfig!, "u")} as ${
        sql.ref(colAlias)
      }`,
    );
    searchFields.push(colAlias);
  }
  sysUsersSearchConfig?.relatedTables?.forEach((relatedSearchConfig, index) => {
    if (typeof relatedSearchConfig.table !== "string") {
      return;
    }
    if (!hasSearchFields(relatedSearchConfig)) {
      return;
    }
    const relationParts = relatedSearchConfig.relationField.split(".");
    if (relationParts.length !== 2) {
      return;
    }
    const [relationTableName, relationFieldName] = relationParts;
    const relatedTable = system.db.tables[relatedSearchConfig.table];
    if (!relatedTable) {
      return;
    }
    const alias = `usr_search_${relatedTable.name}_${index}`;
    const aliasIdent = sql.ref(alias);
    if (relationTableName === "sys_users") {
      userTypeJoins.push(
        sql`left join ${relatedTable.identWithDb} as ${aliasIdent} on ${aliasIdent}.${relatedTable.primaryKeyIdent} = u.${
          sql.ref(relationFieldName)
        }`,
      );
    } else if (relationTableName === relatedTable.name) {
      userTypeJoins.push(
        sql`left join ${relatedTable.identWithDb} as ${aliasIdent} on ${aliasIdent}.${
          sql.ref(relationFieldName)
        } = u.${sysUsersTable.primaryKeyIdent}`,
      );
    } else {
      return;
    }
    const colAlias = `${alias}_search_text`;
    userTypeSelects.push(
      sql`${buildSearchExpression(relatedSearchConfig, alias)} as ${
        sql.ref(colAlias)
      }`,
    );
    searchFields.push(colAlias);
  });
  for (const ut of authBlock.userTypes) {
    const alias = `ut_${singularize(ut.table.name)}`;
    const aliasIdent = sql.ref(alias);
    userTypeJoins.push(
      sql`left join ${ut.table.identWithDb} as ${aliasIdent} on ${aliasIdent}.id = u.${
        sql.ref(ut.fieldName)
      }`,
    );
    const fields = new Set(ut.table.recordDisplayName?.fields ?? []);
    if (ut.table.fields.email) {
      fields.add("email");
    }
    if (ut.table.recordDisplayName) {
      userTypeDisplayNames.push(
        ut.table.recordDisplayName.expr(
          ...ut.table.recordDisplayName.fields.map((f) =>
            sql`${aliasIdent}.${sql.ref(f)}`
          ),
        ),
      );
    }
    for (const f of fields) {
      const colAlias = `${alias}_${f}`;
      userTypeSelects.push(
        sql`${aliasIdent}.${sql.ref(f)} as ${sql.ref(colAlias)}`,
      );
      searchFields.push(colAlias);
    }
  }
  // sys_users itself may carry a record display name (e.g. resolved through
  // a person fk); prefer it so the list identifies users even when no
  // userTypes are registered.
  if (sysUsersTable.recordDisplayName) {
    userTypeDisplayNames.unshift(
      sysUsersTable.recordDisplayName.expr(
        ...sysUsersTable.recordDisplayName.fields.map((f) =>
          sql`u.${sql.ref(f)}`
        ),
      ),
    );
  }
  const hasUserDisplayName = userTypeDisplayNames.length > 0;
  if (hasUserDisplayName) {
    userTypeSelects.push(
      sql`${sql.coalesce(...userTypeDisplayNames)} as user_display_name`,
    );
    searchFields.push("user_display_name");
  }
  const mergedAdditionalColumns = [
    ...(additionalColumns ? [additionalColumns] : []),
    ...userTypeSelects,
  ].reduce<Sql | undefined>(
    (acc, part) => acc ? sql`${acc}, ${part}` : part,
    undefined,
  );
  const mergedAdditionalFrom = userTypeJoins.reduce<Sql>(
    (acc, join) => sql`${acc} ${join}`,
    additionalFrom ?? sql``,
  );
  const roleFilter = sql`case
    when selected_role is null then true
    else exists (
      select 1
      from db.auth_user_roles
      where sys_user_id = dt_base.id
        and auth_role_id = selected_role
    )
      or exists (
        select 1
        from db.auth_user_role_sources
        where sys_user_id = dt_base.id
          and auth_role_id = selected_role
      )
  end`;
  const baseQuery = sql`select
      u.*,
      (select string_agg(r.name, ', ' order by r.name)
        from db.auth_roles r
        where exists (
          select 1
          from db.auth_user_roles ur
          where ur.sys_user_id = u.id
            and ur.auth_role_id = r.id
        )
          or exists (
            select 1
            from db.auth_user_role_sources urs
            where urs.sys_user_id = u.id
              and urs.auth_role_id = r.id
          )
        limit 3) as role_names,
      (select count(*)
        from db.auth_roles r
        where exists (
          select 1
          from db.auth_user_roles ur
          where ur.sys_user_id = u.id
            and ur.auth_role_id = r.id
        )
          or exists (
            select 1
            from db.auth_user_role_sources urs
            where urs.sys_user_id = u.id
              and urs.auth_role_id = r.id
          )) as role_count,
      (select string_agg(${permissionDisplayCase}, ', ' order by up.permission)
        from (${getUserPermissions(sql`u.id`)}) up limit 3) as permission_names,
      (select count(*) from (${
    getUserPermissions(sql`u.id`)
  }) up) as permission_count
      ${mergedAdditionalColumns ? sql`, ${mergedAdditionalColumns}` : sql``}
    from db.sys_users u
    ${mergedAdditionalFrom}`;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("selected_role", { type: "BigInt" });
      }}
    >
      <DataTable
        query={baseQuery}
        primaryTable="sys_users"
        className="h-[calc(100vh-70px)]"
        scrollable
        searchable={searchFields.length > 0 ? searchFields : true}
        sortable
        pageSize={25}
        where={userFilter
          ? sql.and(userFilter(sql`dt_base.id`), roleFilter)
          : roleFilter}
        watch={[sql`selected_role`]}
        header={
          <UserCardHeader
            disableAddButton={disableAddButton}
            backHomeButton={backHomeButton}
          />
        }
        columns={(b) => {
          if (hasUserDisplayName) {
            b.column(
              "User",
              ({ record }) => (
                <span className="text-sm font-medium">
                  {sql`coalesce(${record}.user_display_name, 'User #' || ${record}.id::string)`}
                </span>
              ),
              { field: "user_display_name" },
            );
          }
          if (extraColumns) {
            extraColumns(b);
          }
          b.column(
            "Roles",
            ({ record }) => (
              <div className="flex flex-row gap-2 flex-wrap">
                <Show when={sql`${record}.role_names is not null`}>
                  {sql`${record}.role_names`}
                </Show>
                <Show when={sql`${record}.role_count > 3`}>
                  <span>&hellip;</span>
                </Show>
              </div>
            ),
            { field: "role_names" },
          );
          b.column(
            "Permissions",
            ({ record }) => (
              <div className="flex flex-row gap-2 flex-wrap items-center">
                <Show when={sql`${record}.permission_count > 0`}>
                  <Chip size="sm" variant="soft" color="neutral">
                    {sql`${record}.permission_count`}
                  </Chip>
                </Show>
                <Show when={sql`${record}.permission_names is not null`}>
                  <span className="text-sm">
                    {sql`${record}.permission_names`}
                  </span>
                </Show>
                <Show when={sql`${record}.permission_count > 3`}>
                  <span>&hellip;</span>
                </Show>
              </div>
            ),
            { field: "permission_names" },
          );
          b.column(
            "Status",
            ({ record }) => (
              <Conditional
                when={sql`${record}.disabled`}
                then={
                  <Chip color="danger" variant="plain" startIcon="Close">
                    Not Active
                  </Chip>
                }
                else={
                  <Chip color="success" variant="plain" startIcon="CheckCircle">
                    Active
                  </Chip>
                }
              />
            ),
            { field: "disabled" },
          );
        }}
        actions={(b) => {
          b.custom("Manage", { icon: "ManageAccountsOutlined" }, (s) => {
            s.navigate(sql`'/users/' || sys_user.id`);
          });
        }}
      />
    </Data>
  );
}

export interface UserAccountManagementButtonProps {
  userId: NumericExpr;
}

/**
 * Links a domain record to AuthBlock's dedicated login and access screen.
 * The caller owns the domain-to-user lookup; AuthBlock owns account management.
 */
export function UserAccountManagementButton(
  props: UserAccountManagementButtonProps,
) {
  return (
    <Conditional
      when={sql`${props.userId} is not null`}
      then={
        <Button
          variant="outlined"
          color="neutral"
          startIcon="ManageAccountsOutlined"
          href={sql`'/users/' || ${props.userId}`}
        >
          Manage login &amp; access
        </Button>
      }
      else={
        <Chip color="neutral" variant="soft" startIcon="PersonOffOutlined">
          No login
        </Chip>
      }
    />
  );
}

function ActiveChip() {
  return (
    <Conditional
      when={sql`user_info.disabled`}
      then={
        <Chip color="danger" variant="plain" startIcon="Close">
          Not Active
        </Chip>
      }
      else={
        <Chip color="success" variant="plain" startIcon="CheckCircle">
          Active
        </Chip>
      }
    />
  );
}

function RuleManagedPermissionEntries() {
  return (
    <Data
      pendingFallback={null}
      procedure={(s) => {
        s.defTable(
          "rule_managed_permission_entries",
          sql`
            select source.permission,
                   source.is_allowed,
                   ${
            accessRuleSourceLabel(
              sql`source.source`,
              sql`source.source_record_id`,
            )
          } as source_label,
                   exists (
                     select 1
                     from write_auth_user_permissions manual
                     where manual.permission = source.permission
                   ) as is_overridden
            from db.auth_user_permission_sources source
            where source.sys_user_id = ui.record_id
            order by source.permission, source.source, source.source_record_id
          `,
        );
      }}
    >
      <Show
        when={sql`exists (select 1 from rule_managed_permission_entries)`}
      >
        <Divider inset="none" className="my-4" />
        <Typography level="title-sm" className="mb-2">
          Rule-managed permission entries
        </Typography>
        <Typography level="body-sm" className="text-neutral-500 mb-3">
          These entries are read-only here. A manual override takes precedence.
        </Typography>
        <div className="flex flex-col gap-2">
          <Each
            table="rule_managed_permission_entries"
            recordName="sourced_permission"
          >
            <div
              role="group"
              aria-label={sql`'Rule-managed ' || fn.display_auth_permission(sourced_permission.permission)`}
              className="flex flex-wrap items-center gap-2 rounded-md border border-divider p-3"
            >
              <Typography level="body-md" className="min-w-48 flex-1">
                {sql`fn.display_auth_permission(sourced_permission.permission)`}
              </Typography>
              <Chip
                size="sm"
                variant="soft"
                color="success"
                conditionalVariants={[{
                  when: sql`not sourced_permission.is_allowed`,
                  color: "danger",
                }]}
              >
                {sql`case when sourced_permission.is_allowed then 'Allow' else 'Deny' end`}
              </Chip>
              <Chip
                size="sm"
                variant="outlined"
                color="neutral"
                startIcon="RuleOutlined"
              >
                {sql`sourced_permission.source_label`}
              </Chip>
              <Show when={sql`sourced_permission.is_overridden`}>
                <Chip size="sm" variant="soft" color="warning">
                  Overridden manually
                </Chip>
              </Show>
            </div>
          </Each>
        </div>
      </Show>
    </Data>
  );
}

interface PermissionsFormCardProps {
  isNew?: boolean;
  sx?: Style;
}

function PermissionsFormCard(props: PermissionsFormCardProps) {
  return (
    <Card variant="outlined" sx={props.sx}>
      <CardHeader>
        <div>
          <Typography level="title-lg">
            Manual permission overrides
          </Typography>
          <Typography level="body-sm" className="text-neutral-500">
            Use roles for normal access. Add an override only when this login
            needs an explicit grant or denial.
          </Typography>
        </div>
      </CardHeader>
      <div className="flex flex-col gap-3 py-4">
        <Form.Relation
          table="auth_user_permissions"
          field="sys_user_id"
          fields={["permission", "is_allowed"]}
          dontInitialize={props.isNew}
        >
          <Show
            when={sql`not exists (select 1 from write_auth_user_permissions)`}
          >
            <Alert color="neutral" variant="soft" startIcon="InfoOutlined">
              No manual permission overrides. Access currently comes from roles
              or rules.
            </Alert>
          </Show>
          <PermissionFormEntries overrides />
          {!props.isNew && <RuleManagedPermissionEntries />}
        </Form.Relation>
      </div>
    </Card>
  );
}
interface UsersCardHeaderProps {
  disableAddButton?: boolean;
  backHomeButton?: boolean;
}

function UserCardHeader(
  { disableAddButton, backHomeButton }: UsersCardHeaderProps,
) {
  return (
    <div className="p-4">
      <div className="flex justify-between items-center gap-4">
        {backHomeButton && (
          <IconButton
            variant="plain"
            color="neutral"
            className="mr-2"
            aria-label="Back to Home"
            icon="HomeOutlined"
            href="/"
          />
        )}
        <Typography level="h2">Login &amp; Access</Typography>
        <div sx={{ flex: 1 }} />
        <div className="flex items-center gap-3">
          <TableRecordSelect
            tableName="auth_roles"
            size="sm"
            color="neutral"
            value={sql`selected_role`}
            onSelectValue={(s, value) => s.setScalar("selected_role", value)}
            placeholder="Filter by Role"
          />
          {!disableAddButton && (
            <Button startIcon="Add" href="/users/add">
              Add Login
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type BeforeUserMutation = (
  s: UiServerStatements,
  userId: Sql,
) => void;

export interface ImpersonationAppOption {
  name: string;
  domain: string;
  icon?: IconName;
  visible?: BooleanExpr;
}

const IMPERSONATION_URL_OR_DOMAIN_PATTERN =
  "^(?:https?://)?([^/?#:@]+)(?::[0-9]+)?(?:[/?#].*)?$";
const IMPERSONATION_DOMAIN_PATTERN =
  "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$";

function normalizeImpersonationDomain(value: Sql) {
  const trimmed = sql`lower(trim(${value}))`;
  return sql`case
    when regex.is_match(
      ${trimmed},
      ${sql.lit(IMPERSONATION_URL_OR_DOMAIN_PATTERN)}
    ) then trim(trailing '.' from regex.capture(
      ${trimmed},
      ${sql.lit(IMPERSONATION_URL_OR_DOMAIN_PATTERN)},
      1
    ))
    else ${trimmed}
  end`;
}

function impersonationDomainError(opts: {
  domain: Sql;
  recordUiId: Sql;
  tableIdent: Sql;
  disallowedDomains: string[];
}) {
  return sql`case
    when ${opts.domain} is null or trim(${opts.domain}) = '' then 'Required'
    when length(${opts.domain}) > 100 then 'Must be 100 characters or less'
    when not regex.is_match(
      ${opts.domain},
      ${sql.lit(IMPERSONATION_DOMAIN_PATTERN)}
    ) then 'Enter a valid app domain or HTTP(S) URL'
    when ${sql.inList(opts.domain, opts.disallowedDomains.map(sql.lit))}
      then 'You cannot impersonate users on this application'
    when exists (
      select 1
      from ${opts.tableIdent} other_domain
      where other_domain.domain = ${opts.domain}
        and other_domain.write_ui_id != ${opts.recordUiId}
    ) then 'This application is already selected'
    else null
  end`;
}

function ImpersonationDomainInput(props: { disallowedDomains: string[] }) {
  if (usePhase() === "gather") {
    return null;
  }
  const field = useFieldHelper();
  const cursor = useCursorHelper();
  const tableIdent = sql.ref(`ui.${cursor.table.stateName}`);
  const normalizedDomain = normalizeImpersonationDomain(field.value);
  return (
    <JoyFormControl fullWidth error={field.hasError}>
      <Input
        value={field.value}
        error={field.hasError}
        placeholder="https://app.example.com/"
        aria-label="Application domain or URL"
        fullWidth
        onInput={(s) => {
          field.setValue(s, sql`target_value`);
          field.setError(s, sql.null);
        }}
        onBlur={(s) => {
          field.setValue(s, normalizedDomain);
          field.setTouched(s, sql.true);
          field.setError(
            s,
            impersonationDomainError({
              domain: normalizedDomain,
              recordUiId: cursor.recordUiId,
              tableIdent,
              disallowedDomains: props.disallowedDomains,
            }),
          );
        }}
      />
      <Show when={field.hasError}>
        <FormHelperText>{field.error}</FormHelperText>
      </Show>
    </JoyFormControl>
  );
}

function ImpersonationAppSuggestions(props: {
  apps: ImpersonationAppOption[];
}) {
  if (usePhase() === "gather") {
    return null;
  }
  const form = useICtx(FormICtxKey);
  const domains = form.table("auth_impersonation_domains");
  const domainsTableIdent = sql.ref(`ui.${domains.table.stateName}`);
  return (
    <div className="flex flex-wrap gap-2">
      {props.apps.map((app, index) => {
        const selected = sql`exists (
            select 1 from ${domainsTableIdent}
            where domain = ${sql.lit(app.domain)}
          )`;
        return (
          <Show when={sql.ref(`impersonation_app_visible_${index}`)}>
            <Button
              size="sm"
              variant="soft"
              color="neutral"
              startIcon={app.icon}
              aria-pressed={selected}
              disabled={selected}
              endDecorator={
                <Show when={selected}>
                  <MaterialIcon icon="Check" fontSize="sm" />
                </Show>
              }
              onClick={(s) => {
                const blankDomainName = `blank_impersonation_domain_${index}`;
                const blankDomain = sql.ref(blankDomainName);
                s.if(
                  sql`exists (
                      select 1 from ${domainsTableIdent}
                      where domain is null or trim(domain) = ''
                    )`,
                  (s) => {
                    s.forEachTable(
                      `ui.${domains.table.stateName}`,
                      blankDomainName,
                      (s) => {
                        s.if(
                          sql`${blankDomain}.write_ui_id = (
                            select min(write_ui_id)
                            from ${domainsTableIdent}
                            where domain is null or trim(domain) = ''
                          )`,
                          (s) => {
                            s.modify(sql`
                              update ${blankDomain}
                              set domain = ${sql.lit(app.domain)},
                                  domain_write_error = null
                            `);
                          },
                        );
                      },
                    );
                  },
                  (s) => domains.addRecord(s, { domain: sql.lit(app.domain) }),
                );
              }}
            >
              {app.name}
            </Button>
          </Show>
        );
      })}
    </div>
  );
}

function ImpersonateButton(props: {
  beforeUserMutation?: BeforeUserMutation;
  apps?: ImpersonationAppOption[];
}) {
  const app = useApp();
  const disallowedDomains = [app.domain, ...app.domainAliases].map((domain) =>
    domain.toLowerCase()
  );
  const suggestedApps = props.apps ?? [];
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("open", sql`false`);
        s.defScalar("domains", sql.lit``);
        s.defScalar("success", false);
        s.defScalar("duration", 5);
      }}
    >
      <>
        <AccessCheck
          when={system.block(AuthBlock).opts.accessPolicy
            ? canImpersonateUser(sql`current_user`, sql`ui.record_id`)
            : sql.true}
          fallback={
            <Typography level="body-sm">
              Impersonation requires permission and access at least equal to
              this person's.
            </Typography>
          }
        >
          <Button
            variant="soft"
            color="primary"
            startIcon="PersonOutlined"
            onClick={(s) => s.setScalar("open", sql`true`)}
          >
            Impersonate
          </Button>
        </AccessCheck>
        <ModalDialog
          bindScalar="open"
          maxWidth="sm"
          className="flex flex-col p-6"
        >
          <Typography
            level="title-lg"
            startIcon="PersonOutlined"
            slotProps={{
              startDecorator: {
                sx: {
                  color: "primary-500",
                },
              },
            }}
            className="mb-2"
          >
            Impersonate User
          </Typography>

          <Typography level="body-md" className="text-neutral-600 mb-4">
            Impersonating this user will allow you to see and interact with
            applications as if you were them.
          </Typography>

          <Form
            defaultFieldComponent={LabelOnTopFormField}
            beforeSubmitClient={(s, ctx) => {
              const domains = ctx.table("auth_impersonation_domains");
              const domainsTableIdent = sql.ref(
                `ui.${domains.table.stateName}`,
              );
              const currentDomainName = "impersonation_domain_to_validate";
              const currentDomain = sql.ref(currentDomainName);
              s.forEachTable(
                `ui.${domains.table.stateName}`,
                currentDomainName,
                (s) => {
                  const normalizedDomain = normalizeImpersonationDomain(
                    sql`${currentDomain}.domain`,
                  );
                  s.modify(sql`
                    update ${currentDomain}
                    set domain = ${normalizedDomain},
                        domain_write_error = ${
                    impersonationDomainError({
                      domain: normalizedDomain,
                      recordUiId: sql`${currentDomain}.write_ui_id`,
                      tableIdent: domainsTableIdent,
                      disallowedDomains,
                    })
                  }
                  `);
                },
              );
            }}
            afterTransactionStart={(s) => {
              if (system.block(AuthBlock).opts.accessPolicy) {
                assertOriginalAccessActor(s);
                s.throwErrorIf(
                  sql`${
                    canImpersonateUser(sql`current_user`, sql`ui.record_id`)
                  } is not true`,
                  sql
                    .lit`You cannot impersonate this person because you lack impersonation authority or they have access you do not have.`,
                );
              }
              props.beforeUserMutation?.(s, sql`ui.record_id`);
            }}
            beforeTransactionCommit={(s) => {
              s.defScalar(
                "created_id",
                sql`last_record_id(db.auth_impersonations)`,
              );
              if (system.block(AuthBlock).opts.accessPolicy) {
                s.modify(sql`update db.auth_impersonation_domains
                  set domain = ${normalizeImpersonationDomain(sql`domain`)}
                  where auth_impersonation_id = created_id`);
                const allowedDomains = suggestedApps.map((suggested) =>
                  sql`(domain = ${sql.lit(suggested.domain)} and (${
                    suggested.visible ?? sql.true
                  }))`
                );
                const allowed = allowedDomains.length
                  ? allowedDomains.reduce((a, b) => sql`(${a} or ${b})`)
                  : sql.true;
                s.throwErrorIf(
                  sql`not exists (
                  select 1 from db.auth_impersonation_domains where auth_impersonation_id = created_id
                ) or exists (
                  select 1 from db.auth_impersonation_domains
                  where auth_impersonation_id = created_id and (
                    (${allowed}) is not true
                    or not regex.is_match(domain, ${
                    sql.lit(IMPERSONATION_DOMAIN_PATTERN)
                  })
                    or ${
                    sql.inList(sql`domain`, disallowedDomains.map(sql.lit))
                  }
                  )
                )`,
                  sql.lit`Choose an application available to this user.`,
                );
                s.throwErrorIf(
                  sql`exists (select 1 from db.auth_impersonations
                  where id = created_id and (duration <= 0 or duration > 60 or trim(reason) = ''))`,
                  sql
                    .lit`Enter a reason and a duration between 1 and 60 minutes.`,
                );
                s.modify(sql`update db.auth_impersonations set active = false
                  where impersonator = current_user and id != created_id and active`);
              }
            }}
            afterTransactionCommit={(s) => {
              useICtx(CurrentRefetchICtxKey).triggerRefetch(s);
              s.setScalar("open", sql`false`);
              s.setScalar("success", true);
              s.setScalar(
                "domains",
                sql`(select string_agg(domain, ', ') from auth_impersonation_domains where auth_impersonation_id = created_id)`,
              );
              s.setScalar(
                "duration",
                sql`(select duration from auth_impersonations where id = created_id)`,
              );
            }}
          >
            <Form.Insert
              table="auth_impersonations"
              values={{
                impersonator: sql`current_user`,
                impersonatee: sql`ui.record_id`,
                issued: sql`now()`,
              }}
            >
              <div className="flex flex-col gap-2">
                <Form.Field field="duration" initialValue={sql.lit`0:05`} />
                <Form.Field field="reason" />
              </div>

              <Divider inset="none" className="my-4" />

              <Typography level="title-sm" className="mb-1 text-neutral-600">
                Applications
              </Typography>
              <Typography level="body-sm" className="mb-3 text-neutral-500">
                Choose an application available to this user, or paste an app
                URL or domain below.
              </Typography>

              {suggestedApps.length > 0 && (
                <div className="mb-3">
                  <ImpersonationAppSuggestions apps={suggestedApps} />
                </div>
              )}

              <Form.Relation table="auth_impersonation_domains">
                <div className="flex flex-col gap-3">
                  <Form.Each>
                    <div className="flex items-center gap-2">
                      <Form.Field field="domain">
                        <ImpersonationDomainInput
                          disallowedDomains={disallowedDomains}
                        />
                      </Form.Field>

                      <Show
                        when={sql`write_auth_impersonation_domain.iteration_index > 0`}
                      >
                        <Form.DeleteRecordIconButton
                          aria-label="Delete Domain"
                          variant="plain"
                          color="neutral"
                          icon="Delete"
                        />
                      </Show>

                      <Show
                        when={sql`write_auth_impersonation_domain.iteration_index = (select count(*) from write_auth_impersonation_domains) - 1`}
                      >
                        <IconButton
                          aria-label="Add Domain"
                          variant="plain"
                          color="primary"
                          icon="Add"
                          onClick={(s) => {
                            useCursorHelper().addRecord(s, {});
                          }}
                        />
                      </Show>
                    </div>
                  </Form.Each>
                </div>
              </Form.Relation>
            </Form.Insert>

            <Form.ErrorAlert />

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="plain"
                color="neutral"
                onClick={(s) => s.setScalar("open", sql`false`)}
              >
                Cancel
              </Button>
              <Form.SubmitButton variant="solid" color="primary">
                Start Impersonation
              </Form.SubmitButton>
            </div>
          </Form>
        </ModalDialog>

        <Show when={sql`success`}>
          {/*Example_Snackbar_Start*/}
          <Snackbar
            color="success"
            startIcon="CheckCircleOutlined"
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            onMount={(s) => {
              s.sleep(10000);
              s.setScalar("success", sql`false`);
            }}
          >
            Impersonation successful. You will be impersonating this user on
            {" "}
            {sql`domains`} for {sql`duration`} minutes.
          </Snackbar>
          {/*Example_Snackbar_End*/}
        </Show>
      </>
    </Data>
  );
}

interface UserDetailPageProps {
  name: Node;
  userInfo?: Node;
  backButtonRef?: string;
  wrapper?: (children: Node) => Node;
  beforeUserMutation?: BeforeUserMutation;
  beforeImpersonation?: BeforeUserMutation;
  beforeStaffMutation?: BeforeUserMutation;
  impersonationApps?: ImpersonationAppOption[];
  /** Applies only to password set, reset, and forced-change actions. */
  passwordManagement?: {
    requiredPermission: string;
    /** Also offer direct password assignment for email/password accounts. */
    allowSetPassword?: boolean;
  };
}

/**
A page component that displays detailed information about a user, including roles, permissions,
and impersonation history.

 */
export function UserDetailPage(
  {
    name,
    userInfo,
    backButtonRef,
    wrapper,
    beforeUserMutation: externalBeforeUserMutation,
    beforeImpersonation,
    beforeStaffMutation,
    impersonationApps,
    passwordManagement,
  }: UserDetailPageProps,
) {
  const beforeUserMutation: BeforeUserMutation | undefined =
    system.block(AuthBlock).opts.accessPolicy
      ? (s, userId) => {
        assertOriginalAccessActor(s);
        assertAccessAdministrator(s);
        externalBeforeUserMutation?.(s, userId);
      }
      : externalBeforeUserMutation;
  const canManagePasswords = passwordManagement
    ? sql`exists(select 1 from db.sys_users where id = current_user
        and coalesce(disabled, false) = false and ${
      userHasPermission(
        sql.lit(passwordManagement.requiredPermission),
        sql`current_user`,
      )
    })`
    : sql.true;
  const beforePasswordMutation: BeforeUserMutation = (s, userId) => {
    beforeUserMutation?.(s, userId);
    s.throwErrorUnless(canManagePasswords, sql.lit`Permission denied`);
  };
  const app = useApp();
  const disallowedDomains = [app.domain, ...app.domainAliases].map((domain) =>
    domain.toLowerCase()
  );
  const availableImpersonationApps = (impersonationApps ?? []).filter(
    (suggestedApp) =>
      !disallowedDomains.includes(suggestedApp.domain.toLowerCase()),
  );
  return (
    <RecordPage
      table="sys_users"
      path="/users/{record_id:id}"
      wrapper={wrapper}
    >
      <Data
        pendingFallback={null}
        procedure={(s) => {
          s.defRecord(
            "user_info",
            sql`select disabled, created_at, last_modified_at
              from db.sys_users where id = ui.record_id`,
          );
          availableImpersonationApps.forEach((suggestedApp, index) => {
            s.defScalar(
              `impersonation_app_visible_${index}`,
              suggestedApp.visible ?? sql.true,
            );
          });
        }}
      >
        <div className="grid w-full mx-auto p-2 sm:px-4 md:gap-4 lg:px-10 xl:px-12 xl:max-w-7xl py-4 gap-3 grid-cols-1 lg:grid-cols-12">
          <PageHeader>
            {backButtonRef && (
              <IconButton
                icon="ArrowBackOutlined"
                variant="plain"
                color="neutral"
                href={backButtonRef}
              />
            )}
            <div>
              <Typography
                level="h3"
                startIcon="ManageAccountsOutlined"
                slotProps={{
                  startDecorator: { sx: { color: "primary-500" } },
                }}
              >
                {name}
              </Typography>
              <Typography level="body-sm" className="text-neutral-500">
                Login &amp; access
              </Typography>
            </div>
            <ActiveChip />
            <PageHeader.Grow />
            <ImpersonateButton
              beforeUserMutation={beforeImpersonation ??
                externalBeforeUserMutation}
              apps={availableImpersonationApps}
            />
            <AccessCheck
              when={system.block(AuthBlock).opts.accessPolicy
                ? isAccessAdministrator()
                : sql.true}
            >
              <Button
                variant="solid"
                color="primary"
                startIcon="Edit"
                href={sql`'/users/' || ui.record_id || '/edit'`}
              >
                Edit access
              </Button>
            </AccessCheck>
          </PageHeader>

          <Card
            variant="outlined"
            size="lg"
            sx={{ gridColumnSpan: { xs: 12, lg: 8 } }}
          >
            <CardHeader noDivider>
              <Typography level="title-lg">Access summary</Typography>
            </CardHeader>
            <div
              sx={{
                gap: 2,
                display: "grid",
                gridTemplateColumns: "auto 1fr",
              }}
            >
              <Typography level="title-md">Roles</Typography>
              <UserRoles beforeMutation={beforeStaffMutation} />
              {userInfo}
            </div>
          </Card>

          <Card
            variant="outlined"
            size="lg"
            sx={{ gridColumnSpan: { xs: 12, lg: 4 }, alignSelf: "flex-start" }}
          >
            <CardHeader noDivider>
              <Typography level="title-lg">User Details</Typography>
            </CardHeader>
            <div className="py-2 flex flex-col gap-6">
              <div>
                <Typography level="body-sm">Created At</Typography>
                <Typography level="body-lg" startIcon="ScheduleOutlined">
                  {sql`format.date(user_info.created_at, '%Y-%m-%d')`}
                </Typography>
              </div>
              <div>
                <Typography level="body-sm">Last Modified</Typography>
                <Typography level="body-lg" startIcon="ScheduleOutlined">
                  {sql`format.date(user_info.last_modified_at, '%Y-%m-%d')`}
                </Typography>
              </div>
            </div>
          </Card>

          <div
            sx={{
              gridColumnSpan: { xs: 12, lg: 4 },
              display: "flex",
              flexDirection: "column",
              gap: { xs: 3, md: 4 },
            }}
          >
            <AccessCheck
              when={system.block(AuthBlock).opts.accessPolicy
                ? isAccessAdministrator()
                : sql.true}
            >
              <AccessCheck when={canManagePasswords}>
                <PasswordManagementCard
                  beforeUserMutation={beforePasswordMutation}
                  allowSetPassword={passwordManagement?.allowSetPassword}
                />
              </AccessCheck>
              <SessionTokensCard beforeUserMutation={beforeUserMutation} />
            </AccessCheck>
            <ImpersonationLogCard />
          </div>
          <PermissionsCard sx={{ gridColumnSpan: { xs: 12, lg: 8 } }} />
        </div>
      </Data>
    </RecordPage>
  );
}

function SessionTokensCard(props: {
  beforeUserMutation?: BeforeUserMutation;
}) {
  return (
    <Card
      variant="outlined"
      size="lg"
    >
      <CardHeader noDivider>
        <Typography level="title-lg">Sessions</Typography>
      </CardHeader>
      <Data
        pendingFallback={null}
        procedure={(s) => {
          s.defRecord(
            "session_token_info",
            sql`select
                count(*) as token_count,
                max(issued) as latest_issued
              from db.auth_session_tokens
              where sys_user_id = ui.record_id`,
          );
        }}
      >
        <Data
          local
          procedure={(s) => {
            s.defScalar("clear_tokens_loading", false);
            s.defScalar("clear_tokens_success", false);
            s.defScalar("clear_tokens_error", { type: "String" });
          }}
        >
          <div className="py-2 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Typography level="body-sm">Active Tokens:</Typography>
              <Chip color="neutral" variant="soft" size="sm">
                {sql`session_token_info.token_count`}
              </Chip>
            </div>
            <Show when={sql`session_token_info.latest_issued is not null`}>
              <div>
                <Typography level="body-sm">Latest Issued</Typography>
                <Typography level="body-md" startIcon="ScheduleOutlined">
                  {sql`format.date(session_token_info.latest_issued, '%b %d, %Y at %I:%M %p')`}
                </Typography>
              </div>
            </Show>
            <Button
              variant="outlined"
              color="danger"
              size="sm"
              startIcon="LogoutOutlined"
              loading={sql`clear_tokens_loading`}
              disabled={sql`session_token_info.token_count = 0`}
              onClick={(s) => {
                s.setScalar("clear_tokens_loading", true);
                s.setScalar("clear_tokens_success", false);
                s.setScalar("clear_tokens_error", sql.null);
                s.commitUiTreeChanges();
                s.tryServer({
                  body: (s) => {
                    s.startTransaction();
                    props.beforeUserMutation?.(s, sql`ui.record_id`);
                    s.modify(
                      sql`delete from db.auth_session_tokens where sys_user_id = ui.record_id`,
                    );
                    s.commitTransaction();
                    s.setScalar("clear_tokens_success", true);
                  },
                  errorName: "err",
                  catch: (s) => {
                    s.setScalar(
                      "clear_tokens_error",
                      sql.concat("Error: ", sql`err.message`),
                    );
                  },
                  finally: (s) => {
                    s.setScalar("clear_tokens_loading", false);
                    useICtx(CurrentRefetchICtxKey).triggerRefetch(s);
                  },
                });
              }}
            >
              Clear Tokens
            </Button>
            <Show when={sql`clear_tokens_success`}>
              <Alert color="success" size="sm">
                Session tokens have been cleared.
              </Alert>
            </Show>
            <Show when={sql`clear_tokens_error is not null`}>
              <Alert color="danger" size="sm">
                {sql`clear_tokens_error`}
              </Alert>
            </Show>
          </div>
        </Data>
      </Data>
    </Card>
  );
}

function PasswordManagementCard(props: {
  beforeUserMutation?: BeforeUserMutation;
  allowSetPassword?: boolean;
}) {
  const authBlock = useBlock(AuthBlock);
  const hasEmailPassword = authBlock.opts.appAuthTypes.includes(
    "email_password",
  );
  const hasUsernamePassword = authBlock.opts.appAuthTypes.includes(
    "username_password",
  );
  const legacyPasswordsEnabled = !!authBlock.opts.legacyPasswords;
  const hasPasswordExpr = legacyPasswordsEnabled
    ? sql`password_hash is not null or (legacy_password_hash is not null and legacy_password_algorithm is not null)`
    : sql`password_hash is not null`;
  if (!hasEmailPassword && !hasUsernamePassword) {
    return null;
  }
  return (
    <Card
      variant="outlined"
      size="lg"
    >
      <CardHeader noDivider>
        <Typography level="title-lg">Password</Typography>
      </CardHeader>
      <Data
        pendingFallback={null}
        procedure={(s) => {
          s.defRecord(
            "pw_info",
            sql`select ${hasPasswordExpr} as has_password, coalesce(must_change_password, false) as must_change_password
              from db.sys_users where id = ui.record_id`,
          );
        }}
      >
        <div className="py-2 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Typography level="body-sm">Status:</Typography>
            <Conditional
              when={sql`pw_info.has_password`}
              then={
                <Chip color="success" variant="soft" size="sm">
                  Password set
                </Chip>
              }
              else={
                <Chip color="neutral" variant="soft" size="sm">
                  Not set
                </Chip>
              }
            />
          </div>
          <Show when={sql`pw_info.must_change_password`}>
            <Chip color="warning" variant="soft" size="sm">
              Must change on next login
            </Chip>
          </Show>
          {hasEmailPassword && (
            <ResetPasswordButton
              clearLegacyPassword={legacyPasswordsEnabled}
              beforeUserMutation={props.beforeUserMutation}
            />
          )}
          {(hasUsernamePassword || props.allowSetPassword) && (
            <AdminSetPasswordButton
              clearLegacyPassword={legacyPasswordsEnabled}
              beforeUserMutation={props.beforeUserMutation}
            />
          )}
          <RequirePasswordChangeButton
            beforeUserMutation={props.beforeUserMutation}
          />
        </div>
      </Data>
    </Card>
  );
}

function ResetPasswordButton(props: {
  clearLegacyPassword?: boolean;
  beforeUserMutation?: BeforeUserMutation;
}) {
  const clearLegacyPassword = props.clearLegacyPassword
    ? sql`, legacy_password_hash = null, legacy_password_algorithm = null, legacy_password_migrated_at = current_timestamp()`
    : sql``;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("reset_loading", false);
        s.defScalar("reset_error", { type: "String" });
        s.defScalar("reset_success", false);
      }}
    >
      <Button
        variant="outlined"
        color="danger"
        size="sm"
        loading={sql`reset_loading`}
        startIcon="LockResetOutlined"
        onClick={(s) => {
          s.setScalar("reset_loading", true);
          s.setScalar("reset_error", sql.null);
          s.setScalar("reset_success", false);
          s.commitUiTreeChanges();
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              props.beforeUserMutation?.(s, sql`ui.record_id`);
              s.modify(
                sql`update sys_users set password_hash = null, password_salt = null ${clearLegacyPassword} where id = ui.record_id`,
              );
              s.commitTransaction();
              s.setScalar("reset_success", true);
            },
            errorName: "err",
            catch: (s) => {
              s.setScalar(
                "reset_error",
                sql.concat("Error: ", sql`err.message`),
              );
            },
            finally: (s) => {
              s.setScalar("reset_loading", false);
            },
          });
        }}
      >
        Reset Password
      </Button>
      <Show when={sql`reset_success`}>
        <Alert color="success" size="sm">
          Password has been reset. A new password must be set before password
          sign-in.
        </Alert>
      </Show>
      <Show when={sql`reset_error is not null`}>
        <Alert color="danger" size="sm">{sql`reset_error`}</Alert>
      </Show>
    </Data>
  );
}

function AdminSetPasswordButton(props: {
  clearLegacyPassword?: boolean;
  beforeUserMutation?: BeforeUserMutation;
}) {
  const clearLegacyPassword = props.clearLegacyPassword
    ? sql`, legacy_password_hash = null, legacy_password_algorithm = null, legacy_password_migrated_at = current_timestamp()`
    : sql``;
  return (
    <Data
      procedure={(s) => {
        s.defScalar("set_pw_open", false);
        s.defScalar("admin_new_password", sql.lit``);
        s.defScalar("admin_confirm_password", sql.lit``);
        s.defScalar("set_pw_error", { type: "String" });
        s.defScalar("set_pw_loading", false);
        s.defScalar("set_pw_success", false);
        s.defScalar("require_change", true);
      }}
    >
      <Button
        variant="outlined"
        color="primary"
        size="sm"
        startIcon="LockOutlined"
        onClick={(s) => {
          s.setScalar("admin_new_password", sql.lit``);
          s.setScalar("admin_confirm_password", sql.lit``);
          s.setScalar("set_pw_error", sql.null);
          s.setScalar("set_pw_success", false);
          s.setScalar("require_change", true);
          s.setScalar("set_pw_open", true);
        }}
      >
        Set Password
      </Button>
      <Show when={sql`set_pw_success`}>
        <Alert color="success" size="sm">
          Password has been set.
        </Alert>
      </Show>
      <ModalDialog
        bindScalar="set_pw_open"
        maxWidth="sm"
        className="flex flex-col p-6 gap-4"
      >
        <Typography level="title-lg">Set User Password</Typography>
        <JoyFormControl fullWidth>
          <JoyFormLabel>New Password</JoyFormLabel>
          <Input
            bindScalar="admin_new_password"
            type="password"
            placeholder="Enter password"
            fullWidth
          />
        </JoyFormControl>
        <JoyFormControl fullWidth>
          <JoyFormLabel>Confirm Password</JoyFormLabel>
          <Input
            bindScalar="admin_confirm_password"
            type="password"
            placeholder="Confirm password"
            fullWidth
          />
        </JoyFormControl>
        <Checkbox
          label="Require password change on next login"
          checked={sql`require_change`}
          variant="outlined"
          onCheckboxChange={(s) => {
            s.setScalar("require_change", sql`not require_change`);
          }}
        />
        <Show when={sql`set_pw_error is not null`}>
          <Alert color="danger" size="sm">{sql`set_pw_error`}</Alert>
        </Show>
        <div className="flex justify-end gap-3 mt-2">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => {
              s.setScalar("set_pw_open", false);
              s.setScalar("admin_new_password", sql.lit``);
              s.setScalar("admin_confirm_password", sql.lit``);
            }}
          >
            Cancel
          </Button>
          <Button
            loading={sql`set_pw_loading`}
            onClick={(s) => {
              s.setScalar("set_pw_error", sql.null);
              s.if(
                sql`char_length(admin_new_password) < 8`,
                (s) => {
                  s.setScalar(
                    "set_pw_error",
                    sql.lit`Password must be at least 8 characters`,
                  );
                  s.return();
                },
              );
              s.if(
                sql`admin_new_password != admin_confirm_password`,
                (s) => {
                  s.setScalar(
                    "set_pw_error",
                    sql.lit`Passwords do not match`,
                  );
                  s.return();
                },
              );
              s.setScalar("set_pw_loading", true);
              s.commitUiTreeChanges();
              s.tryServer({
                body: (s) => {
                  s.startTransaction();
                  props.beforeUserMutation?.(s, sql`ui.record_id`);
                  s.throwErrorIf(
                    sql`(char_length(ui.admin_new_password) >= 8) is not true`,
                    sql.lit`Password must be at least 8 characters`,
                  );
                  s.throwErrorIf(
                    sql`(ui.admin_new_password = ui.admin_confirm_password) is not true`,
                    sql.lit`Passwords do not match`,
                  );
                  s.defScalar("new_salt", sql`crypto.random_bytes(32)`);
                  s.defScalar(
                    "new_hash",
                    sql`crypto.hash_password(ui.admin_new_password, new_salt)`,
                  );
                  s.modify(
                    sql`update sys_users set password_hash = new_hash, password_salt = new_salt, must_change_password = coalesce(ui.require_change, true) ${clearLegacyPassword} where id = ui.record_id`,
                  );
                  s.commitTransaction();
                  s.setScalar("set_pw_open", false);
                  s.setScalar("set_pw_success", true);
                  s.setScalar("admin_new_password", sql.lit``);
                  s.setScalar("admin_confirm_password", sql.lit``);
                },
                errorName: "err",
                catch: (s) => {
                  s.setScalar(
                    "set_pw_error",
                    sql.concat("Error: ", sql`err.message`),
                  );
                },
                finally: (s) => {
                  s.setScalar("set_pw_loading", false);
                  s.if(
                    sql`set_pw_success`,
                    (s) => {
                      s.refetch();
                    },
                  );
                },
              });
            }}
          >
            Set Password
          </Button>
        </div>
      </ModalDialog>
    </Data>
  );
}

function RequirePasswordChangeButton(props: {
  beforeUserMutation?: BeforeUserMutation;
}) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("rpc_loading", false);
        s.defScalar("rpc_success", false);
      }}
    >
      <Button
        variant="outlined"
        color="warning"
        size="sm"
        loading={sql`rpc_loading`}
        startIcon="SyncLockOutlined"
        onClick={(s) => {
          s.setScalar("rpc_loading", true);
          s.setScalar("rpc_success", false);
          s.commitUiTreeChanges();
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              props.beforeUserMutation?.(s, sql`ui.record_id`);
              s.modify(
                sql`update sys_users set must_change_password = true where id = ui.record_id`,
              );
              s.commitTransaction();
              s.setScalar("rpc_success", true);
            },
            errorName: "err",
            catch: () => {},
            finally: (s) => {
              s.setScalar("rpc_loading", false);
            },
          });
        }}
      >
        Require Password Change
      </Button>
      <Show when={sql`rpc_success`}>
        <Alert color="success" size="sm">
          User will be required to change their password on next login.
        </Alert>
      </Show>
    </Data>
  );
}

function effectivePermissionSources(user: NumericExpr) {
  return sql`
    with recursive assigned_role_origins as (
      select 'manual:' || cast(assigned.id as string) as origin_key,
             role.id as role_id,
             role.extends,
             'Role · ' || role.name as source_label,
             'role' as source_kind
      from db.auth_user_roles assigned
      join db.auth_roles role on role.id = assigned.auth_role_id
      where assigned.sys_user_id = ${user}
      union all
      select 'rule:' || cast(source.id as string) as origin_key,
             role.id as role_id,
             role.extends,
             'Rule · ' || ${
    accessRuleSourceLabel(
      sql`source.source`,
      sql`source.source_record_id`,
    )
  } || ' · ' || role.name as source_label,
             'rule' as source_kind
      from db.auth_user_role_sources source
      join db.auth_roles role on role.id = source.auth_role_id
      where source.sys_user_id = ${user}
    ),
    role_hierarchy as (
      select origin_key, role_id, extends, source_label, source_kind
      from assigned_role_origins
      union
      select child.origin_key,
             parent.id as role_id,
             parent.extends,
             child.source_label,
             child.source_kind
      from role_hierarchy child
      join db.auth_roles parent on parent.id = child.extends
    )
    select distinct permission, source_label, source_kind
    from (
      select manual.permission,
             'Direct' as source_label,
             'direct' as source_kind
      from db.auth_user_permissions manual
      where manual.sys_user_id = ${user}
        and manual.is_allowed
      union all
      select source.permission,
             'Rule · ' || ${
    accessRuleSourceLabel(
      sql`source.source`,
      sql`source.source_record_id`,
    )
  } as source_label,
             'rule' as source_kind
      from db.auth_user_permission_sources source
      where source.sys_user_id = ${user}
        and source.is_allowed
        and not exists (
          select 1
          from db.auth_user_permissions manual
          where manual.sys_user_id = source.sys_user_id
            and manual.permission = source.permission
        )
      union all
      select role_permission.permission,
             hierarchy.source_label,
             hierarchy.source_kind
      from role_hierarchy hierarchy
      join db.auth_role_permissions role_permission
        on role_permission.auth_role_id = hierarchy.role_id
      where role_permission.is_allowed
        and not exists (
          select 1
          from db.auth_user_permissions manual
          where manual.sys_user_id = ${user}
            and manual.permission = role_permission.permission
        )
    ) sources
    order by permission, source_kind, source_label
  `;
}

function PermissionsCard({ sx }: { sx?: Style }) {
  return (
    <PermissionListCard
      title="Effective access"
      description="Only permissions this login currently has, with every source that grants them."
      permissionsQuery={getUserPermissions(sql`ui.record_id`)}
      sourcesQuery={effectivePermissionSources(sql`ui.record_id`)}
      emptyMessage="This login currently has no permissions."
      sx={sx}
    />
  );
}

function ImpersonationLogCard() {
  return (
    <Card
      variant="outlined"
      size="lg"
    >
      <CardHeader noDivider>
        <Typography level="title-lg">Impersonation Log</Typography>
      </CardHeader>
      <List
        size="sm"
        sx={{
          maxHeight: "20rem",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <Data
          pendingFallback={null}
          procedure={(s) => {
            s.defTable(
              "impersonations",
              sql`select i.*
              from db.auth_impersonations i
              where i.impersonatee = ui.record_id
              order by i.issued desc`,
            );
            s.defTable(
              "imp_domains",
              sql`select d.*
              from db.auth_impersonation_domains d
              join db.auth_impersonations i on i.id = d.auth_impersonation_id
              where i.impersonatee = ui.record_id`,
            );
          }}
        >
          <Show when={sql`(select count(*) from impersonations) = 0`}>
            <ListItem>
              <Typography level="body-sm" className="text-neutral-500">
                No impersonations found
              </Typography>
            </ListItem>
          </Show>
          <Each table="impersonations" recordName="imp">
            <Divider hideOnFirstEach />
            <ListItem className="flex flex-col items-start gap-2 py-4">
              <Typography
                level="body-md"
                startIcon="PersonOutlined"
                slotProps={{
                  startDecorator: {
                    sx: { color: "primary-500" },
                  },
                }}
              >
                <InlineRecordDisplay
                  tableName="sys_users"
                  id={sql`imp.impersonator`}
                />
              </Typography>

              <Typography level="body-sm" startIcon="ScheduleOutlined">
                {sql`format.date(imp.issued, '%b %d, %Y at %I:%M %p')`} for{" "}
                {sql`case when imp.duration < 60 then imp.duration || ' minutes'
                else (imp.duration / 60) || ' hours' || (imp.duration % 60) || ' minutes'
                end`}
              </Typography>

              <Typography level="body-sm" startIcon="InfoOutlined">
                {sql`imp.reason`}
              </Typography>
              <div className="flex gap-2 flex-wrap">
                <Each
                  table="imp_domains"
                  recordName="imp_domain"
                  where={sql`imp_domain.auth_impersonation_id = imp.id`}
                >
                  <Chip
                    size="sm"
                    variant="soft"
                    color="neutral"
                    startIcon="Language"
                  >
                    {sql`imp_domain.domain`}
                  </Chip>
                </Each>
              </div>
            </ListItem>
          </Each>
        </Data>
      </List>
    </Card>
  );
}
