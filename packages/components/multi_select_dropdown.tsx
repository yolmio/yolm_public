import type { DomStatements } from "std/statements";
import { Button } from "./button";
import { Card } from "./card";
import { Checkbox } from "./checkbox";
import { Divider } from "./divider";
import { Input } from "./input";
import { List, ListItemButton } from "./list";
import { MaterialIcon } from "./material_icon";
import { Typography } from "./typography";
import type { AnyExpr, Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import { Data } from "std/data";
import { Radio } from "./radio";
import type { Color, Size } from "./types";
import type { StyleObject } from "std/style_types";

interface MultiSelectDropdownProps {
  selectedItemsQuery: Sql;
  selectedItemsValue?: Sql;
  availableItemsQuery: Sql;
  onToggleItem: (isSelected: AnyExpr) => {
    onSelected: (s: DomStatements) => void;
    onDeselected: (s: DomStatements) => void;
  };
  placeholder?: string;
  buttonVariant?: "plain" | "outlined" | "solid" | "soft";
  buttonColor?: Color;
  buttonSize?: Size;
  dropdownWidth?: number;
  maxDropdownHeight?: number;
  showDivider?: boolean;
  watch?: AnyExpr[];
  showRadioButtons?: boolean;
  buttonSx?: StyleObject;
  searchPlaceholder?: string;
}

/**
 * Dropdown that lets users pick zero-or-more items from a list driven by
 * two SQL queries (`selectedItemsQuery` and `availableItemsQuery`).
 * Toggling an item calls `onToggleItem`; the button label summarizes the
 * selection or falls back to `placeholder` when empty.
 */
export function MultiSelectDropdown({
  selectedItemsQuery,
  selectedItemsValue,
  availableItemsQuery,
  onToggleItem,
  placeholder = "None",
  buttonVariant = "plain",
  buttonColor,
  buttonSize = "sm",
  dropdownWidth = 250,
  maxDropdownHeight = 300,
  showDivider = true,
  watch = [],
  showRadioButtons = false,
  buttonSx,
  searchPlaceholder,
}: MultiSelectDropdownProps) {
  const iconSize = buttonSize === "xs" ? "xs" : "sm";
  const itemSx = buttonSize === "xs" ? { px: 1, py: 0.5 } : { px: 2, py: 1 };
  const searchEnabled = searchPlaceholder !== undefined;
  const availableItemsWatch = searchEnabled
    ? [...watch, sql`dropdown_search`]
    : watch;
  const toggleItem = (s: DomStatements) => {
    const toggleHandler = onToggleItem(sql`item.is_selected`);
    s.if(sql`item.is_selected`, (s) => {
      toggleHandler.onDeselected(s);
    }).else((s) => {
      toggleHandler.onSelected(s);
    });
  };
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("show_dropdown", sql`false`);
        if (searchEnabled) {
          s.defScalar("dropdown_search", sql.lit``);
        }
      }}
    >
      <Data
        local
        procedure={(s) => {
          s.defScalar(
            "selected_items",
            selectedItemsValue ?? selectedItemsQuery,
          );
        }}
        watch={watch}
      >
        <div
          sx={{ position: "relative" }}
          onClickAway={(s) => s.setScalar("show_dropdown", sql`false`)}
        >
          <Button
            variant={buttonVariant}
            color={buttonColor}
            size={buttonSize}
            sx={{
              justifyContent: "flex-start",
              textAlign: "left",
              width: "100%",
              px: 1,
              py: 0.5,
              minHeight: "unset",
              fontWeight: "normal",
              "&:hover": {
                backgroundColor: "neutral.100",
              },
              ...buttonSx,
            }}
            aria-expanded={sql`show_dropdown`}
            aria-haspopup="listbox"
            onClick={(s) => s.toggle("show_dropdown")}
          >
            <div
              sx={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                justifyContent: "space-between",
                gap: 0.5,
              }}
            >
              <Show
                when={sql`selected_items is not null`}
                fallback={<span>{placeholder}</span>}
              >
                <span className="text-ellipsis overflow-hidden">
                  {sql`selected_items`}
                </span>
              </Show>
              <Show
                when={sql`show_dropdown`}
                fallback={
                  <MaterialIcon
                    icon="ArrowDropDown"
                    fontSize={iconSize}
                    sx={{ flexShrink: 0 }}
                  />
                }
              >
                <MaterialIcon
                  icon="ArrowDropUp"
                  fontSize={iconSize}
                  sx={{ flexShrink: 0 }}
                />
              </Show>
            </div>
          </Button>

          <Show when={sql`show_dropdown`}>
            <Card
              variant="outlined"
              size={buttonSize}
              sx={{
                position: "absolute",
                top: "100%",
                left: 0,
                minWidth: dropdownWidth,
                mt: 0.5,
                zIndex: 1000,
                maxHeight: maxDropdownHeight,
                boxShadow: "lg",
                backgroundColor: "background.surface",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Data
                local
                procedure={(s) => {
                  s.defTable(
                    "available_items",
                    searchEnabled
                      ? sql`
                        select *
                        from (${availableItemsQuery}) item
                        where trim(dropdown_search) = ''
                          or fuzzy_match(dropdown_search, item.name)
                          or fuzzy_match(dropdown_search, coalesce(item.description::string, ''))
                      `
                      : availableItemsQuery,
                  );
                }}
                watch={availableItemsWatch}
              >
                {searchEnabled && (
                  <>
                    <div sx={{ p: buttonSize === "xs" ? 1 : 1.5 }}>
                      <Input
                        size={buttonSize}
                        bindScalar="dropdown_search"
                        aria-label={searchPlaceholder}
                        placeholder={searchPlaceholder}
                      />
                    </div>
                    <Divider sx={{ mt: 0, mb: 0 }} />
                  </>
                )}
                <div sx={{ overflowY: "auto" }}>
                  <List
                    sx={{ p: 0 }}
                    size={buttonSize}
                    role="listbox"
                    aria-multiselectable={sql`true`}
                  >
                    <Each table="available_items" recordName="item">
                      <ListItemButton
                        sx={itemSx}
                        role="option"
                        aria-selected={sql`item.is_selected`}
                        // Saves must finish even when Done removes this option.
                        onClick={{
                          detachedFromNode: true,
                          procedure: toggleItem,
                        }}
                        onKeyDown={{
                          detachedFromNode: true,
                          procedure: (s) => {
                            s.if(sql`event.key in (' ', 'Enter')`, (s) => {
                              s.event.preventDefault();
                              toggleItem(s);
                            });
                          },
                        }}
                      >
                        <div
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            width: "100%",
                          }}
                        >
                          <Show
                            when={showRadioButtons}
                            fallback={
                              <Checkbox
                                size={buttonSize}
                                checked={sql`item.is_selected`}
                                tabIndex={-1}
                                aria-hidden={sql`true`}
                                onChange={() => {}} // Handled by ListItemButton onClick
                              />
                            }
                          >
                            <Radio
                              size={buttonSize}
                              variant="soft"
                              color="primary"
                              className="mr-2"
                              checked={sql`item.is_selected`}
                              tabIndex={-1}
                              aria-hidden={sql`true`}
                              onChange={() => {}}
                            />
                          </Show>

                          <div sx={{ flex: 1 }}>
                            <Typography
                              level={buttonSize === "xs"
                                ? "body-xs"
                                : "body-sm"}
                            >
                              {sql`item.name`}
                            </Typography>
                            <Show when={sql`item.description is not null`}>
                              <Typography
                                level="body-xs"
                                sx={{ color: "neutral.600" }}
                              >
                                {sql`item.description`}
                              </Typography>
                            </Show>
                          </div>
                        </div>
                      </ListItemButton>
                    </Each>
                  </List>
                </div>
              </Data>

              <Show when={showDivider}>
                <Divider sx={{ mt: 0, mb: 0 }} />
                <div
                  sx={{
                    p: buttonSize === "xs" ? 1 : 1.5,
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <Button
                    size={buttonSize}
                    variant="plain"
                    onClick={(s) => s.setScalar("show_dropdown", sql`false`)}
                  >
                    Done
                  </Button>
                </div>
              </Show>
            </Card>
          </Show>
        </div>
      </Data>
    </Data>
  );
}
