import { AutoInsertButton } from "components/auto_insert_dialog";
import type { FieldOverride as AutoInsertFieldOverride } from "components/auto_insert_dialog";
import { AutoUpdateButton } from "components/auto_update_dialog";
import { Button } from "components/button";
import { Card } from "components/card";
import { DataTable } from "components/data_table";
import type {
  ActionsBuilder,
  ColumnsBuilder,
  DataTableProps,
  RowDeleteHooks,
  RowEditHooks,
} from "components/data_table";
import { IconButton } from "components/icon_button";
import { InlineFieldDisplay } from "components/inline_field_display";
import { ModalDialog } from "components/modal";
import { Sidebar } from "components/sidebar";
import { Typography } from "components/typography";
import { getUniqueUiId } from "components/utils";
import { Data } from "std/data";
import type { FormContext, FormSubmitError } from "std/form";
import { SidebarPresenceICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "std/sql_utils";
import type {
  DomStatements,
  StateStatementsOrFn,
  UiServerStatements,
} from "std/statements";
import { system } from "std/system";
import type { Field, Table } from "std/system";
import { DocumentTitle, Route, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { getTableBaseUrl } from "std/utils/url";

type DetailTitle = Node | ((record: Sql) => Node);

/**
 * Configures the per-row detail view of {@link AdminCrudPage} /
 * {@link AdminRelatedTable}. Pass `false`/`true` on the page's `detail` prop
 * for the on/off shorthand, or this object to customize.
 */
export interface AdminCrudDetailConfig {
  enabled?: boolean;
  /** `"modal"` opens a dialog in place; `"route"` navigates to a detail URL. Defaults to `"modal"`. */
  mode?: "modal" | "route";
  /** Heading; a callback receives the record ref. */
  title?: DetailTitle;
  /** Explicit fields to show. Defaults to all non-id, non-Bytes fields. */
  fields?: string[];
  /** Fields to exclude when `fields` is not given. */
  ignoreFields?: string[];
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Show the Edit button (requires update to be enabled). Defaults to true. */
  editButton?: boolean;
  /** Custom detail URL builder, used in `"route"` mode. */
  url?: (id: Sql) => Sql;
  /** Related tables rendered inside the detail view. */
  related?: AdminRelatedTableProps[];
}

/**
 * Configures the Add (insert) flow of {@link AdminCrudPage} /
 * {@link AdminRelatedTable}. Pass `false`/`true` on the `insert` prop for the
 * on/off shorthand, or this object to customize.
 */
export interface AdminCrudInsertConfig {
  enabled?: boolean;
  /** Add-button label. Defaults to `Add <table display name>`. */
  label?: Node;
  ignoreFields?: string[];
  /** Per-field overrides for the auto insert dialog. */
  fieldOverrides?: Record<string, AutoInsertFieldOverride>;
  /** Constant values applied to the inserted record. */
  values?: Record<string, AnyExpr>;
}

/**
 * Configures the row-action (dialog-based) edit of {@link AdminCrudPage} /
 * {@link AdminRelatedTable}. Pass `false`/`true` on the `update` prop for the
 * on/off shorthand, or this object to customize.
 */
export interface AdminCrudUpdateConfig extends RowEditHooks {
  enabled?: boolean;
  ignoreFields?: string[];
  /** Custom field nodes rendered before the generated update fields. */
  temporaryFields?: Node;
}

/**
 * Configures the delete row action of {@link AdminCrudPage} /
 * {@link AdminRelatedTable}. Pass `false`/`true` on the `delete` prop for the
 * on/off shorthand, or this object to customize.
 */
export interface AdminCrudDeleteConfig extends RowDeleteHooks {
  enabled?: boolean;
  /** Confirmation prompt text. */
  confirmText?: string;
}

/** Props for {@link AdminCrudPage}. Inherits most {@link DataTableProps} layout/behavior options. */
export interface AdminCrudPageProps extends
  Omit<
    DataTableProps,
    | "actions"
    | "columns"
    | "onRowClick"
    | "primaryTable"
    | "query"
    | "recordName"
    | "toolbar"
  > {
  /** Table whose rows are listed. */
  table: string;
  /** Route path. Defaults to the (primary) table's base URL. */
  path?: string;
  /** Wraps the registered route's content without wrapping the Route itself. */
  wrapper?: (children: Node) => Node;
  /** Procedure defining page-local UI state, wrapped around the page in a local `Data`. */
  localState?: StateStatementsOrFn;
  title?: Node;
  /** Document title. Defaults to the table display name. */
  documentTitle?: string | Sql;
  description?: Node;
  /** Override the listing query. Defaults to `select * from <table>`. */
  query?: Sql;
  /** Table the row actions (insert/edit/delete/detail) target, if different from `table`. */
  primaryTable?: string;
  /** Custom columns builder. Defaults to auto-generated columns minus audit/id fields. */
  columns?: (b: ColumnsBuilder) => void;
  ignoreFields?: string[];
  recordName?: string;
  /** Extra row actions appended after the built-in detail/edit/delete actions. */
  actions?: (b: ActionsBuilder) => void;
  toolbar?: Node;
  /** Disable insert, update, and delete in one switch. */
  readonly?: boolean;
  insert?: AdminCrudInsertConfig | boolean;
  update?: AdminCrudUpdateConfig | boolean;
  delete?: AdminCrudDeleteConfig | boolean;
  detail?: AdminCrudDetailConfig | boolean;
  containerClassName?: string;
  contentClassName?: string;
}

interface ResolvedAdminCrudDetailConfig {
  enabled: boolean;
  mode: "modal" | "route";
  title?: DetailTitle;
  fields: string[];
  ignoreFields: string[];
  maxWidth: "xs" | "sm" | "md" | "lg" | "xl";
  editButton: boolean;
  url?: (id: Sql) => Sql;
  related: AdminRelatedTableProps[];
}

interface ResolvedAdminCrudInsertConfig {
  enabled: boolean;
  label?: Node;
  ignoreFields: string[];
  fieldOverrides: Record<string, AutoInsertFieldOverride>;
  values: Record<string, AnyExpr>;
}

interface ResolvedAdminCrudUpdateConfig {
  enabled: boolean;
  ignoreFields: string[];
  temporaryFields?: Node;
  beforeSubmitClient?: RowEditHooks["beforeSubmitClient"];
  beforeTransactionStart?: RowEditHooks["beforeTransactionStart"];
  afterTransactionStart?: RowEditHooks["afterTransactionStart"];
  beforeTransactionCommit?: RowEditHooks["beforeTransactionCommit"];
  afterTransactionCommit?: RowEditHooks["afterTransactionCommit"];
  afterSubmitClientSuccess?: RowEditHooks["afterSubmitClientSuccess"];
  onSubmitServerError?: RowEditHooks["onSubmitServerError"];
}

interface ResolvedAdminCrudDeleteConfig {
  enabled: boolean;
  confirmText?: string;
  beforeSubmitClient?: RowDeleteHooks["beforeSubmitClient"];
  beforeTransactionStart?: RowDeleteHooks["beforeTransactionStart"];
  afterTransactionStart?: RowDeleteHooks["afterTransactionStart"];
  beforeTransactionCommit?: RowDeleteHooks["beforeTransactionCommit"];
  afterTransactionCommit?: RowDeleteHooks["afterTransactionCommit"];
  afterSubmitClient?: RowDeleteHooks["afterSubmitClient"];
}

const DEFAULT_IGNORED_TABLE_FIELDS = [
  "id",
  "created_at",
  "last_modified_at",
  "updated_at",
  "created_by",
  "updated_by",
];

/**
 * An admin-style CRUD page: a {@link DataTable} listing with built-in Add,
 * edit (via a row-action dialog), delete, and a per-row detail view (modal or routed), plus a
 * title/description header. The fastest way to expose a table for back-office
 * management when you don't need the heavier {@link DatagridPage}.
 *
 * **Self-routing: do NOT wrap in a Route component.**
 *
 * @category Page Component
 */
export function AdminCrudPage(props: AdminCrudPageProps) {
  const inner = props.localState
    ? (
      <Data local procedure={props.localState}>
        <AdminCrudPageContent {...props} />
      </Data>
    )
    : <AdminCrudPageContent {...props} />;
  const content = props.wrapper ? props.wrapper(inner) : inner;
  return (
    <Route
      path={props.path ??
        `/${getTableBaseUrl(props.primaryTable ?? props.table)}`}
    >
      {content}
    </Route>
  );
}

function AdminCrudPageContent(props: AdminCrudPageProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const primaryTable = props.primaryTable ?? props.table;
  const primaryTableModel = system.db.tables[primaryTable];
  if (!primaryTableModel) {
    throw new Error(`Table ${primaryTable} not found`);
  }

  const detailConfig = normalizeDetailConfig(props.detail);
  const insertConfig = normalizeInsertConfig(props.insert, props.readonly);
  const updateConfig = normalizeUpdateConfig(props.update, props.readonly);
  const deleteConfig = normalizeDeleteConfig(props.delete, props.readonly);
  const detailRecordIdScalar = `admin_crud_detail_id_${getUniqueUiId()}`;
  const recordName = props.recordName ?? "admin_crud_record";
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  const query = props.query ?? sql`select * from ${table.identWithDb}`;
  const columns = props.columns ?? ((b) => {
    addDefaultColumns(b, primaryTableModel, props.ignoreFields);
  });
  const toolbar = (
    <>
      {props.toolbar}
      {insertConfig.enabled && (
        <AutoInsertButton
          table={primaryTable}
          size="sm"
          startIcon="Add"
          variant="soft"
          ignoreFields={insertConfig.ignoreFields}
          fieldOverrides={insertConfig.fieldOverrides}
          values={insertConfig.values}
        >
          {insertConfig.label ?? `Add ${primaryTableModel.displayName}`}
        </AutoInsertButton>
      )}
    </>
  );

  return (
    <Data
      local
      procedure={(s) => {
        if (detailConfig.enabled) {
          s.defScalar(detailRecordIdScalar, sql`null::bigint`);
        }
      }}
    >
      <DocumentTitle>
        {props.documentTitle ?? table.displayName}
      </DocumentTitle>
      <div className={props.containerClassName ?? "h-full overflow-y-auto"}>
        <div className={props.contentClassName ?? "container mx-auto p-4"}>
          {(props.title || props.description) && (
            <div className="mb-6">
              {props.title && (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {hasSidebar?.autoTrigger && <Sidebar.Trigger />}
                    <Typography level="h3">{props.title}</Typography>
                  </div>
                </div>
              )}
              {props.description && (
                <Card variant="outlined" className="mt-4">
                  {typeof props.description === "string"
                    ? (
                      <Typography level="body-sm">
                        {props.description}
                      </Typography>
                    )
                    : props.description}
                </Card>
              )}
            </div>
          )}
          <DataTable
            query={query}
            primaryTable={primaryTable}
            columns={columns}
            showIdColumn={props.showIdColumn}
            selectable={props.selectable}
            bulkActions={props.bulkActions}
            actions={(b) => {
              if (detailConfig.enabled) {
                b.custom("Details", { icon: "OpenInNew" }, (s) => {
                  const id = sql`${
                    sql.ref(recordName)
                  }.${primaryTableModel.primaryKeyIdent}`;
                  if (detailConfig.mode === "route") {
                    s.navigate(
                      getAdminDetailUrl(primaryTable, id, detailConfig),
                    );
                  } else {
                    s.setScalar(detailRecordIdScalar, id);
                  }
                });
              }
              if (updateConfig.enabled) {
                b.edit(updateActionOptions(updateConfig));
              }
              if (deleteConfig.enabled) {
                b.delete(deleteActionOptions(deleteConfig));
              }
              props.actions?.(b);
            }}
            recordName={recordName}
            toolbar={toolbar}
            searchable={props.searchable ?? true}
            searchDebounceMs={props.searchDebounceMs}
            filterable={props.filterable ?? true}
            filterVariant={props.filterVariant ?? "panel"}
            defaultFilters={props.defaultFilters}
            sortable={props.sortable ?? true}
            defaultSort={props.defaultSort}
            pageSize={props.pageSize ?? 50}
            download={props.download}
            editable={props.editable ?? !props.readonly}
            where={props.where}
            watch={props.watch}
            variant={props.variant ?? "outlined"}
            size={props.size}
            emptyState={props.emptyState}
            loadingState={props.loadingState}
            className={props.className}
            tableProps={props.tableProps}
            header={props.header}
            footer={props.footer}
            scrollable={props.scrollable}
            selectionTable={props.selectionTable}
            analysisScalars={props.analysisScalars}
            minColumnWidth={props.minColumnWidth}
          />
        </div>
      </div>
      {detailConfig.enabled && detailConfig.mode === "modal" && (
        <AdminCrudDetailDialog
          table={primaryTableModel}
          recordIdScalar={detailRecordIdScalar}
          config={detailConfig}
          updateConfig={updateConfig}
        />
      )}
    </Data>
  );
}

function normalizeDetailConfig(
  detail: AdminCrudPageProps["detail"],
): ResolvedAdminCrudDetailConfig {
  if (detail === false) {
    return {
      enabled: false,
      mode: "modal",
      title: undefined,
      fields: [],
      ignoreFields: [],
      maxWidth: "lg",
      editButton: true,
      url: undefined,
      related: [],
    };
  }
  if (detail === true || detail === undefined) {
    return {
      enabled: true,
      mode: "modal",
      title: undefined,
      fields: [],
      ignoreFields: [],
      maxWidth: "lg",
      editButton: true,
      url: undefined,
      related: [],
    };
  }
  return {
    enabled: detail.enabled ?? true,
    mode: detail.mode ?? "modal",
    title: detail.title,
    fields: detail.fields ?? [],
    ignoreFields: detail.ignoreFields ?? [],
    maxWidth: detail.maxWidth ?? "lg",
    editButton: detail.editButton ?? true,
    url: detail.url,
    related: detail.related ?? [],
  };
}

function normalizeInsertConfig(
  insert: AdminCrudPageProps["insert"],
  readonly: boolean | undefined,
): ResolvedAdminCrudInsertConfig {
  if (readonly || insert === false) {
    return {
      enabled: false,
      label: undefined,
      ignoreFields: [],
      fieldOverrides: {},
      values: {},
    };
  }
  if (insert === true || insert === undefined) {
    return {
      enabled: true,
      label: undefined,
      ignoreFields: [],
      fieldOverrides: {},
      values: {},
    };
  }
  return {
    enabled: insert.enabled ?? true,
    label: insert.label,
    ignoreFields: insert.ignoreFields ?? [],
    fieldOverrides: insert.fieldOverrides ?? {},
    values: insert.values ?? {},
  };
}

function normalizeUpdateConfig(
  update: AdminCrudPageProps["update"],
  readonly: boolean | undefined,
): ResolvedAdminCrudUpdateConfig {
  if (readonly || update === false) {
    return {
      enabled: false,
      ignoreFields: [],
    };
  }
  if (update === true || update === undefined) {
    return {
      enabled: true,
      ignoreFields: [],
    };
  }
  return {
    enabled: update.enabled ?? true,
    ignoreFields: update.ignoreFields ?? [],
    temporaryFields: update.temporaryFields,
    beforeSubmitClient: update.beforeSubmitClient,
    beforeTransactionStart: update.beforeTransactionStart,
    afterTransactionStart: update.afterTransactionStart,
    beforeTransactionCommit: update.beforeTransactionCommit,
    afterTransactionCommit: update.afterTransactionCommit,
    afterSubmitClientSuccess: update.afterSubmitClientSuccess,
    onSubmitServerError: update.onSubmitServerError,
  };
}

function normalizeDeleteConfig(
  deleteConfig: AdminCrudPageProps["delete"],
  readonly: boolean | undefined,
): ResolvedAdminCrudDeleteConfig {
  if (readonly) {
    return {
      enabled: false,
      confirmText: undefined,
    };
  }
  if (deleteConfig === true) {
    return {
      enabled: true,
      confirmText: undefined,
    };
  }
  if (deleteConfig === false || deleteConfig === undefined) {
    return {
      enabled: false,
      confirmText: undefined,
    };
  }
  return {
    enabled: deleteConfig.enabled ?? true,
    confirmText: deleteConfig.confirmText,
    beforeSubmitClient: deleteConfig.beforeSubmitClient,
    beforeTransactionStart: deleteConfig.beforeTransactionStart,
    afterTransactionStart: deleteConfig.afterTransactionStart,
    beforeTransactionCommit: deleteConfig.beforeTransactionCommit,
    afterTransactionCommit: deleteConfig.afterTransactionCommit,
    afterSubmitClient: deleteConfig.afterSubmitClient,
  };
}

function updateActionOptions(
  config: ResolvedAdminCrudUpdateConfig,
  extraIgnoreFields: string[] = [],
) {
  return {
    ignoreFields: mergeIgnoreFields(config.ignoreFields, extraIgnoreFields),
    temporaryFields: config.temporaryFields,
    beforeSubmitClient: config.beforeSubmitClient,
    beforeTransactionStart: config.beforeTransactionStart,
    afterTransactionStart: config.afterTransactionStart,
    beforeTransactionCommit: config.beforeTransactionCommit,
    afterTransactionCommit: config.afterTransactionCommit,
    afterSubmitClientSuccess: config.afterSubmitClientSuccess,
    onSubmitServerError: config.onSubmitServerError,
  };
}

function updateDialogOptions(
  config: ResolvedAdminCrudUpdateConfig,
  recordId: Sql,
) {
  return {
    ignoreFields: config.ignoreFields,
    temporaryFields: config.temporaryFields,
    beforeSubmitClient: config.beforeSubmitClient
      ? ((s: DomStatements, ctx: FormContext) =>
        config.beforeSubmitClient!(s, ctx, recordId))
      : undefined,
    beforeTransactionStart: config.beforeTransactionStart
      ? ((s: UiServerStatements, ctx: FormContext) =>
        config.beforeTransactionStart!(s, ctx, recordId))
      : undefined,
    afterTransactionStart: config.afterTransactionStart
      ? ((s: UiServerStatements, ctx: FormContext) =>
        config.afterTransactionStart!(s, ctx, recordId))
      : undefined,
    beforeTransactionCommit: config.beforeTransactionCommit
      ? ((s: UiServerStatements, ctx: FormContext) =>
        config.beforeTransactionCommit!(s, ctx, recordId))
      : undefined,
    afterTransactionCommit: config.afterTransactionCommit
      ? ((s: UiServerStatements, ctx: FormContext) =>
        config.afterTransactionCommit!(s, ctx, recordId))
      : undefined,
    afterSubmitClientSuccess: config.afterSubmitClientSuccess
      ? ((s: DomStatements, ctx: FormContext) =>
        config.afterSubmitClientSuccess!(s, ctx, recordId))
      : undefined,
    onSubmitServerError: config.onSubmitServerError
      ? ((
        s: UiServerStatements,
        ctx: FormContext,
        err: FormSubmitError,
      ) => config.onSubmitServerError!(s, ctx, err, recordId))
      : undefined,
  };
}

function deleteActionOptions(config: ResolvedAdminCrudDeleteConfig) {
  return {
    confirmText: config.confirmText,
    beforeSubmitClient: config.beforeSubmitClient,
    beforeTransactionStart: config.beforeTransactionStart,
    afterTransactionStart: config.afterTransactionStart,
    beforeTransactionCommit: config.beforeTransactionCommit,
    afterTransactionCommit: config.afterTransactionCommit,
    afterSubmitClient: config.afterSubmitClient,
  };
}

function mergeIgnoreFields(
  ignoreFields: string[],
  extraIgnoreFields: string[],
) {
  return Array.from(new Set([...ignoreFields, ...extraIgnoreFields]));
}

function getAdminDetailUrl(
  table: string,
  id: Sql,
  detailConfig: ResolvedAdminCrudDetailConfig,
) {
  return detailConfig.url
    ? detailConfig.url(id)
    : sql.concat("/", getTableBaseUrl(table), "/", id);
}

function addDefaultColumns(
  b: ColumnsBuilder,
  table: Table,
  ignoreFields: string[] | undefined,
) {
  const ignored = new Set([
    ...DEFAULT_IGNORED_TABLE_FIELDS,
    ...(ignoreFields ?? []),
  ]);
  for (const field of Object.values(table.fields)) {
    if (ignored.has(field.name) || field.type === "Bytes") {
      continue;
    }
    if (isLongTextField(field)) {
      b.column(
        field.displayName,
        ({ record }) => (
          <Typography level="body-xs" className="max-w-xs truncate">
            {sql`substring(${record}.${field.ident}, 1, 120)`}
          </Typography>
        ),
        { field: field.name, width: 260 },
      );
      continue;
    }
    if (canInlineDisplayField(field)) {
      b.field(field.name);
    } else {
      b.simpleColumn(field.name, field.displayName);
    }
  }
}

function AdminCrudDetailDialog(props: {
  table: Table;
  recordIdScalar: string;
  config: ResolvedAdminCrudDetailConfig;
  updateConfig: ResolvedAdminCrudUpdateConfig;
}) {
  const detailFields = resolveDetailFields(props.table, props.config);
  const title = props.config.title
    ? typeof props.config.title === "function"
      ? props.config.title(sql`admin_crud_detail`)
      : props.config.title
    : `Record Details`;
  return (
    <ModalDialog
      open={sql`${sql.ref(props.recordIdScalar)} is not null`}
      onClose={(s) => s.setScalar(props.recordIdScalar, sql`null::bigint`)}
      maxWidth={props.config.maxWidth}
      className="flex flex-col gap-4 p-5"
    >
      <Data
        watch={sql.ref(props.recordIdScalar)}
        procedure={(s) => {
          s.defRecord(
            "admin_crud_detail",
            sql`select * from ${props.table.identWithDb} where ${props.table.primaryKeyIdent} = ${
              sql.ref(props.recordIdScalar)
            }`,
          );
        }}
        pendingFallback={null}
      >
        <div className="flex items-start justify-between gap-3">
          <Typography level="title-lg">{title}</Typography>
          <IconButton
            icon="Close"
            variant="plain"
            color="neutral"
            size="sm"
            aria-label="Close"
            onClick={(s: DomStatements) =>
              s.setScalar(props.recordIdScalar, sql`null::bigint`)}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {detailFields.map((field) => <DetailFieldRow field={field} />)}
        </div>
        {props.config.related.length > 0 && (
          <div className="grid gap-4">
            {props.config.related.map((related) => (
              <AdminRelatedTable
                {...related}
                parentRecordId={sql.ref(props.recordIdScalar)}
              />
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) =>
              s.setScalar(props.recordIdScalar, sql`null::bigint`)}
          >
            Close
          </Button>
          {props.config.editButton && props.updateConfig.enabled && (
            <AutoUpdateButton
              table={props.table.name}
              recordId={sql.ref(props.recordIdScalar)}
              {...updateDialogOptions(
                props.updateConfig,
                sql.ref(props.recordIdScalar),
              )}
              variant="soft"
              color="primary"
            >
              Edit
            </AutoUpdateButton>
          )}
        </div>
      </Data>
    </ModalDialog>
  );
}

function resolveDetailFields(
  table: Table,
  config: ResolvedAdminCrudDetailConfig,
) {
  if (config.fields.length > 0) {
    return config.fields.map((fieldName) => {
      const field = table.fields[fieldName];
      if (!field) {
        throw new Error(`Field ${fieldName} not found on table ${table.name}`);
      }
      return field;
    });
  }
  const ignored = new Set(["id", ...config.ignoreFields]);
  return Object.values(table.fields).filter((field) =>
    !ignored.has(field.name) && field.type !== "Bytes"
  );
}

function DetailFieldRow(props: { field: Field }) {
  const field = props.field;
  const value = sql`admin_crud_detail.${field.ident}`;
  const isWide = isLongTextField(field) || field.type === "Json";
  return (
    <div className={isWide ? "md:col-span-2" : undefined}>
      <Typography level="body-xs" className="text-tertiary mb-1">
        {field.displayName}
      </Typography>
      <div
        className={isWide
          ? "rounded-sm bg-level1 p-3 text-sm whitespace-pre-wrap break-words max-h-80 overflow-auto"
          : "text-sm"}
      >
        {isWide
          ? sql`cast(${value} as string)`
          : canInlineDisplayField(field)
          ? <InlineFieldDisplay field={field} value={value} />
          : value}
      </div>
    </div>
  );
}

function canInlineDisplayField(field: Field) {
  if (field.type !== "ForeignKey") {
    return true;
  }
  const target = system.db.tables[field.table];
  return !!(
    target?.inlineRecordDisplay || target?.recordDisplayName ||
    target?.fields.email
  );
}

function isLongTextField(field: Field) {
  return field.type === "String" &&
    (field.multiline ||
      field.maxLength > 160 ||
      field.name.includes("note") ||
      field.name.includes("description") ||
      field.name.includes("comment"));
}

/** Props for {@link AdminRelatedTable}. Inherits most {@link DataTableProps} layout/behavior options. */
export interface AdminRelatedTableProps extends
  Omit<
    DataTableProps,
    | "actions"
    | "primaryTable"
    | "query"
    | "recordName"
    | "toolbar"
  > {
  /** Card heading for the related section. */
  title: Node;
  /** Related table to list. */
  table: string;
  /** FK field on the related table pointing back to the parent. Inferred when the table has exactly one FK. */
  parentField?: string;
  /** Parent record id used to filter related rows. Defaults to `ui.record_id`. */
  parentRecordId?: NumericExpr;
  /** Override the related-rows query; a callback receives the parent record id. */
  query?: Sql | ((parentRecordId: NumericExpr) => Sql);
  /** Table the row actions target, if different from `table`. */
  primaryTable?: string;
  columns?: (b: ColumnsBuilder) => void;
  /** Extra row actions appended after the built-in detail/edit/delete actions. */
  actions?: (b: ActionsBuilder) => void;
  toolbar?: Node;
  /** Disable insert, update, and delete in one switch. */
  readonly?: boolean;
  insert?: AdminCrudInsertConfig | boolean;
  update?: AdminCrudUpdateConfig | boolean;
  delete?: AdminCrudDeleteConfig | boolean;
  detail?: AdminCrudDetailConfig | boolean;
  description?: Node;
}

/**
 * A card-wrapped {@link DataTable} of rows related to a parent record via a
 * foreign key, with the same Add/edit/delete/detail features as
 * {@link AdminCrudPage}. Embed inside a detail view (e.g. {@link AdminDetailPage}'s
 * `related`) to manage child records.
 *
 * @category Page Component
 */
export function AdminRelatedTable(props: AdminRelatedTableProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const primaryTable = props.primaryTable ?? props.table;
  const primaryTableModel = system.db.tables[primaryTable];
  if (!primaryTableModel) {
    throw new Error(`Table ${primaryTable} not found`);
  }
  const resolvedParentField = props.parentField ?? inferParentField(table);
  if (!props.query && !resolvedParentField) {
    throw new Error(
      `AdminRelatedTable for ${props.table} needs parentField when query is not provided`,
    );
  }

  const detailConfig = normalizeDetailConfig(props.detail);
  const insertConfig = normalizeInsertConfig(props.insert, props.readonly);
  const updateConfig = normalizeUpdateConfig(props.update, props.readonly);
  const deleteConfig = normalizeDeleteConfig(props.delete, props.readonly);
  const detailRecordIdScalar = `admin_related_detail_id_${getUniqueUiId()}`;
  const recordName = "admin_related_record";
  const parentRecordId = props.parentRecordId ?? sql`ui.record_id`;
  const query = typeof props.query === "function"
    ? props.query(parentRecordId)
    : props.query ??
      sql`select * from ${table.identWithDb} where ${
        sql.ref(resolvedParentField!)
      } = ${parentRecordId}`;
  const toolbar = (
    <>
      {props.toolbar}
      {insertConfig.enabled && (
        <AutoInsertButton
          table={primaryTable}
          size="sm"
          startIcon="Add"
          variant="soft"
          ignoreFields={insertConfig.ignoreFields}
          fieldOverrides={insertConfig.fieldOverrides}
          values={insertConfig.values}
          parentRecordId={resolvedParentField ? parentRecordId : undefined}
          parentField={resolvedParentField}
        >
          {insertConfig.label ?? `Add ${primaryTableModel.displayName}`}
        </AutoInsertButton>
      )}
    </>
  );

  return (
    <Data
      local
      procedure={(s) => {
        if (detailConfig.enabled && detailConfig.mode === "modal") {
          s.defScalar(detailRecordIdScalar, sql`null::bigint`);
        }
      }}
    >
      <Card variant="outlined">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <Typography level="title-md">{props.title}</Typography>
            {props.description && (
              <Typography level="body-xs" className="text-tertiary mt-1">
                {props.description}
              </Typography>
            )}
          </div>
        </div>
        <DataTable
          query={query}
          primaryTable={primaryTable}
          columns={props.columns}
          showIdColumn={props.showIdColumn}
          selectable={props.selectable}
          bulkActions={props.bulkActions}
          actions={(b) => {
            if (detailConfig.enabled) {
              b.custom("Details", { icon: "OpenInNew" }, (s) => {
                const id = sql`${
                  sql.ref(recordName)
                }.${primaryTableModel.primaryKeyIdent}`;
                if (detailConfig.mode === "route") {
                  s.navigate(getAdminDetailUrl(primaryTable, id, detailConfig));
                } else {
                  s.setScalar(detailRecordIdScalar, id);
                }
              });
            }
            if (updateConfig.enabled) {
              b.edit(
                updateActionOptions(
                  updateConfig,
                  resolvedParentField ? [resolvedParentField] : [],
                ),
              );
            }
            if (deleteConfig.enabled) {
              b.delete(deleteActionOptions(deleteConfig));
            }
            props.actions?.(b);
          }}
          recordName={recordName}
          toolbar={toolbar}
          searchable={props.searchable ?? true}
          searchDebounceMs={props.searchDebounceMs}
          filterable={props.filterable ?? true}
          filterVariant={props.filterVariant ?? "panel"}
          defaultFilters={props.defaultFilters}
          sortable={props.sortable ?? true}
          defaultSort={props.defaultSort}
          pageSize={props.pageSize ?? 25}
          download={props.download}
          editable={props.editable ?? !props.readonly}
          where={props.where}
          watch={props.watch}
          variant={props.variant ?? "outlined"}
          size={props.size}
          emptyState={props.emptyState}
          loadingState={props.loadingState}
          className={props.className}
          tableProps={props.tableProps}
          header={props.header}
          footer={props.footer}
          scrollable={props.scrollable}
          selectionTable={props.selectionTable}
          analysisScalars={props.analysisScalars}
          minColumnWidth={props.minColumnWidth}
        />
      </Card>
      {detailConfig.enabled && detailConfig.mode === "modal" && (
        <AdminCrudDetailDialog
          table={primaryTableModel}
          recordIdScalar={detailRecordIdScalar}
          config={detailConfig}
          updateConfig={updateConfig}
        />
      )}
    </Data>
  );
}

function inferParentField(table: Table) {
  const fields = Object.values(table.fields).filter((field) =>
    field.type === "ForeignKey"
  );
  return fields.length === 1 ? fields[0].name : undefined;
}
