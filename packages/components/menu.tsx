import { DropdownGatherICtxKey } from "std/ictx";
import type { DropdownGatherICtx } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type {
  DomStatements,
  DomStatementsOrFn,
  StateStatements,
} from "std/statements";
import { createStyles, cssVar } from "std/style_utils";
import type { StyleObject } from "std/style_types";
import type { Variant } from "std/theme";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import {
  addCtx,
  createICtxKey,
  gatherChildrenContextInfo,
  Show,
  useICtx,
  usePhase,
  useUniqueId,
} from "std/ui";
import type {
  ContextInstance,
  FloatingOpts,
  ICtxKey,
  Node,
  StatePropsWithoutChildren,
} from "std/ui";
import { Button } from "./button";
import type { ButtonProps } from "./button";
import { IconButton } from "./icon_button";
import type { IconButtonProps } from "./icon_button";
import { List, ListItemButton } from "./list";
import type { ListItemButtonProps, ListProps } from "./list";
import { singleElementComponent } from "./utils";

// --- Styles ---

const styles = createStyles({
  menuList: (app, variant: Variant): StyleObject => {
    const s: StyleObject = {
      "--focus-outline-offset": `calc(${cssVar("focus-thickness")} * -1)`,
      "--list-radius": cssVar("radius-sm"),
      "--list-item-sticky-top":
        "calc(var(--list-padding, var(--list-divider-gap)) * -1)",
      boxShadow: "md",
      overflow: "auto",
      zIndex: 1400,
      opacity: 0,
      "&[data-floating-placement='bottom-end']": {
        transformOrigin: "var(--popover-transform-origin, top right)",
      },
      "&[data-floating-placement='bottom-start']": {
        transformOrigin: "var(--popover-transform-origin, top left)",
      },
      "&[data-floating-placement='top-end']": {
        transformOrigin: "var(--popover-transform-origin, bottom right)",
      },
      "&[data-floating-placement='top-start']": {
        transformOrigin: "var(--popover-transform-origin, bottom left)",
      },
      "&[data-floating-placement='right-start']": {
        transformOrigin: "var(--popover-transform-origin, top left)",
      },
      "&[data-floating-placement='right-end']": {
        transformOrigin: "var(--popover-transform-origin, top right)",
      },
      "&[data-floating-placement='left-start']": {
        transformOrigin: "var(--popover-transform-origin, bottom left)",
      },
      "&[data-floating-placement='left-end']": {
        transformOrigin: "var(--popover-transform-origin, bottom right)",
      },
      "&[data-floating-placement='top']": {
        transformOrigin: "var(--popover-transform-origin, bottom)",
      },
      "&[data-floating-placement='bottom']": {
        transformOrigin: "var(--popover-transform-origin, top)",
      },
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
    if (variant === "outlined" || variant === "plain") {
      (s as any).backgroundColor = cssVar("palette-background-popup");
    }
    (s as any)["--list-item-sticky-background"] = (s as any).backgroundColor;
    return s;
  },
});

// --- Gather context (for portal nodes/state only, NOT items) ---

interface MenuGatherICtx {
  nodes: { key: string; node: Node }[];
  states: { key: string; f: StatePropsWithoutChildren }[];
  addNode(key: string, node: Node): void;
  addState(key: string, f: StatePropsWithoutChildren): void;
}

const MenuGatherICtxKey = createICtxKey<MenuGatherICtx>("MenuGatherICtx");

class MenuGatherCtx
  implements ContextInstance, MenuGatherICtx, DropdownGatherICtx {
  implementICtxs: ICtxKey<any>[] = [MenuGatherICtxKey, DropdownGatherICtxKey];
  nodes: { key: string; node: Node }[] = [];
  states: { key: string; f: StatePropsWithoutChildren }[] = [];
  items: { onClick: DomStatementsOrFn }[] = [];

  addNode(key: string, node: Node) {
    if (this.nodes.find((n) => n.key === key)) return;
    this.nodes.push({ key, node });
  }

  addState(key: string, f: StatePropsWithoutChildren) {
    if (this.states.find((s) => s.key === key)) return;
    this.states.push({ key, f });
  }
}

// --- Render context ---

interface MenuRenderICtx {
  buttonId: Sql;
  menuId: Sql;
}

const MenuRenderICtxKey = createICtxKey<MenuRenderICtx>("MenuRenderICtx");

class MenuRenderCtx implements ContextInstance, MenuRenderICtx {
  implementICtxs: ICtxKey<any>[] = [MenuRenderICtxKey];
  constructor(
    public buttonId: Sql,
    public menuId: Sql,
  ) {}
}

// --- Public API for portal nodes/state ---

/**
 * From inside a {@link Menu}'s children, register an extra node (e.g. a
 * dialog or portal) to be rendered alongside the menu's content rather
 * than inline in the item list. `key` deduplicates repeated registrations.
 *
 * @category Helper
 */
export function useMenuNode(key: string, node: Node) {
  const gatherCtx = useICtx(MenuGatherICtxKey);
  gatherCtx.addNode(key, node);
}

/**
 * From inside a {@link Menu}'s children, declare additional `Data` state
 * that wraps the menu (e.g. a scalar a menu item reads/writes). Accepts
 * either state props or a procedure. `key` deduplicates registrations.
 *
 * @category Helper
 */
export function useMenuState(
  key: string,
  f: StatePropsWithoutChildren | ((s: StateStatements) => void),
) {
  const gatherCtx = useICtx(MenuGatherICtxKey);
  gatherCtx.addState(key, typeof f === "function" ? { procedure: f } : f);
}

/** Backward-compatible alias for {@link useMenuNode}. */
export const useDropdownNode = useMenuNode;
/** Backward-compatible alias for {@link useMenuState}. */
export const useDropdownState = useMenuState;

// --- Menu ---

interface MenuProps {
  buttonId?: Sql | string;
  children: Node;
}

/**
 * Dropdown menu — composed by combining the trigger and content as
 * children of a single `<Menu>`: `Menu.Button` (or `Menu.IconButton`)
 * for the trigger, `Menu.Content` for the popover, and `Menu.Item`s
 * for the entries.
 *
 * Loads the `listbox_nav` JS module so arrow-key navigation,
 * enter-to-activate, and esc-to-close work without manual wiring.
 *
 * @example
 * <Menu>
 *   <Menu.Button variant="outlined" size="sm">Actions</Menu.Button>
 *   <Menu.Content floating={{ placement: "bottom-start" }}>
 *     <Menu.Item onClick={onRename}>Rename</Menu.Item>
 *     <Menu.Item onClick={onDelete}>Delete</Menu.Item>
 *   </Menu.Content>
 * </Menu>
 */
export function Menu(props: MenuProps) {
  useJsModule("listbox_nav");

  const gatherCtx = new MenuGatherCtx();
  addCtx(gatherCtx);

  // Gather for portal nodes/state only, NOT items
  gatherChildrenContextInfo(props.children);

  const buttonId = props.buttonId
    ? typeof props.buttonId === "string"
      ? sql.lit(props.buttonId)
      : props.buttonId
    : useUniqueId();
  const menuId = props.buttonId ? sql.concat(buttonId, "-menu") : useUniqueId();

  addCtx(new MenuRenderCtx(buttonId, menuId));

  let content: Node = (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("showing_list", false);
      }}
    >
      {props.children}
      {gatherCtx.nodes.map((n) => n.node)}
    </Data>
  );

  // Wrap with additional state from useMenuState
  for (const state of gatherCtx.states) {
    content = <Data local noRefetch {...state.f}>{content}</Data>;
  }

  return content;
}

