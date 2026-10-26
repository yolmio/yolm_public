/**
 The complete model of a yolm system. A yolm system is a collection of apps, tables, enums, etc. with a single database.
 A Yolm system is a (mostly) declarative description of a full-stack, integrated software solution for an organization.
 This model is serialized to JSON and passed on to the Yolm compiler and then to the Yolm runtime.
 This is the complete contract between model creators and the compiler and runtime.
 Package and solution developers can ignore the items marked @private since they are not part of the public API and are only used for platform tests.
 */
export interface System {
  /** Specifies the formatting of dates, numbers, etc. For now, only en_us is supported. */
  locale: Locale;
  /**
       Timezone of the system, controls how detes on the server are handled, when scheduled procs fire, etc.

       Use a timezone identifier from the IANA Time Zone Database.
       */
  timezone: string;
  /** Sepcifies how the Yolm runtime compares strings for sorting, searching, etc. */
  collation: Collation;
  /** The database of the system. This is the single database that is shared by all apps, api, webhooks, etc. */
  db: Database;
  /* An app is a web application. A Yolm system can have multiple apps, e.g. a user facing web app and an admin app.  */
  apps: App[];
  /**  An enum is a set of named values. These enums can be used in the apps, database, api, etc. */
  enums?: Enum[];
  /** A scalar function is a function that takes in arguments and returns a single value. */
  scalarFunctions?: ScalarFunction[];
  storedProcedures?: StoredProcedure[];
  /** Specifies API and/or UI tests that can be run on the developer's machine. */
  test?: TestModel;
  /** An api is a set of https endpoints that other programs can use to interact with the system. */
  apis?: Api[];
  /** A scheduled procedure is a way to run a set of statements at a specific time,
   * e.g. every day at 10am, every hour at the 1st minute, etc. */
  scheduledProcedures?: ScheduledProcedure[];
  typstTemplates?: TypstTemplate[];
  assetHashes?: Record<string, string>;
  dynamicRuntime?: DynamicRuntime;
  pipelines?: Pipeline[];
  /**
       Api endpoints that are accessible via yolmglobalapi.com.

       When a request is sent to yolmglobalapi.com we forward it to the system provided in the yolm-system-id query
       parameter or the yolm-system-id header. This is useful for multi-tenant oauth flows.
       */
  globalEndpoints?: ApiEndpoint[];
  /**
       Reactors are database-driven procedures that automatically run in response to query results.
       */
  reactors?: Reactor[];
  /**
       Transforms allow creating a new database with a new schema or performing maintenance operations.
       */
  transforms?: Transform[];
  /**
       Edges are local agents that run on customer hardware and bridge the cloud platform
       to local hardware (printers, scanners, etc.).
       */
  edges?: Edge[];
  /** @private */
  internalLogicTests?: LogicTest[];
  /** @private */
  internalPlanTests?: PlanTest[];
  /** @private */
  internalUiTests?: UiTest[];
  /** @private */
  internalUiSnapshotDir?: string;
  /** @private */
  internalBenchmarks?: Benchmark[];
}

export interface DynamicRuntime {
  blockMetadata?: Record<string, any>;
}

export interface TypstTemplate {
  name: string;
  body?: string;
  path?: string;
}

export interface RenderTypstAsset {
  name: string;
  data: SqlExpression;
}

export interface Pipeline {
  name: string;
  setup: GeneralServerStatement[];
  stages: PipelineStage[];
  finalize: GeneralServerStatement[];
}

export interface PipelineStage {
  source?: string | PipelineStageSource;
  name?: string;
  dependencies?: string[];
  after?: string | string[];
  where?: Sql;
  process?: GeneralServerStatement[];
  processBatch?: GeneralServerStatement[];
  /** Query output columns whose equal key tuples must be delivered in one batch. */
  keepTogetherBy?: string[];
  /** If true, process batches within this stage in parallel using multiple threads. */
  parallelize?: boolean;
  checkpointAfter?: boolean;
}

export type PipelineStageSource =
  | { type: "Table"; table: string }
  | { type: "Query"; query: Sql };

export type ReactorMode = "Batch" | "PerRecord";

export interface Reactor {
  /** The name of the reactor. */
  name: string;
  /** The query that triggers the reactor when results change. */
  query: string;
  /** The procedure to run when the query results change. */
  procedure: GeneralServerStatement[];
  /** Optional rename for the temporary results table (defaults to "reactor_results"). */
  resultTable?: string;
  /** The execution mode: Batch processes all results together, PerRecord processes one at a time (defaults to Batch). */
  mode?: ReactorMode;
  /** Maximum number of concurrent reactor executions (defaults to 1). */
  maxConcurrency?: number;
  /** Maximum wall-clock duration of one reactor handler (1–3900 seconds; defaults to 600). */
  maxExecutionSeconds?: number;
}

/**
 * NewSchema transform kind - source database has different (older) schema than current system.
 * The `sourceDatabase` field specifies the name of a dev database whose schema will be used
 * to validate `op.*` field references.
 */
export interface NewSchemaTransformKind {
  type: "newSchema";
  /** Name of the source database (must exist in dev databases registry) */
  sourceDatabase: string;
}

/**
 * SameSchema transform kind - source and target have the same schema (current system).
 * Useful for maintenance, compaction, data masking, etc.
 */
export interface SameSchemaTransformKind {
  type: "sameSchema";
}

export interface CompactTransformKind {
  /** Compact selected history without changing the persisted schema or ID spaces. */
  type: "compact";
  tables: string[];
}

export type TransformKind =
  | NewSchemaTransformKind
  | SameSchemaTransformKind
  | CompactTransformKind;

export interface Transform {
  /** The name of the transform. */
  name: string;
  /**
   * The kind of transform.
   * - `{ type: "sameSchema" }`: maintains the current schema (default)
   * - `{ type: "newSchema", sourceDatabase: "..." }`: creates a new database schema
   *   where `sourceDatabase` is the name of a dev database whose schema differs from current.
   * - `{ type: "compact", tables: [...] }`: native maintenance; replay hooks must be empty.
   */
  kind?: TransformKind;
  /**
   * If true, only explicitly listed tables are transformed; unlisted
   * schema-incompatible tables are not auto-replayed.
   */
  disableAutomaticReplay?: boolean;
  /** Setup statements that run before table transforms. */
  setup: TransformStatement[];
  /** Table-specific transform operations. */
  tables: TableTransform[];
  /** Finalize statements that run after all table transforms. */
  finalize: TransformStatement[];
}

export interface TableTransform {
  /** The table name to transform. */
  table: string;
  /** Optional name for the op record (defaults to "op"). */
  opRecordName?: string;
  /** Statements to process each operation for this table. */
  process: TransformStatement[];
}

export interface TransformStartTransactionStatement {
  t: "StartTransaction";
  creator?: SqlExpression;
  timestamp?: SqlExpression;
}

export interface TransformCommitTransactionStatement {
  t: "CommitTransaction";
}

export interface TransformEncodeSkipOpStatement {
  t: "EncodeSkipOp";
  table: string;
  count: SqlExpression;
}

export interface TransformSkipTransactionsStatement {
  t: "SkipTransactions";
  count: SqlExpression;
}

export interface TransformRestoreStatement {
  t: "Restore";
  table: string;
  query: Sql;
}

export type TransformStatement =
  | BaseStatement
  | IfStatement<TransformStatement>
  | WhileStatement<TransformStatement>
  | BlockStatement<TransformStatement>
  | ForEachCursorStatement<TransformStatement>
  | ForEachQueryStatement<TransformStatement>
  | ForEachTableStatement<TransformStatement>
  | TryStatement<TransformStatement>
  | TransformStartTransactionStatement
  | TransformCommitTransactionStatement
  | TransformEncodeSkipOpStatement
  | TransformSkipTransactionsStatement
  | TransformRestoreStatement;

// ── Edge types ────────────────────────────────────────────────────────

export interface Edge {
  name: string;
  drivers?: EdgeDriverBinding[];
  validate?: EdgeStatement[];
  setup?: EdgeStatement[];
  handlers: EdgeHandler[];
}

export interface EdgeDriverBinding {
  name: string;
  type: string;
  /** Trusted process definition for an `external:*` driver. */
  process?: EdgeDriverProcess;
  eventDurabilities?: Record<string, EdgeDriverDurability>;
}

export interface EdgeDriverProcess {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  workingDirectory?: string;
}

export interface EdgeHandler {
  name: string;
  source: EdgeHandlerSource;
  procedure: EdgeStatement[];
}

export interface EdgeEventBatch {
  maxItems: number;
  maxWaitMs: number;
  maxBytes: number;
}

export type EdgeHandlerSource =
  | { type: "boot" }
  | { type: "timer"; everyMs: number; runOnStart?: boolean }
  | { type: "reactor"; query: Sql }
  | {
    type: "driver";
    driver: string;
    event: string;
    batch?: EdgeEventBatch;
  };

export type EdgeDriverDurability = "ephemeral" | "durable";

export interface EdgeServerStatement_Server {
  t: "Server";
  procedure: GeneralServerStatement[];
}

export interface EdgeDriverSendStatement {
  t: "DriverSend";
  driver: string;
  action: string;
  params?: Record<string, SqlExpression>;
  durability?: EdgeDriverDurability;
  commandId?: SqlExpression;
}

export interface EdgeKvGetStatement {
  t: "KvGet";
  key: SqlExpression;
  scalar: string;
}

export interface EdgeKvSetStatement {
  t: "KvSet";
  key: SqlExpression;
  value: SqlExpression;
}

export interface EdgeKvDeleteStatement {
  t: "KvDelete";
  key: SqlExpression;
}

export type EdgeBaseStatement =
  | EdgeServerStatement_Server
  | EdgeDriverSendStatement
  | EdgeKvGetStatement
  | EdgeKvSetStatement
  | EdgeKvDeleteStatement;

export type EdgeStatement =
  | BaseStatement
  | IfStatement<EdgeStatement>
  | WhileStatement<EdgeStatement>
  | BlockStatement<EdgeStatement>
  | ForEachCursorStatement<EdgeStatement>
  | ForEachQueryStatement<EdgeStatement>
  | ForEachTableStatement<EdgeStatement>
  | TryStatement<EdgeStatement>
  | EdgeBaseStatement;

export interface Benchmark {
  /** The name of the benchmark. */
  name: string;
  /** Setup statements to run before benchmark procedures. */
  setup: GeneralServerStatement[];
  /** The procedures to benchmark. */
  procedures: BenchmarkProc[];
}

export interface BenchmarkProc {
  /** The name of the benchmark procedure. */
  name: string;
  /** The procedure statements to benchmark. */
  body: GeneralServerStatement[];
  /** Number of iterations to run (default is implementation-defined). */
  iterations?: number;
  /** Number of warmup iterations (default is implementation-defined). */
  warmup?: number;
}

export interface ScheduledProcedure {
  /** The name of the scheduled procedure. */
  name: string;
  /**
       Uses cron syntax.

       Use AI chat (e.g. Claude) to generate the cron schedules.
       */
  schedules: string[];
  procedure: GeneralServerStatement[];
}

export type StoredProcedureTransactionMode = "caller" | "standalone";

/** A procedure callable only through a checked RunJavascript tool binding. */
export type StoredProcedureInvocationKind = "ordinary" | "toolEntry";

export interface StoredProcedureScalarField {
  name: string;
  type: FieldType;
  notNull?: boolean;
}

export interface StoredProcedureFieldSet {
  name: string;
  fields: ProcTableField[];
}

export interface StoredProcedure {
  name: string;
  transaction?: StoredProcedureTransactionMode;
  /** Omitted (or `ordinary`) procedures cannot be registered as JS tools. */
  invocationKind?: StoredProcedureInvocationKind;
  inputScalars?: StoredProcedureScalarField[];
  inputRecords?: StoredProcedureFieldSet[];
  inputTables?: StoredProcedureFieldSet[];
  outputScalars?: StoredProcedureScalarField[];
  outputRecords?: StoredProcedureFieldSet[];
  outputTables?: StoredProcedureFieldSet[];
  procedure: GeneralServerStatement[];
}

export type Locale = "en_us";

/**
 * This indicates the string is to be treated as a SQL expression. A SQL expression returns a value at runtime.
 * It can be a string or a number, because the number is the id of the sql expression if we used sql`` to create it.
 */
export type SqlExpression = string | number;

/**
 * This indicates the string is to be treated as a SQL query.
 * It can be a string or a number, because the number is the id of the sql query if we used sql`` to create it.
 */
export type Sql = string | number;

export interface EnumValue {
  name: string;
  renameFrom?: string;
}

export interface Enum {
  name: string;
  renameFrom?: string;
  values: EnumValue[];
}

///
/// PROCEDURE
///

/** Runs an insert, update or delete sql statement */
export interface ModifyStatement {
  t: "Modify";
  sql: string;
}

/** Throws an error in the procedure, error will be of type `thrown_error` */
export interface ThrowStatement {
  t: "Throw";
  message: SqlExpression;
  description?: SqlExpression;
}

/** Expected server rejection; requires runtime validation-error support. */
export interface ValidationErrorStatement {
  t: "ValidationError";
  message: SqlExpression;
  description?: SqlExpression;
}

/**
 Declares a table variable in the procedure.

 You must specify either `query`, `fields` or both.

 If only `query` is specified, the fields of the table will be derived from the query if possible.
 If not possible, you must specify the fields manually.
 */
export interface TableDeclaration {
  t: "TableDeclaration";
  name: string;
  query?: Sql;
  inferQuery?: Sql;
  fields?: ProcTableField[];
  allowNoRead?: boolean;
}

