import type { ComponentOpts, Size } from "components/types";
import type { DatagridBuilder } from "pages/datagrid";
import { Api, GlobalApi } from "./api";
import { createTheme } from "./create_theme";
import {
  getGlobalFontFaces,
  getGlobalFontPreloads,
  type GlobalFontAssetId,
  type GlobalFontPreload,
} from "./default_fonts";
import type { JsModuleConfig } from "./js_modules";
import { resolveJsModule } from "./js_modules";
import type { ThemeOpts } from "./create_theme";
import type {
  EdgeDriverActionName,
  EdgeDriverActionParams,
  EdgeDriverEventName,
  EdgeDriverTypeName,
  ExternalEdgeDriverType,
} from "./edge_drivers";
import { getEdgeDriverDefinition } from "./edge_drivers";
import {
  normalizeCase,
  pluralize,
  singularize,
  upcaseFirst,
} from "./inflectors";
import type { WebAppManifest } from "./pwa_manifest";
import type { SampleDataScriptContext } from "./sample_data";
import { PagesSharedContext } from "./shared_contexts";
import { sql } from "./sql_utils";
import type {
  AnyExpr,
  BooleanExpr,
  NumericExpr,
  SelectColumn,
} from "./sql_utils";
import type { IServerBaseStatements } from "./statements";
import {
  AuthorizeStatements,
  BasicStatements,
  DomStatements,
  EdgeStatements,
  EndpointStatements,
  GeneralServerStatements,
  scalarDeclarationAnalysisExpr,
  StateStatements,
  TestStatements,
  TransformStatements,
} from "./statements";
import type {
  BasicStatementsOrFn,
  DomStatementsOrFn,
  EdgeStatementsOrFn,
  EmailAttachment,
  EndpointStatementsOrFn,
  GeneralServerStatementsOrFn,
  HelperProcField,
  IStatementsBase,
  ProcedureToolRef,
  RankedSearchTable,
  StateStatementsOrFn,
  TestStatementsOrFn,
  TransformStatementsOrFn,
} from "./statements";
import type { KeyFrames, Style, StyleObject } from "./style_types";
import { StyleSheet } from "./stylesheet";
import { tailwindClassesToStyleObject } from "./tailwind";
import type { Theme } from "./theme";
import {
  createClipboardEventObject,
  createFileEventObject,
  createFocusEventObject,
  createFormEventObject,
  createKeyboardEventObject,
  createMouseEventObject,
} from "./event_utils";
import type {
  ChangeEventHandler,
  CheckboxEventHandler,
  ClipboardEventHandler,
  FileEventHandler,
  FocusEventHandler,
  FormEventHandler,
  InputEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
} from "./event_utils";
import {
  AuthorizeSymbol,
  DatagridSymbol,
  DynamicNodeSymbol,
  EachSymbol,
  EffectSymbol,
  Element,
  elementStatementSourceOrigin,
  EventHandlers,
  EventHandlersSymbol,
  gatherChildrenContextInfo,
  ListenSymbol,
  Match,
  MatchSymbol,
  ModeSymbol,
  QueryParamsSymbol,
  RecurseSymbol,
  RecursiveSymbol,
  RedirectSymbol,
  RoutesSymbol,
  RouteSymbol,
  ShowSymbol,
  SourceMapSymbol,
  State,
  StateSymbol,
  Switch,
  SwitchSymbol,
  useApp,
  useState,
} from "./ui";
import {
  popStatementSourceOrigin,
  pushStatementSourceOrigin,
} from "./statement_source";
import type {
  ContextInstance,
  DatagridProps,
  DynamicNodeProps,
  EmptyProps,
  HelperEventHandler,
  ICtxKey,
  Node,
  QueryParam,
  StateProps,
  StatePropsWithoutChildren,
} from "./ui";
import {
  addDatagridNameEnumValue,
  initializeDatagridTables,
} from "../pages/datagrid_internals/db_state";
import { dedent } from "./utils";
import { cronToHumanReadable } from "./utils/cron";

import { SequentialIDGenerator } from "./utils/sequential_id_generator";
import { validPropNames } from "./valid_prop_names";
import type * as yom from "./yom";
import type { ScalarType } from "./yom";
import { Sql } from "./sql_utils";
import * as YolmGenApi from "./yolm_gen_api";
import {
  AnalyzeQueryLocalCtx,
  type AnalyzeQueryLocalICtx,
  AnalyzeQueryLocalICtxKey,
  type AnalyzeScalarType,
  RoutePathParamsCtx,
  RoutePathParamsICtxKey,
  yomFieldTypeToAnalyzeType,
} from "./ictx";

const svgPropNameAliases: Record<string, string> = {
  "clip-path": "clipPath",
  "dominant-baseline": "dominantBaseline",
  "fill-opacity": "fillOpacity",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "marker-start": "markerStart",
  "shape-rendering": "shapeRendering",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "vector-effect": "vectorEffect",
};

interface AppDoc {
  requiredPermission?: string;
  domain: string;
  domainAliases: string[];
  navitems: {
    label: string;
    path: string;
    source: string;
  }[];
}

interface EnumValueDoc {
  name: string;
  displayName?: string;
  description?: string;
}

export interface GeneratePartialOptions {
  apps?: boolean;
  apis?: boolean;
  scheduled?: boolean;
  procedures?: boolean;
  tests?: boolean;
  reactors?: boolean;
  edges?: boolean;
  pipelines?: boolean;
  transforms?: boolean;
}

function addStateStatementDeclarations(
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
            (s.fields as yom.ProcTableField[]).map((f) => ({
              name: f.name,
              type: yomFieldTypeToAnalyzeType(f.type),
              nullable: !f.notNull,
            })),
            kind,
          );
          break;
        }
        const query = s.inferQuery ?? s.query;
        if (query !== undefined) {
          const result = YolmGenApi.analyzeQuery({
            query,
            localDbs: ctx.toLocalDatabases(),
            dbScope: ["ui", "db"],
          });
          if (result.status === "ok" && result.columns.length > 0) {
            ctx.addTable(
              s.name,
              result.columns.map((column) => ({
                name: column.name,
                type: column.type,
                nullable: column.nullable,
              })),
              kind,
            );
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
          break;
        }
        const analysisExpr = scalarDeclarationAnalysisExpr(
          s as yom.ScalarDeclaration,
        );
        const serializedExpr = s.inferExpr ?? s.expr;
        const expr = analysisExpr?.toSQL() ??
          (typeof serializedExpr === "string" ? serializedExpr : undefined);
        if (expr !== undefined) {
          const result = YolmGenApi.analyzeQuery({
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
            break;
          }
        }
        break;
      }
    }
  }
}

