import type { Node } from "std/ui";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { Menu } from "components/menu";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { ModalDialog } from "components/modal";
import { WiseStatLineChart } from "components/wise_stat_line_chart";
import { LineChart } from "vis/line_charts";
import { BarChart } from "vis/bar_charts";
import { userHasPermission } from "blocks/auth";
import { ManualEntry } from "blocks/manual_measurements";
import { Data } from "std/data";
import { Each, Route, Show, useICtx, usePhase, useUniqueId } from "std/ui";
import { VisRootICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import { formatValue } from "std/value_format";
import { DashboardBlock } from "./index";
import { system } from "std/system";
import { resolveParameters } from "./parameters";
import { ParameterControls } from "./parameter_controls";
import { executeWidget } from "./query";

function ResultTable() {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("result_page", 0);
        // Columns keep the widget query's select order.
        s.defTable(
          "result_columns",
          sql`select key from json.object_each(widget_result->0)`,
        );
      }}
    >
      <div className="overflow-auto max-h-96">
        <table className="w-full text-sm text-left">
          <thead>
            <tr>
              <Each table="result_columns" recordName="column">
                <th className="p-2 border-b border-divider">
                  {sql`column.key`}
                </th>
              </Each>
            </tr>
          </thead>
          <tbody>
            <QueryEach
              query={sql`select index,value from json.array_each(widget_result) order by index limit 25 offset result_page * 25`}
              recordName="result_row"
            >
              <tr>
                <Each table="result_columns" recordName="column">
                  <td className="p-2 border-b border-divider">
                    {sql`case
                      when result_row.value->>column.key is null then '—'
                      when widget.config->'columnFormats'->column.key->>'type'='text' then result_row.value->>column.key
                      when json_typeof(result_row.value->column.key)='number'
                        or widget.config->'columnFormats'->column.key->>'type' is not null
                        or (widget.type!='table' and column.key in ('value','value2')) then ${
                      formatValue(
                        sql`try_cast(result_row.value->>column.key as double)`,
                        sql`coalesce(widget.config->'columnFormats'->column.key, case when widget.type!='table' and column.key in ('value','value2') then widget.config->'format' else null::json end)`,
                      )
                    }
                      else result_row.value->>column.key end`}
                  </td>
                </Each>
              </tr>
            </QueryEach>
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-2">
        <Button
          size="sm"
          variant="plain"
          disabled={sql`result_page = 0`}
          onClick={(s) => s.decrement("result_page")}
        >
          Previous
        </Button>
        <Typography>{sql`(result_page + 1)::string`}</Typography>
        <Button
          size="sm"
          variant="plain"
          disabled={sql`(result_page + 1)*25 >= json_array_length(widget_result)`}
          onClick={(s) => s.increment("result_page")}
        >
          Next
        </Button>
      </div>
    </Data>
  );
}

function formatWidgetValue(value: NumericExpr) {
  return formatValue(value, sql`widget.config->'format'`);
}

// Fixed value series with a new SVG subpath after each missing observation.
function WidgetLine() {
  if (usePhase() === "gather") useICtx(VisRootICtxKey).setYAxis("value");
  return (
    <g>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        d={sql`(select string_agg(case when y is null then '' when previous_y is null then 'M ' || x::string || ' ' || y::string else 'L ' || x::string || ' ' || y::string end,' ' order by index) from (select *,lag(y) over(order by index) as previous_y from data_points_value) points)`}
      />
      <Each table="data_points_value" recordName="line_point">
        <Show when={sql`line_point.y is not null`}>
          <circle
            cx={sql`line_point.x`}
            cy={sql`line_point.y`}
            r={3}
            fill="currentColor"
          />
        </Show>
      </Each>
    </g>
  );
}

