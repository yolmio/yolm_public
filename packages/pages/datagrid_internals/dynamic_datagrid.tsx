import { Alert } from "components/alert";
import {
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
  CurrentWatchKeyICtxKey,
  DatagridBaseICtxKey,
  DatagridColumnDisplayICtxKey,
  DatagridColumnOrderICtxKey,
  DatagridCurrentCellICtxKey,
  DatagridEditICtxKey,
  DatagridSortICtxKey,
  DatagridViewsICtxKey,
  DynamicDatagridICtxKey,
} from "std/ictx";
import type {
  CurrentRefetchICtx,
  CurrentTableICtx,
  CurrentWatchKeyICtx,
  DatagridBaseICtx,
  DatagridColumnDisplayICtx,
  DatagridColumnOrderICtx,
  DatagridCurrentCellICtx,
  DatagridEditICtx,
  DatagridSortICtx,
  DatagridViewsICtx,
  DynamicDatagridICtx,
} from "std/ictx";
import { sql, updateAssignment, valuesRow } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import type { AnyExpr, BooleanExpr, NumericExpr } from "../../std/sql_utils";
import {
  type DomStatements,
  type HelperProcField,
  type IStatementsBase,
  StateStatements,
  type StateStatementsOrFn,
  type UiServerStatements,
} from "std/statements";
import { createStyles } from "std/style_utils";
import { system, useGlobalState } from "std/system";
import type { BoolEnumLikeConfig, Table } from "std/system";
import {
  addCtx,
  Datagrid,
  Effect,
  EventHandlers,
  Route,
  Routes,
  Show,
  SourceMap,
  useApp,
  useQueryParams,
  WithContext,
} from "std/ui";
import { Data, GLOBAL_REFETCH_SCALAR } from "std/data";
import type { ContextInstance, Node } from "std/ui";
import {
  colClickHandlers,
  colKeydownHandlers,
  DatagridBaseContext,
  editFocusState,
  refreshKeyState,
  rowHeightInPixels,
  useCellHelper,
} from "./shared";
import type { ColumnEventHandlers, DgCellHelper, RowHeight } from "./shared";
import { styles as sharedStyles } from "./styles";
import { BulkActionsSnackbar } from "./toolbar";
import type { BulkActionsSnackbarProps } from "./toolbar";
import type { FilterTermHelper } from "./toolbar_filter";
import {
  DATAGRID_RECORD_NAVIGATION_CAPTURE_COUNT_QUERY,
  DATAGRID_RECORD_NAVIGATION_CAPTURE_QUERY_PREFIX,
  DATAGRID_RECORD_NAVIGATION_CAPTURE_SOURCE,
  DatagridRecordNavigation,
  useSeparatedDatagridRecordNavigationState,
} from "./record_navigation";
import { buildQuickSearchSqlFragments } from "std/search_utils";
import type { ResolvedQuickSearch } from "std/search_utils";
import { hashSha256 } from "std/yolm_gen_api";

const INVALID_DATE_FILTER_MESSAGE =
  "Invalid date filter. Choose a valid date or relative date.";

export interface DefaultView {
  columnOrder?: string[];
  displayColumns?: string[];
  sort?: {
    column: string;
    sort: "asc" | "desc";
  }[];
  filter?: {
    column: string;
    op: string;
    value_1: string;
  }[];
}

export type StringFilterOp =
  | "str_eq"
  | "str_ne"
  | "str_contains"
  | "str_not_contains"
  | "str_matches"
  | "str_not_matches"
  | "empty"
  | "not_empty";

export interface RelationStringFilter {
  /** SQL fragment after `from` in the correlated relation subquery. */
  from: Sql;
  /** Related string value to compare with the filter input. */
  value: AnyExpr;
  /** Correlates and restricts related rows; the datagrid row alias is `record`. */
  where: BooleanExpr;
  /**
   * Scalar requires at most one related row and preserves scalar SQL NULL
   * semantics for negative comparisons. Many (the default) compares sets.
   */
  semantics?: "scalar" | "many";
}

const stringFilterOps: StringFilterOp[] = [
  "str_eq",
  "str_ne",
  "str_contains",
  "str_not_contains",
  "str_matches",
  "str_not_matches",
  "empty",
  "not_empty",
];

