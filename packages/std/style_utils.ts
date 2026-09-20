import type { Style, StyleObject } from "./style_types";
import type { App } from "./system";
import type { ColorPaletteProp, Variant } from "./theme";
import { lazyPerApp, memoizePerApp } from "./utils/memoize";
import type { AppFunc, RestOfAppFuncArgs } from "./utils/memoize";
export { cssVar } from "./css_var";
import { cssVar } from "./css_var";

/**
 * Returns a `var(--{name})` CSS expression for one of Yolm's themed CSS
 * variables.
 *
 * The `CssVar` type is an enumeration of the variables Yolm registers on
 * `:root` (palette colors, spacing, radii, shadows, etc.) — autocomplete
 * lists every valid name. Use this any time you need to reference a
 * themed value from inline styles or a custom CSS rule.
 *
 * @example
 * import { cssVar } from "std/style_utils";
 *
 * const styles = {
 *   color: cssVar("palette-primary-700"),
 *   borderRadius: cssVar("radius-md"),
 * };
 */
/** Interaction state selector for variant styling. */
export type VariantState = "hover" | "disabled" | "active";

/**
 * Returns the color/background (and border, for `outlined`) for a themed
 * component given its `variant`, `color`, and optional interaction `state`,
 * as CSS-variable references. Pass `"harmonize"` to pull from the
 * harmonized palette instead of a named color.
 */
export function getVariantStyle(
  variant: Variant,
  color: ColorPaletteProp | "harmonize",
  state?: VariantState,
): StyleObject {
  const stateStr = typeof state === "string" ? `-${state}` : "";
  const props: any = {};
  if (color === "harmonize") {
    props.color = `var(--harmonize-${variant}${stateStr}-color)`;
    props.backgroundColor = `var(--harmonize-${variant}${stateStr}-bg)`;
  } else {
    props.color = `var(--palette-${color}-${variant}${stateStr}-color)`;
    props.backgroundColor = `var(--palette-${color}-${variant}${stateStr}-bg)`;
  }
  if (state === "hover") {
    props.cursor = "pointer";
  }
  if (variant === "outlined") {
    props["--variant-border-width"] = "1px";
    props.border = "var(--variant-border-width) solid";
    if (color === "harmonize") {
      props.borderColor = `var(--harmonize-${variant}${stateStr}-border)`;
    } else {
      props.borderColor =
        `var(--palette-${color}-${variant}${stateStr}-border)`;
    }
  }
  return props;
}

/**
 * Builds the full set of `--harmonize-*` and `--palette-*` CSS variables for
 * a harmonized surface, dispatching to the soft or solid variant generator.
 * Apply on a container so descendants using `color="harmonize"` pick them up.
 */
export function createHarmonizeVars(
  variant: "soft" | "solid",
  color: ColorPaletteProp,
) {
  return variant === "soft"
    ? createSoftHarmonizeVars(color)
    : createSolidHarmonizeVars(color);
}

const resetLightVars = {
  "--badge-ring-color": "var(--badge-ring-color-light) !important",
  "--palette-focus-visible": "var(--palette-focus-visible-light)",
  "--palette-background-body": "var(--palette-background-body-light)",
  "--palette-background-surface":
    "var(--palette-background-surface-light) !important",
  "--palette-background-popup": "var(--palette-background-popup-light)",
  "--palette-background-level1": "var(--palette-background-level1-light)",
  "--palette-background-level2": "var(--palette-background-level2-light)",
  "--palette-background-level3": "var(--palette-background-level3-light)",
  "--palette-text-primary": "var(--palette-text-primary-light)",
  "--palette-text-secondary": "var(--palette-text-secondary-light)",
  "--palette-text-tertiary": "var(--palette-text-tertiary-light)",
  "--palette-divider": "var(--palette-divider-light)",
};

const resetDarkVars = {
  "--badge-ring-color": "var(--badge-ring-color-dark)",
  "--palette-focus-visible": "var(--palette-focus-visible-dark)",
  "--palette-background-body": "var(--palette-background-body-dark)",
  "--palette-background-popup": "var(--palette-background-popup-dark)",
  "--palette-background-surface": "var(--palette-background-surface-dark)",
  "--palette-background-level1": "var(--palette-background-level1-dark)",
  "--palette-background-level2": "var(--palette-background-level2-dark)",
  "--palette-background-level3": "var(--palette-background-level3-dark)",
  "--palette-text-primary": "var(--palette-text-primary-dark)",
  "--palette-text-secondary": "var(--palette-text-secondary-dark)",
  "--palette-text-tertiary": "var(--palette-text-tertiary-dark)",
  "--palette-divider": "var(--palette-divider-dark)",
};

