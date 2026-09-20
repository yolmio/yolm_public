import { PieRootICtxKey } from "std/ictx";
import type { SVGTags } from "std/jsx-dev-runtime";
import { sql } from "../std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { cssVar } from "std/style_utils";
import { Data } from "std/data";
import {
  Each,
  Match,
  Show,
  Switch,
  useICtx,
  usePhase,
  useSourceMap,
} from "std/ui";
import type { Node } from "std/ui";
import { PieChartRoot } from "./utils_pie_charts";

interface PieChart {
  children: Node;
  size?: number;
  query: Sql;
  sx?: Style;
  className?: string;
}

const SIZE_CONFIGS = {
  small: {
    size: 300,
  },
  medium: {
    size: 400,
  },
  large: {
    size: 500,
  },
} as const;

/**
 PieChart is the root component for creating pie charts.

 Required props:
 - query: SQL query that returns the data to plot
 - children: Child components like segments, tooltips, legends etc.

 Optional props:
 - size: Total size (width/height) of the chart in pixels (uses responsive sizing if not provided)
 - sx: Additional styles for the chart container
 - className: CSS class name for the chart container

 The component:
 - Wraps chart content in PieChartRoot which provides context and data
 - Handles chart dimensions and scaling
 - Supports responsive sizing with container queries when size prop is not provided
 - Supports pie segments, tooltips and other customizable elements
 - Pie chart visualization is best for 5 - 10 row max for better visualization
 @category Visualization
 @example
 [Example](../../examples/northwind/apps/northwind.yolmstaging.net.tsx)
 */
export function PieChart(props: PieChart) {
  const { children, size, query, sx, className } = props;
  useSourceMap("PieChart");

  // If size is explicitly provided, use it directly
  if (size) {
    return (
      <PieChartRoot query={query} size={size} sx={sx} className={className}>
        {children}
      </PieChartRoot>
    );
  }

  // Otherwise use responsive sizing with container queries
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
        <PieChartRoot
          query={query}
          size={size ?? SIZE_CONFIGS.small.size}
        >
          {children}
        </PieChartRoot>
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
        <PieChartRoot
          query={query}
          size={size ?? SIZE_CONFIGS.medium.size}
        >
          {children}
        </PieChartRoot>
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
        <PieChartRoot
          query={query}
          size={size ?? SIZE_CONFIGS.large.size}
        >
          {children}
        </PieChartRoot>
      </div>
    </div>
  );
}

function defaultTooltipContent(value: Sql, columnName: string) {
  return (
    <>
      <span>{columnName}:</span>
      <span>{value}</span>
    </>
  );
}

interface PieTooltipProps {
  sx?: Style;
  renderTooltipContent?: (value: Sql, recordName: AnyExpr) => Node;
  /**
   * Radial distance from chart center where the tooltip anchor sits.
   * Defaults to size/3. Smaller values pull the tooltip inward toward the
   * pie, which helps keep it inside the card on narrow layouts.
   */
  distanceFromCenter?: number;
}

/**
 PieChartNew.Tooltip component renders a tooltip/popover for pie chart segments.

 The tooltip appears when hovering over pie segments and shows the value for that segment.
 It positions itself dynamically around the pie chart based on the segment's angle.

 Optional props:
 - sx: Custom styles to apply to the tooltip container
 - renderTooltipContent: Custom function to render tooltip content, receives column name and record name

 The component:
 - Uses foreignObject to render HTML content in SVG
 - Dynamically positions tooltip based on segment angle
 - Shows column name and value by default
 - Supports custom content rendering
 - Handles edge cases for tooltip positioning to prevent clipping
 - Uses pointer-events:none to prevent tooltip from interfering with interactions

 Requires PieRootICtx context with:
 - size: Total size of pie chart
 - yAxis: Array of column configurations
 */
