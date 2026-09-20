import { Alert } from "components/alert";
import { ActionButton } from "std/action_button";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { ModalDialog } from "components/modal";
import { Select } from "components/select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { currentUserHasPermission } from "blocks/auth";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { Each, Show } from "std/ui";
import {
  assessmentTaskStateChip,
  deleteAssessmentChoiceSelectionSql,
  insertAssessmentChoiceSelectionSql,
  saveAssessmentResponseManualScore,
  selectAssessmentSingleChoiceSql,
} from "../assessment_helpers";
import {
  currentEmployeeId,
  employeeName,
  formatDateSql,
  formatDateTimeSql,
  personTable,
  trainingPermissions,
} from "../helpers";
import type { TrainingBlock } from "../index.tsx";
import {
  callSaveAssessmentMetadataResponse,
  callSaveAssessmentResponse,
  EmptyState,
  SignaturePad,
} from "../shared";
import { assessmentExecutionModeLabelSql } from "./assessments";
import {
  adminAssessmentReviewsHref,
  adminAssessmentsHref,
  adminAssessmentTaskHref,
  adminSelectClass,
  TrainingAdminFrame,
} from "./shared";

export function TrainingAdminAssessmentReviewsPage(
  props: { block: TrainingBlock },
) {
  const opts = props.block.opts;
  return (
    <Data local procedure={() => {}}>
      <TrainingAdminFrame>
        <div className="flex flex-col gap-5">
          <div>
            <Button
              component="a"
              href={adminAssessmentsHref(props.block)}
              variant="plain"
              color="neutral"
              startIcon="ArrowBack"
            >
              Back to assessments
            </Button>
          </div>
          <Card variant="outlined">
            <CardHeader>
              <Typography level="title-lg" startIcon="RateReview">
                Attempts Pending Review
              </Typography>
            </CardHeader>
            <CardContent>
              <Data
                procedure={(s) => {
                  s.defTable(
                    "review_pending_attempts",
                    sql`select att.id, att.attempt_number, att.submitted_at,
                           att.training_employee_task_id,
                           assessment.name as assessment_name,
                           ${employeeName(opts, sql`person`)} as person_name
                        from db.training_assessment_attempts att
                        join db.training_assessment_versions version
                          on version.id = att.training_assessment_version_id
                        join db.training_assessments assessment
                          on assessment.id = version.training_assessment_id
                        join db.training_employee_tasks task
                          on task.id = att.training_employee_task_id
                        join db.training_assignments assignment
                          on assignment.id = task.training_assignment_id
                        join db.${sql.ref(personTable(opts))} person
                          on person.id = assignment.person_id
                        where att.status = 'review_pending'
                          and task.status in ('assigned', 'in_progress')
                          and assignment.status in
                            ('pending', 'in_progress', 'validation_pending')
                        order by att.submitted_at, att.id`,
                  );
                }}
              >
                <Show
                  when={sql`not exists (
                    select 1 from review_pending_attempts
                  )`}
                >
                  <EmptyState
                    icon="RateReview"
                    title="Nothing to review"
                    body="Submitted attempts that need a reviewer decision appear here."
                  />
                </Show>
                <Each
                  table="review_pending_attempts"
                  recordName="pending_attempt"
                >
                  <div className="flex items-center justify-between gap-3 border border-divider rounded-md px-4 py-2 mb-2 bg-white">
                    <div>
                      <Typography level="body-md">
                        {sql`pending_attempt.person_name || ' · ' ||
                          pending_attempt.assessment_name`}
                      </Typography>
                      <Typography level="body-sm" className="text-neutral-600">
                        {sql`'Attempt ' ||
                          pending_attempt.attempt_number::string ||
                          coalesce(' · submitted ' || ${
                          formatDateTimeSql(sql`pending_attempt.submitted_at`)
                        }, '')`}
                      </Typography>
                    </div>
                    <Button
                      size="sm"
                      startIcon="RateReview"
                      onClick={(s) =>
                        s.navigate(
                          adminAssessmentTaskHref(
                            props.block,
                            sql`pending_attempt.training_employee_task_id`,
                          ),
                        )}
                    >
                      Review
                    </Button>
                  </div>
                </Each>
              </Data>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardHeader>
              <Typography level="title-lg" startIcon="FactCheck">
                Evaluations To Record
              </Typography>
            </CardHeader>
            <CardContent>
              <Data
                procedure={(s) => {
                  s.defTable(
                    "trainer_recorded_tasks",
                    sql`select t.id, t.due_date,
                           assessment.name as assessment_name,
                           ${employeeName(opts, sql`person`)} as person_name,
                           (select task_state.derived_state
                            from db.training_task_derived_state task_state
                            where task_state.task_id = t.id) as derived_state
                        from db.training_employee_tasks t
                        join db.training_course_section_items i
                          on i.id = t.training_course_section_item_id
                         and i.type = 'assessment'
                        join db.training_assessments assessment
                          on assessment.id = i.training_assessment_id
                         and assessment.execution_mode = 'trainer_recorded'
                        join db.training_assignments assignment
                          on assignment.id = t.training_assignment_id
                        join db.${sql.ref(personTable(opts))} person
                          on person.id = assignment.person_id
                        where cast(t.status as string) in
                          ('assigned', 'in_progress')
                        order by t.due_date nulls last, t.id`,
                  );
                }}
              >
                <Show
                  when={sql`not exists (
                    select 1 from trainer_recorded_tasks
                  )`}
                >
                  <EmptyState
                    icon="FactCheck"
                    title="No evaluations waiting"
                    body="Open trainer-recorded evaluation tasks appear here."
                  />
                </Show>
                <Each
                  table="trainer_recorded_tasks"
                  recordName="trainer_task"
                >
                  <div className="flex items-center justify-between gap-3 border border-divider rounded-md px-4 py-2 mb-2 bg-white">
                    <div className="flex items-center gap-2">
                      <div>
                        <Typography level="body-md">
                          {sql`trainer_task.person_name || ' · ' ||
                            trainer_task.assessment_name`}
                        </Typography>
                      </div>
                      {assessmentTaskStateChip(sql`trainer_task.derived_state`)}
                    </div>
                    <Button
                      size="sm"
                      startIcon="EditNote"
                      onClick={(s) =>
                        s.navigate(
                          adminAssessmentTaskHref(
                            props.block,
                            sql`trainer_task.id`,
                          ),
                        )}
                    >
                      Record
                    </Button>
                  </div>
                </Each>
              </Data>
            </CardContent>
          </Card>
        </div>
      </TrainingAdminFrame>
    </Data>
  );
}

