import { IconButton } from "components/icon_button";
import { List, ListItem, ListItemButton } from "components/list";
import { MaterialIcon } from "components/material_icon";
import { getUniqueUiId } from "components/utils";
import { Data } from "std/data";
import {
  CurrentRefetchICtxKey,
  DatagridColumnOrderICtxKey,
  DatagridSortICtxKey,
  DynamicDatagridICtxKey,
} from "std/ictx";
import { sql } from "../../std/sql_utils";
import { createStyles } from "std/style_utils";
import { Show, useICtx } from "std/ui";
import { lazyPerApp } from "std/utils/memoize";
import type { SortConfig } from "./dynamic_datagrid";

const stringSortAscNode = sql.lit`A → Z`;
const stringSortDescNode = sql.lit`Z → A`;
const stringSortAscText = stringSortAscNode;
const stringSortDescText = stringSortDescNode;

const numericSortAscNode = sql.lit`1 → 9`;
const numericSortDescNode = sql.lit`9 → 1`;
const numericSortAscText = numericSortAscNode;
const numericSortDescText = numericSortDescNode;

const checkboxStyles = {
  ml: 2,
  display: "inline-flex",
};
const checkboxSortAscNode = lazyPerApp(() => (
  <span sx={checkboxStyles}>
    <MaterialIcon icon="CheckBoxOutlined" />
    <span>→</span>
    <MaterialIcon icon="CheckBoxOutlineBlank" />
  </span>
));
const checkboxSortDescNode = lazyPerApp(() => (
  <span sx={checkboxStyles}>
    <MaterialIcon icon="CheckBoxOutlineBlank" />
    <span>→</span>
    <MaterialIcon icon="CheckBoxOutlined" />
  </span>
));
const checkboxSortAscText = sql.lit`☐ → ✓`;
const checkboxSortDescText = sql.lit`✓ → ☐`;

function getSortAscNode(sort: SortConfig) {
  switch (sort.type) {
    case "string":
      return stringSortAscNode;
    case "checkbox":
      return checkboxSortAscNode();
    case "numeric":
      return numericSortAscNode;
    case "custom":
      return sort.ascNode;
  }
}

function getSortDescNode(sort: SortConfig) {
  switch (sort.type) {
    case "string":
      return stringSortDescNode;
    case "checkbox":
      return checkboxSortDescNode();
    case "numeric":
      return numericSortDescNode;
    case "custom":
      return sort.descNode;
  }
}

export function getSortAscText(sort: SortConfig) {
  switch (sort.type) {
    case "string":
      return stringSortAscText;
    case "checkbox":
      return checkboxSortAscText;
    case "numeric":
      return numericSortAscText;
    case "custom":
      return sort.ascText;
  }
}

export function getSortDescText(sort: SortConfig) {
  switch (sort.type) {
    case "string":
      return stringSortDescText;
    case "checkbox":
      return checkboxSortDescText;
    case "numeric":
      return numericSortDescText;
    case "custom":
      return sort.descText;
  }
}

const styles = createStyles({
  columnDialog: (app) => {
    return {
      position: "fixed",
      backgroundColor: "background-popup",
      borderRadius: "md",
      boxShadow: "md",
      zIndex: 100,
      minWidth: 192,
      width: 192,
      border: "1px solid",
      borderColor: "divider",

      opacity: 0,
      transformOrigin: "top right",
      transform: "scale(0)",

      "&:popover-open": {
        opacity: 1,
        transform: "none",
        "@starting-style": {
          "&": {
            opacity: 0,
            transform: "scale(0)",
          },
        },
      },

      margin: 0,
      transition:
        `opacity ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, transform ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, display ${app.theme.transitionDurations.popover} allow-discrete`,
    };
  },
});

const popoverId = getUniqueUiId();

export interface ColumnMenuProps {
  columnIndex: number;
  sort?: SortConfig;
}

