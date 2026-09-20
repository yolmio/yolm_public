import type { StyleObject } from "./style_types";
import { cssVar } from "./style_utils";
import type { App } from "./system";
import type { ColorScheme, Theme } from "./theme";

export function rootStyles(app: App): StyleObject {
  const { theme } = app;
  const rootVars = getRootVariables(theme);

  // Apply color scheme variables
  if (app.colorSchemeType === "light") {
    Object.assign(rootVars, getColorSchemeVariables(theme.lightColorScheme));
    rootVars.colorScheme = "light";
  } else if (app.colorSchemeType === "dark") {
    Object.assign(rootVars, getColorSchemeVariables(theme.darkColorScheme));
    rootVars.colorScheme = "dark";
  }

  // Handle responsive color scheme
  let colorSchemeCss = {};
  if (app.colorSchemeType === "cookie") {
    colorSchemeCss = {
      "@media (prefers-color-scheme: dark)": {
        ":root:not(.light)": {
          ...getColorSchemeVariables(theme.darkColorScheme),
          colorScheme: "dark",
        },
      },
      ":root:is(.dark)": {
        ...getColorSchemeVariables(theme.darkColorScheme),
        colorScheme: "dark",
      },
      "@media (prefers-color-scheme: light)": {
        ":root:not(.dark)": {
          ...getColorSchemeVariables(theme.lightColorScheme),
          colorScheme: "light",
        },
      },
      ":root:is(.light)": {
        ...getColorSchemeVariables(theme.lightColorScheme),
        colorScheme: "light",
      },
    };
  }

  // Combine preflight styles with custom styles
  return {
    // Root variables
    ":root": rootVars,
    ...colorSchemeCss,

    ":root.resizing": {
      userSelect: "none",
    },

    // Preflight CSS + custom styles
    "*,::after,::before,::backdrop,::file-selector-button": {
      boxSizing: "border-box",
      margin: 0,
      padding: 0,
      border: "0 solid",
    },

    "html,:host": {
      lineHeight: 1.5,
      WebkitTextSizeAdjust: "100%",
      tabSize: 4,
      fontFamily: cssVar("font-sans"),
      fontFeatureSettings: "normal",
      fontVariationSettings: "normal",
      WebkitTapHighlightColor: "transparent",
      // Keep the original styles
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
      boxSizing: "border-box",
      height: "100%",
      width: "100%",
    },

    hr: {
      height: 0,
      color: "inherit",
      borderTopWidth: "1px",
    },

    "abbr:where([title])": {
      WebkitTextDecoration: "underline dotted",
      textDecoration: "underline dotted",
    },

    "h1,h2,h3,h4,h5,h6": {
      fontSize: "inherit",
      fontWeight: "inherit",
    },

    a: {
      color: "inherit",
      textDecoration: "inherit",
    },

    "b,strong": {
      fontWeight: "bolder",
    },

    "code,kbd,samp,pre": {
      fontFamily: cssVar("font-mono"),
      fontFeatureSettings: "normal",
      fontVariationSettings: "normal",
      fontSize: "1em",
    },

    small: {
      fontSize: "80%",
    },

    "sub,sup": {
      fontSize: "75%",
      lineHeight: 0,
      position: "relative",
      verticalAlign: "baseline",
    },

    sub: {
      bottom: "-0.25em",
    },

    sup: {
      top: "-0.5em",
    },

    table: {
      textIndent: 0,
      borderColor: "inherit",
      borderCollapse: "collapse",
    },

    ":-moz-focusring": {
      outline: "auto",
    },

    progress: {
      verticalAlign: "baseline",
    },

    summary: {
      display: "list-item",
    },

    "ol,ul,menu": {
      listStyle: "none",
    },

    "img,svg,video,canvas,audio,iframe,embed,object": {
      display: "block",
      verticalAlign: "middle",
    },

    "img,video": {
      maxWidth: "100%",
      height: "auto",
    },

    "button,input,select,optgroup,textarea,::file-selector-button": {
      font: "inherit",
      fontFeatureSettings: "inherit",
      fontVariationSettings: "inherit",
      letterSpacing: "inherit",
      color: "inherit",
      borderRadius: 0,
      backgroundColor: "transparent",
      opacity: 1,
    },

    ":where(select:is([multiple], [size])) optgroup": {
      fontWeight: "bolder",
    },

    ":where(select:is([multiple], [size])) optgroup option": {
      paddingInlineStart: "20px",
    },

    "::file-selector-button": {
      marginInlineEnd: "4px",
    },

    "::placeholder": {
      opacity: 1,
    },

    "@supports (not (-webkit-appearance: -apple-pay-button)) or (contain-intrinsic-size: 1px)":
      {
        "::placeholder": {
          color: "color-mix(in oklab, currentcolor 50%, transparent)",
        },
      },

    textarea: {
      resize: "vertical",
    },

    "::-webkit-search-decoration": {
      WebkitAppearance: "none",
    },

    "::-webkit-date-and-time-value": {
      minHeight: "1lh",
      textAlign: "inherit",
    },

    "::-webkit-datetime-edit": {
      display: "inline-flex",
    },

    "::-webkit-datetime-edit-fields-wrapper": {
      padding: 0,
    },

    "::-webkit-datetime-edit,::-webkit-datetime-edit-year-field,::-webkit-datetime-edit-month-field,::-webkit-datetime-edit-day-field,::-webkit-datetime-edit-hour-field,::-webkit-datetime-edit-minute-field,::-webkit-datetime-edit-second-field,::-webkit-datetime-edit-millisecond-field,::-webkit-datetime-edit-meridiem-field":
      {
        paddingBlock: 0,
      },

    ":-moz-ui-invalid": {
      boxShadow: "none",
    },

    "button,input:where([type='button'], [type='reset'], [type='submit']),::file-selector-button":
      {
        appearance: "button",
      },

    "::-webkit-inner-spin-button,::-webkit-outer-spin-button": {
      height: "auto",
    },

    "[hidden]:where(:not([hidden='until-found']))": {
      display: "none !important",
    },

    // Original custom styles
    "*, *::before, *::after": {
      boxSizing: "inherit",
    },

    body: {
      margin: 0,
      height: "100%",
      width: "100%",
      color: cssVar("palette-text-primary"),
      backgroundColor: cssVar("palette-background-body"),
      ...theme.typography["body-md"],
      "&::backdrop": {
        backgroundColor: cssVar("palette-background-backdrop"),
      },
    },

    "#yolm-app-container": {
      height: "100%",
      width: "100%",
      display: "flex",
      flexDirection: "column",
    },

    "html::view-transition-group(root)": {
      animationDuration: cssVar("transition-duration-navigation"),
      animationTimingFunction: cssVar("transition-easing-navigation"),
    },

    'html[data-yolm-transition-type*="navigate"]::view-transition-new(root)': {
      animationName: app.registerKeyframes({
        from: {
          opacity: 0,
        },
        to: {
          opacity: 1,
        },
      }),
      mixBlendMode: "plus-lighter",
    },

    'html[data-yolm-transition-type*="navigate"]::view-transition-old(root)': {
      animationName: app.registerKeyframes({
        from: {
          opacity: 1,
        },
        to: {
          opacity: 0,
        },
      }),
      mixBlendMode: "plus-lighter",
    },
  };
}

