import { Alert } from "components/alert";
import { Button } from "components/button";
import { CircularProgress } from "components/circular_progress";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import { createStyles } from "std/style_utils";
import { Each, Show } from "std/ui";
import type { Node } from "std/ui";
import type { StateStatements } from "std/statements";

const styles = createStyles({
  frame: {
    width: "100%",
    minWidth: "320px",
    maxWidth: "360px",
    mx: "auto",
    border: "1px solid #9aa6bd",
    backgroundColor: "#ffffff",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.14)",
  },
  pageFrame: {
    maxWidth: "560px",
    minWidth: 0,
    "@media print": {
      width: "100%",
      maxWidth: "6.2in",
      boxShadow: "none",
    },
  },
  preview: {
    width: "100%",
    minWidth: "320px",
    maxWidth: "360px",
    mx: "auto",
  },
  previewAction: {
    display: "flex",
    justifyContent: "flex-end",
    pb: 1,
  },
  svg: {
    display: "block",
    width: "100%",
    height: "auto",
    backgroundColor: "#ffffff",
  },
  title: {
    fill: "#27317f",
    fontSize: "14px",
    fontWeight: 700,
    letterSpacing: 0,
  },
  meta: {
    fill: "#343b86",
    fontSize: "9px",
    fontWeight: 500,
    letterSpacing: 0,
  },
  axisText: {
    fill: "#4e5593",
    fontSize: "9px",
    letterSpacing: 0,
  },
  pointText: {
    fill: "#27317f",
    fontSize: "9px",
    fontWeight: 600,
    letterSpacing: 0,
    stroke: "#ffffff",
    strokeWidth: "2.5px",
    paintOrder: "stroke",
  },
});

const CHART_WIDTH = 360;
const CHART_HEIGHT = 500;
const CHART_LEFT = 62;
const CHART_BOTTOM = 88;
const INTERVAL_COUNT = 10;
const BOTTOM_TICK_LENGTH = 6;

/**
 * How raw `value`s are scaled and labeled on the graph:
 * - `number`: plotted as-is.
 * - `number_thousands`: entered raw, plotted and labeled in thousands.
 * - `currency`: dollars, plotted in thousands ("In Thousands").
 * - `percentage`: fractions, plotted as percent.
 * - `duration`: minutes, labeled as H:MM.
 */
export type WiseStatValueFormat =
  | "number"
  | "number_thousands"
  | "currency"
  | "percentage"
  | "duration";

export type WiseStatDisplaySize = "grid" | "page" | "widget";

export interface WiseStatLineChartProps {
  title: Node;
  query: Sql;
  valueFormat?: WiseStatValueFormat;
  /** Free-text axis unit, shown as "In {unit}" (number format only). */
  unit?: string;
  ownerHeader?: Node;
  ownerLabel?: Node;
  graphLow?: Sql;
  graphDivision?: Sql;
  /**
   * Invert the y-axis (low value at the top), the WISE convention for
   * lower-is-better stats like TAT or county drops.
   */
  reverseAxis?: boolean;
  /** Legend label for the primary series; only shown on dual-series charts. */
  seriesLabel?: Node;
  /**
   * Second (dashed) series plotted against its own right-hand axis,
   * e.g. Cash/Bills. Must use the same value format as the primary series.
   */
  series2?: {
    query: Sql;
    label: Node;
    graphLow?: Sql;
    graphDivision?: Sql;
    reverseAxis?: boolean;
  };
  /** Optional app-local route for opening this graph in a focused view. */
  viewHref?: Sql | string;
  /** Page enlarges for print; widget fills a host card that supplies its title/frame. */
  displaySize?: WiseStatDisplaySize;
  emptyFallback?: Node;
  errorFallback?: Node;
  pendingFallback?: Node;
}

function chartMetricValue(value: NumericExpr, format: WiseStatValueFormat) {
  switch (format) {
    case "currency":
    case "number_thousands":
      return sql`coalesce(${value}, 0) / 1000.0`;
    case "percentage":
      return sql`coalesce(${value}, 0) * 100.0`;
    default:
      return sql`coalesce(${value}, 0)`;
  }
}

