import { useDefaultColor } from "std/ictx";
import type { BooleanExpr } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import type { DynamicClass } from "std/ui";
import type { Node } from "std/ui";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";
import { SvgIcon } from "./svg_icon";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { OverridableComponent } from "./utils";

interface ChipBaseProps extends
  ComponentOpts<Size>,
  SlottedComponentBaseProps<{
    root: "div";
    label: "div";
    action: "button";
    startDecorator: "span";
    endDecorator: "span";
  }> {
  clickable?: boolean;
  conditionalVariants?: {
    when: BooleanExpr;
    variant?: Variant;
    color?: Color;
  }[];
  startDecorator?: Node;
  endDecorator?: Node;
  startIcon?: IconName;
  endIcon?: IconName;
  children?: Node;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
  clickable: boolean;
  conditionalVariants?: {
    variant: Variant;
    color: Color;
  }[];
}

const chipSizeStyleBySize: Record<Size, StyleObject> = {
  xs: {
    "--chip-gap": "0.25rem",
    "--chip-padding-x": "0.375rem",
    "--chip-decorator-child-height":
      "calc(min(1rem, var(--_chip-min-height)) - 2 * var(--variant-border-width, 0px))",
    "--icon-font-size": "calc(var(--_chip-min-height) / 1.6)",
    "--_chip-min-height": "var(--chip-min-height, 1.25rem)",
    fontSize: cssVar("text-xs"),
  },
  sm: {
    "--chip-gap": "0.25rem",
    "--chip-padding-x": "0.5rem",
    "--chip-decorator-child-height":
      "calc(min(1.125rem, var(--_chip-min-height)) - 2 * var(--variant-border-width, 0px))",
    "--icon-font-size": "calc(var(--_chip-min-height) / 1.714)",
    "--_chip-min-height": "var(--chip-min-height, 1.5rem)",
    fontSize: cssVar("text-xs"),
  },
  md: {
    "--chip-gap": "0.375rem",
    "--chip-padding-x": "0.75rem",
    "--chip-decorator-child-height": "min(1.375rem, var(--_chip-min-height))",
    "--icon-font-size": "calc(var(--_chip-min-height) / 1.778)",
    "--_chip-min-height": "var(--chip-min-height, 2rem)",
    fontSize: cssVar("text-sm"),
  },
  lg: {
    "--chip-gap": "0.5rem",
    "--chip-padding-x": "1rem",
    "--chip-decorator-child-height": "min(1.75rem, var(--_chip-min-height))",
    "--icon-font-size": "calc(var(--_chip-min-height) / 2)",
    "--_chip-min-height": "var(--chip-min-height, 2.5rem)",
    fontSize: cssVar("text-base"),
  },
};

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
    const { size, variant, color, clickable, conditionalVariants } = ownerState;
    const styles: StyleObject = {
      "--chip-decorator-child-offset":
        "min(calc(var(--chip-padding-x) - (var(--_chip-min-height) - 2 * var(--variant-border-width, 0px) - var(--chip-decorator-child-height)) / 2), var(--chip-padding-x))",
      "--chip-decorator-child-radius":
        "max(var(--_chip-radius) - var(--variant-border-width, 0px) - var(--_chip-padding-y), min(var(--_chip-padding-y) + var(--variant-border-width, 0px), var(--_chip-radius) / 2))",
      "--chip-delete-radius": "var(--chip-decorator-child-radius)",
      "--chip-delete-size": "var(--chip-decorator-child-height)",
      "--avatar-radius": "var(--chip-decorator-child-radius)",
      "--avatar-size": "var(--chip-decorator-child-height)",
      "--icon-margin-top": "initial",
      "--icon-margin-right": "initial",
      "--icon-margin-bottom": "initial",
      "--icon-margin-left": "initial",
      "--action-radius": "var(--_chip-radius)",
      "--_chip-radius": "var(--chip-radius, 1.5rem)",
      "--_chip-padding-y":
        "max((var(--_chip-min-height) - 2 * var(--variant-border-width, 0px) - var(--chip-decorator-child-height)) / 2, 0px)",
      minHeight: "var(--_chip-min-height)",
      paddingX: "var(--chip-padding-x)",
      borderRadius: "var(--_chip-radius)",
      position: "relative",
      fontWeight: cssVar("font-weight-medium"),
      fontFamily: cssVar("font-family-body"),
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      whiteSpace: "nowrap",
      textDecoration: "none",
      verticalAlign: "middle",
      boxSizing: "border-box",
    };

    Object.assign(styles, chipSizeStyleBySize[size]);

    if (clickable) {
      Object.assign(styles, {
        "--variant-border-width": "0px",
        color: (getVariantStyle(variant, color) as any).color,
      });
      if (conditionalVariants) {
        for (let i = 0; i < conditionalVariants.length; i++) {
          const { variant, color } = conditionalVariants[i];
          styles[`&.variant-${i}`] = {
            color: (getVariantStyle(variant, color) as any).color,
          };
        }
      }
    } else {
      Object.assign(styles, getVariantStyle(variant, color));
      if (conditionalVariants) {
        for (let i = 0; i < conditionalVariants.length; i++) {
          const { variant, color } = conditionalVariants[i];
          styles[`&.variant-${i}`] = getVariantStyle(variant, color);
        }
      }
    }
    return styles;
  },
);