/**
 Declares a record variable in the procedure.

 A record is a table with exactly one row and some syntactic sugar to make it easier to work with.

 For example if you specify a record `foo` you can access a field from it by simply writing `foo.field_name`.

 You must specify either `query`, `fields` or both.

 If only `query` is specified, the fields of the table will be derived from the query if possible.
 If not possible, you must specify the fields manually.
 */
export interface RecordDeclaration {
  t: "RecordDeclaration";
  name: string;
  query?: Sql;
  inferQuery?: Sql;
  fields?: ProcTableField[];
  allowNoRead?: boolean;
}

/**
 Declares a scalar variable in the procedure.

 A scalar is a single value, e.g. a string, number or date. We have some syntactic sugar to make it easier to work with.

 For example if you specify a scalar `foo` you can access it by simply writing `foo` in any expression.

 You must specify either `expr` or `type` or both.

 If only `expr` is specified, the type of the scalar will be derived from the expression if possible.
 If not possible, you must specify the type manually.
 */
export interface ScalarDeclaration {
  t: "ScalarDeclaration";
  name: string;
  expr?: SqlExpression;
  inferExpr?: SqlExpression;
  type?: FieldType;
  allowNoRead?: boolean;
}

/** Sets a scalar to a value. */
export interface SetScalar {
  t: "SetScalar";
  name: string;
  expr: SqlExpression;
}

/**
 Returns a value from the procedure.

 This can also be used as an exit point from the procedure if the procedure doesn't need a return value.
 */
export interface ReturnExprStatement {
  t: "ReturnExpr";
  expr: SqlExpression;
}

export interface DebugExprStatement {
  t: "DebugExpr";
  expr: SqlExpression;
}

export interface CaptureExecutionStatement {
  t: "CaptureExecution";
}

export interface DebugProcAndUiDbStatement {
  t: "DebugProcAndUiDb";
}

export interface DebugQueryStatement {
  t: "DebugQuery";
  query: Sql;
}

/**
 * Logs an error message that will be captured in metrics.
 * Multiple errors can be logged per request and they will all be captured.
 */
export interface LogErrorStatement {
  t: "LogError";
  /** The error message to log */
  message: SqlExpression;
  /** Optional error type/category (defaults to "error") */
  errorType?: SqlExpression;
}

export interface CreateTableCursorStatement {
  t: "CreateTableCursor";
  table: string;
  name: string;
  where?: SqlExpression;
  orderBy?: SqlExpression;
}

export interface CreateQueryCursorStatement {
  t: "CreateQueryCursor";
  query: string;
  name: string;
}

export interface AdvanceCursorStatement {
  t: "AdvanceCursor";
  cursor: string;
}

export interface BreakStatement {
  t: "Break";
  label?: string;
}

export interface ContinueStatement {
  t: "Continue";
  label?: string;
}

export interface QueryToCsvStatement {
  t: "QueryToCsv";
  query: Sql;
  scalar: string;
}

export interface PushSourceStatement {
  t: "PushSource";
  source: string;
}

export interface PopSourceStatement {
  t: "PopSource";
}

export interface EvalRulesStatement {
  t: "EvalRules";
  rules: SqlExpression[][];
}

export interface ValidateExprStatement {
  t: "ValidateExpr";
  expr: SqlExpression;
  name?: string;
}

export interface ValidateQueryStatement {
  t: "ValidateQuery";
  query: Sql;
  name?: string;
}

export interface ValidateModifyStatement {
  t: "ValidateModify";
  sql: string;
  name?: string;
}

// Validates an expression that returns a query string
// assumes that the expression doesn't reference any table or scalar
export interface ValidateQueryExprStatement {
  t: "ValidateQueryExpr";
  query: SqlExpression;
  name?: string;
}

export interface ValidateModifyExprStatement {
  t: "ValidateModifyExpr";
  sql: SqlExpression;
  name?: string;
}

export interface ValidateExprExprStatement {
  t: "ValidateExprExpr";
  expr: SqlExpression;
  name?: string;
}

export interface ExitBlockStatement {
  t: "ExitBlock";
  label?: string;
}

export interface AssertExprType {
  t: "AssertExprType";
  expr: SqlExpression;
  type: ScalarType;
}

export interface AssertQueryType {
  t: "AssertQueryType";
  query: Sql;
  columns: {
    name: string;
    type: ScalarType;
  }[];
}

export interface AssertStatement {
  t: "Assert";
  condition: SqlExpression;
  message?: SqlExpression;
}

export interface AssertEqualStatement {
  t: "AssertEqual";
  actual: SqlExpression;
  expected: SqlExpression;
  message?: SqlExpression;
}

export interface AssertNotEqualStatement {
  t: "AssertNotEqual";
  actual: SqlExpression;
  expected: SqlExpression;
  message?: SqlExpression;
}

/** A statement that is a part of a procedure. A procedure is a set of statements that are executed in order.
  Depending on context (UI, Server, API, Test, etc.) different types of statements are allowed.
  Almost all contexts allow the following BaseStatement(s).
 */
export type BaseStatement =
  | ModifyStatement
  | ThrowStatement
  | TableDeclaration
  | RecordDeclaration
  | ScalarDeclaration
  | SetScalar
  | ReturnExprStatement
  | DebugExprStatement
  | CaptureExecutionStatement
  | DebugProcAndUiDbStatement
  | DebugQueryStatement
  | LogErrorStatement
  | CreateTableCursorStatement
  | CreateQueryCursorStatement
  | BreakStatement
  | ContinueStatement
  | QueryToCsvStatement
  | AdvanceCursorStatement
  | PushSourceStatement
  | PopSourceStatement
  | EvalRulesStatement
  | ValidateExprStatement
  | ValidateQueryStatement
  | ValidateModifyStatement
  | ValidateQueryExprStatement
  | ValidateModifyExprStatement
  | ValidateExprExprStatement
  | ExitBlockStatement
  | AssertExprType
  | AssertQueryType
  | AssertStatement
  | AssertEqualStatement
  | AssertNotEqualStatement;

export interface IfStatement<T> {
  t: "If";
  condition: SqlExpression;
  onTrue: T[];
  onFalse: T[];
}

export interface WhileStatement<T> {
  t: "While";
  condition: SqlExpression;
  label?: string;
  body: T[];
}

export interface BlockStatement<T> {
  t: "Block";
  label?: string;
  body: T[];
}

export interface ForEachCursorStatement<T> {
  t: "ForEachCursor";
  label?: string;
  cursor: string;
  body: T[];
}

export interface ForEachTableStatement<T> {
  t: "ForEachTable";
  label?: string;
  where?: SqlExpression;
  orderBy?: SqlExpression;
  cursorName: string;
  table: string;
  body: T[];
}

export interface ForEachQueryStatement<T> {
  t: "ForEachQuery";
  label?: string;
  query: string;
  cursorName: string;
  body: T[];
}

export interface TryStatement<T> {
  t: "Try";
  body: T[];
  errorName?: string;
  catch?: T[];
  finally?: T[];
}

export type BasicStatement =
  | IfStatement<BasicStatement>
  | WhileStatement<BasicStatement>
  | BlockStatement<BasicStatement>
  | ForEachCursorStatement<BasicStatement>
  | ForEachQueryStatement<BasicStatement>
  | ForEachTableStatement<BasicStatement>
  | TryStatement<BasicStatement>
  | BaseStatement;

export interface ProcTableField {
  name: string;
  type: FieldType;
  notNull?: boolean;
  indexed?: boolean;
}

//
// Database
//

export type FieldType =
  | { type: FieldIntegerTypes }
  | {
    type:
      | "Ordering"
      | "Real"
      | "Double"
      | "Timestamp"
      | "TimestampTz"
      | "Date"
      | "Time"
      | "Bool"
      | "Uuid"
      | "Json"
      | "TimestampTz"
      | "TimestampNaive"
      | "TimestampUtc"
      | "PhoneNumber"
      | "Interval";
  }
  | EnumType
  | DecimalType
  | ForeignKeyType
  | StringType
  | { type: "Tx" }
  | BytesType;

export type FieldIntegerTypes =
  | "TinyUint"
  | "TinyInt"
  | ScalarIntegerTypes
  | "SmallUint"
  | "Uint"
  | "BigUint";

export interface DecimalType {
  type: "Decimal";
  scale: number;
  precision: number;
  signed: boolean;
}

export interface ForeignKeyType {
  type: "ForeignKey";
  table: string;
  onDelete: OnDeleteBehavior;
}

export interface EnumType {
  type: "Enum";
  enum: string;
}

export interface StringType {
  type: "String";
  collation?: Collation;
  maxLength: number;
  minLength?: number;
  maxBytesPerChar?: number;
  autoTrim?: AutoTrim;
}

export interface BytesType {
  type: "Bytes";
  maxLength: number;
}

export type SimpleScalarTypes =
  | "Ordering"
  | "Real"
  | "Double"
  | "Timestamp"
  | "TimestampTz"
  | "Date"
  | "Time"
  | "Bool"
  | "Uuid"
  | "Json"
  | "PhoneNumber"
  | "Interval";

export type ScalarIntegerTypes = "SmallInt" | "Int" | "BigInt";

export type ScalarType =
  | { type: SimpleScalarTypes }
  | { type: ScalarIntegerTypes }
  | { type: "String" }
  | DecimalType
  | EnumType;

export type OnDeleteBehavior = "Cascade" | "Restrict" | "SetToNull";

export type Collation = "Binary" | "NoCase";

export type AutoTrim = "None" | "Left" | "Right" | "Both";

export interface TableField {
  name: string;
  renameFrom?: string;
  description?: string;
  type: FieldType;
  notNull?: boolean;
  default?: SqlExpression;
}

export interface TableTtl {
  fieldName: string;
  expr: SqlExpression;
}

export interface Table {
  name: string;
  primaryKeyFieldName?: string;
  renameFrom?: string;
  description?: string;
  /** Indicates this table should only have a single record. */
  singleRecord?: boolean;
  /** Allows this specific table to have more than 100 fields. */
  allowBigTables?: boolean;
  /**
   * Enables monthly transaction-log compaction for this table.
   *
   * Use for high-churn tables where compact retained logs matter more than
   * preserving every historical record operation. Compaction runs during Level 4
   * maintenance, folds old updates into canonical insert payloads, and may
   * replace deleted inserts with skip records. Already compacted operation
   * history cannot be recovered.
   *
   * See docs/sql/transaction_queries.md for the audit-history caveat.
   */
  autoCompact?: boolean;
  insertOnly?: boolean;
  ttl?: TableTtl;
  fields: TableField[];
  uniqueConstraints?: UniqueConstraint[];
  checks?: SqlExpression[];
  virtuals?: VirtualField[];
}

export interface VirtualField {
  name: string;
  expr: SqlExpression;
  type?: ScalarType;
}

export type UniqueConstraintField =
  | string
  | {
    field: string;
    distinctNulls?: boolean;
  };

export interface UniqueConstraint {
  name?: string;
  fields: UniqueConstraintField[];
  distinctNulls?: boolean;
  where?: Sql;
}

/**
 The database of the system. This is the single, relational database that is shared by all apps, api, webhooks, etc.
 In addition to tables with fields, primary keys, foreign keys, etc., the database also has scalar functions,
 text search configurations and views.
 */
export interface Database {
  collation?: Collation;
  autoTrim?: AutoTrim;
  /** Enables transaction queries, i.e. queries that query the transaction log. */
  enableTransactionQueries: boolean;
  /** Allows tables with more than 100 fields. */
  allowBigTables?: boolean;
  defaultUniqueDistinctNulls?: boolean;
  tables: Table[];
  scalarFunctions?: ScalarFunction[];
  searchMatches?: SearchMatchConfig[];
  views?: View[];
}

export interface View {
  name: string;
  query: Sql;
}

export type Parameter = ProcTableField;

export interface ScalarFunction {
  name: string;
  parameters?: Parameter[];
  procedure: BasicStatement[];
  returnType: ScalarType;
}

/**
 Filters that are applied to tokens during indexing or searching to normalize or modify them.
 */
export type TokenizerFilter =
  /**
   * Convert all tokens to lowercase.
   */
  | { type: "Lowercase" }
  /**
   * Remove tokens longer than a given length.
   * @property len - The maximum allowed length of tokens. Tokens exceeding this length are removed.
   */
  | { type: "RemoveLong"; len: number }
  /**
   * Convert accented or unicode characters to their ASCII equivalents.
   * For example, "é" to "e".
   */
  | { type: "AsciiFold" };

/**
 How text is split into tokens before filtering and indexing.
 */
export type TokenizerSplitter =
  /**
   * No splitting is performed. The entire input is treated as a single token.
   */
  | { type: "None" }
  /**
   * Split text based on alphanumeric characters. Non-alphanumeric characters act as delimiters.
   */
  | { type: "Alphanumeric" }
  /**
   * Split text on whitespace boundaries.
   */
  | { type: "Whitespace" };

/**
 Defines how text is tokenized before indexing or searching.
 @property filters - A list of filters applied to tokens after splitting.
 @property splitter - The strategy for splitting text into tokens.
 */
export interface Tokenizer {
  filters: TokenizerFilter[];
  splitter: TokenizerSplitter;
}

/**
 Defines a table to be included in ranked search, along with optional filtering and relationship chaining.
 @property table - The name of the table to search.
 @property filterExpr - An SQL expression to filter rows before searching. For example, "is_active = true".
 @property disabled - An SQL expression indicating whether searching this table is disabled.
 @property fields - Fields directly on this table to search, with associated priorities.
 @property fieldGroups - Groups of fields to search together with a shared priority.
 @property relatedTables - Other related tables to include in the search, forming a search graph.
 */
