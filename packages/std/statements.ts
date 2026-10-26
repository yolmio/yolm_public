import { normalizeIdent, Sql, sql } from "./sql_utils";
import type {
  AnyExpr,
  BooleanExpr,
  JsonBuildValue,
  NumericExpr,
} from "./sql_utils";
import { fieldTypeFromHelper } from "./system";
import type { HelperFieldType } from "./system";
import type * as yom from "./yom";
import { currentStatementSourceOrigin } from "./statement_source";
import { registerStatement, registerStatementAtSource } from "./yolm_gen_api";

export const BACKING_ARRAY = Symbol("BACKING_ARRAY");
// This analyzer-only metadata is intentionally absent from serialized YOM.
const SCALAR_DECLARATION_ANALYSIS_EXPR = Symbol(
  "SCALAR_DECLARATION_ANALYSIS_EXPR",
);

type ScalarDeclarationWithAnalysisExpr = yom.ScalarDeclaration & {
  [SCALAR_DECLARATION_ANALYSIS_EXPR]?: Sql;
};

export function scalarDeclarationAnalysisExpr(
  statement: yom.ScalarDeclaration,
): Sql | undefined {
  return (statement as ScalarDeclarationWithAnalysisExpr)[
    SCALAR_DECLARATION_ANALYSIS_EXPR
  ];
}

/**
 * The control-flow and declaration surface common to every Yolm statement
 * builder, implemented by {@link StatementsBase}. Defines the primitives
 * available in any procedure scope regardless of execution phase: scoped
 * declarations (`defScalar`/`defRecord`/`defTable`), control flow (`if`,
 * `while`, `forEach*`, `block`, `try`), early exits (`break`, `continue`,
 * `return`, `throwError`), assertions, and `modify`.
 *
 * Concrete builders ({@link DomStatements}, {@link UiServerStatements},
 * {@link EndpointStatements}, …) extend this with phase-specific statements.
 * Use this type only for helpers meant to run in any scope.
 */
export interface IStatementsBase {
  statementsIsEmpty: boolean;

  modify(sql: Sql): this;
  modify(template: TemplateStringsArray, ...args: any[]): this;
  break(): this;
  breakIf(condition: BooleanExpr): this;
  breakUnless(condition: BooleanExpr): this;
  continue(): this;
  continueIf(condition: BooleanExpr): this;
  continueUnless(condition: BooleanExpr): this;
  throwError(message: Sql, description?: Sql): this;
  throwErrorIf(
    condition: BooleanExpr,
    message: Sql,
    description?: Sql,
  ): this;
  throwErrorUnless(
    condition: BooleanExpr,
    message: Sql,
    description?: Sql,
  ): this;
  return(expr?: AnyExpr): this;
  returnIf(condition: BooleanExpr, expr?: AnyExpr): this;
  returnUnless(condition: BooleanExpr, expr?: AnyExpr): this;

  /** @deprecated Use `s.defTable(name, query)` instead. */
  table(name: string, query: Sql): this;
  /** @deprecated Use `s.defTable(name, opts)` instead. */
  tableDef(opts: TableDefOpts): this;
  /** Declares a new local table in the current scope. */
  defTable(name: string, query: Sql): this;
  /** Declares a new local table in the current scope. */
  defTable(name: string, opts?: DefTableOpts): this;

  /** @deprecated Use `s.defRecord(name, query)` instead. */
  record(name: string, query: Sql): this;
  /** @deprecated Use `s.defRecord(name, opts)` instead. */
  recordDef(opts: RecordDefOpts): this;
  /** Declares a new local record in the current scope. */
  defRecord(name: string, query: Sql): this;
  /** Declares a new local record in the current scope. */
  defRecord(name: string, opts?: DefRecordOpts): this;

  /** @deprecated Use `s.defScalar(name, expr)` instead. */
  scalar(name: string, expr: AnyExpr): this;
  /** @deprecated Use `s.defScalar(name, opts)` instead. */
  scalarDef(opts: ScalarDefOpts): this;
  /** Declares a new local scalar in the current scope. */
  defScalar(name: string | Sql, expr: AnyExpr): this;
  /** Declares a new local scalar in the current scope. */
  defScalar(name: string | Sql, opts: DefScalarOpts): this;

  setScalar(name: string | Sql, expr: AnyExpr): this;
  increment(name: string | Sql, by?: NumericExpr): this;
  toggle(name: string | Sql): this;

  debug(log: string): this;
  debugExpr(expr: AnyExpr): this;
  captureExecution(): this;
  debugProcAndUiDb(): this;
  debugQuery(query: Sql): this;
  logError(message: AnyExpr, errorType?: AnyExpr): this;

  createQueryCursor(name: string, query: Sql): this;
  advanceCursor(cursor: string): this;

  pushSource(source: string): this;
  popSource(): this;

  queryToCsv(query: Sql, scalar: string): this;
  downloadQueryCsv(filename: Sql, query: Sql, contentType?: Sql): this;
  downloadQueryExcel(filename: Sql, opts: DownloadQueryExcelOpts): this;
  downloadDynamicQueryCsv(
    filename: Sql,
    query: Sql,
    opts?: DownloadDynamicQueryCsvOpts,
  ): this;

  evalRules(...rules: Sql[][]): this;

  statements(
    ...statements: (StatementsOrFn<this> | undefined | null | false)[]
  ): this;
  conditionalStatements(
    condition: boolean,
    statements: StatementsOrFn<this>,
  ): this;
  mapArrayToStatements<T>(arr: T[], fn: (item: T, s: this) => any): this;

  if(condition: BooleanExpr, then: StatementsOrFn<this>): this;
  if(
    condition: BooleanExpr,
    then: StatementsOrFn<this>,
    else_: StatementsOrFn<this>,
  ): this;
  elseIf(condition: BooleanExpr, then: StatementsOrFn<this>): this;
  else(then: StatementsOrFn<this>): this;
  unless(condition: BooleanExpr, then: StatementsOrFn<this>): this;
  conditional(opts: Conditional<StatementsOrFn<this>>): this;
  cases(opts: Cases<StatementsOrFn<this>>): this;

  while(condition: Sql, body: StatementsOrFn<this>): this;
  whileWithLabel(opts: While<StatementsOrFn<this>>): this;

  /**
       Infinitely loops the body, equivalent to `while (true)`
       */
  loop(body: StatementsOrFn<this>): this;
  loopWithLabel(label: string, body: StatementsOrFn<this>): this;

  /**
       Loops the body n times, equivalent to doing a for loop with a counter
       */
  loopN(n: NumericExpr, body: StatementsOrFn<this>): this;
  loopNWithLabel(
    n: NumericExpr,
    label: string,
    body: StatementsOrFn<this>,
  ): this;

  forEachCursor(cursor: string, body: StatementsOrFn<this>): this;
  forEachCursorWithLabel(opts: ForEachCursor<StatementsOrFn<this>>): this;

  forEachTable(
    table: string,
    cursorName: string,
    body: StatementsOrFn<this>,
  ): this;
  forEachTableWithOpts(opts: ForEachTable<StatementsOrFn<this>>): this;

  forEachQuery(
    query: Sql,
    cursorName: string,
    body: StatementsOrFn<this>,
  ): this;
  forEachQueryWithLabel(opts: ForEachQuery<StatementsOrFn<this>>): this;

  try(opts: Try<StatementsOrFn<this>>): this;

  block(body: StatementsOrFn<this>): this;
  block(label: string, body: StatementsOrFn<this>): this;

  exitBlock(label?: string): this;
  exitBlockIf(condition: BooleanExpr, label?: string): this;
  exitBlockUnless(condition: BooleanExpr, label?: string): this;

  validateExpr(expr: AnyExpr, name: string): this;
  validateExprExpr(expr: AnyExpr, name: string): this;
  validateQuery(query: Sql, name: string): this;
  validateQueryExpr(query: AnyExpr, name: string): this;
  validateModify(modify: Sql, name: string): this;
  validateModifyExpr(modify: Sql, name: string): this;

  assertExprType(expr: AnyExpr, type: yom.ScalarType): this;
  assertQueryType(
    query: Sql,
    columns: { name: string; type: yom.ScalarType }[],
  ): this;

  // New composable assertion primitives
  assert(condition: BooleanExpr, message?: AnyExpr): this;
  assertEqual(actual: AnyExpr, expected: AnyExpr, message?: AnyExpr): this;
  assertNotEqual(actual: AnyExpr, expected: AnyExpr, message?: AnyExpr): this;

  consoleLog(): void;
}

/**
 * Description of a single field on a procedure-scope record or table
 * declared with `s.defRecord(...)` / `s.defTable(...)`, or a stored
 * procedure parameter.
 */
export interface HelperProcField {
  /** Field name referenced from SQL inside the procedure. */
  name: string;
  /** Field type (full {@link yom.FieldType} or shorthand). */
  type: HelperFieldType;
  /** Whether the field is NOT NULL. */
  notNull?: boolean;
  /** Build an index over this field on the in-memory table. */
  indexed?: boolean;
}

export interface TableDefOpts {
  name: string;
  fields?: HelperProcField[];
  query?: Sql;
  inferQuery?: Sql;
  allowNoRead?: boolean;
}

interface RecordDefOpts {
  name: string;
  fields?: HelperProcField[];
  query?: Sql;
  inferQuery?: Sql;
  allowNoRead?: boolean;
}

/**
 * Options for `s.defScalar(name, opts)` — the polymorphic declaration form.
 * Name is passed as the first positional argument; everything else lives here.
 */
interface DefScalarCommonOpts {
  allowNoRead?: boolean;
}

export type DefScalarOpts =
  & DefScalarCommonOpts
  & (
    | {
      type: HelperFieldType;
      expr?: AnyExpr;
      inferExpr?: AnyExpr;
    }
    | {
      type?: HelperFieldType;
      expr: AnyExpr;
      inferExpr?: AnyExpr;
    }
    | {
      type?: HelperFieldType;
      expr?: AnyExpr;
      inferExpr: AnyExpr;
    }
  );

type ScalarDefOpts = DefScalarOpts & { name: string | Sql };

/**
 * Options for `s.defRecord(name, opts)`. Name is positional.
 */
export interface DefRecordOpts {
  fields?: HelperProcField[];
  query?: Sql;
  inferQuery?: Sql;
  allowNoRead?: boolean;
}

/**
 * Options for `s.defTable(name, opts)`. Name is positional.
 */
export interface DefTableOpts {
  fields?: HelperProcField[];
  query?: Sql;
  inferQuery?: Sql;
  allowNoRead?: boolean;
}

export abstract class StatementsBase<Statement extends object>
  implements IStatementsBase {
  private [BACKING_ARRAY]: Statement[] = [];

  protected pushToBacking(statement: Statement) {
    // Attach statement ID for source tracking. An id of 0 means source
    // tracking is unavailable (the runtime never hands out 0 as a real id),
    // so omit it instead of serializing a dangling reference.
    const origin = currentStatementSourceOrigin();
    let stId: number;
    if (origin === undefined) {
      stId = registerStatement();
    } else {
      stId = origin.statementId ?? 0;
      if (origin.statementId === undefined) {
        stId = registerStatementAtSource(
          origin.fileName,
          origin.lineNumber,
          origin.columnNumber,
        );
        origin.statementId = stId;
      }
    }
    if (stId !== 0) {
      (statement as any).s = stId;
    }
    this[BACKING_ARRAY].push(statement);
  }

  get statementsIsEmpty() {
    return this[BACKING_ARRAY].length === 0;
  }

  /**
   Modify statement
   @param sql - The SQL modify statement to execute.
   @returns The current StatementsBase instance.

   Common mistakes:
   - Not using sql` template method. Always use the sql` template method.
   */
  modify(sql: Sql): this;
  modify(template: TemplateStringsArray, ...args: any[]): this;
  modify(sqlParam: Sql | TemplateStringsArray, ...args: any[]): this {
    if (sqlParam instanceof Sql) {
      this.pushToBacking({
        t: "Modify",
        sql: typeof sqlParam === "string" ? sqlParam : sqlParam.toYOM(),
      } as yom.ModifyStatement as any);
    } else {
      this.pushToBacking({
        t: "Modify",
        sql: sql(sqlParam, ...args).toYOM(),
      } as yom.ModifyStatement as any);
    }
    return this;
  }

  break() {
    this.pushToBacking({ t: "Break" } as yom.BreakStatement as any);
    return this;
  }

  breakIf(sql: BooleanExpr) {
    this.if(sql, (s) => s.break());
    return this;
  }

  breakUnless(sql: BooleanExpr) {
    this.unless(sql, (s) => s.break());
    return this;
  }

  continue() {
    this.pushToBacking({ t: "Continue" } as yom.ContinueStatement as any);
    return this;
  }

  continueIf(sql: BooleanExpr) {
    this.if(sql, (s) => s.continue());
    return this;
  }

  continueUnless(sql: BooleanExpr) {
    this.unless(sql, (s) => s.continue());
    return this;
  }

  throwError(message: string | Sql, description?: Sql) {
    this.pushToBacking({
      t: "Throw",
      message: typeof message === "string"
        ? sql.lit(message).toYOM()
        : sql.normalizeExpr(message).toYOM(),
      description: description !== undefined
        ? sql.normalizeExpr(description).toYOM()
        : undefined,
    } as yom.ThrowStatement as any);
    return this;
  }

  throwErrorIf(
    condition: BooleanExpr,
    message: Sql,
    description?: Sql,
  ) {
    return this.if(condition, (s) => s.throwError(message, description));
  }

  throwErrorUnless(
    condition: BooleanExpr,
    message: Sql,
    description?: Sql,
  ) {
    return this.unless(condition, (s) => s.throwError(message, description));
  }

  return(expr?: AnyExpr) {
    this.pushToBacking({
      t: "ReturnExpr",
      expr: expr === undefined ? "null" : sql.toYOM(expr),
    } as yom.ReturnExprStatement as any);
    return this;
  }

  returnIf(condition: BooleanExpr, expr?: AnyExpr) {
    return this.if(condition, (s) => s.return(expr));
  }

  returnUnless(condition: BooleanExpr, expr?: AnyExpr) {
    return this.unless(condition, (s) => s.return(expr));
  }

  /** @deprecated Use `s.defTable(name, query)` instead. */
  table(name: string, query: Sql): this {
    return this.defTable(name, query);
  }

  /** @deprecated Use `s.defTable(name, opts)` instead. */
  tableDef(opts: TableDefOpts): this {
    const { name, ...rest } = opts;
    return this.defTable(name, rest);
  }

  defTable(name: string, queryOrOpts?: Sql | DefTableOpts): this {
    const opts: DefTableOpts = queryOrOpts === undefined
      ? {}
      : queryOrOpts instanceof Sql
      ? { query: queryOrOpts }
      : queryOrOpts;
    this.pushToBacking({
      t: "TableDeclaration",
      name,
      query: opts.query?.toYOM(),
      fields: opts.fields?.map((f) => ({
        name: f.name,
        type: fieldTypeFromHelper(f.type),
        notNull: f.notNull,
        indexed: f.indexed,
      })),
      inferQuery: opts.inferQuery?.toYOM(),
      allowNoRead: opts.allowNoRead,
    } as yom.TableDeclaration as any);
    return this;
  }

  /** @deprecated Use `s.defRecord(name, query)` instead. */
  record(name: string, query: Sql) {
    return this.defRecord(name, query);
  }

  /** @deprecated Use `s.defRecord(name, opts)` instead. */
  recordDef(opts: RecordDefOpts): this {
    const { name, ...rest } = opts;
    return this.defRecord(name, rest);
  }

  defRecord(name: string, queryOrOpts?: Sql | DefRecordOpts): this {
    const opts: DefRecordOpts = queryOrOpts === undefined
      ? {}
      : queryOrOpts instanceof Sql
      ? { query: queryOrOpts }
      : queryOrOpts;
    this.pushToBacking({
      t: "RecordDeclaration",
      name,
      query: opts.query?.toYOM(),
      fields: opts.fields?.map((f) => ({
        name: f.name,
        type: fieldTypeFromHelper(f.type),
        notNull: f.notNull,
        indexed: f.indexed,
      })),
      inferQuery: opts.inferQuery?.toYOM(),
      allowNoRead: opts.allowNoRead,
    } as yom.RecordDeclaration as any);
    return this;
  }

  /** @deprecated Use `s.defScalar(name, expr)` instead. */
  scalar(name: string | Sql, expr: AnyExpr): this {
    return this.defScalar(name, expr);
  }

  /** @deprecated Use `s.defScalar(name, opts)` instead. */
  scalarDef(opts: ScalarDefOpts): this {
    const { name, ...rest } = opts;
    return this.defScalar(name, rest);
  }

  defScalar(
    name: string | Sql,
    exprOrOpts: AnyExpr | DefScalarOpts,
  ): this {
    const opts: DefScalarOpts = sql.isAnyExpr(exprOrOpts)
      ? { expr: exprOrOpts }
      : exprOrOpts;
    const declaration: ScalarDeclarationWithAnalysisExpr = {
      t: "ScalarDeclaration",
      name: typeof name === "string" ? name : name.toYOM(),
      expr: opts.expr !== undefined ? sql.toYOM(opts.expr) : undefined,
      type: opts.type !== undefined
        ? fieldTypeFromHelper(opts.type)
        : undefined,
      inferExpr: opts.inferExpr !== undefined
        ? sql.toYOM(opts.inferExpr)
        : undefined,
      allowNoRead: opts.allowNoRead,
    } as yom.ScalarDeclaration;
    const analysisExpr = opts.expr ?? opts.inferExpr;
    if (analysisExpr !== undefined) {
      declaration[SCALAR_DECLARATION_ANALYSIS_EXPR] = sql.normalizeExpr(
        analysisExpr,
      );
    }
    this.pushToBacking(declaration as any);
    return this;
  }

  setScalar(name: string | Sql, expr: AnyExpr) {
    this.pushToBacking({
      t: "SetScalar",
      name: typeof name === "string" ? name : name.toYOM(),
      expr: sql.toYOM(expr),
    } as yom.SetScalar as any);
    return this;
  }

  increment(name: string | Sql, by: NumericExpr = 1) {
    return this.setScalar(name, sql`${normalizeIdent(name)} + ${by}`);
  }

  decrement(name: string | Sql, by: NumericExpr = 1) {
    return this.setScalar(name, sql`${normalizeIdent(name)} - ${by}`);
  }

  toggle(name: string | Sql) {
    return this.setScalar(name, sql.not(normalizeIdent(name)));
  }

  debug(log: string | Sql) {
    this.pushToBacking({
      t: "DebugExpr",
      expr: typeof log === "string" ? sql.lit(log).toYOM() : log.toYOM(),
    } as yom.DebugExprStatement as any);
    return this;
  }

  debugExpr(expr: AnyExpr) {
    this.pushToBacking({
      t: "DebugExpr",
      expr: sql.toYOM(expr),
    } as yom.DebugExprStatement as any);
    return this;
  }

  captureExecution() {
    this.pushToBacking({
      t: "CaptureExecution",
    } as yom.CaptureExecutionStatement as any);
    return this;
  }

  debugProcAndUiDb() {
    this.pushToBacking({
      t: "DebugProcAndUiDb",
    } as yom.DebugProcAndUiDbStatement as any);
    return this;
  }

  debugQuery(query: Sql) {
    this.pushToBacking({
      t: "DebugQuery",
      query: query.toYOM(),
    } as yom.DebugQueryStatement as any);
    return this;
  }

  logError(message: AnyExpr, errorType?: AnyExpr) {
    this.pushToBacking({
      t: "LogError",
      message: sql.toYOM(message),
      errorType: errorType !== undefined ? sql.toYOM(errorType) : undefined,
    } as yom.LogErrorStatement as any);
    return this;
  }

  createQueryCursor(name: string, query: Sql) {
    this.pushToBacking({
      t: "CreateQueryCursor",
      name,
      query: query.toYOM(),
    } as yom.CreateQueryCursorStatement as any);
    return this;
  }

  advanceCursor(cursor: string) {
    this.pushToBacking({
      t: "AdvanceCursor",
      cursor,
    } as yom.AdvanceCursorStatement as any);
    return this;
  }

  pushSource(source: string) {
    this.pushToBacking({
      t: "PushSource",
      source,
    } as yom.PushSourceStatement as any);
    return this;
  }

  popSource() {
    this.pushToBacking({ t: "PopSource" } as yom.PopSourceStatement as any);
    return this;
  }

  evalRules(...rules: AnyExpr[][]) {
    this.pushToBacking({
      t: "EvalRules",
      rules: rules.map((rules) => rules.map((ru) => sql.toYOM(ru)) as any),
    } as yom.EvalRulesStatement as any);
    return this;
  }

  queryToCsv(query: Sql, scalar: string) {
    this.pushToBacking({
      t: "QueryToCsv",
      query: query.toYOM(),
      scalar,
    } as yom.QueryToCsvStatement as any);
    return this;
  }

  downloadQueryCsv(filename: Sql, query: Sql, contentType?: Sql) {
    this.pushToBacking({
      t: "DownloadQueryCsv",
      filename: sql.toYOM(filename),
      query: query.toYOM(),
      contentType: contentType ? sql.toYOM(contentType) : undefined,
    } as any);
    return this;
  }

  downloadQueryExcel(filename: Sql, opts: DownloadQueryExcelOpts) {
    this.pushToBacking({
      t: "DownloadQueryExcel",
      filename: sql.toYOM(filename),
      sheets: opts.sheets,
      statements: UiServerStatements.normalizeToArray(opts.setup),
    } as any);
    return this;
  }

  downloadDynamicQueryCsv(
    filename: Sql,
    query: Sql,
    opts: DownloadDynamicQueryCsvOpts = {},
  ) {
    this.pushToBacking({
      t: "DownloadDynamicQueryCsv",
      filename: sql.toYOM(filename),
      query: query.toYOM(),
      contentType: opts.contentType ? sql.toYOM(opts.contentType) : undefined,
      skipAutoRowCap: opts.skipAutoRowCap
        ? sql.toYOM(opts.skipAutoRowCap)
        : undefined,
    } as any);
    return this;
  }

  protected addGenericStatements(
    statements: StatementsOrFn<this> | undefined | null | false,
  ) {
    if (!statements) {
      return;
    }
    if (typeof statements === "function") {
      statements(this);
      return;
    }
    if (statements[BACKING_ARRAY]) {
      for (const statement of statements[BACKING_ARRAY]) {
        this.pushToBacking(statement as any);
      }
    }
  }

  protected normalizeGenericStatements(
    s: StatementsOrFn<this> | undefined | null | false,
  ): Statement[] | undefined {
    if (typeof s === "function") {
      const arr = new (this.constructor as any)();
      s(arr);
      return arr[BACKING_ARRAY];
    }
    if (s === this) {
      throw new Error(
        "Cannot call any helper functions with itself, i.sql. \n" +
          " const statements = new BasicStatements();\n" +
          "statements.statements(statements); statements.if('true', statements);\n" +
          "You did something like the above",
      );
    }
    if (s) {
      return s[BACKING_ARRAY] as any;
    }
  }

  statements(
    ...statements: (StatementsOrFn<this> | undefined | null | false)[]
  ) {
    for (const s of statements) {
      this.addGenericStatements(s);
    }
    return this;
  }

  conditionalStatements(condition: boolean, statements: StatementsOrFn<this>) {
    if (condition) {
      this.addGenericStatements(statements);
    }
    return this;
  }

  mapArrayToStatements<T>(arr: T[], fn: (item: T, s: this) => this) {
    for (const item of arr) {
      fn(item, this);
    }
    return this;
  }

  if(condition: BooleanExpr, then: StatementsOrFn<this>): this;
  if(
    condition: BooleanExpr,
    then: StatementsOrFn<this>,
    else_: StatementsOrFn<this>,
  ): this;
  if(
    condition: BooleanExpr,
    then: StatementsOrFn<this>,
    else_?: StatementsOrFn<this>,
  ): this {
    if (condition === true) {
      return this.block(then);
    }
    if (condition === false) {
      if (else_) {
        return this.block(else_);
      }
      return this;
    }
    this.pushToBacking({
      t: "If",
      condition: sql.toYOM(condition),
      onTrue: this.normalizeGenericStatements(then),
      onFalse: this.normalizeGenericStatements(else_),
    } as yom.IfStatement<any> as any);
    return this;
  }

  #addToLastIfElse(statements: StatementsOrFn<this>) {
    const lastStatement = this[BACKING_ARRAY][this[BACKING_ARRAY].length - 1];
    if ((lastStatement as any).t !== "If") {
      throw new Error("elseIf or else must be used after an if statement");
    }
    const lastIfStatement = lastStatement as yom.IfStatement<any>;

    // If there's already an onFalse with content, we need to find the last nested if
    if (lastIfStatement.onFalse && lastIfStatement.onFalse.length > 0) {
      // Check if the last statement in onFalse is an If statement
      const lastFalseStatement =
        lastIfStatement.onFalse[lastIfStatement.onFalse.length - 1];
      if ((lastFalseStatement as any).t === "If") {
        // Recursively find the deepest if statement without an else
        let currentIf = lastFalseStatement as yom.IfStatement<any>;
        while (currentIf.onFalse && currentIf.onFalse.length > 0) {
          const lastNestedStatement =
            currentIf.onFalse[currentIf.onFalse.length - 1];
          if ((lastNestedStatement as any).t !== "If") {
            break;
          }
          currentIf = lastNestedStatement as yom.IfStatement<any>;
        }
        // Add the statements to the deepest if's onFalse
        currentIf.onFalse = this.normalizeGenericStatements(statements)!;
        return;
      }
    }

    // If there's no onFalse yet, add it directly
    lastIfStatement.onFalse = this.normalizeGenericStatements(statements)!;
  }

  elseIf(condition: BooleanExpr, then: StatementsOrFn<this>): this {
    this.#addToLastIfElse((s) => {
      s.if(condition, then);
    });
    return this;
  }

  else(then: StatementsOrFn<this>): this {
    this.#addToLastIfElse(then);
    return this;
  }

  unless(condition: BooleanExpr, then: StatementsOrFn<this>): this {
    return this.if(sql.not(condition), then);
  }

  conditional(opts: Conditional<StatementsOrFn<this>>) {
    this.pushToBacking({
      t: "If",
      condition: sql.toYOM(opts.condition),
      onTrue: this.normalizeGenericStatements(opts.then),
      onFalse: this.normalizeGenericStatements(opts.else),
    } as yom.IfStatement<any> as any);
    return this;
  }

  cases(opts: Cases<StatementsOrFn<this>>): this {
    const [first, ...rest] = opts.cases;
    if (!first) {
      this.statements(opts.default);
      return this;
    }
    if (first.condition === false) {
      return this.cases({ cases: rest, default: opts.default });
    }
    if (first.condition === true) {
      this.statements(first.body);
      return this;
    }
    const onFalse = new (this.constructor as any)();
    onFalse.cases({ cases: rest, default: opts.default });
    this.conditional({
      condition: first.condition,
      then: first.body,
      else: onFalse,
    });
    return this;
  }

  while(condition: BooleanExpr, body: StatementsOrFn<this>) {
    this.pushToBacking({
      t: "While",
      condition: sql.toYOM(condition),
      body: this.normalizeGenericStatements(body),
    } as yom.WhileStatement<any> as any);
    return this;
  }
  whileWithLabel(opts: While<StatementsOrFn<this>>) {
    this.pushToBacking({
      t: "While",
      condition: sql.toYOM(opts.condition),
      body: this.normalizeGenericStatements(opts.body),
      label: opts.label,
    } as yom.WhileStatement<any> as any);
    return this;
  }

  loop(body: StatementsOrFn<this>): this {
    this.pushToBacking({
      t: "While",
      condition: "true",
      body: this.normalizeGenericStatements(body),
    } as yom.WhileStatement<any> as any);
    return this;
  }
  loopWithLabel(label: string, body: StatementsOrFn<this>) {
    this.pushToBacking({
      t: "While",
      condition: "true",
      body: this.normalizeGenericStatements(body),
      label,
    } as yom.WhileStatement<any> as any);
    return this;
  }

  loopN(n: NumericExpr, body: StatementsOrFn<this>): this {
    this.defScalar("loop_n_iteration_index", 0);
    return this.while(sql`loop_n_iteration_index < ${n}`, (s) => {
      s.increment("loop_n_iteration_index");
      s.statements(body);
    });
  }
  loopNWithLabel(
    n: NumericExpr,
    label: string,
    body: StatementsOrFn<this>,
  ): this {
    this.defScalar("loop_n_iteration_index", 0);
    return this.whileWithLabel({
      label,
      condition: sql`loop_n_iteration_index < ${n}`,
      body: (s) => {
        s.increment("loop_n_iteration_index");
        s.statements(body);
      },
    });
  }

  forEachCursor(cursor: string, body: StatementsOrFn<this>): this {
    this.pushToBacking({
      t: "ForEachCursor",
      cursor,
      body: this.normalizeGenericStatements(body),
    } as yom.ForEachCursorStatement<any> as any);
    return this;
  }
  forEachCursorWithLabel(opts: ForEachCursor<StatementsOrFn<this>>): this {
    this.pushToBacking({
      t: "ForEachCursor",
      cursor: opts.cursor,
      body: this.normalizeGenericStatements(opts.body),
      label: opts.label,
    } as yom.ForEachCursorStatement<any> as any);
    return this;
  }

  forEachTable(
    table: string,
    cursorName: string,
    body: StatementsOrFn<this>,
  ): this {
    this.pushToBacking({
      t: "ForEachTable",
      table,
      cursorName,
      body: this.normalizeGenericStatements(body),
    } as yom.ForEachTableStatement<any> as any);
    return this;
  }
  forEachTableWithOpts(opts: ForEachTable<StatementsOrFn<this>>): this {
    this.pushToBacking({
      t: "ForEachTable",
      table: opts.table,
      cursorName: opts.cursorName,
      where: sql.toYOM(opts.where),
      orderBy: opts.orderBy?.toYOM(),
      label: opts.label,
      body: this.normalizeGenericStatements(opts.body),
    } as yom.ForEachTableStatement<any> as any);
    return this;
  }

  forEachQuery(
    query: Sql,
    cursorName: string,
    body: StatementsOrFn<this>,
  ): this {
    this.pushToBacking({
      t: "ForEachQuery",
      query: query.toYOM(),
      cursorName,
      body: this.normalizeGenericStatements(body),
    } as yom.ForEachQueryStatement<any> as any);
    return this;
  }
  forEachQueryWithLabel(opts: ForEachQuery<StatementsOrFn<this>>): this {
    this.pushToBacking({
      t: "ForEachQuery",
      query: opts.query instanceof Sql ? opts.query.toYOM() : opts.query,
      cursorName: opts.cursorName,
      label: opts.label,
      body: this.normalizeGenericStatements(opts.body),
    } as yom.ForEachQueryStatement<any> as any);
    return this;
  }

  try(opts: Try<StatementsOrFn<this>>) {
    this.pushToBacking({
      t: "Try",
      body: this.normalizeGenericStatements(opts.body),
      errorName: opts.errorName,
      catch: this.normalizeGenericStatements(opts.catch),
      finally: this.normalizeGenericStatements(opts.finally),
    } as yom.TryStatement<any> as any);
    return this;
  }

  block(body: StatementsOrFn<this>): this;
  block(label: string, body: StatementsOrFn<this>): this;
  block(label: string | StatementsOrFn<this>, body?: StatementsOrFn<this>) {
    if (typeof label === "string") {
      this.pushToBacking({
        t: "Block",
        label,
        body: this.normalizeGenericStatements(body),
      } as yom.BlockStatement<any> as any);
    } else {
      this.pushToBacking({
        t: "Block",
        body: this.normalizeGenericStatements(label),
      } as yom.BlockStatement<any> as any);
    }
    return this;
  }

  exitBlock(label?: string): this {
    this.pushToBacking({
      t: "ExitBlock",
      label,
    } as yom.ExitBlockStatement as any);
    return this;
  }

  exitBlockIf(condition: BooleanExpr, label?: string): this {
    this.if(condition, (s) => s.exitBlock(label));
    return this;
  }

  exitBlockUnless(condition: BooleanExpr, label?: string): this {
    this.unless(condition, (s) => s.exitBlock(label));
    return this;
  }

  validateExpr(expr: Sql, name: string): this {
    this.pushToBacking({
      t: "ValidateExpr",
      expr: sql.toYOM(expr),
      name,
    } as yom.ValidateExprStatement as any);
    return this;
  }

  validateExprExpr(expr: Sql, name: string): this {
    this.pushToBacking({
      t: "ValidateExprExpr",
      expr: sql.toYOM(expr),
      name,
    } as yom.ValidateExprExprStatement as any);
    return this;
  }

  validateQuery(query: Sql, name: string): this {
    this.pushToBacking({
      t: "ValidateQuery",
      query: query.toYOM(),
      name,
    } as yom.ValidateQueryStatement as any);
    return this;
  }

  validateQueryExpr(query: Sql, name: string): this {
    this.pushToBacking({
      t: "ValidateQueryExpr",
      query: sql.toYOM(query),
      name,
    } as yom.ValidateQueryExprStatement as any);
    return this;
  }

  validateModify(modify: Sql, name: string): this {
    this.pushToBacking({
      t: "ValidateModify",
      sql: modify.toYOM(),
      name,
    } as yom.ValidateModifyStatement as any);
    return this;
  }

  validateModifyExpr(modify: Sql, name: string): this {
    this.pushToBacking({
      t: "ValidateModifyExpr",
      sql: sql.toYOM(modify),
      name,
    } as yom.ValidateModifyExprStatement as any);
    return this;
  }

  assertExprType(expr: Sql, type: yom.ScalarType): this {
    this.pushToBacking({
      t: "AssertExprType",
      expr: sql.toYOM(expr),
      type,
    } as yom.AssertExprType as any);
    return this;
  }

  assertQueryType(
    query: Sql,
    columns: { name: string; type: yom.ScalarType }[],
  ): this {
    this.pushToBacking({
      t: "AssertQueryType",
      query: query.toYOM(),
      columns,
    } as yom.AssertQueryType as any);
    return this;
  }

  assert(condition: BooleanExpr, message?: AnyExpr): this {
    this.pushToBacking({
      t: "Assert",
      condition: sql.toYOM(condition),
      message: message ? sql.toYOM(message) : undefined,
    } as yom.AssertStatement as any);
    return this;
  }

  assertEqual(actual: AnyExpr, expected: AnyExpr, message?: AnyExpr): this {
    this.pushToBacking({
      t: "AssertEqual",
      actual: sql.toYOM(actual),
      expected: sql.toYOM(expected),
      message: message ? sql.toYOM(message) : undefined,
    } as yom.AssertEqualStatement as any);
    return this;
  }

  assertNotEqual(actual: AnyExpr, expected: AnyExpr, message?: AnyExpr): this {
    this.pushToBacking({
      t: "AssertNotEqual",
      actual: sql.toYOM(actual),
      expected: sql.toYOM(expected),
      message: message ? sql.toYOM(message) : undefined,
    } as yom.AssertNotEqualStatement as any);
    return this;
  }

  consoleLog(): void {
    console.log(JSON.stringify(this[BACKING_ARRAY], null, 2));
  }

  [Symbol.iterator]() {
    return this[BACKING_ARRAY][Symbol.iterator]();
  }
}

