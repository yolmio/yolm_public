import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Style, StyleObject } from "std/style_types";
import type { Variant } from "std/theme";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { addCtx, createICtxKey, Show, useICtx, useUniqueId } from "std/ui";
import type { ContextInstance, ElementType, ICtxKey, Node } from "std/ui";
import { List, ListItemButton } from "./list";
import type { ListItemButtonProps } from "./list";
import type { Color, ComponentOpts, Size } from "./types";
import { getUniqueUiId, singleElementComponent } from "./utils";
import type { OverridableComponent } from "./utils";
import type { ChangeEventHandlerFn } from "std/event_utils";

type TabValue = string | number | Sql;

// --- Context ---

interface TabsICtx {
  selectedTabScalar: string;
  selectedTab: Sql;
  controlled: boolean;
  onValueChange?: ChangeEventHandlerFn;
  size: Size;
  color: Color;
  variant: Variant;
  orientation: "horizontal" | "vertical";
  idBase: string;
}

const TabsICtxKey = createICtxKey<TabsICtx>("TabsICtx");

class TabsCtx implements ContextInstance, TabsICtx {
  implementICtxs: ICtxKey<any>[] = [TabsICtxKey];
  selectedTab: Sql;

  constructor(
    public idBase: string,
    public selectedTabScalar: string,
    public size: Size,
    public color: Color,
    public variant: Variant,
    public orientation: "horizontal" | "vertical",
    public controlled: boolean,
    selectedTab?: Sql,
    public onValueChange?: ChangeEventHandlerFn,
  ) {
    this.selectedTab = selectedTab ?? sql`${sql.ref(this.selectedTabScalar)}`;
  }
}

// --- Styles ---

function getTabsStyles(ownerState: {
  size: Size;
  color: Color;
  variant: Variant;
  orientation: "horizontal" | "vertical";
}): StyleObject {
  return {
    ...(ownerState.size === "xs" && { "--tabs-spacing": "0.5rem" }),
    ...(ownerState.size === "sm" && { "--tabs-spacing": "0.75rem" }),
    ...(ownerState.size === "md" && { "--tabs-spacing": "1rem" }),
    ...(ownerState.size === "lg" && { "--tabs-spacing": "1.25rem" }),
    "--tab-indicator-thickness": "2px",
    "--icon-color":
      ownerState.color !== "neutral" || ownerState.variant === "solid"
        ? "currentColor"
        : cssVar("palette-text-icon"),
    "--tab-list-sticky-background": cssVar("palette-background-surface"),
    display: "flex",
    flexDirection: ownerState.orientation === "vertical" ? "row" : "column",
    backgroundColor: cssVar("palette-background-surface"),
    position: "relative",
    fontFamily: cssVar("font-family-body"),
    fontSize: ownerState.size === "lg"
      ? cssVar("text-lg")
      : ownerState.size === "md"
      ? cssVar("text-base")
      : ownerState.size === "sm"
      ? cssVar("text-sm")
      : cssVar("text-sm"),
    lineHeight: ownerState.size === "lg"
      ? cssVar("leading-loose")
      : ownerState.size === "md"
      ? cssVar("leading-normal")
      : ownerState.size === "sm"
      ? cssVar("leading-snug")
      : cssVar("leading-snug"),
  };
}

function getTabListStyles(
  orientation: "horizontal" | "vertical",
  disableUnderline?: boolean,
  underlinePlacement?: "left" | "right" | "bottom" | "top",
  tabFlex?: string | number,
): StyleObject {
  return {
    "--list-gap": "0px",
    "--list-divider-gap": "0px",
    "--list-item-padding-x": "var(--tabs-spacing)",
    "--list-item-gap": "0.375rem",
    "--list-radius": "0px",
    "--list-padding": "0px",
    flexGrow: "initial",
    flexDirection: orientation === "vertical" ? "column" : "row",
    borderRadius: "var(--list-radius)",
    padding: "var(--list-padding)",
    zIndex: 1,
    ...(!disableUnderline && {
      ...(underlinePlacement === "bottom" && {
        "--tab-list-underline-bottom": "1px",
        paddingBottom: "1px",
        boxShadow: `inset 0 -1px ${cssVar("palette-divider")}`,
      }),
      ...(underlinePlacement === "top" && {
        "--tab-list-underline-top": "1px",
        paddingTop: "1px",
        boxShadow: `inset 0 1px ${cssVar("palette-divider")}`,
      }),
      ...(underlinePlacement === "right" && {
        "--tab-list-underline-right": "1px",
        paddingRight: "1px",
        boxShadow: `inset -1px 0 ${cssVar("palette-divider")}`,
      }),
      ...(underlinePlacement === "left" && {
        "--tab-list-underline-left": "1px",
        paddingLeft: "1px",
        boxShadow: `inset 1px 0 ${cssVar("palette-divider")}`,
      }),
    }),
    ...(tabFlex && {
      "& > *": { flex: tabFlex },
    }),
  };
}

