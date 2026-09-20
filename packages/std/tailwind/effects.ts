import type { Parser } from "./types";
import { getThemeToken, parseNumericValue } from "./utils";
import { DEFAULT_OPACITY_SCALE, TW_VAR } from "./constants";

// Box shadow parser
export const boxShadowParser: Parser = (className, theme) => {
  const match = className.match(/^shadow-?(.+)?$/);
  if (!match) return null;

  const [, value = ""] = match;

  // Skip shadow color parsers
  if (
    value &&
    !["sm", "md", "lg", "xl", "2xl", "inner", "none", ""].includes(value)
  ) {
    return null;
  }

  const shadow = value
    ? getThemeToken(theme, "shadow", value)
    : getThemeToken(theme, "shadow", "DEFAULT");

  if (shadow) {
    const shadowStr = String(shadow);

    // Handle colored shadows
    const coloredShadow = shadowStr.replace(
      /(?:rgb|hsl)a?\([^)]+\)\s*\/\s*[^),]+/g,
      `var(${TW_VAR.SHADOW_COLOR}, ${TW_VAR.SHADOW_COLOR_FALLBACK})`,
    );

    return {
      [TW_VAR.SHADOW]: shadowStr === "none" ? "0 0 #0000" : shadowStr,
      [TW_VAR.SHADOW_COLORED]: shadowStr === "none"
        ? "0 0 #0000"
        : coloredShadow,
    };
  }

  return null;
};