function chartFixedMetricValue(
  value: NumericExpr,
  format: WiseStatValueFormat,
) {
  switch (format) {
    case "currency":
    case "number_thousands":
      return sql`${value} / 1000.0`;
    case "percentage":
      return sql`${value} * 100.0`;
    default:
      return sql.normalizeExpr(value);
  }
}

function formatDurationMinutes(value: NumericExpr) {
  return sql`
    fn.display_minutes_duration(cast(round(coalesce(${value}, 0)) as bigint))
  `;
}

function formatChartValue(value: NumericExpr, format: WiseStatValueFormat) {
  switch (format) {
    case "percentage":
      return sql`format.decimal(coalesce(${value}, 0), maximum_fraction_digits => 1) || '%'`;
    case "duration":
      return formatDurationMinutes(value);
    default:
      return sql`format.decimal(coalesce(${value}, 0), maximum_fraction_digits => 2)`;
  }
}

function formatDivision(value: NumericExpr, format: WiseStatValueFormat) {
  switch (format) {
    case "currency":
    case "number_thousands":
      return sql`format.decimal(coalesce(${value}, 0) * 1000.0, maximum_fraction_digits => 0)`;
    case "percentage":
      return sql`format.decimal(coalesce(${value}, 0), maximum_fraction_digits => 2) || '%'`;
    case "duration":
      return formatDurationMinutes(value);
    default:
      return sql`
        case
          when abs(coalesce(${value}, 0) - floor(coalesce(${value}, 0))) < 0.000001
            then format.decimal(coalesce(${value}, 0), maximum_fraction_digits => 0)
          else format.decimal(coalesce(${value}, 0), maximum_fraction_digits => 3)
        end
      `;
  }
}

function formatPointValue(value: NumericExpr, format: WiseStatValueFormat) {
  switch (format) {
    case "currency":
    case "number_thousands":
      return sql`format.decimal(coalesce(${value}, 0) * 1000.0, maximum_fraction_digits => 0)`;
    default:
      return formatChartValue(value, format);
  }
}

function chartUnitLabel(format: WiseStatValueFormat, unit?: string) {
  switch (format) {
    case "currency":
    case "number_thousands":
      return "In Thousands";
    case "percentage":
      return "In Percent";
    default:
      return unit ? `In ${unit}` : "";
  }
}

interface SeriesSpec {
  key: string;
  query: Sql;
  dashed: boolean;
  reverse: boolean;
  graphLow?: Sql;
  graphDivision?: Sql;
}

interface ChartLayout {
  top: number;
  plotWidth: number;
  plotHeight: number;
  xLabelY: number;
}

function axisRef(key: string, name: string) {
  return sql.ref(`wise_chart_${name}_${key}`);
}

function niceDivisionMultiple(
  seedRatio: Sql,
  includeDurationHour: boolean,
) {
  const durationMultiple = includeDurationHour
    ? sql`when ${seedRatio} <= 6.0 then 6.0`
    : sql``;
  return sql`
    case
      when ${seedRatio} <= 1.0 then 1.0
      when ${seedRatio} <= 1.5 then 1.5
      when ${seedRatio} <= 2.0 then 2.0
      when ${seedRatio} <= 2.5 then 2.5
      when ${seedRatio} <= 3.0 then 3.0
      when ${seedRatio} <= 3.6 then 3.6
      when ${seedRatio} <= 4.0 then 4.0
      when ${seedRatio} <= 5.0 then 5.0
      ${durationMultiple}
      when ${seedRatio} <= 8.0 then 8.0
      else 10.0
    end
  `;
}

/**
 * Defines the 10-division axis scalars for one series, suffixed by the
 * series key: min, low, division, axis_min, axis_max. The axis anchors at
 * the data low (or graphLow when lower); an explicit division that cannot
 * contain the data range is bumped to a safe division that can.
 */
