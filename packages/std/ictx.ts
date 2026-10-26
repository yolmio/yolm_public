import type { Color, Size } from "components/types";
import type {
  Column,
  DynamicDatagridFns,
} from "pages/datagrid_internals/dynamic_datagrid";
import type { UpdateCellFieldOpts } from "pages/datagrid_internals/shared";
import type { AnyExpr, BooleanExpr, NumericExpr, Sql } from "./sql_utils";
import type {
  DomStatements,
  DomStatementsOrFn,
  EndpointStatements,
  HelperProcField,
  IStatementsBase,
  StateStatements,
  UiServerStatements,
} from "./statements";
import type { ResolvedQuickSearch } from "./search_utils";
import type { Field, HelperFieldType, Table } from "./system";
import type { Variant } from "./theme";
import type * as yom from "./yom";
import {
  addCtx,
  type Component,
  type ContextInstance,
  createICtxKey,
  type ICtxKey,
  type Node,
  type StateProps,
  type StatePropsWithoutChildren,
  useICtx,
  useOptionalICtx,
  usePhase,
  useState,
} from "./ui";
import type {
  FormField,
  FormTable,
  GatherFormTable,
  RecordHelper,
  TableHelper,
} from "./form";

/**
 * Tracks the table currently in scope (e.g. a record page's table) so nested
 * components can resolve fields against it without being passed the table
 * explicitly. Nestable via `parentCurrentTable`.
 */
export interface CurrentTableICtx {
  parentCurrentTable?: CurrentTableICtx;
  currentTable: Table;
}

export const CurrentTableICtxKey = createICtxKey<CurrentTableICtx>(
  "CurrentTableICtx",
);

export class ExtendedCurrentTableContext
  implements ContextInstance, CurrentTableICtx {
  implementICtxs = [CurrentTableICtxKey];

  parentCurrentTable?: CurrentTableICtx;
  currentTable: Table;

  constructor(parent: CurrentTableICtx | undefined, currentTable: Table) {
    this.parentCurrentTable = parent;
    this.currentTable = currentTable;
  }
}

/**
 * Tracks the record id currently in scope, so nested components can act on
 * "the current record" without threading the id through props. Nestable via
 * `parentCurrentRecord`.
 */
export interface CurrentRecordICtx {
  parentCurrentRecord?: CurrentRecordICtx;
  currentRecordId: NumericExpr;
}

export const CurrentRecordICtxKey = createICtxKey<CurrentRecordICtx>(
  "CurrentRecordICtx",
);

export class ExtendedCurrentRecordContext
  implements ContextInstance, CurrentRecordICtx {
  implementICtxs = [CurrentRecordICtxKey];

  parentCurrentRecord?: CurrentRecordICtx;
  currentRecordId: NumericExpr;

  constructor(
    parent: CurrentRecordICtx | undefined,
    currentRecordId: NumericExpr,
  ) {
    this.parentCurrentRecord = parent;
    this.currentRecordId = currentRecordId;
  }
}

/**
 * Lets descendants trigger a refetch of the nearest enclosing data scope
 * (e.g. after a mutation). Call `triggerRefetch(s)` from within an event
 * handler/statement builder.
 */
export interface CurrentRefetchICtx {
  triggerRefetch: <T extends IStatementsBase>(s: T) => unknown;
}

export const CurrentRefetchICtxKey = createICtxKey<CurrentRefetchICtx>(
  "CurrentRefetchICtx",
);

export class SimpleRefetchContext implements ContextInstance {
  currentRefetchKey: AnyExpr[];
  triggerRefetch: <T extends IStatementsBase>(s: T) => unknown;
  implementICtxs: ICtxKey<any>[] = [CurrentRefetchICtxKey];

  constructor(currentRefetchKey: string, currentWatchKey: AnyExpr[]) {
    this.currentRefetchKey = currentWatchKey;
    this.triggerRefetch = <T extends IStatementsBase>(s: T) => {
      s.increment(currentRefetchKey);
    };
  }
}

/**
 * Accumulates the set of expressions that enclosing scopes watch for change.
 * Consumed by {@link useCurrentWatchState} so derived state re-runs whenever
 * any ancestor key changes. Nested keys are concatenated with the parent's.
 */
export interface CurrentWatchKeyICtx {
  parent?: CurrentWatchKeyICtx;
  currentWatchKey: AnyExpr[];
}

export const CurrentWatchKeyICtxKey = createICtxKey<CurrentWatchKeyICtx>(
  "CurrentWatchKeyICtx",
);

export class ExtendedWatchKeyContext
  implements ContextInstance, CurrentWatchKeyICtx {
  implementICtxs = [CurrentWatchKeyICtxKey];

  parent?: CurrentWatchKeyICtx;
  currentWatchKey: AnyExpr[];

  constructor(parent: CurrentWatchKeyICtx | undefined, newKeys: AnyExpr[]) {
    this.parent = parent;
    this.currentWatchKey = [...(parent?.currentWatchKey ?? []), ...newKeys];
  }
}

