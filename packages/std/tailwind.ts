// Re-export everything from the modular tailwind implementation
export * from "./tailwind/index";

// For backward compatibility, also export specific items that might be imported directly
export { parseTailwindClass, processTailwindClasses } from "./tailwind/index";
export type {
  CSSObjectWithVars,
  ParsedClass,
  ParseNumericOptions,
  Parser,
  TailwindConfig,
} from "./tailwind/types";
export {
  BASE_VAR_DEPENDENT_STYLES,
  DEFAULT_OPACITY_SCALE,
  DEFAULT_SPACING_UNIT,
  TW_VAR,
} from "./tailwind/constants";
export {
  deepMerge,
  getArbitraryValue,
  getBreakpointValue,
  getContainerValue,
  getMaxWidthValue,
  mapSpacing,
  memoize,
  parseNumericValue,
} from "./tailwind/utils";
export { staticClasses } from "./tailwind/static-classes";

// Export the main function with the expected name for backward compatibility
export { processTailwindClasses as tailwindClassesToStyleObject } from "./tailwind/index";
