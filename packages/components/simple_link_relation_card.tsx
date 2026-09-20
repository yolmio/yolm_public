import { Button } from "components/button";
import { Card, CardOverflow } from "components/card";
import { Chip } from "components/chip";
import { Divider } from "components/divider";
import { InlineFieldDisplay } from "components/inline_field_display";
import { Link } from "components/link";
import { Typography } from "components/typography";
import { getUniqueUiId } from "components/utils";
import { CurrentRecordICtxKey, CurrentTableICtxKey } from "std/ictx";
import { pluralize } from "std/inflectors";
import { getHrefToRecord } from "std/shared_contexts";
import { Data } from "std/data";
import { selectColumn, sql } from "../std/sql_utils";
import type { AnyExpr, SelectColumn, Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles, flexGrowStyles } from "std/style_utils";
import { system } from "std/system";
import { Each, Show, useICtx } from "std/ui";
import type { Node } from "std/ui";

export type TableDisplayValue =
  | string
  | {
    expr: AnyExpr;
    label: Node;
    display: (sql: Sql) => Node;
  };

export interface Props {
  table: string;
  fkField?: string;
  sx?: Style;
  className?: string;
  headerStartDecorator?: Node;
  header?: Node;
  displayValues: TableDisplayValue[];
}

const styles = createStyles({
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    pb: 3,
  },
  list: {
    listStyle: "none",
    px: 0,
    py: 2,
    my: 0,
    overflowY: "auto",
    maxHeight: "300px",
  },
  listItem: {
    p: 0,
    display: "flex",
    alignItems: "center",
    gap: 4,
    "&:not(:last-child)": {
      borderBottom: "1px solid",
      borderBottomColor: "divider",
      mb: 2,
      pb: 2,
    },
    px: 4,
  },
  itemValue: {
    mr: 1,
    color: "text-secondary",
    my: 0,
    fontSize: "sm",
    alignSelf: "flex-end",
  },
  itemValueWrapper: {
    display: "flex",
    flexDirection: "column",
    mb: 4,
  },
});

/**
 SimpleLinkRelationCard component for displaying a card with related records.

 This component renders a card that shows a list of related records from another table,
 with customizable display values and linking options.

 @category UI Component

 @param props.table The name of the related table
 @param props.displayValues An array of display values for each related record
 @param props.sx
 @param props.headerStartDecorator A node to be displayed at the start of the header
 @param props.header Custom header content

 @examples
 [Example](../../examples/kitchen_sink/apps/kitchen-sink.yolmstaging.net.tsx)
*/
export function SimpleLinkRelationCard(props: Props) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const otherTable = system.db.tables[props.table];
  const listScrollId = sql.lit(getUniqueUiId());
  if (!otherTable) {
    throw new Error(`Table ${props.table} not found`);
  }
  const foreignKeyField = Object.values(otherTable.fields).find(
    (f) => f.type === "ForeignKey" && f.table === currentTable.name,
  );
  if (!foreignKeyField) {
    throw new Error(
      `No foreign key field found for ${currentTable.name} to ${props.table}`,
    );
  }
  const displayValues = props.displayValues;
  const selectFields: SelectColumn[] = [selectColumn(sql`id`)];
  for (let i = 0; i < displayValues.length; i++) {
    const value = displayValues[i];
    if (typeof value === "string") {
      selectFields.push(selectColumn(sql.ref(value)));
    } else {
      selectFields.push(selectColumn(value.expr, `expr_${i}`));
    }
  }
  const { recordDisplayName } = otherTable;
  if (recordDisplayName) {
    selectFields.push(
      selectColumn(
        recordDisplayName.expr(
          ...recordDisplayName.fields.map(
            (f) => sql`${sql.ref(props.table)}.${sql.ref(f)}`,
          ),
        ),
        "display_name",
      ),
    );
  }
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("row_count", sql`20`);
      }}
    >
      <Data
        watch={[sql`row_count`]}
        statusScalar="status"
        procedure={(s) => {
          s.defTable(
            "related",
            sql`select ${selectFields} from ${otherTable.identWithDb} where ${foreignKeyField.ident} = ${currentRecordId} order by id desc limit row_count`,
          );
          s.defScalar("service_row_count", sql`row_count`);
        }}
      >
        <Card variant="outlined" sx={props.sx} className={props.className}>
          <div sx={styles.header}>
            <Typography
              level="body-lg"
              startDecorator={props.headerStartDecorator}
            >
              {props.header ?? pluralize(otherTable.displayName)}
            </Typography>
          </div>
          <Divider />
          <CardOverflow>
            <ul
              id={listScrollId}
              sx={styles.list}
              onScroll={(s) => {
                s.returnIf(
                  sql`status != 'received' or (service_row_count is not null and (select count(*) from related) < service_row_count)`,
                );
                const listScrollEl = s.element(listScrollId);
                listScrollEl.getScrollHeight("el_scroll_height");
                listScrollEl.getBoundingClientRect("el_rect");
                listScrollEl.getScrollTop("el_scroll_top");
                s.if(
                  sql`el_scroll_height - el_scroll_top - el_rect.height < 300`,
                  (s) => s.increment("row_count", 20),
                );
              }}
            >
              <Each
                table="related"
                recordName="record"
                eachKey={sql`record.id`}
              >
                <li sx={styles.listItem}>
                  {recordDisplayName
                    ? (
                      <Link
                        href={getHrefToRecord(otherTable, sql`record.id`)}
                      >
                        {sql`record.display_name`}
                      </Link>
                    )
                    : (
                      <Button
                        href={getHrefToRecord(otherTable, sql`record.id`)}
                        size="sm"
                      >
                        View
                      </Button>
                    )}
                  <div sx={flexGrowStyles} />
                  {displayValues.map((displayValue, i) => {
                    if (typeof displayValue === "string") {
                      const field = otherTable.fields[displayValue];
                      if (!field) {
                        throw new Error(
                          `Field ${displayValue} does not exist in table ${otherTable.name}`,
                        );
                      }
                      const value = sql`record.${sql.ref(displayValue)}`;
                      if (field.type === "Bool") {
                        return (
                          <Show when={value}>
                            <Chip variant="soft" color="neutral" size="sm">
                              {field.displayName}
                            </Chip>
                          </Show>
                        );
                      }
                      const content = (
                        <div sx={styles.itemValueWrapper}>
                          <p sx={styles.itemValue}>{field.displayName}:</p>
                          <InlineFieldDisplay field={field} value={value} />
                        </div>
                      );
                      if (field.notNull) {
                        return content;
                      }
                      return <Show when={sql.isNotNull(value)}>{content}</Show>;
                    }
                    return (
                      <div sx={styles.itemValueWrapper}>
                        <p sx={styles.itemValue}>{displayValue.label}:</p>
                        {displayValue.display(sql`record.expr_${i}`)}
                      </div>
                    );
                  })}
                </li>
              </Each>
            </ul>
          </CardOverflow>
        </Card>
      </Data>
    </Data>
  );
}