export function TrainingAdminAssessmentTaskPage(
  props: { block: TrainingBlock },
) {
  const opts = props.block.opts;
  const permissions = trainingPermissions;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("assessment_task_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("review_notes", sql.lit``);
        s.defScalar("review_override_reason", sql.lit``);
        s.defScalar("review_signature_data", {
          type: { type: "String", maxLength: 1000000 },
        });
        s.defScalar("response_review_open", sql`false`);
        s.defScalar("response_review_id", { type: "BigInt" });
        s.defScalar("response_review_points", sql.lit``);
        s.defScalar("response_review_max_points", sql.lit``);
        s.defScalar("response_review_notes", sql.lit``);
        s.defScalar("response_review_score_adjustment_allowed", sql`false`);
        s.defScalar(
          "can_record_evaluations",
          currentUserHasPermission(sql.lit(permissions.recordEvaluations)),
        );
        s.defScalar(
          "can_review_assessments",
          currentUserHasPermission(sql.lit(permissions.reviewAssessments)),
        );
        s.defScalar(
          "can_override_assessment_outcomes",
          currentUserHasPermission(
            sql.lit(permissions.overrideAssessmentOutcomes),
          ),
        );
      }}
    >
      <TrainingAdminFrame>
        <div className="flex flex-col gap-5">
          <div>
            <Button
              component="a"
              href={adminAssessmentReviewsHref(props.block)}
              variant="plain"
              color="neutral"
              startIcon="ArrowBack"
            >
              Back to review queue
            </Button>
          </div>
          <Data
            hoistKey={sql`training_task_id`}
            watch={[sql`training_task_id`]}
            procedure={(s) => {
              s.defRecord(
                "assessment_task",
                sql`select t.id, t.status, assignment.person_id, t.due_date,
                       t.training_assignment_id,
                       i.content as step_content,
                       assessment.id as assessment_id,
                       assessment.name as assessment_name,
                       assessment.kind, assessment.execution_mode,
                       ${employeeName(opts, sql`person`)} as person_name,
                       (select task_state.derived_state
                        from db.training_task_derived_state task_state
                        where task_state.task_id = t.id) as derived_state,
                       exists (
                         select 1
                         from db.training_assessment_attempts att
                         where att.training_employee_task_id = t.id
                       ) as has_attempt
                    from db.training_employee_tasks t
                    join db.training_course_section_items i
                      on i.id = t.training_course_section_item_id
                     and i.type = 'assessment'
                    join db.training_assessments assessment
                      on assessment.id = i.training_assessment_id
                    join db.training_assignments assignment
                      on assignment.id = t.training_assignment_id
                    join db.${sql.ref(personTable(opts))} person
                      on person.id = assignment.person_id
                    where t.id = training_task_id`,
              );
              s.defRecord(
                "display_attempt",
                sql`select att.id, att.status, att.outcome, att.attempt_number,
                       att.score_points, att.max_points, att.score_percent,
                       att.submitted_at, att.started_at,
                       (select ${employeeName(opts, sql`started_by`)}
                        from db.${sql.ref(personTable(opts))} started_by
                        where started_by.id = att.started_by_id)
                         as started_by_name,
                       (select ${employeeName(opts, sql`submitted_by`)}
                        from db.${sql.ref(personTable(opts))} submitted_by
                        where submitted_by.id = att.submitted_by_id)
                         as submitted_by_name,
                       v.passing_score_percent, v.outcome_override_allowed,
                       v.score_adjustment_allowed, v.version_label,
                       exists (
                         select 1
                         from db.training_assessment_responses response
                         join db.training_assessment_items item
                           on item.id = response.training_assessment_item_id
                         where response.training_assessment_attempt_id = att.id
                           and item.reviewer_signature_required
                       ) as requires_evaluator_signature
                    from db.training_assessment_attempts att
                    join db.training_assessment_versions v
                      on v.id = att.training_assessment_version_id
                    where att.training_employee_task_id = training_task_id
                      and att.status != 'cancelled'
                    order by att.attempt_number desc, att.id desc
                    limit 1`,
              );
              s.defTable(
                "attempt_metadata_responses",
                sql`select r.id as response_id, r.text_value, r.number_value,
                       r.date_value, r.selected_choice_id,
                       field.id as field_id, field.key as name, field.label,
                       field.type, field.required, field.ordinal,
                       field.help_text
                    from db.training_assessment_metadata_responses r
                    join db.training_assessment_metadata_fields field
                      on field.id = r.training_assessment_metadata_field_id
                    where r.training_assessment_attempt_id =
                      display_attempt.id
                    order by field.ordinal, field.id`,
              );
              s.defTable(
                "attempt_metadata_choices",
                sql`select choice.id, choice.label, choice.value,
                       choice.training_assessment_metadata_field_id
                         as field_id
                    from db.training_assessment_metadata_field_choices choice
                    join db.training_assessment_metadata_fields field
                      on field.id =
                        choice.training_assessment_metadata_field_id
                    where field.training_assessment_version_id = (
                        select att.training_assessment_version_id
                        from db.training_assessment_attempts att
                        where att.id = display_attempt.id
                      )
                    order by choice.sort_order, choice.id`,
              );
              s.defTable(
                "attempt_responses",
                sql`select r.id as response_id, r.text_response,
                       r.practical_result, r.measured_value, r.measured_unit,
                       r.notes, r.signature_name, r.signature_data,
                       r.points_awarded,
                       r.is_correct, r.review_status, r.include_in_score,
                       r.requires_review,
                       r.max_points as response_max_points,
                       item.id as item_id, item.type, item.prompt,
                       item.help_text, item.is_required, item.ordinal,
                       item.selection_mode, item.not_applicable_allowed,
                       section.name as section_name,
                       section.ordinal as section_ordinal
                    from db.training_assessment_responses r
                    join db.training_assessment_items item
                      on item.id = r.training_assessment_item_id
                    join db.training_assessment_sections section
                      on section.id = item.training_assessment_section_id
                    where r.training_assessment_attempt_id =
                      display_attempt.id
                    order by section.ordinal, item.ordinal, item.id`,
              );
              s.defTable(
                "attempt_choices",
                sql`select choice.id, choice.content,
                       choice.training_assessment_item_id as item_id,
                       exists (
                         select 1
                         from db.training_assessment_response_selected_choices sc
                         join db.training_assessment_responses r
                           on r.id = sc.training_assessment_response_id
                         where r.training_assessment_attempt_id =
                           display_attempt.id
                           and sc.training_assessment_item_choice_id =
                             choice.id
                       ) as selected
                    from db.training_assessment_item_choices choice
                    join db.training_assessment_items item
                      on item.id = choice.training_assessment_item_id
                    join db.training_assessment_sections section
                      on section.id = item.training_assessment_section_id
                    where section.training_assessment_version_id = (
                        select att.training_assessment_version_id
                        from db.training_assessment_attempts att
                        where att.id = display_attempt.id
                      )
                    order by choice.sort_order, choice.id`,
              );
              s.defTable(
                "task_attempt_history",
                sql`select att.id, att.attempt_number, att.status,
                       att.outcome, att.score_percent, att.started_at,
                       att.completed_at
                    from db.training_assessment_attempts att
                    where att.training_employee_task_id = training_task_id
                    order by att.attempt_number desc, att.id desc`,
              );
            }}
          >
            <Show when={sql`assessment_task.id is null`}>
              <EmptyState
                icon="Quiz"
                title="Assessment task not found"
                body="The task may have been removed or is not an assessment step."
              />
            </Show>
            <Show when={sql`assessment_task.id is not null`}>
              <Show when={sql`assessment_task_error is not null`}>
                <Alert color="danger" startIcon="Error">
                  {sql`assessment_task_error`}
                </Alert>
              </Show>
              <Card variant="outlined">
                <CardHeader>
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Typography level="title-lg" startIcon="Quiz">
                          {sql`assessment_task.assessment_name`}
                        </Typography>
                        {assessmentTaskStateChip(
                          sql`assessment_task.derived_state`,
                        )}
                        <Chip size="sm" variant="soft" color="neutral">
                          {assessmentExecutionModeLabelSql(
                            sql`assessment_task.execution_mode`,
                          )}
                        </Chip>
                      </div>
                      <Typography
                        level="body-sm"
                        className="text-neutral-600 mt-1"
                      >
                        {sql`assessment_task.person_name ||
                          ' · ' || assessment_task.step_content`}
                      </Typography>
                    </div>
                    <Show
                      when={sql`can_record_evaluations
                        and assessment_task.execution_mode =
                          'trainer_recorded'
                        and assessment_task.status in
                          ('assigned', 'in_progress')
                        and (display_attempt.id is null
                          or display_attempt.status not in
                            ('in_progress', 'review_pending'))
                        and assessment_task.derived_state != 'failed_final'`}
                    >
                      <Button
                        startIcon="PlayArrow"
                        onClick={(s) => {
                          s.setScalar("assessment_task_error", sql`null`);
                          s.tryServer({
                            body: (s) => {
                              s.callStoredProcedure(
                                "training_start_assessment_attempt",
                                {
                                  inputScalars: {
                                    p_task_id: sql`assessment_task.id`,
                                    p_access_token: sql`cast(null as string)`,
                                  },
                                },
                              );
                              s.refetch();
                            },
                            catch: (s) => {
                              s.setScalar(
                                "assessment_task_error",
                                sql
                                  .lit`The evaluation attempt could not be started.`,
                              );
                            },
                          });
                        }}
                      >
                        {sql`case
                          when assessment_task.has_attempt
                          then 'Start retake'
                          else 'Start evaluation'
                        end`}
                      </Button>
                    </Show>
                  </div>
                </CardHeader>
                <CardContent>
                  <Show when={sql`display_attempt.id is null`}>
                    <EmptyState
                      icon="PlayArrow"
                      title="Not started"
                      body="No attempt has been recorded for this assessment task yet."
                    />
                  </Show>
                  <Show when={sql`display_attempt.id is not null`}>
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <Chip size="sm" variant="soft" color="neutral">
                        {sql`'Attempt ' ||
                          display_attempt.attempt_number::string ||
                          ' · ' || display_attempt.version_label`}
                      </Chip>
                      <Chip size="sm" variant="soft" color="neutral">
                        {sql`case display_attempt.status::string
                          when 'in_progress' then 'In progress'
                          when 'review_pending' then 'Review pending'
                          when 'cancelled' then 'Cancelled'
                          else 'Complete'
                        end`}
                      </Chip>
                      <Show
                        when={sql`display_attempt.score_percent is not null`}
                      >
                        <Chip size="sm" variant="soft" color="neutral">
                          {sql`coalesce(display_attempt.score_points::string, '0')
                            || ' / ' ||
                            coalesce(display_attempt.max_points::string, '0')
                            || ' pts · ' ||
                            round(display_attempt.score_percent)::string
                            || '%' ||
                            coalesce(
                              ' (pass ' ||
                                display_attempt.passing_score_percent::string
                                || '%)',
                              ''
                            )`}
                        </Chip>
                      </Show>
                    </div>
                    <Typography
                      level="body-sm"
                      className="text-neutral-600 mb-4"
                    >
                      {sql`'Started by ' ||
                        coalesce(display_attempt.started_by_name, 'Unknown') ||
                        coalesce(
                          ' · Submitted by ' ||
                            display_attempt.submitted_by_name,
                          ''
                        )`}
                    </Typography>
                    <AssessmentMetadataResponseList
                      editableWhen={sql`display_attempt.status = 'in_progress'
                        and assessment_task.execution_mode =
                          'trainer_recorded'
                        and can_record_evaluations`}
                    />
                    <AssessmentResponseList
                      block={props.block}
                      editableWhen={sql`display_attempt.status = 'in_progress'
                        and assessment_task.execution_mode =
                          'trainer_recorded'
                        and can_record_evaluations`}
                    />
                    <Show
                      when={sql`display_attempt.status = 'in_progress'
                        and assessment_task.execution_mode =
                          'trainer_recorded'
                        and can_record_evaluations`}
                    >
                      <div className="flex justify-end mt-4">
                        <Button
                          startIcon="Done"
                          onClick={(s) => {
                            s.setScalar("assessment_task_error", sql`null`);
                            s.tryServer({
                              body: (s) => {
                                s.callStoredProcedure(
                                  "training_submit_assessment_attempt",
                                  {
                                    inputScalars: {
                                      p_attempt_id: sql`display_attempt.id`,
                                      p_access_token: sql`cast(null as string)`,
                                    },
                                  },
                                );
                                s.refetch();
                              },
                              catch: (s) => {
                                s.setScalar(
                                  "assessment_task_error",
                                  sql
                                    .lit`The evaluation could not be submitted. Check that every required item has a result.`,
                                );
                              },
                            });
                          }}
                        >
                          Submit evaluation
                        </Button>
                      </div>
                    </Show>
                    <AssessmentReviewPanel block={props.block} />
                  </Show>
                </CardContent>
              </Card>
              <Card variant="outlined">
                <CardHeader>
                  <Typography level="title-md" startIcon="History">
                    Attempt History
                  </Typography>
                </CardHeader>
                <CardContent>
                  <Each
                    table="task_attempt_history"
                    recordName="history_attempt"
                  >
                    <Typography level="body-sm" className="mb-1">
                      {sql`'Attempt ' ||
                        history_attempt.attempt_number::string || ' · ' ||
                        case history_attempt.status::string
                          when 'in_progress' then 'In progress'
                          when 'review_pending' then 'Review pending'
                          when 'cancelled' then 'Cancelled'
                          else case history_attempt.outcome::string
                            when 'passed' then 'Passed'
                            when 'failed' then 'Failed'
                            else 'Complete'
                          end
                        end ||
                        coalesce(' · ' ||
                          round(history_attempt.score_percent)::string ||
                          '%', '') ||
                        coalesce(' · ' || ${
                        formatDateTimeSql(sql`coalesce(
                          history_attempt.completed_at,
                          history_attempt.started_at
                        )`)
                      }, '')`}
                    </Typography>
                  </Each>
                </CardContent>
              </Card>
            </Show>
          </Data>
        </div>
      </TrainingAdminFrame>
      <AssessmentResponseReviewModal />
    </Data>
  );
}

