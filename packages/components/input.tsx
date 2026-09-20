import { FormControlICtxKey, useDefaultColor } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import type { Node } from "std/ui";
import { useOptionalICtx } from "std/ui";
import type { DynamicClass } from "std/ui";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

/**
 * Props shared by {@link Input} regardless of how its value is wired up.
 * Inherits the standard component shape (variant, color, size, slot
 * props). Provide a value via one of `value`, `bindScalar`, or
 * `bindRecordField` — combining them throws.
 */
export interface InputBaseProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      input: "input";
      startDecorator: "span";
      endDecorator: "span";
    }> {
  fullWidth?: boolean;

  type?: Sql | string;
  placeholder?: Sql | string;
  /** Expression for whether the input is in an error (invalid) state. */
  error?: BooleanExpr;
  /** DOM id applied to the underlying `<input>` (e.g. to target it from a label's `htmlFor`). */
  inputId?: Sql | string;
  autoFocus?: BooleanExpr;

  startDecorator?: Node;
  endDecorator?: Node;
  startIcon?: IconName;
  endIcon?: IconName;

  value?: Sql;

  /** Two-way bind the value to a `ui` scalar; auto-wires `onInput`. Mutually exclusive with `value`/`onInput`/`bindRecordField`. */
  bindScalar?: string;
  /** Two-way bind to a `record.field` (or `ui.record.field`); auto-wires `onInput`. Mutually exclusive with `value`/`onInput`/`bindScalar`. */
  bindRecordField?: string;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
  fullWidth: boolean;
}

const inputSizeStyleBySize: Record<Size, StyleObject> = {
  xs: {
    "--input-min-height": "1.75rem",
    "--input-padding-x": "0.5rem",
    "--input-decorator-child-height": "min(1.25rem, var(--input-min-height))",
    "--icon-font-size": "1rem",
    fontSize: cssVar("text-xs"),
  },
  sm: {
    "--input-min-height": "2rem",
    "--input-padding-x": "0.5rem",
    "--input-decorator-child-height": "min(1.5rem, var(--input-min-height))",
    "--icon-font-size": "1.25rem",
    fontSize: cssVar("text-sm"),
  },
  md: {
    "--input-min-height": "2.5rem",
    "--input-padding-x": "0.75rem",
    "--input-decorator-child-height": "min(2rem, var(--input-min-height))",
    "--icon-font-size": "1.5rem",
  },
  lg: {
    "--input-min-height": "3rem",
    "--input-padding-x": "1rem",
    "--input-gap": "0.75rem",
    "--input-decorator-child-height": "min(2.375rem, var(--input-min-height))",
    "--icon-font-size": "1.75rem",
  },
};