/**
 * Tracks route path parameter names in scope: those added at this level
 * (`routeParamNames`) and all names accumulated from ancestors
 * (`allRouteParamNames`).
 */
export interface RoutePathParamsICtx {
  parent?: RoutePathParamsICtx;
  routeParamNames: string[];
  allRouteParamNames: string[];
}

export const RoutePathParamsICtxKey = createICtxKey<RoutePathParamsICtx>(
  "RoutePathParamsICtx",
);

export class RoutePathParamsCtx
  implements ContextInstance, RoutePathParamsICtx {
  implementICtxs = [RoutePathParamsICtxKey];

  parent?: RoutePathParamsICtx;
  routeParamNames: string[];
  allRouteParamNames: string[];

  constructor(
    parent: RoutePathParamsICtx | undefined,
    routeParamNames: string[],
  ) {
    this.parent = parent;
    this.routeParamNames = routeParamNames;
    this.allRouteParamNames = [
      ...(parent?.allRouteParamNames ?? []),
      ...routeParamNames,
    ];
  }
}

/**
 * Like `useState`, but automatically merges in the surrounding
 * {@link CurrentWatchKeyICtx} watch keys so the state re-evaluates whenever
 * any enclosing watched expression changes. Falls back to plain `useState`
 * when no watch-key context is present.
 */
export function useCurrentWatchState(
  s: ((s: StateStatements) => void) | Omit<StateProps, "children">,
) {
  const ctx = useOptionalICtx(CurrentWatchKeyICtxKey);
  if (!ctx) {
    return useState(s);
  }
  if (typeof s === "function") {
    useState({
      watch: ctx.currentWatchKey,
      procedure: s,
    });
  } else {
    useState({
      ...s,
      watch: [
        ...ctx.currentWatchKey,
        ...(Array.isArray(s.watch) ? s.watch : s.watch ? [s.watch] : []),
      ],
    });
  }
}

/** The primary table of the current page (e.g. a record/update page). */
export interface PageTableICtx {
  pageTable: Table;
}

export const PageTableICtxKey = createICtxKey<PageTableICtx>("PageTableICtx");

/** The primary record id of the current page. */
export interface PageRecordICtx {
  pageRecordId: NumericExpr;
}

export const PageRecordICtxKey = createICtxKey<PageRecordICtx>(
  "PageRecordICtx",
);

/** Lets descendants trigger a refetch of the whole page's data. */
export interface PageRefetchICtx {
  triggerPageRefetch: <T extends IStatementsBase>(s: T) => unknown;
}

export const PageRefetchICtxKey = createICtxKey<PageRefetchICtx>(
  "PageRefetchICtx",
);

/** Watch keys whose change forces the page's data to refetch. */
export interface PageRefetchWatchKeyICtx {
  pageRefetchKey: AnyExpr[];
}

export const PageRefetchWatchKeyICtxKey = createICtxKey<
  PageRefetchWatchKeyICtx
>("PageRefetchWatchKeyICtx");

/** Identifies the table and per-iteration record name inside an `Each` loop. */
export interface EachICtx {
  eachTable: string;
  eachRecordName: string;
}

export const EachICtxKey = createICtxKey<EachICtx>("EachICtx");

/** Identifies the datagrid and its per-row record name for child cells. */
export interface DatagridICtx {
  datagridName: string;
  datagridRecordName: string;
}

export const DatagridICtxKey = createICtxKey<DatagridICtx>("DatagridICtx");

export interface GatherScalarParam {
  name: string;
  type: HelperFieldType;
  initialValue?: AnyExpr;
}

export interface GatherTableParam {
  name: string;
  fields: HelperProcField[];
}

export interface GatherRecordParam {
  name: string;
  fields: HelperProcField[];
}

export interface GatherScalarForeignKeyParam {
  name: string;
  tableName: string;
}

/**
 * Accumulator used during the gather phase to collect the scalar/table/record
 * parameters a procedure or page declares, before they are finalized into
 * {@link ParamsICtx}.
 */
export interface ParamsGatherICtx {
  scalars: GatherScalarParam[];
  tables: GatherTableParam[];
  records: GatherRecordParam[];
  scalarForeignKeys: GatherScalarForeignKeyParam[];
}

export const ParamsGatherICtxKey = createICtxKey<ParamsGatherICtx>(
  "ParamsGatherICtx",
);

export interface ScalarParam {
  name: string;
  type: HelperFieldType;
}

export interface TableParam {
  name: string;
  fields: HelperProcField[];
}

export interface RecordParam {
  name: string;
  fields: HelperProcField[];
}

/**
 * Finalized parameters in scope (keyed by name), produced from
 * {@link ParamsGatherICtx} after the gather phase. Consumed when generating
 * the procedure/page signature.
 */
