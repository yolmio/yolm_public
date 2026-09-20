/**
 * Field Mapping Utilities for Transforms and Pipelines
 *
 * Provides utilities for:
 * - Building field mappings between source and target schemas
 * - Common field normalizers (strings, dates, bools)
 * - Enum value mapping/conversion
 */

import { type Sql, sql } from "./sql_utils";

// =============================================================================
// Field Mapping Types
// =============================================================================

export interface FieldMapping {
  /** Source field name (undefined for target-only fields) */
  source?: string;
  /** Target field name (null = drop field) */
  target: string | null;
  /** Optional transformation function */
  transform?: (value: Sql) => Sql;
  /** Fixed insert expression (for fields without a source) */
  insertExpr?: Sql;
  /** Fixed update expression (for fields without a source; omit to skip on update) */
  updateExpr?: Sql;
}

export interface FieldMapConfig {
  /** Fields to exclude entirely (dropped from output) */
  exclude?: string[];
  /**
   * Explicit field mappings.
   * - string: rename field
   * - null: drop field
   * - function: transform field value
   * - { insert, update? }: fixed expressions for target-only fields (no source column)
   */
  mappings?: Record<
    string,
    | string
    | null
    | ((value: Sql) => Sql)
    | { insert: Sql; update?: Sql }
  >;
  /** Default transformation applied to all fields not in mappings */
  defaultTransform?: (fieldName: string, value: Sql) => Sql;
}

/**
 * Build field mappings from source column names and configuration.
 *
 * @param sourceColumns - Array of source column names
 * @param config - Mapping configuration
 * @returns Array of field mappings (excluding dropped fields)
 *
 * @example
 * ```typescript
 * const mappings = buildFieldMappings(
 *   ["id", "first_name", "last_name", "old_field"],
 *   {
 *     exclude: ["old_field"],
 *     mappings: {
 *       first_name: normalizers.string,
 *       last_name: (v) => sql`upper(${v})`,
 *     },
 *   }
 * );
 * ```
 */
export function buildFieldMappings(
  sourceColumns: string[],
  config: FieldMapConfig = {},
): FieldMapping[] {
  const exclude = new Set(config.exclude ?? []);
  const mappings = config.mappings ?? {};

  const result: FieldMapping[] = [];
  const sourceSet = new Set(sourceColumns);

  for (const name of sourceColumns) {
    // Skip excluded fields
    if (exclude.has(name)) continue;

    const mapping = mappings[name];

    // Explicitly dropped
    if (mapping === null) continue;

    // Renamed field
    if (typeof mapping === "string") {
      result.push({ source: name, target: mapping });
      continue;
    }

    // Transformed field
    if (typeof mapping === "function") {
      result.push({ source: name, target: name, transform: mapping });
      continue;
    }

    // Object with insert/update expressions (source column exists but using fixed expressions)
    if (typeof mapping === "object") {
      result.push({
        target: name,
        insertExpr: mapping.insert,
        updateExpr: mapping.update,
      });
      continue;
    }

    // Default: pass through with optional default transform
    if (config.defaultTransform) {
      result.push({
        source: name,
        target: name,
        transform: (v) => config.defaultTransform!(name, v),
      });
    } else {
      result.push({ source: name, target: name });
    }
  }

  // Process mappings for fields not in source columns (target-only fields)
  for (const [name, mapping] of Object.entries(mappings)) {
    if (sourceSet.has(name)) continue;

    if (mapping === null) continue;

    if (typeof mapping === "object" && typeof mapping !== "function") {
      result.push({
        target: name,
        insertExpr: mapping.insert,
        updateExpr: mapping.update,
      });
    }
  }

  return result;
}

/**
 * Get only the active (non-dropped) field mappings.
 */
export function getActiveMappings(mappings: FieldMapping[]): FieldMapping[] {
  return mappings.filter((m) => m.target !== null);
}

// =============================================================================
// Common Normalizers
// =============================================================================

/**
 * Common field normalizer functions for data transformation.
 */
export const normalizers = {
  /**
   * Trim whitespace and convert empty strings to null.
   */
  string: (value: Sql): Sql => sql`nullif(trim(${value}), '')`,

  /**
   * Uppercase, trim, and convert empty strings to null.
   */
  upperString: (value: Sql): Sql => sql`nullif(upper(trim(${value})), '')`,

  /**
   * Lowercase, trim, and convert empty strings to null.
   */
  lowerString: (value: Sql): Sql => sql`nullif(lower(trim(${value})), '')`,

  /**
   * Default false for null boolean values.
   */
  bool: (value: Sql): Sql => sql`coalesce(${value}, false)`,

  /**
   * Default true for null boolean values.
   */
  boolTrue: (value: Sql): Sql => sql`coalesce(${value}, true)`,

  /**
   * Validate date is within a reasonable range.
   *
   * @param minYearsAgo - Minimum years in the past (default: 150)
   * @param maxYearsAgo - Maximum years in the past (default: 0, meaning today)
   */
  date: (minYearsAgo = 150, maxYearsAgo = 0) => (value: Sql): Sql =>
    sql`
      case
        when ${value} is null then null
        when ${value} < date.add(year, -${minYearsAgo}, current_date()) then null
        when ${value} > date.add(year, -${maxYearsAgo}, current_date()) then null
        else ${value}
      end
    `,

  /**
   * Validate date of birth (14-100 years ago).
   */
  dob: (value: Sql): Sql => normalizers.date(100, 14)(value),

  /**
   * Convert to integer with null coalescing to 0.
   */
  intOrZero: (value: Sql): Sql => sql`coalesce(cast(${value} as int), 0)`,

  /**
   * Convert to bigint with null coalescing to 0.
   */
  bigintOrZero: (value: Sql): Sql => sql`coalesce(cast(${value} as bigint), 0)`,

  /**
   * Convert to decimal with null coalescing to 0.
   */
  decimalOrZero: (precision: number, scale: number) => (value: Sql): Sql =>
    sql`coalesce(cast(${value} as decimal(${precision}, ${scale})), 0)`,

  /**
   * Trim and validate email format (basic check).
   */
  email: (value: Sql): Sql =>
    sql`
    case
      when ${value} is null then null
      when trim(${value}) = '' then null
      when position('@' in trim(${value})) = 0 then null
      else lower(trim(${value}))
    end
  `,

  /**
   * Normalize phone number (digits only).
   */
  phone: (value: Sql): Sql =>
    sql`nullif(regexp_replace(${value}, '[^0-9]', '', 'g'), '')`,
};

