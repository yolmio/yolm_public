import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";

/** An existing string can be kept verbatim, but cannot be newly authored. */
export function validateFormatWrite<T extends IServerBaseStatements>(
  s: T,
  config: Sql,
  existingConfig: Sql = sql`null::json`,
) {
  s.throwErrorIf(
    sql`json_typeof(${config}->'format') = 'string' and
      ((json_typeof(${existingConfig}->'format') is distinct from 'string')
        or ((${config}->>'format') is distinct from (${existingConfig}->>'format')))`,
    sql
      .lit`Use a format object. An existing string format may only be preserved unchanged.`,
  );
}

export function validateFormats<T extends IServerBaseStatements>(
  s: T,
  config: Sql,
) {
  s.throwErrorIf(
    sql`(${config}->'columnFormats' is not null and json_typeof(${config}->'columnFormats') != 'object')
      or (select count(*) from json.object_each(case when json_typeof(${config}->'columnFormats')='object' then ${config}->'columnFormats' else '{}'::json end)) > 100`,
    sql.lit`columnFormats must be an object with at most 100 columns.`,
  );
  // Legacy strings are read-only metadata; columnFormats has no legacy form.
  s.defTable(
    "widget_formats",
    sql`select 'value' as name, ${config}->'format' as value, true as primary_format
    union all select key, value, false from json.object_each(coalesce(${config}->'columnFormats','{}'::json))`,
  );
  s.throwErrorIf(
    sql`exists(select 1 from widget_formats where value is not null and
      (case when primary_format and json_typeof(value)='string' then value #>> '{}' else value->>'type' end
        not in ('number','number_thousands','currency','percentage','duration','text')
      or (json_typeof(value) != 'object' and not (primary_format and json_typeof(value)='string'))
      or (json_typeof(value)='object' and value->>'type' is null)
      or (primary_format and (case when json_typeof(value)='string' then value #>> '{}' else value->>'type' end)='text')))`,
    sql.lit`Choose a supported format object type.`,
  );
  s.throwErrorIf(
    sql`exists(select 1 from widget_formats f cross join json.object_each(case when json_typeof(f.value)='object' then f.value else '{}'::json end) field
      where field.key not in ('type','minimumFractionDigits','maximumFractionDigits','currency','inputUnit')
      or (field.key in ('minimumFractionDigits','maximumFractionDigits') and
        (json_typeof(field.value) != 'number' or not coalesce(try_cast(field.value #>> '{}' as double) between 0 and 20,false)
          or try_cast(field.value #>> '{}' as double) != floor(try_cast(field.value #>> '{}' as double))))
      or (field.key='currency' and (f.value->>'type' != 'currency' or json_typeof(field.value) != 'string' or not coalesce(field.value #>> '{}' ~ '^[A-Z]{3}$',false)))
      or (field.key='inputUnit' and (f.value->>'type' != 'duration' or json_typeof(field.value) != 'string' or field.value #>> '{}' not in ('minutes','seconds','hours'))))
      or exists(select 1 from widget_formats where coalesce(try_cast(value->>'minimumFractionDigits' as int),0) > coalesce(try_cast(value->>'maximumFractionDigits' as int),2))`,
    sql.lit`Invalid format options or precision.`,
  );
}
