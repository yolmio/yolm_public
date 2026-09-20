import { Button } from "components/button";
import { Checkbox } from "components/checkbox";
import { CircularProgress } from "components/circular_progress";
import { Divider } from "components/divider";
import { IconButton } from "components/icon_button";
import { List } from "components/list";
import { ModalDialog } from "components/modal";
import { Typography } from "components/typography";
import { singularize, upcaseFirst } from "std/inflectors";
import { analyzeScalarTypeToSqlCast, fieldToAnalyzeType } from "std/ictx";
import { Data } from "std/data";
import { queryParamsString } from "std/services";
import {
  getHrefToRecordOptional,
  NavigationItemsSharedContext,
  PagesSharedContext,
  TableLinksSharedContext,
} from "std/shared_contexts";
import { sql } from "../std/sql_utils";
import type { AnyExpr, BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import type { DomStatements, DomStatementsOrFn } from "std/statements";
import type { Field, Table } from "std/system";
import { system } from "std/system";
import {
  addCtx,
  DocumentTitle,
  Each,
  gatherChildrenContextInfo,
  Route,
  Show,
  useSharedContext,
} from "std/ui";
import type { Node } from "std/ui";
import { getRelationInfo } from "std/utils/relation";
import { getTableBaseUrl } from "std/utils/url";
import { analyzeQuery } from "std/yolm_gen_api";
import type { QueryColumnInfo } from "std/yolm_gen_api";
import { RecordPageContent, type RecordPageContentProps } from "./record_page";
import {
  buildRankedSearchTargets,
  type QuickSearchFieldMode,
  type QuickSearchTargetResolved,
  type ResolvedQuickSearch,
} from "std/search_utils";
import { ColumnMenu } from "./datagrid_internals/column_menu";
import { validateDatagridViewTables } from "./datagrid_internals/db_state";
import {
  type Column,
  type DefaultView,
  DynamicDatagrid,
  type FilterType,
  type SortConfig,
} from "./datagrid_internals/dynamic_datagrid";
import {
  columnFromField,
  filterTypeFromField,
  fkVirtualColumnFromField,
} from "./datagrid_internals/from_model";
import {
  type FieldCellLink,
  ReadOnlyLinkedCell,
} from "./datagrid_internals/cells";
import { datagridRecordMergeBulkAction } from "./datagrid_internals/record_merge";
import {
  captureDatagridRecordNavigation,
  DATAGRID_RECORD_NAVIGATION_COUNT_QUERY,
  DATAGRID_RECORD_NAVIGATION_PAGE_SIZE,
  DATAGRID_RECORD_NAVIGATION_QUERY_PREFIX,
  DATAGRID_RECORD_NAVIGATION_ROW_COUNT,
  DatagridRecordNavigation,
  datagridRecordUrl,
  useSeparatedDatagridRecordNavigationState,
} from "./datagrid_internals/record_navigation";
import {
  type DgCellHelper,
  type FieldEditProcConfig,
  ResizeableSeperator,
  type RowHeight,
  useCellHelper,
} from "./datagrid_internals/shared";
import { styles as sharedStyles } from "./datagrid_internals/styles";
import {
  DatagridToolbar,
  DynamicDatagridGatherContext,
} from "./datagrid_internals/toolbar";
import type { SnackbarBulkAction } from "./datagrid_internals/toolbar";
import type { FilterTermHelper } from "./datagrid_internals/toolbar_filter";

export type {
  RelationStringFilter,
  StringFilterOp,
} from "./datagrid_internals/dynamic_datagrid";

export { useCellHelper } from "./datagrid_internals/shared";
export { DatagridToolbar } from "./datagrid_internals/toolbar";
export {
  datagridRecordMergeBulkAction,
  RecordMergeDialog,
} from "./datagrid_internals/record_merge";

/** One filter encoded into a {@link datagridUrl} deep link. */
export interface DatagridUrlFilter {
  /** Column storage name, matching saved views and `defaultView`. */
  column: string;
  /** Datagrid filter operator such as `str_eq`, `enum_eq`, or `fk_eq`. */
  op: string;
  value_1?: string | AnyExpr;
  value_2?: string | AnyExpr;
  value_3?: string | AnyExpr;
}

/** One ordered sort encoded into a {@link datagridUrl} deep link. */
export interface DatagridUrlSort {
  /** Column storage name, matching saved views and `defaultView`. */
  column: string;
  sort: "asc" | "desc";
}

export interface DatagridUrlState {
  /** Filters to apply together with AND. An empty array clears view/default filters. */
  filters?: DatagridUrlFilter[];
  /** Sorts in priority order. An empty array clears view/default sorting. */
  sort?: DatagridUrlSort[];
}

/**
 * Builds a datagrid URL whose `filters` and `sort` query params initialize the
 * grid independently of saved views. Dynamic SQL values may be used in filter
 * values, so links can be generated from query-backed dashboard rows.
 */
export function datagridUrl(path: string | Sql, state: DatagridUrlState): Sql {
  if (state.filters === undefined && state.sort === undefined) {
    return typeof path === "string" ? sql.lit(path) : path;
  }
  const filters = state.filters === undefined
    ? undefined
    : sql`cast(${
      sql.jsonBuildArray(
        ...state.filters.map((filter) =>
          sql.jsonBuildObject({
            column: filter.column,
            op: filter.op,
            value_1: filter.value_1,
            value_2: filter.value_2,
            value_3: filter.value_3,
          })
        ),
      )
    } as string)`;
  const sort = state.sort === undefined
    ? undefined
    : sql`cast(${
      sql.jsonBuildArray(
        ...state.sort.map((item) =>
          sql.jsonBuildObject({ column: item.column, sort: item.sort })
        ),
      )
    } as string)`;
  const query = queryParamsString({ filters, sort });
  const normalizedPath = typeof path === "string" ? sql.lit(path) : path;
  return sql`${normalizedPath} || '?' || ${query}`;
}

type FieldConfigs = Record<string, FieldConfig>;
export type VirtualColumnValueType = Exclude<FilterType, { type: "custom" }>;

/**
 * Per-field options for a {@link DatagridPage} column, keyed by field name in
 * the `fields` prop. Extends {@link FieldEditProcConfig} with the inline-edit
 * hooks. Use to override the auto-generated column's display name, width,
 * editability, whether it can be filtered/sorted, or its cell renderer.
 */
export interface FieldConfig extends FieldEditProcConfig {
  /** Expression gating inline edits on this column. Falls back to the page's `canEdit`. */
  canEdit?: BooleanExpr;
  displayName?: string;
  initialWidth?: number;
  /** Whether this column is offered as a filter target. */
  filter?: boolean;
  /** Pin this displayed column while horizontally scrolling. */
  pin?: "left" | "right";
  /** Whether this column is offered as a sort target. */
  sort?: boolean;
  /**
   * Render the field display as a link while preserving the default edit behavior.
   * A callback receives the row's record id and is styled as an internal record link.
   */
  link?: FieldCellLink;
  /**
   * Override the cell renderer. Receives the cell helper (whose `value` is
   * the field's raw value, e.g., the FK id for a ForeignKey field). When
   * omitted, the default field-type-aware cell renderer is used.
   */
  cell?: ((props: { helper: DgCellHelper }) => Node) | Node;
}

function SimpleCellValue() {
  const ctx = useCellHelper();
  // Match field cells: long virtual values truncate instead of wrapping rows.
  return <span sx={sharedStyles.ellipsisSpan}>{ctx.value}</span>;
}

function tableRecordDisplayExpr(tableName: string, value: AnyExpr) {
  const table = system.db.tables[tableName];
  if (!table) {
    throw new Error(`Table ${tableName} not found`);
  }
  if (!table.recordDisplayName) {
    throw new Error(`Unable to display record value for table ${table.name}`);
  }
  const nameExpr = table.recordDisplayName.expr(
    ...table.recordDisplayName.fields.map((f) => sql`r.${sql.ref(f)}`),
  );
  return sql`(select ${nameExpr} from ${table.identWithDb} as r where id = try_cast(${value} as bigint))`;
}

function TableRecordCellValue(props: { table: string }) {
  const ctx = useCellHelper();
  return (
    <span sx={sharedStyles.ellipsisSpan}>
      {tableRecordDisplayExpr(props.table, ctx.value)}
    </span>
  );
}

function EnumCellValue(props: { enum: string }) {
  const ctx = useCellHelper();
  const enumModel = system.enums[props.enum];
  return (
    <span sx={sharedStyles.ellipsisSpan}>
      {enumModel.getDisplayName?.(
        sql`try_cast(${ctx.value} as enums.${sql.ref(enumModel.name)})`,
      ) ?? ctx.value}
    </span>
  );
}

function defaultVirtualCell(type: VirtualColumnValueType | undefined) {
  switch (type?.type) {
    case "table":
      return <TableRecordCellValue table={type.table} />;
    case "enum":
      return <EnumCellValue enum={type.enum} />;
    case undefined:
    case "string":
    case "number":
    case "date":
    case "bool":
    case "timestamp":
    case "minutes_duration":
    case "enum_like_bool":
      return <SimpleCellValue />;
  }
}

function defaultVirtualExportExpr(
  expr: AnyExpr,
  type: VirtualColumnValueType | undefined,
) {
  switch (type?.type) {
    case "table":
      return tableRecordDisplayExpr(type.table, expr);
    case "enum": {
      const displayFnName = `display_${type.enum}`;
      if (system.scalarFunctions[displayFnName]) {
        return sql`fn.${sql.ref(displayFnName)}(${expr})`;
      }
      return expr;
    }
    case undefined:
    case "string":
    case "number":
    case "date":
    case "bool":
    case "timestamp":
    case "minutes_duration":
    case "enum_like_bool":
      return expr;
  }
}

function analyzedColumnValueType(
  column: QueryColumnInfo,
): VirtualColumnValueType | undefined {
  const notNull = !column.nullable;
  if (column.sourceTable && column.sourceField) {
    const table = system.db.tables[column.sourceTable];
    const field = table?.fields[column.sourceField];
    if (field) {
      try {
        return { ...filterTypeFromField(field), notNull };
      } catch {
        // Fall back to scalar analysis below for fields without filter support.
      }
    }
  }
  switch (column.type.type) {
    case "Bool":
      return { type: "bool", notNull };
    case "SmallInt":
    case "Int":
    case "BigInt":
    case "Real":
    case "Double":
    case "Decimal":
    case "Ordering":
      return { type: "number", notNull };
    case "Date":
      return { type: "date", notNull };
    case "Timestamp":
    case "TimestampTz":
    case "TimestampNaive":
      return { type: "timestamp", notNull };
    case "Enum":
      return { type: "enum", enum: column.type.enum, notNull };
    case "String":
    case "Uuid":
      return { type: "string", notNull };
    case "Time":
    case "Json":
    case "Interval":
    case "Bytes":
      return undefined;
  }
}

function analyzeVirtualColumnValueType(
  table: Table,
  expr: AnyExpr,
): VirtualColumnValueType | undefined {
  const result = analyzeQuery({
    query: sql`select ${expr} as value from ${table.identWithDb} as record`
      .toSQL(),
    dbScope: ["db"],
  });
  if (result.status !== "ok" || result.columns.length !== 1) {
    return undefined;
  }
  return analyzedColumnValueType(result.columns[0]);
}

/**
 * Renders the current datagrid cell's value through a custom formatter.
 *
 * Use as the `cell` for a column whose default rendering needs to be
 * post-processed — e.g. formatting a number as currency or composing
 * multiple fields into one cell. The `format` callback receives the
 * cell's raw `AnyExpr` value (resolved from the column's `expr`) and
 * returns a new SQL expression to render.
 *
 * @example
 * cell: () => (
 *   <FormattedCellValue format={(v) => sql`format.currency(${v}, 'USD')`} />
 * )
 */
export function FormattedCellValue(opts: {
  format: (value: AnyExpr) => AnyExpr;
}) {
  const ctx = useCellHelper();
  return opts.format(ctx.value);
}

function idColumn(tableModel: Table, index: number): Column {
  const idDisplayName = tableModel.primaryKeyFieldName
    .split("_")
    .map((v, i) => (i === 0 ? upcaseFirst(v) : v))
    .join(" ");
  const sqlName = tableModel.primaryKeyIdent;
  const sortConfig = {
    type: "numeric",
    displayName: idDisplayName,
  } as SortConfig;
  return {
    filterDisplayName: idDisplayName,
    columnsDisplayName: idDisplayName,
    filterOptGroup: "Field",
    filter: { type: "number", notNull: true },
    sort: sortConfig,
    displayInfo: {
      initialWidth: 150,
      initiallyDisplaying: false,
      header: (
        <>
          <span sx={sharedStyles.headerText}>{idDisplayName}</span>
          <ColumnMenu columnIndex={index} sort={sortConfig} />
          <ResizeableSeperator
            minWidth={50}
            setWidth={(s, width) => {
              s.modify(
                sql`update ui.column set width = ${width} where id = ${index}`,
              );
            }}
            width={sql`(select width from ui.column where id = ${index})`}
          />
        </>
      ),
      cell: <SimpleCellValue />,
    },
    queryGeneration: {
      expr: sql.lit(sql.ref("record", sqlName).toSQL()),
      alwaysGenerate: true,
    },
    export: {
      name: idDisplayName,
      expr: sql.lit(sql.ref("record", sqlName).toSQL()),
    },
    viewStorageName: sqlName.toSQL(),
    canReorder: true,
  };
}

function toggleRowSelection(
  s: DomStatements,
  id: NumericExpr,
  maxSelectedRows?: number,
) {
  s.conditional({
    condition: sql`exists (select id from ui.selected_row where id = ${id})`,
    then: (s) => {
      s.modify(sql`delete from selected_row where id = ${id}`);
    },
    else: (s) => {
      if (maxSelectedRows !== undefined) {
        s.returnIf(
          sql`(select count(*) from ui.selected_row) >= ${maxSelectedRows}`,
        );
      }
      s.modify(sql`insert into selected_row (id) values (${id})`);
    },
  });
}

/**
 * Imperative builder for a {@link DatagridPage}'s columns and bulk actions.
 * Passed to the page's `columns` callback so you can add fields, virtual /
 * cell-only / custom-filter columns, and relation-count columns in the order
 * they should appear. The id column (and any checkbox / view-button columns)
 * are added automatically by the constructor.
 *
 * @category Page Component
 */
export class DatagridBuilder {
  #columns: Column[] = [];
  #bulkActions: SnackbarBulkAction[] = [];
  #table: Table;
  #canEdit: BooleanExpr;
  #recordLink?: {
    field: string;
    href: (id: NumericExpr) => Sql;
    beforeNavigate?: DomStatementsOrFn;
  };
  /**
         This is the number of dynamic fields for the query that have been added, it always starts at 1
         as that the id field is always added first.
         */
  #dynamicFieldCount = 1;

  constructor(
    table: Table,
    canEdit: BooleanExpr,
    selectable: boolean,
    viewButtonUrl: ((id: NumericExpr) => Sql) | undefined,
    maxSelectedRows?: number,
    recordLink?: {
      field: string;
      href: (id: NumericExpr) => Sql;
      beforeNavigate?: DomStatementsOrFn;
    },
    viewButtonBeforeNavigate?: DomStatementsOrFn,
  ) {
    this.#table = table;
    this.#recordLink = recordLink;
    if (selectable) {
      this.#columns.push({
        displayInfo: {
          initiallyDisplaying: true,
          initialWidth: 36,
          pin: "left",
          cell: (
            <Checkbox
              variant="outlined"
              size="sm"
              checked={sql`selected_all or exists (select id from selected_row where id = cast(dg_record.field_0 as bigint))`}
              disabled={maxSelectedRows === undefined
                ? undefined
                : sql`not selected_all and not exists (select id from selected_row where id = cast(dg_record.field_0 as bigint)) and (select count(*) from selected_row) >= ${maxSelectedRows}`}
              tabIndex={-1}
              onClick={(s) => {
                toggleRowSelection(
                  s,
                  sql`cast(dg_record.field_0 as bigint)`,
                  maxSelectedRows,
                );
              }}
            />
          ),
          header: (
            <Checkbox
              variant="outlined"
              size="sm"
              checked={sql`selected_all`}
              disabled={maxSelectedRows !== undefined}
              tabIndex={-1}
              onClick={(s) => {
                if (maxSelectedRows === undefined) {
                  s.toggle("selected_all");
                  s.modify(sql`delete from selected_row`);
                }
              }}
            />
          ),
        },
        keydownCellHandler: (s) => {
          s.returnUnless(sql`event.key = 'Enter' or event.key = ' '`);
          s.defScalar(
            "row_id",
            sql`(select field_0 from ui.dg_table limit 1 offset cell.row - 1)`,
          );
          toggleRowSelection(s, sql`cast(row_id as bigint)`, maxSelectedRows);
        },
        keydownHeaderHandler: (s) => {
          s.returnUnless(sql`event.key = 'Enter' or event.key = ' '`);
          if (maxSelectedRows === undefined) {
            s.toggle("selected_all");
            s.modify(sql`delete from selected_row`);
          }
        },
        viewStorageName: "dg_checkbox_col",
        canReorder: false,
        canPin: false,
      });
    }
    if (typeof viewButtonUrl === "function") {
      this.#columns.push({
        displayInfo: {
          initialWidth: 76,
          pin: "left",
          cell: (
            <Button
              variant="soft"
              color="primary"
              size="sm"
              href={viewButtonUrl(sql`dg_record.field_0`)}
              tabIndex={-1}
              onClick={viewButtonBeforeNavigate
                ? (s) => {
                  s.if(
                    sql`not event.ctrl_key and not event.meta_key and not event.shift_key and not event.alt_key`,
                    (s) => {
                      s.event.preventDefault();
                      s.statements(viewButtonBeforeNavigate);
                      s.navigate(viewButtonUrl(sql`dg_record.field_0`));
                    },
                  );
                }
                : undefined}
            >
              View
            </Button>
          ),
          header: sql.lit`View`,
          initiallyDisplaying: true,
        },
        viewStorageName: "dg_view_button_col",
        canReorder: false,
        canPin: false,
      });
    }
    this.#columns.push(idColumn(this.#table, this.#columns.length));
    this.#canEdit = canEdit;
  }

  /** Register a bulk action shown in the selection snackbar when rows are selected. */
  addSnackbarBulkAction(action: SnackbarBulkAction) {
    this.#bulkActions.push(action);
  }

  /** Add a column for every field on the table, optionally skipping some and applying per-field {@link FieldConfig}. */
  autoFields({
    ignoreFields,
    fields,
  }: {
    ignoreFields?: string[];
    fields?: FieldConfigs;
  } = {}) {
    for (const field of Object.values(this.#table.fields)) {
      if (ignoreFields?.includes(field.name)) {
        continue;
      }
      this.addField(field.name, fields?.[field.name] ?? {});
    }
  }

  /**
         Add virtual columns for all fields in the table that the foreign key references.
         */
  addFkVirtuals(fkField: string) {
    const field = this.#table.fields[fkField];
    if (!field) {
      throw new Error(`Field ${fkField} not found`);
    }
    if (field.type !== "ForeignKey") {
      throw new Error(`Field ${fkField} is not a foreign key`);
    }
    const otherTable = system.db.tables[field.table];
    if (!otherTable) {
      throw new Error(`Table ${field.table} not found`);
    }
    for (const otherField of Object.values(otherTable.fields)) {
      if (otherField.type === "ForeignKey") {
        continue;
      }
      const column = fkVirtualColumnFromField({
        mainTable: this.#table,
        fkTable: otherTable,
        field: otherField,
        fkField: field,
        displayName: `${singularize(otherTable.displayName)} ${
          upcaseFirst(otherField.displayName)
        }`,
        dynIndex: this.#dynamicFieldCount,
        columnIndex: this.#columns.length,
        canEdit: false,
      });
      if (column) {
        column.viewStorageName = `${otherTable.name}_${otherField.name}`;
        column.displayInfo!.initiallyDisplaying = false;
        this.#columns.push(column);
        this.#dynamicFieldCount += 1;
      }
    }
  }

  /**
   * Add a read-only virtual column for one field on the table referenced by a foreign key.
   */
  addFkField(
    fkField: string,
    fieldName: string,
    opts: {
      storageName?: string;
      displayName?: string;
      initialWidth?: number;
      initiallyDisplaying?: boolean;
      filter?: boolean;
      sort?: boolean;
      pin?: "left" | "right";
    } = {},
  ) {
    const field = this.#table.fields[fkField];
    if (!field) {
      throw new Error(`Field ${fkField} not found`);
    }
    if (field.type !== "ForeignKey") {
      throw new Error(`Field ${fkField} is not a foreign key`);
    }
    const otherTable = system.db.tables[field.table];
    if (!otherTable) {
      throw new Error(`Table ${field.table} not found`);
    }
    const otherField = otherTable.fields[fieldName];
    if (!otherField) {
      throw new Error(
        `Field ${fieldName} not found on table ${otherTable.name}`,
      );
    }
    const column = fkVirtualColumnFromField({
      mainTable: this.#table,
      fkTable: otherTable,
      field: otherField,
      fkField: field,
      displayName: opts.displayName,
      dynIndex: this.#dynamicFieldCount,
      columnIndex: this.#columns.length,
      canEdit: false,
      initialWidth: opts.initialWidth,
      filter: opts.filter,
      sort: opts.sort,
      pin: opts.pin,
    });
    if (!column) {
      return this;
    }
    column.viewStorageName = opts.storageName ??
      `${otherTable.name}_${otherField.name}`;
    if (opts.initiallyDisplaying !== undefined) {
      column.displayInfo!.initiallyDisplaying = opts.initiallyDisplaying;
    }
    this.#columns.push(column);
    this.#dynamicFieldCount += 1;
    return this;
  }

  /** Add a single column for the named table field, applying its {@link FieldConfig}. */
  addField(fieldName: string, config: FieldConfig) {
    const field = this.#table.fields[fieldName];
    let canEdit: BooleanExpr | undefined;
    if (sql.isDynamicExpr(config?.canEdit)) {
      canEdit = sql`field_${sql(field.name)}_can_edit`;
    } else if (typeof config?.canEdit === "boolean") {
      canEdit = config.canEdit;
    } else if (sql.isDynamicExpr(this.#canEdit)) {
      canEdit = sql`global_can_edit`;
    } else {
      canEdit = this.#canEdit;
    }
    const recordLink = this.#recordLink?.field === fieldName
      ? {
        href: this.#recordLink.href,
        beforeNavigate: this.#recordLink.beforeNavigate,
      }
      : undefined;
    const configuredCell = config?.cell;
    if (configuredCell && recordLink) {
      throw new Error(
        `recordPage.linkField ${fieldName} cannot use a custom cell renderer`,
      );
    }
    const column = columnFromField({
      table: this.#table.name,
      field,
      dynIndex: this.#dynamicFieldCount,
      columnIndex: this.#columns.length,
      beforeUpdateTransaction: config?.beforeUpdateTransaction,
      beforeUpdate: config?.beforeUpdate,
      afterUpdateTransaction: config?.afterUpdateTransaction,
      afterUpdate: config?.afterUpdate,
      canEdit,
      initialWidth: config?.initialWidth,
      filter: config?.filter,
      sort: config?.sort,
      displayName: config?.displayName,
      pin: config?.pin,
      link: recordLink ?? config?.link,
      cell: configuredCell,
    });
    if (column) {
      this.#columns.push(column);
      this.#dynamicFieldCount += 1;
    }
  }

  /**
   * Add a filter-only column backed by a custom predicate. The `expr` callback
   * receives up to three filter input values and returns the boolean SQL used to
   * filter rows. Has no cell, sort, or query generation. Returns `this` for chaining.
   */
  customFilterColumn(column: {
    storageName: string;
    displayName?: string;
    expr: (
      value1: Sql,
      value2: Sql,
      value3: Sql,
    ) => Sql;
    exampleValues?: {
      value1: string;
      value2?: string;
      value3?: string;
    };
    node?: (helpers: FilterTermHelper) => Node;
  }) {
    this.#columns.push({
      viewStorageName: column.storageName,
      filterDisplayName: column.displayName ??
        column.storageName
          .split("_")
          .map((v, i) => (i === 0 ? upcaseFirst(v) : v))
          .join(" "),
      filterOptGroup: "Field",
      filterExpr: column.expr,
      filterExampleValues: column.exampleValues,
      filter: {
        type: "custom",
        node: column.node,
      },
      canReorder: true,
    });
    return this;
  }

  /**
   * Add a sort-only column backed by a SQL expression. The `expr` callback
   * receives the row `record` and returns the value to sort by. The column is
   * generated into the query only when actively sorted. Returns `this` for chaining.
   */
  customSortColumn(column: {
    storageName: string;
    expr: (record: Sql) => AnyExpr;
    sort: Omit<SortConfig, "displayName"> & {
      displayName?: string;
    };
  }) {
    this.#columns.push({
      viewStorageName: column.storageName,
      queryGeneration: {
        expr: column.expr(sql`record`),
        alwaysGenerate: false,
      },
      sort: {
        ...column.sort,
        displayName: column.sort.displayName ??
          column.storageName
            .split("_")
            .map((v, i) => (i === 0 ? upcaseFirst(v) : v))
            .join(" "),
      } as any,
      canReorder: true,
    });
    return this;
  }

  /**
         A column that is basically like a field, but is actually backed by some sql expression
         */
  virtualColumn(column: {
    storageName: string;
    displayName?: string;
    columnsDisplayName?: string;
    expr: AnyExpr;
    /**
     * Describes the virtual expression's value so default cells and exports can
     * use field-aware formatting without enabling filtering.
     */
    valueType?: VirtualColumnValueType;
    filterDisplayName?: string;
    filterOptGroup?: string;
    filter?: FilterType;
    /**
     * Custom predicate builder. When provided, the datagrid uses this expression
     * (instead of the default op-based predicate) to filter rows. Required when
     * `filter.type === "custom"`.
     */
    filterExpr?: (value1: Sql, value2: Sql, value3: Sql) => Sql;
    /** Required if `filterExpr` is provided — drives query validation. */
    filterExampleValues?: {
      value1: string;
      value2?: string;
      value3?: string;
    };
    sort?: Omit<SortConfig, "displayName"> & {
      displayName?: string;
    };
    cell?: ((props: { helper: DgCellHelper }) => Node) | Node;
    disableSort?: boolean;
    initialWidth?: number;
    initiallyDisplaying?: boolean;
    pin?: "left" | "right";
    canReorder?: boolean;
  }) {
    const displayName = column.displayName ??
      column.storageName
        .split("_")
        .map((v, i) => (i === 0 ? upcaseFirst(v) : v))
        .join(" ");
    const sort = { ...column.sort, displayName } as SortConfig;
    const currentColumnId = this.#columns.length;
    const valueType = column.valueType ??
      analyzeVirtualColumnValueType(this.#table, column.expr) ??
      (column.filter?.type === "custom" ? undefined : column.filter);
    const recordLink = this.#recordLink?.field === column.storageName
      ? {
        href: this.#recordLink.href,
        beforeNavigate: this.#recordLink.beforeNavigate,
      }
      : undefined;
    if (column.cell && recordLink) {
      throw new Error(
        `recordPage.linkField ${column.storageName} cannot use a custom cell renderer`,
      );
    }
    const defaultCell = defaultVirtualCell(valueType);
    const displayCell = recordLink
      ? <ReadOnlyLinkedCell link={recordLink} value={defaultCell} />
      : column.cell ?? defaultCell;
    this.#columns.push({
      viewStorageName: column.storageName,
      columnsDisplayName: column.columnsDisplayName ?? displayName,
      queryGeneration: {
        expr: sql.lit(sql.exprToString(column.expr)),
        alwaysGenerate: false,
      },
      displayInfo: {
        cell: displayCell,
        header: (
          <>
            <span sx={sharedStyles.headerText}>
              {column.columnsDisplayName ?? displayName}
            </span>
            <ColumnMenu
              columnIndex={currentColumnId}
              sort={column.disableSort ? undefined : sort}
            />
            <ResizeableSeperator
              minWidth={50}
              width={sql`(select width from ui.column where id = ${currentColumnId})`}
              setWidth={(s, width) => {
                s.modify(
                  sql`update ui.column set width = ${width} where id = ${currentColumnId}`,
                );
              }}
            />
          </>
        ),
        initiallyDisplaying: column.initiallyDisplaying ?? false,
        initialWidth: column.initialWidth ?? 150,
        pin: column.pin,
      },
      filterDisplayName: column.filterDisplayName ??
        (column.filter ? (column.filterDisplayName ?? displayName) : undefined),
      filterOptGroup: column.filterOptGroup ??
        (column.filter ? "Field" : undefined),
      export: {
        name: column.displayName ?? column.storageName,
        expr: sql.lit(
          sql.exprToString(defaultVirtualExportExpr(column.expr, valueType)),
        ),
      },
      filter: column.filter,
      filterExpr: column.filterExpr,
      filterExampleValues: column.filterExampleValues,
      sort,
      canReorder: column.canReorder ?? true,
    });
    return this;
  }

  /**
         A column that is only displayed in the cell, doesn't filter or sort
         */
  cellOnlyColumn(column: {
    storageName: string;
    displayName?: string;
    headerText?: Node;
    header?: Node;
    cell: ((props: { helper: DgCellHelper }) => Node) | Node;
    initiallyDisplaying?: boolean;
    initialWidth?: number;
    pin?: "left" | "right";
    canReorder?: boolean;
  }) {
    const currentColumnId = this.#columns.length;
    this.#columns.push({
      viewStorageName: column.storageName,
      columnsDisplayName: column.displayName,
      displayInfo: {
        cell: column.cell,
        header: column.header ?? (
          <>
            <span sx={sharedStyles.headerText}>
              {column.headerText ?? column.displayName}
            </span>
            <ColumnMenu columnIndex={currentColumnId} />
            <ResizeableSeperator
              minWidth={50}
              width={sql`(select width from ui.column where id = ${currentColumnId})`}
              setWidth={(s, width) => {
                s.modify(
                  sql`update ui.column set width = ${width} where id = ${currentColumnId}`,
                );
              }}
            />
          </>
        ),
        initiallyDisplaying: column.initiallyDisplaying ?? false,
        initialWidth: column.initialWidth ?? 150,
        pin: column.pin,
      },
      canReorder: column.canReorder ?? true,
    });
    return this;
  }

  /** Push a fully-formed {@link Column} as-is. Escape hatch for cases the typed helpers don't cover. Returns `this` for chaining. */
  column(column: Column) {
    this.#columns.push(column);
    return this;
  }

  /**
   * Add a virtual column showing the count of related rows in another table that
   * reference this table via a foreign key. Pass the related table name, or an
   * object to customize display name / width / initial visibility.
   */
  countVirtual(
    opts:
      | string
      | {
        table: string;
        storageName?: string;
        initiallyDisplaying?: boolean;
        displayName?: string;
        initialWidth?: number;
        pin?: "left" | "right";
      },
  ) {
    const {
      table,
      storageName,
      initiallyDisplaying,
      displayName,
      initialWidth,
      pin,
    } = typeof opts === "string"
      ? {
        table: opts,
        storageName: opts.startsWith(this.#table.name)
          ? `${opts.substring(this.#table.name.length + 1)}_count`
          : `${opts}_count`,
      }
      : {
        table: opts.table,
        storageName: opts.storageName ??
          (opts.table.startsWith(this.#table.name)
            ? `${opts.table.substring(this.#table.name.length + 1)}_count`
            : `${opts.table}_count`),
        initiallyDisplaying: opts.initiallyDisplaying,
        displayName: opts.displayName,
        initialWidth: opts.initialWidth,
        pin: opts.pin,
      };
    const { otherTable, foreignKeyField } = getRelationInfo(
      this.#table.name,
      table,
    );
    return this.virtualColumn({
      storageName,
      displayName: displayName ?? `${table} Count`,
      expr:
        sql`(select count(*) from ${otherTable.identWithDb} where ${foreignKeyField.ident} = record.id)`,
      initiallyDisplaying,
      initialWidth,
      pin,
      filter: { type: "number", notNull: true },
      sort: { type: "numeric" },
    });
  }

  /**
   * Add a related-row count column whose cell opens a dialog listing the related
   * records. `listItem` renders each related record (receiving its record ref);
   * `dialogTitle` overrides the dialog heading. Like {@link countVirtual} but with
   * a drill-in view.
   */
  relationCountAndDialog({
    table,
    displayName,
    initiallyDisplaying,
    initialWidth,
    pin,
    listItem,
    dialogTitle,
  }: {
    table: string;
    displayName?: string;
    initiallyDisplaying?: boolean;
    initialWidth?: number;
    pin?: "left" | "right";
    listItem: (record: Sql) => Node;
    dialogTitle?: string;
  }) {
    const { otherTable, foreignKeyField } = getRelationInfo(
      this.#table.name,
      table,
    );
    const recordName = singularize(otherTable.name) === otherTable.name
      ? `${otherTable.name}_record`
      : singularize(otherTable.name);
    function DialogContent() {
      const cellHelper = useCellHelper();
      return (
        <>
          <div className="flex items-center gap-2 pb-4 sticky">
            <Typography level="h4">
              {dialogTitle ?? displayName ?? `${table} Association`}
            </Typography>
            <div className="grow" />
            <IconButton
              aria-label="Close"
              icon="CloseRounded"
              variant="plain"
              color="neutral"
              onClick={(s) => {
                s.setScalar("show_association_dialog", false);
              }}
            />
          </div>
          <Divider />
          <Data
            pendingFallback={<CircularProgress size="sm" />}
            procedure={(s) => {
              s.defScalar(
                "total_count",
                sql`(select count(*) from ${otherTable.identWithDb} where ${foreignKeyField.ident} = ${cellHelper.recordId})`,
              );
              s.defTable(
                otherTable.name,
                sql`select * from ${otherTable.identWithDb} where ${foreignKeyField.ident} = ${cellHelper.recordId}`,
              );
            }}
          >
            <Show
              when={sql`total_count > 0`}
              fallback={<Typography>No associated records</Typography>}
            >
              <List>
                <Each table={otherTable.name} recordName={recordName}>
                  {listItem(sql.ref(recordName))}
                </Each>
              </List>
            </Show>
          </Data>
        </>
      );
    }
    return this.virtualColumn({
      storageName: `${table}_association`,
      displayName: displayName ?? `${table}`,
      expr:
        sql`(select count(*) from ${otherTable.identWithDb} where ${foreignKeyField.ident} = record.id)`,
      initiallyDisplaying,
      initialWidth: initialWidth ?? 150,
      pin,
      cell: (
        <Data
          local
          procedure={(s) => {
            s.defScalar("show_association_dialog", false);
          }}
        >
          <div className="flex items-center gap-2 justify-between w-full">
            <FormattedCellValue
              format={(v) => sql`format.decimal(${v}::bigint)`}
            />
            <Button
              aria-label="View associated records"
              size="sm"
              variant="plain"
              startIcon="Visibility"
              onClick={(s) => {
                s.setScalar("show_association_dialog", true);
              }}
            >
              View
            </Button>
            <ModalDialog bindScalar="show_association_dialog" maxWidth="xs">
              <DialogContent />
            </ModalDialog>
          </div>
        </Data>
      ),
      filter: { type: "number", notNull: true },
      sort: { type: "numeric" },
    });
  }

  /** The accumulated columns in display order. Used internally by {@link DatagridPage}. */
  getColumns() {
    return this.#columns;
  }

  /** The accumulated snackbar bulk actions. Used internally by {@link DatagridPage}. */
  getBulkActions() {
    return this.#bulkActions;
  }
}

export type { QuickSearchFieldMode };

/** A single-field quick-search target with explicit match mode and ranking priority. */
export interface QuickSearchFieldConfig {
  /** Field name on the table. */
  field: string;
  /** Match strategy for this field. Defaults to "fuzzy". */
  mode?: QuickSearchFieldMode;
  /** Lower priority = ranked higher. Defaults to the entry's index in the array. */
  priority?: number;
}

/**
 * Concatenate multiple fields into a single fuzzy/contains target. Lets a search like
 * "John Smith" hit a row where `first_name = "John"` and `last_name = "Smith"` even
 * though neither field alone contains the full string.
 *
 * `mode: "exact"` is rejected for groups (the concatenated haystack rarely equals a
 * single user input verbatim).
 */
export interface QuickSearchGroupConfig {
  /** Fields concatenated (space-separated) into one haystack expression. */
  fields: string[];
  /** Match strategy. Defaults to "fuzzy". `"exact"` is not allowed for groups. */
  mode?: "fuzzy" | "contains";
  /** Lower priority = ranked higher. Defaults to the entry's index in the array. */
  priority?: number;
}

/**
 * Explicit configuration for a {@link DatagridPage}'s toolbar quick-search input.
 * Use the object form (vs `quickSearch: true`) when the table has no `searchConfig`,
 * or when you need per-field modes, field groups, or custom ranking.
 */
export interface QuickSearchConfig {
  /**
   * Search targets. Each entry is one of:
   * - `string` — single field, `"fuzzy"` mode (shorthand for `{ field, mode: "fuzzy" }`)
   * - `{ field, mode?, priority? }` — single field with explicit mode/priority
   * - `{ fields: [...], mode?, priority? }` — group whose fields are concatenated as
   *   one fuzzy/contains haystack, so cross-field input ("John Smith") can match.
   */
  fields: Array<string | QuickSearchFieldConfig | QuickSearchGroupConfig>;
  /**
   * When true and the search box has text, results are ordered by best match first
   * (user sort becomes a secondary tiebreaker). When false, the user's column sort
   * is preserved and search acts purely as a filter.
   */
  rank: boolean;
  /** Placeholder text on the search input. Defaults to "Search…". */
  placeholder?: string;
}

/** Props for {@link DatagridPage}. */
export interface DatagridPageProps {
  /** Database table name the grid edits. */
  table: string;
  /** Key under which this grid's saved views/column state are stored. Defaults to `table`. */
  datagridName?: string;
  /** Route path. Defaults to the table's base URL. */
  path?: string;
  /** Document title. Defaults to the table display name. */
  title?: string;
  /** Wraps the registered route's content without wrapping the Route itself. */
  wrapper?: (children: Node) => Node;
  /** Show row-selection checkboxes. Implied when bulk actions are enabled. */
  selectable?: boolean;
  /** Custom URL for the per-row view button, given the row id. */
  viewButtonUrl?: (id: NumericExpr) => Sql;
  /** Force-show the view button even when no record route is auto-detected. */
  viewButton?: boolean;
  /** Integrated record detail route and navigation configuration. */
  recordPage?: DatagridRecordPage;
  /**
   * Link rows to a sibling {@link StandaloneDatagridRecordPage} while retaining
   * navigation through the grid result set. Use this instead of `recordPage`
   * when the detail page is large enough to compile independently.
   */
  recordNavigation?: DatagridRecordNavigationConfig;
  /** Initial column order, visibility, sort, and filters. */
  defaultView?: DefaultView;
  /** Page-wide inline-edit gate. Per-field {@link FieldConfig.canEdit} overrides it. */
  canEdit?: BooleanExpr;
  /** Fields to skip when auto-generating columns (ignored when `columns` is given). */
  ignoreFields?: string[];
  /** Per-field overrides for auto-generated columns (ignored when `columns` is given). */
  fields?: FieldConfigs;
  /** Replaces the whole toolbar. Mutually exclusive with `toolbarRight`. */
  toolbar?: Node;
  /** Content placed at the right of the default toolbar. */
  toolbarRight?: Node;
  disableFiltering?: boolean;
  /** Disable saved views (the column/view management UI). */
  disableViews?: boolean;
  pageSize?: number;
  /** Imperative column builder. When provided, auto-field generation is skipped. */
  columns?: (builder: DatagridBuilder) => void;
  defaultRowHeight?: RowHeight;
  /** Extra `where` predicate AND-ed into every query. */
  additionalWhere?: Sql;
  /** Cap selectable rows; selection is blocked once reached. */
  maxSelectedRows?: number;
  /** Also validate queries for columns that are hidden by default. */
  validateHiddenColumnQueries?: boolean;
  /**
   * Toolbar quick-search input.
   * - `true` opts in using the table's `searchConfig` (all fuzzy, ranked).
   * - Object form configures fields and modes explicitly. Required when the table
   *   has no `searchConfig`, or when mixing modes (e.g. exact match on an id column
   *   alongside fuzzy match on names).
   */
  quickSearch?: true | QuickSearchConfig;
  /** Built-in and custom bulk actions; enabling any of these makes the grid selectable. */
  bulk?: {
    delete?: boolean;
    update?: boolean;
    export?: boolean;
    merge?: boolean;
    actions?: SnackbarBulkAction[];
  };
}

/** Configuration for a record detail route integrated into a {@link DatagridPage}. */
export interface DatagridRecordPage extends
  Omit<
    RecordPageContentProps,
    "table" | "children" | "recordWhere"
  > {
  /** Detail content rendered after the record and route state are loaded. */
  content: Node;
  /**
   * String or numeric field, or virtual-column storage name, whose displayed
   * value opens the record, replacing the separate per-row View button.
   */
  linkField?: string;
  /** Run the grid's full count query and show an exact result count. */
  showExactResultCount?: boolean;
}

/** Configuration for linking a grid to a separately registered record route. */
export interface DatagridRecordNavigationConfig {
  /**
   * String or numeric field, or virtual-column storage name, whose displayed
   * value opens the record, replacing the separate per-row View button.
   */
  linkField?: string;
}

/** Props for {@link StandaloneDatagridRecordPage}. */
export interface StandaloneDatagridRecordPageProps
  extends Omit<RecordPageContentProps, "table" | "children" | "recordWhere"> {
  /** Database table rendered by the record page. */
  table: string;
  /** Route of the corresponding list DataGrid. */
  listPath: string;
  /** Detail route path. Defaults to `${listPath}/{record_id:id}`. */
  path?: string;
  /** Run the grid's full count query and show an exact result count. */
  showExactResultCount?: boolean;
  /** Detail content rendered after the record and route state are loaded. */
  content: Node;
}

export type { ResolvedQuickSearch };

const QUICK_SEARCH_ALIAS = "record";

function buildQuickSearchFieldExpr(field: string): Sql {
  return sql`coalesce(cast(${sql.ref(QUICK_SEARCH_ALIAS)}.${
    sql.ref(field)
  } as string), '')`;
}

/**
 * Returns the SQL cast type for a `try_cast(<query> as ...)` gate when `mode: "exact"`
 * is configured for a field of this type. Returns undefined for string-like types
 * where any input is a valid candidate (no gate needed).
 *
 * When the gate is present, the target is dropped from the runtime predicate and
 * rank-key entirely if `try_cast(<query> as <type>)` is null — i.e. the user input
 * isn't a syntactically-valid value of that type. Useful e.g. for an int `br_id`
 * column: typing "John" should not bother filtering by `br_id`.
 */
function exactModeCastType(field: Field): string | undefined {
  const scalarType = fieldToAnalyzeType(field);
  switch (scalarType.type) {
    case "String":
    case "Enum":
    case "Ordering":
    case "Json":
    case "Interval":
    case "Bytes":
      return undefined;
    case "Bool":
      return "boolean";
    case "SmallInt":
    case "Int":
    case "BigInt":
    case "Real":
    case "Double":
    case "Decimal":
    case "Date":
    case "Timestamp":
    case "TimestampTz":
    case "TimestampNaive":
    case "Time":
    case "Uuid":
      return analyzeScalarTypeToSqlCast(scalarType);
  }
}

function resolveSingleEntry(
  table: Table,
  fc: QuickSearchFieldConfig,
  idx: number,
): QuickSearchTargetResolved {
  const mode: QuickSearchFieldMode = fc.mode ?? "fuzzy";
  const priority = fc.priority ?? idx;
  const fieldDef = table.fields[fc.field];
  const isVirtual = Boolean(table.virtuals[fc.field]);
  const isPrimaryKey = fc.field === table.primaryKeyFieldName;
  if (!fieldDef && !isVirtual && !isPrimaryKey) {
    throw new Error(
      `DatagridPage quickSearch: field '${fc.field}' not found on table '${table.name}'`,
    );
  }
  if (mode === "fuzzy") {
    if (!fieldDef) {
      throw new Error(
        `DatagridPage quickSearch: mode 'fuzzy' requires a String or PhoneNumber field; '${fc.field}' on '${table.name}' is ${
          isPrimaryKey ? "the primary key" : "a virtual field"
        }`,
      );
    }
    const t = fieldDef.type;
    if (t !== "String" && t !== "PhoneNumber") {
      throw new Error(
        `DatagridPage quickSearch: mode 'fuzzy' requires a String or PhoneNumber field; '${fc.field}' on '${table.name}' has type '${t}'`,
      );
    }
  }
  if (fieldDef) {
    const t = fieldDef.type;
    if (t === "Bytes" || t === "Json" || t === "Tx") {
      throw new Error(
        `DatagridPage quickSearch: field '${fc.field}' on '${table.name}' has unsupported type '${t}'`,
      );
    }
  }
  let inputGate: Sql | undefined;
  if (mode === "exact") {
    // For non-string fields, gate the target on whether the user input is a valid
    // value of that type. When it's not (e.g. typing "John" against an int column),
    // the target is dropped from the runtime SQL entirely.
    let castType: string | undefined;
    if (fieldDef) {
      castType = exactModeCastType(fieldDef);
    } else if (isPrimaryKey) {
      // Primary keys aren't in `table.fields`; assume the conventional BigInt id.
      castType = "bigint";
    }
    if (castType) {
      // Boolean evaluated at dynamic-query assembly time — `q` is the in-scope UI
      // scalar there. `try_cast(... as <type>) is not null` is true when the user
      // input is a syntactically-valid value of `castType`.
      inputGate = sql`try_cast(coalesce(q, '') as ${
        sql(castType)
      }) is not null`;
    }
  }
  return {
    expr: buildQuickSearchFieldExpr(fc.field),
    mode,
    priority,
    inputGate,
  };
}

function resolveGroupEntry(
  table: Table,
  gc: QuickSearchGroupConfig,
  idx: number,
): QuickSearchTargetResolved {
  if (!gc.fields || gc.fields.length === 0) {
    throw new Error(
      `DatagridPage quickSearch: group at index ${idx} has empty 'fields'`,
    );
  }
  const mode = gc.mode ?? "fuzzy";
  if ((mode as string) === "exact") {
    throw new Error(
      `DatagridPage quickSearch: group at index ${idx} cannot use mode 'exact'; use 'fuzzy' or 'contains'`,
    );
  }
  const priority = gc.priority ?? idx;
  // Validate every field in the group: must exist; must be string-like for fuzzy.
  for (const f of gc.fields) {
    const fieldDef = table.fields[f];
    if (!fieldDef && !table.virtuals[f] && f !== table.primaryKeyFieldName) {
      throw new Error(
        `DatagridPage quickSearch: group field '${f}' not found on table '${table.name}'`,
      );
    }
    if (mode === "fuzzy" && fieldDef) {
      const t = fieldDef.type;
      if (t !== "String" && t !== "PhoneNumber") {
        throw new Error(
          `DatagridPage quickSearch: group field '${f}' on '${table.name}' has type '${t}'; mode 'fuzzy' requires String or PhoneNumber`,
        );
      }
    }
  }
  // Concatenate `coalesce(cast(record.<field> as string), '')` for each field with
  // single-space separators — mirrors what `buildRankedSearchTargets` produces for
  // SearchDialog field groups so the two stay in sync.
  const parts: Sql[] = [];
  gc.fields.forEach((f, i) => {
    if (i > 0) parts.push(sql.lit` `);
    parts.push(buildQuickSearchFieldExpr(f));
  });
  const expr = sql.concat(...parts);
  return { expr, mode, priority };
}

function resolveQuickSearch(
  table: Table,
  config: true | QuickSearchConfig,
): ResolvedQuickSearch {
  if (config === true) {
    const sc = table.getSearchConfig();
    if (!sc) {
      throw new Error(
        `DatagridPage quickSearch: true requires table '${table.name}' to declare searchConfig({...})`,
      );
    }
    // Reuse SearchDialog's target builder so single fields and field groups behave
    // identically across SearchDialog and DatagridPage quickSearch (groups concat).
    const ranked = buildRankedSearchTargets(sc, QUICK_SEARCH_ALIAS);
    if (ranked.length === 0) {
      throw new Error(
        `DatagridPage quickSearch: searchConfig on table '${table.name}' has no fields`,
      );
    }
    const targets: QuickSearchTargetResolved[] = ranked.map((t) => ({
      expr: t.expr,
      mode: "fuzzy",
      priority: t.priority,
    }));
    return { targets, rank: true, placeholder: "Search…" };
  }
  if (!config.fields || config.fields.length === 0) {
    throw new Error(
      "DatagridPage quickSearch: 'fields' must be a non-empty array",
    );
  }
  const targets: QuickSearchTargetResolved[] = [];
  config.fields.forEach((entry, idx) => {
    if (typeof entry === "string") {
      targets.push(resolveSingleEntry(table, { field: entry }, idx));
    } else if ("fields" in entry) {
      targets.push(resolveGroupEntry(table, entry, idx));
    } else {
      targets.push(resolveSingleEntry(table, entry, idx));
    }
  });
  return {
    targets,
    rank: config.rank,
    placeholder: config.placeholder ?? "Search…",
  };
}

function DatagridPageInner(props: DatagridPageProps) {
  const datagridName = props.datagridName ?? props.table;
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  if (props.toolbarRight && props.toolbar) {
    throw new Error("toolbarRight and toolbar cannot both be provided");
  }
  if (props.recordPage && props.recordNavigation) {
    throw new Error(
      "recordPage and recordNavigation cannot both be provided",
    );
  }
  const hasRecordPage = Boolean(props.recordPage);
  const hasRecordNavigation = hasRecordPage || Boolean(props.recordNavigation);
  if (hasRecordNavigation && props.viewButtonUrl) {
    throw new Error(
      "recordPage/recordNavigation and viewButtonUrl cannot both be provided",
    );
  }
  const recordLinkField = props.recordPage?.linkField ??
    props.recordNavigation?.linkField;
  const captureRecordNavigation = props.recordNavigation
    ? (s: DomStatements) =>
      captureDatagridRecordNavigation(s, {
        pageSize: props.pageSize ?? 100,
        rowCountScalar: `ui.${DATAGRID_RECORD_NAVIGATION_ROW_COUNT}`,
      })
    : captureDatagridRecordNavigation;
  if (recordLinkField && props.viewButton) {
    throw new Error(
      "recordPage.linkField and viewButton cannot both be provided",
    );
  }
  if (
    recordLinkField &&
    table.fields[recordLinkField] &&
    ![
      "String",
      "TinyInt",
      "SmallInt",
      "Int",
      "BigInt",
      "TinyUint",
      "SmallUint",
      "Uint",
      "BigUint",
      "Decimal",
      "Double",
      "Real",
    ].includes(table.fields[recordLinkField].type)
  ) {
    throw new Error(
      "recordPage.linkField must identify a string or numeric field, or virtual column",
    );
  }
  const path = props.path ?? `/${getTableBaseUrl(props.table)}`;
  let toolbar = props.toolbar;
  if (!toolbar && props.toolbarRight) {
    toolbar = <DatagridToolbar>{props.toolbarRight}</DatagridToolbar>;
  }
  const hasViewButton = !recordLinkField &&
    (hasRecordNavigation ||
      typeof props.viewButtonUrl === "function" ||
      props.viewButton ||
      getHrefToRecordOptional(table, sql`0`));
  let viewButtonUrl: ((id: NumericExpr) => Sql) | undefined;
  if (hasViewButton) {
    viewButtonUrl = hasRecordNavigation
      ? (id) => datagridRecordUrl(path, id)
      : typeof props.viewButtonUrl === "function"
      ? props.viewButtonUrl
      : (id) => getHrefToRecordOptional(table, id);
  }
  const gatherCtx = new DynamicDatagridGatherContext(table);
  addCtx(gatherCtx);
  gatherChildrenContextInfo(props.toolbar);
  let selectable = gatherCtx.needsSelectable ||
    (props.selectable ?? false) ||
    (props.bulk?.delete ?? false) ||
    (props.bulk?.update ?? false) ||
    (props.bulk?.export ?? false) ||
    (props.bulk?.merge ?? false) ||
    (props.bulk?.actions?.length ?? 0) > 0;
  const builder = new DatagridBuilder(
    table,
    props.canEdit ?? true,
    selectable,
    viewButtonUrl,
    props.maxSelectedRows,
    recordLinkField
      ? {
        field: recordLinkField,
        href: (id) => datagridRecordUrl(path, id),
        beforeNavigate: captureRecordNavigation,
      }
      : undefined,
    hasRecordNavigation && !recordLinkField
      ? captureRecordNavigation
      : undefined,
  );
  if (props.bulk?.merge) {
    builder.addSnackbarBulkAction(datagridRecordMergeBulkAction(props.table));
  }
  for (const action of props.bulk?.actions ?? []) {
    builder.addSnackbarBulkAction(action);
  }
  if (props.columns) {
    props.columns(builder);
  } else {
    builder.autoFields({
      ignoreFields: props.ignoreFields,
      fields: props.fields,
    });
  }
  for (const block of table.allBlocks()) {
    block.populateDatagrid(builder);
  }
  const columns = builder.getColumns();
  if (recordLinkField) {
    const recordLinkColumn = columns.find((column) =>
      column.viewStorageName === recordLinkField && column.displayInfo &&
      column.queryGeneration
    );
    if (!recordLinkColumn) {
      throw new Error(
        `recordPage.linkField ${recordLinkField} must be added as a displayed field column`,
      );
    }
    recordLinkColumn.canHide = false;
    recordLinkColumn.displayInfo!.initiallyDisplaying = true;
  }
  const bulkActions = builder.getBulkActions();
  if (props.defaultView?.columnOrder) {
    if (
      viewButtonUrl &&
      !props.defaultView.columnOrder.includes("dg_view_button_col")
    ) {
      props.defaultView.columnOrder.unshift("dg_view_button_col");
    }
    if (
      selectable &&
      !props.defaultView.columnOrder.includes("dg_checkbox_col")
    ) {
      props.defaultView.columnOrder.unshift("dg_checkbox_col");
    }
  }
  if (props.defaultView?.displayColumns) {
    if (
      viewButtonUrl &&
      !props.defaultView.displayColumns.includes("dg_view_button_col")
    ) {
      props.defaultView.displayColumns.unshift("dg_view_button_col");
    }
    if (
      selectable &&
      !props.defaultView.displayColumns.includes("dg_checkbox_col")
    ) {
      props.defaultView.displayColumns.unshift("dg_checkbox_col");
    }
  }
  selectable = selectable || bulkActions.length > 0;
  const resolvedQuickSearch = props.quickSearch
    ? resolveQuickSearch(table, props.quickSearch)
    : undefined;
  const datagrid = (
    <DynamicDatagrid
      tableModel={table}
      selectable={selectable}
      toolbar={toolbar}
      datagridName={datagridName}
      enableFiltering={!props.disableFiltering}
      enableViews={!props.disableViews}
      pageSize={props.pageSize ?? 100}
      defaultView={props.defaultView}
      defaultRowHeight={props.defaultRowHeight}
      additionalWhere={props.additionalWhere}
      validateHiddenColumnQueries={props.validateHiddenColumnQueries}
      quickSearch={resolvedQuickSearch}
      columns={columns}
      bulkActionsProps={{
        actions: bulkActions,
        delete: props.bulk?.delete,
        update: props.bulk?.update,
        export: props.bulk?.export,
        maxSelectedRows: props.maxSelectedRows,
      }}
      recordPage={hasRecordPage
        ? {
          listPath: path,
          detailPath: `${path}/{record_id:id}`,
          showExactResultCount: props.recordPage!.showExactResultCount ?? false,
          content: (
            <RecordPageContent
              table={props.table}
              title={props.recordPage!.title}
              routeState={props.recordPage!.routeState}
              sx={props.recordPage!.sx}
              queryParams={props.recordPage!.queryParams}
              pendingFallback={props.recordPage!.pendingFallback}
              errorFallback={props.recordPage!.errorFallback}
              statusScalar={props.recordPage!.statusScalar}
              recordWhere={props.additionalWhere
                ? sql`datagrid_record_allowed`
                : undefined}
            >
              {props.recordPage!.content}
            </RecordPageContent>
          ),
        }
        : undefined}
      standaloneRecordNavigation={props.recordNavigation
        ? { listPath: path }
        : undefined}
      extraState={(s) => {
        s.defScalar("open_column_dialog", {
          type: "BigUint",
        });
        if (selectable) {
          s.defScalar("selected_all", false);
          s.defTable("selected_row", {
            fields: [{ name: "id", type: "BigUint" }],
          });
        }
      }}
    />
  );
  const canEdit = props.canEdit;
  if (sql.isDynamicExpr(canEdit)) {
    return (
      <Data
        procedure={(s) => {
          s.defScalar("global_can_edit", canEdit);
        }}
      >
        {datagrid}
      </Data>
    );
  }
  return datagrid;
}

/**
The DatagridPage is Yolm's main component for handling data for a table.
It is a full-blockd grid editor with inline editing, validation, sort, filter, bulk edits, export and much more.
It is the ultimate CRUD component for tables.
For most use cases, you will want to use this component.
To add support for insert, use the toolbar prop and add an DatagridToolbar.AutoInsertButton.

**Self-routing: do NOT wrap in a Route component.**

Common mistakes:
- If a table has a foreign key relationship to other tables, and the other table does not use default search fields (first_name, last_name, name, title, etc),
ensure that the referenced table has a search configuration defined.
- You generally do not need to specify the path property, it will default to the table name, sql.g. "/systems" for the systems table.

@category Page Component, Initial
*/
export function DatagridPage(props: DatagridPageProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const path = props.path ?? `/${getTableBaseUrl(props.table)}`;
  if (props.recordPage || props.recordNavigation) {
    useSharedContext(TableLinksSharedContext).add(
      table,
      (id) => sql.concat(`${path}/`, id),
    );
  }
  const title = props.title ?? table.displayName;
  useSharedContext(NavigationItemsSharedContext).add({
    label: table.displayName,
    url: path,
  });
  useSharedContext(PagesSharedContext).add(
    path,
    table.displayName,
    "DatagridPage",
  );
  validateDatagridViewTables(props.datagridName ?? props.table);
  const inner = (
    <>
      <DocumentTitle>{title}</DocumentTitle>
      <DatagridPageInner {...props} />
    </>
  );
  const content = props.wrapper ? props.wrapper(inner) : inner;
  return (
    <Route path={path}>
      {content}
    </Route>
  );
}

DatagridPage.getSource = (props: DatagridPageProps) =>
  `DatagridPage table=${props.table}`;

/**
 * Registers a record detail route for a {@link DatagridPage} configured with
 * `recordNavigation`. Keeping this as a sibling route prevents the list route
 * from compiling the detail page's UI and procedures.
 *
 * **Self-routing: do NOT wrap in a Route component.**
 */
export function StandaloneDatagridRecordPage(
  props: StandaloneDatagridRecordPageProps,
) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const path = props.path ?? `${props.listPath}/{record_id:id}`;
  useSeparatedDatagridRecordNavigationState();
  useSharedContext(TableLinksSharedContext).add(
    table,
    (id) => sql.concat(`${props.listPath}/`, id),
  );
  return (
    <Route path={path}>
      <DatagridRecordNavigation
        datagridName={props.listPath}
        listPath={props.listPath}
        pageSize={sql`ui.${sql.ref(DATAGRID_RECORD_NAVIGATION_PAGE_SIZE)}`}
        dynamicQuery={sql.concat(
          sql`ui.${sql.ref(DATAGRID_RECORD_NAVIGATION_QUERY_PREFIX)}`,
          " limit ",
          sql`ui.${sql.ref(DATAGRID_RECORD_NAVIGATION_ROW_COUNT)} + 1`,
          ")",
        )}
        countQuery={sql`ui.${sql.ref(DATAGRID_RECORD_NAVIGATION_COUNT_QUERY)}`}
        columnCount={1}
        showExactResultCount={props.showExactResultCount ?? false}
        rowCount={sql`ui.${sql.ref(DATAGRID_RECORD_NAVIGATION_ROW_COUNT)}`}
        rowCountScalar={`ui.${DATAGRID_RECORD_NAVIGATION_ROW_COUNT}`}
      />
      <RecordPageContent
        table={props.table}
        title={props.title}
        routeState={props.routeState}
        sx={props.sx}
        queryParams={props.queryParams}
        pendingFallback={props.pendingFallback}
        errorFallback={props.errorFallback}
        statusScalar={props.statusScalar}
      >
        {props.content}
      </RecordPageContent>
    </Route>
  );
}

StandaloneDatagridRecordPage.getSource = (
  props: StandaloneDatagridRecordPageProps,
) => `StandaloneDatagridRecordPage table=${props.table}`;