PieChart.Tooltip = (props: PieTooltipProps) => {
  const ctx = useICtx(PieRootICtxKey);
  const { size } = ctx;
  const distance = props.distanceFromCenter ?? size / 3;

  return (
    <Data
      local
      watch={[sql`popover_open`, sql`hover_segment_index`, sql`column_name`]}
      procedure={(s) => {
        s.defRecord(
          "hover_segment",
          sql`select * from chart_data where index = hover_segment_index`,
        );
      }}
    >
      <Show when={sql`popover_open`}>
        <foreignObject
          width={size}
          height={size}
          overflow="visible"
          className="pointer-events-none"
        >
          <div
            sx={{
              padding: 1,
              border: "1px solid",
              borderColor: cssVar("palette-neutral-300"),
              borderRadius: "lg",
              backgroundColor: cssVar("palette-neutral-100"),
              position: "fixed",
              pointerEvents: "none",
              ...props.sx,
            }}
            style={{
              top: sql.concat(
                sql`case
                  when sin(radians((hover_start_angle + hover_end_angle) / 2)) < -0.5
                  then ${
                  size / 2
                } + (${distance}) * sin(radians((hover_start_angle + hover_end_angle) / 2)) - 40
                  else ${
                  size / 2
                } + (${distance}) * sin(radians((hover_start_angle + hover_end_angle) / 2)) + 5
                  end`,
                "px",
              ),
              left: sql.concat(
                sql`case
                  when cos(radians((hover_start_angle + hover_end_angle) / 2)) > 0.5
                  then ${
                  size / 2
                } + (${distance}) * cos(radians((hover_start_angle + hover_end_angle) / 2)) + 5
                  when cos(radians((hover_start_angle + hover_end_angle) / 2)) < -0.5
                  then ${
                  size / 2
                } + (${distance}) * cos(radians((hover_start_angle + hover_end_angle) / 2)) - 100
                  else ${
                  size / 2
                } + (${distance}) * cos(radians((hover_start_angle + hover_end_angle) / 2)) - 50
                  end`,
                "px",
              ),
            }}
          >
            <div>
              {ctx.yAxis && (
                <Switch>
                  {ctx.yAxis.map((yAxis) => {
                    return (
                      <Match
                        when={sql`column_name = ${sql
                          .lit`${yAxis.columnName}`}`}
                      >
                        {props.renderTooltipContent?.(
                          sql`hover_segment.${sql.ref(yAxis.columnName)}`,
                          sql`hover_segment`,
                        ) ??
                          defaultTooltipContent(
                            sql`hover_segment.${sql.ref(yAxis.columnName)}`,
                            yAxis.columnName,
                          )}
                      </Match>
                    );
                  })}
                </Switch>
              )}
            </div>
          </div>
        </foreignObject>
      </Show>
    </Data>
  );
};

interface PieChartPieProps {
  columnName: string;
  fill?: string;
  path?: SVGTags["path"];
  innerRadius?: number;
  outerRadius?: number;
  labels?: {
    format?: (value: NumericExpr, recordName: AnyExpr) => Node;
    offset?: number;
    /** SVG attributes spread onto the label <text> element (e.g. fontSize, fill, fontWeight). */
    text?: SVGTags["text"];
    /** SVG attributes spread onto the leader <line> element (e.g. stroke, strokeWidth). */
    line?: SVGTags["line"];
  };
}

/**
 PieChartNew.Pie component renders a pie/donut chart segment with optional labels.

 Required props:
 - columnName: Name of the column containing values to plot

 Optional props:
 - fill: Fill color for pie segments (default: "#000")
 - innerRadius: Inner radius for donut chart effect (default: 10)
 - outerRadius: Outer radius of the pie (default: half the chart size)
 - labels: Configuration for segment labels
   - format: Function to format the label values before display

 The component:
 - Renders pie/donut segments based on data from angles_{columnName} table
 - Handles mouse interactions for tooltips/popovers
 - Can display optional labels with connecting lines
 - Supports both pie (innerRadius=0) and donut (innerRadius>0) chart styles
 - Uses SVG path elements to draw the segments
 */
