import { currentUserHasPermission } from "blocks/auth";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { Node } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import {
  employeeName,
  personTable,
  trainingFeatureEnabled,
  trainingPermissions,
} from "../helpers";
import { EmptyState, PageShell } from "../shared";
import { adminEmployeeHref, adminPeopleHref } from "./shared";

function KpiCard(props: {
  href: string;
  icon: IconName;
  label: string;
  value: Sql;
  tone?: string;
}) {
  return (
    <a
      href={props.href}
      className="bg-white border border-divider rounded-md p-4 flex items-center gap-3 shadow-sm hover:bg-neutral-50 hover:border-neutral-300 transition-colors"
    >
      <div
        className={`h-10 w-10 rounded-md flex items-center justify-center shrink-0 ${
          props.tone ?? "bg-primary-50 text-primary-700"
        }`}
      >
        <MaterialIcon icon={props.icon} />
      </div>
      <div className="min-w-0">
        <Typography level="body-sm" className="text-neutral-600">
          {props.label}
        </Typography>
        <Typography level="h4">{props.value}</Typography>
      </div>
    </a>
  );
}

function StatusLegendItem(
  props: { dotClass: string; label: string; count: Sql },
) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full shrink-0 ${props.dotClass}`} />
      <Typography level="body-sm" className="text-neutral-700">
        {props.label}
      </Typography>
      <Typography level="body-sm" className="text-neutral-500">
        {sql`(${props.count})::string`}
      </Typography>
    </div>
  );
}

function AttentionCountChip(
  props: { when: Sql; color: "danger" | "warning" | "primary"; label: Node },
) {
  return (
    <Show when={props.when}>
      <Chip size="sm" variant="soft" color={props.color}>
        {props.label}
      </Chip>
    </Show>
  );
}

export function TrainingAdminDashboardPage(props: { block: TrainingBlock }) {
  const block = props.block;
  const includeCompliance = trainingFeatureEnabled(block.opts, "compliance");
  const permissions = trainingPermissions;
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "dashboard_can_view_people",
          currentUserHasPermission(sql.lit(permissions.viewEmployeeFiles)),
        );
        s.defRecord(
          "dashboard_stats",
          sql`select
                coalesce(sum(person_status.open_task_count), 0) as open_tasks,
                coalesce(sum(person_status.overdue_task_count), 0)
                  as overdue_tasks,
                (select count(*)
                 from db.training_employee_tasks
                 where dashboard_can_view_people
                   and status in ('assigned', 'in_progress')
                   and due_date is not null
                   and due_date >= current_date()
                   and due_date <= date.add(day, 30, current_date())) as due_soon_tasks,
                coalesce(sum(person_status.completed_task_count), 0)
                  as completed_tasks,
                coalesce(sum(person_status.pending_validation_count), 0)
                  as pending_validation
                ${
            includeCompliance
              ? sql`, (select count(*)
                 from db.training_retraining_cases
                 where dashboard_can_view_people
                   and status = 'open') as open_retraining_cases,
                coalesce(sum(person_status.cert_alert_count), 0)
                  as expiring_certifications`
              : sql``
          }
              from db.training_person_training_status person_status
              where dashboard_can_view_people`,
        );
        s.defTable(
          "attention_people",
          sql`select e.id,
                ${employeeName(block.opts, sql`e`)} as name,
                (select count(*) from db.training_assignments a
                  where a.person_id = e.id and a.training_course_id is not null
                    and a.status = 'in_progress'
                    and not exists (select 1 from db.training_employee_tasks t
                      where t.training_assignment_id = a.id and t.status in ('assigned', 'in_progress'))) as pending_submission,
                person_status.open_task_count as open_tasks,
                person_status.overdue_task_count as overdue_tasks,
                person_status.pending_validation_count as pending_validation
              from db.${sql.ref(personTable(block.opts))} e
              join db.training_person_training_status person_status
                on person_status.person_id = e.id
              where dashboard_can_view_people
                and (
                  person_status.open_task_count > 0
                  or (select count(*) from db.training_assignments a
                  where a.person_id = e.id and a.training_course_id is not null
                    and a.status = 'in_progress'
                    and not exists (select 1 from db.training_employee_tasks t
                      where t.training_assignment_id = a.id and t.status in ('assigned', 'in_progress'))) > 0
                  or person_status.pending_validation_count > 0
                )
              order by overdue_tasks desc, open_tasks desc, name
              limit 8`,
        );
      }}
    >
      <PageShell
        title="Training overview"
        subtitle={sql`case
          when dashboard_can_view_people
            then 'Completion, overdue work, and validation across all people. Select a number to see who it covers.'
          else 'Use the navigation to manage the training content available to you.'
        end`}
      >
        <Show when={sql`dashboard_can_view_people`}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KpiCard
              href={adminPeopleHref(props.block)}
              icon="TrendingUp"
              label="Completion rate"
              value={sql`(dashboard_stats.completed_tasks * 100 /
              greatest(dashboard_stats.completed_tasks + dashboard_stats.open_tasks, 1))::string || '%'`}
              tone="bg-emerald-50 text-emerald-700"
            />
            <KpiCard
              href={adminPeopleHref(props.block)}
              icon="AssignmentLate"
              label="Overdue tasks"
              value={sql`dashboard_stats.overdue_tasks::string`}
              tone="bg-danger-50 text-danger-700"
            />
            <KpiCard
              href={adminPeopleHref(props.block)}
              icon="Event"
              label="Due in 30 days"
              value={sql`dashboard_stats.due_soon_tasks::string`}
              tone="bg-amber-50 text-amber-700"
            />
            <KpiCard
              href={adminPeopleHref(props.block)}
              icon="Rule"
              label="Pending validation"
              value={sql`dashboard_stats.pending_validation::string`}
              tone="bg-sky-50 text-sky-700"
            />
            {includeCompliance && (
              <>
                <KpiCard
                  href={adminPeopleHref(props.block)}
                  icon="HistoryEdu"
                  label="Open retraining cases"
                  value={sql`dashboard_stats.open_retraining_cases::string`}
                  tone="bg-amber-50 text-amber-700"
                />
                <KpiCard
                  href={adminPeopleHref(props.block)}
                  icon="WorkspacePremium"
                  label="Certs expiring in 45 days"
                  value={sql`dashboard_stats.expiring_certifications::string`}
                  tone="bg-amber-50 text-amber-700"
                />
              </>
            )}
          </div>
          <div className="bg-white border border-divider rounded-md p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
              <Typography level="title-sm">Training status</Typography>
              <div className="flex flex-wrap items-center gap-4">
                <StatusLegendItem
                  dotClass="bg-emerald-500"
                  label="Completed"
                  count={sql`dashboard_stats.completed_tasks`}
                />
                <StatusLegendItem
                  dotClass="bg-primary-500"
                  label="Open"
                  count={sql`dashboard_stats.open_tasks - dashboard_stats.overdue_tasks`}
                />
                <StatusLegendItem
                  dotClass="bg-danger-500"
                  label="Overdue"
                  count={sql`dashboard_stats.overdue_tasks`}
                />
              </div>
            </div>
            <Show
              when={sql`dashboard_stats.completed_tasks + dashboard_stats.open_tasks > 0`}
              fallback={
                <Typography level="body-sm" className="text-neutral-600">
                  No training has been assigned yet.
                </Typography>
              }
            >
              <div className="h-2.5 w-full rounded-full bg-neutral-200 overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500"
                  style={{
                    width: sql`(dashboard_stats.completed_tasks * 100 /
                    greatest(dashboard_stats.completed_tasks + dashboard_stats.open_tasks, 1))::string || '%'`,
                  }}
                />
                <div
                  className="h-full bg-primary-500"
                  style={{
                    width:
                      sql`((dashboard_stats.open_tasks - dashboard_stats.overdue_tasks) * 100 /
                    greatest(dashboard_stats.completed_tasks + dashboard_stats.open_tasks, 1))::string || '%'`,
                  }}
                />
                <div
                  className="h-full bg-danger-500"
                  style={{
                    width: sql`(dashboard_stats.overdue_tasks * 100 /
                    greatest(dashboard_stats.completed_tasks + dashboard_stats.open_tasks, 1))::string || '%'`,
                  }}
                />
              </div>
            </Show>
          </div>
          <div>
            <Card variant="outlined">
              <CardHeader>
                <div className="flex items-center justify-between gap-3 w-full">
                  <Typography level="title-lg" startIcon="Group">
                    Needs attention
                  </Typography>
                  <Button
                    component="a"
                    href={adminPeopleHref(props.block)}
                    size="sm"
                    variant="plain"
                    color="neutral"
                    endIcon="ArrowForward"
                  >
                    All people
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Show
                  when={sql`exists (select 1 from attention_people)`}
                  fallback={
                    <EmptyState
                      icon="TaskAlt"
                      title="No one needs attention"
                      body="Everyone is current on their assigned training."
                    />
                  }
                >
                  <div className="flex flex-col -mx-2">
                    <Each table="attention_people" recordName="person">
                      <a
                        href={adminEmployeeHref(props.block, sql`person.id`)}
                        className="flex items-center justify-between gap-3 px-2 py-2.5 rounded-md border-b border-divider last:border-b-0 hover:bg-neutral-50 transition-colors"
                      >
                        <Typography level="title-sm" className="min-w-0">
                          {sql`person.name`}
                        </Typography>
                        <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                          <AttentionCountChip
                            when={sql`person.overdue_tasks > 0`}
                            color="danger"
                            label={sql`person.overdue_tasks::string || ' overdue'`}
                          />
                          <AttentionCountChip
                            when={sql`person.open_tasks - person.overdue_tasks > 0`}
                            color="warning"
                            label={sql`(person.open_tasks - person.overdue_tasks)::string || ' open'`}
                          />
                          <AttentionCountChip
                            when={sql`person.pending_validation > 0`}
                            color="primary"
                            label={sql`person.pending_validation::string || ' to validate'`}
                          />
                          <AttentionCountChip
                            when={sql`person.pending_submission > 0`}
                            color="warning"
                            label={sql`person.pending_submission::string || ' to submit'`}
                          />
                          <MaterialIcon
                            icon="ChevronRight"
                            className="text-neutral-400"
                          />
                        </div>
                      </a>
                    </Each>
                  </div>
                </Show>
              </CardContent>
            </Card>
          </div>
        </Show>
      </PageShell>
    </Data>
  );
}