function getTabStyles(
  variant: Variant,
  color: Color,
  selectedVariant?: Variant,
  selectedColor?: Color,
  disableIndicator?: boolean,
  indicatorInset?: boolean,
  indicatorPlacement?: "left" | "right" | "bottom" | "top",
  row?: boolean,
): Style {
  const s = {
    justifyContent: row ? "center" : "initial",
    "--list-item-decorator-align-items": "center",
    "--offset": "min(calc(-1 * var(--variant-border-width, 0px)), -1px)",
    ...(!disableIndicator && {
      "&[aria-selected='true']": {
        "--tab-indicator-color": "currentColor",
        zIndex: 1,
      },
      "&::after": {
        content: '""',
        display: "block",
        position: "absolute",
        margin: "auto",
        background: "var(--tab-indicator-color)",
        borderRadius: "var(--tab-indicator-radius)",
        ...(indicatorPlacement === "bottom" && {
          height: "var(--tab-indicator-thickness)",
          width: "var(--tab-indicator-size, 100%)",
          left: indicatorInset
            ? "var(--list-item-padding-left)"
            : "var(--offset)",
          right: indicatorInset
            ? "var(--list-item-padding-right)"
            : "var(--offset)",
          bottom: "calc(0px - var(--tab-list-underline-bottom, 0px))",
        }),
        ...(indicatorPlacement === "top" && {
          height: "var(--tab-indicator-thickness)",
          width: "var(--tab-indicator-size, 100%)",
          left: indicatorInset
            ? "var(--list-item-padding-left)"
            : "var(--offset)",
          right: indicatorInset
            ? "var(--list-item-padding-right)"
            : "var(--offset)",
          top: "calc(0px - var(--tab-list-underline-top, 0px))",
        }),
        ...(indicatorPlacement === "right" && {
          height: "var(--tab-indicator-size, 100%)",
          width: "var(--tab-indicator-thickness)",
          top: indicatorInset ? "var(--list-item-padding-y)" : "var(--offset)",
          bottom: indicatorInset
            ? "var(--list-item-padding-y)"
            : "var(--offset)",
          right: "calc(0px - var(--tab-list-underline-right, 0px))",
        }),
        ...(indicatorPlacement === "left" && {
          height: "var(--tab-indicator-size, 100%)",
          width: "var(--tab-indicator-thickness)",
          top: indicatorInset ? "var(--list-item-padding-y)" : "var(--offset)",
          bottom: indicatorInset
            ? "var(--list-item-padding-y)"
            : "var(--offset)",
          left: "calc(0px - var(--tab-list-underline-left, 0px))",
        }),
      },
    }),
    paddingBottom: !disableIndicator && indicatorPlacement === "bottom"
      ? "calc(var(--list-item-padding-y) - var(--variant-border-width, 0px) + var(--tab-indicator-thickness) - 1px)"
      : undefined,
    paddingTop: !disableIndicator && indicatorPlacement === "top"
      ? "calc(var(--list-item-padding-y) - var(--variant-border-width, 0px) + var(--tab-indicator-thickness) - 1px)"
      : undefined,
    paddingRight: !disableIndicator && indicatorPlacement === "right"
      ? "calc(var(--list-item-padding-right) + var(--tab-indicator-thickness) - 1px)"
      : undefined,
    paddingLeft: !disableIndicator && indicatorPlacement === "left"
      ? "calc(var(--list-item-padding-left) + var(--tab-indicator-thickness) - 1px)"
      : undefined,
    ...getVariantStyle(variant, color),
    "&:hover": getVariantStyle(variant, color, "hover"),
    "&:active": getVariantStyle(variant, color, "active"),
  };
  return [
    s,
    (selectedVariant || selectedColor) && {
      "&[aria-selected='true']": {
        ...getVariantStyle(selectedVariant || variant, selectedColor || color),
        "&:hover": getVariantStyle(
          selectedVariant || variant,
          selectedColor || color,
          "hover",
        ),
        "&:active": getVariantStyle(
          selectedVariant || variant,
          selectedColor || color,
          "active",
        ),
      },
    },
  ];
}

