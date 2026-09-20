import { dedent } from "./utils/string";
import {
  captureSourceFrame,
  registerSql,
  type SqlSourceRange,
} from "./yolm_gen_api";

const sqlTemplateSourceFrameCache = new WeakMap<
  TemplateStringsArray,
  number
>();
const staticSqlTemplateCache = new WeakMap<
  TemplateStringsArray,
  { content: string; sqlId?: number }
>();

/**
 * Typed wrapper around a SQL fragment, produced by the {@link sql} tagged
 * template and consumed by every Yolm SQL-accepting API.
 *
 * Storing fragments as objects (rather than raw strings) keeps the
 * original `.tsx` source position attached, so SQL diagnostics can
 * point back at the line of TypeScript that produced the fragment.
 * Construct via `sql\`...\``, never `new Sql(...)` directly.
 */
// Core Sql class - replaces all previous SQL types
export class Sql<T = any> {
  constructor(public inner: T, public sqlId?: number) {}

  toSQL() {
    // If we have an sqlId, we still return the string content for TypeScript-side operations
    // The sqlId is only used during serialization
    return this.inner;
  }

  toYOM() {
    return this.sqlId !== undefined ? this.sqlId : this.inner;
  }
}

// Helper classes that work with Sql
/** A `select`-list entry: an expression with an optional `as` alias. Build via {@link selectColumn}. */
export class SelectColumn {
  constructor(
    public expr: AnyExpr,
    private alias?: Sql,
  ) {}

  toSQL(): string {
    if (this.alias) {
      return `${sql.normalizeExpr(this.expr).toSQL()} as ${this.alias.toSQL()}`;
    }
    return sql.normalizeExpr(this.expr).toSQL();
  }
}

/** One parenthesized row of a `values (...)` clause. Build via {@link valuesRow}. */
export class ValuesRow {
  constructor(public values: Sql[]) {}

  toSQL(): string {
    return `(${this.values.map((v) => v.toSQL()).join(",")})`;
  }
}

/** A single `column = value` assignment in an `update ... set` clause. Build via {@link updateAssignment}. */
export class UpdateAssignment {
  constructor(
    private name: Sql,
    private value: Sql,
  ) {}

  toSQL(): string {
    return `${this.name.toSQL()}=${this.value.toSQL()}`;
  }
}

/** The parenthesized column list of an `insert into t (...)` statement. Build via {@link insertValueColumns}. */
export class InsertValueColumns {
  constructor(private columns: AnyExpr[]) {}

  toSQL(): string {
    return `(${
      this.columns.map((v) => sql.normalizeExpr(v).toSQL()).join(",")
    })`;
  }
}

/** One key/value pair fed to {@link jsonBuildObject} / `sql.jsonBuildObject`. */
export class BuildJsonObjectField {
  constructor(
    private name: Sql,
    private value: Sql,
  ) {}

  toSQL(): string {
    return `${this.name.toSQL()}, ${this.value.toSQL()}`;
  }
}

/**
 * Tagged template that builds a typed SQL fragment.
 *
 * `sql\`...\`` is the only sanctioned way to construct SQL in Yolm — string
 * concatenation is not allowed (see AGENTS.md). Interpolations are wrapped
 * automatically so a `Sql` value pasted in is still tracked, while raw
 * strings/numbers are inlined as-is.
 *
 * Companion helpers on the `sql` namespace cover the cases interpolation
 * cannot:
 * - `sql.lit\`...\`` — string literal that must be SQL-quoted and
 *   escaped (use for user-supplied or fixed text values).
 * - `sql.ref(name)` — dynamic identifier (table/column name) that must
 *   be quoted as an identifier rather than escaped as a literal.
 * - `sql.concat(...)`, `sql.normalizeExpr(...)`, `sql.dedentTemplate\`...\``
 *   — fragment composition utilities used by higher-level builders.
 *
 * The first overload is for tagged-template usage; the second accepts a raw
 * string or number for cases where you already have a fragment in hand.
 *
 * @example
 * // Typical query
 * sql`select id, name from db.users where org = ${orgId} and status = ${sql.lit`active`}`;
 *
 * @example
 * // Dynamic table/column reference
 * const table = "users";
 * sql`select count(*) from ${sql.ref(`db.${table}`)}`;
 *
 * @see {@link Sql} for the value type returned.
 */
