import { rootStyles } from "./root_styles";
import type { KeyFrames, Style, StyleObject } from "./style_types";
import { cssVar } from "./style_utils";
import type { App } from "./system";
import type {
  AnimationTokens,
  AspectRatioTokens,
  BlurTokens,
  BorderRadiusTokens,
  BreakpointTokens,
  ColorTokens,
  DropShadowTokens,
  EasingTokens,
  FontFamilyTokens,
  FontSizeTokens,
  FontWeightTokens,
  LetterSpacingTokens,
  LineHeightTokens,
  ShadowTokens,
  Theme,
  TransitionDurations,
  TransitionEasings,
  TypographyKeys,
} from "./theme";
import { SequentialIDGenerator } from "./utils/sequential_id_generator";

/** Function that transforms style properties into real CSS properties */
type StyleValueMapper = (
  v: any,
  theme: Theme,
) => StyleObject | string | number | null;

const mappers: { [s: string]: StyleValueMapper } = {};

// Border Radius mappers
function borderRadiusMapper(v: any, theme: Theme) {
  if (typeof v === "string" && v in theme.tokens.borderRadius) {
    return theme.tokens.borderRadius[v as keyof BorderRadiusTokens];
  }
  return v;
}

mappers.borderRadius = borderRadiusMapper;
mappers.borderTopLeftRadius = borderRadiusMapper;
mappers.borderTopRightRadius = borderRadiusMapper;
mappers.borderBottomLeftRadius = borderRadiusMapper;
mappers.borderBottomRightRadius = borderRadiusMapper;

// Shadow mappers
mappers.boxShadow = (v, theme) => {
  if (typeof v === "string") {
    // Regular shadows
    if (v in theme.tokens.shadow) {
      return theme.tokens.shadow[v as keyof ShadowTokens];
    }

    // Inset shadows
    if (v.startsWith("inset-") && v.substring(6) in theme.tokens.shadow.inset) {
      const key = v.substring(6) as keyof typeof theme.tokens.shadow.inset;
      return theme.tokens.shadow.inset[key];
    }
  }
  return v;
};

mappers.dropShadow = (v, theme) => {
  if (typeof v === "string" && v in theme.tokens.dropShadow) {
    return theme.tokens.dropShadow[v as keyof DropShadowTokens];
  }
  return v;
};

// Blur mapper
mappers.blur = (v, theme) => {
  if (typeof v === "string" && v in theme.tokens.blur) {
    return theme.tokens.blur[v as keyof BlurTokens];
  }
  return v;
};

// Typography mappers
mappers.fontFamily = (v, theme) => {
  if (typeof v === "string") {
    if (v in theme.tokens.fontFamily) {
      return theme.tokens.fontFamily[v as keyof FontFamilyTokens];
    }
    if (v in theme.fontFamily) {
      return theme.fontFamily[v as keyof typeof theme.fontFamily];
    }
  }
  return v;
};

mappers.fontSize = (v, theme) => {
  if (typeof v === "string" && v in theme.tokens.fontSize) {
    return theme.tokens.fontSize[v as keyof FontSizeTokens];
  }
  return v;
};

mappers.fontWeight = (v, theme) => {
  if (typeof v === "string" && v in theme.tokens.fontWeight) {
    return theme.tokens.fontWeight[v as keyof FontWeightTokens];
  }
  return v;
};

mappers.lineHeight = (v, theme) => {
  if (typeof v === "string" && v in theme.tokens.lineHeight) {
    return theme.tokens.lineHeight[v as keyof LineHeightTokens];
  }
  return v;
};

mappers.letterSpacing = (v, theme) => {
  if (typeof v === "string" && v in theme.tokens.letterSpacing) {
    return theme.tokens.letterSpacing[v as keyof LetterSpacingTokens];
  }
  return v;
};

mappers.typography = (v, theme) => {
  if (typeof v === "string" && v in theme.typography) {
    return theme.typography[v as TypographyKeys] as any;
  }
  return null;
};