export class DynamicDatagridContext extends DatagridBaseContext
  implements
    DatagridBaseICtx,
    ContextInstance,
    CurrentRefetchICtx,
    CurrentWatchKeyICtx,
    DynamicDatagridICtx,
    DatagridViewsICtx,
    CurrentTableICtx,
    DatagridColumnDisplayICtx,
    DatagridColumnOrderICtx,
    DatagridSortICtx,
    DatagridEditICtx {
  implementICtxs = [
    DatagridBaseICtxKey,
    CurrentRefetchICtxKey,
    CurrentWatchKeyICtxKey,
    DynamicDatagridICtxKey,
    DatagridViewsICtxKey,
    CurrentTableICtxKey,
    DatagridColumnDisplayICtxKey,
    DatagridColumnOrderICtxKey,
    DatagridSortICtxKey,
    DatagridEditICtxKey,
  ];

  currentWatchKey: AnyExpr[];

  currentTable: Table;

  readonly quickSearchPredicate?: Sql;
  readonly quickSearchRankKey?: Sql;

  constructor(
    public readonly datagridName: string,
    public readonly viewsEnabled: boolean,
    public readonly filteringEnabled: boolean,
    public readonly columns: Column[],
    public readonly table: Table,
    public readonly additionalWhere: Sql | undefined,
    public readonly fns: DynamicDatagridFns,
    private readonly filterExprProcedureName: string | undefined,
    public readonly quickSearch: ResolvedQuickSearch | undefined,
    public readonly stableOrder: boolean,
    private readonly resetKeyScalar: string,
  ) {
    super();
    this.currentTable = table;
    this.currentWatchKey = [this.refreshKey, sql.ref(GLOBAL_REFETCH_SCALAR)];
    if (quickSearch) {
      const built = buildQuickSearchSqlFragments(
        quickSearch.targets,
        sql`q`,
      );
      this.quickSearchPredicate = built.predicate;
      this.quickSearchRankKey = built.rankKey;
    }
  }

  private filterExprCallIndex = 0;

  private currentFilterExpr(s: StateStatements | UiServerStatements) {
    if (!this.filterExprProcedureName) {
      return sql.lit`true`;
    }
    const outputScalar = `__${this.datagridName}_dg_filter_expr_${this
      .filterExprCallIndex++}`;
    s.callStoredProcedure(this.filterExprProcedureName, {
      inputScalars: {
        p_root_filter_is_any: sql`ui.root_filter_is_any`,
      },
      inputTables: {
        p_filter_terms: "ui.filter_terms",
      },
      outputScalars: {
        p_filter_expr: outputScalar,
      },
    });
    return sql.ref(outputScalar);
  }

  triggerChangesInToolbar = (s: DomStatements) => {
    s.setScalar("has_unsaved_view_changes", true);
    s.increment("has_changes_refresh_key");
  };

  clearChangesInToolbar = (s: DomStatements) => {
    s.setScalar("has_unsaved_view_changes", false);
    s.increment("has_changes_refresh_key");
  };

  resetView = (s: DomStatements) => {
    s.increment(this.resetKeyScalar);
    this.clearChangesInToolbar(s);
  };

  viewStateHash = (s: StateStatements) => {
    s.defScalar("column_hash", sql.lit``);
    s.forEachQuery(
      sql`select * from column order by ordering`,
      "column_record",
      (s) => {
        s.setScalar(
          "column_hash",
          sql`concat(column_hash,
        '-',
        column_record.id::string,
        '-',
        coalesce(column_record.displaying::string, ''),
        '-',
        coalesce(column_record.sort_index::string, ''),
        '-',
        coalesce(column_record.sort_asc::string, ''),
        '-',
        coalesce(column_record.pin_left::string, ''),
        '-',
        coalesce(column_record.pin_right::string, ''),
        '-',
        coalesce(column_record.always_generate::string, ''),
        '-',
        coalesce(column_record.has_query_generation::string, ''),
        '-',
        '/'
      )`,
        );
      },
    );

    s.defScalar("filter_hash", sql.lit``);
    s.forEachQuery(
      sql`select * from filter_terms order by ordering`,
      "filter_record",
      (s) => {
        s.setScalar(
          "filter_hash",
          sql`concat(filter_hash,
        '-',
        filter_record.id::string,
        '-',
        coalesce(filter_record.group_id::string, ''),
        '-',
        coalesce(filter_record.column_id::string, ''),
        '-',
        coalesce(filter_record.op::string, ''),
        '-',
        coalesce(filter_record.value_1::string, ''),
        '-',
        coalesce(filter_record.value_2::string, ''),
        '-',
        coalesce(filter_record.value_3::string, ''),
        '-',
        coalesce(filter_record.is_any::string, 'false'),
        '/'
      )`,
        );
      },
    );
    return sql`concat(ui.row_height::string, '-', ui.root_filter_is_any::string, '-', column_hash, '-', filter_hash)`;
  };

  setColumnDisplaying = <T extends IStatementsBase>(
    s: T,
    column: NumericExpr,
    displaying: BooleanExpr,
  ) => {
    s.modify(
      sql`update ui.column set displaying = case when can_hide then ${displaying} else true end where id = ${column}`,
    );
  };

  setColumnSort = <T extends IStatementsBase>(
    s: T,
    column: NumericExpr,
    asc: boolean,
  ) => {
    s.modify(sql`update ui.column set sort_index = null, sort_asc = null`);
    s.modify(
      sql`update ui.column set sort_index = 0, sort_asc = ${asc} where id = ${column}`,
    );
  };

  setColumnPin = (
    s: DomStatements,
    column: NumericExpr,
    pin: "left" | "right" | null,
  ) => {
    s.returnIf(
      sql`not coalesce((select can_pin from ui.column where id = ${column}), false)`,
    );
    if (pin === "left" || pin === "right") {
      s.defScalar(
        "target_pin_ordering_before",
        pin === "left"
          ? sql`(select max(ordering) from ui.column where pin_left and id != ${column})`
          : sql`(select max(ordering) from ui.column where pin_right and id != ${column})`,
      );
      s.modify(
        sql`update ui.column set
            pin_left = ${pin === "left"},
            pin_right = ${pin === "right"},
            ordering = ordering.new(target_pin_ordering_before)
          where id = ${column}`,
      );
      return;
    }
    s.modify(
      sql`update ui.column set
          pin_left = false,
          pin_right = false
        where id = ${column}`,
    );
  };

  #moveColumnBetween = <T extends IStatementsBase>(
    s: T,
    column: NumericExpr,
    before: Sql,
    after: Sql,
  ) => {
    s.modify(
      sql`update ui.column set ordering = ordering.new(${before}, ${after}) where id = ${column}`,
    );
  };
  #defineCurrentColumnPosition = (s: DomStatements, column: NumericExpr) => {
    s.defScalar(
      "current_col",
      sql`(select ordering from ui.column where id = ${column})`,
    );
    s.defScalar(
      "current_pin_left",
      sql`(select pin_left from ui.column where id = ${column})`,
    );
    s.defScalar(
      "current_pin_right",
      sql`(select pin_right from ui.column where id = ${column})`,
    );
    s.defScalar(
      "current_can_reorder",
      sql`coalesce((select can_reorder from ui.column where id = ${column}), false)`,
    );
  };
  moveColumnRight = (s: DomStatements, column: NumericExpr) => {
    this.#defineCurrentColumnPosition(s, column);
    s.defScalar(
      "next_col",
      sql`(select min(ordering) from ui.column where ordering > current_col and pin_left = current_pin_left and pin_right = current_pin_right and can_reorder)`,
    );
    s.returnIf(sql`not current_can_reorder or next_col is null`);
    this.#moveColumnBetween(
      s,
      column,
      sql`next_col`,
      sql`(select min(ordering) from ui.column where ordering > next_col and pin_left = current_pin_left and pin_right = current_pin_right and can_reorder)`,
    );
  };
  moveColumnLeft = (s: DomStatements, column: NumericExpr) => {
    this.#defineCurrentColumnPosition(s, column);
    s.defScalar(
      "prev_col",
      sql`(select max(ordering) from ui.column where ordering < current_col and pin_left = current_pin_left and pin_right = current_pin_right and can_reorder)`,
    );
    s.returnIf(sql`not current_can_reorder or prev_col is null`);
    this.#moveColumnBetween(
      s,
      column,
      sql`(select max(ordering) from ui.column where ordering < prev_col and pin_left = current_pin_left and pin_right = current_pin_right)`,
      sql`prev_col`,
    );
  };
  moveColumnToStart = (s: DomStatements, column: NumericExpr) => {
    this.#defineCurrentColumnPosition(s, column);
    s.defScalar(
      "first_reorderable_col",
      sql`(select min(ordering) from ui.column where pin_left = current_pin_left and pin_right = current_pin_right and can_reorder)`,
    );
    s.returnIf(
      sql`not current_can_reorder or first_reorderable_col is null or current_col = first_reorderable_col`,
    );
    this.#moveColumnBetween(
      s,
      column,
      sql`(select max(ordering) from ui.column where pin_left = current_pin_left and pin_right = current_pin_right and not can_reorder)`,
      sql`first_reorderable_col`,
    );
  };
  moveColumnToEnd = (s: DomStatements, column: NumericExpr) => {
    this.#defineCurrentColumnPosition(s, column);
    s.returnIf(
      sql`not current_can_reorder or current_col = (select max(ordering) from ui.column where pin_left = current_pin_left and pin_right = current_pin_right)`,
    );
    this.#moveColumnBetween(
      s,
      column,
      sql`(select max(ordering) from ui.column where pin_left = current_pin_left and pin_right = current_pin_right)`,
      sql.null,
    );
  };

  get dynamicQuery() {
    return this.dynamicQueryWithLimit(undefined, sql`ui.row_count`);
  }

  buildDynamicQuery(s: StateStatements | UiServerStatements) {
    return this.dynamicQueryWithLimit(s, sql`ui.row_count`);
  }

  recordNavigationDynamicQuery(s: StateStatements | UiServerStatements) {
    return this.dynamicQueryWithLimit(s, sql`ui.row_count + 1`);
  }

  recordNavigationIdsQueryPrefix(s: StateStatements | UiServerStatements) {
    const idColumn = this.columns.findIndex(
      (column) => column.viewStorageName === this.table.primaryKeyIdent.toSQL(),
    );
    if (idColumn === -1) {
      throw new Error(
        `Unable to find primary key column for datagrid ${this.datagridName}`,
      );
    }
    const primaryKey = this.table.primaryKeyIdent.toSQL();
    return sql.concat(
      "select ",
      primaryKey,
      " from (select ",
      primaryKey,
      ",",
      sql`(select string_agg(
        fn.${this.fns.idToSqlExpr}(id) || ' as col_' || id,
        ',' order by id
      ) from ui.column where sort_index is not null or id = ${idColumn})`,
      this.buildFromAndWherePart(s),
      this.orderByPart(),
    );
  }

  dynamicQueryWithLimit(
    s: StateStatements | UiServerStatements | undefined,
    rowLimit: Sql,
  ) {
    return sql.concat(
      this.dynamicQueryPrefix(s),
      " limit ",
      rowLimit,
      ")",
    );
  }

  dynamicQueryPrefix(s?: StateStatements | UiServerStatements) {
    return sql.concat(
      "select ",
      sql`(select string_agg(
        case
          when not has_query_generation then null
          when ${shouldGenerateColumn} then 'col_' || id
          else 'null'
        end, ',' order by id)
      from ui.column
    )`,
      " from (select ",
      // Keep the result slots above in ID order, but lower active sort
      // expressions first. This lets TopK delay unrelated scalar display
      // lookups while preserving every col_N alias.
      sql`(select string_agg(
        case
          when not has_query_generation then null
          when ${shouldGenerateColumn} then fn.${this.fns.idToSqlExpr}(id) || ' as col_' || id
        end, ',' order by sort_index nulls last, id)
      from ui.column
    )`,
      s ? this.buildFromAndWherePart(s) : this.inlineFromAndWherePart(),
      this.orderByPart(),
    );
  }

  orderByPart() {
    let baseOrder = baseOrderByPart;
    let stableResultKey: string | undefined;
    if (this.stableOrder) {
      const idColumn = this.columns.findIndex(
        (column) =>
          column.viewStorageName === this.table.primaryKeyIdent.toSQL(),
      );
      if (idColumn === -1) {
        throw new Error(
          `Unable to find primary key column for datagrid ${this.datagridName}`,
        );
      }
      stableResultKey = `col_${idColumn} asc`;
      baseOrder =
        sql`' order by ' || coalesce(nullif(${configuredResultOrder}, '') || ',', '') || ${
          sql.lit(stableResultKey)
        }`;
    }
    if (this.quickSearch?.rank && this.quickSearchRankKey) {
      const stableRankSuffix = stableResultKey
        ? sql` || ${sql.lit(`, ${stableResultKey}`)}`
        : sql``;
      return sql`case
        when trim(coalesce(q, '')) = '' then ${baseOrder}
        else ' order by ' || ${this.quickSearchRankKey} || coalesce(', ' || ${configuredResultOrder}, '')${stableRankSuffix}
      end`;
    }
    return baseOrder;
  }

  downloadQuery = (additionalWhere?: Sql) => {
    return sql.concat(
      "select ",
      sql`(select string_agg(
        case
          when ${shouldGenerateColumn} then fn.${this.fns
        .idToExportExpr!}(id) || ' as ' || fn.${this.fns.idToExportName!}(id)
        end,
        ','
      )
      from ui.column
    )`,
      this.inlineFromAndWherePart(additionalWhere),
      sql`coalesce(
  ' order by ' || (select
    string_agg(concat(fn.${this.fns
        .idToExportName!}(id), (case when sort_asc then ' nulls last' else ' desc nulls last' end)), ',')
    from (select id, sort_asc from ui.column where sort_index is not null order by sort_index)),
  ''
)`,
    );
  };

  get countQuery() {
    return sql.concat("select count(*) ", this.inlineFromAndWherePart());
  }

  buildCountQuery(s: StateStatements | UiServerStatements) {
    return sql.concat("select count(*) ", this.buildFromAndWherePart(s));
  }

  get idsQuery() {
    return sql.concat(
      " select ",
      this.table.primaryKeyIdent.toSQL(),
      " ",
      this.inlineFromAndWherePart(),
    );
  }

  buildIdsQuery(s: StateStatements | UiServerStatements) {
    return sql.concat(
      " select ",
      this.table.primaryKeyIdent.toSQL(),
      " ",
      this.buildFromAndWherePart(s),
    );
  }

  recordAccessQuery(recordId: NumericExpr) {
    if (!this.additionalWhere) {
      throw new Error(
        `Datagrid ${this.datagridName} does not have an additionalWhere predicate`,
      );
    }
    const primaryKey = this.table.primaryKeyIdent.toSQL();
    return sql.concat(
      "select ",
      primaryKey,
      " from ",
      this.table.identWithDb.toSQL(),
      " as record where ",
      primaryKey,
      " = ",
      sql`literal.number(${recordId})`,
      " and (",
      this.additionalWhere,
      ")",
    );
  }

  private buildFromAndWherePart(
    s: StateStatements | UiServerStatements,
    additionalWhere?: Sql,
  ) {
    return sql.concat(
      " from ",
      sql.lit(this.table.identWithDb.toSQL()),
      " as record where ",
      this.buildWherePart(s, additionalWhere),
    );
  }

  private inlineFromAndWherePart(additionalWhere?: Sql) {
    return sql.concat(
      " from ",
      sql.lit(this.table.identWithDb.toSQL()),
      " as record where ",
      this.wherePart(additionalWhere),
    );
  }

  wherePart(additionalWhere?: Sql) {
    return this.combineWhereParts(
      sql`coalesce(${filterExpr(this.fns)}, 'true')`,
      additionalWhere,
    );
  }

  buildWherePart(
    s: StateStatements | UiServerStatements,
    additionalWhere?: Sql,
  ) {
    return this.combineWhereParts(this.currentFilterExpr(s), additionalWhere);
  }

  private combineWhereParts(filter: Sql, additionalWhere?: Sql) {
    let combinedWhere: Sql | undefined;
    if (additionalWhere) {
      combinedWhere = sql.concat(
        this.additionalWhere,
        " and ",
        additionalWhere,
      );
    } else {
      combinedWhere = this.additionalWhere;
    }

    return sql.concat(
      filter,
      combinedWhere
        ? sql`coalesce(' and (' || ${combinedWhere} || ')', '')`
        : undefined,
      this.quickSearchPredicate
        ? sql`' and ' || ${this.quickSearchPredicate}`
        : undefined,
    );
  }

  insertViewColumnsAndFiltersToView(
    s: UiServerStatements,
    viewId: NumericExpr,
  ) {
    const fns = this.fns;
    s.modify(sql`insert into db.datagrid_view_columns
          (view_id, name, displaying, ordering, sort_index, sort_asc, pin_left, pin_right, width)
          select
            ${viewId} as view_id,
            fn.${fns.idToStorageName}(id) as name,
            displaying,
            ordering,
            sort_index,
            sort_asc,
            pin_left,
            pin_right,
            case when coalesce(${
      fns.idToInitialWidth(sql`id`)
    }, -12345) != width then width else null end as width
          from ui.column
          where fn.${fns.idToStorageName}(id) is not null`);
    s.defTable("filter_mapping", {
      fields: [
        { name: "ui_id", type: "BigUint" },
        { name: "db_id", type: "BigUint" },
      ],
    });
    s.forEachQuery(
      sql`select id from ui.filter_terms where group_id is null`,
      "filter_term_record",
      (s) => {
        s.modify(
          sql`insert into db.datagrid_view_filter_terms
              (view_id, group_id, ordering, is_any, column_name, op, value_1, value_2, value_3)
            select
              ${viewId},
              null,
              ordering,
              is_any,
              fn.${fns.idToStorageName}(column_id),
              op,
              value_1,
              value_2,
              value_3
            from ui.filter_terms where id = filter_term_record.id`,
        );
        s.modify(
          sql`insert into filter_mapping (ui_id, db_id) values (filter_term_record.id, (select max(id) from db.datagrid_view_filter_terms))`,
        );
      },
    );
    s.defTable(
      "sub_root_term",
      sql`select id from ui.filter_terms where group_id in (select ui_id from filter_mapping)`,
    );
    s.forEachTable("sub_root_term", "filter_term_record", (s) => {
      s.modify(
        sql`insert into db.datagrid_view_filter_terms
            (view_id, group_id, ordering, is_any, column_name, op, value_1, value_2, value_3)
          select
            ${viewId},
            db_id,
            ordering,
            is_any,
            fn.${fns.idToStorageName}(column_id),
            op,
            value_1,
            value_2,
            value_3
          from ui.filter_terms
            join filter_mapping on ui_id = group_id
          where id = filter_term_record.id`,
      );
      s.modify(
        sql`insert into filter_mapping (ui_id, db_id) values (filter_term_record.id, (select max(id) from db.datagrid_view_filter_terms))`,
      );
    });
    s.forEachQuery(
      sql`select id from ui.filter_terms where group_id in (select id from sub_root_term)`,
      "filter_term_record",
      (s) => {
        s.modify(
          sql`insert into db.datagrid_view_filter_terms
              (view_id, group_id, ordering, is_any, column_name, op, value_1, value_2, value_3)
            select
              ${viewId},
              db_id,
              ordering,
              is_any,
              fn.${fns.idToStorageName}(column_id),
              op,
              value_1,
              value_2,
              value_3
            from ui.filter_terms
              join filter_mapping on ui_id = group_id
            where id = filter_term_record.id`,
        );
      },
    );
  }

  saveCurrentAsNewView(
    s: UiServerStatements,
    viewName: Sql,
    personal: BooleanExpr,
  ) {
    const maxOrdering =
      sql`(select max(ordering) from db.datagrid_views where datagrid_name = ${
        sql.lit(this.datagridName)
      } and case when ${personal} then sys_user_id = current_user else sys_user_id is null end)`;
    s.modify(
      sql`insert into db.datagrid_views (name, ordering, datagrid_name, root_filter_is_any, sys_user_id, row_height)
        values (
          ${viewName},
          ordering.new(${maxOrdering}),
          ${sql.lit(this.datagridName)},
          ui.root_filter_is_any,
          case when ${personal} then current_user else null end,
          ui.row_height
        )`,
    );
    this.insertViewColumnsAndFiltersToView(
      s,
      sql`last_record_id(db.datagrid_views)`,
    );
    s.defScalar("view_id", sql`last_record_id(db.datagrid_views)`);
  }

  saveCurrentToExistingView(s: UiServerStatements, viewId: NumericExpr) {
    s.modify(
      sql`update db.datagrid_views set root_filter_is_any = ui.root_filter_is_any, row_height = ui.row_height where id = ${viewId}`,
    );
    // just deleting and re-inserting is much easier
    s.modify(
      sql`delete from db.datagrid_view_columns where view_id = ${viewId}`,
    );
    s.modify(
      sql`delete from db.datagrid_view_filter_terms where view_id = ${viewId}`,
    );
    this.insertViewColumnsAndFiltersToView(s, viewId);
  }

  duplicateView(s: UiServerStatements, viewId: NumericExpr) {
    const sameUserAsOldView =
      sql`case when old_view.sys_user_id is null then sys_user_id is null else old_view.sys_user_id = sys_user_id end`;
    s.defRecord(
      "old_view",
      sql`select * from db.datagrid_views where id = ${viewId}`,
    );
    s.defScalar("base_name", sql`old_view.name || ' copy'`);
    s.defScalar("check_count", 1);
    s.defScalar("new_name", sql`base_name`);
    s.while(
      sql`exists (select 1 from db.datagrid_views where name = new_name and datagrid_name = old_view.datagrid_name and ${sameUserAsOldView})`,
      (s) => {
        s.setScalar("check_count", sql`check_count + 1`);
        s.setScalar("new_name", sql`base_name || ' ' || check_count`);
      },
    );
    s.modify(sql`insert into db.datagrid_views
        select
          new_name as name,
          datagrid_name,
          root_filter_is_any,
          row_height,
          ordering.new(
            ordering,
            (select
                min(ordering)
              from db.datagrid_views
                where ordering > original.ordering and
                  datagrid_name = original.datagrid_name and
                  ${sameUserAsOldView}
            )
          ) as ordering,
          sys_user_id
          from db.datagrid_views as original where id = ${viewId}`);
    s.defScalar("new_view_id", sql`last_record_id(db.datagrid_views)`);
    s.modify(
      sql`insert into db.datagrid_view_columns
        (view_id, name, displaying, ordering, sort_index, sort_asc, pin_left, pin_right, width)
        select
          new_view_id as view_id,
          name,
          displaying,
          ordering,
          sort_index,
          sort_asc,
          pin_left,
          pin_right,
          width
        from db.datagrid_view_columns where view_id = ${viewId}`,
    );
    s.defTable("filter_mapping", {
      fields: [
        { name: "old_id", type: "BigUint" },
        { name: "new_id", type: "BigUint" },
      ],
    });
    s.forEachQuery(
      sql`select id from db.datagrid_view_filter_terms where group_id is null and view_id = ${viewId}`,
      "filter_term_record",
      (s) => {
        s.modify(
          sql`insert into db.datagrid_view_filter_terms
            select
              new_view_id as view_id,
              group_id,
              ordering,
              is_any,
              column_name,
              op,
              value_1,
              value_2,
              value_3
            from db.datagrid_view_filter_terms where id = filter_term_record.id`,
        );
        s.modify(
          sql`insert into filter_mapping (old_id, new_id) values (filter_term_record.id, (select max(id) from db.datagrid_view_filter_terms))`,
        );
      },
    );
    s.defTable(
      "sub_root_term",
      sql`select id from db.datagrid_view_filter_terms where view_id = ${viewId} and group_id in (select old_id from filter_mapping)`,
    );
    s.forEachTable("sub_root_term", "filter_term_record", (s) => {
      s.modify(sql`insert into db.datagrid_view_filter_terms
              select
                new_view_id as view_id,
                new_id as group_id,
                ordering,
                is_any,
                column_name,
                op,
                value_1,
                value_2,
                value_3
                from db.datagrid_view_filter_terms
                  join filter_mapping on old_id = group_id
                where id = filter_term_record.id`);
      s.modify(
        sql`insert into filter_mapping (old_id, new_id) values (filter_term_record.id, (select max(id) from db.datagrid_view_filter_terms))`,
      );
    });
    s.forEachQuery(
      sql`select id from db.datagrid_view_filter_terms where view_id = ${viewId} and group_id in (select id from sub_root_term)`,
      "filter_term_record",
      (s) => {
        s.modify(sql`insert into db.datagrid_view_filter_terms
              select
                new_view_id as view_id,
                new_id as group_id,
                ordering,
                is_any,
                column_name,
                op,
                value_1,
                value_2,
                value_3
                from db.datagrid_view_filter_terms
                  join filter_mapping on old_id = group_id
                where id = filter_term_record.id`);
      },
    );
  }
}