export interface ParamsICtx {
  scalars: Record<string, ScalarParam>;
  tables: Record<string, TableParam>;
  records: Record<string, RecordParam>;
  scalarForeignKeys: GatherScalarForeignKeyParam[];
}

export const ParamsICtxKey = createICtxKey<ParamsICtx>("ParamsICtx");

/** A single report registered with a reports container during gather. */
export interface GatherReport {
  name: string;
  /** URL slug used to route to this report. */
  urlName: string;
  node: Node;
  /** Whether this report is shown by default when none is selected. */
  default?: boolean;
  /** Section header this report is grouped under. */
  section?: string;
}

/** Collects reports (and the current section name) during the gather phase. */
export interface ReportsGatherICtx {
  addReport(report: GatherReport): void;
  sectionName: string;
}

export const ReportsGatherICtxKey = createICtxKey<ReportsGatherICtx>(
  "ReportsGatherICtx",
);

export interface SimpleReportsGatherICtx {
  addSection(header: string): void;
}

export const SimpleReportsGatherICtxKey = createICtxKey<
  SimpleReportsGatherICtx
>("SimpleReportsGatherICtx");

/**
 How to logout in the current context,

 Should be defined by whatever auth component is being used and consumed
 by navbar or any other component that needs to logout.
 */
export interface LogoutICtx {
  logout: (s: DomStatements) => unknown;
  /** Registers idempotent client/server cleanup to run before logout. */
  registerLogoutCleanup?: (key: string, cleanup: DomStatementsOrFn) => void;
  /** Runs cleanups for logout paths implemented outside `logout()`. */
  runLogoutCleanups?: (s: DomStatements) => void;
}

export const LogoutICtxKey = createICtxKey<LogoutICtx>("LogoutICtx");

/** Keyed cleanup registry shared by the built-in authentication providers. */
export class LogoutCleanupRegistry {
  private readonly cleanups = new Map<string, DomStatementsOrFn>();

  register = (key: string, cleanup: DomStatementsOrFn) => {
    this.cleanups.set(key, cleanup);
  };

  run = (s: DomStatements) => {
    for (const cleanup of this.cleanups.values()) {
      s.statements(cleanup);
    }
  };
}

/**
 When making calls to the api for the current app (used for attachments, files, etc.)
 this indicates how to authenticate the request.
 */
export interface AuthApiICtx {
  authenticate: (s: EndpointStatements) => unknown;
}

export const AuthApiICtxKey = createICtxKey<AuthApiICtx>("AuthApiICtx");

export interface DropdownGatherICtx {
  items: { onClick: DomStatementsOrFn }[];
  /**
       Adds a node to the same node as the dropdown context, this allows for external nodes to be
       added by a dropdown item. For example a dropdown item to open a dialog can be controlled by this.

       Only have nodes that should not be part of the regular document flow (i.sql. dialogs, popovers, snackbars)
       */
  addNode: (key: string, node: Node) => void;
  /**
       Adds a state to the same node as the dropdown context, this allows for external state to be
       controlled by a menu item. For example a menu item to open a dialog can be controlled by this.
       */
  addState: (key: string, f: StatePropsWithoutChildren) => void;
}

export const DropdownGatherICtxKey = createICtxKey<DropdownGatherICtx>(
  "DropdownGatherICtx",
);

export interface ToolbarGatherICtx {
  addToolbarState: (
    f: ((s: StateStatements) => void) | StatePropsWithoutChildren,
  ) => void;
  /**
       Adds a node to the toolbar, use this to add dialogs or other components that need to exist higher in the tree,
       but should not be visible in the toolbar section.
       */
  addToolbarNode: (node: Node) => void;
}

export const ToolbarGatherICtxKey = createICtxKey<ToolbarGatherICtx>(
  "ToolbarGatherICtx",
);

/**
 * Registers UI state on the enclosing toolbar (via
 * {@link ToolbarGatherICtxKey}) during the gather phase. Use from a toolbar
 * item that needs backing state which must live at the toolbar level.
 */
export function useToolbarState(f: (s: StateStatements) => void) {
  if (usePhase() === "gather") {
    const ctx = useICtx(ToolbarGatherICtxKey);
    ctx.addToolbarState(f);
  }
}

/**
 * Hoists `node` up to the enclosing toolbar during the gather phase. Use for
 * dialogs/popovers triggered by a toolbar item that must render outside the
 * toolbar's visible flow.
 */
export function useToolbarNode(node: Node) {
  if (usePhase() === "gather") {
    const ctx = useICtx(ToolbarGatherICtxKey);
    ctx.addToolbarNode(node);
  }
}

///
/// Styling
///

/**
 In this given context, the default button variant is used.

 Used for button groups, but can be used for other components.
 */
export interface DefaultButtonVariantICtx {
  defaultVariant?: Variant;
  defaultColor?: Color;
  defaultSize?: Size;
}