function defAxisScalars(
  s: StateStatements,
  series: SeriesSpec,
  valueFormat: WiseStatValueFormat,
) {
  const k = series.key;
  const def = (name: string, expr: Sql) =>
    s.defScalar(`wise_chart_${name}_${k}`, expr);
  def(
    "min",
    sql`
      coalesce((
        select min(value) from wise_chart_points_all
        where series = ${sql.lit(k)}
      ), 0.0)
    `,
  );
  def(
    "max",
    sql`
      coalesce((
        select max(value) from wise_chart_points_all
        where series = ${sql.lit(k)}
      ), 0.0)
    `,
  );
  def(
    "low",
    series.graphLow === undefined ? axisRef(k, "min") : sql`
      least(
        (${chartFixedMetricValue(series.graphLow, valueFormat)})::Double,
        ${axisRef(k, "min")}
      )
    `,
  );
  def("span", sql`${axisRef(k, "max")} - ${axisRef(k, "low")}`);
  def(
    "division_seed",
    sql`
      case
        when ${axisRef(k, "span")} > 0.0
          then ${axisRef(k, "span")} / ${INTERVAL_COUNT}
        else greatest(abs(${axisRef(k, "max")}), 1.0) / ${INTERVAL_COUNT}
      end
    `,
  );
  def(
    "division_power",
    sql`
      power(
        10.0,
        floor(log10(greatest(${axisRef(k, "division_seed")}, 0.000001)))
      )
    `,
  );
  const seedRatio = sql`${axisRef(k, "division_seed")} / ${
    axisRef(k, "division_power")
  }`;
  def("division_multiple", niceDivisionMultiple(seedRatio, false));
  def(
    "candidate_division",
    valueFormat === "number" || valueFormat === "duration"
      ? sql`
        greatest(
          ${axisRef(k, "division_power")} *
            ${axisRef(k, "division_multiple")},
          1.0
        )
      `
      : sql`
        ${axisRef(k, "division_power")} * ${axisRef(k, "division_multiple")}
      `,
  );
  def(
    "candidate_axis_min",
    sql`
      floor(${axisRef(k, "low")} / ${axisRef(k, "candidate_division")}) *
        ${axisRef(k, "candidate_division")}
    `,
  );
  // Rounding the lower bound down can consume almost one interval. Reserving
  // one interval here guarantees the fallback still contains the data.
  def(
    "safe_division_seed",
    sql`
      case
        when ${axisRef(k, "span")} > 0.0
          then ${axisRef(k, "span")} / ${INTERVAL_COUNT - 1}
        else ${axisRef(k, "division_seed")}
      end
    `,
  );
  def(
    "safe_division_power",
    sql`
      power(
        10.0,
        floor(log10(greatest(${axisRef(k, "safe_division_seed")}, 0.000001)))
      )
    `,
  );
  const safeSeedRatio = sql`${axisRef(k, "safe_division_seed")} / ${
    axisRef(k, "safe_division_power")
  }`;
  def(
    "safe_division_multiple",
    niceDivisionMultiple(safeSeedRatio, valueFormat === "duration"),
  );
  def(
    "safe_division",
    valueFormat === "number" || valueFormat === "duration"
      ? sql`
        greatest(
          ${axisRef(k, "safe_division_power")} *
            ${axisRef(k, "safe_division_multiple")},
          1.0
        )
      `
      : sql`
        ${axisRef(k, "safe_division_power")} *
          ${axisRef(k, "safe_division_multiple")}
      `,
  );
  def(
    "auto_division",
    sql`
      case
        when ${axisRef(k, "candidate_axis_min")} +
            ${INTERVAL_COUNT} * ${axisRef(k, "candidate_division")} >=
            ${axisRef(k, "max")}
          then ${axisRef(k, "candidate_division")}
        else ${axisRef(k, "safe_division")}
      end
    `,
  );
  if (series.graphDivision === undefined) {
    def("division", axisRef(k, "auto_division"));
  } else {
    def(
      "explicit_division",
      sql`(${
        chartFixedMetricValue(series.graphDivision, valueFormat)
      })::Double`,
    );
    def(
      "division",
      sql`
        case
          when ${axisRef(k, "explicit_division")} <= 0.0
            then ${axisRef(k, "auto_division")}
          when
            floor(${axisRef(k, "low")} / ${axisRef(k, "explicit_division")}) *
                ${axisRef(k, "explicit_division")} +
              ${INTERVAL_COUNT} * ${axisRef(k, "explicit_division")} >=
              ${axisRef(k, "max")}
            then ${axisRef(k, "explicit_division")}
          else greatest(
            ${axisRef(k, "explicit_division")},
            ${axisRef(k, "safe_division")}
          )
        end
      `,
    );
  }
  def(
    "axis_min",
    sql`
      floor(${axisRef(k, "low")} / ${axisRef(k, "division")}) *
        ${axisRef(k, "division")}
    `,
  );
  def(
    "axis_max",
    sql`
      ${axisRef(k, "axis_min")} +
        ${INTERVAL_COUNT} * ${axisRef(k, "division")}
    `,
  );
}

