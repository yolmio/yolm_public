import { sql } from "../std/sql_utils";
import type { NumericExpr } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import type { Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { createSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { OverridableComponent } from "./utils";

interface CircularProgressBaseProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      svg: "svg";
      track: "track";
      progress: "progress";
    }> {
  determinate?: boolean;
  value?: NumericExpr;

  children?: Node;
}

interface OwnerState {
  hasChildren: boolean;
  size: Size | undefined;
  variant: Variant;
  color: Color;
  determinate: boolean;
}

const defaultCircularProgressSizeStyle: StyleObject = {
  "--circular-progress-track-thickness":
    "var(--circular-progress-thickness, 6px)",
  "--circular-progress-progress-thickness":
    "var(--circular-progress-thickness, 6px)",
  "--_root-size": "var(--circular-progress-size, 40px)",
};

const circularProgressSizeStyleBySize: Record<Size, StyleObject> = {
  xs: {
    "--circular-progress-track-thickness":
      "var(--circular-progress-thickness, 2px)",
    "--circular-progress-progress-thickness":
      "var(--circular-progress-thickness, 2px)",
    "--_root-size": "var(--circular-progress-size, 16px)",
    "--circular-progress-size": "16px",
  },
  sm: {
    "--circular-progress-track-thickness":
      "var(--circular-progress-thickness, 3px)",
    "--circular-progress-progress-thickness":
      "var(--circular-progress-thickness, 3px)",
    "--_root-size": "var(--circular-progress-size, 24px)", // use --_root-size to let other components overrides via --circular-progress-size
    "--circular-progress-size": "24px",
  },
  md: {
    ...defaultCircularProgressSizeStyle,
    "--circular-progress-size": "40px",
  },
  lg: {
    "--circular-progress-track-thickness":
      "var(--circular-progress-thickness, 8px)",
    "--circular-progress-progress-thickness":
      "var(--circular-progress-thickness, 8px)",
    "--_root-size": "var(--circular-progress-size, 64px)",
    "--circular-progress-size": "64px",
  },
};

const root = createSlot(
  "root",
  (
    _,
    {
      ownerState: { variant, color: propColor, size, hasChildren },
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { color, backgroundColor, ...rest } = getVariantStyle(
      variant,
      propColor,
    ) as any;
    return {
      // integration with icon
      "--icon-font-size": "calc(0.4 * var(--_root-size))",
      // public variables
      "--circular-progress-percent": "25",
      "--circular-progress-track-color": backgroundColor,
      "--circular-progress-progress-color": color,
      "--circular-progress-linecap": "round",
      ...(size === undefined
        ? defaultCircularProgressSizeStyle
        : circularProgressSizeStyleBySize[size]),
      // internal variables
      "--_thickness-diff":
        "calc(var(--circular-progress-track-thickness) - var(--circular-progress-progress-thickness))",
      "--_inner-size":
        "calc(var(--_root-size) - 2 * var(--variant-border-width, 0px))",
      "--_outlined-inset":
        "max(var(--circular-progress-track-thickness), var(--circular-progress-progress-thickness))",
      width: "var(--_root-size)",
      height: "var(--_root-size)",
      borderRadius: "var(--_root-size)",
      margin: "var(--circular-progress-margin)",
      boxSizing: "border-box",
      display: "inline-flex",
      justifyContent: "center",
      alignItems: "center",
      flexShrink: 0, // prevent from shrinking when CircularProgress is in a flex container.
      position: "relative",
      color,
      ...(hasChildren && {
        // only add font related properties when there is a child.
        // so that when there is no child, the size can be controlled by the parent font-size e.g. Link
        fontFamily: cssVar("font-family-body"),
        fontWeight: cssVar("font-weight-medium"),
        fontSize: "calc(0.2 * var(--_root-size))",
      }),
      ...rest,
      ...(variant === "outlined" && {
        "&:before": {
          content: '""',
          display: "block",
          position: "absolute",
          borderRadius: "inherit",
          top: "var(--_outlined-inset)",
          left: "var(--_outlined-inset)",
          right: "var(--_outlined-inset)",
          bottom: "var(--_outlined-inset)",
          ...rest,
        },
      }),
    };
  },
);

const svg = createSlot("svg", () => ({
  width: "inherit",
  height: "inherit",
  display: "inherit",
  boxSizing: "inherit",
  position: "absolute",
  top: "calc(-1 * var(--variant-border-width, 0px))", // centered align
  left: "calc(-1 * var(--variant-border-width, 0px))", // centered align
}));

const track = createSlot("track", () => ({
  cx: "50%",
  cy: "50%",
  r: "calc(var(--_inner-size) / 2 - var(--circular-progress-track-thickness) / 2 + min(0px, var(--_thickness-diff) / 2))",
  fill: "transparent",
  strokeWidth: "var(--circular-progress-track-thickness)",
  stroke: "var(--circular-progress-track-color)",
}));

const progress = createSlot(
  "progress",
  (
    app,
    {
      ownerState: { determinate },
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const styles: StyleObject = {
      "--_progress-radius":
        "calc(var(--_inner-size) / 2 - var(--circular-progress-progress-thickness) / 2 - max(0px, var(--_thickness-diff) / 2))",
      "--_progress-length": "calc(2 * 3.1415926535 * var(--_progress-radius))", // the circumference around the progress
      cx: "50%",
      cy: "50%",
      r: "var(--_progress-radius)",
      fill: "transparent",
      strokeWidth: "var(--circular-progress-progress-thickness)",
      stroke: "var(--circular-progress-progress-color)",
      strokeLinecap: "var(--circular-progress-linecap, round)" as "round", // can't use CSS variable directly, need to cast type.
      strokeDasharray: "var(--_progress-length)",
      strokeDashoffset:
        "calc(var(--_progress-length) - var(--circular-progress-percent) * var(--_progress-length) / 100)",
      transformOrigin: "center",
      transform: "rotate(-90deg)", // to initially appear at the top-center of the circle.
    };
    if (determinate) {
      styles.transition =
        "stroke-dashoffset 300ms cubic-bezier(0.4, 0, 0.2, 1) 0ms";
    } else {
      const circulate = app.registerKeyframes({
        "0%": {
          // let the progress start at the top of the ring
          transform: "rotate(-90deg)",
        },
        "100%": {
          transform: "rotate(270deg)",
        },
      });
      styles.animation = `var(
        --circular-progress-circulation,
        0.8s linear 0s infinite normal none running
    ) ${circulate}`;
    }
    return styles;
  },
);

/**
 A customizable circular progress component for displaying loading or progress states.

 @category UI Component

 @param props.children
 @param props.color
 @param props.variant
 @param props.size
 @param props.determinate - Whether the progress is determinate (with a specific value) or indeterminate. Defaults to false.
 @param props.value - The current progress value for determinate progress.

 @examples
 [Example](../table_blocks/attachments/attachments_card.tsx)

 */
export const CircularProgress: OverridableComponent<{
  defaultComponent: "span";
  props: CircularProgressBaseProps;
}> = (props: CircularProgressBaseProps) => {
  const {
    children,
    color = "primary",
    variant = "soft",
    size,
    determinate = false,
    value,
    ...rest
  } = props;
  const ownerState: OwnerState = {
    color,
    size,
    variant,
    determinate,
    hasChildren: Boolean(children),
  };
  const [RootSlot, rootProps] = root({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
    externalProps: rest,
    internalProps: {
      role: "progressbar",
      "aria-valuenow": determinate ? sql`round(${value ?? 0})` : undefined,
      style: determinate
        ? { "--circular-progress-percent": sql`${value ?? 0}` }
        : undefined,
    },
  });
  const [SvgSlot, svgProps] = svg({
    component: "svg",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [TrackSlot, trackProps] = track({
    component: "circle",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [ProgressSlot, progressProps] = progress({
    component: "circle",
    rootProps: props,
    slotProps: { ownerState },
  });
  return (
    <RootSlot {...rootProps}>
      <SvgSlot {...svgProps}>
        <TrackSlot {...trackProps} />
        <ProgressSlot {...progressProps} />
      </SvgSlot>
      {children}
    </RootSlot>
  );
};