function getTabPanelStyles(ownerState: {
  size: Size;
  color: Color;
  variant: Variant;
}): StyleObject {
  return {
    display: "block",
    padding: "var(--tabs-spacing)",
    flexGrow: 1,
    fontFamily: cssVar("font-family-body"),
    fontSize: ownerState.size === "lg"
      ? cssVar("text-lg")
      : ownerState.size === "md"
      ? cssVar("text-base")
      : ownerState.size === "sm"
      ? cssVar("text-sm")
      : cssVar("text-sm"),
    lineHeight: ownerState.size === "lg"
      ? cssVar("leading-loose")
      : ownerState.size === "md"
      ? cssVar("leading-normal")
      : ownerState.size === "sm"
      ? cssVar("leading-snug")
      : cssVar("leading-snug"),
    ...getVariantStyle(ownerState.variant, ownerState.color),
  };
}

// --- Props ---

interface TabsBaseProps extends ComponentOpts<Size> {
  component?: ElementType;
  /** Scalar name for the selected tab value. Default: "selected_tab" */
  selectedTabScalar?: string;
  /** Initial tab value. Default: first tab clicked */
  defaultValue?: string | number;
  orientation?: "horizontal" | "vertical";
  idBase?: string;
  /** Controlled value (SQL expression). When set, no internal state is created. */
  value?: Sql;
  /** Called when tab changes (controlled mode) */
  onValueChange?: ChangeEventHandlerFn;
  children: Node;
}

interface TabListBaseProps extends ComponentOpts<Size> {
  component?: ElementType;
  disableUnderline?: boolean;
  underlinePlacement?: "left" | "right" | "bottom" | "top";
  tabFlex?: string | number;
}

interface TabBaseProps extends ListItemButtonProps {
  /** Value identifying this tab */
  value: TabValue;
  disableIndicator?: boolean;
  indicatorInset?: boolean;
  indicatorPlacement?: "left" | "right" | "bottom" | "top";
  selectedVariant?: Variant;
  selectedColor?: Color;
  component?: ElementType;
}

interface TabPanelBaseProps extends ComponentOpts<Size> {
  value: TabValue;
  /** Mount immediately and preserve panel state while inactive. Default false. */
  keepMounted?: boolean;
  component?: ElementType;
}

function getTabValueExpr(value: string | number | Sql) {
  return typeof value === "string" || typeof value === "number"
    ? sql.lit`${value}`
    : value;
}

// --- Tabs ---

/**
 * Container for a tabbed interface.
 *
 * Compose with `TabsList` (the row of tab triggers), `TabsTab` (each
 * tab), and `TabsPanel` (the body shown when a tab is active).
 *
 * In uncontrolled mode (the default), Tabs creates its own scalar to
 * track the active tab — name it via `selectedTabScalar` and seed it
 * with `defaultValue`. For external control, pass `value` (a SQL
 * expression) plus `onValueChange`. Use `orientation`
 * (`horizontal`/`vertical`) for sidebar-style layouts.
 *
 * @example
 * <Tabs selectedTabScalar="active_tab" defaultValue="overview">
 *   <TabsList>
 *     <TabsTab value="overview">Overview</TabsTab>
 *     <TabsTab value="activity">Activity</TabsTab>
 *   </TabsList>
 *   <TabsPanel value="overview">…</TabsPanel>
 *   <TabsPanel value="activity">…</TabsPanel>
 * </Tabs>
 */
