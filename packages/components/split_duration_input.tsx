import { FormControlICtxKey } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import { useOptionalICtx, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

interface SplitDurationInputBaseProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      hoursInput: "input";
      minutesInput: "input";
      separator: "span";
      startDecorator: "span";
      endDecorator: "span";
    }> {
  fullWidth?: boolean;
  error?: BooleanExpr;
  autoFocus?: BooleanExpr;
  onChange?: (s: DomStatements, value: Sql) => void;
  value?: Sql;
  startDecorator?: Node;
  endDecorator?: Node;
  bindScalar?: string;
  bindRecordField?: string;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
  fullWidth: boolean;
}

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
      // Match input component's variables
      "--duration-radius": cssVar("radius-sm"),
      "--duration-gap": "0.125rem",
      "--duration-focused-thickness": cssVar("focus-thickness"),
      "--duration-min-height": "var(--input-min-height)",
      "--duration-padding-x": "var(--input-padding-x)",
      "--duration-padding-y": "var(--input-padding-y)",
      "--duration-decorator-child-height":
        "var(--input-decorator-child-height)",
      boxSizing: "border-box",
      minWidth: 0,
      minHeight: "var(--duration-min-height)",
      // for some reason without this it stays at 42px and is not consistent with input component
      maxHeight: "var(--duration-min-height)",
      cursor: "text",
      position: "relative",
      display: "flex",
      alignItems: "center",
      gap: "var(--duration-gap)",
      paddingX: "var(--duration-padding-x)",
      borderRadius: "var(--duration-radius)",
      fontFamily: cssVar("font-family-body"),
      fontSize: cssVar("text-base"),
      ...getVariantStyle(variant, color),
      "&:hover:not(:focus-within)": {
        ...getVariantStyle(variant, color, "hover"),
        backgroundColor: null,
        cursor: "text",
      },
    };
    if (variant === "outlined" || variant === "plain") {
      (styles as any).backgroundColor = cssVar("palette-background-surface");
    }
    if (fullWidth) {
      (styles as any).width = "100%";
    }

    if (color === "harmonize") {
      (styles as any)["--duration-focused-highlight"] = cssVar(
        "palette-focus-visible",
      );
    } else {
      const paletteColor = color === "neutral" ? "primary" : color;
      (styles as any)["--duration-focused-highlight"] = cssVar(
        `palette-${paletteColor}-500`,
      );
    }
    switch (size) {
      case "xs":
        Object.assign(styles, {
          "--input-min-height": "1.5rem",
          "--input-padding-x": "0.0625rem",
          "--input-decorator-child-height":
            "min(1.25rem, var(--input-min-height))",
          "--duration-input-width": "2rem",
          fontSize: cssVar("text-xs"),
        });
        break;
      case "sm":
        Object.assign(styles, {
          "--input-min-height": "2rem",
          "--input-padding-x": "0.0625rem",
          "--input-decorator-child-height":
            "min(1.5rem, var(--input-min-height))",
          "--duration-input-width": "2.5rem",
          fontSize: cssVar("text-sm"),
        });
        break;
      case "md":
        Object.assign(styles, {
          "--input-min-height": "2.5rem",
          "--input-padding-x": "0.125rem",
          "--input-decorator-child-height":
            "min(2rem, var(--input-min-height))",
          "--duration-input-width": "3rem",
          fontSize: cssVar("text-base"),
        });
        break;
      case "lg":
        Object.assign(styles, {
          "--input-min-height": "3rem",
          "--input-padding-x": "0.25rem",
          "--duration-gap": "0.25rem",
          "--input-decorator-child-height":
            "min(2.375rem, var(--input-min-height))",
          "--duration-input-width": "3.5rem",
          fontSize: cssVar("text-lg"),
        });
        break;
    }
    const errorStyles = getVariantStyle(variant, "danger");
    const errorHoverStyles = getVariantStyle(variant, "danger", "hover");
    (styles as any)["&.error"] = {
      ...errorStyles,
      "--duration-focused-highlight": cssVar("palette-danger-500"),
      "&:hover:not(:focus-within)": {
        ...errorHoverStyles,
        backgroundColor: null,
      },
    };
    return styles;
  },
);

const inputStyles: StyleObject = {
  width: "var(--duration-input-width)",
  minHeight: "var(--duration-min-height)",
  border: "none",
  outline: 0,
  padding: 0,
  color: "inherit",
  backgroundColor: "transparent",
  fontFamily: "inherit",
  fontSize: "inherit",
  fontStyle: "inherit",
  fontWeight: "inherit",
  lineHeight: "inherit",
  textAlign: "center",
  borderRadius: "var(--duration-radius)",
  "&:focus": {
    boxShadow:
      "inset 0 0 0 var(--duration-focused-thickness) var(--duration-focused-highlight)",
  },
};

const hoursInput = createGatherSafeSlot("hoursInput", () => inputStyles);
const minutesInput = createGatherSafeSlot("minutesInput", () => inputStyles);

const separator = createGatherSafeSlot("separator", () => ({
  fontSize: "inherit",
  color: cssVar("palette-text-tertiary"),
}));

const startDecoratorSlot = createGatherSafeSlot("startDecorator", () => ({
  display: "inherit",
  alignItems: "center",
  marginRight: "var(--duration-gap)",
  color: cssVar("palette-text-tertiary"),
}));

const endDecoratorSlot = createGatherSafeSlot("endDecorator", () => ({
  display: "inherit",
  alignItems: "center",
  marginLeft: "var(--duration-gap)",
  color: cssVar("palette-text-tertiary"),
}));

