import type { Theme } from "../theme";

// Allow CSS variables (--*) alongside standard CSS properties
// This is a flexible type that allows for CSS custom properties and extended CSS features
export interface CSSObjectWithVars {
  [key: string]: any;
}

// Parser function type
export type Parser = (
  className: string,
  theme: Theme,
) => CSSObjectWithVars | null;

// Parsed class result
export interface ParsedClass {
  prefixes: string[];
  styles: CSSObjectWithVars | null;
  coreClass: string; // Store the base class for debugging/logging
}

// Numeric value parsing options
export interface ParseNumericOptions {
  allowNegative?: boolean;
  scale?: string | string[];
  allowSpacingUnits?: boolean;
  allowFractions?: boolean;
  keywords?: Record<string, string | undefined>;
  defaultUnit?: string;
}

// Type guard for objects
export function isObject(item: any): item is Record<string, any> {
  return item && typeof item === "object" && !Array.isArray(item);
}

// Safe theme token accessor with proper typing
export function getThemeToken(
  theme: Theme,
  tokenType: string,
  key: string,
): any {
  const tokens = (theme.tokens as any)?.[tokenType];
  if (tokens && typeof tokens === "object" && key in tokens) {
    return tokens[key];
  }
  return undefined;
}

// Configuration interface for parser options
export interface TailwindConfig {
  enableWarnings?: boolean;
  enablePrintStyles?: boolean;
  enableForcedColors?: boolean;
}
