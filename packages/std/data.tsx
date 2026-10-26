import { Alert } from "components/alert";
import { CircularProgress } from "components/circular_progress";
import { getUniqueUiId } from "components/utils";
import {
  AnalyzeQueryLocalCtx,
  type AnalyzeQueryLocalICtx,
  AnalyzeQueryLocalICtxKey,
  type AnalyzeScalarType,
  SimpleRefetchContext,
  yomFieldTypeToAnalyzeType,
} from "./ictx";
import { type AnyExpr, Sql, sql } from "./sql_utils";
import { scalarDeclarationAnalysisExpr, StateStatements } from "./statements";
import type { StateStatementsOrFn } from "./statements";
import { fieldTypeFromHelper, type HelperFieldType } from "./system";
import {
  addCtx,
  Match,
  type Node,
  type QueryParam,
  type StateProps,
  Switch,
  useOptionalICtx,
  usePhase,
  useQueryParams,
  useState,
} from "./ui";
import type * as yom from "./yom";
import { analyzeQuery } from "./yolm_gen_api";
import type { LocalField, QueryColumnInfo } from "./yolm_gen_api";

/**
 * The scalar name used for global refetch. All non-local {@link Data} components
 * automatically watch this scalar, and calling `s.refetch()` increments it to
 * trigger a re-fetch across all listening Data components.
 */
export const GLOBAL_REFETCH_SCALAR = "global_refetch_key";

/**
 * Configuration for a single URL query parameter used by {@link Data}.
 *
 * When only a default value is provided (as a bare {@link Sql} expression),
 * the type is inferred automatically via query analysis. Use this interface
 * when you need to override the inferred type explicitly.
 */
export interface DataQueryParamConfig {
  /** The default value for the query parameter, expressed as a SQL expression. */
  default: Sql;
  /** Optional explicit type. If omitted, the type is inferred from {@link default}. */
  type?: HelperFieldType;
  /**
   * How writes to this param update browser history. Every write (`setScalar`,
   * `bindScalar`, `setQueryParam`) updates the URL. `"replace"` (default)
   * updates the current entry, right for filters, search, sort, and paging;
   * `"push"` adds an entry so Back steps through changes, for navigation-like
   * state such as tabs.
   */
  history?: yom.QueryParamHistory;
}

/**
 * Props for the {@link Data} component.
 *
 * Extends {@link StateProps} (minus `procedure`) with conveniences for data
 * fetching: built-in refetch support, URL query parameters, and fallback UIs
 * for pending/error states.
 */
export interface DataProps extends Omit<StateProps, "procedure"> {
  /** Procedure to run for fetching data. Automatically forced to run on the server unless {@link local} is set. */
  procedure?: StateStatementsOrFn;
  /**
   * URL query parameters that are exposed as scalars inside the procedure.
   *
   * Each entry can be a bare {@link Sql} expression (used as the default value,
   * type inferred automatically) or a {@link DataQueryParamConfig} for explicit
   * type control.
   */
  queryParams?: Record<string, Sql | DataQueryParamConfig>;
  /** If true, this Data component will not respond to global refetch triggered by `s.refetch()`. */
  noRefetch?: boolean;
  /** If true, the procedure runs client-only (no server call) and refetch is disabled. */
  local?: boolean;
  /**
   * Node shown while data is loading. Defaults to a `CircularProgress` spinner.
   * Pass `null` to disable the pending fallback entirely.
   */
  pendingFallback?: Node | null;
  /**
   * Node shown when the data fetch fails. Defaults to an `Alert` component.
   * Pass `null` to disable the error fallback entirely.
   */
  errorFallback?: Node | null;
}