// Main template function
export function sql<T = string>(
  template: TemplateStringsArray,
  ...params: any[]
): Sql<T>;
export function sql<T = string>(str: string | number): Sql<T>;
export function sql<T = string>(
  template: TemplateStringsArray | string | number,
  ...params: any[]
): Sql<T> {
  if (typeof template === "number") {
    return new Sql(template.toString() as any);
  }
  if (typeof template === "string") {
    return new Sql(template as any);
  }

  if (params.length === 0) {
    const cached = staticSqlTemplateCache.get(template);
    if (cached) {
      return new Sql(cached.content as any, cached.sqlId);
    }
  }

  // For template literals, build SQL with source tracking
  let sourceId = sqlTemplateSourceFrameCache.get(template);
  if (sourceId === undefined) {
    sourceId = captureSourceFrame();
    sqlTemplateSourceFrameCache.set(template, sourceId);
  }
  const sourceRanges: SqlSourceRange[] = [];
  let sqlContent = "";
  let currentPos = 0;

  for (let i = 0; i < params.length; i++) {
    // Add template string part with source tracking
    const templatePart = template[i];
    if (templatePart.length > 0) {
      sourceRanges.push({
        start: currentPos,
        len: templatePart.length,
        sourceId,
      });
      sqlContent += templatePart;
      currentPos += templatePart.length;
    }

    // Add interpolated parameter
    const param = params[i];
    const paramSql = argToSql(param);

    // If param is a Sql object with an ID, reference it
    if (param instanceof Sql && param.sqlId !== undefined) {
      sourceRanges.push({
        start: currentPos,
        len: paramSql.length,
        sqlId: param.sqlId,
      });
    } else {
      // Otherwise, attribute it to the current source frame
      sourceRanges.push({
        start: currentPos,
        len: paramSql.length,
        sourceId,
      });
    }

    sqlContent += paramSql;
    currentPos += paramSql.length;
  }

  // Add final template part
  const finalPart = template[template.length - 1];
  if (finalPart.length > 0) {
    sourceRanges.push({
      start: currentPos,
      len: finalPart.length,
      sourceId,
    });
    sqlContent += finalPart;
  }

  // Register SQL with all source ranges. An id of 0 means source tracking
  // is unavailable (e.g. running outside the yolm CLI); the runtime never
  // hands out 0 as a real id, so fall back to inline SQL.
  const sqlId = registerSql(sqlContent, sourceRanges);
  const normalizedSqlId = sqlId === 0 ? undefined : sqlId;
  if (params.length === 0) {
    staticSqlTemplateCache.set(template, {
      content: sqlContent,
      sqlId: normalizedSqlId,
    });
  }

  return new Sql(sqlContent as any, normalizedSqlId);
}

function argToSql(arg: any): string {
  if (Array.isArray(arg)) {
    return arg.map((a) => argToSql(a)).join(",");
  }
  if (arg && typeof arg === "object" && typeof arg.toSQL === "function") {
    return arg.toSQL();
  }
  if (typeof arg === "boolean" || typeof arg === "number") {
    return String(arg);
  }
  throw new Error(`Invalid argument for sql: ${describeSqlArg(arg)}`);
}

function describeSqlArg(arg: any): string {
  if (arg === null) {
    return "null";
  }
  if (arg === undefined) {
    return "undefined";
  }
  const argType = typeof arg;
  if (argType !== "object") {
    return `${argType} ${String(arg)}`;
  }
  const constructorName = describeObjectConstructor(arg);
  const keys = describeObjectKeys(arg);
  const keySummary = keys.length === 0
    ? "no enumerable keys"
    : `keys: ${keys.slice(0, 8).join(", ")}${
      keys.length > 8 ? `, ... +${keys.length - 8} more` : ""
    }`;
  return `object ${constructorName} (${keySummary})`;
}

function describeObjectConstructor(arg: object): string {
  try {
    return Object.getPrototypeOf(arg)?.constructor?.name ?? "Object";
  } catch {
    return "unknown constructor";
  }
}

function describeObjectKeys(arg: object): string[] {
  try {
    return Object.keys(arg);
  } catch {
    return ["<unable to read keys>"];
  }
}