// Aspect Ratio mapper
mappers.aspectRatio = (v, theme) => {
  if (typeof v === "string" && v in theme.tokens.aspectRatio) {
    return theme.tokens.aspectRatio[v as keyof AspectRatioTokens];
  }
  return v;
};

// Animation mapper
mappers.animation = (v, theme) => {
  if (typeof v === "string" && v in theme.tokens.animation) {
    return theme.tokens.animation[v as keyof AnimationTokens];
  }
  return v;
};

// Perspective mapper
mappers.perspective = (v, theme) => {
  if (typeof v === "string" && v in theme.tokens.perspective) {
    return theme.tokens.perspective[v as keyof typeof theme.tokens.perspective];
  }
  return v;
};

// Initialize color token registry
const colorTokenRegistry = new Set<string>();
const paletteVariantRegistry = new Set<string>();

/**
 Initializes the color token registry from the theme tokens
 */
function initializeColorTokenRegistry(tokens: ColorTokens) {
  // Register all direct color tokens
  for (const colorName of Object.keys(tokens)) {
    colorTokenRegistry.add(colorName);

    const colorValue = tokens[colorName as keyof ColorTokens];
    if (typeof colorValue !== "string") {
      // Register color scale tokens (50-950)
      for (const scaleKey of Object.keys(colorValue)) {
        colorTokenRegistry.add(`${colorName}-${scaleKey}`);
      }
    }
  }
}

/**
 Initializes the palette variant registry for palette token lookup
 */
function initializePaletteVariantRegistry() {
  // Common colors
  paletteVariantRegistry.add("common-white");
  paletteVariantRegistry.add("common-black");

  // Text variants
  for (const textType of ["primary", "secondary", "tertiary", "icon"]) {
    paletteVariantRegistry.add(`text-${textType}`);
  }

  // Background variants
  for (
    const bgType of [
      "body",
      "surface",
      "level1",
      "level2",
      "level3",
      "tooltip",
      "backdrop",
      "popup",
    ]
  ) {
    paletteVariantRegistry.add(`background-${bgType}`);
  }

  // Add divider and focus-visible
  paletteVariantRegistry.add("divider");
  paletteVariantRegistry.add("focus-visible");

  // Color palettes with scales and variants
  const colorPalettes = ["primary", "neutral", "danger", "success", "warning"];

  for (const palette of colorPalettes) {
    // Add color scales (50-950)
    for (let i = 50; i <= 950; i += i < 100 ? 50 : 100) {
      paletteVariantRegistry.add(`${palette}-${i}`);
    }

    // Add channel values
    paletteVariantRegistry.add(`${palette}-main-channel`);
    paletteVariantRegistry.add(`${palette}-light-channel`);
    paletteVariantRegistry.add(`${palette}-dark-channel`);

    // Add all variant combinations
    const variants = ["plain", "solid", "soft", "outlined"];
    const states = ["", "hover-", "active-", "disabled-"];
    const properties = ["color", "bg"];

    for (const variant of variants) {
      for (const state of states) {
        for (const prop of properties) {
          paletteVariantRegistry.add(`${palette}-${variant}-${state}${prop}`);
        }

        // Add border property for outlined variant
        if (variant === "outlined") {
          paletteVariantRegistry.add(`${palette}-${variant}-${state}border`);
        }
      }
    }
  }
}

/**
 Transforms a color value using the token system or palette
 */
