import { Card, CardHeader } from "components/card";
import { CurrentUserFirstName, TimeGreeting } from "components/greeting";
import { EnumColorSpan } from "components/inline_field_display";
import { DataTable } from "components/data_table";
import { StatRow } from "components/stat_row";
import { Typography } from "components/typography";
import { SimpleReportsPage } from "pages/simple_reports";
import { sql } from "../../std/sql_utils";
import { cssVar } from "std/style_utils";
import { system } from "std/system";
import { KanbanProjectTableBlock } from "table_blocks/kanban_project";
import { BarChart } from "vis/bar_charts";
import { PieChart } from "vis/pie_chart";
import { CrmBlock } from "./index";

/**
 * Pre-built `SimpleReportsPage.Report` showing high-level KPIs for
 * organizations: counts by status, region, and industry, plus a chart of
 * new orgs over time. Drop inside a `SimpleReportsPage` to add it to a
 * report group.
 */
export function OrganizationsOverviewReport(props: { name?: string }) {
  const block = system.block(CrmBlock);
  const organizationsTable = system.db.tables[block.organizationsTableName];
  return (
    <SimpleReportsPage.Report
      name={props.name ?? "Overview"}
      grid
      disableHeader
    >
      <StatRow
        header={`${organizationsTable.displayName} Overview`}
        stats={[
          {
            title: `Total ${organizationsTable.displayName}`,
            value: sql`(select count(*) from ${
              sql.ref(organizationsTable.name)
            })`,
            titleProps: {
              startIcon: "Groups",
            },
            color: "primary",
          },
          {
            title: "Active",
            value: sql`(select count(*) from ${
              sql.ref(organizationsTable.name)
            } where status = 'customer')`,
            titleProps: {
              startIcon: "Star",
            },
            color: "success",
          },
          {
            title: "Prospects",
            value: sql`(select count(*) from ${
              sql.ref(organizationsTable.name)
            } where status = 'prospect')`,
            titleProps: {
              startIcon: "TrendingUp",
            },
            color: "success",
          },
          {
            title: "Inactive",
            value: sql`(select count(*) from ${
              sql.ref(organizationsTable.name)
            } where status = 'inactive')`,
            titleProps: {
              startIcon: "PauseCircle",
            },
            color: "neutral",
          },
        ]}
      />

      <Card
        variant="outlined"
        sx={{ gridColumnSpan: 12, md: { gridColumnSpan: 7 } }}
      >
        <CardHeader>
          <Typography level="title-lg">
            {organizationsTable.displayName} by Industry
          </Typography>
        </CardHeader>
        <BarChart
          query={sql`
              select
                crm_industries.name as industry_name,
                count(*) as client_count
              from ${sql.ref(organizationsTable.name)}
              auto join crm_industries
              group by crm_industries.name
              order by client_count desc
              limit 5
            `}
          height={400}
          width={700}
        >
          <BarChart.XAxisLabels columnName="industry_name" />
          <BarChart.YAxisLabels />
          <BarChart.CartesianGrid strokeDasharray="3 3" />
          <BarChart.Bar
            columnName="client_count"
            fill={cssVar("palette-primary-500")}
          />
          <BarChart.Tooltip />
        </BarChart>
      </Card>

      <Card
        variant="outlined"
        sx={{ gridColumnSpan: 12, md: { gridColumnSpan: 5 } }}
      >
        <CardHeader>
          <Typography level="title-lg">Client Status Distribution</Typography>
        </CardHeader>
        <PieChart
          query={sql`
              select
                status,
                count(*)::int as status_count
              from ${sql.ref(organizationsTable.name)}
              group by status
              order by status_count desc
            `}
          size={500}
        >
          <PieChart.Pie
            columnName="status_count"
            innerRadius={60}
            outerRadius={120}
            fill={cssVar("palette-primary-400")}
            labels={{
              format: (value, recordName) =>
                sql.concat(value, " ", sql`${recordName}.status`),
              offset: 70,
            }}
            path={{
              style: {
                fill: sql.caseWhen({
                  conditions: Object.values(
                    system.enums.organization_status.values,
                  ).map((v) => ({
                    condition: sql`segment.status = ${sql.lit(v.name)}`,
                    expr: sql.lit(v.color!),
                  })),
                }),
              },
            }}
          />
          <PieChart.Tooltip />
        </PieChart>
      </Card>

      <Card variant="outlined" sx={{ gridColumnSpan: 12 }}>
        <CardHeader>
          <Typography level="title-lg">
            Recently Added {organizationsTable.displayName}
          </Typography>
        </CardHeader>
        <DataTable
          variant="outlined"
          primaryTable={organizationsTable.name}
          query={sql`
            select
              id,
              name,
              billing_email,
              status,
              crm_industry_id
            from ${sql.ref(organizationsTable.name)}
            order by id desc
            limit 10
          `}
          columns={(b) => {
            b.field("name");
            b.field("billing_email");
            b.field("status");
            b.field("crm_industry_id");
          }}
        />
      </Card>
    </SimpleReportsPage.Report>
  );
}

