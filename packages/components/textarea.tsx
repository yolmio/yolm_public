import { sql } from "../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import type { Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

interface TextareaBaseProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      textarea: "textarea";
      startDecorator: "div";
      endDecorator: "div";
    }> {
  fullWidth?: boolean;

  placeholder?: Sql | string;
  error?: BooleanExpr;
  autoFocus?: BooleanExpr;
  rows?: NumericExpr;
  minRows?: number;
  value?: Sql;

  startDecorator?: Node;
  endDecorator?: Node;

  bindScalar?: string;
  bindRecordField?: string;
}

export type TextareaProps =
  & TextareaBaseProps
  & JSX.IntrinsicElements["textarea"];

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
  fullWidth: boolean;
  minRows?: number;
}

const textareaLineHeightBySize: Record<Size, string> = {
  xs: cssVar("leading-snug"),
  sm: cssVar("leading-snug"),
  md: cssVar("leading-normal"),
  lg: cssVar("leading-normal"),
};

const textareaFontSizeBySize: Record<Size, string> = {
  xs: cssVar("text-xs"),
  sm: cssVar("text-sm"),
  md: cssVar("text-base"),
  lg: cssVar("text-base"),
};

const textareaPaddingYBySize: Record<Size, string> = {
  xs: "0.375rem - var(--variant-border-width, 0px)",
  sm: "0.5rem - var(--variant-border-width, 0px)",
  md: "0.75rem - var(--variant-border-width, 0px)",
  lg: "0.75rem - var(--variant-border-width, 0px)",
};

function textareaSizeStyle(
  size: Size,
  getMinHeight: (defaultHeight: string) => string,
): StyleObject {
  const sizeStyleBySize: Record<Size, StyleObject> = {
    xs: {
      "--textarea-min-height": getMinHeight("1.75rem"),
      "--textarea-padding-x": "0.5rem",
      "--textarea-decorator-child-height":
        "min(1.25rem, var(--textarea-min-height))",
      "--icon-font-size": "1rem",
    },
    sm: {
      "--textarea-min-height": getMinHeight("2rem"),
      "--textarea-padding-x": "0.5rem",
      "--textarea-decorator-child-height":
        "min(1.5rem, var(--textarea-min-height))",
      "--icon-font-size": "1.25rem",
    },
    md: {
      "--textarea-min-height": getMinHeight("2.5rem"),
      "--textarea-padding-x": "0.75rem",
      "--textarea-decorator-child-height":
        "min(2rem, var(--textarea-min-height))",
      "--icon-font-size": "1.5rem",
    },
    lg: {
      "--textarea-min-height": getMinHeight("3rem"),
      "--textarea-padding-x": "1rem",
      "--textarea-gap": "0.75rem",
      "--textarea-decorator-child-height":
        "min(2.375rem, var(--textarea-min-height))",
      "--icon-font-size": "1.75rem",
    },
  };
  return sizeStyleBySize[size];
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
    const { size, variant, color, fullWidth, minRows } = ownerState;
    const lineHeight = textareaLineHeightBySize[size];
    const fontSize = textareaFontSizeBySize[size];
    const paddingY = textareaPaddingYBySize[size];
    const styles: StyleObject = {
      "--textarea-radius": cssVar("radius-sm"),
      "--textarea-gap": "0.5rem",
      "--textarea-placeholder-color": "inherit",
      "--textarea-placeholder-opacity": "0.5",
      "--textarea-focused-thickness": cssVar("focus-thickness"),
      "--textarea-focused-highlight": color === "harmonize"
        ? cssVar("palette-focus-visible")
        : cssVar(`palette-${color === "neutral" ? "primary" : color}-500`),
      "--_textarea-padding-y":
        "max((var(--textarea-min-height) - 2 * var(--variant-border-width, 0px) - var(--textarea-decorator-child-height)) / 2, 0px)",
      "--textarea-decorator-child-radius":
        "max(var(--textarea-radius) - var(--variant-border-width, 0px) - var(--_textarea-padding-y), min(var(--_textarea-padding-y) + var(--variant-border-width, 0px), var(--textarea-radius) / 2))",
      "--button-min-height": "var(--textarea-decorator-child-height)",
      "--icon-button-size": "var(--textarea-decorator-child-height)",
      "--button-radius": "var(--textarea-decorator-child-radius)",
      "--icon-button-radius": "var(--textarea-decorator-child-radius)",
      boxSizing: "border-box",
      minWidth: 0,
      minHeight: "var(--textarea-min-height)",
      cursor: "text",
      position: "relative",
      display: "flex",
      flexDirection: "column",
      paddingLeft: "var(--textarea-padding-x)",
      paddingY: "var(--textarea-padding-y)",
      borderRadius: "var(--textarea-radius)",
      fontFamily: cssVar("font-family-body"),
      fontSize,
      lineHeight,
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
        margin: "calc(var(--variant-border-width, 0px) * -1)",
      },
      ...getVariantStyle(variant, color),
      "--textarea-padding-y": `calc(${paddingY})`,
      backgroundColor: variant === "plain" || variant === "outlined"
        ? cssVar("palette-background-surface")
        : (getVariantStyle(variant, color) as any).backgroundColor,
      "&:hover:not(&:has(textarea:focus))": {
        ...getVariantStyle(variant, color, "hover"),
        backgroundColor: null,
        cursor: "text",
      },
      "&:has(textarea:focus)": {
        "&:before": {
          boxShadow:
            "inset 0 0 0 var(--textarea-focused-thickness) var(--textarea-focused-highlight)",
        },
      },
    };

    if (fullWidth) {
      (styles as any).width = "100%";
    }
    function getMinHeight(defaultHeight: string) {
      return minRows
        ? `calc(${lineHeight} * ${fontSize} * ${minRows} + (${paddingY} * 2))`
        : defaultHeight;
    }
    Object.assign(styles, textareaSizeStyle(size, getMinHeight));

    const errorStyles = getVariantStyle(variant, "danger");
    const errorHoverStyles = getVariantStyle(variant, "danger", "hover");
    (styles as any)["&.error"] = {
      ...errorStyles,
      "--textarea-focused-highlight": cssVar("palette-danger-500"),
      "&:hover:not(:focus-within)": {
        ...errorHoverStyles,
        backgroundColor: null,
      },
    };

    return styles;
  },
);