// --- Shared keyboard handler ---

function menuKeyDown(s: DomStatements, listboxHandle: Sql) {
  s.returnIf(
    sql`event.is_composing or event.shift_key or event.meta_key or event.alt_key or event.ctrl_key`,
  );
  s.if(sql`event.key = 'Escape'`, (s) => {
    s.event.preventDefault();
    s.setScalar("ui.showing_list", false);
    s.return();
  });
  s.if(sql`event.key in ('ArrowDown', 'ArrowUp')`, (s) => {
    s.event.preventDefault();
    s.if(sql`not ui.showing_list`, (s) => {
      s.setScalar("ui.showing_list", true);
      s.commitUiTreeChanges();
      s.sleep(5);
      s.jsCall({
        module: "listbox_nav",
        exportName: "focusFirst",
        handle: listboxHandle,
        argJson: sql`json_build_object('handle', ${listboxHandle})`,
      });
    });
    s.if(sql`ui.showing_list`, (s) => {
      s.if(sql`event.key = 'ArrowDown'`, (s) => {
        s.jsCall({
          module: "listbox_nav",
          exportName: "focusNext",
          handle: listboxHandle,
          argJson: sql`json_build_object('handle', ${listboxHandle})`,
        });
      });
      s.if(sql`event.key = 'ArrowUp'`, (s) => {
        s.jsCall({
          module: "listbox_nav",
          exportName: "focusPrev",
          handle: listboxHandle,
          argJson: sql`json_build_object('handle', ${listboxHandle})`,
        });
      });
    });
    s.return();
  });
  s.if(sql`event.key in ('Enter', ' ')`, (s) => {
    s.event.preventDefault();
    s.if(sql`ui.showing_list`, (s) => {
      s.jsCall({
        module: "listbox_nav",
        exportName: "clickFocused",
        handle: listboxHandle,
        argJson: sql`json_build_object('handle', ${listboxHandle})`,
      });
    });
    s.if(sql`not ui.showing_list`, (s) => {
      s.setScalar("ui.showing_list", true);
    });
    s.return();
  });
}

