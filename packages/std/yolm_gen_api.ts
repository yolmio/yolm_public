// Yolm TypeScript API - Single source for type definitions and implementation
// All functions are standalone exports to avoid object initialization issues

import type * as yom from "./yom.js";

/** System-wide database settings applied via {@link setDatabaseConfig}. */
export interface DatabaseConfig {
  /** Name of the table treated as the user/auth table. */
  userTableName?: string;
  /** Default collation for string comparisons. */
  collation?: yom.Collation;
  /** Default automatic string-trimming behaviour for fields. */
  autoTrim?: yom.AutoTrim;
  /** Enables transaction queries, i.e. queries that query the transaction log. */
  enableTransactionQueries: boolean;
  /** Default `nulls distinct` behaviour for unique constraints. */
  defaultUniqueDistinctNulls?: boolean;
}

interface ListSystemFilesResult {
  files: string[];
  error: string;
}

declare const Deno: any;

// Helper to safely access Deno.core.ops
function getOps(): any {
  if (typeof Deno === "undefined" || !Deno.core || !Deno.core.ops) {
    throw new Error(
      "Yolm ops not available. This code must be run with the Yolm runtime.",
    );
  }
  return Deno.core.ops;
}

/**
 * Prints `msg` through the Yolm runtime so it appears in `devCheckSystem`
 * output. Use for generation-time logging that must surface in check/deploy
 * logs (plain `console.log` may not). Set `isErr` to route to stderr.
 */
// Direct print function that captures output for error reporting
// Use this for logging that should appear in devCheckSystem error logs
export function yolmPrint(msg: string, isErr = false): void {
  getOps().op_yolm_print(msg + "\n", isErr);
}

// Core system functions
export function init_system() {
  getOps().op_init_system();
}

export function createSystem(
  timezone: string,
  locale: string,
  collation: string,
): number {
  return getOps().op_create_system(timezone, locale, collation);
}

export function compileDatabase(): void {
  if (!getOps().op_compile_database) {
    return;
  }
  getOps().op_compile_database();
}

export function addEnum(enum_: yom.Enum) {
  getOps().op_add_enum(enum_);
}

export function addTable(table: yom.Table) {
  getOps().op_add_table_json(JSON.stringify(table));
}

function findFirstRoutesNode(
  node: yom.Node | null | undefined,
): yom.RoutesNode | undefined {
  if (
    node === null ||
    node === undefined ||
    typeof node === "string" ||
    typeof node === "number"
  ) {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const routes = findFirstRoutesNode(child);
      if (routes !== undefined) {
        return routes;
      }
    }
    return undefined;
  }

  switch (node.t) {
    case "Routes":
      return node;
    case "Authorize":
      return findFirstRoutesNode(node.authorized) ??
        findFirstRoutesNode(node.unauthorized);
    case "State":
    case "Mode":
    case "Each":
    case "Recursive":
    case "Route":
    case "QueryParams":
    case "SourceMap":
    case "Element":
      return findFirstRoutesNode(node.children);
    case "If":
      return findFirstRoutesNode(node.then) ??
        findFirstRoutesNode(node.else);
    case "Switch":
      for (const switchCase of node.cases) {
        const routes = findFirstRoutesNode(switchCase.node);
        if (routes !== undefined) {
          return routes;
        }
      }
      return undefined;
    case "DataGrid":
      for (const column of node.columns) {
        const routes = findFirstRoutesNode(column.header) ??
          findFirstRoutesNode(column.cell);
        if (routes !== undefined) {
          return routes;
        }
      }
      return undefined;
    case "Recurse":
    case "EventHandlers":
    case "DynamicNode":
    case "Effect":
    case "Listen":
      return undefined;
  }
}

export function addApp(app: yom.App): void {
  const ops = getOps();
  const routes = findFirstRoutesNode(app.tree);
  if (routes !== undefined && ops.op_add_app_route_chunks_json) {
    const routeChildren = routes.children;
    const routeShapes: number[] = [];
    const routeJson: string[] = [];
    for (const route of routeChildren) {
      if (Array.isArray(route)) {
        routeShapes.push(route.length);
        for (const leaf of route) {
          routeJson.push(JSON.stringify(leaf));
        }
      } else {
        routeShapes.push(0xffffffff);
        routeJson.push(JSON.stringify(route));
      }
    }
    let metadataJson: string;
    routes.children = [];
    try {
      metadataJson = JSON.stringify(app);
    } finally {
      routes.children = routeChildren;
    }
    if (
      ops.op_add_app_route_chunks_json(
        metadataJson,
        routeShapes,
        routeJson,
      )
    ) {
      return;
    }
  }
  const appJson = JSON.stringify(app);
  ops.op_add_app_json(appJson);
}

