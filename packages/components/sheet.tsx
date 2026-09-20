import { HarmonizeCtx } from "std/ictx";
import type { StyleObject } from "std/style_types";
import {
  createHarmonizeVars as createHarmonizeVarsUtil,
  createStyles,
  cssVar,
  getVariantStyle,
} from "std/style_utils";
import type { Variant } from "std/theme";
import { addCtx } from "std/ui";
import type { Node } from "std/ui";
import type { Color, ComponentOpts } from "./types";
import { singleElementComponent } from "./utils";
import type { SingleElementComponentProps } from "./utils";
import type { OverridableComponent } from "./utils";

type HarmonizeVariant = "soft" | "solid";
type ColorPaletteProp = Exclude<Color, "harmonize">;

/** Props for {@link Sheet}. Inherits variant/color but not size. */
export interface SheetProps
  extends Omit<ComponentOpts, "size">, SingleElementComponentProps {
  /**
   * Expose this surface's variant/color as harmonize CSS vars so nested
   * components with `color="harmonize"` blend with it. Only applies to
   * `soft`/`solid` variants with a non-harmonize color.
   */
  harmonize?: boolean;
  children?: Node;
}

const styles = createStyles({
  root: (_, harmonize: boolean, variant: Variant, color: Color) => {
    const styles: StyleObject = {
      backgroundColor: cssVar("palette-background-surface"),
      ...getVariantStyle(variant, color),
    };
    if (
      harmonize &&
      (variant === "soft" || variant === "solid") &&
      color !== "harmonize"
    ) {
      Object.assign(
        styles,
        createHarmonizeVarsUtil(
          variant as HarmonizeVariant,
          color as ColorPaletteProp,
        ),
      );
    }
    return styles;
  },
});

/**
 Sheet component for creating a surface container.

 This component renders a customizable sheet with various styling options.
 It supports harmonization, different variants, and color themes.

 @category UI Component

 @param props.variant
 @param props.color
 @param props.harmonize Whether to apply color harmonization
 @param props.children The content to be rendered inside the sheet

 @examples
 [Example](./date_range.tsx)
*/
export const Sheet: OverridableComponent<{
  defaultComponent: "div";
  props: SheetProps;
}> = (props: SheetProps) => {
  const {
    variant = "plain",
    color = "neutral",
    harmonize = false,
    ...other
  } = props;
  const [RootSlot, rootProps] = singleElementComponent({
    component: "div",
    sx: styles.root(harmonize, variant, color),
    externalProps: other,
  });
  if (harmonize) {
    addCtx(new HarmonizeCtx(variant, color));
  }
  return <RootSlot {...rootProps}>{props.children}</RootSlot>;
};
