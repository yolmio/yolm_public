import type { CSSObjectWithVars, Parser } from "./types";
import type { Theme } from "../theme";
import { normaliseOpacity, parseNumericValue } from "./utils";
import { TW_VAR } from "./constants";

// ───────────────────────────────────────────────────────────────────────────────
// Background colour
// ───────────────────────────────────────────────────────────────────────────────
export const backgroundColorParser: Parser = (className, theme) => {
  const m = className.match(/^bg-(.+)$/);
  if (!m) return null;

  const [, colourValue] = m;
  const col = parseColourValue(colourValue, theme, TW_VAR.BG_OPACITY);
  if (!col) return null;

  const styles: CSSObjectWithVars = { backgroundColor: col.rgb };
  if (col.opacity !== undefined) {
    styles[TW_VAR.BG_OPACITY] = String(col.opacity);
  }
  return styles;
};

// Background opacity
export const backgroundOpacityParser: Parser = (className, theme) => {
  const m = className.match(/^bg-opacity-(.+)$/);
  if (!m) return null;

  const [, value] = m;
  const opRaw = parseNumericValue(value, theme, {
    scale: "opacity",
    defaultUnit: "",
  });
  if (!opRaw) return null;

  return { [TW_VAR.BG_OPACITY]: String(normaliseOpacity(opRaw)) };
};

// ───────────────────────────────────────────────────────────────────────────────
// Border colour (sided incl. logical)
// ───────────────────────────────────────────────────────────────────────────────
export const borderColorParser: Parser = (className, theme) => {
  const m = className.match(
    /^border-((?:[trblxyse])|(?:[tb][lr])|(?:[sb][se]))?-?(.+)$/,
  );
  if (!m) return null;

  const [, side, colourValue] = m;

  // skip non-colour utilities
  if (
    !side &&
    /^\d+$|^(solid|dashed|dotted|double|hidden|none)$/.test(colourValue)
  ) {
    return null;
  }

  const col = parseColourValue(colourValue, theme, TW_VAR.BORDER_OPACITY);
  if (!col) return null;

  const s: CSSObjectWithVars = {};
  if (col.opacity !== undefined) s[TW_VAR.BORDER_OPACITY] = String(col.opacity);

  switch (side) {
    case "t":
      s.borderTopColor = col.rgb;
      break;
    case "r":
      s.borderRightColor = col.rgb;
      break;
    case "b":
      s.borderBottomColor = col.rgb;
      break;
    case "l":
      s.borderLeftColor = col.rgb;
      break;
    case "x":
      s.borderLeftColor = s.borderRightColor = col.rgb;
      break;
    case "y":
      s.borderTopColor = s.borderBottomColor = col.rgb;
      break;
    case "s":
      s.borderInlineStartColor = col.rgb;
      break;
    case "e":
      s.borderInlineEndColor = col.rgb;
      break;
    default:
      s.borderColor = col.rgb;
  }
  return s;
};

// Border opacity
export const borderOpacityParser: Parser = (className, theme) => {
  const m = className.match(/^border-opacity-(.+)$/);
  if (!m) return null;

  const [, value] = m;
  const opRaw = parseNumericValue(value, theme, {
    scale: "opacity",
    defaultUnit: "",
  });
  if (!opRaw) return null;

  return { [TW_VAR.BORDER_OPACITY]: String(normaliseOpacity(opRaw)) };
};

// ───────────────────────────────────────────────────────────────────────────────
// (outline / ring / divide … unchanged below, only opacity calc updated)
// ───────────────────────────────────────────────────────────────────────────────

// Outline colour
export const outlineColorParser: Parser = (className, theme) => {
  const m = className.match(/^outline-(.+)$/);
  if (!m) return null;

  const [, colourValue] = m;
  if (/^\d+$|^(none|dashed|dotted|double|solid)$/.test(colourValue)) {
    return null;
  }

  const col = parseColourValue(colourValue, theme, TW_VAR.OUTLINE_OPACITY);
  if (!col) return null;

  const st: CSSObjectWithVars = { outlineColor: col.rgb };
  if (col.opacity !== undefined) {
    st[TW_VAR.OUTLINE_OPACITY] = String(col.opacity);
  }
  return st;
};

