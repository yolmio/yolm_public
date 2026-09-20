import { Button } from "components/button";
import { Divider } from "components/divider";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { SwitchControl } from "components/switch";
import {
  CurrentRefetchICtxKey,
  DatagridColumnOrderICtxKey,
  DynamicDatagridICtxKey,
} from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { createStyles, cssVar } from "std/style_utils";
import { Each, Show, useICtx, useUniqueId } from "std/ui";
import { Data } from "std/data";
import { styles as sharedStyles } from "./styles";
import { ToolbarPopover } from "./toolbar_popover";

const styles = createStyles({
  columnsWrapper: {
    display: "flex",
    flexDirection: "column",
    maxHeight: 500,
    overflow: "auto",
    listStyle: "none",
    m: 0,
    p: 0,
  },
  column: {
    display: "flex",
    gap: 2,
    alignItems: "center",
    minHeight: 32,
    // this is because the drag and drop api triggers a drag leave event whenver you
    // drag over an element within the column for some reason unless you set this
    "&.any-column-dragging": {
      pointerEvents: "none",
    },
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 1,
    px: 2,
    pt: 2,
    pb: 1,
    fontSize: "xs",
    fontWeight: "lg",
    color: "text-tertiary",
    textTransform: "uppercase",
  },
  sectionCount: {
    color: "text-tertiary",
    fontWeight: "md",
  },
  columnName: {
    minWidth: 0,
    flexGrow: 1,
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  pinState: {
    width: 24,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "text-tertiary",
  },
  columnActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 0.5,
  },
  columnDropArea: {
    pr: 2,
    py: 2,
    borderTop: "2px solid",
    borderBottom: "2px solid",
    borderColor: "transparent",
    "&.top": {
      borderColor: cssVar("palette-primary-400"),
      borderBottomColor: "transparent",
    },
    "&.bottom": {
      borderColor: cssVar("palette-primary-400"),
      borderTopColor: "transparent",
    },
  },
  dragIndicator: {
    cursor: "grab",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    "&:active": {
      cursor: "grabbing",
    },
  },
});