export const DefaultButtonVariantICtxKey = createICtxKey<
  DefaultButtonVariantICtx
>("DefaultButtonVariantICtx");

/**
 * Published by `FormControl` so labels, inputs, and helper text within it
 * share the same id (for `for`/`aria-*` wiring) and error state.
 */
export interface FormControlICtx {
  id?: Sql;
  error?: BooleanExpr;
  // todo probably add to this
}

export const FormControlICtxKey = createICtxKey<FormControlICtx>(
  "FormControlICtx",
);

/**
 * Marks a region whose descendants should adopt the harmonized palette
 * (driven by the surface's `variant`/`color`). Components detect this via
 * {@link useDefaultColor}, which returns `"harmonize"` when present.
 */
export interface HarmonizeICtx {
  variant?: Variant;
  color?: Color;
}

export const HarmonizeICtxKey = createICtxKey<HarmonizeICtx>("HarmonizeICtx");

/** Concrete {@link HarmonizeICtx} provider holding a fixed variant + color. */
export class HarmonizeCtx implements ContextInstance, HarmonizeICtx {
  implementICtxs = [HarmonizeICtxKey];

  constructor(
    public variant: Variant,
    public color: Color,
  ) {}
}

export interface SidebarPresenceICtx {
  presence: boolean;
  autoTrigger: boolean;
}
/**
 * ICtx key advertised by `Sidebar` so descendant components can detect
 * that they are rendering inside a sidebar (and adjust spacing/auto-open
 * behaviour accordingly).
 *
 * Pair with `useOptionalICtx(SidebarPresenceICtxKey)` — components that
 * depend on a sidebar should still render outside one.
 */
export const SidebarPresenceICtxKey = createICtxKey<SidebarPresenceICtx>(
  "SidebarPresenceICtx",
);

export class SidebarCtx implements ContextInstance {
  implementICtxs = [SidebarPresenceICtxKey];
  constructor(public presence: boolean, public autoTrigger: boolean) {
    this.presence = presence;
    this.autoTrigger = autoTrigger;
  }
}

/**
 * Resolves the color a component should default to: `"harmonize"` when
 * rendering inside a {@link HarmonizeICtx} (so the component adopts the
 * harmonized palette), otherwise the supplied `defaultColor`.
 */
export function useDefaultColor(defaultColor: Color): Color {
  const ctx = useOptionalICtx(HarmonizeICtxKey);
  if (ctx) {
    return "harmonize";
  }
  return defaultColor;
}

///
/// Datagrid
///

export interface DatagridBaseICtx {
  focusState: {
    column: Sql;
    row: Sql;
    shouldFocus: BooleanExpr;
  };
  selectable: boolean;
  editingState: {
    column: Sql;
    row: Sql;
    isEditing: BooleanExpr;
  };
  startEditEmpty: Sql;
  savingEdit: Sql;
  displayErrorMessage: Sql;
  displayEditErrorAndRemoveAfter: (
    s: DomStatements,
    message: Sql,
    delay?: NumericExpr,
  ) => unknown;
}

export const DatagridBaseICtxKey = createICtxKey<DatagridBaseICtx>(
  "DatagridBaseICtx",
);

export interface DatagridCurrentCellICtx {
  /**
       Index of the column in the datagrid, this is not index in the display order, but should be treated
       as a unique id.
       */
  column: number;
  /**
       The current record name for the row in the datagrid
       */
  rowRecord: Sql;
  /**
       The current result field for the cell in the datagrid, can be undefined if there is no result field
       for example a cell that just displays a relation doesn't have a field value
       */
  resultField?: Sql;
  /**
       The next column in the datagrid, this is used to tab to the next cell
       */
  nextColumn: NumericExpr;
  /**
       The id field for the record in the datagrid
       */
  recordId: NumericExpr;
  /**
       The id field for the record in the datagrid
       */
  idField: Sql;
}

export const DatagridCurrentCellICtxKey = createICtxKey<
  DatagridCurrentCellICtx
>("DatagridCurrentCellICtx");

export interface DynamicDatagridICtx {
  selectable: boolean;
  viewsEnabled: boolean;
  filteringEnabled: boolean;
  dynamicQuery: Sql;
  buildDynamicQuery: (s: StateStatements | UiServerStatements) => Sql;
  downloadQuery: (additionalWhere?: Sql) => Sql;
  countQuery: Sql;
  buildCountQuery: (s: StateStatements | UiServerStatements) => Sql;
  idsQuery: Sql;
  buildIdsQuery: (s: StateStatements | UiServerStatements) => Sql;
  wherePart: (additionalWhere?: Sql) => Sql;
  buildWherePart: (
    s: StateStatements | UiServerStatements,
    additionalWhere?: Sql,
  ) => Sql;
  quickSearch: ResolvedQuickSearch | undefined;

