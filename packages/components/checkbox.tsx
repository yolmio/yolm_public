import { sql } from "../std/sql_utils";
import type { BooleanExpr } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import type { DynamicClass } from "std/ui";
import { Show } from "std/ui";
import type { Node } from "std/ui";
import { SvgIcon } from "./svg_icon";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { OverridableComponent } from "./utils";

interface CheckboxProps extends
  ComponentOpts<Size>,
  SlottedComponentBaseProps<{
    root: "span";
    checkbox: "span";
    action: "span";
    input: "input";
    label: "label";
  }> {
  fullWidth?: boolean;
  overlay?: boolean;
  disableIcon?: boolean;

  error?: BooleanExpr;

  checkedVariation?: {
    variant: Variant;
    color: Color;
  };

  checked?: BooleanExpr;
  label?: Node;
  bindScalar?: string;
  bindRecordField?: string;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
  overlay: boolean;
  disableIcon: boolean;
  checkedVariation?: {
    variant: Variant;
    color: Color;
  };
}

const checkboxSizeStyleBySize: Record<Size, StyleObject> = {
  xs: {
    "--checkbox-size": "0.875rem",
    "--checkbox-gap": "0.25rem",
    fontSize: cssVar("text-xs"),
  },
  sm: {
    "--checkbox-size": "1rem",
    "--checkbox-gap": "0.375rem",
    fontSize: cssVar("text-sm"),
  },
  md: {
    "--checkbox-size": "1.25rem",
    "--checkbox-gap": "0.5rem",
    fontSize: cssVar("text-base"),
  },
  lg: {
    "--checkbox-size": "1.5rem",
    "--checkbox-gap": "0.625rem",
    fontSize: cssVar("text-lg"),
  },
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
    const { size, variant, color, overlay, disableIcon, checkedVariation } =
      ownerState;
    const styles: StyleObject = {
      "--icon-font-size": "var(--checkbox-size)",
      ...checkboxSizeStyleBySize[size],
      position: overlay ? "initial" : "relative",
      display: "inline-flex",
      fontFamily: cssVar("font-family-body"),
      lineHeight: "var(--checkbox-size)",
      color: disableIcon
        ? (getVariantStyle(variant, color) as any).color
        : cssVar("palette-text-primary"),
    };
    if (checkedVariation && !disableIcon) {
      (styles as any)["&.checked"] = {
        color: (
          getVariantStyle(
            checkedVariation.variant,
            checkedVariation.color,
          ) as any
        ).color,
      };
      (styles as any)["&.error"] = {
        color: (getVariantStyle(checkedVariation.variant, "danger") as any)
          .color,
      };
    }
    return styles;
  },
);

const checkboxSlot = createGatherSafeSlot(
  "checkbox",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { variant, color, disableIcon, checkedVariation } = ownerState;
    const styles: StyleObject = {
      boxSizing: "border-box",
      borderRadius: cssVar("radius-xs"),
      width: "var(--checkbox-size)",
      height: "var(--checkbox-size)",
      display: disableIcon ? "contents" : "inline-flex",
      justifyContent: "center",
      alignItems: "center",
      flexShrink: 0,
      "--icon-color": "currentColor",
    };
    function variation(variant: Variant, color: Color): StyleObject {
      const variationStyles: StyleObject = {
        ...getVariantStyle(variant, color),
        "&:hover": getVariantStyle(variant, color, "hover"),
        "&:active": getVariantStyle(variant, color, "active"),
      };
      if (variant === "outlined" || variant === "plain") {
        (variationStyles as any).backgroundColor = cssVar(
          "palette-background-surface",
        );
      }
      return variationStyles;
    }
    if (!disableIcon) {
      Object.assign(styles, variation(variant, color));
      if (checkedVariation) {
        (styles as any)[".checked &"] = variation(
          checkedVariation.variant,
          checkedVariation.color,
        );
      }
      (styles as any)[".error &"] = variation(variant, "danger");
    }
    return styles;
  },
);

const action = createGatherSafeSlot(
  "action",
  (
    app,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { variant, color, overlay, disableIcon, checkedVariation } =
      ownerState;
    const styles: StyleObject = {
      borderRadius: `var(--checkbox-action-radius, ${
        overlay ? "var(--action-radius, inherit)" : "inherit"
      })`,
      position: "absolute",
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      zIndex: 1,
      "&:has(:focus-visible)": app.theme.focus.default,
    };
    if (disableIcon) {
      Object.assign(styles, {
        ...getVariantStyle(variant, color),
        "&:hover": getVariantStyle(variant, color, "hover"),
        "&:active": getVariantStyle(variant, color, "active"),
      });
      styles[".error &"] = {
        ...getVariantStyle(variant, "danger"),
        "&:hover": getVariantStyle(variant, "danger", "hover"),
        "&:active": getVariantStyle(variant, "danger", "active"),
      };
      if (checkedVariation) {
        styles[".checked &"] = {
          ...getVariantStyle(checkedVariation.variant, checkedVariation.color),
          "&:hover": getVariantStyle(
            checkedVariation.variant,
            checkedVariation.color,
            "hover",
          ),
          "&:active": getVariantStyle(
            checkedVariation.variant,
            checkedVariation.color,
            "active",
          ),
        };
      }
    }
    return styles;
  },
);

