import type { CSSObjectWithVars } from "./types";

// Default units and scales
export const DEFAULT_SPACING_UNIT = "rem";
export const DEFAULT_OPACITY_SCALE = 100;

// CSS variable names used by Tailwind structure
export const TW_VAR = {
  // Opacity
  BG_OPACITY: "--tw-bg-opacity",
  TEXT_OPACITY: "--tw-text-opacity",
  BORDER_OPACITY: "--tw-border-opacity",
  OUTLINE_OPACITY: "--tw-outline-opacity",
  RING_OPACITY: "--tw-ring-opacity",
  SHADOW_COLOR: "--tw-shadow-color",
  SHADOW_COLOR_FALLBACK: "rgb(0 0 0 / 0.0)",

  // Ring
  RING_INSET: "--tw-ring-inset",
  RING_OFFSET_WIDTH: "--tw-ring-offset-width",
  RING_OFFSET_COLOR: "--tw-ring-offset-color",
  RING_WIDTH: "--tw-ring-width",
  RING_COLOR: "--tw-ring-color",

  // Shadow
  SHADOW: "--tw-shadow",
  SHADOW_COLORED: "--tw-shadow-colored",

  // Transform
  TRANSLATE_X: "--tw-translate-x",
  TRANSLATE_Y: "--tw-translate-y",
  ROTATE: "--tw-rotate",
  SKEW_X: "--tw-skew-x",
  SKEW_Y: "--tw-skew-y",
  SCALE_X: "--tw-scale-x",
  SCALE_Y: "--tw-scale-y",

  // Filters
  BLUR: "--tw-blur",
  BRIGHTNESS: "--tw-brightness",
  CONTRAST: "--tw-contrast",
  GRAYSCALE: "--tw-grayscale",
  HUE_ROTATE: "--tw-hue-rotate",
  INVERT: "--tw-invert",
  SATURATE: "--tw-saturate",
  SEPIA: "--tw-sepia",
  DROP_SHADOW: "--tw-drop-shadow",

  // Backdrop Filters
  BACKDROP_BLUR: "--tw-backdrop-blur",
  BACKDROP_BRIGHTNESS: "--tw-backdrop-brightness",
  BACKDROP_CONTRAST: "--tw-backdrop-contrast",
  BACKDROP_GRAYSCALE: "--tw-backdrop-grayscale",
  BACKDROP_HUE_ROTATE: "--tw-backdrop-hue-rotate",
  BACKDROP_INVERT: "--tw-backdrop-invert",
  BACKDROP_OPACITY: "--tw-backdrop-opacity",
  BACKDROP_SATURATE: "--tw-backdrop-saturate",
  BACKDROP_SEPIA: "--tw-backdrop-sepia",

  // Gradients
  GRADIENT_FROM: "--tw-gradient-from",
  GRADIENT_TO: "--tw-gradient-to",
  GRADIENT_VIA: "--tw-gradient-via",
  GRADIENT_STOPS: "--tw-gradient-stops",

  // Space Between
  SPACE_X_REVERSE: "--tw-space-x-reverse",
  SPACE_Y_REVERSE: "--tw-space-y-reverse",

  // Scroll Snap
  SCROLL_SNAP_STRICTNESS: "--tw-scroll-snap-strictness",
} as const;

// Styles that depend on CSS variables being set
export const BASE_VAR_DEPENDENT_STYLES: CSSObjectWithVars = {
  // Ring shadow structure
  boxShadow:
    `var(${TW_VAR.RING_INSET}) 0 0 0 calc(var(${TW_VAR.RING_OFFSET_WIDTH}, 0px)) var(${TW_VAR.RING_OFFSET_COLOR}, #fff), ` +
    `var(${TW_VAR.RING_INSET}) 0 0 0 calc(var(${TW_VAR.RING_WIDTH}, 0px) + var(${TW_VAR.RING_OFFSET_WIDTH}, 0px)) var(${TW_VAR.RING_COLOR}, rgb(59 130 246 / 0.5)), ` +
    `var(${TW_VAR.SHADOW}, 0 0 #0000)`,

  // Transform structure
  transform:
    `translate(var(${TW_VAR.TRANSLATE_X}, 0), var(${TW_VAR.TRANSLATE_Y}, 0)) ` +
    `rotate(var(${TW_VAR.ROTATE}, 0)) ` +
    `skewX(var(${TW_VAR.SKEW_X}, 0)) ` +
    `skewY(var(${TW_VAR.SKEW_Y}, 0)) ` +
    `scaleX(var(${TW_VAR.SCALE_X}, 1)) ` +
    `scaleY(var(${TW_VAR.SCALE_Y}, 1))`,

  // Filter structure
  filter: `var(${TW_VAR.BLUR}, ) ` +
    `var(${TW_VAR.BRIGHTNESS}, ) ` +
    `var(${TW_VAR.CONTRAST}, ) ` +
    `var(${TW_VAR.GRAYSCALE}, ) ` +
    `var(${TW_VAR.HUE_ROTATE}, ) ` +
    `var(${TW_VAR.INVERT}, ) ` +
    `var(${TW_VAR.SATURATE}, ) ` +
    `var(${TW_VAR.SEPIA}, ) ` +
    `var(${TW_VAR.DROP_SHADOW}, )`,

  // Backdrop filter structure
  backdropFilter: `var(${TW_VAR.BACKDROP_BLUR}, ) ` +
    `var(${TW_VAR.BACKDROP_BRIGHTNESS}, ) ` +
    `var(${TW_VAR.BACKDROP_CONTRAST}, ) ` +
    `var(${TW_VAR.BACKDROP_GRAYSCALE}, ) ` +
    `var(${TW_VAR.BACKDROP_HUE_ROTATE}, ) ` +
    `var(${TW_VAR.BACKDROP_INVERT}, ) ` +
    `var(${TW_VAR.BACKDROP_OPACITY}, ) ` +
    `var(${TW_VAR.BACKDROP_SATURATE}, ) ` +
    `var(${TW_VAR.BACKDROP_SEPIA}, )`,
};
