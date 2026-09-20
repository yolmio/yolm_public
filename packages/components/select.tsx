import { EachICtxKey, useDefaultColor } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import { DomStatements } from "std/statements";
import type { DomStatementsOrFn } from "std/statements";
import type { HelperFieldType } from "std/system";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import {
  addCtx,
  createICtxKey,
  Each,
  gatherChildrenContextInfo,
  Show,
  useICtx,
  useOptionalICtx,
  usePhase,
  useUniqueId,
} from "std/ui";
import type { ContextInstance, EnumExpr, ICtxKey, Node } from "std/ui";
import type { StyleObject } from "std/style_types";
import { createStyles, cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import { memoize } from "std/utils/memoize";
import { List, ListItemButton } from "./list";
import { SvgIcon } from "./svg_icon";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { ChangeEventHandlerFn } from "std/event_utils";

// --- Shared select utilities ---

interface OwnerState {
  variant: Variant;
  color: Color;
  size: Size;
  fullWidth: boolean;
  placeholder?: Sql | string;
}
/**
 * Size-token CSS vars (min-height, padding, icon size) for the select
 * root, keyed by {@link Size}. Shared by {@link Select} and other
 * select-like components so they size identically. Memoized per size.
 *
 * @category Helper
 */
export const selectSizeStyles = memoize((size: Size) => {
  const sizeStyleBySize: Record<Size, StyleObject> = {
    xs: {
      "--select-min-height": "1.75rem",
      "--select-padding-x": "0.5rem",
      "--select-decorator-child-height":
        "min(1.25rem, var(--select-min-height))",
      "--icon-font-size": "1rem",
      "--select-padding-y": "1px",
      fontSize: cssVar("text-xs"),
    },
    sm: {
      "--select-min-height": "2rem",
      "--select-padding-x": "0.5rem",
      "--select-decorator-child-height":
        "min(1.5rem, var(--select-min-height))",
      "--icon-font-size": "1.25rem",
      "--select-padding-y": "2px",
      fontSize: cssVar("text-sm"),
    },
    md: {
      "--select-min-height": "2.5rem",
      "--select-padding-x": "0.75rem",
      "--select-decorator-child-height": "min(2rem, var(--select-min-height))",
      "--icon-font-size": "1.5rem",
      "--select-padding-y": "3px",
    },
    lg: {
      "--select-min-height": "3rem",
      "--select-padding-x": "1rem",
      "--select-decorator-child-height":
        "min(2.375rem, var(--select-min-height))",
      "--icon-font-size": "1.75rem",
      "--select-padding-y": "4px",
    },
  };
  return sizeStyleBySize[size];
});

const selectIndicatorIconSizeBySize: Record<Size, string> = {
  xs: "1rem",
  sm: "1.125rem",
  md: "1.25rem",
  lg: "1.5rem",
};

/**
 * Root-slot style builder for the select trigger (variant/color/size,
 * focus ring, error state). Exported so other select-like components can
 * reuse the same trigger styling.
 *
 * @category Helper
 */
export const selectRoot = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { variant, color, size, fullWidth, placeholder } = ownerState;
    const styles: any = {
      "--select-radius": cssVar("radius-sm"),
      "--select-gap": "0.5rem",
      "--select-placeholder-opacity": "0.5",
      "--select-focused-thickness": cssVar("focus-thickness"),
      "--select-decorator-child-offset":
        "min(calc(var(--select-padding-x) - (var(--select-min-height) - 2 * var(--variant-border-width) - var(--select-decorator-child-height)) / 2), var(--select-padding-x))",
      "--select-decorator-child-radius":
        "max(var(--select-radius) - var(--select-padding-y), min(var(--select-padding-y) / 2, var(--select-radius) / 2))",
      "--button-min-height": "var(--select-decorator-child-height)",
      "--icon-button-size": "var(--select-decorator-child-height)",
      "--button-radius": "var(--select-decorator-child-radius)",
      "--icon-button-radius": "var(--select-decorator-child-radius)",
      boxSizing: "border-box",
      minWidth: 0,
      minHeight: "var(--select-min-height)",
      position: "relative",
      display: "flex",
      alignItems: "center",
      borderRadius: "var(--select-radius)",
      fontFamily: cssVar("font-family-body"),
      fontSize: cssVar("text-base"),
      width: "inherit",
      "&::placeholder": {
        color: "var(--select-placeholder-color)",
        opacity: "var(--select-placeholder-opacity)",
      },
      ...selectSizeStyles(size),
      ...getVariantStyle(variant, color),
    };

    if (fullWidth) {
      styles.width = "100%";
    }

    if (color === "harmonize") {
      styles["--select-focused-highlight"] = cssVar("palette-focus-visible");
    } else {
      const paletteColor = color === "neutral" ? "primary" : color;
      styles["--select-focused-highlight"] = cssVar(
        `palette-${paletteColor}-500`,
      );
    }

    if (variant === "outlined" || variant === "plain") {
      styles.backgroundColor = cssVar("palette-background-surface");
    }

    styles["&:focus-within"] = {
      "--select-indicator-color": "var(--select-focused-highlight)",
    };

    if (variant !== "solid") {
      styles["&:focus-within:before"] = {
        boxShadow:
          "inset 0 0 0 var(--select-focused-thickness) var(--select-focused-highlight)",
      };
    }

    if (placeholder) {
      styles["--select-placeholder-color"] = cssVar("palette-text-tertiary");
      styles["--select-placeholder-opacity"] = "1";
    }
    styles["&:hover"] = getVariantStyle(variant, color, "hover");
    styles["&.error"] = {
      ...getVariantStyle(variant, "danger"),
      "--select-focused-highlight": cssVar("palette-danger-500"),
      "&:hover": getVariantStyle(variant, "danger", "hover"),
    };

    return styles;
  },
);

