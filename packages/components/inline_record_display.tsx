import { getHrefToRecord, isTableLinkable } from "std/shared_contexts";
import { sql } from "../std/sql_utils";
import type { NumericExpr, Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { system } from "std/system";
import { Show, useState } from "std/ui";
import { Link } from "./link";

interface InlineRecordDisplayProps {
  sx?: Style;
  className?: string;
  tableName: string;
  id: NumericExpr;
  nullValue?: string;
}

/**
 Displays a record inline, using the table's configured display method or falling back to a default.

 @category UI Component

 @param props.tableName
 @param props.id The ID of the record to display
 @param props.sx

 @examples
 [Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
 */
export function InlineRecordDisplay(props: InlineRecordDisplayProps) {
  const { tableName, id } = props;
  const nullValue = props.nullValue;
  const table = system.db.tables[tableName];
  if (!table) {
    throw new Error(`Table with name ${tableName} does not exist`);
  }
  if (table.inlineRecordDisplay) {
    const Component = table.inlineRecordDisplay;
    return <Component id={id} className={props.className} sx={props.sx} />;
  }
  let nameExpr: Sql;
  if (table.recordDisplayName) {
    nameExpr = table.recordDisplayName.expr(
      ...table.recordDisplayName.fields.map((f) => sql`other.${sql.ref(f)}`),
    );
  } else if (table.fields.email) {
    nameExpr = sql`other.email`;
  } else {
    throw new Error(
      `Table ${table.name} has no recordDisplayName and no email field, cannot display inline record display`,
    );
  }
  useState({
    watch: [id],
    procedure: (s) =>
      s.defScalar(
        "name",
        sql`(select ${nameExpr} from db.${table.ident} as other where other.${table.primaryKeyIdent} = ${id})`,
      ),
  });
  if (isTableLinkable(table)) {
    return (
      <Show when={sql`name is not null and name != ''`} fallback={nullValue}>
        <Link
          sx={props.sx}
          href={getHrefToRecord(table, id)}
          className={props.className}
        >
          {sql`name`}
        </Link>
      </Show>
    );
  }
  return nullValue ? sql`coalesce(name, ${sql.lit(nullValue)})` : sql`name`;
}