  fns: DynamicDatagridFns;
  columns: Column[];
  viewStateHash: (s: StateStatements) => Sql;
  triggerChangesInToolbar: (s: DomStatements) => unknown;
  clearChangesInToolbar: (s: DomStatements) => unknown;
  /** Reload the saved/default view, discarding unsaved grid settings. */
  resetView: (s: DomStatements) => unknown;
}

export const DynamicDatagridICtxKey = createICtxKey<DynamicDatagridICtx>(
  "DynamicDatagridICtx",
);

/** Lets datagrid header cells set the sort direction for a column. */
export interface DatagridSortICtx {
  setColumnSort: (
    s: DomStatements,
    column: NumericExpr,
    asc: boolean,
  ) => unknown;
}

export const DatagridSortICtxKey = createICtxKey<DatagridSortICtx>(
  "DatagridSortICtx",
);

/** Lets datagrid controls reorder a column within the display order. */
export interface DatagridColumnOrderICtx {
  moveColumnLeft: (s: DomStatements, column: NumericExpr) => unknown;
  moveColumnRight: (s: DomStatements, column: NumericExpr) => unknown;
  moveColumnToStart: (s: DomStatements, column: NumericExpr) => unknown;
  moveColumnToEnd: (s: DomStatements, column: NumericExpr) => unknown;
  setColumnPin: (
    s: DomStatements,
    column: NumericExpr,
    pin: "left" | "right" | null,
  ) => unknown;
}

export const DatagridColumnOrderICtxKey = createICtxKey<
  DatagridColumnOrderICtx
>("DatagridColumnOrderICtx");

/** Lets datagrid controls show or hide a column. */
export interface DatagridColumnDisplayICtx {
  setColumnDisplaying: (
    s: DomStatements,
    column: NumericExpr,
    displaying: BooleanExpr,
  ) => unknown;
}

export const DatagridColumnDisplayICtxKey = createICtxKey<
  DatagridColumnDisplayICtx
>("DatagridColumnDisplayICtx");

/**
 * Operations for managing saved datagrid views (column layout, sort, filters):
 * create a new view, overwrite an existing one, or duplicate one. `personal`
 * scopes the new view to the current user vs. shared.
 */
export interface DatagridViewsICtx {
  datagridName: string;
  saveCurrentAsNewView: (
    s: UiServerStatements,
    viewName: Sql,
    personal: BooleanExpr,
  ) => unknown;
  saveCurrentToExistingView: (
    s: UiServerStatements,
    viewId: NumericExpr,
  ) => unknown;
  duplicateView: (s: UiServerStatements, viewId: NumericExpr) => unknown;
}

export const DatagridViewsICtxKey = createICtxKey<DatagridViewsICtx>(
  "DatagridViewsICtx",
);

/** Lets an editable datagrid cell persist a changed field value to the db. */
export interface DatagridEditICtx {
  updateFieldValueInDb: (
    s: DomStatements,
    opts: UpdateCellFieldOpts,
  ) => unknown;
}

export const DatagridEditICtxKey = createICtxKey<DatagridEditICtx>(
  "DatagridEditICtx",
);

/** Which of a filter term's up-to-three operand slots is being referenced. */
export type FilterValue = 1 | 2 | 3;

/**
 * State and setters for a single datagrid filter term: its operator (`op`)
 * and up to three operand values, plus generic {@link FilterValue}-indexed
 * get/set accessors. Used by filter editor controls.
 */
export interface FilterTermICtx {
  id: Sql;
  columnId: Sql;
  op: Sql;
  setOp: <T extends IStatementsBase>(s: T, value: Sql) => unknown;
  value1: Sql;
  setValue1: <T extends IStatementsBase>(s: T, value: Sql) => unknown;
  value2: Sql;
  setValue2: <T extends IStatementsBase>(s: T, value: Sql) => unknown;
  value3: Sql;
  setValue3: <T extends IStatementsBase>(s: T, value: Sql) => unknown;
  getValue: (value: FilterValue) => Sql;
  setValue: <T extends IStatementsBase>(
    s: T,
    value: FilterValue,
    expr: AnyExpr,
  ) => unknown;
}

export const FilterTermICtxKey = createICtxKey<FilterTermICtx>(
  "FilterTermICtx",
);

export interface DynamicDatagridToolbarGatherICtx {
  needsSelectable: boolean;
}

export const DynamicDatagridToolbarGatherICtxKey = createICtxKey<
  DynamicDatagridToolbarGatherICtx
>(
  "DynamicDatagridToolbarGatherICtx",
);

///
/// Write
///

export interface FormGatherICtx {
  getTable: (name: string) => GatherFormTable | undefined;
  addTable: (table: GatherFormTable) => void;
  defaultFieldComponent?: Component;
}

export const FormGatherICtxKey = createICtxKey<FormGatherICtx>(
  "FormGatherICtx",
);