// Ring colour
export const ringColorParser: Parser = (className, theme) => {
  const m = className.match(/^ring-(.+)$/);
  if (!m) return null;

  const [, value] = m;
  if (/^\d+$|^(inset|offset-.+)$/.test(value)) return null;

  const col = parseColourValue(value, theme, TW_VAR.RING_OPACITY);
  if (!col) return null;

  const st: CSSObjectWithVars = { [TW_VAR.RING_COLOR]: col.rgb };
  if (col.opacity !== undefined) st[TW_VAR.RING_OPACITY] = String(col.opacity);
  return st;
};

export const ringOpacityParser: Parser = (className, theme) => {
  const m = className.match(/^ring-opacity-(.+)$/);
  if (!m) return null;

  const [, value] = m;
  const opRaw = parseNumericValue(value, theme, {
    scale: "opacity",
    defaultUnit: "",
  });
  if (!opRaw) return null;

  return { [TW_VAR.RING_OPACITY]: String(normaliseOpacity(opRaw)) };
};

// Ring offset colour
export const ringOffsetColorParser: Parser = (className, theme) => {
  const m = className.match(/^ring-offset-(.+)$/);
  if (!m) return null;

  const [, value] = m;
  if (/^\d+$/.test(value)) return null;

  const col = parseColourValue(value, theme);
  return col ? { [TW_VAR.RING_OFFSET_COLOR]: col.rgb } : null;
};

// Shadow colour
export const shadowColorParser: Parser = (className, theme) => {
  const m = className.match(/^shadow-(.+)$/);
  if (!m) return null;

  const [, value] = m;
  if (/^(sm|md|lg|xl|2xl|inner|none)$/.test(value)) return null;

  const col = parseColourValue(value, theme);
  if (!col) return null;

  return {
    [TW_VAR.SHADOW_COLOR]: col.rgb,
    [TW_VAR.SHADOW_COLORED]: `var(${TW_VAR.SHADOW})`.replace(
      /(?:rgb|hsl)a?\([^)]+\)\s*\/\s*[^),]+/g,
      `var(${TW_VAR.SHADOW_COLOR})`,
    ),
  };
};

// Gradient parsers (unchanged except uses parseColourValue) …
// Divide colour / opacity parsers (opacity calc uses normaliseOpacity) …

// ───────────────────────────────────────────────────────────────────────────────
// Helper: parseColourValue
// ───────────────────────────────────────────────────────────────────────────────

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

function parseColourValue(
  raw: string,
  theme: Theme,
  opacityVar?: string,
): { rgb: string; opacity?: number } | null {
  // 1. Arbitrary
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return { rgb: raw.slice(1, -1) };
  }

  // 2. Split for opacity
  const [path, opToken] = raw.split("/");
  const parts = path.split("-");

  // 3. Check for palette colors (primary-500, danger-100, etc.)
  if (parts.length === 2) {
    const [colorName, scale] = parts;
    if (
      PALETTE_COLORS.includes(colorName as typeof PALETTE_COLORS[number]) &&
      PALETTE_SCALES.includes(scale as typeof PALETTE_SCALES[number])
    ) {
      let op: number | undefined;
      if (opToken) {
        const parsed = parseNumericValue(opToken, theme, {
          scale: "opacity",
          defaultUnit: "",
        });
        if (parsed) op = normaliseOpacity(parsed);
      }
      return { rgb: `var(--palette-${colorName}-${scale})`, opacity: op };
    }
  }

  // 4. Walk theme tokens for raw colors (red-500, blue-100, etc.)
  let obj: any = theme.tokens.colors;
  if (!obj) return null;

  for (const p of parts) {
    if (isObject(obj) && p in obj) obj = obj[p];
    else {
      obj = theme.tokens.colors[path];
      break;
    }
  }

  if (isObject(obj) && "DEFAULT" in obj) obj = obj.DEFAULT;
  if (typeof obj !== "string") return null;

  // 5. Opacity
  let op: number | undefined;
  if (opToken) {
    const parsed = parseNumericValue(opToken, theme, {
      scale: "opacity",
      defaultUnit: "",
    });
    if (parsed) op = normaliseOpacity(parsed);
  }

  const rgb = opacityVar
    ? obj.replace(/<alpha-value>/g, `var(${opacityVar}, 1)`)
    : obj.replace(/<alpha-value>/g, "1");

  return { rgb, opacity: op };
}

