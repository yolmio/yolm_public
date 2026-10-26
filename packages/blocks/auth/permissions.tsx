import { Link } from "components/link";
import { Button } from "components/button";
import { Alert } from "components/alert";
import { Card, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { ModalDialog } from "components/modal";
import { Select } from "components/select";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { Form, useCurrentTableHelper, useCursorHelper } from "std/form";
import { sql } from "std/sql_utils";
import type { BooleanExpr, Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import type { Style } from "std/style_types";
import { system } from "std/system";
import type { EnumValue } from "std/system";
import { Each, Show } from "std/ui";
import type { Node } from "std/ui";

export function permissionMatchesSearch(permission: EnumValue, search: Sql) {
  const searchable = [
    permission.name,
    permission.displayName,
    permission.description ?? "",
    permission.group ?? "",
  ].join(" ");
  return sql`contains(lower(${sql.lit(searchable)}), lower(${search}))`;
}

/** Shared permission identity and actions for grants and manual overrides. */
export function PermissionEntry(props: {
  permission: Sql;
  label?: Sql | string;
  children?: Node;
}) {
  const description = sql.caseWhen({
    operand: props.permission,
    conditions: [...system.enums.auth_permission.valuesMap.values()].map((
      value,
    ) => ({
      condition: sql.lit(value.name),
      expr: sql.lit(value.description ?? ""),
    })),
    default: sql.lit``,
  });
  return (
    <div
      role="group"
      aria-label={props.label ??
        sql`fn.display_auth_permission(${props.permission}) || ' permission'`}
      className="flex flex-wrap items-center gap-3 rounded-md border border-divider p-3"
    >
      <div className="min-w-48 flex-1">
        <Typography level="body-md" className="font-medium">
          {sql`fn.display_auth_permission(${props.permission})`}
        </Typography>
        <Typography level="body-sm" className="text-secondary">
          {description}
        </Typography>
      </div>
      {props.children}
    </div>
  );
}

/** Paginated permission groups; callers supply grants and optional provenance. */
export function PermissionListCard(props: {
  title: string;
  description?: string;
  permissionsQuery: Sql;
  sourcesQuery?: Sql;
  /** Optional destination for each permission source. */
  sourceHref?: (source: Sql) => Sql;
  emptyMessage: string;
  sx?: Style;
}) {
  const pageSize = 10;
  const permissions = [...system.enums.auth_permission.valuesMap.values()];
  const groups = new Map<string, EnumValue[]>();
  for (const permission of permissions) {
    const group = permission.group ?? "";
    const entries = groups.get(group) ?? [];
    entries.push(permission);
    groups.set(group, entries);
  }
  const orderedPermissions = [
    ...(groups.get("") ?? []),
    ...[...groups].flatMap(([name, entries]) => name ? entries : []),
  ];
  const displayOrder = sql.caseWhen({
    operand: sql`permission`,
    conditions: orderedPermissions.map((permission, index) => ({
      condition: sql.lit(permission.name),
      expr: sql`${index}`,
    })),
  });
  const matchesSearch = sql.caseWhen({
    operand: sql`permission`,
    conditions: permissions.map((permission) => ({
      condition: sql.lit(permission.name),
      expr: permissionMatchesSearch(permission, sql`permission_search_query`),
    })),
    default: sql.false,
  });
  const visible = (permission: EnumValue) =>
    sql`exists (select 1 from visible_permissions where permission = ${
      sql.lit(permission.name)
    })`;
  const entry = (permission: EnumValue) => (
    <Show when={visible(permission)}>
      <PermissionEntry permission={sql.lit(permission.name)}>
        {props.sourcesQuery
          ? (
            <div className="flex max-w-full flex-wrap gap-2">
              <Each
                table="permission_sources"
                recordName="permission_source"
                where={sql`permission_source.permission = ${
                  sql.lit(permission.name)
                }`}
              >
                <Chip
                  size="sm"
                  variant="soft"
                  color="neutral"
                  conditionalVariants={[
                    {
                      when: sql`permission_source.source_kind = 'direct'`,
                      color: "primary",
                    },
                    {
                      when: sql`permission_source.source_kind = 'role'`,
                      color: "success",
                    },
                    {
                      when: sql`permission_source.source_kind = 'rule'`,
                      color: "warning",
                    },
                  ]}
                >
                  {props.sourceHref
                    ? (
                      <Show
                        when={sql`${
                          props.sourceHref(sql`permission_source`)
                        } is not null`}
                        fallback={sql`permission_source.source_label`}
                      >
                        <Link href={props.sourceHref(sql`permission_source`)}>
                          {sql`permission_source.source_label`}
                        </Link>
                      </Show>
                    )
                    : sql`permission_source.source_label`}
                </Chip>
              </Each>
            </div>
          )
          : <Typography level="body-sm">Granted</Typography>}
      </PermissionEntry>
    </Show>
  );
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("permission_search_query", sql.lit``);
        s.defScalar("permission_page", sql`1`);
      }}
    >
      <Card variant="outlined" sx={props.sx}>
        <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Typography level="title-lg">{props.title}</Typography>
            {props.description && (
              <Typography level="body-sm" className="text-secondary">
                {props.description}
              </Typography>
            )}
          </div>
          <Input
            size="sm"
            startIcon="Search"
            placeholder="Search permissions..."
            value={sql`permission_search_query`}
            onInput={(s) => {
              s.setScalar("permission_search_query", sql`target_value`);
              s.setScalar("permission_page", sql`1`);
            }}
            className="w-full shrink-0 sm:w-64"
          />
        </CardHeader>
        <Data
          pendingFallback={null}
          procedure={(s) => {
            s.defTable("granted_permissions", props.permissionsQuery);
            if (props.sourcesQuery) {
              s.defTable(
                "permission_sources",
                props.sourcesQuery,
              );
            }
          }}
        >
          <Data
            local
            procedure={(s) => {
              s.defTable(
                "matching_permissions",
                sql`select permission, ${displayOrder} as display_order
                  from granted_permissions where ${matchesSearch}`,
              );
              s.defScalar(
                "permission_count",
                sql`(select count(*) from matching_permissions)`,
              );
              s.defScalar(
                "permission_page_count",
                sql`case when permission_count = 0 then 1
                  else (permission_count - 1) / ${pageSize} + 1 end`,
              );
              s.defScalar(
                "effective_permission_page",
                sql`least(permission_page, permission_page_count)`,
              );
              s.defTable(
                "visible_permissions",
                sql`select permission from matching_permissions
                  order by display_order
                  limit ${pageSize}
                  offset (effective_permission_page - 1) * ${pageSize}`,
              );
            }}
          >
            <div className="flex flex-col gap-3 py-4">
              <Show when={sql`permission_count > ${pageSize}`}>
                <div className="flex items-center justify-between gap-3">
                  <Typography level="body-sm" className="text-secondary">
                    {sql`((effective_permission_page - 1) * ${pageSize} + 1)
                    || '–' || least(effective_permission_page * ${pageSize}, permission_count)
                    || ' of ' || permission_count || ' permissions'`}
                  </Typography>
                  <div className="flex gap-1">
                    <IconButton
                      size="sm"
                      variant="outlined"
                      color="neutral"
                      icon="ChevronLeft"
                      aria-label="Previous permissions page"
                      disabled={sql`effective_permission_page <= 1`}
                      onClick={(s) =>
                        s.setScalar(
                          "permission_page",
                          sql`greatest(1, effective_permission_page - 1)`,
                        )}
                    />
                    <IconButton
                      size="sm"
                      variant="outlined"
                      color="neutral"
                      icon="ChevronRight"
                      aria-label="Next permissions page"
                      disabled={sql`effective_permission_page >= permission_page_count`}
                      onClick={(s) =>
                        s.setScalar(
                          "permission_page",
                          sql`least(permission_page_count, effective_permission_page + 1)`,
                        )}
                    />
                  </div>
                </div>
              </Show>
              <Show when={sql`not exists (select 1 from granted_permissions)`}>
                <Alert color="neutral" variant="soft" startIcon="InfoOutlined">
                  {props.emptyMessage}
                </Alert>
              </Show>
              {groups.get("")?.map(entry)}
              {[...groups].filter(([name]) => name !== "").map((
                [name, entries],
              ) => (
                <Show when={sql.or(...entries.map(visible))}>
                  <Typography level="title-md" className="font-semibold">
                    {name}
                  </Typography>
                  {entries.map(entry)}
                </Show>
              ))}
              <Show
                when={sql.and(
                  sql`exists (select 1 from granted_permissions)`,
                  sql`permission_count = 0`,
                )}
              >
                <Typography
                  level="body-sm"
                  className="py-6 text-center text-secondary"
                >
                  No granted permissions match this search.
                </Typography>
              </Show>
            </div>
          </Data>
        </Data>
      </Card>
    </Data>
  );
}

