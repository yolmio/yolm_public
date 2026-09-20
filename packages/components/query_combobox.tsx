import { FormControlICtxKey, FormICtxKey } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { AnyExpr, BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import { DomStatements } from "std/statements";
import type {
  DomStatementsOrFn,
  IStatementsBase,
  StateStatements,
} from "std/statements";
import type { Style } from "std/style_types";
import { createStyles, cssVar } from "std/style_utils";
import { Data } from "std/data";
import { Each, Mode, Show, useOptionalICtx, usePhase } from "std/ui";
import type { Node } from "std/ui";
import { CircularProgress } from "./circular_progress";
import { IconButton } from "./icon_button";
import { Input } from "./input";
import { List, ListItemButton } from "./list";
import { SvgIcon } from "./svg_icon";
import type { ComponentOpts, Size, Variant } from "./types";
import { getUniqueUiId } from "./utils";

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

interface QueryComboboxProps extends ComponentOpts<Size> {
  id?: Sql | string;
  error?: BooleanExpr;
  placeholder?: Sql | string;
  className?: string;

  loading?: BooleanExpr;
  immediateFocus?: boolean;
  sx?: Style;
  listboxSx?: Style;

  clearOnSelect?: boolean;
  /**
   * Commit the first result when Enter or Tab is pressed after typing without
   * first highlighting an option. Tab keeps its native focus traversal.
   */
  selectFirstResultOnEnterOrTab?: boolean;
  onSelect: (s: DomStatements, result: Sql) => unknown;
  onClear: DomStatementsOrFn;
  onBlur: DomStatementsOrFn;

  populateResultTable: (
    s: StateStatements,
    query: Sql,
    resultTable: Sql,
  ) => unknown;

  resultTableInferQuery?: Sql;

  initialInputText?: Sql;
  displayItem?: (props: { record: Sql }) => Node;
  addItem?: {
    component: (props: { query: Sql }) => Node;
    dialog?: (props: {
      onConfirm: <T extends IStatementsBase>(
        s: T,
        opts: {
          id: NumericExpr;
          label: Sql;
        },
      ) => void;
      openScalar: string;
      query: Sql;
    }) => Node;
    onClick: (
      s: DomStatements,
      props: {
        query: Sql;
        openScalar: string;
      },
    ) => unknown;
  };

  notFoundSnackbar?: Node;
  endDecorator?: Node;
}

/**
 Combobox that gets its data from a query, the query can also be dependent on the input in the textbox.

 The query can go to the database. Usually used as part of a TableRecordSelect.

 @category UI Component
 */
export function QueryCombobox(props: QueryComboboxProps) {
  if (usePhase() === "gather") {
    return null;
  }
  const resetWatch = useOptionalICtx(FormICtxKey)?.resetKey;
  const mainWatch = [
    sql`query`,
    sql`showing_list`,
    props.initialInputText,
    resetWatch,
  ];
  const id = props.id ?? useOptionalICtx(FormControlICtxKey)?.id ??
    sql.lit(getUniqueUiId());
  const inputWrapperId = sql.concat(id, "-input-wrapper");
  const listboxId = sql.concat(id, "-listbox");
  const optionId = (itemId: NumericExpr) => sql.concat(id, "-opt-", itemId);
  const doSelection = new DomStatements();
  doSelection.defRecord(
    "result",
    sql`select * from ui.result where index = ui.selected_index`,
  );
  props.onSelect(doSelection, sql.ref("result"));
  doSelection.setScalar("ui.showing_list", false);
  if (props.clearOnSelect) {
    doSelection.setScalar("ui.query", sql.null);
    doSelection.setScalar("ui.last_valid_query", sql.null);
  } else {
    doSelection.setScalar("ui.query", sql`result.label`);
    doSelection.setScalar("ui.last_valid_query", sql`result.label`);
  }
  doSelection.setScalar("ui.active_descendant", sql.null);
  doSelection.setScalar("ui.input_focus_key", sql.null);
  const updateComboboxWidth = new DomStatements();
  updateComboboxWidth.element(inputWrapperId).getBoundingClientRect("rect");
  updateComboboxWidth.setScalar("ui.combobox_width", sql`rect.width`);
  const Item = props.displayItem ?? ((props) => sql`${props.record}.label`);
  const AddContent = props.addItem?.component;
  const AddDialog = props.addItem?.dialog;
  const showingAddItem =
    sql`query is not null and query != '' and (query != last_valid_query or last_valid_query is null)`;
  const addItemId = sql.concat(id, "-add-item");
  return (
    <Data
      local
      noRefetch
      watch={[resetWatch, props.initialInputText].filter(Boolean) as AnyExpr[]}
      procedure={(s) => {
        s.defScalar("showing_list", false);
        s.defScalar("clicking_on_list", false);
        s.defScalar("initialized", false);
        if (props.addItem?.dialog) {
          s.defScalar("add_dialog_open", false);
        }
        s.defScalar("input_focus_key", {
          type: "BigInt",
          expr: props.immediateFocus ? 0 : sql.null,
        });
        s.defScalar("query", {
          type: "String",
          expr: props.initialInputText ? sql.null : sql.lit``,
        });
        s.defScalar("active_descendant", {
          type: "String",
        });
        s.defScalar("last_valid_query", {
          type: "String",
          expr: props.initialInputText ? sql.null : sql.lit``,
        });
        s.defScalar("combobox_width", {
          type: "BigInt",
        });
        if (props.notFoundSnackbar) {
          s.defScalar("showing_not_found_snackbar", false);
        }
      }}
    >
      <Data
        pendingFallback={null}
        errorFallback={null}
        watch={mainWatch.filter((sql) => Boolean(sql)) as AnyExpr[]}
        statusScalar="combobox_query_status"
        procedure={(s) => {
          s.defTable("result", {
            fields: props.resultTableInferQuery ? undefined : [
              { name: "label", type: { type: "String", maxLength: 1000 } },
              { name: "index", type: "BigInt" },
              { name: "id", type: "BigInt" },
            ],
            inferQuery: props.resultTableInferQuery,
          });
          s.returnUnless(sql`showing_list`);
          props.populateResultTable(
            s,
            props.initialInputText
              ? sql`case
              when last_valid_query = coalesce(query, ${props.initialInputText}, '')
              or (last_valid_query is null and query is null)
              then ''
              else coalesce(query, ${props.initialInputText}, '')
            end`
              : sql`case
              when last_valid_query = query then ''
              else query
            end`,
            sql.ref("ui.result"),
          );
          s.defScalar("selected_index", { type: "BigInt" });
        }}
      >
        <div
          sx={props.sx ? [styles.root, props.sx] : styles.root}
          className={props.className}
        >
          <Mode render="immediate">
            <Input
              size={props.size}
              color={props.color}
              variant={props.variant}
              error={props.error}
              id={id}
              slotProps={{ root: { id: inputWrapperId } }}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-controls={listboxId}
              aria-expanded={sql`showing_list`}
              aria-activedescendant={sql`active_descendant`}
              type="text"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              yolmFocusKey={sql`input_focus_key`}
              placeholder={props.placeholder}
              value={props.initialInputText
                ? sql`coalesce(query, ${props.initialInputText}, '')`
                : sql`query`}
              role="combobox"
              onInput={(s) => {
                s.setScalar("ui.query", sql`target_value`);
                s.setScalar("ui.showing_list", true);
                s.setScalar("ui.active_descendant", sql.null);
              }}
              onFocus={(s) => {
                s.setScalar("ui.showing_list", true);
                //slowing down the first time the combobox is focused to allow the
                // width to be set properly in case of a dialog
                s.if(sql`not ui.initialized`, (s) => {
                  s.sleep(150);
                  s.setScalar("ui.initialized", true);
                });
                s.statements(updateComboboxWidth);
              }}
              onBlur={(s) => {
                s.returnIf(sql`clicking_on_list`);
                s.statements(props.onBlur);
                s.setScalar("ui.showing_list", false);
                s.defScalar(
                  "return_to",
                  props.initialInputText
                    ? sql`coalesce(${props.initialInputText}, last_valid_query, '')`
                    : sql`coalesce(last_valid_query, '')`,
                );
                s.if(
                  sql`ui.query is not null and ui.query != return_to`,
                  (s) => {
                    s.setScalar("ui.query", sql`ui.last_valid_query`);
                    if (props.notFoundSnackbar) {
                      s.setScalar("ui.showing_not_found_snackbar", true);
                      s.commitUiTreeChanges();
                      s.sleep(5000);
                      s.setScalar("ui.showing_not_found_snackbar", false);
                      s.commitUiTreeChanges();
                    }
                  },
                );
              }}
              onKeyDown={(s) => {
                s.returnIf(
                  sql`not ui.showing_list or event.is_composing or event.shift_key or event.meta_key or event.alt_key or event.ctrl_key`,
                );
                s.if(sql`event.key in ('Enter', 'Tab')`, (s) => {
                  if (props.addItem) {
                    s.if(sql`ui.active_descendant = ${addItemId}`, (s) => {
                      s.event.preventDefault();
                      s.element(addItemId).click();
                      s.return();
                    });
                  }
                  if (props.selectFirstResultOnEnterOrTab) {
                    s.if(
                      sql`ui.active_descendant is null
                        and trim(coalesce(ui.query, '')) <> ''
                        and (ui.last_valid_query is null or ui.query <> ui.last_valid_query)
                        and exists (select 1 from ui.result)`,
                      (s) => {
                        s.setScalar(
                          "ui.selected_index",
                          sql`(select index from ui.result limit 1)`,
                        );
                        s.if(sql`event.key = 'Enter'`, (s) => {
                          s.event.preventDefault();
                        });
                        s.statements(doSelection);
                        s.return();
                      },
                    );
                  }
                  s.if(sql`ui.active_descendant is not null`, (s) => {
                    if (props.selectFirstResultOnEnterOrTab) {
                      s.if(sql`event.key = 'Enter'`, (s) => {
                        s.event.preventDefault();
                      });
                    } else {
                      s.event.preventDefault();
                    }
                    s.statements(doSelection);
                  });
                  s.return();
                });
                s.if(sql`event.key = 'ArrowDown'`, (s) => {
                  s.event.preventDefault();
                  if (props.addItem) {
                    s.returnIf(
                      sql`not exists (select index from ui.result) and not ${showingAddItem}`,
                    );
                    s.setScalar(
                      "ui.selected_index",
                      sql`case
                  when not exists (select index from ui.result) or (ui.selected_index = (select count(*) from ui.result) - 1 and ${showingAddItem})
                      then null
                  when ui.selected_index is null or ui.selected_index = (select count(*) from ui.result) - 1
                      then 0
                  else ui.selected_index + 1
                  end`,
                    );
                    s.setScalar(
                      "ui.active_descendant",
                      sql`case when ui.selected_index is null then ${addItemId} else ${
                        optionId(sql`ui.selected_index`)
                      } end`,
                    );
                  } else {
                    s.returnIf(sql`not exists (select index from ui.result)`);
                    s.setScalar(
                      "ui.selected_index",
                      sql`case
                        when ui.selected_index is null or ui.selected_index = (select count(*) from ui.result) - 1
                            then 0
                        else ui.selected_index + 1
                    end`,
                    );
                    s.setScalar(
                      "ui.active_descendant",
                      optionId(sql`ui.selected_index`),
                    );
                  }
                  s.return();
                });
                s.if(sql`event.key = 'ArrowUp'`, (s) => {
                  s.event.preventDefault();
                  if (props.addItem) {
                    s.returnIf(
                      sql`not exists (select index from ui.result) and not ${showingAddItem}`,
                    );
                    s.setScalar(
                      "ui.selected_index",
                      sql`case
                      when not exists (select index from ui.result) or (ui.selected_index = 0 and ${showingAddItem})
                          then null
                      when ui.selected_index is null or ui.selected_index = 0
                          then (select count(*) from ui.result)
                      else ui.selected_index - 1
                  end`,
                    );
                    s.setScalar(
                      "ui.active_descendant",
                      sql`case when ui.selected_index is null then ${addItemId} else ${
                        optionId(sql`ui.selected_index`)
                      } end`,
                    );
                  } else {
                    s.returnIf(sql`not exists (select index from ui.result)`);
                    s.setScalar(
                      "ui.selected_index",
                      sql`case
                        when ui.selected_index is null or ui.selected_index = 0
                            then (select count(*) from ui.result)
                        else ui.selected_index - 1
                    end`,
                    );
                    s.setScalar(
                      "ui.active_descendant",
                      optionId(sql`ui.selected_index`),
                    );
                  }
                  s.return();
                });
                s.setScalar("ui.active_descendant", sql.null);
              }}
              endDecorator={
                <>
                  <IconButton
                    sx={styles.clearIconButton}
                    size={props.size ?? "md"}
                    color={props.color ?? "neutral"}
                    variant="plain"
                    dynamicClass={{
                      classes: "hide",
                      condition: props.initialInputText
                        ? sql`(${props.initialInputText} is null or ${props.initialInputText} = '') and (last_valid_query is null or ui.last_valid_query = '')`
                        : sql`last_valid_query is null or ui.last_valid_query = ''`,
                    }}
                    tabIndex={-1}
                    onClick={(s) => {
                      s.setScalar("ui.query", sql.lit``);
                      s.setScalar("ui.last_valid_query", sql.lit``);
                      s.statements(props.onClear);
                      s.unless(sql`ui.showing_list`, (s) => {
                        s.setScalar(
                          "ui.input_focus_key",
                          sql`coalesce(ui.input_focus_key + 1, 0)`,
                        );
                      });
                    }}
                    aria-label="Clear"
                    icon="Close"
                  />
                  <Show
                    when={props.loading
                      ? sql`${props.loading} or (combobox_query_status = 'fallback_triggered' and showing_list)`
                      : sql`combobox_query_status = 'fallback_triggered' and showing_list`}
                  >
                    <CircularProgress
                      size={props.size === "xs" ? "xs" : "sm"}
                    />
                  </Show>
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
                        s.setScalar(
                          "ui.input_focus_key",
                          sql`coalesce(ui.input_focus_key + 1, 0)`,
                        );
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
          </Mode>
          <List
            sx={[styles.listbox(props.variant ?? "outlined"), props.listboxSx]}
            size={props.size ?? "md"}
            id={listboxId}
            role="listbox"
            popover="manual"
            yolmPopoverShowing={sql`ui.showing_list and ui.combobox_width is not null`}
            variant="outlined"
            color="neutral"
            floating={{
              anchorEl: inputWrapperId,
              placement: sql.lit`bottom`,
              strategy: sql.lit`fixed`,
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
            //the width calculated in the onFocus event is not always correct,
            //so I've added a small sleep on the first click to wait for the next frame to get the correct width
            style={{ width: sql`ui.combobox_width || 'px'` }}
          >
            <Each table="result" recordName="record" eachKey={sql`id`}>
              <ListItemButton
                sx={styles.listboxItem}
                id={optionId(sql`record.index`)}
                role="option"
                aria-selected={sql`record.index = selected_index`}
                tabIndex={-1}
                onClick={(s) => {
                  s.setScalar("ui.selected_index", sql`record.index`);
                  s.statements(doSelection);
                }}
              >
                <Item record={sql.ref("record")} />
              </ListItemButton>
            </Each>
            {props.addItem && AddContent && (
              <Show when={showingAddItem}>
                <ListItemButton
                  sx={styles.listboxItem}
                  id={addItemId}
                  role="option"
                  aria-selected={sql`active_descendant = ${addItemId}`}
                  tabIndex={-1}
                  onClick={(s) => {
                    props.addItem!.onClick(s, {
                      query: sql`query`,
                      openScalar: "add_dialog_open",
                    });
                  }}
                >
                  <AddContent query={sql`query`} />
                </ListItemButton>
              </Show>
            )}
          </List>
          {AddDialog && (
            <AddDialog
              onConfirm={(s, opts) => {
                s.defRecord(
                  "result",
                  sql`select ${opts.id} as id, ${opts.label} as label`,
                );
                props.onSelect(
                  s as unknown as DomStatements,
                  sql.ref("result"),
                );
                s.setScalar("ui.showing_list", false);
                s.setScalar("ui.query", sql`result.label`);
                s.setScalar("ui.last_valid_query", sql`result.label`);
                s.setScalar("ui.active_descendant", sql.null);
                s.setScalar("ui.input_focus_key", sql.null);
              }}
              openScalar="add_dialog_open"
              query={sql`ui.query`}
            />
          )}
          {props.notFoundSnackbar && (
            <Show when={sql`ui.showing_not_found_snackbar`}>
              {props.notFoundSnackbar}
            </Show>
          )}
        </div>
      </Data>
    </Data>
  );
}