class StateAnalyzeCtx extends AnalyzeQueryLocalCtx {
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
      addStateStatementDeclarations(this.#getStmtArray(), this);
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

interface EnumDoc {
  name: string;
  values: EnumValueDoc[];
}

interface FieldDoc {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  enum?: string;
  references?: string;
  onDelete?: yom.OnDeleteBehavior;
  maxLength?: number;
  minLength?: number;
  precision?: number;
  scale?: number;
  signed?: boolean;
  description?: string;
}

interface VirtualFieldDoc {
  name: string;
  expr: string;
  explicitType?: string;
  description?: string;
}

interface TableDoc {
  name: string;
  isSolutionTable: boolean;
  description?: string;
  fields: FieldDoc[];
  virtualFields: VirtualFieldDoc[];
  fromBlock?: string;
}

interface ViewDoc {
  name: string;
  query: string;
  description?: string;
}

interface DbEnumValueDoc {
  name: string;
  description?: string;
}

interface DbEnumDoc {
  name: string;
  values: DbEnumValueDoc[];
}

/** Serializable snapshot of the database schema (tables, views, enums) for tooling/docs. */
export interface DbDoc {
  tables: TableDoc[];
  views: ViewDoc[];
  enums: DbEnumDoc[];
}

interface BlockDoc {
  name: string;
  definedByBlock?: string;
  tablesDefined?: string[];
  componentDependencies?: string[];
  description?: string;
}

/** Scheduled procedure definition with generation-time documentation metadata. */
export interface ScheduledProcedure extends yom.ScheduledProcedure {
  description?: string;
}

function generateScheduledProcedure(
  proc: ScheduledProcedure,
): yom.ScheduledProcedure {
  return {
    name: proc.name,
    schedules: proc.schedules,
    procedure: proc.procedure,
  };
}

interface ScheduledProcedureDoc {
  name: string;
  schedule: string;
  description?: string;
}

interface StoredProcedureDoc {
  name: string;
  transaction: yom.StoredProcedureTransactionMode;
}

interface ApiDoc {
  domain: string;
  prefix: string;
  domainAliases: string[];
  endpoints: {
    method: yom.EndpointMethod;
    path: string;
  }[];
}

/** Serializable snapshot of the whole system (apps, schema, blocks, procedures, api) for tooling/docs. */
export interface SystemDoc {
  apps: AppDoc[];
  apis: ApiDoc[];
  enums: EnumDoc[];
  tables: TableDoc[];
  views: ViewDoc[];
  blocks: BlockDoc[];
  storedProcedures: StoredProcedureDoc[];
  scheduledProcedures: ScheduledProcedureDoc[];
  globalApi: yom.ApiEndpoint[];
  decisionTables: DecisionTable[];
}

interface DecisionTable {
  name: string;
  path: string;
}

/**
 * One stage of a {@link PipelineOpts | pipeline}.
 *
 * A stage reads rows from a Yolm database table or query (`source`) and runs
 * either `process` for each row or `processBatch` for bounded sets of rows.
 * Stages can depend on earlier stages and run in parallel when `parallelize`
 * is true.
 *
 * See {@link https://docs.yolm.io/concepts/pipelines | Pipelines}.
 */
export interface PipelineStageOpts {
  /** A table name or a read-only query that produces the stage's batch rows. */
  source?: string | { query: Sql } | { type: "Table"; table: string } | {
    type: "Query";
    query: Sql;
  };
  /** Explicit stage name for setup/finalize-style stages that do not stream source rows. */
  name?: string;
  /** Names of stages that must finish before this one starts. */
  dependencies?: string[];
  /** Stage or stages that must finish before this one starts. */
  after?: string | string[];
  /** Optional filter applied to the source rows. */
  where?: BooleanExpr;
  /** Statements run for each row from `source`. */
  process?: GeneralServerStatementsOrFn;
  /** Statements run once per bounded, read-only `batch` table of source rows. */
  processBatch?: GeneralServerStatementsOrFn;
  /** Query-output columns whose equal key tuples must be delivered in one batch. */
  keepTogetherBy?: string[];
  /** Run the stage in parallel across rows (defaults to sequential). */
  parallelize?: boolean;
  /** Create a resumable dev database checkpoint after this stage completes. */
  checkpointAfter?: boolean;
}

/**
 * Options for {@link System.addPipeline}.
 *
 * Pipelines can stream rows from Yolm database tables through stages, with
 * optional `setup` and `finalize` procedures that run once. A pipeline can
 * omit stages when it only needs setup/finalize behavior.
 *
 * See {@link https://docs.yolm.io/concepts/pipelines | Pipelines}.
 */
export interface PipelineOpts {
  /** Pipeline name. Defaults to the caller file stem. */
  name?: string;
  /** Statements run once before any stage starts. */
  setup?: GeneralServerStatementsOrFn;
  /** Stages, executed in dependency order. Omit for setup/finalize-only pipelines. */
  stages?: (PipelineStageOpts | yom.PipelineStage)[];
  /** Statements run once after every stage has completed successfully. */
  finalize?: GeneralServerStatementsOrFn;
}

interface NormalizedPipelineStage extends yom.PipelineStage {}

/**
 * Options for {@link System.addReactor}.
 *
 * A reactor re-evaluates `query` and runs `procedure` whenever the query
 * result changes. Choose between PerRecord mode (set `recordName`) and
 * Batch mode (optionally set `resultTable`).
 *
 * See {@link https://docs.yolm.io/concepts/reactors | Reactors}.
 */
export interface ReactorOpts {
  /** Reactor name. Defaults to the caller file stem. */
  name?: string;
  /** Query that drives the reactor. Re-runs trigger `procedure`. */
  query: Sql;
  /** Statements executed when the query result changes. */
  procedure: GeneralServerStatementsOrFn;
  /**
   * Name for the record in PerRecord mode.
   * Providing this automatically sets mode to PerRecord.
   * Cannot be used with `resultTable`.
   */
  recordName?: string;
  /**
   * Name for the results table in Batch mode (defaults to `"reactor"`).
   * Cannot be used with `recordName`.
   */
  resultTable?: string;
  /** Maximum number of concurrent reactor executions (defaults to 1). */
  maxConcurrent?: number;
  /** Maximum wall-clock duration of one handler execution (1–3900 seconds; defaults to 600). */
  maxExecutionSeconds?: number;
}

/**
 * Options for {@link System.outboxTable}.
 *
 * Adds a database table that buffers outgoing work (emails, SMS, etc.)
 * for asynchronous delivery by an outbox reactor.
 */
export interface OutboxTableOpts {
  /** Outbox table name. */
  name: string;
  /** Add extra columns to the default outbox schema. */
  fields?: (table: TableBuilder) => void;
}

/** Callback invoked from an outbox reactor when delivery fails. */
export type OutboxOnError = (
  s: GeneralServerStatements,
  errorMessage?: Sql,
) => void;
/** Callback invoked from an outbox reactor when delivery succeeds. */
export type OutboxOnSuccess = (s: GeneralServerStatements) => void;

/**
 * Options for {@link System.outboxReactor}.
 *
 * A custom outbox reactor: `procedure` does the per-record delivery and
 * must call `onSuccess` or `onError` to mark each row as resolved.
 *
 * For the built-in email and SMS variants see
 * {@link System.emailOutboxReactor} and {@link System.smsOutboxReactor}.
 */
export interface OutboxReactorOpts {
  /** Outbox reactor name. */
  name: string;
  /**
   * Per-record delivery statements. Must terminate by calling
   * `onSuccess(s)` or `onError(s, errorMessage)`.
   */
  procedure: (
    s: GeneralServerStatements,
    onError: OutboxOnError,
    onSuccess: OutboxOnSuccess,
  ) => void;
  /** Statements run after `onSuccess` is invoked. */
  onSuccess?: (s: GeneralServerStatements) => void;
  /** Statements run after `onError` is invoked. */
  onError?: (s: GeneralServerStatements) => void;
  /** Maximum number of concurrent deliveries (defaults to 1). */
  maxConcurrent?: number;
  /** Maximum number of retries before the row is moved to failed. */
  maxRetries?: number;
  /** Interval after which a crashed in-flight delivery is retried. */
  crashTimeout?: string;
  /** Interval between retries — fixed string or a function of retry count. */
  retryBackoff?: string | ((retryCount: Sql) => Sql);
}

interface OutboxReactorBaseOpts {
  name: string;
  setup?: (s: GeneralServerStatements) => void;
  onSuccess?: (s: GeneralServerStatements) => void;
  onError?: (s: GeneralServerStatements) => void;
  maxConcurrent?: number;
  maxRetries?: number;
  crashTimeout?: string;
  retryBackoff?: string | ((retryCount: Sql) => Sql);
  mockProcedure?: EndpointStatementsOrFn;
}

/**
 * Options for {@link System.emailOutboxReactor}.
 *
 * Each field accepts a string literal or a {@link Sql} expression evaluated
 * against the outbox row. See {@link https://docs.yolm.io/services/postmark | Postmark}
 * for delivery details.
 */
export interface EmailOutboxReactorOpts extends OutboxReactorBaseOpts {
  /** From address (literal or SQL expression). */
  from: Sql | string;
  /** To address. Required unless the outbox row already supplies it. */
  to?: Sql | string;
  /** Email subject. */
  subject: Sql | string;
  /** HTML body. At least one of `htmlBody` or `textBody` should be set. */
  htmlBody?: Sql | string;
  /** Plain-text body. */
  textBody?: Sql | string;
  /** Cc address. */
  cc?: Sql | string;
  /** Bcc address. */
  bcc?: Sql | string;
  /** Reply-To address. */
  replyTo?: Sql | string;
  /** Optional tag for delivery analytics. */
  tag?: Sql | string;
  /** Postmark message stream identifier. */
  messageStream?: Sql | string;
  /** File attachments included with the message. */
  attachments?: EmailAttachment[];
}

/**
 * Options for {@link System.smsOutboxReactor}.
 *
 * SMS variant of the outbox reactor pattern.
 */
export interface SmsOutboxReactorOpts extends OutboxReactorBaseOpts {
  /** Recipient phone number. Required unless the outbox row supplies it. */
  to?: Sql | string;
  /** Sender phone number or short code. */
  from: Sql | string;
  /** Message body. */
  body: Sql | string;
}

/**
 * Options for {@link System.addTransform}.
 *
 * Transforms project per-table change events into derived data. See
 * {@link https://docs.yolm.io/concepts/transforms | Transforms}.
 */
export interface TransformOpts {
  /** Transform name. Defaults to the caller file stem. */
  name?: string;
  /** Kind of transform (e.g. realtime vs batch). */
  kind?: yom.TransformKind;
  /**
   * If true, only explicitly listed tables are transformed; unlisted
   * schema-incompatible tables are not auto-replayed.
   */
  disableAutomaticReplay?: boolean;
  /** Statements run once before any per-table processing. */
  setup?: TransformStatementsOrFn;
  /** Per-table change processors. */
  tables: TableTransformOpts[];
  /** Statements run once after every table processor finishes. */
  finalize?: TransformStatementsOrFn;
}

/** Per-table change processor inside a {@link TransformOpts}. */
export interface TableTransformOpts {
  /** Source table whose change events should be processed. */
  table: string;
  /** Variable name bound to each change op (defaults to `"op"`). */
  opRecordName?: string;
  /** Statements run for each change op on `table`. */
  process: TransformStatementsOrFn;
}

/**
 * Options for {@link System.addBenchmark}.
 *
 * Defines a microbenchmark that runs one or more procedures and reports
 * timing.
 */
export interface BenchmarkOpts {
  /** Benchmark name. */
  name: string;
  /** Setup statements run once before the procedures. */
  setup?: GeneralServerStatementsOrFn;
  /** Procedures to benchmark. */
  procedures: BenchmarkProcOpts[];
}

/** A single procedure inside a {@link BenchmarkOpts}. */
export interface BenchmarkProcOpts {
  /** Procedure name (displayed in benchmark output). */
  name: string;
  /** Statements to time. */
  body: GeneralServerStatementsOrFn;
  /** Number of timed iterations. */
  iterations?: number;
  /** Number of warm-up iterations not counted in the result. */
  warmup?: number;
}

/**
 * A named set of fields used as a record or table parameter in
 * {@link StoredProcedureOpts}.
 */
export interface StoredProcedureFieldSetOpts {
  /** Parameter name (referenced from the procedure body). */
  name: string;
  /** Fields belonging to the record or table parameter. */
  fields: HelperProcField[];
}

/**
 * Options for {@link System.storedProcedure}.
 *
 * Stored procedures are server-side procedures callable from other
 * procedures, endpoints, or scheduled jobs.
 */
interface StoredProcedureCommonOpts {
  /** Procedure name. Defaults to the caller file stem. */
  name?: string;
  /** Scalar input parameters. */
  inputScalars?: HelperProcField[];
  /** Record input parameters. */
  inputRecords?: StoredProcedureFieldSetOpts[];
  /** Table input parameters. */
  inputTables?: StoredProcedureFieldSetOpts[];
  /** Scalar output parameters. */
  outputScalars?: HelperProcField[];
  /** Record output parameters. */
  outputRecords?: StoredProcedureFieldSetOpts[];
  /** Table output parameters. */
  outputTables?: StoredProcedureFieldSetOpts[];
  /** Procedure body. */
  procedure: GeneralServerStatementsOrFn;
}

/** An ordinary reusable stored procedure. */
export interface OrdinaryStoredProcedureOpts extends StoredProcedureCommonOpts {
  /** Transaction mode controlling how the procedure handles transactions. */
  transaction?: yom.StoredProcedureTransactionMode;
  invocationKind?: "ordinary";
}

/** A standalone entry that can be exposed through a checked JS tool binding. */
export interface ToolEntryStoredProcedureOpts
  extends StoredProcedureCommonOpts {
  /** Stable catalog identity; tool entries never infer a name from a caller. */
  name: string;
  /** Native tools have a scalar-only invocation ABI. */
  inputRecords?: never;
  inputTables?: never;
  outputRecords?: never;
  outputTables?: never;
  /** Tool entries own their transaction boundary and never inherit one. */
  transaction: "standalone";
  /** `toolEntryProcedure` sets the only valid invocation kind itself. */
  invocationKind?: never;
}

export type StoredProcedureOpts =
  | OrdinaryStoredProcedureOpts
  | ToolEntryStoredProcedureOpts;

/** Internal registration shape; only `toolEntryProcedure` may mint toolEntry. */
type StoredProcedureRegistration = StoredProcedureCommonOpts & {
  name?: string;
  transaction?: yom.StoredProcedureTransactionMode;
  invocationKind?: yom.StoredProcedureInvocationKind;
};

/**
 * Function passed to {@link System.addValidation} that inspects the fully
 * built system and returns an error message, or `undefined` if the system
 * passes.
 */
export type ValidationFn = (system: System) => string | undefined;

/**
The system class, THE main class of Yolm.

It represents the entire system, including the database, the ui for apps, the api, everything.

This operates at a higher level of abstraction than the YOM, such as pages, blocks, etc. Its main purpose is to provide a single
point of entry for the system, and to provide a single point of configuration and generate the YOM.

A system.tsx script has easy access to the system singleton, and can be used to configure the system.

Every system imports the system and db singletons as follows.

```tsx
import { db, system } from "std/system";
```

 @category Core, Initial

 */

/**
 * Walks the stack trace to find the first userland file:// frame
 * (skipping packages/std/ frames) and returns the filename stem.
 */
function getCallerFileStem(): string | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  const matches = stack.match(
    /(?:file:\/\/|yolm:\/\/)(.+?)\.(tsx?|jsx?):\d+/g,
  );
  for (const m of matches ?? []) {
    const url = m.match(/(?:file:\/\/|yolm:\/\/)(.+?)\.(tsx?|jsx?)/)!;
    const path = url[1];
    if (path.includes("/packages/")) continue;
    const parts = path.split("/");
    return parts[parts.length - 1];
  }
  return undefined;
}

/**
 * Options for {@link System.edge}.
 *
 * An edge represents code that runs at the edge of the system — typically
 * close to clients or external integrations. Edges bind drivers (third-party
 * services / hardware) and respond to boot, timer, reactor, and driver
 * events.
 */
export type EdgeDriver<TType extends EdgeDriverTypeName = EdgeDriverTypeName> =
  & {
    readonly type: TType;
  }
  & (TType extends ExternalEdgeDriverType ? {
      readonly process: yom.EdgeDriverProcess;
      readonly eventDurabilities: Readonly<
        Record<string, yom.EdgeDriverDurability>
      >;
    }
    : {
      readonly process?: never;
      readonly eventDurabilities?: never;
    });

export interface EdgeOpts<
  TDrivers extends Readonly<Record<string, EdgeDriver>> = Record<never, never>,
> {
  /** Edge name. Defaults to the caller file stem. */
  name?: string;
  /** Drivers bound to this edge. */
  drivers?: TDrivers;
}

/** Options for {@link EdgeBuilder.onBoot}: procedure to run when the edge boots. */
export interface EdgeBootHandlerOpts {
  /** Optional handler name. */
  name?: string;
  /** Statements executed when the edge boots. */
  procedure: EdgeStatementsOrFn;
}

/** Options for {@link EdgeBuilder.onTimer}: procedure to run on a fixed interval. */
export interface EdgeTimerHandlerOpts {
  /** Handler name. */
  name: string;
  /** Interval between invocations, in milliseconds. */
  everyMs: number;
  /** Run the procedure immediately on edge boot in addition to on schedule. */
  runOnStart?: boolean;
  /** Statements executed each tick. */
  procedure: EdgeStatementsOrFn;
}

/** Options for {@link EdgeBuilder.onReactor}: edge-side reactor on a SQL query. */
export interface EdgeReactorHandlerOpts {
  /** Handler name. */
  name: string;
  /** Query that drives the reactor. */
  query: Sql;
  /** Statements executed when the query result changes. */
  procedure: EdgeStatementsOrFn;
}

/** Options for {@link EdgeBuilder.onDriver}: handler for events emitted by a bound driver. */
export interface EdgeDriverHandlerOpts<
  TType extends EdgeDriverTypeName,
  TEvent extends string,
> {
  /** Handler name. */
  name: string;
  /** Name of the bound driver this handler listens on. */
  driver: TypedEdgeDriverBinding<TType, TEvent>;
  /** Driver event name. */
  event: NoInfer<TEvent>;
  /** Process bounded microbatches instead of one procedure turn per event. */
  batch?: {
    /** Maximum events in one batch. */
    maxItems: number;
    /** Maximum milliseconds from the first event until the batch seals. */
    maxWaitMs: number;
    /** Maximum encoded event bytes in one batch. */
    maxBytes: number;
  };
  /** Statements executed when the driver emits `event`. */
  procedure: EdgeStatementsOrFn;
}

/** A durable driver event intentionally not consumed by this Edge. */
export interface EdgeIgnoredDriverEventOpts<
  TType extends EdgeDriverTypeName,
  TEvent extends string,
> {
  /** Name of the bound driver. */
  driver: TypedEdgeDriverBinding<TType, TEvent>;
  /** Declared driver event name. */
  event: NoInfer<TEvent>;
}

export type {
  EdgeDriverConfig,
  EdgeDriverTypeName,
  EdgeDriverTypeRegistry,
  ExternalEdgeDriverConfig,
  ExternalEdgeDriverType,
} from "./edge_drivers";
/**
 * Validates an edge config value. Called by {@link EdgeBuilder.validateConfig}.
 *
 * Use `s` to emit validation statements (throws an error) and inspect
 * `config` to access the incoming configuration value.
 */
export interface EdgeConfigValidationStatements {
  throwError(message: Sql, description?: Sql): unknown;
  throwErrorIf(
    condition: BooleanExpr,
    message: Sql,
    description?: Sql,
  ): unknown;
}

export type EdgeConfigValidator = (
  s: EdgeConfigValidationStatements,
  config: AnyExpr,
) => void;

/**
 * A driver binding tagged with its driver type so {@link send} parameters
 * are checked at compile time. Returned by {@link EdgeBuilder.driver} and
 * normally used inline at the call site.
 */
export class TypedEdgeDriverBinding<
  TType extends EdgeDriverTypeName,
  TEvent extends string = EdgeDriverEventName<TType>,
> {
  declare private readonly eventType: TEvent;
  constructor(
    /** Name the driver is bound under on the edge. */
    public readonly name: string,
    /** Driver type — determines the available actions. */
    public readonly type: TType,
    token: typeof edgeDriverBindingToken,
  ) {
    if (token !== edgeDriverBindingToken) {
      throw new Error(
        "Edge driver bindings are created by EdgeBuilder.driver()",
      );
    }
  }

  /**
   * Produce an {@link EdgeDriverSendOpts} object targeting this driver.
   * Used inside an edge handler to dispatch an action.
   */
  send<TAction extends EdgeDriverActionName<TType>>(
    opts:
      & {
        /** Action name supported by this driver type. */
        action: TAction;
        /** Parameters required by the action. */
        params: EdgeDriverActionParams<TType, TAction>;
      }
      & (
        | {
          /** Persist the command across restarts. */
          durability: "durable";
          /** Stable id used for replay and idempotency. */
          commandId: AnyExpr;
        }
        | {
          /** Dispatch without durable replay. */
          durability?: "ephemeral";
          commandId?: never;
        }
      ),
  ) {
    return {
      driver: this.name,
      action: opts.action,
      params: opts.params,
      durability: opts.durability,
      commandId: opts.commandId,
    };
  }
}

const edgeDriverBindingToken = Symbol("edgeDriverBinding");

type EdgeDriverEvents<TDriver extends EdgeDriver> = TDriver extends
  { type: ExternalEdgeDriverType; eventDurabilities: infer TEvents }
  ? keyof TEvents & string
  : EdgeDriverEventName<TDriver["type"]>;

function validateBuiltInDriverActions(
  edgeName: string,
  statements: yom.EdgeStatement[],
  drivers: yom.EdgeDriverBinding[],
) {
  for (const statement of statements) {
    switch (statement.t) {
      case "DriverSend": {
        const binding = drivers.find((driver) =>
          driver.name === statement.driver
        );
        if (binding && !binding.type.startsWith("external:")) {
          const definition = getEdgeDriverDefinition(binding.type);
          if (!(statement.action in definition.actions)) {
            throw new Error(
              `Edge "${edgeName}" driver "${binding.name}" of type "${binding.type}" does not declare action "${statement.action}"`,
            );
          }
        }
        break;
      }
      case "If":
        validateBuiltInDriverActions(edgeName, statement.onTrue, drivers);
        validateBuiltInDriverActions(
          edgeName,
          statement.onFalse ?? [],
          drivers,
        );
        break;
      case "While":
      case "Block":
      case "ForEachCursor":
      case "ForEachQuery":
      case "ForEachTable":
        validateBuiltInDriverActions(edgeName, statement.body, drivers);
        break;
      case "Try":
        validateBuiltInDriverActions(edgeName, statement.body, drivers);
        validateBuiltInDriverActions(edgeName, statement.catch ?? [], drivers);
        validateBuiltInDriverActions(
          edgeName,
          statement.finally ?? [],
          drivers,
        );
        break;
      default:
        break;
    }
  }
}

function driverEventKey(driver: string, event: string) {
  return `${driver}\0${event}`;
}

/**
 * Builder returned by {@link System.edge} that registers handlers, drivers,
 * and setup statements for a single edge.
 *
 * Each edge has one definition and one builder.
 */
export class EdgeBuilder<
  TDrivers extends Readonly<Record<string, EdgeDriver>> = Readonly<
    Record<string, EdgeDriver>
  >,
> {
  #setup?: yom.EdgeStatement[];
  #handlers: yom.EdgeHandler[] = [];
  #drivers: yom.EdgeDriverBinding[];
  #driverDefinitions?: TDrivers;
  #configValidator?: EdgeConfigValidator;
  #ignoredDriverEvents = new Set<string>();

  constructor(
    /** Edge name. */
    public readonly name: string,
    drivers?: TDrivers,
  ) {
    this.#driverDefinitions = drivers;
    this.#drivers = Object.entries(drivers ?? {}).map(([name, driver]) => ({
      name,
      ...driver,
    }));
  }

  /**
   * Set the setup procedure run once per edge boot.
   */
  setup(procedure: EdgeStatementsOrFn) {
    if (this.#setup !== undefined) {
      throw new Error(`Edge "${this.name}" setup() was already defined`);
    }
    this.#setup = EdgeStatements.normalizeToArray(procedure);
    return this;
  }

  /** Set the validator that runs against the edge's config value. */
  validateConfig(validator: EdgeConfigValidator) {
    if (this.#configValidator !== undefined) {
      throw new Error(
        `Edge "${this.name}" validateConfig() was already defined`,
      );
    }
    this.#configValidator = validator;
    return this;
  }

  /** Register a handler that runs once when the edge boots. */
  onBoot(opts: EdgeBootHandlerOpts) {
    this.addHandler({
      name: opts.name ?? "boot",
      source: { type: "boot" },
      procedure: EdgeStatements.normalizeToArray(opts.procedure),
    });
  }

  /** Register a handler that runs on a fixed timer. */
  onTimer(opts: EdgeTimerHandlerOpts) {
    this.addHandler({
      name: opts.name,
      source: {
        type: "timer",
        everyMs: opts.everyMs,
        runOnStart: opts.runOnStart,
      },
      procedure: EdgeStatements.normalizeToArray(opts.procedure),
    });
  }

  /** Register an edge-side reactor handler driven by a SQL query. */
  onReactor(opts: EdgeReactorHandlerOpts) {
    this.addHandler({
      name: opts.name,
      source: {
        type: "reactor",
        query: opts.query.toYOM(),
      },
      procedure: EdgeStatements.normalizeToArray(opts.procedure),
    });
  }

  /** Register a handler for events emitted by a bound driver. */
  onDriver<TType extends EdgeDriverTypeName, TEvent extends string>(
    opts: EdgeDriverHandlerOpts<TType, TEvent>,
  ) {
    this.addHandler({
      name: opts.name,
      source: {
        type: "driver",
        driver: opts.driver.name,
        event: opts.event,
        batch: opts.batch,
      },
      procedure: EdgeStatements.normalizeToArray(opts.procedure),
    });
  }

  /** Explicitly acknowledge a declared durable driver event without handling it. */
  ignoreDriverEvent<TType extends EdgeDriverTypeName, TEvent extends string>(
    opts: EdgeIgnoredDriverEventOpts<TType, TEvent>,
  ) {
    this.#ignoredDriverEvents.add(driverEventKey(opts.driver.name, opts.event));
    return this;
  }

  /**
   * Look up a driver binding by name. Returns a typed binding whose
   * `send(...)` method validates action / params against the driver type at
   * compile time. Throws if no binding with that name and type exists.
   */
  driver<TName extends keyof TDrivers & string>(
    name: TName,
  ): TypedEdgeDriverBinding<
    TDrivers[TName]["type"],
    EdgeDriverEvents<TDrivers[TName]>
  > {
    const binding = this.#driverDefinitions?.[name];
    if (!binding) {
      throw new Error(
        `Edge "${this.name}" has no declared driver binding named "${name}"`,
      );
    }
    return new TypedEdgeDriverBinding(
      name,
      binding.type,
      edgeDriverBindingToken,
    );
  }

  /** Run the registered config validator (no-op if none was set). */
  private runConfigValidator(
    s: EdgeConfigValidationStatements,
    config: AnyExpr,
  ) {
    this.#configValidator?.(s, config);
  }

  private addHandler(handler: yom.EdgeHandler) {
    if (this.#handlers.some((existing) => existing.name === handler.name)) {
      throw new Error(
        `Edge "${this.name}" handler "${handler.name}" was already defined`,
      );
    }
    this.#handlers.push(handler);
  }

  /**
   * Validate the edge configuration and produce the YOM representation.
   * Called by the system at generation time — application code does not need
   * to invoke this directly.
   */
  generateYom(): yom.Edge {
    const validation = new EdgeStatements();
    this.runConfigValidator(validation, sql`edge_config`);
    const setup = this.#setup ?? [];
    validateBuiltInDriverActions(this.name, setup, this.#drivers);
    for (const handler of this.#handlers) {
      validateBuiltInDriverActions(this.name, handler.procedure, this.#drivers);
    }
    const handledDriverEvents = new Set<string>();
    for (const handler of this.#handlers) {
      const source = handler.source;
      if (source.type !== "driver") {
        continue;
      }
      handledDriverEvents.add(
        driverEventKey(source.driver, source.event),
      );
    }
    for (const ignored of this.#ignoredDriverEvents) {
      if (handledDriverEvents.has(ignored)) {
        throw new Error(
          `Edge "${this.name}" cannot both handle and ignore driver event "${
            ignored.replace("\0", "/")
          }"`,
        );
      }
    }
    const handlerNames = new Set(this.#handlers.map((handler) => handler.name));
    const ignoredHandlers: yom.EdgeHandler[] = [];
    let ignoredHandlerIndex = 0;
    for (const ignored of [...this.#ignoredDriverEvents].sort()) {
      let name: string;
      do {
        name = `__yolm_ignored_driver_event_${ignoredHandlerIndex++}`;
      } while (handlerNames.has(name));
      handlerNames.add(name);
      const [driver, event] = ignored.split("\0");
      ignoredHandlers.push({
        name,
        source: { type: "driver", driver, event },
        procedure: [],
      });
    }
    return {
      name: this.name,
      drivers: [...this.#drivers]
        .map((driver) => {
          const declaredEvents = getEdgeDriverDefinition(driver.type).events;
          return {
            ...driver,
            eventDurabilities: driver.type.startsWith("external:")
              ? driver.eventDurabilities ?? {}
              : Object.fromEntries(
                Object.entries(declaredEvents).map(([event, def]) => [
                  event,
                  def.durability,
                ]),
              ),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      validate: EdgeStatements.normalizeToArray(validation),
      setup,
      handlers: [...this.#handlers, ...ignoredHandlers],
    };
  }
}

/**
 * The top-level Yolm system singleton — the entry point that ties together
 * the database, apps, apis, scheduled jobs, blocks, enums, and everything
 * else, and produces the YOM. Configure it from `core.tsx` / `system.tsx`
 * via the exported {@link system} instance (and its {@link db}).
 *
 * @category Core, Initial
 */
export class System {
  /**
   * Set to `true` after `core.tsx` finishes executing. Schema-mutating
   * helpers (adding tables, enums, etc.) check this and throw if mutation
   * is attempted afterwards.
   */
  isGlobalsLocked = false;
  /** Set of scalar function names that were defined in core.tsx (used to detect new functions in app files) */
  #coreScalarFunctionNames: Set<string> | null = null;
  /**
       Configures how display names are generated for various parts of the system.

       You can override these functions to customize how display names are generated.
       */
  displayNameConfig: DisplayNameConfig = {
    default: defaultGetDisplayName,
    table: defaultGetDisplayName,
    field: defaultGetDisplayName,
    enum: defaultGetDisplayName,
    enumValue: defaultGetDisplayName,
  };
  /**
       Configures the default search settings for the system, generators will use these (for example the navbar search dialog).
       */
  searchConfig: SearchConfig = {
    defaultFuzzyConfig: {
      prefix: "Last",
      transpositionCostOne: true,
      tolerance: [
        { min: 8, tolerance: 2 },
        { min: 4, tolerance: 1 },
        { min: 0, tolerance: 0 },
      ],
    },
    /** Tokens are the smallest unit of text that can be searched, sql.g. a word. This defines the default tokenizer. */
    defaultTokenizer: {
      splitter: { type: "Alphanumeric" },
      filters: [{ type: "AsciiFold" }, { type: "Lowercase" }],
    },
  };

  /**
       The default collation to use for text fields in the system.

       Collation determines how text is sorted and compared.

       @default "NoCase"
       */
  collation = "NoCase" as yom.Collation;
  /**
       The default auto trim setting to use for text fields in the system.

       Auto trim determines if leading and trailing whitespace should be removed from text fields.

       @default "None"
       */
  autoTrim = "None" as yom.AutoTrim;
  /**
       Locale of the system, controls how dates, numbers, etc. are formatted.

       Currently only en_us is supported.
       */
  locale: yom.Locale = "en_us";
  /**
       Timezone of the system, controls how detes on the server are handled, when scheduled procs fire, etc.

       Use a timezone identifier from the IANA Time Zone Database.
       */
  timezone = "America/New_York";
  /**
       The database definition for the system. This is where you define your tables, scalar functions, enums, etc.
       This is the single database that is shared by all apps, api, webhooks, etc.
       You can also access defined tables to automatically generate api endpoints, ui, etc.
       */
  db = new Db();
  /**
   * The api definitions for the system. An api is a set of https endpoints
   * that other programs can use to interact with the system.
   */
  apis: Api[] = [];
  /** Index of the api currently being defined, while inside {@link System.api}. */
  currentApiIdx?: number;
  /**
          An enum is a set of named values. These enums can be used in the apps, database, api, etc.
       */
  enums: Record<string, Enum> = {};
  /**
       All scalar functions defined in the system. Scalar functions are functions that take in arguments and return a single value.

       These functions are defined at the root level and do not have access to the database. They can be used in the apps, database, api, etc.
       */
  scalarFunctions: Record<string, ScalarFunction> = {};
  /**
       The test data and api tests for the system. More tests coming eventually.
       Can be called directly as system.test("name", fn) or via methods like system.test.testDataProc(...)
       */
  test: CallableTest = createCallableTest();
  /** Pipelines registered via {@link System.addPipeline}. */
  pipelines: yom.Pipeline[] = [];
  /** Reactors registered via {@link System.addReactor}. */
  reactors: yom.Reactor[] = [];
  /** Transforms registered via {@link System.addTransform}. */
  transforms: yom.Transform[] = [];
  /** Benchmarks registered via {@link System.addBenchmark}. */
  benchmarks: yom.Benchmark[] = [];
  /** Edges registered via {@link System.edge}. */
  edges: Array<{ name: string; generateYom(): yom.Edge }> = [];

  /** Block metadata injected into DynamicNode runtime code as `system.blockMetadata`. */
  blockMetadata: Record<string, any> = {};

  /** The {@link App} currently being rendered (set during YOM generation). */
  renderingApp: App | undefined;

  /**
       The base url for the static webhooks, this is where we will put the endpoints for static webhooks.

       The URL scheme is: https://{domain}/api/static_webhook/{key}
       */
  staticWebhookDomain?: string;
  /**
       A webhook is a way to register an endpoint with an associated set of statements that is called a specific event happens,
       sql.g. a Stripe payment, a Brevo hard bounce, etc.

       Static webhooks means that it is defined in code and not setup by a user.
       **/
  staticWebhooks: StaticWebhook[] = [];
  #staticWebhookApi: Api | undefined;
  #declaredStaticWebhookCount = 0;
  #emittedStaticWebhookCount = 0;
  /** Validators registered via {@link System.addValidation}, keyed by name. */
  validations = new Map<string, ValidationFn>();
  /** Stored procedures registered via {@link System.storedProcedure}. */
  storedProcedures: yom.StoredProcedure[] = [];
  /** Scheduled procedures registered via {@link System.scheduledProc}. */
  scheduledProcedures: ScheduledProcedure[] = [];
  /** Tracks registered outbox tables for validation in enqueueToOutbox. */
  outboxTables = new Map<string, { tableName: string; userFields: string[] }>();
  #blocks = new Map<BlockConstructor<Block>, Block[]>();
  #apps: App[] = [];
  #context = new Map<ICtxKey<any>, any>();
  #delayedFunctions: (() => void)[] = [];
  /** Currently active block frames — used to attribute schema changes to the block adding them. */
  blockStack: BlockFrame[] = [];
  /** All table blocks attached to tables across the system. */
  allTableBlocks: { table: Table; block: TableBlock }[] = [];
  /** Default theme used by apps that do not specify their own. */
  defaultTheme: Theme = createTheme({});
  /** Optional mapping describing the previously-deployed database layout. */
  previousMapping?: yom.DatabaseMapping;
  /** Typst templates registered via {@link System.useTypstTemplate} / {@link System.useTypstLib}. */
  typstTemplates: yom.TypstTemplate[] = [];
  private _packageAssetsLoaded = false;

  /**
   * Load a package template from packages/templates/{name}.typ.
   * Also loads package template asset registry on first call.
   */
  useTypstTemplate(name: string): void {
    if (this.typstTemplates.some((t) => t.name === name)) return;
    const body = YolmGenApi.loadRepoTextFile(`packages/templates/${name}.typ`);
    this.typstTemplates.push({ name, body });
    this.loadPackageTemplateAssets();
  }

  /**
   * Load a shared Typst library from packages/templates/_lib/{name}.typ.
   */
  useTypstLib(name: string): void {
    const libName = `_lib/${name}`;
    if (this.typstTemplates.some((t) => t.name === libName)) return;
    const body = YolmGenApi.loadRepoTextFile(
      `packages/templates/_lib/${name}.typ`,
    );
    this.typstTemplates.push({ name: libName, body });
  }

  private loadPackageTemplateAssets(): void {
    if (this._packageAssetsLoaded) return;
    this._packageAssetsLoaded = true;
    try {
      const json = YolmGenApi.loadRepoTextFile(
        "packages/templates/assets.json",
      );
      const registry = JSON.parse(json) as Record<string, string>;
      for (const [name, hash] of Object.entries(registry)) {
        YolmGenApi.addAssetHash(name, hash);
      }
    } catch {
      /* no registry = no package assets */
    }
  }

  /** Endpoints exposed on the system-wide global API (not scoped to a single app). */
  globalApi = new GlobalApi();
  /** Decision tables registered via {@link System.addDecisionTable}. */
  decisionTables: DecisionTable[] = [];
  constructor() {}

  /**
   * Index that `app` will occupy in the apps array. Returns the existing
   * index if an app with the same domain is already registered, otherwise
   * the next-available index.
   */
  appIndex(app: App) {
    const idx = this.#apps.findIndex((a) => a.domain === app.domain);
    if (idx === -1) {
      return this.#apps.length;
    }
    return idx;
  }

  /** Register a decision table. Decision tables live under `decision_tables/`. */
  addDecisionTable(table: DecisionTable) {
    this.decisionTables.push(table);
  }

  /** Set the default theme used by apps that do not override it. */
  setDefaultTheme(theme: ThemeOpts) {
    this.defaultTheme = createTheme(theme);
  }

  /** Publish block-level metadata for DynamicNode code. */
  setDynamicBlockMetadata(key: string, value: any) {
    this.blockMetadata[key] = value;
  }

  /**
   * Register a system-level block. Blocks package schema, logic and UI; see
   * {@link https://docs.yolm.io/concepts/blocks | Blocks}. The block is
   * initialized immediately; further introspection is available via
   * {@link System.block} / {@link System.blocks}.
   */
  addBlock(block: Block) {
    this.blockStack.push({
      type: "system",
      block,
    });
    block.initialize();
    this.blockStack.pop();
    if (this.#blocks.has(block.constructor as BlockConstructor<Block>)) {
      this.#blocks
        .get(block.constructor as BlockConstructor<Block>)!
        .push(block);
    } else {
      this.#blocks.set(block.constructor as BlockConstructor<Block>, [block]);
    }
  }

  /**
   * Register a pipeline. If `name` is omitted, it defaults to the caller
   * file stem. Re-registering with the same name replaces the previous
   * definition. See {@link PipelineOpts}.
   */
  addPipeline(opts: PipelineOpts) {
    if (!opts.name) {
      const stem = getCallerFileStem();
      if (!stem) {
        throw new Error(
          "addPipeline(): could not derive name from filename. Please provide name explicitly.",
        );
      }
      opts = { ...opts, name: stem };
    }
    const pipeline = normalizePipeline(opts as PipelineOpts & { name: string });
    const idx = this.pipelines.findIndex((p) => p.name === pipeline.name);
    if (idx === -1) {
      this.pipelines.push(pipeline);
    } else {
      this.pipelines[idx] = pipeline;
    }
    return pipeline;
  }

  /**
   * Register a reactor. Provide `recordName` for PerRecord mode or
   * `resultTable` for Batch mode (not both). If `opts.name` is omitted the
   * caller file stem is used; if both are present the final name is
   * `"{fileStem}/{opts.name}"`. See {@link ReactorOpts}.
   */
  addReactor(opts: ReactorOpts) {
    if (opts.resultTable && opts.recordName) {
      throw new Error(
        `Reactor "${opts.name}": Cannot provide both resultTable and recordName. ` +
          `Use recordName for PerRecord mode, or resultTable for Batch mode.`,
      );
    }
    const fileStem = getCallerFileStem();
    let name: string;
    if (opts.name) {
      name = fileStem ? `${fileStem}/${opts.name}` : opts.name;
    } else if (fileStem) {
      name = fileStem;
    } else {
      throw new Error(
        "addReactor(): could not derive name from filename. Please provide name explicitly.",
      );
    }
    const maxExecutionSeconds = opts.maxExecutionSeconds ?? 600;
    if (
      !Number.isInteger(maxExecutionSeconds) || maxExecutionSeconds < 1 ||
      maxExecutionSeconds > 3900
    ) {
      throw new Error(
        `Reactor "${name}": maxExecutionSeconds must be an integer between 1 and 3900.`,
      );
    }
    const mode: yom.ReactorMode = opts.recordName ? "PerRecord" : "Batch";
    const resultTable = opts.recordName || opts.resultTable;
    const reactor: yom.Reactor = {
      name,
      query: opts.query.toYOM(),
      procedure: GeneralServerStatements.normalizeToArray(opts.procedure),
      resultTable: resultTable,
      mode: mode,
      maxConcurrency: opts.maxConcurrent ?? 1,
      maxExecutionSeconds,
    };
    const idx = this.reactors.findIndex((r) => r.name === reactor.name);
    if (idx === -1) {
      this.reactors.push(reactor);
    } else {
      this.reactors[idx] = reactor;
    }
    return reactor;
  }

  /**
   * Register a transform. Transforms project per-table change events into
   * derived data. The transform name defaults to the caller file stem. See
   * {@link TransformOpts}.
   */
  addTransform(opts: TransformOpts) {
    let resolvedName: string;
    if (opts.name) {
      resolvedName = opts.name;
    } else {
      const stem = getCallerFileStem();
      if (!stem) {
        throw new Error(
          "addTransform(): could not derive name from filename. Please provide name explicitly.",
        );
      }
      resolvedName = stem;
    }
    const transform: yom.Transform = {
      name: resolvedName,
      kind: opts.kind,
      disableAutomaticReplay: opts.disableAutomaticReplay,
      setup: opts.setup ? transformStatements(opts.setup) : [],
      tables: opts.tables.map((t) => ({
        table: t.table,
        opRecordName: t.opRecordName,
        process: transformStatements(t.process),
      })),
      finalize: opts.finalize ? transformStatements(opts.finalize) : [],
    };
    const idx = this.transforms.findIndex((t) => t.name === transform.name);
    if (idx === -1) {
      this.transforms.push(transform);
    } else {
      this.transforms[idx] = transform;
    }
    return transform;
  }

  /**
   * Register a benchmark. Benchmarks run one or more procedures with a
   * shared setup and report timings. See {@link BenchmarkOpts}.
   */
  addBenchmark(opts: BenchmarkOpts) {
    const benchmark: yom.Benchmark = {
      name: opts.name,
      setup: GeneralServerStatements.normalizeToArray(opts.setup),
      procedures: opts.procedures.map((p) => ({
        name: p.name,
        body: GeneralServerStatements.normalizeToArray(p.body),
        iterations: p.iterations,
        warmup: p.warmup,
      })),
    };
    const idx = this.benchmarks.findIndex((b) => b.name === benchmark.name);
    if (idx === -1) {
      this.benchmarks.push(benchmark);
    } else {
      this.benchmarks[idx] = benchmark;
    }
    return benchmark;
  }

  /**
   * Return the single instance of a block type registered via
   * {@link System.addBlock}. Throws if there are zero or more than one
   * matching block instances.
   */
  block<T extends Block>(ctor: BlockConstructor<T>): T {
    const blocks = this.#blocks.get(ctor);
    if (!blocks) {
      throw new Error(`Block ${ctor.name} not found`);
    }
    if (blocks.length !== 1) {
      throw new Error(
        `Block ${ctor.name} found ${blocks.length} times, expected 1`,
      );
    }
    return blocks[0] as T;
  }

  /** True if at least one instance of `ctor` has been registered. */
  hasBlock<T extends Block>(ctor: BlockConstructor<T>): boolean {
    return this.#blocks.has(ctor);
  }

  /** Return every registered instance of `ctor` (possibly empty). */
  blocks<T extends Block>(ctor: BlockConstructor<T>): T[] {
    return (this.#blocks.get(ctor) ?? []) as T[];
  }

  /** Return every block instance registered system-wide. */
  allBlocks(): Block[] {
    return Array.from(this.#blocks.values()).flat();
  }

  /**
   * Like {@link System.block} but returns `undefined` when the block is not
   * registered. Throws when more than one matching instance exists.
   */
  blockOptional<T extends Block>(ctor: BlockConstructor<T>): T | undefined {
    if (this.#blocks.has(ctor)) {
      const blocks = this.#blocks.get(ctor)!;
      if (blocks.length === 1) {
        return blocks[0] as T;
      }
      throw new Error(
        `Block ${ctor.name} found ${blocks.length} times, expected 1`,
      );
    }
  }

  /**
   * Return the single registered block with a stable `blockName`.
   *
   * Prefer constructor lookup for ordinary package blocks. Name lookup is the
   * extension seam for a system-local implementation of a packaged contract,
   * where importing the package constructor would defeat local ownership.
   */
  blockNamed<T extends Block>(blockName: string): T {
    const blocks = this.allBlocks().filter((block) =>
      block.blockName === blockName
    );
    if (blocks.length === 0) {
      throw new Error(`Block ${blockName} not found`);
    }
    if (blocks.length !== 1) {
      throw new Error(
        `Block ${blockName} found ${blocks.length} times, expected 1`,
      );
    }
    return blocks[0] as T;
  }

  /** Like {@link System.blockNamed}, but returns `undefined` when absent. */
  blockNamedOptional<T extends Block>(blockName: string): T | undefined {
    const blocks = this.allBlocks().filter((block) =>
      block.blockName === blockName
    );
    if (blocks.length === 0) {
      return undefined;
    }
    if (blocks.length !== 1) {
      throw new Error(
        `Block ${blockName} found ${blocks.length} times, expected 1`,
      );
    }
    return blocks[0] as T;
  }

  /** True when a block with the stable `blockName` is registered. */
  hasBlockNamed(blockName: string): boolean {
    return this.allBlocks().some((block) => block.blockName === blockName);
  }

  /**
   * Register a context value implementing one or more {@link ICtxKey} keys.
   * Later calls to {@link System.getContext} retrieve it by key. See
   * {@link https://docs.yolm.io/ui/ictx | ICtx}.
   */
  addContext(value: ContextInstance) {
    for (const key of value.implementICtxs) {
      this.#context.set(key, value);
    }
  }

  /**
   * Resolve a context value for `key`. Throws if no value has been
   * registered via {@link System.addContext}.
   */
  getContext<T>(key: ICtxKey<T>): T {
    const value = this.#context.get(key);
    if (value === undefined) {
      throw new Error(
        `Tried to get ictx \`${key.name}\` but it was not found.`,
      );
    }
    return value;
  }

  /** Like {@link System.getContext} but returns `undefined` instead of throwing. */
  getContextOptional<T>(key: ICtxKey<T>): T | undefined {
    return this.#context.get(key);
  }

  /**
   * The api currently being defined by an enclosing {@link System.api} call,
   * or `undefined` outside such a call.
   */
  get currentApi() {
    if (typeof this.currentApiIdx === "number") {
      return this.apis[this.currentApiIdx];
    }
    return undefined;
  }

  /** Like {@link System.currentApi} but throws if there is no current api. */
  getCurrentApi() {
    const api = this.currentApi;
    if (!api) {
      throw new Error("No current api");
    }
    return api;
  }

  /**
       Defines a new scalar function in the system, this is defined at the root level and does not have access to the database.

       @param f Content of the function
       */
  scalarFunction(f: HelperScalarFunction) {
    this.scalarFunctions[f.name] = scalarFunctionFromHelper(f);
  }

  /**
   * Register a scheduled procedure. `schedule` is a cron expression (or
   * array of cron expressions) and runs in {@link System.timezone}. If
   * `props.name` is omitted the caller file stem is used; if both are
   * present the final name is `"{fileStem}/{props.name}"`. See
   * {@link https://docs.yolm.io/concepts/scheduled_jobs | Scheduled jobs}.
   */
  scheduledProc(props: {
    /** Procedure name. Defaults to the caller file stem. */
    name?: string;
    /** Cron expression or list of expressions. */
    schedule: string | string[];
    /** Optional human-readable description. */
    description?: string;
    /** Statements to run on each scheduled tick. */
    procedure: GeneralServerStatementsOrFn;
  }) {
    const fileStem = getCallerFileStem();
    let name: string;
    if (props.name) {
      name = fileStem ? `${fileStem}/${props.name}` : props.name;
    } else if (fileStem) {
      name = fileStem;
    } else {
      throw new Error(
        "scheduledProc(): could not derive name from filename. Please provide name explicitly.",
      );
    }
    this.scheduledProcedures.push({
      schedules: typeof props.schedule === "string"
        ? [props.schedule]
        : props.schedule,
      procedure: GeneralServerStatements.normalizeToArray(props.procedure),
      name,
      description: props.description,
    });
  }

  /**
   * Register a stored procedure callable from other procedures, endpoints,
   * and scheduled jobs. The procedure name defaults to the caller file
   * stem. See {@link StoredProcedureOpts}.
   */
  private registerStoredProcedure(props: StoredProcedureRegistration) {
    const fileStem = getCallerFileStem();
    let name: string;
    if (props.name) {
      name = props.name;
    } else if (fileStem) {
      name = fileStem;
    } else {
      throw new Error(
        "storedProcedure(): could not derive name from filename. Please provide name explicitly.",
      );
    }
    this.storedProcedures.push({
      name,
      transaction: props.transaction ?? "caller",
      ...(props.invocationKind === undefined
        ? {}
        : { invocationKind: props.invocationKind }),
      inputScalars: normalizeStoredProcedureScalarFields(props.inputScalars),
      inputRecords: normalizeStoredProcedureFieldSets(props.inputRecords),
      inputTables: normalizeStoredProcedureFieldSets(props.inputTables),
      outputScalars: normalizeStoredProcedureScalarFields(props.outputScalars),
      outputRecords: normalizeStoredProcedureFieldSets(props.outputRecords),
      outputTables: normalizeStoredProcedureFieldSets(props.outputTables),
      procedure: GeneralServerStatements.normalizeToArray(props.procedure),
    });
  }

  storedProcedure(props: StoredProcedureOpts) {
    this.registerStoredProcedure(props);
  }

  /**
   * Register a standalone procedure as a JavaScript tool entry and return its
   * opaque binding reference. The private reference brand prevents normal TS
   * callers from registering an unrelated ordinary procedure as a tool.
   */
  toolEntryProcedure(props: ToolEntryStoredProcedureOpts): ProcedureToolRef {
    if (!props.name) {
      throw new Error(
        "toolEntryProcedure requires an explicit stable procedure name.",
      );
    }
    this.registerStoredProcedure({ ...props, invocationKind: "toolEntry" });
    return { procedure: props.name } as ProcedureToolRef;
  }

  /**
   * Registers the outbox_status enum (if not already registered) and creates
   * a `{name}_outbox` table with standard outbox columns plus user-defined fields.
   * Call this in core.tsx.
   */
  outboxTable(opts: OutboxTableOpts) {
    if (this.isGlobalsLocked) {
      throw new Error(
        `Cannot modify database schema after core.tsx execution. Tried to add outbox table '${opts.name}'`,
      );
    }
    // Register the shared enum once
    if (!this.enums["outbox_status"]) {
      this.enum_({
        name: "outbox_status",
        values: ["pending", "sending", "sent", "failed"],
        disableDisplayFn: true,
      });
    }
    const tableName = `${opts.name}_outbox`;
    this.db.table(tableName, (table) => {
      table.enum("status", "outbox_status").notNull().default(sql.lit`pending`);
      table.uuid("idempotency_key").notNull().default(sql`gen_random_uuid()`);
      table.tinyUint("retry_count").notNull().default(0);
      table.timestampTz("created_at").notNull().default(sql`now()`);
      table.timestampTz("attempted_at");
      table.timestampTz("completed_at");
      table.timestampTz("retry_after");
      table.string("error", 2000);
      if (opts.fields) {
        opts.fields(table);
      }
    });
    this.outboxTables.set(opts.name, { tableName, userFields: [] });
    return { tableName, name: opts.name };
  }

  /**
   * Like outboxTable but auto-adds `provider_message_id` column.
   * Add `recipient_email` yourself in fields if you want to store it;
   * otherwise derive the recipient at send time in the reactor.
   */
  emailOutboxTable(opts: OutboxTableOpts) {
    return this.outboxTable({
      ...opts,
      fields: (table) => {
        table.string("provider_message_id", 200);
        if (opts.fields) opts.fields(table);
      },
    });
  }

  /**
   * Like outboxTable but auto-adds `provider_message_id` column.
   * Add `recipient_phone` yourself in fields if you want to store it;
   * otherwise derive the recipient at send time in the reactor.
   */
  smsOutboxTable(opts: OutboxTableOpts) {
    return this.outboxTable({
      ...opts,
      fields: (table) => {
        table.string("provider_message_id", 200);
        if (opts.fields) opts.fields(table);
      },
    });
  }

  /**
   * Creates a PerRecord reactor that processes outbox entries with a
   * claim/execute/record pattern. Call this in a reactor file.
   *
   * The procedure receives `onError` and `onSuccess` callbacks that the user
   * invokes to signal the outcome.
   */
  outboxReactor(opts: OutboxReactorOpts) {
    const tableName = `${opts.name}_outbox`;
    const maxRetries = opts.maxRetries ?? 3;
    const crashTimeout = opts.crashTimeout ?? "10 minutes";
    const backoffExpr = typeof opts.retryBackoff === "function"
      ? opts.retryBackoff(sql`outbox.retry_count`)
      : sql`interval '${sql(opts.retryBackoff ?? "5 minutes")}'`;

    this.addReactor({
      name: `${opts.name}_outbox_executor`,
      query: sql`
        select * from db.${sql(tableName)}
        where (status = 'pending' and (retry_after is null or retry_after <= now()))
           or (status = 'sending' and attempted_at < now() - interval '${
        sql(crashTimeout)
      }')
      `,
      recordName: "outbox",
      maxConcurrent: opts.maxConcurrent ?? 5,
      procedure: (s) => {
        // Phase 1: CLAIM
        s.startTransaction();
        s.modify(sql`
          update db.${sql(tableName)}
          set status = 'sending', attempted_at = now()
          where id = outbox.id
        `);
        s.commitTransaction();

        // Phase 2: EXECUTE — user procedure calls onError or onSuccess
        const onError = (es: GeneralServerStatements, errorMessage?: Sql) => {
          const errExpr = errorMessage ?? sql`null`;
          es.if(sql`outbox.retry_count + 1 >= ${maxRetries}`, (es) => {
            es.modify(sql`
              update db.${sql(tableName)}
              set status = 'failed',
                  retry_count = retry_count + 1,
                  error = ${errExpr}
              where id = outbox.id
            `);
          });
          es.else((es) => {
            es.modify(sql`
              update db.${sql(tableName)}
              set status = 'pending',
                  retry_count = retry_count + 1,
                  retry_after = now() + ${backoffExpr},
                  error = ${errExpr}
              where id = outbox.id
            `);
          });
          if (opts.onError) opts.onError(es);
        };

        const onSuccess = (es: GeneralServerStatements) => {
          es.modify(sql`
            update db.${sql(tableName)}
            set status = 'sent', completed_at = now()
            where id = outbox.id
          `);
          if (opts.onSuccess) opts.onSuccess(es);
        };

        opts.procedure(s, onError, onSuccess);
      },
    });
  }

  /**
   * Creates an email outbox reactor with setup phase for fetching related data
   * and automatic sendEmail + error handling. Call this in a reactor file.
   */
  emailOutboxReactor(opts: EmailOutboxReactorOpts) {
    const tableName = `${opts.name}_outbox`;
    const maxRetries = opts.maxRetries ?? 3;
    const crashTimeout = opts.crashTimeout ?? "10 minutes";
    const backoffExpr = typeof opts.retryBackoff === "function"
      ? opts.retryBackoff(sql`outbox.retry_count`)
      : sql`interval '${sql(opts.retryBackoff ?? "5 minutes")}'`;

    this.addReactor({
      name: `${opts.name}_outbox_executor`,
      query: sql`
        select * from db.${sql(tableName)}
        where (status = 'pending' and (retry_after is null or retry_after <= now()))
           or (status = 'sending' and attempted_at < now() - interval '${
        sql(crashTimeout)
      }')
      `,
      recordName: "outbox",
      maxConcurrent: opts.maxConcurrent ?? 5,
      procedure: (s) => {
        // Phase 1: CLAIM
        s.startTransaction();
        s.modify(sql`
          update db.${sql(tableName)}
          set status = 'sending', attempted_at = now()
          where id = outbox.id
        `);
        s.commitTransaction();

        // Setup: fetch related data
        if (opts.setup) opts.setup(s);

        // Phase 2: EXECUTE — sendEmail
        s.sendEmail({
          from: opts.from,
          to: opts.to ?? sql`outbox.recipient_email`,
          subject: opts.subject,
          htmlBody: opts.htmlBody,
          textBody: opts.textBody,
          cc: opts.cc,
          bcc: opts.bcc,
          replyTo: opts.replyTo,
          tag: opts.tag,
          messageStream: opts.messageStream,
          attachments: opts.attachments,
          idempotencyKey: sql`outbox.idempotency_key`,
          resultJsonScalar: "__outbox_email_result",
          errorJsonScalar: "__outbox_email_error",
          mockProcedure: opts.mockProcedure,
        });

        // Phase 3: CHECK & RECORD
        s.if(sql`__outbox_email_error is not null`, (s) => {
          s.startTransaction();
          s.if(sql`outbox.retry_count + 1 >= ${maxRetries}`, (s) => {
            s.modify(sql`
              update db.${sql(tableName)}
              set status = 'failed',
                  retry_count = retry_count + 1,
                  error = __outbox_email_error->>'message'
              where id = outbox.id
            `);
          });
          s.else((s) => {
            s.modify(sql`
              update db.${sql(tableName)}
              set status = 'pending',
                  retry_count = retry_count + 1,
                  retry_after = now() + ${backoffExpr},
                  error = __outbox_email_error->>'message'
              where id = outbox.id
            `);
          });
          if (opts.onError) opts.onError(s);
          s.commitTransaction();
          s.return();
        });

        // SUCCESS
        s.startTransaction();
        s.modify(sql`
          update db.${sql(tableName)}
          set status = 'sent',
              completed_at = now(),
              provider_message_id = __outbox_email_result->>'MessageID'
          where id = outbox.id
        `);
        if (opts.onSuccess) opts.onSuccess(s);
        s.commitTransaction();
      },
    });
  }

  /**
   * Creates an SMS outbox reactor with setup phase and automatic sendSms + error handling.
   */
  smsOutboxReactor(opts: SmsOutboxReactorOpts) {
    const tableName = `${opts.name}_outbox`;
    const maxRetries = opts.maxRetries ?? 3;
    const crashTimeout = opts.crashTimeout ?? "10 minutes";
    const backoffExpr = typeof opts.retryBackoff === "function"
      ? opts.retryBackoff(sql`outbox.retry_count`)
      : sql`interval '${sql(opts.retryBackoff ?? "5 minutes")}'`;

    this.addReactor({
      name: `${opts.name}_outbox_executor`,
      query: sql`
        select * from db.${sql(tableName)}
        where (status = 'pending' and (retry_after is null or retry_after <= now()))
           or (status = 'sending' and attempted_at < now() - interval '${
        sql(crashTimeout)
      }')
      `,
      recordName: "outbox",
      maxConcurrent: opts.maxConcurrent ?? 5,
      procedure: (s) => {
        // Phase 1: CLAIM
        s.startTransaction();
        s.modify(sql`
          update db.${sql(tableName)}
          set status = 'sending', attempted_at = now()
          where id = outbox.id
        `);
        s.commitTransaction();

        // Setup
        if (opts.setup) opts.setup(s);

        // Phase 2: EXECUTE — sendSms
        s.sendSms({
          to: opts.to ?? sql`outbox.recipient_phone`,
          from: opts.from,
          body: opts.body,
          idempotencyKey: sql`outbox.idempotency_key`,
          resultJsonScalar: "__outbox_sms_result",
          errorJsonScalar: "__outbox_sms_error",
          mockProcedure: opts.mockProcedure,
        });

        // Phase 3: CHECK & RECORD
        s.if(sql`__outbox_sms_error is not null`, (s) => {
          s.startTransaction();
          s.if(sql`outbox.retry_count + 1 >= ${maxRetries}`, (s) => {
            s.modify(sql`
              update db.${sql(tableName)}
              set status = 'failed',
                  retry_count = retry_count + 1,
                  error = __outbox_sms_error->>'message'
              where id = outbox.id
            `);
          });
          s.else((s) => {
            s.modify(sql`
              update db.${sql(tableName)}
              set status = 'pending',
                  retry_count = retry_count + 1,
                  retry_after = now() + ${backoffExpr},
                  error = __outbox_sms_error->>'message'
              where id = outbox.id
            `);
          });
          if (opts.onError) opts.onError(s);
          s.commitTransaction();
          s.return();
        });

        // SUCCESS
        s.startTransaction();
        s.modify(sql`
          update db.${sql(tableName)}
          set status = 'sent',
              completed_at = now(),
              provider_message_id = __outbox_sms_result->>'sid'
          where id = outbox.id
        `);
        if (opts.onSuccess) opts.onSuccess(s);
        s.commitTransaction();
      },
    });
  }

  /**
   * Ensure that the data-grid backing tables exist and that `enumNames` are
   * registered as valid data-grid name enum values. Called internally when
   * pages register data grids.
   */
  addDataGridTablesAndEnums(enumNames: string[]) {
    if (system.isGlobalsLocked) {
      throw new Error(
        "Cannot modify database schema after core.tsx execution. Tried to add data grid tables and enums",
      );
    }
    initializeDatagridTables();
    for (const enumName of enumNames) {
      addDatagridNameEnumValue(enumName);
    }
  }

  /**
Wrapper around `scalarFunction` that makes it easy to define a function that is a set of rules.
Rules are basically a decision table, with conditions and an output:
"if condition_1 then output_1 else if condition_2 then output_2 else output_3".
Each row is evaluated in order until one matches and then the output for that row is returned.

@param f Content of the function

@category Function

@examples
[Example](../pages/bulk_merge_import.tsx)

  */
  rulesFunction(f: RulesFunction) {
    //todo: reenable this as soon as we have locally scoped rules functions
    // if (this.isGlobalsLocked) {
    //   throw new Error(`Cannot modify database schema after core.tsx execution. Tried to add rules function '${f.name}'`);
    // }
    const firstRow = f.rules[0];
    firstRow[firstRow.length - 1] = sql`output`;
    this.scalarFunction({
      name: f.name,
      description: f.description,
      parameters: f.parameters,
      returnType: f.returnType,
      procedure: (s) =>
        s
          .scalarDef({
            name: "output",
            type: helperScalarTypeToFieldType(f.returnType),
          })
          .statements(f.setup)
          .evalRules(...f.rules)
          .return(sql`output`),
    });
  }

  /**
       Defines an enum (a set of named values) in the system that can be accessed anywhere.

       @param enum_ Parameters for the enum
       */
  enum_(enum_: HelperEnum) {
    const displayName = system.displayNameConfig.enum(enum_.name);
    const valueDisplayName = enum_.valueDisplayName ??
      system.displayNameConfig.enumValue;
    const values = enum_.values.map((v) => {
      if (typeof v === "string") {
        return { name: v, displayName: valueDisplayName(v) };
      }
      return {
        displayName: valueDisplayName(v.name),
        ...v,
      };
    });
    if (Array.isArray(enum_.withBoolRulesFn)) {
      enum_.withRulesFn = enum_.withRulesFn ?? [];
      for (const f of enum_.withBoolRulesFn) {
        enum_.withRulesFn.push({
          name: f.name,
          outputType: "Bool",
          fields: "trues" in f
            ? f.trues.map((n) => [n, sql.true] as [string, Sql])
            : f.falses.map((n) => [n, sql.false] as [string, Sql]),
          default: "trues" in f ? sql.false : sql.true,
        });
      }
    }
    if (Array.isArray(enum_.withRulesFn)) {
      for (const rfn of enum_.withRulesFn) {
        this.rulesFunction({
          name: rfn.name,
          parameters: [
            {
              name: "value",
              type: { type: "Enum", enum: enum_.name },
            },
          ],
          returnType: rfn.outputType,
          rules: [
            [sql`input.value`, sql`output`],
            ...rfn.fields.map(([field, value]) => [sql.lit(field), value]),
            ...(rfn.default ? [[sql.anyColumnValue, rfn.default]] : []),
          ],
        });
      }
    }
    const valuesObject: Record<string, EnumValue> = {};
    const valuesMap = new Map<string, EnumValue>();
    for (const v of values) {
      valuesObject[v.name] = v;
      valuesMap.set(v.name, v);
    }
    const modelEnum: Enum = {
      blockStack: this.blockStack.slice(),
      name: enum_.name,
      displayName,
      renameFrom: enum_.renameFrom,
      description: enum_.description,
      values: valuesObject,
      valuesMap,
    };
    if (!enum_.disableDisplayFn) {
      modelEnum.getDisplayName = (v) =>
        sql`fn.display_${sql(enum_.name)}(${v})`;
    }
    system.enums[enum_.name] = modelEnum;
    this.#delayedFunctions.push(() => {
      if (!enum_.disableDisplayFn) {
        this.rulesFunction({
          name: `display_${enum_.name}`,
          parameters: [
            {
              name: "value",
              type: { type: "Enum", enum: enum_.name },
            },
          ],
          returnType: "String",
          rules: [
            [sql`input.value`, sql`output`],
            ...Object.entries(modelEnum.values).map(
              ([name, value]) =>
                [sql.lit(name), sql.lit(value.displayName)] as [Sql, Sql],
            ),
          ],
        });
      }
    });
  }

  /**
   * Add a single variant to an existing enum. Most often used by blocks
   * that extend an enum defined by another block. Schema-locked: must be
   * called before `core.tsx` finishes executing.
   */
  addVariantToEnum(enumName: string, variant: HelperEnumValue | string) {
    if (system.isGlobalsLocked) {
      throw new Error(
        `Cannot add variant to enum after core.tsx execution. Tried to add variant '${variant}' to enum '${enumName}'`,
      );
    }
    const value = typeof variant === "string"
      ? {
        name: variant,
        displayName: system.displayNameConfig.enumValue(variant),
      }
      : {
        displayName: system.displayNameConfig.enumValue(variant.name),
        ...variant,
      };
    this.enums[enumName].values[value.name] = value;
    this.enums[enumName].valuesMap.set(value.name, value);
  }

  /**
   * Declare a static webhook — an endpoint defined in code (not configured
   * by a user) that runs `procedure` when called. See {@link StaticWebhook}.
   */
  staticWebhook(webhook: StaticWebhook) {
    this.staticWebhooks.push(webhook);
  }

  /**
   * Register a new app, or update the in-flight app definition for an
   * existing domain. The app's `pages` callback is invoked immediately so
   * pages are gathered during this call. See {@link AppOpts} and
   * {@link https://docs.yolm.io/concepts/apps | Apps}.
   */
  app(opts: AppOpts) {
    if (!opts.domain) {
      const stem = getCallerFileStem();
      if (!stem) {
        throw new Error(
          "app(): could not derive domain from filename. Please provide domain explicitly.",
        );
      }
      opts = { ...opts, domain: stem };
    }
    const app = new App(opts as AppOpts & { domain: string });
    this.renderingApp = app;
    try {
      this.renderingApp.gatherForBlocks();
      this.#apps.push(app);
    } catch (e) {
      console.error("Error in app: ", app.domain);
      if (e instanceof RenderError) {
        console.error("Component stack: ");
        console.error(
          e.componentStack
            .map((f) => {
              return `${f.stackName ?? f.component?.name}`;
            })
            .join("\n> "),
        );
        console.error("Error: ", e.error);
        throw e.error ?? new Error("RenderError had undefined error");
      }
      if (e instanceof GatherError) {
        console.error("Component stack: ");
        console.error(
          e.componentStack
            .map((f) => {
              return `${f.stackName ?? f.component?.name}`;
            })
            .join("\n> "),
        );
        console.error("Error: ", e.error);
        throw e.error ?? new Error("GatherError had undefined error");
      }
      throw e;
    } finally {
      this.renderingApp = undefined;
    }
  }

  /**
   * Define or extend an api at `prefix` on `domain`. Returns the {@link Api} instance so
   * endpoints can be added to it. If `domain` is omitted it defaults to the
   * caller file stem. See {@link https://docs.yolm.io/api/overview | APIs}.
   */
  api(opts: {
    /** URL prefix mounted on the api domain. */
    prefix: string;
    /** Domain to mount the api under. Defaults to the caller file stem. */
    domain?: string;
    /** Alternate domains routed to this api. */
    domainAliases?: string[];
  }) {
    let domain = opts.domain;
    if (!domain) {
      const stem = getCallerFileStem();
      if (!stem) {
        throw new Error(
          "api(): could not derive domain from filename. Please provide domain explicitly.",
        );
      }
      domain = stem;
    }
    const existingApi = this.apis.findIndex((api) =>
      api.domain === domain && api.prefix === opts.prefix
    );
    if (existingApi !== -1) {
      this.currentApiIdx = existingApi;
      return this.apis[this.currentApiIdx];
    }
    this.currentApiIdx = this.apis.length;
    this.apis.push(
      new Api(domain, this, opts.prefix, opts.domainAliases ?? []),
    );
    return this.apis[this.currentApiIdx];
  }

  /** Register one {@link EdgeBuilder}. */
  edge<
    const TDrivers extends Readonly<Record<string, EdgeDriver>> = Record<
      never,
      never
    >,
  >(
    opts: EdgeOpts<TDrivers> = {},
  ): EdgeBuilder<TDrivers> {
    let name = opts.name;
    if (!name) {
      const stem = getCallerFileStem();
      if (!stem) {
        throw new Error(
          "edge(): could not derive name from filename. Please provide name explicitly.",
        );
      }
      name = stem;
    }
    const existing = this.edges.find((edge) => edge.name === name);
    if (existing) {
      throw new Error(`Edge "${name}" was already defined`);
    }
    const edge = new EdgeBuilder(name, opts.drivers);
    this.edges.push(edge);
    return edge;
  }

  /**
   * Run every validator registered via {@link System.addValidation}. Throws
   * if any returns an error message. Called automatically during YOM
   * generation.
   */
  validate() {
    if (this.validations.size === 0) {
      return;
    }
    for (const [name, validation] of this.validations) {
      const error = validation(this);
      if (error) {
        console.error(`System validation failed: ${name}:\n${error}`);
        throw new Error(`System validation failed: ${name}:\n${error}`);
      }
    }
  }

  /**
   * Register a {@link ValidationFn} run during {@link System.validate}.
   * `name` is used to identify the validator in error messages.
   */
  addValidation(name: string, validation: ValidationFn) {
    this.validations.set(name, validation);
  }

  /**
   * Throw if an enum field declares a string-literal default that is not a
   * member of its enum. Computed defaults (anything that is not a simple
   * SQL string literal) are left to the compiler. Runs during
   * {@link System.prepareYom}, after all enums and blocks are registered.
   */
  #validateEnumFieldDefaults() {
    for (const table of Object.values(this.db.tables)) {
      for (const field of Object.values(table.fields)) {
        if (field.type !== "Enum" || field.default === undefined) {
          continue;
        }
        const literal = extractSimpleSqlStringLiteral(field.default);
        if (literal === undefined) {
          continue;
        }
        const enum_ = this.enums[field.enum];
        if (enum_ === undefined || enum_.valuesMap.has(literal)) {
          continue;
        }
        const values = Array.from(enum_.valuesMap.keys()).join(", ");
        throw new Error(
          `Invalid default '${literal}' for field '${field.name}' on table '${table.name}': ` +
            `enum '${field.enum}' has no such value. Valid values: ${values}`,
        );
      }
    }
  }

  #declareStaticWebhookEndpoints() {
    if (this.staticWebhooks.length === 0) return;
    if (!this.staticWebhookDomain) {
      throw new Error(
        "Please specify a static webhook domain if you have static webhooks",
      );
    }
    const api = this.#staticWebhookApi ?? this.api({
      prefix: "/api",
      domain: this.staticWebhookDomain,
    });
    this.#staticWebhookApi = api;
    for (
      const webhook of this.staticWebhooks.slice(
        this.#declaredStaticWebhookCount,
      )
    ) {
      api.post(`/static_webhook/${webhook.key}`, {
        jsonBodyScalar: webhook.jsonBodyScalar,
        textBodyScalar: webhook.textBodyScalar,
        procedure: webhook.handler,
        query: webhook.query,
      });
    }
    this.#declaredStaticWebhookCount = this.staticWebhooks.length;
  }

  #emitPendingStaticWebhookEndpoints() {
    this.#declareStaticWebhookEndpoints();
    if (
      this.#staticWebhookApi &&
      this.#emittedStaticWebhookCount < this.#declaredStaticWebhookCount
    ) {
      this.#staticWebhookApi.generateYom2();
      this.#emittedStaticWebhookCount = this.#declaredStaticWebhookCount;
    }
  }

  /**
   * Build the per-app YOM representations and finalize static webhook
   * endpoint declarations. Called internally by {@link System.generateYom}.
   */
  prepareYom(): yom.App[] {
    for (const block of this.#blocks.values()) {
      for (const f of block) {
        f.populate?.();
      }
    }
    for (const { table, block } of this.allTableBlocks) {
      block.populate?.(table);
    }
    const apps: yom.App[] = [];
    for (const app of this.#apps) {
      this.renderingApp = app;
      try {
        apps.push(app.generateYom());
      } catch (e) {
        console.error("Error in app: ", app.domain);
        if (e instanceof RenderError) {
          console.error("Component stack: ");
          console.error(
            e.componentStack
              .map((f) => {
                return `${f.stackName ?? f.component?.name}`;
              })
              .join("\n> "),
          );
          console.error("Error: ", e.error);
          throw e.error ?? new Error("RenderError had undefined error");
        }
        if (e instanceof GatherError) {
          console.error("Component stack: ");
          console.error(
            e.componentStack
              .map((f) => {
                return `${f.stackName ?? f.component?.name}`;
              })
              .join("\n> "),
          );
          console.error("Error: ", e.error);
          throw e.error ?? new Error("GatherError had undefined error");
        }
        throw e;
      } finally {
        this.renderingApp = undefined;
      }
    }
    // try {
    //   Deno.writeTextFileSync(
    //     "apps.json",
    //     JSON.stringify( apps)
    //   );
    // } catch (err) {
    //   console.error("Failed to write apps.json:", err);
    // }
    for (const fn of this.#delayedFunctions) {
      fn();
    }
    this.#validateEnumFieldDefaults();
    this.validate();
    for (const block of this.#blocks.values()) {
      for (const f of block) {
        f.validate?.();
      }
    }
    for (const { table, block } of this.allTableBlocks) {
      block.validate?.(table);
    }
    this.#declareStaticWebhookEndpoints();
    return apps;
  }

  /**
   * Generate the full YOM representation of this system: db, apps, edges,
   * enums, scalar functions, procedures, pipelines, reactors, transforms,
   * benchmarks, and tests. This is the main entry point used by the Yolm
   * CLI; application code rarely calls it directly.
   */
  generateYom(): yom.System {
    const apps = this.prepareYom();
    const edges = [...this.edges].sort((a, b) => a.name.localeCompare(b.name))
      .map((edge) => edge.generateYom());
    return {
      locale: this.locale,
      timezone: this.timezone,
      collation: this.collation,
      db: this.db.generateYom(),
      scalarFunctions: Object.values(this.scalarFunctions).map(
        generateScalarFunction,
      ),
      enums: Object.values(this.enums).map((sql) => ({
        name: sql.name,
        renameFrom: sql.renameFrom,
        description: sql.description,
        values: Array.from(sql.valuesMap.values()).map((v) => ({
          name: v.name,
          renameFrom: v.renameFrom,
          description: v.description,
        })),
      })),
      apps,
      apis: this.apis.sort((a, b) => a.domain.localeCompare(b.domain)).map((
        api,
      ) => api.generateYom()),
      test: this.test.generateYom(),
      storedProcedures: this.storedProcedures,
      scheduledProcedures: this.scheduledProcedures.map(
        generateScheduledProcedure,
      ),
      reactors: this.reactors,
      transforms: this.transforms,
      internalBenchmarks: this.benchmarks,
      pipelines: this.pipelines,
      edges,
      globalEndpoints: this.globalApi.generateYom().sort((a, b) =>
        a.path.localeCompare(b.path)
      ),
      typstTemplates: this.typstTemplates,
      dynamicRuntime: this.#dynamicRuntimeYom(),
    };
  }

  #dynamicRuntimeYom(): yom.DynamicRuntime | undefined {
    if (Object.keys(this.blockMetadata).length === 0) return undefined;
    return {
      blockMetadata: this.blockMetadata,
    };
  }

  #emitDynamicRuntimeMetadata() {
    for (const [key, value] of Object.entries(this.blockMetadata)) {
      YolmGenApi.setDynamicBlockMetadata(key, value);
    }
  }

  /**
   * Streaming variant of {@link System.generateYom} that incrementally pushes
   * generated YOM into the Rust generator via {@link YolmGenApi}. Used when
   * the CLI runs with the JIT generator. Application code should not need
   * to call this directly.
   */
  generateYom2() {
    YolmGenApi.printElapsedTime("Generating Yom - new version");
    const apps = this.prepareYom();
    //YolmGenApi.writeSystemTextFile("apps2.json", JSON.stringify(apps));
    YolmGenApi.printElapsedTime(
      "Generated YOM for apps and prepared rest of system",
    );
    YolmGenApi.createSystem(
      this.timezone,
      this.locale,
      this.collation,
    );
    this.#emitDynamicRuntimeMetadata();
    YolmGenApi.printElapsedTime("Created system");
    this.db.generateYom2();
    YolmGenApi.printElapsedTime("Generated YOM for db");
    for (const scalarFunction of Object.values(this.scalarFunctions)) {
      const fn = generateScalarFunction(scalarFunction);
      YolmGenApi.addScalarFunction(fn);
    }
    for (const enum_ of Object.values(this.enums)) {
      YolmGenApi.addEnum({
        name: enum_.name,
        renameFrom: enum_.renameFrom,
        values: Array.from(enum_.valuesMap.values()).map((v) => ({
          name: v.name,
          renameFrom: v.renameFrom,
          description: v.description,
        })),
      });
    }
    for (const app of apps) {
      YolmGenApi.addApp(app);
      YolmGenApi.printElapsedTime(`Added app: ${app.domain}`);
    }
    YolmGenApi.printElapsedTime("Added apps");
    // Sort APIs by domain to ensure deterministic order
    this.apis.sort((a, b) => a.domain.localeCompare(b.domain));
    this.apis.map((api) => api.generateYom2());
    YolmGenApi.printElapsedTime("Generated YOM for apis");
    this.test.generateYom2();
    YolmGenApi.printElapsedTime("Generated YOM for test");
    this.storedProcedures.forEach((proc) => {
      YolmGenApi.addStoredProcedure(proc);
    });
    this.scheduledProcedures.forEach((proc) => {
      YolmGenApi.addScheduledProcedure(generateScheduledProcedure(proc));
    });
    // Sort global endpoints by path for deterministic order
    const globalEndpoints = this.globalApi.getEndpoints();
    globalEndpoints.sort((a, b) => a.path.localeCompare(b.path));
    globalEndpoints.forEach((endpoint) => {
      YolmGenApi.addGlobalApiEndpoint(endpoint);
    });
    [...this.edges].sort((a, b) => a.name.localeCompare(b.name)).forEach((
      edge,
    ) => {
      YolmGenApi.addEdge(edge.generateYom());
    });
    this.typstTemplates.forEach((template) => {
      YolmGenApi.addTypstTemplate(template);
    });
    this.reactors.forEach((reactor) => {
      YolmGenApi.addReactor(reactor);
    });
    this.pipelines.forEach((pipeline) => {
      YolmGenApi.addPipeline(pipeline);
    });
    this.transforms.forEach((transform) => {
      YolmGenApi.addTransform(transform);
    });
    this.publishSystemDocs();
    YolmGenApi.printElapsedTime("Finished generating YOM");
  }

  /**
   * Generate core/global definitions after core.tsx.
   * This creates the system, db (tables, views, scalar functions), enums, and global scalar functions.
   * Call this after importing core.tsx to establish the global state before parallel app execution.
   */
  generateCore() {
    // Call populate on blocks (needed for tables to be ready)
    for (const block of this.#blocks.values()) {
      for (const f of block) {
        f.populate?.();
      }
    }
    for (const { table, block } of this.allTableBlocks) {
      block.populate?.(table);
    }
    for (const fn of this.#delayedFunctions) {
      fn();
    }
    this.#validateEnumFieldDefaults();
    YolmGenApi.createSystem(
      this.timezone,
      this.locale,
      this.collation,
    );
    this.#emitDynamicRuntimeMetadata();
    this.db.generateYom2();
    for (const scalarFunction of Object.values(this.scalarFunctions)) {
      const fn = generateScalarFunction(scalarFunction);
      YolmGenApi.addScalarFunction(fn);
    }
    for (const enum_ of Object.values(this.enums)) {
      YolmGenApi.addEnum({
        name: enum_.name,
        renameFrom: enum_.renameFrom,
        values: Array.from(enum_.valuesMap.values()).map((v) => ({
          name: v.name,
          renameFrom: v.renameFrom,
          description: v.description,
        })),
      });
    }
    this.#emitPendingStaticWebhookEndpoints();
    // Compile the database to make analyzeQuery() available in app files
    YolmGenApi.compileDatabase();
    // Record which scalar functions were defined in core.tsx
    // so we can detect new ones added in app files during generatePartial()
    this.#coreScalarFunctionNames = new Set(Object.keys(this.scalarFunctions));
  }

  /**
   * Stream the remaining YOM (apps, apis, procedures, edges, etc.) to the
   * Rust generator after {@link System.generateCore} has been called. Used
   * by the JIT generator to incrementally compile app code after core.
   */
  generatePartial(options: GeneratePartialOptions = {}) {
    const includeApps = options.apps ?? true;
    const includeApis = options.apis ?? true;
    const includeScheduled = options.scheduled ?? true;
    const includeProcedures = options.procedures ?? true;
    const includeTests = options.tests ?? true;
    const includeReactors = options.reactors ?? true;
    const includeEdges = options.edges ?? true;
    const includePipelines = options.pipelines ?? true;
    const includeTransforms = options.transforms ?? true;

    // Render registered apps
    const apps: yom.App[] = [];
    if (includeApps) {
      for (const app of this.#apps) {
        this.renderingApp = app;
        try {
          apps.push(app.generateYom());
        } catch (e) {
          console.error("Error in app: ", app.domain);
          if (e instanceof RenderError) {
            console.error("Component stack: ");
            console.error(
              e.componentStack
                .map((f) => {
                  return `${f.stackName ?? f.component?.name}`;
                })
                .join("\n> "),
            );
            console.error("Error: ", e.error);
            throw e.error ?? new Error("RenderError had undefined error");
          }
          if (e instanceof GatherError) {
            console.error("Component stack: ");
            console.error(
              e.componentStack
                .map((f) => {
                  return `${f.stackName ?? f.component?.name}`;
                })
                .join("\n> "),
            );
            console.error("Error: ", e.error);
            throw e.error ?? new Error("GatherError had undefined error");
          }
          throw e;
        } finally {
          this.renderingApp = undefined;
        }
      }
    }
    for (const app of apps) {
      YolmGenApi.addApp(app);
    }
    this.#emitDynamicRuntimeMetadata();
    this.#emitPendingStaticWebhookEndpoints();
    // APIs
    if (includeApis) {
      this.apis.sort((a, b) => a.domain.localeCompare(b.domain));
      this.apis.filter((api) => api !== this.#staticWebhookApi).map((api) =>
        api.generateYom2()
      );
    }
    // Tests
    if (includeTests) {
      this.test.generateYom2();
    }
    // Stored and scheduled procedures
    if (includeProcedures) {
      this.storedProcedures.forEach((proc) => {
        YolmGenApi.addStoredProcedure(proc);
      });
    }
    if (includeScheduled) {
      this.scheduledProcedures.forEach((proc) => {
        YolmGenApi.addScheduledProcedure(generateScheduledProcedure(proc));
      });
    }
    // Global endpoints
    if (includeApis) {
      const globalEndpoints = this.globalApi.getEndpoints();
      globalEndpoints.sort((a, b) => a.path.localeCompare(b.path));
      globalEndpoints.forEach((endpoint) => {
        YolmGenApi.addGlobalApiEndpoint(endpoint);
      });
    }
    if (includeEdges) {
      [...this.edges].sort((a, b) => a.name.localeCompare(b.name)).forEach((
        edge,
      ) => {
        YolmGenApi.addEdge(edge.generateYom());
      });
    }
    // Typst
    this.typstTemplates.forEach((template) => {
      YolmGenApi.addTypstTemplate(template);
    });
    // Reactors, pipelines, and transforms
    if (includeReactors) {
      this.reactors.forEach((reactor) => {
        YolmGenApi.addReactor(reactor);
      });
    }
    if (includePipelines) {
      this.pipelines.forEach((pipeline) => {
        YolmGenApi.addPipeline(pipeline);
      });
    }
    if (includeTransforms) {
      this.transforms.forEach((transform) => {
        YolmGenApi.addTransform(transform);
      });
    }
    // Add scalar functions that were defined in app files (not in core.tsx)
    // These will be merged with core scalar functions
    if (this.#coreScalarFunctionNames) {
      for (
        const [name, scalarFunction] of Object.entries(this.scalarFunctions)
      ) {
        if (!this.#coreScalarFunctionNames.has(name)) {
          const fn = generateScalarFunction(scalarFunction);
          YolmGenApi.addScalarFunction(fn);
        }
      }
    }
    if (
      includeApps &&
      includeApis &&
      includeScheduled &&
      includeProcedures &&
      includeTests &&
      includeReactors &&
      includeEdges &&
      includePipelines &&
      includeTransforms
    ) {
      this.publishSystemDocs();
    }
  }

  private publishSystemDocs() {
    YolmGenApi.setSystemDocs(JSON.stringify(this.generateDocs()));
  }

  /**
   * Produce structured documentation for every system enum (excluding
   * internal datagrid enums). Used by docs tooling and Studio.
   */
  generateEnumDocs(): EnumDoc[] {
    const has_enums = Object.values(this.enums).length !== 0;
    if (!has_enums) {
      return [];
    }
    const enumDocs: EnumDoc[] = [];

    const sortedEnums = Object.keys(this.enums).sort();
    for (const enumName of sortedEnums) {
      if (enumName === "datagrid_name" || enumName === "dg_filter_op") {
        continue;
      }
      const enumValues: EnumValueDoc[] = [];
      const enum_ = this.enums[enumName];
      for (const value of Object.values(enum_.values)) {
        enumValues.push({
          name: value.name,
          displayName: value.displayName,
          description: value.description,
        });
      }
      const enumDoc: EnumDoc = {
        name: enumName,
        values: enumValues,
      };
      enumDocs.push(enumDoc);
    }
    return enumDocs;
  }

  /**
   * Produce structured documentation for every block (system-level and
   * table-level), including which tables each block defined.
   */
  generateBlockDocs(): BlockDoc[] {
    const blockDocs: BlockDoc[] = [];
    const uniqueBlocks = new Set<Block>();
    const sortedTables = Object.keys(this.db.tables).sort();
    const tableBlocks: Record<string, string | undefined> = {};
    for (const tableName of sortedTables) {
      const table = this.db.tables[tableName];
      let fromBlock: string | undefined;
      if (table.blockStack && table.blockStack.length > 0) {
        fromBlock = table.blockStack[0]?.block?.blockName;
      }
      tableBlocks[tableName] = fromBlock;
    }
    for (const blockList of this.#blocks.values()) {
      for (const block of blockList) {
        uniqueBlocks.add(block);
      }
    }
    for (const block of uniqueBlocks) {
      blockDocs.push({
        name: block.blockName,
        definedByBlock: block.definedByBlock,
        tablesDefined: Object.keys(tableBlocks).filter(
          (tableName) =>
            tableBlocks[tableName] === block.blockName &&
            tableBlocks[tableName] !== undefined,
        ),
        componentDependencies: block.componentDependencies,
        description: block.description,
      });
    }
    return blockDocs;
  }

  /**
   * Produce structured documentation describing the whole system: apps,
   * enums, tables, blocks, views, procedures, scheduled jobs, global api,
   * and decision tables. Used by docs tooling and Studio.
   */
  generateDocs(): SystemDoc {
    function normalizePages(app: App) {
      const normalizedPages: {
        label: string;
        path: string;
        source: string;
      }[] = [];
      for (const item of app.sharedContext(PagesSharedContext).pages) {
        if (!normalizedPages.some((page) => page.path === item.path)) {
          normalizedPages.push({
            ...item,
          });
        }
      }
      return normalizedPages;
    }
    const systemDoc: SystemDoc = {
      apps: this.#apps.map((app) => {
        return {
          domain: app.domain,
          requiredPermission: undefined,
          domainAliases: app.domainAliases,
          navitems: normalizePages(app),
        };
      }),
      apis: [...this.apis].sort((a, b) => a.domain.localeCompare(b.domain))
        .map((api) => {
          const apiYom = api.generateYom();
          return {
            domain: apiYom.domain,
            prefix: apiYom.prefix,
            domainAliases: apiYom.domainAliases ?? [],
            endpoints: apiYom.endpoints.map((endpoint) => ({
              method: endpoint.method,
              path: endpoint.path,
            })),
          };
        }),
      enums: this.generateEnumDocs(),
      tables: this.db.generateTableDocs(),
      blocks: this.generateBlockDocs(),
      storedProcedures: this.storedProcedures.map((proc) => ({
        name: proc.name,
        transaction: proc.transaction ?? "caller",
      })),
      scheduledProcedures: this.scheduledProcedures.map((proc) => ({
        name: proc.name,
        schedule: cronToHumanReadable(proc.schedules[0]),
        description: proc.description,
      })),
      globalApi: this.globalApi.generateYom().map((endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
      })),
      views: this.db.generateViewDocs(),
      decisionTables: this.decisionTables,
    };
    return systemDoc;
  }
}