export function Tabs(props: TabsBaseProps & JSX.IntrinsicElements["div"]) {
  const {
    size = "md",
    color = "neutral",
    variant = "plain",
    orientation = "horizontal",
    idBase = getUniqueUiId(),
    component = "div",
    selectedTabScalar = "selected_tab",
    defaultValue,
    value,
    onValueChange,
    ...other
  } = props;

  const ctx = new TabsCtx(
    idBase,
    selectedTabScalar,
    size,
    color,
    variant,
    orientation,
    value !== undefined,
    value,
    onValueChange,
  );
  addCtx(ctx);

  const [Root, rootProps] = singleElementComponent({
    component,
    sx: getTabsStyles({ size, color, variant, orientation }),
    externalProps: other,
  });

  if (value) {
    // Controlled mode - use external state
    return <Root {...rootProps} />;
  }

  // Uncontrolled mode - create local state
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(selectedTabScalar, {
          expr: defaultValue ? sql.lit`${defaultValue}` : sql.lit``,
          allowNoRead: true,
        });
      }}
    >
      <Root {...rootProps} />
    </Data>
  );
}

// --- Tabs.List ---

/**
 * The row (or column, when vertical) of tab triggers inside a {@link Tabs}.
 * Wraps the tab buttons with keyboard listbox navigation (arrow keys,
 * focus follows selection) and the active-tab underline. Must be a child
 * of {@link Tabs}.
 *
 * @category UI Component
 */
export const TabsList: OverridableComponent<{
  defaultComponent: "div";
  props: TabListBaseProps;
}> = (props: TabListBaseProps & JSX.IntrinsicElements["div"]) => {
  const ctx = useICtx(TabsICtxKey);
  const {
    component = List,
    tabFlex,
    disableUnderline = false,
    underlinePlacement,
    size,
    ...other
  } = props;
  const resolvedUnderlinePlacement = underlinePlacement ??
    (ctx.orientation === "horizontal" ? "bottom" : "right");

  useJsModule("listbox_nav");

  const listId = useUniqueId();
  const listboxHandle = sql.concat("tabs-", ctx.idBase);

  const [Root, rootProps] = singleElementComponent({
    component: component as ElementType,
    sx: getTabListStyles(
      ctx.orientation,
      disableUnderline,
      resolvedUnderlinePlacement,
      tabFlex,
    ),
    externalProps: other,
    internalProps: {
      role: "tablist",
      id: listId,
      size: size ?? ctx.size,
      onMount: (s: DomStatements) => {
        s.jsCall({
          module: "listbox_nav",
          exportName: "initialize",
          handle: listboxHandle,
          argJson: sql`json_build_object(
            'handle', ${listboxHandle},
            'rootId', ${listId},
            'itemSelector', '.listbox-item',
            'horizontal', ${
            ctx.orientation === "horizontal" ? sql.true : sql.false
          },
            'letterSearch', ${sql.false},
            'activateOnFocus', ${sql.true},
            'loop', ${sql.true}
          )`,
        });
      },
      onKeyDown: (s: DomStatements) => {
        s.returnIf(
          sql`event.is_composing or event.shift_key or event.meta_key or event.alt_key or event.ctrl_key`,
        );
        s.if(
          sql`event.key = ${
            ctx.orientation === "horizontal"
              ? sql.lit`ArrowRight`
              : sql.lit`ArrowDown`
          }`,
          (s) => {
            s.event.preventDefault();
            s.jsCall({
              module: "listbox_nav",
              exportName: "focusNext",
              handle: listboxHandle,
              argJson: sql`json_build_object('handle', ${listboxHandle})`,
            });
          },
        );
        s.if(
          sql`event.key = ${
            ctx.orientation === "horizontal"
              ? sql.lit`ArrowLeft`
              : sql.lit`ArrowUp`
          }`,
          (s) => {
            s.event.preventDefault();
            s.jsCall({
              module: "listbox_nav",
              exportName: "focusPrev",
              handle: listboxHandle,
              argJson: sql`json_build_object('handle', ${listboxHandle})`,
            });
          },
        );
        s.if(sql`event.key = 'Home'`, (s) => {
          s.event.preventDefault();
          s.jsCall({
            module: "listbox_nav",
            exportName: "focusFirst",
            handle: listboxHandle,
            argJson: sql`json_build_object('handle', ${listboxHandle})`,
          });
          s.jsCall({
            module: "listbox_nav",
            exportName: "clickFocused",
            handle: listboxHandle,
            argJson: sql`json_build_object('handle', ${listboxHandle})`,
          });
        });
      },
    },
  });
  return <Root {...rootProps} />;
};

