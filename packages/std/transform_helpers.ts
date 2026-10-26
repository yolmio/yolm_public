/**
 * Transform Helpers for Schema Migrations
 *
 * Provides utilities for generating transform SQL that maps data from
 * an old schema (via WAL replay) to a new schema.
 *
 * Key concepts:
 * - Transforms process WAL (Write-Ahead Log) operations: insert, update, delete
 * - Source data accessed via `op.<table>__<field>` pattern
 * - Update tracking via `op.<table>__<field>__set` boolean
 */

import { type Sql, sql } from "./sql_utils";
import { system } from "./system";
import {
  devDb,
  getSourceTable,
  type SchemaSource,
  type SourceColumn,
} from "./schema_utils";
import {
  buildFieldMappings,
  type FieldMapConfig,
  type FieldMapping,
} from "./field_mapping";
import type {
  TransformStatements,
  TransformStatementsOrFn,
} from "./statements";

// =============================================================================
// Op Record Helpers
// =============================================================================

/**
 * Generate a reference to an op field value.
 *
 * @param table - Source table name
 * @param field - Source field name
 * @returns SQL expression: `op.<table>__<field>`
 */
export function opField(table: string, field: string): Sql {
  return sql`op.${sql(table)}__${sql(field)}`;
}

/**
 * Generate an op field value ready to write into a target column.
 *
 * Op fields carry their source column types. A `newSchema` source has its own
 * copy of each enum, so an enum value is converted to the target enum by name,
 * as automatic replay does: `cast(cast(value as string) as enums.<target>)`.
 * The conversion also holds for a `sameSchema` source. Other types, including
 * `Json` and `Ordering`, are returned unchanged.
 *
 * @param table - Source table name
 * @param field - Source field name
 * @param ty - Source column type name from {@link getSourceTable}
 * @param targetEnum - Enum of the target column, when it is an enum
 */
export function opFieldValue(
  table: string,
  field: string,
  ty?: string,
  targetEnum?: string,
): Sql {
  const value = opField(table, field);
  return ty === "Enum" && targetEnum
    ? sql`cast(cast(${value} as string) as ${sql.ref("enums", targetEnum)})`
    : value;
}

function sourceColumnTypes(
  columns: readonly SourceColumn[] | undefined,
): Map<string, string> {
  return new Map(columns?.map((column) => [column.name, column.ty]));
}

function targetEnumName(table: string, field: string): string | undefined {
  const target = system.db.tables[table]?.fields[field];
  return target?.type === "Enum" ? target.enum : undefined;
}

// A custom mapping receives the raw, source-typed op value and must produce the
// target type, so it can map an enum value the target enum no longer has. Only
// a field without a custom mapping gets the automatic enum conversion.
function mappedOpFieldValue(
  table: string,
  mapping: FieldMapping,
  columnTypes: Map<string, string>,
): Sql {
  if (mapping.transform) {
    return mapping.transform(opField(table, mapping.source!));
  }
  return opFieldValue(
    table,
    mapping.source!,
    columnTypes.get(mapping.source!),
    targetEnumName(table, mapping.target!),
  );
}

/**
 * Generate a reference to an op field's "set" flag (for updates).
 *
 * @param table - Source table name
 * @param field - Source field name
 * @returns SQL expression: `op.<table>__<field>__set`
 */
export function opFieldSet(table: string, field: string): Sql {
  return sql`op.${sql(table)}__${sql(field)}__set`;
}

// =============================================================================
// SQL Generation
// =============================================================================

/**
 * Generate INSERT SQL from field mappings for a transform.
 *
 * @param tableName - Target table name
 * @param mappings - Field mappings (from buildFieldMappings)
 * @param sourceColumns - Source columns; enum columns without a custom mapping
 *   are cast to target enums
 * @returns SQL INSERT statement
 */
export function transformInsertSql(
  tableName: string,
  mappings: FieldMapping[],
  sourceColumns?: readonly SourceColumn[],
): Sql {
  const activeMappings = mappings.filter((m) => m.target !== null);
  const columnTypes = sourceColumnTypes(sourceColumns);

  const targetFields = activeMappings.map((m) => m.target!);
  const sourceValues = activeMappings.map((m) => {
    if (m.insertExpr) return m.insertExpr;
    return mappedOpFieldValue(tableName, m, columnTypes);
  });

  const fieldsStr = targetFields.join(", ");
  const valuesStr = sourceValues.map((v) => v.toSQL()).join(", ");

  return sql`
    insert into db.${sql.ref(tableName)} (${sql(fieldsStr)})
    values (${sql(valuesStr)})
  `;
}