const inputColorInputHeightBySize: Record<Size, string> = {
  xs: "1.75rem",
  sm: "2rem",
  md: "2.5rem",
  lg: "2.5rem",
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
    const { size, variant, color, fullWidth } = ownerState;
    const styles: StyleObject = {
      "--input-radius": cssVar("radius-sm"),
      "--input-gap": "0.5rem",
      "--input-placeholder-color": "inherit",
      "--input-placeholder-opacity": "0.5",
      "--input-focused-thickness": cssVar("focus-thickness"),
      "--input-decorator-child-offset":
        "min(calc(var(--input-padding-x) - (var(--input-min-height) - 2 * var(--variant-border-width) - var(--input-decorator-child-height)) / 2), var(--input-padding-x))",
      "--input-padding-y":
        "max((var(--input-min-height) - 2 * var(--variant-border-width) - var(--input-decorator-child-height)) / 2, 0px)",
      "--input-decorator-child-radius":
        "max(var(--input-radius) - var(--input-padding-y), min(var(--input-padding-y) / 2, var(--input-radius) / 2))",
      "--button-min-height": "var(--input-decorator-child-height)",
      "--icon-button-size": "var(--input-decorator-child-height)",
      "--button-radius": "var(--input-decorator-child-radius)",
      "--icon-button-radius": "var(--input-decorator-child-radius)",
      boxSizing: "border-box",
      minWidth: 0,
      minHeight: "var(--input-min-height)",
      cursor: "text",
      position: "relative",
      display: "flex",
      alignItems: "center",
      paddingX: "var(--input-padding-x)",
      borderRadius: "var(--input-radius)",
      fontFamily: cssVar("font-family-body"),
      fontSize: cssVar("text-base"),
      "&:before": {
        boxSizing: "border-box",
        content: '""',
        display: "block",
        position: "absolute",
        pointerEvents: "none",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1,
        borderRadius: "inherit",
        margin: "calc(var(--variant-border-width) * -1)",
      },
      '&:has(input[type="color"])': {
        cursor: "pointer",
      },
    };

    if (fullWidth) {
      styles.width = "100%";
    }

    if (color === "harmonize") {
      styles["--input-focused-highlight"] = cssVar("palette-focus-visible");
    } else {
      const paletteColor = color === "neutral" ? "primary" : color;
      styles["--input-focused-highlight"] = cssVar(
        `palette-${paletteColor}-500`,
      );
    }

    Object.assign(styles, inputSizeStyleBySize[size]);

    Object.assign(styles, getVariantStyle(variant, color));

    if (variant === "outlined" || variant === "plain") {
      styles.backgroundColor = cssVar("palette-background-surface");
    }

    styles["&:hover:not(:focus-within)"] = {
      ...getVariantStyle(variant, color, "hover"),
      backgroundColor: null,
      cursor: "text",
    };

    styles["&:focus-within"] = {
      "&:before": {
        boxShadow:
          "inset 0 0 0 var(--input-focused-thickness) var(--input-focused-highlight)",
      },
    };

    const errorStyles = getVariantStyle(variant, "danger");
    const errorHoverStyles = getVariantStyle(variant, "danger", "hover");
    styles["&.error"] = {
      ...errorStyles,
      "--input-focused-highlight": cssVar("palette-danger-500"),
      "&:hover:not(:focus-within)": {
        ...errorHoverStyles,
        backgroundColor: null,
      },
    };

    return styles;
  },
);
const inputSlot = createGatherSafeSlot(
  "input",
  (
    _,
    {
      size,
    }: {
      size: Size;
    },
  ) => ({
    border: "none",
    minWidth: 0,
    outline: 0,
    padding: 0,
    flex: 1,
    alignSelf: "stretch",
    color: "inherit",
    backgroundColor: "transparent",
    fontFamily: "inherit",
    fontSize: "inherit",
    fontStyle: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
    textOverflow: "ellipsis",
    "&:-webkit-autofill": {
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "currentColor",
    },
    "&::-webkit-input-placeholder": {
      color: "var(--input-placeholder-color)",
      opacity: "var(--input-placeholder-opacity)",
    },
    "&::-moz-placeholder": {
      color: "var(--input-placeholder-color)",
      opacity: "var(--input-placeholder-opacity)",
    },
    "&::-ms-input-placeholder": {
      color: "var(--input-placeholder-color)",
      opacity: "var(--input-placeholder-opacity)",
    },
    // Add special styling for color inputs
    '&[type="color"]': {
      appearance: "none",
      WebkitAppearance: "none",
      py: 2,
      height: inputColorInputHeightBySize[size],
      border: "none",
      "&::-webkit-color-swatch-wrapper": {
        padding: 0,
      },
      "&::-webkit-color-swatch": {
        border: "none",
        borderRadius: "var(--input-decorator-child-radius)",
      },
      "&::-moz-color-swatch": {
        border: "none",
        borderRadius: "var(--input-decorator-child-radius)",
      },
    },
  }),
);
const startDecorator = createGatherSafeSlot(
  "startDecorator",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    "--button-margin-left": "calc(var(--input-decorator-child-offset) * -1)",
    "--icon-button-margin-left":
      "calc(var(--input-decorator-child-offset) * -1)",
    "--icon-margin-left": "calc(var(--input-padding-x) / -4)",
    display: "inherit",
    alignItems: "center",
    paddingY: "var(--input-padding-y)",
    flexWrap: "wrap",
    marginRight: "var(--input-gap)",
    color: cssVar("palette-text-tertiary"),
    cursor: "initial",
    "div:focus-within > &": {
      color: ownerState.color === "harmonize"
        ? `var(--harmonize-${ownerState.variant}-color)`
        : cssVar(`palette-${ownerState.color}-${ownerState.variant}-color`),
    },
  }),
);

const endDecorator = createGatherSafeSlot(
  "endDecorator",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    "--button-margin-right": "calc(var(--input-decorator-child-offset) * -1)",
    "--icon-button-margin-right":
      "calc(var(--input-decorator-child-offset) * -1)",
    "--icon-margin-right": "calc(var(--input-padding-x) / -4)",
    display: "inherit",
    alignItems: "center",
    marginLeft: "var(--input-gap)",
    color: ownerState.color === "harmonize"
      ? `var(--harmonize-${ownerState.variant}-color)`
      : cssVar(`palette-${ownerState.color}-${ownerState.variant}-color`),
    cursor: "initial",
  }),
);