/**
 * Popover-surface styles for the select dropdown (background, shadow,
 * open/close transition). Shared with other select-like popovers.
 *
 * @category Helper
 */
export const selectPopoverStyles = createStyles({
  popover: (app) => {
    return {
      viewTransitionName: "navbar-popover",
      backgroundColor: "background-popup",
      borderRadius: "md",
      boxShadow: "md",
      border: "1px solid",
      borderColor: "divider",
      zIndex: 1400,

      opacity: 0,
      transform: "scaleY(0)",
      transformOrigin: "top",
      width: "inherit",
      "&:popover-open": {
        opacity: 1,
        transform: "none",
        "@starting-style": {
          "&": {
            opacity: 0,
            transform: "scaleY(0)",
          },
        },
      },

      margin: 0,
      transition:
        `opacity ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, transform ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, display ${app.theme.transitionDurations.popover} allow-discrete`,
    };
  },
});
/**
 * The up/down chevron `<path>` drawn inside the select's indicator
 * {@link SvgIcon}. Exported for reuse by other select-style triggers.
 *
 * @category Helper
 */
export function SelectIcon() {
  return (
    <path d="m12 5.83 2.46 2.46c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L12.7 3.7a.9959.9959 0 0 0-1.41 0L8.12 6.88c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0L12 5.83zm0 12.34-2.46-2.46a.9959.9959 0 0 0-1.41 0c-.39.39-.39 1.02 0 1.41l3.17 3.18c.39.39 1.02.39 1.41 0l3.17-3.17c.39-.39.39-1.02 0-1.41a.9959.9959 0 0 0-1.41 0L12 18.17z" />
  );
}
/** Start-decorator slot style builder for select-like triggers. @category Helper */
export const selectStartDecoratorSlot = createGatherSafeSlot(
  "startDecorator",
  () => ({
    "--button-margin-right": "calc(var(--select-decorator-child-offset) * -1)",
    "--icon-button-margin-right":
      "calc(var(--select-decorator-child-offset) * -1)",
    "--icon-margin-right": "calc(var(--select-padding-x) / -4)",
    display: "inherit",
    alignItems: "center",
    paddingY: "var(--select-padding-y)",
    flexWrap: "wrap",
    marginRight: "var(--select-gap)",
    marginLeft: "var(--select-gap)",
    color: cssVar("palette-text-tertiary"),
    cursor: "initial",
  }),
);

/** End-decorator slot style builder for select-like triggers. @category Helper */
export const selectEndDecoratorSlot = createGatherSafeSlot(
  "endDecorator",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    "--button-margin-right": "calc(var(--select-decorator-child-offset) * -1)",
    "--icon-button-margin-right":
      "calc(var(--select-decorator-child-offset) * -1)",
    "--icon-margin-right": "calc(var(--select-padding-x) / -4)",
    display: "inherit",
    alignItems: "center",
    marginLeft: "var(--select-gap)",
    color: ownerState.color === "harmonize"
      ? `var(--harmonize-${ownerState.variant}-color)`
      : cssVar(`palette-${ownerState.color}-${ownerState.variant}-color`),
    cursor: "initial",
  }),
);
/** Indicator-icon slot style builder for select-like triggers. @category Helper */
export const selectIconSlot = createGatherSafeSlot(
  "icon",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    "--icon-font-size": selectIndicatorIconSizeBySize[ownerState.size],
    color: "var(--select-indicator-color)",
    position: "absolute",
    userSelect: "none",
    pointerEvents: "none",
    right: "calc(var(--select-padding-x) - var(--select-padding-x)/2)",
    display: "flex",
    alignItems: "center",
    height: "100%",
  }),
);

