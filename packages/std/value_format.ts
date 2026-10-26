import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";

/** Display metadata only: queries and chart geometry keep numeric values. */
export interface ValueFormat {
  type:
    | "number"
    | "number_thousands"
    | "currency"
    | "percentage"
    | "duration"
    | "text";
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  currency?: string;
  inputUnit?: "minutes" | "seconds" | "hours";
}

/** Normalize historical string formats at the read boundary, without a DB write. */
export function normalizeValueFormat(format: Sql): Sql {
  return sql`case when json_typeof(${format}) = 'string'
    then json_build_object('type', ${format} #>> '{}')
    else coalesce(${format}, '{"type":"number"}'::json) end`;
}

/** Total hours, rounded once to the nearest minute; never folds into days. */
export function formatHoursMinutes(minutes: NumericExpr): Sql {
  const rounded = sql`cast(round(abs(${minutes})) as bigint)`;
  return sql`case when ${minutes} is null then '—' else
    case when ${minutes} < 0 and ${rounded} > 0 then '-' else '' end ||
    format.decimal(floor(${rounded} / 60.0), maximum_fraction_digits => 0) || 'h ' ||
    lpad((${rounded} % 60)::string, 2, '0') || 'm' end`;
}

export function formatValue(value: NumericExpr, format: Sql): Sql {
  const normalized = normalizeValueFormat(format);
  const type = sql`${normalized}->>'type'`;
  const max =
    sql`coalesce(try_cast(${normalized}->>'maximumFractionDigits' as int), 2)`;
  const min =
    sql`coalesce(try_cast(${normalized}->>'minimumFractionDigits' as int), case when ${type}='currency' then least(2, ${max}) else 0 end)`;
  const options =
    sql`minimum_fraction_digits => ${min}, maximum_fraction_digits => ${max}`;
  const minutes =
    sql`case ${normalized}->>'inputUnit' when 'seconds' then ${value}/60.0 when 'hours' then ${value}*60.0 else ${value} end`;
  return sql`case when ${value} is null then '—'
    when ${type} = 'currency' then case when ${value}<0 then '-' else '' end || format.currency(abs(${value}), coalesce(${normalized}->>'currency','USD'), ${options})
    when ${type} = 'percentage' then format.decimal(${value}*100.0, ${options}) || '%'
    when ${type} = 'number_thousands' then format.decimal(${value}/1000.0, ${options}) || 'k'
    when ${type} = 'duration' then ${formatHoursMinutes(minutes)}
    else format.decimal(${value}, ${options}) end`;
}
