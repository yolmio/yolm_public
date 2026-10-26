import { sql } from "std/sql_utils";
import type { BooleanExpr, Sql } from "std/sql_utils";
import type {
  HelperProcField,
  StateStatements,
  TestStatements,
} from "std/statements";
import { formatValue, normalizeValueFormat } from "std/value_format";
import { system } from "std/system";

export const CHART_LEFT = 90;
const INTERVAL_COUNT = 10;

export interface WiseChartSeries {
  key: "a" | "b";
  query: Sql;
  dashed: boolean;
  reverse: BooleanExpr;
  graphLow?: Sql;
  graphDivision?: Sql;
}

export interface WiseChartLayout {
  top: number;
  plotWidth: number;
  plotHeight: number;
  xLabelY: number;
}

const sourceFields: HelperProcField[] = [
  { name: "series", type: "String" },
  { name: "period_start_date", type: "Date" },
  { name: "value", type: "Double" },
];
const indexedFields: HelperProcField[] = [
  ...sourceFields,
  { name: "date_index", type: "Int" },
];

function scaledValue(value: Sql) {
  // NULL bounds must remain NULL so the axis can choose an automatic bound.
  return sql`case
    when (p_format->>'type') in ('currency', 'number_thousands') then ${value} / 1000.0
    when (p_format->>'type') = 'percentage' then ${value} * 100.0
    when p_format->>'type' = 'duration' then case p_format->>'inputUnit' when 'seconds' then ${value}/60.0 when 'hours' then ${value}*60.0 else ${value} end
    else ${value} end`;
}

function valueLabel(value: Sql, exact = false) {
  const raw = sql`case when p_format->>'type'='percentage' then (${value})/100.0
    ${
    exact
      ? sql`when p_format->>'type' in ('currency','number_thousands') then (${value})*1000.0`
      : sql``
  }
    else ${value} end`;
  const format = sql`p_format || case
    when p_format->>'type'='duration' then '{"inputUnit":"minutes"}'::json
    ${
    !exact
      ? sql`when p_format->>'type'='number_thousands' then '{"type":"number"}'::json`
      : sql``
  }
    else '{}'::json end`;
  return sql`${formatValue(raw, format)} || ${
    !exact
      ? sql`case when p_format->>'type'='currency' then 'k' else '' end`
      : sql.lit``
  }`;
}

function divisionLabel(value: Sql) {
  return valueLabel(value, true);
}

function niceMultiple(ratio: Sql, allowDurationHour: boolean) {
  return sql`case
    when ${ratio} <= 1.0 then 1.0
    when ${ratio} <= 1.5 then 1.5
    when ${ratio} <= 2.0 then 2.0
    when ${ratio} <= 2.5 then 2.5
    when ${ratio} <= 3.0 then 3.0
    when ${ratio} <= 3.6 then 3.6
    when ${ratio} <= 4.0 then 4.0
    when ${ratio} <= 5.0 then 5.0
    ${
    allowDurationHour
      ? sql`when (p_format->>'type') = 'duration' and ${ratio} <= 6.0 then 6.0`
      : sql``
  }
    when ${ratio} <= 8.0 then 8.0
    else 10.0 end`;
}