function ColumnItem() {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { fns, triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const { setColumnPin } = useICtx(DatagridColumnOrderICtxKey);
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        // none | top | bottom
        s.defScalar("accept_drop", sql.lit`none`);
      }}
    >
      <li
        sx={styles.columnDropArea}
        dynamicClasses={[
          {
            classes: "top",
            condition: sql`accept_drop = 'top'`,
          },
          {
            classes: "bottom",
            condition: sql`accept_drop = 'bottom'`,
          },
        ]}
        id={sql`'li_' || column_record.id`}
        onDragOver={(s) => {
          s.event.preventDefault();
          s.element(sql`'li_' || column_record.id`).getBoundingClientRect(
            "rect",
          );
          s.defScalar("midpoint", sql`(rect.top + rect.bottom) / 2`);
          s.setScalar(
            "accept_drop",
            sql`case
                    when dragging_column is null then 'none'
                    when exists(
                      select 1 from ui.column
                      where id = dragging_column
                        and (pin_left != column_record.pin_left or pin_right != column_record.pin_right)
                    ) then 'none'
                    when exists(
                      select 1 from ui.column
                      where id = dragging_column
                        and not can_reorder
                    ) then 'none'
                    when not column_record.can_reorder then 'none'
                    when event.client_y <= midpoint then 'top'
                    else 'bottom'
                  end`,
          );
        }}
        onDragLeave={(s) => {
          s.setScalar("accept_drop", sql.lit`none`);
        }}
        onDrop={(s) => {
          s.returnIf(
            sql`dragging_column is null
              or accept_drop = 'none'
              or not column_record.can_reorder
              or exists(
                select 1 from ui.column
                where id = dragging_column
                  and (pin_left != column_record.pin_left or pin_right != column_record.pin_right)
              )
              or exists(
                select 1 from ui.column
                where id = dragging_column
                  and not can_reorder
              )`,
          );
          s.defScalar(
            "ordering_before",
            sql`(select max(ordering) from ui.column where ordering < column_record.ordering and pin_left = column_record.pin_left and pin_right = column_record.pin_right)`,
          );
          s.defScalar(
            "ordering_after",
            sql`(select min(ordering) from ui.column where ordering > column_record.ordering and pin_left = column_record.pin_left and pin_right = column_record.pin_right)`,
          );
          s.modify(sql`update ui.column set ordering = case accept_drop
                        when 'top' then ordering.new(ordering_before, column_record.ordering)
                        when 'bottom' then ordering.new(column_record.ordering, ordering_after)
                        else ordering
                      end
                      where id = dragging_column`);
          s.setScalar("accept_drop", sql.lit`none`);
          s.setScalar("dragging_column", sql.null);
          triggerRefetch(s);
          triggerChangesInToolbar(s);
        }}
      >
        <div
          sx={styles.column}
          dynamicClasses={[
            {
              classes: "any-column-dragging",
              condition:
                sql`dragging_column is not null and dragging_column != column_record.id`,
            },
          ]}
        >
          <Show
            when={sql`column_record.can_reorder`}
            fallback={<div sx={styles.dragIndicator} />}
          >
            <div
              sx={styles.dragIndicator}
              aria-label="Drag column"
              draggable
              onDragStart={(s) => {
                s.setEffectAllowed(sql.lit`move`);
                s.setScalar("dragging_column", sql`column_record.id`);
              }}
              onDragEnd={(s) => {
                s.setScalar("dragging_column", sql.null);
                s.setScalar("accept_drop", sql.lit`none`);
              }}
            >
              <MaterialIcon icon="DragIndicator" />
            </div>
          </Show>
          <div sx={styles.pinState}>
            <Show when={sql`column_record.pin_left`}>
              <MaterialIcon icon="KeyboardDoubleArrowLeft" />
            </Show>
            <Show when={sql`column_record.pin_right`}>
              <MaterialIcon icon="KeyboardDoubleArrowRight" />
            </Show>
          </div>
          <span sx={styles.columnName}>
            {sql`fn.${fns.idToColumnsDisplayName}(column_record.id)`}
          </span>
          <div sx={styles.columnActions}>
            <Show
              when={sql`column_record.can_pin and not column_record.pin_left`}
            >
              <IconButton
                variant="plain"
                color="neutral"
                size="xs"
                icon="KeyboardDoubleArrowLeft"
                aria-label="Pin column left"
                tooltip="Pin left"
                onClick={(s) => {
                  setColumnPin(s, sql`column_record.id`, "left");
                  triggerChangesInToolbar(s);
                }}
              />
            </Show>
            <Show
              when={sql`column_record.can_pin and not column_record.pin_right`}
            >
              <IconButton
                variant="plain"
                color="neutral"
                size="xs"
                icon="KeyboardDoubleArrowRight"
                aria-label="Pin column right"
                tooltip="Pin right"
                onClick={(s) => {
                  setColumnPin(s, sql`column_record.id`, "right");
                  triggerChangesInToolbar(s);
                }}
              />
            </Show>
            <Show
              when={sql`column_record.can_pin and (column_record.pin_left or column_record.pin_right)`}
            >
              <IconButton
                variant="plain"
                color="neutral"
                size="xs"
                icon="PushPinOutlined"
                aria-label="Unpin column"
                tooltip="Unpin"
                onClick={(s) => {
                  setColumnPin(s, sql`column_record.id`, null);
                  triggerChangesInToolbar(s);
                }}
              />
            </Show>
          </div>
          <SwitchControl
            id={sql`column_record.id`}
            checked={sql`column_record.displaying`}
            disabled={sql`not column_record.can_hide`}
            onCheckboxChange={(s) => {
              s.returnIf(
                sql`column_record.displaying and (select count(*) from ui.column where displaying) = 1`,
              );
              s.modify(
                sql`update column_record set displaying = not displaying`,
              );
              s.if(sql`column_record.displaying`, triggerRefetch);
              triggerChangesInToolbar(s);
            }}
          />
        </div>
      </li>
    </Data>
  );
}