// Recognized by the generation runtime only when this helper is called directly
// from user source. Keep ordinary package/runtime TypeErrors operational.
class SqlLiteralInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "SqlLiteralInputError";
  }
}

function validateLiteralTemplate(
  template: unknown,
  parameterCount: number,
  helper: "sql.lit" | "sql.lit.dedent",
): void {
  if (!Array.isArray(template)) {
    const expected = helper === "sql.lit"
      ? "a string or a tagged template"
      : "a tagged template";
    throw new SqlLiteralInputError(
      `${helper} expects ${expected}; received ${
        template === null ? "null" : typeof template
      }`,
    );
  }
  if (template.length !== parameterCount + 1) {
    throw new SqlLiteralInputError(
      `${helper} expects a tagged template with one more string segment than interpolated values`,
    );
  }
  for (let i = 0; i < template.length; i++) {
    if (typeof template[i] !== "string") {
      throw new SqlLiteralInputError(
        `${helper} expects every tagged-template segment to be a string; segment ${i} is not a string`,
      );
    }
  }
}

function escapeStringLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

function stringLiteral(s: string): string {
  return `'${escapeStringLiteral(s)}'`;
}

function parenWrap(s: string): string {
  let openCount = 0;
  let isFullyWrapped = true;

  for (const char of s) {
    if (char === "(") {
      openCount++;
    } else if (char === ")") {
      openCount--;
    } else if (openCount === 0) {
      isFullyWrapped = false;
      break;
    }
    if (openCount < 0) {
      isFullyWrapped = false;
      break;
    }
  }

  if (
    isFullyWrapped &&
    openCount === 0 &&
    s.startsWith("(") &&
    s.endsWith(")")
  ) {
    return s;
  }

  return `(${s})`;
}

// Helper functions attached to sql
sql.lit = Object.assign(
  function (
    templateOrString: TemplateStringsArray | string,
    ...params: any[]
  ): Sql {
    if (typeof templateOrString === "string") {
      return new Sql(stringLiteral(templateOrString));
    }
    validateLiteralTemplate(templateOrString, params.length, "sql.lit");
    // Handle template literal case
    if (params.length === 0) {
      return new Sql(stringLiteral(templateOrString[0]));
    }
    // Check if any params are SQL expressions
    const hasExprOrSql = params.some((p) => p instanceof Sql);
    if (hasExprOrSql) {
      const concat = [];
      for (let i = 0; i < templateOrString.length; i++) {
        concat.push(templateOrString[i]);
        if (i < params.length) {
          concat.push(params[i]);
        }
      }
      return sql.concat(...concat);
    }
    // Simple string concatenation
    let concat = "";
    for (let i = 0; i < params.length; i++) {
      concat += templateOrString[i];
      concat += params[i];
    }
    concat += templateOrString.at(-1);
    return new Sql(stringLiteral(concat));
  },
  {
    dedent: (template: TemplateStringsArray, ...params: any[]) => {
      validateLiteralTemplate(template, params.length, "sql.lit.dedent");
      if (params.length === 0) {
        return new Sql(stringLiteral(dedent(template[0])));
      }
      // Check if any params are SQL expressions
      const hasExprOrSql = params.some((p) => p instanceof Sql);
      if (hasExprOrSql) {
        const concat = [];
        for (let i = 0; i < template.length; i++) {
          concat.push(dedent(template[i]));
          if (i < params.length) {
            concat.push(params[i]);
          }
        }
        return sql.concat(...concat);
      }
      // Simple string concatenation with dedent
      return new Sql(stringLiteral(dedent(template, ...params)));
    },
  },
);

// Helper function to check if identifier needs quoting
function needsQuoting(part: string): boolean {
  const isReservedKeyword =
    /^(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|TRUE|FALSE|NULL)$/i;
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ||
    isReservedKeyword.test(part);
}

sql.ref = (...s: (string | Sql)[]): Sql => {
  const parts = s.flatMap((s) => {
    if (s instanceof Sql) {
      // If it's already a Sql object, just return its inner value
      return s.inner;
    }
    // Split by dots to handle multi-part identifiers
    return s.split(".").filter(Boolean).map((part) =>
      part === "*"
        ? part
        : needsQuoting(part)
        ? `"${part.replaceAll('"', '""')}"`
        : part
    );
  });
  return new Sql(parts.join("."));
};

