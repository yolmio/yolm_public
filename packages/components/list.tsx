import { EachICtxKey, useDefaultColor } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import { Show, useApp, useICtx, usePhase } from "std/ui";
import type { Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot, singleElementComponent } from "./utils";
import type {
  OverridableComponent,
  SingleElementComponentProps,
} from "./utils";

/** Whether a {@link List} lays its items out in a column or a row. */
export type Orientation = "horizontal" | "vertical";

/** Props for {@link List}. */
export interface ListProps
  extends ComponentOpts<Size>, SingleElementComponentProps {
  orientation?: Orientation;
  /** DOM id of the parent list; set when this list is rendered nested inside a {@link ListItem} to inherit nested spacing/sizing. */
  nestedIn?: Sql;
  children: Node;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
  isNested: boolean;
  orientation: Orientation;
}

const listStyles = ({ ownerState }: { ownerState: OwnerState }) => {
  const { size, variant, color, isNested, orientation } = ownerState;
  const styles: StyleObject = {
    boxSizing: "border-box",
    borderRadius: "var(--list-radius)",
    listStyle: "none",
    display: "flex",
    flexDirection: orientation === "vertical" ? "column" : "row",
    flexGrow: 1,
    position: "relative",
    ...getVariantStyle(variant, color),
  };

  function applySizeVars(size: Size | undefined) {
    if (size === "xs") {
      return {
        "--list-divider-gap": "0.1875rem",
        "--list-item-min-height": "1.5rem",
        "--list-item-padding-y": "0.125rem",
        "--list-item-padding-x": "0.375rem",
        "--list-item-font-size": cssVar("text-xs"),
        "--list-decorator-size": "1.5rem",
        "--icon-font-size": "1rem",
        "--list-item-gap": "0.1875rem",
      };
    }
    if (size === "sm") {
      return {
        "--list-divider-gap": "0.25rem",
        "--list-item-min-height": "2rem",
        "--list-item-padding-y": "0.25rem",
        "--list-item-padding-x": "0.5rem",
        "--list-item-font-size": cssVar("text-sm"),
        "--list-decorator-size": "2rem",
        "--icon-font-size": "1.125rem",
        "--list-item-gap": "0.25rem",
      };
    }
    if (size === "md") {
      return {
        "--list-divider-gap": "0.375rem",
        "--list-item-min-height": "2.5rem",
        "--list-item-padding-y": "0.375rem",
        "--list-item-padding-x": "0.75rem",
        "--list-item-font-size": cssVar("text-base"),
        "--list-decorator-size": "2.5rem",
        "--icon-font-size": "1.25rem",
        "--list-item-gap": "0.625rem",
      };
    }
    if (size === "lg") {
      return {
        "--list-divider-gap": "0.5rem",
        "--list-item-min-height": "3rem",
        "--list-item-padding-y": "0.5rem",
        "--list-item-padding-x": "1rem",
        "--list-item-font-size": cssVar("text-base"),
        "--list-decorator-size": "3rem",
        "--icon-font-size": "1.5rem",
        "--list-item-gap": "0.75rem",
      };
    }
    return {};
  }

  if (isNested) {
    Object.assign(styles, applySizeVars(size));
    Object.assign(styles, {
      "--list-item-padding-right": "var(--list-item-padding-x)",
      "--list-item-padding-left": "var(--nested-list-item-padding-left)",
      "--list-item-button-margin-y": "0px",
      "--list-item-button-margin-x": "0px",
      "--list-item-margin-y": "0px",
      "--list-item-margin-x": "0px",
      padding: 0,
      marginLeft: "var(--nested-list-margin-left)",
      marginRight: "var(--nested-list-margin-right)",
      marginTop: "var(--list-gap)",
      marginBottom: "initial",
    });
  } else {
    Object.assign(styles, applySizeVars(size ?? "md"));
    Object.assign(styles, {
      "--list-gap": "0px",
      "--list-decorator-color": cssVar("palette-text-tertiary"),
      "--list-nested-inset-start": "0px",
      "--list-item-padding-left": "var(--list-item-padding-x)",
      "--list-item-padding-right": "var(--list-item-padding-x)",
      "--internal-child-radius":
        "max(var(--list-radius) - var(--list-padding), min(var(--list-padding) / 2, var(--list-radius) / 2))",
      "--list-item-radius": "var(--internal-child-radius)",
      "--list-item-start-action-translate-x":
        "calc(0.5 * var(--list-item-padding-left))",
      "--list-item-end-action-translate-x":
        "calc(-0.5 * var(--list-item-padding-right))",
      margin: "initial",
    });
    if (orientation === "vertical") {
      Object.assign(styles, {
        paddingY: "var(--list-padding, var(--list-divider-gap))",
        paddingX: "var(--list-padding)",
      });
    } else {
      Object.assign(styles, {
        paddingX: "var(--list-padding, var(--list-divider-gap))",
        paddingY: "var(--list-padding)",
      });
    }
  }
  return styles;
};