// =============================================================================
// Enum Mapping
// =============================================================================

export interface EnumMapEntry {
  /** Source value(s) to match (case-insensitive) */
  from: string | string[];
  /** Target enum value */
  to: string;
}

/**
 * Build a CASE expression for enum value mapping.
 *
 * @param value - Source value expression
 * @param enumName - Target enum name (without 'enums.' prefix)
 * @param entries - Mapping entries
 * @param defaultValue - Default enum value if no match
 * @returns SQL CASE expression
 *
 * @example
 * ```typescript
 * const statusExpr = enumMapper(
 *   sql`record.status`,
 *   "order_status",
 *   [
 *     { from: ["NEW", "PENDING"], to: "pending" },
 *     { from: "COMPLETED", to: "completed" },
 *     { from: "CANCELLED", to: "cancelled" },
 *   ],
 *   "pending"
 * );
 * ```
 */
export function enumMapper(
  value: Sql,
  enumName: string,
  entries: EnumMapEntry[],
  defaultValue: string,
): Sql {
  const cases: string[] = [];

  for (const entry of entries) {
    const sources = Array.isArray(entry.from) ? entry.from : [entry.from];
    for (const source of sources) {
      cases.push(
        `when upper(trim(${value.toSQL()})) = '${source.toUpperCase()}' then '${entry.to}'::enums.${enumName}`,
      );
    }
  }

  const casesStr = cases.join("\n      ");
  return sql`
    case
      ${sql(casesStr)}
      else '${sql(defaultValue)}'::enums.${sql(enumName)}
    end
  `;
}

/**
 * Build an enum mapper function for use in field mappings.
 *
 * @example
 * ```typescript
 * const mappings = buildFieldMappings(columns, {
 *   mappings: {
 *     status: enumMapperFn("order_status", [
 *       { from: "NEW", to: "pending" },
 *       { from: "DONE", to: "completed" },
 *     ], "pending"),
 *   },
 * });
 * ```
 */
export function enumMapperFn(
  enumName: string,
  entries: EnumMapEntry[],
  defaultValue: string,
): (value: Sql) => Sql {
  return (value: Sql) => enumMapper(value, enumName, entries, defaultValue);
}

// =============================================================================
// Lookup Helpers
// =============================================================================

/**
 * Create a lookup expression that finds a record by a unique field.
 *
 * @param table - Target table name
 * @param lookupField - Field to match against
 * @param value - Value to look up
 * @param returnField - Field to return (default: "id")
 * @returns SQL subquery expression
 *
 * @example
 * ```typescript
 * const clientId = lookup("clients", "acronym", sql`record.client_code`);
 * // Produces: (select id from db.clients where acronym = record.client_code)
 * ```
 */
export function lookup(
  table: string,
  lookupField: string,
  value: Sql,
  returnField = "id",
): Sql {
  return sql`(select ${sql.ref(returnField)} from db.${sql.ref(table)} where ${
    sql.ref(lookupField)
  } = ${value})`;
}

/**
 * Create a lookup function for a specific table and field.
 *
 * @example
 * ```typescript
 * const lookupClientId = lookupFn("clients", "acronym");
 * // Use in mappings:
 * const clientId = lookupClientId(sql`record.client_code`);
 * ```
 */
export function lookupFn(
  table: string,
  lookupField: string,
  returnField = "id",
): (value: Sql) => Sql {
  return (value: Sql) => lookup(table, lookupField, value, returnField);
}

// =============================================================================
// ID Mapping Table Helpers
// =============================================================================

/**
 * Generate SQL to insert into an ID mapping table.
 *
 * @param mappingTable - Name of the mapping table
 * @param oldId - Old/source ID expression
 * @param newId - New/target ID expression
 * @returns SQL INSERT statement
 */
export function insertIdMapping(
  mappingTable: string,
  oldId: Sql,
  newId: Sql,
): Sql {
  return sql`insert into db.${
    sql.ref(mappingTable)
  } (old_id, new_id) values (${oldId}, ${newId})`;
}

/**
 * Generate SQL to look up a new ID from a mapping table.
 *
 * @param mappingTable - Name of the mapping table
 * @param oldId - Old/source ID expression
 * @returns SQL subquery expression
 */
export function lookupMappedId(mappingTable: string, oldId: Sql): Sql {
  return sql`(select new_id from db.${
    sql.ref(mappingTable)
  } where old_id = ${oldId})`;
}
