import type { BooleanExpr } from "../std/sql_utils";
import { sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { VariantState } from "std/style_utils";
import type { Variant } from "std/theme";
import type { DynamicClass, Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { OverridableComponent } from "./utils";

export interface SwitchProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "span";
      track: "span";
      thumb: "span";
      action: "span";
      input: "input";
      startDecorator: "span";
      endDecorator: "span";
    }> {
  checked?: BooleanExpr;
  disabled?: BooleanExpr;
  startDecorator?: Node;
  endDecorator?: Node;
  bindScalar?: string;
  bindRecordField?: string;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
}

const switchSizeStyleBySize: Record<Size, StyleObject> = {
  xs: {
    "--switch-thumb-size": "8px",
    "--switch-track-height": "14px",
    "--switch-track-width": "22px",
    fontSize: cssVar("text-xs"),
    gap: "var(--switch-gap, 4px)",
  },
  sm: {
    "--switch-thumb-size": "10px",
    "--switch-track-height": "16px",
    "--switch-track-width": "26px",
    fontSize: cssVar("text-sm"),
    gap: "var(--switch-gap, 6px)",
  },
  md: {
    "--switch-thumb-size": "14px",
    "--switch-track-height": "20px",
    "--switch-track-width": "32px",
    fontSize: cssVar("text-base"),
    gap: "var(--switch-gap, 8px)",
  },
  lg: {
    "--switch-thumb-size": "18px",
    "--switch-track-height": "24px",
    "--switch-track-width": "40px",
    fontSize: cssVar("text-lg"),
    gap: "var(--switch-gap, 12px)",
  },
};

const switchTrackFontSizeBySize: Record<Size, string> = {
  xs: cssVar("text-xs"),
  sm: cssVar("text-xs"),
  md: cssVar("text-sm"),
  lg: cssVar("text-base"),
};

const root = createGatherSafeSlot(
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
    function getColorVars(color: Color, state?: VariantState) {
      const styles = getVariantStyle(variant, color, state) as any;
      return {
        "--switch-track-background": styles.backgroundColor,
        "--switch-track-color": styles.color,
        "--switch-track-border-color": variant === "outlined"
          ? styles.borderColor
          : "currentColor",
        "--switch-thumb-background": styles.color,
        "--switch-thumb-color": styles.backgroundColor,
      };
    }
    const styles: StyleObject = {
      "--switch-track-radius": cssVar("radius-xl"),
      "--switch-thumb-shadow": variant === "soft"
        ? "none"
        : "0 0 0 1px var(--switch-track-background)",
      "--padding-block":
        "max((var(--switch-track-height) - 2 * var(--variant-border-width, 0px) - var(--switch-thumb-size)) / 2, 0px)",
      "--switch-thumb-radius":
        "max(var(--switch-track-radius) - var(--padding-block), min(var(--padding-block) / 2, var(--switch-track-radius) / 2))",
      "--switch-thumb-width": "var(--switch-thumb-size)",
      "--switch-thumb-offset":
        "max((var(--switch-track-height) - var(--switch-thumb-size)) / 2, 0px)",
      "--icon-color": "currentColor",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      fontFamily: cssVar("font-family-body"),
      padding:
        "calc((var(--switch-thumb-size) / 2) - (var(--switch-track-height) / 2)) calc(-1 * var(--switch-thumb-offset))",
      backgroundColor: "initial",
      border: "none",
      ...getColorVars("neutral"),
      "&:hover": getColorVars("neutral", "hover"),
      "&.checked": {
        ...getColorVars(color),
        "&:hover": getColorVars(color, "hover"),
      },
    };

    Object.assign(styles, switchSizeStyleBySize[size]);

    return styles;
  },
);

const track = createGatherSafeSlot(
  "track",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    position: "relative",
    color: "var(--switch-track-color)",
    height: "var(--switch-track-height)",
    width: "var(--switch-track-width)",
    display: "flex",
    flexShrink: 0,
    justifyContent: "space-between",
    alignItems: "center",
    boxSizing: "border-box",
    border: "var(--variant-border-width, 0px) solid",
    borderColor: "var(--switch-track-border-color)",
    backgroundColor: "var(--switch-track-background)",
    borderRadius: "var(--switch-track-radius)",
    fontFamily: cssVar("font-family-body"),
    fontSize: switchTrackFontSizeBySize[ownerState.size],
  }),
);

const thumb = createGatherSafeSlot("thumb", () => ({
  "--icon-font-size": "calc(var(--switch-thumb-size) * 0.75)",
  display: "inline-flex",
  justifyContent: "center",
  alignItems: "center",
  position: "absolute",
  top: "50%",
  left:
    "calc(50% - var(--switch-track-width) / 2 + var(--switch-thumb-width) / 2 + var(--switch-thumb-offset))",
  transform: "translate(-50%, -50%)",
  width: "var(--switch-thumb-width)",
  height: "var(--switch-thumb-size)",
  borderRadius: "var(--switch-thumb-radius)",
  boxShadow: "var(--switch-thumb-shadow)",
  color: "var(--switch-thumb-color)",
  backgroundColor: "var(--switch-thumb-background)",
  "&.checked": {
    left:
      "calc(50% + var(--switch-track-width) / 2 - var(--switch-thumb-width) / 2 - var(--switch-thumb-offset))",
  },
}));