/** Shared runtime boundaries, registered once per system, not once per chart. */
export function registerWiseChartProcedures() {
  if (system.storedProcedures.some((p) => p.name === "wise_chart_dates")) {
    return;
  }

  system.storedProcedure({
    name: "wise_chart_dates",
    transaction: "caller",
    inputScalars: [
      { name: "p_format", type: "Json" },
      { name: "p_width", type: "Double" },
      { name: "p_label_y", type: "Double" },
    ],
    inputTables: [{ name: "source_points", fields: sourceFields }],
    outputScalars: [{ name: "date_count", type: "Int" }],
    outputTables: [
      { name: "indexed_points", fields: indexedFields },
      {
        name: "dates",
        fields: [
          { name: "period_label", type: "String" },
          { name: "x", type: "Double" },
          { name: "label_transform", type: "String" },
        ],
      },
    ],
    procedure: (s) => {
      s.modify(sql`insert into indexed_points
        select series, period_start_date, ${scaledValue(sql`value`)}::Double,
          (dense_rank() over (order by period_start_date) - 1)::Int
        from source_points order by period_start_date`);
      s.setScalar(
        "date_count",
        sql`coalesce((select max(date_index) from indexed_points), -1) + 1`,
      );
      s.modify(sql`insert into dates
        select period_label, x, concat('rotate(-60 ', (x - 3.0)::text, ' ', p_label_y::text, ')')
        from (
          select period_start_date,
            case when date_index = 0 or date_index = date_count - 1
              then format.date(period_start_date, '%-d %b %Y')
              else format.date(period_start_date, '%-d %b') end as period_label,
            case when date_count <= 1 then ${CHART_LEFT}.0 + p_width / 2.0
              else ${CHART_LEFT}.0 + date_index::Double * p_width / (date_count - 1)::Double end as x
          from indexed_points group by period_start_date, date_index
        ) date_positions order by period_start_date`);
    },
  });

  system.storedProcedure({
    name: "wise_chart_axis",
    transaction: "caller",
    inputScalars: [
      { name: "p_format", type: "Json" },
      { name: "p_min", type: "Double" },
      { name: "p_max", type: "Double" },
      { name: "p_graph_low", type: "Double" },
      { name: "p_graph_division", type: "Double" },
    ],
    outputScalars: [
      { name: "axis_min", type: "Double" },
      { name: "axis_max", type: "Double" },
      { name: "division", type: "Double" },
      { name: "division_label", type: "String" },
    ],
    procedure: (s) => {
      s.defScalar("data_min", sql`coalesce(p_min, 0.0)`);
      s.defScalar("data_max", sql`coalesce(p_max, 0.0)`);
      s.defScalar(
        "low",
        sql`least(coalesce(${
          scaledValue(sql`p_graph_low`)
        }, data_min), data_min)`,
      );
      s.defScalar("span", sql`data_max - low`);
      s.defScalar(
        "seed",
        sql`case when span > 0.0 then span / ${INTERVAL_COUNT} else greatest(abs(data_max), 1.0) / ${INTERVAL_COUNT} end`,
      );
      s.defScalar(
        "seed_power",
        sql`power(10.0, floor(log10(greatest(seed, 0.000001))))`,
      );
      s.defScalar("multiple", niceMultiple(sql`seed / seed_power`, false));
      s.defScalar(
        "candidate",
        sql`case when (p_format->>'type') in ('number', 'duration') then greatest(seed_power * multiple, 1.0) else seed_power * multiple end`,
      );
      s.defScalar("candidate_min", sql`floor(low / candidate) * candidate`);
      // Rounding down can consume almost one interval; reserve it in the fallback.
      s.defScalar(
        "safe_seed",
        sql`case when span > 0.0 then span / ${
          INTERVAL_COUNT - 1
        } else seed end`,
      );
      s.defScalar(
        "safe_power",
        sql`power(10.0, floor(log10(greatest(safe_seed, 0.000001))))`,
      );
      s.defScalar(
        "safe_multiple",
        niceMultiple(sql`safe_seed / safe_power`, true),
      );
      s.defScalar(
        "safe_division",
        sql`case when (p_format->>'type') in ('number', 'duration') then greatest(safe_power * safe_multiple, 1.0) else safe_power * safe_multiple end`,
      );
      s.defScalar(
        "auto_division",
        sql`case when candidate_min + ${INTERVAL_COUNT} * candidate >= data_max then candidate else safe_division end`,
      );
      s.defScalar("explicit_division", scaledValue(sql`p_graph_division`));
      // A too-small explicit division grows by 1-2-5 multiples of itself so
      // the label stays a multiple of the configured division. Rounding the
      // low down needs at most one more interval, which ×2 of the decade covers.
      s.defScalar(
        "explicit_power",
        sql`case when explicit_division > 0.0 then power(10.0, floor(log10(greatest(span / (${INTERVAL_COUNT} * explicit_division), 1.0)))) end`,
      );
      s.setScalar(
        "division",
        sql`case
        when explicit_division is null or explicit_division <= 0.0 then auto_division
        else (select min(fit.division) from (
          select explicit_division * k * explicit_power as division
          from (values (1.0),(2.0),(5.0),(10.0),(20.0)) multiples(k)
        ) fit where floor(low / fit.division) * fit.division + ${INTERVAL_COUNT} * fit.division >= data_max) end`,
      );
      s.setScalar("axis_min", sql`floor(low / division) * division`);
      s.setScalar("axis_max", sql`axis_min + ${INTERVAL_COUNT} * division`);
      s.setScalar("division_label", divisionLabel(sql`division`));
    },
  });

  system.storedProcedure({
    name: "wise_chart_series",
    transaction: "caller",
    inputScalars: [
      { name: "p_format", type: "Json" },
      { name: "p_series", type: "String" },
      { name: "p_reverse", type: "Bool" },
      { name: "p_graph_low", type: "Double" },
      { name: "p_graph_division", type: "Double" },
      { name: "p_date_count", type: "Int" },
      { name: "p_top", type: "Double" },
      { name: "p_width", type: "Double" },
      { name: "p_height", type: "Double" },
      { name: "p_label_offset", type: "Double" },
    ],
    inputTables: [{ name: "indexed_points", fields: indexedFields }],
    outputScalars: [{ name: "division_label", type: "String" }],
    outputTables: [
      {
        name: "points",
        fields: [
          { name: "x", type: "Double" },
          { name: "y", type: "Double" },
          { name: "label_x", type: "Double" },
          { name: "label_y", type: "Double" },
          { name: "label_anchor", type: "String" },
          { name: "label_transform", type: "String" },
          { name: "value_label", type: "String" },
        ],
      },
      {
        name: "segments",
        fields: [
          { name: "x1", type: "Double" },
          { name: "y1", type: "Double" },
          { name: "x2", type: "Double" },
          { name: "y2", type: "Double" },
        ],
      },
      {
        name: "ticks",
        fields: [
          { name: "y", type: "Double" },
          { name: "value_label", type: "String" },
        ],
      },
    ],
    procedure: (s) => {
      s.callStoredProcedure("wise_chart_axis", {
        inputScalars: {
          p_format: sql`p_format`,
          p_min:
            sql`(select min(value) from indexed_points where series = p_series)`,
          p_max:
            sql`(select max(value) from indexed_points where series = p_series)`,
          p_graph_low: sql`p_graph_low`,
          p_graph_division: sql`p_graph_division`,
        },
        outputScalars: {
          axis_min: "series_min",
          axis_max: "series_max",
          division: "series_division",
          division_label: "division_label",
        },
      });
      s.defTable(
        "positions",
        sql`select
        value, date_index, (row_number() over (order by period_start_date) - 1)::Int as series_index,
        case when p_date_count <= 1 then ${CHART_LEFT}.0 + p_width / 2.0
          else ${CHART_LEFT}.0 + date_index::Double * p_width / (p_date_count - 1)::Double end as x,
        p_top + (case when p_reverse then value - series_min else series_max - value end) * p_height / greatest(series_max - series_min, 0.000001) as y
        from indexed_points where series = p_series`,
      );
      s.modify(sql`insert into points
        select x, y, label_x, label_y,
          case when y < p_top + p_height / 2.0 then 'end' else 'start' end,
          concat('rotate(-90 ', label_x::text, ' ', label_y::text, ')'),
          ${valueLabel(sql`value`, true)}
        from (
          select *,
            case when date_index = p_date_count - 1 then x - p_label_offset else x + p_label_offset end as label_x,
            case when y < p_top + p_height / 2.0 then y + 6.0 else y - 6.0 end as label_y
          from positions where value is not null
        ) labels order by series_index`);
      s.modify(sql`insert into segments
        select p1.x as x1, p1.y as y1, p2.x as x2, p2.y as y2 from positions p1
          join positions p2 on p2.date_index = p1.date_index + 1 where p1.value is not null and p2.value is not null order by p1.date_index`);
      s.modify(sql`insert into ticks
        select p_top + (${INTERVAL_COUNT} - tick_index)::Double * p_height / ${INTERVAL_COUNT}.0,
          ${
        valueLabel(
          sql`series_min + (case when p_reverse then ${INTERVAL_COUNT} - tick_index else tick_index end) * series_division`,
        )
      }
        from (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10)) indexes(tick_index)
        order by tick_index`);
    },
  });
}

