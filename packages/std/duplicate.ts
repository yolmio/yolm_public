import { sql } from "./sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "./sql_utils";
import { system } from "std/system";
import type { Field, Table } from "std/system";
import type { IStatementsBase } from "./statements";

interface DuplicateRecordOptions {
  table: string;
  overrideFields?: Record<string, (oldRecord: Sql) => AnyExpr>;
  id: NumericExpr;
  ignoreTables?: string[];
  /** An explicit empty list duplicates only the parent record. */
  onlyTables?: string[];
}

/**
 Duplicates a record and all related records recursively.
@param s DomStatements instance to add statements to
@param opts.table The name of the table containing the record to duplicate
@param opts.id The id of the record to duplicate
@returns A scalar variable name that will hold the new record's id

 */
export function duplicateRecordAndRelations<T extends IStatementsBase>(
  s: T,
  opts: DuplicateRecordOptions,
) {
  const t = system.db.tables[opts.table];
  if (!t) {
    throw new Error(`Table ${opts.table} not found.`);
  }
  if (
    Array.isArray(opts.onlyTables) &&
    opts.onlyTables.length > 0 &&
    Array.isArray(opts.ignoreTables) &&
    opts.ignoreTables.length > 0
  ) {
    throw new Error(
      "Cannot specify both onlyTables and ignoreTables. Please specify one or the other.",
    );
  }
  if (Array.isArray(opts.onlyTables)) {
    for (const tableName of opts.onlyTables) {
      if (!system.db.tables[tableName]) {
        throw new Error(
          `Table "${tableName}" specified in onlyTables does not exist in the database.`,
        );
      }
    }
  }
  s.defRecord(
    "old_child_record",
    sql`select * from ${t.identWithDb} where id = ${opts.id}`,
  );
  duplicateRecordInner(s, {
    table: t,
    overrideFields: opts.overrideFields,
    parentField: undefined,
    parentId: undefined,
    ignoreTables:
      Array.isArray(opts.ignoreTables) && opts.ignoreTables.length > 0
        ? opts.ignoreTables
        : undefined,
    onlyTables: Array.isArray(opts.onlyTables) ? opts.onlyTables : undefined,
  });
}

interface DuplicateRecordInnerOptions {
  table: Table;
  parentField?: Field;
  parentId?: NumericExpr;
  ignoreTables?: string[];
  onlyTables?: string[];
  overrideFields?: Record<string, (oldRecord: Sql) => AnyExpr>;
}

function duplicateRecordInner<T extends IStatementsBase>(
  s: T,
  opts: DuplicateRecordInnerOptions,
) {
  const t = opts.table;
  const insertColumns = [];
  const insertValues = [];
  for (const field of Object.values(t.fields)) {
    if (field.name === "id") {
      continue;
    }
    if (opts.overrideFields?.[field.name]) {
      insertColumns.push(field.name);
      insertValues.push(
        opts.overrideFields[field.name](sql.ref("old_child_record")),
      );
    } else if (opts.parentField === field) {
      insertColumns.push(field.name);
      insertValues.push(opts.parentId);
    } else {
      insertColumns.push(field.name);
      insertValues.push(sql`old_child_record.${field.ident}`);
    }
  }
  const newIdVar = `new_${t.name}_id`;
  s.modify(sql.insertValues(t.identWithDb, insertColumns, insertValues));
  s.defScalar(newIdVar, {
    expr: sql`last_record_id(${t.identWithDb})`,
    allowNoRead: true,
  });
  for (const otherTable of Object.values(system.db.tables)) {
    if (opts.ignoreTables?.includes(otherTable.name)) {
      continue;
    }
    if (opts.onlyTables && !opts.onlyTables.includes(otherTable.name)) {
      continue;
    }
    let foundField: undefined | Field;
    for (const field of Object.values(otherTable.fields)) {
      if (field.type === "ForeignKey" && field.table === t.name) {
        if (foundField) {
          throw new Error(
            `Multiple foreign keys found for table ${t.name} to table ${otherTable.name}`,
          );
        }
        foundField = field;
      }
    }
    if (!foundField) {
      continue;
    }
    s.forEachTableWithOpts({
      table: otherTable.name,
      cursorName: "old_child_record",
      where:
        sql`${foundField.ident} = old_child_record.${otherTable.primaryKeyIdent}`,
      body: (sub) => {
        duplicateRecordInner(sub, {
          table: otherTable,
          parentField: foundField,
          parentId: sql.ref(newIdVar),
          ignoreTables: opts.ignoreTables,
          onlyTables: opts.onlyTables,
        });
      },
    });
  }
}