// Boolean operations
sql.and = (...exprs: (BooleanExpr | BooleanExpr[])[]): BooleanExpr => {
  if (exprs.length === 0) {
    throw new Error("Specify at least one expression");
  }

  const filtered: BooleanExpr[] = [];
  for (const ex of exprs.flat()) {
    if (ex === false) {
      return false;
    }
    if (ex === true) {
      continue;
    }
    filtered.push(ex);
  }

  if (filtered.length === 0) {
    return true;
  }
  if (filtered.length === 1) {
    return filtered[0];
  }

  return new Sql(filtered.map((f) => sql.parenWrap(f).toSQL()).join(" and "));
};

sql.or = (...exprs: (BooleanExpr | BooleanExpr[])[]): BooleanExpr => {
  if (exprs.length === 0) {
    throw new Error("Specify at least one expression");
  }
  const filtered: BooleanExpr[] = [];
  for (const ex of exprs.flat()) {
    if (ex === true) {
      return true;
    }
    if (ex === false) {
      continue;
    }
    filtered.push(ex);
  }
  if (filtered.length === 1) {
    return filtered[0];
  }
  if (filtered.length === 0) {
    return false;
  }
  return new Sql(filtered.map((f) => sql.parenWrap(f).toSQL()).join(" or "));
};

sql.not = (expr: Sql | boolean): Sql | boolean => {
  if (typeof expr === "boolean") {
    return !expr;
  }
  return new Sql(`not ${parenWrap(expr.toSQL())}`);
};

// Null operations
sql.isNull = (expr: AnyExpr): Sql => {
  const normalized = sql.normalizeExpr(expr).toSQL();
  return new Sql(`${parenWrap(normalized)} is null`);
};

sql.isNotNull = (expr: AnyExpr): Sql => {
  const normalized = sql.normalizeExpr(expr).toSQL();
  return new Sql(`${parenWrap(normalized)} is not null`);
};

// Comparison operations
sql.inList = (ex: AnyExpr, values: AnyExpr[]) => {
  const joined = values.map((ex) => sql.normalizeExpr(ex).toSQL()).join(",");
  return new Sql(`${sql.parenWrap(ex).toSQL()} in (${joined})`);
};

sql.least = (...args: Sql[]): Sql => {
  return new Sql(`least(${args.map((a) => a.toSQL()).join(",")})`);
};

sql.greatest = (...args: Sql[]): Sql => {
  return new Sql(`greatest(${args.map((a) => a.toSQL()).join(",")})`);
};

// String operations
sql.concat = (
  ...args: (
    | Sql
    | string
    | boolean
    | number
    | undefined
    | (Sql | string | boolean | number | undefined)[]
  )[]
) => {
  return new Sql(
    `concat(${
      args
        .filter((v) => v !== undefined)
        .map((v) => {
          if (typeof v === "string") {
            return stringLiteral(v);
          }
          return argToSql(v as any);
        })
        .join(",")
    })`,
  );
};

sql.concatTemplate = (
  template: TemplateStringsArray,
  ...params: any[]
): Sql => {
  const concat = [];
  for (let i = 0; i < template.length; i++) {
    concat.push(template[i]);
    if (i < params.length) {
      concat.push(params[i]);
    }
  }
  return sql.concat(...concat);
};

// Conditional operations
sql.caseWhen = (opts: {
  operand?: Sql;
  conditions: { condition: BooleanExpr; expr: Sql | number }[];
  default?: Sql;
}): Sql => {
  const body = opts.conditions.map(({ condition, expr }) => {
    const condSql = typeof condition === "boolean"
      ? String(condition)
      : condition.toSQL();
    const exprSql = typeof expr === "number" ? String(expr) : expr.toSQL();
    return `when ${condSql} then ${exprSql}`;
  });
  const operandPart = opts.operand ? opts.operand.toSQL() + " " : "";
  return new Sql(
    `case ${operandPart}${body.join(" ")} ${
      opts.default ? `else ${opts.default.toSQL()}` : ""
    } end`,
  );
};