// Opacity parser
export const opacityParser: Parser = (className, theme) => {
  const match = className.match(/^opacity-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const opacity = parseNumericValue(value, theme, {
    scale: "opacity",
    defaultUnit: "",
  });

  if (opacity) {
    const opacityValue = parseFloat(opacity) / DEFAULT_OPACITY_SCALE;
    return { opacity: opacityValue };
  }

  return null;
};

// Blur parser
export const blurParser: Parser = (className, theme) => {
  const match = className.match(/^blur-?(.+)?$/);
  if (!match) return null;

  const [, value = ""] = match;
  const blur = value
    ? getThemeToken(theme, "blur", value)
    : getThemeToken(theme, "blur", "DEFAULT");

  return blur ? { [TW_VAR.BLUR]: `blur(${blur})` } : null;
};

// Brightness parser
export const brightnessParser: Parser = (className, theme) => {
  const match = className.match(/^brightness-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const brightness = parseNumericValue(value, theme, {
    scale: "brightness",
    defaultUnit: "",
  });

  if (brightness) {
    const brightnessValue = parseFloat(brightness) / 100;
    return { [TW_VAR.BRIGHTNESS]: `brightness(${brightnessValue})` };
  }

  return null;
};

// Contrast parser
export const contrastParser: Parser = (className, theme) => {
  const match = className.match(/^contrast-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const contrast = parseNumericValue(value, theme, {
    scale: "contrast",
    defaultUnit: "",
  });

  if (contrast) {
    const contrastValue = parseFloat(contrast) / 100;
    return { [TW_VAR.CONTRAST]: `contrast(${contrastValue})` };
  }

  return null;
};

// Grayscale parser
export const grayscaleParser: Parser = (className, theme) => {
  if (className === "grayscale") {
    return { [TW_VAR.GRAYSCALE]: "grayscale(100%)" };
  }

  const match = className.match(/^grayscale-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const grayscale = parseNumericValue(value, theme, {
    scale: "grayscale",
    defaultUnit: "",
  });

  if (grayscale) {
    const grayscaleValue = parseFloat(grayscale) / 100;
    return { [TW_VAR.GRAYSCALE]: `grayscale(${grayscaleValue})` };
  }

  return null;
};

// Hue rotate parser
export const hueRotateParser: Parser = (className, theme) => {
  const match = className.match(/^-?hue-rotate-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, value] = match;
  const hueRotate = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "hueRotate",
    defaultUnit: "deg",
  });

  return hueRotate ? { [TW_VAR.HUE_ROTATE]: `hue-rotate(${hueRotate})` } : null;
};

// Invert parser
export const invertParser: Parser = (className, theme) => {
  if (className === "invert") {
    return { [TW_VAR.INVERT]: "invert(100%)" };
  }

  const match = className.match(/^invert-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const invert = parseNumericValue(value, theme, {
    scale: "invert",
    defaultUnit: "",
  });

  if (invert) {
    const invertValue = parseFloat(invert) / 100;
    return { [TW_VAR.INVERT]: `invert(${invertValue})` };
  }

  return null;
};

// Saturate parser
export const saturateParser: Parser = (className, theme) => {
  const match = className.match(/^saturate-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const saturate = parseNumericValue(value, theme, {
    scale: "saturate",
    defaultUnit: "",
  });

  if (saturate) {
    const saturateValue = parseFloat(saturate) / 100;
    return { [TW_VAR.SATURATE]: `saturate(${saturateValue})` };
  }

  return null;
};

// Sepia parser
export const sepiaParser: Parser = (className, theme) => {
  if (className === "sepia") {
    return { [TW_VAR.SEPIA]: "sepia(100%)" };
  }

  const match = className.match(/^sepia-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const sepia = parseNumericValue(value, theme, {
    scale: "sepia",
    defaultUnit: "",
  });

  if (sepia) {
    const sepiaValue = parseFloat(sepia) / 100;
    return { [TW_VAR.SEPIA]: `sepia(${sepiaValue})` };
  }

  return null;
};

// Drop shadow parser
export const dropShadowParser: Parser = (className, theme) => {
  const match = className.match(/^drop-shadow-?(.+)?$/);
  if (!match) return null;

  const [, value = ""] = match;
  const dropShadow = value
    ? getThemeToken(theme, "dropShadow", value)
    : getThemeToken(theme, "dropShadow", "DEFAULT");

  if (dropShadow) {
    const shadows = Array.isArray(dropShadow) ? dropShadow : [dropShadow];
    const dropShadowValue = shadows.map((s) => `drop-shadow(${s})`).join(" ");
    return { [TW_VAR.DROP_SHADOW]: dropShadowValue };
  }

  return null;
};

// Backdrop blur parser
export const backdropBlurParser: Parser = (className, theme) => {
  const match = className.match(/^backdrop-blur-?(.+)?$/);
  if (!match) return null;

  const [, value = ""] = match;
  const blur = value
    ? getThemeToken(theme, "backdropBlur", value)
    : getThemeToken(theme, "backdropBlur", "DEFAULT");

  return blur ? { "--tw-backdrop-blur": `blur(${blur})` } : null;
};

// Backdrop brightness parser
export const backdropBrightnessParser: Parser = (className, theme) => {
  const match = className.match(/^backdrop-brightness-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const brightness = parseNumericValue(value, theme, {
    scale: "backdropBrightness",
    defaultUnit: "",
  });

  if (brightness) {
    const brightnessValue = parseFloat(brightness) / 100;
    return { "--tw-backdrop-brightness": `brightness(${brightnessValue})` };
  }

  return null;
};

// Backdrop contrast parser
export const backdropContrastParser: Parser = (className, theme) => {
  const match = className.match(/^backdrop-contrast-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const contrast = parseNumericValue(value, theme, {
    scale: "backdropContrast",
    defaultUnit: "",
  });

  if (contrast) {
    const contrastValue = parseFloat(contrast) / 100;
    return { "--tw-backdrop-contrast": `contrast(${contrastValue})` };
  }

  return null;
};

// Backdrop grayscale parser
export const backdropGrayscaleParser: Parser = (className, theme) => {
  if (className === "backdrop-grayscale") {
    return { "--tw-backdrop-grayscale": "grayscale(100%)" };
  }

  const match = className.match(/^backdrop-grayscale-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const grayscale = parseNumericValue(value, theme, {
    scale: "backdropGrayscale",
    defaultUnit: "",
  });

  if (grayscale) {
    const grayscaleValue = parseFloat(grayscale) / 100;
    return { "--tw-backdrop-grayscale": `grayscale(${grayscaleValue})` };
  }

  return null;
};

// Backdrop hue rotate parser
export const backdropHueRotateParser: Parser = (className, theme) => {
  const match = className.match(/^-?backdrop-hue-rotate-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, value] = match;
  const hueRotate = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "backdropHueRotate",
    defaultUnit: "deg",
  });

  return hueRotate
    ? { "--tw-backdrop-hue-rotate": `hue-rotate(${hueRotate})` }
    : null;
};

// Backdrop invert parser
export const backdropInvertParser: Parser = (className, theme) => {
  if (className === "backdrop-invert") {
    return { "--tw-backdrop-invert": "invert(100%)" };
  }

  const match = className.match(/^backdrop-invert-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const invert = parseNumericValue(value, theme, {
    scale: "backdropInvert",
    defaultUnit: "",
  });

  if (invert) {
    const invertValue = parseFloat(invert) / 100;
    return { "--tw-backdrop-invert": `invert(${invertValue})` };
  }

  return null;
};

// Backdrop opacity parser
export const backdropOpacityParser: Parser = (className, theme) => {
  const match = className.match(/^backdrop-opacity-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const opacity = parseNumericValue(value, theme, {
    scale: "backdropOpacity",
    defaultUnit: "",
  });

  if (opacity) {
    const opacityValue = parseFloat(opacity) / DEFAULT_OPACITY_SCALE;
    return { "--tw-backdrop-opacity": `opacity(${opacityValue})` };
  }

  return null;
};

// Backdrop saturate parser
export const backdropSaturateParser: Parser = (className, theme) => {
  const match = className.match(/^backdrop-saturate-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const saturate = parseNumericValue(value, theme, {
    scale: "backdropSaturate",
    defaultUnit: "",
  });

  if (saturate) {
    const saturateValue = parseFloat(saturate) / 100;
    return { "--tw-backdrop-saturate": `saturate(${saturateValue})` };
  }

  return null;
};

// Backdrop sepia parser
export const backdropSepiaParser: Parser = (className, theme) => {
  if (className === "backdrop-sepia") {
    return { "--tw-backdrop-sepia": "sepia(100%)" };
  }

  const match = className.match(/^backdrop-sepia-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const sepia = parseNumericValue(value, theme, {
    scale: "backdropSepia",
    defaultUnit: "",
  });

  if (sepia) {
    const sepiaValue = parseFloat(sepia) / 100;
    return { "--tw-backdrop-sepia": `sepia(${sepiaValue})` };
  }

  return null;
};
