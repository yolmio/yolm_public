import type { BooleanExpr, Sql } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Node } from "std/ui";

import type { Color, ComponentOpts, Size, Variant } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

/** Props for {@link Radio}. */
export interface RadioProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "span";
      radio: "span";
      icon: "span";
      action: "span";
      input: "input";
      label: "label";
    }> {
  /** Hide the circular dot indicator; the variant style alone shows selection. */
  disableIcon?: boolean;
  /** Stretch the clickable action area to cover the parent (e.g. a whole card). */
  overlay?: boolean;
  /** Expression for whether this radio is the selected one. */
  checked?: BooleanExpr;
  /** Submitted value of the underlying `<input type="radio">`. */
  value?: Sql;
  label?: Node;
  disabled?: BooleanExpr;
  /** Shared group name tying mutually exclusive radios together. */
  name?: Sql;
}

interface OwnerState {
  variant: Variant;
  color: Color;
  size: Size;
  disableIcon: boolean;
  overlay: boolean;
}

const radioSizeStyleBySize: Record<Size, StyleObject> = {
  xs: {
    "--radio-size": "0.875rem",
    fontSize: cssVar("text-xs"),
    gap: "var(--radio-gap, 0.375rem)",
  },
  sm: {
    "--radio-size": "1rem",
    fontSize: cssVar("text-sm"),
    gap: "var(--radio-gap, 0.5rem)",
  },
  md: {
    "--radio-size": "1.25rem",
    fontSize: cssVar("text-base"),
    gap: "var(--radio-gap, 0.625rem)",
  },
  lg: {
    "--radio-size": "1.5rem",
    fontSize: cssVar("text-lg"),
    gap: "var(--radio-gap, 0.75rem)",
  },
};

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
    const { variant, color, size, overlay, disableIcon } = ownerState;
    const styles: StyleObject = {
      "--icon-font-size": "var(--radio-size)",
      "--icon-color": "currentColor",
      position: overlay ? "initial" : "relative",
      display: "inline-flex",
      boxSizing: "border-box",
      minWidth: 0,
      fontFamily: cssVar("font-family-body"),
      lineHeight: "var(--radio-size)",
      color: cssVar("palette-text-primary"),
      ...radioSizeStyleBySize[size],
      "&:has(:focus-visible)": app.theme.focus.default,
    };
    if (disableIcon) {
      (styles as any).color = (getVariantStyle(variant, color) as any).color;
    }
    return styles;
  },
);

const radio = createGatherSafeSlot(
  "radio",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { variant, color, disableIcon } = ownerState;
    const variantStyle = getVariantStyle(variant, color);
    return {
      "--icon-color": color !== "neutral" || variant === "solid"
        ? "currentColor"
        : cssVar("palette-text-icon"),
      margin: 0,
      boxSizing: "border-box",
      width: "var(--radio-size)",
      height: "var(--radio-size)",
      borderRadius: "var(--radio-size)",
      display: "inline-flex",
      justifyContent: "center",
      alignItems: "center",
      flexShrink: 0,
      ...(disableIcon && { display: "contents" }),
      ...(!disableIcon && {
        ...variantStyle,
        backgroundColor: (variantStyle as any).backgroundColor ??
          cssVar("palette-background-surface"),
      }),
      "&:hover": disableIcon ? {} : getVariantStyle(variant, color, "hover"),
      "&:active": disableIcon ? {} : getVariantStyle(variant, color, "active"),
    };
  },
);

const icon = createGatherSafeSlot("icon", () => ({
  width: "calc(var(--radio-size) / 2)",
  height: "calc(var(--radio-size) / 2)",
  borderRadius: "inherit",
  color: "inherit",
  backgroundColor: "currentColor",
  transform: "scale(0)",
  "&.checked": {
    transform: "scale(1)",
  },
}));

const action = createGatherSafeSlot(
  "action",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    position: "absolute",
    textAlign: "left",
    borderRadius: `var(--radio-action-radius, ${
      ownerState.overlay ? "var(--unstable-action-radius, inherit)" : "inherit"
    })`,
    top: "calc(-1 * var(--variant-border-width, 0px))",
    left: "calc(-1 * var(--variant-border-width, 0px))",
    bottom: "calc(-1 * var(--variant-border-width, 0px))",
    right: "calc(-1 * var(--variant-border-width, 0px))",
    zIndex: 1,
  }),
);

const input = createGatherSafeSlot("input", () => ({
  margin: 0,
  opacity: 0,
  position: "absolute",
  height: "100%",
  width: "100%",
  cursor: "pointer",
}));

const label = createGatherSafeSlot(
  "label",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    flex: 1,
    minWidth: 0,
    zIndex: ownerState.disableIcon ? 1 : undefined,
    pointerEvents: ownerState.disableIcon ? "none" : undefined,
  }),
);

/**
 A customizable radio button component.

 This component renders a radio button with various customization options such as
 variant, color, size, and label. It can be used standalone or as part of a RadioGroup.

 @category UI Component

@examples
[Example](../pages/bulk_merge_import.tsx)

*/
export const Radio: OverridableComponent<{
  defaultComponent: "span";
  props: RadioProps;
}> = (props: RadioProps) => {
  const {
    variant = "outlined",
    color = "neutral",
    size = "md",
    disableIcon = false,
    overlay = false,
    checked,
    value,
    label: labelNode,
    disabled,
    name,
    ...other
  } = props;

  const ownerState: OwnerState = {
    variant,
    color,
    size,
    disableIcon,
    overlay,
  };

  const [RootSlot, rootProps] = root({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });

  const [RadioSlot, radioProps] = radio({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });

  const [IconSlot, iconProps] = icon({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });

  const [ActionSlot, actionProps] = action({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });

  const [InputSlot, inputProps] = input({
    component: "input",
    rootProps: props,
    externalProps: { ...other, className: undefined },
    slotProps: { ownerState },
  });

  const [LabelSlot, labelProps] = label({
    component: "label",
    rootProps: props,
    slotProps: { ownerState },
  });

  return (
    <RootSlot {...rootProps}>
      <RadioSlot {...radioProps}>
        {!disableIcon && (
          <IconSlot
            {...iconProps}
            dynamicClasses={[{ classes: "checked", condition: checked! }]}
          />
        )}
        <ActionSlot {...actionProps}>
          <InputSlot
            {...inputProps}
            type="radio"
            name={name}
            value={value}
            checked={checked}
            disabled={disabled}
          />
        </ActionSlot>
      </RadioSlot>
      {labelNode && <LabelSlot {...labelProps}>{labelNode}</LabelSlot>}
    </RootSlot>
  );
};