/**
 * Convenience wrapper for {@link System.block}. Returns the single
 * registered instance of `block`, throwing if zero or more than one is
 * registered.
 *
 * See {@link https://docs.yolm.io/concepts/blocks | Blocks}.
 */
export function useBlock<T extends Block>(block: BlockConstructor<T>) {
  return system.block(block);
}

/**
 * Convenience wrapper for {@link System.blockNamed}. Use this from reusable
 * components that support a system-owned subclass of a package block.
 */
export function useBlockNamed<T extends Block>(blockName: string) {
  return system.blockNamed<T>(blockName);
}

/**
 * Like {@link useBlock} but returns `undefined` when the block has not been
 * registered. Throws if more than one instance exists.
 */
export function useBlockOptional<T extends Block>(block: BlockConstructor<T>) {
  return system.blockOptional(block);
}

/** Describes a single external-service option exposed by a {@link Block}. */
export interface BlockExternalServiceOption {
  /** Stable key referenced in code. */
  optionKey: string;
  /** Human-readable label shown to integrators. */
  optionLabel: string;
}

/**
 * Interface implemented by system-level blocks. Blocks package schema,
 * logic, and UI together; register them via {@link System.addBlock}.
 *
 * See {@link https://docs.yolm.io/concepts/blocks | Blocks}.
 */
export interface Block {
  /** Stable identifier for the block. */
  blockName: string;
  /** Human-readable name for documentation. */
  blockDisplayName?: string;
  /** Name of the block that this block was defined inside, if any. */
  definedByBlock?: string;
  /** Component dependencies the block expects to be in scope. */
  componentDependencies?: string[];
  /** Free-text description of the block, surfaced in generated docs. */
  description?: string;
  /** External-service hooks the block exposes for integrators. */
  externalServiceOptions?: BlockExternalServiceOption[];
  /** Called once when the block is added to the system. */
  initialize: () => void;
  /** Called after every block has initialized — useful for cross-block wiring. */
  populate?: () => void;
  /** Called during {@link System.validate}. Should throw on misconfiguration. */
  validate?: () => void;
  /** Called before the default sample data is generated. */
  beforeGenerateSampleData?: (
    s: IServerBaseStatements,
    ctx: SampleDataScriptContext,
  ) => void;
  /** Called after the default sample data is generated. */
  afterGenerateSampleData?: (
    s: IServerBaseStatements,
    ctx: SampleDataScriptContext,
  ) => void;
}

/** Parameters describing an inline plan-and-edit operation surfaced to users. */
export interface DoEditWithPlanParams {
  /** Short summary of the planned edit. */
  summary: Sql;
  /** Detailed plan text. */
  plan: Sql;
}

/** Constructor signature for a {@link Block}. */
export type BlockConstructor<T extends Block> = new (...args: any[]) => T;

/**
 * Base class for table-level blocks. A table block packages reusable
 * schema, validation, and UI for a specific table; attach one with
 * `TableBuilder.addBlock(...)`.
 *
 * See {@link https://docs.yolm.io/concepts/blocks | Blocks}.
 */
export abstract class TableBlock<T = EmptyProps> {
  /** Stable identifier for the block (defaults to the class name). */
  public blockName: string;

  constructor(
    /** Name of the table this block is attached to. */
    public parentTableName: string,
    /** Options passed when the block was added. */
    public opts: T,
  ) {
    this.blockName = this.constructor.name;
  }

  /** If true, multiple instances of this block may attach to the same table. */
  allowMultipleInstances = false;
  /** Called once when the block is attached. Adds fields / virtuals to the builder. */
  abstract initialize(table: TableBuilder): void;
  /** Called when the {@link TableBuilder} finalizes into a {@link Table}. */
  finalizeBuilder(_table: Table) {}
  /** Validate the finished table; throw to abort generation. */
  validate(_table: Table) {}
  /** Populate cross-block / cross-table state after every block has initialized. */
  populate(_table: Table) {}

  /** Optional record-page detail tab contributed by this block. */
  getDetailTab(_table: Table):
    | undefined
    | {
      value?: string;
      header: Node;
      content: Node;
    } {
    return undefined;
  }

  /** Contribute columns / behavior to a datagrid built for this table. */
  populateDatagrid(_: DatagridBuilder) {}
}

/** Constructor signature for a {@link TableBlock}. */
export type TableBlockConstructor<T = EmptyProps> = new (
  tableName: string,
  opts: T,
) => TableBlock<T>;

/**
 * One frame in {@link System.blockStack} — tracks whether schema is
 * currently being added by a system-level or table-level block.
 */
export type BlockFrame =
  | {
    type: "table";
    block: TableBlock;
  }
  | {
    type: "system";
    block: Block;
  };

/**
 * A webhook endpoint defined in code (rather than configured by an admin user).
 * Its registration lifecycle is exposed through the static webhook management
 * page via {@link StaticWebhook.register} / {@link StaticWebhook.deregister}.
 */
export interface StaticWebhook {
  /** Stable identifier appended to the public URL. */
  key: string;
  /** Query-string parameters accepted by the webhook. */
  query?: yom.QueryParam[];
  /** Name of the JSON body scalar that the handler should read from. */
  jsonBodyScalar?: string;
  /** Name of the text body scalar that the handler should read from. */
  textBodyScalar?: string;
  /** Api endpoint that will be called when the webhook is triggered. */
  handler: EndpointStatementsOrFn;
  /**
       Registers the webhook with its provider from the admin management page.
       Must be idempotent and can be called multiple times; should store data in the database.

       Url is the url that the endpoint will be listening on.
       */
  register: (url: Sql) => GeneralServerStatementsOrFn;
  /**
       Deregisters the webhook with its provider from the admin management page.
       Must be idempotent and can be called multiple times; should remove data from the database.
       Must also be able to be called even if the webhook is not registered in the first place.
       */
  deregister: GeneralServerStatementsOrFn;
  /**
       If the webhook is already registered, this is used for the admin ui
       */
  webhookRegistered: Sql;
}

/**
 * Build the public URL for a {@link StaticWebhook}. Requires
 * {@link System.staticWebhookDomain} to be set.
 */
export function staticWebhookUrl(webhook: StaticWebhook) {
  return `https://${system.staticWebhookDomain}/api/static_webhook/${webhook.key}`;
}

function defaultGetDisplayName(sqlName: string) {
  return upcaseFirst(normalizeCase(sqlName).join(" "));
}
/** Options for a custom cross-page snackbar mounted by an app. */
export interface CustomCrossPageSnackbarOpts {
  /** Node rendered as the snackbar surface. */
  node: Node;
  /** Optional state procedure run at the snackbar's root state. */
  rootStateProc?: StateStatementsOrFn;
  /** Auto-hide duration in milliseconds. */
  autoHideDuration?: number;
}

/** Wrapper that takes the page tree and returns a decorated tree (e.g. with a sidebar). */
export type Shell = (pages: Node) => Node;

/** Generic constructor type. */
export type Constructor<T> = new (...args: any[]) => T;

/** One directive in a Content-Security-Policy header. */
export interface ContentSecurityPolicyDirective {
  /** CSP directive name (e.g. `"script-src"`). */
  directive: string;
  /** Allowed sources for the directive. */
  sources: string[];
}

/** Allowed values for the `X-Frame-Options` HTTP header. */
export type XFrameOptionsValue = "DENY" | "SAMEORIGIN" | "ALLOW-FROM";

/** Custom `X-Frame-Options` configuration. */
export interface XFrameOptionsDirective {
  /** Header value to emit. */
  value: XFrameOptionsValue;
  /** URI used when `value` is `"ALLOW-FROM"`. */
  uri?: string;
}

/** Default Content-Security-Policy directives applied when {@link SecurityHeadersConfig.contentSecurityPolicy} is `true`. */
export const DEFAULT_CSP_DIRECTIVES: ContentSecurityPolicyDirective[] = [
  { directive: "default-src", sources: ["'self'"] },
  {
    directive: "script-src",
    sources: [
      "'self'",
      "https://yolmcdn.net",
      "https://static.cloudflareinsights.com",
      "'wasm-unsafe-eval'",
    ],
  },
  {
    directive: "style-src",
    sources: [
      "'self'",
      "'unsafe-inline'",
      "https://yolmcdn.net",
    ],
  },
  {
    directive: "img-src",
    sources: ["'self'", "https://yolmcdn.net", "data:"],
  },
  {
    directive: "connect-src",
    sources: [
      "'self'",
      "https://yolmcdn.net",
      "https://yolmglobalapi.com",
    ],
  },
  {
    directive: "font-src",
    sources: ["'self'", "https://yolmcdn.net"],
  },
  { directive: "base-uri", sources: ["'self'"] },
  { directive: "frame-src", sources: ["'self'"] },
  { directive: "form-action", sources: ["'self'"] },
  { directive: "worker-src", sources: ["'self'", "blob:"] },
];