/**
 * Pre-built `SimpleReportsPage.Report` showing high-level KPIs for
 * people: counts by persona, department, and relationship strength,
 * plus a chart of new contacts over time.
 */
export function PeopleOverviewReport(props: { name?: string }) {
  const block = system.block(CrmBlock);
  const peopleTable = system.db.tables[block.peopleTableName];
  const organizationsTable = system.db.tables[block.organizationsTableName];
  return (
    <SimpleReportsPage.Report
      name={props.name ?? "Overview"}
      grid
      disableHeader
    >
      <StatRow
        header={`${peopleTable.displayName} Overview`}
        stats={[
          {
            title: `Total ${peopleTable.displayName}`,
            value: sql`(select count(*) from ${sql.ref(peopleTable.name)})`,
          },
          {
            title: "With Phone",
            value: sql`(select count(*) from ${
              sql.ref(peopleTable.name)
            } where phone is not null)`,
          },
          {
            title: "With Email",
            value: sql`(select count(*) from ${
              sql.ref(peopleTable.name)
            } where email is not null)`,
          },
        ]}
      />
      <Card variant="outlined" sx={{ gridColumnSpan: 12 }}>
        <CardHeader>
          <Typography level="title-lg">
            {peopleTable.displayName} by Client Status
          </Typography>
        </CardHeader>
        <BarChart
          query={sql`
              select
                ${sql.ref(organizationsTable.name)}.status as client_status,
                count(*) as cnt
              from ${sql.ref(peopleTable.name)}
              auto join ${sql.ref(organizationsTable.name)}
              where ${sql.ref(organizationsTable.name)}.id is not null
              group by ${sql.ref(organizationsTable.name)}.status
            `}
          height={400}
          width={800}
        >
          <BarChart.CartesianGrid />
          <BarChart.XAxis />
          <BarChart.XAxisLabels columnName="client_status" />
          <BarChart.YAxis />
          <BarChart.YAxisLabels />
          <BarChart.Bar columnName="cnt" fill={cssVar("palette-primary-400")} />
          <BarChart.Tooltip />
        </BarChart>
      </Card>
      <div sx={{ gridColumnSpan: 12 }}>
        <DataTable
          header={
            <h3 className="p-2 text-center">
              {`Recently Added ${peopleTable.displayName}`}
            </h3>
          }
          variant="outlined"
          primaryTable={peopleTable.name}
          query={sql`
              select id, first_name, last_name, email, phone
              from ${sql.ref(peopleTable.name)}
              order by id desc
              limit 8
            `}
          columns={(b) => {
            b.field("first_name");
            b.field("last_name");
            b.field("email");
            b.field("phone");
          }}
        />
      </div>
    </SimpleReportsPage.Report>
  );
}

/**
 * "Welcome back" report — the landing report users see after logging in.
 * Surfaces their open tasks, recently visited records, and outstanding
 * items needing attention.
 */