export type FormGatherStackFrame =
  | {
    type: "Table";
    table: GatherFormTable;
  }
  | {
    type: "Field";
    field: FormField;
  }
  | {
    type: "Each";
    recordName: string;
  }
  | {
    type: "View";
    recordId: NumericExpr;
  };

export interface FormGatherStackICtx {
  stack: FormGatherStackFrame[];
}

export const FormGatherStackICtxKey = createICtxKey<FormGatherStackICtx>(
  "FormGatherStackICtx",
);

export interface FormSubmittingRecord {
  table: string;
  recordUiId: NumericExpr;
}

export interface FormSubmitOptions {
  submittingRecord?: FormSubmittingRecord;
  beforeTransactionCommit?: (s: UiServerStatements) => unknown;
}

export interface FormICtx {
  /** Server authorization hooks run inside the transaction before callbacks or writes. */
  registerAuthorization: (hook: (s: UiServerStatements) => unknown) => void;
  registerBeforeValidationClient: (
    hook: (s: DomStatements) => unknown,
  ) => void;
  submitting: BooleanExpr;
  keepHistory: boolean;
  historyThrottleTime: number;
  setSubmitting: <T extends IStatementsBase>(
    s: T,
    submitting: BooleanExpr,
  ) => unknown;
  submittingRecord: (
    table: string,
    recordUiId: NumericExpr,
  ) => BooleanExpr;
  reset: <T extends IStatementsBase>(s: T) => unknown;
  submit: (
    s: DomStatements,
    opts?: FormSubmitOptions,
  ) => unknown;
  setTouchedAll: <T extends IStatementsBase>(s: T) => unknown;
  setTouchedNone: <T extends IStatementsBase>(s: T) => unknown;
  resetErrorState: <T extends IStatementsBase>(s: T) => unknown;
  writeError: Sql;
  hasWriteError: BooleanExpr;
  setWriteError: <T extends IStatementsBase>(
    s: T,
    error: Sql,
  ) => unknown;
  hasAnyError: BooleanExpr;
  table(name: string): TableHelper;
  record(name: string): RecordHelper;
  defaultFieldComponent?: Component;
  stateHash: () => Sql;
  resetKey: Sql;
  undo: <T extends IStatementsBase>(s: T) => unknown;
  redo: <T extends IStatementsBase>(s: T) => unknown;
  historyIndex: NumericExpr;
  canUndo: BooleanExpr;
  canRedo: BooleanExpr;
}

/**
 * ICtx key provided by `Form` so descendants can act on the surrounding
 * form. The shape ({@link FormICtx}) exposes `submit`/`reset`, the
 * touched/error helpers (`setTouchedAll`, `setTouchedNone`,
 * `resetErrorState`, `setWriteError`), the `table(name)` and
 * `record(name)` lookups (returning `TableHelper` / `RecordHelper`),
 * and the undo/redo handles (`undo`, `redo`, `canUndo`, `canRedo`).
 *
 * Custom controls that integrate with `Form.Field` resolve this via
 * `useICtx(FormICtxKey)`.
 */
export const FormICtxKey = createICtxKey<FormICtx>("FormContextICtx");

export type FormStackFrame =
  | {
    type: "Table";
    table: FormTable;
  }
  | {
    type: "Field";
    field: FormField;
  }
  | {
    type: "Each";
    recordName: string;
    where?: BooleanExpr;
  }
  | {
    type: "View";
    recordId: NumericExpr;
  };

export interface FormStackICtx {
  stack: FormStackFrame[];
}

export const FormStackICtxKey = createICtxKey<FormStackICtx>(
  "FormStackICtx",
);

export interface FormSwitchICtx {
  hasOperand: boolean;
}

export const FormSwitchICtxKey = createICtxKey<FormSwitchICtx>(
  "FormSwitchICtx",
);

//
// vis
//

/**
 * Shared chart geometry and axis registration published by a visualization
 * root to its child marks. Marks register the columns they map to the x/y
 * axes via `setXAxis`/`setYAxis` during gather.
 */
export interface VisRootICtx {
  padding: number;
  scaleType: "linear" | "logarithmic";
  height: number;
  width: number;
  yAxis?: string[];
  setYAxis: (yAxis: string) => void;
  xAxis?: string;
  setXAxis: (xAxis: string) => void;
}

export const VisRootICtxKey = createICtxKey<VisRootICtx>("VisRootICtx");

/**
 * Like {@link VisRootICtx} but for bar charts: adds per-side padding and a
 * `layout` (vertical vs horizontal bars) shared with child marks.
 */
export interface BarRootICtx {
  padding: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  scaleType: "linear" | "logarithmic";
  height: number;
  width: number;
  layout: "vertical" | "horizontal";
  yAxis?: string[];
  setYAxis: (yAxis: string) => void;
  xAxis?: string;
  setXAxis: (xAxis: string) => void;
}

export const BarRootICtxKey = createICtxKey<BarRootICtx>("BarRootICtx");

