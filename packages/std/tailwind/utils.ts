import type { Theme } from "../theme";
import { DEFAULT_OPACITY_SCALE, DEFAULT_SPACING_UNIT } from "./constants";
import type { CSSObjectWithVars, ParseNumericOptions } from "./types";
import { getThemeToken, isObject } from "./types";

// Re-export for convenience
export { getThemeToken };

// ───────────────────────────────────────────────────────────────────────────────
// Memoisation
// ───────────────────────────────────────────────────────────────────────────────
const memoCache = new WeakMap<Theme, Map<string, any>>();

export function memoize<T>(theme: Theme, key: string, fn: () => T): T {
  if (!memoCache.has(theme)) memoCache.set(theme, new Map());
  const cache = memoCache.get(theme)!;
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────
export function getArbitraryValue(value: string): string | null {
  const match = value.match(/^\[(.+)\]$/);
  return match ? match[1] : null;
}

export function mapSpacing(value: number): string {
  if (value === 0) return "0";
  return `${
    (value * 0.25).toFixed(2).replace(/\.?0+$/, "")
  }${DEFAULT_SPACING_UNIT}`;
}

/** Normalise opacity tokens (string or number) to 0 … 1 */
export function normaliseOpacity(sql: string | number): number {
  const n = typeof sql === "string" ? parseFloat(sql) : sql;
  return n > 1 ? n / DEFAULT_OPACITY_SCALE : n;
}

// ───────────────────────────────────────────────────────────────────────────────
// parseNumericValue
// ───────────────────────────────────────────────────────────────────────────────
export function parseNumericValue(
  value: string,
  theme: Theme,
  options: ParseNumericOptions = {},
): string | undefined {
  let multiplier = 1;
  let numericPart = String(value);

  if (options.allowNegative && numericPart.startsWith("-")) {
    multiplier = -1;
    numericPart = numericPart.substring(1);
  }

  // 1. Arbitrary values ────────────────────────────────────────────────────────
  const arbitrary = getArbitraryValue(numericPart);
  if (arbitrary) {
    if (multiplier === -1 && !/^[-(]|^var\(|^calc\(/.test(arbitrary)) {
      return `-${arbitrary}`;
    }
    return arbitrary;
  }

  // 2. Keywords ────────────────────────────────────────────────────────────────
  const combinedKeywords = {
    ...options.keywords,
    ...(options.allowFractions && { full: "100%" }),
  };

  if (numericPart in combinedKeywords) {
    const keywordValue =
      combinedKeywords[numericPart as keyof typeof combinedKeywords];
    if (
      multiplier === -1 &&
      keywordValue !== "auto" &&
      keywordValue !== "" &&
      !Number.isNaN(parseFloat(keywordValue!))
    ) {
      return `-${keywordValue}`;
    }
    if (multiplier === -1 && keywordValue !== "auto" && keywordValue !== "") {
      return undefined;
    }
    return keywordValue;
  }

  // 3. Fractions (sql.g. 1/2) ───────────────────────────────────────────────────
  if (options.allowFractions) {
    const fractionMatch = numericPart.match(/^(\d+)\/(\d+)$/);
    if (fractionMatch) {
      const num = parseFloat(fractionMatch[1]);
      const den = parseFloat(fractionMatch[2]);
      if (den !== 0) {
        const pct = (num / den) * 100;
        const result = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(6)}%`;
        return multiplier === -1 ? `-${result}` : result; // ← simplified
      }
    }
  }

  // 4. Theme scale look-ups ────────────────────────────────────────────────────
  if (options.scale) {
    const scales = Array.isArray(options.scale)
      ? options.scale
      : [options.scale];
    for (const scaleName of scales) {
      const themeValue = getThemeToken(theme, scaleName, numericPart);
      if (themeValue !== undefined && themeValue !== null) {
        const strVal = String(themeValue);
        if (multiplier === -1) {
          if (strVal.startsWith("-")) return strVal.substring(1); // avoid double neg
          if (/^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|deg)?$/.test(strVal)) {
            return `-${strVal}`;
          }
          return `calc(${strVal} * -1)`;
        }
        return strVal;
      }
    }
  }

  // 5. Spacing util (theme.spacing or fallback) ────────────────────────────────
  if (options.allowSpacingUnits) {
    if (numericPart === "px") return multiplier === -1 ? "-1px" : "1px";

    const num = parseFloat(numericPart);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      const spacingFn = typeof theme?.spacing === "function"
        ? theme.spacing
        : mapSpacing;
      const spacingVal = spacingFn(num);
      return multiplier === -1 ? `-${spacingVal}` : spacingVal;
    }
  }

  // 6. Raw numeric with default unit ───────────────────────────────────────────
  const num = parseFloat(numericPart);
  if (
    !Number.isNaN(num) && Number.isFinite(num) &&
    options.defaultUnit !== undefined
  ) {
    const res = `${num}${options.defaultUnit}`;
    return multiplier === -1 ? `-${res}` : res;
  }

  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────────
// deepMerge – unchanged
// ───────────────────────────────────────────────────────────────────────────────
export function deepMerge(target: any, source: any): CSSObjectWithVars {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    for (const key of Object.keys(source)) {
      if (isObject(source[key]) && key in target && isObject(target[key])) {
        if (
          key.startsWith("@media") ||
          key.startsWith("@container") ||
          key.startsWith("@layer") ||
          key.startsWith("&") ||
          key.startsWith(".")
        ) {
          output[key] = deepMerge(target[key], source[key]);
        } else {
          output[key] = source[key];
        }
      } else {
        output[key] = source[key];
      }
    }
  }
  return output as CSSObjectWithVars;
}

// ───────────────────────────────────────────────────────────────────────────────
// Breakpoints & containers helpers – unchanged
// ───────────────────────────────────────────────────────────────────────────────
export function getBreakpointValue(
  name: string,
  theme: Theme,
): string | undefined {
  return getThemeToken(theme, "breakpoints", name) as string | undefined;
}

export function getContainerValue(
  name: string,
  theme: Theme,
): string | undefined {
  return getThemeToken(theme, "containers", name) as string | undefined;
}

export function getMaxWidthValue(
  bpName: string,
  theme: Theme,
): string | undefined {
  const bpValue = getBreakpointValue(bpName, theme);
  if (!bpValue) return undefined;

  const sql = bpValue.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (sql) {
    const n = parseFloat(sql[1]);
    const unit = sql[2] || "px";
    return `${(n - 0.02).toFixed(2)}${unit}`;
  }
  return `calc(${bpValue} - 0.02px)`;
}