/** Search the auth permission catalog; the caller owns selection state. */
export function PermissionPicker(props: {
  selected: (permission: Sql) => BooleanExpr;
  onSelect: (s: DomStatements, permission: Sql, allowed: BooleanExpr) => void;
  overrides?: boolean;
}) {
  const permissions = [...system.enums.auth_permission.valuesMap.values()];
  const matches = (permission: EnumValue) =>
    sql.and(
      sql.not(props.selected(sql.lit(permission.name))),
      permissionMatchesSearch(permission, sql`permission_picker_search`),
    );
  const title = props.overrides ? "Add permission override" : "Add permission";
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("permission_picker_open", sql`false`);
        s.defScalar("permission_picker_search", sql.lit``);
      }}
    >
      <Button
        size="sm"
        variant="outlined"
        startIcon="Add"
        onClick={(s) => {
          s.setScalar("permission_picker_search", sql.lit``);
          s.setScalar("permission_picker_open", sql`true`);
        }}
      >
        {title}
      </Button>
      <ModalDialog
        bindScalar="permission_picker_open"
        maxWidth="md"
        className="flex flex-col p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <Typography level="title-lg">{title}</Typography>
            <Typography level="body-sm" className="text-secondary mt-1">
              {props.overrides
                ? "Choose an explicit grant or denial. Prefer roles for normal access."
                : "Search for a permission to grant."}
            </Typography>
          </div>
          <IconButton
            icon="Close"
            aria-label="Close permission picker"
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("permission_picker_open", sql`false`)}
          />
        </div>
        <Input
          className="my-4"
          startIcon="Search"
          placeholder="Search permissions..."
          value={sql`permission_picker_search`}
          onInput={(s) =>
            s.setScalar("permission_picker_search", sql`target_value`)}
        />
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-auto">
          {permissions.map((permission) => (
            <Show when={matches(permission)}>
              <PermissionEntry
                permission={sql.lit(permission.name)}
                label={`${permission.displayName} permission option`}
              >
                <Button
                  size="sm"
                  variant="outlined"
                  color="success"
                  onClick={(s) =>
                    props.onSelect(s, sql.lit(permission.name), sql.true)}
                >
                  {props.overrides ? "Allow" : "Add"}
                </Button>
                {props.overrides && (
                  <Button
                    size="sm"
                    variant="outlined"
                    color="danger"
                    onClick={(s) =>
                      props.onSelect(s, sql.lit(permission.name), sql.false)}
                  >
                    Deny
                  </Button>
                )}
              </PermissionEntry>
            </Show>
          ))}
          <Show when={sql.not(sql.or(...permissions.map(matches)))}>
            <Typography
              level="body-sm"
              className="py-6 text-center text-secondary"
            >
              No available permissions match this search.
            </Typography>
          </Show>
        </div>
      </ModalDialog>
    </Data>
  );
}