/**
 * Pie/donut chart root context: overall `size` and the registered value
 * series, each with its inner/outer radius (so concentric rings can be
 * stacked). Child marks register via `setYAxis`.
 */
export interface PieRootICtx {
  size: number;
  yAxis?: {
    columnName: string;
    innerRadius: number;
    outerRadius: number;
  }[];
  setYAxis: (yAxis: string, innerRadius: number, outerRadius: number) => void;
}

export const PieRootICtxKey = createICtxKey<PieRootICtx>("PieRootICtx");

//
// i18n
//

/**
 * Simple context for accessing the current user's language preference
 */
export interface UserLanguageICtx {
  /** Current user's language code from the languages enum (e.g., 'en', 'ru', 'es') */
  currentLanguage: Sql;
}

export const UserLanguageICtxKey = createICtxKey<UserLanguageICtx>(
  "UserLanguageICtx",
);

/**
 * Returns the current user's language code as a SQL expression, read from
 * the surrounding {@link UserLanguageICtx}. Throws if no language context is
 * present.
 */
export function useUserLanguage() {
  return useICtx(UserLanguageICtxKey).currentLanguage;
}

/**
 * Provides {@link UserLanguageICtx} to descendants, making `language`
 * (a languages-enum code expression) available via {@link useUserLanguage}.
 */
export function setUserLanguage(language: Sql) {
  class UserLanguageCtx implements ContextInstance, UserLanguageICtx {
    implementICtxs = [UserLanguageICtxKey];
    currentLanguage: Sql;

    constructor(currentLanguage: Sql) {
      this.currentLanguage = currentLanguage;
    }
  }
  addCtx(new UserLanguageCtx(language));
}

//
// AnalyzeQuery Local Context
//

import { analyzeQuery } from "./yolm_gen_api";
import type {
  AnalyzeQueryResult,
  AnalyzeScalarType,
  LocalDatabase,
  LocalField,
  LocalTable,
  TableKind,
} from "./yolm_gen_api";

export type {
  AnalyzeScalarType,
  LocalDatabase,
  LocalField,
  LocalTable,
  TableKind,
};

/**
 * Context for building local database definitions for analyzeQuery.
 * This accumulates type information as we traverse the component tree.
 */
export interface AnalyzeQueryLocalICtx {
  /** Parent context for stack-based scoping */
  parent?: AnalyzeQueryLocalICtx;
  /** Tables in the UI database (accessible as ui.* or without prefix) */
  uiTables: LocalTable[];
  /** Find a table by name in this scope or parent scopes */
  findTable(name: string): LocalTable | undefined;
  /** Build LocalDatabase[] for analyzeQuery, including parent scopes */
  toLocalDatabases(): LocalDatabase[];
}

export const AnalyzeQueryLocalICtxKey = createICtxKey<AnalyzeQueryLocalICtx>(
  "AnalyzeQueryLocalICtx",
);

/**
 * Implementation of AnalyzeQueryLocalICtx with stack-based scoping.
 */
export class AnalyzeQueryLocalCtx
  implements ContextInstance, AnalyzeQueryLocalICtx {
  implementICtxs = [AnalyzeQueryLocalICtxKey];

  parent?: AnalyzeQueryLocalICtx;
  uiTables: LocalTable[] = [];

  constructor(parent?: AnalyzeQueryLocalICtx) {
    this.parent = parent;
  }

  /** Register a UI scalar (a one-field `Scalar` table) for analysis. */
  addScalar(name: string, type: AnalyzeScalarType, nullable = false) {
    this.uiTables.push({
      name,
      kind: "Scalar",
      fields: [{ name: "value", type, nullable }],
    });
  }

  /** Register a UI table with the given fields for analysis. */
  addTable(name: string, fields: LocalField[], kind: TableKind = "Table") {
    this.uiTables.push({ name, kind, fields });
  }

  /** Register a single-row record table for analysis. */
  addRecord(name: string, fields: LocalField[]) {
    this.addTable(name, fields, "SingleRecord");
  }

  /** Find a table by name in this scope or parent scopes. */
  findTable(name: string): LocalTable | undefined {
    const found = this.uiTables.find((t) => t.name === name);
    if (found) return found;
    return this.parent?.findTable(name);
  }

  /**
   * Add a SingleRecord that aliases a table already in the context.
   * Used by Each to register the iteration record for child query analysis.
   */
  addRecordFromTable(
    recordName: string,
    tableName: string,
    extraFields?: LocalField[],
  ) {
    const table = this.findTable(tableName);
    if (!table) return;
    const fields = extraFields
      ? [...table.fields, ...extraFields]
      : table.fields;
    this.addRecord(recordName, fields);
  }

  /**
   * Build the `LocalDatabase[]` for `analyzeQuery`, flattening this scope and
   * all parents. Tables are exposed both under the `ui` prefix and under the
   * default (unprefixed) database.
   */
  toLocalDatabases(): LocalDatabase[] {
    // Collect all tables from this scope and parent scopes. Go through the
    // parent API so lazy parent contexts populate their declarations first.
    const allTables: LocalTable[] = [...this.uiTables];
    if (this.parent) {
      const parentUiDb = this.parent.toLocalDatabases().find((db) =>
        db.name === "ui"
      );
      if (parentUiDb) {
        allTables.push(...parentUiDb.tables);
      }
    }

    // UI database - accessible with ui.* prefix
    const uiDb: LocalDatabase = {
      name: "ui",
      tables: allTables,
    };

    // Default database (empty name) - allows access without prefix
    const defaultDb: LocalDatabase = {
      name: "",
      tables: allTables,
    };

    return [defaultDb, uiDb];
  }
}