const input = createGatherSafeSlot("input", () => ({
  margin: 0,
  opacity: 0,
  position: "absolute",
  width: "100%",
  height: "100%",
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
  ) => {
    const { disableIcon } = ownerState;
    const styles: StyleObject = {
      flex: 1,
      minWidth: 0,
    };
    if (disableIcon) {
      Object.assign(styles, {
        zIndex: 1,
        pointerEvents: "none",
      });
    } else {
      styles.marginLeft = "var(--checkbox-gap)";
    }
    return styles;
  },
);

/**
 A customizable checkbox component with various styles and states.

 @category UI Component

 @param props.color - Defaults to "primary".
 @param props.variant
 @param props.size
 @param props.fullWidth - Whether the checkbox should take up the full width of its container. Defaults to false.
 @param props.overlay - Whether to use an overlay effect. Defaults to false.
 @param props.disableIcon - Whether to disable the checkbox icon. Defaults to false.
 @param props.error - Expression to determine if the checkbox is in an error state.
 @param props.checkedVariation - Custom style variation for the checked state.
 @param props.checked - Expression to determine if the checkbox is checked.
 @param props.label - The label content for the checkbox.
 @param props.bindScalar - Scalar variable to bind the checkbox state to.
 @param props.bindRecordField - Record field to bind the checkbox state to.
 @param props.onCheckboxChange - Custom handler for checkbox state changes.

 @examples
 [Example](./search_dialog.tsx)
*/
export const Checkbox: OverridableComponent<{
  defaultComponent: "input";
  props: CheckboxProps;
}> = (props: CheckboxProps & Omit<JSX.IntrinsicElements["input"], "size">) => {
  let {
    color = "primary",
    variant = "outlined",
    size = "md",
    // deno-lint-ignore no-unused-vars
    fullWidth = false,
    overlay = false,
    disableIcon = false,
    error,
    checkedVariation,
    checked,
    label: labelNode,
    bindScalar,
    bindRecordField,
    onCheckboxChange,
    children,
    ...other
  } = props;
  const ownerState: OwnerState = {
    color,
    variant,
    size,
    overlay,
    disableIcon,
    checkedVariation,
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
  const dynamicClasses: DynamicClass[] = [];
  if (checkedVariation) {
    dynamicClasses.push({ classes: "checked", condition: checked });
  }
  if (error) {
    dynamicClasses.push({ classes: "error", condition: error });
  }
  const [RootSlot, rootProps] = root({
    component: "span",
    rootProps: props,
    internalProps: { dynamicClasses },
    slotProps: { ownerState },
  });
  const [CheckboxSlot, checkboxProps] = checkboxSlot({
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
    slotProps: { ownerState },
    externalProps: other,
    internalProps: {
      type: "checkbox",
      checked,
      onCheckboxChange,
    },
  });
  const [LabelSlot, labelProps] = label({
    component: "label",
    rootProps: props,
    slotProps: { ownerState },
    internalProps: labelNode ? { htmlFor: inputProps.id } : undefined,
  });
  return (
    <RootSlot {...rootProps}>
      <CheckboxSlot {...checkboxProps}>
        <ActionSlot {...actionProps}>
          <InputSlot {...inputProps} />
        </ActionSlot>
        {!disableIcon && (
          <Show when={checked}>
            {/*Example_SvgIcon_Start*/}
            <SvgIcon>
              <path d="M9 16.17 5.53 12.7a.9959.9959 0 0 0-1.41 0c-.39.39-.39 1.02 0 1.41l4.18 4.18c.39.39 1.02.39 1.41 0L20.29 7.71c.39-.39.39-1.02 0-1.41a.9959.9959 0 0 0-1.41 0L9 16.17z" />
            </SvgIcon>
            {/*Example_SvgIcon_End*/}
          </Show>
        )}
      </CheckboxSlot>
      {(children || labelNode) && (
        <LabelSlot {...labelProps}>{children || labelNode}</LabelSlot>
      )}
    </RootSlot>
  );
};
