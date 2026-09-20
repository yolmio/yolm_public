import { DefaultButtonVariantICtxKey } from "std/ictx";
import type { DefaultButtonVariantICtx } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { BooleanExpr } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar } from "std/style_utils";
import type { Variant } from "std/theme";
import { addCtx } from "std/ui";
import type { ICtxKey, Node } from "std/ui";
import type { ContextInstance } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { singleElementComponent } from "./utils";
import type { OverridableComponent } from "./utils";

interface ButtonGroupOpts extends ComponentOpts<Size> {
  buttonFlex?: string | number;
  disabled?: BooleanExpr;
  orientation?: "horizontal" | "vertical";
  spacing?: number;
  children: Node;
}

interface OwnerState {
  variant: Variant;
  color: Color;
  orientation: "horizontal" | "vertical";
  spacing: number | undefined;
  buttonFlex: string | number | undefined;
}

function styles(ownerState: OwnerState) {
  const { variant, color, orientation, spacing, buttonFlex } = ownerState;

  const styles: StyleObject = {
    "--button-group-separator-size": variant === "outlined"
      ? "1px"
      : "calc(var(--button-group-connected) * 1px)",
    "--button-group-separator-color": color === "harmonize"
      ? `var(--harmonize-${variant}-border)`
      : cssVar(`palette-${color}-outlined-border`),
    "--button-group-radius": cssVar("radius-sm"),
    "--divider-inset": "0.5rem",
    "--child-radius":
      "calc((1 - var(--button-group-connected)) * var(--button-group-radius) - var(--variant-border-width, 0px))",
    display: "flex",
    borderRadius: "var(--button-group-radius)",
    flexDirection: orientation === "vertical" ? "column" : "row",
    gap: spacing,
    "--button-group-connected": (spacing ?? 0) > 0
      ? (0).toString()
      : (1).toString(),
  };

  const firstChildRadius = orientation === "vertical"
    ? "var(--button-group-radius) var(--button-group-radius) var(--child-radius) var(--child-radius)"
    : "var(--button-group-radius) var(--child-radius) var(--child-radius) var(--button-group-radius)";

  const lastChildRadius = orientation === "vertical"
    ? "var(--child-radius) var(--child-radius) var(--button-group-radius) var(--button-group-radius)"
    : "var(--child-radius) var(--button-group-radius) var(--button-group-radius) var(--child-radius)";

  const margin = orientation === "vertical"
    ? {
      "--button-margin-top": "calc(var(--button-group-separator-size) * -1)",
      "--icon-button-margin-top":
        "calc(var(--button-group-separator-size) * -1)",
    }
    : {
      "--button-margin-left": "calc(var(--button-group-separator-size) * -1)",
      "--icon-button-margin-left":
        "calc(var(--button-group-separator-size) * -1)",
    };

  Object.assign(styles, {
    "& > :first-child": {
      borderRadius: firstChildRadius,
      "--button-radius": firstChildRadius,
      "--icon-button-radius": firstChildRadius,
      ...(orientation === "horizontal" && {
        borderRight:
          "var(--button-group-separator-size) solid var(--button-group-separator-color)",
      }),
      ...(orientation === "vertical" && {
        borderBottom:
          "var(--button-group-separator-size) solid var(--button-group-separator-color)",
      }),
    },
    "& > :not(:first-child):not(:last-child):not(:only-child)": {
      "--button-radius": "var(--child-radius)",
      "--icon-button-radius": "var(--child-radius)",
      borderRadius: "var(--child-radius)",
      ...(orientation === "horizontal" && {
        borderLeft:
          "var(--button-group-separator-size) solid var(--button-group-separator-color)",
        borderRight:
          "var(--button-group-separator-size) solid var(--button-group-separator-color)",
      }),
      ...(orientation === "vertical" && {
        borderTop:
          "var(--button-group-separator-size) solid var(--button-group-separator-color)",
        borderBottom:
          "var(--button-group-separator-size) solid var(--button-group-separator-color)",
      }),
    },
    "& > :last-child": {
      "--button-radius": lastChildRadius,
      "--icon-button-radius": lastChildRadius,
      ...(orientation === "horizontal" && {
        borderLeft:
          "var(--button-group-separator-size) solid var(--button-group-separator-color)",
      }),
      ...(orientation === "vertical" && {
        borderTop:
          "var(--button-group-separator-size) solid var(--button-group-separator-color)",
      }),
    },
    "& > :only-child": {
      "--button-radius": "var(--button-group-radius)",
      "--icon-button-radius": "var(--button-group-radius)",
    },
    "& > :not(:first-child):not(:only-child)": margin,
  });

  if (buttonFlex) {
    Object.assign(styles, {
      "& > *:not(.IconButton)": {
        flex: buttonFlex,
      },
      "& > :not(button) > .Button": {
        width: "100%",
      },
    });
  }

  return styles;
}

class ButtonGroupContext implements DefaultButtonVariantICtx, ContextInstance {
  implementICtxs: ICtxKey<any>[] = [DefaultButtonVariantICtxKey];

  constructor(
    public defaultVariant: Variant,
    public defaultColor: Color,
    public defaultSize: Size,
  ) {}
}

/**
 A component that groups multiple buttons together, providing consistent styling and layout.

 @category UI Component

 @param props.color
 @param props.variant
 @param props.orientation - The layout orientation of the buttons. Can be "horizontal" or "vertical". Defaults to "horizontal".
 @param props.spacing - The spacing between buttons.
 @param props.buttonFlex - The flex property for the buttons, determining how they grow or shrink.
 @param props.size
 @param props.children - The child elements (buttons) to be grouped.

 @returns The rendered ButtonGroup component.

 @examples
 [Example](../blocks/email_templates/lexical_advanced_editor.tsx)
 */
export const ButtonGroup: OverridableComponent<{
  defaultComponent: "div";
  props: ButtonGroupOpts;
}> = (props: ButtonGroupOpts) => {
  const {
    color = "neutral",
    variant = "outlined",
    orientation = "horizontal",
    spacing,
    buttonFlex,
    size = "md",
    children,
    ...rest
  } = props;
  const ownerState = { variant, color, orientation, spacing, buttonFlex };
  addCtx(new ButtonGroupContext(variant, color, size));
  const [Root, rootProps] = singleElementComponent({
    component: "div",
    sx: styles(ownerState),
    externalProps: rest,
    internalProps: {
      role: sql.lit`group`,
    },
  });
  return <Root {...rootProps}>{children}</Root>;
};
