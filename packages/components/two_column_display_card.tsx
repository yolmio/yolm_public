import { Card } from "components/card";
import { Divider } from "components/divider";
import { InlineFieldDisplay } from "components/inline_field_display";
import { Typography } from "components/typography";
import { CurrentRecordICtxKey, CurrentTableICtxKey } from "std/ictx";
import { selectColumn, sql } from "../std/sql_utils";
import type { AnyExpr, SelectColumn } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles, flexGrowStyles } from "std/style_utils";
import { useICtx, useSourceMap } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";

const styles = createStyles({
  root: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 2,
    my: 0,
    md: {
      my: 1,
      gridTemplateColumns: "1fr 1fr",
    },
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    pb: 3,
  },
  divider: {
    mb: 3,
  },
  cell: {
    display: "flex",
    flexDirection: "column",
    minHeight: 54,
  },
  label: {
    fontWeight: "semibold",
    fontSize: "sm",
  },
  data: {
    p: 0,
    mt: 1,
    fontSize: "base",
    color: "text-secondary",
  },
});

type Cell =
  | string
  | {
    label: Node;
    recordExpr: AnyExpr;
    display?: (value: AnyExpr) => Node;
  }
  | {
    label: Node;
    expr: AnyExpr;
    display?: (value: AnyExpr) => Node;
  };

/** Props for {@link TwoColumnDisplayCard}. */
export interface Props {
  sx?: Style;
  className?: string;
  /** Heading shown above the grid; omit to render the card with no header. */
  headerText?: Node;
  /** Content aligned to the right of the header (e.g. an edit button). */
  headerRight?: Node;
  /**
   * The label/value pairs to display, laid out two per row. Each cell is
   * either a field name on the current record's table (label + value
   * inferred), or an object with an explicit `label` plus a `recordExpr`
   * (selected from the record) or `expr` (rendered as-is), with an optional
   * `display` wrapper.
   */
  cells: Cell[];
}

/**
 TwoColumnDisplayCard component for displaying data in a two-column layout within a card.
 Supports dynamic data fetching and custom cell rendering.

@category UI Component

@examples
 [Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
*/
export function TwoColumnDisplayCard(props: Props) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const selectColumns: SelectColumn[] = [
    selectColumn(currentTable.primaryKeyIdent, currentTable.primaryKeyIdent),
  ];
  const cells = props.cells;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (typeof cell === "string") {
      const field = currentTable.fields[cell];
      if (!field) {
        throw new Error(
          `Field ${cell} not found in table ${currentTable.name}`,
        );
      }
      selectColumns.push(selectColumn(sql`record.${field.ident}`, field.ident));
    } else if ("recordExpr" in cell) {
      selectColumns.push(selectColumn(sql`${cell.recordExpr}`, `e_${i}`));
    }
  }
  useSourceMap("two_column_display_card");
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "record",
          sql`select ${selectColumns} from ${currentTable.identWithDb} as record where id = ${currentRecordId}`,
        );
      }}
    >
      <Card variant="outlined" sx={props.sx} className={props.className}>
        {props.headerText && (
          <>
            <div sx={styles.header}>
              <Typography level="body-lg">{props.headerText}</Typography>
              {props.headerRight && (
                <>
                  <div sx={flexGrowStyles} />
                  {props.headerRight}
                </>
              )}
            </div>
            <Divider sx={styles.divider} />
          </>
        )}
        <dl sx={styles.root}>
          {props.cells.map((row, i) => {
            let label: Node;
            let value: Node;
            if (typeof row === "string") {
              const field = currentTable.fields[row];
              label = sql.lit(field.displayName);
              value = (
                <InlineFieldDisplay
                  field={field}
                  value={sql`record.${sql.ref(field.name)}`}
                />
              );
            } else if ("recordExpr" in row) {
              label = row.label;
              const expr = sql`record.e_${sql(i)}`;
              value = row.display ? (row.display(expr) as Node) : expr;
            } else {
              label = row.label;
              value = row.display
                ? (row.display(row.expr) as Node)
                : sql.normalizeExpr(row.expr);
            }
            return (
              <div sx={styles.cell}>
                <dt sx={styles.label}>{label}</dt>
                <dd sx={styles.data}>{value}</dd>
              </div>
            );
          })}
        </dl>
      </Card>
    </Data>
  );
}