function transformColor(value: any, theme: Theme) {
  if (typeof value !== "string") {
    return value;
  }

  // Handle CSS variables for shadows
  if (
    value === "shadow-channel" ||
    value === "shadow-ring" ||
    value === "shadow-opacity"
  ) {
    return cssVar(value);
  }

  // Handle dots in color names (LLMs often hallucinate these)
  const normalizedValue = value.replaceAll(".", "-");

  // Check if it's a palette variant
  if (paletteVariantRegistry.has(normalizedValue)) {
    return cssVar(`palette-${normalizedValue}` as any);
  }

  // Check if it's a direct color token
  if (colorTokenRegistry.has(normalizedValue)) {
    return value;
  }

  // Check if it's a color with scale (like blue-500)
  const parts = normalizedValue.split("-");
  if (parts.length === 2) {
    const colorName = parts[0];
    const scale = parts[1];

    if (colorName in theme.tokens.colors && !Number.isNaN(Number(scale))) {
      return value;
    }
  }

  return value;
}

// Register color property mappers
const colorProperties = [
  "color",
  "backgroundColor",
  "borderColor",
  "outlineColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
];

for (const prop of colorProperties) {
  mappers[prop] = (v, theme) => transformColor(v, theme);
}

// Special case for bgcolor shorthand
mappers.bgcolor = (v, theme) => ({ backgroundColor: transformColor(v, theme) });

export function transformSpacing(v: number | string) {
  if (v === "px") {
    return "1px";
  }
  // Convert numeric spacing values to theme spacing
  if (typeof v === "number") {
    // Direct mapping for common spacing values
    const spacingMap: Record<number, string> = {
      0: "0px",
      0.5: "0.125rem", // 2px
      1: "0.25rem", // 4px
      1.5: "0.375rem", // 6px
      2: "0.5rem", // 8px
      2.5: "0.625rem", // 10px
      3: "0.75rem", // 12px
      3.5: "0.875rem", // 14px
      4: "1rem", // 16px
      5: "1.25rem", // 20px
      6: "1.5rem", // 24px
      7: "1.75rem", // 28px
      8: "2rem", // 32px
      9: "2.25rem", // 36px
      10: "2.5rem", // 40px
      11: "2.75rem", // 44px
      12: "3rem", // 48px
      14: "3.5rem", // 56px
      16: "4rem", // 64px
      20: "5rem", // 80px
      24: "6rem", // 96px
      28: "7rem", // 112px
      32: "8rem", // 128px
      36: "9rem", // 144px
      40: "10rem", // 160px
      44: "11rem", // 176px
      48: "12rem", // 192px
      52: "13rem", // 208px
      56: "14rem", // 224px
      60: "15rem", // 240px
      64: "16rem", // 256px
      72: "18rem", // 288px
      80: "20rem", // 320px
      96: "24rem", // 384px
    };

    return spacingMap[v] !== undefined ? spacingMap[v] : `${v * 0.25}rem`;
  }

  // Return the value as-is if it's not a number
  return v;
}

// Spacing mappers
const simpleSpacingFields = [
  { real: "paddingTop", short: "pt" },
  { real: "paddingLeft", short: "pl" },
  { real: "paddingRight", short: "pr" },
  { real: "paddingBottom", short: "pb" },
  { real: "marginTop", short: "mt" },
  { real: "marginLeft", short: "ml" },
  { real: "marginRight", short: "mr" },
  { real: "marginBottom", short: "mb" },
  { real: "paddingInlineStart" },
  { real: "paddingInlineEnd" },
  { real: "paddingBlockStart" },
  { real: "paddingBlockEnd" },
  { real: "marginInlineStart" },
  { real: "marginInlineEnd" },
  { real: "marginBlockStart" },
  { real: "marginBlockEnd" },
];

for (const { real, short } of simpleSpacingFields) {
  mappers[real] = (v) => {
    return { [real]: transformSpacing(v) };
  };
  if (short) {
    mappers[short] = mappers[real];
  }
}

