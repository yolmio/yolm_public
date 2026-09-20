import { sql, valuesRow } from "../std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "../std/sql_utils";
import { DomStatements } from "std/statements";
import type { Style } from "std/style_types";
import { createStyles, cssVar } from "std/style_utils";
import type { Variant } from "std/theme";
import { Each, Show } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { IconButton } from "./icon_button";
import { Input } from "./input";
import { List, ListItemButton } from "./list";
import type { ComponentOpts, Size } from "./types";

import { countries } from "enums/country";
import { SvgIcon } from "./svg_icon";
import { getUniqueUiId } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";

const styles = createStyles({
  root: { position: "relative" },
  arrowIconButton: {
    marginLeft: "calc(var(--input-padding-y) / 2)",
    marginRight: "calc(var(--input-decorator-child-offset) * -1)",
    "&.showing-list": {
      transform: "rotate(180deg)",
    },
  },
  clearIconButton: {
    marginLeft: "calc(var(--input-padding-y) / 2)",
    "&.hide": {
      visibility: "hidden",
    },
  },
  listbox: (app, variant: Variant) => {
    const styles = {
      "--focus-outline-offset": `calc(${cssVar("focus-thickness")} * -1)`, // to prevent the focus outline from being cut by overflow
      "--list-radius": cssVar("radius-sm"),
      "--list-item-sticky-top":
        "calc(var(--list-padding, var(--list-divider-gap)) * -1)", // negative amount of the List's padding block
      boxShadow: "md",
      overflow: "auto",
      maxHeight: "40vh",
      width: "100%",
      zIndex: 1300, // the same value as Material UI Menu. TODO: revisit the appropriate value later.
      "&:empty": {
        visibility: "hidden",
      },

      "&[data-floating-placement*='top']": {
        transformOrigin: "var(--popover-transform-origin, bottom)",
      },
      "&[data-floating-placement*='bottom']": {
        transformOrigin: "var(--popover-transform-origin, top)",
      },
      transform: "scaleY(0)",

      "&:popover-open": {
        transform: "none",
        "@starting-style": {
          "&": {
            transform: "scaleY(0)",
          },
        },
      },

      margin: 0,
      transition:
        `opacity ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, transform ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, display ${app.theme.transitionDurations.popover} allow-discrete`,
    };
    if (variant === "outlined" || variant === "plain") {
      (styles as any).backgroundColor = cssVar("palette-background-popup");
    }
    (styles as any)["--list-item-sticky-background"] = (
      styles as any
    ).backgroundColor;
    return styles;
  },
  listboxItem: {
    "&[aria-selected='true']": {
      backgroundColor: "neutral-100",
      dark: {
        backgroundColor: "neutral-700",
      },
    },
  },
});