// --- Gather context ---

interface StaticItem {
  value: string;
  searchText?: string;
  children: Node;
}

interface DynamicGroup {
  table: string;
  recordName: string;
  valueExpr: Sql;
  searchText?: string | Sql;
  children: Node;
}

interface SelectGatherICtx {
  statics: StaticItem[];
  dynamics: DynamicGroup[];
}

const SelectGatherICtxKey = createICtxKey<SelectGatherICtx>(
  "SelectGatherICtx",
);

class SelectGatherCtx implements ContextInstance, SelectGatherICtx {
  implementICtxs: ICtxKey<any>[] = [SelectGatherICtxKey];
  statics: StaticItem[] = [];
  dynamics: DynamicGroup[] = [];
}

// --- Render context ---

interface SelectRenderICtx {
  statics: StaticItem[];
  dynamics: DynamicGroup[];
  color: Color;
  size: Size;
  enumName?: string;
  onInput?: ChangeEventHandlerFn;
  onChange?: ChangeEventHandlerFn;
  popoverId: Sql;
  valueType: HelperFieldType;
}

const SelectRenderICtxKey = createICtxKey<SelectRenderICtx>(
  "SelectRenderICtx",
);

class SelectRenderCtx implements ContextInstance, SelectRenderICtx {
  implementICtxs: ICtxKey<any>[] = [SelectRenderICtxKey];
  statics: StaticItem[] = [];
  dynamics: DynamicGroup[] = [];
  color: Color;
  size: Size;
  enumName?: string;
  onInput?: ChangeEventHandlerFn;
  onChange?: ChangeEventHandlerFn;
  popoverId: Sql;
  valueType: HelperFieldType;

  constructor(opts: {
    color: Color;
    size: Size;
    popoverId: Sql;
    valueType: HelperFieldType;
    enumName?: string;
    onInput?: ChangeEventHandlerFn;
    onChange?: ChangeEventHandlerFn;
  }) {
    this.color = opts.color;
    this.size = opts.size;
    this.popoverId = opts.popoverId;
    this.valueType = opts.valueType;
    this.enumName = opts.enumName;
    this.onInput = opts.onInput;
    this.onChange = opts.onChange;
  }
}

// --- Props ---

/**
 * Props for {@link Select}. Inherits the standard component shape
 * (variant, color, size, slot props) and adds picker-specific options:
 * `value`, `onChange`, `placeholder`, `enumName` / `valueType`, etc.
 *
 * For type-ahead use `Autocomplete`; for table-backed selects use
 * `EachSelect`.
 */
export interface SelectProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      startDecorator: "span";
      endDecorator: "span";
    }> {
  fullWidth?: boolean;
  error?: BooleanExpr;
  startDecorator?: Node;
  endDecorator?: Node;
  placeholder?: Sql | string;
  placement?: EnumExpr<
    | "top"
    | "top-start"
    | "top-end"
    | "right"
    | "right-start"
    | "right-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "left"
    | "left-start"
    | "left-end"
  >;
  children: Node;
  onInput?: ChangeEventHandlerFn;
  onChange?: ChangeEventHandlerFn;
  value?: Sql | NumericExpr;
  id?: Sql | string;
  enumName?: string;
  valueType?: HelperFieldType;
  onClickAway?: DomStatementsOrFn;
  immediateFocus?: boolean;
  /** Accessible name for the combobox trigger. */
  "aria-label"?: Sql | string;
}

interface SelectOptionProps {
  value: string | Sql;
  searchText?: string | Sql;
  disabled?: BooleanExpr;
  children: Node;
}

// --- Component ---

