import type {
  CSSObjectWithVars,
  ParsedClass,
  Parser,
  TailwindConfig,
} from "./types";
import type { Theme } from "../theme";
import {
  deepMerge,
  getBreakpointValue,
  getContainerValue,
  getMaxWidthValue,
  memoize,
} from "./utils";
import { staticClasses } from "./static-classes";
import { BASE_VAR_DEPENDENT_STYLES } from "./constants";

// Import all parsers
import * as spacingParsers from "./spacing";
import * as typographyParsers from "./typography";
import * as colorParsers from "./colors";
import * as borderParsers from "./borders";
import * as effectParsers from "./effects";
import * as flexboxParsers from "./flexbox";
import * as gridParsers from "./grid";
import * as transformParsers from "./transforms";
import * as backgroundParsers from "./backgrounds";
import * as animationParsers from "./animations";

// Combine all parsers
const dynamicParsers: Parser[] = [
  // Spacing
  spacingParsers.paddingParser,
  spacingParsers.marginParser,
  spacingParsers.spaceBetweenParser,
  spacingParsers.gapParser,
  spacingParsers.widthParser,
  spacingParsers.heightParser,
  spacingParsers.minWidthParser,
  spacingParsers.maxWidthParser,
  spacingParsers.minHeightParser,
  spacingParsers.maxHeightParser,
  spacingParsers.sizeParser,
  spacingParsers.insetParser,
  spacingParsers.positionParser,
  spacingParsers.zIndexParser,

  // Typography
  typographyParsers.fontSizeParser,
  typographyParsers.fontFamilyParser,
  typographyParsers.fontWeightParser,
  typographyParsers.lineHeightParser,
  typographyParsers.letterSpacingParser,
  typographyParsers.textColorParser,
  typographyParsers.textOpacityParser,
  typographyParsers.textDecorationColorParser,
  typographyParsers.textDecorationStyleParser,
  typographyParsers.textDecorationThicknessParser,
  typographyParsers.textUnderlineOffsetParser,
  typographyParsers.textIndentParser,

  // Colors
  colorParsers.backgroundColorParser,
  colorParsers.backgroundOpacityParser,
  colorParsers.borderColorParser,
  colorParsers.borderOpacityParser,
  colorParsers.outlineColorParser,
  colorParsers.ringColorParser,
  colorParsers.ringOpacityParser,
  colorParsers.ringOffsetColorParser,
  colorParsers.shadowColorParser,
  colorParsers.gradientFromParser,
  colorParsers.gradientViaParser,
  colorParsers.gradientToParser,
  colorParsers.divideColorParser,
  colorParsers.divideOpacityParser,

  // Borders
  borderParsers.borderWidthParser,
  borderParsers.borderRadiusParser,
  borderParsers.ringWidthParser,
  borderParsers.ringOffsetWidthParser,
  borderParsers.outlineWidthParser,
  borderParsers.outlineOffsetParser,
  borderParsers.divideWidthParser,
  borderParsers.divideStyleParser,
  borderParsers.borderSpacingParser,

  // Effects
  effectParsers.boxShadowParser,
  effectParsers.opacityParser,
  effectParsers.blurParser,
  effectParsers.brightnessParser,
  effectParsers.contrastParser,
  effectParsers.grayscaleParser,
  effectParsers.hueRotateParser,
  effectParsers.invertParser,
  effectParsers.saturateParser,
  effectParsers.sepiaParser,
  effectParsers.dropShadowParser,
  effectParsers.backdropBlurParser,
  effectParsers.backdropBrightnessParser,
  effectParsers.backdropContrastParser,
  effectParsers.backdropGrayscaleParser,
  effectParsers.backdropHueRotateParser,
  effectParsers.backdropInvertParser,
  effectParsers.backdropOpacityParser,
  effectParsers.backdropSaturateParser,
  effectParsers.backdropSepiaParser,

  // Flexbox
  flexboxParsers.flexBasisParser,
  flexboxParsers.flexGrowParser,
  flexboxParsers.flexShrinkParser,
  flexboxParsers.orderParser,

  // Grid
  gridParsers.gridTemplateColumnsParser,
  gridParsers.gridTemplateRowsParser,
  gridParsers.gridColumnParser,
  gridParsers.gridRowParser,
  gridParsers.gridAutoColumnsParser,
  gridParsers.gridAutoRowsParser,

  // Transforms
  transformParsers.scaleParser,
  transformParsers.rotateParser,
  transformParsers.translateParser,
  transformParsers.skewParser,
  transformParsers.transformOriginParser,
  transformParsers.transformParser,

  // Backgrounds
  backgroundParsers.backgroundSizeParser,
  backgroundParsers.backgroundPositionParser,
  backgroundParsers.backgroundImageParser,
  backgroundParsers.containerParser,
  backgroundParsers.columnsParser,
  backgroundParsers.breakAfterParser,
  backgroundParsers.breakBeforeParser,
  backgroundParsers.breakInsideParser,
  backgroundParsers.aspectRatioParser,

  // Animations
  animationParsers.animationParser,
  animationParsers.transitionPropertyParser,
  animationParsers.transitionDurationParser,
  animationParsers.transitionTimingFunctionParser,
  animationParsers.transitionDelayParser,
];

