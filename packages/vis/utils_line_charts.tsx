import { Alert } from "components/alert";
import { Skeleton } from "components/skeleton";
import { Data } from "std/data";
import { VisRootICtxKey } from "std/ictx";
import type { VisRootICtx } from "std/ictx";
import type { AnyExpr, NumericExpr, Sql } from "../std/sql_utils";
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
import type { Style } from "std/style_types";
import type { Node } from "std/ui";

interface LineChartProps {
  children: Node;
  height: number;
  width: number;
  query: Sql;
  padding?: number;
  scaleType?: "linear" | "logarithmic";
  tickCount?: number;
  minValue?: number;
  maxValue?: number;
  sx?: Style;
  className?: string;
}
interface XScaleProps {
  padding: NumericExpr;
  value: NumericExpr;
  width: NumericExpr;
  dataLength: NumericExpr;
}
export function xScale(props: XScaleProps) {
  const { padding, value, width, dataLength } = props;
  const scaled = sql`case
    when ${dataLength}::Double <= 1::Double then ${width}::Double / 2::Double
    else ${padding}::Double + (
      ${value}::Double * (${width}::Double - 2 * ${padding}::Double) /
      (${dataLength}::Double - 1::Double)
    )
  end`;
  return scaled;
}

interface YScaleProps {
  padding: NumericExpr;
  value: NumericExpr;
  height: NumericExpr;
  minValue: NumericExpr;
  maxValue: NumericExpr;
  scaleType: "linear" | "logarithmic";
}
function yScale(props: YScaleProps) {
  const { padding, value, height, minValue, maxValue, scaleType } = props;
  let scaled: AnyExpr;
  if (scaleType === "linear") {
    scaled = sql`case
      when ${maxValue}::Double = ${minValue}::Double then ${height}::Double / 2::Double
      else ${height}::Double - ${padding}::Double - (
        (${value}::Double - ${minValue}::Double) *
        (${height}::Double - (2 * ${padding}::Double)) /
        (${maxValue}::Double - ${minValue}::Double)
      )
    end`;
  } else {
    scaled = sql`case
      when ${maxValue}::Double = ${minValue}::Double then ${height}::Double / 2::Double
      else ${height}::Double - ${padding}::Double - (
        (ln(${value}::Double) - ln(greatest(1::Double, ${minValue}::Double)::Double)::Double) *
        (${height}::Double - 2::Double * ${padding}::Double) /
        (ln(${maxValue}::Double) - ln(greatest(1::Double, ${minValue}::Double)::Double)::Double)
      )
    end`;
  }
  return scaled;
}

class VisRootCtx implements ContextInstance, VisRootICtx {
  implementICtxs: ICtxKey<any>[] = [VisRootICtxKey];
  yAxis: string[] = [];
  xAxis?: string;
  constructor(
    public padding: number,
    public scaleType: "linear" | "logarithmic",
    public height: number,
    public width: number,
  ) {
    this.padding = padding;
    this.scaleType = scaleType;
    this.height = height;
    this.width = width;
  }
  setYAxis(value: string) {
    this.yAxis = [...this.yAxis, value];
  }
  setXAxis(value: string) {
    this.xAxis = value;
  }
}

