import { Button } from "components/button";
import { IconButton } from "components/icon_button";
import { Select } from "components/select";
import { CurrentRefetchICtxKey, DynamicDatagridICtxKey } from "std/ictx";
import { sql } from "../../std/sql_utils";
import { createStyles } from "std/style_utils";
import { Data } from "std/data";
import { Conditional, Each, Match, Switch, useICtx, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { getSortAscText, getSortDescText } from "./column_menu";
import type { SortConfig } from "./dynamic_datagrid";
import { ToolbarPopover } from "./toolbar_popover";

const styles = createStyles({
  columns: {
    display: "flex",
    gap: 2,
  },
});

type SortAggregated =
  | {
    type: "string" | "numeric" | "checkbox";
    cols: number[];
  }
  | {
    type: "custom";
    col: number;
    config: SortConfig;
  };

function SortPopover() {
  const { columns, triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const aggregatedSorts: SortAggregated[] = [];
  const options: Node[] = [];
  const sortableColumns: {
    index: number;
    displayName: string;
    column: any;
  }[] = [];
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.sort) {
      sortableColumns.push({
        index: i,
        displayName: col.sort.displayName,
        column: col,
      });
    }
  }
  sortableColumns.sort((a, b) => a.displayName.localeCompare(b.displayName));
  for (const { index: i, column: col } of sortableColumns) {
    if (col.sort.type === "custom") {
      aggregatedSorts.push({ type: "custom", col: i, config: col.sort });
    } else {
      const existingSort = aggregatedSorts.find(
        (s) => s.type === col.sort?.type,
      );
      if (existingSort) {
        (existingSort as any).cols.push(i);
      } else {
        aggregatedSorts.push({ type: col.sort?.type, cols: [i] });
      }
    }
    options.push(
      <Select.Option value={i.toString()}>
        {col.sort.displayName}
      </Select.Option>,
    );
  }
  const ascNodeCases: any[] = [];
  const descNodeCases: any[] = [];
  for (const agg of aggregatedSorts) {
    if (agg.type === "custom") {
      ascNodeCases.push(
        <Match when={sql`column_record.id = ${agg.col}`}>
          {getSortAscText(agg.config)}
        </Match>,
      );
      descNodeCases.push(
        <Match when={sql`column_record.id = ${agg.col}`}>
          {getSortDescText(agg.config)}
        </Match>,
      );
    } else {
      ascNodeCases.push(
        <Match when={sql.inList(sql`column_record.id`, agg.cols)}>
          {getSortAscText({ type: agg.type, displayName: "" })}
        </Match>,
      );
      descNodeCases.push(
        <Match when={sql.inList(sql`column_record.id`, agg.cols)}>
          {getSortDescText({ type: agg.type, displayName: "" })}
        </Match>,
      );
    }
  }
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("adding", false);
      }}
    >
      <Each
        table="column"
        eachKey={sql`id`}
        recordName="column_record"
        where={sql`sort_index is not null`}
        orderBy={sql.ref("sort_index")}
      >
        <div sx={styles.columns}>
          <Select
            variant="outlined"
            color="primary"
            size="sm"
            value={sql`column_record.id::string`}
            onInput={(s) => {
              s.defScalar("new_id", sql`cast(target_value as int)`);
              s.if(sql`column_record.id != new_id`, (s) => {
                s.modify(
                  sql`update ui.column set sort_index = column_record.sort_index, sort_asc = column_record.sort_asc where id = new_id`,
                );
                s.modify(
                  sql`update ui.column set sort_index = null where id = column_record.id`,
                );
                triggerRefetch(s);
              });
              triggerChangesInToolbar(s);
            }}
            className="w-[200px]"
          >
            {options}
          </Select>
          <Select
            variant="outlined"
            color="primary"
            size="sm"
            value={sql`case when column_record.sort_asc then 'asc' else 'desc' end`}
            onInput={(s) => {
              s.modify(
                sql`update ui.column set sort_asc = target_value = 'asc' where id = column_record.id`,
              );
              triggerRefetch(s);
              triggerChangesInToolbar(s);
            }}
            className="w-[150px]"
          >
            <Select.Option value="asc">
              <Switch>{ascNodeCases}</Switch>
            </Select.Option>
            <Select.Option value="desc">
              <Switch>{descNodeCases}</Switch>
            </Select.Option>
          </Select>
          <IconButton
            icon="Close"
            variant="plain"
            color="primary"
            size="sm"
            aria-label="Remove sort"
            onClick={(s) => {
              s.modify(
                sql`update ui.column set sort_index = null, sort_asc = null where id = column_record.id`,
              );
              triggerRefetch(s);
              triggerChangesInToolbar(s);
            }}
          />
        </div>
      </Each>
      <Conditional
        when={sql`adding or not exists (select id from column where sort_index is not null)`}
        then={
          <Select
            variant="outlined"
            color="primary"
            size="sm"
            onInput={(s) => {
              s.setScalar("ui.adding", false);
              s.modify(sql`update ui.column
                    set sort_index = coalesce((select max(sort_index) from column) + 1, 0),
                    sort_asc = true
                    where id = try_cast(target_value as int)`);
              triggerRefetch(s);
              triggerChangesInToolbar(s);
            }}
            className="w-[200px]"
          >
            <Select.Option value="default">
              {sql`case when exists (select id from column where sort_index is not null) then 'Select another field...' else 'Select field...' end`}
            </Select.Option>
            {options}
          </Select>
        }
        else={
          <Button
            variant="outlined"
            color="primary"
            size="sm"
            startIcon="Add"
            onClick={(s) => {
              s.setScalar("ui.adding", true);
              triggerChangesInToolbar(s);
            }}
          >
            Add another field
          </Button>
        }
      />
    </Data>
  );
}

export function ToolbarSortButton() {
  const sortButtonId = useUniqueId();
  const buttonText = sql`case
    when sort_field_count = 0 then 'Sort'
    when sort_field_count = 1 then 'Sorted by 1 field'
    else 'Sorted by ' || sort_field_count || ' fields'
  end`;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("popover_open", false);
      }}
    >
      <Data
        local
        procedure={(s) => {
          s.defScalar("sort_field_count", {
            type: "BigInt",
            expr:
              sql`(select count(*) from column where sort_index is not null)`,
          });
        }}
        watch={[sql`has_changes_refresh_key`]}
      >
        <Button
          variant="plain"
          color="neutral"
          size="sm"
          startIcon="SwapVert"
          onClick={(s) => s.toggle("popover_open")}
          id={sortButtonId}
        >
          {buttonText}
        </Button>
      </Data>
      <ToolbarPopover
        openScalar={sql.ref("ui.popover_open")}
        buttonId={sortButtonId}
      >
        <SortPopover />
      </ToolbarPopover>
    </Data>
  );
}