const labelSlot = createGatherSafeSlot(
  "label",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const styles: StyleObject = {
      display: "inline-block",
      overflow: "hidden",
      textOverflow: "ellipsis",
      order: 1,
      minInlineSize: 0,
      flexGrow: 1,
    };
    if (ownerState.clickable) {
      Object.assign(styles, { zIndex: 1, pointerEvents: "none" });
    }
    return styles;
  },
);

const actionSlot = createGatherSafeSlot(
  "action",
  (
    app,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { variant, color, conditionalVariants } = ownerState;
    const styles: StyleObject = {
      position: "absolute",
      zIndex: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      border: "none",
      cursor: "pointer",
      padding: "initial",
      margin: "initial",
      backgroundColor: "initial",
      textDecoration: "none",
      borderRadius: "inherit",
      "&:focus": app.theme.focus.default,
      ...getVariantStyle(variant, color),
      "&:hover": getVariantStyle(variant, color, "hover"),
      "&:active": getVariantStyle(variant, color, "active"),
    };
    if (conditionalVariants) {
      for (let i = 0; i < conditionalVariants.length; i++) {
        const { variant, color } = conditionalVariants[i];
        Object.assign(styles, {
          [`.variant-${i} &`]: {
            ...getVariantStyle(variant, color),
            "&:hover": getVariantStyle(variant, color, "hover"),
            "&:active": getVariantStyle(variant, color, "active"),
          },
        });
      }
    }
    return styles;
  },
);

const startDecoratorSlot = createGatherSafeSlot("startDecorator", () => ({
  "--avatar-margin-left": "calc(var(--chip-decorator-child-offset) * -1)",
  "--chip-delete-margin": "0 0 0 calc(var(--chip-decorator-child-offset) * -1)",
  "--icon-margin-left": "calc(var(--chip-padding-x) / -4)",
  display: "inherit",
  marginRight: "var(--chip-gap)",
  order: 0,
  zIndex: 1,
  pointerEvents: "none",
}));

const endDecoratorSlot = createGatherSafeSlot("endDecorator", () => ({
  "--chip-delete-margin": "0 calc(var(--chip-decorator-child-offset) * -1) 0 0",
  "--icon-margin-right": "calc(var(--chip-padding-x) / -4)",
  display: "inherit",
  marginLeft: "var(--chip-gap)",
  order: 2,
  zIndex: 1,
}));

/** Props for {@link Chip}: chip-specific options plus the native `div` attributes. */
export type ChipProps = ChipBaseProps & JSX.IntrinsicElements["div"];

/**
 A customizable chip component for displaying compact information or interactive elements.

 @category UI Component

 @param props.variant
 @param props.color - Defaults to the default color (usually "primary").
 @param props.size
 @param props.clickable - Whether the chip is clickable. Defaults to false.
 @param props.selected - Configuration for the selected state of the chip.
 @param props.startDecorator - Content to be displayed at the start of the chip.
 @param props.endDecorator - Content to be displayed at the end of the chip.
 @param props.children - The main content of the chip.

 @examples
 [Example](./search_dialog.tsx)
 */
