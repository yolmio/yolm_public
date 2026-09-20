import type { Sql } from "../std/sql_utils";
import { cssVar } from "std/style_utils";
import { LineChart } from "./line_charts";

/** Props for {@link WiseChart}. */
export interface WiseChartProps {
  /**
   * Query that projects `label` (X-axis tick text) and `value` (numeric
   * Y value). Other columns are ignored.
   */
  query: Sql;
  /** Top of the Y-axis range. */
  high: number;
  /** Bottom of the Y-axis range. */
  low: number;
  /** Chart height in px (default 500). */
  height?: number;
  /** Chart width in px (default 800). */
  width?: number;
}

/**
 * Pre-themed `LineChart` with light/dark-aware axis/line colors and
 * downward-trending segments highlighted in `palette-danger-400`.
 *
 * Expects the query to project `label` (the X-axis tick text) and
 * `value` (the numeric Y value). `low`/`high` clamp the Y-axis range
 * so all rendered values fit inside the bounds you choose.
 *
 * Use for dashboard KPI panels (weekly stats, throughput) where you
 * want a labelled line chart without re-styling LineChart from
 * scratch.
 *
 * @example
 * <WiseChart
 *   query={sql`select format.date(day, '%-m/%-d') as label,
 *                     total / 60 as value
 *              from query_result`}
 *   low={0}
 *   high={40}
 * />
 */
export function WiseChart(props: WiseChartProps) {
  return (
    <LineChart
      query={props.query}
      tickCount={10}
      height={props.height ?? 500}
      width={props.width ?? 800}
      minValue={props.low}
      maxValue={props.high}
    >
      <LineChart.XAxisLabels
        text={{
          sx: {
            fill: "#000",
            dark: {
              fill: "#fff",
            },
          },
        }}
        columnName="label"
      />
      <LineChart.YAxisLabels
        text={{
          sx: {
            fill: "#000",
            dark: {
              fill: "#fff",
            },
          },
        }}
      />
      <LineChart.YAxis />
      <LineChart.XAxis />
      <LineChart.CartesianGrid />
      <LineChart.DistinctValueLines
        column="value"
        sx={{
          strokeWidth: 2,
          fill: "none",
          stroke: cssVar("palette-common-black"),
          dark: {
            "& :not(.downLine)": {
              stroke: cssVar("palette-common-white"),
            },
          },
          "& .downLine": {
            stroke: cssVar("palette-danger-400"),
          },
        }}
        showLabels={{
          fontSize: 14,
          textAnchor: "middle",
          offset: 15,
          sx: {
            fill: "#000",
            dark: {
              fill: "#fff",
            },
          },
        }}
      />
    </LineChart>
  );
}
