import { TableRecordSelect } from "components/table_record_select";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { BooleanExpr, Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";

/** Select an unassigned role; the caller owns the draft and its save lifecycle. */
export function RoleSelector(props: {
  selected: (role: Sql) => BooleanExpr;
  onSelect: (s: DomStatements, role: Sql, name: Sql) => void;
}) {
  return (
    <Data
      local
      noRefetch
      procedure={(s) =>
        s.defScalar("role_selector_value", {
          type: "BigInt",
          expr: sql.null,
        })}
    >
      <TableRecordSelect
        tableName="auth_roles"
        size="sm"
        variant="outlined"
        placeholder="Select Role"
        value={sql`role_selector_value`}
        clearOnSelect
        disableDialogInsert
        where={sql`not (${props.selected(sql`auth_roles.id`)})`}
        onComboboxSelectValue={(s, role, name) => {
          s.if(
            sql.isNotNull(role),
            (s) => props.onSelect(s, sql`${role}`, name),
          );
        }}
      />
    </Data>
  );
}