export interface RankedSearchTable {
  table: string;
  filterExpr?: SqlExpression;
  disabled?: SqlExpression;
  fields?: { field: string; priority: number }[];
  fieldGroups?: { fields: string[]; priority: number }[];
  relatedTables?: RelatedRankedSearchTable[];
}

/**
 A related table in a ranked search configuration, extending the main RankedSearchTable interface
 with the specification of a relation field.
 @property relationField - A foreign key field on either the parent or related table that points to the other table.
 For example, if the parent table is "contacts" and this is "contact_notes", then "contact_notes.contact_id" would allow
 searching contacts through the contact_notes table.
 If the parent table is "contact_notes" and this is "contacts", then "contact_notes.contact_id" would allow searching contact_notes
 through the contacts table.
 */
export interface RelatedRankedSearchTable extends RankedSearchTable {
  relationField: string;
}

/**
 A configuration defining how ranked searches should be performed across multiple tables.
 @property tokenizer - How text should be tokenized before searching.
 @property style - The matching style to use (fuzzy, contains, exact) along with its configuration.
 @property tables - The tables and related tables involved in the search.
 */
export interface RankedSearchConfig {
  tokenizer: Tokenizer;
  style: RankedSearchStyle;
  tables: RankedSearchTable[];
}

/**
 A configuration defining a named search match, typically used to index and search a single table and its fields.
 @property name - A unique name identifying this search match configuration.
 @property tokenizer - How text should be tokenized before searching.
 @property style - The matching style (fuzzy, contains, exact) and its parameters.
 @property table - The table to apply this search match to.
 @property fields - The list of fields from the table to index and search.
 @property fieldGroups - Groups of fields to be indexed and searched together.
 */
export interface SearchMatchConfig {
  name: string;
  tokenizer: Tokenizer;
  style: SearchMatchStyle;
  table: string;
  fields?: string[];
  fieldGroups?: { fields: string[] }[];
}

/**
 Prefix style determines how the prefix of the search term is treated.
 - "None" means no special prefix handling.
 - "Last" means to treat only the last token as a prefix, allowing for prefix-based matches on that token.
 */
export type PrefixStyle = "None" | "Last";

/**
 Defines tolerance thresholds for fuzzy matching.
 @property {number} min - Minimum token length to apply this tolerance.
 @property {number} tolerance - Number of allowed character alterations (e.g., substitutions, transpositions) for a match.
 */
export interface FuzzyTolerance {
  min: number;
  tolerance: number;
}

/**
 Configuration for fuzzy matching.
 @property {boolean} transpositionCostOne - Whether transposing two adjacent characters counts as a single edit.
 @property {FuzzyTolerance[]} tolerance - An array of tolerance rules based on token length.
 @property {PrefixStyle} prefix - How to treat prefixes during fuzzy matching.
 */
export interface FuzzyConfig {
  transpositionCostOne: boolean;
  tolerance: FuzzyTolerance[];
  prefix: PrefixStyle;
}

/**
 Defines the style of search matching when using a SearchMatchConfig.
 - "Fuzzy": Allows approximate matches according to given tolerances and prefix rules.
 - "Contains": Matches results that contain the search term as a substring.
 - "Exact": Matches only exact terms, with optional prefix handling.
 */
export type SearchMatchStyle =
  | ({ type: "Fuzzy" } & FuzzyConfig)
  | { type: "Contains" }
  | { type: "Exact"; prefix: PrefixStyle };

/**
 Defines the style of search matching when using a RankedSearchConfig.
 Behavior is similar to SearchMatchStyle but used in the context of ranked searching.
 */
export type RankedSearchStyle =
  | ({ type: "Fuzzy" } & FuzzyConfig)
  | { type: "Contains" }
  | { type: "Exact"; prefix: PrefixStyle };

/**
 Represents a SQL statement that performs a ranked search against one or more tables.
 @property t - Indicates this is a search statement.
 @property resultTable - A temporary or result table name where the search results will be stored.
 @property config - The full ranked search configuration, including tables, tokenizer, and style.
 @property query - The search query expression. Typically a string containing search terms.
 @property offset - An optional offset SQL expression for pagination.
 @property limit - A limit SQL expression specifying the maximum number of results to return.
 */
export interface SearchStatement {
  t: "Search";
  resultTable: string;
  config: RankedSearchConfig;
  query: SqlExpression;
  offset?: SqlExpression;
  limit: SqlExpression;
}

//
// UI
//

export type YolmPropNames =
  | "yolmFocusKey"
  | "yolmPopoverShowing"
  | "yolmModalShowing";

export type AriaPropNames =
  | "aria-activedescendant"
  | "aria-atomic"
  | "aria-autocomplete"
  | "aria-busy"
  | "aria-checked"
  | "aria-colcount"
  | "aria-colindex"
  | "aria-colspan"
  | "aria-controls"
  | "aria-current"
  | "aria-describedby"
  | "aria-details"
  | "aria-disabled"
  | "aria-dropeffect"
  | "aria-errormessage"
  | "aria-expanded"
  | "aria-flowto"
  | "aria-grabbed"
  | "aria-haspopup"
  | "aria-hidden"
  | "aria-invalid"
  | "aria-keyshortcuts"
  | "aria-label"
  | "aria-labelledby"
  | "aria-level"
  | "aria-live"
  | "aria-modal"
  | "aria-multiline"
  | "aria-multiselectable"
  | "aria-orientation"
  | "aria-owns"
  | "aria-placeholder"
  | "aria-posinset"
  | "aria-pressed"
  | "aria-readonly"
  | "aria-relevant"
  | "aria-required"
  | "aria-roledescription"
  | "aria-rowcount"
  | "aria-rowindex"
  | "aria-rowspan"
  | "aria-selected"
  | "aria-setsize"
  | "aria-sort"
  | "aria-valuemax"
  | "aria-valuemin"
  | "aria-valuenow"
  | "aria-valuetext";

export type HtmlPropNames =
  | "accessKey"
  | "className"
  | "contentEditable"
  | "contextMenu"
  | "dir"
  | "draggable"
  | "hidden"
  | "id"
  | "lang"
  | "placeholder"
  | "slot"
  | "spellCheck"
  | "style"
  | "tabIndex"
  | "title"
  | "translate"
  | "radioGroup"
  | "role"
  | "autoCapitalize"
  | "autoCorrect"
  | "autoSave"
  | "color"
  | "itemProp"
  | "itemScope"
  | "itemType"
  | "itemID"
  | "itemRef"
  | "results"
  | "security"
  | "unselectable"
  | "inputMode";

export type AllHtmlPropNames =
  | AriaPropNames
  | HtmlPropNames
  | YolmPropNames
  | "accept"
  | "acceptCharset"
  | "action"
  | "allowFullScreen"
  | "allowTransparency"
  | "alt"
  | "as"
  | "async"
  | "autoComplete"
  | "autoFocus"
  | "autoPlay"
  | "capture"
  | "cellPadding"
  | "cellSpacing"
  | "charSet"
  | "challenge"
  | "checked"
  | "cite"
  | "classID"
  | "cols"
  | "colSpan"
  | "content"
  | "controls"
  | "coords"
  | "crossOrigin"
  | "data"
  | "dateTime"
  | "default"
  | "defer"
  | "disabled"
  | "download"
  | "encType"
  | "form"
  | "formAction"
  | "formEncType"
  | "formMethod"
  | "formNoValidate"
  | "formTarget"
  | "frameBorder"
  | "headers"
  | "height"
  | "high"
  | "href"
  | "hrefLang"
  | "htmlFor"
  | "httpEquiv"
  | "indeterminate"
  | "integrity"
  | "keyParams"
  | "keyType"
  | "kind"
  | "label"
  | "list"
  | "loop"
  | "low"
  | "manifest"
  | "marginHeight"
  | "marginWidth"
  | "max"
  | "maxLength"
  | "media"
  | "mediaGroup"
  | "method"
  | "min"
  | "minLength"
  | "multiple"
  | "muted"
  | "name"
  | "nonce"
  | "noValidate"
  | "open"
  | "optimum"
  | "pattern"
  | "placeholder"
  | "playsInline"
  | "poster"
  | "preload"
  | "readOnly"
  | "rel"
  | "required"
  | "reversed"
  | "rows"
  | "rowSpan"
  | "sandbox"
  | "scope"
  | "scoped"
  | "scrolling"
  | "seamless"
  | "selected"
  | "shape"
  | "size"
  | "sizes"
  | "span"
  | "src"
  | "srcDoc"
  | "srcLang"
  | "srcSet"
  | "start"
  | "step"
  | "summary"
  | "target"
  | "type"
  | "useMap"
  | "value"
  | "width"
  | "wmode"
  | "wrap"
  | "popover";

export type SvgPropNames =
  | AriaPropNames
  | HtmlPropNames
  | "color"
  | "height"
  | "id"
  | "lang"
  | "max"
  | "media"
  | "method"
  | "min"
  | "name"
  | "style"
  | "target"
  | "type"
  | "width"
  | "role"
  | "tabIndex"
  | "crossOrigin"
  | "accentHeight"
  | "accumulate"
  | "additive"
  | "alignmentBaseline"
  | "text-after-edge"
  | "allowReorder"
  | "alphabetic"
  | "amplitude"
  | "arabicForm"
  | "ascent"
  | "attributeName"
  | "attributeType"
  | "autoReverse"
  | "azimuth"
  | "baseFrequency"
  | "baselineShift"
  | "baseProfile"
  | "bbox"
  | "begin"
  | "bias"
  | "by"
  | "calcMode"
  | "capHeight"
  | "clip"
  | "clipPath"
  | "clipPathUnits"
  | "clipRule"
  | "colorInterpolation"
  | "colorInterpolationFilters"
  | "colorProfile"
  | "colorRendering"
  | "contentScriptType"
  | "contentStyleType"
  | "cursor"
  | "cx"
  | "cy"
  | "d"
  | "decelerate"
  | "descent"
  | "diffuseConstant"
  | "direction"
  | "display"
  | "divisor"
  | "dominantBaseline"
  | "dur"
  | "dx"
  | "dy"
  | "edgeMode"
  | "elevation"
  | "enableBackground"
  | "end"
  | "exponent"
  | "externalResourcesRequired"
  | "fill"
  | "fillOpacity"
  | "fillRule"
  | "filter"
  | "filterRes"
  | "filterUnits"
  | "floodColor"
  | "floodOpacity"
  | "focusable"
  | "fontFamily"
  | "fontSize"
  | "fontSizeAdjust"
  | "fontStretch"
  | "fontStyle"
  | "fontVariant"
  | "fontWeight"
  | "format"
  | "from"
  | "fx"
  | "fy"
  | "g1"
  | "g2"
  | "glyphName"
  | "glyphOrientationHorizontal"
  | "glyphOrientationVertical"
  | "glyphRef"
  | "gradientTransform"
  | "gradientUnits"
  | "hanging"
  | "horizAdvX"
  | "horizOriginX"
  | "href"
  | "ideographic"
  | "imageRendering"
  | "in2"
  | "in"
  | "intercept"
  | "k1"
  | "k2"
  | "k3"
  | "k4"
  | "k"
  | "kernelMatrix"
  | "kernelUnitLength"
  | "kerning"
  | "keyPoints"
  | "keySplines"
  | "keyTimes"
  | "lengthAdjust"
  | "letterSpacing"
  | "lightingColor"
  | "limitingConeAngle"
  | "local"
  | "markerEnd"
  | "markerHeight"
  | "markerMid"
  | "markerStart"
  | "markerUnits"
  | "markerWidth"
  | "mask"
  | "maskContentUnits"
  | "maskUnits"
  | "mathematical"
  | "mode"
  | "numOctaves"
  | "offset"
  | "opacity"
  | "operator"
  | "order"
  | "orient"
  | "orientation"
  | "origin"
  | "overflow"
  | "overlinePosition"
  | "overlineThickness"
  | "paintOrder"
  | "panose1"
  | "path"
  | "pathLength"
  | "patternContentUnits"
  | "patternTransform"
  | "patternUnits"
  | "pointerEvents"
  | "points"
  | "pointsAtX"
  | "pointsAtY"
  | "pointsAtZ"
  | "preserveAlpha"
  | "preserveAspectRatio"
  | "primitiveUnits"
  | "r"
  | "radius"
  | "refX"
  | "refY"
  | "renderingIntent"
  | "repeatCount"
  | "repeatDur"
  | "requiredExtensions"
  | "requiredBlocks"
  | "restart"
  | "result"
  | "rotate"
  | "rx"
  | "ry"
  | "scale"
  | "seed"
  | "shapeRendering"
  | "slope"
  | "spacing"
  | "specularConstant"
  | "specularExponent"
  | "speed"
  | "spreadMethod"
  | "startOffset"
  | "stdDeviation"
  | "stemh"
  | "stemv"
  | "stitchTiles"
  | "stopColor"
  | "stopOpacity"
  | "strikethroughPosition"
  | "strikethroughThickness"
  | "string"
  | "stroke"
  | "strokeDasharray"
  | "strokeDashoffset"
  | "strokeLinecap"
  | "strokeLinejoin"
  | "strokeMiterlimit"
  | "strokeOpacity"
  | "strokeWidth"
  | "surfaceScale"
  | "systemLanguage"
  | "tableValues"
  | "targetX"
  | "targetY"
  | "textAnchor"
  | "textDecoration"
  | "textLength"
  | "textRendering"
  | "to"
  | "transform"
  | "u1"
  | "u2"
  | "underlinePosition"
  | "underlineThickness"
  | "unicode"
  | "unicodeBidi"
  | "unicodeRange"
  | "unitsPerEm"
  | "vAlphabetic"
  | "values"
  | "vectorEffect"
  | "version"
  | "vertAdvY"
  | "vertOriginX"
  | "vertOriginY"
  | "vHanging"
  | "vIdeographic"
  | "viewBox"
  | "viewTarget"
  | "visibility"
  | "vMathematical"
  | "widths"
  | "wordSpacing"
  | "writingMode"
  | "x1"
  | "x2"
  | "x"
  | "xChannelSelector"
  | "xHeight"
  | "xlinkActuate"
  | "xlinkArcrole"
  | "xlinkHref"
  | "xlinkRole"
  | "xlinkShow"
  | "xlinkTitle"
  | "xlinkType"
  | "xmlBase"
  | "xmlLang"
  | "xmlns"
  | "xmlnsXlink"
  | "xmlSpace"
  | "y1"
  | "y2"
  | "y"
  | "yChannelSelector"
  | "z"
  | "zoomAndPan";