const textareaSlot = createGatherSafeSlot("textarea", () => ({
  resize: "vertical",
  fieldSizing: "content",
  border: "none",
  minWidth: 0,
  outline: 0,
  padding: 0,
  paddingRight: "var(--textarea-padding-x)",
  flex: "auto",
  alignSelf: "stretch",
  color: "inherit",
  backgroundColor: "transparent",
  fontFamily: "inherit",
  fontSize: "inherit",
  fontStyle: "inherit",
  fontWeight: "inherit",
  lineHeight: "inherit",
  "&:-webkit-autofill": {
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "currentColor",
  },
  "&::placeholder": {
    color: "var(--textarea-placeholder-color)",
    opacity: "var(--textarea-placeholder-opacity)",
  },
}));

const startDecoratorSlot = createGatherSafeSlot("startDecorator", () => ({
  display: "flex",
  marginLeft: "calc(var(--textarea-padding-y) - var(--textarea-padding-x))",
  marginRight: "var(--textarea-padding-y)",
  marginBottom: "var(--textarea-gap)",
  color: cssVar("palette-text-tertiary"),
  cursor: "initial",
}));

const endDecoratorSlot = createGatherSafeSlot("endDecorator", () => ({
  display: "flex",
  marginLeft: "calc(var(--textarea-padding-y) - var(--textarea-padding-x))",
  marginRight: "var(--textarea-padding-y)",
  marginTop: "var(--textarea-gap)",
  color: cssVar("palette-text-tertiary"),
  cursor: "initial",
}));

/**
 Multi-line text input.

 Bind it one of three ways: `bindScalar` (read/write a UI scalar),
 `bindRecordField` (read/write a `record.field` or `ui.record.field`), or a
 manual `value` + `onInput` pair. Passing both a binding and `value`, or a
 bind helper together with `onInput`, throws. Use `minRows` to set a minimum
 height and `error` to apply the danger styling.

 @category UI Component

 @examples
 [Example](./notes_card.tsx)
*/
export const Textarea: OverridableComponent<{
  defaultComponent: "textarea";
  props: TextareaBaseProps;
}> = (props: TextareaProps) => {
  let {
    size = "md",
    variant = "outlined",
    color = "neutral",
    fullWidth = false,
    error,
    startDecorator,
    endDecorator,
    value,
    bindScalar,
    bindRecordField,
    minRows,
    onInput,
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
    if (onInput) {
      throw new Error("Cannot specify both onInput and bindScalar");
    }
    onInput = (s: DomStatements) => {
      s.setScalar(bindScalar, sql`target_value`);
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
  const ownerState: OwnerState = {
    size,
    variant,
    color,
    fullWidth,
    minRows,
  };
  const [RootSlot, rootProps] = root({
    component: "div",
    rootProps: props,
    slotProps: { ownerState },
    internalProps: {
      dynamicClasses: error
        ? [{ classes: "error", condition: error }]
        : undefined,
    },
  });
  const [TextareaSlot, textareaProps] = textareaSlot({
    component: "textarea",
    rootProps: props,
    externalProps: { ...other, className: undefined },
    slotProps: { ownerState },
    internalProps: {
      value,
      onInput,
    },
  });
  const [StartDecoratorSlot, startDecoratorProps] = startDecoratorSlot({
    component: "div",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [EndDecoratorSlot, endDecoratorProps] = endDecoratorSlot({
    component: "div",
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
      <TextareaSlot {...textareaProps} />
      {endDecorator && (
        <EndDecoratorSlot {...endDecoratorProps}>
          {endDecorator}
        </EndDecoratorSlot>
      )}
    </RootSlot>
  );
};