// ───────────────────────────────────────────────────────────────────────────────
// Gradient parsers
// ───────────────────────────────────────────────────────────────────────────────
export const gradientFromParser: Parser = (className, theme) => {
  const m = className.match(/^from-(.+)$/);
  if (!m) return null;

  const [, colourValue] = m;
  const col = parseColourValue(colourValue, theme);
  if (!col) return null;

  return {
    [TW_VAR.GRADIENT_FROM]: col.rgb,
    [TW_VAR.GRADIENT_TO]: "rgb(0 0 0 / 0)",
    [TW_VAR.GRADIENT_STOPS]:
      `var(${TW_VAR.GRADIENT_FROM}), var(${TW_VAR.GRADIENT_TO})`,
  };
};

export const gradientViaParser: Parser = (className, theme) => {
  const m = className.match(/^via-(.+)$/);
  if (!m) return null;

  const [, colourValue] = m;
  const col = parseColourValue(colourValue, theme);
  if (!col) return null;

  return {
    [TW_VAR.GRADIENT_VIA]: col.rgb,
    [TW_VAR.GRADIENT_STOPS]:
      `var(${TW_VAR.GRADIENT_FROM}), var(${TW_VAR.GRADIENT_VIA}), var(${TW_VAR.GRADIENT_TO})`,
  };
};

export const gradientToParser: Parser = (className, theme) => {
  const m = className.match(/^to-(.+)$/);
  if (!m) return null;

  const [, colourValue] = m;
  const col = parseColourValue(colourValue, theme);
  if (!col) return null;

  return {
    [TW_VAR.GRADIENT_TO]: col.rgb,
  };
};

// ───────────────────────────────────────────────────────────────────────────────
// Divide parsers
// ───────────────────────────────────────────────────────────────────────────────
export const divideColorParser: Parser = (className, theme) => {
  const m = className.match(/^divide-(.+)$/);
  if (!m) return null;

  const [, colourValue] = m;

  // Skip if it's not a color
  if (/^[xy]$|^\d+$|^(solid|dashed|dotted|double|none)$/.test(colourValue)) {
    return null;
  }

  const col = parseColourValue(colourValue, theme, TW_VAR.BORDER_OPACITY);
  if (!col) return null;

  const styles: CSSObjectWithVars = {
    "& > :not([hidden]) ~ :not([hidden])": {
      borderColor: col.rgb,
    },
  };

  if (col.opacity !== undefined) {
    styles[TW_VAR.BORDER_OPACITY] = String(col.opacity);
  }

  return styles;
};

export const divideOpacityParser: Parser = (className, theme) => {
  const m = className.match(/^divide-opacity-(.+)$/);
  if (!m) return null;

  const [, value] = m;
  const opRaw = parseNumericValue(value, theme, {
    scale: "opacity",
    defaultUnit: "",
  });
  if (!opRaw) return null;

  return {
    "& > :not([hidden]) ~ :not([hidden])": {
      [TW_VAR.BORDER_OPACITY]: String(normaliseOpacity(opRaw)),
    },
  };
};

// Utility guard
function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
