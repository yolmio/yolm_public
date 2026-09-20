import type { CSSObjectWithVars, Parser } from "./types";
import { getArbitraryValue, getThemeToken, parseNumericValue } from "./utils";

// Background size parser
export const backgroundSizeParser: Parser = (className, theme) => {
  const match = className.match(/^bg-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const bgSize = getThemeToken(theme, "backgroundSize", value);

  if (bgSize) {
    return { backgroundSize: String(bgSize) };
  }

  // Handle keywords
  const keywords: Record<string, string> = {
    auto: "auto",
    cover: "cover",
    contain: "contain",
  };

  return keywords[value] ? { backgroundSize: keywords[value] } : null;
};

// Background position parser
export const backgroundPositionParser: Parser = (className, theme) => {
  const match = className.match(/^bg-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const bgPos = getThemeToken(theme, "backgroundPosition", value);

  if (bgPos) {
    return { backgroundPosition: String(bgPos) };
  }

  // Handle keywords
  const keywords: Record<string, string> = {
    bottom: "bottom",
    center: "center",
    left: "left",
    "left-bottom": "left bottom",
    "left-top": "left top",
    right: "right",
    "right-bottom": "right bottom",
    "right-top": "right top",
    top: "top",
  };

  return keywords[value] ? { backgroundPosition: keywords[value] } : null;
};

// Background image parser
export const backgroundImageParser: Parser = (className, theme) => {
  const match = className.match(/^bg-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  // Skip if it's handled by other parsers
  if (/^(gradient-to-|none$)/.test(value)) return null;

  const bgImage = getThemeToken(theme, "backgroundImage", value);

  return bgImage ? { backgroundImage: String(bgImage) } : null;
};

// Container parser
export const containerParser: Parser = (className, theme) => {
  if (className !== "container") return null;

  const breakpoints = theme.tokens.breakpoints;
  if (!breakpoints) return { maxWidth: "100%", width: "100%" };

  const styles: CSSObjectWithVars = {
    width: "100%",
  };

  // Apply responsive max-widths
  const containerStyles: CSSObjectWithVars = {};

  Object.entries(breakpoints).forEach(([_name, minWidth]) => {
    if (typeof minWidth === "string") {
      containerStyles[`@media (min-width: ${minWidth})`] = {
        maxWidth: minWidth,
      };
    }
  });

  return { ...styles, ...containerStyles };
};

// Columns parser
export const columnsParser: Parser = (className, theme) => {
  const match = className.match(/^columns-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  // Check theme first
  const columns = getThemeToken(theme, "columns", value);
  if (columns) {
    return { columns: String(columns) };
  }

  // Handle numeric values
  const num = parseFloat(value);
  if (!isNaN(num)) {
    return { columns: String(num) };
  }

  // Handle size values
  const size = parseNumericValue(value, theme, {
    scale: "spacing",
    allowSpacingUnits: true,
    defaultUnit: "rem",
  });

  return size ? { columns: size } : null;
};

// Break after parser
export const breakAfterParser: Parser = (className, _theme) => {
  const match = className.match(/^break-after-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const keywords: Record<string, string> = {
    auto: "auto",
    avoid: "avoid",
    all: "all",
    "avoid-page": "avoid-page",
    page: "page",
    left: "left",
    right: "right",
    column: "column",
  };

  return keywords[value] ? { breakAfter: keywords[value] } : null;
};

// Break before parser
export const breakBeforeParser: Parser = (className, _theme) => {
  const match = className.match(/^break-before-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const keywords: Record<string, string> = {
    auto: "auto",
    avoid: "avoid",
    all: "all",
    "avoid-page": "avoid-page",
    page: "page",
    left: "left",
    right: "right",
    column: "column",
  };

  return keywords[value] ? { breakBefore: keywords[value] } : null;
};

// Break inside parser
export const breakInsideParser: Parser = (className, _theme) => {
  const match = className.match(/^break-inside-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const keywords: Record<string, string> = {
    auto: "auto",
    avoid: "avoid",
    "avoid-page": "avoid-page",
    "avoid-column": "avoid-column",
  };

  return keywords[value] ? { breakInside: keywords[value] } : null;
};

// Aspect ratio parser
export const aspectRatioParser: Parser = (className, theme) => {
  const match = className.match(/^aspect-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  const arbitrary = getArbitraryValue(value);
  if (arbitrary) {
    const aspectRatio = arbitrary.replaceAll("_", " ").replace(
      /\s*\/\s*/g,
      " / ",
    );
    return { aspectRatio };
  }

  // Check theme first
  const aspect = getThemeToken(theme, "aspectRatio", value);
  if (aspect) {
    return { aspectRatio: String(aspect) };
  }

  // Handle keywords
  const keywords: Record<string, string> = {
    auto: "auto",
    square: "1 / 1",
    video: "16 / 9",
  };

  return keywords[value] ? { aspectRatio: keywords[value] } : null;
};