export const Chip: OverridableComponent<{
  defaultComponent: "div";
  props: ChipBaseProps;
}> = (props: ChipProps) => {
  const {
    variant = "solid",
    color = useDefaultColor("primary"),
    size = "md",
    clickable = false,
    startDecorator,
    endDecorator,
    startIcon,
    endIcon,
    children,
    conditionalVariants,
    ...other
  } = props;

  if (startIcon && startDecorator) {
    throw new Error("Cannot have both startIcon and startDecorator");
  }
  if (endIcon && endDecorator) {
    throw new Error("Cannot have both endIcon and endDecorator");
  }

  const resolvedStartDecorator = startIcon
    ? <MaterialIcon icon={startIcon} />
    : startDecorator;
  const resolvedEndDecorator = endIcon
    ? <MaterialIcon icon={endIcon} />
    : endDecorator;

  const resolvedConditionalVariants = conditionalVariants?.map((v) => ({
    when: v.when,
    variant: v.variant ?? variant,
    color: v.color ?? color,
  }));

  const ownerState: OwnerState = {
    size,
    variant,
    color,
    clickable,
    conditionalVariants: resolvedConditionalVariants,
  };
  const [RootSlot, rootProps] = rootSlot({
    component: "div",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  const [LabelSlot, labelProps] = labelSlot({
    component: "div",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [ActionSlot, actionProps] = actionSlot({
    component: "button",
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
  const dynamicClasses: DynamicClass[] = [];
  if (resolvedConditionalVariants) {
    for (let i = 0; i < resolvedConditionalVariants.length; i++) {
      dynamicClasses.push({
        classes: `variant-${i}`,
        condition: resolvedConditionalVariants[i].when,
      });
    }
  }
  return (
    <RootSlot {...rootProps} dynamicClasses={dynamicClasses}>
      {resolvedStartDecorator && (
        <StartDecoratorSlot {...startDecoratorProps}>
          {resolvedStartDecorator}
        </StartDecoratorSlot>
      )}
      <LabelSlot {...labelProps}>{children}</LabelSlot>
      {clickable && <ActionSlot {...actionProps} />}
      {resolvedEndDecorator && (
        <EndDecoratorSlot {...endDecoratorProps}>
          {resolvedEndDecorator}
        </EndDecoratorSlot>
      )}
    </RootSlot>
  );
};

interface ChipDeleteProps extends
  ComponentOpts,
  SlottedComponentBaseProps<{
    root: "button";
  }> {
  conditionalVariants?: {
    when: BooleanExpr;
    variant?: Variant;
    color?: Color;
  }[];
}

const deleteIconSlot = createGatherSafeSlot(
  "root",
  (
    app,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { variant, color, conditionalVariants } = ownerState;
    const styles: StyleObject = {
      "--icon-margin-left": "initial",
      "--icon-margin-right": "initial",
      "--icon-margin-top": "initial",
      "--icon-margin-bottom": "initial",
      pointerEvents: "visible",
      cursor: "pointer",
      width: "var(--chip-delete-size, 2rem)",
      height: "var(--chip-delete-size, 2rem)",
      borderRadius: "var(--chip-delete-radius, 50%)",
      margin: "var(--chip-delete-margin)",
      display: "inline-flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 1,
      border: "none",
      background: "none",
      padding: "0px",
      "&:focus-visible": app.theme.focus.default,
      ...getVariantStyle(variant, color),
      "&:hover": getVariantStyle(variant, color, "hover"),
      "&:active": getVariantStyle(variant, color, "active"),
    };
    if (conditionalVariants) {
      for (let i = 0; i < conditionalVariants.length; i++) {
        const { variant, color } = conditionalVariants[i];
        Object.assign(styles, {
          [`.variant-${i} &`]: {
            ...getVariantStyle(variant, color),
            "&:hover": getVariantStyle(variant, color, "hover"),
            "&:active": getVariantStyle(variant, color, "active"),
          },
        });
      }
    }
    return styles;
  },
);

/**
 * The delete affordance for a {@link Chip} — a circular icon button
 * (rendered as an "x") sized to sit inside the chip's end decorator.
 * Place it in the chip's `endDecorator` and wire its `onClick` to remove
 * the chip. `conditionalVariants` lets its color follow the parent chip's
 * conditional variant classes.
 *
 * @category UI Component
 */
export const ChipDelete: OverridableComponent<{
  defaultComponent: "button";
  props: ChipDeleteProps;
}> = (props: ChipDeleteProps) => {
  const {
    variant = "solid",
    color = "primary",
    // deno-lint-ignore no-unused-vars
    size,
    conditionalVariants,
    ...other
  } = props;
  const resolvedConditionalVariants = conditionalVariants?.map((v) => ({
    when: v.when,
    variant: v.variant ?? variant,
    color: v.color ?? color,
  }));
  const ownerState: OwnerState = {
    variant,
    color,
    size: "md", // Size is not relevant for ChipDelete
    clickable: true,
    conditionalVariants: resolvedConditionalVariants,
  };
  const [DeleteIconSlot, deleteIconProps] = deleteIconSlot({
    component: "button",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  return (
    <DeleteIconSlot {...deleteIconProps}>
      <SvgIcon>
        <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
      </SvgIcon>
    </DeleteIconSlot>
  );
};
