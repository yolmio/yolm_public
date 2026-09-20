import { HarmonizeCtx } from "std/ictx";
import type { StyleObject } from "std/style_types";
import { createHarmonizeVars, cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import { addCtx } from "std/ui";
import type { Node } from "std/ui";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { OverridableComponent } from "./utils";

/** Screen edge a {@link Snackbar} anchors to. */
export interface AnchorOrigin {
  vertical: "top" | "bottom";
  /** Extra pixel offset added to the vertical inset, e.g. to clear a fixed header. */
  verticalOffset?: number;
  horizontal: "left" | "center" | "right";
}

/** Props for {@link Snackbar}. */
export interface SnackbarProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      startDecorator: "span";
      endDecorator: "span";
    }> {
  /** Where the snackbar is pinned on screen. Defaults to bottom-left. */
  anchorOrigin?: AnchorOrigin;
  startDecorator?: Node;
  endDecorator?: Node;
  /** Invert the snackbar's colors to contrast with the surrounding surface. */
  harmonize?: boolean;
  /** Icon shortcut rendered in the start decorator slot. */
  startIcon?: IconName;
  /** Icon shortcut rendered in the end decorator slot. */
  endIcon?: IconName;
  children: Node;
}

interface OwnerState {
  variant: Variant;
  color: Color;
  size: Size;
  anchorOrigin: AnchorOrigin;
  harmonize: boolean;
}

const root = createGatherSafeSlot(
  "root",
  ({ theme }, { ownerState }: { ownerState: OwnerState }) => {
    const { variant, color, size, anchorOrigin, harmonize } = ownerState;
    const styles: StyleObject = {
      "--snackbar-radius": cssVar("radius-sm"),
      "--snackbar-decorator-child-radius":
        "max((var(--snackbar-radius) - var(--variant-border-width, 0px)) - var(--snackbar-padding), min(var(--snackbar-padding) + var(--variant-border-width, 0px), var(--snackbar-radius) / 2))",
      "--button-min-height": "var(--snackbar-decorator-child-height)",
      "--icon-button-size": "var(--snackbar-decorator-child-height)",
      "--button-radius": "var(--snackbar-decorator-child-radius)",
      "--icon-button-radius": "var(--snackbar-decorator-child-radius)",
      "--icon-color": "currentColor",
      "--snackbar-vertical-offset": ownerState.anchorOrigin.verticalOffset
        ? `${ownerState.anchorOrigin.verticalOffset}px`
        : "0px",
      zIndex: 40,
      position: "fixed",
      display: "flex",
      alignItems: "center",
      minWidth: size === "xs" ? 240 : 300,
      boxShadow: cssVar("shadow-lg"),
      backgroundColor: cssVar("palette-background-surface"),
      padding: "var(--snackbar-padding)",
      borderRadius: "var(--snackbar-radius)",
      ...theme.typography[
        `body-${({ xs: "xs", sm: "sm", md: "md", lg: "lg" } as const)[size!]}`
      ],
      opacity: 1,
      transform: "translateY(0px) scale(1)",
      transition:
        `opacity ${theme.transitionDurations.popover} ${theme.transitionEasing.popover}, transform ${theme.transitionDurations.popover} ${theme.transitionEasing.popover}`,
      "@starting-style": {
        "&": {
          opacity: 0,
          transform: "translateY(10px) scale(0.97)",
        },
      },
    };
    Object.assign(styles, getVariantStyle(variant, color));
    switch (size) {
      case "xs":
        Object.assign(styles, {
          "--snackbar-padding": "0.5rem",
          "--snackbar-inset": "0.5rem",
          "--snackbar-decorator-child-height": "1.25rem",
          "--icon-font-size": cssVar("text-xl"),
          gap: "0.375rem",
        });
        break;
      case "sm":
        Object.assign(styles, {
          "--snackbar-padding": "0.75rem",
          "--snackbar-inset": "0.5rem",
          "--snackbar-decorator-child-height": "1.5rem",
          "--icon-font-size": cssVar("text-2xl"),
          gap: "0.5rem",
        });
        break;
      case "md":
        Object.assign(styles, {
          "--snackbar-padding": "1rem",
          "--snackbar-inset": "0.75rem",
          "--snackbar-decorator-child-height": "2rem",
          "--icon-font-size": cssVar("text-2xl"),
          gap: "0.625rem",
        });
        break;
      case "lg":
        Object.assign(styles, {
          "--snackbar-padding": "1.25rem",
          "--snackbar-inset": "1rem",
          "--snackbar-decorator-child-height": "2.375rem",
          "--icon-font-size": cssVar("text-2xl"),
          gap: "0.875rem",
        });
        break;
    }
    if (anchorOrigin.vertical === "top") {
      styles.top =
        "calc(var(--snackbar-inset) + var(--snackbar-vertical-offset, 0px))";
    } else {
      styles.bottom =
        "calc(var(--snackbar-inset) + var(--snackbar-vertical-offset, 0px))";
    }
    if (anchorOrigin.horizontal === "left") {
      styles.left = "var(--snackbar-inset)";
    } else if (anchorOrigin.horizontal === "right") {
      styles.right = "var(--snackbar-inset)";
    } else {
      styles.left = "50%";
      styles.transform += "translateX(-50%)";
      (styles["@starting-style"] as any)["&"].transform += " translateX(-50%)";
    }
    if (harmonize) {
      if (
        (variant === "soft" || variant === "solid") &&
        color !== "harmonize"
      ) {
        return [styles, createHarmonizeVars(variant, color)];
      }
      // Handle the "outlined" case, "harmonize" color, or any other variants
      console.warn(
        `Inverting colors for "${variant}" variant or "harmonize" color is not supported.`,
      );
      return styles;
    }
    return styles;
  },
);