const doubleSpacingFields = [
  { long: "paddingX", short: "px", fields: ["paddingLeft", "paddingRight"] },
  { long: "paddingY", short: "py", fields: ["paddingTop", "paddingBottom"] },
  { long: "marginX", short: "mx", fields: ["marginLeft", "marginRight"] },
  { long: "marginY", short: "my", fields: ["marginTop", "marginBottom"] },
  { long: "marginBlock", fields: ["marginBlockStart", "marginBlockEnd"] },
  { long: "marginInline", fields: ["marginInlineStart", "marginInlineEnd"] },
  { long: "paddingBlock", fields: ["paddingBlockStart", "paddingBlockEnd"] },
  { long: "paddingInline", fields: ["paddingInlineStart", "paddingInlineEnd"] },
];

for (const { long, short, fields } of doubleSpacingFields) {
  mappers[long] = (v) => {
    return {
      [fields[0]]: transformSpacing(v),
      [fields[1]]: transformSpacing(v),
    };
  };
  if (short) {
    mappers[short] = mappers[long];
  }
}

// All sides spacing mappers
mappers.padding = (v) => {
  if (typeof v !== "number") {
    return {
      paddingTop: v,
      paddingLeft: v,
      paddingRight: v,
      paddingBottom: v,
    };
  }
  return {
    paddingTop: transformSpacing(v),
    paddingLeft: transformSpacing(v),
    paddingRight: transformSpacing(v),
    paddingBottom: transformSpacing(v),
  };
};
mappers.p = mappers.padding;

mappers.margin = (v) => {
  if (typeof v !== "number") {
    return {
      marginTop: v,
      marginLeft: v,
      marginRight: v,
      marginBottom: v,
    };
  }
  return {
    marginTop: transformSpacing(v),
    marginLeft: transformSpacing(v),
    marginRight: transformSpacing(v),
    marginBottom: transformSpacing(v),
  };
};
mappers.sql = mappers.margin;

// Gap mappers
mappers.gap = (v) => {
  return { gap: transformSpacing(v) };
};

mappers.columnGap = (v) => {
  return { columnGap: transformSpacing(v) };
};

mappers.rowGap = (v) => {
  return { rowGap: transformSpacing(v) };
};

// Media mappers
mappers.displayPrint = (v) => ({
  "@media print": {
    display: v,
  },
});

mappers.mediaHover = (v) => ({
  "@media (hover: hover) and (pointer: fine)": {
    display: v,
  },
});

// Grid mappers
mappers.gridColumnSpan = (v) => ({
  gridColumn: v === "full" ? "1 / -1" : `span ${v} / span ${v}`,
});

mappers.gridRowSpan = (v) => ({
  gridRow: v === "full" ? "1 / -1" : `span ${v} / span ${v}`,
});

// Transition mappers
mappers.transitionTimingFunction = (v, theme) => {
  if (typeof v === "string") {
    if (v in theme.transitionEasing) {
      return theme.transitionEasing[v as keyof TransitionEasings];
    }
    if (v in theme.tokens.easing) {
      return theme.tokens.easing[v as keyof EasingTokens];
    }
  }
  return v;
};

mappers.transitionDuration = (v, theme) => {
  if (typeof v === "string" && v in theme.transitionDurations) {
    return theme.transitionDurations[v as keyof TransitionDurations];
  }
  return v;
};

// CSS properties that accept unitless values
const CSS_NUMBER: Set<string> = new Set();

const CSS_NUMBER_KEYS = [
  "animation-iteration-count",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "box-flex",
  "box-flex-group",
  "box-ordinal-group",
  "column-count",
  "columns",
  "counter-increment",
  "counter-reset",
  "flex",
  "flex-grow",
  "flex-positive",
  "flex-shrink",
  "flex-negative",
  "flex-order",
  "font-weight",
  "grid-area",
  "grid-column",
  "grid-column-end",
  "grid-column-span",
  "grid-column-start",
  "grid-row",
  "grid-row-end",
  "grid-row-span",
  "grid-row-start",
  "line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
  // SVG properties
  "fill-opacity",
  "flood-opacity",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
];

