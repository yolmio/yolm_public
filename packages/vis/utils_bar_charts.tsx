import { Alert } from "components/alert";
import { Skeleton } from "components/skeleton";
import { Data } from "std/data";
import { BarRootICtxKey } from "std/ictx";
import type { BarRootICtx } from "std/ictx";
import type { NumericExpr, Sql } from "../std/sql_utils";
import { sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import {
  addCtx,
  type ContextInstance,
  gatherChildrenContextInfo,
  type ICtxKey,
  Show,
  useUniqueId,
} from "std/ui";
import type { Node } from "std/ui";
import type { Style } from "std/style_types";

/**
 * Padding around the chart's plot area. Pass a single number for symmetric
 * padding, or an object to override individual sides. Sides that are
 * omitted from the object fall back to the layout's default.
 */
export type BarChartPadding = number | {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

interface BarChartProps {
  children: Node;
  height: number;
  width: number;
  query: Sql;
  padding?: BarChartPadding;
  tickCount?: number;
  minValue?: number;
  maxValue?: number;
  scaleType?: "linear" | "logarithmic";
  /**
   * "vertical" (default): bars grow upward, categories along the x-axis.
   * "horizontal": bars grow rightward, categories along the y-axis.
   */
  layout?: "vertical" | "horizontal";
  sx?: Style;
  className?: string;
}

interface BarXScaleProps {
  barIndex: NumericExpr;
  groupWidth: NumericExpr;
  barWidth: NumericExpr;
  numBarsPerGroup: NumericExpr;
  barGap: NumericExpr;
  monthIndex: NumericExpr;
}
/**
 * SQL expression mapping a bar at `barIndex` inside group `monthIndex`
 * to its X coordinate. Used internally by `BarChart.Bar`; exported so
 * advanced charts can reuse the same scale.
 */
export function barXScale(props: BarXScaleProps) {
  const {
    barIndex,
    groupWidth,
    barWidth,
    numBarsPerGroup,
    barGap,
    monthIndex,
  } = props;
  const groupX = sql`${monthIndex}::Double * ${groupWidth}::Double`;
  const groupCenterX = sql`${groupX} + (${groupWidth} / 2)::Double`;
  const barsStartX =
    sql`${groupCenterX} - (${numBarsPerGroup}::Double * ${barWidth}::Double + (${numBarsPerGroup}::Double - 1) * ${barGap}::Double) / 2::Double`;
  const barX =
    sql`${barsStartX} + (${barWidth}::Double + ${barGap}::Double) * ${barIndex}::Double`;
  return barX;
}
interface BarYScaleProps {
  value: NumericExpr;
  chartHeight: NumericExpr;
  maxValue: NumericExpr;
  minValue: NumericExpr;
  scaleType: "linear" | "logarithmic";
}
/**
 * SQL expression mapping a numeric value to a Y coordinate inside the
 * chart's plot area. Supports linear and logarithmic scales. Exported
 * so custom marks can reuse the chart's vertical scale.
 */
export function barYScale(props: BarYScaleProps) {
  const { value, chartHeight, maxValue, minValue, scaleType } = props;
  if (scaleType === "logarithmic") {
    return sql`${chartHeight}::Double - (
      (ln(greatest(1::Double, ${value}::Double)) - ln(greatest(1::Double, ${minValue}::Double))) /
      (ln(${maxValue}::Double)::Double - ln(greatest(1::Double, ${minValue}::Double)::Double))
    ) * ${chartHeight}::Double`;
  }
  return sql`${chartHeight}::Double - (${value}::Double / ${maxValue}::Double) * ${chartHeight}::Double`;
}

class BarRootCtx implements ContextInstance, BarRootICtx {
  implementICtxs: ICtxKey<any>[] = [BarRootICtxKey];
  yAxis: string[] = [];
  xAxis?: string;
  padding: number;
  constructor(
    public paddingTop: number,
    public paddingRight: number,
    public paddingBottom: number,
    public paddingLeft: number,
    public scaleType: "linear" | "logarithmic",
    public height: number,
    public width: number,
    public layout: "vertical" | "horizontal",
  ) {
    // `padding` kept for backward compatibility — most callers used it as the
    // top inset; pick top so existing code keeps rendering as before.
    this.padding = paddingTop;
    this.paddingTop = paddingTop;
    this.paddingRight = paddingRight;
    this.paddingBottom = paddingBottom;
    this.paddingLeft = paddingLeft;
    this.scaleType = scaleType;
    this.height = height;
    this.width = width;
    this.layout = layout;
  }
  setYAxis(value: string) {
    this.yAxis = [...this.yAxis, value];
  }
  setXAxis(value: string) {
    this.xAxis = value;
  }
}

/**
 * Internal root component for {@link BarChart}. Wraps the chart query in
 * a `<Data>` block, computes scales, and provides the `BarRootICtx` for
 * sub-components. Use {@link BarChart} (not `BarRoot`) directly in
 * application code.
 */
export function BarRoot(props: BarChartProps) {
  const {
    children,
    query,
    height,
    width,
    scaleType = "linear",
    tickCount = 5,
    minValue,
    maxValue,
    layout = "vertical",
    sx,
    className,
  } = props;
  // Resolve per-side paddings. Horizontal mode puts category labels on the
  // left and tick labels on the bottom, with no labels above or to the right
  // of the plot area — so the default is asymmetric.
  const defaults = layout === "horizontal"
    ? { top: 20, right: 20, bottom: 40, left: 110 }
    : { top: 60, right: 60, bottom: 60, left: 60 };
  const p = props.padding;
  const resolved = typeof p === "number"
    ? { top: p, right: p, bottom: p, left: p }
    : {
      top: p?.top ?? defaults.top,
      right: p?.right ?? defaults.right,
      bottom: p?.bottom ?? defaults.bottom,
      left: p?.left ?? defaults.left,
    };
  const padding = resolved.top; // alias for legacy `padding` references
  const ctx = new BarRootCtx(
    resolved.top,
    resolved.right,
    resolved.bottom,
    resolved.left,
    scaleType,
    height,
    width,
    layout,
  );

  addCtx(ctx);
  gatherChildrenContextInfo(children);

  const BarRootId = useUniqueId();
  function onMouseMove(s: DomStatements) {
    if (ctx.yAxis.length > 0) {
      s.setScalar("popover_open", true);
      const yValue = ctx.yAxis.length === 1
        ? sql`(select max(${
          sql.ref(ctx.yAxis[0])
        }) from chart_data where index = mouse_index)`
        : sql`(select greatest(${
          sql(
            ctx.yAxis
              .map(
                (col) =>
                  `(select max(${col}) from chart_data where index = mouse_index)`,
              )
              .join(", "),
          )
        }))`;
      if (layout === "vertical") {
        s.setScalar(
          "tool_tip_x",
          barXScale({
            barIndex: 0,
            groupWidth: sql`group_width`,
            barWidth: sql`bar_width`,
            numBarsPerGroup: sql`${ctx.yAxis.length}::Int`,
            barGap: sql`bar_gap`,
            monthIndex: sql`mouse_index`,
          }),
        );
        s.setScalar(
          "tool_tip_y",
          sql`${
            barYScale({
              value: yValue,
              chartHeight: sql`chart_height`,
              maxValue: sql`max_value`,
              minValue: sql`min_value`,
              scaleType,
            })
          }`,
        );
      } else {
        // Horizontal: x maps to value, y maps to category index.
        s.setScalar(
          "tool_tip_x",
          sql`(${yValue}::Double / max_value::Double) * chart_width::Double`,
        );
        s.setScalar(
          "tool_tip_y",
          barXScale({
            barIndex: 0,
            groupWidth: sql`group_width`,
            barWidth: sql`bar_width`,
            numBarsPerGroup: sql`${ctx.yAxis.length}::Int`,
            barGap: sql`bar_gap`,
            monthIndex: sql`mouse_index`,
          }),
        );
      }
      s.setScalar("popover_open", true);
    }
  }
  function onMouseLeave(s: DomStatements) {
    s.setScalar("popover_open", false);
  }
  return (
    <div sx={sx} className={className}>
      <Data
        pendingFallback={
          <div
            sx={{
              width: "100%",
              height: "100%",
              aspectRatio: `${width} / ${height}`,
              padding: `${padding}px`,
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          >
            <Skeleton
              variant="rectangular"
              animation="wave"
              className="w-full h-full"
            />
          </div>
        }
        errorFallback={
          <Alert color="danger" startIcon="Report">
            Failed to load data
          </Alert>
        }
        procedure={(s) => {
          s.defScalar("records_exist", sql`exists (${query})`);
          s.defScalar("popover_open", {
            type: "Bool",
            expr: false,
            allowNoRead: true,
          });
          s.defScalar("mouse_index", {
            type: "Int",
            allowNoRead: true,
          });
          s.defScalar("tool_tip_x", {
            type: "Int",
            allowNoRead: true,
          });
          s.defScalar("tool_tip_y", {
            type: "Int",
            allowNoRead: true,
          });
          s.defTable(
            "chart_data",
            sql`select *, ((row_number() over()) - 1) as index from (${query})`,
          );
          s.defScalar("chart_data_row_count", {
            expr: sql`(select count(*) from chart_data)`,
            allowNoRead: true,
          });
          s.defScalar(
            "chart_height",
            sql`${height} - ${resolved.top} - ${resolved.bottom}`,
          );
          s.defScalar(
            "chart_width",
            sql`${width} - ${resolved.left} - ${resolved.right}`,
          );
          // `group_width` / `bar_width` track the *category-axis* slot, which is
          // the x-dimension when vertical and the y-dimension when horizontal.
          s.defScalar(
            "group_width",
            layout === "vertical"
              ? sql`(chart_width / chart_data_row_count)::Double`
              : sql`(chart_height / chart_data_row_count)::Double`,
          );
          s.defScalar(
            "total_bars_width",
            sql`round(group_width::Double * 0.6::Double)`,
          );
          s.defScalar(
            "bar_width",
            sql`total_bars_width / greatest(${ctx.yAxis.length}, 1)`,
          );
          s.defScalar("bar_gap", sql`bar_width * 0.2`);
          if (ctx.yAxis.length > 0) {
            s.defScalar(
              "min_value",
              minValue ??
                (ctx.yAxis.length === 1
                  ? sql`(select min(${sql.ref(ctx.yAxis[0])}) from chart_data)`
                  : sql`(select least(${
                    sql(
                      ctx.yAxis
                        .map((col) => `(select min(${col}) from chart_data)`)
                        .join(", "),
                    )
                  }))`),
            );
            s.defScalar(
              "max_value",
              maxValue ??
                (ctx.yAxis.length === 1
                  ? sql`(select max(${sql.ref(ctx.yAxis[0])}) from chart_data)`
                  : sql`(select greatest(${
                    sql(
                      ctx.yAxis
                        .map((col) => `(select max(${col}) from chart_data)`)
                        .join(", "),
                    )
                  }))`),
            );
            for (const [barIndex, yAxis] of ctx.yAxis.entries()) {
              if (layout === "vertical") {
                s.defTable(
                  `data_points_${yAxis}`,
                  sql`select
                  ${sql.ref(yAxis)},
                  index,
                  ${
                    barXScale({
                      barIndex: sql`${barIndex}::Int`,
                      groupWidth: sql`group_width`,
                      barWidth: sql`bar_width`,
                      numBarsPerGroup: sql`${ctx.yAxis.length}::Int`,
                      barGap: sql`bar_gap`,
                      monthIndex: sql`index`,
                    })
                  } as x,
                  ${
                    barYScale({
                      value: sql`${sql.ref(yAxis)}`,
                      chartHeight: sql`chart_height`,
                      maxValue: sql`max_value`,
                      minValue: sql`min_value`,
                      scaleType,
                    })
                  } as y
                from chart_data`,
                );
              } else {
                // Horizontal: x = 0 (bars start at the left of the plot area),
                // y = category slot, bar_w = scaled value length, bar_h = bar
                // thickness along the category axis.
                const valueLen = scaleType === "logarithmic"
                  ? sql`(
                      (ln(greatest(1::Double, ${
                    sql.ref(yAxis)
                  }::Double)) - ln(greatest(1::Double, min_value::Double))) /
                      (ln(max_value::Double) - ln(greatest(1::Double, min_value::Double)))
                    ) * chart_width::Double`
                  : sql`(${
                    sql.ref(yAxis)
                  }::Double / max_value::Double) * chart_width::Double`;
                s.defTable(
                  `data_points_${yAxis}`,
                  sql`select
                  ${sql.ref(yAxis)},
                  index,
                  0::Double as x,
                  ${
                    barXScale({
                      barIndex: sql`${barIndex}::Int`,
                      groupWidth: sql`group_width`,
                      barWidth: sql`bar_width`,
                      numBarsPerGroup: sql`${ctx.yAxis.length}::Int`,
                      barGap: sql`bar_gap`,
                      monthIndex: sql`index`,
                    })
                  } as y,
                  ${valueLen} as bar_w,
                  bar_width::Double as bar_h
                from chart_data`,
                );
              }
            }
            s.defTable("ticks", {
              fields: [
                { name: "value", type: "BigInt" },
                { name: "x", type: "BigInt" },
                { name: "y", type: "BigInt" },
              ],
            });
            // Compute tick rows in a single CTE and group by integer value to
            // drop duplicates (otherwise a 0-2 range with tickCount=5 would
            // render '0,0,0,1,1,2' once values are cast to bigint).
            const tickValueExpr = scaleType === "linear"
              ? sql`min_value + (gs.value * (max_value - min_value)) / ${tickCount}`
              : sql`exp(ln(greatest(1, min_value)) +
                  (gs.value * (ln(max_value) - ln(greatest(1, min_value)))) /
                    ${tickCount})`;
            if (layout === "vertical") {
              s.modify(sql`
                with raw_ticks as (
                  select gs.value as i, cast(${tickValueExpr} as bigint) as v
                  from series.int(0, ${tickCount}) gs
                ),
                deduped as (
                  select v, min(i) as i from raw_ticks group by v
                )
                insert into ticks (value, x, y)
                select
                  d.v,
                  ${resolved.left},
                  ${height} - ${resolved.bottom} - (d.i * (${height} - ${resolved.top} - ${resolved.bottom}) / ${tickCount})
                from deduped d
              `);
            } else {
              s.modify(sql`
                with raw_ticks as (
                  select gs.value as i, cast(${tickValueExpr} as bigint) as v
                  from series.int(0, ${tickCount}) gs
                ),
                deduped as (
                  select v, min(i) as i from raw_ticks group by v
                )
                insert into ticks (value, x, y)
                select
                  d.v,
                  ${resolved.left} + (d.i * (${width} - ${resolved.left} - ${resolved.right}) / ${tickCount}),
                  ${height - resolved.bottom}
                from deduped d
              `);
            }
          }
        }}
      >
        <Show when={sql`not records_exist`}>
          <Alert color="warning" startIcon="Info">
            No data
          </Alert>
        </Show>
        <Show when={sql`records_exist`}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="100%"
            height="100%"
            viewBox={`0 0 ${width} ${height}`}
            id={BarRootId}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
          >
            {children}
          </svg>
        </Show>
      </Data>
    </div>
  );
}
