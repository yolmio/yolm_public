import { useDefaultColor } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { BooleanExpr } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import type { DynamicClass, Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

// Stepper component
export interface StepperProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "ol";
    }> {
  orientation?: "horizontal" | "vertical";
  children: Node;
}

interface StepperOwnerState {
  size: Size;
  orientation: "horizontal" | "vertical";
}

const stepperRoot = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: StepperOwnerState;
    },
  ) => {
    const { size, orientation } = ownerState;
    const styles: StyleObject = {
      "--stepper-indicator-column": "auto",
      "--step-connector-thickness": "1px",
      "--step-indicator-dot-size": "0.375rem",
      boxSizing: "border-box",
      display: "flex",
      margin: 0,
      padding: 0,
    };

    switch (size) {
      case "xs":
        Object.assign(styles, {
          "--stepper-vertical-gap": "0.375rem",
          "--step-gap": "0.25rem",
          "--step-connector-inset": "0.1875rem",
          "--step-indicator-size": "1rem",
          fontSize: cssVar("text-xs"),
          fontWeight: cssVar("font-weight-medium"),
        });
        break;
      case "sm":
        Object.assign(styles, {
          "--stepper-vertical-gap": "0.5rem",
          "--step-gap": "0.375rem",
          "--step-connector-inset": "0.25rem",
          "--step-indicator-size": "1.25rem",
          fontSize: cssVar("text-sm"),
          fontWeight: cssVar("font-weight-medium"),
        });
        break;
      case "md":
        Object.assign(styles, {
          "--stepper-vertical-gap": "0.75rem",
          "--step-gap": "0.5rem",
          "--step-connector-inset": "0.375rem",
          "--step-indicator-size": "1.5rem",
          fontSize: cssVar("text-base"),
          fontWeight: cssVar("font-weight-medium"),
        });
        break;
      case "lg":
        Object.assign(styles, {
          "--stepper-vertical-gap": "0.75rem",
          "--step-gap": "0.5rem",
          "--step-connector-inset": "0.5rem",
          "--step-indicator-size": "1.75rem",
          fontSize: cssVar("text-lg"),
          fontWeight: cssVar("font-weight-medium"),
        });
        break;
    }

    if (orientation === "vertical") {
      Object.assign(styles, {
        flexDirection: "column",
        gap: "var(--stepper-vertical-gap)",
      });
    }

    return styles;
  },
);

/**
 Stepper component for displaying a sequence of steps.

 This component creates a stepper that can be used to guide users through a multi-step process.
 It supports both horizontal and vertical orientations and can be customized in size.

 @category UI Component

 @param props.size
 @param props.orientation The orientation of the stepper. Can be 'horizontal' or 'vertical'.
 @param props.children The step components to be rendered within the stepper.

 @examples
 [Example](../pages/bulk_merge_import.tsx)
*/
export const Stepper: OverridableComponent<{
  defaultComponent: "ol";
  props: StepperProps;
}> = (props: StepperProps) => {
  const { size = "md", orientation = "horizontal", ...other } = props;
  const ownerState: StepperOwnerState = { size, orientation };
  const [RootSlot, rootProps] = stepperRoot({
    component: "ol",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  return <RootSlot {...rootProps}>{props.children}</RootSlot>;
};

export interface StepProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "li";
      indicator: "div";
    }> {
  active?: BooleanExpr;
  activeLineColor?: Color;
  dotted?: boolean;
  completed?: BooleanExpr;
  disabled?: BooleanExpr;
  orientation?: "horizontal" | "vertical";
  indicator?: Node;
  children: Node;
}

interface StepOwnerState {
  orientation: "horizontal" | "vertical";
  dotted: boolean;
  activeLineColor?: Color;
}

const stepRoot = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: StepOwnerState;
    },
  ) => {
    const { orientation, dotted, activeLineColor } = ownerState;
    const styles: StyleObject = {
      position: "relative",
      display: "flex",
      gridTemplateColumns: "var(--stepper-indicator-column) 1fr",
      gridAutoFlow: "dense",
      flex: "var(--step-flex)",
      flexDirection: "row",
      alignItems: "var(--step-align-items, center)",
      justifyContent: "var(--step-justify, center)",
      gap: "var(--step-gap)",
      "&::after": {
        content: '""',
        display: "block",
        borderRadius: "var(--step-connector-radius)",
        height: "var(--step-connector-thickness)",
        background: `var(--step-connector-bg, ${cssVar("palette-divider")})`,
        flex: 1,
        marginInlineStart:
          "calc(var(--step-connector-inset) - var(--step-gap))",
        marginInlineEnd: "var(--step-connector-inset)",
        zIndex: 0,
      },
      ...(activeLineColor && {
        "&.active::after": {
          backgroundColor: (getVariantStyle("solid", activeLineColor) as any)
            .backgroundColor,
        },
      }),
      ...(activeLineColor &&
        dotted && {
        "&.active:not(:has(~ .active))::after": {
          color: (getVariantStyle("solid", activeLineColor) as any)
            .backgroundColor,
          backgroundColor: "transparent",
          backgroundImage: "radial-gradient(currentColor 2px, transparent 2px)",
          backgroundSize: "7px 7px",
          backgroundPosition: "center left",
        },
      }),
      "&:not(:last-child)": {
        "--step-flex": "auto",
      },
      "&:last-child::after": {
        display: "none",
      },
      ...(orientation === "vertical" && {
        flexDirection: "column",
        "&::after": {
          width: "var(--step-connector-thickness)",
          height: "auto",
          margin:
            "calc(var(--step-connector-inset) - var(--step-gap)) auto calc(var(--step-connector-inset) - var(--stepper-vertical-gap))",
          alignSelf: "stretch",
        },
      }),
    };

    if (activeLineColor) {
      styles["&.active::after"] = {
        backgroundColor: (getVariantStyle("solid", activeLineColor) as any)
          .backgroundColor,
      };
    }

    if (activeLineColor && dotted) {
      styles["&.active:not(:has(~ .active))::after"] = {
        color: (getVariantStyle("solid", activeLineColor) as any)
          .backgroundColor,
        backgroundColor: "transparent",
        backgroundImage: "radial-gradient(currentColor 2px, transparent 2px)",
        backgroundSize: "7px 7px",
        backgroundPosition: "center left",
      };
    }

    if (orientation === "vertical") {
      Object.assign(styles, {
        flexDirection: "column",
        "&::after": {
          width: "var(--step-connector-thickness)",
          height: "auto",
          margin:
            "calc(var(--step-connector-inset) - var(--step-gap)) auto calc(var(--step-connector-inset) - var(--stepper-vertical-gap))",
          alignSelf: "stretch",
        },
      });
    }

    return styles;
  },
);