// Main parsing function
export function parseTailwindClass(
  className: string,
  theme: Theme,
  config: TailwindConfig = {},
): ParsedClass | null {
  // Handle prefixes (responsive, hover, etc.)
  const prefixes: string[] = [];
  let coreClass = className;

  const lastColon = className.lastIndexOf(":");
  if (lastColon !== -1) {
    prefixes.push(...className.slice(0, lastColon).split(":"));
    coreClass = className.slice(lastColon + 1);
  }

  // Try static classes first
  let styles = staticClasses[coreClass] || null;

  // If not found, try dynamic parsers
  if (!styles) {
    const result = memoize(theme, `parse:${coreClass}`, () => {
      for (const parser of dynamicParsers) {
        const result = parser(coreClass, theme);
        if (result) return result;
      }
      return null;
    });
    if (result) styles = result;
  }

  if (!styles) {
    if (config.enableWarnings) {
      console.warn(
        `Skipping unparsed Tailwind class: "${className}" (Core: "${coreClass}")`,
      );
    }
    return null;
  }

  return { prefixes, styles, coreClass };
}

// Apply responsive styles
function applyResponsive(
  styles: CSSObjectWithVars,
  breakpoint: string,
  theme: Theme,
): CSSObjectWithVars {
  const minWidth = getBreakpointValue(breakpoint, theme);
  if (!minWidth) return styles;

  return {
    [`@media (min-width: ${minWidth})`]: styles,
  };
}

// Apply container queries
function applyContainer(
  styles: CSSObjectWithVars,
  container: string,
  theme: Theme,
): CSSObjectWithVars {
  const minWidth = getContainerValue(container, theme);
  if (!minWidth) return styles;

  return {
    [`@container (min-width: ${minWidth})`]: styles,
  };
}

// Apply max responsive styles
function applyMaxResponsive(
  styles: CSSObjectWithVars,
  breakpoint: string,
  theme: Theme,
): CSSObjectWithVars {
  const maxWidth = getMaxWidthValue(breakpoint, theme);
  if (!maxWidth) return styles;

  return {
    [`@media (max-width: ${maxWidth})`]: styles,
  };
}

