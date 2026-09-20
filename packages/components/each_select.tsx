import { sql } from "../std/sql_utils";
import type { AnyExpr, BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import { DomStatements } from "std/statements";
import { getVariantStyle } from "std/style_utils";
import type { HelperFieldType } from "std/system";
import type { Variant } from "std/theme";
import { Each, Show, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { List, ListItemButton } from "./list";
import {
  selectEndDecoratorSlot,
  SelectIcon,
  selectIconSlot,
  selectPopoverStyles,
  selectRoot,
  selectStartDecoratorSlot,
} from "./select";
import { SvgIcon } from "./svg_icon";
import type { Color, ComponentOpts, Size } from "./types";
import type { SlottedComponentBaseProps } from "./utils";

interface EachSelectProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      select: "select";
      startDecorator: "span";
      endDecorator: "span";
      icon: "span";
    }> {
  table: string;
  where?: BooleanExpr;
  orderBy?: AnyExpr;
  limit?: NumericExpr;
  /**
       This is always the id of the record
    **/
  value?: NumericExpr;
  renderItem?: Node;
  fullWidth?: boolean;
  error?: BooleanExpr;
  startDecorator?: Node;
  endDecorator?: Node;
  placeholder?: string;
  onChange?: (s: DomStatements, recordId: NumericExpr) => void;
  findOnValue?: string;
  optionLabel: string;
  optionValue: string;
  valueType?: HelperFieldType;
  id?: Sql | string;
  watch?: AnyExpr[];
}

interface OwnerState {
  variant: Variant;
  color: Color;
  size: Size;
  fullWidth: boolean;
  placeholder?: string;
}

/**
 * `Select` whose options are populated from rows in a database table.
 *
 * Use when the option set is dynamic and table-backed but doesn't need
 * the searchable-combobox affordance of `QueryCombobox` — e.g. a small
 * status table or an FK picker that fits comfortably in a dropdown.
 * Provide `table` plus `optionLabel`/`optionValue` (column names);
 * narrow with `where`, `orderBy`, `limit`. The current selection is
 * controlled via `value` + `onChange` (the change handler receives the
 * picked record id).
 */
export function EachSelect(props: EachSelectProps) {
  const {
    color = "neutral",
    variant = "outlined",
    size = "md",
    fullWidth = false,
    error,
    startDecorator,
    endDecorator,
    placeholder = "Select option",
    onChange,
    value,
    optionLabel,
    optionValue,
    findOnValue = optionLabel,
    id: idProp,
  } = props;
  const id = idProp ?? useUniqueId();
  const ownerState: OwnerState = {
    variant,
    color,
    size,
    fullWidth,
    placeholder,
  };
  const where = props.where ? sql` where ${props.where}` : sql``;
  const orderBy = props.orderBy ? sql` order by ${props.orderBy}` : sql``;
  const limit = props.limit !== undefined ? sql` limit ${props.limit}` : sql``;

  const findOnValueExpr = typeof findOnValue === "string"
    ? sql.ref(findOnValue)
    : findOnValue;
  const [RootSlot, rootProps] = selectRoot({
    component: "div",
    rootProps: props,
    internalProps: {
      dynamicClasses: error
        ? [{ classes: "error", condition: error }]
        : undefined,
      id,
      tabIndex: 0,
      onKeyDown: (s: DomStatements) => {
        s.if(
          sql`regex.is_match(event.key, '^[a-zA-Z0-9]$')`,
          (s: DomStatements) => {
            const key = sql`lower(event.key)`;
            s.if(sql`selected_index is not null`, (s: DomStatements) => {
              s.defScalar(
                "next_match",
                sql`(
                select min(rn)
                from (
                  select row_number() over () - 1 as rn, ${findOnValueExpr}
                  from select_table
                ) numbered
                where rn > selected_index
                and lower(left(${findOnValueExpr}, 1)) = ${key}
               )`,
              );
              s.if(sql`next_match is not null`, (s: DomStatements) => {
                s.setScalar("selected_index", sql`next_match`);
                s.element(sql.concat(id, "-opt-", sql`selected_index`)).focus();
                s.return();
              });
            });

            // If no selection or no next match found, start from beginning
            s.defScalar(
              "first_match",
              sql`(
                select min(rn)
                from (
                  select row_number() over () - 1 as rn, ${findOnValueExpr}
                  from select_table
                ) numbered
                where lower(left(${findOnValueExpr}, 1)) = ${key}
              )`,
            );
            s.if(sql`first_match is not null`, (s: DomStatements) => {
              s.setScalar("selected_index", sql`first_match`);
              s.element(sql.concat(id, "-opt-", sql`selected_index`)).focus();
            });
          },
        );
        s.if(sql`event.key in (' ', 'Enter')`, (s: DomStatements) => {
          s.event.preventDefault();
          s.element(sql.concat(id, "-opt-", sql`selected_index`)).click();
          s.setScalar("selected_index", sql.null);
        });
        s.if(sql`event.key = 'ArrowDown'`, (s: DomStatements) => {
          s.event.preventDefault();
          s.if(sql`not popover_open`, (s: DomStatements) => {
            s.setScalar("popover_open", true);
            s.commitUiTreeChanges();
            s.sleep(5);
            s.setScalar("selected_index", 0);
            s.element(sql.concat(id, "-opt-", sql`selected_index`)).focus();
            s.return();
          });
          s.if(sql`popover_open`, (s: DomStatements) => {
            s.setScalar(
              "selected_index",
              sql`case
                  when selected_index is null or selected_index = select_table_count -1
                    then 0
                  else selected_index + 1
                end`,
            );
            s.element(sql.concat(id, "-opt-", sql`selected_index`)).focus();
          });
        });

        s.if(sql`event.key = 'ArrowUp'`, (s: DomStatements) => {
          s.event.preventDefault();
          s.if(sql`popover_open`, (s: DomStatements) => {
            s.setScalar(
              "selected_index",
              sql`case
                  when selected_index is null or selected_index = 0
                    then select_table_count - 1
                  else selected_index - 1
                end`,
            );
            s.element(sql.concat(id, "-opt-", sql`selected_index`)).focus();
          });
        });
      },
      onClick: (s: DomStatements) => {
        s.toggle("popover_open");
        s.statements(updateComboboxWidth);
      },
    },
    slotProps: { ownerState },
  });
  const [StartDecoratorSlot, startDecoratorProps] = selectStartDecoratorSlot({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [EndDecoratorSlot, endDecoratorProps] = selectEndDecoratorSlot({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [IconSlot, iconProps] = selectIconSlot({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  const updateComboboxWidth = new DomStatements();
  updateComboboxWidth
    .element(typeof id === "string" ? sql.lit`${id}` : id)
    .getBoundingClientRect("rect");
  updateComboboxWidth.setScalar("popover_width", sql`rect.width`);
  return (
    <Data
      watch={props.watch}
      pendingFallback={null}
      errorFallback={null}
      procedure={(s) => {
        s.defScalar("popover_open", false);
        s.defScalar("target_value", {
          type: props.valueType ?? "BigInt",
          expr: value ?? sql.null,
          allowNoRead: true,
        });
        s.defScalar("selected_index", {
          type: "BigInt",
        });
        s.defScalar("popover_width", {
          type: "BigInt",
        });
        s.defTable(
          "select_table",
          sql`select * from ${sql.ref(props.table)} ${where}${orderBy}${limit}`,
        );
        s.defScalar("select_table_count", {
          type: "BigInt",
          expr: sql`(select count(*) from select_table)`,
        });
      }}
    >
      <RootSlot {...rootProps}>
        {startDecorator && (
          <StartDecoratorSlot {...startDecoratorProps}>
            {startDecorator}
          </StartDecoratorSlot>
        )}
        <div
          sx={{
            position: "relative",
            display: "flex",
            flex: 1,
            alignItems: "center",
          }}
        >
          <Show when={sql`target_value is null`}>
            <div className="opacity-50 ml-2">{placeholder}</div>
          </Show>
          <Show when={sql`target_value is not null`}>
            <div className="flex ml-2 items-center">
              {sql`(select ${sql.ref(optionLabel)} from ${
                sql.ref(props.table)
              } where ${sql.ref(optionValue)} = target_value and ${
                props.where ?? true
              })`}
            </div>
          </Show>
        </div>
        <div
          sx={selectPopoverStyles.popover()}
          tabIndex={-1}
          popover="auto"
          yolmPopoverShowing={sql`popover_open`}
          classes="skip-harmonize"
          id={sql.concat("popover-", id)}
          floating={{
            anchorEl: typeof id === "string" ? sql.lit`${id}` : id,
            placement: "bottom",
            strategy: "fixed",
            shift: { mainAxis: true, crossAxis: true },
            offset: {
              mainAxis: 4,
              crossAxis: 0,
            },
            flip: { crossAxis: false, mainAxis: false },
          }}
          onToggleHide={(s) => {
            s.setScalar("popover_open", false);
          }}
          style={{ width: sql`popover_width || 'px'` }}
        >
          {/*Example_List_Start*/}
          <List className="max-h-[300px] overflow-y-auto">
            <Each
              table="select_table"
              recordName={`${props.table}_record`}
            >
              <ListItemButton
                aria-selected={sql`target_value = ${
                  sql.ref(props.table)
                }_record.${sql.ref(optionValue)}`}
                sx={{
                  "&[aria-selected='true']": getVariantStyle(
                    "soft",
                    color,
                    "active",
                  ),
                }}
                id={sql.concat(
                  id,
                  "-opt-",
                  sql`${sql.ref(props.table)}_record.iteration_index`,
                )}
                onClick={(s) => {
                  s.setScalar(
                    "target_value",
                    sql`${sql.ref(props.table)}_record.${sql.ref(optionValue)}`,
                  );
                  onChange?.(
                    s,
                    sql`${sql.ref(props.table)}_record.${sql.ref(optionValue)}`,
                  );
                }}
              >
                {props.renderItem ??
                  sql`${sql.ref(props.table)}_record.${sql.ref(optionLabel)}`}
              </ListItemButton>
            </Each>
          </List>
          {/*Example_List_End*/}
        </div>
        {endDecorator && (
          <EndDecoratorSlot {...endDecoratorProps}>
            {endDecorator}
          </EndDecoratorSlot>
        )}

        <IconSlot {...iconProps}>
          <SvgIcon>
            <SelectIcon />
          </SvgIcon>
        </IconSlot>
      </RootSlot>
    </Data>
  );
}