/**
 * Analyze a SQL query using the current component tree context.
 * Automatically reads parent Data/Each context to resolve local tables, records, and scalars.
 */
export function analyzeQueryWithContext(
  query: Sql,
  extraScalars?: Record<string, AnalyzeScalarType>,
): AnalyzeQueryResult {
  const parentCtx = useOptionalICtx(AnalyzeQueryLocalICtxKey);
  let localDbs: LocalDatabase[] | undefined;
  if (parentCtx || extraScalars) {
    const ctx = new AnalyzeQueryLocalCtx(parentCtx);
    if (extraScalars) {
      for (const [name, type] of Object.entries(extraScalars)) {
        ctx.addScalar(name, type);
      }
    }
    localDbs = ctx.toLocalDatabases();
  }
  return analyzeQuery({
    query: query.toSQL(),
    dbScope: ["ui", "db"],
    localDbs,
  });
}

/** Convert a YOM field type to its SQL analysis scalar domain. */
export function yomFieldTypeToAnalyzeType(
  fieldType: yom.FieldType,
): AnalyzeScalarType {
  switch (fieldType.type) {
    case "TinyUint":
    case "TinyInt":
    case "SmallInt":
      return { type: "SmallInt" };
    case "SmallUint":
      return { type: "Int" };
    case "Int":
      return { type: "Int" };
    case "Uint":
      return { type: "BigInt" };
    case "BigInt":
    case "BigUint":
    case "ForeignKey":
    case "Tx":
      return { type: "BigInt" };
    case "String":
      return { type: "String" };
    case "Bool":
      return { type: "Bool" };
    case "Date":
      return { type: "Date" };
    case "Timestamp":
    case "TimestampUtc":
    case "TimestampTz":
      return { type: "TimestampTz" };
    case "TimestampNaive":
      return { type: "TimestampNaive" };
    case "Time":
      return { type: "Time" };
    case "Uuid":
      return { type: "Uuid" };
    case "Json":
      return { type: "Json" };
    case "Interval":
      return { type: "Interval" };
    case "Ordering":
      return { type: "Ordering" };
    case "Double":
      return { type: "Double" };
    case "Real":
      return { type: "Real" };
    case "Enum":
      return { type: "Enum", enum: fieldType.enum };
    case "Decimal":
      return {
        type: "Decimal",
        precision: fieldType.precision,
        scale: fieldType.scale,
      };
    case "Bytes":
      return { type: "Bytes" };
    case "PhoneNumber":
      return { type: "String" };
  }
}

/** Convert a database Field to its SQL analysis scalar domain. */
export function fieldToAnalyzeType(field: Field): AnalyzeScalarType {
  return yomFieldTypeToAnalyzeType(field.generateYomFieldType());
}

/** Return the SQL cast name for an analysis scalar type. */
export function analyzeScalarTypeToSqlCast(
  scalarType: AnalyzeScalarType,
): string {
  switch (scalarType.type) {
    case "Bool":
      return "bool";
    case "SmallInt":
      return "smallint";
    case "Int":
      return "int";
    case "BigInt":
      return "bigint";
    case "Real":
      return "real";
    case "Double":
      return "double";
    case "Decimal":
      return `decimal(${scalarType.precision}, ${scalarType.scale})`;
    case "Ordering":
      return "ordering";
    case "Date":
      return "date";
    case "Timestamp":
    case "TimestampTz":
      return "timestamptz";
    case "TimestampNaive":
      return "timestamp";
    case "Enum":
      return `enums.${scalarType.enum}`;
    case "Time":
      return "time";
    case "String":
      return "string";
    case "Uuid":
      return "uuid";
    case "Json":
      return "json";
    case "Interval":
      return "interval";
    case "Bytes":
      return "bytes";
  }
}

/**
 * Convert a database Table's fields to LocalField[]
 */
export function tableToLocalFields(table: Table): LocalField[] {
  return Object.values(table.fields).map((field) => ({
    name: field.name,
    type: fieldToAnalyzeType(field),
    nullable: !field.notNull,
  }));
}
