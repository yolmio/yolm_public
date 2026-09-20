import type { ColorPaletteProp } from "std/theme";
import type { Variant } from "std/theme";

/**
 * The set of valid `color` prop values for themed components.
 *
 * One of the standard palette names (`primary`, `neutral`, `success`,
 * `warning`, `danger`) or `"harmonize"`, which tells the component to
 * pick up colors from a surrounding harmonized container (e.g. a `Card`
 * or `Snackbar` whose own variant set `--harmonize-*` CSS variables).
 */
export type Color = ColorPaletteProp | "harmonize";
export type Size = "xs" | "sm" | "md" | "lg";
export type { Variant };

/**
 * The shared theming props (`color`, `size`, `variant`) accepted by most
 * themed components. Components extend or spread this so callers get a
 * consistent appearance API. Parameterize `TSize` to restrict the allowed
 * sizes for a particular component.
 */
export interface ComponentOpts<TSize extends Size = Size> {
  color?: Color;
  size?: TSize;
  variant?: Variant;
}
