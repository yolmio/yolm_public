import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import type { TypographyKeys, Variant } from "std/theme";
import type { Node } from "std/ui";
import type { AllHtmlTags } from "std/yom";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";
import type { Color } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { OverridableComponent } from "./utils";

type Level = TypographyKeys | "inherit";

/** Props for {@link Typography}. */
export interface TypographyOpts extends
  SlottedComponentBaseProps<{
    root: "span";
    startDecorator: "span";
    endDecorator: "span";
  }> {
  /**
   * Typographic scale + default host tag (e.g. `h1`–`h4`, `title-*`,
   * `body-*`). `"inherit"` keeps the surrounding text styles. Default:
   * `"body-md"`.
   */
  level?: Level;
  /** Node placed after the text, separated by a gap. */
  endDecorator?: Node;
  /** Node placed before the text, separated by a gap. */
  startDecorator?: Node;
  /** Add bottom margin to space this from following block content. */
  gutterBottom?: boolean;
  /** Render inline (default host tag becomes `span`) instead of block. */
  inline?: boolean;
  /** Truncate to a single line with an ellipsis instead of wrapping. */
  noWrap?: boolean;
  /** Apply a variant background/border; only takes effect alongside `color`. */
  variant?: Variant;
  color?: Color;
  children?: Node;
  /** Material icon shorthand for {@link startDecorator}. */
  startIcon?: IconName;
  /** Material icon shorthand for {@link endDecorator}. */
  endIcon?: IconName;
}

interface OwnerState {
  level: Level;
  inline: boolean;
  noWrap: boolean;
  gutterBottom: boolean;
  color: Color | undefined;
  variant: Variant | undefined;
  hasStartDecorator: boolean;
  hasEndDecorator: boolean;
}

const root = createGatherSafeSlot(
  "root",
  (
    app,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const {
      level,
      inline,
      noWrap,
      gutterBottom,
      color,
      variant,
      hasStartDecorator,
      hasEndDecorator,
    } = ownerState;
    const styles: StyleObject = {
      "--icon-font-size": "1.25em",
      margin: 0,
      ...(inline
        ? {
          display: "inline",
        }
        : {
          fontFamily: cssVar("font-family-body"),
          display: "block",
        }),
      ...((hasEndDecorator || hasStartDecorator) && {
        display: "flex",
        alignItems: "center",
        ...(inline && {
          display: "inline-flex",
          ...(hasStartDecorator && {
            verticalAlign: "bottom",
          }),
        }),
      }),
      ...(level && level !== "inherit" && app.theme.typography[level]),
      ...(noWrap && {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }),
      ...(gutterBottom && {
        marginBottom: "0.35em",
      }),
      ...(color &&
        color !== "harmonize" && {
        color: `rgba(${cssVar(`palette-${color}-main-channel`)} / 1)`,
      }),
      ...(variant &&
        color && {
        borderRadius: cssVar("radius-xs"),
        paddingY: "min(0.15em, 4px)",
        paddingX: "0.375em",
        ...(!inline && {
          marginX: "-0.375em",
        }),
        ...getVariantStyle(variant, color),
      }),
    };
    return styles;
  },
);

const startDecoratorSlot = createGatherSafeSlot("startDecorator", () => ({
  display: "inline-flex",
  marginRight: "clamp(4px, var(--typography-gap, 0.375em), 0.75rem)",
}));

const endDecoratorSlot = createGatherSafeSlot("endDecorator", () => ({
  display: "inline-flex",
  marginLeft: "clamp(4px, var(--typography-gap, 0.375em), 0.75rem)",
}));

const tagMapping: Record<Level, AllHtmlTags> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  "title-lg": "div",
  "title-md": "div",
  "title-sm": "div",
  "body-lg": "div",
  "body-md": "div",
  "body-sm": "div",
  "body-xs": "span",
  inherit: "div",
};

/**
 Typography component for displaying text with various styles and levels.

@param props.level: set the typography level: available levels are h1, h2, h3, h4, title-lg, title-md, title-sm, body-lg, body-md, body-sm, body-xs, inherit.
@param props.color: set the text color using theme colors.
@param props.variant: styling variants like 'plain', 'outlined', or 'soft'.
@param props.startDecorator and props.endDecorator: add decorative elements.
 @param props.startIcon and props.endIcon: props to add Material icons.
@param props.noWrap: prevent text wrapping.
@param props.gutterBottom: add bottom margin.
@param props.inline: render as inline element.

Common mistakes:
- Using level: "h5". This is not a valid level. Instead, use level: "body-md".

 @category UI Component

 @examples
 [Example](./search_dialog.tsx)
*/
export const Typography: OverridableComponent<{
  defaultComponent: "span";
  props: TypographyOpts;
}> = (props: TypographyOpts) => {
  const {
    level = "body-md",
    inline = false,
    component = inline ? "span" : tagMapping[level],
    startDecorator,
    endDecorator,
    children,
    noWrap = false,
    gutterBottom = false,
    color,
    variant,
    startIcon,
    endIcon,
    ...other
  } = props;
  const resolvedStartDecorator = startIcon
    ? <MaterialIcon icon={startIcon} />
    : startDecorator;
  const resolvedEndDecorator = endIcon
    ? <MaterialIcon icon={endIcon} />
    : endDecorator;
  const ownerState: OwnerState = {
    level,
    inline,
    noWrap,
    gutterBottom,
    color,
    variant,
    hasStartDecorator: Boolean(resolvedStartDecorator),
    hasEndDecorator: Boolean(resolvedEndDecorator),
  };
  const [RootSlot, rootProps] = root({
    component: component as any,
    rootProps: props,
    externalProps: other,
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
      {resolvedStartDecorator && (
        <StartDecoratorSlot {...startDecoratorProps}>
          {resolvedStartDecorator}
        </StartDecoratorSlot>
      )}
      {children}
      {resolvedEndDecorator && (
        <EndDecoratorSlot {...endDecoratorProps}>
          {resolvedEndDecorator}
        </EndDecoratorSlot>
      )}
    </RootSlot>
  );
};