type StatementsOrFn<S> = ((statements: S) => unknown) | S | BasicStatements;

interface Try<S> {
  body: S;
  errorName?: string;
  catch?: S;
  finally?: S;
}

interface Conditional<S> {
  condition: BooleanExpr;
  then: S;
  else?: S;
}

interface Cases<S> {
  cases: {
    condition: BooleanExpr;
    body: S;
  }[];
  default?: S;
}

interface While<S> {
  condition: BooleanExpr;
  label?: string;
  body?: S;
}

interface ForEachCursor<S> {
  cursor: string;
  label?: string;
  body?: S;
}

interface ForEachTable<S> {
  table: string;
  cursorName: string;
  where?: BooleanExpr;
  orderBy?: Sql;
  label?: string;
  body?: S;
}

interface ForEachQuery<S> {
  query: Sql | string;
  cursorName: string;
  label?: string;
  body?: S;
}

/**
 * Either a {@link BasicStatements} instance or a builder function. APIs
 * that need basic statements accept this shorthand so callers can pass an
 * inline `(s) => …` instead of constructing a builder by hand.
 */
export type BasicStatementsOrFn = StatementsOrFn<BasicStatements>;

/**
 * The smallest statement builder — only contains the universal building
 * blocks (`if`, `forEach`, `while`, `block`, `try`, `defScalar`, etc.) and
 * is the parent of every other statement builder.
 *
 * Use it directly only for the most generic helpers; most call sites use
 * the more specific {@link DomStatements}, {@link EndpointStatements},
 * {@link GeneralServerStatements}, {@link StateStatements}, etc.
 *
 * See {@link https://docs.yolm.io/procedures/base_statements | Base statements}.
 */
export class BasicStatements extends StatementsBase<yom.BasicStatement> {
  static normalize(p: BasicStatementsOrFn | undefined | false | null) {
    return p instanceof BasicStatements
      ? p
      : new BasicStatements().statements(p);
  }

  static normalizeToArray(p: BasicStatementsOrFn | undefined | false | null) {
    return BasicStatements.normalize(p)[BACKING_ARRAY];
  }
}

/** Target dimensions and fit mode for resizing an image at upload time. */
export interface ImageResize {
  width: NumericExpr;
  height: NumericExpr;
  /** "crop" | "cover" | "scale_down" | "contain" */
  type: Sql;
}

/** Options for adding an uploaded image to a record, with optional re-encoding/resize. */
export interface AddImageOpts {
  /** Uuid of the DOM file input the image came from. */
  domUuid: Sql;
  /** Name of the record receiving the stored image fields. */
  fileRecord: string;
  /** integer between 0 and 100 */
  jpegQuality: NumericExpr;
  resize?: ImageResize;
}

interface TryServerProc<T> {
  body: UiServerStatementsOrFn;
  transferFiles?: Sql;
  errorName?: string;
  catch?: T;
  finally?: T;
}

/** Options for {@link ElementStatements.scrollIntoView}. */
export interface ScrollIntoViewOpts {
  /**  "auto" | "instant" | "smooth"*/
  behavior?: Sql;
  /** "start" | "center" | "end" | "nearest" */
  block?: Sql;
  /** "start" | "center" | "end" | "nearest" */
  inline?: Sql;
}

/**
 * Options for {@link DomStatements.jsCall} — invokes a named export from a
 * bundled JS module in the browser. Args are passed as JSON and/or named
 * byte buffers; results come back into a scalar and/or a bytes table.
 */
export interface JsCallOpts {
  /** Bundled JS module path. */
  module: string;
  /** Exported function name within the module. */
  exportName: string;
  /** Opaque handle identifying the call's host context. */
  handle: Sql;
  argJson?: Sql;
  argBytes?: Record<string, Sql>;
  resultJsonScalar?: string;
  resultBytesTable?: string;
}

/**
 * Anything callers can pass where a {@link DomStatements} block is expected:
 * either a pre-built `DomStatements` instance or a `(s) => …` builder
 * function that mutates a fresh one. Used pervasively on event handlers
 * (`onClick`, `onSubmit`, `onChange`, …) and any `Form`/`Data` callback
 * that runs in the DOM phase.
 */
export type DomStatementsOrFn = StatementsOrFn<DomStatements>;

/**
 * Statement builder for code that runs in the **DOM phase** — inside
 * the user's browser. This is the `s` argument you receive in DOM
 * event handlers (`onClick`, `onSubmit`, …), `Form`'s client-side
 * hooks (`beforeSubmitClient`, `afterSubmitClientSuccess`,
 * `onSubmitError`), and `Listen`'s `onChange`.
 *
 * Available statements include client-side state mutations
 * (`s.setScalar`, `s.modify`), navigation (`s.navigate`,
 * `s.setQueryParam`), and event helpers under the `s.event` namespace
 * (`s.event.preventDefault()`, `s.event.stopPropagation()`). For work
 * that needs to run on the server (transactions, external HTTP, file
 * IO) use `s.server(...)` to hop to a {@link UiServerStatements} block.
 *
 * @see docs/procedures/dom_statements.md
 */
export class DomStatements extends StatementsBase<yom.DomProcStatement> {
  static normalize(p: DomStatementsOrFn | undefined | false | null) {
    return p instanceof DomStatements ? p : new DomStatements().statements(p);
  }

  static normalizeToArray(p: DomStatementsOrFn | undefined | false | null) {
    return DomStatements.normalize(p)[BACKING_ARRAY];
  }

  navigate(to: Sql, replace?: Sql) {
    this.pushToBacking({
      t: "Navigate",
      to: sql.toYOM(to),
      replace: replace !== undefined ? sql.toYOM(replace) : undefined,
    });
    return this;
  }

  download(
    filename: Sql,
    content: Sql,
    contentType?: Sql,
  ) {
    this.pushToBacking({
      t: "Download",
      filename: sql.toYOM(filename),
      content: sql.toYOM(content),
      contentType: contentType ? sql.toYOM(contentType) : undefined,
    });
    return this;
  }

  emitDynamicInternalEvent(name: Sql, payloadJson?: Sql) {
    this.pushToBacking({
      t: "EmitDynamicInternalEvent",
      name: sql.toYOM(name),
      payloadJson: payloadJson !== undefined
        ? sql.toYOM(payloadJson)
        : undefined,
    });
    return this;
  }

  sleep(ms: NumericExpr) {
    this.pushToBacking({ t: "Sleep", ms: sql.toYOM(ms) });
    return this;
  }

  commitUiTreeChanges() {
    this.pushToBacking({ t: "CommitUiTreeChanges" });
    return this;
  }

  runTreeChangeEffects() {
    this.pushToBacking({ t: "RunTreeChangeEffects" });
    return this;
  }

  logOut() {
    this.pushToBacking({ t: "ClearLocalData" });
    return this;
  }

  startTask(procedure: StatementsOrFn<this>): this {
    this.pushToBacking({
      t: "StartTask",
      statements: DomStatements.normalizeToArray(procedure as any),
    });
    return this;
  }
  startTaskWithOpts(opts: SpawnOpts<this>): this {
    this.pushToBacking({
      t: "StartTask",
      statements: DomStatements.normalizeToArray(opts.procedure as any),
      detached: opts.detached,
      idScalar: opts.handleScalar,
    });
    return this;
  }

  waitOnTask(handle: Sql) {
    this.pushToBacking({ t: "WaitOnTask", id: sql.toYOM(handle) });
    return this;
  }

  waitOnTasks(tasks: Sql[]) {
    this.pushToBacking({ t: "WaitOnTasks", tasks: tasks.map(sql.toYOM) });
    return this;
  }

  waitOnOneOfTasks(tasks: Sql[]) {
    this.pushToBacking({
      t: "WaitOnOneOfTasks",
      tasks: tasks.map(sql.toYOM),
    });
    return this;
  }

  cancelTask(handle: Sql) {
    this.pushToBacking({ t: "CancelTask", id: sql.toYOM(handle) });
    return this;
  }

  /**
   * Writes a query param and updates the URL. `replace` overrides the param's
   * declared `history` (default `"replace"`): true updates the current history
   * entry, false adds one. A plain `setScalar` on a query param is equivalent.
   */
  setQueryParam(param: string, value: Sql, replace?: Sql) {
    this.pushToBacking({
      t: "SetQueryParam",
      param,
      value: sql.toYOM(value),
      replace: replace !== undefined ? sql.toYOM(replace) : undefined,
    });
    return this;
  }

  server(statements: StatementsOrFn<UiServerStatements>) {
    this.pushToBacking({
      t: "Server",
      statements: UiServerStatements.normalizeToArray(statements),
    });
    return this;
  }

  serverWithFiles(
    files: Sql,
    statements: StatementsOrFn<UiServerStatements>,
  ) {
    this.pushToBacking({
      t: "Server",
      statements: UiServerStatements.normalizeToArray(statements),
      transferFiles: files.toYOM(),
    });
    return this;
  }

  tryServer(opts: TryServerProc<StatementsOrFn<this>>) {
    return this.try({
      body: (s) => {
        if (opts.transferFiles) {
          s.serverWithFiles(opts.transferFiles, opts.body);
        } else {
          s.server(opts.body);
        }
      },
      catch: opts.catch,
      errorName: opts.errorName,
      finally: opts.finally,
    });
  }

  get documentBodyElement() {
    return this.element(sql.lit`yolm-document-body`);
  }

  get document() {
    return new DocumentStatements(this[BACKING_ARRAY]);
  }

  element(elementId: Sql | string) {
    return new ElementStatements(
      typeof elementId === "string" ? sql.lit(elementId) : elementId,
      this[BACKING_ARRAY],
    );
  }

  get window() {
    return new WindowStatements(this[BACKING_ARRAY]);
  }

  get location() {
    return new LocationStatements(this[BACKING_ARRAY]);
  }

  get history() {
    return new HistoryStatements(this[BACKING_ARRAY]);
  }

  get event() {
    return new EventStatements(this[BACKING_ARRAY]);
  }

  get clipboard() {
    return new ClipboardStatements(this[BACKING_ARRAY]);
  }

  clearLocalData() {
    this.pushToBacking({ t: "ClearLocalData" });
    return this;
  }

  triggerViewTransition(on: yom.ViewTransitionTiming, type?: Sql) {
    this.pushToBacking({
      t: "TriggerViewTransition",
      on,
      type: sql.toYOM(type),
    });
    return this;
  }

  setDropEffect(dropEffect: Sql) {
    this.pushToBacking({
      t: "SetDropEffect",
      dropEffect: sql.toYOM(dropEffect),
    });
    return this;
  }

  setEffectAllowed(effectAllowed: Sql) {
    this.pushToBacking({
      t: "SetEffectAllowed",
      effectAllowed: sql.toYOM(effectAllowed),
    });
    return this;
  }

  refetch(): this {
    this.increment("global_refetch_key");
    return this;
  }

  readDomFile(fileId: Sql, bodyScalar = "body") {
    this.pushToBacking({
      t: "ReadDomFile",
      bodyScalar,
      fileId: sql.toYOM(fileId),
    });
    return this;
  }

  setCookie(name: Sql, value: Sql, options: CookieOptions = {}) {
    this.pushToBacking({
      t: "SetCookie",
      name: sql.toYOM(name),
      value: sql.toYOM(value),
      domain: options.domain
        ? typeof options.domain === "string"
          ? sql.lit(options.domain).toYOM()
          : sql.toYOM(options.domain)
        : undefined,
      path: options.path
        ? typeof options.path === "string"
          ? sql.lit(options.path).toYOM()
          : sql.toYOM(options.path)
        : undefined,
      expires: options.expires
        ? typeof options.expires === "string"
          ? sql.lit(options.expires).toYOM()
          : sql.toYOM(options.expires)
        : undefined,
      secure: options.secure ? sql.toYOM(options.secure) : undefined,
      httpOnly: options.httpOnly ? sql.toYOM(options.httpOnly) : undefined,
      sameSite: options.sameSite
        ? typeof options.sameSite === "string"
          ? sql.lit(options.sameSite).toYOM()
          : sql.toYOM(options.sameSite)
        : undefined,
    });
    return this;
  }

  removeCookie(name: Sql) {
    this.pushToBacking({
      t: "RemoveCookie",
      name: sql.toYOM(name),
    });
    return this;
  }

  switchKeyboardEvent(branches: Record<string, StatementsOrFn<this>>) {
    const default_ = branches.default;
    if (default_) {
      this.defScalar("switch_keyboard_event_ran_branch", false);
    }
    for (const [keys, handler] of Object.entries(branches)) {
      if (keys === "default") {
        continue;
      }
      this.if(parseKeyMatcher(keys), (s) => {
        if (default_) {
          s.setScalar("switch_keyboard_event_ran_branch", true);
        }
        s.statements(handler);
      });
    }
    if (default_) {
      this.unless(sql`switch_keyboard_event_ran_branch`, (s) => {
        s.statements(default_);
      });
    }
    return this;
  }

  jsCall(jsCallOpts: JsCallOpts) {
    this.pushToBacking({
      t: "JsCall",
      module: jsCallOpts.module,
      exportName: jsCallOpts.exportName,
      handle: sql.toYOM(jsCallOpts.handle),
      args: {
        json: jsCallOpts.argJson ? sql.toYOM(jsCallOpts.argJson) : undefined,
        bytes: jsCallOpts.argBytes
          ? Object.fromEntries(
            Object.entries(jsCallOpts.argBytes).map((
              [key, value],
            ) => [key, sql.toYOM(value)]),
          )
          : undefined,
      },
      result: {
        jsonScalar: jsCallOpts.resultJsonScalar,
        bytesTable: jsCallOpts.resultBytesTable,
      },
    });
    return this;
  }
}

/** Options for {@link ElementStatements.setSelectionRange} on a text input/textarea. */
export interface SetSelectionRangeOpts {
  start: NumericExpr;
  end: NumericExpr;
  direction?: "forward" | "backward" | "none" | Sql;
}

/**
 * DOM operations scoped to a single element, obtained from
 * {@link DomStatements.element}. Covers focus/click/blur, reading
 * geometry and scroll/selection properties into scalars, and scrolling
 * the element into view. Runs in the browser (DOM phase).
 */
export class ElementStatements {
  constructor(
    private elementId: Sql,
    private backing: yom.DomProcStatement[],
  ) {}

  private push(statement: yom.ElementStatementInner) {
    this.backing.push({
      t: "Element",
      elementId: sql.toYOM(this.elementId),
      statement,
    });
  }

  focus() {
    this.push({ t: "Focus" });
  }

  click() {
    this.push({ t: "Click" });
  }

  blur() {
    this.push({ t: "Blur" });
  }

  getScrollHeight(scalar: string) {
    this.push({ t: "GetProperty", property: "scrollHeight", scalar });
  }

  getScrollWidth(scalar: string) {
    this.push({ t: "GetProperty", property: "scrollWidth", scalar });
  }

  getScrollTop(scalar: string) {
    this.push({ t: "GetProperty", property: "scrollTop", scalar });
  }

  getScrollLeft(scalar: string) {
    this.push({ t: "GetProperty", property: "scrollLeft", scalar });
  }

  getSelectionStart(scalar: string) {
    this.push({ t: "GetProperty", property: "selectionStart", scalar });
  }

  getSelectionEnd(scalar: string) {
    this.push({ t: "GetProperty", property: "selectionEnd", scalar });
  }

  getSelectionDirection(scalar: string) {
    this.push({ t: "GetProperty", property: "selectionDirection", scalar });
  }

  matches(selector: Sql, scalar: string) {
    this.push({ t: "Matches", selector: sql.toYOM(selector), scalar });
  }

  getBoundingClientRect(record: string) {
    this.push({ t: "GetBoundingClientRect", record });
  }

  scrollIntoView(opts: ScrollIntoViewOpts) {
    this.push({
      t: "ScrollIntoView",
      behavior: opts.behavior ? sql.toYOM(opts.behavior) : undefined,
      block: opts.block ? sql.toYOM(opts.block) : undefined,
      inline: opts.inline ? sql.toYOM(opts.inline) : undefined,
    });
  }

  scrollTo(opts: {
    left: NumericExpr;
    top: NumericExpr;
    behavior?: "auto" | "instant" | "smooth" | Sql;
  }) {
    this.push({
      t: "ScrollTo",
      left: sql.toYOM(opts.left),
      top: sql.toYOM(opts.top),
      behavior: typeof opts.behavior === "string"
        ? sql.lit(opts.behavior).toYOM()
        : opts.behavior
        ? sql.toYOM(opts.behavior)
        : undefined,
    });
  }

  setSelectionRange(opts: SetSelectionRangeOpts) {
    this.push({
      t: "SetSelectionRange",
      start: sql.toYOM(opts.start),
      end: sql.toYOM(opts.end),
      direction: opts.direction
        ? typeof opts.direction === "string"
          ? sql.lit(opts.direction).toYOM()
          : sql.toYOM(opts.direction)
        : undefined,
    });
  }
}

/**
 * Browser `window` operations, obtained from {@link DomStatements.window}.
 * Focus/print/open/close, reading window/screen geometry into scalars,
 * and scrolling the window. Runs in the DOM phase.
 */
export class WindowStatements {
  constructor(private backing: yom.DomProcStatement[]) {}

  private push(statement: yom.WindowStatementInner) {
    this.backing.push({
      t: "Window",
      statement,
    });
  }

  focus() {
    this.push({ t: "Focus" });
  }

  print() {
    this.push({ t: "Print" });
  }

  open(url: Sql, target?: Sql, features?: Sql) {
    this.push({
      t: "Open",
      url: sql.toYOM(url),
      target: target ? sql.toYOM(target) : undefined,
      features: features ? sql.toYOM(features) : undefined,
    });
  }

  close() {
    this.push({ t: "Close" });
  }

  getScrollY(scalar: string) {
    this.push({ t: "GetProperty", property: "scrollY", scalar });
  }

  getScrollX(scalar: string) {
    this.push({ t: "GetProperty", property: "scrollX", scalar });
  }

  getInnerHeight(scalar: string) {
    this.push({ t: "GetProperty", property: "innerHeight", scalar });
  }

  getInnerWidth(scalar: string) {
    this.push({ t: "GetProperty", property: "innerWidth", scalar });
  }

  getOuterHeight(scalar: string) {
    this.push({ t: "GetProperty", property: "outerHeight", scalar });
  }

  getOuterWidth(scalar: string) {
    this.push({ t: "GetProperty", property: "outerWidth", scalar });
  }

  getScreenLeft(scalar: string) {
    this.push({ t: "GetProperty", property: "screenLeft", scalar });
  }

  getScreenTop(scalar: string) {
    this.push({ t: "GetProperty", property: "screenTop", scalar });
  }

  scrollTo({
    top,
    left,
    behavior,
  }: {
    top: NumericExpr;
    left: NumericExpr;
    behavior?: "auto" | "instant" | "smooth" | Sql;
  }) {
    this.push({
      t: "ScrollTo",
      top: sql.toYOM(top),
      left: sql.toYOM(left),
      behavior: typeof behavior === "string"
        ? sql.lit(behavior).toYOM()
        : behavior
        ? sql.toYOM(behavior)
        : undefined,
    });
  }
}

/**
 * Reads from / writes to the system clipboard, obtained from
 * {@link DomStatements.clipboard}. `readText` writes into a scalar;
 * `writeText` copies a SQL value out. Runs in the DOM phase.
 */
export class ClipboardStatements {
  constructor(private backing: yom.DomProcStatement[]) {}

  readText(scalar: string) {
    this.backing.push({
      t: "Clipboard",
      statement: { t: "ReadText", scalar },
    });
  }

  writeText(text: Sql) {
    this.backing.push({
      t: "Clipboard",
      statement: { t: "WriteText", text: sql.toYOM(text) },
    });
  }
}

/**
 * Browser `window.location` operations (`reload`, `assign`), obtained
 * from {@link DomStatements.location}. Use for hard navigations that
 * leave the SPA; for in-app routing prefer {@link DomStatements.navigate}.
 */
export class LocationStatements {
  constructor(private backing: yom.DomProcStatement[]) {}