export type AllHtmlTags =
  | "a"
  | "abbr"
  | "address"
  | "area"
  | "article"
  | "aside"
  | "audio"
  | "b"
  | "base"
  | "bdi"
  | "bdo"
  | "big"
  | "blockquote"
  | "body"
  | "br"
  | "button"
  | "canvas"
  | "caption"
  | "cite"
  | "code"
  | "col"
  | "colgroup"
  | "data"
  | "datalist"
  | "dd"
  | "del"
  | "details"
  | "dfn"
  | "dialog"
  | "div"
  | "dl"
  | "dt"
  | "em"
  | "embed"
  | "fieldset"
  | "figcaption"
  | "figure"
  | "footer"
  | "form"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "head"
  | "header"
  | "hgroup"
  | "hr"
  | "html"
  | "i"
  | "iframe"
  | "img"
  | "input"
  | "ins"
  | "kbd"
  | "keygen"
  | "label"
  | "legend"
  | "li"
  | "link"
  | "main"
  | "map"
  | "mark"
  | "menu"
  | "menuitem"
  | "meta"
  | "meter"
  | "nav"
  | "noindex"
  | "noscript"
  | "object"
  | "ol"
  | "optgroup"
  | "option"
  | "output"
  | "p"
  | "param"
  | "picture"
  | "pre"
  | "progress"
  | "q"
  | "rp"
  | "rt"
  | "ruby"
  | "s"
  | "samp"
  | "slot"
  | "script"
  | "section"
  | "select"
  | "small"
  | "source"
  | "span"
  | "strong"
  | "style"
  | "sub"
  | "summary"
  | "sup"
  | "table"
  | "template"
  | "tbody"
  | "td"
  | "textarea"
  | "tfoot"
  | "th"
  | "thead"
  | "time"
  | "title"
  | "tr"
  | "track"
  | "u"
  | "ul"
  | "var"
  | "video"
  | "wbr"
  | "webview"
  | "svg"
  | "animate"
  | "animateMotion"
  | "animateTransform"
  | "circle"
  | "clipPath"
  | "defs"
  | "desc"
  | "ellipse"
  | "feBlend"
  | "feColorMatrix"
  | "feComponentTransfer"
  | "feComposite"
  | "feConvolveMatrix"
  | "feDiffuseLighting"
  | "feDisplacementMap"
  | "feDistantLight"
  | "feDropShadow"
  | "feFlood"
  | "feFuncA"
  | "feFuncB"
  | "feFuncG"
  | "feFuncR"
  | "feGaussianBlur"
  | "feImage"
  | "feMerge"
  | "feMergeNode"
  | "feMorphology"
  | "feOffset"
  | "fePointLight"
  | "feSpecularLighting"
  | "feSpotLight"
  | "feTile"
  | "feTurbulence"
  | "filter"
  | "foreignObject"
  | "g"
  | "image"
  | "line"
  | "linearGradient"
  | "marker"
  | "mask"
  | "metadata"
  | "mpath"
  | "path"
  | "pattern"
  | "polygon"
  | "polyline"
  | "radialGradient"
  | "rect"
  | "stop"
  | "switch"
  | "symbol"
  | "text"
  | "textPath"
  | "tspan"
  | "use"
  | "view";

export type EventHandlerName =
  | "click"
  | "doubleClick"
  | "clickAway"
  | "mouseDown"
  | "mouseUp"
  | "mouseEnter"
  | "mouseLeave"
  | "mouseOver"
  | "mouseOut"
  | "mouseMove"
  | "keydown"
  | "keyup"
  | "blur"
  | "focus"
  | "focusin"
  | "focusout"
  | "focusAway"
  | "input"
  | "checkboxChange"
  | "change"
  | "submit"
  | "fileChange"
  | "mount"
  | "scroll"
  | "mousemove"
  | "close"
  | "cancel"
  | "toggleShow"
  | "toggleHide"
  | "dialogBackdropClick"
  | "dragStart"
  | "drag"
  | "dragEnd"
  | "drop"
  | "dragEnter"
  | "dragLeave"
  | "dragOver"
  | "paste"
  | "visibilityChange"
  | "beforeUnload"
  | "resize";

export interface SleepStatement {
  t: "Sleep";
  /** positive integer */
  ms: SqlExpression;
}

export interface CommitUiTreeChangesStatement {
  t: "CommitUiTreeChanges";
}

export interface RunTreeChangeEffectsStatement {
  t: "RunTreeChangeEffects";
}

/**
 This will run a set of statements as a new asynchronous task, this means this can
 run concurrently with the task that spawned it.

 `detached` makes it so that the task is not aborted when the parent task is aborted, by default
 the task is aborted when the parent task is aborted.
 */
export interface StartDomTaskStatement {
  t: "StartTask";
  disableAutoUiCommit?: boolean;
  detached?: boolean;
  idScalar?: string;
  statements: DomProcStatement[];
}

export interface WaitOnDomTaskStatement {
  t: "WaitOnTask";
  id: SqlExpression;
}

export interface WaitOnDomTasksStatement {
  t: "WaitOnTasks";
  /** Either a query or list of expressions of task handles */
  tasks: Sql | SqlExpression[];
}

export interface WaitOnOneOfDomTasksStatement {
  t: "WaitOnOneOfTasks";
  /** Either a query or list of expressions of task handles */
  tasks: Sql | SqlExpression[];
}

export interface CancelDomTaskStatement {
  t: "CancelTask";
  id: SqlExpression;
}

export interface ElementScrollIntoViewStatement {
  t: "ScrollIntoView";
  behavior?: "'auto'" | "'instant'" | "'smooth'" | SqlExpression;
  block?: "'start'" | "'center'" | "'end'" | "'nearest'" | SqlExpression;
  inline?: "'start'" | "'center'" | "'end'" | "'nearest'" | SqlExpression;
}

export interface ElementScrollToStatement {
  t: "ScrollTo";
  left: SqlExpression;
  top: SqlExpression;
  behavior?: "'auto'" | "'instant'" | "'smooth'" | SqlExpression;
}

export interface ElementFocusStatement {
  t: "Focus";
}

export type ElProperty =
  | "scrollHeight"
  | "scrollWidth"
  | "scrollTop"
  | "scrollLeft"
  | "selectionStart"
  | "selectionEnd"
  | "selectionDirection";

export interface ElementGetPropertyStatement {
  t: "GetProperty";
  property: ElProperty;
  scalar: string;
}

export interface ElementGetBoundingClientRectStatement {
  t: "GetBoundingClientRect";
  record: string;
}

export interface ElementBlurStatement {
  t: "Blur";
}

export interface ElementClickStatement {
  t: "Click";
}

export interface ElementMatchesStatement {
  t: "Matches";
  selector: SqlExpression;
  scalar: string;
}

export interface ElementSetSelectionRangeStatement {
  t: "SetSelectionRange";
  start: SqlExpression;
  end: SqlExpression;
  direction?: "'forward'" | "'backward'" | "'none'" | SqlExpression;
}

export type ElementStatementInner =
  | ElementScrollIntoViewStatement
  | ElementScrollToStatement
  | ElementFocusStatement
  | ElementGetPropertyStatement
  | ElementGetBoundingClientRectStatement
  | ElementBlurStatement
  | ElementClickStatement
  | ElementMatchesStatement
  | ElementSetSelectionRangeStatement;

export interface ElementStatement {
  t: "Element";
  elementId: SqlExpression;
  statement: ElementStatementInner;
}

export interface WindowGetPropertyStatement {
  t: "GetProperty";
  property: WindowProperty;
  scalar: string;
}

export type WindowProperty =
  | "outerHeight"
  | "outerWidth"
  | "innerHeight"
  | "innerWidth"
  | "scrollY"
  | "scrollX"
  | "screenLeft"
  | "screenTop";

export interface WindowOpenStatement {
  t: "Open";
  url: SqlExpression;
  target?: SqlExpression;
  features?: SqlExpression;
}

export interface WindowCloseStatement {
  t: "Close";
}

export interface WindowFocusStatement {
  t: "Focus";
}

export interface WindowPrintStatement {
  t: "Print";
}

export interface WindowScrollToStatement {
  t: "ScrollTo";
  top: SqlExpression;
  left: SqlExpression;
  behavior?: "'auto'" | "'instant'" | "'smooth'" | SqlExpression;
}

export type WindowStatementInner =
  | WindowGetPropertyStatement
  | WindowCloseStatement
  | WindowFocusStatement
  | WindowPrintStatement
  | WindowOpenStatement
  | WindowScrollToStatement;

export interface WindowStatement {
  t: "Window";
  statement: WindowStatementInner;
}

export interface ReadClipboardTextStatement {
  t: "ReadText";
  scalar: string;
}

export interface WriteClipboardTextStatement {
  t: "WriteText";
  text: SqlExpression;
}

export interface ClipboardStatement {
  t: "Clipboard";
  statement: ReadClipboardTextStatement | WriteClipboardTextStatement;
}

export interface LocationReloadStatement {
  t: "LocationReload";
}

export interface LocationAssignStatement {
  t: "LocationAssign";
  url: SqlExpression;
}

export interface JsCallStatement {
  t: "JsCall";
  /** The module ID to call. */
  module: string;
  /** The export name to call. */
  exportName: string;
  handle: SqlExpression;
  /** Optional arguments to pass. */
  args?: JsCallArgs;
  /** Optional result configuration. */
  result?: JsCallResult;
}

export type DocumentProperty = "hidden";

export interface GetDocumentPropertyStatement {
  t: "GetDocumentProperty";
  property: DocumentProperty;
  scalar: string;
}

export interface ServerStatement {
  t: "Server";
  transferFiles?: Sql;
  statements: UiServerProcStatement[];
}

export interface Download {
  t: "Download";
  filename: SqlExpression;
  content: SqlExpression;
  contentType?: SqlExpression;
}

export interface EmitDynamicInternalEventStatement {
  t: "EmitDynamicInternalEvent";
  name: SqlExpression;
  payloadJson?: SqlExpression;
}

export interface PreventDefault {
  t: "PreventDefault";
}

export interface StopPropagation {
  t: "StopPropagation";
}

export interface GetEventTargetStatement {
  t: "GetEventTarget";
  scalar: string;
}

export interface GetEventCurrentTargetStatement {
  t: "GetEventCurrentTarget";
  scalar: string;
}

export type ViewTransitionTiming =
  | "immediate"
  | "not_immediate"
  | "fallback"
  | "final"
  | "next"
  | "next_not_immediate"
  | "next_and_final"
  | "all";

export interface TriggerViewTransition {
  t: "TriggerViewTransition";
  on: ViewTransitionTiming;
  type?: SqlExpression;
}

export interface SetDropEffectStatement {
  t: "SetDropEffect";
  dropEffect: SqlExpression;
}

export interface SetEffectAllowedStatement {
  t: "SetEffectAllowed";
  effectAllowed: SqlExpression;
}

export interface HistoryGoStatement {
  t: "HistoryGo";
  delta: SqlExpression;
}

export interface IdbGetStatement {
  t: "IdbGet";
  key: SqlExpression;
  scalar: string;
}

export interface IdbSetStatement {
  t: "IdbSet";
  key: SqlExpression;
  value: SqlExpression;
}

export interface IdbRemoveStatement {
  t: "IdbRemove";
  key: SqlExpression;
}

export interface IdbClearStatement {
  t: "IdbClear";
}

export interface IdbKeysStatement {
  t: "IdbKeys";
  table: string;
}

export type DomProcStatement =
  | IfStatement<DomProcStatement>
  | WhileStatement<DomProcStatement>
  | BlockStatement<DomProcStatement>
  | ForEachCursorStatement<DomProcStatement>
  | ForEachQueryStatement<DomProcStatement>
  | ForEachTableStatement<DomProcStatement>
  | TryStatement<DomProcStatement>
  | BaseStatement
  | NavigateStatement
  | PreventDefault
  | StopPropagation
  | Download
  | EmitDynamicInternalEventStatement
  | SetQueryParam
  | ServerStatement
  | SleepStatement
  | CommitUiTreeChangesStatement
  | StartDomTaskStatement
  | WaitOnDomTaskStatement
  | WaitOnDomTasksStatement
  | WaitOnOneOfDomTasksStatement
  | CancelDomTaskStatement
  | ElementFocusStatement
  | ElementScrollIntoViewStatement
  | RequestStatement
  | WindowStatement
  | ElementStatement
  | LocationAssignStatement
  | LocationReloadStatement
  | ClearLocalDataStatement
  | TriggerViewTransition
  | RunTreeChangeEffectsStatement
  | ReadDomFileStatement
  | SetDropEffectStatement
  | SetEffectAllowedStatement
  | GetDocumentPropertyStatement
  | RemoveCookieStatement
  | SetCookieStatement
  | HistoryGoStatement
  | GetEventTargetStatement
  | GetEventCurrentTargetStatement
  | ClipboardStatement
  | JsCallStatement
  | IdbGetStatement
  | IdbSetStatement
  | IdbRemoveStatement
  | IdbClearStatement
  | IdbKeysStatement;