export function ColumnMenu(props: ColumnMenuProps) {
  const { columnIndex: i, sort } = props;
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { setColumnPin } = useICtx(DatagridColumnOrderICtxKey);
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  // const { setColumnDisplaying } = useICtx(DatagridColumnDisplayICtxKey);
  const { setColumnSort } = useICtx(DatagridSortICtxKey);
  const id = sql.concat(popoverId, "-", i);
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(
          "column_menu_pinned_left",
          {
            type: "Bool",
            expr:
              sql`coalesce((select pin_left from column where id = ${i}), false)`,
          },
        );
        s.defScalar(
          "column_menu_pinned_right",
          {
            type: "Bool",
            expr:
              sql`coalesce((select pin_right from column where id = ${i}), false)`,
          },
        );
        s.defScalar(
          "column_menu_can_pin",
          {
            type: "Bool",
            expr:
              sql`coalesce((select can_pin from column where id = ${i}), false)`,
          },
        );
      }}
      watch={[sql`has_changes_refresh_key`]}
    >
      <IconButton
        variant="plain"
        color="neutral"
        size="sm"
        tabIndex={-1}
        id={id}
        aria-label="Open column menu"
        onClick={(s) => {
          s.setScalar(
            "ui.open_column_dialog",
            sql`case when ui.open_column_dialog = ${i} then null else ${i} end`,
          );
          s.event.stopPropagation();
        }}
      >
        <MaterialIcon fontSize="base" icon="MoreVert" />
      </IconButton>
      <List
        sx={styles.columnDialog()}
        popover="auto"
        yolmPopoverShowing={sql`ui.open_column_dialog = ${i}`}
        floating={{
          anchorEl: id,
          placement: sql.lit`bottom-end`,
          strategy: sql.lit`fixed`,
          shift: {
            mainAxis: true,
            crossAxis: true,
          },
          offset: {
            mainAxis: 4,
            crossAxis: 0,
          },
          flip: {
            crossAxis: false,
            mainAxis: false,
          },
        }}
        onToggleHide={(s) => {
          s.setScalar("ui.open_column_dialog", sql.null);
        }}
      >
        {sort
          ? (
            <>
              <ListItem
                onClick={(s) => {
                  setColumnSort(s, i, true);
                  s.setScalar("ui.open_column_dialog", sql.null);
                  triggerRefetch(s);
                  triggerChangesInToolbar(s);
                }}
              >
                <ListItemButton variant="plain" color="neutral">
                  Sort {getSortAscNode(sort)}
                </ListItemButton>
              </ListItem>
              <ListItem
                onClick={(s) => {
                  setColumnSort(s, i, false);
                  s.setScalar("ui.open_column_dialog", sql.null);
                  triggerRefetch(s);
                  triggerChangesInToolbar(s);
                }}
              >
                <ListItemButton variant="plain" color="neutral">
                  Sort {getSortDescNode(sort)}
                </ListItemButton>
              </ListItem>
            </>
          )
          : undefined}
        {
          /* <ListItem
          onClick={(s) => {
            setColumnDisplaying(s, i, sql.false);
          }}
        >
          <ListItemButton variant="plain" color="neutral">
            Hide Field
          </ListItemButton>
        </ListItem> */
        }
        <Show
          when={sql`column_menu_can_pin and not column_menu_pinned_left`}
        >
          <ListItem
            onClick={(s) => {
              setColumnPin(s, i, "left");
              s.setScalar("ui.open_column_dialog", sql.null);
              triggerChangesInToolbar(s);
            }}
          >
            <ListItemButton variant="plain" color="neutral">
              Pin left
            </ListItemButton>
          </ListItem>
        </Show>
        <Show
          when={sql`column_menu_can_pin and not column_menu_pinned_right`}
        >
          <ListItem
            onClick={(s) => {
              setColumnPin(s, i, "right");
              s.setScalar("ui.open_column_dialog", sql.null);
              triggerChangesInToolbar(s);
            }}
          >
            <ListItemButton variant="plain" color="neutral">
              Pin right
            </ListItemButton>
          </ListItem>
        </Show>
        <Show
          when={sql`column_menu_can_pin and (column_menu_pinned_left or column_menu_pinned_right)`}
        >
          <ListItem
            onClick={(s) => {
              setColumnPin(s, i, null);
              s.setScalar("ui.open_column_dialog", sql.null);
              triggerChangesInToolbar(s);
            }}
          >
            <ListItemButton variant="plain" color="neutral">
              Unpin
            </ListItemButton>
          </ListItem>
        </Show>
      </List>
    </Data>
  );
}