export function addApi(
  domain: string,
  prefix: string,
  aliases: string[],
): number {
  return getOps().op_add_api(domain, prefix, aliases);
}

export function addView(view: yom.View) {
  getOps().op_add_view(view);
}

export function addApiEndpoint(
  apiIndex: number,
  endpoint: yom.ApiEndpoint,
): number {
  return getOps().op_add_api_endpoint(apiIndex, endpoint);
}

export function addSearchMatchConfig(config: yom.SearchMatchConfig): void {
  getOps().op_add_search_match_config(config);
}

export function addScalarFunction(fn: yom.ScalarFunction): void {
  getOps().op_add_scalar_function(fn);
}

export function addDbScalarFunction(fn: yom.ScalarFunction): void {
  getOps().op_add_db_scalar_function(fn);
}

export function addStoredProcedure(procedure: yom.StoredProcedure): void {
  getOps().op_add_stored_procedure(procedure);
}

export function addScheduledProcedure(procedure: yom.ScheduledProcedure): void {
  getOps().op_add_scheduled_procedure(procedure);
}

export function addReactor(reactor: yom.Reactor): void {
  const ops = getOps();
  const reactorJson = JSON.stringify(reactor);
  if (ops.op_add_reactor_json) {
    ops.op_add_reactor_json(reactorJson);
  } else {
    ops.op_add_reactor(JSON.parse(reactorJson));
  }
}

export function addPipeline(pipeline: yom.Pipeline): void {
  getOps().op_add_pipeline(pipeline);
}

export function addTransform(transform: yom.Transform): void {
  getOps().op_add_transform(transform);
}

export function addEdge(edge: yom.Edge): void {
  const edgeJson = JSON.stringify(edge);
  getOps().op_add_edge_json(edgeJson);
}

export function setDatabaseConfig(config: DatabaseConfig): void {
  getOps().op_set_database_config(config);
}

export function loadRepoTextFile(relativePath: string): string {
  return getOps().op_load_repo_text(relativePath);
}

export function loadDocSnippets(): any {
  return getOps().op_load_doc_snippets();
}

export function getRepoDir(): string {
  return getOps().op_get_repo_dir();
}

/**
 * Returns the system's `devCapabilities.json` contents — an arbitrary
 * key/value map consumed at generation time to enable optional
 * behaviour (custom logo paths, dev-bypass flags on blocks, gating
 * experimental features, tenant-specific tokens).
 *
 * The shape is intentionally untyped — each system defines its own
 * keys; downstream code typically narrows with `as`.
 */
export function getCapabilities(): { [key: string]: any } {
  return getOps().op_get_capabilities();
}

/** The kind of generation run currently executing (see {@link getYolmStdEnv}). */
export type GenerationEnvType =
  | "deploy"
  | "check"
  | "transform"
  | "pipeline"
  | "test"
  | "production"
  | "preview";

/**
 * Returns which generation context the code is running in. Use to branch
 * generation-time behaviour (e.g. seeding demo data only under `check`/`test`,
 * or pointing at production assets under `deploy`).
 */
export function getYolmStdEnv(): GenerationEnvType {
  return getOps().op_get_env_type();
}

export function getSystemDir(): string {
  return getOps().op_get_system_dir();
}

/** Resolves a system-relative module path to an absolute import specifier. */
export function resolveSystemModule(relativePath: string): string {
  return getOps().op_resolve_system_module(relativePath);
}

/**
 * Reads a UTF-8 text file from inside the current system's directory at
 * generation time and returns its contents.
 *
 * Use for inlining static assets that need to ship as part of the
 * generated output — translation JSON, MJML email templates, fixture
 * data, etc. The path is resolved relative to the system root, not the
 * caller's file. Throws if the file is missing.
 *
 * @example
 * import { loadSystemTextFile } from "std/yolm_gen_api";
 *
 * const welcomeMjml = loadSystemTextFile("assets/emails/welcome.mjml");
 */
