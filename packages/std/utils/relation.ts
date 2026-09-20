import { system } from "../system";

export function getRelationInfo(tableName: string, otherTableName: string) {
  const table = system.db.tables[tableName];
  if (!table) {
    throw new Error(`Table ${tableName} does not exists`);
  }
  const otherTable = system.db.tables[otherTableName];
  if (!otherTable) {
    throw new Error(`Table ${otherTableName} does not exists`);
  }
  const foreignKeyField = Object.values(otherTable.fields).find(
    (f) => f.type === "ForeignKey" && f.table === table.name,
  );
  if (!foreignKeyField) {
    throw new Error(
      `No foreign key field found from ${otherTableName} to ${tableName}`,
    );
  }
  return {
    otherTable,
    foreignKeyField,
    table,
  };
}
