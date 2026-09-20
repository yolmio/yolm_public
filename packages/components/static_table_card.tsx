import { Card } from "components/card";
import { InlineFieldDisplay } from "components/inline_field_display";
import { CurrentTableICtxKey } from "std/ictx";
import { Data } from "std/data";
import { sql } from "../std/sql_utils";
import type { AnyExpr } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles } from "std/style_utils";
import { useICtx } from "std/ui";
import type { Node } from "std/ui";

type Row =
  | string
  | {
    label: Node;
    expr: AnyExpr;
    display?: (value: AnyExpr) => Node;
  };

export interface Props {
  sx?: Style;
  className?: string;
  rows: Row[];
}

const styles = createStyles({
  header: {
    fontWeight: "semibold",
    color: "text-secondary",
    textAlign: "left",
    py: 2,
  },
  headerWithDivider: {
    fontWeight: "semibold",
    color: "text-secondary",
    textAlign: "left",
    borderTop: "1px solid",
    borderColor: "divider",
    py: 2,
  },
  cell: {
    borderTop: "1px solid",
    borderColor: "divider",
    py: 2,
  },
});

/**
 StaticTableCard component for displaying a table of static data in a card format.

 This component renders a card containing a table with rows of data. Each row can be either a string
 representing a field from the current table, or an object with custom label and expression.

 @category UI Component

 @param props.sx
 @param props.rows An array of rows to display in the table. Each row can be a string (field name) or an object with label, expr, and optional display properties

 @examples
 [Example](../../examples/chinook/apps/chinook.yolmstaging.net.tsx)

*/
export function StaticTableCard(props: Props) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const rows = props.rows;
  const exprRows: { index: number; scalarName: string; expr: AnyExpr }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (typeof row !== "string") {
      const scalarName = `static_table_card_expr_${i}`;
      exprRows.push({ index: i, scalarName, expr: row.expr });
    }
  }
  const card = (
    <Card variant="outlined" sx={props.sx} className={props.className}>
      <table>
        <tbody>
          {rows.map((row, i) => {
            if (typeof row === "string") {
              const field = currentTable.fields[row];
              const value = (
                <InlineFieldDisplay
                  field={field}
                  value={sql`record.${field.ident}`}
                />
              );
              return (
                <tr>
                  <th
                    sx={i === 0 ? styles.header : styles.headerWithDivider}
                    scope="row"
                  >
                    {field.displayName}
                  </th>
                  <td sx={i === 0 ? {} : styles.cell}>{value}</td>
                </tr>
              );
            }
            const exprRow = exprRows.find((e) =>
              e.index === i
            )!;
            const value = sql.ref(exprRow.scalarName);
            return (
              <tr>
                <th
                  sx={i === 0 ? styles.header : styles.headerWithDivider}
                  scope="row"
                >
                  {row.label}
                </th>
                <td sx={i === 0 ? {} : styles.cell}>
                  {row.display ? (row.display(value) as Node) : value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
  if (exprRows.length === 0) {
    return card;
  }
  return (
    <Data
      procedure={(s) => {
        for (const exprRow of exprRows) {
          s.defScalar(exprRow.scalarName, exprRow.expr);
        }
      }}
    >
      {card}
    </Data>
  );
}