/**
 A customizable list component that can be used to display a collection of items.

 @category UI Component
 @param props.size
 @param props.variant
 @param props.color
 @param props.orientation - The orientation of the list. Defaults to "vertical".
 @param props.nestedIn - The ID of the parent list if this is a nested list.
 @param props.children - The content of the list.

 @examples
 [Example](./read_select.tsx)
 */
export const List: OverridableComponent<{
  defaultComponent: "ul";
  props: ListProps;
}> = (props: ListProps) => {
  const {
    size = "md",
    variant = "plain",
    color = "neutral",
    orientation = "vertical",
    nestedIn,
    children,
    ...rest
  } = props;
  const ownerState: OwnerState = {
    size,
    variant,
    color,
    isNested: Boolean(nestedIn),
    orientation,
  };
  const [RootSlot, rootProps] = singleElementComponent({
    component: "ul",
    sx: listStyles({ ownerState }),
    externalProps: rest,
    internalProps: {
      "aria-labelledby": nestedIn,
    },
  });
  return <RootSlot {...rootProps}>{children}</RootSlot>;
};

/** Props for {@link ListItemButton}. */
export interface ListItemButtonProps
  extends ComponentOpts<Size>, SingleElementComponentProps {
  variant?: Variant;
  color?: Color;
  /** Set when the parent list is horizontal so trailing margins use the row gap instead of the column gap. */
  inRow?: boolean;
  /** When set, renders as an `<a>` link to this destination instead of a `<div>`. */
  href?: Sql | string;
  children: Node;
  className?: string;
}

/**
 * The clickable element inside a `ListItem`. Renders as a focusable,
 * hover-styled control wrapping the row content. Use whenever the row
 * acts as an action (navigation link, filter selector, menu entry).
 *
 * Themed via `variant`/`color`. Pass `href` to render as a link, or
 * any standard DOM event handler (`onClick`, `onKeyDown`, …). For
 * "selected" styling, set `aria-selected` and style via `sx`.
 *
 * @example
 * <ListItem>
 *   <ListItemButton onClick={(s) => s.navigate(sql`'/users/' || id`)}>
 *     {sql`name`}
 *   </ListItemButton>
 * </ListItem>
 */
export const ListItemButton: OverridableComponent<{
  defaultComponent: "div";
  props: ListItemButtonProps;
}> = (props: ListItemButtonProps) => {
  const {
    variant = "plain",
    color = "neutral",
    // deno-lint-ignore no-unused-vars
    size,
    inRow = false,
    href,
    children,
    component,
    ...rest
  } = props;
  const app = useApp();
  const [Root, rootProps] = singleElementComponent({
    component: component ?? (href ? "a" : "div"),
    sx: styles.listItemButton(app, variant, color, inRow),
    externalProps: rest,
    internalProps: {
      tabIndex: 0,
      href,
      type: component === "button" ? "button" : undefined,
    },
  });
  return <Root {...rootProps}>{children}</Root>;
};

interface ListItemDecoratorOpts extends ComponentOpts<Size> {
  listOrientation?: Orientation;
  children: Node;
}

/**
 * Reserved leading slot inside a `ListItem` — typically used to render an
 * icon, avatar, or status dot to the left (or above, in horizontal lists)
 * of the main row content. Aligns its children to the list's icon
 * gutter so multiple rows line up.
 *
 * @example
 * <ListItem>
 *   <ListItemDecorator><MaterialIcon icon="Mail" /></ListItemDecorator>
 *   <ListItemContent>{sql`subject`}</ListItemContent>
 * </ListItem>
 */
export const ListItemDecorator: OverridableComponent<{
  defaultComponent: "span";
  props: ListItemDecoratorOpts;
}> = (props: ListItemDecoratorOpts) => {
  const {
    listOrientation = "vertical",
    children,
    // deno-lint-ignore no-unused-vars
    size,
    ...rest
  } = props;

  const [Root, rootProps] = singleElementComponent({
    component: "span",
    sx: styles.decorator(listOrientation),
    externalProps: rest,
  });

  return <Root {...rootProps}>{children}</Root>;
};

