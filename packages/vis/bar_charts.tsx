import type { Property } from "csstype";
import { BarRootICtxKey } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { NumericExpr, Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { cssVar } from "std/style_utils";
import { Data } from "std/data";
import { Each, Show, useICtx, usePhase, useSourceMap } from "std/ui";
import type { Node } from "std/ui";
import { type BarChartPadding, BarRoot } from "./utils_bar_charts";

export type { BarChartPadding };

/**
 * Props for {@link BarChart}. When both `height` and `width` are omitted the
 * chart renders responsively, picking small/medium/large presets via container
 * queries; supply both to fix the dimensions.
 *
 * @category Visualization
 */
export interface BarChartProps {
  children: Node;
  /** Fixed chart height in px. Omit (along with `width`) for responsive sizing. */
  height?: number;
  /** Fixed chart width in px. Omit (along with `height`) for responsive sizing. */
  width?: number;
  /** SQL query returning the rows to plot; one row per category. */
  query: Sql;
  /**
   * Padding around the plot area. Pass a single number for symmetric padding,
   * or an object like `{ top: 20, left: 110, bottom: 40, right: 20 }` to
   * override individual sides. Omitted sides fall back to the layout's
   * default (vertical = 60 on all sides; horizontal = small top/right,
   * larger left for category labels, medium bottom for tick text).
   */
  padding?: BarChartPadding;
  /** Number of value-axis ticks (default: inferred from data). */
  tickCount?: number;
  /** Lower bound of the value axis (default: inferred from data). */
  minValue?: number;
  /** Upper bound of the value axis (default: inferred from data). */
  maxValue?: number;
  /** Value-axis scale (default `"linear"`). */
  scaleType?: "linear" | "logarithmic";
  /**
   * "vertical" (default): bars grow upward, categories along the x-axis.
   * "horizontal": bars grow rightward, categories along the y-axis. Good
   * for many categories or for cases where category labels are long.
   */
  layout?: "vertical" | "horizontal";
  sx?: Style;
  className?: string;
}

const SIZE_CONFIGS = {
  small: {
    width: 400,
    height: 250,
    padding: 30,
  },
  medium: {
    width: 600,
    height: 350,
    padding: 45,
  },
  large: {
    width: 800,
    height: 450,
    padding: 60,
  },
} as const;

/**
 BarChart is the root component for creating bar charts.

 Required props:
 - height: Total height of the chart in pixels
 - width: Total width of the chart in pixels
 - query: SQL query that returns the data to plot
 - children: Child components like XAxisLabels, YAxisLabels,CartesianGrid, Bar, Tooltip etc.

 Optional props:
 - padding: Padding around the chart area (default: 40)
 - tickCount: Number of ticks to show on y-axis (default: inferred from data)
 - minValue: Minimum value for y-axis (default: inferred from data)
 - maxValue: Maximum value for y-axis (default: inferred from data)
 - scaleType: Type of y-axis scale - "linear" or "logarithmic" (default: "linear")

 The component:
 - Wraps chart content in BarRoot which provides context and data
 - Handles chart dimensions and scaling
 - Supports multiple bars, tooltips and customizable axes

 @category Visualization
 @example
 [Example](../../examples/northwind/apps/northwind.yolmstaging.net.tsx)
 */
export function BarChart(props: BarChartProps) {
  const {
    children,
    height,
    width,
    query,
    padding,
    tickCount,
    minValue,
    maxValue,
    scaleType,
    layout,
    sx,
    className,
  } = props;
  useSourceMap("BarChart");
  if (height && width) {
    return (
      <BarRoot
        query={query}
        height={height}
        width={width}
        padding={padding}
        tickCount={tickCount}
        minValue={minValue}
        maxValue={maxValue}
        scaleType={scaleType}
        layout={layout}
        sx={sx}
        className={className}
      >
        {children}
      </BarRoot>
    );
  }
  return (
    <div
      className={className}
      sx={{
        width: "100%",
        containerType: "inline-size",
        ...sx,
      }}
    >
      {/* Small size for narrow containers (< 600px) */}
      <div
        sx={{
          display: "block",
          "@container (min-width: 600px)": {
            display: "none",
          },
        }}
      >
        <BarRoot
          query={query}
          height={height ?? SIZE_CONFIGS.small.height}
          width={width ?? SIZE_CONFIGS.small.width}
          padding={padding}
          tickCount={tickCount}
          minValue={minValue}
          maxValue={maxValue}
          scaleType={scaleType}
          layout={layout}
        >
          {children}
        </BarRoot>
      </div>

      {/* Medium size for medium containers (600px - 800px) */}
      <div
        sx={{
          display: "none",
          "@container (min-width: 600px)": {
            display: "block",
          },
          "@container (min-width: 800px)": {
            display: "none",
          },
        }}
      >
        <BarRoot
          query={query}
          height={height ?? SIZE_CONFIGS.medium.height}
          width={width ?? SIZE_CONFIGS.medium.width}
          padding={padding}
          tickCount={tickCount}
          minValue={minValue}
          maxValue={maxValue}
          scaleType={scaleType}
          layout={layout}
        >
          {children}
        </BarRoot>
      </div>

      {/* Large size for wide containers (> 800px) */}
      <div
        sx={{
          display: "none",
          "@container (min-width: 800px)": {
            display: "block",
          },
        }}
      >
        <BarRoot
          query={query}
          height={height ?? SIZE_CONFIGS.large.height}
          width={width ?? SIZE_CONFIGS.large.width}
          padding={padding}
          tickCount={tickCount}
          minValue={minValue}
          maxValue={maxValue}
          scaleType={scaleType}
          layout={layout}
        >
          {children}
        </BarRoot>
      </div>
    </div>
  );
}

interface XAxisGridProps {
  stroke?: Property.Stroke;
  strokeWidth?: number;
  strokeDasharray?: string;
}
/**
 * Vertical grid lines drawn at each x-axis tick of a {@link BarChart}.
 * Use {@link BarChart.CartesianGrid} for the standard horizontal +
 * vertical pair; reach for this sub-component only when you need the
 * vertical lines alone.
 */
BarChart.XAxisGrid = (props: XAxisGridProps) => {
  const ctx = useICtx(BarRootICtxKey);
  const {
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    height,
    width,
    layout,
  } = ctx;
  if (layout === "horizontal") {
    return (ctx.yAxis?.length ?? 0) > 0
      ? (
        <Each table="ticks" recordName="tick">
          <line
            x1={sql`tick.x`}
            y1={paddingTop}
            x2={sql`tick.x`}
            y2={height - paddingBottom}
            stroke={props.stroke ?? cssVar("palette-neutral-200")}
            strokeWidth={props.strokeWidth ?? 1}
            strokeDasharray={props.strokeDasharray ?? "none"}
          />
        </Each>
      )
      : null;
  }
  return (
    <>
      <Each table="chart_data" recordName="row">
        <line
          x1={sql`${paddingLeft}::Double + row.index::Double * group_width::Double + group_width::Double / 2::Double`}
          y1={paddingTop}
          x2={sql`${paddingLeft}::Double + row.index::Double * group_width::Double + group_width::Double / 2::Double`}
          y2={height - paddingBottom}
          stroke={props.stroke ?? cssVar("palette-neutral-200")}
          strokeWidth={props.strokeWidth ?? 1}
          strokeDasharray={props.strokeDasharray ?? "none"}
        />
      </Each>
      <line
        x1={width - paddingRight}
        y1={paddingTop}
        x2={width - paddingRight}
        y2={height - paddingBottom}
        stroke={props.stroke ?? cssVar("palette-neutral-200")}
        strokeWidth={props.strokeWidth ?? 1}
        strokeDasharray={props.strokeDasharray ?? "none"}
      />
    </>
  );
};

interface YAxisGridProps {
  stroke?: Property.Stroke;
  strokeWidth?: number;
  strokeDasharray?: string;
}
/**
 * Horizontal grid lines drawn at each y-axis tick of a {@link BarChart}.
 * Use {@link BarChart.CartesianGrid} for the standard horizontal +
 * vertical pair; reach for this sub-component only when you need the
 * horizontal lines alone.
 */
BarChart.YAxisGrid = (props: YAxisGridProps) => {
  const ctx = useICtx(BarRootICtxKey);
  const { paddingTop, paddingRight, paddingLeft, width, layout } = ctx;
  if (layout === "horizontal") {
    return (
      <Each table="chart_data" recordName="row">
        <line
          x1={paddingLeft}
          y1={sql`${paddingTop}::Double + row.index::Double * group_width::Double + group_width::Double / 2::Double`}
          x2={width - paddingRight}
          y2={sql`${paddingTop}::Double + row.index::Double * group_width::Double + group_width::Double / 2::Double`}
          stroke={props.stroke ?? cssVar("palette-neutral-200")}
          strokeWidth={props.strokeWidth ?? 1}
          strokeDasharray={props.strokeDasharray ?? "none"}
        />
      </Each>
    );
  }
  return (ctx.yAxis?.length ?? 0) > 0
    ? (
      <Each table="ticks" recordName="tick">
        <line
          x1={paddingLeft}
          y1={sql`tick.y`}
          x2={width - paddingRight}
          y2={sql`tick.y`}
          stroke={props.stroke ?? cssVar("palette-neutral-200")}
          strokeWidth={props.strokeWidth ?? 1}
          strokeDasharray={props.strokeDasharray ?? "none"}
        />
      </Each>
    )
    : null;
};

interface CartesianGridProps {
  stroke?: Property.Stroke;
  strokeWidth?: number;
  strokeDasharray?: string;
}
/**
 CartesianGrid component for BarChartNew that renders both horizontal and vertical gridlines.

 The component combines XAxisGrid and YAxisGrid to create a full cartesian grid system.
 It passes through styling props to both grid components for consistent appearance.

 Optional props:
 - stroke: Color of the grid lines (default: neutral-200 from theme)
 - strokeWidth: Width of the grid lines (default: 1)
 - strokeDasharray: Dash pattern for grid lines (default: "none")

 Requires BarRootICtx context with:
 - padding: Padding around chart area
 - height: Total height of chart
 - width: Total width of chart
 */
BarChart.CartesianGrid = (props: CartesianGridProps) => {
  return (
    <g>
      <BarChart.XAxisGrid
        stroke={props.stroke}
        strokeWidth={props.strokeWidth}
        strokeDasharray={props.strokeDasharray}
      />
      <BarChart.YAxisGrid
        stroke={props.stroke}
        strokeWidth={props.strokeWidth}
        strokeDasharray={props.strokeDasharray}
      />
    </g>
  );
};

interface XAxisProps {
  stroke?: Property.Stroke;
  strokeWidth?: number;
}
/**
 XAxis component for BarChartNew that renders the horizontal axis line.

 The component draws a horizontal line along the x-axis of the chart.
 It positions the line at the bottom of the chart area, accounting for padding.

 Required context from BarRootICtx:
 - padding: Padding around chart area
 - height: Total height of chart
 - width: Total width of chart

 Optional props:
 - stroke: Color of the axis line (default: neutral-200 from theme)
 - strokeWidth: Width of the axis line (default: 2)
 */
BarChart.XAxis = (props: XAxisProps) => {
  const ctx = useICtx(BarRootICtxKey);
  const { paddingLeft, paddingRight, paddingBottom, height, width } = ctx;
  return (
    <g>
      <line
        x1={paddingLeft}
        y1={height - paddingBottom}
        x2={width - paddingRight}
        y2={height - paddingBottom}
        stroke={props.stroke ?? cssVar("palette-neutral-200")}
        strokeWidth={props.strokeWidth ?? 2}
      />
    </g>
  );
};

interface YAxisProps {
  stroke?: Property.Stroke;
  strokeWidth?: number;
}
/**
 YAxis component for BarChartNew that renders the vertical axis line.

 The component draws a vertical line along the y-axis of the chart.
 It positions the line at the left edge of the chart area, accounting for padding.

 Required context from BarRootICtx:
 - padding: Padding around chart area
 - height: Total height of chart

 Optional props:
 - stroke: Color of the axis line (default: neutral-200 from theme)
 - strokeWidth: Width of the axis line (default: 2)
 */
BarChart.YAxis = (props: YAxisProps) => {
  const ctx = useICtx(BarRootICtxKey);
  const { paddingTop, paddingBottom, paddingLeft, height } = ctx;
  return (
    <g>
      <line
        x1={paddingLeft}
        y1={paddingTop}
        x2={paddingLeft}
        y2={height - paddingBottom}
        stroke={props.stroke ?? cssVar("palette-neutral-200")}
        strokeWidth={props.strokeWidth ?? 2}
      />
    </g>
  );
};

interface YAxisLabelsProps {
  format?: (value: NumericExpr) => Node;
  text?: {
    fontSize?: number;
    textAnchor?: "middle" | "end" | "start";
    dominantBaseline?: "middle" | "hanging" | "auto";
    fill?: Property.Fill;
  };
}
/**
 YAxisLabels component for BarChartNew that renders labels along the y-axis.

 Required context from BarRootICtx:
 - padding: Padding around chart area
 - yAxis: Array of y-axis columns to show labels for

 Optional props:
 - format: Function to format the label values
 - text: Object to customize text appearance:
   - fontSize: Font size in pixels (default: 12)
   - textAnchor: Text anchor position (default: "end")
   - dominantBaseline: Text baseline alignment (default: "middle")
   - fill: Text color (default: "#666")

 The component:
 - Renders text labels for each tick mark on y-axis
 - Uses "ticks" table for positioning and values
 - Positions labels to left of axis with 10px offset
 - Supports custom formatting of values
 - Returns null if no y-axis columns are defined
 */
BarChart.YAxisLabels = (props: YAxisLabelsProps & { columnName?: string }) => {
  const ctx = useICtx(BarRootICtxKey);
  const { paddingTop, paddingLeft, layout } = ctx;
  if (layout === "horizontal") {
    // In horizontal mode the y-axis holds categories; label each row's slot.
    const { columnName } = props;
    if (usePhase() === "gather" && columnName) {
      ctx.setXAxis(columnName);
    }
    return (
      <g>
        <Each table="chart_data" recordName="row">
          <text
            x={paddingLeft - 10}
            y={sql`${paddingTop}::Double + row.index::Double * group_width::Double + group_width::Double / 2::Double`}
            textAnchor={props.text?.textAnchor ?? "end"}
            dominantBaseline={props.text?.dominantBaseline ?? "middle"}
            fontSize={props.text?.fontSize ?? "12"}
            fill={props.text?.fill ?? "#666"}
          >
            {columnName
              ? (props.format
                ? props.format(sql`row.${sql.ref(columnName)}`)
                : sql`row.${sql.ref(columnName)}`)
              : (props.format ? props.format(sql`row.index`) : sql`row.index`)}
          </text>
        </Each>
      </g>
    );
  }
  return (ctx.yAxis?.length ?? 0) > 0
    ? (
      <g>
        <Each table="ticks" recordName="tick">
          <text
            x={paddingLeft - 10}
            y={sql`tick.y`}
            textAnchor={props.text?.textAnchor ?? "end"}
            dominantBaseline={props.text?.dominantBaseline ?? "middle"}
            fontSize={props.text?.fontSize ?? "12"}
            fill={props.text?.fill ?? "#666"}
          >
            {props.format ? props.format(sql`tick.value`) : sql`tick.value`}
          </text>
        </Each>
      </g>
    )
    : null;
};

interface XAxisLabelsProps {
  columnName?: string;
  format?: (value: NumericExpr) => Node;
  text?: {
    fontSize?: number;
    textAnchor?: "middle" | "end" | "start";
    dominantBaseline?: "middle" | "hanging" | "auto";
    fill?: Property.Fill;
    rotate?: NumericExpr;
  };
}

/**
 XAxisLabels component for BarChartNew that renders labels along the x-axis.

 Required context from BarRootICtx:
 - padding: Padding around chart area
 - height: Total height of chart

 Optional props:
 - columnName: The column name from data to use for labels (default: uses row index)
 - format: Function to format the label values
 - text: Object to customize text appearance:
   - fontSize: Font size in pixels (default: 12)
   - textAnchor: Text anchor position (default: "middle")
   - dominantBaseline: Text baseline alignment (default: "middle")
   - fill: Text color (default: "#666")

 The component:
 - Registers the x-axis column during gather phase
 - Renders text labels for each data point
 - Positions labels below bars using chart_data table
 - Centers labels under each bar group
 - Supports custom formatting of label values
 */
BarChart.XAxisLabels = (props: XAxisLabelsProps) => {
  const { columnName, format, text } = props;
  const ctx = useICtx(BarRootICtxKey);
  const { paddingBottom, paddingLeft, height, layout } = ctx;
  if (usePhase() === "gather") {
    ctx.setXAxis(columnName ?? "index");
  }
  const y = height - paddingBottom + 20;
  if (layout === "horizontal") {
    // In horizontal mode the x-axis holds value ticks (not categories).
    return (
      <g>
        <Each table="ticks" recordName="tick">
          <text
            x={sql`tick.x`}
            y={y}
            textAnchor={text?.textAnchor ?? "middle"}
            dominantBaseline={text?.dominantBaseline ?? "middle"}
            fontSize={text?.fontSize ?? "12"}
            fill={text?.fill ?? "#666"}
          >
            {format ? format(sql`tick.value`) : sql`tick.value`}
          </text>
        </Each>
      </g>
    );
  }
  const textProps = text?.rotate
    ? {
      transform: sql
        .concatTemplate`translate(${sql`${paddingLeft}::double + row.index::double * group_width::double + group_width::double / 4::double`}, ${y}) rotate(${text.rotate})`,
      textAnchor: "start",
    }
    : {
      x: sql`${paddingLeft}::double + row.index::double * group_width::double + group_width::double / 2::double`,
      y,
      textAnchor: "middle",
    };
  return (
    <g>
      <Each table="chart_data" recordName="row">
        <text
          {...textProps}
          dominantBaseline={text?.dominantBaseline ?? "middle"}
          fontSize={text?.fontSize ?? "12"}
          fill={text?.fill ?? "#666"}
        >
          {columnName
            ? format
              ? format(sql`row.${sql.ref(columnName)}`)
              : sql`row.${sql.ref(columnName)}`
            : format
            ? format(sql`row.index`)
            : sql`row.index`}
        </text>
      </Each>
    </g>
  );
};
interface BarProps {
  columnName: string;
  fill?: Property.Fill;
}
/**
 Bar component for BarChartNew that renders individual bars in the chart.

 Required props:
 - columnName: The column name from the data to plot as bar heights

 Optional props:
 - fill: Fill color for the bars (default: neutral-200 from theme)

 Required context from BarRootICtx:
 - padding: Padding around chart area

 The component:
 - Registers the column as a y-axis during gather phase
 - Renders rectangles for each data point in the column
 - Positions bars using x/y coordinates from data_points table
 - Sets bar width based on bar_width variable
 - Calculates bar height based on chart height and y position
 */
BarChart.Bar = (props: BarProps) => {
  const { columnName, fill } = props;
  const ctx = useICtx(BarRootICtxKey);
  const {
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    height,
    width,
    layout,
  } = ctx;
  if (usePhase() === "gather") {
    ctx.setYAxis(columnName);
  }
  if (layout === "horizontal") {
    return (
      <g>
        <Each table={`data_points_${columnName}`} recordName="point">
          <rect
            x={paddingLeft}
            y={sql`${paddingTop} + point.y`}
            width={sql`point.bar_w`}
            height={sql`point.bar_h`}
            fill={fill ?? cssVar("palette-neutral-200")}
          />
          {/* Invisible full-width rectangle for mouse interaction */}
          <rect
            x={paddingLeft}
            y={sql`${paddingTop} + point.y`}
            width={sql`${width} - ${paddingLeft} - ${paddingRight}`}
            height={sql`point.bar_h`}
            fill="transparent"
            onMouseMove={(s) => {
              s.setScalar("mouse_index", sql`point.iteration_index`);
            }}
          />
        </Each>
      </g>
    );
  }
  return (
    <g>
      <Each table={`data_points_${columnName}`} recordName="point">
        <rect
          x={sql`${paddingLeft} + point.x`}
          y={sql`${paddingTop} + point.y`}
          width={sql`bar_width`}
          height={sql`chart_height::Double - point.y::Double`}
          fill={fill ?? cssVar("palette-neutral-200")}
        />
        {/* Invisible full-height rectangle for mouse interaction */}
        <rect
          x={sql`${paddingLeft} + point.x`}
          y={paddingTop}
          width={sql`bar_width`}
          height={sql`${height} - ${paddingTop} - ${paddingBottom}`}
          fill="transparent"
          onMouseMove={(s) => {
            s.setScalar("mouse_index", sql`point.iteration_index`);
          }}
        />
      </Each>
    </g>
  );
};
interface TooltipProps {
  sx?: Style;
  /**
   * Override the tooltip body. Receives the x-axis column name, the list of
   * y-axis column names, and the SQL record alias for the hovered row.
   */
  renderContent?: (
    xAxis: string,
    yAxes: string[],
    recordName: Sql,
  ) => Node;
}
const defaultTooltipContent = (
  xAxis: string,
  yAxes: string[],
  recordName: Sql,
) => (
  <>
    <span>{sql`${recordName}.${sql.ref(xAxis)}`}</span>
    {yAxes?.map((yAxis) => (
      <div>
        <span>{yAxis}</span>-<text>{sql`${recordName}.${sql.ref(yAxis)}`}</text>
      </div>
    ))}
  </>
);
/**
 Tooltip component for BarChartNew that displays data values on hover.

 The component shows a vertical guide line and tooltip box when hovering over bars.
 It tracks the mouse position and displays the corresponding data values.

 Required context from BarRootICtx:
 - padding: Padding around chart area
 - height: Total height of chart
 - width: Total width of chart
 - xAxis: Name of x-axis column (defaults to "index")
 - yAxis: Array of y-axis column names

 Optional props:
 - sx: Additional styles for tooltip box
 - renderContent: Custom function to render tooltip content
   Args: (xAxis: string, yAxes: string[], recordName: Sql)

 The component:
 - Shows/hides based on popover_open state
 - Draws dashed vertical guide line at mouse position
 - Positions tooltip box based on mouse coordinates
 - Uses default or custom content renderer
 - Watches mouse_index to update displayed data
 */
BarChart.Tooltip = (props: TooltipProps) => {
  const ctx = useICtx(BarRootICtxKey);
  const {
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    height,
    width,
    xAxis = "index",
    layout,
  } = ctx;
  const categoryOrigin = layout === "horizontal" ? paddingTop : paddingLeft;
  const categoryCenter =
    sql`${categoryOrigin}::Double + mouse_index::Double * group_width::Double + group_width::Double / 2::Double`;
  return (
    <Data
      local
      watch={[sql`mouse_index`]}
      procedure={(s) => {
        s.defRecord(
          "series",
          sql`(select * from chart_data where index = mouse_index)`,
        );
      }}
    >
      <Show when={sql`popover_open`}>
        {layout === "horizontal"
          ? (
            <line
              x1={paddingLeft}
              y1={categoryCenter}
              x2={width - paddingRight}
              y2={categoryCenter}
              stroke={cssVar("palette-neutral-200")}
              strokeWidth={1}
              strokeDasharray="5 5"
            />
          )
          : (
            <line
              x1={categoryCenter}
              y1={paddingTop}
              x2={categoryCenter}
              y2={height - paddingBottom}
              stroke={cssVar("palette-neutral-200")}
              strokeWidth={1}
              strokeDasharray="5 5"
            />
          )}
        <foreignObject
          width={width}
          height={height}
          className="pointer-events-none"
        >
          <div
            sx={{
              padding: "10px",
              border: "1px solid",
              borderColor: cssVar("palette-neutral-300"),
              borderRadius: "lg",
              backgroundColor: cssVar("palette-neutral-100"),
              position: "fixed",
              pointerEvents: "none",
              ...props.sx,
            }}
            style={{
              top: sql.concat(sql`tool_tip_y`, "px"),
              left: sql.concat(
                sql`case when tool_tip_x < ${
                  width / 2
                } then tool_tip_x + 65 else tool_tip_x - 60 end`,
                "px",
              ),
              transition: "top 0.2s ease, left 0.2s ease",
            }}
          >
            {props.renderContent?.(xAxis, ctx.yAxis ?? [], sql`series`) ??
              defaultTooltipContent(xAxis, ctx.yAxis ?? [], sql`series`)}
          </div>
        </foreignObject>
      </Show>
    </Data>
  );
};
