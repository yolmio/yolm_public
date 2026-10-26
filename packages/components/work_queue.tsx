import { Alert } from "components/alert";
import { MaterialIcon } from "components/material_icon";
import { Table } from "components/table";
import { Data } from "std/data";
import { analyzeQueryWithContext } from "std/ictx";
import { normalizeCase, upcaseFirst } from "std/inflectors";
import { sql } from "std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { createStyles } from "std/style_utils";
import { system } from "std/system";
import {
  addCtx,
  type ContextInstance,
  createICtxKey,
  Each,
  EventHandlers,
  gatherChildrenContextInfo,
  type ICtxKey,
  type Node,
  Show,
  useOptionalICtx,
  usePhase,
  useQueryParams,
} from "std/ui";
import type { AnalyzeScalarType, QueryColumnInfo } from "std/yolm_gen_api";

// ============================================================================
// Types
// ============================================================================

interface ResolvedColumn {
  name: string;
  header: Node;
  width?: number | string;
  render: (row: Sql) => Node;
  hidden?: boolean;
  sortable: boolean;
}

interface WorkQueueColumnOverride {
  field: string;
  header?: Node;
  hidden?: boolean;
  format?: "date" | "datetime" | "currency" | "decimal" | "percent";
  width?: number | string;
  render?: (row: Sql) => Node;
  sortable?: boolean;
}

interface FooterConfig {
  height: number;
  resizable: boolean;
  minHeight: number;
  maxHeight: number;
}

// ============================================================================
// Context
// ============================================================================

interface WorkQueueICtx {
  queryName: string;
  rowKey: string;
  selectedParam: string;
  analyzedColumns: QueryColumnInfo[];
  resolvedColumns: ResolvedColumn[];
  emptyMessage?: Node;
}

const WorkQueueICtxKey = createICtxKey<WorkQueueICtx>("WorkQueueICtx");

class WorkQueueContext implements ContextInstance, WorkQueueICtx {
  implementICtxs: ICtxKey<any>[] = [WorkQueueICtxKey];

  queryName: string;
  rowKey: string;
  selectedParam: string;
  analyzedColumns: QueryColumnInfo[];
  resolvedColumns: ResolvedColumn[];
  emptyMessage?: Node;

  constructor(opts: WorkQueueICtx) {
    this.queryName = opts.queryName;
    this.rowKey = opts.rowKey;
    this.selectedParam = opts.selectedParam;
    this.analyzedColumns = opts.analyzedColumns;
    this.resolvedColumns = opts.resolvedColumns;
    this.emptyMessage = opts.emptyMessage;
  }
}

// Gather context for collecting column overrides and footer config
interface WorkQueueGatherICtx {
  columnOverrides: WorkQueueColumnOverride[];
  footerConfig?: FooterConfig;
}

const WorkQueueGatherICtxKey = createICtxKey<WorkQueueGatherICtx>(
  "WorkQueueGatherICtx",
);

class WorkQueueGatherContext implements ContextInstance, WorkQueueGatherICtx {
  implementICtxs: ICtxKey<any>[] = [WorkQueueGatherICtxKey];
  columnOverrides: WorkQueueColumnOverride[] = [];
  footerConfig?: FooterConfig;
}

// ============================================================================
// Styles
// ============================================================================

