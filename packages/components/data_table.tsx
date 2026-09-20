import {
  analyzeQueryWithContext,
  CurrentRecordICtxKey,
  CurrentTableICtxKey,
  ExtendedCurrentRecordContext,
  ExtendedCurrentTableContext,
} from "std/ictx";
import { normalizeCase, singularize, upcaseFirst } from "std/inflectors";
import { selectColumn, sql, valuesRow } from "../std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "../std/sql_utils";
import {
  buildRankedSearchTargets,
  buildSearchExpression,
} from "std/search_utils";
import type {
  DomStatements,
  RankedSearchTable,
  UiServerStatements,
  UiServerStatementsOrFn,
} from "std/statements";
import type { FormContext, FormSubmitError } from "std/form";
import { system } from "std/system";
import type { Field, Table as DbTable } from "std/system";
import {
  addCtx,
  Conditional,
  Each,
  EventHandlers,
  Show,
  useOptionalICtx,
} from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import type { AnalyzeScalarType, QueryColumnInfo } from "std/yolm_gen_api";
import { Alert } from "./alert";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { DownloadButton } from "./download_button";
import { IconButton } from "./icon_button";
import { InlineFieldDisplay } from "./inline_field_display";
import { InlineRecordDisplay } from "./inline_record_display";
import { Input } from "./input";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "components/material_icon_names";
import { ListItemDecorator } from "components/list";
import { Menu } from "./menu";
import { Select } from "./select";
import { Skeleton } from "./skeleton";
import { Snackbar } from "./snackbar";
import { Table } from "./table";
import type { TableProps } from "./table";
import { AutoUpdateMenuItem } from "./auto_update_dialog";
import { DeleteRecordMenuItem } from "./delete_record_dialog";
import { QueryCombobox } from "./query_combobox";
import { EnumSelect } from "./enum_select";
import type { Size } from "./types";
import { ActionMenuItem } from "std/action_button";
import type {
  ActionButtonConfirm,
  ActionMenuItemProps,
} from "std/action_button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Hook invoked around an inline cell edit. Receives the new cell value
 * and the record's primary key, and returns statements run on the server
 * inside the update transaction (see `beforeEdit`/`afterEdit` on
 * {@link ColumnOpts}).
 */
export type EditHook = (
  newValue: Sql,
  recordId: Sql,
) => UiServerStatementsOrFn;

type DataTableFieldType = Field["type"] | "Interval";

/** Options for configuring individual columns in a DataTable. */
export interface ColumnOpts {
  /** Database field name used for sorting and filtering. Required for custom columns that need sorting/filtering support. */
  field?: string;
  /** Whether this column is sortable by clicking the header. Default: `true` for field/simpleColumn, `false` for custom column. */
  sortable?: boolean;
  /** Whether this column has a filter control. Default: `true` for field/simpleColumn, `false` for custom column. */
  filterable?: boolean;
  /** Field type for computed columns. Used for filter controls and filter predicates when the column does not map directly to a database field. */
  fieldType?: DataTableFieldType;
  /** Query-backed enum filter options with `value` and `label` columns. */
  enumFilterOptionsQuery?: Sql;
  /** Column width as a CSS value (e.g. `"200px"`, `"30%"`, `150`). */
  width?: string | number;
  /** Text alignment for the column. */
  align?: "left" | "center" | "right";
  /** Whether this column supports inline editing. Requires the primary key to be present in query results. */
  editable?: boolean;
  /** Hook called before the database update when inline editing. Receives the new value and the record's primary key. */
  beforeEdit?: EditHook;
  /** Hook called after the database update when inline editing. Receives the new value and the record's primary key. */
  afterEdit?: EditHook;
  /** SQL boolean expression — when true at runtime, the column is omitted. */
  hidden?: BooleanExpr;
}

interface EditingMeta {
  sourceTable: string;
  sourceField: string;
  pkResultColumn: string;
  dbField: Field;
  beforeEdit?: EditHook;
  afterEdit?: EditHook;
}

interface InternalColumn {
  header: Node;
  cell: (props: { record: Sql }) => Node;
  field?: string;
  fieldType?: DataTableFieldType;
  sortable: boolean;
  filterable: boolean;
  width?: string | number;
  align?: "left" | "center" | "right";
  editable?: boolean;
  beforeEdit?: EditHook;
  afterEdit?: EditHook;
  editing?: EditingMeta;
  hidden?: BooleanExpr;
  enumName?: string;
  enumFilterOptionsQuery?: Sql;
}

// ---------------------------------------------------------------------------
// ColumnsBuilder
// ---------------------------------------------------------------------------

/**
 * Builder for defining DataTable columns.
 *
 * Provides methods for common column types (field, currency, date, enum, etc.)
 * as well as fully custom columns. Pass a callback to the DataTable `columns` prop
 * to configure columns via this builder.
 *
 * @example
 * ```tsx
 * <DataTable
 *   query={sql`select * from db.orders`}
 *   primaryTable="orders"
 *   columns={(b) => {
 *     b.field("order_number", "Order #");
 *     b.usdColumn("total", "Amount");
 *     b.enumColumn("status", "order_status");
 *     b.dateColumn("created_at", "%b %d, %Y", "Date");
 *   }}
 * />
 * ```
 */
export class ColumnsBuilder {
  #columns: InternalColumn[] = [];
  #primaryTable: DbTable | undefined;

  constructor(primaryTable: DbTable | undefined) {
    this.#primaryTable = primaryTable;
  }

  /** Display a field from `primaryTable` with automatic formatting via InlineFieldDisplay. */
  field(name: string, header?: Node, opts?: ColumnOpts) {
    if (!this.#primaryTable) {
      throw new Error(
        `Primary table not set, but using field() in DataTable for field '${name}'.`,
      );
    }
    const field = this.#primaryTable.fields[name];
    if (!field) {
      throw new Error(
        `Field '${name}' not found on table '${this.#primaryTable.name}'`,
      );
    }
    this.#columns.push({
      header: header ?? field.displayName,
      cell: (props) => (
        <InlineFieldDisplay
          field={field}
          value={sql`${props.record}.${sql.ref(name)}`}
        />
      ),
      field: name,
      fieldType: field.type,
      sortable: opts?.sortable ?? true,
      filterable: opts?.filterable ?? true,
      width: opts?.width,
      align: opts?.align,
      editable: opts?.editable,
      beforeEdit: opts?.beforeEdit,
      afterEdit: opts?.afterEdit,
      hidden: opts?.hidden,
      enumName: field.type === "Enum" ? field.enum : undefined,
      enumFilterOptionsQuery: opts?.enumFilterOptionsQuery,
    });
  }

  /** Custom column with full render control. Sortable and filterable default to `false` unless `field` is provided. */
  column(
    header: Node,
    cell: (props: { record: Sql }) => Node,
    opts?: ColumnOpts,
  ) {
    const hasField = !!opts?.field;
    this.#columns.push({
      header,
      cell,
      field: opts?.field,
      fieldType: opts?.fieldType,
      sortable: opts?.sortable ?? hasField,
      filterable: opts?.filterable ?? hasField,
      width: opts?.width,
      align: opts?.align,
      editable: opts?.editable,
      beforeEdit: opts?.beforeEdit,
      afterEdit: opts?.afterEdit,
      hidden: opts?.hidden,
    });
  }

  /** Basic text column displaying the raw field value. */
  simpleColumn(field: string, header?: Node, opts?: ColumnOpts) {
    this.#columns.push({
      header: header ?? upcaseFirst(normalizeCase(field).join(" ")),
      cell: (props) => sql`${props.record}.${sql.ref(field)}`,
      field,
      fieldType: opts?.fieldType,
      sortable: opts?.sortable ?? true,
      filterable: opts?.filterable ?? true,
      width: opts?.width,
      align: opts?.align,
      editable: opts?.editable,
      beforeEdit: opts?.beforeEdit,
      afterEdit: opts?.afterEdit,
      hidden: opts?.hidden,
    });
  }

  /** Column formatted with `format.decimal()`. */
  decimalColumn(field: string, opts?: ColumnOpts) {
    this.formatColumn(
      field,
      (col) => sql`format.decimal(${col})`,
      undefined,
      opts,
    );
  }

  /** Column formatted as a percentage via `format.percent()`. */
  percentColumn(
    field: string,
    formatOpts?: { maximumFractionDigits?: number },
    opts?: ColumnOpts,
  ) {
    const resolvedFormatOpts = formatOpts ?? {};
    const parts: string[] = [];
    if (resolvedFormatOpts.maximumFractionDigits) {
      parts.push(
        `maximum_fraction_digits => ${resolvedFormatOpts.maximumFractionDigits}`,
      );
    }
    const joinedOpts = parts.length > 0
      ? sql`, ${sql(parts.join(", "))}`
      : sql``;
    this.formatColumn(
      field,
      (col) => sql`format.percent(${col}${joinedOpts})`,
      undefined,
      opts,
    );
  }

  /** Column formatted as USD currency via `format.currency()`. */
  usdColumn(field: string, header?: Node, opts?: ColumnOpts) {
    this.formatColumn(
      field,
      (col) => sql`format.currency(${col}, 'USD')`,
      header,
      opts,
    );
  }

  /** Column formatted with `format.date()` using the given format string. */
  dateColumn(field: string, format: string, header?: Node, opts?: ColumnOpts) {
    this.formatColumn(
      field,
      (col) => sql`format.date(${col}, ${sql.lit(format)})`,
      header,
      opts,
    );
  }

  /** Column displaying a duration in minutes via `fn.display_minutes_duration()`. */
  minutesDurationColumn(field: string, header?: Node, opts?: ColumnOpts) {
    this.formatColumn(
      field,
      (col) => sql`fn.display_minutes_duration(${col})`,
      header,
      opts,
    );
  }

  /** Column showing a checkmark icon for boolean `true` values. */
  checkColumn(field: string, header?: Node, opts?: ColumnOpts) {
    this.#columns.push({
      header: header ?? upcaseFirst(normalizeCase(field).join(" ")),
      cell: (props) => (
        <Show when={sql`${props.record}.${sql.ref(field)}`}>
          <MaterialIcon icon="Check" />
        </Show>
      ),
      field,
      fieldType: "Bool",
      sortable: opts?.sortable ?? true,
      filterable: opts?.filterable ?? true,
      width: opts?.width,
      align: opts?.align,
      editable: opts?.editable,
      beforeEdit: opts?.beforeEdit,
      afterEdit: opts?.afterEdit,
      hidden: opts?.hidden,
    });
  }

  /** Column displaying an enum value using its display function. */
  enumColumn(
    field: string,
    enumName: string,
    header?: Node,
    opts?: ColumnOpts,
  ) {
    const enum_ = system.enums[enumName];
    if (!enum_) {
      throw new Error(`Enum ${enumName} not found`);
    }
    this.#columns.push({
      header: header ?? upcaseFirst(normalizeCase(field).join(" ")),
      cell: (props) =>
        sql`fn.display_${sql(enum_.name)}(${sql`${props.record}.${
          sql.ref(field)
        }`})`,
      field,
      fieldType: "Enum",
      sortable: opts?.sortable ?? true,
      filterable: opts?.filterable ?? true,
      width: opts?.width,
      align: opts?.align,
      editable: opts?.editable,
      beforeEdit: opts?.beforeEdit,
      afterEdit: opts?.afterEdit,
      hidden: opts?.hidden,
      enumName,
      enumFilterOptionsQuery: opts?.enumFilterOptionsQuery,
    });
  }

  /** Column with a custom format function applied to the field value. */
  formatColumn(
    field: string,
    format: (value: Sql) => Node,
    header?: Node,
    opts?: ColumnOpts,
  ) {
    this.#columns.push({
      header: header ?? upcaseFirst(normalizeCase(field).join(" ")),
      cell: (props) => format(sql`${props.record}.${sql.ref(field)}`),
      field: opts?.field ?? field,
      fieldType: opts?.fieldType,
      sortable: opts?.sortable ?? true,
      filterable: opts?.filterable ?? true,
      width: opts?.width,
      align: opts?.align,
      editable: opts?.editable,
      beforeEdit: opts?.beforeEdit,
      afterEdit: opts?.afterEdit,
      hidden: opts?.hidden,
    });
  }

  /** Column displaying a related record's name with a link, using InlineRecordDisplay. */
  recordDisplayColumn(
    field: string,
    tableName: string,
    header?: Node,
    opts?: ColumnOpts,
  ) {
    this.formatColumn(
      field,
      (col) => <InlineRecordDisplay id={col} tableName={tableName} />,
      header,
      opts,
    );
  }

  /** Add one column per field of `primaryTable`, skipping `id` (unless `showIdColumn`) and any `ignoreFields`. */
  autoFields(opts?: { ignoreFields?: string[]; showIdColumn?: boolean }) {
    if (!this.#primaryTable) {
      throw new Error(
        "Primary table not set, but using autoFields() in DataTable.",
      );
    }
    const ignoreFields = opts?.ignoreFields;
    for (const field of Object.values(this.#primaryTable.fields)) {
      if (!opts?.showIdColumn && field.name === "id") continue;
      if (ignoreFields?.includes(field.name)) continue;
      this.field(field.name);
    }
  }

  /** Return the accumulated column definitions. Called internally by DataTable. */
  getColumns() {
    return this.#columns;
  }
}

// ---------------------------------------------------------------------------
// ActionsBuilder
// ---------------------------------------------------------------------------

interface CustomAction {
  type: "custom";
  label: string;
  icon?: IconName;
  handler: (s: DomStatements) => void;
}