/**
 * Generate UPDATE SQL with __set pattern for a transform.
 *
 * Each field is only updated if its corresponding __set flag is true.
 *
 * @param tableName - Target table name
 * @param mappings - Field mappings (from buildFieldMappings)
 * @param sourceColumns - Source columns; enum columns without a custom mapping
 *   are cast to target enums
 * @returns SQL UPDATE statement
 */
export function transformUpdateSql(
  tableName: string,
  mappings: FieldMapping[],
  sourceColumns?: readonly SourceColumn[],
): Sql {
  const activeMappings = mappings.filter(
    (m) => m.target !== null && m.target !== "id",
  );
  const columnTypes = sourceColumnTypes(sourceColumns);

  const setClauses: string[] = [];
  for (const m of activeMappings) {
    // Source-less mapping with explicit update expression
    if (!m.source) {
      if (m.updateExpr) {
        setClauses.push(
          `${m.target} = ${m.updateExpr.toSQL()}`,
        );
      }
      // No updateExpr means skip on update (e.g. created_at)
      continue;
    }

    const transformed = mappedOpFieldValue(tableName, m, columnTypes);
    const setCheck = opFieldSet(tableName, m.source);
    setClauses.push(
      `${m.target} = case when ${setCheck.toSQL()} then ${transformed.toSQL()} else ${m.target} end`,
    );
  }

  const setClausesStr = setClauses.join(",\n        ");

  return sql`
    update db.${sql.ref(tableName)}
    set ${sql(setClausesStr)}
    where id = op.record_id
  `;
}

/**
 * Generate DELETE SQL for a transform.
 *
 * @param tableName - Target table name
 * @returns SQL DELETE statement
 */
export function transformDeleteSql(tableName: string): Sql {
  return sql`delete from db.${sql.ref(tableName)} where id = op.record_id`;
}

// =============================================================================
// Latest-State Compaction
// =============================================================================

/** A target field written by {@link latestStateProcess}, identified by name. */
export interface LatestStateField {
  name: string;
}

/**
 * Builds a SQL predicate (given the source row alias) that decides whether a
 * source row should be kept; rows failing it are emitted as skip ops.
 */
export type LatestStateRowFilter = (alias: string) => Sql;

/** Context passed to a {@link LatestStateProcessConfig.beforeInsert} hook. */
export interface LatestStateInsertContext {
  recordIdExpr: Sql;
}

/** Configuration for {@link latestStateProcess}. */
export interface LatestStateProcessConfig<
  TField extends LatestStateField = LatestStateField,
> {
  /** Target table written by the transform. */
  targetTable: string;
  /** Source table to query for the current/latest row state. */
  sourceTable: Sql;
  /** Target fields to insert, in target table order. */
  fields: TField[];
  /** Expression for one target field from the source row alias. */
  fieldExpr: (field: TField, alias: string) => Sql;
  /** Per-field expressions that replace fieldExpr. */
  overrides?: Record<string, Sql>;
  /** Optional source-row filter; filtered rows become skip ops. */
  rowFilter?: LatestStateRowFilter;
  /** Source alias used in generated queries and fieldExpr. */
  sourceAlias?: string;
  /** Prefix for generated scalar names. */
  scalarPrefix?: string;
  /** Optional hook that runs after the latest row is found and before insert. */
  beforeInsert?: (
    s: TransformStatements,
    context: LatestStateInsertContext,
  ) => void;
}

function latestStateFieldListSql(fields: LatestStateField[]): Sql {
  return sql(fields.map((field) => sql.ref(field.name).toSQL()).join(", "));
}

function latestStateScalarName(
  prefix: string,
  targetTable: string,
  fieldName: string,
): string {
  return `${prefix}_${targetTable}_${fieldName}`;
}

function latestStateRecordIdScalarName(
  prefix: string,
  targetTable: string,
): string {
  return `${prefix}_${targetTable}_record_id`;
}

function latestStateFieldValueSql<TField extends LatestStateField>(
  config: LatestStateProcessConfig<TField>,
  alias: string,
  recordIdExpr: Sql,
  field: TField,
): Sql {
  const filter = config.rowFilter ? config.rowFilter(alias) : null;
  const expr = config.overrides?.[field.name] ?? config.fieldExpr(field, alias);

  return sql`(
    select ${expr}
    from ${config.sourceTable} as ${sql.ref(alias)}
    where ${sql.ref(alias, "id")} = ${recordIdExpr}
      ${filter ? sql`and (${filter})` : sql``}
  )`;
}

