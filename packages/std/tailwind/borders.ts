import type { CSSObjectWithVars, Parser } from "./types";
import { getThemeToken, parseNumericValue } from "./utils";
import { TW_VAR } from "./constants";

// ───────────────────────────────────────────────────────────────────────────────
// Border width (now supports l / r / s / e etc.)
// ───────────────────────────────────────────────────────────────────────────────
export const borderWidthParser: Parser = (className, theme) => {
  const m = className.match(
    /^border(?:-([trblxyse]))?(?:-(\d+|[a-z]+))?$/,
  );
  if (!m) return null;

  const [, side, val = "1"] = m;
  if (/^(transparent|current|inherit|initial|unset)$/.test(val)) return null;

  const width = parseNumericValue(val, theme, {
    scale: "borderWidth",
    defaultUnit: "px",
  });
  if (!width) return null;

  const st: CSSObjectWithVars = {};
  switch (side) {
    case "t":
      st.borderTopWidth = width;
      break;
    case "r":
      st.borderRightWidth = width;
      break;
    case "b":
      st.borderBottomWidth = width;
      break;
    case "l":
      st.borderLeftWidth = width;
      break;
    case "s":
      st.borderInlineStartWidth = width;
      break;
    case "e":
      st.borderInlineEndWidth = width;
      break;
    case "x":
      st.borderLeftWidth = st.borderRightWidth = width;
      break;
    case "y":
      st.borderTopWidth = st.borderBottomWidth = width;
      break;
    default:
      st.borderWidth = width;
  }
  return st;
};

// ───────────────────────────────────────────────────────────────────────────────
// Border radius – unchanged (added logical *be/bs* already in original code)
// Ring / outline / divide… unchanged
// ───────────────────────────────────────────────────────────────────────────────

// Border radius parser
export const borderRadiusParser: Parser = (className, theme) => {
  const match = className.match(/^rounded-?([trblse]|[tb][lr])?-?(.+)?$/);
  if (!match) return null;

  const [, position, value = ""] = match;
  const radius = value
    ? parseNumericValue(value, theme, {
      scale: "borderRadius",
      keywords: { none: "0", full: "9999px" },
      defaultUnit: "px",
    })
    : getThemeToken(theme, "borderRadius", "DEFAULT") || "0.25rem";

  if (!radius) return null;

  const styles: CSSObjectWithVars = {};

  switch (position) {
    case "t":
      styles.borderTopLeftRadius = radius;
      styles.borderTopRightRadius = radius;
      break;
    case "r":
      styles.borderTopRightRadius = radius;
      styles.borderBottomRightRadius = radius;
      break;
    case "b":
      styles.borderBottomLeftRadius = radius;
      styles.borderBottomRightRadius = radius;
      break;
    case "l":
      styles.borderTopLeftRadius = radius;
      styles.borderBottomLeftRadius = radius;
      break;
    case "tl":
      styles.borderTopLeftRadius = radius;
      break;
    case "tr":
      styles.borderTopRightRadius = radius;
      break;
    case "br":
      styles.borderBottomRightRadius = radius;
      break;
    case "bl":
      styles.borderBottomLeftRadius = radius;
      break;
    case "s":
      styles.borderStartStartRadius = radius;
      styles.borderEndStartRadius = radius;
      break;
    case "e":
      styles.borderStartEndRadius = radius;
      styles.borderEndEndRadius = radius;
      break;
    case "ss":
      styles.borderStartStartRadius = radius;
      break;
    case "se":
      styles.borderStartEndRadius = radius;
      break;
    case "ee":
      styles.borderEndEndRadius = radius;
      break;
    case "es":
      styles.borderEndStartRadius = radius;
      break;
    default:
      styles.borderRadius = radius;
      break;
  }

  return styles;
};