export interface ClearLocalDataStatement {
  t: "ClearLocalData";
}

export interface NavigateStatement {
  t: "Navigate";
  to: SqlExpression;
  replace?: SqlExpression;
}

export interface SetQueryParam {
  t: "SetQueryParam";
  param: SqlExpression;
  value: SqlExpression;
  replace?: SqlExpression;
}

export interface StartTransactionStatement {
  t: "StartTransaction";
}

export interface CommitTransactionStatement {
  t: "CommitTransaction";
  txScalar?: string;
}

export interface RollbackTransactionStatement {
  t: "RollbackTransaction";
}

export interface UndoTx {
  t: "UndoTx";
  tx: SqlExpression;
}

export interface UndoTransactions {
  t: "UndoTransactions";
  query: SqlExpression;
}

export interface AnalyzeUndoTransactions {
  t: "AnalyzeUndoTransactions";
  query: SqlExpression;
  resultTable: string;
}

export interface ReadDomFileStatement {
  t: "ReadDomFile";
  fileId: SqlExpression;
  bodyScalar: string;
}

export interface CreateBlobStatement {
  t: "CreateBlob";
  /** Def-style: declares a new scalar receiving the hash. */
  hashScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setHashScalar?: string;
  content: SqlExpression;
}

export interface ReadBlobStatement {
  t: "ReadBlob";
  hash: SqlExpression;
  /** Def-style: declares a new scalar receiving the content. */
  contentScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setContentScalar?: string;
}

export interface RemoveBlobStatement {
  t: "RemoveBlob";
  hash: SqlExpression;
}

export interface PdfRenderPageStatement {
  t: "PdfRenderPage";
  pdf: SqlExpression;
  page: SqlExpression;
  width: SqlExpression;
  /** Def-style: declares a new scalar receiving the PNG bytes. */
  outputScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setOutputScalar?: string;
}

export interface CropImageStatement {
  t: "CropImage";
  inBytes: SqlExpression;
  imageType: SqlExpression;
  x: SqlExpression;
  y: SqlExpression;
  width: SqlExpression;
  height: SqlExpression;
  /** Def-style: declares a new scalar receiving the cropped PNG bytes. */
  outBytesScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setOutBytesScalar?: string;
}

/** Push bytes from a procedure-side bytes scalar into the per-RunJavascript
    JS scratch and write the resulting BigInt id into a scalar. */
export interface SetJsBytesStatement {
  t: "SetJsBytes";
  bytes: SqlExpression;
  /** Def-style: declares a new BigInt scalar receiving the id. */
  idScalar?: string;
  /** Set-style: assigns into an existing BigInt scalar in scope. */
  setIdScalar?: string;
}

/** Look up bytes in the JS scratch by id and write them into a procedure-side
    bytes scalar. The id comes from a prior `setJsBytes` or `yolm.bytes.set`. */
export interface GetJsBytesStatement {
  t: "GetJsBytes";
  id: SqlExpression;
  /** Def-style: declares a new bytes scalar receiving the content. */
  bytesScalar?: string;
  /** Set-style: assigns into an existing bytes scalar in scope. */
  setBytesScalar?: string;
}

export interface ResizeImageStatement {
  t: "ResizeImage";
  inBytes: SqlExpression;
  imageType: SqlExpression;
  resizeType: SqlExpression;
  width: SqlExpression;
  height: SqlExpression;
  /** Def-style: declares a new scalar receiving the resized bytes. */
  outBytesScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setOutBytesScalar?: string;
}

export interface RenderTemplateStatement {
  t: "RenderTemplate";
  template: SqlExpression;
  scope: Record<string, string>;
  hasDbAccess?: boolean;
  htmlEscaped?: boolean;
  /** Def-style: declares a new scalar receiving the rendered output. */
  outputScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setOutputScalar?: string;
}

export interface QueryToExcelColumnDef {
  format?: string;
  width?: number;
  header?: string;
}

export interface QueryToExcelFooterRowDef {
  label?: string;
  columns: Record<string, string>;
}

export interface QueryToExcelSheetDef {
  name?: string;
  query: string;
  title?: string;
  columns?: Record<string, QueryToExcelColumnDef>;
  footer?: QueryToExcelFooterRowDef[];
  freezeHeaderRow?: boolean;
  skipAutoRowCap?: boolean;
}

export interface QueryToExcelStatement {
  t: "QueryToExcel";
  sheets: QueryToExcelSheetDef[];
  password?: string;
  /** Def-style: declares a new scalar receiving the XLSX bytes. */
  outputScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setOutputScalar?: string;
}

export type CreateZipSourceType = "BlobHash" | "Bytes";

export type ZipCompression = "Store" | "Deflate";

export interface CreateZipStatement {
  t: "CreateZip";
  query: string;
  sourceType: CreateZipSourceType;
  compression?: ZipCompression;
  /** Def-style: declares a new scalar receiving the zip bytes. */
  outputScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setOutputScalar?: string;
}

export interface RenderMjmlStatement {
  t: "RenderMjml";
  mjml: SqlExpression;
  /** Def-style: declares a new scalar receiving the rendered HTML. */
  outputScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setOutputScalar?: string;
}

export interface UploadPublicAssetStatement {
  t: "UploadPublicAsset";
  content: SqlExpression;
  contentType: SqlExpression;
  /** Def-style: declares a new scalar receiving the asset hash. */
  hashScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setHashScalar?: string;
}

export interface RenderTypstStatement {
  t: "RenderTypst";
  template: string;
  data: string;
  /**
       Only pdf is supported for now.
       */
  outputFormat: "'pdf'" | SqlExpression;
  /** Def-style: declares a new scalar receiving the PDF bytes. */
  pdfOutputScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setPdfOutputScalar?: string;
  assets?: RenderTypstAsset[];
  options?: SqlExpression;
}

export interface RunJavascriptStatement {
  t: "RunJavascript";
  /** The JavaScript code to execute. */
  script: SqlExpression;
  /** Optional tools that the JavaScript can call. */
  tools?: RunJavascriptTool[];
  /** Required common policy for procedure-backed tools. */
  procedureToolPolicy?: ProcedureToolPolicy;
  /** Optional sandbox configuration for security and resource limits. */
  sandbox?: RunJavascriptSandbox;
  /** Optional scalar to store the result. */
  resultScalar?: string;
  /** Optional record to store error information. */
  errorRecord?: string;
  /** Optional table to store output. */
  outputTable?: string;
  /** Optional scalar to capture console.log output as a single string. */
  consoleOutput?: string;
  /**
   * Optional Sql expression evaluating to a JSON array of strings naming the
   * bundled libs the script may `await import(...)`. Omit (or null/empty) to
   * allow every bundled lib (legacy behavior). Empty array → deny all.
   */
  includeLibs?: SqlExpression;
}

export type ProcedureToolInputBinding =
  | { kind: "normalizedArguments" }
  | { kind: "trustedHostScalar"; scalar: string }
  | { kind: "policyOutput"; scalar: string };

export interface ProcedureToolStateOutput {
  outputScalar: string;
  stateScalar: string;
}

/** A metadata-only binding to a checked `toolEntry` stored procedure. */
export interface RunJavascriptTool {
  name: string;
  timeoutMs?: number;
  implementation: "procedure";
  procedure: string;
  inputBindings: Record<string, ProcedureToolInputBinding>;
  stateOutputs: ProcedureToolStateOutput[];
  policyMetadataJson: string;
  statements?: never;
}

export type ProcedureToolPolicyInputBinding =
  | { kind: "rawArguments" }
  | { kind: "toolMetadata" }
  | { kind: "trustedHostScalar"; scalar: string };

export interface ProcedureToolPolicy {
  procedure: string;
  inputBindings: Record<string, ProcedureToolPolicyInputBinding>;
  outputBindings: Record<string, string>;
}

export interface RunJavascriptSandbox {
  /** Maximum memory in MB (default: 100). */
  maxMemoryMb?: SqlExpression;
  /** Maximum total time in milliseconds (default: 30000). */
  maxTimeMs?: SqlExpression;
  /** Maximum CPU time in milliseconds (default: 25000). */
  maxCpuTimeMs?: SqlExpression;
  /** Allowed global variables. */
  allowedGlobals?: string[];
  /** Blocked global variables (default: ['Deno', 'process', 'require', 'globalThis.Deno']). */
  blockedGlobals?: string[];
  /** Whether to track resource usage. */
  trackResourceUsage?: boolean;
  /** Optional isolate ID for reusing the same JavaScript context. */
  isolateId?: SqlExpression;
}

export interface StudioRequestStatement {
  t: "StudioRequest";
  request: SqlExpression;
  resultScalar: string;
  bytesResultScalar?: string;
}

export interface ServiceRequestStatement {
  usageContext?: SqlExpression;
  usageScalar?: string;
  setUsageScalar?: string;
  t: "ServiceRequest";
  serviceType: SqlExpression;
  operation: SqlExpression;
  optIn?: SqlExpression;
  requestJson: SqlExpression;
  requestBytes?: SqlExpression;
  /** Def-style: declares a new scalar receiving the result JSON. */
  resultJsonScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setResultJsonScalar?: string;
  /** Def-style: declares a new scalar receiving the result bytes. */
  resultBytesScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setResultBytesScalar?: string;
  /** Def-style: declares a new scalar receiving the error JSON. */
  errorJsonScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setErrorJsonScalar?: string;
  mockProcedure?: EndpointStatement[];
}

export type SftpAuth =
  | {
    type: "Password";
    password: SqlExpression;
  }
  | {
    type: "PrivateKey";
    privateKey: SqlExpression;
    passphrase?: SqlExpression;
  };

export interface SftpConnection {
  host: SqlExpression;
  port?: SqlExpression;
  username: SqlExpression;
  auth: SftpAuth;
  hostKey: SqlExpression;
  connectTimeoutMs?: SqlExpression;
  ioTimeoutMs?: SqlExpression;
}

export type SftpSendSource =
  | {
    type: "Bytes";
    bytes: SqlExpression;
  }
  | {
    type: "BlobHash";
    blobHash: SqlExpression;
  };

export interface SftpSendStatement {
  t: "SftpSend";
  connection: SftpConnection;
  remotePath: SqlExpression;
  source: SftpSendSource;
  overwrite?: SqlExpression;
  createParents?: SqlExpression;
  /** Def-style: declares a new scalar receiving the result JSON. */
  resultJsonScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setResultJsonScalar?: string;
  /** Def-style: declares a new scalar receiving the error JSON. */
  errorJsonScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setErrorJsonScalar?: string;
}

export type SftpReceiveDestination =
  | {
    type: "BytesScalar";
    /** Def-style: declares a new scalar receiving the file bytes. */
    contentScalar?: string;
    /** Set-style: assigns file bytes into an existing scalar in scope. */
    setContentScalar?: string;
  }
  | {
    type: "BlobHashScalar";
    /** Def-style: declares a new scalar receiving the blob hash. */
    blobHashScalar?: string;
    /** Set-style: assigns the blob hash into an existing scalar in scope. */
    setBlobHashScalar?: string;
  };

export interface SftpReceiveStatement {
  t: "SftpReceive";
  connection: SftpConnection;
  remotePath: SqlExpression;
  destination: SftpReceiveDestination;
  /** Def-style: declares a new scalar receiving the result JSON. */
  resultJsonScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setResultJsonScalar?: string;
  /** Def-style: declares a new scalar receiving the error JSON. */
  errorJsonScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setErrorJsonScalar?: string;
}

export interface RemoveFilesStatement {
  t: "RemoveFiles";
  query: Sql;
}

export interface CallStoredProcedureStatement {
  t: "CallStoredProcedure";
  name: string;
  /** Skip JIT prewarming for a bounded static dispatcher child call. */
  prewarm?: "never";
  inputScalars?: Record<string, SqlExpression>;
  inputRecords?: Record<string, string>;
  inputTables?: Record<string, string>;
  outputScalars?: Record<string, string>;
  outputRecords?: Record<string, string>;
  outputTables?: Record<string, string>;
}

export type GeneralServerBaseStatement =
  | BaseStatement
  | ValidationErrorStatement
  | SetCurrentUserStatement
  | SetContextStatement
  | SleepStatement
  | StartTransactionStatement
  | CommitTransactionStatement
  | RollbackTransactionStatement
  | UndoTx
  | UndoTransactions
  | AnalyzeUndoTransactions
  | RestoreStatement
  | DynamicModifyStatement
  | DynamicQueryStatement
  | DynamicQueryToCsv
  | DynamicQueryToJson
  | ValidateDynamicQuery
  | SearchStatement
  | RequestStatement
  | ServiceRequestStatement
  | SftpSendStatement
  | CallStoredProcedureStatement
  | SftpReceiveStatement
  | RemoveFilesStatement
  | CreateBlobStatement
  | ReadBlobStatement
  | RemoveBlobStatement
  | PdfRenderPageStatement
  | CropImageStatement
  | SetJsBytesStatement
  | GetJsBytesStatement
  | ResizeImageStatement
  | RenderTemplateStatement
  | QueryToExcelStatement
  | CreateZipStatement
  | RenderMjmlStatement
  | UploadPublicAssetStatement
  | StudioRequestStatement
  | DevQueryDatabasesStatement
  | DevExplainQueryStatement
  | DynamicExplainQueryStatement
  | RenderTypstStatement
  | RunJavascriptStatement
  | SetCurrentUserStatement;

