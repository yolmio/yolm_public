import { sql } from "../std/sql_utils";
import type { BooleanExpr } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Node } from "std/ui";
import { Show } from "std/ui";
import type { Color, ComponentOpts, Size, Variant } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { OverridableComponent } from "./utils";

function colorVar(color: Color, shade: 100 | 500): string {
  return `var(--palette-${color}-${shade})`;
}

interface ChipButtonProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "label";
      input: "input";
      overlay: "span";
      label: "span";
    }> {
  checked?: BooleanExpr;
  label?: Node;
  bindScalar?: string;
  bindRecordField?: string;
  children?: Node;
  styles?: StyleObject;
  checkedVariation?: {
    color?: Color;
    variant?: Variant;
  };
  overlay?: boolean;
  onCheckboxChange?: (s: DomStatements) => void;
}

interface OwnerState {
  variant: Variant;
  color: Color;
  size: Size;
  checkedVariation?: {
    color?: Color;
    variant?: Variant;
  };
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
    const { variant, color, size, checkedVariation } = ownerState;
    return {
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      userSelect: "none",
      verticalAlign: "middle",
      textDecoration: "none",
      borderRadius: "xl",
      transition: "all 0.2s",
      ...getVariantStyle(variant, color),
      ...(size === "xs" && {
        fontSize: "0.75rem",
        height: "20px",
        padding: 3,
      }),
      ...(size === "sm" && {
        fontSize: "0.8125rem",
        height: "24px",
        padding: 4,
      }),
      ...(size === "md" && {
        fontSize: "sm",
        height: "32px",
        padding: 4,
      }),
      ...(size === "lg" && {
        fontSize: "0.9375rem",
        height: "40px",
        padding: 4,
      }),
      "&:hover": {
        backgroundColor: colorVar(color, 100),
      },
      "&.checked": {
        ...getVariantStyle(
          checkedVariation?.variant ?? "solid",
          checkedVariation?.color ?? color,
        ),
        backgroundColor: colorVar(checkedVariation?.color ?? color, 500),
        color: cssVar("palette-common-white"),
      },
    };
  },
);

const input = createGatherSafeSlot("input", () => ({
  cursor: "inherit",
  position: "absolute",
  opacity: 0,
  width: "100%",
  height: "100%",
  top: 0,
  left: 0,
  margin: 0,
  padding: 0,
  zIndex: 1,
}));

const overlay = createGatherSafeSlot("overlay", () => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  borderRadius: "inherit",
  backgroundColor: "currentColor",
  opacity: 0,
  transition: "opacity 0.2s",
  "&:hover": {
    opacity: 0.08,
  },
  "&:focus-visible": {
    opacity: 0.12,
  },
}));

const label = createGatherSafeSlot("label", () => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 8px",
  fontWeight: "medium",
  lineHeight: 1,
  whiteSpace: "nowrap",
}));

/**
 A customizable chip button component that can act as a toggle or selectable item.

 @category UI Component


 @param props.variant - Defaults to "outlined".
 @param props.color
 @param props.size - Defaults to "sm".
 @param props.checked - Expression to determine if the chip is checked/selected.
 @param props.label - The label content for the chip.
 @param props.bindScalar - Scalar variable to bind the chip's checked state to.
 @param props.bindRecordField - Record field to bind the chip's checked state to.
 @param props.checkedVariation - Custom style variation for the checked state.
 @param props.overlay - Whether to show an overlay effect. Defaults to false.
 @param props.onCheckboxChange - Custom handler for chip state changes.

 @examples
 [Example](../../examples/kitchen_sink/apps/kitchen-sink.yolmstaging.net.tsx)
 */
export const ChipButton: OverridableComponent<{
  defaultComponent: "label";
  props: ChipButtonProps;
}> = (props: ChipButtonProps) => {
  let {
    variant = "outlined",
    color = "neutral",
    size = "sm",
    checked,
    label: labelNode,
    bindScalar,
    bindRecordField,
    checkedVariation = props.checkedVariation ?? {
      color: "primary",
      variant: "outlined",
    },
    overlay: showOverlay = false,
    onCheckboxChange,
    children,
    ...other
  } = props;

  const ownerState: OwnerState = {
    variant,
    color,
    size,
    checkedVariation,
  };

  if (bindScalar) {
    if (bindRecordField) {
      throw new Error("Cannot specify both bindScalar and bindRecordField");
    }
    if (onCheckboxChange) {
      throw new Error("Cannot specify both onCheckboxChange and bindScalar");
    }
    onCheckboxChange = (s) => {
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
    onCheckboxChange = (s) => {
      const record = sql.ref(...split.slice(0, -1));
      const field = sql.ref(split[split.length - 1]);
      s.modify(sql`update ${record} set ${field} = target_checked`);
    };
    checked = sql.ref(bindRecordField);
  }

  const [RootSlot, rootProps] = root({
    component: "label",
    rootProps: props,
    internalProps: {
      dynamicClasses: [{ classes: "checked", condition: checked! }],
    },
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

  const [OverlaySlot, overlayProps] = overlay({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });

  const [LabelSlot, labelProps] = label({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });

  return (
    <RootSlot {...rootProps}>
      <InputSlot {...inputProps} />
      <Show when={showOverlay}>
        <OverlaySlot {...overlayProps} />
      </Show>
      <LabelSlot {...labelProps}>{children || labelNode}</LabelSlot>
    </RootSlot>
  );
};