function latestStateRowExistsSql<TField extends LatestStateField>(
  config: LatestStateProcessConfig<TField>,
  alias: string,
  recordIdExpr: Sql,
): Sql {
  const filter = config.rowFilter ? config.rowFilter(alias) : null;

  return sql`
    exists(
      select 1
      from ${config.sourceTable} as ${sql.ref(alias)}
      where ${sql.ref(alias, "id")} = ${recordIdExpr}
        ${filter ? sql`and (${filter})` : sql``}
    )
  `;
}

function defineLatestStateFieldScalars<TField extends LatestStateField>(
  s: TransformStatements,
  config: LatestStateProcessConfig<TField>,
  recordIdExpr: Sql,
): string[] {
  const prefix = config.scalarPrefix ?? "latest_state";
  const alias = config.sourceAlias ?? "src";

  return config.fields.map((field) => {
    const name = latestStateScalarName(
      prefix,
      config.targetTable,
      field.name,
    );
    s.defScalar(
      name,
      latestStateFieldValueSql(config, alias, recordIdExpr, field),
    );
    return name;
  });
}

function latestStateInsertSql(
  targetTable: string,
  fields: LatestStateField[],
  scalarNames: string[],
): Sql {
  return sql`
    insert into db.${sql.ref(targetTable)} (${latestStateFieldListSql(fields)})
    values (${sql(scalarNames.map((name) => sql.ref(name).toSQL()).join(", "))})
  `;
}

/**
 * Generate a transform process that compacts WAL history to the latest source
 * row state.
 *
 * This is useful for high-churn tables where the migrated database only needs
 * current data. The process emits one insert for each source insert whose
 * latest row still exists, emits a skip op when the source row was deleted or
 * filtered out, forwards existing skip ops, and ignores update/delete history.
 */
export function latestStateProcess<TField extends LatestStateField>(
  config: LatestStateProcessConfig<TField>,
): TransformStatementsOrFn {
  return (s) => {
    s.if(sql`op.kind = 'skip'`, (s) => {
      s.encodeSkipOp({ table: config.targetTable, count: sql`op.skip_count` });
    });

    s.if(sql`op.kind = 'insert'`, (s) => {
      const recordIdScalarName = latestStateRecordIdScalarName(
        config.scalarPrefix ?? "latest_state",
        config.targetTable,
      );
      const recordIdExpr = sql.ref(recordIdScalarName);
      const alias = config.sourceAlias ?? "src";

      s.defScalar(recordIdScalarName, sql`op.record_id`);
      s.if(
        latestStateRowExistsSql(config, alias, recordIdExpr),
        (s) => {
          config.beforeInsert?.(s, { recordIdExpr });
          s.modify(
            latestStateInsertSql(
              config.targetTable,
              config.fields,
              defineLatestStateFieldScalars(s, config, recordIdExpr),
            ),
          );
        },
        (s) => {
          s.encodeSkipOp({ table: config.targetTable, count: 1 });
        },
      );
    });
  };
}

// =============================================================================
// High-Level Transform Generation
// =============================================================================

/**
 * Configuration for {@link transformTableProcess}: which dev database and
 * table to read from, plus the {@link FieldMapConfig} field-mapping rules.
 */
export interface TransformTableConfig extends FieldMapConfig {
  /** Source database name (dev database) */
  sourceDb: string;
  /** Table name (same in source and target) */
  table: string;
}

function transformSourceColumns(
  config: TransformTableConfig,
): SourceColumn[] {
  const source: SchemaSource = devDb(config.sourceDb);
  return getSourceTable(source, config.table)?.columns.filter((column) =>
    !column.name.startsWith("__orphan_")
  ) ?? [];
}

/**
 * Generate a complete transform process function for a table.
 *
 * This creates a transform process that handles insert, update, and delete
 * operations, mapping fields from the source schema to the target schema.
 *
 * @param config - Transform configuration
 * @returns TransformStatementsOrFn for use in system.addTransform()
 *
 * @example
 * ```typescript
 * system.addTransform({
 *   name: "migrate_contacts",
 *   kind: { type: "newSchema", sourceDatabase: "old_system" },
 *   tables: [{
 *     table: "contacts",
 *     process: transformTableProcess({
 *       sourceDb: "old_system",
 *       table: "contacts",
 *       exclude: ["image_full", "image_thumb"],  // Drop old UUID fields
 *       mappings: {
 *         first_name: normalizers.string,
 *         email: normalizers.lowerString,
 *       },
 *     }),
 *   }],
 * });
 * ```
 */