export function loadSystemTextFile(relativePath: string): string {
  return getOps().op_load_system_text_file(relativePath);
}

/** Whether a file exists at `relativePath` within the system directory. */
export function existsSystemFile(relativePath: string): boolean {
  return getOps().op_exists_system_file(relativePath);
}

/**
 * Writes `content` to a text file at `relativePath` inside the system
 * directory at generation time (e.g. emitting generated source/assets).
 * Returns whether the write succeeded.
 */
export function writeSystemTextFile(
  relativePath: string,
  content: string,
): boolean {
  return getOps().op_write_system_text_file(relativePath, content);
}

/** Lists the file names in a system-relative directory. Throws on error. */
export function listSystemFiles(relativeDirectory: string): string[] {
  const result: ListSystemFilesResult = getOps().op_list_system_files(
    relativeDirectory,
  );
  if (result.error !== undefined && result.error.length > 0) {
    throw new Error(result.error);
  }
  return result.files;
}

/** Lists the subdirectory names in a system-relative directory. */
export function listSystemDirs(relativeDirectory: string): string[] {
  return getOps().op_list_system_dirs(relativeDirectory);
}

export function setDynamicBlockMetadata(key: string, value: any): void {
  getOps().op_set_dynamic_block_metadata(key, value);
}

export function addTypstTemplate(template: yom.TypstTemplate): void {
  getOps().op_add_typst_template(template);
}

export function addAssetHash(name: string, hash: string): void {
  getOps().op_add_asset_hash(name, hash);
}

export function setUiSnapshotDir(dir: string): void {
  getOps().op_set_ui_snapshot_dir(dir);
}

export function addTestData(data: yom.TestData): void {
  getOps().op_add_test_data(data);
}

export function addApiTest(api: yom.Test): void {
  getOps().op_add_api_test(api);
}

export function addGlobalApiEndpoint(endpoint: yom.ApiEndpoint): number {
  return getOps().op_add_global_api_endpoint(endpoint);
}

/** The current preview deployment id, or `null` when not a preview build. */
export function getPreviewId(): number | null {
  return getOps().op_get_preview_id();
}

/** Logs `msg` with the elapsed time since the run started (generation timing). */
export function printElapsedTime(msg: string): void {
  getOps().op_print_elapsed_time(msg);
}

// Faker API methods - all as standalone functions

// Person methods
export function fakerPersonFirstName(): string {
  return getOps().op_faker_person_first_name();
}

export function fakerPersonLastName(): string {
  return getOps().op_faker_person_last_name();
}

export function fakerPersonFullName(): string {
  return getOps().op_faker_person_full_name();
}

// Internet methods
export function fakerInternetEmail(): string {
  return getOps().op_faker_internet_email();
}

export function fakerInternetUserName(): string {
  return getOps().op_faker_internet_username();
}

export function fakerInternetPassword(): string {
  return getOps().op_faker_internet_password();
}

export function fakerInternetUrl(): string {
  return getOps().op_faker_internet_url();
}

// Phone methods
export function fakerPhoneNumber(options?: { style?: string }): string {
  return getOps().op_faker_phone_number(options?.style);
}

// Location methods
export function fakerLocationStreetAddress(): string {
  return getOps().op_faker_location_street_address();
}

export function fakerLocationCity(): string {
  return getOps().op_faker_location_city();
}

export function fakerLocationState(): string {
  return getOps().op_faker_location_state();
}

export function fakerLocationCountry(): string {
  return getOps().op_faker_location_country();
}

export function fakerLocationZipCode(): string {
  return getOps().op_faker_location_zip_code();
}

// Commerce methods
export function fakerCommerceProductName(): string {
  return getOps().op_faker_commerce_product_name();
}

export function fakerCommercePrice(
  options?: { min?: number; max?: number; dec?: number },
): string {
  return getOps().op_faker_commerce_price(
    options?.min ?? 0,
    options?.max ?? 1000,
    options?.dec ?? 2,
  );
}

// Company methods
export function fakerCompanyName(): string {
  return getOps().op_faker_company_name();
}

// Lorem methods
export function fakerLoremWords(
  options?: { min?: number; max?: number } | number,
): string {
  if (typeof options === "number") {
    return getOps().op_faker_lorem_words(options, options);
  }
  return getOps().op_faker_lorem_words(
    options?.min ?? 1,
    options?.max ?? 4,
  );
}