Tabs.List = TabsList;

// --- Tabs.Tab ---

/**
 * A single clickable tab trigger inside {@link TabsList}. Its `value`
 * identifies the tab and is matched against the {@link TabsPanel} `value`
 * to decide which panel is shown. In uncontrolled mode, clicking sets the
 * parent's selected-tab scalar; in controlled mode it invokes the parent's
 * `onValueChange`.
 *
 * @category UI Component
 */
export const TabsTab: OverridableComponent<{
  defaultComponent: "button";
  props: TabBaseProps;
}> = (props: TabBaseProps & JSX.IntrinsicElements["div"]) => {
  const ctx = useICtx(TabsICtxKey);
  const {
    component = ListItemButton,
    value,
    disableIndicator = false,
    indicatorInset = false,
    indicatorPlacement,
    selectedVariant,
    selectedColor,
    variant = ctx.variant,
    color = ctx.color,
    ...other
  } = props;
  const resolvedIndicatorPlacement = indicatorPlacement ??
    (ctx.orientation === "horizontal" ? "bottom" : "right");

  const valueExpr = getTabValueExpr(value);
  const isSelected = sql`${ctx.selectedTab} = ${valueExpr}`;
  const usesDefaultComponent = component === ListItemButton;

  const [Root, rootProps] = singleElementComponent({
    component: component as ElementType,
    sx: getTabStyles(
      variant,
      color,
      selectedVariant,
      selectedColor,
      disableIndicator,
      indicatorInset,
      resolvedIndicatorPlacement,
      ctx.orientation === "horizontal",
    ),
    externalProps: other,
    internalProps: {
      component: usesDefaultComponent ? "button" : undefined,
      type: usesDefaultComponent ? "button" : undefined,
      role: "tab",
      classes: "listbox-item",
      value: usesDefaultComponent ? valueExpr : undefined,
      "aria-selected": isSelected,
      tabIndex: sql`case when ${isSelected} then 0 else -1 end`,
      onFocus: (s: DomStatements) => {
        s.jsCall({
          module: "listbox_nav",
          exportName: "focusByValue",
          handle: sql.concat("tabs-", ctx.idBase),
          argJson: sql`json_build_object(
            'handle', ${sql.concat("tabs-", ctx.idBase)},
            'value', ${valueExpr}
          )`,
        });
      },
      onClick: (s: DomStatements) => {
        if (ctx.onValueChange) {
          ctx.onValueChange(s, valueExpr);
        } else if (!ctx.controlled) {
          s.setScalar(ctx.selectedTabScalar, valueExpr);
        }
      },
    },
  });
  return <Root {...rootProps} />;
};

Tabs.Tab = TabsTab;

// --- Tabs.Panel ---

/**
 * The body shown when its `value` matches the active tab. Only the
 * matching panel is rendered (it is gated behind `Show`), so each panel's
 * contents are mounted lazily. Set `keepMounted` to preserve internal state
 * while inactive. Must be a child of {@link Tabs}.
 *
 * @category UI Component
 */
export const TabsPanel: OverridableComponent<{
  defaultComponent: "div";
  props: TabPanelBaseProps;
}> = (props: TabPanelBaseProps & JSX.IntrinsicElements["div"]) => {
  const { component = "div", value, keepMounted = false, ...other } = props;
  const ctx = useICtx(TabsICtxKey);
  const ownerState = { size: ctx.size, color: ctx.color, variant: ctx.variant };
  const valueExpr = getTabValueExpr(value);

  const [Root, rootProps] = singleElementComponent({
    component,
    sx: {
      ...getTabPanelStyles(ownerState),
      "&[hidden]": { display: "none" },
    },
    externalProps: {
      role: "tabpanel",
      hidden: sql`${ctx.selectedTab} != ${valueExpr}`,
      ...other,
    },
  });
  if (keepMounted) return <Root {...rootProps} />;
  return (
    <Show when={sql`${ctx.selectedTab} = ${valueExpr}`}>
      <Root {...rootProps} />
    </Show>
  );
};

Tabs.Panel = TabsPanel;