/** Thin coordinator: query once, then call the bulk date and per-series stages. */
export function prepareWiseChart(
  s: StateStatements | TestStatements,
  series: WiseChartSeries[],
  layout: WiseChartLayout,
  format: Sql,
) {
  // Materialize arbitrary caller queries first (including statically empty ones),
  // then bind an exact schema at the stored-procedure boundary.
  s.defTable(
    "wise_chart_query",
    sql.unionAll(...series.map((spec) =>
      sql`
      select ${
        sql.lit(spec.key)
      } as series, source.period_start_date, source.value::Double as value
      from (${spec.query}) source`
    )),
  );
  s.defTable("wise_chart_source", { fields: sourceFields });
  s.modify(
    sql`insert into wise_chart_source select series, period_start_date, value from wise_chart_query`,
  );
  s.callStoredProcedure("wise_chart_dates", {
    inputScalars: {
      p_format: normalizeValueFormat(sql`json_build_array(${format})->0`),
      p_width: sql`${layout.plotWidth}::Double`,
      p_label_y: sql`${layout.xLabelY}::Double`,
    },
    inputTables: { source_points: "wise_chart_source" },
    outputScalars: { date_count: "wise_chart_date_count" },
    outputTables: {
      indexed_points: "wise_chart_points_all",
      dates: "wise_chart_dates",
    },
  });
  s.defScalar(
    "records_exist",
    sql`exists(select 1 from wise_chart_points_all where value is not null)`,
  );
  for (const spec of series) {
    s.callStoredProcedure("wise_chart_series", {
      inputScalars: {
        p_format: normalizeValueFormat(sql`json_build_array(${format})->0`),
        p_series: sql.lit(spec.key),
        p_reverse: spec.reverse,
        p_graph_low: sql`(${spec.graphLow ?? sql`null`})::Double`,
        p_graph_division: sql`(${spec.graphDivision ?? sql`null`})::Double`,
        p_date_count: sql`wise_chart_date_count`,
        p_top: sql`${layout.top}::Double`,
        p_width: sql`${layout.plotWidth}::Double`,
        p_height: sql`${layout.plotHeight}::Double`,
        p_label_offset: sql`${
          spec.dashed ? (layout.plotWidth > 500 ? 26 : 14) : 5
        }::Double`,
      },
      inputTables: { indexed_points: "wise_chart_points_all" },
      outputScalars: {
        division_label: `wise_chart_division_label_${spec.key}`,
      },
      outputTables: {
        points: `wise_chart_points_${spec.key}`,
        segments: `wise_chart_segments_${spec.key}`,
        ticks: `wise_chart_ticks_${spec.key}`,
      },
    });
  }
}