export interface DynamicDatagridProps {
  datagridName: string;
  tableModel: Table;
  toolbar: Node;
  emptyState?: Node;
  enableViews: boolean;
  enableFiltering: boolean;
  columns: Column[];
  pageSize: number;
  extraState?: StateStatementsOrFn;
  defaultView?: DefaultView;
  defaultRowHeight?: RowHeight;
  additionalWhere?: Sql;
  quickSearch?: ResolvedQuickSearch;
  validateHiddenColumnQueries?: boolean;
  selectable: boolean;
  bulkActionsProps?: BulkActionsSnackbarProps;
  recordPage?: {
    listPath: string;
    detailPath: string;
    showExactResultCount: boolean;
    content: Node;
  };
  standaloneRecordNavigation?: { listPath: string };
}

const filterTermFields: HelperProcField[] = [
  { name: "id", notNull: true, type: "SmallUint" },
  { name: "group_id", type: "SmallUint" },
  { name: "is_any", type: "Bool" },
  { name: "column_id", type: "SmallUint" },
  { name: "ordering", notNull: true, type: "Ordering" },
  { name: "op", type: { type: "Enum", enum: "dg_filter_op" } },
  { name: "value_1", type: { type: "String", maxLength: 2000 } },
  { name: "value_2", type: { type: "String", maxLength: 2000 } },
  { name: "value_3", type: { type: "String", maxLength: 2000 } },
];

function urlFilterOpAllowed(
  fns: DynamicDatagridFns,
  columnId: NumericExpr,
  op: AnyExpr,
): BooleanExpr {
  const defaultOp = fns.idToDefaultOp(columnId);
  return sql`case
    when ${defaultOp} is null then false
    when ${op} in ('empty', 'not_empty') then true
    when fn.is_string_filter_op(${defaultOp}) then fn.is_string_filter_op(${op})
    when fn.is_number_filter_op(${defaultOp}) then fn.is_number_filter_op(${op})
    when fn.is_date_filter_op(${defaultOp}) then fn.is_date_filter_op(${op})
    when fn.is_timestamp_filter_op(${defaultOp}) then fn.is_timestamp_filter_op(${op})
    when fn.is_enum_filter_op(${defaultOp}) then fn.is_enum_filter_op(${op})
    when fn.is_fk_filter_op(${defaultOp}) then fn.is_fk_filter_op(${op})
    when fn.is_minute_duration_filter_op(${defaultOp}) then fn.is_minute_duration_filter_op(${op})
    when ${defaultOp} = 'bool_eq' then ${op} in ('bool_eq', 'bool_ne')
    when ${defaultOp} = 'enum_like_bool_eq' then ${op} = 'enum_like_bool_eq'
    when ${defaultOp} = 'custom' then ${op} = 'custom'
    else false
  end`;
}