function AssessmentResponseReviewModal() {
  const submitReview = (action: string) => (s: UiServerStatements) => {
    if (action === "adjust_score") {
      s.throwErrorIf(
        sql`try_cast(nullif(trim(ui.response_review_points), '') as double)
          is null`,
        sql.lit`Enter a valid response score.`,
      );
    }
    s.callStoredProcedure("training_review_assessment_response", {
      inputScalars: {
        p_response_id: sql`ui.response_review_id`,
        p_action: sql.lit(action),
        p_points_awarded: action === "adjust_score"
          ? sql`try_cast(trim(ui.response_review_points) as double)`
          : sql`null`,
        p_notes: sql`nullif(trim(ui.response_review_notes), '')`,
      },
    });
    s.setScalar("ui.response_review_open", sql`false`);
    s.setScalar("ui.response_review_id", sql`null`);
    s.setScalar("ui.response_review_points", sql.lit``);
    s.setScalar("ui.response_review_notes", sql.lit``);
    s.setScalar("ui.response_review_score_adjustment_allowed", sql`false`);
  };
  return (
    <ModalDialog bindScalar="response_review_open" maxWidth="sm">
      <Typography level="title-lg" startIcon="RateReview">
        Review response
      </Typography>
      <div className="grid gap-3 mt-4">
        <Show when={sql`response_review_score_adjustment_allowed`}>
          <FormControl>
            <FormLabel>Score</FormLabel>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                max={sql`response_review_max_points`}
                bindScalar="response_review_points"
                placeholder="0"
              />
              <Typography level="body-sm" className="text-neutral-600">
                {sql`'/ ' || response_review_max_points || ' pts'`}
              </Typography>
            </div>
          </FormControl>
        </Show>
        <FormControl>
          <FormLabel>Review notes</FormLabel>
          <Textarea bindScalar="response_review_notes" minRows={3} />
        </FormControl>
      </div>
      <div className="flex flex-wrap justify-end gap-2 mt-4">
        <Button
          variant="plain"
          color="neutral"
          onClick={(s) => s.setScalar("response_review_open", sql`false`)}
        >
          Cancel
        </Button>
        <Show when={sql`response_review_score_adjustment_allowed`}>
          <ActionButton
            variant="outlined"
            action={submitReview("adjust_score")}
            errorDisplay="inline"
          >
            Save score
          </ActionButton>
        </Show>
        <ActionButton
          variant="outlined"
          color="warning"
          disabled={sql`nullif(trim(response_review_notes), '') is null`}
          action={submitReview("request_changes")}
          errorDisplay="inline"
        >
          Request changes
        </ActionButton>
        <ActionButton
          variant="outlined"
          color="danger"
          action={submitReview("reject")}
          errorDisplay="inline"
        >
          Reject
        </ActionButton>
        <ActionButton
          color="success"
          action={submitReview("approve")}
          errorDisplay="inline"
        >
          Approve
        </ActionButton>
      </div>
    </ModalDialog>
  );
}