  reload() {
    this.backing.push({ t: "LocationReload" });
  }

  assign(url: Sql) {
    this.backing.push({ t: "LocationAssign", url: sql.toYOM(url) });
  }
}

/**
 * Browser history navigation (`go`, `back`, `forward`), obtained from
 * {@link DomStatements.history}. Runs in the DOM phase.
 */
export class HistoryStatements {
  constructor(private backing: yom.DomProcStatement[]) {}

  go(delta: NumericExpr) {
    this.backing.push({ t: "HistoryGo", delta: sql.toYOM(delta) });
  }

  back() {
    this.backing.push({ t: "HistoryGo", delta: "-1" });
  }

  forward() {
    this.backing.push({ t: "HistoryGo", delta: "1" });
  }
}

/**
 * Operations on the DOM event that triggered the current handler,
 * obtained from {@link DomStatements.event}. `stopPropagation` /
 * `preventDefault` plus readers that capture the event target into a
 * scalar. Only valid inside an event-handler procedure.
 */
export class EventStatements {
  constructor(private backing: yom.DomProcStatement[]) {}

  stopPropagation() {
    this.backing.push({ t: "StopPropagation" });
  }

  preventDefault() {
    this.backing.push({ t: "PreventDefault" });
  }

  getTarget(scalar: string) {
    this.backing.push({ t: "GetEventTarget", scalar });
  }

  getCurrentTarget(scalar: string) {
    this.backing.push({ t: "GetEventCurrentTarget", scalar });
  }
}

/**
 * Reads `document`-level properties (e.g. visibility) into scalars,
 * obtained from {@link DomStatements.document}. Runs in the DOM phase.
 */
export class DocumentStatements {
  constructor(private backing: yom.DomProcStatement[]) {}

  getHidden(scalar: string) {
    this.backing.push({ t: "GetDocumentProperty", property: "hidden", scalar });
  }
}

function parseKeyMatcher(key: string): BooleanExpr {
  return sql.or(...key.split(/\s+/).map((k) => parseKeyboardCombo(k)));
}

function parseKeyboardCombo(matcher: string): BooleanExpr {
  const parts = matcher.split("+").map((part) => part.trim());
  const keyPart = parts.pop()!;
  const modifiers = new Set(parts);

  let keyCondition: BooleanExpr;
  if (keyPart.startsWith("regex:")) {
    keyCondition = sql`regex.is_match(event.key, ${sql.lit(keyPart.slice(6))})`;
  } else if (keyPart.startsWith("not_regex:")) {
    keyCondition = sql`not regex.is_match(event.key, ${
      sql.lit(keyPart.slice(10))
    })`;
  } else {
    keyCondition = parseKey(keyPart);
  }

  const conditions: BooleanExpr[] = [keyCondition];

  conditions.push(
    modifiers.has("ctrl") || modifiers.has("control")
      ? sql`event.ctrl_key`
      : sql`not event.ctrl_key`,
  );
  conditions.push(
    modifiers.has("shift") ? sql`event.shift_key` : sql`not event.shift_key`,
  );
  conditions.push(
    modifiers.has("alt") ? sql`event.alt_key` : sql`not event.alt_key`,
  );
  conditions.push(
    modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("super")
      ? sql`event.meta_key`
      : sql`not event.meta_key`,
  );

  return sql.and(...conditions);
}

function parseKey(key: string): BooleanExpr {
  switch (key.toLowerCase()) {
    case "digit":
      return sql`regex.is_match(event.key, '^[0-9]$')`;
    case "alpha":
      return sql`regex.is_match(event.key, '^[a-zA-Z]$')`;
    case "alphanumeric":
      return sql`regex.is_match(event.key, '^[a-zA-Z0-9]$')`;
    case "punctuation":
      return sql`regex.is_match(event.key, '^[!"#$%&''()*+,-./:;<=>?@[\\\\]^_\`{|}~]$')`;
    case "whitespace":
      return sql`regex.is_match(event.key, '^\\s$')`;
    default:
      return sql`lower(event.key) = ${sql.lit(key.toLowerCase())}`;
  }
}

/**
 * Common surface shared by every server-side statements builder that
 * extends `ServerStatementsBase` ({@link UiServerStatements},
 * {@link GeneralServerStatements}, {@link TestStatements},
 * `EndpointStatements`, `StateStatements`).
 *
 * Use this as the parameter type when writing a helper that should
 * work in any server context — e.g. a "log audit row" routine
 * shared between UI service procs and scheduled jobs.
 *
 * @example
 * import type { IServerBaseStatements } from "std/statements";
 *
 * function logAudit(s: IServerBaseStatements, message: Sql) {
 *   s.startTransaction();
 *   s.modify(sql`insert into db.audit_log (message, ts) values (${message}, now())`);
 *   s.commitTransaction();
 * }
 */
export interface IServerBaseStatements extends IStatementsBase {
  /** Reject expected invalid input without recording an execution failure. */
  validationError(message: Sql, description?: Sql): this;
  validationErrorIf(
    condition: BooleanExpr,
    message: Sql,
    description?: Sql,
  ): this;
  validationErrorUnless(
    condition: BooleanExpr,
    message: Sql,
    description?: Sql,
  ): this;
  setContext(context: Sql): this;
  /**
       Sleeps for the specified number of milliseconds, then continues the procedure.
       */
  sleep(ms: NumericExpr): this;
  /**
       Starts a transaction. This must always be called before any changes to the database.

       Current transaction behavior is that all transactions are serialized. This means the content
       of a transaction should be as fast as possible (avoid sleeps and requests), othrwise you will
       be blocking other transactions from starting..
       */
  startTransaction(): this;
  /**
       Commits the current transaction. This must be called after the startTransaction.
       */
  commitTransaction(txScalar?: string): this;
  /**
       Rolls back the current transaction. Nullifying all changes to the database.

       This must be called after the startTransaction.
       */
  rollbackTransaction(): this;
  /**
       Rolls back the current transaction if we are in a transaction.
       */
  rollbackIfInTransaction(): this;
  /**
       Modifies the database in such a way to undo the effect of the transaction with the given id.

       For example, lets say transaction 1 creates a contact, updates a note and deletes a task.
       Calling undoTx(1) will change the database to delete the createed contact, update the note to its previous value
       and restore the deleted task.
       */
  undoTx(txId: NumericExpr): this;
  /**
       Undoes every transaction ID returned by the query as one atomic change.

       This must be the first operation after startTransaction(). The query must
       return one bigint column named tx_id.
       */
  undoTransactions(query: Sql): this;
  /**
       Analyzes whether the transaction IDs returned by the query can currently
       be undone. This must run outside a transaction and defines resultTable.
       */
  analyzeUndoTransactions(query: Sql, resultTable: string): this;
  /**
       Restores deleted records for the provided table.

       In Yolm as we have a transaction log, we can restore deleted records to their previous state.

       The query must return a column with the id of the records to restore.
       */
  restore(table: string, query: Sql): this;
  /**
       Allows you to construct a single sql insert, update, delete or merge statement at runtime
       and execute it.

       ONLY USE THIS IF YOU CANNOT USE A NORMAL STATEMENT TO DO THE SAME THING, AS IF NOT DONE CORRECTLY
       YOU CAN RUN THE RISK OF SQL INJECTION.

       We mitigate this risk by only allowing one statement at a time, but it is up to you to make it secure.

       This is for the cases like a database admin screen.
       */
  dynamicModify(sql: Sql): this;
  /**
       Allows you to construct a single sql query at runtime and execute it, getting the results as a csv.

       ONLY USE THIS IF YOU CANNOT USE A NORMAL STATEMENT TO DO THE SAME THING, AS IF NOT DONE CORRECTLY
       YOU CAN RUN THE RISK OF SQL INJECTION.

       We mitigate this risk by only allowing one query at a time and disallowing any write from the query,
       but it is up to you to make it secure.

       This is useful for datagrids, or other dynamic uis.
       */
  /** @deprecated Pass `{ defScalar, ...opts }` as the second argument instead. */
  dynamicQueryToCsv(
    query: Sql,
    scalar: string,
    opts?: DynamicQueryToCsvOpts,
  ): this;
  dynamicQueryToCsv(
    query: Sql,
    opts: DynamicQueryToCsvWithDefScalarOpts,
  ): this;
  dynamicQueryToCsv(
    query: Sql,
    opts: DynamicQueryToCsvWithSetScalarOpts,
  ): this;
  dynamicQueryToJson(
    query: Sql,
    opts: DynamicQueryToJsonWithDefScalarOpts,
  ): this;
  dynamicQueryToJson(
    query: Sql,
    opts: DynamicQueryToJsonWithSetScalarOpts,
  ): this;
  /**
       Validates the provided sql query and sets the error message on the provided record if there are any errors.
       */
  validateDynamicQuery(
    query: Sql,
    errorRecord: string,
    opts?: DynamicQueryPolicyOpts,
  ): this;
  /**
       Allows you to construct a single sql query at runtime and execute it.

       ONLY USE THIS IF YOU CANNOT USE A NORMAL STATEMENT TO DO THE SAME THING, AS IF NOT DONE CORRECTLY
       YOU CAN RUN THE RISK OF SQL INJECTION.

       We mitigate this risk by only allowing one query at a time and disallowing any write from the query,
       but it is up to you to make it secure.

       This is useful for datagrids, or other dynamic uis.
       */
  dynamicQuery(opts: DynamicQueryOpts): this;
  /**
       Allows you to construct a single sql query at runtime and return its explain plan text.
       */
  dynamicExplainQuery(opts: DynamicExplainQueryOpts): this;
  /**
       Runs a search against the database.
       */
  search(opts: SearchOpts): this;
  /**
       Sends an http request with the provided options.
       */
  request(info: AnyRequestOpts): this;
  /**
       Sends a platform service request (email/sms/ai).
       */
  serviceRequest(opts: ServiceRequestOpts): this;
  /**
       Sends a file to a remote SFTP server.
       */
  sftpSend(opts: SftpSendOpts): this;
  callStoredProcedure(
    name: string,
    opts?: CallStoredProcedureOpts,
  ): this;
  /**
       Receives a file from a remote SFTP server.
       */
  sftpReceive(opts: SftpReceiveOpts): this;
  /**
       Provider-agnostic email helper that compiles to ServiceRequest.
       */
  sendEmail(opts: SendEmailOpts): this;
  /**
       Sends one marketing message to multiple recipients through the
       platform-managed bulk email service.
       */
  sendBulkEmail(opts: SendBulkEmailOpts): this;
  /**
       Provider-agnostic SMS helper that compiles to ServiceRequest.
       */
  sendSms(opts: SendSmsOpts): this;
  sendWebPush(opts: SendWebPushOpts): this;
  /**
       Provider-agnostic AI generation helper that compiles to ServiceRequest.
       */
  aiGenerate(opts: AiGenerateOpts): this;
  /**
       Lists configured AI models without contacting providers.
       */
  aiListModels(opts: AiListModelsOpts): this;
  removeFiles(query: Sql): this;
  /**
       Creates a new blob with the given content.

       Blobs are how we manage content too big to put into the database, use it for large files, images, etc.

       @deprecated Pass `{ defHashScalar }` as the second argument instead.
       */
  createBlob(content: Sql, hashScalar: string): this;
  createBlob(content: Sql, opts: { defHashScalar: string }): this;
  createBlob(content: Sql, opts: { setHashScalar: string }): this;
  /**
       Reads the content of the blob with the given uuid.
       @deprecated Pass `{ defContentScalar }` as the second argument instead.
       */
  readBlob(hash: Sql, contentScalar: string): this;
  readBlob(hash: Sql, opts: { defContentScalar: string }): this;
  readBlob(hash: Sql, opts: { setContentScalar: string }): this;
  /**
       Removes the blob with the given uuid.
       */
  removeBlob(hash: Sql): this;
  /**
       Push a procedure-side bytes scalar into the per-RunJavascript byte
       scratch shared with the V8 isolate; writes the new BigInt id into a scalar.

       Use the returned id to hand bytes to JS without round-tripping through
       the JSON tool channel — typical pattern: read a blob with `readBlob`,
       call `setJsBytes`, then return `{ bytesId }` to the script which calls
       `await yolm.bytes.get(bytesId)`.
       */
  setJsBytes(bytes: Sql, opts: { defIdScalar: string }): this;
  setJsBytes(bytes: Sql, opts: { setIdScalar: string }): this;
  /**
       Look up bytes in the JS scratch by id (BigInt) and write them into a
       procedure-side bytes scalar — typically immediately fed to `createBlob`
       or `modify`.

       The id comes from a prior `setJsBytes` or from `yolm.bytes.set` on the
       JS side. Unknown ids resolve to an empty bytes value with a warning.
       */
  getJsBytes(id: Sql, opts: { defBytesScalar: string }): this;
  getJsBytes(id: Sql, opts: { setBytesScalar: string }): this;
  /**
       Resizes an image to the given width and height.

       The image type is the mime type of the image, sql.g. image/jpeg.
       The resize type is the type of resize, crop, contain, cover, scale_down.
       */
  resizeImage(opts: ResizeImageOpts): this;
  renderTemplate(opts: RenderTemplateOpts): this;
  queryToExcel(opts: QueryToExcelOpts): this;
  createZip(opts: CreateZipOpts): this;
  renderMjml(opts: RenderMjmlOpts): this;
  uploadPublicAsset(opts: UploadPublicAssetOpts): this;
  renderTypst(opts: RenderTypstOpts): this;
  dev: StudioApi;
  studio: StudioApi;
}

interface ResizeImageOpts {
  inBytes: Sql;
  imageType: Sql;
  resizeType: Sql;
  width: NumericExpr;
  height: NumericExpr;
  /** Declares a new scalar receiving the resized image bytes. */
  defOutBytesScalar?: string;
  /** Assigns the resized image bytes into an existing scalar in scope. */
  setOutBytesScalar?: string;
  /** @deprecated Use `defOutBytesScalar` instead. */
  outBytesScalar?: string;
}

/** Options for `s.renderTemplate(...)` — expands a text/HTML template against a scope. */
export interface RenderTemplateOpts {
  template: Sql;
  /** Variables exposed to the template, mapping template name to in-scope scalar/record. */
  scope: Record<string, string>;
  /** Allow the template to run database queries. */
  hasDbAccess?: boolean;
  /** HTML-escape interpolated values. */
  htmlEscaped?: boolean;
  /** Declares a new scalar receiving the rendered template output. */
  defOutputScalar?: string;
  /** Assigns the rendered template output into an existing scalar in scope. */
  setOutputScalar?: string;
  /** @deprecated Use `defOutputScalar` instead. */
  outputScalar?: string;
}

/** Per-column formatting for a {@link QueryToExcelSheet} (number format, width, header text). */
export interface QueryToExcelColumn {
  format?: string;
  width?: number;
  header?: string;
}

/** A footer row in a {@link QueryToExcelSheet} that aggregates named columns. */
export interface QueryToExcelFooterRow {
  label?: string;
  /** Aggregation applied per result column. */
  columns: Record<string, "sum" | "average" | "count" | "min" | "max">;
}

/** One worksheet generated from a query for an Excel scalar or download. */
export interface QueryToExcelSheet {
  name?: string;
  /** SQL query whose rows fill the sheet. */
  query: string;
  title?: string;
  /** Per-column formatting keyed by result column name. */
  columns?: Record<string, QueryToExcelColumn>;
  footer?: QueryToExcelFooterRow[];
  freezeHeaderRow?: boolean;
  /**
   * Disable the automatic result-row cap for this sheet. The export still
   * uses the platform's standard dynamic-query execution budget.
   */
  skipAutoRowCap?: boolean;
}

/** Options for `s.queryToExcel(...)` — renders query results to an XLSX workbook. */
export interface QueryToExcelOpts {
  sheets: QueryToExcelSheet[];
  /** Encrypt the workbook with this password. */
  password?: string;
  /** Declares a new scalar receiving the generated XLSX bytes. */
  defOutputScalar?: string;
  /** Assigns the generated XLSX bytes into an existing scalar in scope. */
  setOutputScalar?: string;
  /** @deprecated Use `defOutputScalar` instead. */
  outputScalar?: string;
}

/** Options for a streamed XLSX response generated by `s.downloadQueryExcel(...)`. */
export interface DownloadQueryExcelOpts {
  sheets: QueryToExcelSheet[];
  /** Server statements that declare temporary data used by the sheet queries. */
  setup?: UiServerStatementsOrFn;
}

/** Whether {@link CreateZipOpts} entries reference stored blobs by hash or carry inline bytes. */
export type CreateZipSourceType = "BlobHash" | "Bytes";

/** Compression method for a generated zip (`Store` = none, `Deflate` = standard). */
export type ZipCompression = "Store" | "Deflate";

/** Options for `s.createZip(...)` — builds a zip archive from query rows. */
export interface CreateZipOpts {
  /** Query returning one row per zip entry (filename plus blob hash or bytes). */
  query: string;
  sourceType: CreateZipSourceType;
  compression?: ZipCompression;
  /** Declares a new scalar receiving the generated zip bytes. */
  defOutputScalar?: string;
  /** Assigns the generated zip bytes into an existing scalar in scope. */
  setOutputScalar?: string;
  /** @deprecated Use `defOutputScalar` instead. */
  outputScalar?: string;
}

/** Options for `s.renderMjml(...)` — compiles MJML markup into responsive email HTML. */
export interface RenderMjmlOpts {
  mjml: Sql;
  /** Declares a new scalar receiving the rendered HTML. */
  defOutputScalar?: string;
  /** Assigns the rendered HTML into an existing scalar in scope. */
  setOutputScalar?: string;
  /** @deprecated Use `defOutputScalar` instead. */
  outputScalar?: string;
}

/** Options for `s.uploadPublicAsset(...)` — stores bytes as a publicly servable asset. */
export interface UploadPublicAssetOpts {
  content: Sql;
  contentType: Sql;
  /** Declares a new scalar receiving the asset hash. */
  defHashScalar?: string;
  /** Assigns the asset hash into an existing scalar in scope. */
  setHashScalar?: string;
  /** @deprecated Use `defHashScalar` instead. */
  hashScalar?: string;
}

/** A named auxiliary file (font, image, …) made available to a Typst render. */
export interface RenderTypstAsset {
  name: string;
  data: Sql;
}

/** PDF output settings for a Typst render (PDF/A standards, tagging, page subset). */
export interface TypstPdfOptions {
  standards?: string[];
  tagged?: boolean;
  pageRanges?: string;
}

/** Options for `s.renderTypst(...)` — renders a Typst template with data to PDF. */
export interface RenderTypstOpts {
  template: Sql;
  /** JSON data bound into the template. */
  data: Sql;
  outputFormat: "pdf" | Sql;
  /** Declares a new scalar receiving the rendered PDF bytes. */
  defPdfOutputScalar?: string;
  /** Assigns the rendered PDF bytes into an existing scalar in scope. */
  setPdfOutputScalar?: string;
  /** @deprecated Use `defPdfOutputScalar` instead. */
  pdfOutputScalar?: string;
  assets?: RenderTypstAsset[];
  pdfOptions?: TypstPdfOptions | Sql;
}

declare const procedureToolRefBrand: unique symbol;

/**
 * Opaque reference minted only by `System.toolEntryProcedure`. Its private
 * brand prevents a normal TypeScript caller from pairing an arbitrary stored
 * procedure name with a JavaScript tool registration.
 */
export interface ProcedureToolRef {
  readonly procedure: string;
  readonly [procedureToolRefBrand]: void;
}

export type ProcedureToolInputBinding =
  | { kind: "normalizedArguments" }
  | { kind: "trustedHostScalar"; scalar: string }
  | { kind: "policyOutput"; scalar: string };

export interface ProcedureToolStateOutput {
  outputScalar: string;
  stateScalar: string;
}

export interface ProcedureJavascriptTool {
  name: string;
  timeoutMs?: number;
  implementation: ProcedureToolRef;
  inputBindings: Record<string, ProcedureToolInputBinding>;
  stateOutputs?: ProcedureToolStateOutput[];
  policyMetadataJson: string;
  /** Procedure-backed tools never carry an inline JavaScript body. */
  statements?: never;
}

export type JavascriptTool = ProcedureJavascriptTool;

export type ProcedureToolPolicyInputBinding =
  | { kind: "rawArguments" }
  | { kind: "toolMetadata" }
  | { kind: "trustedHostScalar"; scalar: string };

/**
 * Common, read-only application policy required by each procedure-backed
 * JavaScript tool catalog. Native validation verifies its interface/effects.
 */
export interface ProcedureToolPolicy {
  procedure: string;
  inputBindings: Record<string, ProcedureToolPolicyInputBinding>;
  outputBindings: Record<string, string>;
}

/** Options for running a sandboxed JavaScript snippet in a V8 isolate from a server proc. */
export interface RunJavascriptOpts {
  script: Sql;
  /** Server procedures the script may invoke as named tools (the JS-to-Yolm bridge). */
  tools?: JavascriptTool[];
  /** Required when the script exposes tools. */
  procedureToolPolicy?: ProcedureToolPolicy;
  /** Scalar receiving the script's return value (JSON). */
  resultScalar?: string;
  /** Scalar receiving captured `console` output. */
  consoleOutput?: string;
  /**
   * Optional Sql expression that evaluates to a JSON array of strings naming
   * the bundled libs the script may `await import(...)`. Omit to allow every
   * bundled lib (back-compat); pass `sql\`json_build_array()\`` to deny all
   * imports; pass `sql\`json_build_array('mammoth')\`` to allow only mammoth.
   */
  includeLibs?: Sql;
}

/**
 * Input/output bindings for `s.callStoredProcedure(...)`. Each map keys the
 * stored procedure's parameter name to a caller-side scalar/record/table:
 * `input*` pass values in, `output*` receive results back.
 */
export interface CallStoredProcedureOpts {
  /** Skip JIT prewarming for a bounded static dispatcher child call. */
  prewarm?: "never";
  inputScalars?: Record<string, AnyExpr>;
  inputRecords?: Record<string, string>;
  inputTables?: Record<string, string>;
  outputScalars?: Record<string, string>;
  outputRecords?: Record<string, string>;
  outputTables?: Record<string, string>;
}

function callStoredProcedureStatement(
  name: string,
  opts: CallStoredProcedureOpts,
): yom.CallStoredProcedureStatement {
  return {
    t: "CallStoredProcedure",
    name,
    ...(opts.prewarm === undefined ? {} : { prewarm: opts.prewarm }),
    inputScalars: Object.fromEntries(
      Object.entries(opts.inputScalars ?? {}).map(([key, value]) => [
        key,
        sql.toYOM(value),
      ]),
    ),
    inputRecords: opts.inputRecords ?? {},
    inputTables: opts.inputTables ?? {},
    outputScalars: opts.outputScalars ?? {},
    outputRecords: opts.outputRecords ?? {},
    outputTables: opts.outputTables ?? {},
  };
}

/**
 * Shared base for every server-side statement builder. Implements the
 * full {@link IServerBaseStatements} surface (transactions, blobs, HTTP /
 * service requests, tasks, dynamic queries, file rendering, …) on top of
 * {@link StatementsBase}. Concrete subclasses ({@link UiServerStatements},
 * {@link GeneralServerStatements}, {@link EndpointStatements},
 * {@link StateStatements}, {@link TestStatements}) add context-specific
 * statements. Abstract — never instantiated directly.
 */
