// Yolm i18n - Internationalization utilities
// Provides type-safe translation functionality with dynamic SQL generation

import { type Sql, sql } from "./sql_utils";
import { useOptionalICtx } from "./ui";
import { UserLanguageICtxKey } from "./ictx";

// Helper type to extract nested keys from an object as dot-notation strings
type NestedKeys<T> = T extends Record<string, any> ? {
    [K in keyof T]: K extends string
      ? T[K] extends Record<string, any> ? `${K}.${NestedKeys<T[K]>}`
      : K
      : never;
  }[keyof T]
  : never;

/** Configuration for {@link createTranslator}. */
export interface TranslatorConfig<T extends Record<string, any>> {
  /** Language used when no `UserLanguageICtx` is present. */
  defaultLanguage: string;
  /** Map of language code to that language's nested translation object. */
  languages: Record<string, T>;
  /** Optional static language override; ignored when `UserLanguageICtx` is available. */
  currentLanguage?: string;
}

/** Result of {@link createTranslator}: a `t` function that resolves a translation key to a SQL string. */
export interface Translator<T extends Record<string, any>> {
  /** Resolve a (dot-path) translation key to a SQL string, interpolating optional `params`. */
  t: (key: NestedKeys<T>, params?: Record<string, any>) => Sql;
}

/**
 * Creates a translator instance with type-safe translation keys
 *
 * @param config - Configuration object with languages and settings
 * @returns Translator instance with t function
 *
 * @example
 * ```typescript
 * import enTranslations from "./en.json" with { type: "json" };
 * import ruTranslations from "./ru.json" with { type: "json" };
 *
 * const { t } = createTranslator({
 *   defaultLanguage: "en",
 *   languages: {
 *     en: enTranslations,
 *     ru: ruTranslations
 *   },
 *   currentLanguage: "ru"
 * });
 *
 * // Type-safe translation keys inferred from default language structure
 * t("shared.fields.org")
 * t("stats.events.header")
 * ```
 */
export function createTranslator<T extends Record<string, any>>(
  config: TranslatorConfig<T>,
): Translator<T> {
  function t(key: NestedKeys<T>, params?: Record<string, any>): Sql {
    try {
      // Get the translation value for each supported language
      const translationValues: Record<string, string> = {};

      for (const [langCode, translations] of Object.entries(config.languages)) {
        const value = getNestedValue(translations, key);
        if (typeof value === "string") {
          // Apply parameter substitution if needed
          translationValues[langCode] = params
            ? applyParams(value, params)
            : value;
        }
      }

      // Get fallback value from default language
      const fallbackValue = translationValues[config.defaultLanguage];

      // If no translation found at all, return the key as a string literal
      if (!fallbackValue && Object.keys(translationValues).length === 0) {
        console.warn(`Translation key not found: ${key}`);
        return sql.lit(String(key));
      }

      const finalFallback = fallbackValue || String(key);

      // Check if we have UserLanguageICtx available
      const userLanguageCtx = useOptionalICtx(UserLanguageICtxKey);

      if (userLanguageCtx && Object.keys(translationValues).length > 1) {
        // Generate dynamic SQL with CASE WHEN for language switching
        return sql.caseWhen(
          {
            conditions: Object.entries(translationValues)
              .filter(([langCode, translation]) =>
                translation && langCode !== config.defaultLanguage
              ) // Only include valid translations
              .map(([langCode, translation]) => ({
                condition: sql`${userLanguageCtx.currentLanguage} = ${
                  sql.lit(langCode)
                }`,
                expr: sql.lit(translation),
              })),
            default: sql.lit(finalFallback),
          },
        );
      } else {
        // Static mode: use currentLanguage config or fallback
        const staticLang = config.currentLanguage || config.defaultLanguage;
        const staticValue = translationValues[staticLang] || finalFallback;
        return sql.lit(String(staticValue));
      }
    } catch (error) {
      console.error(`Error in translation function for key "${key}":`, error);
      return sql.lit(String(key));
    }
  }
  return { t };
}

// Helper function to get nested value from object using dot notation
function getNestedValue(obj: any, key: string): any {
  const keys = key.split(".");
  let value = obj;

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = value[k];
    } else {
      return undefined;
    }
  }

  return value;
}

// Helper function to apply parameter substitution to a translation string
function applyParams(template: string, params: Record<string, any>): string {
  let result = template;
  for (const [paramKey, paramValue] of Object.entries(params)) {
    result = result.replace(
      new RegExp(`{${paramKey}}`, "g"),
      String(paramValue),
    );
  }
  return result;
}
