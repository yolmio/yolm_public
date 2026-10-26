import { DefaultButtonVariantICtxKey, useDefaultColor } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { BooleanExpr } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import type { DynamicClass } from "std/ui";
import { Show, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { memoize } from "std/utils/memoize";
import { CircularProgress } from "./circular_progress";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";
import type { Color, ComponentOpts, Size } from "./types";
import { backLinkAttrs, createGatherSafeSlot } from "./utils";
import type { BackLinkOpts, SlottedComponentBaseProps } from "./utils";
import type { OverridableComponent } from "./utils";

/**
 * Props for {@link Button}. Inherits the standard component shape
 * (variant, color, size, slot props) plus button-specific options.
 *
 * See {@link https://docs.yolm.io/ui/button | Button}.
 */
export interface ButtonProps extends
  Omit<
    SlottedComponentBaseProps<{
      root: "button";
      startDecorator: "span";
      endDecorator: "span";
      loadingIndicatorCenter: "span";
    }>,
    "color"
  >,
  ComponentOpts<Size>,
  BackLinkOpts {
  fullWidth?: boolean;
  loadingPosition?: "start" | "center" | "end";

  /** expression for if the button is disabled */
  disabled?: BooleanExpr;
  /** expression for if the button shouhld be put into a loading state */
  loading?: BooleanExpr;
  /** expression for href, will make button into anchor tag and add this prop */
  href?: Sql | string;

  startDecorator?: Node;
  startIcon?: IconName;
  endDecorator?: Node;
  endIcon?: IconName;
  children: Node;
}

const buttonSizeStyleBySize: Record<Size, StyleObject> = {
  xs: {
    "--circular-progress-size": "16px",
    "--circular-progress-thickness": "2px",
    "--icon-font-size": "1rem",
    "--button-gap": "0.25rem",
    minHeight: "var(--button-min-height, 1.5rem)",
    fontSize: cssVar("text-xs"),
    paddingY: "1px",
    paddingX: "0.5rem",
  },
  sm: {
    "--circular-progress-size": "20px",
    "--circular-progress-thickness": "2px",
    "--icon-font-size": "1.25rem",
    "--button-gap": "0.375rem",
    minHeight: "var(--button-min-height, 2rem)",
    fontSize: cssVar("text-sm"),
    paddingY: "2px",
    paddingX: "0.75rem",
  },
  md: {
    "--circular-progress-size": "24px",
    "--circular-progress-thickness": "3px",
    "--icon-font-size": "1.5rem", // control the SvgIcon font-size
    "--button-gap": "0.5rem",
    minHeight: "var(--button-min-height, 2.5rem)", // use min-height instead of height to make the button resilient to its content
    fontSize: cssVar("text-sm"),
    paddingY: "0.25rem", // the padding-block act as a minimum spacing between content and root element
    paddingX: "1rem",
  },
  lg: {
    "--circular-progress-size": "28px",
    "--circular-progress-thickness": "4px",
    "--icon-font-size": "1.75rem",
    "--button-gap": "0.75rem",
    minHeight: "var(--button-min-height, 3rem)",
    fontSize: cssVar("text-base"),
    paddingY: "0.375rem",
    paddingX: "1.5rem",
  },
};

export const buttonSizeStyles = memoize((size: Size) => {
  return buttonSizeStyleBySize[size];
});

interface OwnerState {
  variant: Variant;
  color: Color;
  size: Size;
  fullWidth: boolean;
}

const root = createGatherSafeSlot(
  "root",
  (
    app,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { variant, color, size, fullWidth } = ownerState;
    const styles: StyleObject = {
      appearance: "none",
      "--icon-margin-top": "initial", // reset the icon's margin.
      "--icon-margin-right": "initial",
      "--icon-margin-bottom": "initial",
      "--icon-margin-left": "initial",
      WebkitTapHighlightColor: "transparent",
      borderRadius: `var(--button-radius, ${cssVar("radius-sm")})`, // to be controlled by other components, eg. Input
      marginTop: "var(--button-margin-top)", // to be controlled by other components, eg. Input
      marginBottom: "var(--button-margin-bottom)", // to be controlled by other components, eg. Input
      marginLeft: "var(--button-margin-left)", // to be controlled by other components, eg. Input
      marginRight: "var(--button-margin-right)", // to be controlled by other components, eg. Input
      border: "none",
      backgroundColor: "transparent",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      textDecoration: "none", // prevent user agent underline when used as anchor
      fontFamily: cssVar("font-family-body"),
      fontWeight: cssVar("font-weight-medium"),
      lineHeight: 1,
      "&:focus-visible": app.theme.focus.default,
      "&:hover": {
        hoverEnabled: getVariantStyle(variant, color, "hover"),
      },
      "&:active": getVariantStyle(variant, color, "active"),
      "&[aria-pressed='true']": getVariantStyle(variant, color, "active"),
      "&:disabled": getVariantStyle(variant, color, "disabled"),
      "--icon-color": "currentColor",
      ...getVariantStyle(variant, color),
      ...buttonSizeStyles(size),
    };
    if (fullWidth) {
      (styles as any).width = "100%";
    }
    (styles as any)["&.loading"] = {
      color: "transparent",
      "&:hover": { color: "transparent" },
      "&:active": { color: "transparent" },
    };
    return styles;
  },
);

const StartDecorator = createGatherSafeSlot("startDecorator", () => ({
  "--icon-margin-right": "calc(var(--button-gap) / -2)",
  "--circular-progress-margin": "0 0 0 calc(var(--button-gap) / -2)",
  display: "inherit",
  marginRight: "var(--button-gap)",
}));

const EndDecorator = createGatherSafeSlot("endDecorator", () => ({
  "--icon-margin-left": "calc(var(--button-gap) / -2)",
  "--circular-progress-margin": "0 calc(var(--button-gap) / -2) 0 0",
  display: "inherit",
  marginLeft: "var(--button-gap)",
}));

const LoadingIndicatorCenter = createGatherSafeSlot(
  "loadingIndicatorCenter",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    display: "inherit",
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    color: (getVariantStyle(ownerState.variant, ownerState.color) as any).color,
  }),
);

