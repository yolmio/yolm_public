import { sql } from "../std/sql_utils";
import type { AnyExpr, Sql } from "../std/sql_utils";
import type { StringUsage } from "std/system";

const SIMPLE_PHONE_VALUE_PATTERN =
  "(?i)^\\s*\\+?[0-9().\\-\\s]+(?:\\s*(?:ext\\.?|extension|x|#)\\s*[0-9]+)?\\s*$";
const PHONE_EXTENSION_PATTERN =
  "(?i)\\s*(?:ext\\.?|extension|x|#)\\s*([0-9]+)\\s*$";
const PHONE_EXTENSION_EXTRACT_PATTERN =
  "(?i)^.*(?:ext\\.?|extension|x|#)\\s*([0-9]+)\\s*$";

export function formatPhoneNumberStringValue(
  valueExpr: AnyExpr,
  usage?: StringUsage,
): Sql {
  const value = sql.normalizeExpr(valueExpr);
  if (usage?.type !== "PhoneNumber") {
    return value;
  }
  const trimmed = sql`trim(${value})`;
  const base = sql`trim(regex.replace(${trimmed}, ${
    sql.lit(PHONE_EXTENSION_PATTERN)
  }, ''))`;
  const extension = sql`regex.replace(${trimmed}, ${
    sql.lit(PHONE_EXTENSION_EXTRACT_PATTERN)
  }, '$1')`;
  const formattedBase = usage.country
    ? sql`
      case
        when starts_with(${base}, '+') and phone.try_parse(${base}) is not null
          then phone.format_international(phone.parse(${base}))
        when starts_with(${base}, '+')
          then ${base}
        else phone.format_partial(${base}, country => ${
      sql.lit(usage.country)
    }, disable_country_code => true)
      end
    `
    : sql`phone.format_partial(${base})`;
  return sql`
    case
      when ${value} is null then null
      when ${trimmed} = '' then ''
      when regex.is_match(${trimmed}, ${sql.lit(SIMPLE_PHONE_VALUE_PATTERN)})
        then case
          when regex.is_match(${trimmed}, ${sql.lit(PHONE_EXTENSION_PATTERN)})
            then ${formattedBase} || ' x' || ${extension}
          else ${formattedBase}
        end
      else ${value}
    end
  `;
}
