import type { CSSObjectWithVars, Parser } from "./types";
import { parseNumericValue } from "./utils";
import { TW_VAR } from "./constants";

// Scale parser
export const scaleParser: Parser = (className, theme) => {
  const match = className.match(/^-?scale-([xy])?-?(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, axis, value] = match;

  const scale = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "scale",
    defaultUnit: "",
  });

  if (!scale) return null;

  const scaleValue = parseFloat(scale) / 100;
  const styles: CSSObjectWithVars = {};

  if (!axis) {
    styles[TW_VAR.SCALE_X] = String(scaleValue);
    styles[TW_VAR.SCALE_Y] = String(scaleValue);
  } else if (axis === "x") {
    styles[TW_VAR.SCALE_X] = String(scaleValue);
  } else {
    styles[TW_VAR.SCALE_Y] = String(scaleValue);
  }

  return styles;
};

// Rotate parser
export const rotateParser: Parser = (className, theme) => {
  const match = className.match(/^-?rotate-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, value] = match;

  const rotate = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "rotate",
    defaultUnit: "deg",
  });

  return rotate ? { [TW_VAR.ROTATE]: rotate } : null;
};

// Translate parser
export const translateParser: Parser = (className, theme) => {
  const match = className.match(/^-?translate-([xy])-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, axis, value] = match;

  const translate = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "translate",
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: { full: "100%" },
  });

  if (!translate) return null;

  return axis === "x"
    ? { [TW_VAR.TRANSLATE_X]: translate }
    : { [TW_VAR.TRANSLATE_Y]: translate };
};

// Skew parser
export const skewParser: Parser = (className, theme) => {
  const match = className.match(/^-?skew-([xy])-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, axis, value] = match;

  const skew = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "skew",
    defaultUnit: "deg",
  });

  if (!skew) return null;

  return axis === "x" ? { [TW_VAR.SKEW_X]: skew } : { [TW_VAR.SKEW_Y]: skew };
};

// Transform origin parser
export const transformOriginParser: Parser = (className, theme) => {
  const match = className.match(/^origin-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const origin = getThemeToken(theme, "transformOrigin", value);

  return origin ? { transformOrigin: String(origin) } : null;
};

// Transform parser for enabling/disabling
export const transformParser: Parser = (className, _theme) => {
  const transforms: Record<string, CSSObjectWithVars> = {
    transform: {
      transform:
        `translate(var(${TW_VAR.TRANSLATE_X}, 0), var(${TW_VAR.TRANSLATE_Y}, 0)) ` +
        `rotate(var(${TW_VAR.ROTATE}, 0)) ` +
        `skewX(var(${TW_VAR.SKEW_X}, 0)) ` +
        `skewY(var(${TW_VAR.SKEW_Y}, 0)) ` +
        `scaleX(var(${TW_VAR.SCALE_X}, 1)) ` +
        `scaleY(var(${TW_VAR.SCALE_Y}, 1))`,
    },
    "transform-cpu": {
      transform:
        `translate(var(${TW_VAR.TRANSLATE_X}, 0), var(${TW_VAR.TRANSLATE_Y}, 0)) ` +
        `rotate(var(${TW_VAR.ROTATE}, 0)) ` +
        `skewX(var(${TW_VAR.SKEW_X}, 0)) ` +
        `skewY(var(${TW_VAR.SKEW_Y}, 0)) ` +
        `scaleX(var(${TW_VAR.SCALE_X}, 1)) ` +
        `scaleY(var(${TW_VAR.SCALE_Y}, 1))`,
    },
    "transform-gpu": {
      transform:
        `translate3d(var(${TW_VAR.TRANSLATE_X}, 0), var(${TW_VAR.TRANSLATE_Y}, 0), 0) ` +
        `rotate(var(${TW_VAR.ROTATE}, 0)) ` +
        `skewX(var(${TW_VAR.SKEW_X}, 0)) ` +
        `skewY(var(${TW_VAR.SKEW_Y}, 0)) ` +
        `scaleX(var(${TW_VAR.SCALE_X}, 1)) ` +
        `scaleY(var(${TW_VAR.SCALE_Y}, 1))`,
    },
    "transform-none": {
      transform: "none",
    },
  };

  return transforms[className] || null;
};

// Helper to get theme token
function getThemeToken(theme: any, path: string, key: string): any {
  return theme?.tokens?.[path]?.[key];
}
