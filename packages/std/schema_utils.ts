/**
 * Schema Utilities for Metaprogramming
 *
 * Provides unified schema introspection for both dev databases (transforms)
 * and import sources (pipelines). Since both use the same underlying
 * infrastructure, this module provides a consistent API for both use cases.
 */

import {
  getDevDatabases,
  type ImportSourceColumn,
  type ImportSourceSchema,
  type ImportSourceTable,
} from "./yolm_gen_api";
import { system } from "./system";

// Re-export types for convenience
export type { ImportSourceColumn, ImportSourceSchema, ImportSourceTable };

// Alias types for clarity in different contexts
export type SourceColumn = ImportSourceColumn;
export type SourceTable = ImportSourceTable;
export type SourceSchema = ImportSourceSchema;

export type SchemaSourceType = "devDatabase" | "currentSystem";

export interface SchemaSource {
  type: SchemaSourceType;
  /** Name of the dev database */
  name: string;
}

const warnedUnboundDevDatabases = new Set<string>();

function boundDevDatabase(name: string): ImportSourceSchema | undefined {
  const db = getDevDatabases()[name];
  if (!db && !warnedUnboundDevDatabases.has(name)) {
    warnedUnboundDevDatabases.add(name);
    console.warn(
      `Dev database "${name}" is not bound for this generation; its schema is empty. Bind it by name in the database mapping.`,
    );
  }
  return db;
}

/**
 * Get a table schema from any source type.
 *
 * @param source - The schema source (dev database, import source, or current system)
 * @param tableName - Name of the table to retrieve
 * @returns The table schema or undefined if not found
 *
 * @example
 * ```typescript
 * // From dev database (for transforms)
 * const table = getSourceTable({ type: "devDatabase", name: "old_system" }, "contacts");
 *
 * // From import source (for pipelines)
 * const table = getSourceTable({ type: "importSource", name: "csv_import" }, "orders");
 *
 * // From current system
 * const table = getSourceTable({ type: "currentSystem", name: "" }, "users");
 * ```
 */
export function getSourceTable(
  source: SchemaSource,
  tableName: string,
): SourceTable | undefined {
  switch (source.type) {
    case "devDatabase": {
      return boundDevDatabase(source.name)?.tables.find((t) =>
        t.name === tableName
      );
    }
    case "currentSystem": {
      const table = system.db.tables[tableName];
      if (!table) return undefined;
      return {
        name: tableName,
        columns: Object.values(table.fields).map((f) => ({
          name: f.name,
          ty: f.type,
          notNull: f.notNull,
        })),
      };
    }
  }
}

/**
 * Get all tables from a schema source.
 *
 * @param source - The schema source
 * @returns Array of table schemas
 */
export function getSourceTables(source: SchemaSource): SourceTable[] {
  switch (source.type) {
    case "devDatabase": {
      return boundDevDatabase(source.name)?.tables ?? [];
    }
    case "currentSystem": {
      return Object.values(system.db.tables).map((t) => ({
        name: t.name,
        columns: Object.values(t.fields).map((f) => ({
          name: f.name,
          ty: f.type,
          notNull: f.notNull,
        })),
      }));
    }
  }
}

/**
 * Get column names from a source table.
 *
 * @param source - The schema source
 * @param tableName - Name of the table
 * @returns Array of column names, or empty array if table not found
 */
export function getSourceColumnNames(
  source: SchemaSource,
  tableName: string,
): string[] {
  const table = getSourceTable(source, tableName);
  return (
    table?.columns
      .filter((c) => !c.name.startsWith("__orphan_"))
      .map((c) => c.name) ?? []
  );
}

/**
 * Check if a table exists in a schema source.
 */
export function sourceTableExists(
  source: SchemaSource,
  tableName: string,
): boolean {
  return getSourceTable(source, tableName) !== undefined;
}

/**
 * Get a column from a source table.
 */
export function getSourceColumn(
  source: SchemaSource,
  tableName: string,
  columnName: string,
): SourceColumn | undefined {
  const table = getSourceTable(source, tableName);
  return table?.columns.find((c) => c.name === columnName);
}

/**
 * Shorthand for dev database source.
 */
export function devDb(name: string): SchemaSource {
  return { type: "devDatabase", name };
}

/**
 * Shorthand for current system.
 */
export function currentSystem(): SchemaSource {
  return { type: "currentSystem", name: "" };
}
