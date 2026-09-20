import { sql } from "../std/sql_utils";
import type { AnyExpr } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { system } from "std/system";
import type { Field } from "std/system";
import { Match, Switch } from "std/ui";
import { InlineRecordDisplay } from "./inline_record_display";
import { externalUrlHref, Link } from "./link";
import { formatPhoneNumberStringValue } from "./phone_number_string";
import { compactTimeZoneDisplaySql } from "./select_timezone";

interface InlineFieldDisplayProps {
  field: Field;
  value: AnyExpr;
}

/**
 Displays a field value inline, formatting it based on the field type and usage.

 This function handles various field types and usages, providing appropriate
 formatting and display for each.

 @category UI Utility

 @param props.field - The field definition.
 @param props.value - The value to display.
 */
export function InlineFieldDisplay(props: InlineFieldDisplayProps) {
  const { field, value } = props;
  let expr = sql.normalizeExpr(value);
  switch (field.type) {
    case "TimestampNaive":
    case "TimestampUtc":
    case "TimestampTz":
    case "Time":
    case "Date": {
      return field.formatExpr(expr);
    }
    case "ForeignKey": {
      return <InlineRecordDisplay tableName={field.table} id={expr} />;
    }
    case "Decimal": {
      if (field.usage) {
        switch (field.usage.type) {
          case "Money": {
            return sql`format.currency(${expr}, 'usd')`;
          }
          case "Percentage": {
            return sql`format.percent(${expr})`;
          }
        }
      }
      expr = sql`format.decimal(${expr})`;
      break;
    }
    case "PhoneNumber": {
      return sql`phone.format_international(${expr})`;
    }
    case "BigInt":
    case "BigUint":
    case "Uint":
    case "Int":
    case "SmallInt":
    case "SmallUint": {
      if (field.usage) {
        switch (field.usage.type) {
          case "Money": {
            return sql`format.currency(${expr}, 'usd')`;
          }
          case "Duration": {
            if (field.usage.size === "minutes") {
              return sql`fn.display_minutes_duration(${expr})`;
            }
            throw new Error("Only minutes duration is supported");
          }
        }
      }
      expr = sql`format.decimal(${expr})`;
      break;
    }
    case "Enum": {
      if (field.enum === "sys_timezone") {
        return compactTimeZoneDisplaySql(expr);
      }
      expr = sql`fn.display_${sql(field.enum)}(${expr})`;
      break;
    }
    case "Bool": {
      if (field.enumLike) {
        const trueStr = sql.lit(field.enumLike.true);
        const falseStr = sql.lit(field.enumLike.false);
        if (field.enumLike.null) {
          const nullStr = sql.lit(field.enumLike.null);
          expr =
            sql`case when ${expr} is null then ${nullStr} when ${expr} then ${trueStr} else ${falseStr} end`;
        } else {
          expr = sql`case when ${expr} then ${trueStr} else ${falseStr} end`;
        }
      }
      break;
    }
    case "String": {
      if (field.usage) {
        switch (field.usage.type) {
          case "Email": {
            return <Link href={sql.concat("mailto:", expr)}>{expr}</Link>;
          }
          case "URL": {
            return (
              <Link
                href={externalUrlHref(expr)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {expr}
              </Link>
            );
          }
          case "PhoneNumber": {
            return formatPhoneNumberStringValue(expr, field.usage);
          }
        }
      }
      break;
    }
  }
  return expr;
}

/**
 * Renders a small colored dot for the enum variant matching `value`, using
 * the color defined on that variant. Variants without a color render
 * nothing. Use as a leading swatch next to an enum label.
 *
 * @category UI Component
 */
export function EnumColorSpan(props: {
  enum: string;
  value: AnyExpr;
  sx?: Style;
}) {
  const enum_ = system.enums[props.enum];
  if (!enum_) {
    throw new Error(`Enum ${props.enum} not found`);
  }
  return (
    <Switch>
      {Object.values(enum_.values).map((v) => (
        <Match when={sql`${props.value} = ${sql.lit(v.name)}`}>
          {v.color && (
            <span
              sx={[
                {
                  display: "inline-block",
                  width: "0.75em",
                  height: "0.75em",
                  borderRadius: "50%",
                  backgroundColor: v.color,
                  mr: 1,
                },
                props.sx,
              ]}
            />
          )}
        </Match>
      ))}
    </Switch>
  );
}