export type SplitDurationInputProps =
  & SplitDurationInputBaseProps
  & Omit<JSX.IntrinsicElements["input"], "size" | "onChange">;

/**
 A customizable split duration input component for entering hours and minutes.

 @category UI Component
 @param props.size - The size of the input
 @param props.variant - The variant style of the input
 @param props.color - The color theme of the input
 @param props.fullWidth - Whether the input should take full width
 @param props.error - Whether to show error state
 @param props.startDecorator - Node to show before the input
 @param props.endDecorator - Node to show after the input
 @param props.value - The controlled value
 @param props.bindScalar - Bind to a scalar variable
 @param props.bindRecordField - Bind to a record field

 @examples
 [Example](./field_form_control.tsx)
 */
export const SplitDurationInput: OverridableComponent<{
  defaultComponent: "div";
  props: SplitDurationInputBaseProps;
}> = (props: SplitDurationInputProps) => {
  let {
    size = "md",
    variant = "outlined",
    color = "neutral",
    fullWidth = false,
    autoFocus,
    error = false,
    startDecorator,
    endDecorator,
    value,
    bindScalar,
    bindRecordField,
    onChange,
    ...other
  } = props;
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
  }
  if (bindRecordField) {
    value = sql.ref(bindRecordField);
    const split = bindRecordField.split(".");
    if (split.length < 2) {
      throw new Error(
        "bindRecordField must be a record.field or ui.record.field",
      );
    }
  }
  if (!value) {
    throw new Error("value is required");
  }
  const ownerState: OwnerState = {
    size,
    variant,
    color,
    fullWidth,
  };
  const [RootSlot, rootProps] = root({
    component: "div",
    rootProps: props,
    externalProps: other,
    internalProps: {
      dynamicClass: error
        ? {
          condition: error,
          classes: "error",
        }
        : undefined,
    },
    slotProps: { ownerState },
  });
  // todo paste behavior
  const formControlCtx = useOptionalICtx(FormControlICtxKey);
  const [HoursInputSlot, hoursInputProps] = hoursInput({
    component: "input",
    rootProps: props,
    internalProps: {
      inputMode: "numeric",
      pattern: "[0-9]*",
      placeholder: "HH",
      "aria-label": "Hours",
      autoFocus,
      value: getHours(value),
      id: props.slotProps?.hoursInput?.id ?? formControlCtx?.id,
      onKeyDown: (s) => {
        s.if(sql`event.key in (':', '.')`, (s) => {
          s.event.preventDefault();
          s.element(minutesId).focus();
          s.return();
        });
        s.if(
          sql`not event.ctrl_key and not event.meta_key and char_length(event.key) = 1 and event.key not in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '0')`,
          (s) => {
            s.event.preventDefault();
            s.return();
          },
        );
      },
      onChange: (s) => {
        const newValue = sql`target_value || ':' || coalesce(case when ${
          getMinutes(value)
        } = '' then null else ${getMinutes(value)} end, '00')`;
        if (bindScalar) {
          s.setScalar(bindScalar, newValue);
        } else if (bindRecordField) {
          const split = bindRecordField.split(".");
          const record = sql.ref(...split.slice(0, -1));
          const field = sql.ref(split[split.length - 1]);
          s.modify(sql`update ${record} set ${field} = ${newValue}`);
        } else {
          onChange?.(s, newValue);
        }
      },
    },
    slotProps: { ownerState },
  });
  const minutesId = useUniqueId();
  const [MinutesInputSlot, minutesInputProps] = minutesInput({
    component: "input",
    rootProps: props,
    internalProps: {
      inputMode: "numeric",
      pattern: "[0-9]*",
      maxLength: 2,
      placeholder: "MM",
      min: 0,
      max: 59,
      "aria-label": "Minutes",
      value: getMinutes(value),
      id: minutesId,
      onKeyDown: (s) => {
        s.if(
          sql`not event.ctrl_key and not event.meta_key and char_length(event.key) = 1 and event.key not in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '0')`,
          (s) => {
            s.event.preventDefault();
            s.return();
          },
        );
      },
      onChange: (s) => {
        const newValue = sql`coalesce(${
          getHours(value)
        }, '0') || ':' || lpad(target_value, 2, '0')`;
        if (bindScalar) {
          s.setScalar(bindScalar, newValue);
        } else if (bindRecordField) {
          const split = bindRecordField.split(".");
          const record = sql.ref(...split.slice(0, -1));
          const field = sql.ref(split[split.length - 1]);
          s.modify(sql`update ${record} set ${field} = ${newValue}`);
        } else {
          onChange?.(s, newValue);
        }
      },
    },
    slotProps: { ownerState },
  });
  const [SeparatorSlot, separatorProps] = separator({
    component: "span",
    rootProps: props,
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
  return (
    <RootSlot {...rootProps}>
      {startDecorator && (
        <StartDecoratorSlot {...startDecoratorProps}>
          {startDecorator}
        </StartDecoratorSlot>
      )}
      <HoursInputSlot {...hoursInputProps} />
      <SeparatorSlot {...separatorProps}>:</SeparatorSlot>
      <MinutesInputSlot {...minutesInputProps} />
      {endDecorator && (
        <EndDecoratorSlot {...endDecoratorProps}>
          {endDecorator}
        </EndDecoratorSlot>
      )}
    </RootSlot>
  );
};

function getHours(value: Sql) {
  return sql`left(${value}, position(':' in ${value}) - 1)`;
}

function getMinutes(value: Sql) {
  return sql`right(${value}, char_length(${value}) - position(':' in ${value}))`;
}