const styles = createStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    position: "relative",
  },
  confirmationOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 60,
    // Status feedback must not swallow the user's next header action while
    // its dismissal timer runs (for example Done -> Process All in Auto Review).
    pointerEvents: "none",
  },
  tableContainer: {
    flex: 1,
    overflow: "auto",
    borderBottom: "1px solid",
    borderColor: "divider",
  },
  row: {
    cursor: "pointer",
    "&:hover": {
      backgroundColor: "background-level1",
    },
    "&[aria-selected='true']": {
      backgroundColor: "primary-100",
    },
  },
  headerCell: {
    px: 3,
    py: 2,
    textAlign: "left",
    fontSize: "xs",
    fontWeight: "medium",
    color: "text-secondary",
  },
  headerCellSortable: {
    px: 3,
    py: 2,
    textAlign: "left",
    fontSize: "xs",
    fontWeight: "medium",
    color: "text-secondary",
    cursor: "pointer",
    userSelect: "none",
    "&:hover": {
      backgroundColor: "background-level1",
    },
  },
  cell: {
    px: 3,
    py: 2,
  },
  footer: {
    flexShrink: 0,
    backgroundColor: "background-body",
    overflow: "hidden",
  },
  emptyState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "text-tertiary",
  },
  resizeHandle: {
    height: 6,
    cursor: "row-resize",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderTop: "1px solid",
    borderColor: "divider",
    "& > div": {
      visibility: "hidden",
    },
    "&:hover > div, &.active > div": {
      visibility: "visible",
    },
  },
  resizeBar: {
    width: "100%",
    height: 3,
    borderRadius: "1.5px",
    backgroundColor: "primary-400",
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

function inflectHeader(name: string): string {
  return upcaseFirst(normalizeCase(name).join(" "));
}

function buildDefaultRenderer(
  col: QueryColumnInfo,
  format?: string,
): (row: Sql) => Node {
  return (row: Sql) => {
    const value = sql`${row}.${sql.ref(col.name)}`;

    // Use explicit format if provided
    if (format === "date") return sql`format.date(${value}, '%-m/%-d/%y')`;
    if (format === "datetime") {
      return sql`format.date(${value}, '%-m/%-d/%y %-I:%M %p')`;
    }
    if (format === "currency") return sql`format.currency(${value}, 'USD')`;
    if (format === "decimal") return sql`format.decimal(${value})`;
    if (format === "percent") return sql`format.percent(${value})`;

    // Otherwise infer from type
    switch (col.type.type) {
      case "Date":
        return sql`format.date(${value}, '%-m/%-d/%y')`;
      case "Timestamp":
      case "TimestampTz":
      case "TimestampNaive":
        return sql`format.date(${value}, '%-m/%-d/%y %-I:%M %p')`;
      case "Bool":
        return (
          <Show when={value}>
            <MaterialIcon icon="Check" fontSize="sm" />
          </Show>
        );
      case "Enum":
        return sql`fn.display_${
          sql((col.type as { type: "Enum"; enum: string }).enum)
        }(${value})`;
      case "Decimal":
        return sql`format.decimal(${value})`;
      case "SmallInt":
      case "Int":
      case "BigInt":
      case "Real":
      case "Double":
      case "Ordering":
      case "Time":
      case "String":
      case "Uuid":
      case "Json":
      case "Interval":
      case "Bytes":
        return value;
    }
  };
}

function buildColumns(
  analyzed: QueryColumnInfo[],
  overrides: WorkQueueColumnOverride[],
): ResolvedColumn[] {
  const overrideMap = new Map<string, WorkQueueColumnOverride>();
  const overrideOrder: string[] = [];
  for (const override of overrides) {
    if (!overrideMap.has(override.field)) {
      overrideOrder.push(override.field);
    }
    overrideMap.set(override.field, override);
  }
  const analyzedMap = new Map(analyzed.map((col) => [col.name, col]));
  const result: ResolvedColumn[] = [];

  const addColumn = (
    col: QueryColumnInfo,
    override?: WorkQueueColumnOverride,
  ) => {
    // Skip internal columns
    if (col.name.startsWith("_wq_")) return;

    if (override?.hidden) return;

    result.push({
      name: col.name,
      header: override?.header ?? inflectHeader(col.name),
      width: override?.width,
      render: override?.render ?? buildDefaultRenderer(col, override?.format),
      hidden: override?.hidden,
      sortable: override?.sortable ?? true,
    });
  };

  for (const field of overrideOrder) {
    const col = analyzedMap.get(field);
    if (!col) continue;
    addColumn(col, overrideMap.get(field));
  }

  return result;
}

function dynamicQueryWithRowNum(query: Sql): Sql {
  return sql.concat(
    "select *, row_number() over () as _wq_row_num from (",
    query,
    ") as _wq_rn",
  );
}

function dynamicOrderByClause(columns: ResolvedColumn[]): Sql {
  if (columns.length === 0) {
    return sql.lit``;
  }

  let expr = sql`case`;
  for (const col of columns) {
    const colRef = sql.ref(col.name).toSQL();
    expr = sql`${expr}
      when wq_sort_col = ${sql.lit(col.name)} and wq_sort_dir = 'asc'
        then ${sql.lit(`${colRef} asc`)}
      when wq_sort_col = ${sql.lit(col.name)} and wq_sort_dir = 'desc'
        then ${sql.lit(`${colRef} desc`)}`;
  }
  return sql`${expr} else '' end`;
}

function dynamicQueryWithSort(query: Sql, columns: ResolvedColumn[]): Sql {
  if (columns.length === 0) {
    return query;
  }

  return sql`
    (
      select
        case
          when _wq_order_clause = '' then _wq_base_query
          else concat(
            'select * from (',
            _wq_base_query,
            ') as _wq order by ',
            _wq_order_clause
          )
        end
      from (
        select
          ${query} as _wq_base_query,
          ${dynamicOrderByClause(columns)} as _wq_order_clause
      ) as _wq_dynamic_sort
    )
  `;
}

export interface WorkQueueConditionalFilter {
  /** Includes `clause` in the queue query only while this expression is true. */
  when: BooleanExpr;
  /** Predicate over projected WorkQueue columns and scoped SQL values. */
  clause: Sql;
}

function conditionalWhereClause(filters: WorkQueueConditionalFilter[]): Sql {
  return sql.concat(
    filters.map((filter) =>
      sql`case when ${filter.when} then ${
        sql.lit(` and (${filter.clause.toSQL()})`)
      } else '' end`
    ),
  );
}

function dynamicQueryWithConditionalFilters(
  query: Sql,
  filters: WorkQueueConditionalFilter[] | undefined,
): Sql {
  if (!filters || filters.length === 0) {
    return query;
  }

  return sql`
    (
      select
        case
          when _wq_where_clause = '' then _wq_base_query
          else concat(
            'select * from (',
            _wq_base_query,
            ') as _wq where true',
            _wq_where_clause
          )
        end
      from (
        select
          ${query} as _wq_base_query,
          ${conditionalWhereClause(filters)} as _wq_where_clause
      ) as _wq_dynamic_filters
    )
  `;
}

function enumFromDynamicField(field: Sql, enumName: string): Sql {
  const enumModel = system.enums[enumName];
  if (!enumModel) {
    return sql`try_cast(${field} as enums.${sql.ref(enumName)})`;
  }

  let expr = sql`case`;
  for (const value of enumModel.valuesMap.keys()) {
    expr = sql`${expr}
      when ${field} = ${sql.lit(value)}
        then ${sql.lit(value)}::enums.${sql.ref(enumName)}`;
  }

  return sql`${expr} else null::enums.${sql.ref(enumName)} end`;
}

function castDynamicField(
  field: Sql,
  type: AnalyzeScalarType | undefined,
): Sql {
  if (!type || type.type === "String") {
    return field;
  }

  switch (type.type) {
    case "Bool":
      return sql`try_cast(${field} as bool)`;
    case "SmallInt":
      return sql`try_cast(${field} as smallint)`;
    case "Int":
      return sql`try_cast(${field} as int)`;
    case "BigInt":
      return sql`try_cast(${field} as bigint)`;
    case "Real":
      return sql`try_cast(${field} as real)`;
    case "Double":
      return sql`try_cast(${field} as double)`;
    case "Decimal":
      return sql`try_cast(${field} as decimal(${type.precision}, ${type.scale}))`;
    case "Ordering":
      return sql`try_cast(${field} as ordering)`;
    case "Date":
      return sql`try_cast(${field} as date)`;
    case "Timestamp":
    case "TimestampTz":
      return sql`try_cast(${field} as timestamptz)`;
    case "TimestampNaive":
      return sql`try_cast(${field} as timestamp)`;
    case "Enum":
      return enumFromDynamicField(field, type.enum);
    case "Time":
      return sql`try_cast(${field} as time)`;
    case "Uuid":
      return sql`try_cast(${field} as uuid)`;
    case "Json":
      return sql`try_cast(${field} as json)`;
    case "Interval":
      return sql`try_cast(${field} as interval)`;
    case "Bytes":
      return sql`try_cast(${field} as bytes)`;
  }
}

// ============================================================================
// WorkQueue Namespace
// ============================================================================

/**
 * A productivity-focused work queue component for processing items one at a time.
 *
 * Features:
 * - Renders only explicitly declared WorkQueue.Column entries
 * - URL-based selection persistence
 * - Keyboard navigation (↑↓ arrows, Escape)
 * - Header and footer slots with selected record access
 * - Auto-scrolls selected row into view
 * - Clickable column headers for sorting (asc → desc → none)
 * - Resizable footer panel via drag handle
 *
 * @example
 * ```tsx
 * <WorkQueue.Root
 *   query={sql`select id, title, created_at from db.todos where done = false`}
 *   rowKey="id"
 * >
 *   <WorkQueue.Header>
 *     {(selected, count) => <Typography>Queue ({count})</Typography>}
 *   </WorkQueue.Header>
 *
 *   <WorkQueue.Table>
 *     <WorkQueue.Column field="title" />
 *     <WorkQueue.Column field="created_at" format="date" />
 *   </WorkQueue.Table>
 *
 *   <WorkQueue.Footer>
 *     {(selected) => (
 *       <Button onClick={(s) => markDone(s, sql`${selected}.id`)}>
 *         Mark Done
 *       </Button>
 *     )}
 *   </WorkQueue.Footer>
 * </WorkQueue.Root>
 * ```
 *
 * @category UI Component
 */
export function WorkQueue() {
  return null;
}

// ============================================================================
// WorkQueue.Root
// ============================================================================

export interface WorkQueueRootProps {
  /** SQL query for queue items */
  query: Sql;
  /** Runtime filter clauses included only while their `when` expressions are true. */
  conditionalFilters?: WorkQueueConditionalFilter[];
  /** Column name for row identity (must be in query) */
  rowKey: string;
  /** Watch expressions to trigger refresh */
  watch?: AnyExpr | AnyExpr[];
  /**
   * Automatically watch query inputs (default: true). When false, the caller must
   * include every UI query and conditional-filter input in watch. Sorting and
   * global refetch remain watched internally.
   */
  autoWatch?: boolean;
  /** Message to show when queue is empty */
  emptyMessage?: Node;
  /** Children: WorkQueue.Header, WorkQueue.Table, WorkQueue.Footer */
  children: Node;
}

WorkQueue.Root = function Root(props: WorkQueueRootProps) {
  const queryName = "wq_items";
  const phase = usePhase();

  // Create gather context for collecting column overrides and footer config
  const gatherCtx = new WorkQueueGatherContext();
  addCtx(gatherCtx);

  if (phase === "gather") {
    return props.children;
  }

  // Gather children to collect column overrides and footer config
  gatherChildrenContextInfo(props.children);

  // Try to analyze query at generation time
  const analysis = analyzeQueryWithContext(props.query);

  if (analysis.status === "error") {
    throw new Error(
      `WorkQueue: failed to analyze query: ${analysis.message}`,
    );
  }
  const overrides = gatherCtx.columnOverrides;
  const analyzedColumns = analysis.columns;
  if (!analyzedColumns.some((c) => c.name === props.rowKey)) {
    throw new Error(
      `WorkQueue rowKey "${props.rowKey}" not found in query columns: ${
        analyzedColumns.map((c) => c.name).join(", ")
      }`,
    );
  }

  // Build resolved columns (moved from Table to Root for sort branch generation)
  const resolvedColumns = buildColumns(analyzedColumns, overrides);

  // Add row_number to query for keyboard navigation
  const queryWithRowNum = sql`
    select *, row_number() over () as _wq_row_num
    from (${props.query}) as _wq_inner
  `;

  // Create main context
  const ctx = new WorkQueueContext({
    queryName,
    rowKey: props.rowKey,
    selectedParam: "wq_selected_id",
    analyzedColumns,
    resolvedColumns,
    emptyMessage: props.emptyMessage,
  });
  addCtx(ctx);

  // Build watch array
  const watchExprs: AnyExpr[] = [];
  if (Array.isArray(props.watch)) {
    watchExprs.push(...props.watch);
  } else if (props.watch) {
    watchExprs.push(props.watch);
  }

  useQueryParams([
    { name: "wq_selected_id", type: "BigInt", history: "push" },
  ]);

  // Footer config from gather phase
  const footerConfig = gatherCtx.footerConfig;
  const footerResizable = footerConfig?.resizable ?? false;
  const footerHeight = footerConfig?.height ?? 280;

  // Sortable columns for dynamic order clause generation
  const sortableCols = resolvedColumns.filter((c) => c.sortable);
  const dynamicColumnNames = analyzedColumns.map((col) => col.name);
  const analyzedColumnByName = new Map(
    analyzedColumns.map((col) => [col.name, col]),
  );

  return (
    <div sx={styles.root}>
      {/* Outer Data: local UI state (sort, resize, confirmation) */}
      <Data
        local
        noRefetch
        procedure={(s) => {
          // Sort state
          s.defScalar("wq_sort_col", sql.lit``);
          s.defScalar("wq_sort_dir", sql.lit`asc`);
          // Confirmation bar state
          s.defScalar("wq_confirmation_msg", sql.lit``);
          s.defScalar("wq_confirmation_visible", sql`false`);
          s.defScalar("wq_confirmation_color", sql.lit`success`);
          // Resize state
          if (footerResizable) {
            s.defScalar("wq_footer_height", sql`${footerHeight}`);
            s.defScalar("wq_resize_start_height", { type: "BigInt" });
            s.defScalar("wq_resize_start_y", { type: "BigInt" });
            s.defScalar("wq_resize_pending", { type: "BigInt" });
            s.defScalar("wq_resize_waiting", false);
          }
        }}
      >
        {/* Confirmation bar — overlays the queue so it never reflows the table */}
        <div sx={styles.confirmationOverlay}>
          <Show
            when={sql`wq_confirmation_visible and wq_confirmation_color = 'success'`}
          >
            <div
              className="flex items-center gap-2 px-3 py-1.5 bg-success-soft text-success-soft text-sm border-b border-success-200"
              onMount={(s) => {
                s.sleep(3500);
                s.setScalar("wq_confirmation_visible", sql`false`);
              }}
            >
              <MaterialIcon icon="CheckCircle" fontSize="sm" />
              <span>{sql`wq_confirmation_msg`}</span>
            </div>
          </Show>
          <Show
            when={sql`wq_confirmation_visible and wq_confirmation_color = 'danger'`}
          >
            <div
              className="flex items-center gap-2 px-3 py-1.5 bg-danger-soft text-danger-soft text-sm border-b border-danger-200"
              onMount={(s) => {
                s.sleep(3500);
                s.setScalar("wq_confirmation_visible", sql`false`);
              }}
            >
              <MaterialIcon icon="Error" fontSize="sm" />
              <span>{sql`wq_confirmation_msg`}</span>
            </div>
          </Show>
          <Show
            when={sql`wq_confirmation_visible and wq_confirmation_color = 'warning'`}
          >
            <div
              className="flex items-center gap-2 px-3 py-1.5 bg-warning-soft text-warning-soft text-sm border-b border-warning-200"
              onMount={(s) => {
                s.sleep(3500);
                s.setScalar("wq_confirmation_visible", sql`false`);
              }}
            >
              <MaterialIcon icon="Warning" fontSize="sm" />
              <span>{sql`wq_confirmation_msg`}</span>
            </div>
          </Show>
        </div>

        {/* Inner Data: server query through dynamicQuery */}
        <Data
          autoWatch={props.autoWatch}
          procedure={(s) => {
            // Declare table shape (columns inferred from queryWithRowNum)
            s.defTable(queryName, { inferQuery: queryWithRowNum });
            s.defScalar("wq_count", { type: "BigInt" });
            s.defScalar("wq_revision", sql`0`);

            const dynamicResultName = "wq_dynamic_items";
            s.defTable(dynamicResultName, {
              fields: Array.from(
                { length: dynamicColumnNames.length + 1 },
                (_, i) => ({
                  name: `field_${i}`,
                  type: "String" as const,
                }),
              ),
            });
            const baseDynamicQuery = sql.lit(props.query.toSQL());
            const filteredDynamicQuery = dynamicQueryWithConditionalFilters(
              baseDynamicQuery,
              props.conditionalFilters,
            );
            const rowNumField = `field_${dynamicColumnNames.length}`;
            s.dynamicQuery({
              setResultTable: dynamicResultName,
              query: dynamicQueryWithRowNum(
                dynamicQueryWithSort(filteredDynamicQuery, sortableCols),
              ),
              columnCount: dynamicColumnNames.length + 1,
              accessibleTableScopes: ["ui"],
            });
            s.modify(
              sql`insert into ${sql.ref(queryName)} (${
                [
                  ...dynamicColumnNames.map((name) => sql.ref(name)),
                  sql.ref("_wq_row_num"),
                ].reduce((a, b) => sql`${a}, ${b}`)
              })
	                select ${
                [
                  ...dynamicColumnNames.map((name, i) =>
                    castDynamicField(
                      sql.ref(`field_${i}`),
                      analyzedColumnByName.get(name)?.type,
                    )
                  ),
                  castDynamicField(sql.ref(rowNumField), { type: "BigInt" }),
                ].reduce((a, b) => sql`${a}, ${b}`)
              }
	                from ${sql.ref(dynamicResultName)}
	                order by ${
                castDynamicField(sql.ref(rowNumField), {
                  type: "BigInt",
                })
              }`,
            );
            s.setScalar(
              "wq_count",
              sql`(select count(*) from ${sql.ref(queryName)})`,
            );
            s.setScalar("wq_revision", sql`wq_revision + 1`);
          }}
          watch={[...watchExprs, sql`wq_sort_col`, sql`wq_sort_dir`]}
          pendingFallback={null}
          errorRecord="wq_error"
          errorFallback={
            <div className="p-3">
              <Alert variant="soft" color="danger" startIcon="Error" size="sm">
                {sql`'Unable to load queue. ' || coalesce(wq_error.message, wq_error.description, cast(wq_error.type as string), 'Unknown error')`}
              </Alert>
            </div>
          }
        >
          {props.children}

          {/* Keyboard navigation */}
          <WorkQueueKeyboard
            rowKey={props.rowKey}
            queryName={queryName}
          />
        </Data>
      </Data>
    </div>
  );
};

function WorkQueueKeyboard({
  rowKey,
  queryName,
}: {
  rowKey: string;
  queryName: string;
}) {
  const interactiveElementSelector = [
    "input",
    "textarea",
    "select",
    "button",
    "a[href]",
    "[contenteditable=true]",
    "[role=button]",
    "[role=combobox]",
    "[role=listbox]",
    "[role=menu]",
    "[role=menuitem]",
    "[role=option]",
    "[role=spinbutton]",
    "[role=textbox]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");

  return (
    <EventHandlers
      document={{
        keydown: (s) => {
          s.event.getTarget("wq_event_target");
          s.element(sql`wq_event_target`).matches(
            sql.lit(interactiveElementSelector),
            "wq_target_is_interactive",
          );
          s.returnIf(sql`wq_target_is_interactive`);

          // Get current row number
          s.defScalar(
            "wq_current_row",
            sql`(select _wq_row_num from ${sql.ref(queryName)} where ${
              sql.ref(rowKey)
            } = wq_selected_id)`,
          );

          // Arrow Down - next row
          s.if(sql`event.key = 'ArrowDown'`, (s) => {
            s.event.preventDefault();
            s.defScalar(
              "wq_next_id",
              sql`(select ${sql.ref(rowKey)} from ${sql.ref(queryName)}
                   where _wq_row_num = coalesce(wq_current_row, 1) + 1)`,
            );
            s.if(sql`wq_next_id is not null`, (s) => {
              s.setQueryParam("wq_selected_id", sql`wq_next_id`);
            });
          });

          // Arrow Up - previous row
          s.if(sql`event.key = 'ArrowUp'`, (s) => {
            s.event.preventDefault();
            s.defScalar(
              "wq_prev_id",
              sql`(select ${sql.ref(rowKey)} from ${sql.ref(queryName)}
                   where _wq_row_num = coalesce(wq_current_row, 1) - 1)`,
            );
            s.if(sql`wq_prev_id is not null`, (s) => {
              s.setQueryParam("wq_selected_id", sql`wq_prev_id`);
            });
          });

          // Escape - clear selection (preserve other query params)
          s.if(sql`event.key = 'Escape'`, (s) => {
            s.navigate(
              sql`location.pathname || (select case when filtered = '' then '' else '?' || filtered end from (select coalesce(string_agg(value, '&'), '') as filtered from (select value from string.split(location.query, '&')) where value != '' and not value like 'wq_selected_id=%') t)`,
            );
          });
        },
      }}
    />
  );
}

// ============================================================================
// WorkQueue.Header
// ============================================================================

export interface WorkQueueHeaderProps {
  /** Render function receiving (selectedRecord, totalCount) */
  children: (selected: Sql, count: Sql) => Node;
}

/**
 * Header section for the WorkQueue. Renders above the table.
 * Has access to the current query table (all displayed rows) and total count.
 */
WorkQueue.Header = function Header(props: WorkQueueHeaderProps) {
  const ctx = useOptionalICtx(WorkQueueICtxKey);
  if (!ctx) {
    return null;
  }

  return (
    <div className="flex-none">
      {props.children(sql.ref(ctx.queryName), sql`wq_count`)}
    </div>
  );
};

// ============================================================================
// WorkQueue.Table
// ============================================================================

export interface WorkQueueTableProps {
  /** WorkQueue.Column children for customizing columns */
  children?: Node;
}

/**
 * Table section for the WorkQueue. Contains the scrollable list of items.
 * Use WorkQueue.Column children to declare rendered columns.
 */
WorkQueue.Table = function QueueTable(props: WorkQueueTableProps) {
  const ctx = useOptionalICtx(WorkQueueICtxKey);
  if (!ctx) {
    // During gather phase, collect column overrides
    gatherChildrenContextInfo(props.children);
    return null;
  }

  const columns = ctx.resolvedColumns;

  return (
    <div sx={styles.tableContainer}>
      <Table stickyHeader hoverRow size="sm">
        <thead>
          <tr>
            {columns.map((col) => {
              if (col.sortable) {
                return (
                  <th
                    sx={[
                      styles.headerCellSortable,
                      col.width ? { width: col.width } : {},
                    ]}
                    onClick={(s: DomStatements) => {
                      s.if(
                        sql`wq_sort_col = ${sql.lit(col.name)}`,
                        (s) => {
                          s.if(
                            sql`wq_sort_dir = 'asc'`,
                            (s) => {
                              s.setScalar("wq_sort_dir", sql.lit`desc`);
                            },
                            (s) => {
                              s.setScalar("wq_sort_col", sql.lit``);
                              s.setScalar("wq_sort_dir", sql.lit`asc`);
                            },
                          );
                        },
                        (s) => {
                          s.setScalar(
                            "wq_sort_col",
                            sql.lit(col.name),
                          );
                          s.setScalar("wq_sort_dir", sql.lit`asc`);
                        },
                      );
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
                        when={sql`wq_sort_col = ${
                          sql.lit(col.name)
                        } and wq_sort_dir = 'asc'`}
                      >
                        <MaterialIcon
                          icon="ArrowUpward"
                          sx={{ fontSize: "1rem" }}
                        />
                      </Show>
                      <Show
                        when={sql`wq_sort_col = ${
                          sql.lit(col.name)
                        } and wq_sort_dir = 'desc'`}
                      >
                        <MaterialIcon
                          icon="ArrowDownward"
                          sx={{ fontSize: "1rem" }}
                        />
                      </Show>
                    </div>
                  </th>
                );
              }
              return (
                <th
                  sx={[
                    styles.headerCell,
                    col.width ? { width: col.width } : {},
                  ]}
                >
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <Show when={sql`wq_count = 0`}>
            <tr>
              <td
                colSpan={columns.length}
                className="text-center p-6 text-tertiary"
              >
                {ctx.emptyMessage ?? "No items in queue"}
              </td>
            </tr>
          </Show>
          <Each
            table={ctx.queryName}
            recordName="wq_row"
          >
            <WorkQueueRow columns={columns} rowKey={ctx.rowKey} />
          </Each>
        </tbody>
      </Table>
    </div>
  );
};

function WorkQueueRow({
  columns,
  rowKey,
}: {
  columns: ResolvedColumn[];
  rowKey: string;
}) {
  const row = sql.ref("wq_row");
  const rowId = sql`${row}.${sql.ref(rowKey)}`;

  return (
    <tr
      sx={styles.row}
      aria-selected={sql`${rowId} = wq_selected_id or (wq_selected_id is null and wq_row._wq_row_num = 1)`}
      onClick={(s) => {
        s.setQueryParam("wq_selected_id", rowId);
      }}
    >
      {columns.map((col) => <td sx={styles.cell}>{col.render(row)}</td>)}
    </tr>
  );
}

// ============================================================================
// WorkQueue.Column
// ============================================================================

export interface WorkQueueColumnProps {
  /** Column name from query to customize */
  field: string;
  /** Custom header text */
  header?: Node;
  /** Hide this column */
  hidden?: boolean;
  /** Format preset: date, datetime, currency, decimal, percent */
  format?: "date" | "datetime" | "currency" | "decimal" | "percent";
  /** Column width */
  width?: number | string;
  /** Whether this column is sortable (default: true) */
  sortable?: boolean;
  /** Custom render function. Receives the row record reference. */
  children?: (row: Sql) => Node;
}

/**
 * Customize a column in the WorkQueue table.
 * Must be a child of WorkQueue.Table.
 */
WorkQueue.Column = function Column(props: WorkQueueColumnProps) {
  const phase = usePhase();

  if (phase === "gather") {
    const gatherCtx = useOptionalICtx(WorkQueueGatherICtxKey);
    if (gatherCtx) {
      gatherCtx.columnOverrides.push({
        field: props.field,
        header: props.header,
        hidden: props.hidden,
        format: props.format,
        width: props.width,
        render: props.children,
        sortable: props.sortable,
      });
    }
  }

  // This component doesn't render anything - it's just for configuration
  return null;
};

// ============================================================================
// WorkQueue.Footer
// ============================================================================

export interface WorkQueueFooterProps {
  /** Height of the footer panel. Default: 280 */
  height?: number | string;
  /** Enable drag-to-resize footer. Default: false */
  resizable?: boolean;
  /** Minimum footer height when resizable. Default: 100 */
  minHeight?: number;
  /** Maximum footer height when resizable. Default: 600 */
  maxHeight?: number;
  /** Render function receiving the selected record */
  children: (selected: Sql) => Node;
}

/**
 * Footer section for the WorkQueue. Renders below the table.
 * Shows details and actions for the selected item.
 * Users can define their own State and Read components inside.
 */
WorkQueue.Footer = function Footer(props: WorkQueueFooterProps) {
  const ctx = useOptionalICtx(WorkQueueICtxKey);
  if (!ctx) {
    // Gather phase - register footer config
    const gatherCtx = useOptionalICtx(WorkQueueGatherICtxKey);
    if (gatherCtx) {
      const height = typeof props.height === "number" ? props.height : 280;
      gatherCtx.footerConfig = {
        height,
        resizable: props.resizable ?? false,
        minHeight: props.minHeight ?? 100,
        maxHeight: props.maxHeight ?? 600,
      };
    }
    return null;
  }

  const resizable = props.resizable ?? false;
  const height = props.height ?? 280;

  const selectedRowQuery = sql`
    select *
    from ${sql.ref(ctx.queryName)}
    where ${
    sql.ref(ctx.rowKey)
  } = wq_selected_id or (wq_selected_id is null and _wq_row_num = 1)
    limit 1
  `;

  const footerContent = (
    <Data
      local
      noRefetch
      watch={[sql`wq_selected_id`, sql`wq_revision`]}
      procedure={(s) => {
        s.defRecord("wq_footer_selected", selectedRowQuery);
      }}
    >
      <Show when={sql`wq_footer_selected.${sql.ref(ctx.rowKey)} is not null`}>
        {props.children(sql.ref("wq_footer_selected"))}
      </Show>
    </Data>
  );

  if (resizable) {
    return (
      <>
        <WorkQueueResizeHandle
          minHeight={props.minHeight ?? 100}
          maxHeight={props.maxHeight ?? 600}
        />
        <div
          sx={styles.footer}
          style={{ height: sql`wq_footer_height || 'px'` }}
        >
          {footerContent}
        </div>
      </>
    );
  }

  return (
    <div sx={[styles.footer, { height }]}>
      {footerContent}
    </div>
  );
};

// ============================================================================
// Resize Handle (internal)
// ============================================================================

function WorkQueueResizeHandle({
  minHeight,
  maxHeight,
}: {
  minHeight: number;
  maxHeight: number;
}) {
  const newValue =
    sql`case when wq_resize_start_height - (event.client_y - wq_resize_start_y) < ${minHeight}
      then ${minHeight}
      when wq_resize_start_height - (event.client_y - wq_resize_start_y) > ${maxHeight}
      then ${maxHeight}
      else wq_resize_start_height - (event.client_y - wq_resize_start_y)
    end`;

  return (
    <div
      sx={styles.resizeHandle}
      dynamicClass={{
        condition: sql`wq_resize_start_height is not null`,
        classes: "active",
      }}
      onMouseDown={(s) => {
        s.setScalar("wq_resize_start_height", sql`wq_footer_height`);
        s.setScalar("wq_resize_start_y", sql`event.client_y`);
      }}
      onClick={(s) => {
        s.event.stopPropagation();
      }}
    >
      <div sx={styles.resizeBar} />
      <Show when={sql`wq_resize_start_height is not null`}>
        <EventHandlers
          document={{
            mouseMove: (s) => {
              s.setScalar("wq_resize_pending", newValue);
              s.unless(sql`wq_resize_waiting`, (s) => {
                s.startTaskWithOpts({
                  detached: true,
                  procedure: (s) => {
                    s.setScalar("wq_resize_waiting", true);
                    s.sleep(16);
                    s.setScalar("wq_footer_height", sql`wq_resize_pending`);
                    s.setScalar("wq_resize_waiting", false);
                  },
                });
              });
            },
            mouseUp: (s) => {
              s.setScalar("wq_resize_start_height", sql.null);
            },
          }}
        />
      </Show>
    </div>
  );
}

// ============================================================================
// Utility: Advance to next item (for use in action handlers)
// ============================================================================

/**
 * Helper to advance to the next item in the queue after completing an action.
 * Call this in your action handler after modifying the current item.
 *
 * @example
 * ```tsx
 * <Button onClick={(s) => {
 *   s.modify(sql`update db.items set done = true where id = ${selected}.id`);
 *   WorkQueue.advanceToNext(s);
 * }}>
 *   Mark Done
 * </Button>
 * ```
 */
WorkQueue.advanceToNext = function advanceToNext(
  s: DomStatements,
) {
  const rowKey = sql.ref(useOptionalICtx(WorkQueueICtxKey)?.rowKey ?? "id");
  // Hide any previous confirmation (will be re-shown if caller uses showConfirmation)
  s.setScalar("wq_confirmation_visible", sql`false`);

  // Get current and next IDs before removing the completed item locally.
  s.defScalar(
    "wq_adv_current_id",
    sql`coalesce(wq_selected_id, (select ${rowKey} from wq_items where _wq_row_num = 1))`,
  );
  s.defScalar(
    "wq_adv_current_row",
    sql`(select _wq_row_num from wq_items where ${rowKey} = wq_adv_current_id)`,
  );
  s.defScalar(
    "wq_adv_next_id",
    sql`(select ${rowKey} from wq_items where _wq_row_num = coalesce(wq_adv_current_row, 1) + 1)`,
  );

  s.modify(sql`delete from wq_items where ${rowKey} = wq_adv_current_id`);
  s.setScalar("wq_count", sql`(select count(*) from wq_items)`);
  s.setScalar("wq_revision", sql`wq_revision + 1`);

  // Navigate to next, or clear selection if no next (preserve other query params)
  s.if(sql`wq_adv_next_id is not null`, (s) => {
    s.setQueryParam("wq_selected_id", sql`wq_adv_next_id`);
  });
  s.if(sql`wq_adv_next_id is null`, (s) => {
    s.setQueryParam("wq_selected_id", sql.null);
  });
};

/**
 * Show an alert message in the work queue's built-in status bar.
 *
 * @param color - "success" | "danger" | "warning" (default: "success")
 */
WorkQueue.showAlert = function showAlert(
  s: DomStatements,
  message: Sql,
  color: "success" | "danger" | "warning" = "success",
) {
  s.setScalar("wq_confirmation_msg", message);
  s.setScalar("wq_confirmation_color", sql.lit(color));
  s.setScalar("wq_confirmation_visible", sql`true`);
};
