import { HarmonizeCtx } from "std/ictx";
import type { StyleObject } from "std/style_types";
import {
  createHarmonizeVars,
  createStyles,
  cssVar,
  getVariantStyle,
} from "std/style_utils";
import type { Variant } from "std/theme";
import { addCtx } from "std/ui";
import type { Node } from "std/ui";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { OverridableComponent } from "./utils";

/** Props for {@link Alert}. */
export interface AlertProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      startDecorator: "span";
      endDecorator: "span";
    }> {
  startDecorator?: Node;
  endDecorator?: Node;
  children: Node;
  /** Material icon rendered before the content. Mutually exclusive with `startDecorator`. */
  startIcon?: IconName;
  /** Material icon rendered after the content. Mutually exclusive with `endDecorator`. */
  endIcon?: IconName;
  /**
   * When `true` (with a `soft`/`solid` variant), recolors descendant
   * components to harmonize with the alert's background instead of using
   * their own palette. Defaults to `false`.
   */
  harmonize?: boolean;
}

interface OwnerState {
  variant: Variant;
  color: Color;
  size: Size;
  harmonize: boolean;
}

const alertSizeStyleBySize: Record<Size, StyleObject> = {
  xs: {
    "--alert-padding": "0.375rem",
    "--alert-gap": "0.25rem",
    "--alert-decorator-child-height": "1.25rem",
    "--icon-font-size": "1rem",
    fontSize: cssVar("text-xs"),
  },
  sm: {
    "--alert-padding": "0.5rem",
    "--alert-gap": "0.375rem",
    "--alert-decorator-child-height": "1.5rem",
    "--icon-font-size": "1.125rem",
    fontSize: cssVar("text-sm"),
  },
  md: {
    "--alert-padding": "0.75rem",
    "--alert-gap": "0.5rem",
    "--alert-decorator-child-height": "2rem",
    "--icon-font-size": "1.25rem",
    fontSize: cssVar("text-sm"),
    fontWeight: cssVar("font-weight-medium"),
  },
  lg: {
    "--alert-padding": "1rem",
    "--alert-gap": "0.75rem",
    "--alert-decorator-child-height": "2.375rem",
    "--icon-font-size": "1.5rem",
    fontSize: cssVar("text-base"),
    fontWeight: cssVar("font-weight-medium"),
  },
};

const styles = createStyles({
  root: (_, variant: Variant, color: Color, size: Size, harmonize: boolean) => {
    const styles: StyleObject = {
      "--alert-radius": cssVar("radius-sm"),
      "--alert-decorator-child-radius":
        "max((var(--alert-radius) - var(--variant-border-width, 0px)) - var(--alert-padding), min(var(--alert-padding) + var(--variant-border-width, 0px), var(--alert-radius) / 2))",
      "--button-min-height": "var(--alert-decorator-child-height)",
      "--icon-button-size": "var(--alert-decorator-child-height)",
      "--button-radius": "var(--alert-decorator-child-radius)",
      "--icon-button-radius": "var(--alert-decorator-child-radius)",
      ...alertSizeStyleBySize[size],
      fontFamily: cssVar("font-family-body"),
      lineHeight: cssVar("text-base--line-height"),
      backgroundColor: "transparent",
      display: "flex",
      alignItems: "center",
      padding: "var(--alert-padding)",
      borderRadius: "var(--alert-radius)",
      ...getVariantStyle(variant, color),
    };
    if (
      (variant === "soft" || variant === "solid") &&
      harmonize &&
      color !== "harmonize"
    ) {
      Object.assign(styles, createHarmonizeVars(variant, color));
    }
    return styles;
  },
  startDecorator: (_, color: Color, variant: Variant) => ({
    display: "inherit",
    flex: "none",
    marginRight: "var(--alert-gap)",
    ...(color !== "harmonize" && {
      color: cssVar(`palette-${color}-${variant}-color`),
    }),
  }),
  endDecorator: (_, color: Color, variant: Variant) => ({
    display: "inherit",
    flex: "none",
    marginLeft: "var(--alert-gap)",
    ...(color !== "harmonize" && {
      color: cssVar(`palette-${color}-${variant}-color`),
    }),
  }),
});

const root = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) =>
    styles.root(
      ownerState.variant,
      ownerState.color,
      ownerState.size,
      ownerState.harmonize,
    ),
);

const startDecoratorSlot = createGatherSafeSlot(
  "startDecorator",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => styles.startDecorator(ownerState.color, ownerState.variant),
);

const endDecoratorSlot = createGatherSafeSlot(
  "endDecorator",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => styles.endDecorator(ownerState.color, ownerState.variant),
);

/**
 A component that displays an alert message with customizable styles and decorators.
 @category UI Component
 @examples
[Example](../../examples/todos/apps/demo.yolmstaging.net.tsx)

 */
export const Alert: OverridableComponent<{
  defaultComponent: "div";
  props: AlertProps;
}> = (props: AlertProps) => {
  const {
    color = "primary",
    variant = "soft",
    size = "md",
    startDecorator,
    endDecorator,
    children,
    startIcon,
    endIcon,
    harmonize = false,
    ...other
  } = props;
  const ownerState: OwnerState = {
    color,
    variant,
    size,
    harmonize,
  };
  const [RootSlot, rootProps] = root({
    component: "div",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  const [StartDecoratorSlot, startDecoratorProps] = startDecoratorSlot({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [EndDecoratorSlot, endDecoratorProps] = endDecoratorSlot({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  if (startIcon && startDecorator) {
    throw new Error("Cannot have both startIcon and startDecorator");
  }
  if (endIcon && endDecorator) {
    throw new Error("Cannot have both endIcon and endDecorator");
  }
  if (harmonize) {
    addCtx(new HarmonizeCtx(variant, color));
  }
  const resolvedStartDecorator = startIcon
    ? <MaterialIcon icon={startIcon} />
    : startDecorator;
  const resolvedEndDecorator = endIcon
    ? <MaterialIcon icon={endIcon} />
    : endDecorator;
  return (
    <RootSlot {...rootProps}>
      {resolvedStartDecorator && (
        <StartDecoratorSlot {...startDecoratorProps}>
          {resolvedStartDecorator}
        </StartDecoratorSlot>
      )}
      {children}
      {resolvedEndDecorator && (
        <EndDecoratorSlot {...endDecoratorProps}>
          {resolvedEndDecorator}
        </EndDecoratorSlot>
      )}
    </RootSlot>
  );
};
