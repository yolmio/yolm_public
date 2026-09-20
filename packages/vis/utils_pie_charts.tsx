import { Alert } from "components/alert";
import { Skeleton } from "components/skeleton";
import { Data } from "std/data";
import { PieRootICtxKey } from "std/ictx";
import type { PieRootICtx } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import {
  addCtx,
  type ContextInstance,
  gatherChildrenContextInfo,
  type ICtxKey,
  type Node,
  Show,
} from "std/ui";

interface PieChartRootProps {
  children: Node;
  query: Sql;
  size: number;
  sx?: Style;
  className?: string;
}

class PieRootCtx implements ContextInstance, PieRootICtx {
  implementICtxs: ICtxKey<any>[] = [PieRootICtxKey];
  yAxis: {
    columnName: string;
    innerRadius: number;
    outerRadius: number;
  }[] = [];
  constructor(public size: number) {
    this.size = size;
  }
  setYAxis(columnName: string, innerRadius: number, outerRadius: number) {
    this.yAxis = [...this.yAxis, { columnName, innerRadius, outerRadius }];
  }
}

export function PieChartRoot(props: PieChartRootProps) {
  const { children, query, size, sx, className } = props;
  const ctx = new PieRootCtx(size);

  addCtx(ctx);
  gatherChildrenContextInfo(children);
  return (
    <div sx={sx} className={className}>
      <Data
        pendingFallback={
          <>
            <Alert color="primary" startIcon="Info">
              Preparing pie chart...
            </Alert>
            <Skeleton variant="circular" animation="wave" />
          </>
        }
        errorFallback={
          <Alert color="danger" startIcon="Report">
            Failed to load data
          </Alert>
        }
        procedure={(s) => {
          s.defScalar("records_exist", sql`exists (${query})`);
          s.defTable(
            "chart_data",
            sql`select *, ((row_number() over()) - 1) as index from (${query})`,
          );
          s.defScalar("hover_segment_index", {
            type: {
              type: "Int",
            },
            allowNoRead: true,
          });
          s.defScalar("popover_open", {
            type: {
              type: "Bool",
            },
            allowNoRead: true,
          });
          s.defScalar("column_name", {
            type: {
              type: "String",
              maxLength: 100,
            },
            allowNoRead: true,
          });
          s.defScalar("hover_start_angle", {
            type: {
              type: "Double",
            },
            allowNoRead: true,
          });
          s.defScalar("hover_end_angle", {
            type: {
              type: "Double",
            },
            allowNoRead: true,
          });
          s.defScalar("chart_data_row_count", {
            expr: sql`(select count(*) from chart_data)`,
            allowNoRead: true,
          });
          if (ctx.yAxis.length > 0) {
            for (const yAxis of ctx.yAxis) {
              s.defScalar(`total_value_${yAxis.columnName}`, {
                expr: sql`(select sum(${
                  sql.ref(yAxis.columnName)
                }) from chart_data)`,
                allowNoRead: true,
              });
              s.defTable(
                `angles_${yAxis.columnName}`,
                sql`
                with total as (
                  select coalesce(sum(${
                  sql.ref(yAxis.columnName)
                }), 0) as total_sum
                  from chart_data
                ),
                running_totals as (
                  select
                    cd1.*,
                    (
                      select coalesce(sum(cd2.${sql.ref(yAxis.columnName)}), 0)
                      from chart_data cd2
                      where cd2.index <= cd1.index
                    ) as cum_sum,
                    total.total_sum as total
                  from chart_data cd1
                  cross join total
                )
                select
                  running_totals.*,
                  case
                    when total = 0 then (-90)::double
                    else (-90)::double + (360 * (cum_sum::double - ${
                  sql.ref(yAxis.columnName)
                }::double) / total::double)
                  end as start_angle,
                  case
                    when total = 0 then (270)::double
                    else (-90)::double + (360 * cum_sum::double / total::double)
                  end as end_angle
                from running_totals
                order by index
                `,
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
            viewBox={`0 0 ${size} ${size}`}
          >
            {children}
          </svg>
        </Show>
      </Data>
    </div>
  );
}