function ColumnSection(props: {
  title: string;
  icon: "KeyboardDoubleArrowLeft" | "ViewColumn" | "KeyboardDoubleArrowRight";
  where: Sql;
}) {
  return (
    <Show when={sql`exists(select 1 from column where ${props.where})`}>
      <li sx={styles.sectionHeader}>
        <MaterialIcon icon={props.icon} />
        <span>{props.title}</span>
        <span sx={styles.sectionCount}>
          {sql`(select count(*) from column where ${props.where})`}
        </span>
      </li>
      <Each
        table="column"
        orderBy={sql`ordering`}
        where={props.where}
        eachKey={sql`id`}
        recordName="column_record"
      >
        <ColumnItem />
      </Each>
    </Show>
  );
}

function ColumnsPopover() {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { fns, triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const columnFilter =
    sql`fn.${fns.idToColumnsDisplayName}(id) is not null and (trim(filter_text) = '' or fn.${fns.idToColumnsDisplayName}(id) like '%' || filter_text || '%')`;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("filter_text", sql.lit``);
        s.defScalar("dragging_column", {
          type: "BigInt",
        });
      }}
    >
      <Input
        variant="outlined"
        color="neutral"
        size="sm"
        bindScalar="filter_text"
        placeholder="Find a column..."
      />
      <Divider sx={sharedStyles.popoverDivider} />
      <ul sx={styles.columnsWrapper}>
        <ColumnSection
          title="Pinned left"
          icon="KeyboardDoubleArrowLeft"
          where={sql`${columnFilter} and pin_left`}
        />
        <ColumnSection
          title="Columns"
          icon="ViewColumn"
          where={sql`${columnFilter} and not pin_left and not pin_right`}
        />
        <ColumnSection
          title="Pinned right"
          icon="KeyboardDoubleArrowRight"
          where={sql`${columnFilter} and pin_right`}
        />
      </ul>
      <div sx={sharedStyles.popoverButtons}>
        <Button
          variant="outlined"
          color="primary"
          onClick={(s) => {
            s.modify(sql`update ui.column set displaying = true`);
            triggerRefetch(s);
            triggerChangesInToolbar(s);
          }}
        >
          Show all
        </Button>
        <Button
          variant="outlined"
          color="primary"
          onClick={(s) => {
            s.modify(
              sql`update ui.column set displaying = false where id != 0 and can_hide`,
            );
            triggerRefetch(s);
            triggerChangesInToolbar(s);
          }}
        >
          Show none
        </Button>
      </div>
    </Data>
  );
}

export function ToolbarColumnsButton() {
  const { fns } = useICtx(DynamicDatagridICtxKey);
  const hiddenColumnCount =
    sql`(select count(*) from column where not displaying and fn.${fns.idToColumnsDisplayName}(id) is not null)`;
  const columnsButtonId = useUniqueId();
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("popover_open", false);
      }}
    >
      <Data
        local
        procedure={(s) => {
          s.defScalar("hidden_column_count", {
            type: "BigInt",
            expr: hiddenColumnCount,
          });
        }}
        watch={[sql`has_changes_refresh_key`]}
      >
        <Button
          variant="plain"
          color="neutral"
          size="sm"
          startIcon="VisibilityOffOutlined"
          id={columnsButtonId}
          onClick={(s) => {
            s.toggle("popover_open");
          }}
        >
          {sql`case
            when hidden_column_count = 0 then 'Columns'
            when hidden_column_count = 1 then '1 hidden column'
            else hidden_column_count || ' hidden columns'
          end`}
        </Button>
      </Data>
      <ToolbarPopover
        openScalar={sql.ref("ui.popover_open")}
        buttonId={columnsButtonId}
      >
        <ColumnsPopover />
      </ToolbarPopover>
    </Data>
  );
}
