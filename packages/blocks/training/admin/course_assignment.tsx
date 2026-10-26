import { ActionButton } from "std/action_button";
import { Button } from "components/button";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { ModalDialog } from "components/modal";
import { Textarea } from "components/textarea";
import { StatusChip } from "components/status_chip";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import { employeeName, personTable } from "../helpers";
import { BackLink, EmptyState } from "../shared";
import { adminCourseHref, TrainingAdminFrame } from "./shared";
import {
  AssignmentWorkspace,
  defineAssignmentWorkspaceState,
} from "./assignment_workspace";

export function TrainingAdminCourseAssignPage(
  props: { block: TrainingBlock },
) {
  return (
    <Data
      local
      procedure={(s) => {
        defineAssignmentWorkspaceState(s, {
          block: props.block,
          assignScalarPrefix: "assign",
          ruleScalarPrefix: "rule",
          dueDateExpr: sql`(
            select date.add(day, due_within_days, current_date())
            from db.training_courses
            where id = course_id
          )`,
        });
      }}
    >
      <TrainingAdminFrame>
        <CourseAssignmentWorkspace
          block={props.block}
          courseId={sql`course_id`}
        />
      </TrainingAdminFrame>
    </Data>
  );
}

export function CourseAssignmentWorkspace(
  props: { block: TrainingBlock; courseId: Sql },
) {
  const courseId = props.courseId;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("withdraw_assignment_id", { type: "BigInt" });
        s.defScalar("withdraw_assignment_reason", sql.lit``);
        s.defScalar("withdraw_assignment_name", sql.lit``);
      }}
    >
      <div className="flex flex-col gap-5">
        <div className="-ml-2">
          <BackLink
            href={adminCourseHref(props.block, courseId)}
            label="Back to course"
          />
        </div>
        <AssignmentWorkspace
          block={props.block}
          kind="course"
          targetId={courseId}
          assignScalarPrefix="assign"
          ruleScalarPrefix="rule"
          extraDataProcedure={(s) => {
            s.defTable(
              "recent_assignments",
              sql`select a.id, a.status, a.assigned_at, a.due_date,
                    ${employeeName(props.block.opts, sql`e`)} as employee_name,
                    count(t.id) as task_count,
                    sum(case when t.status = 'completed' then 1 else 0 end) as completed_count,
                    sum(case when t.status in ('assigned', 'in_progress') then 1 else 0 end) as open_task_count
                from db.training_assignments a
                join db.${
                sql.ref(personTable(props.block.opts))
              } e on e.id = a.person_id
	                left join db.training_employee_tasks t on t.training_assignment_id = a.id
                where a.training_course_id = ${courseId}
                  and (a.status in ('pending', 'in_progress') or a.id in (
                    select recent.id from db.training_assignments recent
                    where recent.training_course_id = ${courseId}
                    order by recent.assigned_at desc, recent.id desc limit 8
                  ))
                group by a.id, a.status, a.assigned_at, a.due_date, employee_name
                order by case when a.status in ('pending', 'in_progress') then 0 else 1 end,
                  a.assigned_at desc, a.id desc`,
            );
          }}
        >
          <Typography level="title-md" className="mt-6 mb-2">
            Assignments
          </Typography>
          <div className="flex flex-col gap-2">
            <Show when={sql`not exists (select 1 from recent_assignments)`}>
              <EmptyState
                icon="AssignmentInd"
                title="No assignments yet"
                body={sql`'When you assign this training ' || case when selected_course.is_program then 'program' else 'course' end || ', the created employee training tasks will appear here.'`}
              />
            </Show>
            <Each table="recent_assignments" recordName="assignment">
              <div className="p-3 border border-divider rounded-md bg-white flex items-center justify-between gap-3">
                <div>
                  <Typography level="title-sm">
                    {sql`assignment.employee_name`}
                  </Typography>
                  <Typography level="body-sm" className="text-neutral-600">
                    {sql`assignment.task_count`} task(s) created
                  </Typography>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip
                    fallbackLabel={sql`assignment.completed_count::string || '/' || assignment.task_count::string || ' completed'`}
                    cases={[
                      {
                        when: sql`assignment.status = 'waived'`,
                        label: "Withdrawn",
                        color: "neutral",
                      },
                      {
                        when: sql`assignment.status = 'completed'`,
                        label: "Completed",
                        color: "success",
                      },
                      {
                        when: sql`assignment.status = 'validation_pending'`,
                        label: "Awaiting verification",
                        color: "warning",
                      },
                      {
                        when:
                          sql`assignment.status in ('pending', 'in_progress')
                          and assignment.completed_count > 0 and assignment.open_task_count = 0`,
                        label: "Ready to submit",
                        color: "warning",
                      },
                    ]}
                  />
                  <Show
                    when={sql`assignment.status in ('pending', 'in_progress')
                      and assignment.open_task_count > 0`}
                  >
                    <Button
                      size="sm"
                      variant="plain"
                      color="danger"
                      aria-label={sql`'Withdraw assignment for ' || assignment.employee_name`}
                      onClick={(s) => {
                        s.setScalar(
                          "withdraw_assignment_id",
                          sql`assignment.id`,
                        );
                        s.setScalar(
                          "withdraw_assignment_name",
                          sql`assignment.employee_name`,
                        );
                        s.setScalar("withdraw_assignment_reason", sql.lit``);
                      }}
                    >
                      Withdraw
                    </Button>
                  </Show>
                </div>
              </div>
            </Each>
          </div>
        </AssignmentWorkspace>
      </div>
      <ModalDialog
        open={sql`ui.withdraw_assignment_id is not null`}
        onClose={(s) => s.setScalar("withdraw_assignment_id", sql.null)}
        maxWidth="sm"
      >
        <div className="flex flex-col gap-4 p-5">
          <Typography level="title-lg">Withdraw course assignment</Typography>
          <Typography level="body-sm">
            {sql`'Outstanding tasks will be removed from ' || ui.withdraw_assignment_name || '''s due training. Completed work will remain in their history.'`}
          </Typography>
          <FormControl>
            <FormLabel>Reason</FormLabel>
            <Textarea
              aria-label="Reason"
              value={sql`ui.withdraw_assignment_reason`}
              maxLength={1000}
              onInput={(s) =>
                s.setScalar("withdraw_assignment_reason", sql`target_value`)}
            />
          </FormControl>
          <div className="flex justify-end gap-2">
            <Button
              variant="plain"
              onClick={(s) => s.setScalar("withdraw_assignment_id", sql.null)}
            >
              Keep assignment
            </Button>
            <ActionButton
              color="danger"
              disabled={sql`nullif(trim(ui.withdraw_assignment_reason), '') is null`}
              action={(s) =>
                s.callStoredProcedure("training_withdraw_course_assignment", {
                  inputScalars: {
                    p_assignment_id: sql`ui.withdraw_assignment_id`,
                    p_reason: sql`ui.withdraw_assignment_reason`,
                  },
                })}
              afterSuccessClient={(s) => {
                s.setScalar("withdraw_assignment_id", sql.null);
                s.refetch();
              }}
            >
              Withdraw assignment
            </ActionButton>
          </div>
        </div>
      </ModalDialog>
    </Data>
  );
}