interface CountrySelectProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      select: "select";
      startDecorator: "span";
      endDecorator: "span";
      icon: "span";
    }> {
  sx?: Style;
  id?: Sql | string;
  value?: Sql;
  onInput?: (s: DomStatements, newValue: AnyExpr) => void;
  onChange?: (s: DomStatements, newValue: AnyExpr) => void;
  enumName?: string;
  endDecorator?: Node;
  immediateFocus?: boolean;
}
export function CountrySelect(props: CountrySelectProps) {
  const { color = "neutral" } = props;
  const id = props.id ?? sql.lit(getUniqueUiId());
  const inputWrapperId = sql.concat(id, "-input-wrapper");
  const listboxId = sql.concat(id, "-listbox");
  const updateComboboxWidth = new DomStatements();
  updateComboboxWidth.element(inputWrapperId).getBoundingClientRect("rect");
  updateComboboxWidth.setScalar("ui.combobox_width", sql`rect.width`);
  const optionId = (itemId: NumericExpr) => sql.concat(id, "-opt-", itemId);
  const filteredCountryCount = sql`(
    select count(*)
    from countries
    where search_query = ''
      or lower(label) like '%' || lower(coalesce(search_query, '')) || '%'
  )`;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("showing_list", false);
        s.defScalar("clicking_on_list", false);
        s.defScalar("combobox_width", {
          type: "BigInt",
        });
        s.defScalar("search_query", {
          type: "String",
          expr: sql.lit``,
        });
        if (props.enumName) {
          s.defTable("countries", {
            fields: [
              {
                name: "value",
                type: { type: "Enum", enum: props.enumName },
                notNull: true,
              },
              {
                name: "label",
                type: { type: "String", maxLength: 100 },
                notNull: true,
              },
            ],
          });
        } else {
          s.defTable("countries", {
            fields: [
              {
                name: "value",
                type: { type: "String", maxLength: 2 },
                notNull: true,
              },
              {
                name: "label",
                type: { type: "String", maxLength: 100 },
                notNull: true,
              },
            ],
          });
        }
        const countryRows = countries.map((country) =>
          valuesRow(sql.lit(country.name), sql.lit(country.displayName))
        );
        s.modify(
          sql`insert into countries (value, label) values ${countryRows}`,
        );
        s.defScalar("selected_index", { type: "BigInt" });
      }}
    >
      <Data
        local
        watch={props.value ? [props.value] : undefined}
        procedure={(s) => {
          if (props.enumName) {
            s.defScalar("target_value", {
              type: { type: "Enum", enum: props.enumName },
              expr: props.value ?? sql.null,
              allowNoRead: true,
            });
            s.defScalar("selected_value", {
              type: { type: "Enum", enum: props.enumName },
              expr: props.value ?? sql.null,
              allowNoRead: true,
            });
          } else {
            s.defScalar("target_value", {
              type: { type: "String", maxLength: 2 },
              expr: props.value ?? sql.null,
              allowNoRead: true,
            });
            s.defScalar("selected_value", {
              type: { type: "String", maxLength: 2 },
              expr: props.value ?? sql.null,
              allowNoRead: true,
            });
          }
          s.defScalar("selected_label", {
            type: "String",
            expr: props.value
              ? sql`(select label from countries where value = ${props.value})`
              : sql.null,
          });
        }}
      >
        <div sx={props.sx ? [styles.root, props.sx] : styles.root}>
          <Input
            size={props.size}
            color={props.color}
            variant={props.variant}
            id={id}
            slotProps={{ root: { id: inputWrapperId } }}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls={listboxId}
            yolmFocusKey={props.immediateFocus ? sql`0` : sql.null}
            aria-expanded={sql`showing_list`}
            type="text"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder={sql.lit`Select a country`}
            value={sql`selected_label`}
            role="combobox"
            onInput={(s) => {
              s.setScalar("ui.showing_list", true);
              s.setScalar("ui.search_query", sql`target_value`);
              s.setScalar("ui.selected_label", sql.null);
              s.setScalar("ui.selected_index", sql.null);
            }}
            onFocus={(s) => {
              s.setScalar("ui.showing_list", true);
              s.statements(updateComboboxWidth);
            }}
            onBlur={(s) => {
              s.returnIf(sql`clicking_on_list`);
              s.setScalar("ui.showing_list", false);
            }}
            onKeyDown={(s) => {
              s.if(sql`event.key = 'Backspace'`, (s) => {
                s.if(sql`selected_label is not null`, (s) => {
                  // If a country is selected, clear everything
                  s.setScalar("ui.selected_label", sql.null);
                  s.setScalar("ui.selected_value", sql.null);
                  s.setScalar("ui.target_value", sql.null);
                  s.setScalar("ui.selected_index", sql.null);
                  s.setScalar("ui.search_query", sql.lit``);
                  s.setScalar("ui.showing_list", true);
                  props.onChange?.(s, sql.null);
                  props.onInput?.(s, sql.null);
                  s.event.stopPropagation();
                  s.return();
                });
              });
              s.returnIf(
                sql`not showing_list or event.is_composing or event.shift_key or event.meta_key or event.alt_key or event.ctrl_key`,
              );
              s.if(sql`event.key in ('Enter', 'Tab')`, (s) => {
                s.event.preventDefault();
                s.element(optionId(sql`selected_index`)).click();
                s.return();
              });
              s.if(sql`event.key = 'ArrowDown'`, (s) => {
                s.event.preventDefault();
                s.setScalar(
                  "selected_index",
                  sql`case
                when ${filteredCountryCount} = 0 then null
                when selected_index is null
                  or selected_index >= ${filteredCountryCount} - 1
                  then 0
                else selected_index + 1
              end`,
                );
                s.return();
              });
              s.if(sql`event.key = 'ArrowUp'`, (s) => {
                s.event.preventDefault();
                s.setScalar(
                  "selected_index",
                  sql`case
                when ${filteredCountryCount} = 0 then null
                when selected_index is null or selected_index = 0
                  then ${filteredCountryCount} - 1
                else selected_index - 1
              end`,
                );
                s.return();
              });
            }}
            endDecorator={
              <>
                <IconButton
                  sx={styles.clearIconButton}
                  size={props.size ?? "md"}
                  color={color}
                  variant="plain"
                  tabIndex={-1}
                  onClick={(s) => {
                    s.setScalar("ui.selected_label", sql.null);
                    s.setScalar("ui.showing_list", false);
                    s.setScalar("ui.selected_value", sql.null);
                    s.setScalar("target_value", sql.null);
                    s.setScalar("search_query", sql.lit``);
                    s.setScalar("ui.selected_index", sql.null);
                    props.onChange?.(s, sql.null);
                    props.onInput?.(s, sql.null);
                  }}
                  aria-label="Clear"
                  icon="Close"
                />
                <IconButton
                  size={props.size ?? "md"}
                  color={props.color ?? "neutral"}
                  variant="plain"
                  tabIndex={-1}
                  dynamicClass={{
                    classes: "showing-list",
                    condition: sql`showing_list`,
                  }}
                  sx={styles.arrowIconButton}
                  aria-label="Expand"
                  onClick={(s) => {
                    s.unless(sql`ui.showing_list`, (s) => {
                      s.statements(updateComboboxWidth);
                    });
                    s.toggle("ui.showing_list");
                  }}
                >
                  <SvgIcon>
                    <path d="M7 10l5 5 5-5z" />
                  </SvgIcon>
                </IconButton>
                {props.endDecorator}
              </>
            }
          />
          <Show when={sql`ui.showing_list and ui.combobox_width is not null`}>
            <List
              id={listboxId}
              sx={styles.listbox(props.variant ?? "outlined")}
              role="listbox"
              popover="manual"
              yolmPopoverShowing={sql`ui.showing_list and ui.combobox_width is not null`}
              variant="outlined"
              color="neutral"
              floating={{
                anchorEl: inputWrapperId,
                placement: sql.lit`bottom`,
                strategy: sql.lit`absolute`,
                offset: {
                  mainAxis: 4,
                  crossAxis: 0,
                },
                flip: {
                  crossAxis: false,
                  mainAxis: true,
                },
              }}
              onMouseDown={(s) => s.setScalar("ui.clicking_on_list", true)}
              onMouseUp={(s) => s.setScalar("ui.clicking_on_list", false)}
              style={{ width: sql`ui.combobox_width || 'px'` }}
            >
              <Each
                table="countries"
                recordName="country"
                where={sql`search_query = '' or lower(country.label) like '%' || lower(coalesce(search_query, '')) || '%'`}
              >
                <ListItemButton
                  sx={styles.listboxItem}
                  id={optionId(sql`country.iteration_index`)}
                  role="option"
                  aria-selected={sql`country.iteration_index = selected_index`}
                  tabIndex={-1}
                  onClick={(s) => {
                    s.setScalar("ui.showing_list", false);
                    s.setScalar("ui.selected_label", sql`country.label`);
                    s.setScalar("ui.selected_value", sql`country.value`);
                    s.setScalar("target_value", sql`country.value`);
                    props.onChange?.(s, sql`country.value`);
                    props.onInput?.(s, sql`country.value`);
                  }}
                >
                  {sql`country.label`}
                </ListItemButton>
              </Each>
            </List>
          </Show>
        </div>
      </Data>
    </Data>
  );
}