export interface DevQueryDatabasesStatement {
  t: "DevQueryDatabases";
  query: SqlExpression;
  databaseMapping: SqlExpression;
  primaryDatabase: SqlExpression;
  resultScalar: string;
  explain?: SqlExpression;
  explainOnly?: SqlExpression;
  metrics?: SqlExpression;
  skipAutoRowCap?: SqlExpression;
  explainScalar?: string;
  metricsScalar?: string;
}

export interface DevExplainQueryStatement {
  t: "DevExplainQuery";
  query: SqlExpression;
  databaseMapping: SqlExpression;
  primaryDatabase: SqlExpression;
  resultScalar: string;
}

export type GeneralServerStatement =
  | IfStatement<GeneralServerStatement>
  | WhileStatement<GeneralServerStatement>
  | BlockStatement<GeneralServerStatement>
  | ForEachCursorStatement<GeneralServerStatement>
  | ForEachQueryStatement<GeneralServerStatement>
  | ForEachTableStatement<GeneralServerStatement>
  | TryStatement<GeneralServerStatement>
  | GeneralServerBaseStatement;

export interface RestoreStatement {
  t: "Restore";
  table: SqlExpression;
  query: Sql;
}

export interface SetCookieStatement {
  t: "SetCookie";
  name: SqlExpression;
  value: SqlExpression;
  domain?: SqlExpression;
  path?: SqlExpression;
  expires?: SqlExpression;
  secure?: SqlExpression;
  httpOnly?: SqlExpression;
  sameSite?: SqlExpression;
}

export interface RemoveCookieStatement {
  t: "RemoveCookie";
  name: SqlExpression;
}

export type UiServerProcStatement =
  | IfStatement<UiServerProcStatement>
  | WhileStatement<UiServerProcStatement>
  | BlockStatement<UiServerProcStatement>
  | ForEachCursorStatement<UiServerProcStatement>
  | ForEachQueryStatement<UiServerProcStatement>
  | ForEachTableStatement<UiServerProcStatement>
  | TryStatement<UiServerProcStatement>
  | GeneralServerBaseStatement
  | NavigateStatement
  | SetQueryParam
  | ReadDomFileStatement
  | GetHeaderStatement
  | SetCookieStatement
  | RemoveCookieStatement
  | GetCookieStatement;

export interface DynamicQueryStatement {
  t: "DynamicQuery";
  query: SqlExpression;
  /** Def-style: declares a new table to receive results. */
  resultTable?: string;
  /** Set-style: assigns into an existing table in scope. */
  setResultTable?: string;
  columnCount: number;
  /** Def-style: declares a new column meta table. */
  columnMetaTable?: string;
  /** Set-style: assigns into an existing column meta table. */
  setColumnMetaTable?: string;
  skipAutoRowCap?: SqlExpression;
  rowCap?: SqlExpression;
  hasMoreScalar?: string;
  setHasMoreScalar?: string;
  /** Def-style: declares a new metrics scalar. */
  metricsScalar?: string;
  /** Set-style: assigns into an existing metrics scalar. */
  setMetricsScalar?: string;
  tableWhitelist?: SqlExpression;
  tableBlacklist?: SqlExpression;
  viewWhitelist?: SqlExpression;
  viewBlacklist?: SqlExpression;
  fieldWhitelist?: SqlExpression;
  fieldBlacklist?: SqlExpression;
  accessibleTableScopes?: Array<"proc" | "ui">;
  tableScopeWhitelist?: string[];
  tableScopeBlacklist?: string[];
}

export interface DynamicExplainQueryStatement {
  t: "DynamicExplainQuery";
  query: SqlExpression;
  /** Def-style: declares a new scalar receiving the explain plan text. */
  resultScalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setResultScalar?: string;
  tableWhitelist?: SqlExpression;
  tableBlacklist?: SqlExpression;
  viewWhitelist?: SqlExpression;
  viewBlacklist?: SqlExpression;
  fieldWhitelist?: SqlExpression;
  fieldBlacklist?: SqlExpression;
}

export interface DynamicModifyStatement {
  t: "DynamicModify";
  sql: SqlExpression;
}

export interface DynamicQueryToCsv {
  t: "DynamicQueryToCsv";
  query: SqlExpression;
  /** Def-style: declares a new scalar receiving the CSV-formatted result. */
  scalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setScalar?: string;
  skipAutoRowCap?: SqlExpression;
  rowCap?: SqlExpression;
  hasMoreScalar?: string;
  setHasMoreScalar?: string;
  tableWhitelist?: SqlExpression;
  tableBlacklist?: SqlExpression;
  viewWhitelist?: SqlExpression;
  viewBlacklist?: SqlExpression;
  fieldWhitelist?: SqlExpression;
  fieldBlacklist?: SqlExpression;
  accessibleTableScopes?: Array<"proc" | "ui">;
  tableScopeWhitelist?: string[];
  tableScopeBlacklist?: string[];
}

export interface DynamicQueryToJson {
  t: "DynamicQueryToJson";
  query: SqlExpression;
  scalar?: string;
  setScalar?: string;
  skipAutoRowCap?: SqlExpression;
  rowCap?: SqlExpression;
  hasMoreScalar?: string;
  setHasMoreScalar?: string;
  tableWhitelist?: SqlExpression;
  tableBlacklist?: SqlExpression;
  viewWhitelist?: SqlExpression;
  viewBlacklist?: SqlExpression;
  fieldWhitelist?: SqlExpression;
  fieldBlacklist?: SqlExpression;
  accessibleTableScopes?: Array<"proc" | "ui">;
  tableScopeWhitelist?: string[];
  tableScopeBlacklist?: string[];
}

export interface ValidateDynamicQuery {
  t: "ValidateDynamicQuery";
  query: SqlExpression;
  errorRecord: string;
  tableWhitelist?: SqlExpression;
  tableBlacklist?: SqlExpression;
  viewWhitelist?: SqlExpression;
  viewBlacklist?: SqlExpression;
  fieldWhitelist?: SqlExpression;
  fieldBlacklist?: SqlExpression;
}

export interface App {
  domain: string;
  domainAliases?: string[];
  css: string;
  defaultFallbackDelay?: number;
  collation?: Collation;
  immediateInitialRender?: boolean;
  tree: Node;
  navigationViewTransitionConfig?: NavigationViewTransitionConfig;
  webAppManifest?: Record<string, any>;
  endpoints?: AppEndpoint[];
  headers?: AppHeader[];
  /**
       Default is "server".
       If "server", the initial render is done on the server.
       If "client", the initial render is done on the client and it is treated like a SPA. This makes it easier to do offline.

       In both cases, the subsequent navigations are done on the client.
       */
  firstRender?: "server" | "client";
  /** JavaScript modules that can be used in the app. */
  jsModules?: JsModule[];
  mode?: "online" | "offline";
}

export interface AppHeader {
  name: string;
  value: string;
}

export interface AppEndpoint {
  path: string;
  query?: {
    name: string;
    default?: SqlExpression;
    type: FieldType;
  }[];
  procedure?: EndpointStatement[];
}

export interface NavigationViewTransitionConfig {
  link?: SimpleViewTransitionConfig;
  popstate?: PopstateViewTransitionConfig;
  statement?: SimpleViewTransitionConfig;
}

export interface PopstateViewTransitionConfig {
  timing: ViewTransitionTiming;
  forwardType: string;
  backwardType: string;
  otherType: string;
}

export interface SimpleViewTransitionConfig {
  timing: ViewTransitionTiming;
  type: string;
}

export interface JsModule {
  /** The unique ID for this module. */
  id: string;
  /** The source of the JavaScript module. */
  source: JsModuleSource;
  /** Exported functions that can be called from Yolm procedures. */
  exports?: string[];
  /** Custom events that can be emitted from the module. */
  events?: string[];
}

export type JsModuleSource =
  | { kind: "External"; path: string }
  | { kind: "Inline"; source: string };

export interface JsCallArgs {
  /** JSON arguments as a SQL expression. */
  json?: SqlExpression;
  /** Bytes arguments as a map of name to SQL expression. */
  bytes?: Record<string, SqlExpression>;
}

export interface JsCallResult {
  /** Scalar to store JSON result. */
  jsonScalar?: string;
  /** Table to store bytes result. */
  bytesTable?: string;
}

export type Node =
  | SqlExpression
  | (Node | null | undefined)[]
  | EachNode
  | IfNode
  | SwitchNode
  | StateNode
  | ModeNode
  | RouteNode
  | RoutesNode
  | ElementNode
  | QueryParamsNode
  | DataGridNode
  | EventHandlersNode
  | SourceMapNode
  | RecursiveNode
  | RecurseNode
  | AuthorizeNode
  | EffectNode
  | RedirectNode
  | ListenNode
  | DynamicNodeNode;

export interface SourceMapNode {
  t: "SourceMap";
  source: string;
  children: Node;
}

export interface EachNode {
  t: "Each";
  table: string;
  recordName: string;
  where?: SqlExpression;
  orderBy?: SqlExpression;
  key?: SqlExpression;
  children: Node;
}

export interface RecursiveNode {
  t: "Recursive";
  table: string;
  recordName: string;
  where?: SqlExpression;
  orderBy?: SqlExpression;
  key?: SqlExpression;
  children: Node;
}

export interface RecurseNode {
  t: "Recurse";
  where: SqlExpression;
  recordName: string;
}

export interface SetCurrentUserStatement {
  t: "SetCurrentUser";
  user: SqlExpression;
}

export interface SetContextStatement {
  t: "SetContext";
  context: SqlExpression;
}

export interface GetCookieStatement {
  t: "GetCookie";
  name: SqlExpression;
  /** Def-style: declares a new record receiving the cookie info. */
  record?: string;
  /** Set-style: assigns into an existing record in scope. */
  setRecord?: string;
}

export type AuthorizeStatement =
  | IfStatement<AuthorizeStatement>
  | WhileStatement<AuthorizeStatement>
  | BlockStatement<AuthorizeStatement>
  | ForEachCursorStatement<AuthorizeStatement>
  | ForEachTableStatement<AuthorizeStatement>
  | ForEachQueryStatement<AuthorizeStatement>
  | TryStatement<AuthorizeStatement>
  | BaseStatement
  | GeneralServerBaseStatement
  | SetCurrentUserStatement
  | SetContextStatement
  | GetCookieStatement;

export interface AuthorizeNode {
  t: "Authorize";
  statements: AuthorizeStatement[];
  unauthorized: Node;
  authorized: Node;
}

export interface EffectNode {
  t: "Effect";
  watch?: SqlExpression[];
  onChange: EventHandler;
  triggerOnMount?: boolean;
}

export interface RedirectNode {
  t: "Redirect";
  to: SqlExpression;
  replace?: SqlExpression;
}

export interface ListenNode {
  t: "Listen";
  /** SQL query that triggers when results change. */
  query?: SqlExpression;
  /** Multiple SQL queries that trigger when any of their results change. */
  queries?: SqlExpression[];
  /** Event handler to run when the query results change. */
  do: EventHandler;
}

export interface DynamicNodeNode {
  t: "DynamicNode";
  source?: SqlExpression;
  entryPath?: SqlExpression;
  appDomain?: SqlExpression;
  accessPolicy?: DynamicTableFieldPolicy;
  meta?: SqlExpression;
  authorize?: AuthorizeStatement[];
  onInternalEvent?: EventHandler;
  sizing?: "fit" | "fill" | "fixed";
  height?: SqlExpression;
}

export interface DynamicTableFieldPolicy {
  tableWhitelist?: string[];
  tableBlacklist?: string[];
  viewWhitelist?: string[];
  viewBlacklist?: string[];
  fieldWhitelist?: DynamicTableFields[];
  fieldBlacklist?: DynamicTableFields[];
}

export interface DynamicTableFields {
  table: string;
  fields?: string[];
}

/**
 Creates table to keep around a dom File, so it doesn't get garbage collected.

 Table is of the form:
  uuid: not null and type uuid
  data: nullable and type string, this has no meaning to us, but it can be used to help manage the files
 */
export interface FileRefTableStatement {
  t: "FileRefTable";
  name: string;
}

export interface GetWindowPropertyStatement {
  t: "GetWindowProperty";
  property: WindowProperty;
  scalar: string;
}

export interface ForceServerStatement {
  t: "ForceServer";
}

export type StateStatement =
  | IfStatement<StateStatement>
  | WhileStatement<StateStatement>
  | BlockStatement<StateStatement>
  | ForEachCursorStatement<StateStatement>
  | ForEachQueryStatement<StateStatement>
  | ForEachTableStatement<StateStatement>
  | TryStatement<StateStatement>
  | BaseStatement
  | GeneralServerBaseStatement
  | FileRefTableStatement
  | GetWindowPropertyStatement
  | GetHeaderStatement
  | GetCookieStatement
  | ForceServerStatement
  | IdbGetStatement
  | IdbSetStatement
  | IdbRemoveStatement
  | IdbClearStatement
  | IdbKeysStatement;