export abstract class ServerStatementsBase<Statement extends object>
  extends StatementsBase<Statement | yom.ValidationErrorStatement>
  implements IServerBaseStatements {
  /**
   * Expected input/business-rule rejection. Ordinary throwError and logError
   * remain reportable. UI callers receive the existing thrown_error response.
   * Requires the validation-error-capable runtime before model deployment.
   */
  validationError(message: Sql, description?: Sql): this {
    this.pushToBacking({
      t: "ValidationError",
      message: sql.toYOM(message),
      description: description === undefined
        ? undefined
        : sql.toYOM(description),
    });
    return this;
  }

  validationErrorIf(
    condition: BooleanExpr,
    message: Sql,
    description?: Sql,
  ): this {
    return this.if(condition, (s) => s.validationError(message, description));
  }

  validationErrorUnless(
    condition: BooleanExpr,
    message: Sql,
    description?: Sql,
  ): this {
    return this.unless(
      condition,
      (s) => s.validationError(message, description),
    );
  }

  /**
   * Set the ambient JSON request context (the SetContext statement). Subsequent
   * queries — including whitelisted views — can read it via the
   * `current_context()` SQL function, so views can scope themselves to a
   * tenant/record without the id being threaded through every query. Pass a
   * json expression; a null clears the scope.
   */
  setContext(context: Sql) {
    this.pushToBacking({
      t: "SetContext",
      context: sql.toYOM(context),
    } as yom.GeneralServerStatement as any);
    return this;
  }
  sleep(ms: NumericExpr): this {
    this.pushToBacking({
      t: "Sleep",
      ms: sql.toYOM(ms),
    } as yom.GeneralServerStatement as any);
    return this;
  }

  startTransaction(): this {
    this.pushToBacking({
      t: "StartTransaction",
    } as yom.GeneralServerStatement as any);
    return this;
  }

  commitTransaction(txScalar?: string): this {
    this.pushToBacking({
      t: "CommitTransaction",
      txScalar,
    } as yom.GeneralServerStatement as any);
    return this;
  }

  rollbackTransaction(): this {
    this.pushToBacking({
      t: "RollbackTransaction",
    } as yom.GeneralServerStatement as any);
    return this;
  }

  rollbackIfInTransaction(): this {
    return this.if(sql`info.current_tx() is not null`, (s) => {
      s.rollbackTransaction();
    });
  }

  undoTx(txId: NumericExpr): this {
    this.pushToBacking({
      t: "UndoTx",
      tx: sql.toYOM(txId),
    } as yom.GeneralServerStatement as any);
    return this;
  }

  undoTransactions(query: Sql): this {
    this.pushToBacking({
      t: "UndoTransactions",
      query: query.toYOM(),
    } as yom.GeneralServerStatement as any);
    return this;
  }

  analyzeUndoTransactions(query: Sql, resultTable: string): this {
    this.pushToBacking({
      t: "AnalyzeUndoTransactions",
      query: query.toYOM(),
      resultTable,
    } as yom.GeneralServerStatement as any);
    return this;
  }

  restore(table: string, query: Sql): this {
    this.pushToBacking({
      t: "Restore",
      table,
      query: query.toYOM(),
    } as yom.GeneralServerStatement as any);
    return this;
  }

  dynamicModify(e: Sql) {
    this.pushToBacking({
      t: "DynamicModify",
      sql: sql.toYOM(e),
    } as yom.GeneralServerStatement as any);
    return this;
  }

  dynamicQuery(opts: DynamicQueryOpts): this {
    if (opts.rowCap !== undefined && opts.skipAutoRowCap === true) {
      throw new Error(
        "dynamicQuery rowCap cannot be combined with true skipAutoRowCap",
      );
    }
    const resultTable = resolveDefSet(
      "resultTable",
      opts.defResultTable,
      opts.setResultTable,
      opts.resultTable,
    );
    if (
      resultTable.defValue === undefined && resultTable.setValue === undefined
    ) {
      throw new Error("dynamicQuery requires defResultTable or setResultTable");
    }
    const columnMetaTable = resolveDefSet(
      "columnMetaTable",
      opts.defColumnMetaTable,
      opts.setColumnMetaTable,
      opts.columnMetaTable,
    );
    const metricsScalar = resolveDefSet(
      "metricsScalar",
      opts.defMetricsScalar,
      opts.setMetricsScalar,
      opts.metricsScalar,
    );
    const hasMoreScalar = resolveDefSet(
      "hasMoreScalar",
      opts.defHasMoreScalar,
      opts.setHasMoreScalar,
      undefined,
    );
    this.pushToBacking({
      t: "DynamicQuery",
      columnCount: opts.columnCount,
      query: sql.toYOM(opts.query),
      resultTable: resultTable.defValue,
      setResultTable: resultTable.setValue,
      columnMetaTable: columnMetaTable.defValue,
      setColumnMetaTable: columnMetaTable.setValue,
      skipAutoRowCap: opts.skipAutoRowCap
        ? sql.toYOM(opts.skipAutoRowCap)
        : undefined,
      rowCap: opts.rowCap !== undefined ? sql.toYOM(opts.rowCap) : undefined,
      hasMoreScalar: hasMoreScalar.defValue,
      setHasMoreScalar: hasMoreScalar.setValue,
      metricsScalar: metricsScalar.defValue,
      setMetricsScalar: metricsScalar.setValue,
      tableWhitelist: opts.tableWhitelist
        ? sql.toYOM(opts.tableWhitelist)
        : undefined,
      tableBlacklist: opts.tableBlacklist
        ? sql.toYOM(opts.tableBlacklist)
        : undefined,
      viewWhitelist: opts.viewWhitelist
        ? sql.toYOM(opts.viewWhitelist)
        : undefined,
      viewBlacklist: opts.viewBlacklist
        ? sql.toYOM(opts.viewBlacklist)
        : undefined,
      fieldWhitelist: opts.fieldWhitelist
        ? sql.toYOM(opts.fieldWhitelist)
        : undefined,
      fieldBlacklist: opts.fieldBlacklist
        ? sql.toYOM(opts.fieldBlacklist)
        : undefined,
      accessibleTableScopes: opts.accessibleTableScopes,
      tableScopeWhitelist: opts.tableScopeWhitelist,
      tableScopeBlacklist: opts.tableScopeBlacklist,
    } as yom.GeneralServerStatement as any);
    return this;
  }

  dynamicExplainQuery(opts: DynamicExplainQueryOpts): this {
    const resultScalar = resolveDefSet(
      "resultScalar",
      opts.defResultScalar,
      opts.setResultScalar,
      opts.resultScalar,
    );
    if (
      resultScalar.defValue === undefined && resultScalar.setValue === undefined
    ) {
      throw new Error(
        "dynamicExplainQuery requires defResultScalar or setResultScalar",
      );
    }
    this.pushToBacking({
      t: "DynamicExplainQuery",
      query: sql.toYOM(opts.query),
      resultScalar: resultScalar.defValue,
      setResultScalar: resultScalar.setValue,
      tableWhitelist: opts.tableWhitelist
        ? sql.toYOM(opts.tableWhitelist)
        : undefined,
      tableBlacklist: opts.tableBlacklist
        ? sql.toYOM(opts.tableBlacklist)
        : undefined,
      viewWhitelist: opts.viewWhitelist
        ? sql.toYOM(opts.viewWhitelist)
        : undefined,
      viewBlacklist: opts.viewBlacklist
        ? sql.toYOM(opts.viewBlacklist)
        : undefined,
      fieldWhitelist: opts.fieldWhitelist
        ? sql.toYOM(opts.fieldWhitelist)
        : undefined,
      fieldBlacklist: opts.fieldBlacklist
        ? sql.toYOM(opts.fieldBlacklist)
        : undefined,
    } as yom.GeneralServerStatement as any);
    return this;
  }

  dynamicQueryToCsv(
    query: Sql,
    scalarOrOpts:
      | string
      | DynamicQueryToCsvWithDefScalarOpts
      | DynamicQueryToCsvWithSetScalarOpts,
    opts?: DynamicQueryToCsvOpts,
  ): this {
    let scalarValue: string | undefined;
    let setScalarValue: string | undefined;
    let resolvedOpts: DynamicQueryToCsvOpts | undefined;
    if (typeof scalarOrOpts === "string") {
      scalarValue = scalarOrOpts;
      resolvedOpts = opts;
    } else if ("defScalar" in scalarOrOpts) {
      scalarValue = scalarOrOpts.defScalar;
      resolvedOpts = scalarOrOpts;
    } else {
      setScalarValue = scalarOrOpts.setScalar;
      resolvedOpts = scalarOrOpts;
    }
    if (
      resolvedOpts?.rowCap !== undefined &&
      resolvedOpts.skipAutoRowCap === true
    ) {
      throw new Error(
        "dynamicQueryToCsv rowCap cannot be combined with true skipAutoRowCap",
      );
    }
    const hasMoreScalar = resolveDefSet(
      "hasMoreScalar",
      resolvedOpts?.defHasMoreScalar,
      resolvedOpts?.setHasMoreScalar,
      undefined,
    );
    this.pushToBacking({
      t: "DynamicQueryToCsv",
      query: sql.toYOM(query),
      scalar: scalarValue,
      setScalar: setScalarValue,
      skipAutoRowCap: resolvedOpts?.skipAutoRowCap
        ? sql.toYOM(resolvedOpts.skipAutoRowCap)
        : undefined,
      rowCap: resolvedOpts?.rowCap !== undefined
        ? sql.toYOM(resolvedOpts.rowCap)
        : undefined,
      hasMoreScalar: hasMoreScalar.defValue,
      setHasMoreScalar: hasMoreScalar.setValue,
      tableWhitelist: resolvedOpts?.tableWhitelist
        ? sql.toYOM(resolvedOpts.tableWhitelist)
        : undefined,
      tableBlacklist: resolvedOpts?.tableBlacklist
        ? sql.toYOM(resolvedOpts.tableBlacklist)
        : undefined,
      viewWhitelist: resolvedOpts?.viewWhitelist
        ? sql.toYOM(resolvedOpts.viewWhitelist)
        : undefined,
      viewBlacklist: resolvedOpts?.viewBlacklist
        ? sql.toYOM(resolvedOpts.viewBlacklist)
        : undefined,
      fieldWhitelist: resolvedOpts?.fieldWhitelist
        ? sql.toYOM(resolvedOpts.fieldWhitelist)
        : undefined,
      fieldBlacklist: resolvedOpts?.fieldBlacklist
        ? sql.toYOM(resolvedOpts.fieldBlacklist)
        : undefined,
      accessibleTableScopes: resolvedOpts?.accessibleTableScopes,
      tableScopeWhitelist: resolvedOpts?.tableScopeWhitelist,
      tableScopeBlacklist: resolvedOpts?.tableScopeBlacklist,
    } as yom.GeneralServerStatement as any);
    return this;
  }

  dynamicQueryToJson(
    query: Sql,
    opts:
      | DynamicQueryToJsonWithDefScalarOpts
      | DynamicQueryToJsonWithSetScalarOpts,
  ): this {
    if (opts.rowCap !== undefined && opts.skipAutoRowCap === true) {
      throw new Error(
        "dynamicQueryToJson rowCap cannot be combined with true skipAutoRowCap",
      );
    }
    const scalar = "defScalar" in opts
      ? { defValue: opts.defScalar, setValue: undefined }
      : { defValue: undefined, setValue: opts.setScalar };
    const hasMoreScalar = resolveDefSet(
      "hasMoreScalar",
      opts.defHasMoreScalar,
      opts.setHasMoreScalar,
      undefined,
    );
    this.pushToBacking({
      t: "DynamicQueryToJson",
      query: sql.toYOM(query),
      scalar: scalar.defValue,
      setScalar: scalar.setValue,
      skipAutoRowCap: opts.skipAutoRowCap
        ? sql.toYOM(opts.skipAutoRowCap)
        : undefined,
      rowCap: opts.rowCap !== undefined ? sql.toYOM(opts.rowCap) : undefined,
      hasMoreScalar: hasMoreScalar.defValue,
      setHasMoreScalar: hasMoreScalar.setValue,
      tableWhitelist: opts.tableWhitelist
        ? sql.toYOM(opts.tableWhitelist)
        : undefined,
      tableBlacklist: opts.tableBlacklist
        ? sql.toYOM(opts.tableBlacklist)
        : undefined,
      viewWhitelist: opts.viewWhitelist
        ? sql.toYOM(opts.viewWhitelist)
        : undefined,
      viewBlacklist: opts.viewBlacklist
        ? sql.toYOM(opts.viewBlacklist)
        : undefined,
      fieldWhitelist: opts.fieldWhitelist
        ? sql.toYOM(opts.fieldWhitelist)
        : undefined,
      fieldBlacklist: opts.fieldBlacklist
        ? sql.toYOM(opts.fieldBlacklist)
        : undefined,
      accessibleTableScopes: opts.accessibleTableScopes,
      tableScopeWhitelist: opts.tableScopeWhitelist,
      tableScopeBlacklist: opts.tableScopeBlacklist,
    } as yom.GeneralServerStatement as any);
    return this;
  }

  validateDynamicQuery(
    query: Sql,
    errorRecord: string,
    opts: DynamicQueryPolicyOpts = {},
  ): this {
    this.pushToBacking({
      t: "ValidateDynamicQuery",
      query: sql.toYOM(query),
      errorRecord,
      tableWhitelist: opts.tableWhitelist
        ? sql.toYOM(opts.tableWhitelist)
        : undefined,
      tableBlacklist: opts.tableBlacklist
        ? sql.toYOM(opts.tableBlacklist)
        : undefined,
      viewWhitelist: opts.viewWhitelist
        ? sql.toYOM(opts.viewWhitelist)
        : undefined,
      viewBlacklist: opts.viewBlacklist
        ? sql.toYOM(opts.viewBlacklist)
        : undefined,
      fieldWhitelist: opts.fieldWhitelist
        ? sql.toYOM(opts.fieldWhitelist)
        : undefined,
      fieldBlacklist: opts.fieldBlacklist
        ? sql.toYOM(opts.fieldBlacklist)
        : undefined,
    } as yom.GeneralServerStatement as any);
    return this;
  }

  search(opts: SearchOpts): this {
    this.pushToBacking(searchOptsToStatement(opts) as any);
    return this;
  }

  request(info: AnyRequestOpts): this {
    this.pushToBacking(requestOptsToStatement(info) as any);
    return this;
  }

  serviceRequest(opts: ServiceRequestOpts): this {
    const usage = resolveDefSet(
      "usageScalar",
      opts.defUsageScalar,
      opts.setUsageScalar,
      undefined,
    );
    const resultJson = resolveDefSet(
      "resultJsonScalar",
      opts.defResultJsonScalar,
      opts.setResultJsonScalar,
      opts.resultJsonScalar,
    );
    if (
      resultJson.defValue === undefined && resultJson.setValue === undefined
    ) {
      throw new Error(
        "serviceRequest requires defResultJsonScalar or setResultJsonScalar",
      );
    }
    const errorJson = resolveDefSet(
      "errorJsonScalar",
      opts.defErrorJsonScalar,
      opts.setErrorJsonScalar,
      opts.errorJsonScalar,
    );
    if (errorJson.defValue === undefined && errorJson.setValue === undefined) {
      throw new Error(
        "serviceRequest requires defErrorJsonScalar or setErrorJsonScalar",
      );
    }
    const resultBytes = resolveDefSet(
      "resultBytesScalar",
      opts.defResultBytesScalar,
      opts.setResultBytesScalar,
      opts.resultBytesScalar,
    );
    const serviceType = sql.toYOM(opts.serviceType);
    const operation = sql.toYOM(opts.operation);
    const requestJson = sql.toYOM(opts.requestJson);
    const requestBytes = opts.requestBytes
      ? sql.toYOM(opts.requestBytes)
      : undefined;
    const optIn = opts.optIn !== undefined ? sql.toYOM(opts.optIn) : undefined;
    const statement: yom.ServiceRequestStatement = {
      t: "ServiceRequest",
      usageContext: opts.usageContext === undefined
        ? undefined
        : sql.toYOM(opts.usageContext),
      usageScalar: usage.defValue,
      setUsageScalar: usage.setValue,
      serviceType,
      operation,
      requestJson,
      resultJsonScalar: resultJson.defValue,
      setResultJsonScalar: resultJson.setValue,
      errorJsonScalar: errorJson.defValue,
      setErrorJsonScalar: errorJson.setValue,
    };
    if (optIn !== undefined) {
      statement.optIn = optIn;
    }
    if (requestBytes !== undefined) {
      statement.requestBytes = requestBytes;
    }
    if (resultBytes.defValue !== undefined) {
      statement.resultBytesScalar = resultBytes.defValue;
    }
    if (resultBytes.setValue !== undefined) {
      statement.setResultBytesScalar = resultBytes.setValue;
    }
    if (opts.mockProcedure) {
      statement.mockProcedure = EndpointStatements.normalizeToArray(
        opts.mockProcedure,
      );
    }
    this.pushToBacking(statement as any);
    return this;
  }

  sftpSend(opts: SftpSendOpts): this {
    const resultJson = resolveDefSet(
      "resultJsonScalar",
      opts.defResultJsonScalar,
      opts.setResultJsonScalar,
      opts.resultJsonScalar,
    );
    if (
      resultJson.defValue === undefined && resultJson.setValue === undefined
    ) {
      throw new Error(
        "sftpSend requires defResultJsonScalar or setResultJsonScalar",
      );
    }
    const errorJson = resolveDefSet(
      "errorJsonScalar",
      opts.defErrorJsonScalar,
      opts.setErrorJsonScalar,
      opts.errorJsonScalar,
    );
    if (errorJson.defValue === undefined && errorJson.setValue === undefined) {
      throw new Error(
        "sftpSend requires defErrorJsonScalar or setErrorJsonScalar",
      );
    }
    const source: yom.SftpSendSource = opts.source.type === "Bytes"
      ? { type: "Bytes", bytes: sql.toYOM(opts.source.bytes) }
      : { type: "BlobHash", blobHash: sql.toYOM(opts.source.blobHash) };
    const statement: yom.SftpSendStatement = {
      t: "SftpSend",
      connection: sftpConnectionOptsToYom(opts.connection),
      remotePath: sql.toYOM(opts.remotePath),
      source,
      resultJsonScalar: resultJson.defValue,
      setResultJsonScalar: resultJson.setValue,
      errorJsonScalar: errorJson.defValue,
      setErrorJsonScalar: errorJson.setValue,
    };
    if (opts.overwrite !== undefined) {
      statement.overwrite = sql.toYOM(opts.overwrite);
    }
    if (opts.createParents !== undefined) {
      statement.createParents = sql.toYOM(opts.createParents);
    }
    this.pushToBacking(statement as any);
    return this;
  }

  callStoredProcedure(name: string, opts: CallStoredProcedureOpts = {}): this {
    this.pushToBacking(
      callStoredProcedureStatement(
        name,
        opts,
      ) as yom.GeneralServerStatement as any,
    );
    return this;
  }

  sftpReceive(opts: SftpReceiveOpts): this {
    const resultJson = resolveDefSet(
      "resultJsonScalar",
      opts.defResultJsonScalar,
      opts.setResultJsonScalar,
      opts.resultJsonScalar,
    );
    if (
      resultJson.defValue === undefined && resultJson.setValue === undefined
    ) {
      throw new Error(
        "sftpReceive requires defResultJsonScalar or setResultJsonScalar",
      );
    }
    const errorJson = resolveDefSet(
      "errorJsonScalar",
      opts.defErrorJsonScalar,
      opts.setErrorJsonScalar,
      opts.errorJsonScalar,
    );
    if (errorJson.defValue === undefined && errorJson.setValue === undefined) {
      throw new Error(
        "sftpReceive requires defErrorJsonScalar or setErrorJsonScalar",
      );
    }
    let destination: yom.SftpReceiveDestination;
    if (opts.destination.type === "BytesScalar") {
      const dest = opts.destination;
      const content = resolveDefSet(
        "contentScalar",
        dest.defContentScalar,
        dest.setContentScalar,
        dest.contentScalar,
      );
      if (content.defValue === undefined && content.setValue === undefined) {
        throw new Error(
          "sftpReceive BytesScalar destination requires defContentScalar or setContentScalar",
        );
      }
      destination = {
        type: "BytesScalar",
        contentScalar: content.defValue,
        setContentScalar: content.setValue,
      };
    } else {
      const dest = opts.destination;
      const blob = resolveDefSet(
        "blobHashScalar",
        dest.defBlobHashScalar,
        dest.setBlobHashScalar,
        dest.blobHashScalar,
      );
      if (blob.defValue === undefined && blob.setValue === undefined) {
        throw new Error(
          "sftpReceive BlobHashScalar destination requires defBlobHashScalar or setBlobHashScalar",
        );
      }
      destination = {
        type: "BlobHashScalar",
        blobHashScalar: blob.defValue,
        setBlobHashScalar: blob.setValue,
      };
    }
    this.pushToBacking({
      t: "SftpReceive",
      connection: sftpConnectionOptsToYom(opts.connection),
      remotePath: sql.toYOM(opts.remotePath),
      destination,
      resultJsonScalar: resultJson.defValue,
      setResultJsonScalar: resultJson.setValue,
      errorJsonScalar: errorJson.defValue,
      setErrorJsonScalar: errorJson.setValue,
    } as yom.SftpReceiveStatement as any);
    return this;
  }

  sendEmail(opts: SendEmailOpts): this {
    if (opts.attachments && opts.attachmentsJson) {
      throw new Error(
        "sendEmail accepts either attachments or attachmentsJson, not both",
      );
    }
    const errorJsonScalar = opts.errorJsonScalar ?? "__send_email_error_json";
    const requestJson = sql.jsonBuildObject({
      apiVersion: 1,
      from: toSqlExpr(opts.from),
      to: toSqlExpr(opts.to),
      cc: opts.cc ? toSqlExpr(opts.cc) : undefined,
      bcc: opts.bcc ? toSqlExpr(opts.bcc) : undefined,
      replyTo: opts.replyTo ? toSqlExpr(opts.replyTo) : undefined,
      subject: toSqlExpr(opts.subject),
      textBody: opts.textBody ? toSqlExpr(opts.textBody) : undefined,
      htmlBody: opts.htmlBody ? toSqlExpr(opts.htmlBody) : undefined,
      idempotencyKey: opts.idempotencyKey
        ? toSqlExpr(opts.idempotencyKey)
        : undefined,
      tag: opts.tag ? toSqlExpr(opts.tag) : undefined,
      messageStream: opts.messageStream
        ? toSqlExpr(opts.messageStream)
        : undefined,
      metadata: opts.metadata,
      attachments: opts.attachmentsJson ??
        (opts.attachments
          ? sql.jsonBuildArray(
            ...opts.attachments.map((attachment) =>
              sql.jsonBuildObject({
                name: toSqlExpr(attachment.name),
                content: attachment.content,
                contentType: toSqlExpr(attachment.contentType),
              })
            ),
          )
          : undefined),
    });
    this.serviceRequest({
      serviceType: sql.lit`email`,
      operation: sql.lit`send`,
      usageContext: opts.usageContext,
      defUsageScalar: opts.defUsageScalar,
      setUsageScalar: opts.setUsageScalar,
      optIn: opts.optIn,
      requestJson,
      resultJsonScalar: opts.resultJsonScalar ?? "__send_email_result_json",
      errorJsonScalar,
      mockProcedure: opts.mockProcedure,
    });
    return this;
  }

  sendBulkEmail(opts: SendBulkEmailOpts): this {
    if (opts.attachments && opts.attachmentsJson) {
      throw new Error(
        "sendBulkEmail accepts either attachments or attachmentsJson, not both",
      );
    }
    const hasResultDestination = opts.defResultJsonScalar !== undefined ||
      opts.setResultJsonScalar !== undefined ||
      opts.resultJsonScalar !== undefined;
    const hasErrorDestination = opts.defErrorJsonScalar !== undefined ||
      opts.setErrorJsonScalar !== undefined ||
      opts.errorJsonScalar !== undefined;
    const requestJson = sql.jsonBuildObject({
      apiVersion: 1,
      streamIntent: "marketing",
      from: toSqlExpr(opts.from),
      replyTo: opts.replyTo ? toSqlExpr(opts.replyTo) : undefined,
      subject: toSqlExpr(opts.subject),
      htmlBody: opts.htmlBody ? toSqlExpr(opts.htmlBody) : undefined,
      textBody: opts.textBody ? toSqlExpr(opts.textBody) : undefined,
      tag: opts.tag ? toSqlExpr(opts.tag) : undefined,
      recipients: opts.recipientsJson,
      attachments: opts.attachmentsJson ??
        (opts.attachments
          ? sql.jsonBuildArray(
            ...opts.attachments.map((attachment) =>
              sql.jsonBuildObject({
                name: toSqlExpr(attachment.name),
                contentType: toSqlExpr(attachment.contentType),
                blobHash: sql`bytes.to_hex(${attachment.blobHash})`,
              })
            ),
          )
          : undefined),
      submissionKey: toSqlExpr(opts.submissionKey),
    });
    this.serviceRequest({
      serviceType: sql.lit`email`,
      operation: sql.lit`send_bulk`,
      usageContext: opts.usageContext,
      defUsageScalar: opts.defUsageScalar,
      setUsageScalar: opts.setUsageScalar,
      optIn: opts.optIn,
      requestJson,
      defResultJsonScalar: hasResultDestination
        ? opts.defResultJsonScalar
        : "__send_bulk_email_result_json",
      setResultJsonScalar: opts.setResultJsonScalar,
      resultJsonScalar: opts.resultJsonScalar,
      defErrorJsonScalar: hasErrorDestination
        ? opts.defErrorJsonScalar
        : "__send_bulk_email_error_json",
      setErrorJsonScalar: opts.setErrorJsonScalar,
      errorJsonScalar: opts.errorJsonScalar,
      mockProcedure: opts.mockProcedure,
    });
    return this;
  }

  sendSms(opts: SendSmsOpts): this {
    const errorJsonScalar = opts.errorJsonScalar ?? "__send_sms_error_json";
    const requestJson = sql.jsonBuildObject({
      apiVersion: 1,
      to: toSqlExpr(opts.to),
      body: toSqlExpr(opts.body),
      from: toSqlExpr(opts.from),
      idempotencyKey: opts.idempotencyKey
        ? toSqlExpr(opts.idempotencyKey)
        : undefined,
      metadata: opts.metadata,
    });
    this.serviceRequest({
      serviceType: sql.lit`sms`,
      operation: sql.lit`send`,
      usageContext: opts.usageContext,
      defUsageScalar: opts.defUsageScalar,
      setUsageScalar: opts.setUsageScalar,
      optIn: opts.optIn,
      requestJson,
      resultJsonScalar: opts.resultJsonScalar ?? "__send_sms_result_json",
      errorJsonScalar,
      mockProcedure: opts.mockProcedure,
    });
    return this;
  }

  sendWebPush(opts: SendWebPushOpts): this {
    const requestJson = sql.jsonBuildObject({
      apiVersion: 1,
      endpoint: opts.endpoint,
      p256dh: opts.p256dh,
      auth: opts.auth,
      vapidKeyId: opts.vapidKeyId,
      payload: opts.payload,
      ttlSeconds: opts.ttlSeconds,
      urgency: opts.urgency,
      topic: opts.topic,
    });
    this.serviceRequest({
      serviceType: sql.lit`web_push`,
      operation: sql.lit`send`,
      optIn: opts.optIn,
      requestJson,
      resultJsonScalar: opts.resultJsonScalar ?? "__send_web_push_result_json",
      errorJsonScalar: opts.errorJsonScalar ?? "__send_web_push_error_json",
      mockProcedure: opts.mockProcedure,
    });
    return this;
  }

  /**
   * Generates an INSERT into the named outbox table.
   * Must be called inside a transaction alongside the business logic modification.
   */
  enqueueToOutbox(
    name: string,
    fields: Record<string, Sql>,
  ): this {
    const tableName = `${name}_outbox`;
    const columns = Object.keys(fields);
    const values = Object.values(fields);
    const columnList = columns.join(", ");
    const valueList = values.map((v) => v.toSQL()).join(", ");
    this.pushToBacking({
      t: "Modify",
      sql: `insert into ${tableName}(${columnList}) values (${valueList})`,
    } as any);
    return this;
  }

  aiGenerate(opts: AiGenerateOpts): this {
    let taskExpr: Sql;
    if (Array.isArray(opts.intent.task)) {
      taskExpr = sql`json_build_array(${
        opts.intent.task.map((t) => sql.lit(t)).reduce((a, b) =>
          sql`${a}, ${b}`
        )
      })`;
    } else {
      taskExpr = toSqlExpr(opts.intent.task);
    }
    const intent = sql.jsonBuildObject({
      intentVersion: 1,
      task: taskExpr,
      priority: opts.intent.priority
        ? toSqlExpr(opts.intent.priority)
        : undefined,
      constraints: opts.intent.constraints,
      noMatchPolicy: opts.intent.noMatchPolicy
        ? toSqlExpr(opts.intent.noMatchPolicy)
        : undefined,
      forceProvider: opts.intent.forceProvider,
      forceModel: opts.intent.forceModel,
      queueTier: opts.intent.queueTier
        ? toSqlExpr(opts.intent.queueTier)
        : undefined,
    });
    const requestJson = sql.jsonBuildObject({
      apiVersion: 1,
      intent,
      system: opts.system,
      messages: opts.messages,
      generation: opts.generation,
      reasoning: opts.reasoning,
      cacheMode: opts.cacheMode ? toSqlExpr(opts.cacheMode) : undefined,
      timeoutMs: opts.timeoutMs,
      metadata: opts.metadata,
    });
    return this.serviceRequest({
      serviceType: sql.lit`ai`,
      operation: sql.lit`generate`,
      usageContext: opts.usageContext,
      defUsageScalar: opts.defUsageScalar,
      setUsageScalar: opts.setUsageScalar,
      optIn: opts.optIn,
      requestJson,
      resultJsonScalar: opts.resultJsonScalar,
      errorJsonScalar: opts.errorJsonScalar,
      mockProcedure: opts.mockProcedure,
    });
  }

  aiListModels(opts: AiListModelsOpts): this {
    return this.serviceRequest({
      serviceType: sql.lit`ai`,
      operation: sql.lit`list_models`,
      optIn: opts.optIn,
      requestJson: sql`'{}'::json`,
      resultJsonScalar: opts.resultJsonScalar,
      errorJsonScalar: opts.errorJsonScalar,
      mockProcedure: opts.mockProcedure,
    });
  }

  removeFiles(query: Sql): this {
    this.pushToBacking({
      t: "RemoveFiles",
      query: query.toYOM(),
    } as yom.GeneralServerStatement as any);
    return this;
  }

  createBlob(
    content: Sql,
    hashScalarOrOpts:
      | string
      | { defHashScalar: string }
      | { setHashScalar: string },
  ): this {
    let hashScalar: string | undefined;
    let setHashScalar: string | undefined;
    if (typeof hashScalarOrOpts === "string") {
      hashScalar = hashScalarOrOpts;
    } else if ("defHashScalar" in hashScalarOrOpts) {
      hashScalar = hashScalarOrOpts.defHashScalar;
    } else {
      setHashScalar = hashScalarOrOpts.setHashScalar;
    }
    this.pushToBacking({
      t: "CreateBlob",
      hashScalar,
      setHashScalar,
      content: sql.toYOM(content),
    } as yom.CreateBlobStatement as any);
    return this;
  }

  readBlob(
    hash: Sql,
    contentScalarOrOpts:
      | string
      | { defContentScalar: string }
      | { setContentScalar: string },
  ): this {
    let contentScalar: string | undefined;
    let setContentScalar: string | undefined;
    if (typeof contentScalarOrOpts === "string") {
      contentScalar = contentScalarOrOpts;
    } else if ("defContentScalar" in contentScalarOrOpts) {
      contentScalar = contentScalarOrOpts.defContentScalar;
    } else {
      setContentScalar = contentScalarOrOpts.setContentScalar;
    }
    this.pushToBacking({
      t: "ReadBlob",
      hash: sql.toYOM(hash),
      contentScalar,
      setContentScalar,
    } as yom.ReadBlobStatement as any);
    return this;
  }

  removeBlob(hash: Sql): this {
    this.pushToBacking({
      t: "RemoveBlob",
      hash: sql.toYOM(hash),
    } as yom.RemoveBlobStatement as any);
    return this;
  }

  pdfRenderPage(
    opts: { pdf: Sql; page: Sql; width: Sql; defOutputScalar: string },
  ): this {
    this.pushToBacking({
      t: "PdfRenderPage",
      pdf: sql.toYOM(opts.pdf),
      page: sql.toYOM(opts.page),
      width: sql.toYOM(opts.width),
      outputScalar: opts.defOutputScalar,
    } as yom.PdfRenderPageStatement as any);
    return this;
  }

  /**
   * Crop a rectangular region (x, y, width, height in pixels) out of an image's
   * bytes and write the cropped PNG into `defOutBytesScalar`. The rect is
   * clamped to the image bounds. Compose after `pdfRenderPage` to zoom into a
   * detail (a BOM table, a callout) that is too small to read on the full page.
   */
  cropImage(
    opts: {
      inBytes: Sql;
      x: Sql;
      y: Sql;
      width: Sql;
      height: Sql;
      imageType?: Sql;
      defOutBytesScalar: string;
    },
  ): this {
    this.pushToBacking({
      t: "CropImage",
      inBytes: sql.toYOM(opts.inBytes),
      imageType: sql.toYOM(opts.imageType ?? sql.lit("png")),
      x: sql.toYOM(opts.x),
      y: sql.toYOM(opts.y),
      width: sql.toYOM(opts.width),
      height: sql.toYOM(opts.height),
      outBytesScalar: opts.defOutBytesScalar,
    } as yom.CropImageStatement as any);
    return this;
  }

  setJsBytes(
    bytes: Sql,
    opts: { defIdScalar: string } | { setIdScalar: string },
  ): this {
    const idScalar = "defIdScalar" in opts ? opts.defIdScalar : undefined;
    const setIdScalar = "setIdScalar" in opts ? opts.setIdScalar : undefined;
    this.pushToBacking({
      t: "SetJsBytes",
      bytes: sql.toYOM(bytes),
      idScalar,
      setIdScalar,
    } as yom.SetJsBytesStatement as any);
    return this;
  }

  getJsBytes(
    id: Sql,
    opts: { defBytesScalar: string } | { setBytesScalar: string },
  ): this {
    const bytesScalar = "defBytesScalar" in opts
      ? opts.defBytesScalar
      : undefined;
    const setBytesScalar = "setBytesScalar" in opts
      ? opts.setBytesScalar
      : undefined;
    this.pushToBacking({
      t: "GetJsBytes",
      id: sql.toYOM(id),
      bytesScalar,
      setBytesScalar,
    } as yom.GetJsBytesStatement as any);
    return this;
  }

  resizeImage(opts: ResizeImageOpts): this {
    const out = resolveDefSet(
      "outBytesScalar",
      opts.defOutBytesScalar,
      opts.setOutBytesScalar,
      opts.outBytesScalar,
    );
    if (out.defValue === undefined && out.setValue === undefined) {
      throw new Error(
        "resizeImage requires defOutBytesScalar or setOutBytesScalar",
      );
    }
    this.pushToBacking({
      t: "ResizeImage",
      inBytes: sql.toYOM(opts.inBytes),
      imageType: sql.toYOM(opts.imageType),
      resizeType: sql.toYOM(opts.resizeType),
      width: sql.toYOM(opts.width),
      height: sql.toYOM(opts.height),
      outBytesScalar: out.defValue,
      setOutBytesScalar: out.setValue,
    } as yom.ResizeImageStatement as any);
    return this;
  }

  renderTemplate(opts: RenderTemplateOpts): this {
    const out = resolveDefSet(
      "outputScalar",
      opts.defOutputScalar,
      opts.setOutputScalar,
      opts.outputScalar,
    );
    if (out.defValue === undefined && out.setValue === undefined) {
      throw new Error(
        "renderTemplate requires defOutputScalar or setOutputScalar",
      );
    }
    this.pushToBacking({
      t: "RenderTemplate",
      template: sql.toYOM(opts.template),
      scope: opts.scope,
      hasDbAccess: opts.hasDbAccess,
      htmlEscaped: opts.htmlEscaped,
      outputScalar: out.defValue,
      setOutputScalar: out.setValue,
    } as yom.RenderTemplateStatement as any);
    return this;
  }

  queryToExcel(opts: QueryToExcelOpts): this {
    const out = resolveDefSet(
      "outputScalar",
      opts.defOutputScalar,
      opts.setOutputScalar,
      opts.outputScalar,
    );
    if (out.defValue === undefined && out.setValue === undefined) {
      throw new Error(
        "queryToExcel requires defOutputScalar or setOutputScalar",
      );
    }
    this.pushToBacking({
      t: "QueryToExcel",
      sheets: opts.sheets,
      password: opts.password,
      outputScalar: out.defValue,
      setOutputScalar: out.setValue,
    } as yom.QueryToExcelStatement as any);
    return this;
  }

  createZip(opts: CreateZipOpts): this {
    const out = resolveDefSet(
      "outputScalar",
      opts.defOutputScalar,
      opts.setOutputScalar,
      opts.outputScalar,
    );
    if (out.defValue === undefined && out.setValue === undefined) {
      throw new Error("createZip requires defOutputScalar or setOutputScalar");
    }
    this.pushToBacking({
      t: "CreateZip",
      query: opts.query,
      sourceType: opts.sourceType,
      compression: opts.compression,
      outputScalar: out.defValue,
      setOutputScalar: out.setValue,
    } as yom.CreateZipStatement as any);
    return this;
  }

  renderMjml(opts: RenderMjmlOpts): this {
    const out = resolveDefSet(
      "outputScalar",
      opts.defOutputScalar,
      opts.setOutputScalar,
      opts.outputScalar,
    );
    if (out.defValue === undefined && out.setValue === undefined) {
      throw new Error("renderMjml requires defOutputScalar or setOutputScalar");
    }
    this.pushToBacking({
      t: "RenderMjml",
      mjml: sql.toYOM(opts.mjml),
      outputScalar: out.defValue,
      setOutputScalar: out.setValue,
    } as yom.RenderMjmlStatement as any);
    return this;
  }

  uploadPublicAsset(opts: UploadPublicAssetOpts): this {
    const hash = resolveDefSet(
      "hashScalar",
      opts.defHashScalar,
      opts.setHashScalar,
      opts.hashScalar,
    );
    if (hash.defValue === undefined && hash.setValue === undefined) {
      throw new Error(
        "uploadPublicAsset requires defHashScalar or setHashScalar",
      );
    }
    this.pushToBacking({
      t: "UploadPublicAsset",
      content: sql.toYOM(opts.content),
      contentType: sql.toYOM(opts.contentType),
      hashScalar: hash.defValue,
      setHashScalar: hash.setValue,
    } as yom.UploadPublicAssetStatement as any);
    return this;
  }

  renderTypst(opts: RenderTypstOpts): this {
    const pdf = resolveDefSet(
      "pdfOutputScalar",
      opts.defPdfOutputScalar,
      opts.setPdfOutputScalar,
      opts.pdfOutputScalar,
    );
    if (pdf.defValue === undefined && pdf.setValue === undefined) {
      throw new Error(
        "renderTypst requires defPdfOutputScalar or setPdfOutputScalar",
      );
    }
    const assets = opts.assets?.length
      ? opts.assets.map((a) => ({
        name: a.name,
        data: sql.toYOM(a.data),
      }))
      : undefined;
    let options: string | undefined;
    if (opts.pdfOptions) {
      if (opts.pdfOptions instanceof Sql) {
        options = sql.toYOM(opts.pdfOptions) as string;
      } else {
        options = sql.lit(JSON.stringify(opts.pdfOptions)).toYOM() as string;
      }
    }
    this.pushToBacking({
      t: "RenderTypst",
      template: sql.toYOM(opts.template),
      data: sql.toYOM(opts.data),
      outputFormat: typeof opts.outputFormat === "string"
        ? sql.lit(opts.outputFormat).toYOM()
        : sql.toYOM(opts.outputFormat),
      pdfOutputScalar: pdf.defValue,
      setPdfOutputScalar: pdf.setValue,
      assets,
      options,
    } as yom.RenderTypstStatement as any);
    return this;
  }

  runJavascript(opts: RunJavascriptOpts): this {
    if (opts.tools?.length) {
      if (!opts.procedureToolPolicy) {
        throw new Error(
          "RunJavascript procedure tools require one procedureToolPolicy.",
        );
      }
      const normalizedArgumentOutputs = Object.values(
        opts.procedureToolPolicy.outputBindings,
      ).filter((name) => name === "normalizedArguments");
      if (normalizedArgumentOutputs.length !== 1) {
        throw new Error(
          "procedureToolPolicy must designate exactly one normalizedArguments output.",
        );
      }
    } else if (opts.procedureToolPolicy) {
      throw new Error(
        "procedureToolPolicy is only valid with procedure-backed JavaScript tools.",
      );
    }
    const statement: yom.RunJavascriptStatement = {
      t: "RunJavascript",
      script: sql.toYOM(opts.script),
      tools: opts.tools?.map((tool) => ({
        name: tool.name,
        timeoutMs: tool.timeoutMs,
        implementation: "procedure" as const,
        procedure: tool.implementation.procedure,
        inputBindings: tool.inputBindings,
        stateOutputs: tool.stateOutputs ?? [],
        policyMetadataJson: tool.policyMetadataJson,
      })) ?? [],
      ...(opts.procedureToolPolicy === undefined
        ? {}
        : { procedureToolPolicy: opts.procedureToolPolicy }),
      resultScalar: opts.resultScalar,
      consoleOutput: opts.consoleOutput,
      includeLibs: opts.includeLibs ? sql.toYOM(opts.includeLibs) : undefined,
    };
    this.pushToBacking(statement as unknown as Statement);
    return this;
  }

  get dev(): StudioApi {
    return new StudioApi(this[BACKING_ARRAY] as any);
  }

  get studio(): StudioApi {
    return new StudioApi(this[BACKING_ARRAY] as any);
  }
}