function WiseWidgetChart(props: {
  dual?: boolean;
  expanded?: boolean;
}) {
  const inverse =
    sql`coalesce(try_cast(widget.config->>'inverse' as bool),false)`;
  return (
    <div
      sx={{ width: "100%", minWidth: 0 }}
    >
      <WiseStatLineChart
        displaySize={props.expanded ? "expanded" : "widget"}
        valueLabels={props.expanded ? "all" : "latest"}
        title={sql`widget.title`}
        ownerHeader={sql`coalesce(widget.config->>'ownerHeader',widget_owner)`}
        ownerLabel={sql`widget.config->>'ownerLabel'`}
        valueFormat={sql`widget.config->'format'`}
        reverseAxis={inverse}
        graphLow={sql`try_cast(widget.config->>'graphLow' as double)`}
        graphDivision={sql`try_cast(widget.config->>'graphDivision' as double)`}
        query={sql`select cast(x as date) as period_start_date,value from widget_points order by x`}
        seriesLabel={sql`coalesce(widget.config->>'seriesLabel','Value')`}
        series2={props.dual
          ? {
            query:
              sql`select cast(x as date) as period_start_date,value2 as value from widget_points order by x`,
            label: sql`widget.config->>'series2Label'`,
            graphLow:
              sql`try_cast(widget.config->>'series2GraphLow' as double)`,
            graphDivision:
              sql`try_cast(widget.config->>'series2GraphDivision' as double)`,
            reverseAxis:
              sql`coalesce(try_cast(widget.config->>'series2Inverse' as bool),false)`,
          }
          : undefined}
      />
    </div>
  );
}

function WidgetChart(props: { expanded?: boolean } = {}) {
  const query =
    sql`select x as label, value, value2 from widget_points order by x`;
  return (
    <>
      <Show when={sql`widget.type = 'number'`}>
        <Typography level="h1" className="py-8">
          {formatWidgetValue(
            sql`try_cast(widget_result->0->>'value' as double)`,
          )}
        </Typography>
      </Show>
      <Show when={sql`widget.type = 'table'`}>
        <ResultTable />
      </Show>
      <Show
        when={sql`widget.type = 'wise'`}
      >
        <Show when={sql`widget.config->>'series2Label' is null`}>
          <WiseWidgetChart expanded={props.expanded} />
        </Show>
        <Show when={sql`widget.config->>'series2Label' is not null`}>
          <WiseWidgetChart dual expanded={props.expanded} />
        </Show>
      </Show>
      {([["small", 240], ["medium", 340], ["large", 460]] as const).map((
        [size, height],
      ) => (
        <Show
          when={sql`widget.type = 'line' and coalesce(widget.config->>'height','medium')=${
            sql.lit(size)
          }`}
        >
          <LineChart query={query} width={600} height={height}>
            <LineChart.XAxisLabels columnName="label" />
            <LineChart.YAxisLabels format={formatWidgetValue} />
            <LineChart.CartesianGrid />
            <LineChart.XAxis />
            <LineChart.YAxis />
            <WidgetLine />
            <LineChart.Tooltip
              renderContent={({ xValue, yValues }) => (
                <div>
                  {xValue}
                  {yValues.map((value) => <div>{formatWidgetValue(value)}
                  </div>)}
                </div>
              )}
            />
          </LineChart>
        </Show>
      ))}
      {([["small", 240], ["medium", 340], ["large", 460]] as const).map((
        [size, height],
      ) => (
        <Show
          when={sql`widget.type = 'bar' and coalesce(widget.config->>'height','medium')=${
            sql.lit(size)
          }`}
        >
          <BarChart query={query} width={600} height={height}>
            <BarChart.XAxisLabels columnName="label" />
            <BarChart.YAxisLabels format={formatWidgetValue} />
            <BarChart.CartesianGrid />
            <BarChart.XAxis />
            <BarChart.YAxis />
            <BarChart.Bar columnName="value" fill="currentColor" />
            <BarChart.Tooltip
              renderContent={(xAxis, yAxes, record) => (
                <div>
                  {sql`${record}.${sql.ref(xAxis)}`}
                  {yAxes.map((axis) => (
                    <div>
                      {formatWidgetValue(sql`${record}.${sql.ref(axis)}`)}
                    </div>
                  ))}
                </div>
              )}
            />
          </BarChart>
        </Show>
      ))}
    </>
  );
}

