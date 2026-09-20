import type { CssVar } from "./theme";

/** Return a CSS custom-property reference for a registered theme variable. */
export function cssVar(name: CssVar): string {
  return `var(--${name})`;
}