function PermissionFormRow(props: { overrides?: boolean }) {
  const cursor = useCursorHelper();
  return (
    <PermissionEntry
      permission={sql`permission_entry.permission`}
      label={props.overrides
        ? sql`'Manual override ' || fn.display_auth_permission(permission_entry.permission)`
        : undefined}
    >
      <Form.Field field="is_allowed">
        {(field) =>
          props.overrides
            ? (
              <Select
                size="sm"
                aria-label="Override type"
                value={sql`case when ${field.value} then 'allow' else 'deny' end`}
                onInput={(s) => field.setValue(s, sql`target_value = 'allow'`)}
              >
                <Select.Option value="allow">Allow</Select.Option>
                <Select.Option value="deny">Deny</Select.Option>
              </Select>
            )
            : (
              <Show
                when={field.value}
                fallback={
                  <Button
                    size="sm"
                    onClick={(s) => field.setValue(s, sql.true)}
                  >
                    Grant permission
                  </Button>
                }
              >
                <Typography level="body-sm">Granted</Typography>
              </Show>
            )}
      </Form.Field>
      <IconButton
        icon="DeleteOutline"
        aria-label={props.overrides
          ? "Remove permission override"
          : "Remove permission"}
        variant="plain"
        color="danger"
        onClick={(s) => cursor.delete(s)}
      />
    </PermissionEntry>
  );
}

/** Used inside either AuthBlock permission Form.Relation. */
export function PermissionFormEntries(props: { overrides?: boolean }) {
  const helper = useCurrentTableHelper();
  return (
    <>
      <Form.Each recordName="permission_entry">
        <PermissionFormRow overrides={props.overrides} />
      </Form.Each>
      <PermissionPicker
        overrides={props.overrides}
        selected={(permission) =>
          sql`exists (
          select 1 from ${helper.tableIdent} where permission = ${permission}
        )`}
        onSelect={(s, permission, allowed) => {
          helper.addRecord(s, { permission, is_allowed: allowed });
        }}
      />
    </>
  );
}