sql.coalesce = (...args: (Sql | number | (Sql | number)[])[]) => {
  const argsFlat = args.flat();
  if (argsFlat.length === 1) {
    return sql.normalizeExpr(argsFlat[0]);
  }
  return new Sql(
    `coalesce(${argsFlat.map((a) => sql.normalizeExpr(a).toSQL()).join(",")})`,
  );
};

// JSON operations
function jsonBuildValueToSql(v: any): Sql {
  if (v === undefined || v === null) {
    return sql.null;
  }
  if (typeof v === "string") {
    return sql.lit(v);
  }
  if (Array.isArray(v)) {
    return sql.jsonBuildArray(...v);
  }
  if (v instanceof Sql) {
    return v;
  }
  if (typeof v === "object") {
    return sql.jsonBuildObject(v);
  }
  return sql.normalizeExpr(v);
}

/** A plain-object literal usable as a value in {@link jsonBuildObject}. */
export interface JsonBuildValueObject {
  [key: string]:
    | AnyExpr
    | JsonBuildValue
    | JsonBuildValue[]
    | string
    | undefined;
}

/**
 * Any value accepted by {@link jsonBuildObject} / {@link jsonBuildArray}:
 * a nested object, array, SQL expression, or JS string. `undefined` keys
 * are dropped from the output.
 */
export type JsonBuildValue =
  | JsonBuildValueObject
  | AnyExpr
  | JsonBuildValue[]
  | string
  | undefined;

/** The two shapes {@link jsonBuildObject} accepts: a key/value record or pre-built fields. */
export type JsonBuildObjectParam =
  | Partial<Record<string, JsonBuildValue>>
  | BuildJsonObjectField[];

/**
 * Build a `json_build_object(...)` SQL expression from a key/value record
 * or a list of {@link BuildJsonObjectField}s. Strings become SQL literals,
 * nested objects/arrays recurse, and `undefined` values are omitted. Also
 * available as `sql.jsonBuildObject`.
 */
export function jsonBuildObject(...fields: BuildJsonObjectField[]): Sql;
export function jsonBuildObject(fields: JsonBuildObjectParam): Sql;
export function jsonBuildObject(
  object: BuildJsonObjectField | JsonBuildObjectParam,
  ...rest: BuildJsonObjectField[]
): Sql {
  const fields = Array.isArray(object)
    ? object
    : object instanceof BuildJsonObjectField
    ? [object, ...rest]
    : Object.entries(object)
      .filter(([_, v]) => v !== undefined)
      .map(
        ([k, v]) =>
          new BuildJsonObjectField(sql.lit(k), jsonBuildValueToSql(v)),
      );
  return sql`json_build_object(${sql(fields.map((o) => o.toSQL()).join(","))})`;
}

sql.jsonBuildObject = jsonBuildObject;

/**
 * Build a `json_build_array(...)` SQL expression. Each value is coerced
 * like {@link jsonBuildObject}'s values; `undefined` entries are dropped.
 * Also available as `sql.jsonBuildArray`.
 */
export function jsonBuildArray(...values: JsonBuildValue[]): Sql<any> {
  const sqlValues = values
    .filter((v) => v !== undefined)
    .map((v) => jsonBuildValueToSql(v));

  const valuesStr = sqlValues.map((v) => v.toSQL()).join(",");
  return sql`json_build_array(${new Sql(valuesStr)})`;
}
sql.insertQuery = (table: string | Sql, query: Sql) => {
  return sql`insert into ${sql.ref(table)} ${query}`;
};
sql.jsonBuildArray = jsonBuildArray;

// Query composition
sql.union = (...queries: (Sql | Sql[])[]) => {
  return new Sql(
    `${
      queries
        .flat()
        .map((sql) => sql.toSQL())
        .join(" union ")
    }`,
  );
};

sql.unionAll = (...queries: Sql[]): Sql => {
  return new Sql(queries.map((sql) => sql.toSQL()).join(" union all "));
};