// Apply all modifiers
function applyModifiers(
  parsed: ParsedClass,
  theme: Theme,
): CSSObjectWithVars {
  let styles = parsed.styles!;

  for (const prefix of parsed.prefixes) {
    // Responsive modifiers
    if (theme.tokens.breakpoints && prefix in theme.tokens.breakpoints) {
      styles = applyResponsive(styles, prefix, theme);
      continue;
    }

    // Container queries
    if (prefix.startsWith("@") && theme.tokens.containers) {
      const containerName = prefix.slice(1);
      if (containerName in theme.tokens.containers) {
        styles = applyContainer(styles, containerName, theme);
        continue;
      }
    }

    // Max width modifiers
    if (prefix.startsWith("max-") && theme.tokens.breakpoints) {
      const breakpointName = prefix.slice(4);
      if (breakpointName in theme.tokens.breakpoints) {
        styles = applyMaxResponsive(styles, breakpointName, theme);
        continue;
      }
    }

    // State modifiers
    const stateModifiers: Record<string, string> = {
      hover: "&:hover",
      focus: "&:focus",
      "focus-within": "&:focus-within",
      "focus-visible": "&:focus-visible",
      active: "&:active",
      visited: "&:visited",
      target: "&:target",
      first: "&:first-child",
      last: "&:last-child",
      only: "&:only-child",
      odd: "&:nth-child(odd)",
      even: "&:nth-child(even)",
      "first-of-type": "&:first-of-type",
      "last-of-type": "&:last-of-type",
      "only-of-type": "&:only-of-type",
      empty: "&:empty",
      disabled: "&:disabled",
      enabled: "&:enabled",
      checked: "&:checked",
      indeterminate: "&:indeterminate",
      default: "&:default",
      required: "&:required",
      valid: "&:valid",
      invalid: "&:invalid",
      "in-range": "&:in-range",
      "out-of-range": "&:out-of-range",
      "placeholder-shown": "&:placeholder-shown",
      autofill: "&:autofill",
      "read-only": "&:read-only",
      before: "&::before",
      after: "&::after",
      "first-letter": "&::first-letter",
      "first-line": "&::first-line",
      marker: "&::marker",
      selection: "&::selection",
      file: "&::file-selector-button",
      backdrop: "&::backdrop",
      placeholder: "&::placeholder",
      // Group modifiers
      "group-hover": ".group:hover &",
      "group-focus": ".group:focus &",
      "group-focus-within": ".group:focus-within &",
      "group-focus-visible": ".group:focus-visible &",
      "group-active": ".group:active &",
      "group-visited": ".group:visited &",
      "group-target": ".group:target &",
      // Peer modifiers
      "peer-hover": ".peer:hover ~ &",
      "peer-focus": ".peer:focus ~ &",
      "peer-focus-within": ".peer:focus-within ~ &",
      "peer-focus-visible": ".peer:focus-visible ~ &",
      "peer-active": ".peer:active ~ &",
      "peer-visited": ".peer:visited ~ &",
      "peer-target": ".peer:target ~ &",
      "peer-checked": ".peer:checked ~ &",
      "peer-disabled": ".peer:disabled ~ &",
    };

    if (prefix in stateModifiers) {
      styles = { [stateModifiers[prefix]]: styles };
      continue;
    }

    // Dark mode
    if (prefix === "dark") {
      styles = { "@media (prefers-color-scheme: dark)": styles };
      continue;
    }

    // Light mode
    if (prefix === "light") {
      styles = { "@media (prefers-color-scheme: light)": styles };
      continue;
    }

    // Print
    if (prefix === "print") {
      styles = { "@media print": styles };
      continue;
    }

    // Screen readers
    if (prefix === "sr-only") {
      styles = { "@media screen": styles };
      continue;
    }

    // Motion preferences
    if (prefix === "motion-safe") {
      styles = { "@media (prefers-reduced-motion: no-preference)": styles };
      continue;
    }

    if (prefix === "motion-reduce") {
      styles = { "@media (prefers-reduced-motion: reduce)": styles };
      continue;
    }

    // Contrast preferences
    if (prefix === "contrast-more") {
      styles = { "@media (prefers-contrast: more)": styles };
      continue;
    }

    if (prefix === "contrast-less") {
      styles = { "@media (prefers-contrast: less)": styles };
      continue;
    }

    // Orientation
    if (prefix === "portrait") {
      styles = { "@media (orientation: portrait)": styles };
      continue;
    }

    if (prefix === "landscape") {
      styles = { "@media (orientation: landscape)": styles };
      continue;
    }

    // RTL/LTR
    if (prefix === "rtl") {
      styles = { "[dir='rtl'] &": styles };
      continue;
    }

    if (prefix === "ltr") {
      styles = { "[dir='ltr'] &": styles };
      continue;
    }

    // Open state (for <details> elements)
    if (prefix === "open") {
      styles = { "&[open]": styles };
      continue;
    }
  }

  return styles;
}