export function fakerLoremParagraph(): string {
  return getOps().op_faker_lorem_paragraph();
}

export function fakerLoremParagraphs(count?: number): string {
  return getOps().op_faker_lorem_paragraphs(count ?? 2);
}

// Number methods
export function fakerNumberInt(
  options?: { min?: number; max?: number },
): number {
  return getOps().op_faker_number_int(
    options?.min ?? 0,
    options?.max ?? 10000,
  );
}

export function fakerNumberFloat(
  options?: { min?: number; max?: number; fractionDigits?: number },
): number {
  return parseFloat(
    getOps().op_faker_number_float(
      options?.min ?? 0,
      options?.max ?? 1000,
      options?.fractionDigits,
    ),
  );
}

// Date methods
export function fakerDateRecent(): Date {
  return new Date(getOps().op_faker_date_recent());
}

export function fakerDatePast(options?: { years?: number }): Date {
  return new Date(getOps().op_faker_date_past(options?.years));
}

export function fakerDateFuture(): Date {
  return new Date(getOps().op_faker_date_future());
}

export function fakerDateBirthdate(): Date {
  return new Date(getOps().op_faker_date_birthdate());
}

// Datatype methods
export function fakerDatatypeBoolean(): boolean {
  return getOps().op_faker_datatype_boolean();
}

// String methods
export function fakerStringUuid(): string {
  return getOps().op_faker_string_uuid();
}

// Color methods
export function fakerColorHuman(): string {
  return getOps().op_faker_color_human();
}

export function fakerColorRgb(): string {
  return getOps().op_faker_color_rgb();
}

// Helpers methods
/** Returns a random element from `items` using the faker RNG. */
export function fakerHelpersArrayElement<T>(items: T[]): T {
  const strings = items.map((item) => String(item));
  const selected = getOps().op_faker_helpers_array_element(strings);
  const index = strings.indexOf(selected);
  return items[index];
}

// Hash functions
/** Computes the SHA-256 hash of `input` at generation time (hex string). */
export function hashSha256(input: string): string {
  return getOps().op_hash_sha256(input);
}

// Asset URL functions
/**
 * Get a URL for an asset file.
 *
 * The behavior depends on the current compilation mode:
 * - Dev mode: Returns `/assets/{path}` (direct local serving)
 * - Check mode: Validates the asset exists, throws if not found
 * - Preview mode: Returns `/_y/preview-asset/{preview_id}/{path}`
 * - Deploy mode: Returns `https://yolmcdn.net/sys/{blake3_hash}`
 *
 * @param assetPath - Relative path to the asset (e.g., "logo.png", "images/hero.jpg")
 * @returns The URL to use for accessing this asset
 * @throws Error if asset path is invalid or not found in check/deploy modes
 *
 * @example
 * ```typescript
 * const logoUrl = getAssetUrl("logo.png");
 * // In preview: "/_y/preview-asset/123/logo.png"
 * // In deploy: "https://yolmcdn.net/sys/a1b2c3...xyz"
 * ```
 */
export function getAssetUrl(assetPath: string): string {
  return getOps().op_get_asset_url(assetPath);
}

export function getActualDomain(domain: string): string {
  return getOps().op_get_actual_domain(domain);
}

export function setSystemDocs(docsJSON: string) {
  getOps().op_set_system_docs(docsJSON);
}

// SQL Source Tracking API
/**
 * A span within a registered SQL string, used to map a region of generated
 * SQL back to the `.tsx` source that produced it (for diagnostics).
 */
export interface SqlSourceRange {
  /** Start offset of the span within the SQL string. */
  start: number;
  /** Length of the span. */
  len: number;
  /** Source frame id this span originates from (see {@link captureSourceFrame}). */
  sourceId?: number;
  /** Reference to another registered SQL's source tracking. */
  sqlId?: number; // Reference to another SQL's source tracking
}

/**
 * Captures the current TypeScript call-site as a source frame and returns its
 * id, so generated SQL/statements can be traced back to it. Returns `0` when
 * source tracking is unavailable.
 */
export function captureSourceFrame(): number {
  if (!getOps().op_capture_source_frame) {
    return 0;
  }
  return getOps().op_capture_source_frame();
}

const registerSqlCache = new Map<string, number>();