/** Per-app HTTP security header configuration. */
export interface SecurityHeadersConfig {
  /**
       Content Security Policy configuration.
       If true, uses the default policy.
       If false, disables CSP.
       If an object, uses the specified configuration.
       */
  contentSecurityPolicy?:
    | boolean
    | {
      reportOnly?: boolean;
      // Complete set of directives (replaces defaults)
      directives?: ContentSecurityPolicyDirective[];
      // Additional sources to add to specific directives (extends defaults)
      additionalSources?: {
        [directive: string]: string[];
      };
      // Additional sources only included in non-production environments (preview, check, test, transform).
      // Useful for allowing 'unsafe-inline' or 'http:' during local development.
      devAdditionalSources?: {
        [directive: string]: string[];
      };
      reportUri?: string;
    };

  /**
       X-Frame-Options configuration.
       If true, uses the default (SAMEORIGIN).
       If false, disables X-Frame-Options.
       If an object, uses the specified value.
       */
  xFrameOptions?: boolean | XFrameOptionsDirective;
}

/**
 * Options passed to {@link System.app}. See
 * {@link https://docs.yolm.io/concepts/apps | Apps}.
 */
export interface AppOpts {
  /** Primary domain. Defaults to the caller file stem. */
  domain?: string;
  /**
   * Human-readable application name. Used as the root document title and
   * as the default PWA manifest name.
   */
  displayName?: string;
  /** Additional domains routed to this app. */
  domainAliases?: string[];
  /** Document `lang` attribute. */
  lang?: string;
  /** Theme to apply. Defaults to {@link System.defaultTheme}. */
  theme?: ThemeOpts;
  /** Favicon / PWA logo generation strategy. */
  logoGeneration?: LogoGeneration;
  /** Whether queries should refresh on window focus. */
  hasFocusRefresh?: boolean;
  /** How the app chooses between light and dark color schemes. */
  colorSchemeType?: ColorSchemeType;
  /** Extra global stylesheet objects. */
  globalStyles?: StyleObject[];
  /** PWA manifest emitted for the app. */
  webAppManifest?: WebAppManifest;
  /** HTTP endpoints registered with the app. */
  endpoints?: AppEndpoint[];
  /** Static HTTP response headers applied to every app response. */
  headers?: yom.AppHeader[];
  /** Skip loading the default font face / preloads. */
  disableDefaultFontFamily?: boolean;
  /** Global font assets to register for this app in addition to the defaults. */
  fonts?: GlobalFontAssetId[];
  /** Root node for the app's UI. */
  ui: Node;
  /**
       Security headers configuration for the application.
       Allows customizing Content-Security-Policy and X-Frame-Options.
       */
  securityHeaders?: SecurityHeadersConfig;
  /**
       Default is "server".
       If "server", the initial render is done on the server.
       If "client", the initial render is done on the client and it is treated like a SPA. This makes it easier to do offline.

       In both cases, the subsequent navigations are done on the client.
       */
  firstRender?: "server" | "client";
  /**
   * JS modules to include in the app.
   * Default: uses CDN. Set `useAssets: true` for local development.
   *
   * @example
   * jsModules: [
   *   { id: "monaco_editor" },
   *   { id: "file_system", useAssets: true }, // Use local /assets/file_system.js
   * ]
   */
  jsModules?: JsModuleConfig[];
  viewTransitionConfig?: yom.NavigationViewTransitionConfig;
}

/** A single HTTP endpoint registered on an {@link App}. */
export interface AppEndpoint {
  /** URL path (relative to the app domain). */
  path: string;
  /** Query-string parameters accepted by the endpoint. */
  query?: yom.QueryParam[];
  /** Statements run when the endpoint is called. */
  procedure: EndpointStatementsOrFn;
}

class RenderError {
  constructor(
    public readonly error: Error,
    public readonly componentStack: ComponentStackFrame[],
  ) {}
}

class GatherError {
  constructor(
    public readonly error: Error,
    public readonly componentStack: ComponentStackFrame[],
  ) {}
}

interface ComponentStackFrame {
  component: { name?: string };
  stackName?: string;
}

/**
 * How an {@link App} sources its favicon, PWA icons, and theme colors.
 *
 * - `"App"`: use the per-app icons under the app's `assets/` directory.
 * - `"Default"`: use the built-in Yolm icons and colors.
 * - `"Custom"`: skip auto-generated icon tags; the app provides its own.
 */
export type LogoGeneration =
  | {
    type: "App";
    safariPinnedTabColor: string;
    msTileColor: string;
    themeColor: string;
  }
  | { type: "Default" }
  | { type: "Custom" };

type ColorSchemeType = "light" | "dark" | "cookie";

/**
 * A single app within a {@link System}. Represents one domain's UI,
 * endpoints, theme, and per-app context. Created via {@link System.app};
 * application code does not normally instantiate this directly.
 *
 * See {@link https://docs.yolm.io/concepts/apps | Apps}.
 */
export class App {
  /** Primary domain the app is served on. */
  readonly domain: string;
  /** Human-readable application name used by document titles and the PWA manifest. */
  readonly displayName?: string;
  /** Additional domains routed to this app. */
  readonly domainAliases: string[] = [];
  /** Theme used by this app's pages. Falls back to {@link System.defaultTheme}. */
  readonly theme: Theme;
  /** Document language tag (defaults to `"en"`). */
  readonly lang: string;
  /** Whether the app re-runs queries on window focus. */
  readonly hasFocusRefresh: boolean;
  /** How the app chooses between light and dark color schemes. */
  readonly colorSchemeType: ColorSchemeType;
  /** Per-app `<meta>` tags applied to every page. */
  readonly globalHtmlMeta: Record<string, string> = {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    viewport:
      "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
  };
  /** How this app generates favicons / PWA logos. */
  readonly logoGeneration: LogoGeneration;
  /** PWA manifest emitted for this app. */
  readonly webAppManifest?: WebAppManifest;
  /**
       This lets you configure how view transitions are triggered on navigations.
       */
  #navigationViewTransitionConfig: yom.NavigationViewTransitionConfig;
  /** JS modules registered for use in this app. */
  jsModuleConfigs: JsModuleConfig[] = [];

  #context = new Map<ICtxKey<any>, any>();
  #currentComponentContextChanges: {
    key: ICtxKey<any>;
    didExist: boolean;
    prevValue?: any;
  }[] = [];
  #currentComponentWrappers: ((node: Node) => Node)[] = [];
  #renderPhase: "gather" | "render" = "render";
  #globalStyles: StyleObject[] = [];
  #keyframeIdGen = new SequentialIDGenerator();
  #keyFrames: Map<KeyFrames, string> = new Map();
  /** Global nodes added via {@link useGlobalNode}. Keyed by node name. */
  globalNodes: Map<string, [number, Node]> = new Map();
  /** Global states added via {@link useGlobalState}. Keyed by state name. */
  globalStates: Map<string, StatePropsWithoutChildren> = new Map();
  #styleSheet = new StyleSheet(this);
  #uiNode: Node;
  #componentStack: ComponentStackFrame[] = [];
  #endpoints: AppEndpoint[] = [];
  #sharedContexts: Map<any, any> = new Map();
  /** Security headers configuration applied to every response. */
  readonly securityHeaders: SecurityHeadersConfig;
  /** Static HTTP response headers applied to every app response. */
  readonly headers: yom.AppHeader[];
  #disableDefaultFontFamily = false;
  #fontPreloads: GlobalFontPreload[] = [];
  #firstRender: "server" | "client" = "server";

  constructor(opts: AppOpts) {
    this.domain = opts.domain!;
    this.displayName = opts.displayName ?? opts.webAppManifest?.name;
    this.domainAliases = opts.domainAliases ?? [];
    this.theme = opts.theme ? createTheme(opts.theme) : system.defaultTheme;
    this.lang = opts.lang ?? "en";
    this.hasFocusRefresh = opts.hasFocusRefresh ?? true;
    this.colorSchemeType = opts.colorSchemeType ?? "cookie";
    this.#globalStyles = opts.globalStyles ?? [];
    this.logoGeneration = opts.logoGeneration ?? { type: "Default" };
    this.webAppManifest = opts.webAppManifest
      ? {
        ...opts.webAppManifest,
        name: opts.webAppManifest.name ?? this.displayName,
      }
      : {
        display: "minimal-ui",
        name: this.displayName,
      };
    this.#uiNode = opts.ui;
    this.#endpoints = opts.endpoints ?? [];
    this.headers = opts.headers ?? [];
    const fonts = getGlobalFontFaces(
      opts.fonts,
      !opts.disableDefaultFontFamily,
    );
    for (const font of fonts) {
      this.#globalStyles.push({
        "@font-face": {
          fontFamily: font.family,
          fontStyle: font.style,
          fontWeight: font.weight,
          fontDisplay: font.display,
          src: `url('${font.url}') format('${font.format}')`,
        },
      });
    }
    this.#fontPreloads = getGlobalFontPreloads(fonts);
    this.#disableDefaultFontFamily = opts.disableDefaultFontFamily ?? false;
    this.securityHeaders = opts.securityHeaders ?? {
      contentSecurityPolicy: true,
      xFrameOptions: true,
    };
    this.#firstRender = opts.firstRender ?? "server";
    this.jsModuleConfigs = opts.jsModules ?? [];
    this.#navigationViewTransitionConfig = opts.viewTransitionConfig ?? {
      link: {
        timing: "next_and_final",
        type: "a-navigate",
      },
      popstate: {
        timing: "next_and_final",
        backwardType: "backward-navigate",
        forwardType: "forward-navigate",
        otherType: "other-navigate",
      },
      statement: {
        timing: "next_and_final",
        type: "statement-navigate",
      },
    };
  }

  /** Position of this app in {@link System.apps}. */
  get appIndex() {
    return system.appIndex(this);
  }

  /** Print the current component stack to the console. Useful for debugging render errors. */
  logComponentStack() {
    console.log(
      this.#componentStack
        .map((f) => {
          return `${f.stackName ?? f.component?.name}`;
        })
        .join("\n> "),
    );
  }

  /**
   * Reactive watch list used by {@link Data} blocks so that focusing the
   * window re-fetches their queries.
   */
  get focusRefreshWatch() {
    if (this.hasFocusRefresh) {
      return [sql`focus_refresh_key`];
    }
    return [];
  }

  /**
   * Register an HTTP endpoint on this app. `opts` can be a full
   * {@link AppEndpoint} object or a procedure shorthand.
   */
  endpoint(
    path: string,
    opts: Omit<AppEndpoint, "path"> | ((s: EndpointStatements) => void),
  ) {
    if (typeof opts === "function") {
      const statements = new EndpointStatements();
      opts(statements);
      this.#endpoints.push({
        path,
        procedure: statements,
      });
    } else {
      this.#endpoints.push({
        path,
        ...opts,
      });
    }
  }

  /**
   * Get (creating on first access) a shared per-app singleton of `ctor`.
   * Used by pages and blocks to share state that lasts across the whole
   * render of an app.
   */
  sharedContext<T>(ctor: Constructor<T>): T {
    if (!this.#sharedContexts.has(ctor)) {
      this.#sharedContexts.set(ctor, new ctor());
    }
    return this.#sharedContexts.get(ctor)!;
  }

  /**
   * Look up an ICtx value provided higher up in the render tree. Throws if
   * no provider for `key` is in scope.
   */
  getContext<T>(key: ICtxKey<T>): T {
    const value = this.getContextOptional(key);
    if (value === undefined) {
      throw new Error(
        dedent`Component depended on ictx \`${key.name}\` but it was not found.
          Make sure that the ictx is provided higher up in the component tree.  `,
      );
    }
    return value;
  }

  /** Like {@link App.getContext} but returns `undefined` instead of throwing. */
  getContextOptional<T>(key: ICtxKey<T>): T | undefined {
    return this.#context.get(key) ?? system.getContextOptional(key);
  }

  /**
   * Temporarily remove the given ICtx keys for the rest of the current
   * component. The previous values are restored when the component finishes
   * rendering.
   */
  omitICtxs(keys: ICtxKey<any>[]) {
    for (const key of keys) {
      const didExist = this.#context.has(key);
      this.#currentComponentContextChanges.push({
        key,
        didExist,
        prevValue: this.#context.get(key),
      });
      this.#context.delete(key);
    }
  }

  /**
   * Provide an ICtx value for descendants of the current component. The
   * previous value is restored when the component finishes rendering.
   */
  setContext(value: ContextInstance) {
    for (const key of value.implementICtxs) {
      const didExist = this.#context.has(key);
      this.#currentComponentContextChanges.push({
        key,
        didExist,
        prevValue: this.#context.get(key),
      });
      this.#context.set(key, value);
    }
  }

  /**
   * Wrap the current component's rendered output in `wrapper`. Used by
   * decorator-style helpers like form controls and modals.
   */
  wrapCurrentComponent(wrapper: (node: Node) => Node) {
    if (this.#renderPhase === "render") {
      this.#currentComponentWrappers.push(wrapper);
    }
  }

  /**
   * Walk `node`'s children in "gather" mode (no output), exposing any ICtx
   * declarations they make to subsequent siblings. Used by parents that
   * need to see what context their children request without rendering them.
   */
  gatherChildrenContextInfo(node: Node) {
    const prevRenderPhase = this.#renderPhase;
    this.#renderPhase = "gather";
    this.#gatherContextInfo(node);
    this.#renderPhase = prevRenderPhase;
  }

  #gatherContextInfo(node: Node) {
    if (!(node instanceof Element)) {
      return this.#gatherContextInfoInner(node);
    }
    const hasStatementSourceOrigin = pushStatementSourceOrigin(
      elementStatementSourceOrigin(node),
    );
    if (!hasStatementSourceOrigin) {
      return this.#gatherContextInfoInner(node);
    }
    try {
      this.#gatherContextInfoInner(node);
    } finally {
      popStatementSourceOrigin();
    }
  }

  #gatherContextInfoInner(node: Node) {
    try {
      if (
        node === undefined ||
        node === null ||
        node === false ||
        typeof node === "string" ||
        typeof node === "number" ||
        node instanceof Sql
      ) {
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          this.#gatherContextInfo(child);
        }
        return;
      }
      if (node instanceof Element) {
        if (typeof node.type === "function") {
          this.#componentStack.push({
            component: node.type,
            stackName: node.type.getSource?.(node.props),
          });
          try {
            const prevLength = this.#currentComponentContextChanges.length;
            const child = node.type(node.props);
            this.#gatherContextInfo(child);
            this.#undoContextChanges(prevLength);
          } finally {
            this.#componentStack.pop();
          }
          return;
        }
        if (typeof node.type === "string") {
          this.#gatherContextInfo(node.props.children);
          return;
        }
        if (node.type === RouteSymbol) {
          // Parse route path parameters and add them to analyze context
          const pathParams = parseRoutePathParams(node.props.path);
          if (pathParams.length > 0) {
            const parentCtx = this.getContextOptional(AnalyzeQueryLocalICtxKey);
            const analyzeCtx = new AnalyzeQueryLocalCtx(parentCtx);
            for (const param of pathParams) {
              analyzeCtx.addScalar(param.name, param.type, false);
            }
            const routeParamCtx = new RoutePathParamsCtx(
              this.getContextOptional(RoutePathParamsICtxKey),
              pathParams.map((p) => p.name),
            );
            const prevContextLength =
              this.#currentComponentContextChanges.length;
            this.setContext(analyzeCtx);
            this.setContext(routeParamCtx);
            this.#gatherContextInfo(node.props.children);
            this.#undoContextChanges(prevContextLength);
          } else {
            this.#gatherContextInfo(node.props.children);
          }
          return;
        }
        if (node.type === RoutesSymbol) {
          this.#gatherContextInfo(node.props.children);
          return;
        }
        if (node.type === ShowSymbol) {
          if (typeof node.props.when === "boolean") {
            this.#gatherContextInfo(
              node.props.when ? node.props.children : node.props.fallback,
            );
            return;
          }
          this.#gatherContextInfo(node.props.children);
          this.#gatherContextInfo(node.props.fallback);
          return;
        }
        if (node.type === SwitchSymbol) {
          this.#gatherContextInfo(node.props.children);
          return;
        }
        if (node.type === MatchSymbol) {
          this.#gatherContextInfo(node.props.children);
          return;
        }
        if (node.type === EventHandlersSymbol) {
          return;
        }
        if (node.type === StateSymbol) {
          this.#gatherContextInfo(node.props.children);
          return;
        }
        if (node.type === AuthorizeSymbol) {
          this.#gatherContextInfo(node.props.children);
          this.#gatherContextInfo(node.props.unauthorized);
          return;
        }
        if (node.type === QueryParamsSymbol || node.type === SourceMapSymbol) {
          this.#gatherContextInfo(node.props.children);
          return;
        }
        if (node.type === EachSymbol || node.type === RecursiveSymbol) {
          this.#gatherContextInfo(node.props.children);
          return;
        }
        if (
          node.type === RecurseSymbol || node.type === ListenSymbol ||
          node.type === EffectSymbol || node.type === RedirectSymbol ||
          node.type === DynamicNodeSymbol
        ) {
          return;
        }
        if (node.type === DatagridSymbol) {
          const props = node.props as DatagridProps;
          for (const col of props.columns) {
            this.#gatherContextInfo(col.header);
            this.#gatherContextInfo(col.cell);
          }
          return;
        }
        if (node.type === ModeSymbol) {
          this.#gatherContextInfo(node.props.children);
          return;
        }
      }
      console.log(node);
      throw new Error("Unhandled node type in #gatherContextInfo");
    } catch (e) {
      if (e instanceof GatherError) {
        throw e;
      }
      const error = e instanceof Error ? e : new Error(
        e === undefined
          ? `Unknown error (undefined was thrown)\nCaught at: ${
            new Error().stack
          }`
          : String(e),
      );
      throw new GatherError(error, this.#componentStack.slice());
    }
  }

  #undoContextChanges(from: number) {
    for (
      let i = this.#currentComponentContextChanges.length - 1;
      i >= from;
      i--
    ) {
      const change = this.#currentComponentContextChanges[i];
      if (change.didExist) {
        this.#context.set(change.key, change.prevValue);
      } else {
        this.#context.delete(change.key);
      }
    }
    this.#currentComponentContextChanges.length = from;
  }

  /** Whether the app is currently in "gather" or "render" phase. */
  get renderPhase() {
    return this.#renderPhase;
  }

  /**
   * Combine caller-supplied watch expressions with the focus-refresh key
   * (when {@link App.hasFocusRefresh} is enabled). Used by {@link Data}
   * blocks to opt into focus-based refresh.
   */
  createFocusRefreshWatch(...keys: (Sql[] | Sql)[]) {
    if (this.hasFocusRefresh) {
      return [...keys.flat(), sql`focus_refresh_key`];
    }
    return keys.flat();
  }

  /** Adds a global style to the application. */
  addGlobalStyle(style: StyleObject) {
    this.#globalStyles.push(style);
  }

  /**
   * Register a CSS `@keyframes` block and return the generated keyframe
   * name. Duplicate keyframes return the same id.
   */
  registerKeyframes(keyframes: KeyFrames) {
    if (this.#keyFrames.has(keyframes)) {
      return this.#keyFrames.get(keyframes)!;
    }
    const id = this.#keyframeIdGen.next();
    this.#keyFrames.set(keyframes, id);
    return id;
  }

  /**
   * Render `node` into a YOM node tree, recursively expanding components
   * and resolving event handlers. Used internally during YOM generation.
   */
  renderNode(node: Node): yom.Node {
    if (!(node instanceof Element)) {
      return this.#renderNodeInner(node);
    }
    const hasStatementSourceOrigin = pushStatementSourceOrigin(
      elementStatementSourceOrigin(node),
    );
    if (!hasStatementSourceOrigin) {
      return this.#renderNodeInner(node);
    }
    try {
      return this.#renderNodeInner(node);
    } finally {
      popStatementSourceOrigin();
    }
  }

  #renderNodeInner(node: Node): yom.Node {
    try {
      if (node === undefined || node === null || node === false) {
        return [];
      }
      if (typeof node === "string") {
        return sql.lit(node).toSQL();
      }
      if (typeof node === "number") {
        return node.toString();
      }
      if (
        node instanceof Sql
      ) {
        return node.toYOM();
      }
      if (Array.isArray(node)) {
        return node.map((n) => this.renderNode(n));
      }
      const statePropsToYomNode = (
        state: Omit<StateProps, "children">,
        children: yom.Node,
        precomputedProcedureArray?: yom.StateStatement[],
      ): yom.StateNode => {
        const watchArray = Array.isArray(state.watch)
          ? state.watch.map((w) => sql.toYOM(w))
          : sql.isAnyExpr(state.watch)
          ? [sql.toYOM(state.watch)]
          : [];
        const hoistKeyArray = Array.isArray(state.hoistKey)
          ? state.hoistKey.map((w) => sql.toYOM(w))
          : sql.isAnyExpr(state.hoistKey)
          ? [sql.toYOM(state.hoistKey)]
          : [];
        const procedureArray = precomputedProcedureArray ??
          StateStatements.normalizeToArray(state.procedure);

        // Build result object without empty arrays
        const result: any = {
          t: "State",
          procedure: procedureArray,
          children,
        };

        // Only add arrays if they're not empty
        if (watchArray.length > 0) {
          result.watch = watchArray;
        }
        if (hoistKeyArray.length > 0) {
          result.hoistKey = hoistKeyArray;
        }

        // Only add optional properties if they exist
        if (state.autoWatch) {
          result.autoWatch = true;
        }
        if (state.fallbackDelay !== undefined) {
          result.fallbackDelay = sql.toYOM(state.fallbackDelay);
        }
        if (state.acceptOldResponses !== undefined) {
          result.acceptOldResponses = sql.toYOM(
            state.acceptOldResponses,
          );
        }
        if (state.longRunning !== undefined) {
          result.longRunning = sql.toYOM(state.longRunning);
        }
        if (state.hasDataScalar) {
          result.hasDataScalar = state.hasDataScalar;
        }
        if (state.statusScalar) {
          result.statusScalar = state.statusScalar;
        }
        if (state.errorRecord) {
          result.errorRecord = state.errorRecord;
        }
        if (state.debounce) {
          result.debounce = {
            wait: sql.toYOM(state.debounce.wait),
            noWaitOnFirst: state.debounce.noWaitOnFirst !== undefined
              ? sql.toYOM(state.debounce.noWaitOnFirst)
              : undefined,
            maxWait: state.debounce.maxWait !== undefined
              ? sql.toYOM(state.debounce.maxWait)
              : undefined,
            leading: state.debounce.leading !== undefined
              ? sql.toYOM(state.debounce.leading)
              : undefined,
            trailing: state.debounce.trailing !== undefined
              ? sql.toYOM(state.debounce.trailing)
              : undefined,
          };
        }

        return result as yom.StateNode;
      };
      if (node instanceof Element) {
        if (typeof node.type === "function") {
          const stackName = node.type.getSource?.(node.props);
          this.#componentStack.push({
            component: node.type,
            stackName,
          });
          try {
            const prevContextLength =
              this.#currentComponentContextChanges.length;
            const prevWrappersLength = this.#currentComponentWrappers.length;
            let rendered;
            try {
              rendered = node.type(node.props);
            } catch (innerError) {
              if (innerError === undefined) {
                throw new Error(
                  `Component "${
                    node.type.name || "anonymous"
                  }" threw undefined. ` +
                    `This usually indicates a missing return statement or incorrectly thrown value.`,
                );
              }
              throw innerError;
            }
            for (
              const wrap of this.#currentComponentWrappers
                .slice(prevWrappersLength)
                .toReversed()
            ) {
              rendered = wrap(rendered);
            }
            const yomNode = this.renderNode(rendered);
            this.#currentComponentWrappers = this.#currentComponentWrappers
              .slice(0, prevWrappersLength);
            this.#undoContextChanges(prevContextLength);
            return stackName
              ? { t: "SourceMap", source: stackName, children: yomNode }
              : yomNode;
          } finally {
            this.#componentStack.pop();
          }
        }
        if (typeof node.type === "string") {
          let {
            onClick,
            onDoubleClick,
            onMouseDown,
            onMouseUp,
            onMouseEnter,
            onMouseLeave,
            onMouseOver,
            onMouseOut,
            onMouseMove,
            onDialogBackdropClick,
            onDrag,
            onDragStart,
            onDragEnter,
            onDragLeave,
            onDragOver,
            onDragEnd,
            onDrop,
            onFocus,
            onBlur,
            onFocusIn,
            onFocusOut,
            onFocusAway,
            onSubmit,
            onClickAway,
            onMount,
            onScroll,
            onClose,
            onCancel,
            onToggleShow,
            onToggleHide,
            onKeyDown,
            onKeyUp,
            onFileChange,
            onInput,
            onChange,
            onCheckboxChange,
            onPaste,
            onVisibilityChange,
            sx,
            dynamicClass,
            dynamicClasses,
            style,
            className,
            children,
            floating,
            scrollRestoration,
            classes,
            dynamicClassNames,
            js,
            serverRenderChildren,
            ...rest
          } = node.props;
          if (className) {
            const transformed = tailwindClassesToStyleObject(
              className,
              this.theme,
            );
            sx = [sx, transformed];
          }
          if (dynamicClassNames) {
            dynamicClasses = dynamicClasses ?? [];
            let i = 0;
            const varStyles: Record<string, any> = {};
            for (const { condition, classNames } of dynamicClassNames) {
              const transformed = tailwindClassesToStyleObject(
                classNames,
                this.theme,
              );
              varStyles[`&.var-${i}`] = transformed;
              dynamicClasses.push({
                condition,
                classes: `var-${i}`,
              });
              i++;
            }
            sx = [sx, varStyles];
          }
          if (sx) {
            const transformed = this.#styleSheet.addStyle(sx);
            classes = classes ? `${classes} ${transformed}` : transformed;
          }
          const on: Record<string, yom.EventHandler> = {};
          if (onClick !== undefined) on.click = onClick;
          if (onDoubleClick !== undefined) on.doubleClick = onDoubleClick;
          if (onMouseDown !== undefined) on.mouseDown = onMouseDown;
          if (onMouseUp !== undefined) on.mouseUp = onMouseUp;
          if (onMouseEnter !== undefined) on.mouseEnter = onMouseEnter;
          if (onMouseLeave !== undefined) on.mouseLeave = onMouseLeave;
          if (onMouseOver !== undefined) on.mouseOver = onMouseOver;
          if (onMouseOut !== undefined) on.mouseOut = onMouseOut;
          if (onMouseMove !== undefined) on.mouseMove = onMouseMove;
          if (onDialogBackdropClick !== undefined) {
            on.dialogBackdropClick = onDialogBackdropClick;
          }
          if (onDrag !== undefined) on.drag = onDrag;
          if (onDragStart !== undefined) on.dragStart = onDragStart;
          if (onDragEnter !== undefined) on.dragEnter = onDragEnter;
          if (onDragLeave !== undefined) on.dragLeave = onDragLeave;
          if (onDragOver !== undefined) on.dragOver = onDragOver;
          if (onDragEnd !== undefined) on.dragEnd = onDragEnd;
          if (onDrop !== undefined) on.drop = onDrop;
          if (onFocus !== undefined) on.focus = onFocus;
          if (onBlur !== undefined) on.blur = onBlur;
          if (onFocusIn !== undefined) on.focusIn = onFocusIn;
          if (onFocusOut !== undefined) on.focusOut = onFocusOut;
          if (onFocusAway !== undefined) on.focusAway = onFocusAway;
          if (onSubmit !== undefined) on.submit = onSubmit;
          if (onClickAway !== undefined) on.clickAway = onClickAway;
          if (onMount !== undefined) on.mount = onMount;
          if (onScroll !== undefined) on.scroll = onScroll;
          if (onClose !== undefined) on.close = onClose;
          if (onCancel !== undefined) on.cancel = onCancel;
          if (onToggleShow !== undefined) on.toggleShow = onToggleShow;
          if (onToggleHide !== undefined) on.toggleHide = onToggleHide;
          if (onKeyDown !== undefined) on.keydown = onKeyDown;
          if (onKeyUp !== undefined) on.keyup = onKeyUp;
          if (onFileChange !== undefined) on.fileChange = onFileChange;
          if (onInput !== undefined) on.input = onInput;
          if (onChange !== undefined) on.change = onChange;
          if (onCheckboxChange !== undefined) {
            on.checkboxChange = onCheckboxChange;
          }
          if (onPaste !== undefined) on.paste = onPaste;
          if (onVisibilityChange !== undefined) {
            on.visibilityChange = onVisibilityChange;
          }
          let hasEventHandlers = false;
          for (const eventName in on) {
            if (Object.prototype.hasOwnProperty.call(on, eventName)) {
              hasEventHandlers = true;
              break;
            }
          }
          if (hasEventHandlers) {
            normalizeElementEventHandlers(on);
          }

          let props: Record<string, string> | undefined;
          for (const k in rest) {
            if (!Object.prototype.hasOwnProperty.call(rest, k)) {
              continue;
            }
            const v = rest[k];
            if (v === undefined || v === null) {
              continue;
            }
            const propName = svgPropNameAliases[k] ?? k;
            if (
              !validPropNames.has(propName) && !propName.startsWith("data-")
            ) {
              console.warn(
                `Invalid prop name: ${k} on tag ${node.type}`,
                rest,
              );
              throw new Error(
                `Invalid prop name: ${k} on tag ${node.type}`,
              );
            }
            const propValue = stringLiteralOrExprToString(
              v as any,
              node.type,
              "prop",
              propName,
            );
            props ??= {};
            if (propName === "__proto__") {
              Object.defineProperty(props, propName, {
                value: propValue,
                enumerable: true,
                configurable: true,
                writable: true,
              });
            } else {
              props[propName] = propValue;
            }
          }

          let styleObj: Record<string, string> | undefined;
          if (style !== undefined && style !== null) {
            for (const k in style) {
              if (!Object.prototype.hasOwnProperty.call(style, k)) {
                continue;
              }
              const styleValue = stringLiteralOrExprToString(
                style[k] as any,
                node.type,
                "style",
                k,
              );
              styleObj ??= {};
              if (k === "__proto__") {
                Object.defineProperty(styleObj, k, {
                  value: styleValue,
                  enumerable: true,
                  configurable: true,
                  writable: true,
                });
              } else {
                styleObj[k] = styleValue;
              }
            }
          }

          let dynamicClassesArray:
            | { condition: yom.Sql; classes: string }[]
            | undefined;
          if (dynamicClass !== undefined && dynamicClass !== null) {
            if (Array.isArray(dynamicClass)) {
              const length = dynamicClass.length;
              for (let i = 0; i < length; i++) {
                if (!(i in dynamicClass)) {
                  continue;
                }
                const value = dynamicClass[i];
                (dynamicClassesArray ??= []).push({
                  condition: sql.toYOM(value.condition)!,
                  classes: value.classes,
                });
              }
            } else {
              dynamicClassesArray = [{
                condition: sql.toYOM(dynamicClass.condition)!,
                classes: dynamicClass.classes,
              }];
            }
          }
          if (dynamicClasses !== undefined && dynamicClasses !== null) {
            if (Array.isArray(dynamicClasses)) {
              const length = dynamicClasses.length;
              for (let i = 0; i < length; i++) {
                if (!(i in dynamicClasses)) {
                  continue;
                }
                const value = dynamicClasses[i];
                (dynamicClassesArray ??= []).push({
                  condition: sql.toYOM(value.condition)!,
                  classes: value.classes,
                });
              }
            } else {
              (dynamicClassesArray ??= []).push({
                condition: sql.toYOM(dynamicClasses.condition)!,
                classes: dynamicClasses.classes,
              });
            }
          }
          const renderedChildren = children
            ? this.renderNode(children)
            : undefined;

          // Build result object without empty properties
          const result: any = {
            t: "Element",
            tag: node.type as any,
          };

          // Only add properties if they're not empty
          if (props !== undefined) {
            result.props = props;
          }
          if (hasEventHandlers) {
            result.on = on;
          }
          if (classes) {
            result.classes = classes;
          }
          if (styleObj !== undefined) {
            result.style = styleObj;
          }
          if (dynamicClassesArray !== undefined) {
            result.dynamicClasses = dynamicClassesArray;
          }
          if (scrollRestoration) {
            result.scrollRestoration = scrollRestoration;
          }
          if (renderedChildren !== undefined) {
            result.children = renderedChildren;
          }
          if (floating) {
            result.floating = {
              anchorEl: stringLiteralOrExprToString(
                floating.anchorEl,
                node.type,
                "floating",
                "anchorEl",
              ),
              placement: stringLiteralOrExprToString(
                floating.placement,
                node.type,
                "floating",
                "placement",
              ),
              strategy: stringLiteralOrExprToString(
                floating.strategy,
                node.type,
                "floating",
                "strategy",
              ),
              flip: floating.flip
                ? {
                  crossAxis: stringLiteralOrExprToString(
                    floating.flip.crossAxis,
                    node.type,
                    "floating",
                    "flip.crossAxis",
                  ),
                  mainAxis: stringLiteralOrExprToString(
                    floating.flip.mainAxis,
                    node.type,
                    "floating",
                    "flip.mainAxis",
                  ),
                }
                : undefined,
              offset: floating.offset
                ? {
                  crossAxis: stringLiteralOrExprToString(
                    floating.offset.crossAxis,
                    node.type,
                    "floating",
                    "offset.crossAxis",
                  ),
                  mainAxis: stringLiteralOrExprToString(
                    floating.offset.mainAxis,
                    node.type,
                    "floating",
                    "offset.mainAxis",
                  ),
                }
                : undefined,
              shift: floating.shift
                ? {
                  crossAxis: stringLiteralOrExprToString(
                    floating.shift.crossAxis,
                    node.type,
                    "floating",
                    "shift.crossAxis",
                  ),
                  mainAxis: stringLiteralOrExprToString(
                    floating.shift.mainAxis,
                    node.type,
                    "floating",
                    "shift.mainAxis",
                  ),
                }
                : undefined,
              arrow: floating.arrow
                ? {
                  elementId: stringLiteralOrExprToString(
                    floating.arrow.elementId,
                    node.type,
                    "floating",
                    "arrow.elementId",
                  ),
                }
                : undefined,
            };
          }
          if (js) {
            result.js = {
              handles: js.handles.map((h: any) => ({
                module: h.module,
                cleanup: h.cleanup,
                handle: sql.toYOM(h.handle),
              })),
              on: Object.fromEntries(
                Object.entries(js.on).map((
                  [k, v],
                ) => [k, normalizeEventHandler(v as any)]),
              ),
            };
          }
          if (serverRenderChildren) {
            result.serverRenderChildren = GeneralServerStatements
              .normalizeToArray(serverRenderChildren);
          }
          return result;
        }
        if (node.type === RouteSymbol) {
          // Parse route path parameters and add them to analyze context
          const pathParams = parseRoutePathParams(node.props.path);
          let renderedChildren: yom.Node;
          if (pathParams.length > 0) {
            // Get parent context and create new context with route params
            const parentCtx = this.getContextOptional(AnalyzeQueryLocalICtxKey);
            const analyzeCtx = new AnalyzeQueryLocalCtx(parentCtx);
            for (const param of pathParams) {
              analyzeCtx.addScalar(param.name, param.type, false);
            }
            const routeParamCtx = new RoutePathParamsCtx(
              this.getContextOptional(RoutePathParamsICtxKey),
              pathParams.map((p) => p.name),
            );
            // Save context state, add context, render, then restore
            const prevContextLength =
              this.#currentComponentContextChanges.length;
            this.setContext(analyzeCtx);
            this.setContext(routeParamCtx);
            renderedChildren = this.renderNode(node.props.children);
            this.#undoContextChanges(prevContextLength);
          } else {
            renderedChildren = this.renderNode(node.props.children);
          }
          if (node.props.title !== undefined) {
            const title = this.displayName
              ? sql.concat(node.props.title, " | ", this.displayName)
              : node.props.title;
            const renderedTitle = this.renderNode(
              new Element("title", { children: title }),
            );
            renderedChildren = [renderedTitle, renderedChildren];
          }
          return {
            t: "Route",
            path: node.props.path,
            exact: node.props.exact,
            children: renderedChildren,
          };
        }
        if (node.type === RoutesSymbol) {
          let children: yom.RouteNode[] = [];
          if (Array.isArray(node.props.children)) {
            children = node.props.children.map((c: any) => this.renderNode(c));
          } else {
            children = [this.renderNode(node.props.children) as yom.RouteNode];
          }
          children = children.filter(
            (c: unknown) => !(Array.isArray(c) && c.length === 0),
          );
          return {
            t: "Routes",
            children,
          };
        }
        if (node.type === ShowSymbol) {
          if (typeof node.props.when === "boolean") {
            return this.renderNode(
              node.props.when ? node.props.children : node.props.fallback,
            );
          }
          return {
            t: "If",
            condition: sql.toYOM(node.props.when)!,
            then: this.renderNode(node.props.children),
            else: this.renderNode(node.props.fallback),
          };
        }
        if (node.type === SwitchSymbol) {
          const children = this.renderNode(node.props.children);
          const cases: yom.SwitchNodeCase[] = [];
          const processNode = (node: any) => {
            if (!node) {
              return;
            }
            if (Array.isArray(node)) {
              for (const child of node) {
                processNode(child);
              }
              return;
            }
            let currentNode = node;
            if (currentNode.t === "SourceMap") {
              currentNode = currentNode.children;
              processNode(currentNode);
              return;
            }
            if (currentNode.t !== MatchSymbol) {
              console.error(
                "Switch must have <Match> components as children, error ",
                currentNode.t,
              );
              throw new Error(
                "Switch must have <Match> components as children",
              );
            }
            cases.push({
              condition: currentNode.condition,
              node: currentNode.children,
            });
          };
          processNode(Array.isArray(children) ? children : [children]);
          return {
            t: "Switch",
            cases,
          };
        }
        if (node.type === MatchSymbol) {
          // kind of a hack, and I should have better error handling if there is a match without a parent switch
          return {
            t: MatchSymbol,
            condition: sql.toYOM(node.props.when)!,
            children: this.renderNode(node.props.children),
          } as any;
        }
        if (node.type === EventHandlersSymbol) {
          const result: yom.EventHandlersNode = {
            t: "EventHandlers",
            window: node.props.window,
            document: node.props.document,
            mount: node.props.mount,
          };
          if (result.window) {
            for (const [key, handler] of Object.entries(result.window)) {
              result.window[key as yom.EventHandlerName] =
                normalizeEventHandler(
                  handler as any,
                );
            }
          }
          if (result.document) {
            for (const [key, handler] of Object.entries(result.document)) {
              result.document[key as yom.EventHandlerName] =
                normalizeEventHandler(handler as any);
            }
          }
          if (result.mount) {
            result.mount = normalizeEventHandler(result.mount as any);
          }
          return result;
        }
        if (node.type === StateSymbol) {
          const stateProps = node.props as StateProps;
          let procedureArray: yom.StateStatement[] | undefined;
          const getProcedureArray = () =>
            procedureArray ??= StateStatements.normalizeToArray(
              stateProps.procedure,
            );
          const parentCtx = this.getContextOptional(AnalyzeQueryLocalICtxKey);
          const analyzeCtx = new StateAnalyzeCtx(parentCtx, getProcedureArray);
          const prevContextLength = this.#currentComponentContextChanges.length;
          this.setContext(analyzeCtx);
          let children: yom.Node;
          try {
            children = this.renderNode(stateProps.children);
          } finally {
            this.#undoContextChanges(prevContextLength);
          }
          return statePropsToYomNode(
            stateProps,
            children,
            procedureArray,
          );
        }
        if (node.type === AuthorizeSymbol) {
          return {
            t: "Authorize",
            statements: AuthorizeStatements.normalizeToArray(
              node.props.procedure,
            ),
            authorized: this.renderNode(node.props.children),
            unauthorized: this.renderNode(node.props.unauthorized),
          };
        }
        if (node.type === QueryParamsSymbol) {
          return {
            t: "QueryParams",
            params: node.props.params.map((p: QueryParam) => ({
              name: p.name,
              type: fieldTypeFromHelper(p.type),
              default: p.default ? sql.toYOM(p.default) : undefined,
              allowNoRead: p.allowNoRead,
              history: p.history,
            })),
            children: this.renderNode(node.props.children),
          };
        }
        if (node.type === SourceMapSymbol) {
          return {
            t: "SourceMap",
            source: node.props.source,
            children: this.renderNode(node.props.children),
          };
        }
        if (node.type === EachSymbol) {
          return {
            t: "Each",
            table: node.props.table,
            recordName: node.props.recordName,
            where: sql.toYOM(node.props.where),
            key: sql.toYOM(node.props.eachKey),
            orderBy: node.props.orderBy
              ? node.props.orderBy.toYOM()
              : undefined,
            children: this.renderNode(node.props.children),
          };
        }
        if (node.type === RecursiveSymbol) {
          return {
            t: "Recursive",
            table: node.props.table,
            recordName: node.props.recordName,
            where: sql.toYOM(node.props.where),
            orderBy: node.props.orderBy
              ? node.props.orderBy.toYOM()
              : undefined,
            key: sql.toYOM(node.props.recursiveKey),
            children: this.renderNode(node.props.children),
          };
        }
        if (node.type === RecurseSymbol) {
          return {
            t: "Recurse",
            where: sql.toYOM(node.props.where)!,
            recordName: node.props.recordName,
          };
        }
        if (node.type === ListenSymbol) {
          return {
            t: "Listen",
            query: sql.toYOM(node.props.query)!,
            do: normalizeEventHandler(node.props.onChange),
          } as any;
        }
        if (node.type === DatagridSymbol) {
          const props = node.props as DatagridProps;

          // Build columns array
          const columns = props.columns.map((col) => {
            const column: any = {
              header: this.renderNode(col.header),
              cell: this.renderNode(col.cell),
              width: sql.toYOM(col.width),
            };
            if (col.ordering !== undefined) {
              column.ordering = sql.toYOM(col.ordering);
            }
            if (col.visible !== undefined) {
              column.visible = sql.toYOM(col.visible);
            }
            if (col.pinLeft !== undefined) {
              column.pinLeft = sql.toYOM(col.pinLeft);
            }
            if (col.pinRight !== undefined) {
              column.pinRight = sql.toYOM(col.pinRight);
            }
            return column;
          });

          // Build classes object without undefined values
          const classes: any = {};
          if (props.sx?.cell) {
            classes.cell = this.#styleSheet.addStyle(props.sx.cell);
          }
          if (props.sx?.header) {
            classes.header = this.#styleSheet.addStyle(props.sx.header);
          }
          if (props.sx?.headerCell) {
            classes.headerCell = this.#styleSheet.addStyle(props.sx.headerCell);
          }
          if (props.sx?.root) {
            classes.root = this.#styleSheet.addStyle(props.sx.root);
          }
          if (props.sx?.row) {
            classes.row = this.#styleSheet.addStyle(props.sx.row);
          }

          // Build event handlers object without undefined values
          const on: any = {};
          if (props.onCellClick) {
            on.cellClick = props.onCellClick;
          }
          if (props.onKeyboardNavigation) {
            on.keyboardNavigation = props.onKeyboardNavigation;
          }
          if (props.onCellDoubleClick) {
            on.cellDoubleClick = props.onCellDoubleClick;
          }
          if (props.onCellKeydown) {
            on.cellKeydown = props.onCellKeydown;
          }
          if (props.onFetchMore) {
            on.fetchMore = props.onFetchMore;
          }

          // Build result object
          const result: any = {
            t: "DataGrid",
            columns,
            headerHeight: sql.toYOM(props.headerHeight),
            recordName: props.recordName,
            rowHeight: sql.toYOM(props.rowHeight),
            table: props.table,
            focusedColumn: sql.toYOM(props.focusedColumn),
            focusedRow: sql.toYOM(props.focusedRow),
            shouldFocusCell: sql.toYOM(props.shouldFocusCell),
          };

          if (props.columnMetadataSource !== undefined) {
            result.columnMetadataSource = props.columnMetadataSource;
          }

          // Only add non-empty objects
          if (Object.keys(classes).length > 0) {
            result.classes = classes;
          }
          if (Object.keys(on).length > 0) {
            for (const [key, handler] of Object.entries(on)) {
              on[key] = normalizeEventHandler(handler as any);
            }
            result.on = on;
          }
          if (props.tableKey !== undefined) {
            result.tableKey = sql.toYOM(props.tableKey);
          }

          return result;
        }
        if (node.type === ModeSymbol) {
          return {
            t: "Mode",
            render: typeof node.props.render === "string"
              ? sql.lit(node.props.render).toYOM()
              : sql.toYOM(node.props.render),
            children: this.renderNode(node.props.children),
          };
        }
        if (node.type === EffectSymbol) {
          return {
            t: "Effect",
            watch: Array.isArray(node.props.watch)
              ? node.props.watch.map((w: any) => sql.toYOM(w))
              : [sql.toYOM(node.props.watch)],
            onChange: normalizeEventHandler(node.props.onChange),
            triggerOnMount: node.props.triggerOnMount,
          };
        }
        if (node.type === RedirectSymbol) {
          return {
            t: "Redirect",
            to: typeof node.props.to === "string"
              ? sql.lit(node.props.to).toYOM()
              : sql.toYOM(node.props.to),
            replace: node.props.replace === undefined
              ? undefined
              : sql.toYOM(node.props.replace),
          };
        }
        if (node.type === DynamicNodeSymbol) {
          const props = node.props as DynamicNodeProps;
          const result: any = {
            t: "DynamicNode",
          };
          if (props.source !== undefined) {
            result.source = sql.exprToString(props.source);
          }
          if (props.entryPath !== undefined) {
            result.entryPath = sql.exprToString(props.entryPath);
          }
          if (props.appDomain !== undefined) {
            result.appDomain = sql.exprToString(props.appDomain);
          }
          if (props.accessPolicy !== undefined) {
            result.accessPolicy = props.accessPolicy;
          }
          if (props.meta !== undefined) {
            result.meta = sql.exprToString(props.meta);
          }
          if (props.authorize !== undefined) {
            result.authorize = AuthorizeStatements.normalizeToArray(
              props.authorize,
            );
          }
          if (props.onInternalEvent !== undefined) {
            result.onInternalEvent = normalizeEventHandler(
              props.onInternalEvent,
            );
          }
          if (props.sizing !== undefined) {
            result.sizing = props.sizing;
          }
          if (props.height !== undefined) {
            result.height = sql.exprToString(props.height);
          }
          return result;
        }
      }
      console.log(node);
      throw new Error("Todo");
    } catch (e) {
      if (e instanceof RenderError || e instanceof GatherError) {
        throw e;
      }
      const error = e instanceof Error ? e : new Error(
        e === undefined
          ? `Unknown error (undefined was thrown)\nCaught at: ${
            new Error().stack
          }`
          : String(e),
      );
      throw new RenderError(error, this.#componentStack.slice());
    }
  }

  /**
   * Pre-render walk of the node tree so that blocks can record which ICtx
   * keys they need before the actual render phase begins.
   */
  gatherForBlocks() {
    this.gatherChildrenContextInfo(this.nodeTreeWithAuth);
  }

  /** Root node tree wrapped in any necessary global-node providers. */
  get nodeTreeWithAuth() {
    let rootNode = this.#uiNode;
    if (this.globalNodes.size > 0 || this.globalStates.size > 0) {
      rootNode = <WithGlobalNodes>{rootNode}</WithGlobalNodes>;
    }
    return rootNode;
  }

  /**
   * Generate the YOM representation of this app — produces the page tree,
   * CSS, JS modules, endpoints, and security headers. Called by
   * {@link System.prepareYom}; application code rarely calls it directly.
   */
  generateYom(): yom.App {
    let rootNode = this.nodeTreeWithAuth;
    const rootHtmlTags: Node[] = [];
    for (const [key, value] of Object.entries(this.globalHtmlMeta)) {
      rootHtmlTags.push(<meta name={key} content={value} />);
    }
    switch (this.logoGeneration.type) {
      case "Default": {
        rootHtmlTags.push(
          <link
            rel="icon"
            type="image/png"
            href="https://yolmcdn.net/global/logo/favicon-96x96.oHgX5EB0fy4lsd9NI4FjAATa2kzytFGxAlzAClnWT0Y.png"
            sizes="96x96"
          />,
          <link
            rel="icon"
            type="image/svg+xml"
            href="https://yolmcdn.net/global/logo/favicon.javWob4YSpWLaTmj7kw7B2NEfTkts2X2L6uxqbRLluE.svg"
          />,
          <link
            rel="shortcut icon"
            href="https://yolmcdn.net/global/logo/favicon._skMB8zx-6Mh7yGyNFyeJGQR1gnXbnz0YMQkDps63lM.ico"
          />,
          <link
            rel="apple-touch-icon"
            sizes="180x180"
            href="https://yolmcdn.net/global/logo/apple-touch-icon.3MFDG1DjqL_1BSMQtnXgIeFsYbOByNuLZOnU0jpE-ZI.png"
          />,
          <meta name="msapplication-TileColor" content="#0B132B" />,
          <meta name="theme-color" content="#ffffff" />,
        );
        break;
      }
      case "App": {
        rootHtmlTags.push(
          <link
            rel="apple-touch-icon"
            sizes="180x180"
            href={YolmGenApi.getAssetUrl("apple-touch-icon.png")}
          />,
          <link
            rel="icon"
            type="image/png"
            sizes="32x32"
            href={YolmGenApi.getAssetUrl("favicon-32x32.png")}
          />,
          <link
            rel="icon"
            type="image/png"
            sizes="16x16"
            href={YolmGenApi.getAssetUrl("favicon-16x16.png")}
          />,
          <link
            rel="mask-icon"
            href={YolmGenApi.getAssetUrl("safari-pinned-tab.svg")}
            color={this.logoGeneration.safariPinnedTabColor}
          />,
          <link
            rel="shortcut icon"
            href={YolmGenApi.getAssetUrl("favicon.ico")}
          />,
          <meta
            name="msapplication-TileColor"
            content={this.logoGeneration.msTileColor}
          />,
          <meta name="theme-color" content={this.logoGeneration.themeColor} />,
        );
        break;
      }
      case "Custom":
        break;
    }
    if (this.displayName) {
      rootHtmlTags.push(<title>{this.displayName}</title>);
    }
    for (const preload of this.#fontPreloads) {
      rootHtmlTags.push(
        <link
          rel="preload"
          as="font"
          href={preload.href}
          type={preload.type}
          crossOrigin="anonymous"
        />,
      );
    }
    rootHtmlTags.push(<html lang={this.lang} />);
    rootNode = [rootHtmlTags, rootNode];
    if (this.hasFocusRefresh) {
      rootNode = <FocusRefresh>{rootNode}</FocusRefresh>;
    }
    rootNode = <GlobalRefetch>{rootNode}</GlobalRefetch>;
    if (this.colorSchemeType === "cookie") {
      rootNode = <CookieColorScheme>{rootNode}</CookieColorScheme>;
    }
    if (!this.#disableDefaultFontFamily) {
      rootNode = (
        <>
          {rootNode}
        </>
      );
    }
    this.#renderPhase = "render";
    this.#styleSheet.addRootStyles();
    const renderedTree = this.renderNode(rootNode);
    this.#styleSheet.addGlobalStyles(this.#globalStyles);
    this.#styleSheet.addKeyframes(this.#keyFrames);
    return {
      domain: this.domain,
      domainAliases: this.domainAliases,
      tree: renderedTree,
      css: this.#styleSheet.getCss(),
      jsModules: this.jsModuleConfigs.map(resolveJsModule),
      navigationViewTransitionConfig: this.#navigationViewTransitionConfig,
      webAppManifest: this.webAppManifest,
      endpoints: this.#endpoints.map((sql) => ({
        path: sql.path,
        query: sql.query,
        procedure: EndpointStatements.normalizeToArray(sql.procedure),
      })),
      firstRender: this.#firstRender,
      headers: [...this.generateSecurityHeaders(), ...this.headers],
    };
  }

  /**
   * Translate {@link App.securityHeaders} into the {@link yom.AppHeader} list
   * served on every response (`X-Frame-Options`,
   * `Content-Security-Policy`, etc.).
   */
  generateSecurityHeaders(): yom.AppHeader[] {
    const headers: yom.AppHeader[] = [];

    // Handle X-Frame-Options
    if (this.securityHeaders.xFrameOptions) {
      if (this.securityHeaders.xFrameOptions === true) {
        // Default value
        headers.push({
          name: "X-Frame-Options",
          value: "SAMEORIGIN",
        });
      } else {
        // Custom configuration
        const xfo = this.securityHeaders.xFrameOptions;
        let value = xfo.value as string;
        if (value === "ALLOW-FROM" && xfo.uri) {
          value = `ALLOW-FROM ${xfo.uri}`;
        }
        headers.push({
          name: "X-Frame-Options",
          value,
        });
      }
    }

    // Handle Content-Security-Policy
    if (this.securityHeaders.contentSecurityPolicy) {
      if (this.securityHeaders.contentSecurityPolicy === true) {
        // Default CSP
        headers.push({
          name: "Content-Security-Policy",
          value: "default-src 'self'; \
            script-src 'self' https://yolmcdn.net https://static.cloudflareinsights.com 'wasm-unsafe-eval'; \
            style-src 'self' 'unsafe-inline'  https://yolmcdn.net; \
            img-src 'self'  https://yolmcdn.net data:; \
            connect-src 'self' https://yolmcdn.net https://yolmglobalapi.com; \
            font-src 'self' https://yolmcdn.net; \
            base-uri 'self'; \
            frame-src 'self'; \
            form-action 'self'; \
            worker-src 'self' blob:; \
            report-uri /_y/csp-report",
        });
      } else {
        // Custom CSP configuration
        const csp = this.securityHeaders.contentSecurityPolicy;
        const headerName = csp.reportOnly
          ? "Content-Security-Policy-Report-Only"
          : "Content-Security-Policy";

        // Get the base directives
        let finalDirectives: ContentSecurityPolicyDirective[];

        if (csp.directives) {
          // Use explicitly provided directives
          finalDirectives = [...csp.directives];
        } else {
          // Start with default directives
          finalDirectives = JSON.parse(JSON.stringify(DEFAULT_CSP_DIRECTIVES));

          // Merge additional sources into directives
          const mergeAdditionalSources = (
            additionalSources: { [directive: string]: string[] },
          ) => {
            for (
              const [directiveName, sources] of Object.entries(
                additionalSources,
              )
            ) {
              const directive = finalDirectives.find(
                (d) => d.directive === directiveName,
              );
              if (directive) {
                directive.sources = [
                  ...new Set([...directive.sources, ...sources]),
                ];
              } else {
                finalDirectives.push({ directive: directiveName, sources });
              }
            }
          };

          // Add additional sources to specific directives if provided
          if (csp.additionalSources) {
            mergeAdditionalSources(csp.additionalSources);
          }

          // Add dev-only additional sources when devCsp capability is set.
          // Set "devCsp": true in devCapabilities.json to enable.
          if (csp.devAdditionalSources) {
            const caps = YolmGenApi.getCapabilities();
            if (caps?.devCsp) {
              mergeAdditionalSources(csp.devAdditionalSources);
            }
          }
        }

        // Build the CSP value from directives
        const directiveStrings = finalDirectives.map(
          (d) => `${d.directive} ${d.sources.join(" ")}`,
        );

        // Add report-uri if specified
        if (csp.reportUri) {
          directiveStrings.push(`report-uri ${csp.reportUri}`);
        } else {
          directiveStrings.push("report-uri /_y/csp-report");
        }

        headers.push({
          name: headerName,
          value: directiveStrings.join("; "),
        });
      }
    }

    return headers;
  }
}