// Ring width parser
export const ringWidthParser: Parser = (className, theme) => {
  const match = className.match(/^ring-?(\d+)?$/);
  if (!match) return null;

  const [, value = "3"] = match;
  const width = parseNumericValue(value, theme, {
    scale: "ringWidth",
    defaultUnit: "px",
  });

  if (!width) return null;

  return {
    [TW_VAR.RING_WIDTH]: width,
    // Set default ring color if not already set
    [TW_VAR.RING_COLOR]: `var(${TW_VAR.RING_COLOR}, rgb(59 130 246 / 0.5))`,
  };
};

// Ring offset width parser
export const ringOffsetWidthParser: Parser = (className, theme) => {
  const match = className.match(/^ring-offset-(\d+)$/);
  if (!match) return null;

  const [, value] = match;
  const width = parseNumericValue(value, theme, {
    scale: "ringOffsetWidth",
    defaultUnit: "px",
  });

  if (!width) return null;

  return {
    [TW_VAR.RING_OFFSET_WIDTH]: width,
    [TW_VAR.RING_OFFSET_COLOR]: `var(${TW_VAR.RING_OFFSET_COLOR}, #fff)`,
  };
};

// Outline width parser
export const outlineWidthParser: Parser = (className, theme) => {
  const match = className.match(/^outline-(\d+)$/);
  if (!match) return null;

  const [, value] = match;
  const width = parseNumericValue(value, theme, {
    scale: "outlineWidth",
    defaultUnit: "px",
  });

  return width ? { outlineWidth: width } : null;
};

// Outline offset parser
export const outlineOffsetParser: Parser = (className, theme) => {
  const match = className.match(/^-?outline-offset-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, value] = match;
  const offset = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "outlineOffset",
    defaultUnit: "px",
  });

  return offset ? { outlineOffset: offset } : null;
};

// Divide width parser
export const divideWidthParser: Parser = (className, theme) => {
  const match = className.match(/^divide-([xy])-?(.+)?$/);
  if (!match) return null;

  const [, axis, value = "1"] = match;

  // Skip divide-x-reverse and divide-y-reverse
  if (value === "reverse") return null;

  const width = parseNumericValue(value, theme, {
    scale: "borderWidth",
    defaultUnit: "px",
  });

  if (!width) return null;

  const isX = axis === "x";
  const styles: CSSObjectWithVars = {
    "& > :not([hidden]) ~ :not([hidden])": {
      [isX ? "borderRightWidth" : "borderBottomWidth"]: "0",
      [isX ? "borderLeftWidth" : "borderTopWidth"]: width,
    },
  };

  return styles;
};

// Divide style parser
export const divideStyleParser: Parser = (className, _theme) => {
  const styles: Record<string, CSSObjectWithVars> = {
    "divide-solid": {
      "& > :not([hidden]) ~ :not([hidden])": { borderStyle: "solid" },
    },
    "divide-dashed": {
      "& > :not([hidden]) ~ :not([hidden])": { borderStyle: "dashed" },
    },
    "divide-dotted": {
      "& > :not([hidden]) ~ :not([hidden])": { borderStyle: "dotted" },
    },
    "divide-double": {
      "& > :not([hidden]) ~ :not([hidden])": { borderStyle: "double" },
    },
    "divide-none": {
      "& > :not([hidden]) ~ :not([hidden])": { borderStyle: "none" },
    },
  };

  return styles[className] || null;
};

// Border spacing parser (for tables)
export const borderSpacingParser: Parser = (className, theme) => {
  const match = className.match(/^border-spacing-([xy])?-?(.+)$/);
  if (!match) return null;

  const [, axis, value] = match;
  const spacing = parseNumericValue(value, theme, {
    scale: "spacing",
    allowSpacingUnits: true,
  });

  if (!spacing) return null;

  if (!axis) {
    return { borderSpacing: spacing };
  } else if (axis === "x") {
    return { borderSpacing: `${spacing} var(--tw-border-spacing-y, 0)` };
  } else {
    return { borderSpacing: `var(--tw-border-spacing-x, 0) ${spacing}` };
  }
};