/**
 * Themed dropdown select.
 *
 * Renders a button-styled trigger with a popover list of `<Select.Option>`
 * children. Variants/colors/sizes mirror the rest of the Joy-style
 * component set (`variant`: `outlined`/`soft`/`solid`/`plain`,
 * `color`: any `Color`, `size`: `sm`/`md`/`lg`).
 *
 * Selection is controlled via `value` + `onChange`. For options sourced
 * from a database table use `EachSelect`; for enum-backed selects use
 * `EnumSelect`; for searchable type-ahead use `QueryCombobox`.
 *
 * @example
 * <Select
 *   value={sql`status_filter`}
 *   onChange={(s) => s.setScalar("status_filter", sql`target_value`)}
 *   placeholder="All statuses"
 * >
 *   <Select.Option value="open">Open</Select.Option>
 *   <Select.Option value="closed">Closed</Select.Option>
 * </Select>
 */
export function Select(props: SelectProps) {
  const {
    color = useDefaultColor("neutral"),
    variant = "outlined",
    size = "md",
    fullWidth = false,
    error,
    startDecorator,
    endDecorator,
    placeholder = "Select option",
    onInput,
    onChange,
    value,
    id = useUniqueId(),
    enumName,
    valueType = enumName ? { type: "Enum", enum: enumName } as any : "String",
    placement = "bottom",
    onClickAway,
    immediateFocus,
    "aria-label": ariaLabel,
  } = props;

  useJsModule("listbox_nav");

  const ownerState = { variant, color, size, fullWidth, placeholder };

  // Gather phase
  const gatherCtx = new SelectGatherCtx();
  addCtx(gatherCtx);
  gatherChildrenContextInfo(props.children);

  // Render context
  const popoverId = sql.concat("popover-", id);
  const listboxId = sql.concat(popoverId, "-listbox");
  const renderCtx = new SelectRenderCtx({
    color,
    size,
    popoverId,
    valueType,
    enumName,
    onInput,
    onChange,
  });
  renderCtx.statics = gatherCtx.statics;
  renderCtx.dynamics = gatherCtx.dynamics;
  addCtx(renderCtx);

  const listboxHandle = sql.concat("select-", id);

  // Root slot
  const [RootSlot, rootProps] = selectRoot({
    component: "div",
    rootProps: props,
    internalProps: {
      dynamicClasses: error
        ? [{ classes: "error", condition: error }]
        : undefined,
      id,
      role: "combobox",
      "aria-label": ariaLabel,
      "aria-haspopup": "listbox",
      "aria-expanded": sql`popover_open`,
      "aria-controls": listboxId,
      tabIndex: 0,
      onKeyDown: (s: DomStatements) => {
        s.statements(updateComboboxWidth);
        // Delegate to JS module handler
        s.if(
          sql`event.key in ('ArrowDown', 'ArrowUp')`,
          (s: DomStatements) => {
            s.event.preventDefault();
            s.if(sql`not popover_open`, (s: DomStatements) => {
              s.setScalar("popover_open", true);
              s.commitUiTreeChanges();
              s.sleep(5);
              s.jsCall({
                module: "listbox_nav",
                exportName: "focusFirst",
                handle: listboxHandle,
                argJson: sql`json_build_object('handle', ${listboxHandle})`,
              });
            });
            s.if(sql`popover_open`, (s: DomStatements) => {
              s.if(sql`event.key = 'ArrowDown'`, (s: DomStatements) => {
                s.jsCall({
                  module: "listbox_nav",
                  exportName: "focusNext",
                  handle: listboxHandle,
                  argJson: sql`json_build_object('handle', ${listboxHandle})`,
                });
              });
              s.if(sql`event.key = 'ArrowUp'`, (s: DomStatements) => {
                s.jsCall({
                  module: "listbox_nav",
                  exportName: "focusPrev",
                  handle: listboxHandle,
                  argJson: sql`json_build_object('handle', ${listboxHandle})`,
                });
              });
            });
          },
        );
        s.if(sql`event.key in (' ', 'Enter')`, (s: DomStatements) => {
          s.event.preventDefault();
          s.if(sql`popover_open`, (s: DomStatements) => {
            s.jsCall({
              module: "listbox_nav",
              exportName: "clickFocused",
              handle: listboxHandle,
              argJson: sql`json_build_object('handle', ${listboxHandle})`,
            });
            s.setScalar("popover_open", false);
          }).else((s: DomStatements) => {
            s.setScalar("popover_open", true);
          });
        });
        s.if(
          sql`event.key = 'Tab' and popover_open`,
          (s: DomStatements) => {
            s.jsCall({
              module: "listbox_nav",
              exportName: "clickFocused",
              handle: listboxHandle,
              argJson: sql`json_build_object('handle', ${listboxHandle})`,
            });
            s.setScalar("popover_open", false);
          },
        );
        s.if(sql`event.key = 'Escape'`, (s: DomStatements) => {
          s.if(sql`popover_open`, (s: DomStatements) => {
            s.setScalar("popover_open", false);
          });
        });
        // Letter search: single printable character opens popover and searches
        s.if(
          sql`length(event.key) = 1 and not event.ctrl_key and not event.meta_key and not event.alt_key`,
          (s: DomStatements) => {
            s.if(sql`not popover_open`, (s: DomStatements) => {
              s.setScalar("popover_open", true);
              s.statements(updateComboboxWidth);
              s.commitUiTreeChanges();
              s.sleep(5);
            });
            s.jsCall({
              module: "listbox_nav",
              exportName: "searchByLetter",
              handle: listboxHandle,
              argJson:
                sql`json_build_object('handle', ${listboxHandle}, 'char', event.key)`,
            });
          },
        );
      },
      onClick: (s: DomStatements) => {
        s.toggle("popover_open");
        s.statements(updateComboboxWidth);
      },
      onClickAway: onClickAway
        ? (s: DomStatements) => {
          s.statements(onClickAway);
          s.setScalar("popover_open", false);
        }
        : (s: DomStatements) => {
          s.setScalar("popover_open", false);
        },
      yolmFocusKey: immediateFocus ? sql`0` : sql.null,
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

  const updateComboboxWidth = new DomStatements();
  updateComboboxWidth
    .element(typeof id === "string" ? sql.lit`${id}` : id)
    .getBoundingClientRect("rect");
  updateComboboxWidth.setScalar("popover_width", sql`rect.width`);
  const listSize = size;

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("popover_open", false);
        s.defScalar("popover_width", { type: "BigInt" });
      }}
    >
      <Data
        local
        noRefetch
        watch={value ? [value] : undefined}
        procedure={(s) => {
          if (enumName) {
            s.defScalar("target_value", {
              type: { type: "Enum", enum: enumName },
              expr: value
                ? sql`case
                    when ${value} is null or cast(${value} as string) = '' then null
                    else ${value}::enums.${sql.ref(enumName)}
                  end`
                : sql.null,
            });
          } else {
            s.defScalar("target_value", {
              type: valueType,
              expr: value ?? sql.null,
            });
          }
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
            <SelectValue
              placeholder={placeholder}
              statics={renderCtx.statics}
              dynamics={renderCtx.dynamics}
              enumName={enumName}
            />
          </div>
          <div
            sx={selectPopoverStyles.popover()}
            tabIndex={-1}
            popover="auto"
            yolmPopoverShowing={sql`popover_open`}
            classes="skip-harmonize"
            id={popoverId}
            floating={{
              anchorEl: typeof id === "string" ? sql.lit`${id}` : id,
              placement,
              strategy: "fixed",
              shift: { mainAxis: true, crossAxis: true },
              offset: { mainAxis: 4, crossAxis: 0 },
              flip: { crossAxis: false, mainAxis: false },
            }}
            onToggleHide={(s: DomStatements) => {
              s.setScalar("popover_open", false);
            }}
            style={{ width: sql`popover_width || 'px'` }}
            js={{
              handles: [{
                module: "listbox_nav",
                cleanup: "cleanup",
                handle: listboxHandle,
              }],
              on: {},
            }}
            onMount={(s: DomStatements) => {
              s.jsCall({
                module: "listbox_nav",
                exportName: "initialize",
                handle: listboxHandle,
                argJson: sql`json_build_object(
                  'handle', ${listboxHandle},
                  'rootId', ${popoverId},
                  'itemSelector', '.listbox-item',
                  'horizontal', false,
                  'letterSearch', true,
                  'activateOnFocus', false,
                  'loop', true
                )`,
              });
            }}
          >
            <List
              id={listboxId}
              role="listbox"
              sx={{ maxHeight: 300, overflowY: "auto" }}
              size={listSize}
            >
              {props.children}
            </List>
          </div>
          <SvgIcon>
            <SelectIcon />
          </SvgIcon>
          {endDecorator && (
            <EndDecoratorSlot {...endDecoratorProps}>
              {endDecorator}
            </EndDecoratorSlot>
          )}
        </RootSlot>
      </Data>
    </Data>
  );
}

// --- Select.Value (template replay) ---

function SelectValue(props: {
  placeholder: Sql | string | undefined;
  statics: StaticItem[];
  dynamics: DynamicGroup[];
  enumName?: string;
}) {
  const { placeholder, statics, dynamics, enumName } = props;
  const hasEmptyStatic = statics.some((s) => s.value === "");
  return (
    <>
      {!(enumName || hasEmptyStatic) && (
        <Show when={sql`target_value is null`}>
          <div className="opacity-50 ml-2">{placeholder}</div>
        </Show>
      )}
      {statics.filter((item, i) =>
        statics.findIndex((s) => s.value === item.value) === i
      ).map((item) => (
        <Show
          when={item.value === "" && enumName
            ? sql`target_value is null`
            : sql`target_value = ${sql.lit`${item.value}`}`}
        >
          <div className="flex ml-2 items-center">{item.children}</div>
        </Show>
      ))}
      {dynamics.map((group) => (
        <Each table={group.table} recordName={group.recordName}>
          <Show
            when={sql`cast(${group.valueExpr} as string) = cast(target_value as string)`}
          >
            <div className="flex ml-2 items-center">{group.children}</div>
          </Show>
        </Each>
      ))}
    </>
  );
}

// --- Select.Option ---

/**
 * A selectable option inside a {@link Select}. A string `value` is a
 * static option; a {@link Sql} `value` inside an `Each` becomes a
 * dynamic option per row. `searchText` feeds the type-by-letter search.
 */
Select.Option = function SelectOption(props: SelectOptionProps) {
  if (usePhase() === "gather") {
    const gatherCtx = useICtx(SelectGatherICtxKey);
    const eachCtx = useOptionalICtx(EachICtxKey);
    if (eachCtx && typeof props.value !== "string") {
      gatherCtx.dynamics.push({
        table: eachCtx.eachTable,
        recordName: eachCtx.eachRecordName,
        valueExpr: props.value as Sql,
        searchText: props.searchText,
        children: props.children,
      });
    } else {
      gatherCtx.statics.push({
        value: props.value as string,
        searchText: typeof props.searchText === "string"
          ? props.searchText
          : undefined,
        children: props.children,
      });
    }
    return;
  }

  const renderCtx = useICtx(SelectRenderICtxKey);
  const isStatic = typeof props.value === "string";
  const valueExpr = isStatic ? sql.lit`${props.value}` : (props.value as Sql);

  const isSelected = isStatic
    ? (props.value === "" && renderCtx.enumName
      ? sql`target_value is null`
      : sql`target_value = ${sql.lit`${props.value}`}`)
    : sql`cast(target_value as string) = cast(${props.value} as string)`;

  return (
    <ListItemButton
      classes="listbox-item"
      role="option"
      aria-label={props.searchText
        ? (typeof props.searchText === "string"
          ? sql.lit`${props.searchText}`
          : props.searchText)
        : undefined}
      tabIndex={sql`case when ${isSelected} then 0 else -1 end`}
      variant="plain"
      aria-selected={isSelected}
      aria-disabled={props.disabled
        ? sql`case when ${props.disabled} then 'true' end`
        : undefined}
      sx={{
        "&[aria-selected='true']": {
          backgroundColor: "neutral-100",
          dark: { backgroundColor: "neutral-700" },
        },
      }}
      onClick={{
        detachedFromNode: true,
        procedure: (s: DomStatements) => {
          if (renderCtx.enumName && isStatic) {
            s.setScalar(
              "target_value",
              sql`try_cast(${sql.lit`${props.value as string}`} as enums.${
                sql.ref(renderCtx.enumName)
              })`,
            );
          } else {
            s.setScalar("target_value", valueExpr);
          }
          if (renderCtx.onInput) {
            renderCtx.onInput(s, sql`target_value`);
          }
          if (renderCtx.onChange) {
            renderCtx.onChange(s, sql`target_value`);
          }
        },
      }}
    >
      {props.children}
    </ListItemButton>
  );
};

// --- Select.Separator ---

/** A horizontal divider rule between groups of {@link Select} options. */
Select.Separator = function SelectSeparator() {
  if (usePhase() === "gather") return;
  return <hr className="my-1 border-divider" />;
};

// --- Select.Group ---

/** A labeled heading grouping related {@link Select.Option}s. */
Select.Group = function SelectGroup(
  props: { label: string | Sql; children: Node },
) {
  if (usePhase() === "gather") {
    // Still let children gather
    return props.children;
  }
  return (
    <>
      <div className="px-3 py-1 text-xs font-semibold text-tertiary uppercase">
        {props.label}
      </div>
      {props.children}
    </>
  );
};