// Insert/Update helpers
sql.insertValues = (
  table: string | Sql,
  columns: (string | Sql | undefined)[],
  ...rows: (ValuesRow | (AnyExpr | undefined)[])[]
) => {
  const filteredCols = columns.filter((c) => c !== undefined);
  const filteredRows = rows.map((v) =>
    v instanceof ValuesRow ? v : valuesRow(v)
  );
  for (let i = 0; i < filteredRows.length; i++) {
    const row = filteredRows[i];
    if (row.values.length !== filteredCols.length) {
      throw new Error(
        `Row ${i} has ${row.values.length} values but there are ${filteredCols.length} columns`,
      );
    }
  }
  return sql`insert into ${sql.ref(table)} ${
    insertValueColumns(
      ...(filteredCols as any),
    )
  } values ${filteredRows}`;
};

sql.insertObjects = (
  table: string | Sql,
  ...objects: Record<string, any>[]
): Sql => {
  if (objects.length === 0) {
    return sql``;
  }

  const allColumns = new Set<string>();
  for (const obj of objects) {
    for (const key in obj) {
      if (obj[key] !== undefined) {
        allColumns.add(key);
      }
    }
  }

  const columns = Array.from(allColumns);
  const rows = objects.map((obj) => {
    return columns.map((col) => {
      const value = obj[col];
      if (value === undefined || value === null) {
        return sql.null;
      }
      return typeof value === "string" ? sql.lit(value) : value;
    });
  });

  return sql.insertValues(table, columns, ...rows);
};

sql.update = (
  table: string | Sql,
  assignments: UpdateAssignment[],
  where?: BooleanExpr,
) => {
  return sql`update ${sql.ref(table)} set ${assignments}${
    where !== undefined ? sql` where ${where}` : sql``
  }`;
};

// Array to query
sql.fromArray = (array: Record<string, any>[]): Sql => {
  if (array.length === 0) {
    throw new Error("Array must not be empty");
  }

  const keys = Object.keys(array[0]);
  const columns = keys.map((k) => new SelectColumn(sql.ref(k)));
  const values = array.map((record) => {
    const rowValues = keys.map((k) => {
      const v = record[k];
      if (typeof v === "string") {
        return sql.lit(v);
      }
      if (v === null || v === undefined) {
        return sql.null;
      }
      return sql.normalizeExpr(v);
    });
    return new ValuesRow(rowValues);
  });

  return sql`select ${columns} from (values ${values}) as t(${new Sql(
    keys.join(","),
  )})`;
};

// Utility functions
sql.normalizeExpr = (arg: AnyExpr): Sql => {
  if (arg instanceof Sql) {
    return arg;
  }
  return new Sql(argToSql(arg));
};

sql.parenWrap = (expr: AnyExpr): Sql => {
  return new Sql(parenWrap(sql.normalizeExpr(expr).toSQL()));
};

sql.toYOM = <T extends AnyExpr | undefined>(
  expr: T,
): T extends undefined ? undefined : (string | number) => {
  if (expr === undefined) {
    return undefined as any;
  }
  return sql.normalizeExpr(expr).toYOM() as any;
};

// Constants
sql.null = new Sql("null");
sql.true = new Sql("true");
sql.false = new Sql("false");

// Helper functions for creating specific SQL elements
/** Construct a {@link SelectColumn}; a string `alias` is quoted as an identifier. */
export function selectColumn(
  expr: AnyExpr,
  alias?: string | Sql,
): SelectColumn {
  const aliasRef = alias
    ? (typeof alias === "string" ? sql.ref(alias) : alias)
    : undefined;
  return new SelectColumn(expr, aliasRef);
}

/** Construct a {@link ValuesRow} from flat or nested expressions; `undefined` entries are dropped. */
export function valuesRow(
  ...args: ((AnyExpr | undefined)[] | AnyExpr | undefined)[]
) {
  return new ValuesRow(
    args
      .flat()
      .filter((a) => a !== undefined)
      .map((a) => sql.normalizeExpr(a!)),
  );
}

/**
 * Construct an {@link UpdateAssignment}. A string `name` is quoted as an
 * identifier and a string `value` is quoted as a SQL string literal.
 */
export function updateAssignment(
  name: string | Sql,
  value: any,
): UpdateAssignment {
  const nameRef = typeof name === "string" ? sql.ref(name) : name;
  const valueRef = typeof value === "string"
    ? sql.lit(value)
    : sql.normalizeExpr(value);
  return new UpdateAssignment(nameRef, valueRef);
}

