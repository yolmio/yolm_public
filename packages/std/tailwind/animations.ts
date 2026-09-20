import type { Parser } from "./types";
import { getThemeToken } from "./utils";

// Animation parser
export const animationParser: Parser = (className, theme) => {
  const match = className.match(/^animate-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  // Handle none
  if (value === "none") {
    return { animation: "none" };
  }

  // Check theme animations
  const animation = getThemeToken(theme, "animation", value);

  if (animation) {
    return { animation: String(animation) };
  }

  return null;
};

// Transition property parser
export const transitionPropertyParser: Parser = (className, theme) => {
  const match = className.match(/^transition(-(.+))?$/);
  if (!match) return null;

  const [, , value = ""] = match;

  // Default transition
  if (!value) {
    const defaultTransition =
      getThemeToken(theme, "transitionProperty", "DEFAULT") ||
      "color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter";

    const duration = getThemeToken(theme, "transitionDuration", "DEFAULT") ||
      "150ms";
    const timing =
      getThemeToken(theme, "transitionTimingFunction", "DEFAULT") ||
      "cubic-bezier(0.4, 0, 0.2, 1)";

    return {
      transitionProperty: String(defaultTransition),
      transitionTimingFunction: String(timing),
      transitionDuration: String(duration),
    };
  }

  // None
  if (value === "none") {
    return { transitionProperty: "none" };
  }

  // Theme values
  const property = getThemeToken(theme, "transitionProperty", value);

  if (property) {
    const duration = getThemeToken(theme, "transitionDuration", "DEFAULT") ||
      "150ms";
    const timing =
      getThemeToken(theme, "transitionTimingFunction", "DEFAULT") ||
      "cubic-bezier(0.4, 0, 0.2, 1)";

    return {
      transitionProperty: String(property),
      transitionTimingFunction: String(timing),
      transitionDuration: String(duration),
    };
  }

  return null;
};

// Transition duration parser
export const transitionDurationParser: Parser = (className, theme) => {
  const match = className.match(/^duration-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const duration = getThemeToken(theme, "transitionDuration", value);

  if (duration) {
    return { transitionDuration: String(duration) };
  }

  // Handle numeric values as milliseconds
  const num = parseFloat(value);
  if (!isNaN(num)) {
    return { transitionDuration: `${num}ms` };
  }

  return null;
};

// Transition timing function parser
export const transitionTimingFunctionParser: Parser = (className, theme) => {
  const match = className.match(/^ease-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const timing = getThemeToken(theme, "transitionTimingFunction", value);

  return timing ? { transitionTimingFunction: String(timing) } : null;
};

// Transition delay parser
export const transitionDelayParser: Parser = (className, theme) => {
  const match = className.match(/^delay-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const delay = getThemeToken(theme, "transitionDelay", value);

  if (delay) {
    return { transitionDelay: String(delay) };
  }

  // Handle numeric values as milliseconds
  const num = parseFloat(value);
  if (!isNaN(num)) {
    return { transitionDelay: `${num}ms` };
  }

  return null;
};