/**
 * Options for {@link useGlobalNode}. A global node is rendered once per app
 * but can be shown from any page (e.g. a cross-page snackbar).
 */
export interface GlobalNodeOpts {
  /** Stable key — different keys produce independent global nodes. */
  key: string;
  /** Render function. `close` returns statements that hide the node. */
  node: (props: {
    close: <T extends IStatementsBase>(s: T) => unknown;
  }) => Node;
  /** Optional auto-hide duration (ms) after the node is opened. */
  autoHideDuration?: number;
}

/**
 * Register (once per app) a node that can be opened from any page and
 * return statements for opening / closing it.
 *
 * See {@link https://docs.yolm.io/ui/snackbar | Snackbar} for an example.
 */
export function useGlobalNode(opts: GlobalNodeOpts) {
  const app = useApp();
  const close = new BasicStatements().setScalar(
    "crosspage_node_open",
    sql.null,
  );
  let i = app.globalNodes.size;
  if (app.globalNodes.has(opts.key)) {
    [i] = app.globalNodes.get(opts.key)!;
  } else {
    const Node = opts.node;
    app.globalNodes.set(opts.key, [
      i,
      <Node close={(s) => s.statements(close)} />,
    ]);
  }
  const delayedClose = typeof opts.autoHideDuration === "number"
    ? new DomStatements().startTaskWithOpts({
      detached: true,
      procedure: (s) =>
        s
          .sleep(opts.autoHideDuration!)
          .if(sql`crosspage_node_open = ${i}`, (s) =>
            s.statements(close).commitUiTreeChanges()),
    })
    : new DomStatements().statements(close);
  return {
    open: new DomStatements()
      .setScalar("crosspage_node_open", i)
      .conditionalStatements(
        typeof opts.autoHideDuration === "number",
        delayedClose,
      ),
    openWithoutDelayedClose: new BasicStatements().setScalar(
      "crosspage_node_open",
      i,
    ),
    close: close,
    delayedClose,
  };
}

/**
 * Register a per-app {@link State} that lives outside the page tree, so it
 * is available from any page. Idempotent on `key`.
 */
export function useGlobalState(
  opts: StatePropsWithoutChildren & { key: string },
) {
  const app = useApp();
  if (app.globalStates.has(opts.key)) {
    return;
  }
  app.globalStates.set(
    opts.key,
    typeof opts === "function" ? { procedure: opts } : opts,
  );
}

/** Props for the internal `WithGlobalNodes` wrapper component. */
export interface WithGlobalNodesProps {
  /** The app's actual page tree. */
  children: Node;
}

/**
Wraps the children with all of the global states and puts nodes next to them.

This needs to be used for anything that needs to exists across pages (for example if you deleted a contact
and then navigate to another page but want to show a message to the user)

@category Utility Component
 */
function WithGlobalNodes(props: WithGlobalNodesProps) {
  const app = useApp();
  gatherChildrenContextInfo(props.children);
  useState((s) => {
    s.defScalar("crosspage_node_open", {
      type: "BigInt",
    });
  });
  for (const state of app.globalStates.values()) {
    useState(state);
  }
  return (
    <>
      {props.children}
      <Switch>
        {Array.from(app.globalNodes.values()).map(([i, node]) => (
          <Match when={sql`crosspage_node_open = ${i}`}>{node}</Match>
        ))}
      </Switch>
    </>
  );
}

function stringLiteralOrExprToString(
  expr: string | AnyExpr,
  tag?: string,
  fieldKind?: "prop" | "style" | "floating",
  fieldName?: string,
) {
  if (typeof expr === "string") {
    return sql.lit(expr).toYOM();
  }
  if (
    expr instanceof Sql ||
    typeof expr === "boolean" ||
    typeof expr === "number" ||
    (expr !== null && typeof expr === "object" &&
      typeof (expr as any).toSQL === "function")
  ) {
    return sql.toYOM(expr)!;
  }
  const prefix = tag && fieldKind && fieldName
    ? `Invalid value for <${tag}> ${renderFieldName(fieldKind, fieldName)}`
    : "Invalid string literal or expression value";
  const hint = fieldKind === "style"
    ? " For DOM style values, use sx for nested style objects, selectors, and responsive styles; style only supports scalar values."
    : "";
  throw new Error(
    `${prefix}: expected a string literal or SQL expression-compatible value, got ${
      describeRenderValue(expr)
    }.${hint}`,
  );
}

function renderFieldName(
  fieldKind: "prop" | "style" | "floating",
  fieldName: string,
) {
  return fieldKind === "floating"
    ? `floating.${fieldName}`
    : `${fieldKind} "${fieldName}"`;
}

function describeRenderValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  const valueType = typeof value;
  if (valueType !== "object") {
    return `${valueType} ${String(value)}`;
  }
  const constructorName = describeObjectConstructor(value);
  const keys = describeObjectKeys(value);
  const keySummary = keys.length === 0
    ? "no enumerable keys"
    : `keys: ${keys.slice(0, 8).join(", ")}${
      keys.length > 8 ? `, ... +${keys.length - 8} more` : ""
    }`;
  return `object ${constructorName} (${keySummary})`;
}

function describeObjectConstructor(value: object): string {
  try {
    return Object.getPrototypeOf(value)?.constructor?.name ?? "Object";
  } catch {
    return "unknown constructor";
  }
}

function describeObjectKeys(value: object): string[] {
  try {
    return Object.keys(value);
  } catch {
    return ["<unable to read keys>"];
  }
}

/**
 * Parse route path parameters like {record_id:id} or {slug:string}
 * Returns array of { name, type } for each parameter found
 */
function parseRoutePathParams(
  path: string,
): { name: string; type: AnalyzeScalarType }[] {
  const params: { name: string; type: AnalyzeScalarType }[] = [];
  // Match {name:type} or {name} patterns
  const regex = /\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z_][a-zA-Z0-9_]*))?\}/g;
  let match;
  while ((match = regex.exec(path)) !== null) {
    const name = match[1];
    const typeStr = match[2] ?? "string";
    let type: AnalyzeScalarType;
    switch (typeStr) {
      case "id":
      case "biguint":
      case "bigint":
        type = { type: "BigInt" };
        break;
      case "int":
        type = { type: "Int" };
        break;
      case "uint":
        type = { type: "BigInt" };
        break;
      case "smallint":
        type = { type: "SmallInt" };
        break;
      case "smalluint":
        type = { type: "Int" };
        break;
      case "tinyuint":
      case "tinyint":
        type = { type: "SmallInt" }; // Map to SmallInt since we don't have TinyInt
        break;
      case "uuid":
        type = { type: "Uuid" };
        break;
      case "string":
        type = { type: "String" };
        break;
      default:
        throw new Error(
          `Unsupported route path parameter type "${typeStr}" for "${name}" in path "${path}"`,
        );
    }
    params.push({ name, type });
  }
  return params;
}

function CookieColorScheme({ children }: { children: Node }) {
  useState((s) => {
    s.defScalar("color_scheme_refresh_key", 0);
  });
  return [
    children,
    <State
      watch={[sql`color_scheme_refresh_key`]}
      procedure={(s) => {
        s.getCookie(sql.lit`color_scheme`, "color_scheme");
      }}
    >
      <html
        dynamicClasses={[
          {
            condition: sql`color_scheme.value = 'light'`,
            classes: "light",
          },
          {
            condition: sql`color_scheme.value = 'dark'`,
            classes: "dark",
          },
        ]}
      />
    </State>,
  ];
}

function GlobalRefetch(props: { children: Node }) {
  useState((s) => {
    s.defScalar("global_refetch_key", 0);
  });
  return props.children;
}

function FocusRefresh(props: { children: Node }) {
  useState((s) => {
    s.defScalar("focus_refresh_key", 0);
    s.defScalar("refresh_task_handle", {
      type: "BigUint",
    });
  });
  function handleFocus(s: DomStatements) {
    s.document.getHidden("hidden");
    s.if(sql`refresh_task_handle is not null`, (s) => {
      s.cancelTask(sql`refresh_task_handle`);
    });
    s.unless(sql`hidden`, (s) => {
      s.startTaskWithOpts({
        handleScalar: "new_refresh_task_handle",
        detached: true,
        procedure: (s) => {
          s.sleep(10);
          s.increment("focus_refresh_key");
          s.increment("global_refetch_key");
          s.commitUiTreeChanges();
        },
      });
      s.setScalar("refresh_task_handle", sql`new_refresh_task_handle`);
    });
  }
  return [
    props.children,
    <EventHandlers
      window={{
        visibilityChange: handleFocus,
      }}
    />,
  ];
}

function normalizeEventHandler(helper: HelperEventHandler): yom.EventHandler {
  if (typeof helper === "function") {
    return DomStatements.normalizeToArray(helper);
  }
  if (helper instanceof DomStatements || helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }
  return {
    ...helper,
    procedure: DomStatements.normalizeToArray(helper.procedure),
  };
}

function normalizeChangeEventHandler(
  helper: ChangeEventHandler,
): yom.EventHandler {
  if (typeof helper === "function") {
    // Simple function form
    return DomStatements.normalizeToArray((s) => {
      // The newValue will be available as target_value in the context
      helper(s, sql`target_value`);
    });
  }

  // Check if it's a BasicStatements instance
  if (helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }

  // Direct EventHandlerObject form
  const eventHandlerObject = helper as
    & Omit<yom.EventHandlerObject, "procedure">
    & { procedure: DomStatementsOrFn };
  return {
    procedure: DomStatements.normalizeToArray(eventHandlerObject.procedure),
    detachedFromNode: eventHandlerObject.detachedFromNode,
    disableAutoUiCommit: eventHandlerObject.disableAutoUiCommit,
  };
}

function normalizeMouseEventHandler(
  helper: MouseEventHandler,
): yom.EventHandler {
  if (typeof helper === "function") {
    // Simple function form
    return DomStatements.normalizeToArray((s) => {
      const eventObject = createMouseEventObject();
      helper(s, eventObject);
    });
  }

  // Check if it's a BasicStatements instance
  if (helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }

  // Direct EventHandlerObject form
  const eventHandlerObject = helper as
    & Omit<yom.EventHandlerObject, "procedure">
    & { procedure: DomStatementsOrFn };
  return {
    procedure: DomStatements.normalizeToArray(eventHandlerObject.procedure),
    detachedFromNode: eventHandlerObject.detachedFromNode,
    disableAutoUiCommit: eventHandlerObject.disableAutoUiCommit,
  };
}

function normalizeKeyboardEventHandler(
  helper: KeyboardEventHandler,
): yom.EventHandler {
  if (typeof helper === "function") {
    return DomStatements.normalizeToArray((s) => {
      const eventObject = createKeyboardEventObject();
      helper(s, eventObject);
    });
  }

  // Check if it's a BasicStatements instance
  if (helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }

  // Direct EventHandlerObject form
  const eventHandlerObject = helper as
    & Omit<yom.EventHandlerObject, "procedure">
    & { procedure: DomStatementsOrFn };
  return {
    procedure: DomStatements.normalizeToArray(eventHandlerObject.procedure),
    detachedFromNode: eventHandlerObject.detachedFromNode,
    disableAutoUiCommit: eventHandlerObject.disableAutoUiCommit,
  };
}

function normalizeFocusEventHandler(
  helper: FocusEventHandler,
): yom.EventHandler {
  if (typeof helper === "function") {
    return DomStatements.normalizeToArray((s) => {
      const eventObject = createFocusEventObject();
      helper(s, eventObject);
    });
  }

  // Check if it's a BasicStatements instance
  if (helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }

  // Direct EventHandlerObject form
  const eventHandlerObject = helper as
    & Omit<yom.EventHandlerObject, "procedure">
    & { procedure: DomStatementsOrFn };
  return {
    procedure: DomStatements.normalizeToArray(eventHandlerObject.procedure),
    detachedFromNode: eventHandlerObject.detachedFromNode,
    disableAutoUiCommit: eventHandlerObject.disableAutoUiCommit,
  };
}

function normalizeClipboardEventHandler(
  helper: ClipboardEventHandler,
): yom.EventHandler {
  if (typeof helper === "function") {
    return DomStatements.normalizeToArray((s) => {
      const eventObject = createClipboardEventObject();
      helper(s, eventObject);
    });
  }

  // Check if it's a BasicStatements instance
  if (helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }

  // Direct EventHandlerObject form
  const eventHandlerObject = helper as
    & Omit<yom.EventHandlerObject, "procedure">
    & { procedure: DomStatementsOrFn };
  return {
    procedure: DomStatements.normalizeToArray(eventHandlerObject.procedure),
    detachedFromNode: eventHandlerObject.detachedFromNode,
    disableAutoUiCommit: eventHandlerObject.disableAutoUiCommit,
  };
}

function normalizeFileEventHandler(helper: FileEventHandler): yom.EventHandler {
  if (typeof helper === "function") {
    return DomStatements.normalizeToArray((s) => {
      const eventObject = createFileEventObject();
      helper(s, eventObject);
    });
  }

  // Check if it's a BasicStatements instance
  if (helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }

  // Direct EventHandlerObject form
  const eventHandlerObject = helper as
    & Omit<yom.EventHandlerObject, "procedure">
    & { procedure: DomStatementsOrFn };
  return {
    procedure: DomStatements.normalizeToArray(eventHandlerObject.procedure),
    detachedFromNode: eventHandlerObject.detachedFromNode,
    disableAutoUiCommit: eventHandlerObject.disableAutoUiCommit,
  };
}

function normalizeFormEventHandler(helper: FormEventHandler): yom.EventHandler {
  if (typeof helper === "function") {
    return DomStatements.normalizeToArray((s) => {
      const eventObject = createFormEventObject();
      helper(s, eventObject);
    });
  }

  // Check if it's a BasicStatements instance
  if (helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }

  // Direct EventHandlerObject form
  const eventHandlerObject = helper as
    & Omit<yom.EventHandlerObject, "procedure">
    & { procedure: DomStatementsOrFn };
  return {
    procedure: DomStatements.normalizeToArray(eventHandlerObject.procedure),
    detachedFromNode: eventHandlerObject.detachedFromNode,
    disableAutoUiCommit: eventHandlerObject.disableAutoUiCommit,
  };
}

function normalizeInputEventHandler(
  helper: InputEventHandler,
): yom.EventHandler {
  if (typeof helper === "function") {
    return DomStatements.normalizeToArray((s) => {
      helper(s, sql`target_value`);
    });
  }

  // Check if it's a BasicStatements instance
  if (helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }

  // Direct EventHandlerObject form
  const eventHandlerObject = helper as
    & Omit<yom.EventHandlerObject, "procedure">
    & { procedure: DomStatementsOrFn };
  return {
    procedure: DomStatements.normalizeToArray(eventHandlerObject.procedure),
    detachedFromNode: eventHandlerObject.detachedFromNode,
    disableAutoUiCommit: eventHandlerObject.disableAutoUiCommit,
  };
}

function normalizeCheckboxEventHandler(
  helper: CheckboxEventHandler,
): yom.EventHandler {
  if (typeof helper === "function") {
    return DomStatements.normalizeToArray((s) => {
      helper(s, sql`target_checked`);
    });
  }

  // Check if it's a BasicStatements instance
  if (helper instanceof BasicStatements) {
    return DomStatements.normalizeToArray(helper);
  }

  // Direct EventHandlerObject form
  const eventHandlerObject = helper as
    & Omit<yom.EventHandlerObject, "procedure">
    & { procedure: DomStatementsOrFn };
  return {
    procedure: DomStatements.normalizeToArray(eventHandlerObject.procedure),
    detachedFromNode: eventHandlerObject.detachedFromNode,
    disableAutoUiCommit: eventHandlerObject.disableAutoUiCommit,
  };
}