// Add vendor prefixes to unitless properties
for (const property of CSS_NUMBER_KEYS) {
  for (const prefix of ["-webkit-", "-ms-", "-moz-", "-o-", ""]) {
    CSS_NUMBER.add(prefix + property);
  }
}

/**
 Interpolate the `&` with style name.
 */
function interpolate(selector: string, styleName: string) {
  return selector.replace(/&/g, styleName);
}

/**
 Interpolate CSS selectors.
 */
function child(selector: string, parent: string) {
  if (selector.indexOf("&") === -1) {
    return `${parent} ${selector}`;
  }
  return interpolate(selector, parent);
}

/**
 Transform a JavaScript property into a CSS property.
 */
function hyphenate(propertyName: string): string {
  return propertyName
    .replace(/[A-Z]/g, (sql: string) => `-${sql.toLowerCase()}`)
    .replace(/^ms-/, "-ms-"); // Internet Explorer vendor prefix.
}

const classNameGenerator = new SequentialIDGenerator();

function serializeSimpleCssProperties(obj: object) {
  const rule = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || typeof value === "object") {
      continue;
    }
    const cssKey = hyphenate(key);
    if (typeof value === "number" && value && !CSS_NUMBER.has(cssKey)) {
      rule.push(`${cssKey}:${value}px`);
    } else {
      rule.push(`${cssKey}:${String(value)}`);
    }
  }
  return rule;
}

function createRulesFromStyle(
  obj: object,
  cssRules: string[],
  selector?: string,
  media?: string,
) {
  const thisRule = serializeSimpleCssProperties(obj);
  if (thisRule.length !== 0) {
    if (!selector) {
      throw new Error("Cannot specify global styles without a selector");
    }
    const rule = `${selector}{${thisRule.join(";")}}`;
    if (media) {
      cssRules.push(`${media}{${rule}}`);
    } else {
      cssRules.push(rule);
    }
  }
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || typeof value !== "object") {
      continue;
    }
    if (
      key.charCodeAt(0) === 64 /* @ */ &&
      (key.includes("media") ||
        key === "@starting-style" ||
        key.includes("supports") ||
        key.includes("container"))
    ) {
      createRulesFromStyle(value, cssRules, selector, key);
    } else {
      createRulesFromStyle(
        value,
        cssRules,
        selector ? child(key, selector) : key,
        media,
      );
    }
  }
}