function mapAnalyzeTypeToHelperFieldType(
  type: AnalyzeScalarType,
): HelperFieldType {
  switch (type.type) {
    case "Bool":
    case "SmallInt":
    case "Int":
    case "BigInt":
    case "Real":
    case "Double":
    case "Ordering":
    case "Date":
    case "Time":
    case "String":
    case "Uuid":
      return type.type;
    case "Timestamp":
      return { type: "Timestamp" };
    case "TimestampTz":
      return { type: "TimestampTz" };
    case "TimestampNaive":
      return { type: "TimestampNaive" };
    case "Enum":
      return { type: "Enum", enum: type.enum };
    case "Json":
      return { type: "Json" };
    case "Interval":
      return { type: "Interval" };
    case "Bytes":
      throw new Error(
        "Query parameters cannot be Bytes: URL query params hold text.",
      );
    case "Decimal":
      return {
        type: "Decimal",
        precision: type.precision,
        scale: type.scale,
        signed: true,
      };
  }
}

function inferQueryParamType(
  name: string,
  defaultExpr: Sql,
  analyzeCtx:
    | {
      toLocalDatabases(): import("./yolm_gen_api").LocalDatabase[];
    }
    | undefined,
): HelperFieldType {
  const result = analyzeQuery({
    query: sql`select ${defaultExpr} as value`.toSQL(),
    localDbs: analyzeCtx?.toLocalDatabases(),
    dbScope: ["ui", "db"],
  });
  if (result.status === "error") {
    throw new Error(
      `Unable to infer the type of Data query parameter "${name}": ${result.message}. ` +
        "Specify its type explicitly in the queryParams configuration.",
    );
  }
  if (result.columns.length === 0) {
    throw new Error(
      `Unable to infer the type of Data query parameter "${name}" because analysis returned no columns. ` +
        "Specify its type explicitly in the queryParams configuration.",
    );
  }
  return mapAnalyzeTypeToHelperFieldType(result.columns[0].type);
}

function helperFieldTypeToAnalyzeType(
  type: HelperFieldType,
): AnalyzeScalarType {
  return yomFieldTypeToAnalyzeType(fieldTypeFromHelper(type));
}

function fieldToLocal(f: yom.ProcTableField): LocalField {
  return {
    name: f.name,
    type: yomFieldTypeToAnalyzeType(f.type),
    nullable: !f.notNull,
  };
}

function colToLocal(c: QueryColumnInfo): LocalField {
  return { name: c.name, type: c.type, nullable: c.nullable };
}

/**
 * Walks top-level statements and registers type info for declarations.
 * Called lazily — only when a child actually needs type context.
 */
function analyzeStatements(
  statements: yom.StateStatement[],
  ctx: AnalyzeQueryLocalCtx,
) {
  for (const stmt of statements) {
    const s = stmt as any;
    if (typeof s.name !== "string") continue;

    switch (s.t) {
      case "TableDeclaration":
      case "RecordDeclaration": {
        const kind = s.t === "RecordDeclaration" ? "SingleRecord" : "Table";
        if (s.fields) {
          ctx.addTable(
            s.name,
            (s.fields as yom.ProcTableField[]).map(fieldToLocal),
            kind,
          );
        } else {
          const query = s.inferQuery ?? s.query;
          if (query !== undefined) {
            const result = analyzeQuery({
              query,
              localDbs: ctx.toLocalDatabases(),
              dbScope: ["ui", "db"],
            });
            if (result.status === "ok" && result.columns.length > 0) {
              ctx.addTable(s.name, result.columns.map(colToLocal), kind);
            }
          }
        }
        break;
      }
      case "ScalarDeclaration": {
        if (s.type) {
          ctx.addScalar(
            s.name,
            yomFieldTypeToAnalyzeType(s.type as yom.FieldType),
          );
        } else {
          const analysisExpr = scalarDeclarationAnalysisExpr(
            s as yom.ScalarDeclaration,
          );
          const serializedExpr = s.inferExpr ?? s.expr;
          const expr = analysisExpr?.toSQL() ??
            (typeof serializedExpr === "string" ? serializedExpr : undefined);
          if (expr !== undefined) {
            const result = analyzeQuery({
              query: `select (${expr}) as value`,
              localDbs: ctx.toLocalDatabases(),
              dbScope: ["ui", "db"],
            });
            if (result.status === "ok" && result.columns.length > 0) {
              ctx.addScalar(
                s.name,
                result.columns[0].type,
                result.columns[0].nullable,
              );
            }
          }
        }
        break;
      }
    }
  }
}