/**
 * Generates the harmonize CSS variables for a `soft` surface of `color`,
 * including light/dark overrides. Prefer {@link createHarmonizeVars}.
 */
export function createSoftHarmonizeVars(color: ColorPaletteProp): StyleObject {
  return {
    "--badge-ring-color": cssVar(`palette-${color}-soft-bg`),
    light: {
      "--palette-focus-visible": cssVar(`palette-${color}-500`),
      "--palette-background-body": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.1)`,
      "--palette-background-surface": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.08)`,
      "--palette-background-level1": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.2)`,
      "--palette-background-level2": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.32)`,
      "--palette-background-level3": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.48)`,
      "--palette-text-primary": cssVar(`palette-${color}-700`),
      "--palette-text-secondary": `rgba(${
        cssVar(
          `palette-${color}-dark-channel`,
        )
      } / 0.8)`,
      "--palette-text-tertiary": `rgba(${
        cssVar(
          `palette-${color}-dark-channel`,
        )
      } / 0.68)`,
      "--palette-divider": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.32)`,
      "& .skip-harmonize": resetLightVars,

      "--harmonize-plain-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 1)`,
      "--harmonize-plain-bg": "transparent",
      "--harmonize-plain-hover-color": cssVar(`palette-${color}-600`),
      "--harmonize-plain-hover-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.12)`,
      "--harmonize-plain-active-color": cssVar(`palette-${color}-600`),
      "--harmonize-plain-active-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.24)`,
      "--harmonize-plain-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.6)`,
      "--harmonize-plain-disabled-bg": "transparent",

      "--harmonize-outlined-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 1)`,
      "--harmonize-outlined-border": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.4)`,
      "--harmonize-outlined-bg": "transparent",
      "--harmonize-outlined-hover-color": cssVar(`palette-${color}-600`),
      "--harmonize-outlined-hover-border": cssVar(`palette-${color}-300`),
      "--harmonize-outlined-hover-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.12)`,
      "--harmonize-outlined-active-color": cssVar(`palette-${color}-600`),
      "--harmonize-outlined-active-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.24)`,
      "--harmonize-outlined-active-border": cssVar(`palette-${color}-300`),
      "--harmonize-outlined-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.6)`,
      "--harmonize-outlined-disabled-border": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.12)`,
      "--harmonize-outlined-disabled-bg": "transparent",

      "--harmonize-soft-color": cssVar(`palette-${color}-600`),
      "--harmonize-soft-bg": `rgba(${
        cssVar(
          `palette-${color}-light-channel`,
        )
      } / 0.72)`,
      "--harmonize-soft-hover-color": cssVar(`palette-${color}-700`),
      "--harmonize-soft-hover-bg": cssVar(`palette-${color}-200`),
      "--harmonize-soft-active-bg": cssVar(`palette-${color}-300`),
      "--harmonize-soft-active-color": cssVar(`palette-${color}-700`),
      "--harmonize-soft-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.6)`,
      "--harmonize-soft-disabled-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.08)`,

      "--harmonize-solid-color": cssVar("palette-common-white"),
      "--harmonize-solid-bg": cssVar(`palette-${color}-600`),
      "--harmonize-solid-hover-color": cssVar("palette-common-white"),
      "--harmonize-solid-hover-bg": cssVar(`palette-${color}-700`),
      "--harmonize-solid-active-color": cssVar("palette-common-white"),
      "--harmonize-solid-active-bg": cssVar(`palette-${color}-800`),
      "--harmonize-solid-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.6)`,
      "--harmonize-solid-disabled-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.08)`,
    },
    dark: {
      "--palette-focusVisible": cssVar(`palette-${color}-300`),
      "--palette-background-body": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.1)`,
      "--palette-background-surface": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.08)`,
      "--palette-background-level1": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.2)`,
      "--palette-background-level2": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.4)`,
      "--palette-background-level3": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.6)`,
      "--palette-text-primary": cssVar(`palette-${color}-100`),
      "--palette-text-secondary": `rgba(${
        cssVar(
          `palette-${color}-light-channel`,
        )
      } / 0.72)`,
      "--palette-text-tertiary": `rgba(${
        cssVar(
          `palette-${color}-light-channel`,
        )
      } / 0.6)`,
      "--palette-divider": `rgba(${
        cssVar(
          `palette-${color}-light-channel`,
        )
      } / 0.2)`,
      "& .skip-harmonize": resetDarkVars,

      "--harmonize-plain-color": `rgba(${
        cssVar(
          `palette-${color}-light-channel`,
        )
      } / 1)`,
      "--harmonize-plain-bg": "transparent",
      "--harmonize-plain-hover-color": cssVar(`palette-${color}-50`),
      "--harmonize-plain-hover-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.16)`,
      "--harmonize-plain-active-color": cssVar(`palette-${color}-50`),
      "--harmonize-plain-active-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.32)`,
      "--harmonize-plain-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.72)`,
      "--harmonize-plain-disabled-bg": "transparent",

      "--harmonize-outlined-color": `rgba(${
        cssVar(
          `palette-${color}-light-channel`,
        )
      } / 1)`,
      "--harmonize-outlined-bg": "initial",
      "--harmonize-outlined-border": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.4)`,
      "--harmonize-outlined-hover-color": cssVar(`palette-${color}-50`),
      "--harmonize-outlined-hover-border": cssVar(`palette-${color}-600`),
      "--harmonize-outlined-hover-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.16)`,
      "--harmonize-outlined-active-color": cssVar(`palette-${color}-50`),
      "--harmonize-outlined-active-border": cssVar(`palette-${color}-600`),
      "--harmonize-outlined-active-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.32)`,
      "--harmonize-outlined-disabled-bg": "transparent",
      "--harmonize-outlined-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.72)`,
      "--harmonize-outlined-disabled-border": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.2)`,

      "--harmonize-soft-color": cssVar(`palette-${color}-100`),
      "--harmonize-soft-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.24)`,
      "--harmonize-soft-hover-color": "#fff",
      "--harmonize-soft-hover-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.32)`,
      "--harmonize-soft-active-color": "#fff",
      "--harmonize-soft-active-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.48)`,
      "--harmonize-soft-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.72)`,
      "--harmonize-soft-disabled-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.12)`,

      "--harmonize-solid-color": "#fff",
      "--harmonize-solid-bg": cssVar(`palette-${color}-500`),
      "--harmonize-solid-hover-color": "#fff",
      "--harmonize-solid-hover-bg": cssVar(`palette-${color}-500`),
      "--harmonize-solid-active-color": "#fff",
      "--harmonize-solid-active-bg": cssVar(`palette-${color}-600`),
      "--harmonize-solid-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.72)`,
      "--harmonize-solid-disabled-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.12)`,
    },
  };
}