function splitTailwindClasses(classString: string): string[] {
  const classes: string[] = [];
  let current = "";
  let inBrackets = false;

  for (let i = 0; i < classString.length; i++) {
    const char = classString[i];

    if (char === "[") {
      inBrackets = true;
      current += char;
    } else if (char === "]") {
      inBrackets = false;
      current += char;
    } else if (/\s/.test(char) && !inBrackets) {
      if (current.trim()) {
        classes.push(current.trim());
      }
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    classes.push(current.trim());
  }

  return classes;
}

// Main function to process Tailwind classes. The same class strings recur
// across many elements, so the full transform is memoized per theme (only
// when no custom config is supplied, since the cache key omits it).
export function processTailwindClasses(
  classNames: string | string[],
  theme: Theme,
  config: TailwindConfig = {},
): CSSObjectWithVars {
  if (Object.keys(config).length !== 0) {
    return processTailwindClassesUncached(classNames, theme, config);
  }
  const key = Array.isArray(classNames) ? classNames.join(" ") : classNames;
  return memoize(
    theme,
    "tw:" + key,
    () => processTailwindClassesUncached(classNames, theme, config),
  );
}

function processTailwindClassesUncached(
  classNames: string | string[],
  theme: Theme,
  config: TailwindConfig,
): CSSObjectWithVars {
  const classes = Array.isArray(classNames)
    ? classNames
    : splitTailwindClasses(classNames);

  let result: CSSObjectWithVars = {};
  let hasTransform = false;
  let hasFilter = false;
  let hasBackdropFilter = false;

  for (const className of classes) {
    const parsed = parseTailwindClass(className, theme, config);
    if (!parsed || !parsed.styles) continue;

    // Track if we need base styles
    const needsTransform = [
      "translate",
      "rotate",
      "scale",
      "skew",
      "transform",
    ].some((prefix) => parsed.coreClass.startsWith(prefix));

    const needsFilter = [
      "blur",
      "brightness",
      "contrast",
      "grayscale",
      "hue-rotate",
      "invert",
      "saturate",
      "sepia",
      "drop-shadow",
    ].some((prefix) => parsed.coreClass.startsWith(prefix));

    const needsBackdropFilter = parsed.coreClass.startsWith("backdrop-");

    if (needsTransform) hasTransform = true;
    if (needsFilter) hasFilter = true;
    if (needsBackdropFilter) hasBackdropFilter = true;

    // Apply modifiers and merge
    const modifiedStyles = applyModifiers(parsed, theme);
    result = deepMerge(result, modifiedStyles);
  }

  // Apply base styles if needed
  if (hasTransform) {
    result = deepMerge(
      { transform: BASE_VAR_DEPENDENT_STYLES.transform },
      result,
    );
  }

  if (hasFilter) {
    result = deepMerge({ filter: BASE_VAR_DEPENDENT_STYLES.filter }, result);
  }

  if (hasBackdropFilter) {
    result = deepMerge({
      backdropFilter: BASE_VAR_DEPENDENT_STYLES.backdropFilter,
    }, result);
  }

  // Apply box shadow structure if ring styles are present
  const hasRing = Object.keys(result).some((key) =>
    key.startsWith("--tw-ring") || key === "boxShadow"
  );

  if (hasRing) {
    result = deepMerge(
      { boxShadow: BASE_VAR_DEPENDENT_STYLES.boxShadow },
      result,
    );
  }

  return result;
}

// Export everything for backward compatibility
export * from "./types";
export * from "./constants";
export * from "./utils";
export { staticClasses } from "./static-classes";
