import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import { usePhase } from "std/ui";
import type { Node } from "std/ui";
import type * as yom from "std/yom";
import type { IconName } from "./material_icon_names";
import { SvgIcon } from "./svg_icon";
import type { SvgIconColor, SvgIconFontSize } from "./svg_icon";
import type { OverridableComponent } from "./utils";
import * as YolmGenApi from "std/yolm_gen_api";

interface MaterialIconProps {
  color?: SvgIconColor;
  fontSize?: SvgIconFontSize;
  title?: Sql;
  icon: IconName;
}

const loadedIcons = new Map<IconName, Node>();

type IconNode = {
  t: "Element";
  tag: yom.AllHtmlTags;
  props: Record<yom.AllHtmlPropNames, string>;
  children: IconNode[] | IconNode;
};

function transformIconNode(node: IconNode) {
  const Element = node.tag as keyof JSX.IntrinsicElements;
  const children = Array.isArray(node.children)
    ? node.children?.map(transformIconNode)
    : typeof node.children === "object"
    ? transformIconNode(node.children)
    : undefined;
  const props = Object.entries(node.props).reduce(
    (acc, [k, v]) => {
      let fixedK = k;
      if (k === "fillrule") {
        fixedK = "fillRule";
      }
      acc[fixedK] = sql(v);
      return acc;
    },
    {} as Record<string, Sql>,
  ) as any;
  return <Element {...props}>{children}</Element>;
}

function loadIcon(name: IconName) {
  if (loadedIcons.has(name)) {
    return loadedIcons.get(name)!;
  }
  let iconData: string;
  try {
    iconData = YolmGenApi.loadRepoTextFile(
      `packages/components/material-icons/${name}.json`,
    );
    if (!iconData || iconData.length === 0) {
      console.error(
        `[MaterialIcon] Icon file for "${name}" is empty or undefined`,
      );
      throw new Error(
        `Icon file for "${name}" returned empty or undefined content`,
      );
    }
  } catch (e) {
    console.error(`[MaterialIcon] File read failed for ${name}:`, e);
    throw e;
  }
  let parsed: IconNode;
  try {
    parsed = JSON.parse(iconData);
  } catch (e) {
    console.error(`[MaterialIcon] JSON parse failed for ${name}:`, e);
    throw e;
  }
  try {
    const node = transformIconNode(parsed);
    loadedIcons.set(name, node);
    return node;
  } catch (e) {
    console.error(`[MaterialIcon] Transform failed for ${name}:`, e);
    throw e;
  }
}

/**
 A component that renders a Material Design icon.

 @category UI Component

 @param props.icon - The name of the icon to display
 @param props.title
 @param props.color
 @param props.fontSize - Font size for the icon

 @examples
 [Example](./delete_record_dialog.tsx)
*/
export const MaterialIcon: OverridableComponent<{
  defaultComponent: "svg";
  props: MaterialIconProps;
}> = (props: MaterialIconProps) => {
  if (usePhase() === "gather") {
    return;
  }
  const { icon, ...rest } = props;
  return <SvgIcon {...rest}>{loadIcon(icon)}</SvgIcon>;
};
