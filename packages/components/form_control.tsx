import { FormControlICtxKey } from "std/ictx";
import type { FormControlICtx } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar } from "std/style_utils";
import { addCtx, useUniqueId } from "std/ui";
import type { ContextInstance, Node } from "std/ui";
import type { Color, Size } from "./types";
import { singleElementComponent } from "./utils";
import type {
  OverridableComponent,
  SingleElementComponentProps,
} from "./utils";

type Orientation = "horizontal" | "vertical";

interface FormControlBaseProps extends SingleElementComponentProps {
  size?: Size;
  color?: Color;
  orientation?: Orientation;
  fullWidth?: boolean;
  error?: BooleanExpr;
  children: Node;
  inputId?: Sql | string;
}

interface OwnerState {
  size: Size;
  orientation: Orientation;
  color?: Color;
  fullWidth: boolean;
}

const formControlSizeStyle = (
  size: Size,
  orientation: Orientation,
): StyleObject => {
  const sizeStyleBySize: Record<Size, StyleObject> = {
    xs: {
      "--form-label-font-size": cssVar("text-xs"),
      "--form-helper-text-font-size": cssVar("text-xs"),
      "--form-label-margin-bottom": orientation === "horizontal"
        ? "0"
        : "0.25rem",
      "--form-label-margin-right": orientation === "horizontal"
        ? "0.375rem"
        : "0",
    },
    sm: {
      "--form-label-font-size": cssVar("text-xs"),
      "--form-helper-text-font-size": cssVar("text-xs"),
      "--form-label-margin-bottom": orientation === "horizontal"
        ? "0"
        : "0.25rem",
      "--form-label-margin-right": orientation === "horizontal"
        ? "0.5rem"
        : "0",
    },
    md: {
      "--form-label-font-size": cssVar("text-sm"),
      "--form-helper-text-font-size": cssVar("text-sm"),
      "--form-label-margin-bottom": orientation === "horizontal"
        ? "0"
        : "0.25rem",
      "--form-label-margin-right": orientation === "horizontal"
        ? "0.75rem"
        : "0",
    },
    lg: {
      "--form-label-font-size": cssVar("text-base"),
      "--form-helper-text-font-size": cssVar("text-sm"),
      "--form-label-margin-bottom": orientation === "horizontal"
        ? "0"
        : "0.25rem",
      "--form-label-margin-right": orientation === "horizontal" ? "1rem" : "0",
    },
  };
  return sizeStyleBySize[size];
};

function styles(ownerState: OwnerState) {
  const { size, orientation, color, fullWidth } = ownerState;
  const styles: StyleObject = {
    "--form-label-align-self": orientation === "horizontal"
      ? "center"
      : "flex-start",
    "--form-helper-text-margin-top": "0.375rem",
    "--form-label-asterisk-color": cssVar("palette-danger-500"),
    display: "flex",
    position: "relative",
    flexDirection: orientation === "horizontal" ? "row" : "column",
  };

  if (fullWidth) {
    styles.width = "100%";
  }

  if (color && color !== "harmonize") {
    styles["--form-helper-text-color"] = cssVar(`palette-${color}-500`);
  }

  Object.assign(styles, formControlSizeStyle(size, orientation));

  return [
    styles,
    {
      "&.error": {
        "--form-helper-text-color": cssVar("palette-danger-500"),
      },
    },
  ];
}

/**
 A component that provides context and styling for form controls.

 @category UI Component

 @param props.size
 @param props.orientation - The orientation of the form control. Can be 'vertical' or 'horizontal'. Defaults to 'vertical'.
 @param props.color
 @param props.fullWidth
 @param props.error - Whether the form control is in an error state.
 @param props.children
 @examples
 [Example](../blocks/email_templates/advanced_editor.tsx)
 */
export const FormControl: OverridableComponent<{
  defaultComponent: "div";
  props: FormControlBaseProps;
}> = (props: FormControlBaseProps) => {
  const {
    size = "md",
    orientation = "vertical",
    color,
    fullWidth = false,
    error,
    children,
    inputId = useUniqueId(),
    ...rest
  } = props;
  const ownerState = { size, orientation, color, fullWidth };
  addCtx(
    new FormControlCtx(
      typeof inputId === "string" ? sql.lit`${inputId}` : inputId,
      error,
    ),
  );
  const [Root, rootProps] = singleElementComponent({
    component: "div",
    sx: styles(ownerState),
    externalProps: rest,
    internalProps: {
      dynamicClasses: [{ classes: "error", condition: error ?? false }],
    },
  });
  return <Root {...rootProps}>{children}</Root>;
};

class FormControlCtx implements ContextInstance, FormControlICtx {
  implementICtxs = [FormControlICtxKey];

  constructor(
    public id?: Sql,
    public error?: BooleanExpr,
  ) {}
}