function applyUrlDatagridState(
  s: StateStatements,
  columns: Column[],
  fns: DynamicDatagridFns,
  enableFiltering: boolean,
) {
  if (enableFiltering && columns.some((column) => column.filter)) {
    s.defScalar("url_filters_json", {
      type: "Json",
      expr: sql`try_cast(filters as json)`,
    });
    const urlFilterRows = sql`select
        fn.${fns.storageNameToId}(value->>'column') as column_id,
        try_cast(value->>'op' as enums.dg_filter_op) as op,
        left(value->>'value_1', 2000) as value_1,
        left(value->>'value_2', 2000) as value_2,
        left(value->>'value_3', 2000) as value_3
      from json.array_each(url_filters_json)
      where json_typeof(value) = 'object'
      limit 255`;
    s.if(sql`json_typeof(url_filters_json) = 'array'`, (s) => {
      s.if(
        sql`json_array_length(url_filters_json) = 0 or exists (
          select 1
          from (${urlFilterRows}) url_filter_candidate
          where ${
          urlFilterOpAllowed(
            fns,
            sql`url_filter_candidate.column_id`,
            sql`url_filter_candidate.op`,
          )
        }
        )`,
        (s) => {
          s.modify(sql`delete from filter_terms`);
          s.setScalar("root_filter_is_any", false);
          s.setScalar("next_filter_id", 0);
          s.forEachQuery(urlFilterRows, "url_filter", (s) => {
            s.if(
              urlFilterOpAllowed(
                fns,
                sql`url_filter.column_id`,
                sql`url_filter.op`,
              ),
              (s) => {
                s.modify(sql`insert into filter_terms
                  (id, column_id, ordering, op, value_1, value_2, value_3)
                values (
                  next_filter_id,
                  url_filter.column_id,
                  ordering.n_after(next_filter_id::bigint),
                  url_filter.op,
                  url_filter.value_1,
                  url_filter.value_2,
                  url_filter.value_3
                )`);
                s.increment("next_filter_id");
              },
            );
          });
        },
      );
    });
  }

  const sortableColumnIds = columns.flatMap((column, id) =>
    column.sort ? [id] : []
  );
  if (sortableColumnIds.length > 0) {
    s.defScalar("url_sort_json", {
      type: "Json",
      expr: sql`try_cast(sort as json)`,
    });
    const urlSortRows = sql`select
        fn.${fns.storageNameToId}(value->>'column') as column_id,
        value->>'sort' as direction
      from json.array_each(url_sort_json)
      where json_typeof(value) = 'object'
      limit 255`;
    s.if(sql`json_typeof(url_sort_json) = 'array'`, (s) => {
      s.if(
        sql`json_array_length(url_sort_json) = 0 or exists (
          select 1
          from (${urlSortRows}) url_sort_candidate
          where ${
          sql.inList(
            sql`url_sort_candidate.column_id`,
            sortableColumnIds,
          )
        }
            and url_sort_candidate.direction in ('asc', 'desc')
        )`,
        (s) => {
          s.modify(sql`update column set sort_index = null, sort_asc = null`);
          s.defScalar("url_sort_index", {
            type: "TinyUint",
            expr: 0,
          });
          s.forEachQuery(urlSortRows, "url_sort", (s) => {
            s.if(
              sql`${
                sql.inList(
                  sql`url_sort.column_id`,
                  sortableColumnIds,
                )
              } and url_sort.direction in ('asc', 'desc')`,
              (s) => {
                s.modify(sql`update column
                set sort_index = url_sort_index,
                    sort_asc = url_sort.direction = 'asc'
                where id = url_sort.column_id`);
                s.increment("url_sort_index");
              },
            );
          });
        },
      );
    });
  }
}

function ErrorDisplay() {
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("show_query_err", {
          type: "Bool",
        });
      }}
    >
      <EventHandlers
        document={{
          keydown: (s) => {
            s.if(
              sql`event.meta_key and event.shift_key and event.key = 'v'`,
              (s) => {
                s.toggle("show_query_err");
              },
            );
          },
        }}
      />
      <Show when={sql`show_query_err`}>
        <div sx={styles.queryError}>
          <p>{sql`dg_error.message`}</p>
          <p>{sql`dg_error.description`}</p>
        </div>
      </Show>
    </Data>
  );
}

const styles = createStyles({
  seperatorWrapper: {
    position: "absolute",
    right: -8,
    cursor: "col-resize",
    display: "flex",
    flexDirection: "row",
    justifyContent: "center",
    width: 16,
    zIndex: 1000,
    "& > div": {
      visibility: "hidden",
    },
    "&:hover > div": {
      visibility: "visible",
    },
  },
  seperator: {
    display: "flex",
    alignItems: "center",
    cursor: "col-resize",
    fontSize: "2xl",
    color: "text-secondary",
    zIndex: 1000,
    userSelect: "none",
    height: 36,
    width: 4,
    backgroundColor: "primary-500",
    "&.active": {
      "& > div": {
        visibility: "visible",
      },
    },
  },
  columnDialog: (app) => {
    return {
      position: "fixed",
      backgroundColor: "background-popup",
      borderRadius: "md",
      boxShadow: "md",
      zIndex: 100,
      minWidth: 192,
      width: 192,
      border: "1px solid",
      borderColor: "divider",

      opacity: 0,
      transformOrigin: "top right",
      transform: "scale(0)",

      "&:popover-open": {
        opacity: 1,
        transform: "none",
        "@starting-style": {
          "&": {
            opacity: 0,
            transform: "scale(0)",
          },
        },
      },

      margin: 0,
      transition:
        `opacity ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, transform ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, display ${app.theme.transitionDurations.popover} allow-discrete`,
    };
  },
  drawerGridWrapper: {
    width: "100%",
    height: "100%",
    display: "flex",
  },
  queryError: {
    position: "absolute",
    bottom: 20,
    left: 8,
    backgroundColor: "danger-500",
    zIndex: 10000,
    color: "common-white",
    p: 4,
  },
});