/**
 * Structured event handler normalization
 * Maps event types to their appropriate normalizer functions
 */
const EVENT_HANDLER_NORMALIZERS: Record<
  string,
  (handler: any) => yom.EventHandler
> = {
  // Mouse events
  click: normalizeMouseEventHandler,
  doubleClick: normalizeMouseEventHandler,
  mouseDown: normalizeMouseEventHandler,
  mouseUp: normalizeMouseEventHandler,
  mouseEnter: normalizeMouseEventHandler,
  mouseLeave: normalizeMouseEventHandler,
  mouseOver: normalizeMouseEventHandler,
  mouseOut: normalizeMouseEventHandler,
  mouseMove: normalizeMouseEventHandler,
  dialogBackdropClick: normalizeMouseEventHandler,
  clickAway: normalizeMouseEventHandler,

  // Drag events (also mouse events)
  drag: normalizeMouseEventHandler,
  dragStart: normalizeMouseEventHandler,
  dragEnter: normalizeMouseEventHandler,
  dragLeave: normalizeMouseEventHandler,
  dragOver: normalizeMouseEventHandler,
  dragEnd: normalizeMouseEventHandler,
  drop: normalizeMouseEventHandler,

  // Keyboard events
  keydown: normalizeKeyboardEventHandler,
  keyup: normalizeKeyboardEventHandler,

  // Focus events
  focus: normalizeFocusEventHandler,
  blur: normalizeFocusEventHandler,
  focusin: normalizeFocusEventHandler,
  focusout: normalizeFocusEventHandler,
  focusAway: normalizeFocusEventHandler,

  // Form events
  submit: normalizeFormEventHandler,

  // File events
  fileChange: normalizeFileEventHandler,

  // Clipboard events
  paste: normalizeClipboardEventHandler,

  // Checkbox events
  checkboxChange: normalizeCheckboxEventHandler,

  // Input events
  change: normalizeChangeEventHandler,
  input: normalizeInputEventHandler,
};

/**
 * Normalizes all event handlers on an element
 * Uses specialized normalizers for specific event types
 */
function normalizeElementEventHandlers(
  eventHandlers: Record<string, any>,
): void {
  for (const [eventName, handler] of Object.entries(eventHandlers)) {
    const normalizer = EVENT_HANDLER_NORMALIZERS[eventName];

    if (normalizer) {
      eventHandlers[eventName as yom.EventHandlerName] = normalizer(handler);
    } else {
      // Default to standard event handler normalization
      eventHandlers[eventName as yom.EventHandlerName] = normalizeEventHandler(
        handler,
      );
    }
  }
}

/** The database class of the system. This is the single database that is shared by all apps, api, webhooks, etc.

@category Core, Initial
*/
export class Db {
  /** Default collation for text columns. See {@link https://docs.yolm.io/database/overview | Database overview}. */
  collation = "NoCase" as yom.Collation;
  /** Default auto-trim behaviour for text columns. */
  autoTrim = "Both" as yom.AutoTrim;
  /** When true, the database exposes the `tx` virtual table for transaction queries. */
  enableTransactionQueries = true;
  /** Db-scoped scalar functions registered via {@link Db.scalarFunction}. */
  scalarFunctions: Record<string, ScalarFunction> = {};
  /** Tables registered via {@link Db.table}, keyed by name. */
  tables: Record<string, Table> = {};
  /** Search match configurations driving the navbar search dialog. */
  searchMatches: Record<string, yom.SearchMatchConfig> = {};
  /** Views registered via {@link Db.view}, keyed by name. */
  views: Record<
    string,
    { name: string; query: Sql; description?: string }
  > = {};

  #checkLocked(db_type: string, value: string) {
    if (system.isGlobalsLocked) {
      throw new Error(
        `Cannot modify database schema after core.tsx execution. Tried to add '${db_type}' '${value}'`,
      );
    }
  }

  /**
       Defines a table in the database.

       @param name The name of the table
       @param f The function that defines the table
       */
  table(name: string, f: (builder: TableBuilder) => void) {
    this.#checkLocked("table", name);
    const builder = new TableBuilder(name);
    f(builder);
    this.tables[name] = builder.finish();
    this.tables[name].blockStack = system.blockStack.slice();
  }

  /**
   * Defines a view in the database. Views are read-only SQL queries
   * addressable as `db.<name>` from elsewhere in the system.
   */
  view(name: string, query: Sql, description?: string) {
    this.#checkLocked("view", name);
    this.views[name] = {
      name,
      query,
      description,
    };
  }

  /** True if a table with the given name has been registered. */
  hasTable(name: string) {
    return name in this.tables;
  }

  /** True if every table in `names` has been registered. */
  hasTables(names: string[]) {
    return names.every((name) => name in this.tables);
  }

  /** Return every table that has been associated with the given table block. */
  getTablesWithBlock(block: TableBlockConstructor<any>): Table[] {
    return Object.entries(this.tables)
      .filter(([_, table]) => table.hasBlock(block))
      .map(([table]) => this.tables[table]);
  }

  /**
   * Define a db-scoped scalar function (one that may read from the
   * database). For system-level scalar functions that may not touch the
   * database, use {@link System.scalarFunction}.
   */
  scalarFunction(f: HelperScalarFunction) {
    this.#checkLocked("scalar function", f.name);
    this.scalarFunctions[f.name] = scalarFunctionFromHelper(f);
  }

  /**
   * Define a db-scoped rules function — a specialized scalar function
   * whose body is a decision table.
   */
  rulesFunction(f: RulesFunction) {
    this.#checkLocked("rules function", f.name);
    const firstRow = f.rules[0];
    firstRow[firstRow.length - 1] = sql`output`;
    this.scalarFunction({
      name: f.name,
      description: f.description,
      parameters: f.parameters,
      returnType: f.returnType,
      procedure: (s) =>
        s
          .statements(f.setup)
          .evalRules(...f.rules)
          .return(sql`output`),
    });
  }

  /** Generate the YOM representation of this database. */
  generateYom(): yom.Database {
    return {
      collation: system.db.collation,
      autoTrim: system.db.autoTrim,
      enableTransactionQueries: system.db.enableTransactionQueries,
      scalarFunctions: Object.values(system.db.scalarFunctions).map(
        generateScalarFunction,
      ),
      tables: Object.values(system.db.tables).map((t) => t.generateYom()),
      searchMatches: Object.values(system.db.searchMatches),
      views: Object.values(system.db.views).map((v) => ({
        name: v.name,
        query: v.query.toYOM(),
      })),
    };
  }

  /**
   * Heuristic for whether `tableName` is a framework / general-purpose
   * table (system, datagrid, webhook, auth) rather than an
   * application-defined "solution" table.
   */
  isGeneralTable(tableName: string) {
    return (
      tableName.startsWith("sys_") ||
      tableName.includes("datagrid") ||
      tableName.includes("webhook") ||
      tableName.includes("auth_")
    );
  }

  /** Return documentation for the non-virtual fields of `table`. */
  getTableFields(table: Table): FieldDoc[] {
    const fields: FieldDoc[] = [];
    for (const f of Object.values(table.fields)) {
      const fieldDoc: FieldDoc = {
        name: f.name,
        type: this.getFieldType(f),
        required: f.notNull,
        default: f.default !== undefined
          ? sql.exprToString(f.default)
          : f.default,
        description: f.description,
      };
      if (f.type === "Enum") {
        fieldDoc.enum = f.enum;
      } else if (f.type === "ForeignKey") {
        fieldDoc.references = f.table;
        fieldDoc.onDelete = f.onDelete;
      } else if (f.type === "String" || f.type === "Bytes") {
        fieldDoc.maxLength = f.maxLength;
        fieldDoc.minLength = f.minLength;
      } else if (f.type === "Decimal") {
        fieldDoc.precision = f.precision;
        fieldDoc.scale = f.scale;
        fieldDoc.signed = f.signed;
      }
      fields.push(fieldDoc);
    }
    return fields;
  }

  /** Return documentation for the virtual (computed) fields of `table`. */
  getTableVirtualFields(table: Table): VirtualFieldDoc[] {
    return Object.values(table.virtuals).map((v) => {
      let explicitType: string | undefined;
      if (v.type) {
        switch (v.type.type) {
          case "String":
            explicitType = "string";
            break;
          case "Int":
            explicitType = "int";
            break;
          case "Real":
            explicitType = "float";
            break;
          case "Decimal":
            explicitType = "float";
            break;
          case "Bool":
            explicitType = "boolean";
            break;
          case "Date":
            explicitType = "date";
            break;
          case "Time":
            explicitType = "time";
            break;
          case "BigInt":
            explicitType = "int";
            break;
          case "SmallInt":
            explicitType = "int";
            break;
          case "Ordering":
            explicitType = "ordering";
            break;
          case "Double":
            explicitType = "float";
            break;
          case "Timestamp":
            explicitType = "timestamp";
            break;
          case "TimestampTz":
            explicitType = "timestamp";
            break;
          case "Uuid":
            explicitType = "uuid";
            break;
          case "Json":
            explicitType = "json";
            break;
          case "PhoneNumber":
            explicitType = "phone_number";
            break;
          case "Enum":
            explicitType = `enum(${v.type.enum})`;
            break;
        }
      }
      return {
        name: v.name,
        expr: v.expr.toSQL(),
        explicitType,
        description: v.description,
      };
    });
  }

  /** Produce per-table documentation for {@link System.generateDocs}. */
  generateTableDocs(): TableDoc[] {
    const tableDocs: TableDoc[] = [];
    const sortedTables = Object.keys(this.tables).sort();
    for (const tableName of sortedTables) {
      const table = this.tables[tableName];
      let fromBlock: string | undefined;
      if (table.blockStack && table.blockStack.length > 0) {
        fromBlock = table.blockStack[0]?.block?.blockName;
      }
      const tableDoc: TableDoc = {
        name: tableName,
        isSolutionTable: !this.isGeneralTable(tableName),
        fromBlock,
        fields: this.getTableFields(table),
        virtualFields: this.getTableVirtualFields(table),
      };
      tableDocs.push(tableDoc);
    }
    return tableDocs;
  }

  /** Produce per-view documentation for {@link System.generateDocs}. */
  generateViewDocs(): ViewDoc[] {
    return Object.values(this.views).map((v) => ({
      name: v.name,
      query: v.query.toSQL(),
      description: v.description,
    }));
  }

  /** Produce documentation for enums actually referenced by tables in this db. */
  generateEnumDocs(): DbEnumDoc[] {
    const enumsReferencedInDocs: Set<string> = new Set();
    for (const table of Object.values(this.tables)) {
      for (const field of Object.values(table.fields)) {
        if (field.type === "Enum") {
          enumsReferencedInDocs.add(field.enum);
        }
      }
    }
    return Object.values(system.enums)
      .filter((sql) => enumsReferencedInDocs.has(sql.name))
      .map((sql) => ({
        name: sql.name,
        values: Object.values(sql.values).map((v) => ({
          name: v.name,
          description: v.description,
        })),
      }));
  }

  /** Streaming variant of {@link Db.generateYom} for the JIT generator. */
  generateYom2() {
    YolmGenApi.setDatabaseConfig({
      collation: this.collation,
      autoTrim: this.autoTrim,
      enableTransactionQueries: this.enableTransactionQueries,
    });
    for (const fn of Object.values(this.scalarFunctions)) {
      YolmGenApi.addDbScalarFunction(generateScalarFunction(fn));
    }
    for (const table of Object.values(this.tables)) {
      YolmGenApi.addTable(table.generateYom());
    }
    for (const view of Object.values(this.views)) {
      YolmGenApi.addView({ name: view.name, query: view.query.toYOM() });
    }
    for (const searchMatch of Object.values(this.searchMatches)) {
      YolmGenApi.addSearchMatchConfig(searchMatch);
    }
  }

  /** Produce the combined tables / views / enums documentation for the db. */
  generateDbDocs(): DbDoc {
    return {
      tables: this.generateTableDocs(),
      views: this.generateViewDocs(),
      enums: this.generateEnumDocs(),
    };
  }

  private getFieldType(field: Field): string {
    switch (field.type) {
      case "Bytes":
        return "bytes";
      case "String":
        return "string";
      case "TinyUint":
        return "tiny_uint";
      case "SmallUint":
        return "small_uint";
      case "Uint":
        return "uint";
      case "BigUint":
        return "big_uint";
      case "TinyInt":
        return "tiny_int";
      case "SmallInt":
        return "small_int";
      case "Int":
        return "int";
      case "BigInt":
        return "big_int";
      case "Real":
        return "real";
      case "Decimal":
        return "decimal";
      case "Double":
        return "double";
      case "Bool":
        return "boolean";
      case "Date":
        return "date";
      case "Time":
        return "time";
      case "TimestampUtc":
        return "timestamp_utc";
      case "TimestampNaive":
        return "timestamp_naive";
      case "TimestampTz":
        return "timestamp_tz";
      case "Uuid":
        return "uuid";
      case "Json":
        return "json";
      case "Ordering":
        return "ordering";
      case "PhoneNumber":
        return "phone_number";
      case "Tx":
        return "tx";
      case "Enum":
        return "enum";
      case "ForeignKey":
        return "foreign_key";
    }
  }
}

/** Time parameter - accepts Date object or ISO string */
export type TimeParam = Date | string;

function normalizeTime(time: TimeParam): string {
  return time instanceof Date ? time.toISOString() : time;
}

/** Options for test() when using the short form */
export interface TestOptions {
  /** Test execution time. Falls back to defaultTime if not provided. */
  time?: TimeParam;
  /** Test data name. Falls back to defaultData if not provided. */
  data?: string;
  /** Random seed for deterministic tests */
  seed?: number;
  /** Skip this test */
  skip?: boolean;
  /** Run only this test */
  only?: boolean;
}

/** Full test configuration object passed to the long form of `system.test(...)`. */
export interface TestConfig extends TestOptions {
  /** Test name. Auto-prefixed with the caller's file stem. */
  name: string;
  /** Test body. */
  procedure: TestStatementsOrFn;
}

/**
 * Holds the system's test data sets and test cases. Accessed via
 * {@link System.test} (which is callable; see {@link CallableTest}).
 *
 * See {@link https://docs.yolm.io/testing/overview | Testing}.
 */
export class Test {
  #data: yom.TestData[] = [];
  #tests: yom.Test[] = [];

  /** Default time for tests. Set this to avoid passing time to every test. */
  defaultTime?: TimeParam;
  /** Default test data name. Set this to avoid passing data to every test. */
  defaultData?: string;

  /**
   * Register a named test data set built procedurally. `procedure` runs
   * once and seeds the database used by tests that reference `name`.
   */
  testDataProc(name: string, time: TimeParam, procedure: BasicStatementsOrFn) {
    this.#data.push({
      name,
      time: normalizeTime(time),
      procedure: BasicStatements.normalizeToArray(procedure),
    });
  }

  /** Register a named test data set loaded from a directory of seed files. */
  testDataDir(name: string, dir: string) {
    this.#data.push({
      name,
      dir,
    });
  }

  /**
   * Define a test.
   *
   * Overloads:
   * - `test(name, procedure)` - Uses defaultTime and defaultData
   * - `test(name, options, procedure)` - Uses options with defaults as fallback
   * - `test(config)` - Full configuration object
   *
   * @example
   * // Simple form (uses defaults)
   * system.test("my test", (s) => {
   *   s.assertEqual(sql`1 + 1`, sql`2`);
   * });
   *
   * @example
   * // With options
   * system.test("my test", { time: "2025-01-15T12:00:00Z" }, (s) => {
   *   s.assertEqual(sql`1 + 1`, sql`2`);
   * });
   *
   * @example
   * // Full config object
   * system.test({
   *   name: "my test",
   *   data: "custom_data",
   *   time: new Date("2025-01-15"),
   *   procedure: (s) => { ... }
   * });
   */
  test(name: string, procedure: TestStatementsOrFn): void;
  test(name: string, options: TestOptions, procedure: TestStatementsOrFn): void;
  test(config: TestConfig): void;
  test(
    nameOrConfig: string | TestConfig,
    optionsOrProcedure?: TestOptions | TestStatementsOrFn,
    maybeProcedure?: TestStatementsOrFn,
  ): void {
    let name: string;
    let time: TimeParam | undefined;
    let data: string | undefined;
    let seed: number | undefined;
    let skip: boolean | undefined;
    let only: boolean | undefined;
    let procedure: TestStatementsOrFn;

    if (typeof nameOrConfig === "string") {
      name = nameOrConfig;
      if (
        typeof optionsOrProcedure === "function" ||
        optionsOrProcedure instanceof TestStatements
      ) {
        // test(name, procedure)
        procedure = optionsOrProcedure;
      } else if (optionsOrProcedure && maybeProcedure) {
        // test(name, options, procedure)
        const opts = optionsOrProcedure as TestOptions;
        time = opts.time;
        data = opts.data;
        seed = opts.seed;
        skip = opts.skip;
        only = opts.only;
        procedure = maybeProcedure;
      } else {
        throw new Error("test() requires a procedure function");
      }
    } else {
      // test(config)
      const config = nameOrConfig;
      name = config.name;
      time = config.time;
      data = config.data;
      seed = config.seed;
      skip = config.skip;
      only = config.only;
      procedure = config.procedure;
    }

    // Auto-prefix test name with caller file stem
    const fileStem = getCallerFileStem();
    if (fileStem) {
      name = `${fileStem}/${name}`;
    }

    // Apply defaults
    const resolvedTime = time ?? this.defaultTime;
    const resolvedData = data ?? this.defaultData;

    if (!resolvedTime) {
      throw new Error(
        `test "${name}": no time provided and no defaultTime set`,
      );
    }
    if (!resolvedData) {
      throw new Error(
        `test "${name}": no data provided and no defaultData set`,
      );
    }

    this.#tests.push({
      name,
      time: normalizeTime(resolvedTime),
      seed,
      skip,
      only,
      data: resolvedData,
      procedure: TestStatements.normalizeToArray(procedure),
    });
  }

  /** Build the YOM test model (data sets + cases). */
  generateYom(): yom.TestModel {
    return {
      data: this.#data,
      api: this.#tests,
    };
  }

  /** Streaming variant of {@link Test.generateYom} for the JIT generator. */
  generateYom2() {
    for (const data of this.#data) {
      YolmGenApi.addTestData(data);
    }
    for (const test of this.#tests) {
      YolmGenApi.addApiTest(test);
    }
  }
}

/**
 * A callable Test interface - can be called directly as a function or used via methods.
 *
 * @example
 * // Call directly
 * system.test("my test", (s) => { ... });
 *
 * // Or use methods
 * system.test.testDataProc("name", time, proc);
 * system.test.test("name", (s) => { ... });
 */
export interface CallableTest {
  /** Define a test (simple form with defaults) */
  (name: string, procedure: TestStatementsOrFn): void;
  /** Define a test with options */
  (name: string, options: TestOptions, procedure: TestStatementsOrFn): void;
  /** Define a test with full config */
  (config: TestConfig): void;

  /** Default time for tests. Set this to avoid passing time to every test. */
  defaultTime?: TimeParam;
  /** Default test data name. Set this to avoid passing data to every test. */
  defaultData?: string;

  /** Define test data from a procedure */
  testDataProc(
    name: string,
    time: TimeParam,
    procedure: BasicStatementsOrFn,
  ): void;
  /** Define test data from a directory */
  testDataDir(name: string, dir: string): void;
  /** Define a test (same as calling the function directly) */
  test: {
    (name: string, procedure: TestStatementsOrFn): void;
    (name: string, options: TestOptions, procedure: TestStatementsOrFn): void;
    (config: TestConfig): void;
  };
  /** Generate YOM output */
  generateYom(): yom.TestModel;
  /** Generate YOM output (alternate) */
  generateYom2(): void;
}

/**
 * Creates a callable Test object that can be used as both a function and object with methods.
 */
export function createCallableTest(): CallableTest {
  const testInstance = new Test();

  // Create the callable function
  const callable = function (
    nameOrConfig: string | TestConfig,
    optionsOrProcedure?: TestOptions | TestStatementsOrFn,
    maybeProcedure?: TestStatementsOrFn,
  ) {
    // @ts-ignore - we're calling with the same signature as test()
    testInstance.test(nameOrConfig, optionsOrProcedure, maybeProcedure);
  } as CallableTest;

  // Copy methods from the Test instance
  callable.testDataProc = testInstance.testDataProc.bind(testInstance);
  callable.testDataDir = testInstance.testDataDir.bind(testInstance);
  callable.test = testInstance.test.bind(testInstance);
  callable.generateYom = testInstance.generateYom.bind(testInstance);
  callable.generateYom2 = testInstance.generateYom2.bind(testInstance);

  // Create property descriptors for defaultTime and defaultData
  Object.defineProperty(callable, "defaultTime", {
    get: () => testInstance.defaultTime,
    set: (value: TimeParam | undefined) => {
      testInstance.defaultTime = value;
    },
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(callable, "defaultData", {
    get: () => testInstance.defaultData,
    set: (value: string | undefined) => {
      testInstance.defaultData = value;
    },
    enumerable: true,
    configurable: true,
  });

  return callable;
}

/**
 * A multi-field check constraint attached to a {@link Table}.
 *
 * Single-field checks live on each {@link FieldBase.checks} instead.
 */
export interface Check {
  /** Names of the fields involved in the check. */
  fields: string[];
  /** Predicate that must hold for the row to be valid. */
  check: (fields: AnyExpr[]) => BooleanExpr;
  /** Builds the error message shown when the check fails. */
  errorMessage: (fields: AnyExpr[]) => Sql;
}

/** A custom table control is a way to customize the way a table is displayed in the UI. */
export type CustomTableControl = (props: TableControlOpts) => Node;

/** Combobox-style picker for choosing a record from the table. */
export interface TableComboboxControl {
  type: "Combobox";
  /** Custom renderer for each combobox item. */
  displayItem?: (props: { record: Sql }) => Node;
  /** If true, add a "create new" entry that opens an insert dialog. */
  dialogInsert?: boolean;
  /** Query used to populate the dropdown when the input is empty. */
  emptyQuery?: Sql;
  /** Where clause applied to the underlying selection query. */
  where?: Sql;
  /** If set, the combobox will only show the first N results, defaults to 50. */
  limit?: number;
  /** Extra columns selected with the option list (available to displayItem). */
  extraSelectColumns?: SelectColumn[];
}

/** Plain `<select>`-style picker for choosing a record from the table. */
export interface TableSelectControl {
  type: "Select";
  /** Where clause applied to the option list. */
  where?: Sql;
}

/** Discriminated union of supported form controls used to pick a record. */
export type TableControl =
  | TableSelectControl
  | TableComboboxControl
  | { type: "Custom"; f: CustomTableControl };

/** Props passed to a {@link TableControl} (combobox / select / custom). */
export interface TableControlOpts extends ComponentOpts<Size> {
  /** Inline style overrides. */
  sx?: Style;
  /** Extra class name. */
  className?: string;
  /** Element id. */
  id?: Sql | string;
  /** Focus the control on mount. */
  immediateFocus?: boolean;
  /** Currently-selected record id. */
  value: NumericExpr;
  /** Callback receiving the newly-selected record id. */
  onSelectValue?: (s: DomStatements, newValue: NumericExpr) => unknown;
  /** Query used when the input is empty. */
  emptyQuery?: Sql;
  /** Where clause applied to the option query. */
  where?: Sql;
  /** Initial display text shown in the input. */
  initialInputText?: Sql;
  /** When true, the control renders in an error state. */
  error?: BooleanExpr;
  /** Callback receiving the id, label, and full record on combobox selection. */
  onComboboxSelectValue?: (
    s: DomStatements,
    newId: NumericExpr,
    newLabel: Sql,
    record: Sql,
  ) => unknown;
  /** Custom renderer for each combobox option. */
  displayItem?: (props: { record: Sql }) => Node;
  /**
   * If true, the combobox will have an item to add new records, it will
   * open a dialog to add the new record.
   */
  dialogInsert?: boolean;
  /** Placeholder text. */
  placeholder?: Sql | string;
  /** Clear the input after a selection. */
  clearOnSelect?: boolean;
  /** Snackbar shown if no matching combobox entry exists. */
  comboboxNotFoundSnackbar?: Node;
  /** Disable the clear button. */
  disableOnClear?: boolean;
  /** Handler invoked on blur. */
  onBlur?: DomStatementsOrFn;
  /** End decorator rendered inside the input. */
  endDecorator?: Node;
  /** Suppress the empty-list popover. */
  comboboxNoEmptyList?: boolean;
  /** Extra columns selected with the option list (available to renderers). */
  extraSelectColumns?: SelectColumn[];
}

/** Per-table configuration consumed by the sample-data generator. */
export interface TableSampleDataConfig {
  /**
   * Custom generation logic that handles the entire table's data
   * generation, including related records.
   */
  generateRecord?: (
    s: IServerBaseStatements,
    ctx: SampleDataScriptContext,
  ) => void;

  /** Skip generating sample data for this table. */
  skipSampleData?: boolean;

  /** Base count when table is the root of generation. */
  baseCount?: number;

  /** Control order when multiple tables could be root tables. */
  generationPriority?: number;
}

/**
 * A finalized database table. Produced by {@link TableBuilder.finish} and
 * stored in {@link Db.tables}. Application code rarely instantiates this
 * directly; use {@link Db.table} via the {@link TableBuilder} fluent API.
 *
 * See {@link https://docs.yolm.io/database/overview | Database overview}.
 */
export class Table {
  /** Old name this table was renamed from (used during deploys/upgrades). */
  renameFrom?: string;
  /** Block frames active when this table was added. */
  blockStack?: BlockFrame[];
  #blocks: Map<TableBlockConstructor<any>, TableBlock[]> = new Map();
  /** Fields on this table, keyed by name. */
  fields: Record<string, Field> = {};
  /** Field group definitions. */
  fieldGroups: Record<string, unknown> = {};
  /** Virtual (computed) fields, keyed by name. */
  virtuals: Record<string, VirtualField> = {};
  /** Multi-field unique constraints. */
  uniqueConstraints: yom.UniqueConstraint[] = [];
  /** Multi-field check constraints. */
  checks: Check[] = [];

  /** Configuration for building a human-readable record name. */
  recordDisplayName?: RecordDisplayName;
  /** Inline renderer used when a record is referenced inline in the UI. */
  inlineRecordDisplay?: (props: {
    id: NumericExpr;
    className?: string;
    sx?: Style;
  }) => Node;
  #searchConfig?: RankedSearchTable;
  /** Default form control used to pick records from this table. */
  control?: TableControl;

  /**
   * Get the search configuration for this table. This method can be overridden by blocks
   * to provide dynamic search configurations based on context (e.g. user language).
   */
  getSearchConfig(): RankedSearchTable | undefined {
    return this.#searchConfig;
  }

  /** Rough expected row count (informs query planning hints). */
  expectedOrderOfMagnitude?: number;
  /** Free-text description surfaced in generated docs. */
  description?: string;
  /** Base URL fragment used when generating routes and api endpoints. */
  baseUrl = "";

  /** Skip the auto-generated api endpoints for this table. */
  skipAutoApi = false;
  /** SQL identifier for the table (e.g. ``sql.ref("users")``). */
  ident: Sql;
  /** SQL identifier including the database name. */
  identWithDb: Sql;
  /** SQL identifier for the primary key field. */
  primaryKeyIdent: Sql;
  /** SQL identifier for the primary key field qualified by the table. */
  primaryKeyIdentWithTable: Sql;
  /** Configuration consumed by the sample-data generator. */
  sampleDataConfig?: TableSampleDataConfig;
  /** Optional time-to-live setting for automatic row pruning. */
  ttl?: TableTtl;
  /** Enable automatic compaction for this table. */
  autoCompact?: boolean;
  /** Reject updates/deletes against this table; rows may only be inserted. */
  insertOnly?: boolean;

  /** Free-form extension storage for blocks and tooling. */
  ext: Record<string, any> = {};

  constructor(
    db: string,
    public primaryKeyFieldName: string,
    public name: string,
    public displayName: string,
    searchConfig?: RankedSearchTable,
  ) {
    this.ident = sql.ref(name);
    this.identWithDb = sql.ref(db, name);
    this.primaryKeyIdent = sql.ref(primaryKeyFieldName);
    this.primaryKeyIdentWithTable = sql.ref(name, primaryKeyFieldName);
    this.#searchConfig = searchConfig;
  }

  /** True if at least one instance of `block` is attached to this table. */
  hasBlock(block: TableBlockConstructor<any>) {
    return this.#blocks.has(block);
  }

  /**
   * Attach a {@link TableBlock} instance to the table. Throws if the same
   * block class is added twice and {@link TableBlock.allowMultipleInstances}
   * is `false`.
   */
  addBlock<T>(block: TableBlock<T>): TableBlock<T> {
    const ctor = block.constructor as TableBlockConstructor<T>;
    // Initialize block map if it doesn't exist
    if (this.hasBlock(ctor)) {
      if (!block.allowMultipleInstances) {
        throw new Error(
          `Block ${block.blockName} does not support multiple instances`,
        );
      }
      this.#blocks.get(ctor)!.push(block as TableBlock<EmptyProps>);
    } else {
      this.#blocks.set(ctor, [block as TableBlock<EmptyProps>]);
    }
    return block;
  }

  /**
   * Return the single instance of `tableBlock` attached to this table.
   * Throws if it is not attached or attached more than once.
   */
  block<T extends TableBlock>(tableBlock: new (...args: any[]) => T): T {
    if (!this.hasBlock(tableBlock)) {
      throw new Error(`Block ${tableBlock} not found for table ${this.name}`);
    }
    const blocks = this.#blocks.get(tableBlock);
    if (!blocks) {
      throw new Error(`Block ${tableBlock} not found for table ${this.name}`);
    }
    if (blocks.length !== 1) {
      throw new Error(
        `Block ${tableBlock} found ${blocks.length} times, expected 1`,
      );
    }
    return blocks[0] as T;
  }

  /** Return every instance of `tableBlock` attached to this table (possibly empty). */
  blocks<T extends TableBlock>(tableBlock: new (...args: any[]) => T): T[] {
    if (!this.hasBlock(tableBlock)) {
      return [];
    }
    return (this.#blocks.get(tableBlock) ?? []) as T[];
  }

  /** Return every block instance attached to this table. */
  allBlocks(): TableBlock[] {
    return Array.from(this.#blocks.values()).flat();
  }

  /**
   * Like {@link Table.block} but returns `undefined` when the block is not
   * attached. Throws if it is attached more than once.
   */
  blockOptional<T extends TableBlock>(
    ctor: new (...args: any[]) => T,
  ): T | undefined {
    if (this.#blocks.has(ctor)) {
      const blocks = this.#blocks.get(ctor)!;
      if (blocks.length === 1) {
        return blocks[0] as T;
      }
      throw new Error(`Block ${ctor} found ${blocks.length} times, expected 1`);
    }
  }

  /**
       The base url for the table, this is the pluralized name of the table and made kebab-case.

       This is used for the api, ui and other places where the table name is used in a url.
       */
  getBaseUrl() {
    return pluralize(this.name.split("_").join(" ")).split(" ").join("-");
  }

  /**
   * Build a SQL expression that yields a record's display name. Optionally
   * scoped to a specific record alias.
   *
   * @throws if {@link Table.recordDisplayName} has not been configured.
   */
  getRecordDisplayNameExpr(record?: Sql) {
    const displayNameFn = this.recordDisplayName;
    if (!displayNameFn) {
      throw new Error(`table ${this.name} has no recordDisplayName`);
    }
    return displayNameFn.expr(
      ...displayNameFn.fields.map(
        (f) => sql`${record ?? this.ident}.${sql.ref(f)}`,
      ),
    );
  }

  /**
       Get the field which is a foreign key to the given table, if any.

       Returns the first foreign key field found.
       */
  getFkFieldToTable(table: string): ForeignKeyField | undefined {
    return Object.values(this.fields).find(
      (f) => f.type === "ForeignKey" && f.table === table,
    ) as ForeignKeyField | undefined;
  }

  /** Build the YOM representation of this table (fields, virtuals, checks, etc.). */
  generateYom(): yom.Table {
    const checks = this.checks.map((c) =>
      c.check(c.fields.map((s) => sql.ref(s)))
    );
    const fields = Object.values(this.fields).map((f): yom.TableField => {
      for (const check of f.checks) {
        checks.push(check.check(sql.ref(f.name)));
      }
      return {
        name: f.name,
        renameFrom: f.renameFrom,
        description: f.description,
        notNull: f.notNull,
        default: f.default !== undefined ? sql.toYOM(f.default) : f.default,
        type: f.generateYomFieldType(),
      };
    });
    return {
      primaryKeyFieldName: this.primaryKeyFieldName,
      name: this.name,
      renameFrom: this.renameFrom,
      description: this.description,
      ttl: this.ttl
        ? {
          fieldName: this.ttl.fieldName,
          expr: sql.toYOM(this.ttl.expr),
        }
        : undefined,
      autoCompact: this.autoCompact,
      insertOnly: this.insertOnly,
      uniqueConstraints: this.uniqueConstraints,
      checks: checks.map((check) => sql.toYOM(check)),
      fields,
      virtuals: Object.values(this.virtuals).map((v) => ({
        name: v.name,
        expr: sql.toYOM(v.expr),
        type: v.type,
      })),
    };
  }
}

/** This indicates how to get a display name of any record of the table. */
export interface RecordDisplayName {
  /** Field names whose values are passed to `expr`. */
  fields: string[];
  /** Combine the field values into the display string. */
  expr: (...fields: Sql[]) => Sql;
}

/** Single-field check constraint attached to a {@link FieldBase}. */
export interface FieldCheck {
  /** Predicate that must hold for the value to be valid. */
  check: (field: AnyExpr) => BooleanExpr;
  /** Builds the error message shown when the check fails. */
  errorMessage: (field: AnyExpr) => Sql;
}

/** Per-field configuration consumed by the sample-data generator. */
export interface FieldSampleDataConfig {
  /** Custom generator function. */
  generator?: (ctx: SampleDataScriptContext) => AnyExpr;

  /** Probability of `null` for nullable fields (0..1). */
  nullProbability?: number;

  /** For foreign keys: strategy for selecting/creating related records. */
  foreignKeyStrategy?: {
    type: "existing" | "new" | "mixed";
    /** For `"mixed"`: probability of creating new vs using existing. */
    newProbability?: number;
    /** Criteria for selecting existing records. */
    selectionCriteria?: (record: any) => boolean;
  };

  /** Value constraints beyond the basic type constraints. */
  constraints?: {
    unique?: boolean;
    pattern?: RegExp;
    custom?: (value: any) => boolean;
  };
}

/**
 * Common base for every finalized field type. Holds shared metadata
 * (`notNull`, `default`, `checks`, ...) populated by the matching
 * {@link BaseFieldBuilder}.
 */
abstract class FieldBase {
  /** Old field name preserved across renames. */
  renameFrom?: string;
  /** Whether the field is NOT NULL. */
  notNull = false;
  /** Single-field check constraints. */
  checks: FieldCheck[] = [];
  /** Single-field unique constraint flag. */
  unique = false;
  /** Free-text description surfaced in generated docs. */
  description?: string;
  /** Default value expression. */
  default?: AnyExpr;
  /** Name of the field group this field belongs to. */
  group?: string;
  /** Free-form extension storage for blocks and tooling. */
  ext: Record<string, any> = {};
  /** Type this should be cast into. */
  abstract castType: string;
  /** SQL identifier for this field. */
  ident: Sql;
  /** SQL identifier qualified by the parent table. */
  identWithTable: Sql;
  /** Block that introduced the field, if any. */
  createdByBlock?: Block;
  /** Sample-data config for the field. */
  sampleDataConfig?: FieldSampleDataConfig;

  constructor(
    table: string,
    public name: string,
    public displayName: string,
  ) {
    this.ident = sql.ref(name);
    this.identWithTable = sql.ref(table, name);
  }

  /** True if the field is one of the integer variants. */
  isInteger() {
    return false;
  }
  /** True if the field is numeric (integer / float / decimal). */
  isNumeric() {
    return false;
  }
  /** True if the field is a variable-precision floating-point type. */
  isVariablePrecision() {
    return false;
  }

  /** Hook called after the field is added to its table. */
  finalize() {}

  /** YOM representation of this field's type. */
  abstract generateYomFieldType(): yom.FieldType;

  /** Build a SQL `cast(expr as <castType>)` for this field's type. */
  castToType(ex: AnyExpr) {
    return sql`cast(${ex} as ${sql(this.castType)})`;
  }

  /** Build a SQL `try_cast(expr as <castType>)` for this field's type. */
  tryCastToType(ex: AnyExpr) {
    return sql`try_cast(${sql.parenWrap(ex)} as ${sql(this.castType)})`;
  }
}

/** Tag attached to a {@link StringField} to mark its semantic usage. */
export type StringUsage =
  | { type: "Email" }
  | { type: "PhoneNumber"; country?: string }
  | { type: "URL" }
  | { type: "HexColor" };

/** Options for a phone-number {@link StringUsage} on a {@link StringField}. */
export interface PhoneNumberStringOptions {
  /** ISO-3166 two-letter country code used for assisted formatting. */
  country?: string;
}

/** Variable-length string field. */
export class StringField extends FieldBase {
  type = "String" as const;
  castType = "string";
  collation?: yom.Collation;
  minLength?: number;
  maxBytesPerChar?: number;
  autoTrim?: yom.AutoTrim;
  multiline?: boolean;
  usage?: StringUsage;

  constructor(
    table: string,
    name: string,
    displayName: string,
    public maxLength: number,
  ) {
    super(table, name, displayName);
  }

  generateYomFieldType(): yom.FieldType {
    return {
      type: "String",
      maxLength: this.maxLength,
      maxBytesPerChar: this.maxBytesPerChar,
      collation: this.collation,
      autoTrim: this.autoTrim,
      minLength: this.minLength,
    };
  }
}

/** Variable-length binary blob field. Use {@link TableBuilder.secret} for encrypted bytes. */
export class BytesField extends FieldBase {
  type = "Bytes" as const;
  castType = "bytes";
  minLength?: number;
  usage?: SecretUsage;

  constructor(
    table: string,
    name: string,
    displayName: string,
    public maxLength: number,
  ) {
    super(table, name, displayName);
  }

  generateYomFieldType(): yom.FieldType {
    return {
      type: "Bytes",
      maxLength: this.maxLength,
    };
  }
}

/** Shared base for every numeric field (integers and floats). */
abstract class NumericFieldBase extends FieldBase {
  /** Optional inclusive minimum. */
  min?: NumericExpr;
  /** Optional inclusive maximum. */
  max?: NumericExpr;

  override isNumeric() {
    return true;
  }
}

/** Granularity of a {@link DurationUsage}. */
export type DurationSize = "seconds" | "minutes" | "hours";

/** Tag applied to an integer field to mark it as a duration. */
export interface DurationUsage {
  type: "Duration";
  size: DurationSize;
}

/** Supported currencies for {@link MoneyUsage}. */
export type Currency = "USD";

/** Tag applied to an integer / decimal field to mark it as a money value. */
export interface MoneyUsage {
  type: "Money";
  currency: Currency;
}

/** Discriminated tag attached to an integer field describing what it represents. */
export type IntegerUsage = DurationUsage | MoneyUsage;

/** Shared base for every integer field type. */
abstract class IntegerFieldBase extends NumericFieldBase {
  /** Optional semantic tag (Money, Duration). */
  usage?: IntegerUsage;

  override isInteger(): boolean {
    return true;
  }
}

/** Unsigned 8-bit integer. */
export class TinyUintField extends IntegerFieldBase {
  type = "TinyUint" as const;
  castType = "smallint";

  generateYomFieldType(): yom.FieldType {
    return { type: "TinyUint" };
  }
}
/** Unsigned 16-bit integer. */
export class SmallUintField extends IntegerFieldBase {
  type = "SmallUint" as const;
  castType = "int";

  generateYomFieldType(): yom.FieldType {
    return { type: "SmallUint" };
  }
}
/** Unsigned 32-bit integer. */
export class UintField extends IntegerFieldBase {
  type = "Uint" as const;
  castType = "bigint";

  generateYomFieldType(): yom.FieldType {
    return { type: "Uint" };
  }
}
/** Unsigned 64-bit integer. */
export class BigUintField extends IntegerFieldBase {
  type = "BigUint" as const;
  castType = "bigint";

  generateYomFieldType(): yom.FieldType {
    return { type: "BigUint" };
  }
}
/** Signed 8-bit integer. */
export class TinyIntField extends IntegerFieldBase {
  type = "TinyInt" as const;
  castType = "smallint";

  generateYomFieldType(): yom.FieldType {
    return { type: "TinyInt" };
  }
}
/** Signed 16-bit integer. */
export class SmallIntField extends IntegerFieldBase {
  type = "SmallInt" as const;
  castType = "smallint";

  generateYomFieldType(): yom.FieldType {
    return { type: "SmallInt" };
  }
}
/** Signed 32-bit integer. */
export class IntField extends IntegerFieldBase {
  type = "Int" as const;
  castType = "int";

  generateYomFieldType(): yom.FieldType {
    return { type: "Int" };
  }
}
/** Signed 64-bit integer. */
export class BigIntField extends IntegerFieldBase {
  type = "BigInt" as const;
  castType = "bigint";

  generateYomFieldType(): yom.FieldType {
    return { type: "BigInt" };
  }
}

/** Union of every integer field variant. */
export type IntegerField =
  | TinyUintField
  | TinyIntField
  | SmallUintField
  | SmallIntField
  | UintField
  | IntField
  | BigUintField
  | BigIntField;

/** 32-bit floating-point field. */
export class RealField extends NumericFieldBase {
  type = "Real" as const;
  castType = "real";
  override isVariablePrecision(): boolean {
    return true;
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "Real" };
  }
}
/** 64-bit floating-point field. */
export class DoubleField extends NumericFieldBase {
  type = "Double" as const;
  castType = "double";
  override isVariablePrecision(): boolean {
    return true;
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "Double" };
  }
}

/** Discriminated tag attached to a decimal field. */
export type DecimalUsage = MoneyUsage | { type: "Percentage" };

/** Fixed-point decimal field with explicit precision and scale. */
export class DecimalField extends NumericFieldBase {
  type = "Decimal" as const;
  castType: string;
  usage?: DecimalUsage;
  constructor(
    tableName: string,
    name: string,
    displayName: string,
    public precision: number,
    public scale: number,
    public signed: boolean,
  ) {
    super(tableName, name, displayName);
    this.castType = `decimal(${precision}, ${scale})`;
  }

  generateYomFieldType(): yom.FieldType {
    return {
      type: "Decimal",
      precision: this.precision,
      scale: this.scale,
      signed: this.signed,
    };
  }
}

/** Union of every numeric field variant (integers, floats, decimal). */
export type NumericFields =
  | TinyUintField
  | TinyIntField
  | SmallUintField
  | SmallIntField
  | UintField
  | IntField
  | BigUintField
  | BigIntField
  | RealField
  | DoubleField
  | DecimalField;

/** Calendar date (no time component). */
export class DateField extends FieldBase {
  type = "Date" as const;
  castType = "date";
  formatString?: string;

  formatExpr(expr: Sql) {
    return sql`format.date(${expr}, ${
      sql.lit(this.formatString ?? "%-d %b %Y")
    })`;
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "Date" };
  }
}

/** Time of day (no date component). */
export class TimeField extends FieldBase {
  type = "Time" as const;
  castType = "time";
  formatString?: string;

  formatExpr(expr: Sql) {
    return sql`format.date(${expr}, ${
      sql.lit(this.formatString ?? "%l:%M%p")
    })`;
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "Time" };
  }
}

