import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IStatementsBase } from "std/statements";
import type { DashboardBlock } from "./index";

/** Developer-owned, viewer-scoped relation returning id and label. Never saved SQL. */
export interface DashboardRecordSource {
  name: string;
  label: string;
  permission: Sql;
  query: Sql;
  currentValue?: Sql;
}

export function parameterDefault(p: Sql, b: DashboardBlock): Sql {
  let value = sql`${p}->'default'`;
  for (const source of b.opts.recordSources ?? []) {
    if (source.currentValue) {
      value = sql`case when ${p}->>'type'='record' and ${p}->>'source'=${
        sql.lit(source.name)
      } and ${p}->>'default'='current' then (json_build_array(${source.currentValue})->0) else ${value} end`;
    }
  }
  return sql`case when ${p}->>'type'='date_range' and ${p}->>'default'='last_12_weeks' then json_build_object('start',date.add(day,-90,date.end_of_week(current_date())),'end',date.add(day,-7,date.end_of_week(current_date()))) else ${value} end`;
}

/** Emits a normalized JSON scalar; used for defaults, UI, Spark and every execution. */
export function resolveParameters<T extends IStatementsBase>(
  s: T,
  b: DashboardBlock,
  declarations: Sql,
  supplied: Sql,
  prefix: string,
) {
  const defs = sql.ref(`${prefix}_definitions`);
  const values = sql.ref(`${prefix}_values`);
  const result = sql.ref(`${prefix}_resolved`);
  s.defScalar(`${prefix}_definitions`, declarations);
  s.defScalar(`${prefix}_values`, supplied);
  s.throwErrorIf(
    sql`coalesce(json_typeof(${defs}),'null')!='array' or json_array_length(${defs})>12 or coalesce(json_typeof(${values}),'null')!='object'`,
    sql.lit`Declare at most twelve inputs and supply an object of values.`,
  );
  s.throwErrorIf(
    sql`exists(select 1 from json.array_each(${defs}) p where
    not coalesce(regex.is_match(p.value->>'name','^[a-z][a-z0-9_]*$'),false) or length(p.value->>'name')>64
    or length(trim(coalesce(p.value->>'label',''))) not between 1 and 160
    or coalesce(p.value->>'type','') not in ('text','number','date','enum','date_range','record')
    or (p.value->'optional' is not null and json_typeof(p.value->'optional')!='boolean')
    or (p.value->>'type'='enum' and (coalesce(json_typeof(p.value->'options'),'null')!='array' or json_array_length(p.value->'options') not between 1 and 100 or exists(select 1 from json.array_each(p.value->'options') o where json_typeof(o.value)!='string'))))
    or exists(select 1 from json.array_each(${defs}) p group by p.value->>'name' having count(*)>1)`,
    sql
      .lit`Inputs need unique names, labels and supported types. Enum options must be text.`,
  );
  s.throwErrorIf(
    sql`exists(select 1 from json.object_each(${values}) v where not exists(select 1 from json.array_each(${defs}) p where p.value->>'name'=v.key))`,
    sql.lit`Unknown dashboard or widget input.`,
  );
  const sources = sql.lit(
    JSON.stringify((b.opts.recordSources ?? []).map((source) => source.name)),
  );
  s.throwErrorIf(
    sql`exists(select 1 from json.array_each(${defs}) p where p.value->>'type'='record' and not coalesce(${sources}::json @> json_build_array(p.value->>'source'),false))`,
    sql.lit`Choose a registered record source.`,
  );
  s.defScalar(
    `${prefix}_resolved`,
    sql`coalesce((select json_object_agg(p.value->>'name', coalesce(${values}->(p.value->>'name'),${
      parameterDefault(sql`p.value`, b)
    })) from json.array_each(${defs}) p),'{}'::json)`,
  );
  s.forEachQuery(
    sql`select value from json.array_each(${defs})`,
    `${prefix}_parameter`,
    (s) => {
      const p = sql.ref(`${prefix}_parameter`, "value");
      const v = sql.ref(`${prefix}_value`);
      s.defScalar(`${prefix}_value`, sql`${result}->(${p}->>'name')`);
      s.throwErrorIf(
        sql`case when ${v} is null or json_typeof(${v})='null' then not coalesce(try_cast(${p}->>'optional' as bool),false) else case ${p}->>'type'
      when 'number' then not coalesce(try_cast(${v} #>> '{}' as double) between cast('-1e308' as double) and cast('1e308' as double),false)
      when 'date' then try_cast(${v} #>> '{}' as date) is null
      when 'enum' then not coalesce(${p}->'options' @> json_build_array(${v}),false)
      when 'text' then json_typeof(${v})!='string' or length(${v} #>> '{}')>1000
      when 'record' then try_cast(${v} #>> '{}' as bigint) is null or not coalesce(regex.is_match(${v} #>> '{}','^[0-9]+$'),false)
      when 'date_range' then json_typeof(${v})!='object' or try_cast(${v}->>'start' as date) is null or try_cast(${v}->>'end' as date) is null or try_cast(${v}->>'start' as date)>try_cast(${v}->>'end' as date) or date.diff(day,try_cast(${v}->>'start' as date),try_cast(${v}->>'end' as date))>3660
      else true end end`,
        sql`'Invalid input: ' || (${p}->>'label')`,
      );
      for (const source of b.opts.recordSources ?? []) {
        s.if(
          sql`${p}->>'type'='record' and ${p}->>'source'=${
            sql.lit(source.name)
          } and ${v} is not null and json_typeof(${v})!='null'`,
          (s) => {
            s.throwErrorIf(
              sql`current_user is null or not coalesce((${source.permission}),false)`,
              sql.lit`You cannot use this record source.`,
            );
            s.throwErrorIf(
              sql`not exists(select 1 from (${source.query}) record_choice where record_choice.id=try_cast(${v} #>> '{}' as bigint))`,
              sql.lit`The selected record is unavailable.`,
            );
          },
        );
      }
    },
  );
}

/** Every value offered by a dashboard input must be accepted by its consumer. */
export function parameterCompatible(widget: Sql, dashboard: Sql): Sql {
  return sql`${widget}->>'type'=${dashboard}->>'type'
    and (not coalesce(try_cast(${dashboard}->>'optional' as bool),false) or coalesce(try_cast(${widget}->>'optional' as bool),false))
    and (${widget}->>'type'!='record' or ${widget}->>'source'=${dashboard}->>'source')
    and (${widget}->>'type'!='enum' or not exists(select 1 from json.array_each(${dashboard}->'options') offered_option where not coalesce(${widget}->'options' @> json_build_array(offered_option.value),false)))`;
}

export function validateBindings<T extends IStatementsBase>(
  s: T,
  config: Sql,
  definitions: Sql,
) {
  const bindings = sql`coalesce(${config}->'bindings','{}'::json)`;
  s.throwErrorIf(
    sql`json_typeof(${bindings})!='object' or exists(select 1 from json.object_each(${bindings}) binding where json_typeof(binding.value)!='string' or not exists(select 1 from json.array_each(coalesce(${config}->'parameters','[]'::json)) p join json.array_each(${definitions}) d on d.value->>'name'=binding.value #>> '{}' where p.value->>'name'=binding.key and ${
      parameterCompatible(sql`p.value`, sql`d.value`)
    }))`,
    sql
      .lit`Bind widget inputs to dashboard inputs with compatible types, record sources, enum options and optionality.`,
  );
}