export function DynamicDatagrid(props: DynamicDatagridProps) {
  const {
    columns,
    datagridName,
    tableModel,
    toolbar,
    pageSize,
    defaultView,
    extraState,
    enableViews,
    enableFiltering,
    defaultRowHeight,
    additionalWhere,
    quickSearch,
  } = props;
  // Saved views may be shared across apps with different column definitions.
  // Only generated helpers are app-scoped; keep their storage key unchanged.
  const helperNamespace = `dg_${
    hashSha256(JSON.stringify([useApp().domain, datagridName]))
  }`;
  const fns = defineDynamicDatagridFns(helperNamespace, columns);
  const filterExprProcedureName = enableFiltering
    ? defineFilterExprProcedure(helperNamespace, fns)
    : undefined;

  if (props.standaloneRecordNavigation) {
    useSeparatedDatagridRecordNavigationState();
  }

  const queryParams: Parameters<typeof useQueryParams>[0] = [];
  const urlStateWatch: Sql[] = [];
  if (enableViews) {
    queryParams.push({ name: "view", type: { type: "BigUint" } });
  }
  if (quickSearch) {
    queryParams.push({
      name: "q",
      type: { type: "String", maxLength: 1000 },
    });
  }
  if (enableFiltering && columns.some((column) => column.filter)) {
    queryParams.push({
      name: "filters",
      type: { type: "String", maxLength: 10_000 },
    });
    urlStateWatch.push(sql`filters`);
  }
  if (columns.some((column) => column.sort)) {
    queryParams.push({
      name: "sort",
      type: { type: "String", maxLength: 10_000 },
    });
    urlStateWatch.push(sql`sort`);
  }
  if (queryParams.length > 0) {
    useQueryParams(queryParams);
  }
  const retainGridState = Boolean(
    props.recordPage || props.standaloneRecordNavigation,
  );
  const resetKeyScalar = retainGridState
    ? `datagrid_${datagridName}_reset_key`
    : "reset_key";
  const selectedView = retainGridState ? sql`datagrid_view` : sql`view`;
  if (enableViews && retainGridState) {
    // The generation must outlive record routes without restoring stale snapshots.
    useGlobalState({
      key: resetKeyScalar,
      procedure: (s) => s.defScalar(resetKeyScalar, 0),
    });
  }
  const ctx = new DynamicDatagridContext(
    datagridName,
    enableViews,
    enableFiltering,
    columns,
    tableModel,
    additionalWhere,
    fns,
    filterExprProcedureName,
    quickSearch,
    retainGridState,
    resetKeyScalar,
  );
  ctx.selectable = props.selectable;
  addCtx(ctx);
  const metaProc = editFocusState();
  const rowCountProc = new StateStatements();
  if (pageSize) {
    if (props.standaloneRecordNavigation) {
      rowCountProc.defScalar(
        "row_count",
        sql`case
            when ui.datagrid_record_navigation_source = ${
          sql.lit(props.standaloneRecordNavigation.listPath)
        }
            then greatest(${pageSize}, coalesce(ui.datagrid_record_navigation_row_count, ${pageSize}))
            else ${pageSize}
          end`,
      );
    } else {
      metaProc.defScalar("row_count", pageSize);
    }
  }
  if (props.recordPage) {
    metaProc.defScalar("datagrid_record_navigation_context", false);
    metaProc.defScalar("datagrid_record_navigation_loading", false);
    metaProc.defScalar("datagrid_record_navigation_load_failed", false);
    metaProc.defScalar("datagrid_record_navigation_has_more", false);
    metaProc.defTable("datagrid_record_navigation_rows", {
      fields: [
        { name: "position", notNull: true, type: "BigUint" },
        { name: "record_id", notNull: true, type: "BigUint" },
      ],
    });
  }
  const initialColumnInsertValues = columns.map((col, i) => {
    const generate = col.queryGeneration?.alwaysGenerate ?? false;
    const prevDisplayCount = columns
      .slice(0, i)
      .filter((v) => Boolean(v.displayInfo)).length;
    const initialWidth = col.displayInfo?.initialWidth ?? 200;
    const initiallyDisplaying = col.displayInfo?.initiallyDisplaying ?? false;
    return valuesRow(
      i,
      initialWidth,
      initiallyDisplaying,
      sql`ordering.n_after(${prevDisplayCount})`,
      generate,
      Boolean(col.queryGeneration),
      col.displayInfo?.pin === "left",
      col.displayInfo?.pin === "right",
      col.canReorder ?? true,
      col.canPin ?? true,
      col.canHide ?? true,
    );
  });
  metaProc.defTable("column", {
    fields: [
      { name: "id", type: "SmallUint" },
      { name: "width", type: "SmallUint" },
      { name: "displaying", type: "Bool" },
      { name: "sort_index", type: "TinyUint" },
      { name: "sort_asc", type: "Bool" },
      { name: "ordering", notNull: true, type: "Ordering" },
      { name: "always_generate", notNull: true, type: "Bool" },
      { name: "has_query_generation", notNull: true, type: "Bool" },
      { name: "pin_left", notNull: true, type: "Bool" },
      { name: "pin_right", notNull: true, type: "Bool" },
      { name: "can_reorder", notNull: true, type: "Bool" },
      { name: "can_pin", notNull: true, type: "Bool" },
      { name: "can_hide", notNull: true, type: "Bool" },
    ],
  });
  // Ui Tables for columns_views and filters
  metaProc.modify(
    sql`insert into column (id, width, displaying, ordering, always_generate, has_query_generation, pin_left, pin_right, can_reorder, can_pin, can_hide) values ${initialColumnInsertValues}`,
  );
  metaProc.defScalar(
    "row_height",
    rowHeightInPixels(defaultRowHeight ?? "medium"),
  );

  if (enableFiltering) {
    metaProc.defScalar("root_filter_is_any", false);
    metaProc.defTable("filter_terms", {
      fields: filterTermFields,
    });
    metaProc.defScalar("next_filter_id", {
      type: "SmallUint",
      expr: 0,
      allowNoRead: true,
    });
  }
  if (enableViews) {
    const loadFilter = new StateStatements();
    if (enableFiltering) {
      const loadedFilterOp = fns.idToLegacyCustomOp
        ? sql`case
            when op = 'custom' then coalesce(
              fn.${fns.idToLegacyCustomOp}(
                fn.${fns.storageNameToId}(column_name)
              ),
              op
            )
            else op
          end`
        : sql`op`;
      loadFilter
        .modify(sql`insert into filter_terms
            (id, group_id, is_any, column_id, ordering, op, value_1, value_2, value_3)
          select
            id,
            group_id,
            is_any,
            fn.${fns.storageNameToId}(column_name),
            ordering,
            ${loadedFilterOp},
            value_1,
            value_2,
            value_3
          from db.datagrid_view_filter_terms where view_id = view_record.id`)
        .setScalar(
          "next_filter_id",
          sql`coalesce((select max(id) from filter_terms), 0) + 1`,
        );
    }
    const loadDefault = new StateStatements();
    if (defaultView) {
      const reordered = columns.map((col, id) => ({
        name: col.viewStorageName,
        id,
      }));
      const columnOrder = defaultView.columnOrder ?? defaultView.displayColumns;
      if (columnOrder) {
        for (let i = 0; i < columnOrder.length; i++) {
          const name = columnOrder[i];
          const oldIndex = reordered.findIndex((x) => x.name === name);
          if (oldIndex === -1) {
            throw new Error(
              `Invalid default view column order: column ${name} not found`,
            );
          }
          const column = reordered.splice(oldIndex, 1)[0];
          reordered.splice(i, 0, column);
        }
      }
      const displayColumns = defaultView.displayColumns;
      if (displayColumns) {
        const defaultVisibility = reordered.map(({ name, id }, sequence) => ({
          sequence,
          id,
          displaying: columns[id].canHide === false ||
            displayColumns.includes(name),
        }));
        loadDefault.forEachQuery(
          sql`${sql.fromArray(defaultVisibility)} order by sequence`,
          "default_column",
          (s) => {
            s.modify(sql`update column
              set displaying = default_column.displaying
              where id = default_column.id`);
          },
        );
      }
      const defaultSort = defaultView.sort ?? [];
      const hasDefaultSort = defaultSort.length > 0;
      const defaultOrdering = reordered.map(({ name, id }, sequence) => {
        const sortIndex = defaultSort.findIndex(
          (sort) => name === sort.column,
        );
        return {
          sequence,
          id,
          ordering: sql`ordering.n_after(${sequence})`,
          ...(hasDefaultSort
            ? {
              sort_index: sortIndex === -1 ? sql`null::tinyuint` : sortIndex,
              sort_asc: sortIndex === -1
                ? sql`null::bool`
                : defaultSort[sortIndex].sort === "asc",
            }
            : {}),
        };
      });
      loadDefault.forEachQuery(
        sql`${sql.fromArray(defaultOrdering)} order by sequence`,
        "default_column",
        (s) => {
          const orderingAssignment = updateAssignment(
            "ordering",
            sql`default_column.ordering`,
          );
          const orderingUpdate = sql.update(
            "column",
            [orderingAssignment],
            sql`id = default_column.id`,
          );
          if (!hasDefaultSort) {
            s.modify(orderingUpdate);
            return;
          }
          s.if(sql`default_column.sort_index is null`, (s) => {
            s.modify(orderingUpdate);
          }, (s) => {
            s.modify(
              sql.update(
                "column",
                [
                  orderingAssignment,
                  updateAssignment(
                    "sort_index",
                    sql`default_column.sort_index`,
                  ),
                  updateAssignment(
                    "sort_asc",
                    sql`default_column.sort_asc`,
                  ),
                ],
                sql`id = default_column.id`,
              ),
            );
          });
        },
      );
      if (defaultView.filter) {
        for (let i = 0; i < defaultView.filter.length; i++) {
          const filter = defaultView.filter[i];
          const id = reordered.find((x) => x.name === filter.column)?.id;
          if (id === undefined) {
            throw new Error(
              `Invalid default view filter: column ${filter.column} not found`,
            );
          }
          loadDefault
            .modify(
              sql`insert into filter_terms (id, column_id, ordering, op, value_1) values
            (next_filter_id, ${id}, ordering.n_after(${i}), cast(${
                sql.lit(filter.op)
              } as enums.dg_filter_op), ${sql.lit(filter.value_1)})`,
            )
            .increment("next_filter_id");
        }
      }
    } else {
      loadDefault.forEachQuery(
        sql`select id from column`,
        "column_record",
        (s) => {
          s.modify(sql`update column
                  set ordering = ordering.new((select max(ordering) from column))
                  where id = column_record.id`);
        },
      );
    }
    metaProc.block((s) => {
      s.defScalar("using_view", false);
      s.if(sql`${selectedView} is not null`, (s) => {
        s.defRecord(
          "view_record",
          sql`select * from db.datagrid_views where id = ${selectedView}`,
        );
        s.if(sql`view_record.id is not null`, (s) => {
          s.setScalar("using_view", true);
          s.setScalar(
            "root_filter_is_any",
            sql`view_record.root_filter_is_any`,
          );
          s.setScalar("row_height", sql`view_record.row_height`);
          s.forEachQuery(
            sql`select * from db.datagrid_view_columns where view_id = view_record.id`,
            "view_column",
            (s) => {
              s.modify(
                sql`update column set ordering = case when can_reorder then view_column.ordering else ordering end,
                  sort_asc = view_column.sort_asc,
                  sort_index = view_column.sort_index,
                  displaying = case when can_hide then view_column.displaying else true end,
                  pin_left = case when can_pin then coalesce(view_column.pin_left, pin_left) else pin_left end,
                  pin_right = case when can_pin then coalesce(view_column.pin_right, pin_right) else pin_right end,
                  width = coalesce(view_column.width, width)
                where id = fn.${fns.storageNameToId}(view_column.name)`,
              );
            },
          );
          s.forEachQuery(
            sql`select id from column
              where can_reorder
                and not exists (
                  select 1
                  from db.datagrid_view_columns saved_column
                  where saved_column.view_id = view_record.id
                    and fn.${fns.storageNameToId}(saved_column.name) = column.id
                )
              order by ordering`,
            "column_record",
            (s) => {
              s.modify(sql`update column
                  set ordering = ordering.new((select max(ordering) from column))
                  where id = column_record.id and can_reorder`);
            },
          )
            .forEachQuery(
              sql`select id from column where pin_left and can_reorder order by ordering`,
              "column_record",
              (s) => {
                s.defScalar(
                  "column_ordering",
                  sql`(select ordering from column where id = column_record.id)`,
                );
                s.modify(sql`update column
                    set ordering = ordering.new(
                      (select max(ordering) from column
                        where pin_left
                          and (not can_reorder or (can_reorder and ordering < column_ordering))),
                      (select min(ordering) from column
                        where pin_left
                          and can_reorder
                          and ordering > column_ordering)
                    )
                    where id = column_record.id`);
              },
            )
            .statements(loadFilter);
        });
      });
      s.unless(sql`using_view`, loadDefault);
    });
  }
  applyUrlDatagridState(metaProc, columns, fns, enableFiltering);
  if (enableFiltering) {
    // Repair only the unambiguous legacy exact-date pair, after either a saved
    // view or URL has initialized the filters. Persisted views remain untouched.
    metaProc.modify(sql`update filter_terms
      set value_2 = value_1, value_1 = 'exact date'
      where (fn.is_date_filter_op(op) or fn.is_timestamp_filter_op(op))
        and value_2 = 'exact date'
        and regex.is_match(value_1, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        and try_cast(value_1 as date) is not null`);
  }
  metaProc.statements(extraState);
  metaProc.defScalar("last_saved_state_hash", {
    expr: ctx.viewStateHash(metaProc),
    allowNoRead: true,
  });
  metaProc.defScalar("has_unsaved_view_changes", false);
  metaProc.defScalar("has_changes_refresh_key", 0);
  const app = useApp();
  const watchKeys: Sql[] = [sql`dg_refresh_key`];
  if (enableViews) {
    watchKeys.push(selectedView, sql.ref(resetKeyScalar));
  }
  if (quickSearch) {
    watchKeys.push(sql`q`);
  }
  const dataFetchWatch = app.createFocusRefreshWatch(...watchKeys);
  const dataFetchProc = (s: StateStatements) => {
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.filter?.type === "string" && col.filter.relation) {
        if (col.filterExpr) {
          throw new Error(
            `Column ${col.viewStorageName} cannot provide both filter.relation and filterExpr`,
          );
        }
        for (const op of stringFilterOps) {
          s.validateQueryExpr(
            sql.concatTemplate`select 1 from ${
              sql.lit(ctx.table.identWithDb.toSQL())
            } as record where ${
              relationStringFilterExpr(
                col.filter,
                sql.lit("example"),
                op,
              )
            }`,
            `relation string filter ${op} for column ${col.viewStorageName}`,
          );
        }
      }
      if (col.filterExpr) {
        if (!col.filterExampleValues) {
          throw new Error(
            `filterExpr for column ${col.viewStorageName} is provided but filterExampleValues is not`,
          );
        }
        // `filterExpr` returns SQL that evaluates to a String of predicate
        // text inlined into the datagrid query at runtime — same contract as
        // the built-in `encode_dg_filter_op` rules. The validator folds the
        // expression with literal example values and re-parses the resulting
        // String as a SQL fragment in the `where` clause, so `record` is the
        // expected alias for the underlying table.
        s.validateQueryExpr(
          sql.concatTemplate`select 1 from ${
            sql.lit(ctx.table.identWithDb.toSQL())
          } as record where ${
            col.filterExpr(
              sql.lit(col.filterExampleValues.value1),
              sql.lit(col.filterExampleValues.value2 ?? ""),
              sql.lit(col.filterExampleValues.value3 ?? ""),
            )
          }`,
          `filterExpr for column ${col.viewStorageName}`,
        );
      }
      if (!col.queryGeneration) {
        continue;
      }
      const { expr } = col.queryGeneration;
      const validate = (s: StateStatements) => {
        s.validateQueryExpr(
          sql.concatTemplate`select ${expr} from ${
            sql.lit(ctx.table.identWithDb.toSQL())
          } as record`,
          `queryGeneration.expr for column ${col.viewStorageName}`,
        );
      };
      if (props.validateHiddenColumnQueries === false) {
        s.if(
          sql`(select displaying or always_generate or sort_index is not null from ui.column where id = ${i})
            or exists (select 1 from ui.filter_terms where column_id = ${i})`,
          validate,
        );
      } else {
        validate(s);
      }
    }

    // s.if(sql`trim(coalesce(dg_search_query, '')) != ''`, (s) => {
    //   const searchConfig = tableModel.searchConfig;
    //   if (!searchConfig) {
    //     throw new Error(`Table ${tableModel.name} does not have searchConfig`);
    //   }

    //   s.search({
    //     query: sql`dg_search_query`,
    //     resultTable: "db_search_result",
    //     offset: 0,
    //     limit: pageSize || 1000,
    //     config: {
    //       tokenizer: {
    //         splitter: { type: "Alphanumeric" },
    //         filters: [{ type: "AsciiFold" }, { type: "Lowercase" }],
    //       },
    //       style: {
    //         type: "Fuzzy",
    //         ...system.searchConfig.defaultFuzzyConfig,
    //       },
    //       tables: [
    //         {
    //           ...searchConfig,
    //           filterExpr: ctx.additionalWhere,
    //           // dynamicFilterExpr: ctx.additionalWhere,
    //         },
    //       ],
    //     },
    //   });

    //   //This needs to be changed so that the result table can be referenced in the dynamicQuery.
    //   // s.dynamicQuery({
    //   //   resultTable: "dg_table",
    //   //   query: sql.concat(
    //   //     "select ",
    //   //     sql`(select string_agg(
    //   //       case
    //   //         when not has_query_generation then null
    //   //         when ${shouldGenerateColumn} then fn.${ctx.fns.idToSqlExpr}(id) || ' as col_' || id
    //   //         else 'null'
    //   //       end, ',')
    //   //     from ui.column)`,
    //   //     " from ",
    //   //     sql.lit(ctx.table.identWithDb.toSQL()),
    //   //     " as record ",
    //   //     " where ",
    //   //     sql`${ctx.table.primaryKeyIdent} in (select record_id from db_search_result)`,
    //   //     ctx.additionalWhere
    //   //       ? sql` and (${ctx.additionalWhere})`
    //   //       : undefined,
    //   //     sql`coalesce(${filterExpr(ctx.fns)}, ' and true')`,
    //   //     orderByPart,
    //   //     " limit ",
    //   //     sql`ui.row_count`,
    //   //   ),
    //   //   columnCount: columns.filter((v) => Boolean(v.queryGeneration)).length,
    //   // });
    // }
    // );

    if (props.standaloneRecordNavigation) {
      s.defScalar(
        DATAGRID_RECORD_NAVIGATION_CAPTURE_SOURCE,
        sql.lit(props.standaloneRecordNavigation.listPath),
      );
      s.defScalar(
        DATAGRID_RECORD_NAVIGATION_CAPTURE_QUERY_PREFIX,
        ctx.recordNavigationIdsQueryPrefix(s),
      );
      s.defScalar(
        DATAGRID_RECORD_NAVIGATION_CAPTURE_COUNT_QUERY,
        ctx.buildCountQuery(s),
      );
    }
    s.dynamicQuery({
      resultTable: "dg_table",
      query: props.recordPage || props.standaloneRecordNavigation
        ? ctx.recordNavigationDynamicQuery(s)
        : ctx.buildDynamicQuery(s),
      columnCount: columns.filter((v) => Boolean(v.queryGeneration)).length,
      ...(props.recordPage || props.standaloneRecordNavigation
        ? {
          rowCap: sql`ui.row_count`,
          setHasMoreScalar: "ui.datagrid_record_navigation_has_more",
        }
        : {}),
    });
  };
  const columnToResultField = new Map<number, Sql>();
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.queryGeneration) {
      columnToResultField.set(i, sql.ref(`field_${columnToResultField.size}`));
    }
  }
  const renderedColumns = columns
    .map((column, sourceId) => ({ column, sourceId }))
    .filter(({ column }) => Boolean(column.displayInfo));
  const dg = (
    <Datagrid
      table="dg_table"
      tableKey={sql`field_0`}
      recordName="dg_record"
      rowHeight={sql`row_height`}
      headerHeight={44}
      focusedColumn={sql`focus_state.column`}
      focusedRow={sql`focus_state.row`}
      shouldFocusCell={sql`focus_state.should_focus`}
      sx={{
        root: sharedStyles.root(),
        row: sharedStyles.row,
        cell: sharedStyles.cell(),
        headerCell: sharedStyles.headerCell(),
        header: sharedStyles.header,
      }}
      onKeyboardNavigation={(s) => {
        s.modify(
          sql`update ui.focus_state set column = cell.column, row = cell.row, should_focus = true`,
        );
        s.modify(sql`update ui.editing_state set is_editing = false`);
      }}
      onCellClick={(s) => {
        s.modify(
          sql`update ui.focus_state set column = cell.column, row = cell.row, should_focus = true`,
        );
        s.modify(sql`update ui.editing_state set is_editing = false`);
        s.statements(colClickHandlers(columns));
      }}
      onCellDoubleClick={(s) => {
        s.modify(
          sql`update ui.focus_state set column = cell.column, row = cell.row, should_focus = false`,
        );
        s.modify(
          sql`update ui.editing_state set column = cell.column, row = cell.row, is_editing = true`,
        );
        s.setScalar("ui.start_edit_empty", false);
      }}
      onCellKeydown={colKeydownHandlers(columns)}
      onFetchMore={typeof props.pageSize === "number"
        ? (s) => {
          s.increment("ui.row_count", props.pageSize);
          ctx.triggerRefetch(s);
        }
        : undefined}
      columns={renderedColumns
        .map(({ column: col, sourceId }) => {
          const field = columnToResultField.get(sourceId);
          const { cell: Cell, header } = col.displayInfo!;
          const CellWrapped = typeof Cell === "function"
            ? () => {
              const helper = useCellHelper();
              return <Cell helper={helper} />;
            }
            : Cell;
          return {
            cell: (
              <SourceMap source={`cell ${col.viewStorageName ?? sourceId}`}>
                <WithContext
                  context={new CurrentColumnContext(
                    sourceId,
                    sql.ref("dg_record"),
                    field,
                    sql`(select id from ui.column where displaying and ordering > (select ordering from ui.column where id = ${sourceId}) order by ordering limit 1)`,
                    sql`cast(dg_record.${sql`field_0`} as bigint)`,
                    sql.ref("field_0"),
                  )}
                >
                  {typeof CellWrapped === "function"
                    ? <CellWrapped />
                    : CellWrapped}
                </WithContext>
              </SourceMap>
            ),
            header: (
              <SourceMap
                source={`header cell ${col.viewStorageName ?? sourceId}`}
              >
                {header}
              </SourceMap>
            ),
            width: sql`(select width from column where id = ${sourceId})`,
            ordering: sql`(select ordering from column where id = ${sourceId})`,
            visible:
              sql`(select displaying from column where id = ${sourceId})`,
            pinLeft: sql`(select pin_left from column where id = ${sourceId})`,
            pinRight:
              sql`(select pin_right from column where id = ${sourceId})`,
          };
        })}
      columnMetadataSource={{
        table: "column",
        columnIds: renderedColumns.map(({ sourceId }) => sourceId),
        idField: "id",
        widthField: "width",
        visibleField: "displaying",
        orderingField: "ordering",
        pinLeftField: "pin_left",
        pinRightField: "pin_right",
      }}
    />
  );
  const gridContent = (
    <>
      <SourceMap source="datagrid toolbar">{toolbar}</SourceMap>
      <ErrorDisplay />
      <Show
        when={sql`status = 'failed' and dg_error.message = ${
          sql.lit(INVALID_DATE_FILTER_MESSAGE)
        }`}
      >
        <Alert startIcon="Report" size="sm" color="danger" variant="solid">
          {sql`dg_error.message`}
        </Alert>
      </Show>
      <div sx={styles.drawerGridWrapper}>
        <Show
          when={sql`(status = 'requested' or status = 'fallback_triggered') and dg_refresh_key = 0 and not dg_has_data`}
          fallback={props.emptyState
            ? (
              <Show
                when={sql`status = 'received' and not exists (select 1 from dg_table)`}
                fallback={dg}
              >
                <div role="status" className="w-full">{props.emptyState}</div>
              </Show>
            )
            : dg}
        >
          <div sx={sharedStyles.emptyGrid} />
        </Show>
      </div>
      {props.bulkActionsProps
        ? <BulkActionsSnackbar {...props.bulkActionsProps} />
        : null}
    </>
  );
  const gridData = (
    <Data
      watch={dataFetchWatch}
      procedure={dataFetchProc}
      statusScalar="status"
      hasDataScalar="dg_has_data"
      errorRecord="dg_error"
      pendingFallback={null}
      errorFallback={null}
      debounce={quickSearch ? { wait: 250, noWaitOnFirst: true } : undefined}
    >
      {gridContent}
    </Data>
  );
  const recordAccessWatch = [
    sql`ui.record_id`,
    sql`dg_refresh_key`,
    sql.ref(GLOBAL_REFETCH_SCALAR),
  ];
  if (quickSearch) {
    recordAccessWatch.push(sql`q`);
  }
  const recordPageContent = props.recordPage
    ? (
      <>
        <DatagridRecordNavigation
          listPath={props.recordPage.listPath}
          pageSize={props.pageSize}
          dynamicQuery={(s) => ctx.recordNavigationDynamicQuery(s)}
          countQuery={(s) => ctx.buildCountQuery(s)}
          columnCount={columns.filter((column) => column.queryGeneration)
            .length}
          showExactResultCount={props.recordPage.showExactResultCount}
        />
        {props.recordPage.content}
      </>
    )
    : null;
  const routedContent = props.recordPage
    ? (
      <Routes>
        <Route path={props.recordPage.detailPath}>
          {ctx.additionalWhere
            ? (
              <Data
                watch={recordAccessWatch}
                procedure={(s) => {
                  s.dynamicQuery({
                    resultTable: "datagrid_record_access_result",
                    query: ctx.recordAccessQuery(sql`ui.record_id`),
                    columnCount: 1,
                  });
                  s.defScalar(
                    "datagrid_record_allowed",
                    sql`exists(select 1 from datagrid_record_access_result)`,
                  );
                }}
              >
                {recordPageContent}
              </Data>
            )
            : recordPageContent}
        </Route>
        <Route path={props.recordPage.listPath} exact>
          {gridData}
        </Route>
      </Routes>
    )
    : gridData;
  const datagridStateWatch = enableViews
    ? [selectedView, sql.ref(resetKeyScalar), ...urlStateWatch]
    : urlStateWatch;
  const refreshedContent = (
    <Data
      watch={datagridStateWatch}
      procedure={refreshKeyState()}
      pendingFallback={null}
      errorFallback={null}
    >
      {routedContent}
    </Data>
  );
  const routeStateContent = props.standaloneRecordNavigation
    ? (
      <Data
        local
        procedure={rowCountProc}
        pendingFallback={null}
        errorFallback={null}
      >
        {refreshedContent}
      </Data>
    )
    : refreshedContent;
  const content = (
    <Data
      watch={datagridStateWatch}
      hoistKey={retainGridState
        ? [
          sql.lit(datagridName),
          // Hoist keys must be non-null; keep Default View distinct from ID 0.
          ...(enableViews
            ? [
              sql`${selectedView} is null`,
              sql`coalesce(${selectedView}, 0)`,
              sql.ref(resetKeyScalar),
            ]
            : []),
          ...urlStateWatch.map((value) => sql`coalesce(${value}, '')`),
        ]
        : enableViews
        ? [sql`view`, sql`reset_key`, ...urlStateWatch]
        : []}
      local
      procedure={metaProc}
      pendingFallback={null}
      errorFallback={null}
    >
      {routeStateContent}
    </Data>
  );
  if (enableViews && retainGridState) {
    return (
      <Data
        local
        // Apply view and generation together so switching issues only one fetch.
        autoWatch={false}
        watch={sql.ref(resetKeyScalar)}
        procedure={(s) => s.defScalar("datagrid_view", sql`view`)}
      >
        <Effect
          watch={sql`view`}
          onChange={(s) => s.increment(resetKeyScalar)}
        />
        {content}
      </Data>
    );
  }
  if (enableViews) {
    return (
      <Data
        local
        noRefetch
        procedure={(s) => {
          s.defScalar("reset_key", 0);
        }}
      >
        {content}
      </Data>
    );
  }
  return content;
}