// --- Menu.Button ---

/**
 * The {@link Button} that opens/closes a {@link Menu}. Wires the trigger's
 * id, ARIA expanded/controls state, and the keyboard handler (arrows open
 * and move focus, enter/space toggle). Accepts all {@link ButtonProps}.
 */
Menu.Button = function MenuButton(props: ButtonProps) {
  if (usePhase() === "gather") {
    return [props.startDecorator, props.children, props.endDecorator];
  }
  const ctx = useICtx(MenuRenderICtxKey);
  const listboxHandle = sql.concat("menu-", ctx.menuId);
  const [RootSlot, rootProps] = singleElementComponent({
    component: Button as any,
    externalProps: props as any,
    sx: {},
    internalProps: {
      variant: props.variant ?? "outlined",
      color: props.color ?? "neutral",
      id: ctx.buttonId,
      "aria-controls": sql`case when showing_list then ${ctx.menuId} end`,
      "aria-haspopup": sql.lit`true`,
      "aria-expanded": sql`case when showing_list then 'true' end`,
      onClick: (s: DomStatements) => {
        s.if(sql`showing_list`, (s) => {
          s.setScalar("showing_list", false);
          s.return();
        });
        s.setScalar("showing_list", true);
      },
      onKeyDown: (s: DomStatements) => menuKeyDown(s, listboxHandle),
    },
  });
  return <RootSlot {...rootProps}>{props.children}</RootSlot>;
};

// --- Menu.IconButton ---

/**
 * Icon-only variant of {@link Menu.Button}: opens/closes a {@link Menu}
 * via an {@link IconButton} trigger. Use when the menu's affordance is an
 * icon (e.g. a "⋯" overflow button) rather than a labelled button.
 */
Menu.IconButton = function MenuIconButton(props: IconButtonProps) {
  if (usePhase() === "gather") {
    return [props.children];
  }
  const ctx = useICtx(MenuRenderICtxKey);
  const listboxHandle = sql.concat("menu-", ctx.menuId);
  const [RootSlot, rootProps] = singleElementComponent({
    component: IconButton as any,
    externalProps: props as any,
    sx: {},
    internalProps: {
      variant: props.variant ?? "outlined",
      color: props.color ?? "neutral",
      size: props.size ?? "md",
      id: ctx.buttonId,
      "aria-controls": sql`case when showing_list then ${ctx.menuId} end`,
      "aria-haspopup": sql.lit`true`,
      "aria-expanded": sql`case when showing_list then 'true' end`,
      onClick: (s: DomStatements) => {
        s.if(sql`showing_list`, (s) => {
          s.setScalar("showing_list", false);
          s.return();
        });
        s.setScalar("showing_list", true);
      },
      onKeyDown: (s: DomStatements) => menuKeyDown(s, listboxHandle),
    },
  });
  return <RootSlot {...rootProps}>{props.children}</RootSlot>;
};