export type InputProps =
  & InputBaseProps
  & Omit<JSX.IntrinsicElements["input"], "size">;

/**
 A customizable input component with various styling options and decorators.

 @category UI Component
 @param props.size
 @param props.variant - Defaults to "outlined".
 @param props.color
 @param props.fullWidth - Whether the input should take up the full width of its container. Defaults to false.
 @param props.error - Whether the input is in an error state.
 @param props.startDecorator - A node to be rendered at the start of the input.
 @param props.endDecorator - A node to be rendered at the end of the input.
 @param props.startIcon - An icon to be rendered at the start of the input.
 @param props.endIcon - An icon to be rendered at the end of the input.
 @param props.value - The value of the input.
 @param props.onInput - Event handler for input events.
 @param props.bindScalar - Binds the input to a scalar variable.
 @param props.bindRecordField - Binds the input to a record field.

 @examples
 [Example](../pages/search_card_page.tsx)
 */
export const Input: OverridableComponent<{
  defaultComponent: "input";
  props: InputBaseProps;
}> = (props: InputProps) => {
  let {
    size = "md",
    variant = "outlined",
    color = useDefaultColor("neutral"),
    fullWidth = false,
    error = false,
    startDecorator: startDecoratorProp,
    endDecorator: endDecoratorProp,
    startIcon,
    endIcon,
    value,
    onInput,
    bindScalar,
    bindRecordField,
    id,
    // deno-lint-ignore no-unused-vars
    className,
    // deno-lint-ignore no-unused-vars
    sx,
    ...other
  } = props;
  const ownerState: OwnerState = {
    size,
    variant,
    color,
    fullWidth,
  };
  const [RootSlot, rootProps] = root({
    component: "div",
    rootProps: props,
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
  const dynamicClasses: DynamicClass[] = [];
  if (error) {
    dynamicClasses.push({ classes: "error", condition: error });
  }
  if (value) {
    if (bindScalar || bindRecordField) {
      throw new Error(
        "Cannot specify both value and bindScalar/bindRecordField",
      );
    }
  }
  if (bindScalar) {
    value = sql`ui.${sql.ref(bindScalar)}`;
    if (bindRecordField) {
      throw new Error("Cannot specify both bindScalar and bindRecordField");
    }
    if (onInput) {
      throw new Error("Cannot specify both onInput and bindScalar");
    }
    onInput = (s: DomStatements) => {
      s.setScalar(props.bindScalar!, sql`target_value`);
    };
  }
  if (bindRecordField) {
    value = sql.ref(bindRecordField);
    const split = bindRecordField.split(".");
    if (split.length < 2) {
      throw new Error(
        "bindRecordField must be a record.field or ui.record.field",
      );
    }
    if (onInput) {
      throw new Error("Cannot specify both onInput and bindRecordField");
    }
    onInput = (s: DomStatements) => {
      const record = sql.ref(...split.slice(0, -1));
      const field = sql.ref(split[split.length - 1]);
      s.modify(sql`update ${record} set ${field} = target_value`);
    };
  }
  const formControlCtx = useOptionalICtx(FormControlICtxKey);

  const [InputSlot, inputProps] = inputSlot({
    component: "input",
    rootProps: props,
    internalProps: {
      value,
      onInput,
      required: props.required,
      id: id ?? formControlCtx?.id,
      disabled: props.disabled,
    },
    externalProps: other,
    slotProps: { size },
  });

  if (startIcon && startDecoratorProp) {
    throw new Error("Cannot have both startIcon and startDecorator");
  }
  if (endIcon && endDecoratorProp) {
    throw new Error("Cannot have both endIcon and endDecorator");
  }

  const resolvedStartDecorator = startIcon
    ? <MaterialIcon icon={startIcon} />
    : startDecoratorProp;
  const resolvedEndDecorator = endIcon
    ? <MaterialIcon icon={endIcon} />
    : endDecoratorProp;

  return (
    <RootSlot {...rootProps} dynamicClasses={dynamicClasses}>
      {resolvedStartDecorator && (
        <StartDecoratorSlot {...startDecoratorProps}>
          {resolvedStartDecorator}
        </StartDecoratorSlot>
      )}
      <InputSlot {...inputProps} />
      {resolvedEndDecorator && (
        <EndDecoratorSlot {...endDecoratorProps}>
          {resolvedEndDecorator}
        </EndDecoratorSlot>
      )}
    </RootSlot>
  );
};