export class CurrentColumnContext
  implements ContextInstance, DatagridCurrentCellICtx {
  implementICtxs = [DatagridCurrentCellICtxKey];

  constructor(
    public column: number,
    public rowRecord: Sql,
    public resultField: Sql | undefined,
    public nextColumn: NumericExpr,
    public recordId: NumericExpr,
    public idField: Sql,
  ) {}
}

export interface ColumnQueryGeneration {
  expr: AnyExpr;
  alwaysGenerate: boolean;
}

export interface CellProps {
  helper: DgCellHelper;
}

export interface ColumnDisplayInfo {
  initialWidth: number;
  cell: ((props: CellProps) => Node) | Node;
  header: Node;
  initiallyDisplaying: boolean;
  pin?: "left" | "right";
}

export interface Column extends ColumnEventHandlers {
  queryGeneration?: ColumnQueryGeneration;
  filterExpr?: (
    value1: Sql,
    value2: Sql,
    value3: Sql,
  ) => Sql;
  displayInfo?: ColumnDisplayInfo;
  viewStorageName: string;
  export?: {
    name: string;
    expr: AnyExpr;
  };
  columnsDisplayName?: string;
  filterDisplayName?: string;
  filterOptGroup?: string;
  filter?: FilterType;
  filterExampleValues?: {
    value1: string;
    value2?: string;
    value3?: string;
  };
  sort?: SortConfig;
  canReorder: boolean;
  canPin?: boolean;
  /** Whether users and saved views may hide this displayed column. */
  canHide?: boolean;
}