export interface StudioCheckSystemOpts {
  version: Sql;
  errorsTable: string;
  runErrorScalar: string;
  runLogsScalar?: string;
  validatedPathsScalar?: string;
  capabilities?: Sql;
  databaseMapping?: Sql;
  /** Deprecated pipeline-only opt-in; prefer `checkCoverage.pipelines`. */
  checkPipelines?: Sql;
  /**
   * Source families to include in addition to the serving system. Omitted
   * families keep the platform default, which excludes them from checking.
   */
  checkCoverage?: StudioCheckCoverage;
  /**
   * Receives the TypeScript check status as JSON:
   * `{status: "not_run" | "completed" | "skipped", reason?}`.
   */
  typeCheckScalar?: string;
}

/**
 * Optional source families included by {@link StudioApi.checkSystem}. A
 * boolean fixes inclusion at generation time; a SQL boolean decides it at run
 * time (true includes the family, false or null keeps the default exclusion).
 */
export interface StudioCheckCoverage {
  tests?: boolean | Sql;
  transforms?: boolean | Sql;
  pipelines?: boolean | Sql;
}

export interface StudioValidateSavedFileOpts {
  version: Sql;
  path: Sql;
  errorsTable: string;
  runErrorScalar: string;
  runLogsScalar?: string;
  validatedPathsScalar?: string;
  capabilities?: Sql;
  databaseMapping?: Sql;
}

export interface StudioDeploySystemOpts {
  version: Sql;
  secrets?: Sql;
  databaseMapping?: Sql;
  transformName?: Sql;
  devDatabaseId?: Sql;
  requestUserId?: Sql;
  forceDatabaseSwap?: Sql;
  takeProductionSnapshot?: Sql;
  resultJsonScalar?: string;
}

export interface StudioStartDeploySystemJobOpts {
  version: Sql;
  databaseMapping?: Sql;
  transformName?: Sql;
  devDatabaseId?: Sql;
  requestUserId?: Sql;
  forceDatabaseSwap?: Sql;
  requestedDeployType?: Sql;
  takeProductionSnapshot?: Sql;
  /** Caller-generated idempotency key retained across a lost admission response. */
  requestId?: Sql;
  /**
   * Live version the caller reviewed (-1 = nothing live). Admission rejects
   * the deploy with `live_version_changed` when production has moved.
   */
  expectedLiveVersionId?: Sql;
  /**
   * Source hash of the candidate version the caller reviewed. Admission
   * rejects the deploy with `source_changed` when the version's files changed.
   */
  expectedCandidateSourceHash?: Sql;
  /**
   * Source hash of the live deployed version the caller reviewed (empty when
   * nothing was live). Admission rejects with `source_changed` on mismatch.
   */
  expectedLiveSourceHash?: Sql;
  deployRunIdScalar?: string;
}

/**
 * Admit a long-running Studio operation and return immediately with its durable
 * execution-run id. `operation` is the tagged Studio operation JSON payload.
 */
export interface StudioStartStudioOperationOpts {
  requestId: Sql;
  operation: Sql;
  executionRunIdScalar?: string;
  /** Attribution; the platform binds userId to the authenticated requester. */
  actor?: Sql;
  /** Full admission response, including retryable rejection details. */
  resultJsonScalar?: string;
}

/**
 * Admit an asynchronous test run. Unlike `runTests`, this returns its tagged
 * admission outcome without waiting for compilation or test execution.
 */
export interface StudioStartTestRunOpts {
  requestId: Sql;
  version: Sql;
  filters?: Sql;
  resultJsonScalar: string;
}

export interface StudioControlSystemServiceOpts {
  action: Sql;
  resultJsonScalar?: string;
}

export interface StudioValidatePreviewDatabaseOpts {
  version: Sql;
  database: Sql;
  databaseMapping?: Sql;
  validScalar: string;
  errorsScalar: string;
}

export interface StudioCheckDeployCompatibilityOpts {
  version: Sql;
  databaseMapping?: Sql;
  deployTypeScalar: string;
  reasonsScalar: string;
  newTablesScalar?: string;
  newColumnsScalar?: string;
  orphanedTablesScalar?: string;
  orphanedFieldsScalar?: string;
  /** `[{table, field, kind}]` for an `automatic_backfill` result. */
  automaticBackfillFieldsScalar?: string;
  /**
   * Structured schema differences against production:
   * `[{kind, table, field, enum, value, renamed_from, from, to, effect, reason}]`
   * where `from`/`to` are field types (`{type, not_null, enum?, table?, ...}`).
   */
  schemaChangesScalar?: string;
}

export interface StudioRunTransformOpts {
  version: Sql;
  name: Sql;
  sourceDatabaseId?: Sql;
  databaseMapping?: Sql;
  createdDatabaseScalar: string;
}

export interface StudioRunPipelineOpts {
  version: Sql;
  name: Sql;
  targetDatabaseId: Sql;
  databaseMapping?: Sql;
  startAtStage?: Sql;
  resultScalar?: string;
}

export interface StudioRunTestsOpts {
  version: Sql;
  resultsTable: string;
  debugOutputsTable?: string;
  /** Scalar receiving the tagged response outcome from Studio. */
  outcomeScalar: string;
  capabilities?: Sql;
  filters?: Sql;
}

export interface StudioCopyDatabaseOpts {
  database: Sql;
  createdDatabaseScalar: string;
}

export interface StudioGetDatabaseSchemaOpts {
  database: Sql;
  resultScalar: string;
}

export interface StudioGetDatabaseStatsOpts {
  database: Sql;
  resultScalar: string;
}

export interface StudioGetSystemSummaryOpts {
  version: Sql;
  parts: Sql;
  detail?: Sql;
  filters?: Sql;
  capabilities?: Sql;
  databaseMapping?: Sql;
  resultScalar: string;
}

export interface StudioCreateEmptyDatabaseOpts {
  createdDatabaseScalar: string;
}

export interface StudioSnapshotProductionOpts {
  createdDatabaseScalar: string;
  nameScalar: string;
}

export interface StudioRunProductionPipelineOpts {
  version: Sql;
  name: Sql;
  databaseMapping?: Sql;
  /** Stable UUID retained for retries of this one invocation. */
  invocationId: Sql;
  /** Invocation UUID that this deliberate new run repeats, if any. */
  rerunOf?: Sql;
  executionRunIdScalar: string;
}

export interface StudioGetProductionPipelineCatalogOpts {
  databaseMapping?: Sql;
  resultScalar: string;
}

export interface StudioResolveProductionPipelineReviewOpts {
  invocationId: Sql;
  /** `effects_applied` or `no_effects`. */
  resolution: Sql;
  /** Required operator explanation recorded with the resolution. */
  note: Sql;
  resultScalar: string;
}

export interface StudioRunProductionTransformOpts {
  version: Sql;
  name: Sql;
  databaseMapping?: Sql;
  executionRunIdScalar: string;
}

export interface StudioGetLiveMetricsOpts {
  limit?: Sql;
  /**
   * When set, returns the in-memory live buffer for the given preview version
   * instead of the production live feed. Preview buffers are ephemeral and
   * reset on preview stop/restart.
   */
  version?: Sql;
  resultScalar: string;
}

export interface StudioGetProductionBackgroundStatusOpts {
  resultScalar: string;
}

export interface StudioGetEnvironmentInfoOpts {
  resultScalar: string;
}

export interface StudioControlProductionBackgroundOpts {
  expectedModelHash: Sql;
  inputs: Sql;
  resultScalar: string;
}

export interface StudioSearchDocsOpts {
  query: Sql;
  tags?: Sql;
  limit?: Sql;
  resultsTable: string;
}

export interface StudioSearchDocSectionsOpts {
  query: Sql;
  tags?: Sql;
  limit?: Sql;
  resultsTable: string;
}

export interface StudioReadDocOpts {
  path: Sql;
  anchor?: Sql;
  includeExamples?: Sql;
  contentScalar: string;
  metadataRecord?: string;
  examplesTable?: string;
}

export interface StudioListDocsOpts {
  path: Sql;
  entriesTable: string;
}

export interface StudioSearchExamplesOpts {
  query?: Sql;
  docPath?: Sql;
  limit?: Sql;
  resultsTable: string;
}

export interface StudioSearchApiOpts {
  query?: Sql;
  importPath?: Sql;
  symbol?: Sql;
  kind?: Sql;
  limit?: Sql;
  resultsTable: string;
}

export interface StudioReadDtsOpts {
  importPath?: Sql;
  symbol?: Sql;
  path?: Sql;
  contentScalar: string;
}

export interface StudioRunBrowserFlowOpts {
  sessionId: Sql;
  baseUrl: Sql;
  authToken: Sql;
  commands: Sql;
  resultScalar: string;
}

export interface StudioRunBrowserScriptOpts {
  version?: Sql;
  previewDomain?: Sql;
  sessionId: Sql;
  authToken: Sql;
  /**
   * Optional preview user id to render pages as. When set, the browser renders
   * the app authenticated as that user (via an orchestrator-signed grant);
   * omit to leave the browser at the app's own auth gate.
   */
  authUserId?: Sql;
  /** JSON object string mapping canonical preview domains to local browser-service URLs. */
  domains?: Sql;
  /** Playwright script source (function or body) executed in the sandbox. */
  code: Sql;
  /** JSON value string passed to the script as `args`. */
  args?: Sql;
  timeoutMs?: Sql;
  /**
   * Browser capture policy. Omit or use `none` for inspection; use `demo` for
   * recording that begins at the first chapter.
   */
  captureMode?: Sql;
  resultScalar: string;
}

export interface StudioPreviewFetchOpts {
  version: Sql;
  previewDomain: Sql;
  method: Sql;
  path: Sql;
  /** JSON object string of request headers. */
  headers?: Sql;
  body?: Sql;
  resultScalar: string;
}

export interface StudioRunPreviewScheduledProcOpts {
  version: Sql;
  previewDomain: Sql;
  name: Sql;
  resultScalar: string;
}

export interface StudioQueryPreviewOpts {
  version: Sql;
  previewDomain: Sql;
  query: Sql;
  resultScalar: string;
}

export interface StudioQueryProductionOpts {
  query: Sql;
  rowCap?: Sql;
  explain?: Sql;
  explainOnly?: Sql;
  resultScalar: string;
}

export interface StudioModifyPreviewOpts {
  version: Sql;
  previewDomain: Sql;
  statement: Sql;
  resultScalar: string;
}

export interface StudioQueryDatabasesOpts {
  query: Sql;
  databaseMapping: Sql;
  primaryDatabase: Sql;
  resultScalar: string;
  explain?: Sql;
  explainOnly?: Sql;
  metrics?: Sql;
  skipAutoRowCap?: Sql;
  explainScalar?: string;
  metricsScalar?: string;
}

export interface StudioApplyExternalDbDdlOpts {
  database: Sql;
  op: Sql;
  resultScalar?: string;
}

export interface StudioApplyExternalDbDdlSqlOpts {
  database: Sql;
  statement: Sql;
  resultScalar?: string;
}

export interface StudioModifyExternalDbOpts {
  database: Sql;
  statement: Sql;
  databaseMapping?: Sql;
  resultScalar?: string;
}

export interface StudioTreeSourceOpts {
  path: Sql;
  depth?: Sql;
  resultScalar: string;
}

export interface StudioFindSourceOpts {
  pattern: Sql;
  path?: Sql;
  resultsTable: string;
}

export interface StudioGrepSourceOpts {
  pattern: Sql;
  path?: Sql;
  resultsTable: string;
}

export interface StudioReadSourceOpts {
  path: Sql;
  contentScalar: string;
  sizeScalar?: string;
}

export interface StudioRenderTypstOpts {
  version: Sql;
  template: Sql;
  data?: Sql;
  /** "pdf" (default) or "png" — png returns first-page bytes for visual feedback. */
  outputFormat?: "pdf" | "png" | Sql;
  pdfBytesScalar: string;
  resultScalar?: string;
}

/**
 * The privileged Studio/dev control surface, reached via `s.studio` /
 * `s.dev` on a server-statements builder. Each method emits a
 * `StudioRequest` that drives the Studio backend: checking and deploying
 * systems, running pipelines/transforms/tests, querying and managing
 * databases, and the docs/source/api lookups the Studio agent uses.
 *
 * Only available in Studio-hosted procedures; not for production app code.
 */
export class StudioApi {
  private static counter = 0;
  constructor(private backing: yom.GeneralServerStatement[]) {}

  private uniqueName(prefix: string): string {
    return `${prefix}_${StudioApi.counter++}`;
  }

  private studioRequest(
    obj: Record<string, Sql | undefined>,
    bytesResultScalar?: string,
  ): string {
    const resultScalar = this.uniqueName("studio_result");
    const stmt: yom.StudioRequestStatement = {
      t: "StudioRequest",
      request: sql.toYOM(sql.jsonBuildObject(obj)),
      resultScalar,
    };
    if (bytesResultScalar) {
      stmt.bytesResultScalar = bytesResultScalar;
    }
    this.backing.push(stmt);
    return resultScalar;
  }

  private pushScalar(name: string, expr: Sql, allowNoRead = false) {
    this.backing.push({
      t: "ScalarDeclaration",
      name,
      expr: sql.toYOM(expr),
      allowNoRead,
    } as yom.ScalarDeclaration as any);
  }

  private pushTable(name: string, query: Sql) {
    this.backing.push({
      t: "TableDeclaration",
      name,
      query: query.toYOM(),
    } as yom.TableDeclaration as any);
  }

  private pushRecord(name: string, query: Sql) {
    this.backing.push({
      t: "RecordDeclaration",
      name,
      query: query.toYOM(),
    } as yom.RecordDeclaration as any);
  }

  private pushStudioCheckResult(
    resultScalar: string,
    opts: {
      errorsTable: string;
      runErrorScalar: string;
      runLogsScalar?: string;
      validatedPathsScalar?: string;
    },
  ) {
    const result = new Sql(resultScalar);
    this.pushTable(
      opts.errorsTable,
      sql`
      select
        value->>'message' as message,
        (value->'diagnostic') as diagnostic,
        value->>'rendered_diagnostic' as rendered_diagnostic,
        value->>'details' as details
      from json.array_each(${result}->'errors')
    `,
    );
    this.pushScalar(opts.runErrorScalar, sql`${result}->>'run_error'`);
    if (opts.runLogsScalar) {
      this.pushScalar(opts.runLogsScalar, sql`${result}->>'run_logs'`);
    }
    if (opts.validatedPathsScalar) {
      this.pushScalar(
        opts.validatedPathsScalar,
        sql`coalesce(${result}->'validated_paths', '[]'::json)`,
      );
    }
  }

  checkSystem(opts: StudioCheckSystemOpts): this {
    const r = this.studioRequest({
      type: sql.lit`CheckSystem`,
      version: opts.version,
      capabilities: opts.capabilities,
      database_mapping: opts.databaseMapping,
      check_coverage: opts.checkCoverage
        ? sql.jsonBuildObject(
          Object.fromEntries(
            Object.entries(opts.checkCoverage).map(([family, included]) => [
              family,
              included instanceof Sql
                ? sql`case when coalesce(${included}, false) then 'include' else 'exclude' end`
                : included
                ? "include"
                : "exclude",
            ]),
          ),
        )
        : undefined,
      check_pipelines: opts.checkPipelines,
    });
    this.pushStudioCheckResult(r, opts);
    if (opts.typeCheckScalar) {
      this.pushScalar(
        opts.typeCheckScalar,
        sql`${new Sql(r)}->'type_check'`,
      );
    }
    return this;
  }