/**
 * Registers a SQL string (with optional source ranges) and returns its id,
 * used to attach source-position info to compiled SQL. Returns `0` when
 * source tracking is unavailable; the runtime never assigns `0` as a real
 * id, so callers can treat `0` as "no id".
 *
 * Identical content + ranges yield an equivalent registration, and repeated
 * template evaluations register the same SQL many times, so the first id is
 * reused instead of a runtime op round-trip per call.
 */
export function registerSql(
  content: string,
  ranges?: SqlSourceRange[],
): number {
  if (!getOps().op_register_sql) {
    return 0;
  }
  // Ranges JSON contains no raw newlines, so the first "\n" unambiguously
  // separates it from the content.
  const key = ranges !== undefined && ranges.length > 0
    ? "r" + JSON.stringify(ranges) + "\n" + content
    : "p" + content;
  const cached = registerSqlCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const id = getOps().op_register_sql(content, ranges);
  registerSqlCache.set(key, id);
  return id;
}

/**
 * Registers a statement for source tracking and returns its id. Returns `0`
 * when source tracking is unavailable; the runtime never assigns `0` as a
 * real id, so callers can treat `0` as "no id".
 */
export function registerStatement(): number {
  if (!getOps().op_register_statement) {
    return 0;
  }
  return getOps().op_register_statement();
}

export function registerStatementAtSource(
  fileName: string,
  lineNumber: number,
  columnNumber: number,
): number {
  if (!getOps().op_register_statement_at_source) {
    return registerStatement();
  }
  return getOps().op_register_statement_at_source(
    fileName,
    lineNumber,
    columnNumber,
  );
}

// ============================================================================
// Query Analysis API
// ============================================================================

/**
 * Scalar type for query analysis.
 * Matches the Rust PubScalarType enum.
 */
export type AnalyzeScalarType =
  | { type: "Bool" }
  | { type: "SmallInt" }
  | { type: "Int" }
  | { type: "BigInt" }
  | { type: "Real" }
  | { type: "Double" }
  | { type: "Decimal"; precision: number; scale: number }
  | { type: "Ordering" }
  | { type: "Date" }
  | { type: "Timestamp" }
  | { type: "TimestampTz" }
  | { type: "TimestampNaive" }
  | { type: "Enum"; enum: string }
  | { type: "Time" }
  | { type: "String" }
  | { type: "Uuid" }
  | { type: "Json" }
  | { type: "Interval" }
  | { type: "Bytes" };

/**
 * Table kind for local table definitions.
 */
export type TableKind = "Scalar" | "SingleRecord" | "Table";

/**
 * A local field definition for query analysis.
 */
export interface LocalField {
  /** Field name */
  name: string;
  /** Field type */
  type: AnalyzeScalarType;
  /** Whether the field is nullable (default: false) */
  nullable?: boolean;
}

/**
 * A local table definition for query analysis.
 */
export interface LocalTable {
  /** Table name */
  name: string;
  /** Table kind */
  kind: TableKind;
  /** Fields in this table */
  fields: LocalField[];
}

/**
 * A local database definition for query analysis.
 */
export interface LocalDatabase {
  /** Database name/prefix (e.g., "ui", "proc") */
  name: string;
  /** Tables in this database */
  tables: LocalTable[];
}

/**
 * Input for query analysis.
 */
export interface AnalyzeQueryInput {
  /** The SQL query to analyze (SqlId as number, or inline string) */
  query: number | string;
  /** Local databases with their tables */
  localDbs?: LocalDatabase[];
  /**
   * Database scope order for unqualified identifier resolution.
   * The order matters - databases listed first take precedence.
   * For example, ["ui", "db"] means UI scalars/tables are resolved before DB tables.
   */
  dbScope?: string[];
}

type AnalyzeWireScalarTypeName =
  | "Bool"
  | "SmallInt"
  | "Int"
  | "BigInt"
  | "Real"
  | "Double"
  | "Decimal"
  | "Ordering"
  | "Date"
  | "Timestamp"
  | "TimestampTz"
  | "Enum"
  | "Time"
  | "String"
  | "Uuid"
  | "Json"
  | "Interval"
  | "Bytes";

type AnalyzeWireScalarType = Extract<
  AnalyzeScalarType,
  { type: AnalyzeWireScalarTypeName }
>;

interface AnalyzeQueryWireLocalField {
  name: string;
  type: AnalyzeWireScalarType;
  timestampKind?: "Naive";
  nullable?: boolean;
}

