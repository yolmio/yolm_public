import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Node } from "std/ui";
import type { Color, ComponentOpts, Size, Variant } from "./types";
import type { Sql } from "../std/sql_utils";
import { createGatherSafeSlot } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

interface RadioGroupProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
    }> {
  orientation?: "horizontal" | "vertical";
  role?: Sql;
  children: Node;
}

interface OwnerState {
  variant: Variant;
  color: Color;
  size: Size;
  orientation: "horizontal" | "vertical";
}

const radioGroupGapBySize: Record<Size, string> = {
  xs: "0.5rem",
  sm: "0.625rem",
  md: "0.875rem",
  lg: "1.25rem",
};

const root = createGatherSafeSlot(
  "root",
  (_, { ownerState }: { ownerState: OwnerState }) => {
    const { variant, color, size, orientation } = ownerState;
    const styles: StyleObject = {
      "--radio-group-gap": radioGroupGapBySize[size],
      gap: "var(--radio-group-gap)",
      display: "flex",
      margin: "var(--unstable-radio-group-margin)",
      flexDirection: orientation === "horizontal" ? "row" : "column",
      borderRadius: cssVar("radius-sm"),
      ...getVariantStyle(variant, color),
    };
    return styles;
  },
);

/**
 A component for grouping radio buttons.

 This component creates a container for radio buttons, allowing them to be grouped together
 and function as a single form control. It handles the layout and styling of the radio buttons
 within the group.

 @category UI Component

 @param props.size
 @param props.color
 @param props.variant
 @param props.orientation The layout orientation of the radio buttons (horizontal or vertical)
 @param props.role The ARIA role of the radio group
 @param props.children The radio button components to be rendered within the group

 @examples
 [Example](../blocks/scheduling/integrations.tsx)
 */
export const RadioGroup: OverridableComponent<{
  defaultComponent: "div";
  props: RadioGroupProps;
}> = (props: RadioGroupProps) => {
  const {
    size = "md",
    color = "neutral",
    variant = "plain",
    orientation = "vertical",
    role = "radiogroup",
    children,
    ...other
  } = props;

  const ownerState: OwnerState = {
    size,
    color,
    variant,
    orientation,
  };

  const [RootSlot, rootProps] = root({
    component: "div",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });

  return (
    <RootSlot {...rootProps} role={role}>
      {children}
    </RootSlot>
  );
};