/** UTC-normalized timestamp. */
export class TimestampUtcField extends FieldBase {
  type = "TimestampUtc" as const;
  castType = "timestamptz";
  formatString?: string;

  formatExpr(expr: Sql) {
    const formatString = this.formatString ?? "%-d %b %Y %l:%M%p";
    return sql`format.date(${expr}, ${sql.lit(formatString)})`;
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "TimestampUtc" };
  }
}

/** Timezone-less ("naive") timestamp. Supports `min` / `max` bounds. */
export class TimestampNaiveField extends FieldBase {
  type = "TimestampNaive" as const;
  castType = "timestamp";
  formatString?: string;
  min?: Sql;
  max?: Sql;

  formatExpr(expr: Sql) {
    const formatString = this.formatString ?? "%-d %b %Y %l:%M%p";
    return sql`format.date(${expr}, ${sql.lit(formatString)})`;
  }

  override finalize(): void {
    if (this.min) {
      this.checks.push({
        check: (field) => sql`${field} > ${this.min!}`,
        errorMessage: () => sql.concat("Value must be greater than ", this.min),
      });
    }
    if (this.max) {
      this.checks.push({
        check: (field) => sql`${field} < ${this.max!}`,
        errorMessage: () => sql.concat("Value must be less than ", this.max),
      });
    }
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "TimestampNaive" };
  }
}

/** Timestamp stored with its original timezone offset. */
export class TimestampTzField extends FieldBase {
  type = "TimestampTz" as const;
  castType = "timestamptz";
  formatString?: string;

  formatExpr(expr: Sql) {
    const formatString = this.formatString ?? "%-d %b %Y %l:%M%p";
    return sql`format.date(${expr}, ${sql.lit(formatString)})`;
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "TimestampTz" };
  }
}

/** Structured phone-number field with optional country restriction. */
export class PhoneNumberField extends FieldBase {
  type = "PhoneNumber" as const;
  castType = "phone_number";
  /** ISO-3166 two-letter country code, if the field is restricted to one country. */
  country?: string;

  override castToType(ex: AnyExpr) {
    return this.country
      ? sql`phone.parse(${ex}, ${sql.lit(this.country)})`
      : super.castToType(ex);
  }

  override tryCastToType(ex: AnyExpr) {
    return this.country
      ? sql`phone.try_parse(${ex}, ${sql.lit(this.country)})`
      : super.tryCastToType(ex);
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "PhoneNumber" };
  }
}

/** Transaction-id field linking each row to the tx that wrote it. */
export class TxField extends FieldBase {
  type = "Tx" as const;
  castType = "bigint";

  generateYomFieldType(): yom.FieldType {
    return { type: "Tx" };
  }
}

/** Display labels used when a {@link BoolField} should render as an enum. */
export interface BoolEnumLikeConfig {
  /** Optional label for `null` (only used with nullable fields). */
  null?: string;
  /** Label shown when the value is `false`. */
  false: string;
  /** Label shown when the value is `true`. */
  true: string;
}

/** Boolean field. Set {@link BoolField.enumLike} to render as an enum picker. */
export class BoolField extends FieldBase {
  type = "Bool" as const;
  castType = "bool";
  enumLike?: BoolEnumLikeConfig;

  generateYomFieldType(): yom.FieldType {
    return { type: "Bool" };
  }
}

/** UUID field. */
export class UuidField extends FieldBase {
  castType = "uuid";
  type = "Uuid" as const;

  generateYomFieldType(): yom.FieldType {
    return { type: "Uuid" };
  }
}

/** JSON field. */
export class JsonField extends FieldBase {
  castType = "json";
  type = "Json" as const;

  generateYomFieldType(): yom.FieldType {
    return { type: "Json" };
  }
}

/** Ordering field used for stable user-controlled ordering. */
export class OrderingField extends FieldBase {
  castType = "ordering";
  type = "Ordering" as const;

  generateYomFieldType(): yom.FieldType {
    return { type: "Ordering" };
  }
}

/** Enum-valued field referencing a {@link System.enum_ | system enum}. */
export class EnumField extends FieldBase {
  type = "Enum" as const;
  enum: string;
  castType: string;
  constructor(
    tableName: string,
    name: string,
    displayName: string,
    _enum: string,
  ) {
    super(tableName, name, displayName);
    this.enum = _enum;
    this.castType = `enums.${_enum}`;
  }

  override tryCastToType(ex: AnyExpr): Sql {
    const values = Object.values(system.enums[this.enum].values);
    values.sort((a, b) => a.name.localeCompare(b.name));
    const castFromDisplayName = sql.caseWhen({
      operand: sql.parenWrap(ex),
      conditions: values.map((v) => ({
        condition: sql.lit(v.displayName),
        expr: sql`cast(${sql.lit(v.name)} as ${sql(this.castType)})`,
      })),
    });
    return sql`coalesce(try_cast(${sql.parenWrap(ex)} as ${
      sql(
        this.castType,
      )
    }), ${castFromDisplayName})`;
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "Enum", enum: this.enum };
  }
}

/**
 * Foreign-key field pointing at another table. See
 * {@link https://docs.yolm.io/database/foreign_keys | Foreign keys}.
 */
export class ForeignKeyField extends FieldBase {
  type = "ForeignKey" as const;
  castType = "bigint";
  constructor(
    tableName: string,
    name: string,
    displayName: string,
    public table: string,
    public onDelete: yom.OnDeleteBehavior,
  ) {
    super(tableName, name, displayName);
  }

  generateYomFieldType(): yom.FieldType {
    return { type: "ForeignKey", onDelete: this.onDelete, table: this.table };
  }
}

/** Union of every finalized field type. */
export type Field =
  | StringField
  | NumericFields
  | DateField
  | ForeignKeyField
  | BoolField
  | EnumField
  | OrderingField
  | UuidField
  | TimestampUtcField
  | TimestampNaiveField
  | TimestampTzField
  | TimeField
  | TxField
  | BytesField
  | JsonField
  | PhoneNumberField;

/** Virtual (computed) field stored alongside a {@link Table}. */
export interface VirtualField {
  /** Field name referenced from queries. */
  name: string;
  /** SQL expression evaluated on each read. */
  expr: Sql;
  /** Optional explicit return type. Inferred when omitted. */
  type?: ScalarType;
  /** Description surfaced in generated docs. */
  description?: string;
}

/** Time-to-live configuration for automatic row pruning. */
export interface TableTtl {
  /** Field whose value drives the TTL (e.g. `"created_at"`). */
  fieldName: string;
  /** Expression evaluating to the cut-off timestamp. */
  expr: Sql;
}

const RECORD_DISPLAY_NAME_FIELD_GROUPS = [["first_name", "last_name"]];
const RECORD_DISPLAY_NAME_FIELDS = ["name", "title"];

/**
 * The `t` argument passed to the callback of `db.table("foo", (t) => …)`.
 *
 * `TableBuilder` collects field declarations (`t.string`, `t.fk`,
 * `t.money`, `t.json`, etc.), unique/check constraints, virtual fields,
 * search config, record display name, ICtx/table-block attachments, and
 * sample-data hints into the table that's about to be registered. The
 * builder is consumed once and discarded at generation time.
 *
 * Tables are referred to elsewhere by their snake_case plural name; this
 * type is what callers interact with while *defining* them.
 *
 * @example
 * import { db, type TableBuilder } from "std/system";
 *
 * function addAuditFields(t: TableBuilder) {
 *   t.timestamp("created_at").notNull();
 *   t.fk("created_by", "users");
 * }
 *
 * db.table("orders", (t) => {
 *   t.string("ref", 64).notNull();
 *   addAuditFields(t);
 * });
 */
/**
 * Fluent builder for defining a {@link Table}. Created automatically by
 * {@link Db.table}; configure fields and constraints, then `finish()` is
 * called for you when the table callback returns.
 *
 * See {@link https://docs.yolm.io/database/overview | Database overview} and
 * {@link https://docs.yolm.io/database/field_types | Field types}.
 */
export class TableBuilder {
  #fields: BaseFieldBuilder[] = [];
  #fieldGroups: Record<string, unknown> = {};
  #uniques: yom.UniqueConstraint[] = [];
  #checks: Check[] = [];
  #virtuals: VirtualField[] = [];
  #description?: string;
  #searchConfig: RankedSearchTable | undefined;
  #renameFrom?: string;
  #recordDisplayNameFields?: string[];
  #recordDisplayName?: RecordDisplayName;
  #createDefaultNameMatch = false;
  #baseUrl?: string;
  #formControl?: TableControl;
  #displayName: string;
  #primaryKeyFieldName?: string;
  #ttl?: TableTtl;
  #autoCompact?: boolean;
  #insertOnly?: boolean;
  #skipAutoApi = false;
  #inlineRecordDisplay?: (props: { id: NumericExpr }) => Node;
  #blocks: Map<TableBlockConstructor<any>, TableBlock[]> = new Map();
  #sampleDataConfig?: TableSampleDataConfig;

  constructor(public name: string) {
    this.#displayName = system.displayNameConfig.table(name);
  }

  /** Configure how sample data is generated for this table. */
  sampleData(config: TableSampleDataConfig) {
    this.#sampleDataConfig = config;
    return this;
  }

  /** Override the auto-derived display name. */
  displayName(name: string) {
    this.#displayName = name;
    return this;
  }

  /** Record the table's previous name so the deploy step preserves data. */
  renameFrom(name: string) {
    this.#renameFrom = name;
    return this;
  }

