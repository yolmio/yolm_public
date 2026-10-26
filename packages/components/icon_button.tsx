import { DefaultButtonVariantICtxKey, useDefaultColor } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { App } from "std/system";
import type { Variant } from "std/theme";
import { Show, useApp, useOptionalICtx, useUniqueId } from "std/ui";
import type { ElementType, Node } from "std/ui";
import { Data } from "std/data";
import type { DomStatements } from "std/statements";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";
import { Tooltip } from "./tooltip";
import type { Color, ComponentOpts, Size } from "./types";
import {
  backLinkAttrs,
  mergeEventHandler,
  singleElementComponent,
} from "./utils";
import type { BackLinkOpts, OverridableComponent } from "./utils";

interface IconButtonBaseProps extends ComponentOpts<Size>, BackLinkOpts {
  component?: ElementType;
  /** expression for if the button is disabled */
  disabled?: BooleanExpr;
  /** expression for href, will make button into an anchor tag and add this prop */
  href?: Sql | string;
  "aria-label"?: Sql | string;

  icon?: IconName;
  children?: Node;

  tooltip?: Node;
  tooltipProps?: {
    placement?:
      | Sql
      | "top"
      | "bottom"
      | "left"
      | "right"
      | "top-start"
      | "top-end"
      | "bottom-start"
      | "bottom-end"
      | "left-start"
      | "left-end"
      | "right-start"
      | "right-end";
  };
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
}

const iconButtonSizeStyleBySize: Record<Size, StyleObject> = {
  xs: {
    "--icon-font-size": "calc(var(--icon-button-size, 1.5rem) / 1.5)",
    minWidth: "var(--icon-button-size, 1.5rem)",
    minHeight: "var(--icon-button-size, 1.5rem)",
    fontSize: cssVar("text-xs"),
    paddingX: "1px",
  },
  sm: {
    "--icon-font-size": "calc(var(--icon-button-size, 2rem) / 1.6)",
    minWidth: "var(--icon-button-size, 2rem)",
    minHeight: "var(--icon-button-size, 2rem)",
    fontSize: cssVar("text-sm"),
    paddingX: "2px",
  },
  md: {
    "--icon-font-size": "calc(var(--icon-button-size, 2.5rem) / 1.667)",
    minWidth: "var(--icon-button-size, 2.5rem)",
    minHeight: "var(--icon-button-size, 2.5rem)",
    fontSize: cssVar("text-base"),
    paddingX: "0.25rem",
  },
  lg: {
    "--icon-font-size": "calc(var(--icon-button-size, 3rem) / 1.714)",
    minWidth: "var(--icon-button-size, 3rem)",
    minHeight: "var(--icon-button-size, 3rem)",
    fontSize: cssVar("text-lg"),
    paddingX: "0.375rem",
  },
};

function styles(app: App, opts: OwnerState) {
  const { size, variant, color } = opts;
  const styles: StyleObject = {
    "--icon-margin-top": "initial",
    "--icon-margin-right": "initial",
    "--icon-margin-bottom": "initial",
    "--icon-margin-left": "initial",
    "--circular-progress-size": "var(--icon-font-size)",
    WebkitTapHighlightColor: "transparent",
    paddingY: 0,
    fontFamily: cssVar("font-family-body"),
    fontWeight: cssVar("font-weight-medium"),
    marginTop: "var(--icon-button-margin-top)", // to be controlled by other components, eg. Input
    marginRight: "var(--icon-button-margin-right)",
    marginBottom: "var(--icon-button-margin-bottom)",
    marginLeft: "var(--icon-button-margin-left)",
    borderRadius: `var(--icon-button-radius, ${cssVar("radius-sm")})`, // to be controlled by other components, eg. Input
    border: "none",
    boxSizing: "border-box",
    backgroundColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    transition:
      "background-color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, border-color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms",
    "&:focus-visible": app.theme.focus.default,
    "--icon-color": "currentColor",
    ...iconButtonSizeStyleBySize[size],
  };
  return [
    styles,
    getVariantStyle(variant, color),
    { "&:hover": getVariantStyle(variant, color, "hover") },
    { "&:active": getVariantStyle(variant, color, "active") },
    { "&[aria-pressed='true']": getVariantStyle(variant, color, "active") },
    { "&:disabled": getVariantStyle(variant, color, "disabled") },
  ];
}