interface ServerAction {
  type: "action";
  label: string;
  icon?: ActionMenuItemProps["icon"];
  when?: BooleanExpr;
  action: (s: UiServerStatements, recordId: Sql) => void;
  successMessage?: string | Sql;
  errorDisplay?: "snackbar" | "none";
  refetch?: boolean;
  confirm?: ActionButtonConfirm;
  onSuccess?: (s: UiServerStatements, recordId: Sql) => void;
  afterSuccessClient?: (s: DomStatements, recordId: Sql) => void;
}

type RowEditServerHook = (
  s: UiServerStatements,
  ctx: FormContext,
  recordId: Sql,
) => unknown;

type RowEditClientHook = (
  s: DomStatements,
  ctx: FormContext,
  recordId: Sql,
) => unknown;

export interface RowEditHooks {
  beforeSubmitClient?: RowEditClientHook;
  beforeTransactionStart?: RowEditServerHook;
  afterTransactionStart?: RowEditServerHook;
  beforeTransactionCommit?: RowEditServerHook;
  afterTransactionCommit?: RowEditServerHook;
  afterSubmitClientSuccess?: RowEditClientHook;
  onSubmitServerError?: (
    s: UiServerStatements,
    ctx: FormContext,
    err: FormSubmitError,
    recordId: Sql,
  ) => unknown;
}

type RowDeleteServerHook = (
  s: UiServerStatements,
  recordId: Sql,
) => unknown;

type RowDeleteClientHook = (
  s: DomStatements,
  recordId: Sql,
) => unknown;

export interface RowDeleteHooks {
  beforeSubmitClient?: RowDeleteClientHook;
  beforeTransactionStart?: RowDeleteServerHook;
  afterTransactionStart?: RowDeleteServerHook;
  beforeTransactionCommit?: RowDeleteServerHook;
  afterTransactionCommit?: RowDeleteServerHook;
  afterSubmitClient?: RowDeleteClientHook;
}

interface EditAction extends RowEditHooks {
  type: "edit";
  ignoreFields?: string[];
  temporaryFields?: Node;
}

interface DeleteAction extends RowDeleteHooks {
  type: "delete";
  confirmText?: string;
}

type ActionItem = CustomAction | ServerAction | EditAction | DeleteAction;

/**
 * Builder for defining row actions in a DataTable.
 *
 * Provides built-in edit and delete actions (using AutoUpdateMenuItem and
 * DeleteRecordMenuItem) and supports custom actions.
 *
 * @example
 * ```tsx
 * <DataTable
 *   query={sql`select * from db.orders`}
 *   primaryTable="orders"
 *   actions={(b) => {
 *     b.edit();
 *     b.delete();
 *     b.custom("Archive", { icon: "Archive" }, (s) => { ... });
 *   }}
 * />
 * ```
 */
export class ActionsBuilder {
  #actions: ActionItem[] = [];

  /** Add an edit action that opens an auto-generated update dialog for the row. */
  edit(
    opts?: { ignoreFields?: string[]; temporaryFields?: Node } & RowEditHooks,
  ) {
    this.#actions.push({
      type: "edit",
      ignoreFields: opts?.ignoreFields,
      temporaryFields: opts?.temporaryFields,
      beforeSubmitClient: opts?.beforeSubmitClient,
      beforeTransactionStart: opts?.beforeTransactionStart,
      afterTransactionStart: opts?.afterTransactionStart,
      beforeTransactionCommit: opts?.beforeTransactionCommit,
      afterTransactionCommit: opts?.afterTransactionCommit,
      afterSubmitClientSuccess: opts?.afterSubmitClientSuccess,
      onSubmitServerError: opts?.onSubmitServerError,
    });
  }

  /** Add a delete action that opens a confirmation dialog before deleting the row. */
  delete(
    opts?: {
      confirmText?: string;
    } & RowDeleteHooks,
  ) {
    this.#actions.push({
      type: "delete",
      confirmText: opts?.confirmText,
      beforeSubmitClient: opts?.beforeSubmitClient,
      beforeTransactionStart: opts?.beforeTransactionStart,
      afterTransactionStart: opts?.afterTransactionStart,
      beforeTransactionCommit: opts?.beforeTransactionCommit,
      afterTransactionCommit: opts?.afterTransactionCommit,
      afterSubmitClient: opts?.afterSubmitClient,
    });
  }

  /** Add a custom action with a label, optional icon, and click handler. */
  custom(
    label: string,
    opts: { icon?: IconName },
    handler: (s: DomStatements) => void,
  ) {
    this.#actions.push({
      type: "custom",
      label,
      icon: opts.icon,
      handler,
    });
  }

  /** Add a guarded server action for the row. */
  action(
    label: string,
    opts: {
      icon?: ActionMenuItemProps["icon"];
      /** SQL condition controlling whether the menu item is rendered. */
      when?: BooleanExpr;
      successMessage?: string | Sql;
      errorDisplay?: "snackbar" | "none";
      refetch?: boolean;
      confirm?: ActionButtonConfirm;
      onSuccess?: (s: UiServerStatements, recordId: Sql) => void;
      afterSuccessClient?: (s: DomStatements, recordId: Sql) => void;
    },
    action: (s: UiServerStatements, recordId: Sql) => void,
  ) {
    this.#actions.push({
      type: "action",
      label,
      action,
      ...opts,
    });
  }

  /** Return the accumulated action definitions. Called internally by DataTable. */
  getActions() {
    return this.#actions;
  }
}

// ---------------------------------------------------------------------------
// DataTableProps
// ---------------------------------------------------------------------------

/** Props for the {@link DataTable} component. */
export interface DataTableProps {
  /** SQL query to display in the table. */
  query: Sql;
  /** Primary database table name. Enables field metadata, display names, InlineFieldDisplay, and editing. */
  primaryTable?: string;
  /** Additional WHERE clause injected into the query. */
  where?: BooleanExpr;
  /** SQL expressions to watch — the table refetches when any of these change. */
  watch?: AnyExpr | AnyExpr[];

  /** Column definitions builder callback. If omitted, columns are auto-inferred from the query. */
  columns?: (b: ColumnsBuilder) => void;
  /** Whether to show the `id` column when auto-inferring columns. Default: `false`. */
  showIdColumn?: boolean;

  /** Enable pagination with this many rows per page. */
  pageSize?: number;
  /**
   * Optional optimized paged query for the default state (no active search,
   * filters, or user sort). Must return the same columns as `query` and apply
   * pagination itself, preserving `defaultSort` when one is configured.
   */
  defaultPagedQuery?: Sql;
  /**
   * Optional count query for the default state (no active search, filters, or
   * user sort). Must return one row containing the same count as `query`.
   */
  defaultCountQuery?: Sql;
  /** Enable a search bar. Pass `{ placeholder: "..." }` to customize the placeholder text. Pass a string array to restrict search to specific fields. */
  searchable?: boolean | string[] | { placeholder?: string };
  /** Enable per-column filter controls. */
  filterable?: boolean;
  /** How per-column filters are presented. Default: `"inline"`. */
  filterVariant?: "inline" | "panel";
  /** Initial per-column filter values keyed by field name. Users can still change or clear filters. */
  defaultFilters?: Record<string, AnyExpr>;
  /** Enable column sorting by clicking headers. */
  sortable?: boolean;
  /** Default sort column and direction. */
  defaultSort?: { column: string; direction?: "asc" | "desc" };
  /** Enable row selection with checkboxes. */
  selectable?: boolean;
  /** Show an action that selects every row matching the current search and filters, including rows on other pages. */
  selectAllFilteredResults?: boolean;
  /** Enable CSV download. Pass a string for the file name, or an object with `fileName` and optional `label`. */
  download?: string | { fileName: string; label?: string };
  /** Enable inline editing for columns that map to database fields. */
  editable?: boolean;

  /** Row click handler. */
  onRowClick?: (s: DomStatements) => void;
  /** Record name used in the `Each` iteration. Default: singularized table name or `"record"`. */
  recordName?: string;
  /** Row actions builder callback (edit, delete, custom). Renders a "..." menu on each row. */
  actions?: (b: ActionsBuilder) => void;
  /** Rendered when rows are selected. Receives the name of the selection table (defaults to `"dt_selected"`, or the value of `selectionTable`). */
  bulkActions?: (selectedTable: string) => Node;

  /** Visual variant. `"outlined"` adds a border, `"plain"` removes row borders. Default: `"default"`. */
  variant?: "default" | "outlined" | "plain";
  /** Table size controlling cell padding. Default: `"md"`. */
  size?: Size;
  /** CSS class for the outer container. */
  className?: string;
  /** Props passed through to the inner `Table` component. */
  tableProps?: Omit<TableProps, "children"> & JSX.IntrinsicElements["table"];
  /** Header content rendered above the table. */
  header?: Node;
  /** Footer content rendered below the table. */
  footer?: Node;
  /** Content or string shown when the query returns no rows. */
  emptyState?: Node | string;
  /** Content shown while the query is loading (defaults to skeleton rows). */
  loadingState?: Node;
  /** Wrap the table in a scrollable container with a sticky header. The caller controls height via `className`. */
  scrollable?: boolean;
  /** Name of an externally-defined selection table. When set, DataTable skips creating `dt_selected` and uses this table instead. The parent must define: `s.defTable("...", { fields: [{ name: "id", type: "BigInt", notNull: true }] })`. */
  selectionTable?: string;
  /** Custom toolbar content rendered alongside the search bar and download button. */
  toolbar?: Node;
  /** Extra scalars available in the query context (e.g., from parent Data queryParams). Passed to the query analyzer so it can resolve unqualified scalar references. */
  analysisScalars?: Record<string, AnalyzeScalarType>;
  /** Minimum width (in px) for columns that don't have an explicit `width`. When set, the table becomes horizontally scrollable if columns exceed the container width. */
  minColumnWidth?: number;
}

// ---------------------------------------------------------------------------
// Helpers - filter condition generation
// ---------------------------------------------------------------------------

function getFieldTypeFromColumn(
  col: InternalColumn,
): DataTableFieldType | undefined {
  return col.fieldType;
}

function requireFilterFieldType(col: InternalColumn): DataTableFieldType {
  const fieldType = getFieldTypeFromColumn(col);
  if (fieldType) return fieldType;
  throw new Error(
    `DataTable column "${
      col.field ?? "<custom>"
    }" requires fieldType for filtering because query analysis did not determine its type`,
  );
}

function getDefaultOperator(fieldType: DataTableFieldType): Sql {
  switch (fieldType) {
    case "String":
    case "PhoneNumber":
      return sql.lit`contains`;
    case "Decimal":
    case "Int":
    case "BigInt":
    case "SmallInt":
    case "Uint":
    case "BigUint":
    case "SmallUint":
    case "TinyInt":
    case "TinyUint":
    case "Real":
    case "Double":
    case "Ordering":
    case "Tx":
      return sql.lit`equals`;
    case "Bool":
    case "ForeignKey":
    case "Enum":
      return sql.lit``;
    case "Date":
    case "TimestampTz":
    case "TimestampUtc":
    case "TimestampNaive":
    case "Uuid":
    case "Time":
    case "Json":
    case "Bytes":
    case "Interval":
      return sql.lit`equals`;
  }
}

function generateFilterCondition(col: InternalColumn): Sql {
  const fieldType = requireFilterFieldType(col);
  const fieldRef = sql.ref(col.field!);
  const filterValue = sql`dt_filter_${sql.ref(col.field!)}`;
  const filterOp = sql`dt_filter_op_${sql.ref(col.field!)}`;

  switch (fieldType) {
    case "ForeignKey":
      return sql`(${filterValue} = '' or ${fieldRef} = try_cast(${filterValue} as bigint))`;
    case "Enum":
      return sql`(${filterValue} = '' or cast(${fieldRef} as text) = ${filterValue})`;
    case "Bool":
      return sql`(${filterValue} = '' or
          case ${filterValue}
            when 'true' then ${fieldRef} = true
            when 'false' then ${fieldRef} = false
            else true
          end)`;
    case "Date":
    case "TimestampTz":
    case "TimestampUtc":
    case "TimestampNaive": {
      const endValue = sql`dt_filter_${sql.ref(col.field!)}_end`;
      return sql`(${filterValue} = '' or
          case ${filterOp}
            when 'equals' then ${fieldRef}::date = try_cast(${filterValue} as date)
            when 'before' then ${fieldRef}::date < try_cast(${filterValue} as date)
            when 'after' then ${fieldRef}::date > try_cast(${filterValue} as date)
            when 'between' then ${fieldRef}::date between try_cast(${filterValue} as date) and try_cast(${endValue} as date)
            else true
          end)`;
    }
    case "Decimal":
    case "Int":
    case "BigInt":
    case "SmallInt":
    case "Uint":
    case "BigUint":
    case "SmallUint":
    case "TinyInt":
    case "TinyUint":
    case "Real":
    case "Double":
    case "Ordering":
    case "Tx":
      return sql`(${filterValue} = '' or
          case ${filterOp}
            when 'equals' then ${fieldRef} = try_cast(${filterValue} as decimal(18,6))
            when 'not_equals' then ${fieldRef} != try_cast(${filterValue} as decimal(18,6))
            when 'greater' then ${fieldRef} > try_cast(${filterValue} as decimal(18,6))
            when 'less' then ${fieldRef} < try_cast(${filterValue} as decimal(18,6))
            when 'greater_equal' then ${fieldRef} >= try_cast(${filterValue} as decimal(18,6))
            when 'less_equal' then ${fieldRef} <= try_cast(${filterValue} as decimal(18,6))
            else true
          end)`;
    case "String":
    case "PhoneNumber":
    case "Uuid":
    case "Time":
    case "Json":
    case "Bytes":
    case "Interval":
      return sql`(${filterValue} = '' or
          case ${filterOp}
            when 'contains' then position(lower(${filterValue}) in lower(${fieldRef}::text)) > 0
            when 'equals' then lower(${fieldRef}::text) = lower(${filterValue})
            when 'starts_with' then position(lower(${filterValue}) in lower(substring(${fieldRef}::text, 1, length(${filterValue})))) > 0
            when 'ends_with' then position(lower(${filterValue}) in lower(substring(${fieldRef}::text, length(${fieldRef}::text) - length(${filterValue}) + 1))) > 0
            when 'not_contains' then position(lower(${filterValue}) in lower(${fieldRef}::text)) = 0
            else true
          end)`;
  }
}

