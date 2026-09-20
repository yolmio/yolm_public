import { EachICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import type { Style } from "std/style_types";
import { cssVar } from "std/style_utils";
import type { App } from "std/system";
import { Show, useApp, useICtx, usePhase } from "std/ui";
import type { Node } from "std/ui";
import { singleElementComponent } from "./utils";
import type { SingleElementComponentProps } from "./utils";
import type { OverridableComponent } from "./utils";

type Orientation = "vertical" | "horizontal";
type Inset = "none" | "context";

interface DividerBaseProps extends SingleElementComponentProps {
  orientation?: Orientation;
  inset?: Inset;
  role?: "separator" | "presentation";
  hideOnFirstEach?: boolean;
  children?: Node;
}

function styles(
  _app: App,
  props: {
    orientation: Orientation;
    hasChildren: boolean;
    inset: Inset | undefined;
  },
) {
  const { orientation, hasChildren, inset } = props;
  const styles: Style = {
    "--divider-thickness": "1px",
    "--divider-line-color": cssVar("palette-divider"),
    margin: "initial", // reset margin for `hr` tag
    marginX: orientation === "vertical" ? "initial" : "var(--divider-inset)",
    marginY: orientation === "vertical" ? "var(--divider-inset)" : "initial",
    position: "relative",
    alignSelf: "stretch",
    flexShrink: 0,
  };
  switch (inset) {
    case "none": {
      styles["--divider-inset"] = "0px";
      break;
    }
    case "context": {
      styles["--divider-inset"] = "var(--divider-inset, 0px)";
      break;
    }
  }
  if (hasChildren) {
    Object.assign(styles, {
      "--divider-gap": 2,
      "--divider-child-position": "50%",
      display: "flex",
      flexDirection: orientation === "vertical" ? "column" : "row",
      alignItems: "center",
      whiteSpace: "nowrap",
      textAlign: "center",
      border: 0,
      fontFamily: cssVar("font-family-body"),
      fontSize: cssVar("text-sm"),
      "&::before, &::after": {
        position: "relative",
        inlineSize: orientation === "vertical"
          ? "var(--divider-thickness)"
          : "initial",
        blockSize: orientation === "vertical"
          ? "initial"
          : "var(--divider-thickness)",
        backgroundColor: "var(--divider-line-color)", // use logical size + background is better than border because they work with gradient.
        content: '""',
      },
      "&::before": {
        marginRight: orientation === "vertical"
          ? "initial"
          : "min(var(--divider-child-position) * 999, var(--divider-gap))",
        marginBottom: orientation === "vertical"
          ? "min(var(--divider-child-position) * 999, var(--divider-gap))"
          : "initial",
        flexBasis: "var(--divider-child-position)",
      },
      "&::after": {
        marginLeft: orientation === "vertical"
          ? "initial"
          : "min((100% - var(--divider-child-position)) * 999, var(--divider-gap))",
        marginTop: orientation === "vertical"
          ? "min((100% - var(--divider-child-position)) * 999, var(--divider-gap))"
          : "initial",
        flexBasis: "calc(100% - var(--divider-child-position))",
      },
    });
  } else {
    Object.assign(styles, {
      border: "none", // reset the border for `hr` tag
      listStyle: "none",
      backgroundColor: "var(--divider-line-color)", // use logical size + background is better than border because they work with gradient.
      inlineSize: orientation === "vertical"
        ? "var(--divider-thickness)"
        : "initial",
      blockSize: orientation === "vertical"
        ? "initial"
        : "var(--divider-thickness)",
    });
  }
  return styles;
}

/**
 A component that renders a divider line with optional content.

 @category UI Component

 @param props.orientation - The orientation of the divider. Can be 'horizontal' or 'vertical'. Defaults to 'horizontal'.
 @param props.inset - Determines if the divider should be inset.
 @param props.children - Content to be rendered within the divider.
 @param props.component - The component to render. Defaults to 'div' if children are provided, otherwise 'hr'.
 @param props.role - The ARIA role for the divider. Defaults to 'separator' if no children are provided.
 @param props.hideOnFirstEach - If true, hides the divider on the first iteration when used within an Each component.

 */
export const Divider: OverridableComponent<{
  defaultComponent: "hr";
  props: DividerBaseProps;
}> = (props: DividerBaseProps) => {
  if (usePhase() === "gather") {
    return props.children;
  }
  const {
    orientation = "horizontal",
    inset,
    children,
    component = children ? "div" : "hr",
    role = children ? undefined : "separator",
    hideOnFirstEach = false,
    ...rest
  } = props;
  const app = useApp();
  const [Root, rootProps] = singleElementComponent({
    component,
    sx: styles(app, { orientation, inset, hasChildren: Boolean(children) }),
    externalProps: rest,
    internalProps: {
      role: role ? sql.lit(role) : undefined,
      "aria-orientation": role === "separator" && orientation === "vertical"
        ? sql.lit`vertical`
        : undefined,
    },
  });
  if (hideOnFirstEach) {
    const ctx = useICtx(EachICtxKey);
    return (
      <Show when={sql`${sql.ref(ctx.eachRecordName)}.iteration_index != 0`}>
        <Root {...rootProps}>{children}</Root>
      </Show>
    );
  }
  return <Root {...rootProps}>{children}</Root>;
};