export type SortConfig =
  | {
    type: "string" | "numeric" | "checkbox";
    displayName: string;
  }
  | {
    type: "custom";
    displayName: string;
    ascNode: Node;
    descNode: Node;
    ascText: Sql;
    descText: Sql;
  };

export function eqFilterType(l: FilterType, r: FilterType) {
  if (l.type !== r.type) {
    return false;
  }
  switch (l.type) {
    case "string":
    case "number":
    case "date":
    case "bool":
    case "timestamp":
    case "minutes_duration":
      return l.notNull === (r as any).notNull;
    case "table":
      return (r as any).table === l.table && l.notNull === (r as any).notNull;
    case "enum":
      return (r as any).enum === l.enum && l.notNull === (r as any).notNull;
    case "enum_like_bool":
      return (r as any).config === l.config && l.notNull === (r as any).notNull;
    case "custom":
      return (r as any).node === l.node;
  }
}

export function defaultOpForFieldType(type: FilterType) {
  switch (type.type) {
    case "number":
      return "num_eq";
    case "string":
      return type.defaultOp ?? "str_eq";
    case "date":
      return "date_eq";
    case "timestamp":
      return "timestamp_eq";
    case "enum":
      return "enum_eq";
    case "table":
      return "fk_eq";
    case "bool":
      return "bool_eq";
    case "enum_like_bool":
      return "enum_like_bool_eq";
    case "minutes_duration":
      return "minute_duration_eq";
    case "custom":
      return "custom";
  }
}

export type FilterType =
  | {
    type: "string";
    notNull: boolean;
    /** Compare against individual related values instead of the column expression. */
    relation?: RelationStringFilter;
    /** Initial operator for newly added filters. */
    defaultOp?: StringFilterOp;
    /** Remaps saved filters created while this column used a custom operator. */
    legacyCustomOp?: StringFilterOp;
  }
  | {
    type:
      | "number"
      | "date"
      | "bool"
      | "timestamp"
      | "minutes_duration";
    notNull: boolean;
  }
  | {
    type: "table";
    table: string;
    notNull: boolean;
  }
  | {
    type: "enum";
    enum: string;
    notNull: boolean;
    /**
     * A single related enum value. This preserves scalar NULL semantics for
     * `is not` and lets the filter reduce the related relation directly.
     */
    relation?: Omit<RelationStringFilter, "semantics"> & {
      semantics: "scalar";
    };
    /** Query-backed filter options with `value` and `label` columns. */
    optionsQuery?: Sql;
  }
  | {
    type: "enum_like_bool";
    config: BoolEnumLikeConfig;
    notNull: boolean;
  }
  | {
    type: "custom";
    node?: (helpers: FilterTermHelper) => Node;
  };

export interface DynamicDatagridFns {
  idToFilterExpr?: Sql;
  idToLegacyCustomOp?: Sql;
  idToRelationFilterFrom?: Sql;
  idToRelationFilterValue?: Sql;
  idToRelationFilterWhere?: Sql;
  idToRelationFilterSemantics?: Sql;
  idToSqlExpr: Sql;
  idToExportExpr?: Sql;
  idToExportName?: Sql;
  idToStorageName: Sql;
  storageNameToId: Sql;
  idToInitialWidth: (id: NumericExpr) => Sql;
  idToColumnsDisplayName: Sql;
  idToFilterDisplayName: (id: NumericExpr) => Sql;
  idToDefaultOp: (id: NumericExpr) => Sql;
  idToIsString: Sql;
}

function mappedDatagridValue(
  id: NumericExpr,
  mappings: [AnyExpr, AnyExpr][],
): Sql {
  if (mappings.length === 0) {
    return sql.null;
  }
  return sql.caseWhen({
    conditions: mappings.map(([mappedId, value]) => ({
      condition: sql`${id} = ${mappedId}`,
      expr: sql.normalizeExpr(value),
    })),
  });
}

function relationStringFilterExpr(
  filter: Extract<FilterType, { type: "string" }>,
  value1: Sql,
  op: StringFilterOp,
) {
  const relation = filter.relation!;
  const positiveOp = op === "str_ne"
    ? "str_eq"
    : op === "str_not_contains"
    ? "str_contains"
    : op === "str_not_matches"
    ? "str_matches"
    : op === "empty"
    ? "not_empty"
    : op;
  const relationValue = sql.lit(sql.exprToString(sql`(${relation.value})`));
  let encodedComparison: Sql;
  switch (positiveOp) {
    case "str_eq":
      encodedComparison =
        sql`${relationValue} || '=' || literal.string(${value1})`;
      break;
    case "str_contains":
      encodedComparison = sql`concat(
        'contains(',
        ${relationValue},
        ',',
        literal.string(${value1}),
        ')'
      )`;
      break;
    case "str_matches":
      encodedComparison = sql`concat(
        'regex.is_match(',
        ${relationValue},
        ',',
        literal.string(${value1}),
        ')'
      )`;
      break;
    case "not_empty":
      encodedComparison = sql`'(' || ${relationValue} ||
        ' is not null and ' || ${relationValue} || ' != '''')'`;
      break;
    default:
      throw new Error(`Unsupported relation string filter operator ${op}`);
  }
  const existsPredicate = sql`'exists (select 1 from ' ||
    ${sql.lit(relation.from.toSQL())} ||
    ' where (' || ${sql.lit(sql.exprToString(relation.where))} ||
    ') and (' || ${encodedComparison} || '))'`;
  const predicate = op === "str_ne" || op === "str_not_contains" ||
      op === "str_not_matches" || op === "empty"
    ? sql`'not ' || ${existsPredicate}`
    : existsPredicate;
  return op === "empty" || op === "not_empty"
    ? predicate
    : sql`case when coalesce(${value1}, '') = '' then 'true'
        else ${predicate}
      end`;
}

