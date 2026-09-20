import type { TableBuilder } from "std/system";

export function usernamePasswordFields(table: TableBuilder) {
  table.string("username", 100).notNull();
  table.bytes("password_hash", 64).notNull();
  table.bytes("password_salt", 32).notNull();
}