/**
 A customizable button component with various styles and states.

@category UI Component


@param props.color - Defaults to the context's default color or "primary".
@param props.variant
@param props.size
@param props.fullWidth - Whether the button should take up the full width of its container. Defaults to false.
@param props.loading - Expression to determine if the button is in a loading state.
@param props.startDecorator - Content to be displayed before the button's main content.
@param props.endDecorator - Content to be displayed after the button's main content.
@param props.startIcon - Icon to be displayed at the start of the button. You only need to specify the name of the icon.
@param props.endIcon - Icon to be displayed at the end of the button. You only need to specify the name of the icon.
@param props.loadingPosition - Position of the loading indicator when the button is in a loading state.
@param props.disabled - Expression to determine if the button is disabled.
@param props.href - If provided, renders the button as an anchor tag with this URL.
@param props.backLink - With `href`, returns to the most recent earlier history entry for that path, restoring its filters and scroll.
@param props.children - The main content of the button.

@returns The rendered Button component.

@examples
[Example](../../examples/northwind/apps/northwind.yolmstaging.net.tsx)

 */
export const Button: OverridableComponent<{
  defaultComponent: "button";
  props: ButtonProps;
}> = (props: ButtonProps) => {
  let {
    color = useDefaultColor("primary"),
    variant = "solid",
    size = "md",
    fullWidth = false,
    loading,
    startDecorator,
    endDecorator,
    component = props.href ? "a" : "button",
    startIcon,
    endIcon,
    // deno-lint-ignore no-unused-vars
    loadingPosition,
    backLink,
    ...other
  } = props;
  Object.assign(other, backLinkAttrs(props.href, backLink));
  const buttonGroupContext = useOptionalICtx(DefaultButtonVariantICtxKey);
  if (buttonGroupContext) {
    variant = props.variant ?? buttonGroupContext.defaultVariant ?? "solid";
    color = props.color ?? buttonGroupContext.defaultColor ?? "primary";
    size = props.size ?? buttonGroupContext.defaultSize ?? "md";
  }
  if (startIcon && startDecorator) {
    throw new Error("Cannot have both startIcon and startDecorator");
  }
  if (endIcon && endDecorator) {
    throw new Error("Cannot have both endIcon and endDecorator");
  }
  const resolvedStartDecorator = startIcon
    ? <MaterialIcon icon={startIcon} />
    : startDecorator;
  const resolvedEndDecorator = endIcon
    ? <MaterialIcon icon={endIcon} />
    : endDecorator;
  const resolvedLoadingPosition = props.loadingPosition ??
    (resolvedStartDecorator && !resolvedEndDecorator
      ? "start"
      : !resolvedStartDecorator && resolvedEndDecorator
      ? "end"
      : "center");
  const ownerState = {
    variant,
    color,
    size,
    fullWidth,
    loadingPosition: resolvedLoadingPosition,
  };
  const [StartDecoratorSlot, startDecoratorProps] = StartDecorator({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [EndDecoratorSlot, endDecoratorProps] = EndDecorator({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [LoadingIndicatorCenterSlot, loadingIndicatorCenterProps] =
    LoadingIndicatorCenter({
      component: "span",
      rootProps: props,
      slotProps: { ownerState },
    });
  const children: Node[] = [props.children];
  const dynamicClasses: DynamicClass[] = [];
  const loadingIndicator = props.loading
    ? <CircularProgress color={color} />
    : null;
  if (sql.isAnyExpr(loading) && resolvedLoadingPosition === "center") {
    dynamicClasses.push({ classes: "loading", condition: loading });
    children.push(
      <Show when={loading}>
        <LoadingIndicatorCenterSlot {...loadingIndicatorCenterProps}>
          {loadingIndicator}
        </LoadingIndicatorCenterSlot>
      </Show>,
    );
  }
  if (
    resolvedStartDecorator ||
    (sql.isAnyExpr(loading) && resolvedLoadingPosition === "start")
  ) {
    if (!resolvedStartDecorator) {
      children.unshift(
        <Show when={loading!}>
          <StartDecoratorSlot {...startDecoratorProps}>
            {loadingIndicator}
          </StartDecoratorSlot>
        </Show>,
      );
    } else if (sql.isAnyExpr(loading) && resolvedLoadingPosition === "start") {
      children.unshift(
        <StartDecoratorSlot {...startDecoratorProps}>
          <Show when={loading!} fallback={resolvedStartDecorator}>
            {loadingIndicator!}
          </Show>
        </StartDecoratorSlot>,
      );
    } else {
      children.unshift(
        <StartDecoratorSlot {...startDecoratorProps}>
          {resolvedStartDecorator}
        </StartDecoratorSlot>,
      );
    }
  }
  if (
    resolvedEndDecorator ||
    (sql.isAnyExpr(loading) && resolvedLoadingPosition === "end")
  ) {
    if (!resolvedEndDecorator) {
      children.push(
        <Show when={loading!}>
          <EndDecoratorSlot {...endDecoratorProps}>
            {loadingIndicator}
          </EndDecoratorSlot>
        </Show>,
      );
    } else if (sql.isAnyExpr(loading) && resolvedLoadingPosition === "end") {
      children.push(
        <EndDecoratorSlot {...endDecoratorProps}>
          <Show when={loading!} fallback={resolvedEndDecorator}>
            {loadingIndicator!}
          </Show>
        </EndDecoratorSlot>,
      );
    } else {
      children.push(
        <EndDecoratorSlot {...endDecoratorProps}>
          {resolvedEndDecorator}
        </EndDecoratorSlot>,
      );
    }
  }
  const [RootSlot, rootProps] = root({
    component,
    rootProps: props,
    externalProps: other,
    internalProps: { classes: "Button", dynamicClasses },
    slotProps: { ownerState },
  });
  return <RootSlot {...rootProps}>{children}</RootSlot>;
};