export interface StateNode {
  t: "State";
  /**
       Expressions to watch for changes, if any of these change, the state will be re-evaluated.

       Equality is as expected for most types, but null is considered equal to null.
       */
  watch?: SqlExpression[];
  hoistKey?: SqlExpression[];
  autoWatch?: boolean;
  procedure: StateStatement[];
  /** positive integer of miliseconds of delay */
  fallbackDelay?: SqlExpression;
  /** boolean, defaults to false */
  acceptOldResponses?: SqlExpression;
  /** boolean, defaults to false */
  longRunning?: SqlExpression;
  /**
       Indicates the status of the state. Accessible in `children` nodes.

       This creates a scalar of type `enums.sys_state_status` with the following values:

       received: means that this has successfully ran
       requested: means that we have tried to run this on the client, seen it needs something from the service
        and have requested it from the service.
       delayed: means that due to the debounce config, we have delayed running this.
       fallback_triggered: means that it has been requesting for longer than the fallbackDelay and we might want to show
        something else in the ui.
       failed: means that the state has failed to run.
       disallowed: means that the allow returned null or false
       */
  statusScalar?: string;
  /**
       This is a scalar that is true if the state has data to display, whether or not it is in the fallback state.
       */
  hasDataScalar?: string;
  /**
       Creates an error record accessible in `children` nodes if this state failed.

       It has the following fields:

       type: not null and a value of enums.sys_error_type
       message: nullable string
       description: nullable string
       */
  errorRecord?: string;
  debounce?: StateDebounceConfig;
  children: Node;
}

export interface StateDebounceConfig {
  /** positive integer of miliseconds of delay */
  wait: SqlExpression;
  /** boolean, defaults to false */
  noWaitOnFirst?: SqlExpression;
  /** positive integer of miliseconds of delay */
  maxWait?: SqlExpression;
  /** boolean, defaults to false */
  leading?: SqlExpression;
  /** boolean, defaults to true */
  trailing?: SqlExpression;
}

export interface ModeNode {
  t: "Mode";
  render?: "'lazy'" | "'lazy_on_first'" | "'immediate'" | SqlExpression;
  children: Node;
}

export interface IfNode {
  t: "If";
  condition: SqlExpression;
  then?: Node;
  else?: Node;
}

export interface SwitchNode {
  t: "Switch";
  cases: SwitchNodeCase[];
}

export interface SwitchNodeCase {
  condition: SqlExpression;
  node?: Node;
}

export interface RouteNode {
  t: "Route";
  path: string;
  /**
       Exact path match, if false it will match any path that starts with the path

       For example, if you have a path of "/events"
       and exact is true, then "/events" will match, but "/events/123" will not.

       If exact is false, then "/events/123" will match, and "/events/123/details" will.
       */
  exact?: boolean;
  children: Node;
}

export interface RoutesNode {
  t: "Routes";
  children: RouteNode[];
}

export interface QueryParamsNode {
  t: "QueryParams";
  params: QueryParam[];
  children: Node;
}

/**
 * How writes to a query param update browser history: `"replace"` (default)
 * updates the current entry in place; `"push"` adds an entry so the browser's
 * Back button steps through changes.
 */
export type QueryParamHistory = "replace" | "push";

export interface QueryParam {
  name: string;
  default?: SqlExpression;
  type: FieldType;
  allowNoRead?: boolean;
  /**
   * History behavior for writes to this param (`SetScalar`, bound inputs, and
   * `SetQueryParam` without an explicit `replace`). Defaults to `"replace"`.
   */
  history?: QueryParamHistory;
}

export interface DataGridNode {
  t: "DataGrid";
  classes: DataGridClasses;
  table: string;
  tableKey?: SqlExpression;

  columns: DataGridColumn[];
  columnMetadataSource?: DataGridColumnMetadataSource;
  on: DataGridEventHandlers;
  recordName: string;

  headerHeight: SqlExpression;
  rowHeight: SqlExpression;
  focusedRow: SqlExpression;
  focusedColumn: SqlExpression;
  shouldFocusCell: SqlExpression;
}

export interface DataGridColumnMetadataSource {
  table: string;
  columnIds: number[];
  idField: string;
  widthField: string;
  visibleField: string;
  orderingField: string;
  pinLeftField: string;
  pinRightField: string;
}

export interface DataGridClasses {
  root?: string;
  row?: string;
  cell?: string;
  headerCell?: string;
  header?: string;
}

export interface DataGridEventHandlers {
  keyboardNavigation: EventHandler;
  cellClick: EventHandler;
  cellDoubleClick?: EventHandler;
  cellKeydown?: EventHandler;
  fetchMore?: EventHandler;
}

export interface DataGridColumn {
  header: Node;
  cell: Node;
  width: SqlExpression;
  visible?: SqlExpression;
  ordering?: SqlExpression;
  pinLeft?: SqlExpression;
  pinRight?: SqlExpression;
}

export interface EventHandlerObject {
  procedure: DomProcStatement[];
  /**
       This indicates that the event handler should not be aborted when the node
       is removed.

       By default, when a node is removed, all event handlers associated with it
       are aborted. This is to prevent memory leaks.
       */
  detachedFromNode?: boolean;
  disableAutoUiCommit?: boolean;
}

export type EventHandler = EventHandlerObject | DomProcStatement[];

export type ElementProps =
  & Partial<Record<AllHtmlPropNames | SvgPropNames, SqlExpression>>
  & Partial<Record<`data-${string}`, SqlExpression>>;
export type ElementEventHandlers = Partial<
  Record<EventHandlerName, EventHandler>
>;

export interface FloatingOpts {
  anchorEl: SqlExpression;
  placement:
    | "'top'"
    | "'top-start'"
    | "'top-end'"
    | "'right'"
    | "'right-start'"
    | "'right-end'"
    | "'bottom'"
    | "'bottom-start'"
    | "'bottom-end'"
    | "'left'"
    | "'left-start'"
    | "'left-end'"
    | SqlExpression;
  strategy: "'absolute'" | "'fixed'" | SqlExpression;
  offset?: {
    mainAxis: SqlExpression;
    crossAxis: SqlExpression;
  };
  flip?: {
    mainAxis: SqlExpression;
    crossAxis: SqlExpression;
  };
  shift?: {
    mainAxis: SqlExpression;
    crossAxis: SqlExpression;
  };
  arrow?: { elementId: SqlExpression };
}

export interface DynamicClass {
  classes: string;
  condition: SqlExpression;
}

export type ScrollRestoration = "route";

export interface ElementJsHandle {
  module: string;
  cleanup: string;
  handle: SqlExpression;
}

export interface ElementJsConfig {
  handles?: ElementJsHandle[];
  on?: Record<string, EventHandler>;
}

/** Represents an html or svg element */
export interface ElementNode {
  t: "Element";
  tag: AllHtmlTags;
  floating?: FloatingOpts;
  scrollRestoration?: ScrollRestoration;
  classes?: string;
  dynamicClasses?: DynamicClass[];
  style?: Record<string, SqlExpression>;
  props?: ElementProps;
  on?: ElementEventHandlers;
  children?: Node;
  /** Server-side rendering statements for this element's children. */
  serverRenderChildren?: GeneralServerStatement[];
  /** JavaScript module handles and event handlers. */
  js?: ElementJsConfig;
}

export interface EventHandlersNode {
  t: "EventHandlers";
  window?: ElementEventHandlers;
  document?: ElementEventHandlers;
  mount?: EventHandler;
}

//
// Request
//

export interface RequestStatement {
  t: "Request";
  uri: SqlExpression;
  method: "'GET'" | "'POST'" | "'DELETE'" | "'PUT'" | "'PATCH'" | SqlExpression;
  optIn?: SqlExpression;
  headers?: { name: SqlExpression; value: SqlExpression }[];
  sendBody?: SendBody;
  receiveBody?: RequestReceiveBody;
  /**
       Def-style: declares a new record for the response information.

       It has the following fields:

       status: number (the status code)
       */
  responseRecord?: string;
  /** Set-style: assigns into an existing record in scope. */
  setResponseRecord?: string;
  /**
       Def-style: declares a new table for the response headers.

       It has the following fields:

       name: string
       value: string
       */
  responseHeadersTable?: string;
  /** Set-style: assigns into an existing table in scope. */
  setResponseHeadersTable?: string;
  serviceCredentials?: ServiceCredentials;
  oauth?: Oauth;
  mockEndpoint?: EndpointStatement[];
}

export type ServiceCredentials = {
  type: "ManagedOauth";
  credentialId: SqlExpression;
};

export type Oauth =
  // | {
  //     type: "ClientCredentialsGrant";
  //     key: SqlExpression;
  //     clientId: SqlExpression;
  //     clientSecret: SqlExpression;
  //     tokenUrl: SqlExpression;
  //     scope: SqlExpression;
  //   }
  {
    type: "ServiceAccount";
    privateKey: SqlExpression;
    tokenUri: SqlExpression;
    clientEmail: SqlExpression;
    scope: SqlExpression;
  };

export type SendBody =
  | { type: "Text"; expr: SqlExpression }
  | { type: "Json"; expr: SqlExpression }
  | { type: "Bytes"; expr: SqlExpression }
  | { type: "Multipart"; query: Sql };

export type RequestReceiveBody =
  | ({ type: "Text" } & RequestReceiveDestination)
  | ({ type: "Json" } & RequestReceiveDestination)
  | ({ type: "Bytes" } & RequestReceiveDestination)
  | (
    & {
      type: "Blob";
      maxBytes: number;
      acceptedStatuses: [number, ...number[]];
    }
    & RequestReceiveDestination
  );

type RequestReceiveDestination =
  | { scalar: string; setScalar?: never }
  | { scalar?: never; setScalar: string };

/**
 * Receive-body wire shape. Each variant carries a def-style `scalar` (declares
 * a new local) and a `setScalar` (assigns into an existing local). Exactly
 * one of the two must be set per receive body.
 */
export type ReceiveBody =
  | { type: "Text"; scalar?: string; setScalar?: string }
  | { type: "Json"; scalar?: string; setScalar?: string }
  | { type: "Bytes"; scalar?: string; setScalar?: string }
  | {
    type: "Blob";
    /** BLAKE3 hash of encrypt(compress(source bytes)). */
    scalar?: string;
    setScalar?: string;
    /** BLAKE3 of the exact source bytes before compression and encryption. */
    sourceHashScalar?: string;
    /** Optional scalar receiving the upload content size in bytes. */
    sizeScalar?: string;
    /** Maximum accepted upload size in bytes (platform default 1 GiB). */
    maxSize?: number;
    /**
     * Runs before any upload bytes are accepted (and again before the main
     * procedure). Reject by setting an HTTP status >= 400 or returning a
     * non-null value; falling off the end allows the upload.
     */
    authorize: EndpointStatement[];
  };

//
// API
//

export type EndpointMethod = "GET" | "POST" | "DELETE" | "PUT" | "PATCH";

export interface ApiEndpoint {
  path: string;
  method: EndpointMethod;
  query?: {
    name: string;
    default?: SqlExpression;
    type: FieldType;
  }[];
  body?: ReceiveBody;
  procedure?: EndpointStatement[];
}

export interface SetHttpStatusStatement {
  t: "SetHttpStatus";
  status: SqlExpression;
}

export interface GetHeaderStatement {
  t: "GetHeader";
  name: SqlExpression;
  /** Def-style: declares a new scalar receiving the header value. */
  scalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setScalar?: string;
}

export interface GetRequestBodyJsonStatement {
  t: "GetRequestBodyJson";
  /** Def-style: declares a new scalar receiving the JSON-parsed body. */
  scalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setScalar?: string;
}

export interface GetRequestBodyTextStatement {
  t: "GetRequestBodyText";
  /** Def-style: declares a new scalar receiving the body text. */
  scalar?: string;
  /** Set-style: assigns into an existing scalar in scope. */
  setScalar?: string;
}

export interface SetHeaderStatement {
  t: "SetHeader";
  name: SqlExpression;
  value: SqlExpression;
}

export interface ReturnBlobStatement {
  t: "ReturnBlob";
  hash: SqlExpression;
}

export interface StreamEvent {
  event: string;
  tables?: string[];
  queries?: Sql[];
  do?: GeneralServerStatement[];
}

export interface ReturnStreamStatement {
  t: "ReturnStream";
  events: StreamEvent[];
}

export type EndpointStatement =
  | IfStatement<EndpointStatement>
  | WhileStatement<EndpointStatement>
  | BlockStatement<EndpointStatement>
  | ForEachCursorStatement<EndpointStatement>
  | ForEachQueryStatement<EndpointStatement>
  | ForEachTableStatement<EndpointStatement>
  | TryStatement<EndpointStatement>
  | GeneralServerBaseStatement
  | SetHttpStatusStatement
  | GetHeaderStatement
  | GetRequestBodyJsonStatement
  | GetRequestBodyTextStatement
  | SetHeaderStatement
  | SetCookieStatement
  | RemoveCookieStatement
  | GetCookieStatement
  | ReturnBlobStatement
  | ReturnStreamStatement;

export interface Api {
  domain: string;
  prefix: string;
  domainAliases?: string[];
  endpoints: ApiEndpoint[];
}

///
/// TEST
///

interface BaseTestData {
  name: string;
}

export interface TestDataPath extends BaseTestData {
  /** Path to directory containing data.db, map.json to load */
  dir: string;
}

export interface TestDataProcedure extends BaseTestData {
  time: string;
  /** Use this procedure to intialize the database */
  procedure: BasicStatement[];
}