function defineDynamicDatagridFns(
  datagridName: string,
  columns: Column[],
): DynamicDatagridFns {
  const sqlExprs: AnyExpr[][] = [];
  const storageNamesToIds: AnyExpr[][] = [];
  const idsToStorageNames: AnyExpr[][] = [];
  const idsToFilterExpr: AnyExpr[][] = [];
  const idsToExportExpr: AnyExpr[][] = [];
  const idsToExportNames: AnyExpr[][] = [];
  const idsToInitialWidth: [AnyExpr, AnyExpr][] = [];
  const columnsDisplayName: AnyExpr[][] = [];
  const filterDisplayName: [AnyExpr, AnyExpr][] = [];
  const defaultOps: [AnyExpr, AnyExpr][] = [];
  const isStringCol: AnyExpr[][] = [];
  const legacyCustomOps: AnyExpr[][] = [];
  const relationFilterFromExprs: AnyExpr[][] = [];
  const relationFilterValueExprs: AnyExpr[][] = [];
  const relationFilterWhereExprs: AnyExpr[][] = [];
  const relationFilterSemantics: AnyExpr[][] = [];
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.queryGeneration) {
      sqlExprs.push([i, col.queryGeneration.expr]);
    }
    if (col.viewStorageName) {
      storageNamesToIds.push([sql.lit(col.viewStorageName), i]);
      idsToStorageNames.push([i, sql.lit(col.viewStorageName)]);
    }
    const relation = (col.filter?.type === "string" ||
        col.filter?.type === "enum")
      ? col.filter.relation
      : undefined;
    if (relation) {
      relationFilterFromExprs.push([
        i,
        sql.lit(relation.from.toSQL()),
      ]);
      relationFilterValueExprs.push([
        i,
        sql.lit(sql.exprToString(sql`(${relation.value})`)),
      ]);
      relationFilterWhereExprs.push([
        i,
        sql.lit(sql.exprToString(relation.where)),
      ]);
      relationFilterSemantics.push([
        i,
        sql.lit(relation.semantics ?? "many"),
      ]);
    } else if (col.filterExpr) {
      idsToFilterExpr.push([
        i,
        col.filterExpr(
          sql`input.value_1`,
          sql`input.value_2`,
          sql`input.value_3`,
        ),
      ]);
    }
    if (col.displayInfo?.initialWidth) {
      idsToInitialWidth.push([i, col.displayInfo.initialWidth]);
    }
    if (col.export) {
      idsToExportExpr.push([i, col.export.expr]);
      idsToExportNames.push([i, sql.lit(sql.ref(col.export.name).toSQL())]);
    }
    if (col.columnsDisplayName) {
      columnsDisplayName.push([i, sql.lit(col.columnsDisplayName)]);
    }
    if (col.filterDisplayName) {
      filterDisplayName.push([i, sql.lit(col.filterDisplayName)]);
    }
    if (col.filter) {
      const op = defaultOpForFieldType(col.filter);
      defaultOps.push([i, sql`cast(${sql.lit(op)} as enums.dg_filter_op)`]);
      isStringCol.push([
        i,
        col.filter.type === "string" ? sql.true : sql.false,
      ]);
      if (col.filter.type === "string" && col.filter.legacyCustomOp) {
        legacyCustomOps.push([
          i,
          sql`${sql.lit(col.filter.legacyCustomOp)}::enums.dg_filter_op`,
        ]);
      }
    }
  }
  const storageNameToIdDt = `${datagridName}_dg_col_storage_name_to_id`;
  system.rulesFunction({
    parameters: [
      {
        name: "sql_name",
        type: { type: "String", maxLength: 2000 },
      },
    ],
    rules: [[sql`input.sql_name`, sql`id`], ...storageNamesToIds],
    name: storageNameToIdDt,
    returnType: "Int",
  });
  const idToStorageName = `${datagridName}_dg_col_id_to_storage_name`;
  system.rulesFunction({
    parameters: [{ name: "id", type: "SmallUint" }],
    rules: [[sql`input.id`, sql`storage_name`], ...idsToStorageNames],
    name: idToStorageName,
    returnType: "String",
  });
  const idToSqlExprDt = `${datagridName}_dg_col_id_to_sql_expr`;
  system.rulesFunction({
    parameters: [{ name: "id", type: "SmallUint", notNull: true }],
    rules: [[sql`input.id`, sql`sql_expr`], ...sqlExprs],
    name: idToSqlExprDt,
    returnType: "String",
  });
  let idToFilterExpr: string | undefined;
  if (idsToFilterExpr.length > 0) {
    idToFilterExpr = `${datagridName}_dg_col_id_to_filter_expr`;
    system.rulesFunction({
      parameters: [
        { name: "id", type: "SmallUint", notNull: true },
        {
          name: "value_1",
          type: { type: "String", maxLength: 200 },
          notNull: false,
        },
        {
          name: "value_2",
          type: { type: "String", maxLength: 200 },
          notNull: false,
        },
        {
          name: "value_3",
          type: { type: "String", maxLength: 200 },
          notNull: false,
        },
      ],
      rules: [[sql`input.id`, sql`sql_expr`], ...idsToFilterExpr],
      returnType: "String",
      name: idToFilterExpr,
    });
  }
  function defineRelationFilterMapping(
    suffix: string,
    rules: AnyExpr[][],
  ) {
    if (rules.length === 0) {
      return undefined;
    }
    const name = `${datagridName}_dg_col_id_to_relation_filter_${suffix}`;
    system.rulesFunction({
      parameters: [{ name: "id", type: "SmallUint", notNull: true }],
      rules: [[sql`input.id`, sql`output`], ...rules],
      name,
      returnType: "String",
    });
    return name;
  }
  const idToRelationFilterFrom = defineRelationFilterMapping(
    "from",
    relationFilterFromExprs,
  );
  const idToRelationFilterValue = defineRelationFilterMapping(
    "value",
    relationFilterValueExprs,
  );
  const idToRelationFilterWhere = defineRelationFilterMapping(
    "where",
    relationFilterWhereExprs,
  );
  const idToRelationFilterSemantics = defineRelationFilterMapping(
    "semantics",
    relationFilterSemantics,
  );
  let idToLegacyCustomOp: string | undefined;
  if (legacyCustomOps.length > 0) {
    idToLegacyCustomOp = `${datagridName}_dg_col_id_to_legacy_custom_op`;
    system.rulesFunction({
      parameters: [{ name: "id", type: "SmallUint", notNull: true }],
      rules: [[sql`input.id`, sql`output`], ...legacyCustomOps],
      name: idToLegacyCustomOp,
      returnType: { type: "Enum", enum: "dg_filter_op" },
    });
  }
  let idToExportName: string | undefined;
  let idToExportExpr: string | undefined;
  if (idsToExportExpr.length > 0) {
    idToExportName = `${datagridName}_dg_col_id_to_export_name`;
    idToExportExpr = `${datagridName}_dg_col_id_to_export_expr`;
    system.rulesFunction({
      parameters: [{ name: "id", type: "SmallUint" }],
      rules: [[sql`input.id`, sql`export_name`], ...idsToExportNames],
      name: idToExportName,
      returnType: "String",
    });
    system.rulesFunction({
      parameters: [{ name: "id", type: "SmallUint" }],
      rules: [[sql`input.id`, sql`export_expr`], ...idsToExportExpr],
      name: idToExportExpr,
      returnType: "String",
    });
  }
  const idToColumnsDisplayName =
    `${datagridName}_dg_col_id_to_columns_display_name`;
  system.rulesFunction({
    parameters: [{ name: "id", type: "SmallUint" }],
    rules: [[sql`input.id`, sql`output`], ...columnsDisplayName],
    name: idToColumnsDisplayName,
    returnType: "String",
  });
  const idToIsStringName = `${datagridName}_dg_col_id_to_is_string`;
  system.rulesFunction({
    parameters: [{ name: "id", type: "SmallUint", notNull: true }],
    rules: [[sql`input.id`, sql`output`], ...isStringCol],
    name: idToIsStringName,
    returnType: "Bool",
  });
  return {
    idToSqlExpr: sql.ref(idToSqlExprDt),
    storageNameToId: sql.ref(storageNameToIdDt),
    idToStorageName: sql.ref(idToStorageName),
    idToFilterExpr: idToFilterExpr ? sql.ref(idToFilterExpr) : undefined,
    idToLegacyCustomOp: idToLegacyCustomOp
      ? sql.ref(idToLegacyCustomOp)
      : undefined,
    idToRelationFilterFrom: idToRelationFilterFrom
      ? sql.ref(idToRelationFilterFrom)
      : undefined,
    idToRelationFilterValue: idToRelationFilterValue
      ? sql.ref(idToRelationFilterValue)
      : undefined,
    idToRelationFilterWhere: idToRelationFilterWhere
      ? sql.ref(idToRelationFilterWhere)
      : undefined,
    idToRelationFilterSemantics: idToRelationFilterSemantics
      ? sql.ref(idToRelationFilterSemantics)
      : undefined,
    idToInitialWidth: (id) => mappedDatagridValue(id, idsToInitialWidth),
    idToExportName: idToExportName ? sql.ref(idToExportName) : undefined,
    idToExportExpr: idToExportExpr ? sql.ref(idToExportExpr) : undefined,
    idToDefaultOp: (id) => mappedDatagridValue(id, defaultOps),
    idToColumnsDisplayName: sql.ref(idToColumnsDisplayName),
    idToFilterDisplayName: (id) => mappedDatagridValue(id, filterDisplayName),
    idToIsString: sql.ref(idToIsStringName),
  };
}

function hasInvalidDateFilter(filterTerms: Sql) {
  return sql`exists (
    select 1 from ${filterTerms}
    where (fn.is_date_filter_op(op) or fn.is_timestamp_filter_op(op))
      and case
        when coalesce(value_1, '') = '' then coalesce(value_2, '') <> ''
        when value_1 = 'exact date' then
          coalesce(value_2, '') <> '' and try_cast(value_2 as date) is null
        when value_1 in ('number of days ago', 'number of days from now') then
          coalesce(value_2, '') <> '' and try_cast(value_2 as int) is null
        else fn.encode_date_dg_filter_param(value_1, value_2) is null
      end
  )`;
}

function defineFilterExprProcedure(
  datagridName: string,
  dts: DynamicDatagridFns,
) {
  const name = `${datagridName}_dg_filter_expr`;
  system.storedProcedure({
    name,
    transaction: "caller",
    inputScalars: [
      { name: "p_root_filter_is_any", type: "Bool" },
    ],
    inputTables: [
      { name: "p_filter_terms", fields: filterTermFields },
    ],
    outputScalars: [
      { name: "p_filter_expr", type: "String", notNull: true },
    ],
    procedure: (s) => {
      // Empty editor values remain inactive. A supplied but invalid date must
      // never become SQL TRUE, including count/export/navigation callers.
      s.if(hasInvalidDateFilter(sql.ref("p_filter_terms")), (s) => {
        s.throwError(sql.lit(INVALID_DATE_FILTER_MESSAGE));
      });
      s.setScalar(
        "p_filter_expr",
        sql`coalesce(${
          filterExpr(
            dts,
            sql.ref("p_filter_terms"),
            sql`p_root_filter_is_any`,
          )
        }, 'true')`,
      );
    },
  });
  return name;
}

function filterExpr(
  dts: DynamicDatagridFns,
  filterTerms: Sql = sql.ref("ui.filter_terms"),
  rootFilterIsAny: BooleanExpr = sql`ui.root_filter_is_any`,
) {
  function serializeFilter(filter: Sql) {
    const encodeFilterOp = sql`fn.encode_dg_filter_op(
      op => ${filter}.op,
      expr => fn.${dts.idToSqlExpr}(${filter}.column_id),
      value_1 => ${filter}.value_1,
      value_2 => ${filter}.value_2,
      value_3 => ${filter}.value_3,
      is_string => coalesce(fn.${dts.idToIsString}(${filter}.column_id), false)
    )`;
    let scalarFilterExpr = encodeFilterOp;
    if (dts.idToFilterExpr) {
      scalarFilterExpr = sql`case
        when ${filter}.op = 'custom' then fn.${dts.idToFilterExpr}(
          ${filter}.column_id,
          ${filter}.value_1,
          ${filter}.value_2,
          ${filter}.value_3
        )
        else ${encodeFilterOp}
      end`;
    }
    if (
      dts.idToRelationFilterFrom && dts.idToRelationFilterValue &&
      dts.idToRelationFilterWhere && dts.idToRelationFilterSemantics
    ) {
      const relationValue =
        sql`fn.${dts.idToRelationFilterValue}(${filter}.column_id)`;
      const relationOp = dts.idToLegacyCustomOp
        ? sql`case when ${filter}.op = 'custom' then coalesce(
            fn.${dts.idToLegacyCustomOp}(${filter}.column_id),
            ${filter}.op
          ) else ${filter}.op end`
        : sql`${filter}.op`;
      return sql`case
        when ${relationValue} is not null then fn.encode_dg_relation_string_filter(
          op => ${relationOp},
          from_expr => fn.${dts.idToRelationFilterFrom}(${filter}.column_id),
          value_expr => ${relationValue},
          where_expr => fn.${dts.idToRelationFilterWhere}(${filter}.column_id),
          is_scalar => coalesce(fn.${dts.idToRelationFilterSemantics}(${filter}.column_id) = 'scalar', false),
          is_string => coalesce(fn.${dts.idToIsString}(${filter}.column_id), false),
          value_1 => ${filter}.value_1
        )
        else ${scalarFilterExpr}
      end`;
    }
    return scalarFilterExpr;
  }
  // Inline consumers (including export and bulk-selection IDs) cannot throw a
  // procedure error. Fail the whole filter closed, including OR groups; the
  // grid's procedure displays the validation error above.
  return sql`case when ${hasInvalidDateFilter(filterTerms)} then 'false' else
(select
  string_agg(
    case
      when is_any is null then ${serializeFilter(sql.ref("root"))}
      else (
        select
          '(' || string_agg(
            case
              when is_any is null then ${serializeFilter(sql.ref("subroot"))}
              else (select
                '(' || string_agg(
                  ${serializeFilter(sql.ref("filter_terms"))},
                  case when subroot.is_any then ' or ' else ' and ' end
                ) || ')'
                from ${filterTerms} as filter_terms
                where group_id = subroot.id
              )
            end,
            case when root.is_any then ' or ' else ' and ' end
          ) || ')'
        from ${filterTerms} as subroot where subroot.group_id = root.id
      )
    end,
    case when ${rootFilterIsAny} then ' or ' else ' and ' end
  )
  from ${filterTerms} as root
  where group_id is null) end`;
}
const configuredResultOrder = sql`(select
  string_agg('col_' || id || (case when sort_asc then ' nulls last' else ' desc nulls last' end), ',')
  from (select id, sort_asc from ui.column where sort_index is not null order by sort_index))`;
const baseOrderByPart = sql`coalesce(
  ' order by ' || ${configuredResultOrder},
  ''
)`;

const shouldGenerateColumn =
  sql`displaying or always_generate or sort_index is not null`;
