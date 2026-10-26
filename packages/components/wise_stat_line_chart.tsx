import { Alert } from "components/alert";
import { Button } from "components/button";
import { CircularProgress } from "components/circular_progress";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { Sql } from "std/sql_utils";
import { normalizeValueFormat } from "std/value_format";
import type { ValueFormat } from "std/value_format";
import type { BooleanExpr } from "std/sql_utils";
import { createStyles } from "std/style_utils";
import { Each, Show } from "std/ui";
import type { Node } from "std/ui";
import {
  CHART_LEFT,
  prepareWiseChart,
  registerWiseChartProcedures,
} from "./wise_stat_line_chart_data";
import type {
  WiseChartLayout,
  WiseChartSeries,
} from "./wise_stat_line_chart_data";

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
const CHART_BOTTOM = 88;
const BOTTOM_TICK_LENGTH = 6;

/**
 * How raw `value`s are scaled and labeled on the graph:
 * - `number`: plotted as-is.
 * - `number_thousands`: entered raw, plotted and labeled in thousands.
 * - `currency`: dollars, plotted in thousands ("In Thousands").
 * - `percentage`: fractions, plotted as percent.
 * - `duration`: minutes, labeled as total hours and minutes.
 */
export type WiseStatValueFormat =
  | "number"
  | "number_thousands"
  | "currency"
  | "percentage"
  | "duration";

export type WiseStatDisplaySize = "grid" | "page" | "widget" | "expanded";

export interface WiseStatLineChartProps {
  title: Node;
  query: Sql;
  /** Static format metadata or a runtime SQL expression containing an object or legacy string. */
  valueFormat?: WiseStatValueFormat | ValueFormat | Sql;
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
  reverseAxis?: BooleanExpr;
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
    reverseAxis?: BooleanExpr;
  };
  /** Optional app-local route for opening this graph in a focused view. */
  viewHref?: Sql | string;
  /** Page enlarges for print; widget fills a host card that supplies its title/frame. */
  displaySize?: WiseStatDisplaySize;
  /** Compact charts label the latest non-missing value; expanded charts can label all. */
  valueLabels?: "all" | "latest";
  emptyFallback?: Node;
  errorFallback?: Node;
  pendingFallback?: Node;
}