/**
 * Renders the responses of `display_attempt` (from the enclosing Data
 * scope), editable while `editableWhen` holds. Also used read-only when
 * reviewing.
 */
function AssessmentMetadataResponseList(props: { editableWhen: Sql }) {
  const saveMetadata = (
    s: UiServerStatements,
    field:
      | "textValue"
      | "numberValue"
      | "dateValue"
      | "selectedChoiceId",
    value: Sql,
  ) =>
    callSaveAssessmentMetadataResponse(s, {
      attemptId: sql`display_attempt.id`,
      fieldId: sql`metadata_response.field_id`,
      field,
      value,
    });
  return (
    <Show when={sql`exists (select 1 from attempt_metadata_responses)`}>
      <div className="border border-divider rounded-md p-4 bg-neutral-50 mb-4">
        <Typography level="title-sm" className="mb-3">
          Assessment details
        </Typography>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Each
            table="attempt_metadata_responses"
            recordName="metadata_response"
          >
            <FormControl>
              <FormLabel>
                {sql`metadata_response.label ||
                  case when metadata_response.required
                    then '' else ' (optional)' end`}
              </FormLabel>
              <Show when={sql`metadata_response.help_text is not null`}>
                <Typography level="body-xs" className="text-neutral-600 mb-1">
                  {sql`metadata_response.help_text`}
                </Typography>
              </Show>
              <Show
                when={props.editableWhen}
                fallback={
                  <Typography level="body-sm">
                    {sql`case metadata_response.type::string
                      when 'text' then coalesce(
                        metadata_response.text_value, 'Not recorded')
                      when 'number' then coalesce(
                        metadata_response.number_value::string,
                        'Not recorded')
                      when 'date' then coalesce(
                        ${formatDateSql(sql`metadata_response.date_value`)},
                        'Not recorded')
                      else coalesce((
                        select choice.label
                        from attempt_metadata_choices choice
                        where choice.id =
                          metadata_response.selected_choice_id
                      ), 'Not recorded')
                    end`}
                  </Typography>
                }
              >
                <Show when={sql`metadata_response.type = 'text'`}>
                  <Input
                    value={sql`coalesce(metadata_response.text_value, '')`}
                    onInput={(s) => {
                      s.tryServer({
                        body: (s) => {
                          saveMetadata(s, "textValue", sql`target_value`);
                        },
                      });
                    }}
                  />
                </Show>
                <Show when={sql`metadata_response.type = 'number'`}>
                  <Input
                    type="number"
                    value={sql`coalesce(metadata_response.number_value::string, '')`}
                    onInput={(s) => {
                      s.tryServer({
                        body: (s) => {
                          saveMetadata(
                            s,
                            "numberValue",
                            sql`try_cast(target_value as double)`,
                          );
                        },
                      });
                    }}
                  />
                </Show>
                <Show when={sql`metadata_response.type = 'date'`}>
                  <Input
                    type="date"
                    value={sql`coalesce(metadata_response.date_value::string, '')`}
                    onInput={(s) => {
                      s.tryServer({
                        body: (s) => {
                          saveMetadata(
                            s,
                            "dateValue",
                            sql`try_cast(target_value as date)`,
                          );
                        },
                      });
                    }}
                  />
                </Show>
                <Show when={sql`metadata_response.type = 'single_choice'`}>
                  <Select
                    className={adminSelectClass}
                    value={sql`coalesce(
                      metadata_response.selected_choice_id::string, '')`}
                    onInput={(s) => {
                      s.tryServer({
                        body: (s) => {
                          saveMetadata(
                            s,
                            "selectedChoiceId",
                            sql`case
                              when nullif(target_value, '') is null then null
                              else target_value::bigint
                            end`,
                          );
                          s.refetch();
                        },
                      });
                    }}
                  >
                    <Select.Option value="">Not recorded</Select.Option>
                    <Each
                      table="attempt_metadata_choices"
                      recordName="metadata_choice"
                      where={sql`metadata_choice.field_id =
                        metadata_response.field_id`}
                    >
                      <Select.Option value={sql`metadata_choice.id::string`}>
                        {sql`metadata_choice.label`}
                      </Select.Option>
                    </Each>
                  </Select>
                </Show>
              </Show>
            </FormControl>
          </Each>
        </div>
      </div>
    </Show>
  );
}