  validateSavedFile(opts: StudioValidateSavedFileOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ValidateSavedFile`,
      version: opts.version,
      path: opts.path,
      capabilities: opts.capabilities,
      database_mapping: opts.databaseMapping,
    });
    this.pushStudioCheckResult(r, opts);
    return this;
  }

  deploySystem(opts: StudioDeploySystemOpts): this {
    const r = this.studioRequest({
      type: sql.lit`DeploySystem`,
      version: opts.version,
      secrets: opts.secrets,
      database_mapping: opts.databaseMapping,
      transform_name: opts.transformName,
      dev_database_id: opts.devDatabaseId,
      request_user_id: opts.requestUserId,
      force_database_swap: opts.forceDatabaseSwap,
      take_production_snapshot: opts.takeProductionSnapshot,
    });
    if (opts.resultJsonScalar) {
      this.pushScalar(opts.resultJsonScalar, sql`${new Sql(r)}`);
    }
    return this;
  }

  startDeploySystemJob(opts: StudioStartDeploySystemJobOpts): this {
    const r = this.studioRequest({
      type: sql.lit`StartDeploySystemJob`,
      version: opts.version,
      database_mapping: opts.databaseMapping,
      transform_name: opts.transformName,
      dev_database_id: opts.devDatabaseId,
      request_user_id: opts.requestUserId,
      force_database_swap: opts.forceDatabaseSwap,
      requested_deploy_type: opts.requestedDeployType,
      take_production_snapshot: opts.takeProductionSnapshot,
      request_id: opts.requestId,
      expected_live_version_id: opts.expectedLiveVersionId,
      expected_candidate_source_hash: opts.expectedCandidateSourceHash,
      expected_live_source_hash: opts.expectedLiveSourceHash,
    });
    if (opts.deployRunIdScalar) {
      this.pushScalar(
        opts.deployRunIdScalar,
        sql`(${new Sql(r)}->>'deploy_run_id')::bigint`,
      );
    }
    return this;
  }

  startStudioOperation(opts: StudioStartStudioOperationOpts): this {
    const r = this.studioRequest({
      type: sql.lit`StartStudioOperation`,
      request_id: opts.requestId,
      operation: opts.operation,
      actor: opts.actor ?? sql`json_build_object('userId', current_user)`,
    });
    if (opts.resultJsonScalar) {
      this.pushScalar(opts.resultJsonScalar, sql`${new Sql(r)}`);
    }
    if (opts.executionRunIdScalar) {
      this.pushScalar(
        opts.executionRunIdScalar,
        sql`(${new Sql(r)}->>'execution_run_id')::bigint`,
      );
    }
    return this;
  }

  /** Start a server-side import of pinned Drive versions and return its job. */
  importDriveFiles(
    opts: { request: Sql; actor?: Sql; resultScalar: string },
  ): this {
    const r = this.studioRequest({
      type: sql.lit`ImportDriveFiles`,
      request: opts.request,
      actor: opts.actor ?? sql`json_build_object('userId', current_user)`,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  /** Request interruption of a resident operation owned by this actor. */
  cancelStudioOperation(
    opts: { requestId: Sql; actor: Sql; resultScalar: string },
  ): this {
    const r = this.studioRequest({
      type: sql.lit`CancelStudioOperation`,
      request_id: opts.requestId,
      actor: opts.actor,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  /** Delete a development database through the janitor's full cleanup path. */
  deleteDevDatabase(database: Sql): this {
    this.studioRequest({ type: sql.lit`DeleteDevDatabase`, database });
    return this;
  }

  startTestRun(opts: StudioStartTestRunOpts): this {
    const r = this.studioRequest({
      type: sql.lit`StartTestRun`,
      request_id: opts.requestId,
      version: opts.version,
      filters: opts.filters,
    });
    this.pushScalar(opts.resultJsonScalar, sql`${new Sql(r)}`);
    return this;
  }

  controlSystemService(opts: StudioControlSystemServiceOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ControlSystemService`,
      action: opts.action,
    });
    if (opts.resultJsonScalar) {
      this.pushScalar(opts.resultJsonScalar, sql`${new Sql(r)}`);
    }
    return this;
  }

  validatePreviewDatabase(opts: StudioValidatePreviewDatabaseOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ValidatePreviewDatabase`,
      version: opts.version,
      database: opts.database,
      database_mapping: opts.databaseMapping,
    });
    this.pushScalar(
      opts.validScalar,
      sql`coalesce(${new Sql(r)}->>'valid' = 'true', false)`,
    );
    this.pushScalar(
      opts.errorsScalar,
      sql`coalesce(${new Sql(r)}->>'errors', '')`,
    );
    return this;
  }

  checkDeployCompatibility(opts: StudioCheckDeployCompatibilityOpts): this {
    const r = this.studioRequest({
      type: sql.lit`CheckDeployCompatibility`,
      version: opts.version,
      database_mapping: opts.databaseMapping,
    });
    this.pushScalar(
      opts.deployTypeScalar,
      sql`${new Sql(r)}->>'deploy_type'`,
      true,
    );
    this.pushScalar(
      opts.reasonsScalar,
      sql`coalesce(${new Sql(r)}->'reasons', json_build_array())`,
      true,
    );
    if (opts.newTablesScalar) {
      this.pushScalar(
        opts.newTablesScalar,
        sql`coalesce(${new Sql(r)}->'new_tables', json_build_array())`,
      );
    }
    if (opts.newColumnsScalar) {
      this.pushScalar(
        opts.newColumnsScalar,
        sql`coalesce(${new Sql(r)}->'new_columns', json_build_object())`,
      );
    }
    if (opts.orphanedTablesScalar) {
      this.pushScalar(
        opts.orphanedTablesScalar,
        sql`coalesce(${new Sql(r)}->'orphaned_tables', json_build_array())`,
      );
    }
    if (opts.orphanedFieldsScalar) {
      this.pushScalar(
        opts.orphanedFieldsScalar,
        sql`coalesce(${new Sql(r)}->'orphaned_fields', json_build_object())`,
      );
    }
    if (opts.automaticBackfillFieldsScalar) {
      const fields = sql`${new Sql(r)}->'automatic_backfill_fields'`;
      this.pushScalar(
        opts.automaticBackfillFieldsScalar,
        sql`coalesce(${fields}, json_build_array())`,
      );
    }
    if (opts.schemaChangesScalar) {
      this.pushScalar(
        opts.schemaChangesScalar,
        sql`coalesce(${new Sql(r)}->'schema_changes', json_build_array())`,
      );
    }
    return this;
  }

  runTransform(opts: StudioRunTransformOpts): this {
    const r = this.studioRequest({
      type: sql.lit`RunTransform`,
      version: opts.version,
      name: opts.name,
      source_database_id: opts.sourceDatabaseId,
      database_mapping: opts.databaseMapping,
    });
    this.pushScalar(
      opts.createdDatabaseScalar,
      sql`${new Sql(r)}->>'created_database'`,
      true,
    );
    return this;
  }

  runPipeline(opts: StudioRunPipelineOpts): this {
    const r = this.studioRequest({
      type: sql.lit`RunPipeline`,
      version: opts.version,
      name: opts.name,
      target_database_id: opts.targetDatabaseId,
      database_mapping: opts.databaseMapping,
      start_at_stage: opts.startAtStage,
    });
    if (opts.resultScalar) {
      this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    }
    return this;
  }

  runTests(opts: StudioRunTestsOpts): this {
    const r = this.studioRequest({
      type: sql.lit`RunTests`,
      version: opts.version,
      capabilities: opts.capabilities,
      filters: opts.filters,
    });
    this.pushTable(
      opts.resultsTable,
      sql`
      select
        value->>'test_name' as test_name,
        (value->>'passed')::bool as passed,
        value->>'error' as error,
        value->>'expected' as expected,
        value->>'actual' as actual,
        value->'diagnostic' as diagnostic,
        value->>'debug_output' as debug_output
      from json.array_each(${new Sql(r)}->'results')
      `,
    );
    this.pushScalar(
      opts.outcomeScalar,
      sql`${new Sql(r)}->>'outcome'`,
      true,
    );
    if (opts.debugOutputsTable) {
      this.pushTable(
        opts.debugOutputsTable,
        sql`
        select
          value->>'kind' as kind,
          value->>'label' as label,
          value->>'value' as value
        from json.array_each(coalesce(${new Sql(
          r,
        )}->'debug_outputs', json_build_array()))
      `,
      );
    }
    return this;
  }

  copyDatabase(opts: StudioCopyDatabaseOpts): this {
    const r = this.studioRequest({
      type: sql.lit`CopyDatabase`,
      database: opts.database,
    });
    this.pushScalar(
      opts.createdDatabaseScalar,
      sql`${new Sql(r)}->>'created_database'`,
      true,
    );
    return this;
  }

  createEmptyDatabase(opts: StudioCreateEmptyDatabaseOpts): this {
    const r = this.studioRequest({
      type: sql.lit`CreateEmptyDatabase`,
    });
    this.pushScalar(
      opts.createdDatabaseScalar,
      sql`${new Sql(r)}->>'created_database'`,
      true,
    );
    return this;
  }

  snapshotProduction(opts: StudioSnapshotProductionOpts): this {
    const r = this.studioRequest({
      type: sql.lit`SnapshotProduction`,
    });
    this.pushScalar(
      opts.createdDatabaseScalar,
      sql`${new Sql(r)}->>'created_database'`,
      true,
    );
    this.pushScalar(opts.nameScalar, sql`${new Sql(r)}->>'name'`, true);
    return this;
  }

  runProductionPipeline(opts: StudioRunProductionPipelineOpts): this {
    const r = this.studioRequest({
      type: sql.lit`RunProductionPipeline`,
      version: opts.version,
      name: opts.name,
      database_mapping: opts.databaseMapping,
      invocation_id: opts.invocationId,
      rerun_of: opts.rerunOf,
    });
    this.pushScalar(
      opts.executionRunIdScalar,
      sql`(${new Sql(r)}->>'execution_run_id')::bigint`,
      true,
    );
    return this;
  }

  getProductionPipelineCatalog(
    opts: StudioGetProductionPipelineCatalogOpts,
  ): this {
    const r = this.studioRequest({
      type: sql.lit`GetProductionPipelineCatalog`,
      database_mapping: opts.databaseMapping,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  /**
   * Record the operator's outcome for a `requires_review` production pipeline
   * invocation, releasing production pipeline/transform admission.
   */
  resolveProductionPipelineReview(
    opts: StudioResolveProductionPipelineReviewOpts,
  ): this {
    const r = this.studioRequest({
      type: sql.lit`ResolveProductionPipelineReview`,
      invocation_id: opts.invocationId,
      resolution: opts.resolution,
      note: opts.note,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`, true);
    return this;
  }

  runProductionTransform(opts: StudioRunProductionTransformOpts): this {
    const r = this.studioRequest({
      type: sql.lit`RunProductionTransform`,
      version: opts.version,
      name: opts.name,
      database_mapping: opts.databaseMapping,
    });
    this.pushScalar(
      opts.executionRunIdScalar,
      sql`(${new Sql(r)}->>'execution_run_id')::bigint`,
      true,
    );
    return this;
  }

  inspectRuntime(opts: {
    version?: Sql;
    view: "status" | "live" | "background";
    resultScalar: string;
  }): this {
    const r = this.studioRequest({
      type: sql.lit`InspectRuntime`,
      version: opts.version,
      view: sql.lit(opts.view),
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  getLiveMetrics(opts: StudioGetLiveMetricsOpts): this {
    const r = this.studioRequest({
      type: sql.lit`GetLiveMetrics`,
      limit: opts.limit,
      version: opts.version,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  /** Read ephemeral Studio diagnostics directly, without queueing Studio work. */
  getStudioLive(opts: { query: Sql; resultScalar: string }): this {
    const r = this.studioRequest({
      type: sql.lit`GetStudioLive`,
      query: opts.query,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  getProductionBackgroundStatus(
    opts: StudioGetProductionBackgroundStatusOpts,
  ): this {
    const r = this.studioRequest({
      type: sql.lit`GetBackgroundStatus`,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  getEnvironmentInfo(opts: StudioGetEnvironmentInfoOpts): this {
    const r = this.studioRequest({
      type: sql.lit`GetEnvironmentInfo`,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  controlProductionBackground(
    opts: StudioControlProductionBackgroundOpts,
  ): this {
    const r = this.studioRequest({
      type: sql.lit`ControlBackground`,
      expected_model_hash: opts.expectedModelHash,
      inputs: opts.inputs,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  getDatabaseSchema(opts: StudioGetDatabaseSchemaOpts): this {
    const r = this.studioRequest({
      type: sql.lit`GetDatabaseSchema`,
      database: opts.database,
    });
    this.pushScalar(
      opts.resultScalar,
      sql`(${new Sql(r)}->>'schema_json')::json`,
    );
    return this;
  }

  getDatabaseStats(opts: StudioGetDatabaseStatsOpts): this {
    const r = this.studioRequest({
      type: sql.lit`GetDatabaseStats`,
      database: opts.database,
    });
    this.pushScalar(
      opts.resultScalar,
      sql`(${new Sql(r)}->>'stats_json')::json`,
    );
    return this;
  }

  getSystemSummary(opts: StudioGetSystemSummaryOpts): this {
    const r = this.studioRequest({
      type: sql.lit`GetSystemSummary`,
      version: opts.version,
      parts: opts.parts,
      detail: opts.detail,
      filters: opts.filters,
      capabilities: opts.capabilities,
      database_mapping: opts.databaseMapping,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  searchDocs(opts: StudioSearchDocsOpts): this {
    const r = this.studioRequest({
      type: sql.lit`SearchDocs`,
      query: opts.query,
      tags: opts.tags,
      limit: opts.limit,
    });
    this.pushTable(
      opts.resultsTable,
      sql`
      select
        value->>'path' as path,
        value->>'title' as title,
        value->>'description' as description,
        value->'tags' as tags,
        value->'related' as related,
        (value->>'score')::double as score,
        (value->>'word_count')::bigint as word_count
      from json.array_each(${new Sql(r)}->'results')
    `,
    );
    return this;
  }

  searchDocSections(opts: StudioSearchDocSectionsOpts): this {
    const r = this.studioRequest({
      type: sql.lit`SearchDocSections`,
      query: opts.query,
      tags: opts.tags,
      limit: opts.limit,
    });
    this.pushTable(
      opts.resultsTable,
      sql`
      select
        value->>'path' as path,
        value->>'title' as title,
        value->>'description' as description,
        value->>'anchor' as anchor,
        value->>'heading' as heading,
        value->>'breadcrumb' as breadcrumb,
        value->>'excerpt' as excerpt,
        value->'tags' as tags,
        value->'related' as related,
        (value->>'word_count')::bigint as word_count,
        (value->>'score')::double as score
      from json.array_each(${new Sql(r)}->'results')
    `,
    );
    return this;
  }

  readDoc(opts: StudioReadDocOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ReadDoc`,
      path: opts.path,
      anchor: opts.anchor,
      include_examples: opts.includeExamples,
    });
    this.pushScalar(opts.contentScalar, sql`${new Sql(r)}->>'content'`);
    if (opts.metadataRecord) {
      this.pushRecord(
        opts.metadataRecord,
        sql`
        select
          ${new Sql(r)}->>'title' as title,
          ${new Sql(r)}->>'description' as description,
          ${new Sql(r)}->'tags' as tags,
          ${new Sql(r)}->'related' as related
      `,
      );
    }
    if (opts.examplesTable) {
      this.pushTable(
        opts.examplesTable,
        sql`
        select
          value->>'name' as name,
          value->>'source_path' as source_path,
          value->>'code' as code
        from json.array_each(coalesce(${new Sql(
          r,
        )}->'examples', json_build_array()))
      `,
      );
    }
    return this;
  }

  listDocs(opts: StudioListDocsOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ListDocs`,
      path: opts.path,
    });
    this.pushTable(
      opts.entriesTable,
      sql`
      select
        value->>'name' as name,
        value->>'entry_type' as entry_type,
        value->>'title' as title,
        value->>'description' as description,
        (value->>'word_count')::bigint as word_count,
        (value->>'file_count')::bigint as file_count
      from json.array_each(${new Sql(r)}->'entries')
    `,
    );
    return this;
  }

  searchExamples(opts: StudioSearchExamplesOpts): this {
    const r = this.studioRequest({
      type: sql.lit`SearchExamples`,
      query: opts.query,
      doc_path: opts.docPath,
      limit: opts.limit,
    });
    this.pushTable(
      opts.resultsTable,
      sql`
      select
        value->>'id' as id,
        value->>'name' as name,
        value->>'source_path' as source_path,
        value->>'doc_path' as doc_path,
        value->>'doc_anchor' as doc_anchor,
        value->>'description' as description,
        value->>'code' as code,
        (value->>'score')::double as score
      from json.array_each(${new Sql(r)}->'results')
    `,
    );
    return this;
  }

  searchApi(opts: StudioSearchApiOpts): this {
    const r = this.studioRequest({
      type: sql.lit`SearchApi`,
      query: opts.query,
      import_path: opts.importPath,
      symbol: opts.symbol,
      kind: opts.kind,
      limit: opts.limit,
    });
    this.pushTable(
      opts.resultsTable,
      sql`
      select
        value->>'import_path' as import_path,
        value->>'symbol' as symbol,
        value->>'kind' as kind,
        value->>'signature' as signature,
        value->>'summary' as summary,
        value->>'dts_path' as dts_path,
        (value->>'score')::double as score
      from json.array_each(${new Sql(r)}->'results')
    `,
    );
    return this;
  }

  readDts(opts: StudioReadDtsOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ReadDts`,
      import_path: opts.importPath,
      symbol: opts.symbol,
      path: opts.path,
    });
    this.pushScalar(opts.contentScalar, sql`${new Sql(r)}->>'content'`);
    return this;
  }

  runBrowserFlow(opts: StudioRunBrowserFlowOpts): this {
    const r = this.studioRequest({
      type: sql.lit`RunBrowserFlow`,
      session_id: opts.sessionId,
      base_url: opts.baseUrl,
      auth_token: opts.authToken,
      commands: opts.commands,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}->>'result'`);
    return this;
  }

  runBrowserScript(opts: StudioRunBrowserScriptOpts): this {
    const r = this.studioRequest({
      type: sql.lit`RunBrowserScript`,
      version: opts.version,
      preview_domain: opts.previewDomain,
      session_id: opts.sessionId,
      auth_token: opts.authToken,
      auth_user_id: opts.authUserId,
      domains: opts.domains,
      code: opts.code,
      args: opts.args,
      timeout_ms: opts.timeoutMs,
      capture_mode: opts.captureMode,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}->>'result'`);
    return this;
  }

  previewFetch(opts: StudioPreviewFetchOpts): this {
    const r = this.studioRequest({
      type: sql.lit`PreviewFetch`,
      version: opts.version,
      preview_domain: opts.previewDomain,
      method: opts.method,
      path: opts.path,
      headers: opts.headers,
      body: opts.body,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  runPreviewScheduledProc(opts: StudioRunPreviewScheduledProcOpts): this {
    const r = this.studioRequest({
      type: sql.lit`RunPreviewScheduledProc`,
      version: opts.version,
      preview_domain: opts.previewDomain,
      name: opts.name,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  queryPreview(opts: StudioQueryPreviewOpts): this {
    const r = this.studioRequest({
      type: sql.lit`QueryPreview`,
      version: opts.version,
      preview_domain: opts.previewDomain,
      query: opts.query,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  queryProduction(opts: StudioQueryProductionOpts): this {
    const r = this.studioRequest({
      type: sql.lit`QueryProduction`,
      query: opts.query,
      row_cap: opts.rowCap,
      explain: opts.explain,
      explain_only: opts.explainOnly,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  modifyPreview(opts: StudioModifyPreviewOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ModifyPreview`,
      version: opts.version,
      preview_domain: opts.previewDomain,
      statement: opts.statement,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    return this;
  }

  queryDatabases(opts: StudioQueryDatabasesOpts): this {
    this.backing.push({
      t: "DevQueryDatabases",
      query: sql.toYOM(opts.query),
      databaseMapping: sql.toYOM(opts.databaseMapping),
      primaryDatabase: sql.toYOM(opts.primaryDatabase),
      resultScalar: opts.resultScalar,
      explain: opts.explain ? sql.toYOM(opts.explain) : undefined,
      explainOnly: opts.explainOnly ? sql.toYOM(opts.explainOnly) : undefined,
      metrics: opts.metrics ? sql.toYOM(opts.metrics) : undefined,
      skipAutoRowCap: opts.skipAutoRowCap
        ? sql.toYOM(opts.skipAutoRowCap)
        : undefined,
      explainScalar: opts.explainScalar,
      metricsScalar: opts.metricsScalar,
    } as yom.DevQueryDatabasesStatement);
    return this;
  }

  applyExternalDbDdl(opts: StudioApplyExternalDbDdlOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ExternalDbDdl`,
      database: opts.database,
      op: opts.op,
    });
    if (opts.resultScalar) {
      this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    }
    return this;
  }

  applyExternalDbDdlSql(opts: StudioApplyExternalDbDdlSqlOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ExternalDbDdlSql`,
      database: opts.database,
      statement: opts.statement,
    });
    if (opts.resultScalar) {
      this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    }
    return this;
  }

  modifyExternalDb(opts: StudioModifyExternalDbOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ExternalDbDml`,
      database: opts.database,
      statement: opts.statement,
      database_mapping: opts.databaseMapping,
    });
    if (opts.resultScalar) {
      this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    }
    return this;
  }

  treeSource(opts: StudioTreeSourceOpts): this {
    const r = this.studioRequest({
      type: sql.lit`TreeSource`,
      path: opts.path,
      depth: opts.depth,
    });
    this.pushScalar(opts.resultScalar, sql`${new Sql(r)}->>'tree'`);
    return this;
  }

  findSource(opts: StudioFindSourceOpts): this {
    const r = this.studioRequest({
      type: sql.lit`FindSource`,
      pattern: opts.pattern,
      path: opts.path,
    });
    this.pushTable(
      opts.resultsTable,
      sql`
      select
        value->>'path' as path,
        (value->>'size')::bigint as size,
        (value->>'is_dir')::bool as is_dir
      from json.array_each(${new Sql(r)}->'matches')
    `,
    );
    return this;
  }

  grepSource(opts: StudioGrepSourceOpts): this {
    const r = this.studioRequest({
      type: sql.lit`GrepSource`,
      pattern: opts.pattern,
      path: opts.path,
    });
    this.pushTable(
      opts.resultsTable,
      sql`
      select
        value->>'path' as path,
        (value->>'match_count')::int as match_count,
        value->>'preview' as preview
      from json.array_each(${new Sql(r)}->'matches')
    `,
    );
    return this;
  }

  readSource(opts: StudioReadSourceOpts): this {
    const r = this.studioRequest({
      type: sql.lit`ReadSource`,
      path: opts.path,
    });
    this.pushScalar(opts.contentScalar, sql`${new Sql(r)}->>'content'`);
    if (opts.sizeScalar) {
      this.pushScalar(opts.sizeScalar, sql`(${new Sql(r)}->>'size')::bigint`);
    }
    return this;
  }

  invalidatePreviews(opts: { version: Sql }): this {
    this.studioRequest({
      type: sql.lit`InvalidatePreviews`,
      version: opts.version,
    });
    return this;
  }

  renderTypst(opts: StudioRenderTypstOpts): this {
    const formatExpr = opts.outputFormat === undefined
      ? sql.lit`pdf`
      : typeof opts.outputFormat === "string"
      ? sql.lit(opts.outputFormat)
      : opts.outputFormat;
    const r = this.studioRequest(
      {
        type: sql.lit`RenderTypst`,
        version: opts.version,
        template: opts.template,
        data: opts.data,
        output_format: formatExpr,
      },
      opts.pdfBytesScalar,
    );
    if (opts.resultScalar) {
      this.pushScalar(opts.resultScalar, sql`${new Sql(r)}`);
    }
    return this;
  }
}

export type GeneralServerStatementsOrFn = StatementsOrFn<
  GeneralServerStatements
>;

/**
 * Statement builder for **scheduled jobs, pipelines, and reactor work** —
 * server execution that is not tied to a specific UI request.
 *
 * Carries the full {@link IServerBaseStatements} surface (transactions,
 * `s.modify`, cursors, `s.forEachQuery`, `s.request`, …) plus
 * `s.setCurrentUser(...)` for jobs that act on behalf of a user. Used
 * as the `s` parameter in `system.scheduledProc`, `system.addPipeline`
 * stage bodies, and `system.addReactor` bodies.
 *
 * @see docs/procedures/server_statements.md
 */
export class GeneralServerStatements
  extends ServerStatementsBase<yom.GeneralServerStatement> {
  static normalize(p: GeneralServerStatementsOrFn | undefined | false | null) {
    return p instanceof GeneralServerStatements
      ? p
      : new GeneralServerStatements().statements(p);
  }

  static normalizeToArray(
    p: GeneralServerStatementsOrFn | undefined | false | null,
  ) {
    return GeneralServerStatements.normalize(p)[BACKING_ARRAY];
  }

  /**
   * Set the user the procedure is running as. Subsequent inserts get this
   * user as `current_user` (and therefore tx_op.tx_creator). Useful in
   * reactors where there's no implicit user context — set it once at the
   * top of the procedure to attribute the agent's work correctly.
   */
  setCurrentUser(user: Sql) {
    this.pushToBacking({
      t: "SetCurrentUser",
      user: sql.toYOM(user),
    } as yom.GeneralServerStatement as any);
    return this;
  }
}

/**
 * Either an {@link EdgeStatements} instance or a builder function. Used
 * everywhere edge handlers are accepted (`onBoot`, `onTimer`, `onReactor`,
 * `onDriver`, edge setup).
 */
export type EdgeStatementsOrFn = StatementsOrFn<EdgeStatements>;

/**
 * Options for {@link EdgeStatements.driverSend} / built from
 * {@link TypedEdgeDriverBinding.send}. Describes a single command
 * dispatched to a bound driver.
 */
export interface EdgeDriverSendOpts {
  /** Name of the driver binding on the edge. */
  driver: string;
  /** Action name supported by the driver type. */
  action: string;
  /** Parameters for the action. */
  params?: Record<string, AnyExpr | undefined>;
  /** How aggressively to persist the command across edge restarts. */
  durability?: yom.EdgeDriverDurability;
  /** Optional command id for tracking / idempotent retry. */
  commandId?: AnyExpr;
}

/**
 * Statement builder for edge handlers. Mixes regular control flow with
 * two edge-specific statements: `s.server(...)` (hop to the database)
 * and `s.driverSend(...)` (dispatch a command to a bound driver).
 *
 * Server blocks must come before any `driverSend` on every reachable
 * path — the compiler validates this. See
 * {@link https://docs.yolm.io/concepts/edges | Edges}.
 */
export class EdgeStatements extends StatementsBase<yom.EdgeStatement> {
  static normalize(p: EdgeStatementsOrFn | undefined | false | null) {
    return p instanceof EdgeStatements ? p : new EdgeStatements().statements(p);
  }

  static normalizeToArray(p: EdgeStatementsOrFn | undefined | false | null) {
    return EdgeStatements.normalize(p)[BACKING_ARRAY];
  }

  server(procedure: GeneralServerStatementsOrFn) {
    this.pushToBacking({
      t: "Server",
      procedure: GeneralServerStatements.normalizeToArray(procedure),
    } as yom.EdgeServerStatement_Server as any);
    return this;
  }

  driverSend(opts: EdgeDriverSendOpts) {
    this.pushToBacking({
      t: "DriverSend",
      driver: opts.driver,
      action: opts.action,
      params: opts.params === undefined ? undefined : Object.fromEntries(
        Object.entries(opts.params)
          .filter((entry): entry is [string, AnyExpr] => entry[1] !== undefined)
          .map(([key, value]) => [key, sql.toYOM(value)]),
      ),
      durability: opts.durability,
      commandId: opts.commandId === undefined
        ? undefined
        : sql.toYOM(opts.commandId),
    } as yom.EdgeDriverSendStatement as any);
    return this;
  }

  kvGet(key: AnyExpr, scalar: string) {
    this.pushToBacking({
      t: "KvGet",
      key: sql.toYOM(key),
      scalar,
    } as yom.EdgeKvGetStatement as any);
    return this;
  }

  kvSet(key: AnyExpr, value: AnyExpr) {
    this.pushToBacking({
      t: "KvSet",
      key: sql.toYOM(key),
      value: sql.toYOM(value),
    } as yom.EdgeKvSetStatement as any);
    return this;
  }

  kvDelete(key: AnyExpr) {
    this.pushToBacking({
      t: "KvDelete",
      key: sql.toYOM(key),
    } as yom.EdgeKvDeleteStatement as any);
    return this;
  }
}

/** A single HTTP header name/value pair for an outbound {@link RequestOpts}. */
export interface RequestHeader {
  name: Sql;
  value: Sql;
}

export type RequestHeaders = RequestHeader[];

/**
 * Options for an outbound HTTP request from a server procedure
 * (`s.request(...)`).
 *
 * Covers URI/method/headers, the request body (`json`, `text`, `bytes`,
 * or `multipart`), response capture (`defReceiveText`/`defReceiveJson`/
 * `defReceiveBytes`, `defResponseRecord`, `defResponseHeadersTable`),
 * `serviceCredentials`/`oauth` for managed auth, and `mockEndpoint`
 * for preview/local-dev stubs.
 *
 * In preview/local-dev runs, external services are gated by the `optIn`
 * flag — set it to `true` (or to a `BooleanExpr`) when the call should
 * actually fire outside production.
 */
interface RequestOptsBase {
  uri: Sql;
  method?: Sql | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
  headers?: RequestHeaders;
  /** Sends json as the body of the request */
  json?: Partial<Record<string, JsonBuildValue>> | Sql | JsonBuildValue[];
  /** Sends text as the body of the request */
  text?: Sql;
  /** Sends bytes as the body of the request */
  bytes?: Sql;
  /** Sends a multipart form (multipart/form-data) request */
  multipart?:
    | Sql
    | {
      name: Sql;
      content_type?: Sql;
      string_value?: Sql;
      bytes_value?: Sql;
      filename?: Sql;
    }[];
  /** Declares a new record containing the response `status` field. */
  defResponseRecord?: string;
  /** Assigns response information into an existing record in scope. */
  setResponseRecord?: string;
  /** @deprecated Use `defResponseRecord` instead. */
  responseRecord?: string;
  /** Declares a new response-header table with `name` and `value` fields. */
  defResponseHeadersTable?: string;
  /** Assigns response headers into an existing table in scope. */
  setResponseHeadersTable?: string;
  /** @deprecated Use `defResponseHeadersTable` instead. */
  responseHeadersTable?: string;
  serviceCredentials?: RequestServiceCredentials;
  oauth?: Oauth;
  /** Mock endpoint handler that runs instead of real HTTP request when preview external services mode blocks requests */
  mockEndpoint?: EndpointStatementsOrFn;
}

interface LegacyRequestReceiveOpts {
  receiveBody?: never;
  /** Declares a new scalar receiving the response body parsed as text. */
  defReceiveText?: string;
  /** Assigns the response body (parsed as text) into an existing scalar in scope. */
  setReceiveText?: string;
  /** @deprecated Use `defReceiveText` instead. */
  receiveText?: string;
  /** Declares a new scalar receiving the response body parsed as JSON. */
  defReceiveJson?: string;
  /** Assigns the response body (parsed as JSON) into an existing scalar in scope. */
  setReceiveJson?: string;
  /** @deprecated Use `defReceiveJson` instead. */
  receiveJson?: string;
  /** Declares a new scalar receiving the response body as raw bytes. */
  defReceiveBytes?: string;
  /** Assigns the response body (raw bytes) into an existing scalar in scope. */
  setReceiveBytes?: string;
  /** @deprecated Use `defReceiveBytes` instead. */
  receiveBytes?: string;
}

interface TaggedRequestReceiveOpts {
  /** A tagged response destination, including direct bounded streaming to a blob. */
  receiveBody: yom.RequestReceiveBody;
  defReceiveText?: never;
  setReceiveText?: never;
  receiveText?: never;
  defReceiveJson?: never;
  setReceiveJson?: never;
  receiveJson?: never;
  defReceiveBytes?: never;
  setReceiveBytes?: never;
  receiveBytes?: never;
}

export interface RequestOpts
  extends RequestOptsBase, LegacyRequestReceiveOpts {}

/**
 * Options for an outbound request using the tagged response destination.
 * Blob destinations stream into blob storage and always require an explicit
 * byte limit and accepted status set.
 */
export interface RequestWithReceiveBodyOpts
  extends RequestOptsBase, TaggedRequestReceiveOpts {}

export type AnyRequestOpts = RequestOpts | RequestWithReceiveBodyOpts;

/** Resolve the one response record and headers binding used by request wrappers. */
export function resolveRequestResponseBindings(requestOpts: AnyRequestOpts) {
  const responseRecordBindings = [
    requestOpts.defResponseRecord,
    requestOpts.setResponseRecord,
    requestOpts.responseRecord,
  ].filter((name): name is string => name !== undefined);
  if (responseRecordBindings.length > 1) {
    throw new Error(
      "Request must specify at most one response record binding",
    );
  }
  const responseHeadersBindings = [
    requestOpts.defResponseHeadersTable,
    requestOpts.setResponseHeadersTable,
    requestOpts.responseHeadersTable,
  ].filter((name): name is string => name !== undefined);
  if (responseHeadersBindings.length > 1) {
    throw new Error(
      "Request must specify at most one response headers binding",
    );
  }
  const responseRecord = responseRecordBindings[0] ?? "response";
  const responseHeadersTable = responseHeadersBindings[0] ??
    "__oauth_response_headers";
  return {
    responseRecord,
    responseHeadersTable,
    defaultBindings: {
      ...(responseRecordBindings.length === 0 ? { responseRecord } : {}),
      ...(responseHeadersBindings.length === 0 ? { responseHeadersTable } : {}),
    },
  };
}

/**
 * Attaches platform-managed credentials to an outbound {@link RequestOpts}.
 * The named managed OAuth credential is resolved and injected by the
 * runtime, so secrets never appear in generated code.
 */
export type RequestServiceCredentials = {
  type: "ManagedOauth";
  credentialId: Sql;
};

/**
 * Options for `s.serviceRequest(...)` — a raw call to a platform service
 * (the low-level form behind {@link SendEmailOpts}, {@link SendSmsOpts},
 * {@link AiGenerateOpts}). Prefer the typed helpers unless you need a
 * service/operation they do not cover.
 */
export interface ServiceUsageOpts {
  /** Local attribution metadata; never forwarded to the provider. */
  usageContext?: Sql;
  /** Declares a JSON scalar with quantities, estimated COGS and rated cost. */
  defUsageScalar?: string;
  /** Assigns usage into an existing JSON scalar, independently of result/error. */
  setUsageScalar?: string;
}

export interface ServiceRequestOpts extends ServiceUsageOpts {
  serviceType: Sql;
  operation: Sql;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
  requestJson: Sql;
  requestBytes?: Sql;
  /** Declares a new scalar receiving the result JSON. Required (use this, `setResultJsonScalar`, or `resultJsonScalar`). */
  defResultJsonScalar?: string;
  /** Assigns the result JSON into an existing scalar in scope. */
  setResultJsonScalar?: string;
  /** @deprecated Use `defResultJsonScalar` instead. */
  resultJsonScalar?: string;
  /** Declares a new scalar receiving the result bytes (when applicable). */
  defResultBytesScalar?: string;
  /** Assigns the result bytes into an existing scalar in scope. */
  setResultBytesScalar?: string;
  /** @deprecated Use `defResultBytesScalar` instead. */
  resultBytesScalar?: string;
  /** Declares a new scalar receiving the error JSON. Required (use this, `setErrorJsonScalar`, or `errorJsonScalar`). */
  defErrorJsonScalar?: string;
  /** Assigns the error JSON into an existing scalar in scope. */
  setErrorJsonScalar?: string;
  /** @deprecated Use `defErrorJsonScalar` instead. */
  errorJsonScalar?: string;
  /** Mock endpoint that runs instead of real service request in dev/test mode */
  mockProcedure?: EndpointStatementsOrFn;
}

/** Authentication for an SFTP connection: password or private key. */
export type SftpAuthOpts =
  | {
    type: "Password";
    password: Sql;
  }
  | {
    type: "PrivateKey";
    privateKey: Sql;
    passphrase?: Sql;
  };

/** Connection details for `s.sftpSend(...)` / `s.sftpReceive(...)`. */
export interface SftpConnectionOpts {
  host: Sql;
  port?: NumericExpr;
  username: Sql;
  auth: SftpAuthOpts;
  hostKey: Sql;
  connectTimeoutMs?: NumericExpr;
  ioTimeoutMs?: NumericExpr;
}

/** Source of the file bytes for {@link SftpSendOpts}: inline bytes or a stored blob. */
export type SftpSendSourceOpts =
  | {
    type: "Bytes";
    bytes: Sql;
  }
  | {
    type: "BlobHash";
    blobHash: Sql;
  };

/** Options for `s.sftpSend(...)` — uploads a file to a remote SFTP server. */
export interface SftpSendOpts {
  connection: SftpConnectionOpts;
  remotePath: Sql;
  source: SftpSendSourceOpts;
  overwrite?: BooleanExpr;
  createParents?: BooleanExpr;
  /** Declares a new scalar receiving the result JSON. */
  defResultJsonScalar?: string;
  /** Assigns the result JSON into an existing scalar in scope. */
  setResultJsonScalar?: string;
  /** @deprecated Use `defResultJsonScalar` instead. */
  resultJsonScalar?: string;
  /** Declares a new scalar receiving the error JSON. */
  defErrorJsonScalar?: string;
  /** Assigns the error JSON into an existing scalar in scope. */
  setErrorJsonScalar?: string;
  /** @deprecated Use `defErrorJsonScalar` instead. */
  errorJsonScalar?: string;
}

/** Destination for the bytes fetched by {@link SftpReceiveOpts}: a bytes scalar or a stored blob. */
export type SftpReceiveDestinationOpts =
  | {
    type: "BytesScalar";
    /** Declares a new scalar receiving the file bytes. */
    defContentScalar?: string;
    /** Assigns file bytes into an existing scalar in scope. */
    setContentScalar?: string;
    /** @deprecated Use `defContentScalar` instead. */
    contentScalar?: string;
  }
  | {
    type: "BlobHashScalar";
    /** Declares a new scalar receiving the blob hash. */
    defBlobHashScalar?: string;
    /** Assigns the blob hash into an existing scalar in scope. */
    setBlobHashScalar?: string;
    /** @deprecated Use `defBlobHashScalar` instead. */
    blobHashScalar?: string;
  };

/** Options for `s.sftpReceive(...)` — downloads a file from a remote SFTP server. */
export interface SftpReceiveOpts {
  connection: SftpConnectionOpts;
  remotePath: Sql;
  destination: SftpReceiveDestinationOpts;
  /** Declares a new scalar receiving the result JSON. */
  defResultJsonScalar?: string;
  /** Assigns the result JSON into an existing scalar in scope. */
  setResultJsonScalar?: string;
  /** @deprecated Use `defResultJsonScalar` instead. */
  resultJsonScalar?: string;
  /** Declares a new scalar receiving the error JSON. */
  defErrorJsonScalar?: string;
  /** Assigns the error JSON into an existing scalar in scope. */
  setErrorJsonScalar?: string;
  /** @deprecated Use `defErrorJsonScalar` instead. */
  errorJsonScalar?: string;
}

/** A single attachment for an outgoing email. */
export interface EmailAttachment {
  /** Filename shown to the recipient. */
  name: Sql | string;
  /** Attachment contents (typically a SQL blob expression). */
  content: Sql;
  /** MIME type (e.g. `"application/pdf"`). */
  contentType: Sql | string;
}

/** Options for `s.sendEmail(...)` — a provider-agnostic email send. */
export interface SendEmailOpts extends ServiceUsageOpts {
  from: Sql | string;
  to: Sql | string;
  cc?: Sql | string;
  bcc?: Sql | string;
  replyTo?: Sql | string;
  subject: Sql | string;
  textBody?: Sql | string;
  htmlBody?: Sql | string;
  idempotencyKey?: Sql | string;
  tag?: Sql | string;
  messageStream?: Sql | string;
  metadata?: Sql;
  attachments?: EmailAttachment[];
  /** A runtime-built attachment array. Do not combine with `attachments`. */
  attachmentsJson?: Sql;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
  resultJsonScalar?: string;
  errorJsonScalar?: string;
  /** Mock endpoint that runs instead of real email send in dev/test mode */
  mockProcedure?: EndpointStatementsOrFn;
}

/** Options for `s.sendBulkEmail(...)` — a provider-agnostic bulk email send. */
export interface SendBulkEmailOpts extends ServiceUsageOpts {
  from: Sql | string;
  replyTo?: Sql | string;
  subject: Sql | string;
  htmlBody?: Sql | string;
  textBody?: Sql | string;
  tag?: Sql | string;
  /**
   * Runtime-built array of recipient objects containing recipientKey, to,
   * templateModel, and optional caller-owned metadata.
   */
  recipientsJson: Sql;
  /** Shared immutable blob attachments sent to every recipient. */
  attachments?: BulkEmailAttachment[];
  /** Runtime-built shared attachment array containing name, contentType, and blobHash. */
  attachmentsJson?: Sql;
  /** Caller-owned correlation key; this does not promise provider idempotency. */
  submissionKey: Sql | string;
  /** Required in preview/local-dev when external services mode is opt-in. */
  optIn?: BooleanExpr;
  /** Declares a new scalar receiving the normalized submission result. */
  defResultJsonScalar?: string;
  /** Assigns the normalized submission result into an existing scalar. */
  setResultJsonScalar?: string;
  /** @deprecated Use `defResultJsonScalar` instead. */
  resultJsonScalar?: string;
  /** Declares a new scalar receiving a structured service error. */
  defErrorJsonScalar?: string;
  /** Assigns a structured service error into an existing scalar. */
  setErrorJsonScalar?: string;
  /** @deprecated Use `defErrorJsonScalar` instead. */
  errorJsonScalar?: string;
  /** Mock endpoint that runs instead of the real bulk email send. */
  mockProcedure?: EndpointStatementsOrFn;
}

/** A shared blob attachment for a bulk email submission. */
export interface BulkEmailAttachment {
  /** Filename shown to the recipient. */
  name: Sql | string;
  /** MIME type (e.g. `"application/pdf"`). */
  contentType: Sql | string;
  /** A BlobRef/Bytes(32) expression resolved by the platform at dispatch time. */
  blobHash: Sql;
}

/** Options for `s.sendSms(...)` — a provider-agnostic SMS send. */
export interface SendSmsOpts extends ServiceUsageOpts {
  to: Sql | string;
  body: Sql | string;
  from: Sql | string;
  idempotencyKey?: Sql | string;
  metadata?: Sql;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
  resultJsonScalar?: string;
  errorJsonScalar?: string;
  /** Mock endpoint that runs instead of real SMS send in dev/test mode */
  mockProcedure?: EndpointStatementsOrFn;
}

/** Options for `s.sendWebPush(...)` — sends one payload to one browser subscription. */
export interface SendWebPushOpts {
  endpoint: Sql;
  p256dh: Sql;
  auth: Sql;
  vapidKeyId: Sql;
  payload: Sql;
  ttlSeconds?: NumericExpr;
  urgency?: Sql;
  topic?: Sql;
  /** Required in preview/local-dev when external services mode is opt-in. */
  optIn?: BooleanExpr;
  resultJsonScalar?: string;
  errorJsonScalar?: string;
  mockProcedure?: EndpointStatementsOrFn;
}

/** Optimization axis for AI model routing in {@link AiGenerateIntentOpts}. */
export type AiPriorityV1 = "balanced" | "speed" | "cost" | "quality";
/** Task category that steers AI model selection in {@link AiGenerateIntentOpts}. */
export type AiTaskV1 =
  | "general"
  | "agentic"
  | "extraction"
  | "summarization"
  | "classification"
  | "creative"
  | "code"
  | "research"
  | "review";
/** What to do when no model matches the requested intent: hard-fail or fall back to the closest match. */
export type AiNoMatchPolicyV1 = "fail" | "best_effort";
/** Whether provider-side prompt caching is used for an AI request. */
export type AiCacheModeV1 = "default" | "off";
/** Provider queue-tier hint for an AI request (see {@link AiGenerateIntentOpts.queueTier}). */
export type AiQueueTierV1 = "priority";

/** Routing intent for {@link AiGenerateOpts.intent} — describes the task so the platform can pick a model. */
export interface AiGenerateIntentOpts {
  task: Sql | AiTaskV1 | AiTaskV1[];
  priority?: Sql | AiPriorityV1;
  constraints?: Sql;
  noMatchPolicy?: Sql | AiNoMatchPolicyV1;
  forceProvider?: Sql;
  forceModel?: Sql;
  /**
   * Provider-side queue tier hint. Currently honored by Fireworks
   * (emits `service_tier: "priority"`) and ignored elsewhere.
   */
  queueTier?: Sql | AiQueueTierV1;
}

/**
 * Options for `s.aiGenerate(...)`. The required {@link AiGenerateIntentOpts}
 * `intent` selects a model; `messages`/`system` are the prompt; results and
 * errors are written to the named scalars.
 */
export interface AiGenerateOpts extends ServiceUsageOpts {
  intent: AiGenerateIntentOpts;
  messages: Sql;
  system?: Sql;
  generation?: Sql;
  reasoning?: Sql;
  cacheMode?: Sql | AiCacheModeV1;
  timeoutMs?: NumericExpr;
  metadata?: Sql;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
  resultJsonScalar: string;
  errorJsonScalar: string;
  /** Mock endpoint that runs instead of real AI generation in dev/test mode */
  mockProcedure?: EndpointStatementsOrFn;
}

/**
 * Options for `s.aiListModels(...)`. The operation reads platform AI metadata
 * and does not contact providers.
 */
export interface AiListModelsOpts {
  /** Accepted for consistency with service requests; not required for metadata-only listing. */
  optIn?: BooleanExpr;
  resultJsonScalar: string;
  errorJsonScalar: string;
  /** Mock endpoint that runs instead of real model listing in dev/test mode */
  mockProcedure?: EndpointStatementsOrFn;
}

/**
 * OAuth configuration for an outbound {@link RequestOpts}. Currently only
 * the service-account (JWT-bearer) grant is supported: the runtime signs a
 * token with `privateKey` and exchanges it at `tokenUri` for the request.
 */
export type Oauth =
  // | {
  //     type: "ClientCredentialsGrant";
  //     key: Sql;
  //     clientId: Sql;
  //     clientSecret: Sql;
  //     tokenUrl: Sql;
  //     scope: Sql;
  //   }
  {
    type: "ServiceAccount";
    privateKey: Sql;
    tokenUri: Sql;
    clientEmail: Sql;
    scope: Sql;
  };

function toSqlExpr(v: AnyExpr | string): Sql {
  return typeof v === "string" ? sql.lit(v) : sql.normalizeExpr(v);
}

/**
 * Resolves a tri-state output binding `(def, set, legacy)` into the two
 * mutually-exclusive wire fields the Rust compiler accepts: the legacy field
 * (def-style; declares a new local) and the `setX` field (set-style; assigns
 * into an existing local). Throws if more than one of the three is provided.
 *
 * `legacy` is the deprecated unprefixed alias (e.g. `receiveText` for
 * `defReceiveText`). `paramName` names the parameter for the error message.
 */
function resolveDefSet(
  paramName: string,
  defValue: string | undefined,
  setValue: string | undefined,
  legacyValue: string | undefined,
): { defValue: string | undefined; setValue: string | undefined } {
  let provided = 0;
  if (defValue !== undefined) provided++;
  if (setValue !== undefined) provided++;
  if (legacyValue !== undefined) provided++;
  if (provided > 1) {
    const cap = paramName.charAt(0).toUpperCase() + paramName.slice(1);
    throw new Error(
      `Cannot specify more than one of def${cap}, set${cap}, ${paramName}`,
    );
  }
  return {
    defValue: defValue ?? legacyValue,
    setValue,
  };
}

function validateRequestReceiveBody(
  receiveBody: yom.RequestReceiveBody,
): yom.RequestReceiveBody {
  const hasScalar = receiveBody.scalar !== undefined;
  const hasSetScalar = receiveBody.setScalar !== undefined;
  if (hasScalar === hasSetScalar) {
    throw new Error(
      "Request receiveBody must specify exactly one of scalar or setScalar",
    );
  }
  if (receiveBody.type !== "Blob") return receiveBody;
  if (
    !Number.isSafeInteger(receiveBody.maxBytes) || receiveBody.maxBytes <= 0
  ) {
    throw new Error(
      "Blob receiveBody maxBytes must be a positive safe integer",
    );
  }
  if (receiveBody.acceptedStatuses.length === 0) {
    throw new Error("Blob receiveBody acceptedStatuses must not be empty");
  }
  const statuses = new Set<number>();
  for (const status of receiveBody.acceptedStatuses) {
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
      throw new Error(
        "Blob receiveBody acceptedStatuses must contain HTTP status integers from 100 through 599",
      );
    }
    if (statuses.has(status)) {
      throw new Error(
        "Blob receiveBody acceptedStatuses must not contain duplicates",
      );
    }
    statuses.add(status);
  }
  return receiveBody;
}

function legacyRequestReceiveBody(
  type: "Text" | "Json" | "Bytes",
  binding: { defValue?: string; setValue?: string },
): yom.RequestReceiveBody | undefined {
  if (binding.defValue !== undefined) {
    return { type, scalar: binding.defValue };
  }
  if (binding.setValue !== undefined) {
    return { type, setScalar: binding.setValue };
  }
  return undefined;
}

function requestOptsToStatement(opts: AnyRequestOpts): yom.RequestStatement {
  let sendBody: yom.SendBody | undefined;
  if (opts.json) {
    let expr: yom.SqlExpression;
    if (sql.isAnyExpr(opts.json)) {
      expr = sql.toYOM(opts.json);
    } else if (Array.isArray(opts.json)) {
      expr = sql.jsonBuildArray(opts.json).toYOM();
    } else {
      expr = sql.jsonBuildObject(opts.json).toYOM();
    }
    sendBody = { type: "Json", expr };
  }
  if (opts.text) {
    if (sendBody) {
      throw new Error("Cannot specify both json and text");
    }
    sendBody = { type: "Text", expr: sql.toYOM(opts.text) };
  }
  if (opts.bytes) {
    if (sendBody) {
      throw new Error("Cannot specify both json and bytes");
    }
    sendBody = { type: "Bytes", expr: sql.toYOM(opts.bytes) };
  }
  if (opts.multipart) {
    if (sendBody) {
      throw new Error("Cannot specify both json and multipart");
    }
    sendBody = {
      type: "Multipart",
      query: Array.isArray(opts.multipart)
        ? sql.fromArray(opts.multipart).toYOM()
        : opts.multipart.toYOM(),
    };
  }
  const text = resolveDefSet(
    "receiveText",
    opts.defReceiveText,
    opts.setReceiveText,
    opts.receiveText,
  );
  const json = resolveDefSet(
    "receiveJson",
    opts.defReceiveJson,
    opts.setReceiveJson,
    opts.receiveJson,
  );
  const bytes = resolveDefSet(
    "receiveBytes",
    opts.defReceiveBytes,
    opts.setReceiveBytes,
    opts.receiveBytes,
  );
  let receiveBody = opts.receiveBody === undefined
    ? undefined
    : validateRequestReceiveBody(opts.receiveBody);
  if (text.defValue !== undefined || text.setValue !== undefined) {
    if (receiveBody) {
      throw new Error("Cannot specify more than one receive body kind");
    }
    receiveBody = legacyRequestReceiveBody("Text", text);
  }
  if (json.defValue !== undefined || json.setValue !== undefined) {
    if (receiveBody) {
      throw new Error("Cannot specify more than one receive body kind");
    }
    receiveBody = legacyRequestReceiveBody("Json", json);
  }
  if (bytes.defValue !== undefined || bytes.setValue !== undefined) {
    if (receiveBody) {
      throw new Error("Cannot specify more than one receive body kind");
    }
    receiveBody = legacyRequestReceiveBody("Bytes", bytes);
  }
  const responseRecordResolved = resolveDefSet(
    "responseRecord",
    opts.defResponseRecord,
    opts.setResponseRecord,
    opts.responseRecord,
  );
  const responseHeadersTableResolved = resolveDefSet(
    "responseHeadersTable",
    opts.defResponseHeadersTable,
    opts.setResponseHeadersTable,
    opts.responseHeadersTable,
  );
  let method: yom.SqlExpression;
  if (opts.method) {
    if (typeof opts.method === "string") {
      method = sql.lit(opts.method).toYOM();
    } else {
      method = sql.toYOM(opts.method);
    }
  } else {
    method = "'GET'";
  }
  return {
    t: "Request",
    uri: sql.toYOM(opts.uri),
    method,
    optIn: opts.optIn !== undefined ? sql.toYOM(opts.optIn) : undefined,
    headers: opts.headers?.map((h) => ({
      name: sql.toYOM(h.name),
      value: sql.toYOM(h.value),
    })),
    sendBody,
    receiveBody,
    responseHeadersTable: responseHeadersTableResolved.defValue,
    setResponseHeadersTable: responseHeadersTableResolved.setValue,
    responseRecord: responseRecordResolved.defValue,
    setResponseRecord: responseRecordResolved.setValue,
    serviceCredentials: opts.serviceCredentials
      ? {
        type: opts.serviceCredentials.type,
        credentialId: sql.toYOM(opts.serviceCredentials.credentialId),
      }
      : undefined,
    oauth:
      // opts.oauth?.type === "ClientCredentialsGrant"
      //   ? {
      //       type: opts.oauth.type,
      //       key: sql.toYOM(opts.oauth.key),
      //       clientId: sql.toYOM(opts.oauth.clientId),
      //       clientSecret: sql.toYOM(opts.oauth.clientSecret),
      //       tokenUrl: sql.toYOM(opts.oauth.tokenUrl),
      //       scope: sql.toYOM(opts.oauth.scope),
      //     }
      opts.oauth?.type === "ServiceAccount"
        ? {
          type: opts.oauth.type,
          privateKey: sql.toYOM(opts.oauth.privateKey),
          tokenUri: sql.toYOM(opts.oauth.tokenUri),
          clientEmail: sql.toYOM(opts.oauth.clientEmail),
          scope: sql.toYOM(opts.oauth.scope),
        }
        : undefined,
    mockEndpoint: opts.mockEndpoint
      ? EndpointStatements.normalizeToArray(opts.mockEndpoint)
      : undefined,
  };
}

function sftpConnectionOptsToYom(
  connection: SftpConnectionOpts,
): yom.SftpConnection {
  const auth: yom.SftpAuth = connection.auth.type === "Password"
    ? {
      type: "Password",
      password: sql.toYOM(connection.auth.password),
    }
    : {
      type: "PrivateKey",
      privateKey: sql.toYOM(connection.auth.privateKey),
      passphrase: connection.auth.passphrase
        ? sql.toYOM(connection.auth.passphrase)
        : undefined,
    };
  return {
    host: sql.toYOM(connection.host),
    port: connection.port !== undefined
      ? sql.toYOM(connection.port)
      : undefined,
    username: sql.toYOM(connection.username),
    auth,
    hostKey: sql.toYOM(connection.hostKey),
    connectTimeoutMs: connection.connectTimeoutMs !== undefined
      ? sql.toYOM(connection.connectTimeoutMs)
      : undefined,
    ioTimeoutMs: connection.ioTimeoutMs !== undefined
      ? sql.toYOM(connection.ioTimeoutMs)
      : undefined,
  };
}

interface SpawnOpts<T> {
  procedure: StatementsOrFn<T>;
  detached?: boolean;
  handleScalar?: string;
}

/**
 * Options for `s.dynamicQuery(...)` — runs a query built at runtime and
 * captures its rows (plus optional column metadata and metrics). The
 * table whitelists/blacklists and scope restrictions bound what the
 * runtime SQL may touch; use them to keep admin-style queries safe.
 */
export interface DynamicQueryOpts extends DynamicQueryExecutionPolicyOpts {
  query: Sql;
  /** Declares a new table to receive the query results. */
  defResultTable?: string;
  /** Assigns the query results into an existing table in scope. */
  setResultTable?: string;
  /** @deprecated Use `defResultTable` instead. */
  resultTable?: string;
  columnCount: number;
  /** Declares a new table for column metadata, when requested. */
  defColumnMetaTable?: string;
  /** Assigns column metadata into an existing table in scope. */
  setColumnMetaTable?: string;
  /** @deprecated Use `defColumnMetaTable` instead. */
  columnMetaTable?: string;
  skipAutoRowCap?: BooleanExpr;
  /** Maximum rows materialized without changing authored SQL semantics. */
  rowCap?: NumericExpr;
  /** Declares a boolean scalar that is true only when a probe row was omitted. */
  defHasMoreScalar?: string;
  /** Assigns the exact truncation flag into an existing boolean scalar. */
  setHasMoreScalar?: string;
  /** Declares a new scalar receiving query metrics JSON. */
  defMetricsScalar?: string;
  /** Assigns query metrics JSON into an existing scalar in scope. */
  setMetricsScalar?: string;
  /** @deprecated Use `defMetricsScalar` instead. */
  metricsScalar?: string;
}

/** Shared options for the `s.dynamicQueryToCsv(...)` overloads. */
export interface DynamicQueryToCsvOpts extends DynamicQueryExecutionPolicyOpts {
  /** Disable the automatic row-count cap on the runtime query. */
  skipAutoRowCap?: BooleanExpr;
  rowCap?: NumericExpr;
  defHasMoreScalar?: string;
  setHasMoreScalar?: string;
}

export interface DownloadDynamicQueryCsvOpts extends DynamicQueryToCsvOpts {
  contentType?: Sql;
}

export interface DynamicQueryToCsvWithDefScalarOpts
  extends DynamicQueryToCsvOpts {
  /** Declares a new scalar receiving the CSV-formatted result. */
  defScalar: string;
}

export interface DynamicQueryToCsvWithSetScalarOpts
  extends DynamicQueryToCsvOpts {
  /** Assigns the CSV-formatted result into an existing scalar in scope. */
  setScalar: string;
}

/**
 * Native JSON row-object output. Big integers and decimals are strings, bytes
 * are lowercase hex, SQL JSON values stay nested, and non-finite floats become
 * JSON null so the result is always valid JSON.
 */
export interface DynamicQueryToJsonOpts
  extends DynamicQueryExecutionPolicyOpts {
  skipAutoRowCap?: BooleanExpr;
  rowCap?: NumericExpr;
  defHasMoreScalar?: string;
  setHasMoreScalar?: string;
}

export interface DynamicQueryToJsonWithDefScalarOpts
  extends DynamicQueryToJsonOpts {
  defScalar: string;
}

export interface DynamicQueryToJsonWithSetScalarOpts
  extends DynamicQueryToJsonOpts {
  setScalar: string;
}

/** Options for `s.dynamicExplainQuery(...)` — captures the explain plan of a runtime-built query. */
export interface DynamicExplainQueryOpts {
  query: Sql;
  /** Declares a new scalar receiving the explain plan text. */
  defResultScalar?: string;
  /** Assigns the explain plan text into an existing scalar in scope. */
  setResultScalar?: string;
  /** @deprecated Use `defResultScalar` instead. */
  resultScalar?: string;
  tableWhitelist?: Sql;
  tableBlacklist?: Sql;
  viewWhitelist?: Sql;
  viewBlacklist?: Sql;
  fieldWhitelist?: Sql;
  fieldBlacklist?: Sql;
}

export interface DynamicQueryPolicyOpts {
  tableWhitelist?: Sql;
  tableBlacklist?: Sql;
  viewWhitelist?: Sql;
  viewBlacklist?: Sql;
  fieldWhitelist?: Sql;
  fieldBlacklist?: Sql;
}

export interface DynamicQueryExecutionPolicyOpts
  extends DynamicQueryPolicyOpts {
  accessibleTableScopes?: ("proc" | "ui")[];
  tableScopeWhitelist?: string[];
  tableScopeBlacklist?: string[];
}

/**
 * Per-table configuration for ranked search. Passed via
 * {@link TableBuilder.searchConfig} or used directly with
 * {@link tableSearchToYom}.
 *
 * See {@link https://docs.yolm.io/database/search_config | Search config}.
 */
export interface RankedSearchTable {
  /** Table being searched. */
  table: string | Sql;
  /** Restrict the rows considered by the search. */
  filterExpr?: BooleanExpr;
  /** Disable this entry entirely (useful for conditional configs). */
  disabled?: BooleanExpr;
  /** Per-field weighting. */
  fields?: {
    field: string | Sql;
    /** The lower the priority number, the higher the priority */
    priority: number;
  }[];
  /** Per-field-group weighting (rows where any field in the group matches). */
  fieldGroups?: {
    fields: (string | Sql)[];
    /** The lower the priority number, the higher the priority */
    priority: number;
  }[];
  /** Related tables included in the same ranking. */
  relatedTables?: RelatedRankedSearchTable[];
}

/** A {@link RankedSearchTable} reached via a foreign-key relation. */
export interface RelatedRankedSearchTable extends RankedSearchTable {
  /** Foreign-key field linking the related table to the base table. */
  relationField: string;
}

/** Top-level config consumed by {@link IServerBaseStatements.search}. */
export interface RankedSearchConfig {
  /** Tokenizer applied to the search input. */
  tokenizer: yom.Tokenizer;
  /** Match style (Fuzzy / Exact / …). */
  style: yom.RankedSearchStyle;
  /** Tables searched, each with its own ranking config. */
  tables: RankedSearchTable[];
}

/** Options for `s.search(...)`: configure a ranked search and pop results into a result table. */
export interface SearchOpts {
  /** Name of the in-memory table that receives the search results. */
  resultTable: string | Sql;
  /** Ranking configuration. */
  config: RankedSearchConfig;
  /** Query string (user input). */
  query: Sql;
  /** Optional row offset. */
  offset?: NumericExpr;
  /** Maximum number of results. */
  limit: NumericExpr;
}

export function tableSearchToYom(t: RankedSearchTable): yom.RankedSearchTable {
  return {
    table: normalizeIdent(t.table).toYOM(),
    disabled: t.disabled !== undefined ? sql.toYOM(t.disabled) : undefined,
    filterExpr: t.filterExpr !== undefined
      ? sql.toYOM(t.filterExpr)
      : undefined,
    fields: t.fields?.map((f) => ({
      field: normalizeIdent(f.field).toYOM(),
      priority: f.priority,
    })),
    fieldGroups: t.fieldGroups?.map((g) => ({
      fields: g.fields.map((f) => normalizeIdent(f).toYOM()),
      priority: g.priority,
    })),
    relatedTables: t.relatedTables?.map((t) => ({
      relationField: t.relationField,
      ...tableSearchToYom(t),
    })),
  };
}

function searchOptsToStatement(opts: SearchOpts): yom.SearchStatement {
  return {
    t: "Search",
    resultTable: normalizeIdent(opts.resultTable).toYOM(),
    limit: sql.toYOM(opts.limit),
    query: sql.toYOM(opts.query),
    offset: opts.offset !== undefined ? sql.toYOM(opts.offset) : undefined,
    config: {
      style: opts.config.style,
      tokenizer: opts.config.tokenizer,
      tables: opts.config.tables.map(tableSearchToYom),
    },
  };
}

/** Attributes applied when setting a cookie via `setCookie(...)`. */
export interface CookieOptions {
  domain?: Sql | string;
  path?: Sql | string;
  expires?: Sql | string;
  secure?: BooleanExpr;
  httpOnly?: BooleanExpr;
  sameSite?: Sql | string;
}

/** Either a {@link UiServerStatements} instance or a builder function. */
export type UiServerStatementsOrFn = StatementsOrFn<UiServerStatements>;

/**
 * Builder function that works against any concrete server-statement class
 * (both {@link UiServerStatements} and {@link GeneralServerStatements}).
 * Use this as the parameter type for helpers that produce server work
 * which should be callable from both UI and non-UI contexts.
 */
export type GenericServerStatementsFn = <T extends IServerBaseStatements>(
  s: T,
) => void;

/**
 * Statement builder for **server work invoked from the UI** — the body of
 * `s.server(...)` callbacks from `DomStatements`, and `Form`'s server
 * hooks (`beforeTransactionStart`, `afterTransactionStart`,
 * `beforeTransactionCommit`, `afterTransactionCommit`, `onSubmitServerError`).
 *
 * Differs from {@link GeneralServerStatements} in that it knows about
 * the originating request and can navigate (`s.navigate`), read/set
 * cookies and headers, refetch UI-side `Data`, and read uploaded DOM
 * files. Use this when the UI is waiting on the result;
 * `GeneralServerStatements` is for fire-and-forget scheduled work.
 *
 * @see docs/procedures/server_statements.md
 */
export class UiServerStatements
  extends ServerStatementsBase<yom.UiServerProcStatement> {
  static normalize(p: UiServerStatementsOrFn | false | undefined | null) {
    return p instanceof UiServerStatements
      ? p
      : new UiServerStatements().statements(p);
  }

  static normalizeToArray(
    p: UiServerStatementsOrFn | false | undefined | null,
  ) {
    return UiServerStatements.normalize(p)[BACKING_ARRAY];
  }

  navigate(to: Sql | string, replace?: BooleanExpr) {
    this.pushToBacking({
      t: "Navigate",
      to: typeof to === "string" ? sql.lit(to).toYOM() : sql.toYOM(to),
      replace: replace !== undefined ? sql.toYOM(replace) : undefined,
    });
    return this;
  }

  setQueryParam(param: string, value: Sql, replace?: BooleanExpr) {
    this.pushToBacking({
      t: "SetQueryParam",
      param,
      value: sql.toYOM(value),
      replace: replace !== undefined ? sql.toYOM(replace) : undefined,
    });
    return this;
  }

  /** @deprecated Pass `{ defScalar }` as the second argument instead. */
  getHeader(name: Sql, scalar: string): this;
  getHeader(name: Sql, opts: { defScalar: string }): this;
  getHeader(name: Sql, opts: { setScalar: string }): this;
  getHeader(
    name: Sql,
    scalarOrOpts: string | { defScalar: string } | { setScalar: string },
  ): this {
    let scalar: string | undefined;
    let setScalar: string | undefined;
    if (typeof scalarOrOpts === "string") {
      scalar = scalarOrOpts;
    } else if ("defScalar" in scalarOrOpts) {
      scalar = scalarOrOpts.defScalar;
    } else {
      setScalar = scalarOrOpts.setScalar;
    }
    this.pushToBacking({
      t: "GetHeader",
      name: sql.toYOM(name),
      scalar,
      setScalar,
    });
    return this;
  }

  /** @deprecated Pass `{ defRecord }` as the second argument instead. */
  getCookie(name: Sql, record: string): this;
  getCookie(name: Sql, opts: { defRecord: string }): this;
  getCookie(name: Sql, opts: { setRecord: string }): this;
  getCookie(
    name: Sql,
    recordOrOpts: string | { defRecord: string } | { setRecord: string },
  ): this {
    let record: string | undefined;
    let setRecord: string | undefined;
    if (typeof recordOrOpts === "string") {
      record = recordOrOpts;
    } else if ("defRecord" in recordOrOpts) {
      record = recordOrOpts.defRecord;
    } else {
      setRecord = recordOrOpts.setRecord;
    }
    this.pushToBacking({
      t: "GetCookie",
      name: sql.toYOM(name),
      record,
      setRecord,
    });
    return this;
  }

  setCookie(name: Sql, value: Sql, options: CookieOptions = {}) {
    this.pushToBacking({
      t: "SetCookie",
      name: sql.toYOM(name),
      value: sql.toYOM(value),
      domain: options.domain
        ? typeof options.domain === "string"
          ? sql.lit(options.domain).toYOM()
          : sql.toYOM(options.domain)
        : undefined,
      path: options.path
        ? typeof options.path === "string"
          ? sql.lit(options.path).toYOM()
          : sql.toYOM(options.path)
        : undefined,
      expires: options.expires
        ? typeof options.expires === "string"
          ? sql.lit(options.expires).toYOM()
          : sql.toYOM(options.expires)
        : undefined,
      secure: options.secure ? sql.toYOM(options.secure) : undefined,
      httpOnly: options.httpOnly ? sql.toYOM(options.httpOnly) : undefined,
      sameSite: options.sameSite
        ? typeof options.sameSite === "string"
          ? sql.lit(options.sameSite).toYOM()
          : sql.toYOM(options.sameSite)
        : undefined,
    });
    return this;
  }

  removeCookie(name: Sql) {
    this.pushToBacking({
      t: "RemoveCookie",
      name: sql.toYOM(name),
    });
    return this;
  }

  refetch(): this {
    this.increment("global_refetch_key");
    return this;
  }

  readDomFile(fileId: Sql, bodyScalar = "body") {
    this.pushToBacking({
      t: "ReadDomFile",
      bodyScalar,
      fileId: sql.toYOM(fileId),
    });
    return this;
  }
}

/** Either an {@link AuthorizeStatements} instance or a builder function. */
export type AuthorizeStatementsOrFn = StatementsOrFn<AuthorizeStatements>;

/**
 * Statement builder used in the `procedure` of the
 * [`Authorize`](../std/ui.tsx#Authorize) component and on Api endpoints'
 * authorization callbacks. Returns true (authorized) by allowing the
 * procedure to fall through, or null/false to deny.
 */
export class AuthorizeStatements
  extends StatementsBase<yom.AuthorizeStatement> {
  static normalize(p: AuthorizeStatementsOrFn | undefined | null | false) {
    return p instanceof AuthorizeStatements
      ? p
      : new AuthorizeStatements().statements(p);
  }

  static normalizeToArray(
    p: AuthorizeStatementsOrFn | undefined | null | false,
  ) {
    return AuthorizeStatements.normalize(p)[BACKING_ARRAY];
  }

  /** @deprecated Pass `{ defRecord }` as the second argument instead. */
  getCookie(name: Sql | string, record: string): this;
  getCookie(name: Sql | string, opts: { defRecord: string }): this;
  getCookie(name: Sql | string, opts: { setRecord: string }): this;
  getCookie(
    name: Sql | string,
    recordOrOpts: string | { defRecord: string } | { setRecord: string },
  ): this {
    let record: string | undefined;
    let setRecord: string | undefined;
    if (typeof recordOrOpts === "string") {
      record = recordOrOpts;
    } else if ("defRecord" in recordOrOpts) {
      record = recordOrOpts.defRecord;
    } else {
      setRecord = recordOrOpts.setRecord;
    }
    this.pushToBacking({
      t: "GetCookie",
      name: typeof name === "string" ? sql.lit(name).toYOM() : sql.toYOM(name),
      record,
      setRecord,
    });
    return this;
  }

  setCurrentUser(user: Sql) {
    this.pushToBacking({
      t: "SetCurrentUser",
      user: sql.toYOM(user),
    });
    return this;
  }

  /** Set the ambient JSON request context; read back via `current_context()`. */
  setContext(context: Sql) {
    this.pushToBacking({
      t: "SetContext",
      context: sql.toYOM(context),
    });
    return this;
  }

  /** Calls reusable server-side authorization logic. */
  callStoredProcedure(name: string, opts: CallStoredProcedureOpts = {}): this {
    this.pushToBacking(callStoredProcedureStatement(name, opts));
    return this;
  }
}

/** Either a {@link StateStatements} instance or a builder function. */
export type StateStatementsOrFn = StatementsOrFn<StateStatements>;

/**
 * Statement builder for the `procedure` of a {@link State} component.
 * Server-side execution scoped to a UI state — has the full server
 * surface plus state-specific helpers like `forceServer()` and cookie /
 * header readers.
 */
export class StateStatements extends ServerStatementsBase<yom.StateStatement> {
  static normalize(p: StateStatementsOrFn | undefined | null | false) {
    return p instanceof StateStatements
      ? p
      : new StateStatements().statements(p);
  }

  static normalizeToArray(p: StateStatementsOrFn | undefined | null | false) {
    return StateStatements.normalize(p)[BACKING_ARRAY];
  }

  forceServer() {
    this.pushToBacking({ t: "ForceServer" });
    return this;
  }

  /** @deprecated Pass `{ defRecord }` as the second argument instead. */
  getCookie(name: Sql | string, record: string): this;
  getCookie(name: Sql | string, opts: { defRecord: string }): this;
  getCookie(name: Sql | string, opts: { setRecord: string }): this;
  getCookie(
    name: Sql | string,
    recordOrOpts: string | { defRecord: string } | { setRecord: string },
  ): this {
    let record: string | undefined;
    let setRecord: string | undefined;
    if (typeof recordOrOpts === "string") {
      record = recordOrOpts;
    } else if ("defRecord" in recordOrOpts) {
      record = recordOrOpts.defRecord;
    } else {
      setRecord = recordOrOpts.setRecord;
    }
    this.pushToBacking({
      t: "GetCookie",
      name: typeof name === "string" ? sql.lit(name).toYOM() : sql.toYOM(name),
      record,
      setRecord,
    });
    return this;
  }

  /** @deprecated Pass `{ defScalar }` as the second argument instead. */
  getHeader(name: Sql, scalar: string): this;
  getHeader(name: Sql, opts: { defScalar: string }): this;
  getHeader(name: Sql, opts: { setScalar: string }): this;
  getHeader(
    name: Sql,
    scalarOrOpts: string | { defScalar: string } | { setScalar: string },
  ): this {
    let scalar: string | undefined;
    let setScalar: string | undefined;
    if (typeof scalarOrOpts === "string") {
      scalar = scalarOrOpts;
    } else if ("defScalar" in scalarOrOpts) {
      scalar = scalarOrOpts.defScalar;
    } else {
      setScalar = scalarOrOpts.setScalar;
    }
    this.pushToBacking({
      t: "GetHeader",
      name: sql.toYOM(name),
      scalar,
      setScalar,
    });
    return this;
  }

  fileRefTable(name: string) {
    this.pushToBacking({ t: "FileRefTable", name });
    return this;
  }
}

/** Either an {@link EndpointStatements} instance or a builder function. */
export type EndpointStatementsOrFn = StatementsOrFn<EndpointStatements>;

/**
 * Statement builder for the body of an HTTP endpoint (Api and App
 * endpoints). Adds endpoint-specific helpers on top of the server
 * surface: `setHttpStatus`, header readers, JSON / text / multipart
 * body readers, and response helpers.
 */
export class EndpointStatements
  extends ServerStatementsBase<yom.EndpointStatement> {
  static normalize(p: EndpointStatementsOrFn | false | undefined | null) {
    return p instanceof EndpointStatements
      ? p
      : new EndpointStatements().statements(p);
  }

  static normalizeToArray(
    p: EndpointStatementsOrFn | false | undefined | null,
  ) {
    return EndpointStatements.normalize(p)[BACKING_ARRAY];
  }

  /** Bind the authenticated API caller for subsequent procedures and writes. */
  setCurrentUser(user: Sql) {
    this.pushToBacking({ t: "SetCurrentUser", user: sql.toYOM(user) });
    return this;
  }

  setHttpStatus(status: NumericExpr) {
    this.pushToBacking({ t: "SetHttpStatus", status: sql.toYOM(status) });
    return this;
  }

  /** @deprecated Pass `{ defScalar }` as the second argument instead. */
  getHeader(name: Sql, scalar: string): this;
  getHeader(name: Sql, opts: { defScalar: string }): this;
  getHeader(name: Sql, opts: { setScalar: string }): this;
  getHeader(
    name: Sql,
    scalarOrOpts: string | { defScalar: string } | { setScalar: string },
  ): this {
    let scalar: string | undefined;
    let setScalar: string | undefined;
    if (typeof scalarOrOpts === "string") {
      scalar = scalarOrOpts;
    } else if ("defScalar" in scalarOrOpts) {
      scalar = scalarOrOpts.defScalar;
    } else {
      setScalar = scalarOrOpts.setScalar;
    }
    this.pushToBacking({
      t: "GetHeader",
      name: sql.toYOM(name),
      scalar,
      setScalar,
    });
    return this;
  }

  /** @deprecated Pass `{ defScalar }` as the argument instead. */
  getRequestBodyJson(scalar: string): this;
  getRequestBodyJson(opts: { defScalar: string }): this;
  getRequestBodyJson(opts: { setScalar: string }): this;
  getRequestBodyJson(
    scalarOrOpts: string | { defScalar: string } | { setScalar: string },
  ): this {
    let scalar: string | undefined;
    let setScalar: string | undefined;
    if (typeof scalarOrOpts === "string") {
      scalar = scalarOrOpts;
    } else if ("defScalar" in scalarOrOpts) {
      scalar = scalarOrOpts.defScalar;
    } else {
      setScalar = scalarOrOpts.setScalar;
    }
    this.pushToBacking({ t: "GetRequestBodyJson", scalar, setScalar });
    return this;
  }

  /** @deprecated Pass `{ defScalar }` as the argument instead. */
  getRequestBodyText(scalar: string): this;
  getRequestBodyText(opts: { defScalar: string }): this;
  getRequestBodyText(opts: { setScalar: string }): this;
  getRequestBodyText(
    scalarOrOpts: string | { defScalar: string } | { setScalar: string },
  ): this {
    let scalar: string | undefined;
    let setScalar: string | undefined;
    if (typeof scalarOrOpts === "string") {
      scalar = scalarOrOpts;
    } else if ("defScalar" in scalarOrOpts) {
      scalar = scalarOrOpts.defScalar;
    } else {
      setScalar = scalarOrOpts.setScalar;
    }
    this.pushToBacking({ t: "GetRequestBodyText", scalar, setScalar });
    return this;
  }

  noCaching() {
    this.setHeader(
      sql.lit`Cache-Control`,
      sql.lit`no-store, no-cache, must-revalidate, proxy-revalidate`,
    );
    this.setHeader(sql.lit`Pragma`, sql.lit`no-cache`);
    this.setHeader(sql.lit`Expires`, sql.lit`0`);
    return this;
  }

  setHeader(name: Sql | string, value: Sql | string) {
    this.pushToBacking({
      t: "SetHeader",
      name: typeof name === "string" ? sql.lit(name).toYOM() : sql.toYOM(name),
      value: typeof value === "string"
        ? sql.lit(value).toYOM()
        : sql.toYOM(value),
    });
    return this;
  }

  /** @deprecated Pass `{ defRecord }` as the second argument instead. */
  getCookie(name: Sql, record: string): this;
  getCookie(name: Sql, opts: { defRecord: string }): this;
  getCookie(name: Sql, opts: { setRecord: string }): this;
  getCookie(
    name: Sql,
    recordOrOpts: string | { defRecord: string } | { setRecord: string },
  ): this {
    let record: string | undefined;
    let setRecord: string | undefined;
    if (typeof recordOrOpts === "string") {
      record = recordOrOpts;
    } else if ("defRecord" in recordOrOpts) {
      record = recordOrOpts.defRecord;
    } else {
      setRecord = recordOrOpts.setRecord;
    }
    this.pushToBacking({
      t: "GetCookie",
      name: sql.toYOM(name),
      record,
      setRecord,
    });
    return this;
  }

  setCookie(
    name: Sql | string,
    value: Sql | string,
    options: CookieOptions = {},
  ) {
    this.pushToBacking({
      t: "SetCookie",
      name: typeof name === "string" ? sql.lit(name).toYOM() : sql.toYOM(name),
      value: typeof value === "string"
        ? sql.lit(value).toYOM()
        : sql.toYOM(value),
      domain: options.domain
        ? typeof options.domain === "string"
          ? sql.lit(options.domain).toYOM()
          : sql.toYOM(options.domain)
        : undefined,
      path: options.path
        ? typeof options.path === "string"
          ? sql.lit(options.path).toYOM()
          : sql.toYOM(options.path)
        : undefined,
      expires: options.expires
        ? typeof options.expires === "string"
          ? sql.lit(options.expires).toYOM()
          : sql.toYOM(options.expires)
        : undefined,
      secure: options.secure ? sql.toYOM(options.secure) : undefined,
      httpOnly: options.httpOnly ? sql.toYOM(options.httpOnly) : undefined,
      sameSite: options.sameSite
        ? typeof options.sameSite === "string"
          ? sql.lit(options.sameSite).toYOM()
          : sql.toYOM(options.sameSite)
        : undefined,
    });
    return this;
  }

  removeCookie(name: Sql) {
    this.pushToBacking({
      t: "RemoveCookie",
      name: sql.toYOM(name),
    });
    return this;
  }

  returnBlob(hash: Sql) {
    this.pushToBacking({
      t: "ReturnBlob",
      hash: sql.toYOM(hash),
    });
    return this;
  }
}

export type TestStatementsOrFn = StatementsOrFn<TestStatements>;

/**
 * Statement builder for **test bodies** — the `s` parameter in
 * `system.test(...)`.
 *
 * Inherits the standard assertion primitives (`s.assert`, `s.assertEqual`,
 * etc.) from {@link IServerBaseStatements} and adds test-only fixtures:
 * `s.runScheduledProc`, `s.flushReactors`, `s.disableReactor`,
 * `s.enableReactor`, and `s.setCurrentUser` (test procedures run without an
 * authenticated user, so `current_user` is null until set). Outside tests
 * this type is unused.
 *
 * @see docs/testing/test_statements.md
 */
export class TestStatements extends ServerStatementsBase<yom.TestStatement> {
  static normalize(p: TestStatementsOrFn | undefined | null | false) {
    return p instanceof TestStatements ? p : new TestStatements().statements(p);
  }

  static normalizeToArray(p: TestStatementsOrFn | undefined | null | false) {
    return TestStatements.normalize(p)[BACKING_ARRAY];
  }

  runScheduledProc(name?: string) {
    this.pushToBacking({ t: "RunScheduledProc", name });
    return this;
  }

  disableReactor(name: string) {
    this.pushToBacking({ t: "DisableReactor", name });
    return this;
  }

  enableReactor(name: string) {
    this.pushToBacking({ t: "EnableReactor", name });
    return this;
  }

  flushReactors() {
    this.pushToBacking({ t: "FlushReactors" });
    return this;
  }

  /**
   * Bind `current_user` for the rest of the test procedure. Test procedures
   * run without an authenticated user, so `current_user` is null until set.
   * Call this before `startTransaction()` when inserts and updates in that
   * transaction should use the user as `tx_creator`. Pass SQL `null` to clear
   * the binding.
   */
  setCurrentUser(user: Sql) {
    this.pushToBacking({
      t: "SetCurrentUser",
      user: sql.toYOM(user),
    });
    return this;
  }
}

/** Either a {@link TransformStatements} instance or a builder function. */
export type TransformStatementsOrFn = StatementsOrFn<TransformStatements>;

/**
 * Statement builder for {@link System.addTransform} per-table `process`
 * bodies and `setup` / `finalize` hooks. See
 * {@link https://docs.yolm.io/concepts/transforms | Transforms}.
 */
export class TransformStatements
  extends StatementsBase<yom.TransformStatement> {
  static normalize(p: TransformStatementsOrFn | undefined | null | false) {
    return p instanceof TransformStatements
      ? p
      : new TransformStatements().statements(p);
  }

  static normalizeToArray(
    p: TransformStatementsOrFn | undefined | null | false,
  ) {
    return TransformStatements.normalize(p)[BACKING_ARRAY];
  }

  startTransaction(opts?: { creator?: NumericExpr; timestamp?: Sql }) {
    this.pushToBacking({
      t: "StartTransaction",
      creator: opts?.creator === undefined
        ? undefined
        : sql.toYOM(opts.creator),
      timestamp: opts?.timestamp === undefined
        ? undefined
        : sql.toYOM(opts.timestamp),
    });
    return this;
  }

  commitTransaction() {
    this.pushToBacking({ t: "CommitTransaction" });
    return this;
  }

  encodeSkipOp(opts: { table: string; count: NumericExpr }) {
    this.pushToBacking({
      t: "EncodeSkipOp",
      table: opts.table,
      count: sql.toYOM(opts.count),
    });
    return this;
  }

  skipTransactions(count: NumericExpr) {
    this.pushToBacking({ t: "SkipTransactions", count: sql.toYOM(count) });
    return this;
  }

  restore(table: string, query: Sql): this {
    this.pushToBacking({
      t: "Restore",
      table,
      query: query.toYOM(),
    });
    return this;
  }
}