function SeriesLines(props: { series: WiseChartSeries }) {
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
  series: WiseChartSeries;
  latestOnly?: boolean;
  top: number;
  bottom: number;
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
        <circle cx={sql`point.x`} cy={sql`point.y`} r={3} fill="#27317f">
          <title>{sql`point.value_label`}</title>
        </circle>
        <Show
          when={props.latestOnly
            ? sql`point.x = (select max(x) from ${
              sql.ref(`wise_chart_points_${props.series.key}`)
            })`
            : true}
        >
          <text
            data-wise-value-label="true"
            x={props.latestOnly ? sql`point.x - 5.0` : sql`point.label_x`}
            y={props.latestOnly
              ? props.series.dashed
                ? sql`case when point.y > ${
                  props.bottom - 40
                } then point.y - 32.0 when point.y < ${
                  props.top + 40
                } then point.y + 36.0 else point.y + 18.0 end`
                : sql`case when point.y < ${
                  props.top + 40
                } then point.y + 18.0 else point.y - 12.0 end`
              : sql`point.label_y`}
            textAnchor={props.latestOnly ? "end" : sql`point.label_anchor`}
            dominantBaseline="middle"
            transform={props.latestOnly
              ? undefined
              : sql`point.label_transform`}
            sx={styles.pointText}
          >
            {sql`point.value_label`}
          </text>
        </Show>
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
 * When `graphDivision` is too small for the data range it grows to the
 * smallest 1-2-5 multiple of itself that fits, so points never escape the
 * plot area.
 *
 * A dual chart (`series2`) draws the second series dashed against its own
 * scale on the right-hand axis, with per-series division annotations and a
 * legend, like the Access dual stat graphs.
 */
export function WiseStatLineChart(props: WiseStatLineChartProps) {
  registerWiseChartProcedures();
  const valueFormat = normalizeValueFormat(
    props.valueFormat instanceof Sql
      ? sql`json_build_array(${props.valueFormat})->0`
      : sql`${
        sql.lit(JSON.stringify(
          typeof props.valueFormat === "string"
            ? { type: props.valueFormat }
            : props.valueFormat ?? { type: "number" },
        ))
      }::json`,
  );
  const formatType = sql`${valueFormat}->>'type'`;
  const compact = props.displaySize === "widget";
  const chartWidth = props.displaySize === "expanded"
    ? 1000
    : compact
    ? 600
    : CHART_WIDTH;
  const chartHeight = compact ? 440 : CHART_HEIGHT;
  const unitLabel = sql`case
    when ${formatType} in ('currency', 'number_thousands') then 'In Thousands'
    when ${formatType} = 'percentage' then 'In Percent'
    else ${sql.lit(props.unit ? `In ${props.unit}` : "")} end`;

  const layout: WiseChartLayout = {
    top: props.series2 ? 88 : 60,
    plotWidth: chartWidth - CHART_LEFT - (props.series2 ? 90 : 24),
    plotHeight: 0,
    xLabelY: 0,
  };
  layout.plotHeight = chartHeight - layout.top - CHART_BOTTOM;
  layout.xLabelY = layout.top + layout.plotHeight + 15;

  const series: WiseChartSeries[] = [
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
      procedure={(s) => prepareWiseChart(s, series, layout, valueFormat)}
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
          sx={compact || props.displaySize === "expanded"
            ? {
              width: "100%",
              minWidth: 0,
              overflowX: compact ? undefined : "auto",
            }
            : props.displaySize === "page"
            ? [styles.frame, styles.pageFrame]
            : styles.frame}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 ${
              compact || props.displaySize === "expanded" ? 28 : 0
            } ${chartWidth} ${
              chartHeight -
              (compact || props.displaySize === "expanded" ? 28 : 0)
            }`}
            role="img"
            sx={[
              styles.svg,
              compact || props.displaySize === "expanded"
                ? {
                  minWidth: compact ? 0 : "800px",
                  "text": { fontSize: "14px" },
                }
                : {},
            ]}
          >
            <rect
              x="0"
              y="0"
              width={chartWidth}
              height={chartHeight}
              fill="#ffffff"
            />
            {!compact && props.displaySize !== "expanded" && (
              <text
                x={chartWidth / 2}
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
                    1 Division = {sql`wise_chart_division_label_a`}
                  </text>
                  <Show when={sql`${unitLabel} != ''`}>
                    <text x="8" y="67" sx={styles.meta}>
                      {unitLabel}
                    </text>
                  </Show>
                  <line
                    x1={chartWidth / 2 + 6}
                    y1="38"
                    x2={chartWidth / 2 + 24}
                    y2="38"
                    stroke="#111111"
                    strokeWidth="3"
                    strokeDasharray="5 4"
                  />
                  <text x={chartWidth / 2 + 28} y="41" sx={styles.meta}>
                    {props.series2.label}
                  </text>
                  <text x={chartWidth / 2 + 28} y="54" sx={styles.meta}>
                    1 Division = {sql`wise_chart_division_label_b`}
                  </text>
                  {props.ownerHeader && (
                    <text
                      x={chartWidth - 8}
                      y="67"
                      textAnchor="end"
                      sx={styles.meta}
                    >
                      {props.ownerHeader}
                    </text>
                  )}
                  {props.ownerLabel && (
                    <text
                      x={chartWidth - 8}
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
                    1 Division = {sql`wise_chart_division_label_a`}
                  </text>
                  <Show when={sql`${unitLabel} != ''`}>
                    <text x="8" y="54" sx={styles.meta}>
                      {unitLabel}
                    </text>
                  </Show>
                  {props.ownerHeader && (
                    <text
                      x={chartWidth - 8}
                      y="41"
                      textAnchor="end"
                      sx={styles.meta}
                    >
                      {props.ownerHeader}
                    </text>
                  )}
                  {props.ownerLabel && (
                    <text
                      x={chartWidth - 8}
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
              <Each table="wise_chart_ticks_a" recordName="tick">
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
              <Each table="wise_chart_ticks_a" recordName="tick">
                <text
                  data-wise-axis-label="a"
                  x={CHART_LEFT - 8}
                  y={sql`tick.y`}
                  textAnchor="end"
                  dominantBaseline="middle"
                  sx={styles.axisText}
                >
                  {sql`tick.value_label`}
                </text>
              </Each>
            </g>
            {props.series2 && (
              <g>
                <Each table="wise_chart_ticks_b" recordName="tick">
                  <text
                    data-wise-axis-label="b"
                    x={plotRight + 8}
                    y={sql`tick.y`}
                    textAnchor="start"
                    dominantBaseline="middle"
                    sx={styles.axisText}
                  >
                    {sql`tick.value_label`}
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
                  transform={sql`chart_date.label_transform`}
                  sx={styles.axisText}
                >
                  {sql`chart_date.period_label`}
                </text>
              </Each>
            </g>
            {series.map((spec) => <SeriesLines series={spec} />)}
            {series.map((spec) => (
              <SeriesValueLabels
                series={spec}
                latestOnly={props.valueLabels === "latest"}
                top={layout.top}
                bottom={layout.top + layout.plotHeight}
              />
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