export function WelcomeBackReport(props: {
  name?: string;
  notDefault?: boolean;
}) {
  const block = system.block(CrmBlock);
  const organizationsTable = system.db.tables[block.organizationsTableName];
  const kanbanBlock = organizationsTable.block(KanbanProjectTableBlock);
  const projectsTable = system.db.tables[kanbanBlock.projectsTableName];
  const tasksTable = system.db.tables[kanbanBlock.tasksTableName];
  const projectsFk = Object.values(tasksTable.fields).find(
    (f) => f.type === "ForeignKey" && f.table === projectsTable.name,
  );
  if (!projectsFk) {
    throw new Error("projectsFk not found");
  }
  const orgFk = Object.values(projectsTable.fields).find(
    (f) => f.type === "ForeignKey" && f.table === organizationsTable.name,
  );
  if (!orgFk) {
    throw new Error("orgFk not found");
  }
  return (
    <SimpleReportsPage.Report
      name="Welcome Back"
      grid
      disableHeader
      default={!props.notDefault}
    >
      <Typography level="h2" sx={{ gridColumnSpan: 12 }}>
        <TimeGreeting />, <CurrentUserFirstName />
      </Typography>

      <StatRow
        sx={{ gridColumnSpan: 12 }}
        header="Overview"
        stats={[
          {
            title: "Active Clients",
            titleProps: {
              startIcon: "Business",
            },
            value: sql`(select count(*) from ${
              sql.ref(organizationsTable.name)
            } where status in ('prospect', 'customer'))`,
          },
          {
            title: "Active Projects",
            titleProps: {
              startIcon: "ViewKanban",
            },
            value: sql`(select count(*) from ${
              sql.ref(projectsTable.name)
            } where id in
                 (select ${projectsFk.ident} from ${
              sql.ref(tasksTable.name)
            } where status != 'done'))`,
          },
          {
            title: "Tasks Due Soon",
            color: "warning",
            titleProps: {
              startIcon: "CalendarToday",
            },
            value: sql`(select count(*) from ${sql.ref(tasksTable.name)}
                 where status != 'done' and due_date <= date.add(day, 7, current_date()))`,
          },
        ]}
      />

      <div
        sx={{
          borderRadius: "md",
          gridColumnSpan: 12,
          md: { gridColumnSpan: 6 },
        }}
      >
        <DataTable
          header={<h3 className="p-2 text-center">New Clients</h3>}
          variant="outlined"
          primaryTable={organizationsTable.name}
          query={sql`
                select
                  t.id,
                  t.status,
                  t.created_at
                from ${sql.ref(organizationsTable.name)} t
                order by t.created_at desc
                limit 5
              `}
          columns={(b) => {
            b.recordDisplayColumn("id", organizationsTable.name, "Client");
            b.formatColumn("status", (col) => (
              <>
                <EnumColorSpan enum="organization_status" value={col} />
                {sql`fn.display_organization_status(${col})`}
              </>
            ));
            b.formatColumn(
              "created_at",
              (col) =>
                sql`case when ${col} is null then null else format.date(${col}, '%-d %b %Y') end`,
            );
          }}
        />
      </div>

      <div
        sx={{
          borderRadius: "md",
          gridColumnSpan: 12,
          md: { gridColumnSpan: 6 },
        }}
      >
        <DataTable
          header={<h3 className="p-2 text-center">New Projects</h3>}
          variant="outlined"
          primaryTable={projectsTable.name}
          query={sql`
                select
                  t.id,
                  (select count(*) from ${
            sql.ref(tasksTable.name)
          } where ${projectsFk.ident} = t.id and status != 'done') as task_count
                from ${sql.ref(projectsTable.name)} t
                order by t.id desc
                limit 5
              `}
          columns={(b) => {
            b.recordDisplayColumn("id", projectsTable.name, "Project");
            b.decimalColumn("task_count");
          }}
        />
      </div>

      <div
        sx={{
          borderRadius: "md",
          gridColumnSpan: 12,
        }}
      >
        <DataTable
          header={<h3 className="p-2 text-center">New Tasks</h3>}
          variant="outlined"
          primaryTable={tasksTable.name}
          query={sql`
                select
                  t.title,
                  t.status,
                  t.due_date,
                  t.${projectsFk.ident},
                  p.${orgFk.ident}
                from ${sql.ref(tasksTable.name)} t
                auto join ${sql.ref(projectsTable.name)} p
                where t.status != 'done'
                order by t.id desc
                limit 5
              `}
          columns={(b) => {
            b.field("title");
            b.field(projectsFk.name, "Project");
            b.recordDisplayColumn(
              orgFk.name,
              organizationsTable.name,
              "Client",
            );
            b.formatColumn("status", (col) => (
              <>
                <EnumColorSpan enum="client_project_task_status" value={col} />
                {sql`fn.display_client_project_task_status(${col})`}
              </>
            ));
          }}
        />
      </div>
    </SimpleReportsPage.Report>
  );
}
