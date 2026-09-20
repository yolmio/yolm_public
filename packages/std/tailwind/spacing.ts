import type { CSSObjectWithVars, Parser } from "./types";
import { parseNumericValue } from "./utils";

// Padding parser
export const paddingParser: Parser = (className, theme) => {
  const match = className.match(/^p([tblrxy])?-(.+)$/);
  if (!match) return null;

  const [, side, value] = match;
  const spacing = parseNumericValue(value, theme, {
    allowNegative: false,
    scale: "spacing",
    allowSpacingUnits: true,
    keywords: { auto: "auto" },
  });

  if (!spacing) return null;

  const styles: CSSObjectWithVars = {};
  switch (side) {
    case "t":
      styles.paddingTop = spacing;
      break;
    case "b":
      styles.paddingBottom = spacing;
      break;
    case "l":
      styles.paddingLeft = spacing;
      break;
    case "r":
      styles.paddingRight = spacing;
      break;
    case "x":
      styles.paddingLeft = spacing;
      styles.paddingRight = spacing;
      break;
    case "y":
      styles.paddingTop = spacing;
      styles.paddingBottom = spacing;
      break;
    default:
      styles.padding = spacing;
      break;
  }
  return styles;
};

// Margin parser
export const marginParser: Parser = (className, theme) => {
  const match = className.match(/^-?m([tblrxy])?-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, side, value] = match;
  const margin = parseNumericValue(isNegative ? `-${value}` : value, theme, {
    allowNegative: isNegative,
    scale: "spacing",
    allowSpacingUnits: true,
    keywords: { auto: "auto" },
  });

  if (!margin) return null;

  const styles: CSSObjectWithVars = {};
  switch (side) {
    case "t":
      styles.marginTop = margin;
      break;
    case "b":
      styles.marginBottom = margin;
      break;
    case "l":
      styles.marginLeft = margin;
      break;
    case "r":
      styles.marginRight = margin;
      break;
    case "x":
      styles.marginLeft = margin;
      styles.marginRight = margin;
      break;
    case "y":
      styles.marginTop = margin;
      styles.marginBottom = margin;
      break;
    default:
      styles.margin = margin;
      break;
  }
  return styles;
};

// Space between parser
export const spaceBetweenParser: Parser = (className, theme) => {
  const match = className.match(/^-?space-([xy])-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, axis, value] = match;
  const spacing = parseNumericValue(isNegative ? `-${value}` : value, theme, {
    allowNegative: isNegative,
    scale: "spacing",
    allowSpacingUnits: true,
  });

  if (!spacing) return null;

  const varName = axis === "x"
    ? "--tw-space-x-reverse"
    : "--tw-space-y-reverse";
  const isX = axis === "x";

  return {
    "& > :not([hidden]) ~ :not([hidden])": {
      [varName]: "0",
      [isX ? "marginRight" : "marginBottom"]:
        `calc(${spacing} * var(${varName}))`,
      [isX ? "marginLeft" : "marginTop"]:
        `calc(${spacing} * calc(1 - var(${varName})))`,
    },
  };
};

// Gap parser
export const gapParser: Parser = (className, theme) => {
  const match = className.match(/^gap-([xy])?-?(.+)$/);
  if (!match) return null;

  const [, axis, value] = match;
  const gap = parseNumericValue(value, theme, {
    allowNegative: false,
    scale: "spacing",
    allowSpacingUnits: true,
  });

  if (!gap) return null;

  switch (axis) {
    case "x":
      return { columnGap: gap };
    case "y":
      return { rowGap: gap };
    default:
      return { gap };
  }
};

