import { Textarea } from "components/textarea";
import { Form, useFieldHelper } from "std/form";
import { FormICtxKey } from "std/ictx";
import { type Sql, sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { useICtx, usePhase } from "std/ui";
import { employeeText } from "./helpers";

// Use the stored procedure's exact table interface, including id signedness.
function defineResponseChanges(s: UiServerStatements, query: Sql) {
  s.defTable("response_changes", {
    fields: [
      { name: "task_id", type: "BigInt", notNull: true },
      { name: "essay_response", type: { type: "String", maxLength: 4000 } },
    ],
  });
  s.modify(
    sql`insert into response_changes (task_id, essay_response) ${query}`,
  );
}

/** Flush only edited responses before a course/task transition. Caller owns the transaction. */
export function saveCourseResponseDrafts(
  s: UiServerStatements,
  accessToken?: Sql,
) {
  defineResponseChanges(
    s,
    sql`select task_id, essay_response
    from ui.course_tasks where requires_essay and response_dirty`,
  );
  s.callStoredProcedure("training_save_course_responses", {
    inputScalars: {
      p_assignment_id: sql`ui.training_assignment_id`,
      p_access_token: accessToken ?? sql`null`,
    },
    inputTables: { p_responses: "response_changes" },
  });
}

function ResponseField(
  props: { preview: boolean; onEdit: (s: DomStatements) => unknown },
) {
  if (usePhase() === "gather") return;
  const field = useFieldHelper();
  const form = useICtx(FormICtxKey);
  return (
    <Textarea
      aria-label={sql`coalesce(nullif(trim(course_task.essay_prompt), ''), ${
        employeeText(sql`course_assignment.employee_language`, {
          en: "Written response",
          es: "Respuesta escrita",
        })
      })`}
      value={field.value}
      disabled={form.submitting}
      minRows={3}
      maxLength={4000}
      onInput={(s) => {
        props.onEdit(s);
        field.setValue(s, sql`target_value`);
        s.modify(
          sql`update ui.course_tasks set essay_response = target_value, response_dirty = true,
        status = case when nullif(trim(target_value), '') is null then 'in_progress' else status end
        where id = course_task.id`,
        );
        s.modify(
          sql`update ui.course_assignment set done_tasks = (select count(*) from ui.course_tasks where status = 'completed')`,
        );
      }}
      onBlur={{
        detachedFromNode: true,
        procedure: (s) => {
          if (!props.preview) {
            s.if(
              sql`last_saved_state_hash != ${form.stateHash()}`,
              (s) => form.submit(s),
            );
          }
        },
      }}
    />
  );
}

/** Form drafts survive refetches; typing never starts a server request. */
export function CourseResponseEditor(props: {
  accessToken?: Sql;
  preview: boolean;
  onEdit: (s: DomStatements) => unknown;
}) {
  return (
    <Form
      watch={props.preview ? [sql`preview_restart`, sql`preview_language`] : []}
      beforeUnloadCheck={!props.preview}
      refetchOnSuccess={false}
      beforeTransactionCommit={(s) => {
        if (props.preview) return;
        defineResponseChanges(
          s,
          sql`select course_task.task_id,
          ui.course_response.essay_response`,
        );
        s.callStoredProcedure("training_save_course_responses", {
          inputScalars: {
            p_assignment_id: sql`ui.training_assignment_id`,
            p_access_token: props.accessToken ?? sql`null`,
          },
          inputTables: { p_responses: "response_changes" },
        });
      }}
      afterSubmitClientSuccess={(s) => {
        s.modify(sql`update ui.course_tasks set response_dirty = false
        where id = course_task.id and essay_response = ui.course_response.essay_response`);
      }}
    >
      <Form.Temporary name="course_response">
        <Form.Field
          field="essay_response"
          fieldType={{ type: "String", maxLength: 4000 }}
          // Preview resets can reinitialize before the parent finishes refreshing.
          initialValue={props.preview
            ? sql.lit``
            : sql`coalesce(course_task.essay_response, '')`}
        >
          <ResponseField preview={props.preview} onEdit={props.onEdit} />
        </Form.Field>
      </Form.Temporary>
      <Form.ErrorAlert />
    </Form>
  );
}