/** Fixed renderer shared by persisted dashboards and Spark dynamic UI hosts. */
export function DashboardWidget(
  props: {
    block?: DashboardBlock;
    widgetId: Sql;
    parameters?: Sql;
  },
) {
  const b = props.block ?? system.block(DashboardBlock);
  const menuButtonId = sql.concat(useUniqueId(), "-widget-", props.widgetId);
  return (
    <Data
      watch={[props.widgetId]}
      procedure={(s) => {
        s.defRecord(
          "widget",
          sql`select * from db.dashboard_widgets where id = ${props.widgetId}`,
        );
        s.defRecord(
          "widget_dashboard",
          sql`select d.* from db.dashboards d join db.dashboard_sections section on section.dashboard_id=d.id where section.id=widget.section_id`,
        );
        b.require(s, "view", sql`widget_dashboard.id`);
        s.defScalar(
          "widget_owner",
          sql`coalesce((select name from db.dashboard_sections where id=widget.section_id),widget_dashboard.name)`,
        );
      }}
    >
      <Data
        local
        procedure={(s) => {
          s.defScalar("widget_expanded", false);
          s.defScalar("widget_show_data", false);
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <Typography level="title-lg">
              {sql`widget.title`}
            </Typography>
            <Show
              when={sql`coalesce(try_cast(widget.config->>'inverse' as bool),false)`}
            >
              <Typography level="body-xs">Lower is better</Typography>
            </Show>
          </div>
          <Menu buttonId={menuButtonId}>
            <Menu.IconButton
              size="sm"
              variant="plain"
              color="neutral"
              aria-label="Widget actions"
            >
              <MaterialIcon icon="MoreHoriz" />
            </Menu.IconButton>
            <Menu.Content floating={{ placement: "bottom-end" }}>
              <Show when={sql`widget.type not in ('table','manual_entry')`}>
                <Menu.Item
                  onClick={(s) =>
                    s.setScalar("widget_show_data", sql`not widget_show_data`)}
                >
                  {sql`case when widget_show_data then 'Show chart' else 'View data' end`}
                </Menu.Item>
              </Show>
              <Menu.Item onClick={(s) => s.setScalar("widget_expanded", true)}>
                Expand
              </Menu.Item>
            </Menu.Content>
          </Menu>
        </div>
        <Data
          watch={props.parameters ? [props.parameters] : []}
          procedure={(s) => {
            b.require(s, "view", sql`widget_dashboard.id`);
            executeWidget(s, b, {
              returnErrors: true,
              type: sql`widget.type::string`,
              query: sql`widget.query`,
              config: sql`widget.config`,
              dashboardParameters: sql`widget_dashboard.parameters`,
              dashboardValues: props.parameters ?? sql`'{}'::json`,
            });
            s.defScalar("widget_result", sql`widget_rows`);
            s.defScalar(
              "widget_error",
              sql`case when contains(lower(widget_diagnostics->>'error'),'blocked by dynamic query') then 'You do not have data access for this widget.' else widget_diagnostics->>'error' end`,
            );
            s.defTable(
              "widget_points",
              sql`select value->>'x' as x, case when widget.config->>'missingValues' = 'zero' then coalesce(try_cast(value->>'value' as double),0) else try_cast(value->>'value' as double) end as value,try_cast(value->>'value2' as double) as value2 from json.array_each(widget_result)`,
            );
          }}
        >
          <Show
            when={sql`widget_error is not null`}
            fallback={
              <>
                <Show
                  when={sql`widget.type = 'manual_entry'`}
                  fallback={
                    <Show
                      when={sql`json_array_length(widget_result) > 0`}
                      fallback={<Alert>No data in this date range.</Alert>}
                    >
                      <Show
                        when={sql`widget_show_data`}
                        fallback={<WidgetChart />}
                      >
                        <ResultTable />
                      </Show>
                    </Show>
                  }
                >
                  {b.opts.measurements
                    ? (
                      <ManualEntry
                        block={b.opts.measurements}
                        statId={sql`try_cast(widget.config->>'measurementId' as bigint)`}
                      />
                    )
                    : <Alert>Manual measurements are unavailable.</Alert>}
                </Show>
              </>
            }
          >
            <Alert color="danger">{sql`widget_error`}</Alert>
          </Show>
          <ModalDialog
            open={sql`widget_expanded`}
            onClose={(s) => s.setScalar("widget_expanded", false)}
            layout="center"
            sx={{
              width: "min(1200px, calc(100vw - 32px))",
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "calc(100dvh - 32px)",
              overflow: "auto",
            }}
          >
            <div className="flex items-center justify-between gap-4 mb-4">
              <Typography level="h3">{sql`widget.title`}</Typography>
              <Button
                variant="plain"
                onClick={(s) => s.setScalar("widget_expanded", false)}
              >
                Close
              </Button>
            </div>
            <Show
              when={sql`widget_error is null and widget.type != 'manual_entry'`}
            >
              <WidgetChart expanded />
            </Show>
          </ModalDialog>
        </Data>
      </Data>
    </Data>
  );
}

/** Spark is the only dashboard authoring surface. */
function DashboardAssistant(
  props: { block: DashboardBlock; create?: boolean },
) {
  const b = props.block;
  return (
    <ServerShow
      when={sql`(${
        userHasPermission(
          sql.lit(b.opts.spark().opts.accessPermission ?? "can_use_spark"),
          sql`current_user`,
        )
      }) and (${props.create ? b.opts.permissions.create : sql.true})`}
    >
      <Button
        variant="outlined"
        href={b.opts.sparkHref(
          props.create
            ? sql.lit`Help me create a personal dashboard.`
            : sql`'Help me analyze or update the dashboard "' || dashboard.name || '" (ID ' || dashboard.id::string || '). Current filters: ' || dashboard_values::string`,
        )}
      >
        {props.create ? "New dashboard" : "Ask Spark"}
      </Button>
    </ServerShow>
  );
}

export function DashboardListPage(
  props: { block: DashboardBlock; path?: string },
) {
  const b = props.block;
  return (
    <Route path={props.path ?? b.basePath}>
      <main className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <Typography level="h2">Dashboards</Typography>
        <DashboardAssistant block={b} create />
        <Data
          procedure={(s) =>
            s.defTable(
              "dashboard_list",
              sql`select id,name,owner_id is null as shared from db.dashboards d where ${
                b.canView(sql`d.id`)
              } order by name,id`,
            )}
        >
          <Show when={sql`not exists(select 1 from dashboard_list)`}>
            <Alert>
              No dashboards yet. Use Spark to create your first dashboard.
            </Alert>
          </Show>
          {[true, false].map((shared) => (
            <Show
              when={sql`exists(select 1 from dashboard_list where shared=${shared})`}
            >
              <Typography level="h3">
                {shared ? "Shared dashboards" : "My dashboards"}
              </Typography>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Each
                  table="dashboard_list"
                  recordName="d"
                  where={sql`shared=${shared}`}
                  eachKey={sql`d.id`}
                >
                  <a
                    className="block border border-divider rounded-lg p-5"
                    href={sql`${sql.lit(b.basePath)} || '/' || d.id::string`}
                  >
                    <Typography level="title-lg">{sql`d.name`}</Typography>
                  </a>
                </Each>
              </div>
            </Show>
          ))}
        </Data>
      </main>
    </Route>
  );
}

export function DashboardPage(
  props: {
    block: DashboardBlock;
    path?: string;
    dashboardKey?: string;
    initialValues?: Sql;
  },
) {
  const b = props.block;
  return (
    <Route path={props.path ?? `${b.basePath}/{dashboard_id:id}`}>
      <main className="max-w-[1600px] w-full min-w-0 mx-auto p-4 md:p-6">
        <Data
          procedure={(s) => {
            s.defRecord(
              "dashboard",
              sql`select d.* from db.dashboards d where ${
                props.dashboardKey
                  ? sql`key=${sql.lit(props.dashboardKey)}`
                  : sql`id=ui.dashboard_id`
              }`,
            );
            b.require(s, "view", sql`dashboard.id`);
            resolveParameters(
              s,
              b,
              sql`dashboard.parameters`,
              props.initialValues ?? sql`'{}'::json`,
              "page_input",
            );
            s.defTable(
              "sections",
              sql`select *,coalesce(name,'Section ' || (row_number() over(order by sort_order,id))::string) as display_name from db.dashboard_sections where dashboard_id=dashboard.id`,
            );
            s.defTable(
              "widgets",
              sql`select * from db.dashboard_widgets where section_id in (select id from sections)`,
            );
          }}
        >
          <Data
            local
            noRefetch
            procedure={(s) => {
              s.defScalar("selected_section", sql`null::bigint`);
              s.defScalar("dashboard_values", sql`page_input_resolved`);
            }}
          >
            <div className="flex flex-wrap gap-3 items-center justify-between mb-5">
              <div>
                <Typography level="h2">{sql`dashboard.name`}</Typography>
                <Typography level="body-sm">
                  {sql`case when dashboard.owner_id is null then 'Shared dashboard' else 'Personal dashboard' end`}
                </Typography>
              </div>
              <div className="flex flex-wrap gap-2">
                <DashboardAssistant block={b} />
              </div>
            </div>
            <ParameterControls
              block={b}
              declarations={sql`dashboard.parameters`}
              scalar="dashboard_values"
            />
            <Show
              when={sql`dashboard.layout='tabs' and (select count(*) from sections)>1`}
            >
              <nav
                className="flex flex-wrap gap-2 border-b border-divider pb-3 mb-4"
                aria-label="Dashboard sections"
              >
                <Each
                  table="sections"
                  recordName="tab"
                  orderBy={sql`sort_order,id`}
                >
                  <Button
                    variant="plain"
                    aria-pressed={sql`tab.id=coalesce((select id from sections where id=selected_section),(select id from sections order by sort_order,id limit 1))`}
                    onClick={(s) =>
                      s.setScalar("selected_section", sql`tab.id`)}
                  >
                    {sql`tab.display_name`}
                  </Button>
                </Each>
              </nav>
            </Show>
            <Show when={sql`not exists(select 1 from sections)`}>
              <Alert>No widgets yet. Ask Spark to build this dashboard.</Alert>
            </Show>
            <Each
              table="sections"
              recordName="section"
              eachKey={sql`section.id`}
              orderBy={sql`sort_order,id`}
            >
              <Show
                when={sql`dashboard.layout='scrolling' or section.id=coalesce((select id from sections where id=selected_section),(select id from sections order by sort_order,id limit 1))`}
              >
                <Data
                  local
                  procedure={(s) => s.defScalar("section_collapsed", false)}
                >
                  <section className="my-6">
                    <Show
                      when={sql`section.name is not null or (select count(*) from sections)>1`}
                    >
                      <Button
                        variant="plain"
                        color="neutral"
                        className="mb-3"
                        onClick={(s) =>
                          s.setScalar(
                            "section_collapsed",
                            sql`not section_collapsed`,
                          )}
                      >
                        <Typography level="h3">
                          {sql`section.display_name`}
                        </Typography>
                      </Button>
                    </Show>
                    <Show when={sql`not section_collapsed`}>
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                        <Each
                          table="widgets"
                          recordName="placement"
                          eachKey={sql`placement.id`}
                          where={sql`section_id=section.id`}
                          orderBy={sql`sort_order,id`}
                        >
                          <article
                            className="min-w-0 border border-divider rounded-lg p-4"
                            data-widget-id={sql`placement.id`}
                            dynamicClassNames={[
                              {
                                condition: sql`placement.width='quarter'`,
                                classNames: "md:col-span-6 xl:col-span-3",
                              },
                              {
                                condition: sql`placement.width='third'`,
                                classNames: "md:col-span-6 xl:col-span-4",
                              },
                              {
                                condition: sql`placement.width='half'`,
                                classNames: "md:col-span-6",
                              },
                              {
                                condition: sql`placement.width='two_thirds'`,
                                classNames: "md:col-span-12 xl:col-span-8",
                              },
                              {
                                condition: sql`placement.width='full'`,
                                classNames: "md:col-span-12",
                              },
                            ]}
                          >
                            <DashboardWidget
                              block={b}
                              widgetId={sql`placement.id`}
                              parameters={sql`dashboard_values`}
                            />
                          </article>
                        </Each>
                      </div>
                      <Show
                        when={sql`not exists(select 1 from widgets where section_id=section.id)`}
                      >
                        <Alert>
                          No widgets yet. Ask Spark to build this dashboard.
                        </Alert>
                      </Show>
                    </Show>
                  </section>
                </Data>
              </Show>
            </Each>
          </Data>
        </Data>
      </main>
    </Route>
  );
}

function QueryEach(props: { query: Sql; recordName: string; children: Node }) {
  const table = `query_${props.recordName}`;
  return (
    <Data local procedure={(s) => s.defTable(table, props.query)}>
      <Each table={table} recordName={props.recordName}>{props.children}</Each>
    </Data>
  );
}

function ServerShow(
  props: {
    when: Sql;
    children: import("std/ui").Node;
    fallback?: import("std/ui").Node;
  },
) {
  return (
    <Data procedure={(s) => s.defScalar("server_visible", props.when)}>
      <Show when={sql`server_visible`} fallback={props.fallback}>
        {props.children}
      </Show>
    </Data>
  );
}
