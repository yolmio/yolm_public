import { Button } from "components/button";
import { Chip } from "components/chip";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import {
  employeeName,
  formatDateSql,
  personTable,
  trainingValidationLabels,
} from "../helpers";
import { EmptyState, PageShell } from "../shared";
import { adminEmployeeCourseValidationHref } from "./shared";

export function TrainingAdminCourseValidationsPage(
  props: { block: TrainingBlock },
) {
  const validationLabels = trainingValidationLabels(props.block.opts);
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "pending_course_validations",
          sql`select a.id,
                     a.person_id,
                     course.name as course_name,
                     ${employeeName(props.block.opts, sql`employee`)}
                       as employee_name,
                     (
                       select max(t.completed_at)
                       from db.training_employee_tasks t
                       where t.training_assignment_id = a.id
                     ) as completed_at,
                     (
                       select count(*)
                       from db.training_employee_tasks t
                       where t.training_assignment_id = a.id
                         and t.status != 'waived'
                     ) as task_count,
                     a.final_primary_validator_id is not null
                       and not exists (
                         select 1
                         from db.training_assignment_validations av
                         where av.training_assignment_id = a.id
                           and av.validation_stage_code = ${
            sql.lit(validationLabels.primaryStageCode)
          }
                       ) as needs_primary_validation,
                     a.final_secondary_validator_id is not null
                       and not exists (
                         select 1
                         from db.training_assignment_validations av
                         where av.training_assignment_id = a.id
                           and av.validation_stage_code = ${
            sql.lit(validationLabels.secondaryStageCode)
          }
                       ) as needs_secondary_validation
              from db.training_assignments a
              join db.training_courses course
                on course.id = a.training_course_id
              join db.${sql.ref(personTable(props.block.opts))} employee
                on employee.id = a.person_id
              where a.training_course_id is not null
                and exists (
                  select 1
                  from db.training_assignment_validation_state validation_state
                  where validation_state.assignment_id = a.id
                )
                and not exists (
                  select 1
                  from db.training_employee_tasks open_task
                  where open_task.training_assignment_id = a.id
                    and open_task.status in ('assigned', 'in_progress')
                )
              order by completed_at nulls last, employee_name, course.name`,
        );
      }}
    >
      <PageShell
        title="Pending course validations"
        subtitle="Completed courses waiting for a validator to confirm the work and sign off."
      >
        <div>
          <Show
            when={sql`exists (select 1 from pending_course_validations)`}
            fallback={
              <EmptyState
                icon="TaskAlt"
                title="All clear"
                body="Completed courses awaiting manager validation will show up here."
              />
            }
          >
            <div className="flex flex-col bg-white border border-divider rounded-md overflow-hidden">
              <Each
                table="pending_course_validations"
                recordName="validation"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 border-b border-divider last:border-b-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Typography level="title-md">
                        {sql`validation.employee_name`}
                      </Typography>
                      <Chip size="sm" variant="soft" color="neutral">
                        {sql`validation.task_count::string ||
                            case when validation.task_count = 1
                              then ' task' else ' tasks' end`}
                      </Chip>
                      <Show when={sql`validation.needs_primary_validation`}>
                        <Chip size="sm" variant="soft" color="warning">
                          {validationLabels.primaryStageDisplayName}
                        </Chip>
                      </Show>
                      <Show
                        when={sql`validation.needs_secondary_validation`}
                      >
                        <Chip size="sm" variant="soft" color="warning">
                          {validationLabels.secondaryStageDisplayName}
                        </Chip>
                      </Show>
                    </div>
                    <Typography
                      level="body-sm"
                      className="text-neutral-600 mt-1"
                    >
                      {sql`validation.course_name || coalesce(' · Completed ' || ${
                        formatDateSql(sql`validation.completed_at`)
                      }, '')`}
                    </Typography>
                  </div>
                  <Button
                    component="a"
                    href={adminEmployeeCourseValidationHref(
                      props.block,
                      sql`validation.person_id`,
                      sql`validation.id`,
                    )}
                    variant="outlined"
                    color="neutral"
                    size="sm"
                    endIcon="ChevronRight"
                  >
                    Review course
                  </Button>
                </div>
              </Each>
            </div>
          </Show>
        </div>
      </PageShell>
    </Data>
  );
}