PieChart.Pie = (props: PieChartPieProps) => {
  const {
    columnName,
    fill,
    innerRadius = 10,
    outerRadius,
    labels,
    path,
  } = props;
  if (usePhase() === "gather") {
    const ctx = useICtx(PieRootICtxKey);
    ctx.setYAxis(columnName, innerRadius, outerRadius ?? ctx.size / 2);
    return null;
  }
  const ctx = useICtx(PieRootICtxKey);
  return (
    <g>
      <Each table={`angles_${columnName}`} recordName="segment">
        <path
          d={sql`concat(
            'M ',
            ${ctx.size / 2} + ${
            outerRadius ?? ctx.size / 2
          } * cos(radians(segment.start_angle + 0.001)), ' ',
            ${ctx.size / 2} + ${
            outerRadius ?? ctx.size / 2
          } * sin(radians(segment.start_angle + 0.001)), ' ',
            'A ',
            ${outerRadius ?? ctx.size / 2}, ' ',
            ${outerRadius ?? ctx.size / 2}, ' ',
            '0 ',
            case when segment.end_angle - segment.start_angle > 180 then '1' else '0' end,
            ' 1 ',
            ${ctx.size / 2} + ${
            outerRadius ?? ctx.size / 2
          } * cos(radians(segment.end_angle - 0.001)), ' ',
            ${ctx.size / 2} + ${
            outerRadius ?? ctx.size / 2
          } * sin(radians(segment.end_angle - 0.001)), ' ',
            'L ',
            ${ctx.size / 2} + ${
            innerRadius ?? 0
          } * cos(radians(segment.end_angle - 0.001)), ' ',
            ${ctx.size / 2} + ${
            innerRadius ?? 0
          } * sin(radians(segment.end_angle - 0.001)), ' ',
            'A ',
            ${innerRadius ?? 0}, ' ',
            ${innerRadius ?? 0}, ' ',
            '0 ',
            case when segment.end_angle - segment.start_angle > 180 then '1' else '0' end,
            ' 0 ',
            ${ctx.size / 2} + ${
            innerRadius ?? 0
          } * cos(radians(segment.start_angle + 0.001)), ' ',
            ${ctx.size / 2} + ${
            innerRadius ?? 0
          } * sin(radians(segment.start_angle + 0.001)), ' ',
            'Z'
          )`}
          fill={fill ?? "#000"}
          stroke="white"
          strokeWidth="2"
          onMouseMove={(s) => {
            s.setScalar("hover_segment_index", sql`segment.index`);
            s.setScalar("column_name", sql.lit`${columnName}`);
            s.setScalar("hover_start_angle", sql`segment.start_angle`);
            s.setScalar("hover_end_angle", sql`segment.end_angle`);
            s.setScalar("popover_open", true);
          }}
          onMouseLeave={(s) => {
            s.setScalar("popover_open", false);
            s.setScalar("hover_segment_index", sql`null`);
            s.setScalar("column_name", sql`null`);
            s.setScalar("hover_start_angle", sql`null`);
            s.setScalar("hover_end_angle", sql`null`);
          }}
          {...path}
        />
        {labels && (
          <>
            <line
              x1={sql`${ctx.size / 2} + (${
                outerRadius ?? ctx.size / 2
              })::Double * cos(radians((segment.start_angle + segment.end_angle) / 2))`}
              y1={sql`${ctx.size / 2} + (${
                outerRadius ?? ctx.size / 2
              })::Double * sin(radians((segment.start_angle + segment.end_angle) / 2))`}
              x2={sql`${ctx.size / 2} + (${
                outerRadius ?? ctx.size / 2
              } + 35)::Double * cos(radians((segment.start_angle + segment.end_angle) / 2))`}
              y2={sql`${ctx.size / 2} + (${
                outerRadius ?? ctx.size / 2
              } + 35)::Double * sin(radians((segment.start_angle + segment.end_angle) / 2))`}
              stroke="#666"
              strokeWidth="1"
              {...labels.line}
            />
            <text
              x={sql`${ctx.size / 2} + (${outerRadius ?? ctx.size / 2} + ${
                labels.offset ?? 50
              })::Double * cos(radians((segment.start_angle + segment.end_angle) / 2))`}
              y={sql`${ctx.size / 2} + (${outerRadius ?? ctx.size / 2} + ${
                labels.offset ?? 50
              })::Double * sin(radians((segment.start_angle + segment.end_angle) / 2))`}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="12"
              fill="#666"
              {...labels.text}
            >
              {labels.format
                ? labels.format(
                  sql`segment.${sql.ref(columnName)}`,
                  sql`segment`,
                )
                : sql`segment.${sql.ref(columnName)}`}
            </text>
          </>
        )}
      </Each>
    </g>
  );
};
