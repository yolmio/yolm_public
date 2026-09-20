import { AuthBlock } from "blocks/auth";
import { Button } from "components/button";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { Typography } from "components/typography";
import { type Sql, sql } from "std/sql_utils";
import type { StateStatements } from "std/statements";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import {
  employeeName,
  formatDateTimeSql,
  personTable,
  trainingPermissions,
} from "../helpers";
import {
  AssignmentWorkspace,
  defineAssignmentWorkspaceState,
} from "./assignment_workspace";

export function initializeTrainingDocumentAssignmentState(
  s: StateStatements,
  block: TrainingBlock,
) {
  defineAssignmentWorkspaceState(s, {
    block,
    assignScalarPrefix: "direct_assign",
    ruleScalarPrefix: "doc_rule",
  });
  s.defScalar("direct_assign_waiver_reason", sql.lit``);
}

export function DirectDocumentAssignmentPanel(
  props: { block: TrainingBlock; documentId: Sql },
) {
  return (
    <AuthBlock.PermissionCheck
      permission={trainingPermissions.assignTraining}
    >
      <DirectDocumentAssignmentPanelContent {...props} />
    </AuthBlock.PermissionCheck>
  );
}

function DirectDocumentAssignmentPanelContent(
  props: { block: TrainingBlock; documentId: Sql },
) {
  const block = props.block;
  const documentId = props.documentId;
  return (
    <AssignmentWorkspace
      block={block}
      kind="document"
      targetId={documentId}
      assignScalarPrefix="direct_assign"
      ruleScalarPrefix="doc_rule"
      extraDataProcedure={(s) => {
        s.defTable(
          "open_document_training_tasks",
          sql`
            select
              task.id as task_id,
              task.status,
              task.due_date,
              ${employeeName(block.opts, sql`person`)} as person_name
            from db.training_employee_tasks task
            join db.training_assignments assignment
              on assignment.id = task.training_assignment_id
            join db.${sql.ref(personTable(block.opts))} person
              on person.id = assignment.person_id
            where assignment.document_id = ${documentId}
              and assignment.training_course_id is null
              and task.status in ('assigned', 'in_progress')
            order by
              case when task.due_date is null then 1 else 0 end,
              task.due_date,
              person_name
          `,
        );
        s.defTable(
          "document_training_waivers",
          sql`
            select
              task.id as task_id,
              task.waived_at,
              task.waiver_reason,
              ${employeeName(block.opts, sql`person`)} as person_name,
              ${employeeName(block.opts, sql`waived_by`)} as waived_by_name
            from db.training_employee_tasks task
            join db.training_assignments assignment
              on assignment.id = task.training_assignment_id
            join db.${sql.ref(personTable(block.opts))} person
              on person.id = assignment.person_id
            join db.${sql.ref(personTable(block.opts))} waived_by
              on waived_by.id = task.waived_by_id
            where assignment.document_id = ${documentId}
              and assignment.training_course_id is null
              and task.status = 'waived'
            order by task.waived_at desc, task.id desc
            limit 20
          `,
        );
      }}
    >
      <Show
        when={sql`exists (
          select 1 from open_document_training_tasks
        )`}
      >
        <div className="mt-6 rounded-md border border-divider bg-neutral-50 p-3">
          <Typography level="title-md" startIcon="Rule">
            Open assignments
          </Typography>
          <Typography level="body-sm" className="text-neutral-600">
            Waivers preserve who approved the exception, when, and why.
          </Typography>
          <FormControl className="mt-3">
            <FormLabel>Waiver reason</FormLabel>
            <Input
              bindScalar="direct_assign_waiver_reason"
              placeholder="Reason this assignment does not apply"
            />
          </FormControl>
          <div className="mt-3 flex flex-col gap-2">
            <Each
              table="open_document_training_tasks"
              recordName="open_task"
            >
              <div className="flex flex-col gap-3 rounded-md border border-divider bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Typography level="title-sm">
                    {sql`open_task.person_name`}
                  </Typography>
                  <Typography
                    level="body-sm"
                    className="text-neutral-600"
                  >
                    {sql`case
                      when open_task.due_date is null then 'No due date'
                      else 'Due ' ||
                        format.date(open_task.due_date, '%m/%d/%Y')
                    end`}
                  </Typography>
                </div>
                <Button
                  size="sm"
                  variant="outlined"
                  color="neutral"
                  disabled={sql`nullif(
                    trim(direct_assign_waiver_reason),
                    ''
                  ) is null`}
                  onClick={(s) => {
                    s.setScalar("direct_assign_message", sql`null`);
                    s.setScalar("direct_assign_error", sql`null`);
                    s.tryServer({
                      body: (s) => {
                        block.waiveDocumentTask(s, {
                          taskId: sql`open_task.task_id`,
                          reason: sql`ui.direct_assign_waiver_reason`,
                        });
                        s.setScalar(
                          "ui.direct_assign_waiver_reason",
                          sql.lit``,
                        );
                        s.setScalar(
                          "ui.direct_assign_message",
                          sql`'Waived assignment for ' ||
                            open_task.person_name || '.'`,
                        );
                        s.refetch();
                      },
                      errorName: "direct_assign_waiver_error",
                      catch: (s) =>
                        s.setScalar(
                          "direct_assign_error",
                          sql`coalesce(
                            direct_assign_waiver_error.message,
                            'The assignment could not be waived.'
                          )`,
                        ),
                    });
                  }}
                >
                  Waive
                </Button>
              </div>
            </Each>
          </div>
        </div>
      </Show>
      <Show
        when={sql`exists (
          select 1 from document_training_waivers
        )`}
      >
        <div className="mt-4 rounded-md border border-divider bg-white p-3">
          <Typography level="title-md">Recent waivers</Typography>
          <div className="mt-2 flex flex-col gap-2">
            <Each
              table="document_training_waivers"
              recordName="waiver"
            >
              <div className="rounded-md bg-neutral-50 p-3">
                <Typography level="title-sm">
                  {sql`waiver.person_name`}
                </Typography>
                <Typography
                  level="body-sm"
                  className="text-neutral-600"
                >
                  {sql`'Waived by ' || waiver.waived_by_name || ' · ' ||
                    ${formatDateTimeSql(sql`waiver.waived_at`)}`}
                </Typography>
                <Typography level="body-sm" className="mt-1">
                  {sql`waiver.waiver_reason`}
                </Typography>
              </div>
            </Each>
          </div>
        </div>
      </Show>
    </AssignmentWorkspace>
  );
}