function getRootVariables(theme: Theme) {
  const styles: Record<string, string> = {
    "--focus-thickness": theme.focus.thickness,
    "--font-family-display": theme.fontFamily.display,
    "--font-family-body": theme.fontFamily.body,
    "--font-family-code": theme.fontFamily.code,
    "--font-family-fallback": theme.fontFamily.fallback,
  };

  // Add token variables
  addTokenVars(styles, theme.tokens);

  // Add transition variables
  addSimpleVars(styles, "--transition-duration-", theme.transitionDurations);
  addSimpleVars(styles, "--transition-easing-", theme.transitionEasing);

  // Add light/dark mode variants
  const lightVars = getColorSchemeVariables(theme.lightColorScheme);
  for (const [key, value] of Object.entries(lightVars)) {
    styles[`${key}-light`] = value;
  }

  const darkVars = getColorSchemeVariables(theme.darkColorScheme);
  for (const [key, value] of Object.entries(darkVars)) {
    styles[`${key}-dark`] = value;
  }

  return styles;
}

function addTokenVars(target: Record<string, string>, tokens: Theme["tokens"]) {
  // Add all other token variables
  addSimpleVars(target, "--breakpoint-", tokens.breakpoints);
  addSimpleVars(target, "--container-", tokens.containers);
  addSimpleVars(target, "--font-", tokens.fontFamily);
  addSimpleVars(target, "--text-", tokens.fontSize);
  addSimpleVars(target, "--font-weight-", tokens.fontWeight);
  addSimpleVars(target, "--tracking-", tokens.letterSpacing);
  for (const [key, value] of Object.entries(tokens.lineHeight)) {
    target[`--text-${key}--line-height`] = value;
  }
  addSimpleVars(target, "--radius-", tokens.borderRadius);

  // Add shadow tokens
  for (const [key, value] of Object.entries(tokens.shadow)) {
    if (key === "inset") {
      for (const [insetKey, insetValue] of Object.entries(value)) {
        target[`--shadow-inset-${insetKey}`] = insetValue as string;
      }
    } else {
      target[`--shadow-${key}`] = value;
    }
  }

  // Add inset shadow tokens separately because of nested structure
  for (const [key, value] of Object.entries(tokens.shadow.inset)) {
    target[`--shadow-inset-${key}`] = value;
  }

  addSimpleVars(target, "--drop-shadow-", tokens.dropShadow);
  addSimpleVars(target, "--blur-", tokens.blur);
  addSimpleVars(target, "--perspective-", tokens.perspective);
  addSimpleVars(target, "--aspect-", tokens.aspectRatio);
  addSimpleVars(target, "--ease-", tokens.easing);
  addSimpleVars(target, "--animate-", tokens.animation);
}

function getColorSchemeVariables(scheme: ColorScheme) {
  const styles: Record<string, string> = {
    "--shadow-ring": scheme.shadowRing,
    "--shadow-opacity": scheme.shadowOpacity,
    "--shadow-channel": scheme.shadowChannel,
    "--palette-divider": scheme.palette.divider,
    "--palette-focus-visible": scheme.palette.focusVisible,
  };
  addSimpleVars(styles, "--palette-primary-", scheme.palette.primary);
  addSimpleVars(styles, "--palette-neutral-", scheme.palette.neutral);
  addSimpleVars(styles, "--palette-danger-", scheme.palette.danger);
  addSimpleVars(styles, "--palette-success-", scheme.palette.success);
  addSimpleVars(styles, "--palette-warning-", scheme.palette.warning);
  addSimpleVars(styles, "--palette-common-", scheme.palette.common);
  addSimpleVars(styles, "--palette-text-", scheme.palette.text);
  addSimpleVars(styles, "--palette-background-", scheme.palette.background);
  return styles;
}

function addSimpleVars(
  target: Record<string, string>,
  prefix: string,
  vars: object,
) {
  for (const [key, value] of Object.entries(vars)) {
    target[prefix + key] = value;
  }
}
