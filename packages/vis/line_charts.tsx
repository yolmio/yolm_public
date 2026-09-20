import type { Property } from "csstype";
import { VisRootICtxKey } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { NumericExpr, Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { cssVar } from "std/style_utils";
import { Data } from "std/data";
import { Each, Show, useICtx, usePhase, useSourceMap } from "std/ui";
import type { Node } from "std/ui";
import { VisRoot, xScale } from "./utils_line_charts";

interface LineChartProps {
  children: Node;
  height?: number;
  width?: number;
  query: Sql;
  padding?: number;
  scaleType?: "linear" | "logarithmic";
  tickCount?: number;
  minValue?: number;
  maxValue?: number;
  sx?: Style;
  className?: string;
}
const SIZE_CONFIGS = {
  small: {
    width: 400,
    height: 250,
    padding: 30,
    tickCount: 4,
  },
  medium: {
    width: 600,
    height: 350,
    padding: 45,
    tickCount: 5,
  },
  large: {
    width: 800,
    height: 450,
    padding: 60,
    tickCount: 6,
  },
} as const;

// multiple lines
// tooltips
// have static min/max and tick count instead inferring from data

/**
 LineChartNew is the root component for creating line charts.

 Required props:
 - height: Total height of the chart in pixels
 - width: Total width of the chart in pixels
 - query: SQL query that returns the data to plot
 - children: Child components like XAxisLabels, YAxisLabels,CartesianGrid, lines, tooltips etc.

 Optional props:
 - padding: Padding around the chart area (default: 40)
 - scaleType: Type of y-axis scale - "linear" or "logarithmic" (default: "linear")
 - tickCount: Number of ticks to show on y-axis (default: inferred from data)
 - minValue: Minimum value for y-axis (default: inferred from data)
 - maxValue: Maximum value for y-axis (default: inferred from data)

 The component:
 - Wraps chart content in VisRoot which provides context and data
 - Handles chart dimensions and scaling
 - Supports multiple lines, tooltips and customizable axes

 @category Visualization
 @example
 [Example](../../examples/northwind/apps/northwind.yolmstaging.net.tsx)
 */
export function LineChart(props: LineChartProps) {
  const {
    children,
    height,
    width,
    query,
    padding,
    scaleType,
    tickCount,
    minValue,
    maxValue,
    sx,
    className,
  } = props;
  useSourceMap("LineChart");
  if (width && height) {
    return (
      <VisRoot
        query={query}
        width={width}
        height={height}
        padding={padding}
        scaleType={scaleType}
        tickCount={tickCount}
        minValue={minValue}
        maxValue={maxValue}
        sx={sx}
        className={className}
      >
        {children}
      </VisRoot>
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
        <VisRoot
          query={query}
          width={SIZE_CONFIGS.small.width}
          height={SIZE_CONFIGS.small.height}
          padding={padding ?? SIZE_CONFIGS.small.padding}
          scaleType={scaleType}
          tickCount={tickCount ?? SIZE_CONFIGS.small.tickCount}
          minValue={minValue}
          maxValue={maxValue}
        >
          {children}
        </VisRoot>
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
        <VisRoot
          query={query}
          width={SIZE_CONFIGS.medium.width}
          height={SIZE_CONFIGS.medium.height}
          padding={padding ?? SIZE_CONFIGS.medium.padding}
          scaleType={scaleType}
          tickCount={tickCount ?? SIZE_CONFIGS.medium.tickCount}
          minValue={minValue}
          maxValue={maxValue}
        >
          {children}
        </VisRoot>
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
        <VisRoot
          query={query}
          width={SIZE_CONFIGS.large.width}
          height={SIZE_CONFIGS.large.height}
          padding={padding ?? SIZE_CONFIGS.large.padding}
          scaleType={scaleType}
          tickCount={tickCount ?? SIZE_CONFIGS.large.tickCount}
          minValue={minValue}
          maxValue={maxValue}
        >
          {children}
        </VisRoot>
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
 * Vertical grid lines drawn at each x-axis data point of a {@link LineChart}.
 * Use {@link LineChart.CartesianGrid} for the standard horizontal + vertical
 * pair; reach for this only when you need the vertical lines alone.
 */
LineChart.XAxisGrid = (props: XAxisGridProps) => {
  const ctx = useICtx(VisRootICtxKey);
  const { padding, height, width } = ctx;
  return (
    <Each table="chart_data" recordName="row">
      <line
        x1={xScale({
          padding,
          value: sql`row.index`,
          width,
          dataLength: sql`chart_data_row_count`,
        })}
        y1={padding}
        x2={xScale({
          padding,
          value: sql`row.index`,
          width,
          dataLength: sql`chart_data_row_count`,
        })}
        y2={height - padding}
        stroke={props.stroke ?? cssVar("palette-neutral-200")}
        strokeWidth={props.strokeWidth ?? 1}
        strokeDasharray={props.strokeDasharray ?? "none"}
      />
    </Each>
  );
};

interface YAxisGridProps {
  stroke?: Property.Stroke;
  strokeWidth?: number;
  strokeDasharray?: string;
}
/**
 * Horizontal grid lines drawn at each y-axis tick of a {@link LineChart}.
 * Use {@link LineChart.CartesianGrid} for the standard horizontal + vertical
 * pair; reach for this only when you need the horizontal lines alone.
 */
LineChart.YAxisGrid = (props: YAxisGridProps) => {
  const ctx = useICtx(VisRootICtxKey);
  const { padding, width } = ctx;
  return (ctx.yAxis?.length ?? 0) > 0
    ? (
      <Each table="ticks" recordName="tick">
        <line
          x1={padding}
          y1={sql`tick.y`}
          x2={width - padding}
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
 CartesianGrid component for LineChartNew that renders both horizontal and vertical grid lines.

 The component combines XAxisGrid and YAxisGrid to create a full grid pattern.
 It passes through styling props to both grid components to maintain consistent appearance.

 Optional props:
 - stroke: Color of the grid lines (default: neutral-200 from theme)
 - strokeWidth: Width of the grid lines (default: 1)
 - strokeDasharray: Dash pattern for grid lines (default: none)

 Requires VisRootICtx context with:
 - padding: Padding around chart area
 - height: Total height of chart
 - width: Total width of chart
 - yAxis: Array of y-axis configurations (for YAxisGrid)
 */
LineChart.CartesianGrid = (props: CartesianGridProps) => {
  return (
    <g>
      <LineChart.XAxisGrid
        stroke={props.stroke}
        strokeWidth={props.strokeWidth}
        strokeDasharray={props.strokeDasharray}
      />
      <LineChart.YAxisGrid
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
 XAxis component for LineChartNew that renders the horizontal axis line.

 The component draws a horizontal line along the x-axis of the chart.
 It positions the line at the bottom of the chart area, accounting for padding.

 Optional props:
 - stroke: Color of the axis line (default: neutral-200 from theme)
 - strokeWidth: Width of the axis line (default: 2)

 Requires VisRootICtx context with:
 - padding: Padding around chart area
 - height: Total height of chart
 - width: Total width of chart
 */
LineChart.XAxis = (props: XAxisProps) => {
  const ctx = useICtx(VisRootICtxKey);
  const { padding, height, width } = ctx;
  return (
    <g>
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
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
 YAxis component for LineChartNew that renders the vertical axis line.

 The component draws a vertical line along the y-axis of the chart.
 It positions the line at the left edge of the chart area, accounting for padding.

 Optional props:
 - stroke: Color of the axis line (default: neutral-200 from theme)
 - strokeWidth: Width of the axis line (default: 2)

 Requires VisRootICtx context with:
 - padding: Padding around chart area
 - height: Total height of chart
 */
LineChart.YAxis = (props: YAxisProps) => {
  const ctx = useICtx(VisRootICtxKey);
  const { padding, height } = ctx;
  return (
    <g>
      <line
        x1={padding}
        y1={padding}
        x2={padding}
        y2={height - padding}
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
    sx?: Style;
  };
}
/**
 YAxisLabels component for LineChartNew that renders labels along the y-axis.

 The component renders text labels for each tick mark along the y-axis of the chart.
 It positions labels slightly to the left of the y-axis line and uses values from
 the "ticks" table for positioning and label content.

 Optional props:
 - format?: Function to format the label values before display
 - text?: Configuration for label text styling
   - fontSize: Font size of labels (default: 12)
   - textAnchor: Text anchor position (default: "end")
   - dominantBaseline: Text baseline alignment (default: "middle")
   - fill: Text color (default: "#666")
 */
LineChart.YAxisLabels = (props: YAxisLabelsProps) => {
  const ctx = useICtx(VisRootICtxKey);
  const { padding } = ctx;
  return (ctx.yAxis?.length ?? 0) > 0
    ? (
      <g>
        <Each table="ticks" recordName="tick">
          <text
            x={padding - 10}
            y={sql`tick.y`}
            textAnchor={props.text?.textAnchor ?? "end"}
            dominantBaseline={props.text?.dominantBaseline ?? "middle"}
            fontSize={props.text?.fontSize ?? "12"}
            fill={props.text?.fill ?? "#666"}
            sx={props.text?.sx}
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
    sx?: Style;
  };
}

/**
 XAxisLabels component for LineChartNew that renders labels along the x-axis.

 Optional props:
 - columnName?: Optional name of the column to use for label values. If not provided, uses row index.
 - format?: Optional function to format the label values before display
 - text?: Optional configuration for label text styling
   - fontSize: Font size of labels (default: 12)
   - textAnchor: Text anchor position (default: "middle")
   - dominantBaseline: Text baseline alignment (default: "middle")
   - fill: Text color (default: "#666")

 The component:
 - Renders text labels for each data point along x-axis
 - Uses either a specified column value or row index for labels
 - Supports custom formatting of label values
 - Positions labels evenly based on chart width and padding
 - Allows customization of text appearance
 - Sets up x-axis configuration during gather phase
 */
LineChart.XAxisLabels = (props: XAxisLabelsProps) => {
  const { columnName, format, text } = props;
  const ctx = useICtx(VisRootICtxKey);
  const { padding, height, width } = ctx;
  if (usePhase() === "gather") {
    ctx.setXAxis(columnName ?? "index");
  }
  return (
    <g>
      <Each table="chart_data" recordName="row">
        <text
          x={xScale({
            padding,
            value: sql`row.index`,
            width,
            dataLength: sql`chart_data_row_count`,
          })}
          y={height - padding + 20}
          textAnchor={text?.textAnchor ?? "middle"}
          dominantBaseline={text?.dominantBaseline ?? "middle"}
          fontSize={text?.fontSize ?? "12"}
          fill={text?.fill ?? "#666"}
          sx={text?.sx}
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

interface ToolTipContentProps {
  xAxis: string;
  yAxes: string[];
  recordName: Sql;
  xValue: Sql;
  yValues: Sql[];
}

interface TooltipProps {
  sx?: Style;
  renderContent?: (props: ToolTipContentProps) => Node;
  activeDot?: {
    fill: Property.Fill;
    r: number;
  };
}

const defaultTooltipContent = (props: ToolTipContentProps) => (
  <>
    <span>{sql`${props.recordName}.${sql.ref(props.xAxis)}`}</span>
    {props.yAxes?.map((yAxis) => (
      <div>
        <span>{yAxis}</span>-
        <text>{sql`${props.recordName}.${sql.ref(yAxis)}`}</text>
      </div>
    ))}
  </>
);

/**
 Tooltip component for LineChartNew that displays data values on hover.

 Optional props:
 - sx?: Optional styles to apply to the tooltip container
 - renderContent?: Optional custom render function for tooltip content
   Takes (xAxis: string, yAxes: string[], recordName: Sql) as arguments
 - activeDot?: Optional configuration for the dot shown at the hovered point
   - fill: Fill color of the dot
   - r: Radius of the dot

 The component:
 - Shows a tooltip when hovering over the chart
 - Displays a vertical guide line at the hover position
 - Shows an optional dot at the data point
 - Renders either custom content or default content showing x and y values
 - Positions the tooltip intelligently based on chart width
 - Updates when mouse_index changes to show current point data
 */
LineChart.Tooltip = (props: TooltipProps) => {
  const { activeDot } = props;
  const ctx = useICtx(VisRootICtxKey);
  const { padding, height, width, xAxis = "index" } = ctx;
  const renderContentProps = {
    xAxis,
    yAxes: ctx.yAxis ?? [],
    recordName: sql`series`,
    xValue: sql`series.${sql.ref(xAxis)}`,
    yValues: ctx.yAxis?.map((yAxis) => sql`series.${sql.ref(yAxis)}`) ?? [],
  };
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
        {activeDot && (
          <circle
            cx={sql`tool_tip_x`}
            cy={sql`tool_tip_y`}
            r={activeDot.r}
            fill={activeDot.fill}
          />
        )}
        <line
          x1={sql`tool_tip_x`}
          y1={padding}
          x2={sql`tool_tip_x`}
          y2={height - padding}
          stroke={cssVar("palette-neutral-200")}
          strokeWidth={1}
          strokeDasharray="5 5"
        />
        <foreignObject
          width={width}
          height={height}
          className="pointer-events-none"
        >
          <div
            sx={{
              padding: "12px",
              border: "1px solid",
              borderColor: cssVar("palette-neutral-300"),
              borderRadius: "lg",
              backgroundColor: cssVar("palette-background-surface"),
              boxShadow: "sm",
              backdropFilter: "blur(8px)",
              pointerEvents: "none",
              fontSize: "sm",
              color: cssVar("palette-text-primary"),
              transform: "translateY(-50%)",
              transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
              "&:hover": {
                boxShadow: "md",
              },
              ...props.sx,
            }}
            style={{
              position: "fixed",
              top: sql.concat(sql`tool_tip_y -15`, "px"),
              left: sql.concat(
                sql`case when tool_tip_x < ${
                  width / 2
                } then tool_tip_x + 5 else tool_tip_x - 120 end`,
                "px",
              ),
              transition: "top 0.2s ease, left 0.2s ease",
            }}
          >
            {props.renderContent?.(renderContentProps) ??
              defaultTooltipContent(renderContentProps)}
          </div>
        </foreignObject>
      </Show>
    </Data>
  );
};

interface LineProps {
  column: string;
  stroke: Property.Stroke;
  strokeWidth: number;
  showLabels?: {
    fontSize: number;
    textAnchor: "middle" | "end" | "start";
    offset: number;
    format?: (value: NumericExpr) => Node;
  };
  activeDot?: {
    fill: Property.Fill;
    r: number;
  };
}
/**
 Line component renders a single line series in a line chart.

 Required props:
 - column: The column name from the data to plot on the y-axis
 - stroke: The color of the line
 - strokeWidth: The width of the line

 Optional props:
 - showLabels: Configuration for displaying labels at each data point
   - fontSize: Size of the label text
   - textAnchor: Alignment of the label text ("middle", "end", or "start")
   - offset: Vertical offset of labels from the data points
 - activeDot: Configuration for dots at each data point
   - fill: Fill color of the dots
   - r: Radius of the dots

 The component:
 - Draws a continuous line through all data points
 - Optionally shows labels at each point
 - Optionally shows dots at each point
 - Registers the column with the chart context during gather phase
 */
LineChart.Line = (props: LineProps) => {
  const { column, stroke, strokeWidth, showLabels, activeDot } = props;
  if (usePhase() === "gather") {
    const ctx = useICtx(VisRootICtxKey);
    ctx.setYAxis(column);
  }
  return (
    <g>
      <path
        sx={{
          fill: "none",
          stroke: stroke ?? cssVar("palette-primary-500"),
          strokeWidth: strokeWidth ?? 2,
        }}
        d={sql`(
          select string_agg(
            case
              when index = 0 then concat('M ', x::text, ' ', y::text)
              else concat('L ', x::text, ' ', y::text)
            end,
            ' '
            order by index
          )
          from data_points_${sql.ref(column)}
        )`}
      />
      {showLabels && (
        <g>
          <Each table={`data_points_${column}`} recordName="row">
            <text
              x={sql`row.x`}
              y={sql`row.y - ${showLabels.offset}::Double`}
              textAnchor={showLabels.textAnchor}
              fontSize={showLabels.fontSize}
            >
              {showLabels.format
                ? showLabels.format(sql`row.${sql.ref(column)}`)
                : sql`row.${sql.ref(column)}`}
            </text>
          </Each>
        </g>
      )}
      {activeDot && (
        <g>
          <Each table={`data_points_${column}`} recordName="row">
            <circle
              cx={sql`row.x`}
              cy={sql`row.y`}
              r={activeDot.r}
              fill={activeDot.fill}
            />
          </Each>
        </g>
      )}
    </g>
  );
};

/** Props for {@link LineChart.DistinctValueLines}. */
export interface LineChartValueLinesProps {
  /** Data column to plot on the y-axis. */
  column: string;
  /** When set, draws a value label at each point; `offset` lifts it above the point. */
  showLabels?: {
    fontSize: number;
    textAnchor: "middle" | "end" | "start";
    offset: number;
    sx?: Style;
  };
  sx?: Style;
  /** When set, draws a dot at each data point. */
  activeDot?: {
    fill: Property.Fill;
    r: number;
  };
}

/**
 DistinctValueLines component renders lines between data points in a line chart with different styles based on value changes.

 Required props:
 - column: The column name from the data to plot on the y-axis

 Optional props:
 - showLabels: Configuration for displaying labels at each data point
   - fontSize: Size of the label text
   - textAnchor: Alignment of the label text ("middle", "end", or "start")
   - offset: Vertical offset of labels from the data points
 - sx: Custom styles to apply to the lines container
 - activeDot: Configuration for dots at each data point
   - fill: Fill color of the dots
   - r: Radius of the dots

 The component:
 - Draws lines between consecutive data points
 - Applies "upLine" class when values increase
 - Applies "downLine" class when values decrease
 - Optionally shows labels at each point
 - Optionally shows dots at each point
 */
LineChart.DistinctValueLines = (props: LineChartValueLinesProps) => {
  const { column, showLabels, sx, activeDot } = props;
  if (usePhase() === "gather") {
    const ctx = useICtx(VisRootICtxKey);
    ctx.setYAxis(column);
  }
  return (
    <>
      <g sx={sx}>
        <Each
          table={`data_point_pairs_${column}`}
          recordName="data_points_record"
        >
          <line
            x1={sql`data_points_record.rec1_x`}
            y1={sql`data_points_record.rec1_y`}
            x2={sql`data_points_record.rec2_x`}
            y2={sql`data_points_record.rec2_y`}
            dynamicClasses={[
              {
                condition:
                  sql`data_points_record.rec1_y < data_points_record.rec2_y`,
                classes: "downLine",
              },
              {
                condition:
                  sql`data_points_record.rec1_y > data_points_record.rec2_y`,
                classes: "upLine",
              },
            ]}
          />
        </Each>
      </g>
      {showLabels && (
        <g>
          <Each table={`data_points_${column}`} recordName="row">
            <text
              x={sql`row.x`}
              y={sql`row.y - ${showLabels.offset}::Double`}
              textAnchor={showLabels.textAnchor}
              fontSize={showLabels.fontSize}
              sx={showLabels.sx}
            >
              {sql`row.${sql.ref(column)}`}
            </text>
          </Each>
        </g>
      )}
      {activeDot && (
        <g>
          <Each table={`data_points_${column}`} recordName="row">
            <circle
              cx={sql`row.x`}
              cy={sql`row.y`}
              r={activeDot.r}
              fill={activeDot.fill}
            />
          </Each>
        </g>
      )}
    </>
  );
};