/** Construct an {@link InsertValueColumns}; string columns are quoted as identifiers. */
export function insertValueColumns(
  ...columns: (string | AnyExpr)[]
): InsertValueColumns {
  const refs = columns.map((c) => typeof c === "string" ? sql.ref(c) : c);
  return new InsertValueColumns(refs);
}
// Additional utility functions
sql.stringLiteral = (s: string): Sql => {
  return new Sql(stringLiteral(s));
};

sql.isDynamicExpr = (s: unknown): s is Sql => {
  return s instanceof Sql;
};

sql.isAnyExpr = (s: unknown): s is Sql | boolean | number => {
  if (typeof s === "boolean") {
    return true;
  }
  if (typeof s === "number") {
    return true;
  }
  return s instanceof Sql;
};

// Convert expression to YOM representation (uses SQL ID if available, otherwise string)
sql.toYom = <T extends AnyExpr | undefined>(
  ex: T,
): T extends undefined ? undefined : (string | number) => {
  if (ex === undefined) {
    return undefined as any;
  }
  const normalized = sql.normalizeExpr(ex);
  // If it's a Sql object with an ID, return the ID
  // Otherwise return the SQL string
  if (normalized instanceof Sql && normalized.sqlId !== undefined) {
    return normalized.sqlId as any;
  }
  return normalized.toSQL() as any;
};

// For backwards compatibility with sql.exprToString
sql.exprToString = <T extends AnyExpr | undefined>(
  ex: T,
): T extends undefined ? undefined : string => {
  if (ex === undefined) {
    return undefined as any;
  }
  return sql.normalizeExpr(ex).toSQL() as any;
};

/** Return an identifier as a plain string, unwrapping a {@link Sql} fragment if given one. */
export function identToString(s: string | Sql): string {
  return typeof s === "string" ? s : s.toSQL();
}

/** Coerce an identifier to {@link Sql}, quoting a bare string via {@link sql.ref}. */
export function normalizeIdent(i: string | Sql): Sql {
  if (i instanceof Sql) {
    return i;
  }
  return sql.ref(i);
}

/**
 * Build a SQL string literal from character-code expressions.
 *
 * Yolm check-trigger diagnostics cannot parse quoted enum literals in some
 * generated SQL, so callers use this form when embedding constants in checks.
 */
export function checkString(value: string): Sql {
  return sql(
    value.split("").map((char) => `chr(${char.charCodeAt(0)})`).join(" || "),
  );
}
// Additional template functions that were in the original
sql.htmlTemplate = (template: TemplateStringsArray, ...params: any[]): Sql => {
  const concat = [];
  for (let i = 0; i < template.length; i++) {
    concat.push(template[i]);
    if (i < params.length) {
      const value = params[i];
      if (typeof value === "string") {
        concat.push(sql.lit(value));
      } else if (value instanceof Sql) {
        concat.push(sql`string.html_escape(${value})`);
      } else {
        concat.push(value);
      }
    }
  }
  return sql.concat(...concat);
};

sql.dedentTemplate = (
  template: TemplateStringsArray,
  ...params: any[]
): Sql => {
  const concat = [];
  for (let i = 0; i < template.length; i++) {
    concat.push(dedent(template[i]));
    if (i < params.length) {
      concat.push(params[i]);
    }
  }
  return sql.concat(...concat);
};

// Additional constants that were in the original
sql.anyColumnValue = new Sql("any");
sql.columnExists = new Sql("exists");
sql.columnNotExists = new Sql("not exists");

/**
 * A boolean-valued expression: either a TS `boolean` (which will be
 * inlined) or a {@link Sql} fragment that evaluates to a SQL boolean.
 *
 * Used by APIs that accept "either give me a static yes/no, or hand me a
 * SQL predicate" — for example a `disabled` prop on a form field, or a
 * `where` clause on a `system.scheduledProc` filter.
 */
export type BooleanExpr = Sql | boolean;
/**
 * A numeric-valued expression: either a TS `number` (which will be
 * inlined) or a {@link Sql} fragment that evaluates to a SQL number.
 *
 * Used pervasively for limits, weights, sort positions, money columns,
 * etc. — anywhere the caller may have a literal at hand, or a column
 * reference like `sql\`u.balance\``.
 */
export type NumericExpr = Sql | number;
export type AnyExpr = BooleanExpr | number | Sql;