/**
 * Lazy version of AnalyzeQueryLocalCtx that defers statement analysis
 * until toLocalDatabases() is actually called by a child component.
 * Most Data nodes pay zero cost since their children never request type info.
 */
class LazyDataAnalyzeCtx extends AnalyzeQueryLocalCtx {
  #getStmtArray: () => yom.StateStatement[];
  #analyzed = false;

  constructor(
    parent: AnalyzeQueryLocalICtx | undefined,
    getStmtArray: () => yom.StateStatement[],
  ) {
    super(parent);
    this.#getStmtArray = getStmtArray;
  }

  #ensureAnalyzed() {
    if (!this.#analyzed) {
      this.#analyzed = true;
      analyzeStatements(this.#getStmtArray(), this);
    }
  }

  override findTable(name: string) {
    this.#ensureAnalyzed();
    return super.findTable(name);
  }

  override toLocalDatabases() {
    this.#ensureAnalyzed();
    return super.toLocalDatabases();
  }
}

function isQueryParamConfig(
  value: Sql | DataQueryParamConfig,
): value is DataQueryParamConfig {
  return !(value instanceof Sql);
}

function normalizeQueryParams(
  queryParams: DataProps["queryParams"],
  analyzeCtx:
    | {
      toLocalDatabases(): import("./yolm_gen_api").LocalDatabase[];
    }
    | undefined,
): QueryParam[] {
  if (!queryParams) {
    return [];
  }
  const params: QueryParam[] = [];
  for (const [name, value] of Object.entries(queryParams)) {
    const defaultExpr = isQueryParamConfig(value) ? value.default : value;
    const type = isQueryParamConfig(value) && value.type
      ? value.type
      : inferQueryParamType(name, defaultExpr, analyzeCtx);
    params.push({
      name,
      type,
      default: defaultExpr,
      history: isQueryParamConfig(value) ? value.history : undefined,
    });
  }
  return params;
}

function createInternalStateName(kind: string) {
  return `__data_${kind}_${getUniqueUiId()}`;
}