function defSeriesTables(
  s: StateStatements,
  series: SeriesSpec,
  layout: ChartLayout,
) {
  const k = series.key;
  const plotMidY = layout.top + layout.plotHeight / 2;
  const labelOffset = series.dashed ? 14.0 : 5.0;
  s.defTable(
    `wise_chart_points_${k}`,
    sql`
      select
        base.*,
        case
          when base.date_index = wise_chart_date_count - 1
            then base.x - ${labelOffset}
          else base.x + ${labelOffset}
        end as label_x,
        base.y < ${plotMidY}::Double as label_extends_down,
        case
          when base.y < ${plotMidY}::Double then base.y + 6.0
          else base.y - 6.0
        end as label_y
      from (
        select
          point.period_start_date,
          point.value,
          point.date_index,
          (row_number() over (order by point.period_start_date) - 1)::Int
            as series_index,
          case
            when wise_chart_date_count <= 1
              then ${CHART_LEFT + layout.plotWidth / 2}::Double
            else ${CHART_LEFT}::Double +
              point.date_index::Double * ${layout.plotWidth}::Double /
                (wise_chart_date_count - 1)::Double
          end as x,
          ${layout.top}::Double +
            ((${
      series.reverse
        ? sql`point.value - ${axisRef(k, "axis_min")}`
        : sql`${axisRef(k, "axis_max")} - point.value`
    })::Double *
              ${layout.plotHeight}::Double /
              greatest(
                ${axisRef(k, "axis_max")} - ${axisRef(k, "axis_min")},
                0.000001
              )::Double) as y
        from wise_chart_points_all point
        where point.series = ${sql.lit(k)}
      ) base
    `,
  );
  s.defTable(
    `wise_chart_segments_${k}`,
    sql`
      select
        p1.x as x1,
        p1.y as y1,
        p2.x as x2,
        p2.y as y2
      from ${sql.ref(`wise_chart_points_${k}`)} p1
      join ${sql.ref(`wise_chart_points_${k}`)} p2
        on p2.series_index = p1.series_index + 1
      order by p1.series_index
    `,
  );
}

function SeriesLines(props: { series: SeriesSpec }) {
  return (
    <g
      sx={{
        "line": {
          strokeWidth: 4,
          strokeLinecap: "round",
        },
        ".upLine": {
          stroke: "#111111",
        },
        ".downLine": {
          stroke: "#ff1a0f",
        },
      }}
    >
      <Each
        table={`wise_chart_segments_${props.series.key}`}
        recordName="segment"
      >
        <line
          x1={sql`segment.x1`}
          y1={sql`segment.y1`}
          x2={sql`segment.x2`}
          y2={sql`segment.y2`}
          strokeDasharray={props.series.dashed ? "7 5" : undefined}
          dynamicClasses={[
            {
              condition: sql`segment.y2 > segment.y1`,
              classes: "downLine",
            },
            {
              condition: sql`segment.y2 <= segment.y1`,
              classes: "upLine",
            },
          ]}
        />
      </Each>
    </g>
  );
}

function SeriesValueLabels(props: {
  series: SeriesSpec;
  valueFormat: WiseStatValueFormat;
}) {
  return (
    <g>
      <Each
        table={`wise_chart_points_${props.series.key}`}
        recordName="point"
      >
        <line
          x1={sql`point.x - 3.0`}
          y1={sql`point.y`}
          x2={sql`point.x + 3.0`}
          y2={sql`point.y`}
          stroke="#5960a2"
          strokeWidth="1"
        />
        <text
          x={sql`point.label_x`}
          y={sql`point.label_y`}
          textAnchor={sql`
            case when point.label_extends_down then 'end' else 'start' end
          `}
          dominantBaseline="middle"
          transform={sql`
            concat(
              'rotate(-90 ',
              point.label_x::text,
              ' ',
              point.label_y::text,
              ')'
            )
          `}
          sx={styles.pointText}
        >
          {formatPointValue(sql`point.value`, props.valueFormat)}
        </text>
      </Each>
    </g>
  );
}