function AssessmentResponseList(
  props: { block: TrainingBlock; editableWhen: Sql },
) {
  const saveResponse = (
    s: UiServerStatements,
    field:
      | "textResponse"
      | "practicalResult"
      | "measuredValue"
      | "measuredUnit"
      | "notes"
      | "signatureName"
      | "signatureData",
    value: Sql,
  ) =>
    callSaveAssessmentResponse(s, {
      attemptId: sql`display_attempt.id`,
      itemId: sql`attempt_response.item_id`,
      field,
      value,
    });
  return (
    <div className="flex flex-col gap-3">
      <Each table="attempt_responses" recordName="attempt_response">
        <div className="border border-divider rounded-md p-4 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Typography level="body-sm" className="text-neutral-500">
                {sql`attempt_response.section_name`}
              </Typography>
              <Typography level="title-sm">
                {sql`attempt_response.prompt ||
                  case when attempt_response.is_required
                    then '' else ' (optional)' end`}
              </Typography>
              <Show when={sql`attempt_response.help_text is not null`}>
                <Typography level="body-sm" className="text-neutral-600">
                  {sql`attempt_response.help_text`}
                </Typography>
              </Show>
            </div>
            <Show
              when={sql`display_attempt.status != 'in_progress'
                and attempt_response.include_in_score`}
            >
              <Chip size="sm" variant="soft" color="neutral">
                {sql`coalesce(attempt_response.points_awarded::string, '—')
                  || ' / ' ||
                  attempt_response.response_max_points::string || ' pts'`}
              </Chip>
            </Show>
          </div>
          <div className="mt-3">
            <Show when={sql`attempt_response.type = 'multiple_choice'`}>
              <div className="flex flex-col gap-1">
                <Each
                  table="attempt_choices"
                  recordName="attempt_choice"
                  where={sql`attempt_choice.item_id =
                    attempt_response.item_id`}
                >
                  <Show
                    when={props.editableWhen}
                    fallback={
                      <Typography level="body-sm">
                        {sql`case when attempt_choice.selected
                          then '☑ ' else '☐ ' end ||
                          attempt_choice.content`}
                      </Typography>
                    }
                  >
                    <Checkbox
                      checked={sql`attempt_choice.selected`}
                      label={sql`attempt_choice.content`}
                      onCheckboxChange={(s) => {
                        s.setScalar("ui.assessment_task_error", sql`null`);
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            s.if(
                              sql`attempt_response.selection_mode = 'single'`,
                              (s) => {
                                for (
                                  const statement
                                    of selectAssessmentSingleChoiceSql({
                                      attemptId: sql`display_attempt.id`,
                                      itemId: sql`attempt_response.item_id`,
                                      choiceId: sql`attempt_choice.id`,
                                    })
                                ) {
                                  s.modify(statement);
                                }
                              },
                              (s) => {
                                s.if(
                                  sql`target_checked`,
                                  (s) => {
                                    s.modify(
                                      insertAssessmentChoiceSelectionSql({
                                        attemptId: sql`display_attempt.id`,
                                        itemId: sql`attempt_response.item_id`,
                                        choiceId: sql`attempt_choice.id`,
                                      }),
                                    );
                                  },
                                  (s) => {
                                    s.modify(
                                      deleteAssessmentChoiceSelectionSql({
                                        attemptId: sql`display_attempt.id`,
                                        itemId: sql`attempt_response.item_id`,
                                        choiceId: sql`attempt_choice.id`,
                                      }),
                                    );
                                  },
                                );
                              },
                            );
                            s.commitTransaction();
                            s.refetch();
                          },
                          catch: (s) => {
                            s.setScalar(
                              "ui.assessment_task_error",
                              sql.lit`The answer could not be saved.`,
                            );
                            s.refetch();
                          },
                        });
                      }}
                    />
                  </Show>
                </Each>
              </div>
            </Show>
            <Show when={sql`attempt_response.type = 'text_response'`}>
              <Show
                when={props.editableWhen}
                fallback={
                  <Typography level="body-sm" className="whitespace-pre-wrap">
                    {sql`coalesce(attempt_response.text_response,
                      'No response.')`}
                  </Typography>
                }
              >
                <Textarea
                  value={sql`coalesce(attempt_response.text_response, '')`}
                  minRows={3}
                  onInput={(s) => {
                    s.tryServer({
                      body: (s) => {
                        saveResponse(s, "textResponse", sql`target_value`);
                      },
                    });
                  }}
                />
              </Show>
              <Show
                when={sql`display_attempt.status = 'review_pending'
                  and can_review_assessments
                  and attempt_response.requires_review`}
              >
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outlined"
                    startIcon="RateReview"
                    onClick={(s) => {
                      s.setScalar(
                        "response_review_id",
                        sql`attempt_response.response_id`,
                      );
                      s.setScalar(
                        "response_review_points",
                        sql`coalesce(
                          attempt_response.points_awarded::string, '')`,
                      );
                      s.setScalar(
                        "response_review_max_points",
                        sql`attempt_response.response_max_points::string`,
                      );
                      s.setScalar(
                        "response_review_score_adjustment_allowed",
                        sql`display_attempt.score_adjustment_allowed`,
                      );
                      s.setScalar("response_review_notes", sql.lit``);
                      s.setScalar("response_review_open", sql`true`);
                    }}
                  >
                    Review response
                  </Button>
                  <Chip size="sm" variant="soft" color="neutral">
                    {sql`case coalesce(attempt_response.review_status::string, 'pending')
                      when 'approved' then 'Approved'
                      when 'rejected' then 'Rejected'
                      when 'changes_requested' then 'Changes requested'
                      else 'Pending review'
                    end`}
                  </Chip>
                </div>
              </Show>
            </Show>
            <Show when={sql`attempt_response.type = 'practical_observation'`}>
              <Show
                when={props.editableWhen}
                fallback={
                  <Typography level="body-sm">
                    {sql`'Result: ' ||
                      coalesce(
                        case attempt_response.practical_result::string
                          when 'pass' then 'Pass'
                          when 'fail' then 'Fail'
                          when 'not_observed' then 'Not observed'
                          when 'not_applicable' then 'Not applicable'
                          else null
                        end, 'Not recorded'
                      ) ||
                      coalesce(' · ' || attempt_response.measured_value ||
                        coalesce(' ' || attempt_response.measured_unit, ''),
                        '') ||
                      coalesce(' · ' || attempt_response.notes, '')`}
                  </Typography>
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormControl>
                    <FormLabel>Result</FormLabel>
                    <Select
                      className={adminSelectClass}
                      value={sql`coalesce(
                        attempt_response.practical_result::string, '')`}
                      onInput={(s) => {
                        s.tryServer({
                          body: (s) => {
                            saveResponse(
                              s,
                              "practicalResult",
                              sql`nullif(target_value, '')`,
                            );
                            s.refetch();
                          },
                        });
                      }}
                    >
                      <Select.Option value="">Not recorded</Select.Option>
                      <Select.Option value="pass">Pass</Select.Option>
                      <Select.Option value="fail">Fail</Select.Option>
                      <Select.Option value="not_observed">
                        Not observed
                      </Select.Option>
                      <Show
                        when={sql`attempt_response.not_applicable_allowed`}
                      >
                        <Select.Option value="not_applicable">
                          Not applicable
                        </Select.Option>
                      </Show>
                    </Select>
                  </FormControl>
                  <Show
                    when={sql`display_attempt.score_adjustment_allowed
                    and attempt_response.include_in_score
                    and attempt_response.response_max_points > 0`}
                  >
                    <FormControl>
                      <FormLabel>Score</FormLabel>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          max={sql`attempt_response.response_max_points::string`}
                          value={sql`coalesce(
                            attempt_response.points_awarded::string, '')`}
                          placeholder="Auto"
                          onInput={(s) => {
                            s.setScalar(
                              "ui.assessment_task_error",
                              sql`null`,
                            );
                            s.tryServer({
                              body: (s) => {
                                s.startTransaction();
                                saveAssessmentResponseManualScore(s, {
                                  attemptId: sql`display_attempt.id`,
                                  itemId: sql`attempt_response.item_id`,
                                  pointsAwarded: sql`case
                                    when nullif(trim(target_value), '')
                                      is null then null
                                    else
                                      nullif(trim(target_value), '')::double
                                  end`,
                                });
                                s.commitTransaction();
                              },
                              catch: (s) => {
                                s.setScalar(
                                  "ui.assessment_task_error",
                                  sql
                                    .lit`The response score could not be saved.`,
                                );
                                s.refetch();
                              },
                            });
                          }}
                        />
                        <Typography
                          level="body-sm"
                          className="text-neutral-600"
                        >
                          {sql`'/ ' ||
                            attempt_response.response_max_points::string ||
                            ' pts'`}
                        </Typography>
                      </div>
                      <Typography level="body-xs" className="text-neutral-500">
                        Leave empty to score from the result.
                      </Typography>
                    </FormControl>
                  </Show>
                  <FormControl>
                    <FormLabel>Measured value</FormLabel>
                    <div className="flex gap-2">
                      <Input
                        value={sql`coalesce(
                          attempt_response.measured_value, '')`}
                        placeholder="Value"
                        onInput={(s) => {
                          s.tryServer({
                            body: (s) => {
                              saveResponse(
                                s,
                                "measuredValue",
                                sql`target_value`,
                              );
                            },
                          });
                        }}
                      />
                      <Input
                        value={sql`coalesce(
                          attempt_response.measured_unit, '')`}
                        placeholder="Unit"
                        onInput={(s) => {
                          s.tryServer({
                            body: (s) => {
                              saveResponse(
                                s,
                                "measuredUnit",
                                sql`target_value`,
                              );
                            },
                          });
                        }}
                      />
                    </div>
                  </FormControl>
                  <FormControl className="md:col-span-2">
                    <FormLabel>Notes</FormLabel>
                    <Input
                      value={sql`coalesce(attempt_response.notes, '')`}
                      placeholder="Observations"
                      onInput={(s) => {
                        s.tryServer({
                          body: (s) => {
                            saveResponse(s, "notes", sql`target_value`);
                          },
                        });
                      }}
                    />
                  </FormControl>
                </div>
              </Show>
            </Show>
            <Show when={sql`attempt_response.type = 'signature'`}>
              <Show
                when={props.editableWhen}
                fallback={
                  <div>
                    <Typography level="body-sm">
                      {sql`coalesce('Signed: ' ||
                        attempt_response.signature_name, 'Not signed.')`}
                    </Typography>
                    <Show
                      when={sql`attempt_response.signature_data is not null`}
                    >
                      <img
                        src={sql`attempt_response.signature_data`}
                        alt="Signature"
                        className="mt-2 max-h-24 border border-divider rounded-md bg-white"
                      />
                    </Show>
                  </div>
                }
              >
                <SignaturePad
                  label="Draw signature"
                  onSigned={(s, signatureData) => {
                    s.tryServer({
                      body: (s) => {
                        saveResponse(
                          s,
                          "signatureName",
                          sql`(
                            select ${
                            employeeName(
                              props.block.opts,
                              sql`signature_person`,
                            )
                          }
                            from db.${
                            sql.ref(personTable(props.block.opts))
                          } signature_person
                            where signature_person.id = ${
                            currentEmployeeId(props.block.opts)
                          }
                          )`,
                        );
                        saveResponse(s, "signatureData", signatureData);
                        s.refetch();
                      },
                    });
                  }}
                />
              </Show>
            </Show>
          </div>
        </div>
      </Each>
    </div>
  );
}

