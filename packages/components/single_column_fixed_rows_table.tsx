import { useCurrentWatchState } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { AnyExpr } from "../std/sql_utils";
import type { StateStatementsOrFn } from "std/statements";
import { Show } from "std/ui";
import type { Node } from "std/ui";
import { Alert } from "./alert";
import { Skeleton } from "./skeleton";
import { Table } from "./table";
import type { TableProps } from "./table";

/** One row of a {@link SingleColumnFixedRowsTable}: a header label and its value. */
export interface RowData {
  /** Row header rendered in the leading `th` cell. */
  header: Node;
  /** Expression whose value is loaded and shown in the row's value cell. */
  expr?: AnyExpr;
  /** Custom renderer for the value cell; receives the loaded `expr` value. */
  cell?: (value: AnyExpr) => Node;
}

/** Props for {@link SingleColumnFixedRowsTable}. Extends {@link TableProps}. */
export interface SingleColumnFixedRowsTableProps extends TableProps {
  /** Procedure run once to load the scalars backing each row's `expr`. */
  procedure?: StateStatementsOrFn;
  /** Fixed set of rows; each renders a header and its loaded value. */
  rows: RowData[];
  caption?: Node;
}

/**
 SingleColumnFixedRowsTable component for displaying a table with a single column and fixed rows.

 This component renders a table with a single column where each row consists of a header and a corresponding value.
 It supports custom cell rendering, loading states, and error handling.

 @category UI Component

 @param props.rows An array of RowData objects defining the content of each row
 @param props.caption Caption for the table
 @param props.procedure Optional procedure to be executed for data loading

 @examples
 [Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
*/
export function SingleColumnFixedRowsTable(
  props:
    & Omit<SingleColumnFixedRowsTableProps, "children">
    & JSX.IntrinsicElements["table"],
) {
  const { rows, caption, procedure, ...other } = props;
  useCurrentWatchState({
    procedure: (s) => {
      s.statements(procedure);
      rows.forEach((row, index) => {
        if (row.expr) {
          s.defScalar(`row_${index}`, row.expr);
        }
      });
    },
    statusScalar: "status",
    hasDataScalar: "has_data",
  });
  return (
    <Show
      when={sql`status != 'failed'`}
      fallback={
        <Alert color="danger" size="lg" startIcon="Error">
          Error loading data
        </Alert>
      }
    >
      <Table {...other}>
        {caption ? <caption>{caption}</caption> : null}
        <tbody>
          {rows.map((row, index) => (
            <tr>
              <th>{row.header}</th>
              <td>
                <Show
                  when={sql`has_data`}
                  fallback={<Skeleton variant="text" level="body-md" />}
                >
                  {row.cell
                    ? row.cell(sql.ref(`row_${index}`))
                    : sql.ref(`row_${index}`)}
                </Show>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Show>
  );
}