// --- Menu.Content ---

interface MenuContentProps extends Omit<ListProps, "floating"> {
  floating?: Partial<FloatingOpts>;
}

/**
 * The popover surface of a {@link Menu}, holding its {@link Menu.Item}s.
 * Renders as a floating, anchored {@link List} that shows while the menu
 * is open and initializes listbox keyboard navigation on mount. Override
 * positioning via the `floating` prop (placement, offset, etc.).
 */
Menu.Content = function MenuContent(
  props: MenuContentProps & Omit<JSX.IntrinsicElements["ul"], "floating">,
) {
  if (usePhase() === "gather") {
    return props.children;
  }
  const ctx = useICtx(MenuRenderICtxKey);
  const listboxHandle = sql.concat("menu-", ctx.menuId);
  const [ListSlot, listProps] = singleElementComponent({
    component: List as any,
    sx: styles.menuList(props.variant ?? "outlined"),
    externalProps: props as any,
    internalProps: {
      role: "menu",
      id: ctx.menuId,
      tabIndex: -1,
      popover: "auto",
      yolmPopoverShowing: sql`showing_list`,
      variant: props.variant ?? "outlined",
      floating: {
        anchorEl: ctx.buttonId,
        placement: sql.lit`bottom-start`,
        strategy: sql.lit`fixed`,
        shift: { mainAxis: true, crossAxis: true },
        offset: { mainAxis: 4, crossAxis: 0 },
        flip: { crossAxis: false, mainAxis: false },
      },
      onToggleHide: (s: DomStatements) => {
        s.setScalar("ui.showing_list", false);
      },
      onMount: (s: DomStatements) => {
        s.jsCall({
          module: "listbox_nav",
          exportName: "initialize",
          handle: listboxHandle,
          argJson: sql`json_build_object(
            'handle', ${listboxHandle},
            'rootId', ${ctx.menuId},
            'itemSelector', '.listbox-item',
            'horizontal', false,
            'letterSearch', true,
            'activateOnFocus', false,
            'loop', true
          )`,
        });
      },
      onKeyDown: (s: DomStatements) => menuKeyDown(s, listboxHandle),
    },
  });
  return (
    <Show when={sql`showing_list`}>
      <ListSlot {...listProps}>{props.children}</ListSlot>
    </Show>
  );
};

// --- Menu.Item ---

interface MenuItemProps extends ListItemButtonProps {
  onClick?: DomStatementsOrFn;
  closeOnClick?: boolean;
  target?: JSX.IntrinsicElements["a"]["target"];
  rel?: JSX.IntrinsicElements["a"]["rel"];
}

/**
 * A single selectable entry in {@link Menu.Content}. Runs `onClick` (or
 * navigates when `href` is set without a `target`) and then closes the menu
 * unless `closeOnClick` is false. Targeted links use native anchor navigation.
 * Inherits {@link ListItemButtonProps} for styling.
 */
Menu.Item = function MenuItem(props: MenuItemProps) {
  if (usePhase() === "gather") {
    return props.children;
  }

  const onClick = props.href && !props.target
    ? (s: DomStatements) => {
      s.navigate(
        typeof props.href === "string" ? sql.lit(props.href) : props.href!,
      );
    }
    : props.onClick;

  const { onClick: _, closeOnClick = true, ...rest } = props;

  const [RootSlot, rootProps] = singleElementComponent({
    component: ListItemButton as any,
    externalProps: rest as any,
    sx: {},
    internalProps: {
      classes: "listbox-item",
      role: sql.lit`menuitem`,
      tabIndex: -1,
      onClick: {
        detachedFromNode: true,
        procedure: (s: DomStatements) => {
          if (onClick) {
            s.statements(onClick);
          }
          if (closeOnClick) {
            s.setScalar("ui.showing_list", false);
          }
        },
      },
    },
  });
  return <RootSlot {...rootProps}>{props.children}</RootSlot>;
};

// --- Menu.Separator ---

/** A horizontal rule dividing groups of {@link Menu.Item}s. */
Menu.Separator = function MenuSeparator() {
  if (usePhase() === "gather") return;
  return <hr className="my-1 border-divider" />;
};