function mergeStyleProp(
  key: string,
  value: any,
  output: Record<string, any>,
  theme: Theme,
  colorSchemeType?: string,
) {
  if (value === null) {
    output[key] = undefined;
    return;
  }
  if (!value && value !== 0) {
    return;
  }

  let newKey = key;

  // Handle light/dark mode
  if (key === "light") {
    if (colorSchemeType === "dark") {
      return;
    }
    if (colorSchemeType === "light") {
      mergeStyle(value, output, theme, colorSchemeType);
    } else {
      newKey = "&:is(.light *)";
      if (!output[newKey]) {
        output[newKey] = {};
      }
      mergeStyle(value, output[newKey], theme, colorSchemeType);
      newKey = "@media (prefers-color-scheme: light)";
      if (!output[newKey]) {
        output[newKey] = {};
      }
      mergeStyle(
        { "&:not(.dark *)": value },
        output[newKey],
        theme,
        colorSchemeType,
      );
    }
    return;
  }

  if (key === "dark") {
    if (colorSchemeType === "light") {
      return;
    }
    if (colorSchemeType === "dark") {
      mergeStyle(value, output, theme, colorSchemeType);
    } else {
      newKey = "&:is(.dark *)";
      if (!output[newKey]) {
        output[newKey] = {};
      }
      mergeStyle(value, output[newKey], theme, colorSchemeType);
      newKey = "@media (prefers-color-scheme: dark)";
      if (!output[newKey]) {
        output[newKey] = {};
      }
      mergeStyle(
        { "&:not(.light *)": value },
        output[newKey],
        theme,
        colorSchemeType,
      );
    }
    return;
  }

  // Handle special media queries
  if (key === "hoverEnabled") {
    newKey = "@media (hover: hover) and (pointer: fine)";
  } // Handle breakpoints
  else if (key in theme.tokens.breakpoints) {
    newKey = `@media (min-width: ${
      theme.tokens.breakpoints[key as keyof BreakpointTokens]
    })`;
  }

  // Handle media queries and nested selectors
  if (
    newKey.includes("&") ||
    newKey.includes("@media") ||
    newKey.includes("@supports")
  ) {
    if (!output[newKey]) {
      output[newKey] = {};
    }
    mergeStyle(value, output[newKey], theme, colorSchemeType);
    return;
  }

  // Handle responsive object values
  if (isMediaQueryObject(value)) {
    mergeStyle(
      expandMediaQueryObject(newKey, value),
      output,
      theme,
      colorSchemeType,
    );
    return;
  }

  // Apply property value mapper if available
  const mapper = mappers[newKey];
  if (!mapper) {
    if (isMediaQueryObject(value)) {
      mergeStyle(
        expandMediaQueryObject(newKey, value),
        output,
        theme,
        colorSchemeType,
      );
      return;
    }
    output[newKey] = value;
    return;
  }

  const mappedValue = mapper(value, theme);
  if (mappedValue === null) {
    output[newKey] = undefined;
    return;
  }

  if (!mappedValue && mappedValue !== 0) {
    return;
  }

  if (isMediaQueryObject(mappedValue)) {
    mergeStyle(
      expandMediaQueryObject(newKey, mappedValue),
      output,
      theme,
      colorSchemeType,
    );
    return;
  }

  if (typeof mappedValue === "object") {
    for (const [key, value] of Object.entries(mappedValue)) {
      // We could potentially handle media query merging here
      output[key] = value;
    }
  } else {
    output[newKey] = mappedValue;
  }
}

/**
 Checks if the value is a responsive object with breakpoint keys
 */
function isMediaQueryObject(value: any) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some(
      (key) =>
        key === "sm" ||
        key === "md" ||
        key === "lg" ||
        key === "xl" ||
        key === "2xl",
    )
  );
}

/**
 Expands a media query object into a format suitable for processing
 */
function expandMediaQueryObject(key: string, value: any) {
  const expanded: Record<string, any> = {};
  for (
    const [mediaQuerySize, keyValue] of Object.entries(
      value as Record<string, any>,
    )
  ) {
    expanded[mediaQuerySize] = {
      [key]: keyValue,
    };
  }
  return expanded;
}

/**
 Merges multiple style objects into one, resolving token references
 */
function mergeStyle(
  style: Style,
  output: Record<string, any>,
  theme: Theme,
  colorSchemeType?: string,
) {
  if (!style) {
    return;
  }

  if (Array.isArray(style)) {
    for (const v of style) {
      mergeStyle(v, output, theme, colorSchemeType);
    }
    return;
  }

  for (const [k, v] of Object.entries(style)) {
    mergeStyleProp(k, v, output, theme, colorSchemeType);
  }
}

/**
 Prepares a style by applying all transformations and token resolutions
 */
function prepStyle(style: Style, theme: Theme, colorSchemeType?: string) {
  const preppedStyle: Record<string, any> = {};
  mergeStyle(style, preppedStyle, theme, colorSchemeType);
  return preppedStyle;
}

export class StyleSheet {
  #cssRules: string[] = [];
  #seenStylesReferences = new WeakMap<StyleObject | Style[], string>();
  #seenStylesHashed = new Map<string, string>();
  #seenStylesRaw = new Map<string, string>();
  #didInitialize = false;

  constructor(private app: App) {
    // Initialize token registries
  }

