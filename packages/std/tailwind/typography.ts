import type { CSSObjectWithVars, Parser } from "./types";
import type { Theme } from "../theme";
import { getArbitraryValue, getThemeToken, parseNumericValue } from "./utils";
import { DEFAULT_OPACITY_SCALE, TW_VAR } from "./constants";

// Font size parser
export const fontSizeParser: Parser = (className, theme) => {
  const match = className.match(/^text-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  const arbitrary = getArbitraryValue(value);
  if (arbitrary) {
    return { fontSize: arbitrary };
  }

  // Check if it's a font size token
  const fontSize = getThemeToken(theme, "fontSize", value);
  if (fontSize) {
    if (typeof fontSize === "string") {
      return { fontSize };
    } else if (Array.isArray(fontSize)) {
      const [size, lineHeightOrConfig] = fontSize;
      const styles: CSSObjectWithVars = { fontSize: size };

      if (typeof lineHeightOrConfig === "string") {
        styles.lineHeight = lineHeightOrConfig;
      } else if (typeof lineHeightOrConfig === "object") {
        const { lineHeight, letterSpacing, fontWeight } = lineHeightOrConfig;
        if (lineHeight) styles.lineHeight = lineHeight;
        if (letterSpacing) styles.letterSpacing = letterSpacing;
        if (fontWeight) styles.fontWeight = String(fontWeight);
      }

      return styles;
    }
  }

  // Not a font size, return null to let other parsers handle it
  return null;
};

// Font family parser
export const fontFamilyParser: Parser = (className, theme) => {
  const match = className.match(/^font-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const fontFamily = getThemeToken(theme, "fontFamily", value);

  if (fontFamily) {
    const family = Array.isArray(fontFamily)
      ? fontFamily.join(", ")
      : fontFamily;
    return { fontFamily: family };
  }

  return null;
};

// Font weight parser
export const fontWeightParser: Parser = (className, theme) => {
  const match = className.match(/^font-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const fontWeight = getThemeToken(theme, "fontWeight", value);

  return fontWeight ? { fontWeight: String(fontWeight) } : null;
};

// Leading (line height) parser
export const lineHeightParser: Parser = (className, theme) => {
  const match = className.match(/^leading-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const lineHeight = parseNumericValue(value, theme, {
    scale: "lineHeight",
    allowSpacingUnits: true,
    keywords: { none: "1" },
  });

  return lineHeight ? { lineHeight } : null;
};

// Letter spacing parser
export const letterSpacingParser: Parser = (className, theme) => {
  const match = className.match(/^-?tracking-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, value] = match;
  const letterSpacing = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "letterSpacing",
    defaultUnit: "em",
  });

  return letterSpacing ? { letterSpacing } : null;
};

// Text color parser
export const textColorParser: Parser = (className, theme) => {
  const match = className.match(/^text-(.+)$/);
  if (!match) return null;

  const [, colorValue] = match;
  const color = parseColorValue(colorValue, theme);

  if (color) {
    if (color.opacity !== undefined) {
      return {
        [TW_VAR.TEXT_OPACITY]: String(color.opacity),
        color: color.rgb,
      };
    }
    return { color: color.rgb };
  }

  return null;
};

// Text opacity parser
export const textOpacityParser: Parser = (className, theme) => {
  const match = className.match(/^text-opacity-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const opacity = parseNumericValue(value, theme, {
    scale: "opacity",
    defaultUnit: "",
  });

  if (opacity) {
    const opacityValue = parseFloat(opacity) / DEFAULT_OPACITY_SCALE;
    return { [TW_VAR.TEXT_OPACITY]: String(opacityValue) };
  }

  return null;
};

// Text decoration color parser
export const textDecorationColorParser: Parser = (className, theme) => {
  const match = className.match(/^decoration-(.+)$/);
  if (!match) return null;

  const [, colorValue] = match;
  const color = parseColorValue(colorValue, theme);

  return color ? { textDecorationColor: color.rgb } : null;
};

// Text decoration style parser
export const textDecorationStyleParser: Parser = (className, _theme) => {
  const styles: Record<string, CSSObjectWithVars> = {
    "decoration-solid": { textDecorationStyle: "solid" },
    "decoration-double": { textDecorationStyle: "double" },
    "decoration-dotted": { textDecorationStyle: "dotted" },
    "decoration-dashed": { textDecorationStyle: "dashed" },
    "decoration-wavy": { textDecorationStyle: "wavy" },
  };

  return styles[className] || null;
};

// Text decoration thickness parser
export const textDecorationThicknessParser: Parser = (className, theme) => {
  const match = className.match(/^decoration-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  // Check if it's a thickness value
  const thickness = parseNumericValue(value, theme, {
    scale: "textDecorationThickness",
    allowSpacingUnits: true,
    keywords: {
      auto: "auto",
      "from-font": "from-font",
    },
    defaultUnit: "px",
  });

  if (thickness) {
    return { textDecorationThickness: thickness };
  }

  return null;
};

// Text underline offset parser
export const textUnderlineOffsetParser: Parser = (className, theme) => {
  const match = className.match(/^underline-offset-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const offset = parseNumericValue(value, theme, {
    scale: "textUnderlineOffset",
    allowSpacingUnits: true,
    keywords: { auto: "auto" },
    defaultUnit: "px",
  });

  return offset ? { textUnderlineOffset: offset } : null;
};

// Text indent parser
export const textIndentParser: Parser = (className, theme) => {
  const match = className.match(/^-?indent-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, value] = match;
  const indent = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "textIndent",
    allowSpacingUnits: true,
  });

  return indent ? { textIndent: indent } : null;
};

// Semantic palette colors that map to CSS variables
const PALETTE_COLORS = [
  "primary",
  "neutral",
  "danger",
  "success",
  "warning",
] as const;
const PALETTE_SCALES = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
] as const;

// Helper function to parse color values
function parseColorValue(
  value: string,
  theme: Theme,
): { rgb: string; opacity?: number } | null {
  // Handle arbitrary values
  if (value.startsWith("[") && value.endsWith("]")) {
    const arbitrary = value.slice(1, -1);
    return { rgb: arbitrary };
  }

  // Split by slash for opacity
  const parts = value.split("/");
  const colorPath = parts[0];
  const opacityValue = parts[1];

  // Parse the color path (e.g., "red-500" or "primary-500")
  const pathParts = colorPath.split("-");

  // Check for palette colors (primary-500, danger-100, etc.)
  if (pathParts.length === 2) {
    const [colorName, scale] = pathParts;
    if (
      PALETTE_COLORS.includes(colorName as typeof PALETTE_COLORS[number]) &&
      PALETTE_SCALES.includes(scale as typeof PALETTE_SCALES[number])
    ) {
      let opacity: number | undefined;
      if (opacityValue) {
        const parsedOpacity = parseNumericValue(opacityValue, theme, {
          scale: "opacity",
          defaultUnit: "",
        });
        if (parsedOpacity) {
          opacity = parseFloat(parsedOpacity) / DEFAULT_OPACITY_SCALE;
        }
      }
      return { rgb: `var(--palette-${colorName}-${scale})`, opacity };
    }
  }

  // Check theme colors
  const colors = theme.tokens.colors;
  if (!colors) return null;

  let colorObj: any = colors;
  for (const part of pathParts) {
    if (colorObj && typeof colorObj === "object" && part in colorObj) {
      colorObj = colorObj[part];
    } else {
      // Try as a complete key
      colorObj = colors[colorPath];
      break;
    }
  }

  if (!colorObj || typeof colorObj !== "string") return null;

  // Parse opacity if provided
  let opacity: number | undefined;
  if (opacityValue) {
    const parsedOpacity = parseNumericValue(opacityValue, theme, {
      scale: "opacity",
      defaultUnit: "",
    });

    if (parsedOpacity) {
      opacity = parseFloat(parsedOpacity) / DEFAULT_OPACITY_SCALE;
    }
  }

  // Convert color to RGB format with opacity variable
  const rgb = colorObj.replace(
    /<alpha-value>/g,
    `var(${TW_VAR.TEXT_OPACITY}, 1)`,
  );

  return { rgb, opacity };
}
