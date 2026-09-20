import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { cssVar } from "std/style_utils";
import type { ColorPaletteProp, Tokens } from "std/theme";
import type { Node } from "std/ui";
import { singleElementComponent } from "./utils";
import type {
  OverridableComponent,
  SingleElementComponentProps,
} from "./utils";

/** Color for {@link SvgIcon}: a palette name, `harmonize`, or `inherit` from the parent. */
export type SvgIconColor = ColorPaletteProp | "harmonize" | "inherit";
/** Size for {@link SvgIcon}: a theme font-size token, or `inherit` from the parent. */
export type SvgIconFontSize = keyof Tokens["fontSize"] | "inherit";

/** Props for {@link SvgIcon}. */
export interface SvgIconBaseProps extends SingleElementComponentProps {
  color?: SvgIconColor;
  fontSize?: SvgIconFontSize;
  /** Accessible label; when set the icon is exposed as an `img`, otherwise it is hidden from assistive tech. */
  title?: Sql | string;
  /** SVG path or group rendered inside the `<svg>` viewBox. */
  children: Node;
}

function styles(props: { color: SvgIconColor; fontSize: SvgIconFontSize }) {
  const { color, fontSize } = props;
  const styles: Style = {
    userSelect: "none",
    marginTop: "var(--icon-margin-top)",
    marginRight: "var(--icon-margin-right)",
    marginBottom: "var(--icon-margin-bottom)",
    marginLeft: "var(--icon-margin-left)",
    width: "1em",
    height: "1em",
    display: "inline-block",
    flexShrink: 0,
    transition: "fill 200ms cubic-bezier(0.4, 0, 0.2, 1) 0ms",
    fontSize: "var(--icon-font-size)",
    color: "var(--icon-color)",
    fill: "currentcolor",
  };
  if (fontSize !== "inherit") {
    (styles as any)["--icon-font-size"] = cssVar(`text-${fontSize}`);
  }
  if (color === "harmonize") {
    styles.color = "var(--harmonize-plain-color)";
  } else if (color !== "inherit") {
    styles.color = cssVar(`palette-${color}-plain-color`);
  }
  return styles;
}

/**
 A customizable SVG icon component.

 @category UI Component

 @param props.color
 @param props.fontSize - The font size of the icon. Can be a size from the theme, or 'inherit'.
 @param props.title - Optional title for the icon, used for accessibility.
 @param props.children - The SVG path or group to be rendered inside the icon.
 @param props.component - The component used for the root node. Default is 'svg'.

 @examples
 [Example](./checkbox.tsx)
*/
export const SvgIcon: OverridableComponent<{
  defaultComponent: "svg";
  props: SvgIconBaseProps;
}> = (props: SvgIconBaseProps) => {
  const {
    color = "inherit",
    fontSize = "inherit",
    title,
    children,
    component = "svg",
    ...rest
  } = props;
  const [Root, rootProps] = singleElementComponent({
    component,
    sx: styles({ color, fontSize }),
    externalProps: rest,
    internalProps: {
      viewBox: sql.lit`0 0 24 24`,
      role: title ? sql.lit`img` : undefined,
      "aria-hidden": title ? undefined : sql.lit`true`,
      focusable: sql`false`,
    },
  });
  return (
    <Root {...rootProps}>
      {children}
      {title && <title>{title}</title>}
    </Root>
  );
};
