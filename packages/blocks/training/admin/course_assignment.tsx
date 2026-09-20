import { Button } from "components/button";
import { StatusChip } from "components/status_chip";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import { employeeName, personTable } from "../helpers";
import { EmptyState } from "../shared";
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
    <div className="flex flex-col gap-5">
      <div>
        <Button
          component="a"
          href={adminCourseHref(props.block, courseId)}
          variant="plain"
          color="neutral"
          startIcon="ArrowBack"
        >
          Back to course or program
        </Button>
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
            sql`select a.id, a.assigned_at, a.due_date,
                    ${employeeName(props.block.opts, sql`e`)} as employee_name,
                    count(t.id) as task_count,
	                    sum(case when t.status = 'completed' then 1 else 0 end) as completed_count
                from db.training_assignments a
                join db.${
              sql.ref(personTable(props.block.opts))
            } e on e.id = a.person_id
	                left join db.training_employee_tasks t on t.training_assignment_id = a.id
                where a.training_course_id = ${courseId}
                group by a.id, a.assigned_at, a.due_date, employee_name
                order by a.assigned_at desc, a.id desc
                limit 8`,
          );
        }}
      >
        <Typography level="title-md" className="mt-6 mb-2">
          Recent assignments
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
              <StatusChip
                fallbackLabel={sql`assignment.completed_count::string || '/' || assignment.task_count::string || ' completed'`}
                cases={[
                  {
                    when:
                      sql`assignment.completed_count = assignment.task_count and assignment.task_count > 0`,
                    label: "Completed",
                    color: "success",
                  },
                ]}
              />
            </div>
          </Each>
        </div>
      </AssignmentWorkspace>
    </div>
  );
}