/** Props for {@link ListItem}. */
export interface ListItemProps
  extends ComponentOpts<Size>, SingleElementComponentProps {
  /** Set to `true` when the item contains a nested {@link List}; switches to a column layout with nested insets. */
  nested?: boolean;
  /** Pin the item to the top of the scroll container (e.g. for group headers). */
  sticky?: boolean;
  variant?: Variant;
  color?: Color;
  /** Node absolutely positioned at the leading edge, staying visible regardless of row hover state. */
  startAction?: Node;
  /** Node absolutely positioned at the trailing edge, staying visible regardless of row hover state. */
  endAction?: Node;
  children: Node;
  /** Lay the item out horizontally (sets the leading margin from the row gap). */
  row?: boolean;
  /** When combined with `row`, allow wrapping and apply both row and column gaps. */
  wrap?: boolean;
  nesting?: boolean;
}

interface ListItemOwnerState {
  sticky: boolean;
  nested: boolean;
  variant: Variant;
  color: Color;
  row: boolean;
  wrap: boolean;
}

const listItemRoot = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: ListItemOwnerState;
    },
  ) => {
    const { sticky, nested, variant, color, row, wrap } = ownerState;
    const styles: StyleObject = {
      boxSizing: "border-box",
      borderRadius: "var(--list-item-radius)",
      display: "flex",
      flex: "none",
      listStyleType: "var(--_list-marker-type, disc)",
      position: "relative",
      paddingTop: nested ? 0 : "var(--list-item-padding-y)",
      paddingBottom: nested ? 0 : "var(--list-item-padding-y)",
      paddingLeft: "var(--list-item-padding-left)",
      paddingRight: "var(--list-item-padding-right)",
      minHeight: "var(--list-item-min-height)",
      "&:empty": {
        display: "none",
      },
    };
    if (!nested) {
      Object.assign(styles, {
        "--list-item-button-margin-inline":
          "calc(-1 * var(--list-item-padding-left)) calc(-1 * var(--list-item-padding-right))",
        "--list-item-button-margin-block":
          "calc(-1 * var(--list-item-padding-y))",
        alignItems: "center",
        gap: "var(--list-item-gap)",
        marginInline: "var(--list-item-margin-inline)",
      });
    }
    if (nested) {
      Object.assign(styles, {
        "--nested-list-margin-right":
          "calc(-1 * var(--list-item-padding-right))",
        "--nested-list-margin-left": "calc(-1 * var(--list-item-padding-left))",
        "--nested-list-item-padding-left":
          "calc(var(--list-item-padding-left) + var(--list-nested-inset-start))",
        "--list-item-button-margin-block": "0px",
        "--list-item-button-margin-inline":
          "calc(-1 * var(--list-item-padding-left)) calc(-1 * var(--list-item-padding-right))",
        "--list-item-margin-inline":
          "calc(-1 * var(--list-item-padding-left)) calc(-1 * var(--list-item-padding-right))",
        flexDirection: "column",
      });
    }
    if (sticky) {
      Object.assign(styles, {
        position: "sticky",
        top: "var(--list-item-sticky-top, 0px)",
        zIndex: 1,
        background: `var(--list-item-sticky-background, ${
          cssVar("palette-background-body")
        })`,
      });
    }
    if (row) {
      Object.assign(styles, {
        marginLeft: "var(--list-gap)",
      });
    } else {
      Object.assign(styles, {
        marginTop: "var(--list-gap)",
      });
    }
    if (row && wrap) {
      Object.assign(styles, {
        marginLeft: "var(--list-gap)",
        marginTop: "var(--list-gap)",
      });
    }
    return {
      ...styles,
      ...getVariantStyle(variant, color),
    };
  },
);

const startActionSlot = createGatherSafeSlot(
  "startAction",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: ListItemOwnerState;
    },
  ) => ({
    display: "inherit",
    position: "absolute",
    top: ownerState.nested ? "calc(var(--list-item-min-height) / 2)" : "50%",
    left: 0,
    transform: "translate(var(--list-item-start-action-translate-x), -50%)",
    zIndex: 1,
  }),
);

const endActionSlot = createGatherSafeSlot(
  "endAction",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: ListItemOwnerState;
    },
  ) => ({
    display: "inherit",
    position: "absolute",
    top: ownerState.nested ? "calc(var(--list-item-min-height) / 2)" : "50%",
    right: 0,
    transform: "translate(var(--list-item-end-action-translate-x), -50%)",
  }),
);

/**
 * A single row inside a `List`. Provides the layout slot for
 * `ListItemDecorator`, `ListItemContent`, and trailing actions.
 *
 * Themed via `variant`/`color`. Set `nested` to `true` when the item
 * itself contains a nested `List` (renders a disclosure-friendly
 * layout); set `endAction` to anchor a button on the trailing edge that
 * stays visible regardless of row hover state.
 */