const stepIndicator = createGatherSafeSlot("indicator", () => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  placeSelf: "center",
  width: "var(--step-indicator-size)",
  height: "var(--step-indicator-size)",
}));

export const Step: OverridableComponent<{
  defaultComponent: "li";
  props: StepProps;
}> = (props: StepProps) => {
  const {
    orientation = "horizontal",
    dotted = false,
    activeLineColor,
    active,
    completed,
    disabled,
    indicator,
    ...other
  } = props;
  const ownerState: StepOwnerState = { orientation, dotted, activeLineColor };
  const [RootSlot, rootProps] = stepRoot({
    component: "li",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  const [IndicatorSlot, indicatorProps] = stepIndicator({
    component: "div",
    rootProps: props,
    slotProps: { ownerState },
  });

  const dynamicClasses: DynamicClass[] = [];
  if (active) {
    dynamicClasses.push({ classes: "active", condition: active });
  }
  if (completed) {
    dynamicClasses.push({ classes: "completed", condition: completed });
  }
  if (disabled) {
    dynamicClasses.push({ classes: "disabled", condition: disabled });
  }

  return (
    <RootSlot {...rootProps} dynamicClasses={dynamicClasses}>
      <IndicatorSlot {...indicatorProps}>{indicator}</IndicatorSlot>
      {props.children}
    </RootSlot>
  );
};

export interface StepButtonProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "button";
    }> {
  children: Node;
}

const stepButtonRoot = createGatherSafeSlot("root", (app) => ({
  WebkitTapHighlightColor: "transparent",
  boxSizing: "border-box",
  border: "none",
  backgroundColor: "transparent",
  cursor: "pointer",
  position: "relative",
  padding: 0,
  textDecoration: "none",
  font: "inherit",
  display: "inline-flex",
  flexDirection: "inherit",
  alignItems: "var(--step-button-align-items, inherit)",
  alignSelf: "var(--step-button-align-self)",
  gap: "var(--step-button-gap)",
  "&:focus-visible": app.theme.focus.default,
  "&::before": {
    content: '""',
    display: "block",
    position: "absolute",
    top: "var(--step-button-top, 0)",
    right: 0,
    bottom: 0,
    left: "var(--step-button-left, 0)",
  },
}));

export const StepButton: OverridableComponent<{
  defaultComponent: "button";
  props: StepButtonProps;
}> = (props: StepButtonProps) => {
  const [RootSlot, rootProps] = stepButtonRoot({
    component: "button",
    rootProps: props,
    externalProps: { type: sql.lit`button` },
    slotProps: {}, // Add this line
  });
  return <RootSlot {...rootProps}>{props.children}</RootSlot>;
};

export interface StepIndicatorProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
    }> {
  color?: Color;
  variant?: Variant;
  activeColor?: Color;
  activeVariant?: Variant;
  children: Node;
}

interface StepIndicatorOwnerState {
  color: Color;
  variant: Variant;
  activeColor?: Color;
  activeVariant?: Variant | undefined;
}

const stepIndicatorRoot = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: StepIndicatorOwnerState;
    },
  ) => {
    const { color, variant, activeColor, activeVariant } = ownerState;
    const styles: StyleObject = {
      "--icon-font-size": "calc(var(--step-indicator-size, 2rem) / 2)",
      "--icon-color": "currentColor",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      font: "inherit",
      borderRadius: "50%",
      width: "var(--step-indicator-size, 1.5rem)",
      height: "var(--step-indicator-size, 1.5rem)",

      ...(activeColor || activeVariant
        ? {
          ".active &": getVariantStyle(
            activeVariant ?? variant,
            activeColor ?? color,
          ),
        }
        : {}),
      ...getVariantStyle(variant, color),
    };

    return styles;
  },
);

export const StepIndicator: OverridableComponent<{
  defaultComponent: "div";
  props: StepIndicatorProps;
}> = (props: StepIndicatorProps) => {
  const {
    color = useDefaultColor("neutral"),
    variant = "soft",
    activeColor,
    activeVariant,
    ...other
  } = props;
  const ownerState: StepIndicatorOwnerState = {
    color,
    variant,
    activeColor,
    activeVariant,
  };
  const [RootSlot, rootProps] = stepIndicatorRoot({
    component: "div",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  return <RootSlot {...rootProps}>{props.children}</RootSlot>;
};