const startDecorator = createGatherSafeSlot("startDecorator", () => ({
  display: "inherit",
  flex: "none",
}));

const endDecorator = createGatherSafeSlot("endDecorator", () => ({
  display: "inherit",
  flex: "none",
  marginLeft: "auto",
}));

/**
 Snackbar component for displaying brief messages to users.

 Snackbars inform users of a process that an app has performed or will perform.
 They appear temporarily, towards the bottom of the screen.

 @category UI Component

 @param props.size
 @param props.color
 @param props.variant
 @param props.anchorOrigin The anchor origin of the snackbar. An object with 'vertical' and 'horizontal' properties.
 @param props.harmonize Whether to harmonize the colors of the snackbar with the background.
 @param props.startDecorator
 @param props.endDecorator
 @param props.children

 @examples
 [Example](../blocks/auth/users.tsx)
*/
export const Snackbar: OverridableComponent<{
  defaultComponent: "div";
  props: SnackbarProps;
}> = (props: SnackbarProps) => {
  const {
    size = "md",
    color = "primary",
    variant = "soft",
    anchorOrigin = { vertical: "bottom", horizontal: "left" },
    harmonize = false,
    startDecorator: startDecoratorProp,
    endDecorator: endDecoratorProp,
    startIcon,
    endIcon,
    ...other
  } = props;
  const ownerState: OwnerState = {
    size,
    color,
    variant: variant as Variant, // Cast to Variant type
    anchorOrigin,
    harmonize,
  };
  const [RootSlot, rootProps] = root({
    component: "div",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  const [StartDecoratorSlot, startDecoratorProps] = startDecorator({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [EndDecoratorSlot, endDecoratorProps] = endDecorator({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  if (harmonize) {
    addCtx(new HarmonizeCtx(variant, color));
  }
  const resolvedStartDecorator = startIcon
    ? <MaterialIcon icon={startIcon} />
    : startDecoratorProp;
  const resolvedEndDecorator = endIcon
    ? <MaterialIcon icon={endIcon} />
    : endDecoratorProp;
  return (
    <RootSlot {...rootProps}>
      {resolvedStartDecorator && (
        <StartDecoratorSlot {...startDecoratorProps}>
          {resolvedStartDecorator}
        </StartDecoratorSlot>
      )}
      {props.children}
      {resolvedEndDecorator && (
        <EndDecoratorSlot {...endDecoratorProps}>
          {resolvedEndDecorator}
        </EndDecoratorSlot>
      )}
    </RootSlot>
  );
};