export const ListItem: OverridableComponent<{
  defaultComponent: "li";
  props: ListItemProps;
}> = (props: ListItemProps) => {
  const {
    nested = false,
    sticky = false,
    variant = "plain",
    color = useDefaultColor("neutral"),
    // deno-lint-ignore no-unused-vars
    size,
    startAction,
    endAction,
    children,
    row = false,
    wrap = false,
    // deno-lint-ignore no-unused-vars
    nesting = false,
    ...other
  } = props;
  const ownerState: ListItemOwnerState = {
    sticky,
    nested,
    row,
    wrap,
    variant,
    color,
  };
  const [RootSlot, rootProps] = listItemRoot({
    component: "li",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  const [StartActionSlot, startActionProps] = startActionSlot({
    component: "div",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [EndActionSlot, endActionProps] = endActionSlot({
    component: "div",
    rootProps: props,
    slotProps: { ownerState },
  });
  return (
    <RootSlot {...rootProps}>
      {startAction && (
        <StartActionSlot {...startActionProps}>{startAction}</StartActionSlot>
      )}
      {children}
      {endAction && (
        <EndActionSlot {...endActionProps}>{endAction}</EndActionSlot>
      )}
    </RootSlot>
  );
};

const styles = {
  listItemButton: (
    app: any,
    variant: Variant,
    color: Color,
    inRow: boolean,
  ): StyleObject => {
    return {
      WebkitTapHighlightColor: "transparent",
      boxSizing: "border-box",
      position: "relative",
      display: "flex",
      alignItems: "center",
      textAlign: "initial",
      textDecoration: "initial",
      backgroundColor: "initial",
      marginX: "var(--list-item-button-margin-x)",
      marginY: "var(--list-item-button-margin-y)",
      paddingY:
        "calc(var(--list-item-padding-y) - var(--variant-border-width))",
      paddingLeft:
        "calc(var(--list-item-padding-left) + var(--list-item-start-action-width, var(--internal-start-action-width, 0px)))",
      paddingRight:
        "calc(var(--list-item-padding-right) + var(--list-item-end-action-width, var(--internal-end-action-width, 0px)))",
      minBlockSize: "var(--list-item-min-height)",
      border: "none",
      borderRadius: "var(--list-item-radius)",
      flexGrow: 1,
      flexBasis: "0%",
      flexShrink: 0,
      minInlineSize: 0,
      transition:
        "background-color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms",
      fontSize: "var(--list-item-font-size)",
      fontFamily: cssVar("font-family-body"),
      "&:not(&:first-child)": {
        marginRight: inRow ? "var(--list-gap)" : undefined,
        marginTop: inRow ? undefined : "var(--list-gap)",
      },
      "&:focus-visible": app.theme.focus.default,
      gap: "var(--list-item-gap)",
      "&:hover": getVariantStyle(variant, color, "hover"),
      "&:active": getVariantStyle(variant, color, "active"),
      ...getVariantStyle(variant, color),
    };
  },
  decorator: (listOrientation: Orientation): StyleObject => ({
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: listOrientation === "horizontal" ? "initial" : "center",
    ...(listOrientation === "horizontal"
      ? {
        minBlockSize: "var(--list-item-decorator-size)",
        justifyContent: "center",
        marginBlockEnd: "calc(-1 * var(--list-item-gap))",
      }
      : {
        minInlineSize: "var(--list-item-decorator-size)",
      }),
  }),
};

// const scopedVariables = {
//   "--nested-list-margin-right": "0px",
//   "--nested-list-margin-left": "0px",
//   "--nested-list-item-padding-left": "var(--list-item-padding-x)",
//   "--list-item-button-margin-y": "0px",
//   "--list-item-button-margin-x": "0px",
//   "--list-item-margin-y": "0px",
//   "--list-item-margin-x": "0px",
// };

interface ListDividerProps
  extends ComponentOpts<Size>, SingleElementComponentProps {
  inset?: "gutter" | "startContent" | "startDecorator";
  orientation?: "horizontal" | "vertical";
  hideOnFirstEach?: boolean;
}

const listDividerStyles = ({
  ownerState,
}: {
  ownerState: ListDividerProps;
}): StyleObject => {
  const { inset, orientation } = ownerState;
  return {
    border: "none",
    flexShrink: 0,
    backgroundColor: cssVar("palette-divider"),
    ...(orientation === "horizontal"
      ? {
        height: "1px",
        width: "100%",
        marginTop: "var(--list-divider-gap)",
        marginBottom: "var(--list-divider-gap)",
      }
      : {
        width: "1px",
        marginLeft: "var(--list-divider-gap)",
        marginRight: "var(--list-divider-gap)",
      }),
    ...(inset === "gutter" && {
      marginLeft: "var(--list-item-padding-left)",
      marginRight: "var(--list-item-padding-right)",
    }),
    ...(inset === "startContent" && {
      marginLeft:
        "calc(var(--list-item-padding-left) + var(--list-item-decorator-size))",
    }),
    ...(inset === "startDecorator" && {
      marginLeft: "var(--list-item-padding-left)",
    }),
  };
};

/**
 * A separator rendered between {@link ListItem}s. Use `inset` to align
 * the rule with the row content gutter, and `hideOnFirstEach` to suppress
 * the divider before the first row when rendered inside an `Each` loop
 * (so a between-items divider does not appear above the list).
 *
 * @category UI Component
 */
export const ListDivider: OverridableComponent<{
  defaultComponent: "li";
  props: ListDividerProps;
}> = (props: ListDividerProps) => {
  if (usePhase() === "gather") {
    return;
  }
  const {
    inset,
    orientation = "horizontal",
    hideOnFirstEach = false,
    // deno-lint-ignore no-unused-vars
    size,
    ...rest
  } = props;
  const ownerState = {
    ...props,
    inset,
    orientation,
  };
  const [RootSlot, rootProps] = singleElementComponent({
    component: "li",
    sx: listDividerStyles({ ownerState }),
    externalProps: rest,
    internalProps: {
      role: "separator",
    },
  });
  if (hideOnFirstEach) {
    const ctx = useICtx(EachICtxKey);
    return (
      <Show when={sql`${sql.ref(ctx.eachRecordName)}.iteration_index != 0`}>
        <RootSlot {...rootProps} />
      </Show>
    );
  }
  return <RootSlot {...rootProps} />;
};

interface ListItemContentProps
  extends ComponentOpts<Size>, SingleElementComponentProps {
  children: Node;
}

const listItemContentStyles: StyleObject = {
  flex: "1 1 auto",
  minWidth: 0,
};

/**
 * The flexible main-content slot of a {@link ListItem}. Grows to fill the
 * space between decorators/actions and truncates rather than overflowing.
 * Use it to wrap the primary text/body of a row.
 *
 * @category UI Component
 */
export const ListItemContent: OverridableComponent<{
  defaultComponent: "div";
  props: ListItemContentProps;
}> = (props: ListItemContentProps) => {
  const {
    children,
    // deno-lint-ignore no-unused-vars
    size,
    ...rest
  } = props;

  const [RootSlot, rootProps] = singleElementComponent({
    component: "div",
    sx: listItemContentStyles,
    externalProps: rest,
  });

  return <RootSlot {...rootProps}>{children}</RootSlot>;
};

interface ListSubheaderProps
  extends ComponentOpts<Size>, SingleElementComponentProps {
  children: Node;
  sticky?: boolean;
}

const listSubheaderStyles = ({
  ownerState,
}: {
  ownerState: ListSubheaderProps;
}): StyleObject => ({
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  marginInline: "var(--list-item-margin-inline)",
  paddingBlock: "var(--list-item-padding-y)",
  paddingInlineStart: "var(--list-item-padding-left)",
  paddingInlineEnd: "var(--list-item-padding-right)",
  minBlockSize: "var(--list-item-min-height)",
  fontSize: "max(0.75em, 0.625rem)",
  fontWeight: cssVar("font-weight-medium"),
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  ...(ownerState.sticky && {
    position: "sticky",
    top: "var(--list-item-sticky-top, 0px)",
    zIndex: 1,
    background: "var(--list-item-sticky-background)",
  }),
});

/**
 * An uppercase, letter-spaced group heading rendered within a
 * {@link List}. Use to label a section of items; set `sticky` to pin the
 * heading to the top of the scroll container while its group is in view.
 *
 * @category UI Component
 */
export const ListSubheader: OverridableComponent<{
  defaultComponent: "div";
  props: ListSubheaderProps;
}> = (props: ListSubheaderProps) => {
  const {
    children,
    sticky = false,
    // deno-lint-ignore no-unused-vars
    size,
    ...rest
  } = props;

  const ownerState = {
    ...props,
    sticky,
  };

  const [RootSlot, rootProps] = singleElementComponent({
    component: "div",
    sx: listSubheaderStyles({ ownerState }),
    externalProps: rest,
  });

  return <RootSlot {...rootProps}>{children}</RootSlot>;
};