const action = createGatherSafeSlot("action", (app) => ({
  borderRadius: "var(--switch-track-radius)",
  position: "absolute",
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  "&:has(:focus-visible)": app.theme.focus.default,
}));

const input = createGatherSafeSlot("input", () => ({
  margin: 0,
  height: "100%",
  width: "100%",
  opacity: 0,
  position: "absolute",
  cursor: "pointer",
}));

const startDecoratorSlot = createGatherSafeSlot("startDecorator", () => ({
  display: "inline-flex",
}));

const endDecoratorSlot = createGatherSafeSlot("endDecorator", () => ({
  display: "inline-flex",
}));

/**
 A customizable switch control (checkbox like, but typically uses a visual toggle to switch between two states) component for boolean values.

 @category UI Component
 @param props.checked - Whether the switch is checked
 @param props.disabled - Whether the switch is disabled
 @param props.color - The color of the switch
 @param props.variant - The variant of the switch
 @param props.size - The size of the switch
 @param props.startDecorator - Content to be rendered before the switch
 @param props.endDecorator - Content to be rendered after the switch
 @param props.bindScalar - Bind the switch state to a scalar variable
 @param props.bindRecordField - Bind the switch state to a record field
 @param props.onCheckboxChange - Callback function when the switch state changes

 @examples
 [Example](../pages/datagrid_internals/bulk_update.tsx)
*/
export const SwitchControl: OverridableComponent<{
  defaultComponent: "input";
  props: SwitchProps;
}> = (props: SwitchProps & Omit<JSX.IntrinsicElements["input"], "size">) => {
  let {
    checked,
    disabled,
    color = "primary",
    variant = "solid",
    size = "md",
    startDecorator,
    endDecorator,
    bindScalar,
    bindRecordField,
    onCheckboxChange,
    ...other
  } = props;

  const ownerState: OwnerState = {
    color,
    variant,
    size,
  };

  if (bindScalar) {
    if (bindRecordField) {
      throw new Error("Cannot specify both bindScalar and bindRecordField");
    }
    if (onCheckboxChange) {
      throw new Error("Cannot specify both onCheckboxChange and bindScalar");
    }
    onCheckboxChange = (s: DomStatements) => {
      s.setScalar(bindScalar, sql`target_checked`);
    };
    checked = sql.ref(bindScalar);
  }

  if (bindRecordField) {
    const split = bindRecordField.split(".");
    if (split.length < 2) {
      throw new Error(
        "bindRecordField must be a record.field or ui.record.field",
      );
    }
    if (onCheckboxChange) {
      throw new Error(
        "Cannot specify both onCheckboxChange and bindRecordField",
      );
    }
    onCheckboxChange = (s: DomStatements) => {
      const record = sql.ref(...split.slice(0, -1));
      const field = sql.ref(split[split.length - 1]);
      s.modify(sql`update ${record} set ${field} = target_checked`);
    };
    checked = sql.ref(bindRecordField);
  }

  if (checked === undefined) {
    throw new Error("checked must be specified");
  }

  const dynamicClasses: DynamicClass[] = [
    { classes: "checked", condition: checked },
  ];

  const [RootSlot, rootProps] = root({
    component: "span",
    rootProps: props,
    internalProps: { dynamicClasses },
    slotProps: { ownerState },
  });

  const [TrackSlot, trackProps] = track({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });

  const [ThumbSlot, thumbProps] = thumb({
    component: "span",
    rootProps: props,
    internalProps: { dynamicClasses },
    slotProps: {},
  });

  const [ActionSlot, actionProps] = action({
    component: "span",
    rootProps: props,
    slotProps: {},
  });

  const [InputSlot, inputProps] = input({
    component: "input",
    rootProps: props,
    slotProps: { ownerState },
    externalProps: { ...other, className: undefined },
    internalProps: {
      type: "checkbox",
      role: "switch",
      checked,
      disabled,
      onCheckboxChange,
    },
  });

  const [StartDecoratorSlot, startDecoratorProps] = startDecoratorSlot({
    component: "span",
    rootProps: props,
    slotProps: {},
  });

  const [EndDecoratorSlot, endDecoratorProps] = endDecoratorSlot({
    component: "span",
    rootProps: props,
    slotProps: {},
  });

  return (
    <RootSlot {...rootProps}>
      {startDecorator && (
        <StartDecoratorSlot {...startDecoratorProps}>
          {startDecorator}
        </StartDecoratorSlot>
      )}
      <TrackSlot {...trackProps}>
        <ThumbSlot {...thumbProps} />
      </TrackSlot>
      <ActionSlot {...actionProps}>
        <InputSlot {...inputProps} />
      </ActionSlot>
      {endDecorator && (
        <EndDecoratorSlot {...endDecoratorProps}>
          {endDecorator}
        </EndDecoratorSlot>
      )}
    </RootSlot>
  );
};