export type IconButtonProps =
  & IconButtonBaseProps
  & JSX.IntrinsicElements["button"];

/**
 A component for rendering an icon button.

 @category UI Component

 @param props.size
 @param props.variant
 @param props.color
 @param props.icon - The icon to display in the button.
 @param props.component - The component used for the root node. Defaults to 'button' or 'a' if href is provided.
 @param props.href - The URL to link to when the button is clicked.
 @param props.backLink - With `href`, returns to the most recent earlier history entry for that path, restoring its filters and scroll.

 @examples
 [Example](../table_blocks/attachments/attachments_card.tsx)
 */
export const IconButton: OverridableComponent<{
  defaultComponent: "button";
  props: IconButtonBaseProps;
}> = (props: IconButtonProps) => {
  let {
    size = "md",
    variant = "solid",
    color = useDefaultColor("primary"),
    children,
    icon,
    component = props.href ? "a" : "button",
    tooltip,
    tooltipProps,
    backLink,
    ...rest
  } = props;
  Object.assign(rest, backLinkAttrs(props.href, backLink));
  const buttonGroupContext = useOptionalICtx(DefaultButtonVariantICtxKey);
  if (buttonGroupContext) {
    variant = props.variant ?? buttonGroupContext.defaultVariant ?? "solid";
    color = props.color ??
      buttonGroupContext.defaultColor ??
      useDefaultColor("primary");
    size = props.size ?? buttonGroupContext.defaultSize ?? "md";
  }
  if (icon && children) {
    throw new Error("Cannot have both icon and children");
  }
  if (!(Boolean(icon) || Boolean(children))) {
    throw new Error("Must have either icon or children");
  }
  if (tooltip) {
    const anchorId = rest.id ?? useUniqueId();
    rest.id = anchorId;
    rest.onMouseEnter = mergeEventHandler(
      rest.onMouseEnter,
      (s: DomStatements) => {
        s.setScalar("open_tooltip", true);
        s.increment("mouse_enter_count");
      },
    );
    rest.onMouseLeave = mergeEventHandler(
      rest.onMouseLeave,
      (s: DomStatements) => {
        s.defScalar("prev_mouse_enter_count", sql`mouse_enter_count`);
        s.sleep(50);
        s.if(
          sql`prev_mouse_enter_count = mouse_enter_count`,
          (s: DomStatements) => {
            s.setScalar("open_tooltip", false);
          },
        );
      },
    );
    rest.onFocus = mergeEventHandler(rest.onFocus, (s: DomStatements) => {
      // Mouse-driven focus transfers must not leave an unhovered tooltip open.
      s.element(typeof anchorId === "string" ? sql.lit(anchorId) : anchorId)
        .matches(sql.lit(":focus-visible"), "tooltip_keyboard_focus");
      s.setScalar("open_tooltip", sql`tooltip_keyboard_focus`);
    });
    rest.onClick = mergeEventHandler((s: DomStatements) => {
      s.setScalar("open_tooltip", false);
    }, rest.onClick);
    rest.onBlur = mergeEventHandler(rest.onBlur, (s: DomStatements) => {
      s.setScalar("open_tooltip", false);
    });
  }
  const app = useApp();
  const ownerState = { size, variant, color };
  const [RootSlot, rootProps] = singleElementComponent({
    component,
    sx: styles(app, ownerState),
    internalProps: { classes: "IconButton" },
    externalProps: rest,
  });
  const button = icon
    ? (
      <RootSlot {...rootProps}>
        <MaterialIcon icon={icon} />
      </RootSlot>
    )
    : <RootSlot {...rootProps}>{children}</RootSlot>;
  if (props.tooltip) {
    return (
      <Data
        local
        noRefetch
        procedure={(s) => {
          s.defScalar("open_tooltip", false);
          s.defScalar("mouse_enter_count", 0);
        }}
      >
        {button}
        <Show when={sql`open_tooltip`}>
          <Tooltip anchorEl={rest.id!} placement={tooltipProps?.placement}>
            {tooltip}
          </Tooltip>
        </Show>
      </Data>
    );
  }
  return button;
};