function renderData(props: DataProps) {
  const local = props.local ?? false;
  const noRefetch = props.noRefetch ?? false;

  const procFn: StateStatementsOrFn = (s) => {
    if (!local) s.forceServer();
    s.statements(props.procedure);
  };
  let stmts: StateStatements | undefined;
  let stmtArray: yom.StateStatement[] | undefined;
  const getStatements = () => stmts ??= StateStatements.normalize(procFn);
  const getStatementArray = () =>
    stmtArray ??= StateStatements.normalizeToArray(getStatements());

  const parentAnalyzeCtx = useOptionalICtx(AnalyzeQueryLocalICtxKey);
  const analyzeCtx = new LazyDataAnalyzeCtx(
    parentAnalyzeCtx,
    getStatementArray,
  );

  const queryParams = normalizeQueryParams(props.queryParams, analyzeCtx);
  if (queryParams.length > 0) {
    for (const param of queryParams) {
      analyzeCtx.addScalar(
        param.name,
        helperFieldTypeToAnalyzeType(param.type),
        true,
      );
    }
    useQueryParams(queryParams);
  }

  addCtx(analyzeCtx);
  addCtx(
    new SimpleRefetchContext(GLOBAL_REFETCH_SCALAR, [
      sql.ref(GLOBAL_REFETCH_SCALAR),
    ]),
  );

  if (usePhase() === "gather") {
    return props.children;
  }

  const normalizedStatements = getStatements();
  const normalizedStatementArray = getStatementArray();
  const hasEmptyProcedure = normalizedStatementArray.length === 0;
  const hasMeaningfulStateBoundary = props.hoistKey !== undefined ||
    props.statusScalar !== undefined ||
    props.hasDataScalar !== undefined ||
    props.errorRecord !== undefined;
  if (
    local &&
    hasEmptyProcedure &&
    props.watch !== undefined &&
    queryParams.length === 0 &&
    !hasMeaningfulStateBoundary
  ) {
    throw new Error(
      "Invalid Data usage: local Data with an empty procedure cannot be used " +
        "as a watch-only wrapper. Remove the no-op Data wrapper or add actual " +
        "local state, query params, or meaningful state-boundary props.",
    );
  }

  const refetchWatch: AnyExpr[] = !local && !noRefetch
    ? [sql.ref(GLOBAL_REFETCH_SCALAR)]
    : [];
  const userWatch = props.watch
    ? Array.isArray(props.watch) ? props.watch : [props.watch]
    : [];
  const combinedWatch = [...refetchWatch, ...userWatch];

  const errorFallback = local
    ? null
    : props.errorFallback === undefined
    ? (
      <Alert variant="soft" color="danger" startIcon="Error">
        Unable to load data
      </Alert>
    )
    : props.errorFallback;
  const pendingFallback = local
    ? null
    : props.pendingFallback === undefined
    ? <CircularProgress size="sm" />
    : props.pendingFallback;

  const dataReadsStatus = !local &&
    (errorFallback !== null || pendingFallback !== null);

  const statusScalar = props.statusScalar ??
    (dataReadsStatus ? createInternalStateName("status") : undefined);
  const hasDataScalar = props.hasDataScalar ??
    (dataReadsStatus ? createInternalStateName("has_data") : undefined);
  const errorRecord = props.errorRecord;

  useState({
    autoWatch: props.autoWatch ?? true,
    watch: combinedWatch.length > 0 ? combinedWatch : undefined,
    hoistKey: props.hoistKey,
    acceptOldResponses: props.acceptOldResponses,
    longRunning: props.longRunning,
    statusScalar,
    hasDataScalar,
    errorRecord,
    debounce: props.debounce,
    fallbackDelay: props.fallbackDelay,
    procedure: normalizedStatements,
  });

  if (local) {
    return props.children;
  }

  if (errorFallback === null && pendingFallback === null) {
    return props.children;
  }

  const noData = sql`not ${sql.ref(hasDataScalar!)}`;
  const statusFailed = sql`${sql.ref(statusScalar!)} = 'failed'`;
  const statusPending = sql`${
    sql.ref(
      statusScalar!,
    )
  } in ('delayed', 'fallback_triggered')`;

  return (
    <Switch>
      {errorFallback !== null
        ? (
          <Match when={sql`${noData} and ${statusFailed}`}>
            {errorFallback}
          </Match>
        )
        : undefined}
      {pendingFallback !== null
        ? (
          <Match when={sql`${noData} and ${statusPending}`}>
            {pendingFallback}
          </Match>
        )
        : undefined}
      <Match when={sql`true`}>{props.children}</Match>
    </Switch>
  );
}

/**
 * Primary component for data fetching in Yolm. Replaces `State`/`useState` for
 * most use cases by wrapping them with sensible defaults and additional features.
 *
 * Features:
 * - Automatically forces server execution for data fetching.
 * - Built-in global refetch support via `s.refetch()` (incrementing {@link GLOBAL_REFETCH_SCALAR}).
 * - Pending and error fallback UIs out of the box (customizable or disableable).
 * - URL query parameter binding with automatic type inference.
 * - Local mode for client-only state that skips server calls and refetch.
 *
 * @example
 * // Basic data fetch
 * <Data
 *   procedure={(s) => {
 *     s.defTable("users", sql`select * from db.users`);
 *   }}
 * >
 *   <Each table="users" recordName="user">
 *     <p>{sql`user.name`}</p>
 *   </Each>
 * </Data>
 *
 * @example
 * // With URL query parameters
 * <Data
 *   queryParams={{ search: sql.lit`` }}
 *   procedure={(s) => {
 *     s.defTable("results", sql`select * from db.items where name like '%' || search || '%'`);
 *   }}
 * >
 *   ...
 * </Data>
 *
 * @example
 * // Local client-only state (no server call, no refetch)
 * <Data
 *   local
 *   procedure={(s) => {
 *     s.defScalar("editing", sql`false`);
 *   }}
 * >
 *   ...
 * </Data>
 */
export function Data(props: DataProps) {
  return renderData(props);
}