export type TestData = TestDataPath | TestDataProcedure;

export type Body =
  | { type: "Text"; text: string }
  | { type: "Json"; value: any };

export interface AssertStream {
  t: "AssertStream";
  domain: string;
  path: string;
  method: EndpointMethod;
  timeoutMs?: number;
  setup?: TestStatement[];
  expectedEvents: string[];
}

export interface RunScheduledProcStatement {
  t: "RunScheduledProc";
  name?: string;
}

export interface DisableReactorStatement {
  t: "DisableReactor";
  name: string;
}

export interface EnableReactorStatement {
  t: "EnableReactor";
  name: string;
}

export interface FlushReactorsStatement {
  t: "FlushReactors";
}

export type TestStatement =
  | ValidationErrorStatement
  | IfStatement<TestStatement>
  | WhileStatement<TestStatement>
  | BlockStatement<TestStatement>
  | ForEachCursorStatement<TestStatement>
  | ForEachQueryStatement<TestStatement>
  | ForEachTableStatement<TestStatement>
  | TryStatement<TestStatement>
  | BaseStatement
  | AssertStream
  | RunScheduledProcStatement
  | DisableReactorStatement
  | EnableReactorStatement
  | FlushReactorsStatement
  | SetCurrentUserStatement;

export interface Test {
  time: string;
  skip?: boolean;
  only?: boolean;
  seed?: number;
  name: string;
  data: string;
  procedure: TestStatement[];
}

export interface TestModel {
  data: TestData[];
  api?: Test[];
}

///
/// Mapping file
///

export interface DatabaseMapping {
  version: number;
  tables: Record<string, TableMapping>;
  enums: Record<string, EnumMapping>;
}

export interface TableMapping {
  id: number;
  primaryKeyFieldName: string;
  fields: Record<string, FieldMapping>;
}

export interface FieldMapping {
  id: number;
  type: MappingFieldType;
  notNull: boolean;
}

export interface EnumMapping {
  values: Record<string, number>;
}

export type MappingFieldType =
  | { type: "TinyUint" }
  | { type: "SmallUint" }
  | { type: "Uint" }
  | { type: "BigUint" }
  | { type: "TinyInt" }
  | { type: "SmallInt" }
  | { type: "Int" }
  | { type: "BigInt" }
  | { type: "Real" }
  | { type: "Double" }
  | { type: "Decimal"; precision: number; scale: number; signed: boolean }
  | { type: "Ordering" }
  | {
    type: "String";
    maxLength: number;
    minLength: number;
    maxBytesPerChar: number;
  }
  | { type: "Uuid" }
  | { type: "Date" }
  | { type: "Time" }
  | { type: "Timestamp" }
  | { type: "TimestampUtc" }
  | { type: "TimestampNaive" }
  | { type: "TimestampTz" }
  | { type: "ForeignKey"; table: string }
  | { type: "Tx" }
  | { type: "Enum"; enum: string }
  | { type: "Bool" }
  | { type: "Json" }
  | { type: "Bytes"; maxLength: number };

///
/// INTERNAL
///

/** @private */
export interface UiTestAssertQueryStatement {
  type: "AssertQuery";
  query: Sql;
  csv: string;
}

/** @private */
export interface UiTestSnapshotUiStatement {
  type: "SnapshotUi";
}

/** @private */
export interface UiTestNavigateStatement {
  type: "Navigate";
  to: string;
}

/** @private */
export interface UiTestSimulateClickStatement {
  type: "SimulateClick";
  nodeId: string;
}

/** @private */
export interface UiTestSimulateSubmitStatement {
  type: "SimulateSubmit";
  nodeId: string;
}

/** @private */
export interface UiTestSimulateInputStatement {
  type: "SimulateInput";
  nodeId: string;
  inputValue: string;
}

/** @private */
export interface UiTestSimulateFileChangeStatement {
  type: "SimulateFileChange";
  nodeId: string;
  files: UiTestFileChangeStatement[];
}

/** @private */
export interface UiTestFileChangeStatement {
  uuid: string;
  type: string;
  lastModified: string;
  size: number;
}

/** @private */
export interface UiTestSetTestTimeStatement {
  type: "SetTestTime";
  to: string;
}

/** @private */
export interface UiTestAdvanceMsStatement {
  type: "AdvanceMs";
  ms: number;
}

/** @private */
export interface UiTestSetServiceRenderDelayStatement {
  type: "SetServiceRenderDelay";
  ms: number;
}

/** @private */
export interface UiTestSetServiceLongRunningRenderDelayStatement {
  type: "SetServiceLongRunningRenderDelay";
  ms: number;
}

/** @private */
export interface UiTestSetServiceProcDelayStatement {
  type: "SetServiceProcDelay";
  ms: number;
}

/** @private */
export interface UiTestAssertLiveMetricCountStatement {
  type: "AssertLiveMetricCount";
  executionType: string;
  uiErrorSource?: string;
  count: number;
}

/** @private */
export interface UiTestAssertOccRetryCountAtLeastStatement {
  type: "AssertOccRetryCountAtLeast";
  min: number;
}

/** @private */
export interface UiTestResetOccRetryProbeStatement {
  type: "ResetOccRetryProbe";
}

/** @private */
export interface UiTestSetRequestResponseStatement {
  type: "SetRequestResponse";
  uri: string;
  method: string;
  status: number;
  headers: UiTestRequestHeader[];
  body?: Body;
  assertRequestBody?: Body;
  assertRequestHeaders?: UiTestRequestHeader[];
}

/** @private */
export interface UiTestCreateClient {
  type: "CreateClient";
  initialPage: string;
  download: boolean;
  name: string;
  user?: number;
  receivingUpdates?: boolean;
  offlineWriting?: boolean;
}

/** @private */
export interface UiTestDisableClientReceivingUpdates {
  type: "DisableClientReceivingUpdates";
}

/** @private */
export interface UiTestEnableClientReceivingUpdates {
  type: "EnableClientReceivingUpdates";
}

/** @private */
export interface UiTestFailNextClientPushResponse {
  type: "FailNextClientPushResponse";
}

/** @private */
export interface UiTestSwitchClient {
  type: "SwitchClient";
  name: string;
}

/** @private */
export interface UiTestStopClient {
  type: "StopClient";
}

/** @private */
export interface UiTestExpectPushResults {
  type: "ExpectPushResults";
  results: ("Duplicate" | "Conflicted" | "Accepted")[];
}

/** @private */
export interface UiTestDoOfflinePush {
  type: "DoOfflinePush";
}

/** @private */
export interface UiTestRequestHeader {
  name: string;
  value: string;
}

export interface UiTestModifyStatement {
  type: "Modify";
  sql: string;
}

/** @private */
export type UiTestStatement =
  | UiTestCreateClient
  | UiTestSetTestTimeStatement
  | UiTestAssertQueryStatement
  | UiTestSnapshotUiStatement
  | UiTestSimulateClickStatement
  | UiTestSimulateSubmitStatement
  | UiTestSimulateInputStatement
  | UiTestSimulateFileChangeStatement
  | UiTestSetRequestResponseStatement
  | UiTestAdvanceMsStatement
  | UiTestSetServiceRenderDelayStatement
  | UiTestSetServiceLongRunningRenderDelayStatement
  | UiTestSetServiceProcDelayStatement
  | UiTestAssertLiveMetricCountStatement
  | UiTestAssertOccRetryCountAtLeastStatement
  | UiTestResetOccRetryProbeStatement
  | UiTestNavigateStatement
  | UiTestDisableClientReceivingUpdates
  | UiTestEnableClientReceivingUpdates
  | UiTestFailNextClientPushResponse
  | UiTestDoOfflinePush
  | UiTestSwitchClient
  | UiTestStopClient
  | UiTestExpectPushResults
  | UiTestModifyStatement;

export type UiTestStyle = "Server" | "SyncService";

/** @private */
export interface UiTest {
  time: string;
  seed?: number;
  name: string;
  setupDb: BasicStatement[];
  style: UiTestStyle;
  body: UiTestStatement[];
}

/** @private */
export interface LogicTest {
  name: string;
  time: string;
  seed: number;
  /** Enable BUGGIFY fault injection for this test */
  faultsEnabled?: boolean;
  body: LogicTestStatement[];
  debugQuery?: string;
}

/** @private */
export interface PlanTestQuery {
  name: string;
  sql: string;
}

/** @private */
export interface PlanTest {
  name: string;
  queries: PlanTestQuery[];
}

export interface PipelineImportColumn {
  name: string;
  ty: string;
  notNull?: boolean;
}

export interface PipelineImportData {
  columns: PipelineImportColumn[];
  rows: string[][];
}

/** @private */
export interface LogicTestQueryStatement {
  type: "Query";
  label?: string;
  sortMode: "NoSort" | "RowSort" | "ValueSort";
  query: string;
  result: LogicTestQueryResult;
}

/** @private */
export interface LogicTestModifyStatement {
  type: "Modify";
  ok: boolean;
  sql: string;
}

/** @private */
export interface LogicTestRestoreStatement {
  type: "Restore";
  ok: boolean;
  table: string;
  ids: string[];
}

/** @private */
export interface LogicTestUndoTxStatement {
  type: "UndoTx";
  ok: boolean;
  tx: string;
}

/** @private */
export interface LogicTestCommitDbStatement {
  type: "CommitDb";
}

/** @private */
export interface LogicTestManualFlushStatement {
  type: "ManualFlush";
}

/** @private */
export interface LogicTestSearchStatement {
  type: "Search";
  config: RankedSearchConfig;
  query: string;
  limit: number;
  result: { record: number; table: string }[];
}

export interface LogicTestRunPipelineStatement {
  type: "RunPipeline";
  pipeline: string;
  start_at_stage?: string;
  imports?: Record<string, PipelineImportData>;
}

/** @private
 * Execute multiple statement groups concurrently for testing race conditions.
 * Each branch runs in parallel with deterministic scheduling based on the test seed.
 */
export interface LogicTestParallelStatement {
  type: "Parallel";
  /** Each branch is a list of statements that run concurrently with other branches */
  branches: LogicTestStatement[][];
}

/** @private
 * Repeat a block of statements N times for stress testing.
 */
export interface LogicTestRepeatStatement {
  type: "Repeat";
  count: number;
  body: LogicTestStatement[];
}

/** @private
 * Enable BUGGIFY fault injection for subsequent statements.
 */
export interface LogicTestEnableFaultsStatement {
  type: "EnableFaults";
}

/** @private
 * Disable BUGGIFY fault injection for subsequent statements.
 */
export interface LogicTestDisableFaultsStatement {
  type: "DisableFaults";
}

/** @private
 * Execute a procedure with explicit transaction control.
 * Allows testing multi-statement transactions with StartTransaction/CommitTransaction.
 */
export interface LogicTestProcStatement {
  type: "Proc";
  /** Whether this procedure should succeed. If false, expects a commit/execution failure. */
  ok: boolean;
  /** The procedure body - supports full GeneralServerStatement including transactions */
  body: GeneralServerStatement[];
}

/** @private
 * Trigger a snapshot operation. Can be placed inside parallel branches to test
 * concurrent query/snapshot interleaving. Uses the real async snapshot_to_world
 * which has yield points for proper interleaving with other async operations.
 */
export interface LogicTestTriggerSnapshotStatement {
  type: "TriggerSnapshot";
}

/** @private
 * Trigger a snapshot operation that rewrites persisted live table data.
 */
export interface LogicTestTriggerRewriteSnapshotStatement {
  type: "TriggerRewriteSnapshot";
}

/** @private
 * Assert prefetch/load behavior from the test harness.
 * Any asserted field is checked against cumulative stats, and `reset` can
 * be used to zero counters after the assertion for the next phase.
 */
export interface LogicTestAssertPrefetchStatement {
  type: "AssertPrefetch";
  calls?: number;
  maxCalls?: number;
  parts?: number;
  maxParts?: number;
  bytes?: number;
  maxBytes?: number;
  reset?: boolean;
}

/** @private
 * Assert whether the streaming executor path was entered.
 */
export interface LogicTestAssertStreamingStatement {
  type: "AssertStreaming";
  calls?: number;
  maxCalls?: number;
  parallelBuildFragmentCalls?: number;
  parallelBuildFragmentMaxCalls?: number;
  parallelProbeFragmentCalls?: number;
  parallelProbeFragmentMaxCalls?: number;
  stageClaimReleaseMinCalls?: number;
  stageClaimReleasedColumnsMin?: number;
  stageClaimPeakColumnsMin?: number;
  stageClaimCompletionResidualColumns?: number;
  reset?: boolean;
}

/** @private */
export type LogicTestStatement =
  | LogicTestQueryStatement
  | LogicTestModifyStatement
  | LogicTestRestoreStatement
  | LogicTestUndoTxStatement
  | LogicTestCommitDbStatement
  | LogicTestSearchStatement
  | LogicTestManualFlushStatement
  | LogicTestRunPipelineStatement
  | LogicTestParallelStatement
  | LogicTestRepeatStatement
  | LogicTestEnableFaultsStatement
  | LogicTestDisableFaultsStatement
  | LogicTestProcStatement
  | LogicTestTriggerSnapshotStatement
  | LogicTestTriggerRewriteSnapshotStatement
  | LogicTestAssertPrefetchStatement
  | LogicTestAssertStreamingStatement;

/** @private */
export type LogicTestQueryResult =
  | { type: "Values"; values: string[] }
  | { type: "Hash"; valueCount: number; hash: string };