// Width parser
export const widthParser: Parser = (className, theme) => {
  const match = className.match(/^w-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const width = parseNumericValue(value, theme, {
    scale: ["spacing", "size"],
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: {
      auto: "auto",
      full: "100%",
      screen: "100vw",
      svw: "100svw",
      lvw: "100lvw",
      dvw: "100dvw",
      min: "min-content",
      max: "max-content",
      fit: "fit-content",
    },
  });

  return width ? { width } : null;
};

// Height parser
export const heightParser: Parser = (className, theme) => {
  const match = className.match(/^h-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const height = parseNumericValue(value, theme, {
    scale: ["spacing", "size"],
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: {
      auto: "auto",
      full: "100%",
      screen: "100vh",
      svh: "100svh",
      lvh: "100lvh",
      dvh: "100dvh",
      min: "min-content",
      max: "max-content",
      fit: "fit-content",
    },
  });

  return height ? { height } : null;
};

// Min/Max width/height parsers
export const minWidthParser: Parser = (className, theme) => {
  const match = className.match(/^min-w-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const minWidth = parseNumericValue(value, theme, {
    scale: ["spacing", "size", "minWidth"],
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: {
      min: "min-content",
      max: "max-content",
      fit: "fit-content",
      full: "100%",
    },
  });

  return minWidth ? { minWidth } : null;
};

export const maxWidthParser: Parser = (className, theme) => {
  const match = className.match(/^max-w-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const maxWidth = parseNumericValue(value, theme, {
    scale: ["maxWidth"],
    keywords: {
      "3xs": "16rem", // 256px
      "2xs": "18rem", // 288px
      xs: "20rem", // 320px
      sm: "24rem", // 384px
      md: "28rem", // 448px
      lg: "32rem", // 512px
      xl: "36rem", // 576px
      "2xl": "42rem", // 672px
      "3xl": "48rem", // 768px
      "4xl": "56rem", // 896px
      "5xl": "64rem", // 1024px
      "6xl": "72rem", // 1152px
      "7xl": "80rem", // 1280px
      none: "none",
      px: "1px",
      full: "100%",
      dvw: "100dvw",
      dvh: "100dvh",
      lvw: "100lvw",
      lvh: "100lvh",
      svw: "100svw",
      svh: "100svh",
      screen: "100vw",
      min: "min-content",
      max: "max-content",
      fit: "fit-content",
      prose: "65ch",
    },
  });

  return maxWidth ? { maxWidth } : null;
};

export const minHeightParser: Parser = (className, theme) => {
  const match = className.match(/^min-h-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const minHeight = parseNumericValue(value, theme, {
    scale: ["spacing", "size", "minHeight"],
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: {
      min: "min-content",
      max: "max-content",
      fit: "fit-content",
      full: "100%",
      screen: "100vh",
      svh: "100svh",
      lvh: "100lvh",
      dvh: "100dvh",
    },
  });

  return minHeight ? { minHeight } : null;
};

export const maxHeightParser: Parser = (className, theme) => {
  const match = className.match(/^max-h-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const maxHeight = parseNumericValue(value, theme, {
    scale: ["spacing", "size", "maxHeight"],
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: {
      none: "none",
      full: "100%",
      min: "min-content",
      max: "max-content",
      fit: "fit-content",
      screen: "100vh",
      svh: "100svh",
      lvh: "100lvh",
      dvh: "100dvh",
    },
  });

  return maxHeight ? { maxHeight } : null;
};

// Size parser (sets both width and height)
export const sizeParser: Parser = (className, theme) => {
  const match = className.match(/^size-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const size = parseNumericValue(value, theme, {
    scale: ["spacing", "size"],
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: {
      auto: "auto",
      full: "100%",
      min: "min-content",
      max: "max-content",
      fit: "fit-content",
    },
  });

  return size ? { width: size, height: size } : null;
};

// Inset (position) parser
export const insetParser: Parser = (className, theme) => {
  const match = className.match(/^-?inset-([xy])?-?(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, axis, value] = match;
  const inset = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "spacing",
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: { auto: "auto", full: "100%" },
  });

  if (!inset) return null;

  if (!axis) {
    return { inset };
  } else if (axis === "x") {
    return { left: inset, right: inset };
  } else {
    return { top: inset, bottom: inset };
  }
};

// Individual position parsers
export const positionParser: Parser = (className, theme) => {
  const match = className.match(/^-?(top|right|bottom|left|start|end)-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, side, value] = match;
  const position = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "spacing",
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: { auto: "auto", full: "100%" },
  });

  if (!position) return null;

  switch (side) {
    case "start":
      return { insetInlineStart: position };
    case "end":
      return { insetInlineEnd: position };
    default:
      return { [side]: position };
  }
};

// Z-index parser
export const zIndexParser: Parser = (className, theme) => {
  const match = className.match(/^-?z-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, value] = match;

  // Handle predefined z-index values
  const predefinedValues: Record<string, number> = {
    "0": 0,
    "10": 10,
    "20": 20,
    "30": 30,
    "40": 40,
    "50": 50,
    "auto": "auto" as any,
  };

  let zIndex: string | number | undefined;

  if (value in predefinedValues) {
    zIndex = predefinedValues[value];
    if (typeof zIndex === "number" && isNegative) {
      zIndex = -zIndex;
    }
  } else {
    // Try to parse as a numeric value or arbitrary value
    zIndex = parseNumericValue(value, theme, {
      allowNegative: isNegative,
      scale: "zIndex",
      defaultUnit: "",
      keywords: { auto: "auto" },
    });
  }

  return zIndex !== undefined ? { zIndex } : null;
};
