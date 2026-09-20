import { Card } from "components/card";
import { Chip } from "components/chip";
import { Params } from "components/params";
import { DataTable } from "components/data_table";
import { Report } from "components/report";
import { StatRow } from "components/stat_row";
import { Typography } from "components/typography";
import { sql } from "../../std/sql_utils";
import { cssVar } from "std/style_utils";
import { system } from "std/system";
import { Show } from "std/ui";
import { BarChart } from "vis/bar_charts";
import { LineChart } from "vis/line_charts";
import { KanbanProjectTableBlock } from "./index";

export function ProjectsOverviewReport(props: {
  name?: string;
  table: string;
}) {
  const table = system.db.tables[props.table];
  const block = table.block(KanbanProjectTableBlock);
  const projectsTable = system.db.tables[block.projectsTableName];
  const tasksTable = system.db.tables[block.tasksTableName];
  return (
    <Report name={props.name ?? "Projects Overview"} grid disableHeader>
      <StatRow
        header="Projects / Tasks"
        stats={[
          {
            title: "Total Projects",
            value: sql`(select count(*) from ${sql.ref(projectsTable.name)})`,
          },
          {
            title: "Total Tasks",
            value: sql`(select count(*) from ${sql.ref(tasksTable.name)})`,
          },
          {
            title: "Tasks Done",
            value: sql`(select count(*) from ${
              sql.ref(tasksTable.name)
            } where status = 'done')`,
          },
          {
            title: "In Progress",
            value: sql`(select count(*) from ${
              sql.ref(tasksTable.name)
            } where status = 'in_progress')`,
          },
        ]}
      />
      <div sx={{ lg: { gridColumnSpan: 6 }, gridColumnSpan: 12 }}>
        <h2 className="text-xl mb-4">Tasks by Status</h2>
        <BarChart
          query={sql`
              select status, count(*)::int as task_count
              from client_project_tasks
              group by status
            `}
          height={400}
          width={600}
        >
          <BarChart.CartesianGrid />
          <BarChart.XAxisLabels columnName="status" />
          <BarChart.YAxisLabels />
          <BarChart.Bar
            columnName="task_count"
            fill={cssVar("palette-success-500")}
          />
          <BarChart.Tooltip />
        </BarChart>
      </div>
      <div sx={{ lg: { gridColumnSpan: 6 }, gridColumnSpan: 12 }}>
        <DataTable
          header={
            <Typography level="title-md" sx={{ p: 1 }}>
              Latest Projects
            </Typography>
          }
          variant="outlined"
          primaryTable="client_projects"
          query={sql`
              select
                client_projects.id,
                client_projects.name,
                client_projects.notes,
                client_id
              from client_projects
              order by id desc
              limit 5
            `}
          columns={(b) => {
            b.field("name");
            b.field("client_id");
            b.field("notes");
          }}
        />
      </div>
    </Report>
  );
}