function AssessmentReviewPanel(_props: { block: TrainingBlock }) {
  const runReview = (action: string) => (s: DomStatements) => {
    s.setScalar("ui.assessment_task_error", sql`null`);
    s.tryServer({
      body: (s) => {
        // Permission checks, the review decision, task/assignment
        // finalization, and certification creation all run atomically
        // inside the stored procedure.
        s.callStoredProcedure("training_decide_assessment_attempt", {
          inputScalars: {
            p_attempt_id: sql`display_attempt.id`,
            p_action: sql.lit(action),
            p_notes: sql`nullif(trim(ui.review_notes), '')`,
            p_override_reason: sql`nullif(trim(ui.review_override_reason), '')`,
            p_signature_data: sql`ui.review_signature_data`,
          },
        });
        s.setScalar("ui.review_notes", sql.lit``);
        s.setScalar("ui.review_override_reason", sql.lit``);
        s.setScalar("ui.review_signature_data", sql`null`);
        s.refetch();
      },
      catch: (s) => {
        s.setScalar(
          "ui.assessment_task_error",
          sql.lit`The review action could not be applied.`,
        );
      },
    });
  };
  return (
    <Show
      when={sql`(can_review_assessments
          or can_override_assessment_outcomes
          or can_record_evaluations)
        and (
          display_attempt.status = 'review_pending'
          or (
            display_attempt.status = 'complete'
            and display_attempt.outcome = 'failed'
          )
          or display_attempt.status = 'in_progress'
        )`}
    >
      <div className="border border-divider rounded-md p-4 mt-4 bg-neutral-50">
        <Typography level="title-sm" startIcon="RateReview">
          Review
        </Typography>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <FormControl>
            <FormLabel>Notes</FormLabel>
            <Textarea bindScalar="review_notes" minRows={2} />
          </FormControl>
          <FormControl>
            <FormLabel>Override reason</FormLabel>
            <Textarea
              bindScalar="review_override_reason"
              minRows={2}
              placeholder="Required for overrides"
            />
          </FormControl>
        </div>
        <Show when={sql`display_attempt.requires_evaluator_signature`}>
          <div className="mt-3">
            <SignaturePad
              label="Evaluator signature"
              onSigned={(s, signatureData) => {
                s.setScalar("review_signature_data", signatureData);
              }}
            />
            <Show when={sql`review_signature_data is not null`}>
              <Chip size="sm" variant="soft" color="success">
                Evaluator signature captured
              </Chip>
            </Show>
          </div>
        </Show>
        <div className="flex flex-wrap gap-2 mt-3">
          <Show
            when={sql`can_review_assessments
              and display_attempt.status = 'review_pending'`}
          >
            <Button
              color="success"
              startIcon="Check"
              onClick={runReview("approve")}
            >
              Approve
            </Button>
            <Button
              color="danger"
              variant="outlined"
              startIcon="Close"
              onClick={runReview("fail")}
            >
              Fail
            </Button>
          </Show>
          <Show
            when={sql`(can_review_assessments
                or can_override_assessment_outcomes)
              and display_attempt.status in ('review_pending', 'complete')
              and not (display_attempt.status = 'complete'
                and display_attempt.outcome = 'passed')`}
          >
            <Button
              variant="outlined"
              color="neutral"
              startIcon="Replay"
              onClick={runReview("request_retake")}
            >
              Request retake
            </Button>
          </Show>
          <Show
            when={sql`can_override_assessment_outcomes
              and display_attempt.outcome_override_allowed
              and display_attempt.status in ('review_pending', 'complete')`}
          >
            <Button
              variant="outlined"
              color="success"
              startIcon="Verified"
              onClick={runReview("pass_override")}
            >
              Pass override
            </Button>
            <Button
              variant="outlined"
              color="danger"
              startIcon="Block"
              onClick={runReview("fail_override")}
            >
              Fail override
            </Button>
          </Show>
          <Show
            when={sql`(can_review_assessments or can_record_evaluations)
              and display_attempt.status in
                ('in_progress', 'review_pending')`}
          >
            <Button
              variant="plain"
              color="danger"
              startIcon="Cancel"
              onClick={runReview("cancel")}
            >
              Cancel attempt
            </Button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