  private buildHashString(style: StyleObject): string {
    const keys = Object.keys(style).sort();
    let hashString = "";
    for (const key of keys) {
      hashString += key;
      const value = style[key as keyof StyleObject];
      if (typeof value === "object" && value !== null) {
        hashString += this.buildHashString(value);
      } else {
        hashString += String(value);
      }
    }
    return hashString;
  }

  // Canonical serialization of a raw (un-prepped) style, used as a cache key
  // to skip prepStyle on repeats. Unlike buildHashString it tags value types,
  // since e.g. 4 and "4" may resolve differently in prepStyle.
  private buildRawKeyString(style: unknown): string {
    if (typeof style !== "object" || style === null) {
      return typeof style + ":" + String(style);
    }
    const obj = style as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    let key = "{";
    for (const k of keys) {
      key += k + "=" + this.buildRawKeyString(obj[k]) + ";";
    }
    return key + "}";
  }

  /**
       Adds a style to the stylesheet and returns a class name
       */
  addStyle(style: Style): string {
    if (typeof style !== "object" || style === null) {
      return "";
    }

    if (!this.#didInitialize) {
      colorTokenRegistry.clear();
      paletteVariantRegistry.clear();
      this.#didInitialize = true;
      initializeColorTokenRegistry(this.app.theme.tokens.colors);
      initializePaletteVariantRegistry();
    }

    // Check if we've already processed this style
    if (this.#seenStylesReferences.has(style)) {
      return this.#seenStylesReferences.get(style)!;
    }

    // Styles are frequently fresh-but-identical objects (which the reference
    // cache can't catch), so also key by the serialized raw style to skip
    // prepStyle on repeats.
    const rawKey = this.buildRawKeyString(style);
    const rawCached = this.#seenStylesRaw.get(rawKey);
    if (rawCached !== undefined) {
      this.#seenStylesReferences.set(style, rawCached);
      return rawCached;
    }

    // Prepare the style by resolving all tokens and transformations
    const prepped = prepStyle(style, this.app.theme, this.app.colorSchemeType);
    const hash = this.buildHashString(prepped);

    // Check if we've already generated a class for this style hash
    if (this.#seenStylesHashed.has(hash)) {
      const className = this.#seenStylesHashed.get(hash)!;
      this.#seenStylesReferences.set(style, className);
      this.#seenStylesRaw.set(rawKey, className);
      return className;
    }

    // Generate a new class name and create CSS rules
    const className = `y${classNameGenerator.next()}`;
    createRulesFromStyle(prepped, this.#cssRules, `.${className}`);

    // Cache the style for future reuse
    this.#seenStylesReferences.set(style, className);
    this.#seenStylesHashed.set(hash, className);
    this.#seenStylesRaw.set(rawKey, className);

    return className;
  }

  /**
       Adds root theme styles to the stylesheet
       */
  addRootStyles() {
    const rootThemeStyles = rootStyles(this.app);
    createRulesFromStyle(
      prepStyle(rootThemeStyles, this.app.theme, this.app.colorSchemeType),
      this.#cssRules,
    );
  }

  /**
       Adds keyframes animations to the stylesheet
       */
  addKeyframes(keyframes: Map<KeyFrames, string>) {
    for (const [frames, id] of keyframes) {
      const selectors = [];
      for (const [key, v] of Object.entries(frames)) {
        if (v) {
          const properties = serializeSimpleCssProperties(
            prepStyle(v, this.app.theme, this.app.colorSchemeType),
          ).join(";");
          selectors.push(`${key} {${properties}}`);
        }
      }
      this.#cssRules.push(`@keyframes ${id}{${selectors.join("")}}`);
    }
  }

  /**
       Adds global styles to the stylesheet
       */
  addGlobalStyles(styles: StyleObject[]) {
    for (const style of styles) {
      createRulesFromStyle(
        prepStyle(style, this.app.theme, this.app.colorSchemeType),
        this.#cssRules,
      );
    }
  }

  /**
       Returns the generated CSS
       */
  getCss() {
    return this.#cssRules.join("");
  }
}