interface AnalyzeQueryWireInput {
  query: number | string;
  localDbs?: {
    name: string;
    tables: {
      name: string;
      kind: TableKind;
      fields: AnalyzeQueryWireLocalField[];
    }[];
  }[];
  dbScope?: string[];
  typePrecision: "Exact";
}

function analyzeScalarTypeToWire(
  type: AnalyzeScalarType,
): Pick<AnalyzeQueryWireLocalField, "type" | "timestampKind"> {
  switch (type.type) {
    case "TimestampNaive":
      return { type: { type: "Timestamp" }, timestampKind: "Naive" };
    case "Bool":
    case "SmallInt":
    case "Int":
    case "BigInt":
    case "Real":
    case "Double":
    case "Decimal":
    case "Ordering":
    case "Date":
    case "Timestamp":
    case "TimestampTz":
    case "Enum":
    case "Time":
    case "String":
    case "Uuid":
    case "Json":
    case "Interval":
    case "Bytes":
      return { type };
  }
}

function analyzeQueryInputToWire(
  input: AnalyzeQueryInput,
): AnalyzeQueryWireInput {
  return {
    ...input,
    localDbs: input.localDbs?.map((db) => ({
      ...db,
      tables: db.tables.map((table) => ({
        ...table,
        fields: table.fields.map((field) => ({
          name: field.name,
          ...analyzeScalarTypeToWire(field.type),
          ...(field.nullable === undefined
            ? undefined
            : { nullable: field.nullable }),
        })),
      })),
    })),
    typePrecision: "Exact",
  };
}

/**
 * Information about a column in the query result.
 */
export interface QueryColumnInfo {
  /** Column name (from AS alias or original field name) */
  name: string;
  /** Column type */
  type: AnalyzeScalarType;
  /** Whether the column is nullable */
  nullable: boolean;
  /** Source table name (if column comes from a table field) */
  sourceTable?: string;
  /** Source field name (if column comes from a table field) */
  sourceField?: string;
}

/**
 * Result of query analysis.
 */
export type AnalyzeQueryResult =
  | { status: "ok"; columns: QueryColumnInfo[] }
  | { status: "error"; message: string };

/**
 * Analyze a SQL query and return metadata about its result columns.
 *
 * This function can be used to infer types from SQL queries for UI components.
 * Call this after core.tsx has defined all tables and enums.
 *
 * @param input - The query to analyze and optional local table definitions
 * @returns Analysis result with column metadata or an error
 *
 * @example
 * ```typescript
 * const result = analyzeQuery({
 *   query: sql`SELECT p.name, c.name as category FROM db.products p JOIN db.categories c ON p.category_id = c.id`,
 * });
 *
 * if (result.status === "ok") {
 *   for (const col of result.columns) {
 *     console.log(`${col.name}: ${col.type.type}, nullable: ${col.nullable}`);
 *   }
 * }
 * ```
 */
export function analyzeQuery(input: AnalyzeQueryInput): AnalyzeQueryResult {
  return getOps().op_analyze_query(analyzeQueryInputToWire(input));
}

// =============================================================================
// Import Sources API - For Pipeline Metaprogramming
// =============================================================================

/** A column in an import source table */
export interface ImportSourceColumn {
  name: string;
  ty: string;
  notNull: boolean;
  maxLength?: number;
}

/** A table in an import source */
export interface ImportSourceTable {
  name: string;
  columns: ImportSourceColumn[];
}

/** Schema information for an import source */
export interface ImportSourceSchema {
  kind: string;
  tables: ImportSourceTable[];
}

/**
 * Get all dev databases with their full schemas.
 *
 * Dev databases are registered database snapshots that can be used as source
 * schemas for transforms. This enables metaprogramming - you can read the source
 * database schema and generate transform code dynamically.
 *
 * @returns Map from database name to its schema
 *
 * @example
 * ```typescript
 * const devDbs = getDevDatabases();
 * const oldSchema = devDbs["old_system"];
 * if (oldSchema) {
 *   const contactsTable = oldSchema.tables.find(t => t.name === "contacts");
 *   console.log(`Contacts has ${contactsTable?.columns.length} columns`);
 * }
 * ```
 */
export function getDevDatabases(): Record<string, ImportSourceSchema> {
  return getOps().op_get_dev_databases();
}