/**
 * WISE-style weekly statistic line graph.
 *
 * `query` (and the optional second series) must select `period_start_date`
 * and `value`. The component derives a fixed 10-division y-axis anchored at
 * the data low (or `graphLow`), WISE-style date labels, rotated value labels,
 * and red/black line segments (descending = red, ascending/flat = black).
 *
 * When `graphDivision` is too small for the data range it is bumped to the
 * nearest auto division that fits, so points never escape the plot area.
 *
 * A dual chart (`series2`) draws the second series dashed against its own
 * scale on the right-hand axis, with per-series division annotations and a
 * legend, like the Access dual stat graphs.
 */
export function WiseStatLineChart(props: WiseStatLineChartProps) {
  const valueFormat = props.valueFormat ?? "number";
  const unitLabel = chartUnitLabel(valueFormat, props.unit);

  const layout: ChartLayout = {
    top: props.series2 ? 88 : 60,
    plotWidth: CHART_WIDTH - CHART_LEFT - (props.series2 ? 44 : 18),
    plotHeight: 0,
    xLabelY: 0,
  };
  layout.plotHeight = CHART_HEIGHT - layout.top - CHART_BOTTOM;
  layout.xLabelY = layout.top + layout.plotHeight + 15;

  const series: SeriesSpec[] = [
    {
      key: "a",
      query: props.query,
      dashed: false,
      reverse: props.reverseAxis ?? false,
      graphLow: props.graphLow,
      graphDivision: props.graphDivision,
    },
  ];
  if (props.series2) {
    series.push({
      key: "b",
      query: props.series2.query,
      dashed: true,
      reverse: props.series2.reverseAxis ?? false,
      graphLow: props.series2.graphLow,
      graphDivision: props.series2.graphDivision,
    });
  }
  const plotRight = CHART_LEFT + layout.plotWidth;

  const chart = (
    <Data
      procedure={(s) => {
        s.defTable(
          "wise_chart_points_all",
          sql`
            select
              tagged.series,
              tagged.period_start_date,
              tagged.value,
              (dense_rank() over (order by tagged.period_start_date) - 1)::Int
                as date_index
            from (${
            sql.unionAll(
              ...series.map((spec) =>
                sql`
                  select
                    ${sql.lit(spec.key)} as series,
                    source.period_start_date,
                    ${
                  chartMetricValue(sql`source.value`, valueFormat)
                }::Double as value
                  from (${spec.query}) source
                  where source.value is not null
                `
              ),
            )
          }) tagged
            order by tagged.period_start_date
          `,
        );
        s.defScalar(
          "records_exist",
          sql`exists (select 1 from wise_chart_points_all)`,
        );
        s.defScalar(
          "wise_chart_date_count",
          sql`coalesce((select max(date_index) from wise_chart_points_all), -1) + 1`,
        );
        s.defTable(
          "wise_chart_dates",
          sql`
            select
              period_start_date,
              date_index,
              case
                when date_index = 0
                  or date_index = wise_chart_date_count - 1
                  then format.date(period_start_date, '%-d %b %Y')
                else format.date(period_start_date, '%-d %b')
              end as period_label,
              case
                when wise_chart_date_count <= 1
                  then ${CHART_LEFT + layout.plotWidth / 2}::Double
                else ${CHART_LEFT}::Double +
                  date_index::Double * ${layout.plotWidth}::Double /
                    (wise_chart_date_count - 1)::Double
              end as x
            from wise_chart_points_all
            group by period_start_date, date_index
            order by period_start_date
          `,
        );
        for (const spec of series) {
          defAxisScalars(s, spec, valueFormat);
        }
        const tickSteps = (spec: SeriesSpec) =>
          spec.reverse ? sql`(${INTERVAL_COUNT} - value)` : sql`value`;
        s.defTable(
          "wise_chart_ticks",
          sql`
            select
              value as tick_index,
              ${axisRef("a", "axis_min")} +
                ${tickSteps(series[0])} * ${
            axisRef("a", "division")
          } as tick_value_a,
              ${
            props.series2
              ? sql`${axisRef("b", "axis_min")} +
                ${tickSteps(series[1])} * ${axisRef("b", "division")}`
              : sql`0.0`
          } as tick_value_b,
              ${layout.top}::Double +
                ((${INTERVAL_COUNT} - value)::Double *
                  ${layout.plotHeight}::Double /
                  ${INTERVAL_COUNT}::Double) as y
            from (
              values
                (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10)
            ) as tick_indexes(value)
            order by value
          `,
        );
        for (const spec of series) {
          defSeriesTables(s, spec, layout);
        }
      }}
      pendingFallback={props.pendingFallback ?? (
        <div className="flex justify-center py-8">
          <CircularProgress size="md" />
        </div>
      )}
      errorFallback={props.errorFallback ?? (
        <Alert color="danger" startIcon="Report">
          Unable to load graph
        </Alert>
      )}
    >
      <Show when={sql`not records_exist`}>
        {props.emptyFallback ?? (
          <Alert color="neutral" startIcon="Info">
            No graph values in this date range.
          </Alert>
        )}
      </Show>
      <Show when={sql`records_exist`}>
        <div
          sx={props.displaySize === "widget"
            ? { width: "100%", minWidth: 0 }
            : props.displaySize === "page"
            ? [styles.frame, styles.pageFrame]
            : styles.frame}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 ${
              props.displaySize === "widget" ? 28 : 0
            } ${CHART_WIDTH} ${
              CHART_HEIGHT - (props.displaySize === "widget" ? 28 : 0)
            }`}
            role="img"
            sx={styles.svg}
          >
            <rect
              x="0"
              y="0"
              width={CHART_WIDTH}
              height={CHART_HEIGHT}
              fill="#ffffff"
            />
            {props.displaySize !== "widget" && (
              <text
                x={CHART_WIDTH / 2}
                y="24"
                textAnchor="middle"
                sx={styles.title}
              >
                {props.title}
              </text>
            )}
            {props.series2
              ? (
                <>
                  <line
                    x1="8"
                    y1="38"
                    x2="26"
                    y2="38"
                    stroke="#111111"
                    strokeWidth="3"
                  />
                  <text x="30" y="41" sx={styles.meta}>
                    {props.seriesLabel}
                  </text>
                  <text x="8" y="54" sx={styles.meta}>
                    1 Division = {formatDivision(
                      axisRef("a", "division"),
                      valueFormat,
                    )}
                  </text>
                  {unitLabel !== "" && (
                    <text x="8" y="67" sx={styles.meta}>
                      {unitLabel}
                    </text>
                  )}
                  <line
                    x1={CHART_WIDTH / 2 + 6}
                    y1="38"
                    x2={CHART_WIDTH / 2 + 24}
                    y2="38"
                    stroke="#111111"
                    strokeWidth="3"
                    strokeDasharray="5 4"
                  />
                  <text x={CHART_WIDTH / 2 + 28} y="41" sx={styles.meta}>
                    {props.series2.label}
                  </text>
                  <text x={CHART_WIDTH / 2 + 28} y="54" sx={styles.meta}>
                    1 Division = {formatDivision(
                      axisRef("b", "division"),
                      valueFormat,
                    )}
                  </text>
                  {props.ownerHeader && (
                    <text
                      x={CHART_WIDTH - 8}
                      y="67"
                      textAnchor="end"
                      sx={styles.meta}
                    >
                      {props.ownerHeader}
                    </text>
                  )}
                  {props.ownerLabel && (
                    <text
                      x={CHART_WIDTH - 8}
                      y="80"
                      textAnchor="end"
                      sx={styles.meta}
                    >
                      {props.ownerLabel}
                    </text>
                  )}
                </>
              )
              : (
                <>
                  <text x="8" y="41" sx={styles.meta}>
                    1 Division = {formatDivision(
                      axisRef("a", "division"),
                      valueFormat,
                    )}
                  </text>
                  {unitLabel !== "" && (
                    <text x="8" y="54" sx={styles.meta}>
                      {unitLabel}
                    </text>
                  )}
                  {props.ownerHeader && (
                    <text
                      x={CHART_WIDTH - 8}
                      y="41"
                      textAnchor="end"
                      sx={styles.meta}
                    >
                      {props.ownerHeader}
                    </text>
                  )}
                  {props.ownerLabel && (
                    <text
                      x={CHART_WIDTH - 8}
                      y="54"
                      textAnchor="end"
                      sx={styles.meta}
                    >
                      {props.ownerLabel}
                    </text>
                  )}
                </>
              )}

            <rect
              x={CHART_LEFT}
              y={layout.top}
              width={layout.plotWidth}
              height={layout.plotHeight}
              fill="#ffffff"
            />
            <g>
              <Each table="wise_chart_dates" recordName="chart_date">
                <line
                  x1={sql`chart_date.x`}
                  y1={layout.top}
                  x2={sql`chart_date.x`}
                  y2={layout.top + layout.plotHeight}
                  stroke="#e6e6e6"
                  strokeWidth="1"
                />
              </Each>
              <Each table="wise_chart_ticks" recordName="tick">
                <line
                  x1={CHART_LEFT}
                  y1={sql`tick.y`}
                  x2={plotRight}
                  y2={sql`tick.y`}
                  stroke="#e2e2e2"
                  strokeWidth="1"
                />
              </Each>
            </g>
            <rect
              x={CHART_LEFT}
              y={layout.top}
              width={layout.plotWidth}
              height={layout.plotHeight}
              fill="none"
              stroke="#575757"
              strokeWidth="2"
            />
            <g>
              <Each table="wise_chart_dates" recordName="chart_date">
                <line
                  x1={sql`chart_date.x`}
                  y1={layout.top + layout.plotHeight}
                  x2={sql`chart_date.x`}
                  y2={layout.top + layout.plotHeight + BOTTOM_TICK_LENGTH}
                  stroke="#575757"
                  strokeWidth="1"
                />
              </Each>
            </g>

            <g>
              <Each table="wise_chart_ticks" recordName="tick">
                <text
                  x={CHART_LEFT - 8}
                  y={sql`tick.y`}
                  textAnchor="end"
                  dominantBaseline="middle"
                  sx={styles.axisText}
                >
                  {formatChartValue(sql`tick.tick_value_a`, valueFormat)}
                </text>
              </Each>
            </g>
            {props.series2 && (
              <g>
                <Each table="wise_chart_ticks" recordName="tick">
                  <text
                    x={plotRight + 8}
                    y={sql`tick.y`}
                    textAnchor="start"
                    dominantBaseline="middle"
                    sx={styles.axisText}
                  >
                    {formatChartValue(sql`tick.tick_value_b`, valueFormat)}
                  </text>
                </Each>
              </g>
            )}
            <g>
              <Each table="wise_chart_dates" recordName="chart_date">
                <text
                  x={sql`chart_date.x - 3.0`}
                  y={layout.xLabelY}
                  textAnchor="end"
                  dominantBaseline="middle"
                  transform={sql`
                    concat(
                      'rotate(-60 ',
                      (chart_date.x - 3.0)::text,
                      ' ',
                      ${layout.xLabelY}::text,
                      ')'
                    )
                  `}
                  sx={styles.axisText}
                >
                  {sql`chart_date.period_label`}
                </text>
              </Each>
            </g>
            {series.map((spec) => <SeriesLines series={spec} />)}
            {series.map((spec) => (
              <SeriesValueLabels series={spec} valueFormat={valueFormat} />
            ))}
          </svg>
        </div>
      </Show>
    </Data>
  );
  if (!props.viewHref) {
    return chart;
  }
  return (
    <div sx={styles.preview}>
      <div sx={styles.previewAction}>
        <Button
          href={props.viewHref}
          size="xs"
          variant="plain"
          color="neutral"
          startIcon="OpenInFull"
          aria-label={typeof props.title === "string"
            ? `View ${props.title}`
            : "View graph"}
        >
          View
        </Button>
      </div>
      {chart}
    </div>
  );
}