export function VisRoot(props: LineChartProps) {
  const {
    children,
    query,
    height,
    width,
    scaleType = "linear",
    padding = 60,
    tickCount = 5,
    minValue,
    maxValue,
    sx,
    className,
  } = props;
  const ctx = new VisRootCtx(padding, scaleType, height, width);
  addCtx(ctx);
  gatherChildrenContextInfo(children);
  const visRootId = useUniqueId();
  function onMouseMove(s: DomStatements) {
    if (ctx.yAxis.length > 0) {
      s.element(visRootId).getBoundingClientRect("svgRect");
      s.setScalar("popover_open", true);
      const mouseX =
        sql`(event.client_x - svgRect.left) * ${width} / svgRect.width`;
      s.defScalar(
        "current_x",
        sql`(
        select x
        from data_points_${sql.ref(ctx.yAxis[0])}
        where x <= ${mouseX}
        order by x desc
        limit 1
      )`,
      );
      s.defScalar(
        "next_x",
        sql`(
        select x
        from data_points_${sql.ref(ctx.yAxis[0])}
        where x > ${mouseX}
        order by x asc
        limit 1
      )`,
      );
      s.defScalar(
        "closest_index",
        sql`(
        select
          case
            when next_x is null then (select max(index) from data_points_${
          sql.ref(ctx.yAxis[0])
        })
            when current_x is null then 0
            when ${mouseX} > (current_x + next_x) / 2 then (
              select index + 1
              from data_points_${sql.ref(ctx.yAxis[0])}
              where x = current_x
            )
            else (
              select index
              from data_points_${sql.ref(ctx.yAxis[0])}
              where x = current_x
            )
          end
      )`,
      );
      const dataIndex = sql`closest_index`;
      s.setScalar(
        "tool_tip_x",
        xScale({
          padding,
          value: sql`${dataIndex}::Int`,
          width,
          dataLength: sql`chart_data_row_count`,
        }),
      );
      const yValue = ctx.yAxis.length === 1
        ? sql`(select max(${
          sql.ref(ctx.yAxis[0])
        }) from chart_data where index = ${dataIndex})`
        : sql`(select greatest(${
          sql(
            ctx.yAxis
              .map(
                (col) =>
                  `(select max(${col}) from chart_data where index = ${
                    sql.exprToString(dataIndex)
                  })`,
              )
              .join(", "),
          )
        }))`;
      s.setScalar(
        "tool_tip_y",
        sql`${
          yScale({
            padding,
            value: yValue,
            height,
            minValue: sql`min_value`,
            maxValue: sql`max_value`,
            scaleType,
          })
        }`,
      );
      s.setScalar("mouse_index", dataIndex);
      s.if(sql`tool_tip_y is null`, (s) => {
        s.setScalar("popover_open", false);
      });
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
          s.defTable(
            "chart_data",
            sql`select *, ((row_number() over()) - 1) as index from (${query})`,
          );
          s.defScalar("records_exist", sql`exists (select 1 from chart_data)`);
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
          s.defScalar("chart_data_row_count", {
            expr: sql`(select count(*) from chart_data)`,
            allowNoRead: true,
          });
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
            for (const yAxis of ctx.yAxis) {
              s.defTable(
                `data_points_${yAxis}`,
                sql`select
                ${sql.ref(yAxis)},
                index,
                (${
                  xScale({
                    padding,
                    value: sql`index`,
                    width,
                    dataLength: sql`chart_data_row_count`,
                  })
                }) as x,
                ${
                  yScale({
                    padding,
                    value: sql`${sql.ref(yAxis)}`,
                    height,
                    minValue: sql`min_value`,
                    maxValue: sql`max_value`,
                    scaleType,
                  })
                } as y
              from chart_data`,
              );
              s.defTable(`data_point_pairs_${yAxis}`, {
                query: sql`select
                t1.x as rec1_x,
                t2.x as rec2_x,
                t1.y as rec1_y,
                t2.y as rec2_y
              from data_points_${sql.ref(yAxis)} t1
                join data_points_${sql.ref(yAxis)} t2
                  on t1.index = t2.index - 1
              order by t1.index`,
                allowNoRead: true,
              });
            }
            s.defTable("ticks", {
              fields: [
                { name: "value", type: "BigInt" },
                { name: "y", type: "BigInt" },
              ],
            });
            for (let i = 0; i <= tickCount; i++) {
              const value = scaleType === "linear"
                ? sql`min_value::Double + (${i} * (max_value::Double - min_value::Double)) / ${tickCount}`
                : sql`exp(ln(greatest(1, min_value::Double)) +
                    (${i} * (ln(max_value::Double) - ln(greatest(1, min_value::Double)))) /
                      ${tickCount})`;
              const y =
                sql`${height} - ${padding} - (${i} * (${height} - 2 * ${padding}) / ${tickCount})`;
              s.modify(
                sql`insert into ticks (value, y) values (${value}, ${y})`,
              );
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
            id={visRootId}
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