export function transformTableProcess(
  config: TransformTableConfig,
): TransformStatementsOrFn {
  const columns = transformSourceColumns(config);
  if (columns.length === 0) {
    throw new Error(
      `Table ${config.table} not found in dev database ${config.sourceDb}, or has no columns`,
    );
  }

  const mappings = buildFieldMappings(
    columns.map((column) => column.name),
    config,
  );

  return (s) => {
    s.if(sql`op.kind = 'insert'`, (s) => {
      s.modify(transformInsertSql(config.table, mappings, columns));
    });

    s.if(sql`op.kind = 'update'`, (s) => {
      s.modify(transformUpdateSql(config.table, mappings, columns));
    });

    s.if(sql`op.kind = 'delete'`, (s) => {
      s.modify(transformDeleteSql(config.table));
    });

    s.if(sql`op.kind = 'skip'`, (s) => {
      s.encodeSkipOp({ table: config.table, count: sql`op.skip_count` });
    });

    s.if(sql`op.kind = 'restore'`, (s) => {
      s.modify(sql`restore ${sql.ref(config.table)} select op.record_id`);
    });
  };
}

// =============================================================================
// Advanced Transform Patterns
// =============================================================================

/** Configuration for {@link transformTableWithIdMapping}. */
export interface TransformTableWithIdMappingConfig
  extends TransformTableConfig {
  /** Name of the ID mapping table (e.g., "import_order_maps") */
  idMappingTable: string;
  /** Scalar name to store the new ID (default: "new_id") */
  newIdScalar?: string;
}

/**
 * Generate a transform process that also maintains an ID mapping table.
 *
 * Useful when you need to track old → new ID mappings for foreign key lookups.
 *
 * @example
 * ```typescript
 * system.addTransform({
 *   name: "migrate_orders",
 *   tables: [{
 *     table: "orders",
 *     process: transformTableWithIdMapping({
 *       sourceDb: "old_system",
 *       table: "orders",
 *       idMappingTable: "import_order_maps",
 *     }),
 *   }],
 * });
 * ```
 */
export function transformTableWithIdMapping(
  config: TransformTableWithIdMappingConfig,
): TransformStatementsOrFn {
  const columns = transformSourceColumns(config);

  if (columns.length === 0) {
    throw new Error(
      `Table ${config.table} not found in dev database ${config.sourceDb}`,
    );
  }

  const mappings = buildFieldMappings(
    columns.map((column) => column.name),
    config,
  );
  const newIdScalar = config.newIdScalar ?? "new_id";

  return (s) => {
    s.if(sql`op.kind = 'insert'`, (s) => {
      // Insert the record
      s.modify(transformInsertSql(config.table, mappings, columns));

      // Store the new ID (use lastval() or currval() depending on your setup)
      s.defScalar(newIdScalar, sql`op.record_id`);

      // Insert into ID mapping table
      s.modify(sql`
        insert into db.${sql.ref(config.idMappingTable)} (old_id, new_id)
        values (op.record_id, ${sql(newIdScalar)})
      `);
    });

    s.if(sql`op.kind = 'update'`, (s) => {
      s.modify(transformUpdateSql(config.table, mappings, columns));
    });

    s.if(sql`op.kind = 'delete'`, (s) => {
      // Delete from mapping table first
      s.modify(sql`
        delete from db.${sql.ref(config.idMappingTable)}
        where old_id = op.record_id
      `);
      s.modify(transformDeleteSql(config.table));
    });

    s.if(sql`op.kind = 'skip'`, (s) => {
      s.encodeSkipOp({ table: config.table, count: sql`op.skip_count` });
    });

    s.if(sql`op.kind = 'restore'`, (s) => {
      s.restore(config.table, sql`select op.record_id`);
    });
  };
}

/**
 * Generate a conditional transform process that skips certain records.
 *
 * @param config - Transform configuration
 * @param skipCondition - SQL condition that returns true to skip the record
 *
 * @example
 * ```typescript
 * transformTableProcessIf(
 *   { sourceDb: "old", table: "users", ... },
 *   sql`op.users__status = 'deleted'`  // Skip deleted users
 * )
 * ```
 */
export function transformTableProcessIf(
  config: TransformTableConfig,
  skipCondition: Sql,
): TransformStatementsOrFn {
  const baseProcess = transformTableProcess(config);

  return (s) => {
    s.if(sql`not (${skipCondition})`, baseProcess);
  };
}