/**
 * Generates the harmonize CSS variables for a `solid` surface of `color`,
 * including light/dark overrides (with a special case for `warning`, which
 * uses dark text on its light fill). Prefer {@link createHarmonizeVars}.
 */
export function createSolidHarmonizeVars(color: ColorPaletteProp): StyleObject {
  if (color === "warning") {
    return {
      "--badge-ring-color": cssVar(`palette-${color}-solid-bg`),
      "--palette-focus-visible": cssVar(`palette-${color}-700`),
      "--palette-background-body": `rgba(${
        cssVar(
          `palette-${color}-dark-channel`,
        )
      } / 0.16)`,
      "--palette-background-surface": `rgba(${
        cssVar(
          `palette-${color}-dark-channel`,
        )
      } / 0.1)`,
      "--palette-background-popup": cssVar(`palette-${color}-100`),
      "--palette-background-level1": `rgba(${
        cssVar(
          `palette-${color}-dark-channel`,
        )
      } / 0.2)`,
      "--palette-background-level2": `rgba(${
        cssVar(
          `palette-${color}-dark-channel`,
        )
      } / 0.36)`,
      "--palette-background-level3": `rgba(${
        cssVar(
          `palette-${color}-dark-channel`,
        )
      } / 0.6)`,
      "--palette-text-primary": cssVar(`palette-${color}-900`),
      "--palette-text-secondary": cssVar(`palette-${color}-700`),
      "--palette-text-tertiary": cssVar(`palette-${color}-500`),
      "--palette-divider": `rgba(${
        cssVar(
          `palette-${color}-dark-channel`,
        )
      } / 0.2)`,
      light: {
        "& .skip-harmonize": resetLightVars,
      },
      dark: {
        "& .skip-harmonize": resetDarkVars,
      },

      "--harmonize-plain-bg": "transparent",
      "--harmonize-plain-color": cssVar(`palette-${color}-700`),
      "--harmonize-plain-hover-color": cssVar(`palette-${color}-800`),
      "--harmonize-plain-hover-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.12)`,
      "--harmonize-plain-active-color": cssVar(`palette-${color}-800`),
      "--harmonize-plain-active-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.32)`,
      "--harmonize-plain-disabled-bg": "transparent",
      "--harmonize-plain-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.72)`,

      "--harmonize-outlined-bg": "transparent",
      "--harmonize-outlined-color": cssVar(`palette-${color}-700`),
      "--harmonize-outlined-border": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.5)`,
      "--harmonize-outlined-hover-color": cssVar(`palette-${color}-800`),
      "--harmonize-outlined-hover-border": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.6)`,
      "--harmonize-outlined-hover-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.12)`,
      "--harmonize-outlined-active-color": cssVar(`palette-${color}-800`),
      "--harmonize-outlined-active-border": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.6)`,
      "--harmonize-outlined-active-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.32)`,
      "--harmonize-outlined-disabled-bg": "transparent",
      "--harmonize-outlined-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.72)`,
      "--harmonize-outlined-disabled-border": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.2)`,

      "--harmonize-soft-color": cssVar(`palette-${color}-800`),
      "--harmonize-soft-hover-color": cssVar(`palette-${color}-900`),
      "--harmonize-soft-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.2)`,
      "--harmonize-soft-hover-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.28)`,
      "--harmonize-soft-active-color": cssVar(`palette-${color}-900`),
      "--harmonize-soft-active-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.12)`,
      "--harmonize-soft-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.72)`,
      "--harmonize-soft-disabled-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.08)`,

      "--harmonize-solid-color": "#fff",
      "--harmonize-solid-bg": cssVar(`palette-${color}-700`),
      "--harmonize-solid-hover-color": "#fff",
      "--harmonize-solid-hover-bg": cssVar(`palette-${color}-800`),
      "--harmonize-solid-active-color": "#fff",
      "--harmonize-solid-active-bg": cssVar(`palette-${color}-600`),
      "--harmonize-solid-disabled-color": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.72)`,
      "--harmonize-solid-disabled-bg": `rgba(${
        cssVar(
          `palette-${color}-main-channel`,
        )
      } / 0.08)`,
    };
  }
  return {
    "--badge-ring-color": cssVar(`palette-${color}-solid-bg`),
    "--palette-focus-visible": cssVar(`palette-${color}-200`),
    "--palette-background-body": "rgba(0 0 0 / 0.1)",
    "--palette-background-surface": "rgba(0 0 0 / 0.06)",
    "--palette-background-popup": cssVar(`palette-${color}-700`),
    "--palette-background-level1": `rgba(${
      cssVar(
        `palette-${color}-dark-channel`,
      )
    } / 0.2)`,
    "--palette-background-level2": `rgba(${
      cssVar(
        `palette-${color}-dark-channel`,
      )
    } / 0.36)`,
    "--palette-background-level3": `rgba(${
      cssVar(
        `palette-${color}-dark-channel`,
      )
    } / 0.6)`,
    "--palette-text-primary": cssVar("palette-common-white"),
    "--palette-text-secondary": cssVar(`palette-${color}-100`),
    "--palette-text-tertiary": cssVar(`palette-${color}-200`),
    "--palette-divider": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.32)`,
    light: {
      "& .skip-harmonize": resetLightVars,
    },
    dark: {
      "& .skip-harmonize": resetDarkVars,
    },

    "--harmonize-plain-bg": "transparent",
    "--harmonize-plain-color": cssVar(`palette-${color}-50`),
    "--harmonize-plain-hover-color": "#fff",
    "--harmonize-plain-hover-bg": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.12)`,
    "--harmonize-plain-active-color": "#fff",
    "--harmonize-plain-active-bg": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.32)`,
    "--harmonize-plain-disabled-bg": "transparent",
    "--harmonize-plain-disabled-color": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.72)`,

    "--harmonize-outlined-color": cssVar(`palette-${color}-50`),
    "--harmonize-outlined-bg": "transparent",
    "--harmonize-outlined-border": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.5)`,
    "--harmonize-outlined-hover-color": "#fff",
    "--harmonize-outlined-hover-border": cssVar(`palette-${color}-300`),
    "--harmonize-outlined-hover-bg": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.12)`,
    "--harmonize-outlined-active-color": "#fff",
    "--harmonize-outlined-active-border": cssVar(`palette-${color}-300`),
    "--harmonize-outlined-active-bg": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.32)`,
    "--harmonize-outlined-disabled-bg": "transparent",
    "--harmonize-outlined-disabled-color": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.72)`,
    "--harmonize-outlined-disabled-border": "rgba(255 255 255 / 0.2)",

    "--harmonize-soft-color": cssVar("palette-common-white"),
    "--harmonize-soft-hover-color": cssVar("palette-common-white"),
    "--harmonize-soft-bg": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.24)`,
    "--harmonize-soft-hover-bg": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.36)`,
    "--harmonize-soft-active-color": cssVar("palette-common-white"),
    "--harmonize-soft-active-bg": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.16)`,
    "--harmonize-soft-disabled-color": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.72)`,
    "--harmonize-soft-disabled-bg": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.1)`,

    "--harmonize-solid-color": cssVar(`palette-${color}-700`),
    "--harmonize-solid-bg": cssVar("palette-common-white"),
    "--harmonize-solid-hover-color": cssVar(`palette-${color}-900`),
    "--harmonize-solid-hover-bg": cssVar(`palette-${color}-100`),
    "--harmonize-solid-active-color": cssVar(`palette-${color}-900`),
    "--harmonize-solid-active-bg": cssVar(`palette-${color}-200`),
    "--harmonize-solid-disabled-color": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.72)`,
    "--harmonize-solid-disabled-bg": `rgba(${
      cssVar(
        `palette-${color}-light-channel`,
      )
    } / 0.1)`,
  };
}

//

/**
 * Responsive centered-container styles (full-width with breakpoint-scaled
 * horizontal padding, capped at the `xl` breakpoint). Computed once per app.
 */
export const containerStyles = lazyPerApp((app) => {
  return {
    width: "100%",
    mx: "auto",
    p: 2,
    sm: {
      px: 4,
    },
    md: {
      px: 6,
    },
    lg: {
      px: 10,
    },
    xl: {
      px: 12,
      maxWidth: app.theme.tokens.breakpoints.xl,
    },
  };
});

/** Standard 12-column CSS grid container styles. */
export const baseGridStyles: StyleObject = {
  display: "grid",
  gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
};
/** `flex-grow: 1` — fills available space in a flex layout. */
export const flexGrowStyles: StyleObject = { flexGrow: 1 };
/**
 * Hides an element visually while keeping it accessible to screen readers
 * (the standard "visually hidden" technique). Use for off-screen labels.
 */
export const visuallyHiddenStyles: StyleObject = {
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
  "&:not(caption)": {
    position: "absolute",
  },
};

/**
 * Input map for {@link createStyles}: each entry is either a static
 * {@link Style} or a function of the current `App` (plus extra args) that
 * returns one.
 */
export type Styles = Record<
  string,
  Style | ((app: App, ...args: any[]) => Style)
>;

type WithoutApp<T> = {
  [K in keyof T]: T[K] extends AppFunc
    ? (...args: RestOfAppFuncArgs<T[K]>) => StyleObject
    : StyleObject;
};

/**
 * Defines a named collection of reusable styles. App-dependent entries
 * (functions taking `App`) are memoized per app, so callers invoke them
 * without passing the app; static entries pass through unchanged.
 *
 * @example
 * const styles = createStyles({
 *   card: { p: 2, borderRadius: "md" },
 *   accent: (app) => ({ color: cssVar("palette-primary-500") }),
 * });
 * // usage: styles.card, styles.accent()
 */
export function createStyles<T extends Styles>(styles: T): WithoutApp<T> {
  const output = {} as Record<string, any>;
  for (const [key, value] of Object.entries(styles)) {
    if (typeof value === "function") {
      output[key] = memoizePerApp(value);
    } else {
      output[key] = value;
    }
  }
  return output as WithoutApp<T>;
}

/** Registered `opacity 0 → 1` keyframes; resolves to the animation name. */
export const fadeIn = lazyPerApp((app) =>
  app.registerKeyframes({
    from: {
      opacity: 0,
    },
    to: {
      opacity: 1,
    },
  })
);

/** Registered `opacity 1 → 0` keyframes; resolves to the animation name. */
export const fadeOut = lazyPerApp((app) =>
  app.registerKeyframes({
    from: {
      opacity: 1,
    },
    to: {
      opacity: 0,
    },
  })
);