export function TimeTrackingOverviewReport(props: {
  name?: string;
  table: string;
}) {
  // const table = system.db.tables[props.table];
  // const block = table.block(KanbanProjectTableBlock);
  // const projectsTable = system.db.tables[block.projectsTableName];
  // const tasksTable = system.db.tables[block.tasksTableName];
  // const timeEntriesTable = system.db.tables[block.timeEntriesTableName];
  return (
    <Report name={props.name ?? "Time Tracking Overview"} grid disableHeader>
      <Params>
        <div className="py-8 flex flex-col gap-12">
          <Params.DateRange
            startName="start_date"
            initialStartValue={sql`date.add(day, -14, current_date())`}
            endName="end_date"
            initialEndValue={sql`current_date()`}
            label="Date Range"
          />

          {/* Stats Overview */}
          <StatRow
            header="Time Overview"
            stats={[
              {
                title: "Total Time Entries",
                titleProps: {
                  startIcon: "ListAlt",
                },
                value:
                  sql`(select count(*) from client_time_entries where date between start_date and end_date)`,
              },
              {
                title: "Billable Hours",
                titleProps: {
                  startIcon: "AttachMoney",
                },
                value:
                  sql`(select coalesce(sum(minutes), 0) from client_time_entries where billable and date between start_date and end_date)`,
                formatValue: (v) =>
                  sql`fn.display_minutes_duration(${v})`,
              },
              {
                title: "Non-Billable Hours",
                titleProps: {
                  startIcon: "AccessTime",
                },
                value:
                  sql`(select coalesce(sum(minutes), 0) from client_time_entries where not billable and date between start_date and end_date)`,
                formatValue: (v) =>
                  sql`fn.display_minutes_duration(${v})`,
              },
            ]}
          />

          {/* Main Content Grid */}
          <div
            sx={{
              display: "grid",
              gap: 4,
              gridTemplateColumns: {
                xs: "1fr",
                lg: "2fr 1fr",
              },
            }}
          >
            {/* Chart Section */}
            <Card variant="outlined" className="p-6">
              <Typography level="title-md" className="mb-6">
                Daily Time Tracking
              </Typography>
              <LineChart
                query={sql`
              with daily_time as (
                select
                  date,
                  sum(minutes) as total_minutes,
                  sum(case when billable then minutes else 0 end) as billable_minutes,
                  sum(case when not billable then minutes else 0 end) as non_billable_minutes
                from client_time_entries
                where date between start_date and end_date
                group by date
                order by date
              )
              select * from daily_time
            `}
                height={400}
                width={700}
                minValue={0}
              >
                <LineChart.CartesianGrid strokeDasharray="3 3" />
                <LineChart.XAxisLabels
                  columnName="date"
                  format={(date) =>
                    sql`format.date(${date}, '%b %d')`}
                />
                <LineChart.YAxisLabels
                  format={(val) =>
                    sql`concat(cast(${val}/60.0 as string), 'h')`}
                />
                <LineChart.Line
                  column="billable_minutes"
                  stroke={cssVar("palette-success-500")}
                  strokeWidth={2}
                  showLabels={{
                    fontSize: 11,
                    offset: 15,
                    format: (val) =>
                      sql`concat(cast(${val}/60.0 as string), 'h')`,
                    textAnchor: "middle",
                  }}
                />
                <LineChart.Line
                  column="non_billable_minutes"
                  stroke={cssVar("palette-primary-300")}
                  strokeWidth={2}
                  showLabels={{
                    fontSize: 11,
                    offset: -15,
                    format: (val) =>
                      sql`concat(cast(${val}/60.0 as string), 'h')`,
                    textAnchor: "middle",
                  }}
                />
                <LineChart.Tooltip />
              </LineChart>
            </Card>

            {/* Recent Entries Table */}
            <Card variant="outlined" className="p-6">
              <Typography level="title-md" className="mb-6">
                Recent Entries
              </Typography>
              <DataTable
                variant="outlined"
                size="sm"
                primaryTable="client_time_entries"
                query={sql`
              select
                date,
                minutes,
                billable,
                client_project_task_id,
                sys_user_id,
                description
              from client_time_entries
              where date between start_date and end_date
              order by date desc, id desc
              limit 8
            `}
                columns={(b) => {
                  b.formatColumn(
                    "date",
                    (val) => sql`format.date(${val}, '%b %d')`,
                  );
                  b.formatColumn(
                    "minutes",
                    (val) => sql`fn.display_minutes_duration(${val})`,
                  );
                  b.column("Status", (s) => (
                    <Show
                      when={sql`${s.record}.billable`}
                      fallback={
                        <Chip size="sm" color="neutral" variant="soft">
                          Non-Billable
                        </Chip>
                      }
                    >
                      <Chip size="sm" color="success">
                        Billable
                      </Chip>
                    </Show>
                  ));
                  b.field("client_project_task_id");
                  b.field("sys_user_id");
                }}
              />
            </Card>
          </div>
        </div>
      </Params>
    </Report>
  );
}