function renderFilterControl(col: InternalColumn, controlSize: Size): Node {
  const fieldType = requireFilterFieldType(col);
  const fieldName = col.field!;

  switch (fieldType) {
    case "ForeignKey":
    case "Enum":
      if (fieldType === "Enum" && col.enumName) {
        if (col.enumFilterOptionsQuery) {
          return (
            <EnumSelect
              enum={col.enumName}
              optionsQuery={col.enumFilterOptionsQuery}
              size={controlSize}
              value={sql`dt_filter_${sql.ref(fieldName)}`}
              onChange={(s: DomStatements) =>
                s.setScalar(
                  `dt_filter_${fieldName}`,
                  sql`coalesce(cast(target_value as string), '')`,
                )}
              nullVariant="All"
              sx={{ width: "100%" }}
            />
          );
        }
        const enum_ = system.enums[col.enumName];
        const options = Object.values(enum_?.values ?? {})
          .filter((v) => !v.hideFromUiControls)
          .map((v) => (
            <Select.Option value={v.name}>{v.displayName}</Select.Option>
          ));
        return (
          <Select
            size={controlSize}
            value={sql`dt_filter_${sql.ref(fieldName)}`}
            onChange={(s: DomStatements) =>
              s.setScalar(`dt_filter_${fieldName}`, sql`target_value`)}
            sx={{ width: "100%" }}
          >
            <Select.Option value="">All</Select.Option>
            {options}
          </Select>
        );
      }
      return (
        <Input
          size={controlSize}
          value={sql`dt_filter_${sql.ref(fieldName)}`}
          placeholder={fieldType === "ForeignKey" ? "Record ID" : "Value"}
          onInput={(s: DomStatements) =>
            s.setScalar(`dt_filter_${fieldName}`, sql`target_value`)}
          sx={{ width: "100%" }}
        />
      );
    case "Bool":
      return (
        <Select
          size={controlSize}
          value={sql`dt_filter_${sql.ref(fieldName)}`}
          onChange={(s: DomStatements) =>
            s.setScalar(`dt_filter_${fieldName}`, sql`target_value`)}
          sx={{ width: "100%" }}
        >
          <Select.Option value="">All</Select.Option>
          <Select.Option value="true">Yes</Select.Option>
          <Select.Option value="false">No</Select.Option>
        </Select>
      );
    case "Date":
    case "TimestampTz":
    case "TimestampUtc":
    case "TimestampNaive":
      return (
        <div sx={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <Select
            size={controlSize}
            value={sql`dt_filter_op_${sql.ref(fieldName)}`}
            onChange={(s: DomStatements) =>
              s.setScalar(`dt_filter_op_${fieldName}`, sql`target_value`)}
            sx={{ width: 80 }}
          >
            <Select.Option value="equals">=</Select.Option>
            <Select.Option value="before">&lt;</Select.Option>
            <Select.Option value="after">&gt;</Select.Option>
            <Select.Option value="between">↔</Select.Option>
          </Select>
          <Input
            type="date"
            size={controlSize}
            value={sql`dt_filter_${sql.ref(fieldName)}`}
            onInput={(s: DomStatements) =>
              s.setScalar(`dt_filter_${fieldName}`, sql`target_value`)}
            sx={{ flex: 1 }}
          />
          <Show when={sql`dt_filter_op_${sql.ref(fieldName)} = 'between'`}>
            <Input
              type="date"
              size={controlSize}
              value={sql`dt_filter_${sql.ref(fieldName)}_end`}
              onInput={(s: DomStatements) =>
                s.setScalar(`dt_filter_${fieldName}_end`, sql`target_value`)}
              sx={{ flex: 1 }}
              placeholder="To"
            />
          </Show>
        </div>
      );
    case "Decimal":
    case "Int":
    case "BigInt":
    case "SmallInt":
    case "Uint":
    case "BigUint":
    case "SmallUint":
    case "TinyInt":
    case "TinyUint":
    case "Real":
    case "Double":
    case "Ordering":
    case "Tx":
      return (
        <div sx={{ display: "flex", gap: "4px" }}>
          <Select
            size={controlSize}
            value={sql`dt_filter_op_${sql.ref(fieldName)}`}
            onChange={(s: DomStatements) =>
              s.setScalar(`dt_filter_op_${fieldName}`, sql`target_value`)}
            sx={{ width: 60 }}
          >
            <Select.Option value="equals">=</Select.Option>
            <Select.Option value="not_equals">≠</Select.Option>
            <Select.Option value="greater">&gt;</Select.Option>
            <Select.Option value="less">&lt;</Select.Option>
            <Select.Option value="greater_equal">≥</Select.Option>
            <Select.Option value="less_equal">≤</Select.Option>
          </Select>
          <Input
            type="number"
            size={controlSize}
            placeholder="Value"
            value={sql`dt_filter_${sql.ref(fieldName)}`}
            onInput={(s: DomStatements) =>
              s.setScalar(`dt_filter_${fieldName}`, sql`target_value`)}
            sx={{ flex: 1 }}
          />
        </div>
      );
    case "String":
    case "PhoneNumber":
    case "Uuid":
    case "Time":
    case "Json":
    case "Bytes":
    case "Interval":
      return (
        <div sx={{ display: "flex", gap: "4px" }}>
          <Select
            size={controlSize}
            value={sql`dt_filter_op_${sql.ref(fieldName)}`}
            onChange={(s: DomStatements) =>
              s.setScalar(`dt_filter_op_${fieldName}`, sql`target_value`)}
            sx={{ width: 100 }}
          >
            <Select.Option value="contains">Contains</Select.Option>
            <Select.Option value="equals">Equals</Select.Option>
            <Select.Option value="starts_with">Starts</Select.Option>
            <Select.Option value="ends_with">Ends</Select.Option>
            <Select.Option value="not_contains">Not contains</Select.Option>
          </Select>
          <Input
            type="text"
            size={controlSize}
            placeholder="Filter..."
            value={sql`dt_filter_${sql.ref(fieldName)}`}
            onInput={(s: DomStatements) =>
              s.setScalar(`dt_filter_${fieldName}`, sql`target_value`)}
            sx={{ flex: 1 }}
          />
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Query analysis helpers
// ---------------------------------------------------------------------------

/** Infer the primary table from query analysis by counting columns per source table. */
function inferPrimaryTable(
  analysisColumns: QueryColumnInfo[],
): string | undefined {
  const tableCounts = new Map<string, number>();
  for (const col of analysisColumns) {
    if (col.sourceTable) {
      tableCounts.set(
        col.sourceTable,
        (tableCounts.get(col.sourceTable) ?? 0) + 1,
      );
    }
  }
  if (tableCounts.size === 0) return undefined;
  let best: string | undefined;
  let bestCount = 0;
  for (const [table, count] of tableCounts) {
    if (count > bestCount) {
      bestCount = count;
      best = table;
    }
  }
  if (best && system.db.tables[best]) return best;
  return undefined;
}

// ---------------------------------------------------------------------------
// Auto-column inference
// ---------------------------------------------------------------------------

function buildAutoColumns(
  analysisColumns: QueryColumnInfo[],
  primaryTable: DbTable | undefined,
  showIdColumn: boolean,
): InternalColumn[] {
  const columns: InternalColumn[] = [];
  for (const col of analysisColumns) {
    if (col.name === "id" && !showIdColumn) continue;

    let field: Field | undefined;
    if (primaryTable) {
      field = primaryTable.fields[col.name];
    }
    const fieldType = field?.type ?? analyzeTypeToFieldType(col);

    if (field) {
      columns.push({
        header: field.displayName,
        cell: (props) => (
          <InlineFieldDisplay
            field={field}
            value={sql`${props.record}.${sql.ref(col.name)}`}
          />
        ),
        field: col.name,
        fieldType,
        enumName: field.type === "Enum" ? field.enum : undefined,
        sortable: true,
        filterable: true,
      });
    } else {
      columns.push({
        header: upcaseFirst(normalizeCase(col.name).join(" ")),
        cell: (props) => sql`${props.record}.${sql.ref(col.name)}`,
        field: col.name,
        fieldType,
        sortable: true,
        filterable: fieldType !== "Json",
      });
    }
  }
  return columns;
}

function analyzeTypeToFieldType(col: QueryColumnInfo): DataTableFieldType {
  switch (col.type.type) {
    case "Bool":
      return "Bool";
    case "SmallInt":
      return "SmallInt";
    case "Int":
      return "Int";
    case "BigInt":
      return "BigInt";
    case "Real":
      return "Real";
    case "Double":
      return "Double";
    case "Decimal":
      return "Decimal";
    case "Ordering":
      return "Ordering";
    case "Date":
      return "Date";
    case "Timestamp":
      return "TimestampUtc";
    case "TimestampTz":
      return "TimestampTz";
    case "TimestampNaive":
      return "TimestampNaive";
    case "Time":
      return "Time";
    case "Enum":
      return "Enum";
    case "String":
      return "String";
    case "Uuid":
      return "Uuid";
    case "Json":
      return "Json";
    case "Interval":
      return "Interval";
    case "Bytes":
      return "Bytes";
  }
}

function applyAnalysisColumnTypes(
  columns: InternalColumn[],
  analysisColumns: QueryColumnInfo[],
) {
  const analysisByName = new Map(analysisColumns.map((col) => [col.name, col]));
  for (const col of columns) {
    if (!col.field || col.fieldType) continue;
    const analyzed = analysisByName.get(col.field);
    if (analyzed) {
      col.fieldType = analyzeTypeToFieldType(analyzed);
    }
  }
}

// ---------------------------------------------------------------------------
// Editing metadata resolution
// ---------------------------------------------------------------------------

function resolveEditingMetadata(
  analysisColumns: QueryColumnInfo[],
  columns: InternalColumn[],
) {
  // Build a map of result column name -> analysis info
  const analysisMap = new Map<string, QueryColumnInfo>();
  for (const col of analysisColumns) {
    analysisMap.set(col.name, col);
  }

  // For each source table that has editable columns, find which result column
  // holds its primary key
  const sourceTablePks = new Map<string, string>();

  // First pass: identify all source tables
  for (const col of columns) {
    if (col.editable === false || !col.field) continue;
    const info = analysisMap.get(col.field);
    if (!info?.sourceTable || !info?.sourceField) continue;
    const dbTable = system.db.tables[info.sourceTable];
    if (!dbTable) continue;

    if (!sourceTablePks.has(info.sourceTable)) {
      const pkFieldName = dbTable.primaryKeyFieldName;
      const pkCol = analysisColumns.find(
        (c) =>
          c.sourceTable === info.sourceTable && c.sourceField === pkFieldName,
      );
      if (pkCol) {
        sourceTablePks.set(info.sourceTable, pkCol.name);
      }
    }
  }

  // Second pass: attach editing metadata to each column
  for (const col of columns) {
    if (col.editable === false || !col.field) continue;
    const info = analysisMap.get(col.field);
    if (!info?.sourceTable || !info?.sourceField) {
      // No source info from analysis — not auto-editable
      if (col.editable === true) {
        throw new Error(
          `DataTable editable: column '${col.field}' has editable=true but ` +
            `the query analysis could not determine its source table/field. ` +
            `Only columns that map directly to a database field can be edited.`,
        );
      }
      continue;
    }

    const dbTable = system.db.tables[info.sourceTable];
    if (!dbTable) continue;
    const dbField = dbTable.fields[info.sourceField];
    if (!dbField) continue;

    const pkResultCol = sourceTablePks.get(info.sourceTable);
    if (!pkResultCol) {
      if (col.editable === true) {
        throw new Error(
          `DataTable editable: column '${col.field}' maps to table '${info.sourceTable}' ` +
            `but the primary key of that table ('${dbTable.primaryKeyFieldName}') is not in the query results. ` +
            `Include the primary key column in your query to enable editing.`,
        );
      }
      continue;
    }

    // Skip field types that can't be inline-edited (unless explicitly requested)
    if (col.editable !== true && !isInlineEditableType(dbField.type)) {
      continue;
    }

    // Auto-detect: column is editable
    col.editable = col.editable ?? true;
    col.fieldType = col.fieldType ?? dbField.type;
    col.editing = {
      sourceTable: info.sourceTable,
      sourceField: info.sourceField,
      pkResultColumn: pkResultCol,
      dbField,
      beforeEdit: col.beforeEdit,
      afterEdit: col.afterEdit,
    };
  }
}

// ---------------------------------------------------------------------------
// Query building helpers
// ---------------------------------------------------------------------------

function isStringLikeType(type: DataTableFieldType | undefined): boolean {
  switch (type) {
    case undefined:
    case "String":
    case "PhoneNumber":
    case "Enum":
    case "Uuid":
      return true;
    case "Decimal":
    case "Int":
    case "BigInt":
    case "SmallInt":
    case "Uint":
    case "BigUint":
    case "SmallUint":
    case "TinyInt":
    case "TinyUint":
    case "Real":
    case "Double":
    case "Ordering":
    case "Tx":
    case "Bool":
    case "ForeignKey":
    case "Date":
    case "TimestampTz":
    case "TimestampUtc":
    case "TimestampNaive":
    case "Time":
    case "Json":
    case "Bytes":
    case "Interval":
      return false;
  }
}

/** Build the search WHERE condition for use inside branching. */
function buildSearchCondition(
  columns: InternalColumn[],
  fields?: string[],
): Sql | undefined {
  const stringCols = Array.isArray(fields) && fields.length > 0
    ? fields
    : columns.filter(
      (c) => c.field && isStringLikeType(getFieldTypeFromColumn(c)),
    ).map((c) => c.field!);
  if (stringCols.length === 0) return undefined;
  const concatParts = stringCols.map((c) =>
    sql`coalesce(${sql.ref(c)}::text, '')`
  );
  let concatExpr = concatParts[0];
  for (let i = 1; i < concatParts.length; i++) {
    concatExpr = sql`${concatExpr} || ' ' || ${concatParts[i]}`;
  }
  return sql`contains(${concatExpr}, dt_search)`;
}

const SEARCH_RANK_SENTINEL = sql`9000000000000000000`;

function buildBestRankExpr(rankExprs: Sql[]) {
  if (rankExprs.length === 0) {
    return undefined;
  }
  if (rankExprs.length === 1) {
    return rankExprs[0];
  }
  const best = sql.least(
    ...rankExprs.map((rankExpr) =>
      sql`coalesce(${rankExpr}, ${SEARCH_RANK_SENTINEL})`
    ),
  );
  return sql`nullif(${best}, ${SEARCH_RANK_SENTINEL})`;
}

function rankedSearchUsesOnlyDataTableColumns(
  searchConfig: RankedSearchTable,
  columns: InternalColumn[],
): boolean {
  if (
    searchConfig.disabled || searchConfig.filterExpr ||
    searchConfig.relatedTables
  ) {
    return false;
  }
  const searchFields: (string | Sql)[] = [];
  for (const field of searchConfig.fields ?? []) {
    searchFields.push(field.field);
  }
  for (const group of searchConfig.fieldGroups ?? []) {
    searchFields.push(...group.fields);
  }
  const columnByField = new Map(
    columns.flatMap((col) => col.field ? [[col.field, col]] : []),
  );
  return searchFields.length > 0 &&
    searchFields.every((field) => {
      if (typeof field !== "string") {
        return false;
      }
      const col = columnByField.get(field);
      return col ? isStringLikeType(getFieldTypeFromColumn(col)) : false;
    });
}

function buildRankedSearchExpr(
  searchConfig: RankedSearchTable,
  tableAlias: string,
): Sql | undefined {
  const targets = buildRankedSearchTargets(searchConfig, tableAlias);
  const rankExprs = targets.map((target) => {
    const matchesTarget = sql`fuzzy_match(dt_search, ${target.expr}, null)`;
    const rankForTarget =
      sql`fuzzy_rank_key(dt_search, ${target.expr}, null, ${target.priority})`;
    return sql`case when ${matchesTarget} then ${rankForTarget} else null end`;
  });
  return buildBestRankExpr(rankExprs);
}

function buildDataTableSearchCondition(
  columns: InternalColumn[],
  fields: string[] | undefined,
  searchRankExpr: Sql | undefined,
): Sql | undefined {
  const containsSearchCond = buildSearchCondition(columns, fields);
  if (!searchRankExpr) {
    return containsSearchCond;
  }
  const rankedSearchCond = sql`${searchRankExpr} is not null`;
  return containsSearchCond
    ? sql`(${rankedSearchCond} or ${containsSearchCond})`
    : rankedSearchCond;
}

/** Build the combined filter WHERE condition for use inside branching. */
function buildFilterCondition(columns: InternalColumn[]): Sql | undefined {
  const filterableCols = columns.filter((col) => col.filterable && col.field);
  if (filterableCols.length === 0) return undefined;
  const conditions = filterableCols.map((col) => generateFilterCondition(col));
  return conditions.reduce(
    (acc: Sql | null, cond) => acc ? sql`${acc} and ${cond}` : cond,
    null as Sql | null,
  ) as Sql;
}

function buildActiveFilterCountExpression(columns: InternalColumn[]): Sql {
  let countExpr: Sql = sql`0`;
  for (const col of columns) {
    countExpr = sql`${countExpr} + case when nullif(dt_filter_${
      sql.ref(col.field!)
    }, '') is null then 0 else 1 end`;
  }
  return countExpr;
}

function buildSearchSortClause(searchRankExpr?: Sql): Sql | undefined {
  return searchRankExpr
    ? sql`case when dt_search = '' then null when ${searchRankExpr} is null then ${SEARCH_RANK_SENTINEL} else ${searchRankExpr} end asc`
    : undefined;
}

function buildDataTableOrderClause(
  sortClause: Sql | undefined,
  searchRankExpr?: Sql,
): Sql | undefined {
  const searchSortClause = sortClause
    ? buildSearchSortClause(searchRankExpr)
    : undefined;
  return searchSortClause && sortClause
    ? sql`${searchSortClause}, ${sortClause}`
    : sortClause;
}

function buildDownloadSortedQuery(
  baseQuery: Sql,
  sortClause: Sql | undefined,
  searchRankExpr?: Sql,
): Sql {
  if (!sortClause) return baseQuery;
  const orderClause = buildDataTableOrderClause(sortClause, searchRankExpr);
  return sql`select * from (${baseQuery}) as dt_sorted order by ${orderClause}`;
}

function buildSortClause(columns: InternalColumn[]): Sql | undefined {
  const sortableCols = columns.filter((col) => col.sortable && col.field);
  if (sortableCols.length === 0) return undefined;
  return sortableCols.map((col) =>
    sql`
      case when dt_sort_col = ${sql.lit(col.field!)} and dt_sort_dir = 'asc'
        then ${sql.ref(col.field!)} end asc,
      case when dt_sort_col = ${sql.lit(col.field!)} and dt_sort_dir = 'desc'
        then ${sql.ref(col.field!)} end desc
    `
  ).reduce(
    (acc: Sql | null, c) => acc ? sql`${acc}, ${c}` : c,
    null as Sql | null,
  ) as Sql;
}

// ---------------------------------------------------------------------------
// Inline cell editors
// ---------------------------------------------------------------------------

/**
 * Builds the edit commit procedure for a cell.
 * Validates, updates local state optimistically, runs server transaction,
 * reverts on error, increments refresh key on success.
 */
function buildEditCommit(
  s: DomStatements,
  opts: {
    recordName: string;
    field: string;
    editing: EditingMeta;
    dbValue: Sql;
    prevValueExpr: Sql;
    newLocalValue?: Sql;
  },
) {
  const { recordName, field, editing, dbValue, prevValueExpr, newLocalValue } =
    opts;
  const pkValue = sql`${sql.ref(recordName)}.${
    sql.ref(editing.pkResultColumn)
  }`;
  const dbTable = system.db.tables[editing.sourceTable];

  // Save previous value for rollback
  s.defScalar("dt_prev_value", prevValueExpr);
  // Optimistically update local table
  if (newLocalValue) {
    s.modify(
      sql`update ${sql.ref(recordName)} set ${
        sql.ref(field)
      } = ${newLocalValue}`,
    );
  }
  // Stop editing
  s.setScalar("dt_is_editing", false);
  s.setScalar("dt_display_error", sql.null);
  s.commitUiTreeChanges();
  s.try({
    body: (s) => {
      s.server((s) => {
        s.startTransaction();
        if (editing.beforeEdit) {
          s.statements(editing.beforeEdit(dbValue, pkValue));
        }
        s.modify(
          sql`update db.${sql.ref(editing.sourceTable)} set ${
            sql.ref(editing.sourceField)
          } = ${dbValue} where ${dbTable.primaryKeyIdent} = ${pkValue}`,
        );
        if (editing.afterEdit) {
          s.statements(editing.afterEdit(dbValue, pkValue));
        }
        s.commitTransaction();
        s.refetch();
      });
    },
    errorName: "dt_edit_err",
    catch: (s) => {
      // Revert optimistic update
      if (newLocalValue) {
        s.modify(
          sql`update ${sql.ref(recordName)} set ${
            sql.ref(field)
          } = dt_prev_value`,
        );
      }
      s.setScalar("dt_display_error", sql.lit`Error saving edit`);
      s.startTaskWithOpts({
        detached: true,
        procedure: (s) => {
          s.sleep(4000);
          s.setScalar("dt_display_error", sql.null);
          s.commitUiTreeChanges();
        },
      });
    },
  });
}

/**
 * Standard keyboard + blur handlers for text-style editors.
 * Enter/blur = commit, Escape = cancel, Tab = commit.
 */
function editFieldHandlers(
  col: InternalColumn,
  recordName: string,
  validUiValue: BooleanExpr,
  changedUiValue: BooleanExpr,
  dbValue: Sql,
  opts?: { newLocalValue?: Sql },
) {
  const editing = col.editing!;
  const field = col.field!;

  const doCommit = (s: DomStatements) => {
    s.unless(validUiValue, (s) => {
      s.setScalar("dt_display_error", sql.lit`Invalid value`);
      s.startTaskWithOpts({
        detached: true,
        procedure: (s) => {
          s.sleep(4000);
          s.setScalar("dt_display_error", sql.null);
          s.commitUiTreeChanges();
        },
      });
      s.return();
    });
    s.if(changedUiValue, (s) => {
      buildEditCommit(s, {
        recordName,
        field,
        editing,
        dbValue,
        prevValueExpr: sql`${sql.ref(recordName)}.${sql.ref(field)}`,
        newLocalValue: opts?.newLocalValue,
      });
    });
    s.unless(changedUiValue, (s) => {
      s.setScalar("dt_is_editing", false);
    });
  };

  return {
    onClick: (s: DomStatements) => s.event.stopPropagation(),
    onKeyDown: {
      detachedFromNode: true,
      procedure: (s: DomStatements) => {
        s.event.stopPropagation();
        s.if(sql`event.key = 'Enter'`, (s) => {
          doCommit(s);
        });
        s.if(sql`event.key = 'Escape'`, (s) => {
          s.setScalar("dt_is_editing", false);
        });
        s.if(sql`event.key = 'Tab'`, (s) => {
          s.event.preventDefault();
          doCommit(s);
        });
      },
    },
    onBlur: {
      detachedFromNode: true,
      procedure: (s: DomStatements) => {
        doCommit(s);
      },
    },
  };
}

function renderStringEditor(
  col: InternalColumn,
  recordName: string,
  editingExpr: Sql,
): Node {
  const editing = col.editing!;
  const field = col.field!;
  const value = sql`${sql.ref(recordName)}.${sql.ref(field)}`;
  const display = col.cell({ record: sql.ref(recordName) });
  const notNull = editing.dbField.notNull;

  return (
    <Show when={editingExpr} fallback={display}>
      <Data
        local
        noRefetch
        procedure={(s) =>
          s.defScalar("value", {
            expr: sql`coalesce(${value}, '')`,
            allowNoRead: true,
          })}
      >
        <input
          sx={{
            border: 0,
            outline: "none",
            background: "none",
            fontSize: "inherit",
            fontFamily: "inherit",
            width: "100%",
            color: "inherit",
          }}
          value={sql`value`}
          onInput={(s: DomStatements) =>
            s.setScalar("ui.value", sql`target_value`)}
          yolmFocusKey
          type="text"
          {...editFieldHandlers(
            col,
            recordName,
            notNull ? sql`value != ''` : sql`true`,
            sql`(${value} is null and ui.value != '') or (ui.value collate Binary) != (coalesce(${value}, '') collate Binary)`,
            sql`case when value = '' then null else value end`,
            {
              newLocalValue:
                sql`case when ui.value = '' then null else ui.value end`,
            },
          )}
        />
      </Data>
    </Show>
  );
}

function renderNumericEditor(
  col: InternalColumn,
  recordName: string,
  editingExpr: Sql,
): Node {
  const editing = col.editing!;
  const field = col.field!;
  const value = sql`${sql.ref(recordName)}.${sql.ref(field)}`;
  const display = col.cell({ record: sql.ref(recordName) });
  const castType = editing.dbField.castType ?? "decimal(18,6)";

  return (
    <Show when={editingExpr} fallback={display}>
      <Data
        local
        noRefetch
        procedure={(s) =>
          s.defScalar("value", {
            expr: sql`coalesce(cast(${value} as text), '')`,
            allowNoRead: true,
          })}
      >
        <input
          sx={{
            border: 0,
            outline: "none",
            background: "none",
            fontSize: "inherit",
            fontFamily: "inherit",
            width: "100%",
            color: "inherit",
          }}
          value={sql`value`}
          onInput={(s: DomStatements) =>
            s.setScalar("ui.value", sql`target_value`)}
          yolmFocusKey
          type="text"
          {...editFieldHandlers(
            col,
            recordName,
            sql`ui.value = '' or try_cast(ui.value as ${
              sql(castType)
            }) is not null`,
            sql`coalesce(cast(${value} as text), '') != ui.value`,
            sql`case when value = '' then null else cast(value as ${
              sql(castType)
            }) end`,
            {
              newLocalValue:
                sql`case when ui.value = '' then null else cast(ui.value as ${
                  sql(castType)
                }) end`,
            },
          )}
        />
      </Data>
    </Show>
  );
}

function renderBoolEditor(
  col: InternalColumn,
  recordName: string,
  controlSize: Size,
): Node {
  const editing = col.editing!;
  const field = col.field!;
  const value = sql`${sql.ref(recordName)}.${sql.ref(field)}`;
  const pkValue = sql`${sql.ref(recordName)}.${
    sql.ref(editing.pkResultColumn)
  }`;
  const dbTable = system.db.tables[editing.sourceTable];

  // Bool cells toggle immediately on click, no edit mode needed
  return (
    <Checkbox
      variant="outlined"
      size={controlSize}
      checked={value}
      tabIndex={-1}
      slotProps={{
        action: {
          onClick: (s: DomStatements) => {
            s.event.stopPropagation();
            const newVal = sql`not ${value}`;
            s.defScalar("dt_prev_value", value);
            s.defScalar("dt_new_value", newVal);
            s.modify(
              sql`update ${sql.ref(recordName)} set ${
                sql.ref(field)
              } = dt_new_value`,
            );
            s.commitUiTreeChanges();
            s.try({
              body: (s) => {
                s.server((s) => {
                  s.startTransaction();
                  if (editing.beforeEdit) {
                    s.statements(
                      editing.beforeEdit(sql`dt_new_value`, pkValue),
                    );
                  }
                  s.modify(
                    sql`update db.${sql.ref(editing.sourceTable)} set ${
                      sql.ref(editing.sourceField)
                    } = dt_new_value where ${dbTable.primaryKeyIdent} = ${pkValue}`,
                  );
                  if (editing.afterEdit) {
                    s.statements(editing.afterEdit(sql`dt_new_value`, pkValue));
                  }
                  s.commitTransaction();
                  s.refetch();
                });
              },
              errorName: "dt_edit_err",
              catch: (s) => {
                s.modify(
                  sql`update ${sql.ref(recordName)} set ${
                    sql.ref(field)
                  } = dt_prev_value`,
                );
                s.setScalar("dt_display_error", sql.lit`Error saving edit`);
                s.startTaskWithOpts({
                  detached: true,
                  procedure: (s) => {
                    s.sleep(4000);
                    s.setScalar("dt_display_error", sql.null);
                    s.commitUiTreeChanges();
                  },
                });
              },
            });
          },
        },
      }}
    />
  );
}

function renderDateEditor(
  col: InternalColumn,
  recordName: string,
  editingExpr: Sql,
): Node {
  const field = col.field!;
  const value = sql`${sql.ref(recordName)}.${sql.ref(field)}`;
  const display = col.cell({ record: sql.ref(recordName) });

  return (
    <Show when={editingExpr} fallback={display}>
      <Data
        local
        noRefetch
        procedure={(s) =>
          s.defScalar("value", {
            expr: sql`coalesce(cast(${value} as text), '')`,
            allowNoRead: true,
          })}
      >
        <input
          sx={{
            border: 0,
            outline: "none",
            background: "none",
            fontSize: "inherit",
            fontFamily: "inherit",
            width: "100%",
            color: "inherit",
          }}
          value={sql`value`}
          onInput={(s: DomStatements) =>
            s.setScalar("ui.value", sql`target_value`)}
          yolmFocusKey
          type="date"
          {...editFieldHandlers(
            col,
            recordName,
            sql`ui.value = '' or try_cast(ui.value as date) is not null`,
            sql`coalesce(cast(${value} as text), '') != ui.value`,
            sql`case when value = '' then null else cast(value as date) end`,
            {
              newLocalValue:
                sql`case when ui.value = '' then null else cast(ui.value as date) end`,
            },
          )}
        />
      </Data>
    </Show>
  );
}

function renderEnumEditor(
  col: InternalColumn,
  recordName: string,
  editingExpr: Sql,
): Node {
  const editing = col.editing!;
  const field = col.field!;
  const value = sql`${sql.ref(recordName)}.${sql.ref(field)}`;
  const display = col.cell({ record: sql.ref(recordName) });
  const dbField = editing.dbField;

  if (dbField.type !== "Enum") return display;
  const enumModel = system.enums[dbField.enum];
  if (!enumModel) return display;

  const options = Array.from(enumModel.valuesMap.values());
  const castType = `enums.${enumModel.name}`;

  const doCommit = (s: DomStatements) => {
    const newDbValue =
      sql`case when ui.value = '' then null else cast(ui.value as ${
        sql(castType)
      }) end`;
    const newLocalValue =
      sql`case when ui.value = '' then null else cast(ui.value as ${
        sql(castType)
      }) end`;
    s.if(sql`coalesce(cast(${value} as text), '') != ui.value`, (s) => {
      buildEditCommit(s, {
        recordName,
        field,
        editing,
        dbValue: newDbValue,
        prevValueExpr: sql`${sql.ref(recordName)}.${sql.ref(field)}`,
        newLocalValue,
      });
    });
    s.unless(sql`coalesce(cast(${value} as text), '') != ui.value`, (s) => {
      s.setScalar("dt_is_editing", false);
    });
  };

  return (
    <Show when={editingExpr} fallback={display}>
      <Data
        local
        noRefetch
        procedure={(s) =>
          s.defScalar("value", {
            expr: sql`coalesce(cast(${value} as text), '')`,
            allowNoRead: true,
          })}
      >
        <select
          sx={{
            border: 0,
            outline: "none",
            background: "none",
            fontSize: "inherit",
            fontFamily: "inherit",
            width: "100%",
            color: "inherit",
            cursor: "pointer",
          }}
          value={sql`value`}
          yolmFocusKey
          onClick={(s: DomStatements) => s.event.stopPropagation()}
          onInput={(s: DomStatements) => {
            s.setScalar("ui.value", sql`target_value`);
            doCommit(s);
          }}
          onKeyDown={{
            detachedFromNode: true,
            procedure: (s: DomStatements) => {
              s.event.stopPropagation();
              s.if(sql`event.key = 'Escape'`, (s) => {
                s.setScalar("dt_is_editing", false);
              });
            },
          }}
        >
          {!dbField.notNull && <option value="">—</option>}
          {options.map((v) => (
            <option value={v.name}>
              {v.displayName}
            </option>
          ))}
        </select>
      </Data>
    </Show>
  );
}

function renderForeignKeyEditor(
  col: InternalColumn,
  recordName: string,
  editingExpr: Sql,
  controlSize: Size,
): Node {
  const editing = col.editing!;
  const field = col.field!;
  const value = sql`${sql.ref(recordName)}.${sql.ref(field)}`;
  const display = col.cell({ record: sql.ref(recordName) });
  const dbField = editing.dbField;

  if (dbField.type !== "ForeignKey") return display;
  const fkTable = system.db.tables[dbField.table];
  if (!fkTable?.recordDisplayName) return display;

  const searchConfig = fkTable.getSearchConfig();
  if (!searchConfig) return display;

  const nameExpr = fkTable.recordDisplayName.expr(
    ...fkTable.recordDisplayName.fields.map(
      (f) => sql`${fkTable.ident}.${sql.ref(f)}`,
    ),
  );
  const selectColumns = [
    selectColumn(nameExpr, "label"),
    selectColumn(sql`rank() over () - 1`, "index"),
    selectColumn(sql`id`),
  ];
  const selectPart = sql`select ${selectColumns}`;
  const limit = 50;
  const emptyQuery =
    sql`${selectPart} from ${fkTable.identWithDb} order by id desc limit ${limit}`;

  const doCommit = (s: DomStatements, selectedId: Sql) => {
    s.if(
      sql`${value} is null or ${selectedId} != ${value}`,
      (s) => {
        buildEditCommit(s, {
          recordName,
          field,
          editing,
          dbValue: selectedId,
          prevValueExpr: sql`${sql.ref(recordName)}.${sql.ref(field)}`,
          newLocalValue: selectedId,
        });
      },
      (s) => {
        s.setScalar("dt_is_editing", false);
      },
    );
  };

  const doClear = (s: DomStatements) => {
    if (dbField.notNull) {
      s.setScalar("dt_is_editing", false);
      return;
    }
    s.if(sql.isNotNull(value), (s) => {
      buildEditCommit(s, {
        recordName,
        field,
        editing,
        dbValue: sql.null,
        prevValueExpr: sql`${sql.ref(recordName)}.${sql.ref(field)}`,
        newLocalValue: sql.null,
      });
    });
    s.if(sql.isNull(value), (s) => {
      s.setScalar("dt_is_editing", false);
    });
  };

  return (
    <Show when={editingExpr} fallback={display}>
      <Data
        noRefetch
        pendingFallback={null}
        errorFallback={null}
        procedure={(s) => {
          s.defScalar(
            "initial_text",
            sql`coalesce((select ${nameExpr} from ${fkTable.identWithDb} where id = ${value}), '')`,
          );
        }}
      >
        <QueryCombobox
          size={controlSize}
          resultTableInferQuery={emptyQuery}
          initialInputText={sql`initial_text`}
          populateResultTable={(s, query, resultTable) => {
            s.conditional({
              condition: sql`trim(${query}) = ''`,
              then: (s) => {
                s.modify(sql.insertQuery(resultTable, emptyQuery));
              },
              else: (s) => {
                const searchExpr = buildSearchExpression(
                  searchConfig,
                  fkTable.name,
                );
                const whereClause = searchConfig.filterExpr
                  ? sql`${searchConfig.filterExpr} and fuzzy_match(${query}, ${searchExpr})`
                  : sql`fuzzy_match(${query}, ${searchExpr})`;
                s.modify(
                  sql`insert into ${resultTable}
                    ${selectPart}
                    from ${fkTable.identWithDb}
                    where ${whereClause}
                    order by fuzzy_rank_key(${query}, ${searchExpr}), ${fkTable.primaryKeyIdent}
                    limit ${limit}`,
                );
              },
            });
          }}
          onSelect={(s, result) => {
            doCommit(s, sql`${result}.id`);
          }}
          onClear={(s) => {
            doClear(s);
          }}
          onBlur={(s) => {
            s.setScalar("dt_is_editing", false);
          }}
        />
      </Data>
    </Show>
  );
}

function renderTimestampEditor(
  col: InternalColumn,
  recordName: string,
  editingExpr: Sql,
): Node {
  const field = col.field!;
  const fieldType = col.fieldType ?? "TimestampTz";
  const castTarget = fieldType === "TimestampNaive"
    ? "timestamp"
    : "timestamptz";
  const value = sql`${sql.ref(recordName)}.${sql.ref(field)}`;
  const display = col.cell({ record: sql.ref(recordName) });

  return (
    <Show when={editingExpr} fallback={display}>
      <Data
        local
        noRefetch
        procedure={(s) =>
          s.defScalar("value", {
            expr:
              sql`coalesce(format.date(${value}, 'YYYY-MM-DD''T''HH24:MI'), '')`,
            allowNoRead: true,
          })}
      >
        <input
          sx={{
            border: 0,
            outline: "none",
            background: "none",
            fontSize: "inherit",
            fontFamily: "inherit",
            width: "100%",
            color: "inherit",
          }}
          value={sql`value`}
          onInput={(s: DomStatements) =>
            s.setScalar("ui.value", sql`target_value`)}
          yolmFocusKey
          type="datetime-local"
          {...editFieldHandlers(
            col,
            recordName,
            sql`ui.value = '' or try_cast(ui.value as ${
              sql(castTarget)
            }) is not null`,
            sql`coalesce(format.date(${value}, 'YYYY-MM-DD''T''HH24:MI'), '') != ui.value`,
            sql`case when value = '' then null else cast(value as ${
              sql(castTarget)
            }) end`,
            {
              newLocalValue:
                sql`case when ui.value = '' then null else cast(ui.value as ${
                  sql(castTarget)
                }) end`,
            },
          )}
        />
      </Data>
    </Show>
  );
}

/**
 * Dispatches to the appropriate editor based on field type.
 */
function renderEditableCell(
  col: InternalColumn,
  editing: EditingMeta,
  colIndex: number,
  recordName: string,
  controlSize: Size,
): Node {
  const editingExpr =
    sql`dt_is_editing and dt_editing_col = ${colIndex} and dt_editing_row = ${
      sql.ref(recordName)
    }.iteration_index`;
  const fieldType = editing.dbField.type;

  switch (fieldType) {
    case "Bool":
      return renderBoolEditor(col, recordName, controlSize);
    case "Date":
      return renderDateEditor(col, recordName, editingExpr);
    case "Enum":
      return renderEnumEditor(col, recordName, editingExpr);
    case "ForeignKey":
      return renderForeignKeyEditor(col, recordName, editingExpr, controlSize);
    case "TimestampTz":
    case "TimestampNaive":
    case "TimestampUtc":
      return renderTimestampEditor(col, recordName, editingExpr);
    case "TinyInt":
    case "SmallInt":
    case "Int":
    case "BigInt":
    case "TinyUint":
    case "SmallUint":
    case "Uint":
    case "BigUint":
    case "Decimal":
    case "Double":
    case "Real":
      return renderNumericEditor(col, recordName, editingExpr);
    case "String":
    case "Bytes":
    case "Ordering":
    case "Time":
    case "Uuid":
    case "Json":
    case "PhoneNumber":
    case "Tx":
      return renderStringEditor(col, recordName, editingExpr);
  }
}

// ---------------------------------------------------------------------------
// DataTable component
// ---------------------------------------------------------------------------

/**
 * A data-driven table component that provides automatic column inference,
 * pagination, searching, sorting, filtering, row selection, inline editing,
 * row actions, and CSV download — all in one component.
 *
 * Internally uses two nested `Data` nodes: an outer local node for interactive
 * state (page, search, sort, filters, selection) and an inner node for server
 * query execution.
 *
 * @example
 * Basic usage with auto-inferred columns:
 * ```tsx
 * <DataTable query={sql`select * from db.users`} />
 * ```
 *
 * @example
 * Custom columns with pagination and search:
 * ```tsx
 * <DataTable
 *   query={sql`select * from db.orders`}
 *   primaryTable="orders"
 *   pageSize={25}
 *   searchable
 *   sortable
 *   columns={(b) => {
 *     b.field("order_number", "Order #");
 *     b.usdColumn("total", "Amount");
 *     b.enumColumn("status", "order_status");
 *     b.dateColumn("created_at", "%b %d, %Y", "Date");
 *   }}
 * />
 * ```
 *
 * @example
 * Editable table with row actions:
 * ```tsx
 * <DataTable
 *   query={sql`select * from db.products`}
 *   primaryTable="products"
 *   editable
 *   actions={(b) => {
 *     b.edit();
 *     b.delete();
 *   }}
 * />
 * ```
 */
export function DataTable(props: DataTableProps) {
  const {
    query,
    primaryTable: primaryTableName,
    where,
    watch,
    columns: columnsFn,
    showIdColumn = false,
    pageSize,
    defaultPagedQuery,
    defaultCountQuery,
    searchable = false,
    filterable = false,
    filterVariant = "inline",
    sortable = false,
    defaultSort,
    selectable = false,
    selectAllFilteredResults = false,
    download,
    editable = false,
    onRowClick,
    recordName: userRecordName,
    actions: actionsFn,
    bulkActions,
    variant = "default",
    size = "md",
    className,
    tableProps = {},
    header,
    footer,
    emptyState,
    loadingState,
    scrollable = false,
    selectionTable: selectionTableProp,
    toolbar,
    analysisScalars,
    minColumnWidth,
    defaultFilters,
  } = props;
  const controlSize: Size = size === "xs" ? "xs" : "sm";

  // Analyze query once, share result across column inference and editing
  const analysisResult = analyzeQueryWithContext(query, analysisScalars);
  let analysisColumns: QueryColumnInfo[];
  if (analysisResult.status === "error") {
    // For read-only tables with explicit columns, analysis isn't required —
    // allow graceful fallback so DataTable can query procedure temp tables
    if (editable || !columnsFn) {
      throw new Error(
        `DataTable: failed to analyze query: ${analysisResult.message}`,
      );
    }
    analysisColumns = [];
  } else {
    analysisColumns = analysisResult.columns;
  }

  // Resolve primary table (auto-infer if not provided)
  let primaryTable: DbTable | undefined;
  if (primaryTableName) {
    primaryTable = system.db.tables[primaryTableName];
    if (!primaryTable) {
      throw new Error(`DataTable: table '${primaryTableName}' not found`);
    }
  } else {
    const inferred = inferPrimaryTable(analysisColumns);
    if (inferred) {
      primaryTable = system.db.tables[inferred];
    }
  }

  // Resolve record name — only derive from explicitly provided primaryTable
  // to avoid collisions with db table names when auto-inferred
  const recordName = userRecordName ??
    (primaryTableName && primaryTable
      ? singularize(primaryTable.name)
      : "record");

  // Resolve selection table name
  const selTableName = selectionTableProp ?? "dt_selected";

  // Build columns
  let resolvedColumns: InternalColumn[];
  if (columnsFn) {
    const builder = new ColumnsBuilder(primaryTable);
    columnsFn(builder);
    resolvedColumns = builder.getColumns();
    applyAnalysisColumnTypes(resolvedColumns, analysisColumns);
  } else {
    resolvedColumns = buildAutoColumns(
      analysisColumns,
      primaryTable,
      showIdColumn,
    );
  }

  // Resolve editing metadata when editable (reuse analysis)
  if (editable) {
    resolveEditingMetadata(analysisColumns, resolvedColumns);
  }
  const hasEditableCols = editable &&
    resolvedColumns.some((c) => c.editable && c.editing);

  // Build actions
  let resolvedActions: ActionItem[] | undefined;
  if (actionsFn) {
    const actionsBuilder = new ActionsBuilder();
    actionsFn(actionsBuilder);
    resolvedActions = actionsBuilder.getActions();
  }
  const hasActions = resolvedActions && resolvedActions.length > 0;

  // Resolve search
  const enableSearch = !!searchable;
  const searchFields = Array.isArray(searchable) ? searchable : undefined;
  const searchConfig = enableSearch && !searchFields
    ? primaryTable?.getSearchConfig()
    : undefined;
  const usesRankedSearch = searchConfig &&
      rankedSearchUsesOnlyDataTableColumns(
        searchConfig,
        resolvedColumns,
      )
    ? true
    : false;
  const searchRankExpr = searchConfig && usesRankedSearch
    ? buildRankedSearchExpr(searchConfig, "dt")
    : undefined;
  const searchSortRankExpr = searchConfig && usesRankedSearch
    ? buildRankedSearchExpr(searchConfig, "dt_sorted")
    : undefined;
  const searchPlaceholder =
    typeof searchable === "object" && !Array.isArray(searchable)
      ? searchable.placeholder ?? "Search..."
      : "Search...";

  // Resolve download
  const enableDownload = !!download;
  const downloadFileName = typeof download === "string"
    ? download
    : typeof download === "object"
    ? download.fileName
    : "export.csv";
  const downloadLabel = typeof download === "object"
    ? download.label
    : undefined;

  // Determine filter/sort capabilities
  const enableFiltering = filterable;
  const enableSorting = sortable;
  const filterableCols = resolvedColumns.filter(
    (c) => c.filterable && c.field,
  );
  const hasFilterControls = enableFiltering && filterableCols.length > 0;
  const filterControlsInPanel = hasFilterControls &&
    filterVariant === "panel";
  const activeFilterCount = buildActiveFilterCountExpression(filterableCols);

  // Determine if we need an outer Data for interactive state
  const needsOuterState = pageSize || enableSearch || enableSorting ||
    enableFiltering || selectable || hasEditableCols || minColumnWidth ||
    enableDownload || toolbar;

  // Build the base query with optional where clause
  let baseQuery = query;
  if (where) {
    baseQuery = sql`select * from (${query}) as dt_base where ${where}`;
  }

  // Resolve empty state
  const resolvedEmptyState: Node | undefined = typeof emptyState === "string"
    ? (
      <tr>
        <td
          colSpan={resolvedColumns.length + (selectable ? 1 : 0) +
            (hasActions ? 1 : 0)}
          sx={{ textAlign: "center", py: 4 }}
        >
          <span className="text-tertiary">{emptyState}</span>
        </td>
      </tr>
    )
    : emptyState
    ? (
      <tr>
        <td
          colSpan={resolvedColumns.length + (selectable ? 1 : 0) +
            (hasActions ? 1 : 0)}
        >
          {emptyState}
        </td>
      </tr>
    )
    : undefined;

  // Container styling
  const containerClass = [
    className,
    variant === "outlined" ? "border border-divider rounded-md" : undefined,
    scrollable ? "flex flex-col" : undefined,
  ].filter(Boolean).join(" ") || undefined;

  // Build the inner query layers
  // The actual query wrapping happens inside the inner Data procedure
  // because it depends on outer state scalars

  const userWatch = (watch ? (Array.isArray(watch) ? watch : [watch]) : [])
    .slice();
  // temp hack, seems like autoWatch doesn't cover yet
  if (pageSize) {
    userWatch.push(sql`dt_page`);
  }

  // Render the component tree
  return (
    <div className={containerClass}>
      {header}
      {renderBody()}
      {footer}
    </div>
  );

  function renderBody() {
    if (!needsOuterState) {
      return renderInnerData(baseQuery, userWatch);
    }

    // Outer Data: local, noRefetch - owns interactive state
    return (
      <Data
        local
        noRefetch
        procedure={(s) => {
          if (pageSize) {
            s.defScalar("dt_page", sql`1`);
          }
          if (enableSearch) {
            s.defScalar("dt_search", sql.lit``);
          }
          if (enableSorting) {
            s.defScalar(
              "dt_sort_col",
              defaultSort ? sql.lit(defaultSort.column) : sql.lit``,
            );
            s.defScalar(
              "dt_sort_dir",
              defaultSort
                ? sql.lit(defaultSort.direction ?? "asc")
                : sql.lit`asc`,
            );
          }
          if (enableFiltering) {
            for (const col of filterableCols) {
              s.defScalar(
                `dt_filter_${col.field}`,
                defaultFilters?.[col.field!] ?? sql.lit``,
              );
              const fieldType = requireFilterFieldType(col);
              s.defScalar(
                `dt_filter_op_${col.field}`,
                getDefaultOperator(fieldType),
              );
              if (isDateType(fieldType)) {
                s.defScalar(`dt_filter_${col.field}_end`, sql.lit``);
              }
            }
            if (filterControlsInPanel) {
              s.defScalar("dt_filters_open", false);
            }
          }
          if (selectable && !selectionTableProp) {
            s.defTable(
              "dt_selected",
              sql`select null::bigint as id where false`,
            );
          }
          if (minColumnWidth) {
            s.defTable("dt_col_widths", {
              fields: [
                { name: "col", type: "SmallUint", notNull: true },
                { name: "width", type: "SmallUint", notNull: true },
              ],
            });
            const rows = resolvedColumns.map((col, i) =>
              valuesRow(
                i,
                col.width
                  ? (typeof col.width === "number" ? col.width : minColumnWidth)
                  : minColumnWidth,
              )
            );
            s.modify(
              sql`insert into dt_col_widths (col, width) values ${rows}`,
            );
            s.defScalar("dt_resizing_col", sql`-1`);
            s.defScalar("dt_resize_start_x", sql`0`);
            s.defScalar("dt_resize_start_width", sql`0`);
          }
          if (hasEditableCols) {
            s.defScalar("dt_editing_row", sql`-1`);
            s.defScalar("dt_editing_col", sql`-1`);
            s.defScalar("dt_is_editing", false);
            s.defScalar("dt_display_error", {
              type: { type: "String", maxLength: 2000 },
            });
          }
        }}
      >
        {(enableSearch || enableDownload || toolbar || filterControlsInPanel) &&
          (
            <div
              className="flex items-center gap-2 p-2"
              sx={variant === "outlined"
                ? { borderBottom: "1px solid", borderColor: "divider" }
                : {}}
            >
              {enableSearch && (
                <Input
                  size={controlSize}
                  placeholder={searchPlaceholder}
                  value={sql`dt_search`}
                  onInput={(s: DomStatements) => {
                    s.setScalar("dt_search", sql`target_value`);
                    if (pageSize) {
                      s.setScalar("dt_page", sql`1`);
                    }
                  }}
                  startDecorator={<MaterialIcon icon="Search" />}
                  sx={{ flex: 1, maxWidth: 300 }}
                />
              )}
              <div sx={{ flex: 1 }} />
              {toolbar}
              {filterControlsInPanel && (
                <Button
                  size={controlSize}
                  variant="outlined"
                  color="neutral"
                  startIcon="FilterList"
                  onClick={(s: DomStatements) => {
                    s.setScalar("dt_filters_open", sql`not dt_filters_open`);
                  }}
                >
                  <Show
                    when={sql`${activeFilterCount} > 0`}
                    fallback="Filters"
                  >
                    {sql`'Filters (' || ${activeFilterCount} || ')'`}
                  </Show>
                </Button>
              )}
              {enableDownload && (
                <DownloadButton
                  query={buildDownloadQuery()}
                  fileName={downloadFileName}
                  size={controlSize}
                >
                  {downloadLabel ?? "Download"}
                </DownloadButton>
              )}
            </div>
          )}
        {hasEditableCols && (
          <Show when={sql`dt_display_error is not null`}>
            <Snackbar
              size={controlSize}
              color="danger"
              variant="soft"
              startIcon="Error"
              anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            >
              {sql`dt_display_error`}
            </Snackbar>
          </Show>
        )}
        {selectable && bulkActions && (
          <Show
            when={sql`(select count(*) from ${sql.ref(selTableName)}) > 0`}
          >
            <div className="flex items-center justify-end gap-2 px-2 py-1 bg-primary-soft">
              <span className="text-sm text-primary-soft">
                {sql`(select count(*) from ${
                  sql.ref(selTableName)
                }) || ' selected'`}
              </span>
              {bulkActions(selTableName)}
            </div>
          </Show>
        )}
        {renderInnerDataWithState()}
        {minColumnWidth && (
          <EventHandlers
            document={{
              mouseMove: (s: DomStatements) => {
                s.if(sql`dt_resizing_col >= 0`, (s) => {
                  s.event.preventDefault();
                  s.defScalar(
                    "dt_new_width",
                    sql`greatest(${minColumnWidth}, dt_resize_start_width + cast(event.client_x - dt_resize_start_x as int))`,
                  );
                  s.modify(
                    sql`update dt_col_widths set width = dt_new_width where col = dt_resizing_col`,
                  );
                });
              },
              mouseUp: (s: DomStatements) => {
                s.if(sql`dt_resizing_col >= 0`, (s) => {
                  s.setScalar("dt_resizing_col", sql`-1`);
                });
              },
            }}
          />
        )}
      </Data>
    );
  }

  function buildDownloadQuery(): Sql {
    let q = baseQuery;
    // Apply search
    const searchCond = enableSearch
      ? buildDataTableSearchCondition(
        resolvedColumns,
        searchFields,
        searchRankExpr,
      )
      : undefined;
    const filterCond = enableFiltering
      ? buildFilterCondition(resolvedColumns)
      : undefined;
    if (searchCond || filterCond) {
      const conditions: Sql[] = [];
      if (searchCond) {
        conditions.push(sql`(dt_search = '' or ${searchCond})`);
      }
      if (filterCond) conditions.push(filterCond);
      const whereCond = conditions.reduce(
        (acc: Sql | null, c) => acc ? sql`${acc} and ${c}` : c,
        null as Sql | null,
      ) as Sql;
      q = sql`select * from (${q}) as dt where ${whereCond}`;
    }
    const sortClause = enableSorting
      ? buildSortClause(resolvedColumns)
      : undefined;
    if (sortClause) {
      q = buildDownloadSortedQuery(q, sortClause, searchSortRankExpr);
    }
    return q;
  }

  function renderInnerDataWithState(): Node {
    const searchCond = enableSearch
      ? buildDataTableSearchCondition(
        resolvedColumns,
        searchFields,
        searchRankExpr,
      )
      : undefined;
    const filterCond = enableFiltering
      ? buildFilterCondition(resolvedColumns)
      : undefined;
    const sortClause = enableSorting
      ? buildSortClause(resolvedColumns)
      : undefined;

    function paginateQuery(q: Sql): Sql {
      if (pageSize) {
        return sql`${q} limit ${pageSize} offset ((dt_page - 1) * ${pageSize})`;
      }
      return q;
    }

    function buildWhereClause(): Sql | undefined {
      const conditions: Sql[] = [];
      if (searchCond) {
        conditions.push(sql`(dt_search = '' or ${searchCond})`);
      }
      if (filterCond) {
        conditions.push(filterCond);
      }
      if (conditions.length === 0) return undefined;
      return conditions.reduce(
        (acc: Sql | null, c) => acc ? sql`${acc} and ${c}` : c,
        null as Sql | null,
      ) as Sql;
    }

    function buildFilteredQuery(): Sql {
      const whereClause = buildWhereClause();
      if (whereClause) {
        return sql`select * from (${baseQuery}) as dt where ${whereClause}`;
      }
      return baseQuery;
    }

    function buildDataQuery(): Sql {
      const filteredQuery = buildFilteredQuery();
      const orderClause = buildDataTableOrderClause(
        sortClause,
        searchSortRankExpr,
      );
      if (orderClause) {
        return sql`select * from (${filteredQuery}) as dt_sorted order by ${orderClause}`;
      }
      return filteredQuery;
    }

    function buildDefaultStateCondition(): Sql | undefined {
      const conditions: Sql[] = [];
      if (enableSearch) {
        conditions.push(sql`dt_search = ''`);
      }
      if (enableSorting) {
        conditions.push(
          defaultPagedQuery && defaultSort
            ? sql`dt_sort_col = ${
              sql.lit(defaultSort.column)
            } and dt_sort_dir = ${sql.lit(defaultSort.direction ?? "asc")}`
            : sql`dt_sort_col = ''`,
        );
      }
      if (enableFiltering) {
        conditions.push(sql`${activeFilterCount} = 0`);
      }
      if (conditions.length === 0) return undefined;
      return conditions.reduce(
        (acc: Sql | null, c) => acc ? sql`${acc} and ${c}` : c,
        null as Sql | null,
      ) as Sql;
    }

    function buildDefaultPagedQuery(): Sql | undefined {
      if (!pageSize) return undefined;
      if (defaultPagedQuery) return defaultPagedQuery;
      if (defaultSort) return undefined;
      if (searchSortRankExpr) {
        return undefined;
      }
      // Only used when the default-state condition holds (or when no
      // search/sort/filter is enabled at all), where the search and filter
      // clauses are tautologies: dropping them keeps the selected rows
      // identical while letting the paged query keep its top-k plan. The
      // ui-scalar search clause otherwise forces the full relation through
      // every column's match expression before the limit.
      return paginateQuery(baseQuery);
    }

    return (
      <Data
        procedure={(s) => {
          s.defTable("dt_data", { inferQuery: baseQuery });
          if (pageSize) {
            s.defScalar("dt_total", { type: "BigInt" });
          }
          const filteredQuery = buildFilteredQuery();
          if (selectable && selectAllFilteredResults) {
            s.defTable(
              "dt_filtered_ids",
              sql`select distinct id from (${filteredQuery}) dt_filtered`,
            );
          }
          const defaultStateCondition = buildDefaultStateCondition();
          const optimizedDefaultQuery = buildDefaultPagedQuery();
          if (optimizedDefaultQuery && defaultStateCondition) {
            s.if(defaultStateCondition, (s) => {
              s.modify(sql`insert into dt_data ${optimizedDefaultQuery}`);
            }).else((s) => {
              s.modify(
                sql`insert into dt_data ${paginateQuery(buildDataQuery())}`,
              );
            });
          } else if (optimizedDefaultQuery) {
            s.modify(sql`insert into dt_data ${optimizedDefaultQuery}`);
          } else {
            s.modify(
              sql`insert into dt_data ${paginateQuery(buildDataQuery())}`,
            );
          }
          if (pageSize) {
            const filteredCount =
              sql`(select count(*) from (${filteredQuery}) as dt_c)`;
            const defaultCount = defaultCountQuery
              ? sql`(${defaultCountQuery})`
              : sql`(select count(*) from (${baseQuery}) as dt_c)`;
            if (defaultStateCondition) {
              // Same tautology argument as buildDefaultPagedQuery: with no
              // active search or filters the filtered count equals the base
              // count, without dragging the full relation through the
              // ui-scalar search clause.
              s.if(defaultStateCondition, (s) => {
                s.setScalar("dt_total", defaultCount);
              }).else((s) => {
                s.setScalar("dt_total", filteredCount);
              });
            } else {
              s.setScalar("dt_total", defaultCount);
            }
          }
        }}
        watch={userWatch.length > 0 ? userWatch : undefined}
        statusScalar="dt_status"
        hasDataScalar="dt_has_data"
      >
        {renderTableContent()}
      </Data>
    );
  }

  function renderInnerData(q: Sql, watchExprs: AnyExpr[]): Node {
    return (
      <Data
        procedure={(s) => {
          s.defTable("dt_data", q);
        }}
        watch={watchExprs.length > 0 ? watchExprs : undefined}
        statusScalar="dt_status"
        hasDataScalar="dt_has_data"
      >
        {renderTableContent()}
      </Data>
    );
  }

  function clearFilterControls(s: DomStatements) {
    for (const col of filterableCols) {
      s.setScalar(`dt_filter_${col.field}`, sql.lit``);
      if (isDateType(requireFilterFieldType(col))) {
        s.setScalar(`dt_filter_${col.field}_end`, sql.lit``);
      }
    }
    if (pageSize) {
      s.setScalar("dt_page", sql`1`);
    }
  }

  function renderFilterControlsGrid(): Node {
    return (
      <div
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(220px, 1fr))`,
          gap: 1.25,
        }}
      >
        {filterableCols.map((col) => (
          <div>
            <span className="text-xs text-tertiary mb-1 block">
              {col.header}
            </span>
            {renderFilterControl(col, controlSize)}
          </div>
        ))}
      </div>
    );
  }

  function renderFilterControlsInline(): Node {
    return (
      <div
        className="p-2"
        sx={variant === "outlined"
          ? { borderBottom: "1px solid", borderColor: "divider" }
          : {}}
      >
        {renderFilterControlsGrid()}
      </div>
    );
  }

  function renderFilterControlsPanel(): Node {
    return (
      <div
        className="p-3"
        sx={variant === "outlined"
          ? { borderBottom: "1px solid", borderColor: "divider" }
          : {}}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-sm font-medium">Filters</span>
          <Button
            size={controlSize}
            variant="plain"
            color="neutral"
            disabled={sql`${activeFilterCount} = 0`}
            onClick={clearFilterControls}
          >
            Clear
          </Button>
        </div>
        {renderFilterControlsGrid()}
      </div>
    );
  }

  function renderTableContent(): Node {
    return (
      <Show
        when={sql`dt_status != 'failed'`}
        fallback={
          <Alert color="danger" startIcon="Error">
            Unable to load data
          </Alert>
        }
      >
        {hasFilterControls &&
          (filterControlsInPanel
            ? (
              <Show when={sql`dt_filters_open`}>
                {renderFilterControlsPanel()}
              </Show>
            )
            : renderFilterControlsInline())}
        {selectable && selectAllFilteredResults && (
          <div className="flex justify-end px-2 py-1">
            <Button
              size={controlSize}
              variant="plain"
              disabled={sql`not exists (select 1 from dt_filtered_ids)`}
              onClick={(s: DomStatements) => {
                s.modify(sql`insert into ${sql.ref(selTableName)} (id)
                  select filtered.id from dt_filtered_ids filtered
                  where not exists (select 1 from ${
                  sql.ref(selTableName)
                } selected
                    where selected.id = filtered.id)`);
              }}
            >
              Select all filtered results
            </Button>
          </div>
        )}
        {renderTableElement()}
        {pageSize && (
          <div
            className="flex items-center justify-between px-3 py-2"
            sx={variant === "outlined"
              ? { borderTop: "1px solid", borderColor: "divider" }
              : {}}
          >
            <span className="text-sm text-tertiary">
              {sql`'Page ' || dt_page || ' of ' || case when dt_total = 0 then 1 else ((dt_total - 1) / ${pageSize} + 1) end || ' (' || dt_total || ' records)'`}
            </span>
            <div className="flex gap-1">
              <IconButton
                size={controlSize}
                variant="outlined"
                color="neutral"
                icon="ChevronLeft"
                aria-label="Previous page"
                disabled={sql`dt_page <= 1`}
                onClick={(s: DomStatements) => {
                  s.if(sql`dt_page > 1`, (s) => {
                    s.setScalar("dt_page", sql`dt_page - 1`);
                  });
                }}
              />
              <IconButton
                size={controlSize}
                variant="outlined"
                color="neutral"
                icon="ChevronRight"
                aria-label="Next page"
                disabled={sql`dt_page >= case when dt_total = 0 then 1 else ((dt_total - 1) / ${pageSize} + 1) end`}
                onClick={(s: DomStatements) => {
                  s.if(
                    sql`dt_page < case when dt_total = 0 then 1 else ((dt_total - 1) / ${pageSize} + 1) end`,
                    (s) => {
                      s.setScalar("dt_page", sql`dt_page + 1`);
                    },
                  );
                }}
              />
            </div>
          </div>
        )}
      </Show>
    );
  }

  function renderTableElement(): Node {
    const resolvedLoadingState = loadingState ?? (
      <>
        {Array.from({ length: 3 }).map(() => (
          <tr>
            {selectable && (
              <td>
                <Skeleton
                  variant="rectangular"
                  sx={{ width: 20, height: 20 }}
                />
              </td>
            )}
            {resolvedColumns.map((col) => {
              const cell = (
                <td sx={col.width ? { width: col.width } : {}}>
                  <Skeleton variant="text" level="body-md" />
                </td>
              );
              return col.hidden
                ? <Show when={sql`not (${col.hidden})`}>{cell}</Show>
                : cell;
            })}
            {hasActions && (
              <td>
                <Skeleton
                  variant="rectangular"
                  sx={{ width: 24, height: 24 }}
                />
              </td>
            )}
          </tr>
        ))}
      </>
    );

    // Resolve Table component props
    const mergedTableProps = {
      size,
      borderAxis: variant === "plain" ? "none" as const : "xBetween" as const,
      hoverRow: !!onRowClick,
      ...tableProps,
      sx: [
        scrollable && {
          "--table-cell-head-background": "var(--palette-background-level1)",
        },
        minColumnWidth ? { tableLayout: "fixed" as const } : undefined,
        tableProps?.sx,
      ],
      ...(scrollable
        ? {
          stickyHeader: true,
        }
        : {}),
      ...(minColumnWidth
        ? {
          style: {
            minWidth: sql`(select sum(width)${selectable ? sql` + 40` : sql``}${
              hasActions ? sql` + 48` : sql``
            } || 'px' from dt_col_widths)`,
          },
        }
        : {}),
    };

    const tableNode = (
      <Table {...mergedTableProps}>
        <thead>
          <tr>
            {selectable && (
              <th sx={{ width: 40 }}>
                <Checkbox
                  variant="outlined"
                  size={controlSize}
                  checked={sql`exists (select 1 from dt_data)
                    and not exists (
                      select 1 from dt_data page_row
                      where not exists (
                        select 1 from ${sql.ref(selTableName)} selected
                        where selected.id = page_row.id
                      )
                    )`}
                  tabIndex={-1}
                  slotProps={{
                    action: {
                      onClick: (s: DomStatements) => {
                        s.if(
                          sql`exists (select 1 from dt_data)
                            and not exists (
                              select 1 from dt_data page_row
                              where not exists (
                                select 1 from ${sql.ref(selTableName)} selected
                                where selected.id = page_row.id
                              )
                            )`,
                          (s) => {
                            s.modify(
                              sql`delete from ${sql.ref(selTableName)}
                                where id in (select id from dt_data)`,
                            );
                          },
                          (s) => {
                            s.modify(
                              sql`insert into ${sql.ref(selTableName)} (id)
                                select page_row.id from dt_data page_row
                                where not exists (
                                  select 1 from ${
                                sql.ref(selTableName)
                              } selected
                                  where selected.id = page_row.id
                                )`,
                            );
                          },
                        );
                      },
                    },
                  }}
                />
              </th>
            )}
            {resolvedColumns.map((col, colIdx) => {
              const wrapHidden = (node: Node) =>
                col.hidden
                  ? <Show when={sql`not (${col.hidden})`}>{node}</Show>
                  : node;
              const canSort = enableSorting && col.sortable && col.field;
              const thStyle: Record<string, any> = {};
              if (!minColumnWidth) {
                if (col.width) thStyle.width = col.width;
                if (col.align) thStyle.textAlign = col.align;
              } else {
                if (col.align) thStyle.textAlign = col.align;
              }
              if (canSort) thStyle.cursor = "pointer";

              // When minColumnWidth is set, use runtime style for dynamic widths
              const dynamicStyle = minColumnWidth
                ? {
                  width:
                    sql`(select width || 'px' from dt_col_widths where col = ${colIdx})`,
                }
                : undefined;

              const resizeHandle = minColumnWidth
                ? (
                  <div
                    sx={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: 4,
                      cursor: "col-resize",
                      "&:hover": {
                        backgroundColor: "var(--palette-primary-300)",
                      },
                    }}
                    onMouseDown={(s: DomStatements) => {
                      s.event.preventDefault();
                      s.setScalar("dt_resizing_col", sql`${colIdx}`);
                      s.setScalar("dt_resize_start_x", sql`event.client_x`);
                      s.setScalar(
                        "dt_resize_start_width",
                        sql`(select width from dt_col_widths where col = ${colIdx})`,
                      );
                    }}
                  />
                )
                : undefined;

              const thSx = {
                ...thStyle,
                ...(minColumnWidth
                  ? { position: "relative", overflow: "hidden" }
                  : {}),
              };
              const thSxProp = Object.keys(thSx).length > 0 ? thSx : undefined;

              if (canSort) {
                return wrapHidden(
                  <th
                    sx={thSxProp}
                    style={dynamicStyle}
                    onClick={(s: DomStatements) => {
                      if (minColumnWidth) {
                        s.returnIf(sql`dt_resizing_col >= 0`);
                      }
                      s.if(
                        sql`dt_sort_col = ${sql.lit(col.field!)}`,
                        (s) => {
                          s.if(
                            sql`dt_sort_dir = 'asc'`,
                            (s) => {
                              s.setScalar("dt_sort_dir", sql.lit`desc`);
                            },
                            (s) => {
                              s.setScalar("dt_sort_col", sql.lit``);
                              s.setScalar("dt_sort_dir", sql.lit`asc`);
                            },
                          );
                        },
                        (s) => {
                          s.setScalar("dt_sort_col", sql.lit(col.field!));
                          s.setScalar("dt_sort_dir", sql.lit`asc`);
                        },
                      );
                      if (pageSize) {
                        s.setScalar("dt_page", sql`1`);
                      }
                    }}
                  >
                    <div
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      {col.header}
                      <Show
                        when={sql`dt_sort_col = ${
                          sql.lit(col.field!)
                        } and dt_sort_dir = 'asc'`}
                      >
                        <MaterialIcon
                          icon="ArrowUpward"
                          sx={{ fontSize: "1rem" }}
                        />
                      </Show>
                      <Show
                        when={sql`dt_sort_col = ${
                          sql.lit(col.field!)
                        } and dt_sort_dir = 'desc'`}
                      >
                        <MaterialIcon
                          icon="ArrowDownward"
                          sx={{ fontSize: "1rem" }}
                        />
                      </Show>
                    </div>
                    {resizeHandle}
                  </th>,
                );
              }

              return wrapHidden(
                <th sx={thSxProp} style={dynamicStyle}>
                  {col.header}
                  {resizeHandle}
                </th>,
              );
            })}
            {hasActions && <th sx={{ width: 48 }} />}
          </tr>
        </thead>
        <tbody>
          <Conditional
            when={sql`not dt_has_data and dt_status in ('requested', 'fallback_triggered')`}
            then={resolvedLoadingState}
            else={renderRows()}
          />
        </tbody>
      </Table>
    );
    if (scrollable) {
      return <div className="flex-1 min-h-0 overflow-auto">{tableNode}</div>;
    }
    if (minColumnWidth) {
      return <div className="overflow-x-auto">{tableNode}</div>;
    }
    return tableNode;
  }

  function renderRows(): Node {
    // Set up context for actions
    if (hasActions && primaryTable) {
      const parentTableCtx = useOptionalICtx(CurrentTableICtxKey);
      addCtx(new ExtendedCurrentTableContext(parentTableCtx, primaryTable));
    }

    const rowContent = (
      <Each table="dt_data" recordName={recordName}>
        {renderRow()}
      </Each>
    );

    if (resolvedEmptyState) {
      return (
        <>
          <Show when={sql`(select count(*) from dt_data) = 0`}>
            {resolvedEmptyState}
          </Show>
          <Show when={sql`(select count(*) from dt_data) > 0`}>
            {rowContent}
          </Show>
        </>
      );
    }

    return rowContent;
  }

  function renderRow(): Node {
    // Set up record context for actions
    if (hasActions && primaryTable) {
      const parentRecordCtx = useOptionalICtx(CurrentRecordICtxKey);
      addCtx(
        new ExtendedCurrentRecordContext(
          parentRecordCtx,
          sql`${sql.ref(recordName)}.id`,
        ),
      );
    }

    const trProps: Record<string, any> = {};
    if (onRowClick) {
      trProps.onClick = onRowClick;
      trProps.sx = { cursor: "pointer" };
    }

    return (
      <tr {...trProps}>
        {selectable && (
          <td>
            <Checkbox
              variant="outlined"
              size={controlSize}
              checked={sql`exists (select id from ${
                sql.ref(selTableName)
              } where id = ${sql.ref(recordName)}.id)`}
              tabIndex={-1}
              slotProps={{
                action: {
                  onClick: (s: DomStatements) => {
                    s.if(
                      sql`exists (select id from ${
                        sql.ref(selTableName)
                      } where id = ${sql.ref(recordName)}.id)`,
                      (s) => {
                        s.modify(
                          sql`delete from ${sql.ref(selTableName)} where id = ${
                            sql.ref(recordName)
                          }.id`,
                        );
                      },
                      (s) => {
                        s.modify(
                          sql`insert into ${
                            sql.ref(selTableName)
                          } (id) values (${sql.ref(recordName)}.id)`,
                        );
                      },
                    );
                  },
                },
              }}
            />
          </td>
        )}
        {resolvedColumns.map((col, colIndex) => {
          const wrapHidden = (node: Node) =>
            col.hidden
              ? <Show when={sql`not (${col.hidden})`}>{node}</Show>
              : node;
          const tdStyle: Record<string, any> = {};
          if (!minColumnWidth) {
            if (col.width) tdStyle.width = col.width;
          } else {
            tdStyle.overflow = "hidden";
            tdStyle.textOverflow = "ellipsis";
            tdStyle.whiteSpace = "nowrap";
          }
          if (col.align) tdStyle.textAlign = col.align;

          const editing = col.editing;

          if (col.editable && editing) {
            const cellContent = renderEditableCell(
              col,
              editing,
              colIndex,
              recordName,
              controlSize,
            );
            // Bool editors handle their own click, no double-click needed
            const isBool = (col.editing?.dbField.type ?? col.fieldType) ===
              "Bool";
            if (!isBool) {
              tdStyle.cursor = "text";
            }
            return wrapHidden(
              <td
                sx={Object.keys(tdStyle).length > 0 ? tdStyle : undefined}
                onDoubleClick={!isBool
                  ? (s: DomStatements) => {
                    s.setScalar(
                      "dt_editing_row",
                      sql`${sql.ref(recordName)}.iteration_index`,
                    );
                    s.setScalar("dt_editing_col", sql`${colIndex}`);
                    s.setScalar("dt_is_editing", true);
                  }
                  : undefined}
              >
                {cellContent}
              </td>,
            );
          }

          const Component = col.cell;
          return wrapHidden(
            <td sx={Object.keys(tdStyle).length > 0 ? tdStyle : undefined}>
              <Component record={sql.ref(recordName)} />
            </td>,
          );
        })}
        {hasActions && renderActionsCell()}
      </tr>
    );
  }

  function renderActionsCell(): Node {
    const rowId = sql`${sql.ref(recordName)}.id`;
    return (
      <td>
        <Menu>
          <Menu.IconButton
            variant="plain"
            size={controlSize}
            color="neutral"
            icon="MoreVert"
            aria-label="Actions"
          />
          <Menu.Content>
            {resolvedActions!.map((action) => {
              switch (action.type) {
                case "edit":
                  return (
                    <AutoUpdateMenuItem
                      table={primaryTable?.name}
                      recordId={rowId}
                      ignoreFields={action.ignoreFields}
                      temporaryFields={action.temporaryFields}
                      beforeSubmitClient={action.beforeSubmitClient
                        ? ((s, ctx) =>
                          action.beforeSubmitClient!(s, ctx, rowId))
                        : undefined}
                      beforeTransactionStart={action.beforeTransactionStart
                        ? ((s, ctx) =>
                          action.beforeTransactionStart!(s, ctx, rowId))
                        : undefined}
                      afterTransactionStart={action.afterTransactionStart
                        ? ((s, ctx) =>
                          action.afterTransactionStart!(s, ctx, rowId))
                        : undefined}
                      beforeTransactionCommit={action.beforeTransactionCommit
                        ? ((s, ctx) =>
                          action.beforeTransactionCommit!(s, ctx, rowId))
                        : undefined}
                      afterTransactionCommit={action.afterTransactionCommit
                        ? ((s, ctx) =>
                          action.afterTransactionCommit!(s, ctx, rowId))
                        : undefined}
                      afterSubmitClientSuccess={action.afterSubmitClientSuccess
                        ? ((s, ctx) =>
                          action.afterSubmitClientSuccess!(s, ctx, rowId))
                        : undefined}
                      onSubmitServerError={action.onSubmitServerError
                        ? ((s, ctx, err) =>
                          action.onSubmitServerError!(s, ctx, err, rowId))
                        : undefined}
                    >
                      Edit
                    </AutoUpdateMenuItem>
                  );
                case "delete":
                  return (
                    <DeleteRecordMenuItem
                      table={primaryTable?.name}
                      recordId={rowId}
                      description={action.confirmText}
                      beforeSubmitClient={action.beforeSubmitClient
                        ? ((s) => action.beforeSubmitClient!(s, rowId))
                        : undefined}
                      beforeTransactionStart={action.beforeTransactionStart
                        ? ((s) => action.beforeTransactionStart!(s, rowId))
                        : undefined}
                      afterTransactionStart={action.afterTransactionStart
                        ? ((s) => action.afterTransactionStart!(s, rowId))
                        : undefined}
                      beforeTransactionCommit={action.beforeTransactionCommit
                        ? ((s) => action.beforeTransactionCommit!(s, rowId))
                        : undefined}
                      afterTransactionCommit={action.afterTransactionCommit
                        ? ((s) => action.afterTransactionCommit!(s, rowId))
                        : undefined}
                      afterSubmitClient={action.afterSubmitClient
                        ? ((s) => action.afterSubmitClient!(s, rowId))
                        : undefined}
                    >
                      Delete
                    </DeleteRecordMenuItem>
                  );
                case "custom":
                  return (
                    <Menu.Item onClick={action.handler}>
                      {action.icon && (
                        <ListItemDecorator>
                          <MaterialIcon icon={action.icon} />
                        </ListItemDecorator>
                      )}
                      {action.label}
                    </Menu.Item>
                  );
                case "action": {
                  const menuItem = (
                    <ActionMenuItem
                      icon={action.icon}
                      action={(s) => action.action(s, rowId)}
                      successMessage={action.successMessage}
                      errorDisplay={action.errorDisplay}
                      refetch={action.refetch}
                      confirm={action.confirm}
                      onSuccess={action.onSuccess
                        ? (s) => action.onSuccess!(s, rowId)
                        : undefined}
                      afterSuccessClient={action.afterSuccessClient
                        ? (s) => action.afterSuccessClient!(s, rowId)
                        : undefined}
                    >
                      {action.label}
                    </ActionMenuItem>
                  );
                  return action.when
                    ? <Show when={action.when}>{menuItem}</Show>
                    : menuItem;
                }
              }
            })}
          </Menu.Content>
        </Menu>
      </td>
    );
  }
}

function isDateType(fieldType: DataTableFieldType): boolean {
  return (
    fieldType === "Date" ||
    fieldType === "TimestampTz" ||
    fieldType === "TimestampUtc" ||
    fieldType === "TimestampNaive"
  );
}

/** Field types that support inline editing in DataTable. */
function isInlineEditableType(fieldType: DataTableFieldType): boolean {
  switch (fieldType) {
    case "String":
    case "Bool":
    case "Enum":
    case "Date":
    case "TimestampTz":
    case "TimestampUtc":
    case "TimestampNaive":
    case "Int":
    case "BigInt":
    case "SmallInt":
    case "TinyInt":
    case "Uint":
    case "BigUint":
    case "SmallUint":
    case "TinyUint":
    case "Decimal":
    case "Double":
    case "Real":
      return true;
    case "ForeignKey":
      return true;
    case "Bytes":
    case "Ordering":
    case "Time":
    case "Uuid":
    case "Json":
    case "PhoneNumber":
    case "Tx":
    case "Interval":
      return false;
  }
}