  /** Add a boolean field. */
  bool(name: string) {
    const field = new BoolFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Alias for {@link TableBuilder.bool}. */
  boolean(name: string) {
    return this.bool(name);
  }

  /** Add an `Ordering` field used for stable user-controlled ordering. */
  ordering(name: string) {
    const field = new OrderingFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a calendar-date field (no time component). */
  date(name: string) {
    const field = new DateFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a time-of-day field (no date component). */
  time(name: string) {
    const field = new TimeFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Alias for {@link TableBuilder.timestampUtc}. */
  timestamp(name: string) {
    return this.timestampUtc(name);
  }

  /** Add a UTC-normalized timestamp field. */
  timestampUtc(name: string) {
    const field = new TimestampUtcFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a timestamp field stored with a fixed timezone offset. */
  timestampTz(name: string) {
    const field = new TimestampTzFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a "naive" (timezone-less) timestamp field. */
  timestampNaive(name: string) {
    const field = new TimestampNaiveFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a transaction-id field (links the row to the tx that wrote it). */
  tx(name: string) {
    const field = new TxFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a signed 8-bit integer field. */
  tinyInt(name: string) {
    const field = new TinyIntFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a signed 16-bit integer field. */
  smallInt(name: string) {
    const field = new SmallIntFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a signed 32-bit integer field. */
  int(name: string) {
    const field = new IntFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a signed 64-bit integer field. */
  bigInt(name: string) {
    const field = new BigIntFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add an unsigned 8-bit integer field. */
  tinyUint(name: string) {
    const field = new TinyUintFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add an unsigned 16-bit integer field. */
  smallUint(name: string) {
    const field = new SmallUintFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add an unsigned 32-bit integer field. */
  uint(name: string) {
    const field = new UintFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add an unsigned 64-bit integer field. */
  bigUint(name: string) {
    const field = new BigUintFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a binary blob field with a maximum byte length. */
  bytes(name: string, maxLength: number) {
    const field = new BytesFieldBuilder(this.name, name, maxLength);
    this.addField(field);
    return field;
  }

  /** Add a field that references a Yolm blob hash. */
  blobRef(name: string, maxLength: 32 | 64 = 32) {
    return this.bytes(name, maxLength);
  }

  /**
   * Add an encrypted binary field. Values are encrypted at rest using the
   * provided `encryptionKey`.
   */
  secret(name: string, maxLength: number, encryptionKey: string) {
    const field = new BytesFieldBuilder(this.name, name, maxLength, {
      type: "Secret",
      encryptionKey,
    });
    this.addField(field);
    return field;
  }

  /** Add a 32-bit floating-point field. */
  real(name: string) {
    const field = new RealFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a 64-bit floating-point field. */
  double(name: string) {
    const field = new DoubleFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a UUID field. */
  uuid(name: string) {
    const field = new UuidFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a JSON field. */
  json(name: string) {
    const field = new JsonFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /**
   * Add a fixed-point decimal field. `precision` is the total number of
   * digits; `scale` is the number of digits after the decimal point.
   * `signed` defaults to `true`.
   */
  decimal(
    name: string,
    opts: {
      precision: number;
      scale: number;
      signed?: boolean;
    },
  ) {
    const field = new DecimalFieldBuilder(
      this.name,
      name,
      opts.precision,
      opts.scale,
      opts.signed ?? true,
      undefined,
    );
    this.addField(field);
    return field;
  }

  /** Alias for {@link TableBuilder.string}. */
  varchar(name: string, maxLength: number) {
    return this.string(name, maxLength);
  }

  /** Alias for {@link TableBuilder.string}. */
  text(name: string, maxLength: number) {
    return this.string(name, maxLength);
  }

  /** Add a string field bounded by `maxLength` characters. */
  string(name: string, maxLength: number) {
    const field = new StringFieldBuilder(this.name, name, maxLength);
    this.addField(field);
    return field;
  }

  /**
   * Add a foreign-key field. If `table` is omitted, the call is interpreted
   * as `fk(table)` and the field name is derived as `<singular>_id`.
   */
  fk(name: string, table?: string) {
    const field = new ForeignKeyFieldBuilder(
      this.name,
      table ? name : `${singularize(name)}_id`,
      table ?? name,
    );
    this.addField(field);
    return field;
  }

  /**
   * Add an enum field. If `enumName` is omitted the enum and field share
   * the same name.
   */
  enum(name: string, enumName?: string) {
    const field = new EnumFieldBuilder(this.name, name, enumName ?? name);
    this.addField(field);
    return field;
  }

  /**
   * Add a money field. Pass a `{precision, scale}` object for a fixed-point
   * decimal representation, or an integer field type name (e.g. `"BigInt"`)
   * to store amounts as integer minor units.
   * See {@link https://docs.yolm.io/database/money_and_accounting | Money and accounting}.
   */
  money(
    name: string,
    opts?:
      | {
        precision: number;
        scale: number;
        signed?: boolean;
      }
      | yom.FieldIntegerTypes,
  ) {
    const usage = { type: "Money", currency: "USD" } as const;
    if (typeof opts === "string") {
      let field: BaseFieldBuilder;
      switch (opts) {
        case "TinyUint": {
          field = new TinyUintFieldBuilder(this.name, name, usage);
          break;
        }
        case "SmallUint": {
          field = new SmallUintFieldBuilder(this.name, name, usage);
          break;
        }
        case "Uint": {
          field = new UintFieldBuilder(this.name, name, usage);
          break;
        }
        case "BigUint": {
          field = new BigUintFieldBuilder(this.name, name, usage);
          break;
        }
        case "TinyInt": {
          field = new TinyIntFieldBuilder(this.name, name, usage);
          break;
        }
        case "SmallInt": {
          field = new SmallIntFieldBuilder(this.name, name, usage);
          break;
        }
        case "Int": {
          field = new IntFieldBuilder(this.name, name, usage);
          break;
        }
        case "BigInt": {
          field = new BigIntFieldBuilder(this.name, name, usage);
          break;
        }
      }
      this.addField(field);
      return field;
    }
    const normalizedOpts = opts ?? { precision: 13, scale: 2, signed: true };
    const field = new DecimalFieldBuilder(
      this.name,
      name,
      normalizedOpts.precision,
      normalizedOpts.scale,
      normalizedOpts.signed ?? false,
      usage,
    );
    this.addField(field);
    return field;
  }

  /** Add a fixed-point decimal field tagged as a percentage value. */
  percentage(
    name: string,
    opts: {
      precision: number;
      scale: number;
      signed?: boolean;
    },
  ) {
    const field = new DecimalFieldBuilder(
      this.name,
      name,
      opts.precision,
      opts.scale,
      opts.signed ?? false,
      {
        type: "Percentage",
      },
    );
    this.addField(field);
    return field;
  }

  #duration = (
    name: string,
    size: DurationSize,
    backing: yom.FieldIntegerTypes,
  ) => {
    const usage = { type: "Duration", size } as const;
    let field: BaseFieldBuilder;
    switch (backing) {
      case "TinyUint": {
        field = new TinyUintFieldBuilder(this.name, name, usage);
        break;
      }
      case "SmallUint": {
        field = new SmallUintFieldBuilder(this.name, name, usage);
        break;
      }
      case "Uint": {
        field = new UintFieldBuilder(this.name, name, usage);
        break;
      }
      case "BigUint": {
        field = new BigUintFieldBuilder(this.name, name, usage);
        break;
      }
      case "TinyInt": {
        field = new TinyIntFieldBuilder(this.name, name, usage);
        break;
      }
      case "SmallInt": {
        field = new SmallIntFieldBuilder(this.name, name, usage);
        break;
      }
      case "Int": {
        field = new IntFieldBuilder(this.name, name, usage);
        break;
      }
      case "BigInt": {
        field = new BigIntFieldBuilder(this.name, name, usage);
        break;
      }
    }
    this.addField(field);
    return field;
  };

  /**
   * Add an integer duration field measured in seconds.
   * See {@link https://docs.yolm.io/database/duration_types | Duration types}.
   */
  secondsDuration(name: string, backing: yom.FieldIntegerTypes) {
    return this.#duration(name, "seconds", backing);
  }

  /** Add an integer duration field measured in minutes. */
  minutesDuration(name: string, backing: yom.FieldIntegerTypes) {
    addMinuteDurationFns();
    return this.#duration(name, "minutes", backing);
  }

  /** Add an integer duration field measured in hours. */
  hoursDuration(name: string, backing: yom.FieldIntegerTypes) {
    return this.#duration(name, "hours", backing);
  }

  /** Add a string field tagged as an email address (length-capped at 254). */
  email(name: string) {
    const field = new StringFieldBuilder(this.name, name, 254, {
      type: "Email",
    });
    this.addField(field);
    return field;
  }

  /** Add a string field tagged as a URL, displayed as a hyperlink. */
  url(name: string, maxLength = 2048) {
    const field = new StringFieldBuilder(this.name, name, maxLength, {
      type: "URL",
    });
    this.addField(field);
    return field;
  }

  /** Add a structured `PhoneNumber` field. */
  phoneNumber(name: string) {
    const field = new PhoneNumberFieldBuilder(this.name, name);
    this.addField(field);
    return field;
  }

  /** Add a string field tagged as a phone number (free-form, max 50 chars). */
  phoneNumberString(name: string, opts?: PhoneNumberStringOptions) {
    const field = new StringFieldBuilder(this.name, name, 50, {
      type: "PhoneNumber",
      country: opts?.country,
    });
    this.addField(field);
    return field;
  }

  /** Add a string field tagged as a hex color literal (e.g. `#a1b2c3`). */
  hexColor(name: string) {
    const field = new StringFieldBuilder(this.name, name, 7, {
      type: "HexColor",
    });
    this.addField(field);
    return field;
  }

  /**
   * Add a unique constraint. `constraint` can be the list of fields or a
   * full {@link yom.UniqueConstraint} (supports per-field nulls / ordering).
   */
  unique(
    constraint: yom.UniqueConstraintField[] | yom.UniqueConstraint,
  ): TableBuilder {
    if (Array.isArray(constraint)) {
      this.#uniques.push({ fields: constraint });
    } else {
      this.#uniques.push(constraint);
    }
    return this;
  }

  /**
   * Add a pre-built {@link BaseFieldBuilder}. Most callers use the typed
   * helpers (`bool`, `int`, etc.) rather than calling this directly.
   */
  addField(field: BaseFieldBuilder): TableBuilder {
    field.blockStack = system.blockStack.slice();
    this.#fields.push(field);
    return this;
  }

  /** True if a field with the given name has already been added. */
  hasField(name: string): boolean {
    return this.#fields.some((f) => f.name === name);
  }

  /**
   * Attach a {@link TableBlock} to the table. Throws if the same block class
   * is added twice and {@link TableBlock.allowMultipleInstances} is false.
   */
  addBlock<T>(blockConstructor: TableBlockConstructor<T>, opts?: T) {
    const block = new blockConstructor(
      this.name,
      opts ?? ({} as T),
    ) as TableBlock<EmptyProps>;
    system.blockStack.push({
      type: "table",
      block: block,
    });
    block.initialize(this);
    system.blockStack.pop();
    if (this.#blocks.has(block.constructor as any)) {
      this.#blocks.get(block.constructor as any)!.push(block);
    } else {
      this.#blocks.set(block.constructor as any, [block]);
    }
    return this;
  }

  /** Register a named field group (e.g. for cohesive form sections). */
  fieldGroup(name: string, group: unknown) {
    this.#fieldGroups[name] = group;
    return this;
  }

  /** Add a multi-field check constraint. See {@link Check}. */
  check(check: Check): TableBuilder {
    this.#checks.push(check);
    return this;
  }

  /**
   * Add a virtual (computed) field. `expr` is evaluated on read; the value
   * is not stored. Optionally specify an explicit return type.
   */
  virtual(opts: VirtualField): this;
  virtual(name: string, expr: Sql, type?: HelperScalarType): this;
  virtual(
    name: string | VirtualField,
    expr?: Sql,
    type?: HelperScalarType,
  ) {
    if (typeof name === "string") {
      this.#virtuals.push({
        name,
        expr: expr!,
        type: typeof type === "string" ? { type } : type,
      });
    } else {
      this.#virtuals.push(name);
    }
    return this;
  }

  /**
   * Register a default {@link yom.SearchMatchConfig} for this table's
   * display name. Used by the navbar search dialog.
   */
  createDefaultNameMatch(): TableBuilder {
    this.#createDefaultNameMatch = true;
    return this;
  }

  /** Free-text description surfaced in generated docs. */
  description(s: string) {
    this.#description = s;
    return this;
  }

  /**
   * Restrict which fields contribute to the auto-derived
   * {@link RecordDisplayName}. Useful when the heuristic picks the wrong
   * combination.
   */
  recordDisplayNameFields(fields: string[]) {
    this.#recordDisplayNameFields = fields;
    return this;
  }

  /**
   * Explicitly set the {@link RecordDisplayName}. With multiple fields, an
   * `expr` callback is required to combine them.
   */
  recordDisplayName(
    fields: string[],
    expr?: (...fields: Sql[]) => Sql,
  ) {
    if (fields.length !== 1 && !expr) {
      throw new Error(
        "Please make sure to specify an expression for setRecordDisplayName",
      );
    }
    this.#recordDisplayName = {
      fields,
      expr: expr ?? ((name: Sql) => name),
    };
    return this;
  }

  /** Override the auto-derived primary key field name (default `id`). */
  primaryKeyFieldName(name: string) {
    this.#primaryKeyFieldName = name;
    return this;
  }

  /**
   * Configure the time-to-live for rows in this table. `fieldName` is a
   * not-null timestamp field; `expr` is a scalar cutoff that must not
   * reference the row, such as `date.add(hour, -24, now())`. A row is pruned
   * once its `fieldName` value is earlier than the cutoff.
   */
  ttl(opts: { fieldName: string; expr: AnyExpr }) {
    this.#ttl = {
      fieldName: opts.fieldName,
      expr: sql`${opts.expr}`,
    };
    return this;
  }

  /** Shorthand for {@link TableBuilder.ttl} with positional arguments. */
  ttlFrom(fieldName: string, expr: AnyExpr) {
    if (!fieldName) {
      throw new Error("ttlFrom requires a fieldName");
    }
    this.#ttl = {
      fieldName,
      expr: sql`${expr}`,
    };
    return this;
  }

  /** Opt this table into monthly transaction-log autoCompact. */
  autoCompact(enabled = true) {
    this.#autoCompact = enabled;
    return this;
  }

  /** Mark this table append-only: inserts are allowed, updates/deletes are rejected. */
  insertOnly(enabled = true) {
    this.#insertOnly = enabled;
    return this;
  }

  /**
   * Configure the navbar / global search ranking for this table. See
   * {@link https://docs.yolm.io/database/search_config | Search config}.
   */
  searchConfig(config: Omit<RankedSearchTable, "table">) {
    this.#searchConfig = { table: this.name, ...config };
    return this;
  }

  /** True if a search config has been registered. */
  hasSearchConfig(): boolean {
    return this.#searchConfig !== undefined;
  }

  #getBaseUrl() {
    if (this.#baseUrl) {
      return this.#baseUrl;
    }
    return pluralize(this.name.split("_").join(" ")).split(" ").join("-");
  }

  /**
   * Custom renderer used wherever a record is referenced inline in the UI
   * (e.g. chips, link cells). Receives the record's id.
   */
  inlineRecordDisplay(f: (props: { id: NumericExpr }) => Node) {
    this.#inlineRecordDisplay = f;
    return this;
  }

  /**
   * Set the default form control used to pick records from this table —
   * `"Select"`, `"Combobox"`, a {@link TableComboboxControl} config, or a
   * custom render function.
   */
  setFormControl(
    type: CustomTableControl | "Select" | "Combobox" | TableComboboxControl,
  ) {
    if (type === "Select" || type === "Combobox") {
      this.#formControl = { type };
    } else if (typeof type === "function") {
      this.#formControl = { type: "Custom", f: type };
    } else {
      this.#formControl = type;
    }
    return this;
  }

  /** Skip the auto-generated REST endpoints for this table. */
  skipAutoApi(shouldSkip?: boolean) {
    this.#skipAutoApi = shouldSkip ?? true;
    return this;
  }

  /**
   * Finalize the builder into a {@link Table}. Called automatically by
   * {@link Db.table} when the table callback returns.
   */
  finish(): Table {
    const fields: { [s: string]: Field } = {};
    for (const f of this.#fields) {
      const field = f.finish();
      if (field.unique) {
        this.unique([field.name]);
      }
      fields[field.name] = field;
    }
    const virtuals: Record<string, VirtualField> = {};
    for (const virtual of this.#virtuals) {
      virtuals[virtual.name] = virtual;
    }
    let displayNameFields = this.#recordDisplayNameFields;
    if (!displayNameFields) {
      for (const fieldNames of RECORD_DISPLAY_NAME_FIELD_GROUPS) {
        if (fieldNames.every((f) => fields[f])) {
          displayNameFields = fieldNames;
          break;
        }
      }
    }
    if (!displayNameFields) {
      for (const fieldName of RECORD_DISPLAY_NAME_FIELDS) {
        if (fields[fieldName]) {
          displayNameFields = [fieldName];
          break;
        }
      }
    }
    let recordDisplayName = this.#recordDisplayName;
    if (!recordDisplayName && displayNameFields) {
      if (displayNameFields.length === 1) {
        recordDisplayName = {
          fields: displayNameFields,
          expr: (name) => name,
        };
      } else if (displayNameFields.length === 2) {
        const [firstField, secondField] = displayNameFields;
        if (fields[firstField].notNull && fields[secondField].notNull) {
          recordDisplayName = {
            fields: displayNameFields,
            expr: (first, second) => sql`${first} || ' ' || ${second}`,
          };
        } else if (fields[firstField].notNull && !fields[secondField].notNull) {
          recordDisplayName = {
            fields: displayNameFields,
            expr: (first, second) =>
              sql`case when ${second} is null then ${first} else ${first} || ' ' || ${second} end`,
          };
        } else if (!fields[firstField].notNull && fields[secondField].notNull) {
          recordDisplayName = {
            fields: displayNameFields,
            expr: (first, second) =>
              sql`case when ${first} is null then ${second} else ${first} || ' ' || ${second} end`,
          };
        } else {
          recordDisplayName = {
            fields: displayNameFields,
            expr: (first, second) =>
              sql`case
            when ${first} is null then ${second}
            when ${second} is null then ${first}
            else ${first} || ' ' || ${second} end`,
          };
        }
      } else {
        throw new Error(
          "recordDisplayNameFields only supports a length 1 or 2",
        );
      }
    }
    const tableName = this.name;
    if (this.#ttl && !fields[this.#ttl.fieldName]) {
      throw new Error(
        `Table ${this.name} ttl field "${this.#ttl.fieldName}" was not found`,
      );
    }
    if (this.#createDefaultNameMatch) {
      if (!displayNameFields) {
        throw new Error(
          "createDefaultNameMatch assumes recordDisplayNameFields",
        );
      }
      const name = `${tableName}_name`;
      system.db.searchMatches[name] = {
        name: `${tableName}_name`,
        table: tableName,
        tokenizer: system.searchConfig.defaultTokenizer,
        style: {
          ...system.searchConfig.defaultFuzzyConfig,
          type: "Fuzzy",
        },
        fieldGroups: displayNameFields.length > 1
          ? [{ fields: displayNameFields }]
          : undefined,
        fields: displayNameFields.length === 1 ? displayNameFields : undefined,
      };
    }
    let searchConfig = this.#searchConfig;
    if (!this.#searchConfig) {
      if (displayNameFields?.length === 1) {
        searchConfig = {
          table: tableName,
          fields: [{ priority: 1, field: displayNameFields[0] }],
        };
      } else if (displayNameFields && displayNameFields?.length > 1) {
        searchConfig = {
          table: tableName,
          fieldGroups: [{ priority: 1, fields: displayNameFields }],
        };
      }
    }
    const table = new Table(
      "db",
      this.#primaryKeyFieldName ?? "id",
      this.name,
      this.#displayName,
      searchConfig,
    );
    table.renameFrom = this.#renameFrom;
    table.ttl = this.#ttl;
    table.autoCompact = this.#autoCompact;
    table.insertOnly = this.#insertOnly;
    table.checks = this.#checks;
    table.fields = fields;
    table.fieldGroups = this.#fieldGroups;
    table.uniqueConstraints = this.#uniques;
    table.recordDisplayName = recordDisplayName;
    table.description = this.#description;
    table.baseUrl = this.#getBaseUrl();
    table.control = this.#formControl;
    table.skipAutoApi = this.#skipAutoApi;
    table.virtuals = virtuals;
    table.inlineRecordDisplay = this.#inlineRecordDisplay;
    table.sampleDataConfig = this.#sampleDataConfig;
    for (const blocks of this.#blocks.values()) {
      for (const block of blocks) {
        table.addBlock(block);
        block.finalizeBuilder(table);
      }
    }
    return table;
  }
}

/** Register minute-duration parsing and display for fields and standalone charts. */
export function addMinuteDurationFns() {
  system.scalarFunction({
    name: "parse_minutes_duration",
    parameters: [
      {
        name: "value",
        type: { type: "String", maxLength: 65_000 },
      },
    ],
    returnType: { type: "BigInt" },
    procedure: (s) => {
      s.try({
        body: (s) => {
          s.defScalar("total", { type: "BigInt" });
          s.createQueryCursor(
            "split",
            sql`select value from string.split(input.value, ':') order by ordinal desc`,
          );
          s.advanceCursor("split");
          s.setScalar(
            "total",
            sql`case when trim(split.value) = '' then 0 else cast(split.value as bigint) end`,
          );
          s.forEachCursor("split", (s) => {
            s.setScalar(
              "total",
              sql`total + (case when trim(split.value) = '' then 0 else cast(split.value as bigint) end) * 60`,
            );
          });
          s.if(sql`input.value like '-%'`, (s) => {
            s.setScalar("total", sql`total * -1`);
          });
          s.return(sql`total`);
        },
        catch: (s) => {
          s.return();
        },
      });
    },
  });
  system.scalarFunction({
    name: "display_minutes_duration",
    parameters: [{ name: "value", type: { type: "BigInt" } }],
    returnType: { type: "String" },
    procedure: (s) => {
      s.return(sql`case when input.value < 0 then '-' else '' end ||
      abs(round(input.value / 60)) ||
      ':' ||
      lpad(abs(round(input.value % 60)), 2, 0)`);
    },
  });
}

/**
 * Common base for every field builder. Provides the shared fluent surface:
 * `notNull`, `unique`, `default`, `check`, `description`, etc.
 *
 * See {@link https://docs.yolm.io/database/field_types | Field types}.
 */
export abstract class BaseFieldBuilder {
  protected _notNull = false;
  protected _renameFrom?: string;
  protected _description?: string;
  protected _unique = false;
  protected _name: string;
  protected _displayName: string;
  protected _checks: FieldCheck[] = [];
  protected _default?: AnyExpr;
  protected _group?: string;
  protected _tableName: string;
  protected _sampleDataConfig?: FieldSampleDataConfig;
  /** Block frames active when the field was added. */
  blockStack?: BlockFrame[];

  constructor(tableName: string, name: string) {
    this._tableName = tableName;
    this._name = name;
    this._displayName = system.displayNameConfig.field(name);
  }

  /** Field name. */
  get name(): string {
    return this._name;
  }

  /** Override the sample-data generator for this field. */
  sampleData(config: FieldSampleDataConfig) {
    this._sampleDataConfig = config;
    return this;
  }

  /** Override the auto-derived display name. */
  displayName(name: string) {
    this._displayName = name;
    return this;
  }

  /** Record the field's previous name so the deploy step preserves data. */
  renameFrom(name: string) {
    this._renameFrom = name;
    return this;
  }

  /** Mark the field as NOT NULL. */
  notNull() {
    this._notNull = true;
    return this;
  }

  /** Assign the field to a named field group. */
  group(group: string) {
    this._group = group;
    return this;
  }

  /**
   * Set the default value. Use a {@link Sql} expression for computed
   * defaults (e.g. ``sql`now()` ``) or `sql.lit(...)` for a literal.
   */
  default(value: AnyExpr) {
    this._default = value;
    return this;
  }

  /** Alias for {@link BaseFieldBuilder.default}. */
  defaultTo(value: AnyExpr) {
    return this.default(value);
  }

  /** Alias for {@link BaseFieldBuilder.default}. */
  defaultsTo(value: AnyExpr) {
    return this.default(value);
  }

  /** Alias for {@link BaseFieldBuilder.default}. */
  defaults(value: AnyExpr) {
    return this.default(value);
  }

  /** Add a single-field unique constraint. */
  unique() {
    this._unique = true;
    return this;
  }

  /**
   * Add a single-field check constraint. `check` is the predicate that
   * must hold; `errorMessage` builds the user-facing message when it
   * fails.
   */
  check(
    check: (field: AnyExpr) => BooleanExpr,
    errorMessage: (field: AnyExpr) => Sql,
  ) {
    this._checks.push({ check, errorMessage });
  }

  /** Free-text description surfaced in generated docs and tooltips. */
  description(s: string) {
    this._description = s;
    return this;
  }

  /** Copy the shared fluent settings into the finalized {@link Field}. */
  writeBaseFields(field: Field) {
    field.renameFrom = this._renameFrom;
    field.notNull = this._notNull ?? false;
    field.checks = this._checks;
    field.description = this._description;
    field.unique = this._unique;
    field.default = this._default;
    field.group = this._group;
    field.sampleDataConfig = this._sampleDataConfig;
  }

  /** Produce the finalized {@link Field}. Called by {@link TableBuilder.finish}. */
  abstract finish(): Field;
}

/**
 * Numeric field builder shared by {@link RealFieldBuilder},
 * {@link DoubleFieldBuilder}, {@link DecimalFieldBuilder}, and the integer
 * builders. Adds `min` / `max` constraints.
 */
export abstract class BaseNumericBuilder extends BaseFieldBuilder {
  #max?: NumericExpr;
  #min?: NumericExpr;

  /** Inclusive maximum value. */
  max(n: NumericExpr) {
    this.#max = n;
    return this;
  }

  /** Inclusive minimum value. */
  min(n: NumericExpr) {
    this.#min = n;
    return this;
  }

  override writeBaseFields(field: NumericFields) {
    super.writeBaseFields(field);
    field.min = this.#min;
    field.max = this.#max;
  }
}

/**
 * Integer field builder shared by every signed and unsigned integer
 * variant. Adds support for a typed `usage` tag (Money, Duration, etc.).
 */
export abstract class BaseIntegerBuilder extends BaseNumericBuilder {
  #usage?: IntegerUsage;

  constructor(tableName: string, name: string, usage?: IntegerUsage) {
    super(tableName, name);
    this.#usage = usage;
  }

  override writeBaseFields(field: IntegerField) {
    super.writeBaseFields(field);
    field.usage = this.#usage;
  }
}

/**
 * Constructor shape shared by the integer field builders
 * ({@link UintFieldBuilder}, {@link IntFieldBuilder}, …) produced by
 * `createIntegerBuilder`.
 */
export interface IntegerFieldBuilder {
  new (
    tableName: string,
    name: string,
    usage?: IntegerUsage,
  ): BaseNumericBuilder;
}

function createIntegerBuilder(
  create: new (
    _tableName: string,
    _name: string,
    _displayName: string,
  ) => IntegerField,
): IntegerFieldBuilder {
  return class extends BaseIntegerBuilder {
    finish(): Field {
      const field = new create(this._tableName, this._name, this._displayName);
      this.writeBaseFields(field);
      return field;
    }
  };
}

/** Fluent builder for {@link TinyUintField}. */
export const TinyUintFieldBuilder = createIntegerBuilder(TinyUintField);
/** Fluent builder for {@link TinyIntField}. */
export const TinyIntFieldBuilder = createIntegerBuilder(TinyIntField);
/** Fluent builder for {@link SmallUintField}. */
export const SmallUintFieldBuilder = createIntegerBuilder(SmallUintField);
/** Fluent builder for {@link SmallIntField}. */
export const SmallIntFieldBuilder = createIntegerBuilder(SmallIntField);
/** Fluent builder for {@link UintField}. */
export const UintFieldBuilder = createIntegerBuilder(UintField);
/** Fluent builder for {@link IntField}. */
export const IntFieldBuilder = createIntegerBuilder(IntField);
/** Fluent builder for {@link BigUintField}. */
export const BigUintFieldBuilder = createIntegerBuilder(BigUintField);
/** Fluent builder for {@link BigIntField}. */
export const BigIntFieldBuilder = createIntegerBuilder(BigIntField);

/** Fluent builder for {@link RealField}. */
export class RealFieldBuilder extends BaseNumericBuilder {
  finish(): Field {
    const field = new RealField(this._tableName, this._name, this._displayName);
    this.writeBaseFields(field);
    return field;
  }
}
/** Fluent builder for {@link DoubleField}. */
export class DoubleFieldBuilder extends BaseNumericBuilder {
  finish(): Field {
    const field = new DoubleField(
      this._tableName,
      this._name,
      this._displayName,
    );
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link DecimalField}. */
export class DecimalFieldBuilder extends BaseNumericBuilder {
  #precision: number;
  #scale: number;
  #signed: boolean;
  #usage?: DecimalUsage;

  constructor(
    tableName: string,
    name: string,
    precision: number,
    scale: number,
    signed: boolean,
    usage: DecimalUsage | undefined,
  ) {
    super(tableName, name);
    this.#precision = precision;
    this.#scale = scale;
    this.#signed = signed;
    this.#usage = usage;
  }

  finish(): Field {
    const field = new DecimalField(
      this._tableName,
      this._name,
      this._displayName,
      this.#precision,
      this.#scale,
      this.#signed,
    );
    this.writeBaseFields(field);
    field.usage = this.#usage;
    return field;
  }
}

/** Fluent builder for {@link UuidField}. */
export class UuidFieldBuilder extends BaseFieldBuilder {
  finish(): Field {
    const field = new UuidField(this._tableName, this._name, this._displayName);
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link JsonField}. */
export class JsonFieldBuilder extends BaseFieldBuilder {
  finish(): Field {
    const field = new JsonField(this._tableName, this._name, this._displayName);
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link BoolField}. */
export class BoolFieldBuilder extends BaseFieldBuilder {
  #enumLike?: BoolEnumLikeConfig;

  /** Render the bool as a labelled enum (e.g. "Active" / "Inactive"). */
  enumLike(config: BoolEnumLikeConfig) {
    this.#enumLike = config;
    return this;
  }

  finish(): Field {
    const field = new BoolField(this._tableName, this._name, this._displayName);
    this.writeBaseFields(field);
    field.enumLike = this.#enumLike;
    return field;
  }
}

/** Fluent builder for {@link OrderingField}. */
export class OrderingFieldBuilder extends BaseFieldBuilder {
  finish(): Field {
    const field = new OrderingField(
      this._tableName,
      this._name,
      this._displayName,
    );
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link DateField}. */
export class DateFieldBuilder extends BaseFieldBuilder {
  finish(): Field {
    const field = new DateField(this._tableName, this._name, this._displayName);
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link TimeField}. */
export class TimeFieldBuilder extends BaseFieldBuilder {
  finish(): Field {
    const field = new TimeField(this._tableName, this._name, this._displayName);
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link TimestampUtcField}. */
export class TimestampUtcFieldBuilder extends BaseFieldBuilder {
  finish(): Field {
    const field = new TimestampUtcField(
      this._tableName,
      this._name,
      this._displayName,
    );
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link TimestampNaiveField}. */
export class TimestampNaiveFieldBuilder extends BaseFieldBuilder {
  finish(): Field {
    const field = new TimestampNaiveField(
      this._tableName,
      this._name,
      this._displayName,
    );
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link TimestampTzField}. */
export class TimestampTzFieldBuilder extends BaseFieldBuilder {
  finish(): Field {
    const field = new TimestampTzField(
      this._tableName,
      this._name,
      this._displayName,
    );
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link PhoneNumberField}. */
export class PhoneNumberFieldBuilder extends BaseFieldBuilder {
  #country?: string;

  /** Restrict the phone number to a specific ISO-3166 two-letter country code. */
  country(country: string) {
    if (country.length !== 2) {
      throw new Error("Country code must be exactly 2 characters");
    }
    this.#country = country;
    return this;
  }

  finish(): Field {
    const field = new PhoneNumberField(
      this._tableName,
      this._name,
      this._displayName,
    );
    this.writeBaseFields(field);
    field.country = this.#country;
    return field;
  }
}

/** Fluent builder for {@link TxField}. */
export class TxFieldBuilder extends BaseFieldBuilder {
  finish(): Field {
    const field = new TxField(this._tableName, this._name, this._displayName);
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link StringField}. */
export class StringFieldBuilder extends BaseFieldBuilder {
  #maxLength: number;
  #collation?: yom.Collation;
  #minLength?: number;
  #maxBytesPerChar?: number;
  #autoTrim?: yom.AutoTrim;
  #multiline?: boolean;
  #usage?: StringUsage;

  constructor(
    tableName: string,
    name: string,
    maxLength: number,
    usage?: StringUsage,
  ) {
    super(tableName, name);
    this.#maxLength = maxLength;
    this.#usage = usage;
  }

  /** Set the maximum length in characters. */
  maxLength(maxLength: number) {
    this.#maxLength = maxLength;
    return this;
  }

  /** Override the per-field collation (defaults to {@link Db.collation}). */
  collation(collation?: yom.Collation) {
    this.#collation = collation;
    return this;
  }

  /** Minimum length, in characters. */
  minLength(minLength?: number) {
    this.#minLength = minLength;
    return this;
  }

  /** Shorthand for `minLength(1)`. */
  notEmpty() {
    this.#minLength = 1;
    return this;
  }

  /** Cap the per-character byte count (controls storage planning). */
  maxBytesPerChar(max?: number) {
    this.#maxBytesPerChar = max;
    return this;
  }

  /** Override the per-field auto-trim setting (defaults to {@link Db.autoTrim}). */
  autoTrim(trim?: yom.AutoTrim) {
    this.#autoTrim = trim;
    return this;
  }

  /** Render the field as a multi-line textarea in generated forms. */
  multiline() {
    this.#multiline = true;
    return this;
  }

  finish(): Field {
    const field = new StringField(
      this._tableName,
      this._name,
      this._displayName,
      this.#maxLength,
    );
    this.writeBaseFields(field);
    field.usage = this.#usage;
    field.minLength = this.#minLength;
    field.collation = this.#collation;
    field.maxBytesPerChar = this.#maxBytesPerChar;
    field.autoTrim = this.#autoTrim;
    field.multiline = this.#multiline;
    return field;
  }
}

/**
 * Tag applied to a {@link BytesField} so its bytes are encrypted at rest.
 * Created indirectly via {@link TableBuilder.secret}.
 */
export type SecretUsage = { type: "Secret"; encryptionKey: string };

/** Fluent builder for {@link BytesField}. */
export class BytesFieldBuilder extends BaseFieldBuilder {
  #maxLength: number;
  #usage?: SecretUsage;

  constructor(
    tableName: string,
    name: string,
    maxLength: number,
    usage?: SecretUsage,
  ) {
    super(tableName, name);
    this.#maxLength = maxLength;
    this.#usage = usage;
  }

  /** Set the maximum byte length. */
  maxLength(maxLength: number) {
    this.#maxLength = maxLength;
    return this;
  }

  finish(): Field {
    const field = new BytesField(
      this._tableName,
      this._name,
      this._displayName,
      this.#maxLength,
    );
    field.usage = this.#usage;
    this.writeBaseFields(field);
    return field;
  }
}

/**
 * Fluent builder for {@link ForeignKeyField}. See
 * {@link https://docs.yolm.io/database/foreign_keys | Foreign keys}.
 */
export class ForeignKeyFieldBuilder extends BaseFieldBuilder {
  #table: string;
  #onDelete: yom.OnDeleteBehavior = "Cascade";

  constructor(selfTableName: string, name: string, tableName: string) {
    super(selfTableName, name);
    this.#table = tableName;
    if (name.endsWith("_id")) {
      this._displayName = system.displayNameConfig.field(name.slice(0, -3));
    }
  }

  /** Override the on-delete behavior (defaults to `"Cascade"`). */
  onDelete(behavior: yom.OnDeleteBehavior) {
    this.#onDelete = behavior;
    return this;
  }

  finish(): Field {
    const field = new ForeignKeyField(
      this._tableName,
      this._name,
      this._displayName,
      this.#table,
      this.#onDelete,
    );
    this.writeBaseFields(field);
    return field;
  }
}

/** Fluent builder for {@link EnumField}. */
export class EnumFieldBuilder extends BaseFieldBuilder {
  #enum: string;

  constructor(tableName: string, name: string, enumName: string) {
    super(tableName, name);
    this.#enum = enumName;
  }

  finish(): Field {
    const field = new EnumField(
      this._tableName,
      this._name,
      this._displayName,
      this.#enum,
    );
    this.writeBaseFields(field);
    return field;
  }
}

/**
 * Convenience union accepted by helpers that take a scalar type: a full
 * {@link yom.ScalarType}, one of the simple type names, an integer type
 * name, or the string `"String"`.
 */
export type HelperScalarType =
  | yom.ScalarType
  | yom.SimpleScalarTypes
  | yom.ScalarIntegerTypes
  | "String";

/** Parameter declaration on a {@link ScalarFunction}. */
export interface Parameter {
  /** Parameter name. */
  name: string;
  /** Whether the value is required. */
  notNull?: boolean;
  /** Parameter type. */
  type: yom.FieldType;
}

/** Finalized scalar function definition stored on the system. */
export interface ScalarFunction {
  /** Function name. */
  name: string;
  /** Description surfaced in generated docs. */
  description?: string;
  /** Body of the function. */
  procedure: yom.BasicStatement[];
  /** Inputs, keyed by name. */
  inputs: { [name: string]: Parameter };
  /** Return type. */
  returnType: yom.ScalarType;
}

/** One value of a system enum. */
export interface EnumValue {
  /** Internal name. */
  name: string;
  /** Human-readable display name. */
  displayName: string;
  /** Old name preserved across renames. */
  renameFrom?: string;
  /** Description surfaced in generated docs. */
  description?: string;
  /** Hide this value from UI pickers. */
  hideFromUiControls?: boolean;
  /** Group name for UI sectioning. */
  group?: string;
  /** Display color (chips, badges). */
  color?: string;
}

/** Discriminated union of supported enum controls. */
export type EnumControl =
  | { type: "Select" }
  | { type: "Combobox" }
  | { type: "Custom"; f: (props: TableControlOpts) => Node };

/** Props for a custom enum control. */
export interface EnumControlOpts {
  /** DOM id of the input element. */
  id: string;
  /** Current value. */
  value: string;
  /** Callback receiving the newly-selected value. */
  onSelectValue: (newValue: string) => yom.DomProcStatement[];
  /** Initial text shown in the input. */
  initialInputText?: string;
}

/** Finalized enum definition stored on the system. */
export interface Enum {
  /** Block frames active when the enum was added. */
  blockStack?: BlockFrame[];
  /** Enum name. */
  name: string;
  /** Display name surfaced in generated docs. */
  displayName?: string;
  /** Old enum name preserved across renames. */
  renameFrom?: string;
  /** Values keyed by name (object access). */
  values: Record<string, EnumValue>;
  /**
   * Values keyed by name, preserving insertion order. JavaScript's plain
   * object orders numeric-looking keys numerically; the Map preserves the
   * declaration order.
   */
  valuesMap: Map<string, EnumValue>;

  /** Description surfaced in generated docs. */
  description?: string;
  /** Render the value's display name as a SQL expression. */
  getDisplayName?: (value: Sql) => Sql;
  /** Custom inline UI for a value (e.g. colored chip). */
  inlineDisplay?: (value: Sql) => Node;
  /** Default UI control used to pick a value of this enum. */
  control?: EnumControl;
}

interface HelperFunctionParam {
  name: string;
  notNull?: boolean;
  collation?: yom.Collation;
  type: HelperFieldType;
}

/**
 * Convenience union accepted by helpers that take a field type: a full
 * {@link yom.FieldType}, one of the integer / simple-scalar type names, or
 * a string shorthand (e.g. `"String"`, `"TimestampUtc"`, `"TimestampNaive"`).
 */
export type HelperFieldType =
  | yom.FieldType
  | yom.FieldIntegerTypes
  | yom.SimpleScalarTypes
  | "String"
  | "TimestampUtc"
  | "TimestampNaive";

interface HelperScalarFunction {
  name: string;
  description?: string;
  parameters: HelperFunctionParam[];
  procedure: BasicStatementsOrFn;
  returnType: HelperScalarType;
}

function scalarFunctionFromHelper(f: HelperScalarFunction): ScalarFunction {
  const inputs: { [name: string]: Parameter } = {};
  for (const input of f.parameters) {
    inputs[input.name] = {
      name: input.name,
      type: fieldTypeFromHelper(input.type),
      notNull: input.notNull,
    };
  }
  return {
    name: f.name,
    description: f.description,
    inputs,
    procedure: BasicStatements.normalizeToArray(f.procedure),
    returnType: typeof f.returnType === "string"
      ? { type: f.returnType }
      : f.returnType,
  };
}

function helperScalarTypeToFieldType(ty: HelperScalarType): yom.FieldType {
  if (ty === "String") {
    return { type: "String", maxLength: 1_000_000 };
  }
  if (typeof ty === "string") {
    return { type: ty };
  }
  if (ty.type === "String") {
    return { type: "String", maxLength: 1_000_000 };
  }
  return ty;
}

/** Normalize a {@link HelperFieldType} into a full {@link yom.FieldType}. */
export function fieldTypeFromHelper(ty: HelperFieldType): yom.FieldType {
  return ty === "String"
    ? { type: "String", maxLength: 2_000_000_000 }
    : typeof ty === "string"
    ? { type: ty }
    : ty;
}

function normalizePipeline(
  opts: PipelineOpts & { name: string },
): yom.Pipeline {
  return {
    name: opts.name,
    setup: GeneralServerStatements.normalizeToArray(opts.setup),
    stages: (opts.stages ?? []).map(normalizePipelineStage),
    finalize: GeneralServerStatements.normalizeToArray(opts.finalize),
  };
}

function normalizeStoredProcedureScalarFields(
  fields: HelperProcField[] | undefined,
): yom.StoredProcedureScalarField[] {
  return (fields ?? []).map((field) => ({
    name: field.name,
    type: fieldTypeFromHelper(field.type),
    notNull: field.notNull,
  }));
}

function normalizeStoredProcedureFieldSets(
  fieldSets: StoredProcedureFieldSetOpts[] | undefined,
): yom.StoredProcedureFieldSet[] {
  return (fieldSets ?? []).map((fieldSet) => ({
    name: fieldSet.name,
    fields: fieldSet.fields.map((field) => ({
      name: field.name,
      type: fieldTypeFromHelper(field.type),
      notNull: field.notNull,
    })),
  }));
}

/**
 * If `ex` is a simple SQL string literal (e.g. produced by `sql.lit`),
 * return its unescaped text; otherwise return undefined.
 */
function extractSimpleSqlStringLiteral(ex: AnyExpr): string | undefined {
  if (!(ex instanceof Sql)) {
    return undefined;
  }
  const text = String(ex.toSQL()).trim();
  const match = /^'((?:[^']|'')*)'$/.exec(text);
  if (match === null) {
    return undefined;
  }
  return match[1].replaceAll("''", "'");
}

function normalizePipelineStage(
  stage: PipelineStageOpts | yom.PipelineStage,
): NormalizedPipelineStage {
  if (
    Array.isArray((stage as yom.PipelineStage).process) ||
    Array.isArray((stage as yom.PipelineStage).processBatch)
  ) {
    const existing = stage as yom.PipelineStage;
    return {
      source: normalizePipelineStageSource(existing.source),
      name: existing.name,
      dependencies: existing.dependencies ?? [],
      after: existing.after,
      where: existing.where,
      process: existing.process,
      processBatch: existing.processBatch,
      keepTogetherBy: existing.keepTogetherBy,
      parallelize: existing.parallelize ?? false,
      checkpointAfter: existing.checkpointAfter ?? false,
    };
  }
  const stageOpts = stage as PipelineStageOpts;
  return {
    source: normalizePipelineStageSource(stageOpts.source),
    name: stageOpts.name,
    dependencies: stageOpts.dependencies ?? [],
    after: stageOpts.after,
    where: stageOpts.where === true ? undefined : sql.toYOM(stageOpts.where),
    process: stageOpts.process === undefined
      ? stageOpts.processBatch === undefined ? [] : undefined
      : GeneralServerStatements.normalizeToArray(stageOpts.process),
    processBatch: stageOpts.processBatch === undefined
      ? undefined
      : GeneralServerStatements.normalizeToArray(stageOpts.processBatch),
    keepTogetherBy: stageOpts.keepTogetherBy,
    parallelize: stageOpts.parallelize ?? false,
    checkpointAfter: stageOpts.checkpointAfter ?? false,
  };
}

function normalizePipelineStageSource(
  source: PipelineStageOpts["source"] | yom.PipelineStage["source"],
): yom.PipelineStageSource | undefined {
  if (source === undefined) return undefined;
  if (typeof source === "string") return { type: "Table", table: source };
  if ("table" in source) return { type: "Table", table: source.table };
  return {
    type: "Query",
    query: source.query instanceof Sql ? source.query.toYOM() : source.query,
  };
}

function transformStatements(
  stmts: TransformStatementsOrFn,
): yom.TransformStatement[] {
  if (Array.isArray(stmts)) {
    return stmts;
  }
  return TransformStatements.normalizeToArray(
    stmts,
  ) as yom.TransformStatement[];
}

/** Column type accepted by the pipeline CSV / Parquet import shorthand. */
export type PipelineImportColumnType =
  | "bool"
  | "int"
  | "bigint"
  | "real"
  | "double"
  | "string"
  | "date"
  | "time"
  | "timestamp"
  | "timestamptz";

/** Options for one column passed to {@link pipelineColumn}. */
export interface PipelineColumnOpts {
  /** Column name. */
  name: string;
  /** Whether the column must be non-null. Defaults to `false`. */
  notNull?: boolean;
}

function pipelineColumnFactory(ty: PipelineImportColumnType) {
  return (opts: PipelineColumnOpts): yom.PipelineImportColumn => ({
    name: opts.name,
    ty,
    notNull: opts.notNull ?? false,
  });
}

/**
 * Typed factories for declaring import columns inside a pipeline
 * `source` definition. Each property returns a function that builds a
 * {@link yom.PipelineImportColumn} of the matching type.
 *
 * @example
 *   stages: [{
 *     source: pipelineSourceCsv({
 *       file: "users.csv",
 *       columns: [
 *         pipelineColumn.string({ name: "email", notNull: true }),
 *         pipelineColumn.int({ name: "age" }),
 *       ],
 *     }),
 *     ...
 *   }]
 */
export const pipelineColumn = {
  bool: pipelineColumnFactory("bool"),
  int: pipelineColumnFactory("int"),
  bigint: pipelineColumnFactory("bigint"),
  real: pipelineColumnFactory("real"),
  double: pipelineColumnFactory("double"),
  string: pipelineColumnFactory("string"),
  date: pipelineColumnFactory("date"),
  time: pipelineColumnFactory("time"),
  timestamp: pipelineColumnFactory("timestamp"),
  timestamptz: pipelineColumnFactory("timestamptz"),
};

/**
 * Helper that lifts a {@link PipelineStageOpts} into the YOM
 * {@link yom.PipelineStage} shape. Useful when composing stages outside of
 * an `addPipeline` call.
 */
export function pipelineStage(opts: PipelineStageOpts): yom.PipelineStage {
  return normalizePipelineStage(opts);
}

/** Strategy for deriving display names from SQL identifiers. */
export interface DisplayNameConfig {
  /** Fallback used when a more specific entry is not provided. */
  default: (sqlName: string) => string;
  /** Override for table names. */
  table: (sqlName: string) => string;
  /** Override for field names. */
  field: (sqlName: string) => string;
  /** Override for enum names. */
  enum: (sqlName: string) => string;
  /** Override for enum value names. */
  enumValue: (sqlName: string) => string;
}

/** System-wide defaults consumed by generated search UI. */
export interface SearchConfig {
  /** Default fuzzy-search configuration. */
  defaultFuzzyConfig: yom.FuzzyConfig;
  /** Default tokenizer applied to search inputs. */
  defaultTokenizer: yom.Tokenizer;
}

/**
 * Helper for declaring a per-enum decision-table function — see
 * {@link HelperEnum.withRulesFn}. Each entry pairs an enum value name with
 * an output expression.
 */
export interface SimpleRfn {
  /** Function name. */
  name: string;
  /** Return type. */
  outputType: HelperScalarType;
  /** `[enumValueName, outputExpr]` entries. */
  fields: [string, AnyExpr][];
  /** Output when none of `fields` match. */
  default?: AnyExpr;
}

/**
 * Helper for declaring a boolean-rules function on an enum: list the
 * value names that should evaluate to true (or to false). See
 * {@link HelperEnum.withBoolRulesFn}.
 */
export type BoolRfn =
  | {
    name: string;
    trues: string[];
  }
  | {
    name: string;
    falses: string[];
  };

/** One value passed to {@link HelperEnum.values}. */
export interface HelperEnumValue {
  /** Internal name. */
  name: string;
  /** Optional display name (auto-derived if omitted). */
  displayName?: string;
  /** Old value name preserved across renames. */
  renameFrom?: string;
  /** Description surfaced in generated docs. */
  description?: string;
  /** Hide this value from UI pickers. */
  hideFromUi?: boolean;
  /** Group name for UI sectioning. */
  group?: string;
  /** Display color (chips, badges). */
  color?: string;
}

/**
 * Options passed to {@link System.enum_}. The `values` list may mix bare
 * strings (auto-deriving display names) and full {@link HelperEnumValue}
 * objects.
 */
export interface HelperEnum {
  /** Enum name. */
  name: string;
  /** Optional display name (auto-derived if omitted). */
  displayName?: string;
  /** Old enum name preserved across renames. */
  renameFrom?: string;
  /** Description surfaced in generated docs. */
  description?: string;
  /** Enum values. Strings expand to `{ name, displayName: f(name) }`. */
  values: (HelperEnumValue | string)[];
  /** Per-value display name override. */
  valueDisplayName?: (v: string) => string;
  /** Rules-function helpers to register alongside the enum. */
  withRulesFn?: SimpleRfn[];
  /** Boolean rules-function helpers to register alongside the enum. */
  withBoolRulesFn?: BoolRfn[];
  /** Skip generating the default `display_<enum>` function. */
  disableDisplayFn?: boolean;
}

/**
 * Options for {@link System.rulesFunction}. A rules function evaluates
 * `rules` top-to-bottom and returns the matching row's last column.
 */
export interface RulesFunction {
  /** Function name. */
  name: string;
  /** Description surfaced in generated docs. */
  description?: string;
  /** Input parameters. */
  parameters: HelperFunctionParam[];
  /** Optional setup statements run before the rules. */
  setup?: BasicStatementsOrFn;
  /** Return type. */
  returnType: HelperScalarType;
  /** Decision-table rows: each row's last cell is its output expression. */
  rules: AnyExpr[][];
}

function generateScalarFunction(f: ScalarFunction): yom.ScalarFunction {
  return {
    name: f.name,
    parameters: Object.values(f.inputs).map((i) => ({
      name: i.name,
      type: i.type,
      notNull: i.notNull,
    })),
    procedure: f.procedure,
    returnType: f.returnType,
  };
}

/**
 * The root system object. Every Yolm system is configured by mutating
 * this singleton from `system.tsx` — `system.db.table(...)`,
 * `system.app(...)`, `system.api(...)`, `system.scheduledProc(...)`,
 * `system.addPipeline(...)`, `system.addReactor(...)`,
 * `system.addDataGridTablesAndEnums(...)`, and so on.
 *
 * This is the single source of truth the YOM serializer walks at
 * generation time to produce the runtime artefacts.
 *
 * @example
 * import { system } from "std/system";
 *
 * system.db.table("users", (t) => {
 *   t.email("email").notNull();
 *   t.fk("org", "organizations");
 * });
 */
export const system = new System();

// Export system on globalThis for js_modules.ts useJsModule()
// deno-lint-ignore no-explicit-any
(globalThis as any).__yolm_system__ = system;

/**
 * Shorthand for {@link system}.db — the entry point for declaring
 * tables (`db.table`), views (`db.view`), and SQL scalar/rules
 * functions. Re-exported because it's the most-used facet of `system`
 * and importing it directly keeps `system.tsx` files concise.
 *
 * @example
 * import { db } from "std/system";
 *
 * db.table("invoices", (t) => {
 *   t.fk("client", "clients").notNull();
 *   t.money("amount").notNull();
 * });
 */
export const { db } = system;

// Re-export JS module helpers for convenience
export { useJsModule } from "./js_modules";
export type { JsModuleConfig, JsModuleId } from "./js_modules";
