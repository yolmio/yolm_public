import { useDefaultColor } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import type { Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot, getUniqueUiId } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

interface TooltipBaseProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      arrow: "span";
    }> {
  anchorEl: Sql | string;
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
  children: Node;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
}

const rootSlot = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { size, variant, color } = ownerState;
    const variantStyle = getVariantStyle(variant, color);
    const styles: StyleObject = {
      zIndex: 100,
      borderRadius: cssVar("radius-xs"),
      boxShadow: cssVar("shadow-sm"),
      fontFamily: cssVar("font-family-body"),
      fontWeight: cssVar("font-weight-medium"),
      lineHeight: cssVar("leading-snug"),
      wordWrap: "break-word",
      position: "fixed",
      margin: 0,
      border: "none",
      overflow: "hidden",
      ...variantStyle,
      ...((variant === "plain" || variant === "outlined") && {
        backgroundColor: cssVar("palette-background-surface"),
      }),
      "&::before": {
        content: '""',
        display: "block",
        position: "absolute",
      },
      '&[data-floating-placement*="bottom"]::before': {
        top: 0,
        left: 0,
        transform: "translateY(-100%)",
        height: "calc(11px + var(--variant-border-width, 0px))",
        width: "100%",
      },
      '&[data-floating-placement*="left"]::before': {
        top: 0,
        right: 0,
        transform: "translateX(100%)",
        width: "calc(11px + var(--variant-border-width, 0px))",
        height: "100%",
      },
      '&[data-floating-placement*="right"]::before': {
        top: 0,
        left: 0,
        transform: "translateX(-100%)",
        width: "calc(11px + var(--variant-border-width, 0px))",
        height: "100%",
      },
      '&[data-floating-placement*="top"]::before': {
        bottom: 0,
        left: 0,
        transform: "translateY(100%)",
        height: "calc(11px + var(--variant-border-width, 0px))",
        width: "100%",
      },
    };

    switch (size) {
      case "xs":
        Object.assign(styles, {
          "--icon-font-size": "0.875rem",
          "--tooltip-arrow-size": "7px",
          py: 0.75,
          px: 1,
          fontSize: cssVar("text-xs"),
        });
        break;
      case "sm":
        Object.assign(styles, {
          "--icon-font-size": "1rem",
          "--tooltip-arrow-size": "8px",
          py: 1,
          px: 1.25,
          fontSize: cssVar("text-xs"),
        });
        break;
      case "md":
        Object.assign(styles, {
          "--icon-font-size": "1.125rem",
          "--tooltip-arrow-size": "10px",
          py: 1.25,
          px: 1.5,
          fontSize: cssVar("text-sm"),
        });
        break;
      case "lg":
        Object.assign(styles, {
          "--icon-font-size": "1.25rem",
          "--tooltip-arrow-size": "12px",
          py: 1.5,
          px: 2,
          fontSize: cssVar("text-base"),
        });
        break;
    }

    return styles;
  },
);

const arrowSlot = createGatherSafeSlot(
  "arrow",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { variant, color } = ownerState;
    const variantStyle = getVariantStyle(variant, color);
    return {
      "--tooltip-arrow-rotation": 0,
      width: "var(--tooltip-arrow-size)",
      height: "var(--tooltip-arrow-size)",
      boxSizing: "border-box",
      position: "absolute",
      "&:before": {
        content: '""',
        display: "block",
        position: "absolute",
        width: 0,
        height: 0,
        border: "calc(var(--tooltip-arrow-size) / 2) solid",
        borderLeftColor: "transparent",
        borderBottomColor: "transparent",
        borderTopColor: variant === "outlined" || variant === "plain"
          ? cssVar("palette-background-surface")
          : (variantStyle as any).backgroundColor,
        borderRightColor: variant === "outlined" || variant === "plain"
          ? cssVar("palette-background-surface")
          : (variantStyle as any).backgroundColor,
        borderRadius: "0px 2px 0px 0px",
        boxShadow: variant === "outlined"
          ? `var(--variant-border-width, 0px) calc(-1 * var(--variant-border-width, 0px)) 0px 0px ${
            (variantStyle as any).borderColor
          }`
          : undefined,
        transformOrigin: "center center",
        transform:
          "rotate(calc(-45deg + 90deg * var(--tooltip-arrow-rotation)))",
      },
      '[data-floating-placement*="bottom"] &': {
        top: "calc(0.5px + var(--tooltip-arrow-size) * -1 / 2)",
      },
      '[data-floating-placement*="top"] &': {
        "--tooltip-arrow-rotation": 2,
        bottom: "calc(0.5px + var(--tooltip-arrow-size) * -1 / 2)",
      },
      '[data-floating-placement*="left"] &': {
        "--tooltip-arrow-rotation": 1,
        right: "calc(0.5px + var(--tooltip-arrow-size) * -1 / 2)",
      },
      '[data-floating-placement*="right"] &': {
        "--tooltip-arrow-rotation": 3,
        left: "calc(0.5px + var(--tooltip-arrow-size) * -1 / 2)",
      },
    };
  },
);

export type TooltipProps = TooltipBaseProps & JSX.IntrinsicElements["span"];

export const Tooltip: OverridableComponent<{
  defaultComponent: "span";
  props: TooltipBaseProps;
}> = (props: TooltipProps) => {
  const {
    variant = "solid",
    color = useDefaultColor("neutral"),
    size = "md",
    anchorEl,
    placement = sql.lit`bottom`,
    children,
    ...other
  } = props;

  const ownerState: OwnerState = {
    size,
    variant,
    color,
  };

  const [RootSlot, rootProps] = rootSlot({
    component: "div",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });

  const [ArrowSlot, arrowProps] = arrowSlot({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });

  const arrowId = sql.lit(getUniqueUiId());

  return (
    <RootSlot
      {...rootProps}
      role="tooltip"
      popover={sql.lit`auto`}
      yolmPopoverShowing
      floating={{
        anchorEl: typeof anchorEl === "string" ? sql.lit(anchorEl) : anchorEl,
        placement,
        strategy: sql.lit`fixed`,
        offset: {
          mainAxis: 10,
          crossAxis: 0,
        },
        arrow: {
          elementId: arrowId,
        },
      }}
    >
      {children}
      <ArrowSlot {...arrowProps} id={arrowId} />
    </RootSlot>
  );
};
