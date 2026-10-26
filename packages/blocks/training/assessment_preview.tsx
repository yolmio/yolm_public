import { Alert } from "components/alert";
import { Button } from "components/button";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "./index.tsx";
import {
  EmployeeAssessmentMetadataResponses,
  EmployeeAssessmentResponses,
} from "./assessment_responses";
import {
  assessmentItemRequiresReviewSql,
  assessmentRequiredAnswerMissingSql,
  assessmentRequiredMetadataMissingSql,
  assessmentVersionPublishIssuesSql,
  multipleChoiceExactMatchSql,
  multipleChoicePointsSql,
} from "./assessment_helpers";
import { activeAssessmentVersionSql } from "./helpers";

/** The learner's answer controls, backed exclusively by transient UI tables. */
export function TrainingAssessmentPreview(props: { block: TrainingBlock }) {
  return (
    <Data
      noRefetch
      watch={[sql`preview_restart`, sql`preview_language`]}
      procedure={(s) => {
        s.defScalar("assessment_error", { type: "String" });
        s.defRecord(
          "assessment_task",
          sql`
        select a.id, a.name as assessment_name, a.execution_mode,
          ui.preview_language as employee_language,
          cast(null as bigint) as person_id,
          coalesce((select v.id from db.training_assessment_versions v
            where v.training_assessment_id = a.id and v.status = 'draft' and v.language = ui.preview_language
            order by v.id desc limit 1),
            ${
            activeAssessmentVersionSql(sql`a.id`, sql`ui.preview_language`)
          }) as version_id
        from db.training_assessments a where a.id = course_task.training_assessment_id
      `,
        );
        s.defRecord(
          "display_attempt",
          sql`
        select id, 'in_progress'::string as status, 'pending'::string as outcome,
          false as approval_simulated,
          version_label, localized_name, status = 'draft' as is_draft, passing_score_percent,
          show_correct_answers_after_submission, show_failed_attempts_to_employee,
          cast(null as double) as score_points, cast(null as double) as max_points,
          cast(null as double) as score_percent
        from db.training_assessment_versions where id = assessment_task.version_id
      `,
        );
        s.defTable(
          "assessment_issues",
          assessmentVersionPublishIssuesSql(sql`assessment_task.version_id`),
        );
        s.defTable(
          "assessment_responses",
          sql`
        select item.id as item_id, item.id as response_id, item.type, item.prompt,
          item.help_text, item.is_required, item.selection_mode, item.scoring_mode,
          item.explanation, item.remediation_text, item.include_in_score,
          ${assessmentItemRequiresReviewSql(sql`item`)} as requires_review,
          item.practical_result_required, item.points as response_max_points,
          section.name as section_name, section.ordinal as section_ordinal,
          cast(null as string) as text_response, cast(null as string) as signature_name,
          cast(null as string) as signature_data, cast(null as string) as practical_result,
          cast(null as double) as points_awarded, cast(null as bool) as is_correct
        from db.training_assessment_items item
        join db.training_assessment_sections section on section.id = item.training_assessment_section_id
        where section.training_assessment_version_id = assessment_task.version_id
        order by section.ordinal, item.ordinal, item.id
      `,
        );
        s.defTable(
          "assessment_choices",
          sql`
        select choice.id, choice.training_assessment_item_id as item_id,
          choice.content, choice.is_correct, choice.explanation, false as selected
        from db.training_assessment_item_choices choice
        where choice.training_assessment_item_id in (select item_id from assessment_responses)
        order by choice.sort_order, choice.id
      `,
        );
        s.defTable(
          "assessment_metadata_responses",
          sql`
        select id as field_id, id as response_id, label, type, required, help_text,
          cast(null as string) as text_value, cast(null as double) as number_value, ''::string as number_text,
          cast(null as date) as date_value, cast(null as bigint) as selected_choice_id
        from db.training_assessment_metadata_fields
        where training_assessment_version_id = assessment_task.version_id
        order by ordinal, id
      `,
        );
        s.defTable(
          "assessment_metadata_choices",
          sql`
        select id, training_assessment_metadata_field_id as field_id, label, value
        from db.training_assessment_metadata_field_choices
        where training_assessment_metadata_field_id in (select field_id from assessment_metadata_responses)
        order by sort_order, id
      `,
        );
      }}
    >
      <div className="mt-3 flex flex-col gap-3">
        <Show
          when={sql`display_attempt.id is not null`}
          fallback={
            <Alert color="warning">
              This assessment has no version to preview. Add its questions in
              the assessment editor.
            </Alert>
          }
        >
          <Typography level="title-sm">
            {sql`coalesce(display_attempt.localized_name, assessment_task.assessment_name) || ' · ' || display_attempt.version_label`}
          </Typography>
          <Show when={sql`display_attempt.is_draft`}>
            <Alert color="warning">
              You are testing an assessment draft. Publish this assessment
              separately before assigning the course; employees receive its
              published version.
            </Alert>
          </Show>
          <Each table="assessment_issues" recordName="assessment_issue">
            <Alert color="warning">{sql`assessment_issue.issue`}</Alert>
          </Each>
          <Show when={sql`assessment_error is not null`}>
            <Alert color="danger">{sql`assessment_error`}</Alert>
          </Show>
          <Show when={sql`assessment_task.execution_mode = 'trainer_recorded'`}>
            <Alert color="neutral">
              A trainer records this evaluation. Employees cannot enter answers
              here.
            </Alert>
          </Show>
          <Show
            when={sql`display_attempt.outcome != 'failed' or display_attempt.show_failed_attempts_to_employee`}
            fallback={
              <Alert color="neutral">
                The details of this failed attempt are not shown.
              </Alert>
            }
          >
            <EmployeeAssessmentMetadataResponses preview />
            <EmployeeAssessmentResponses block={props.block} preview />
          </Show>
          <Show
            when={sql`display_attempt.status = 'in_progress' and assessment_task.execution_mode != 'trainer_recorded'`}
          >
            <Button
              onClick={(s) => {
                s.setScalar("assessment_error", sql`null`);
                s.if(
                  sql`exists (select 1 from ui.assessment_responses r where ${
                    assessmentRequiredAnswerMissingSql(
                      sql`r`,
                      sql`r`,
                      sql`exists (select 1 from ui.assessment_choices c where c.item_id = r.item_id and c.selected)`,
                    )
                  })`,
                  (s) => {
                    s.setScalar(
                      "assessment_error",
                      sql
                        .lit`Every required question needs an answer before submitting.`,
                    );
                    s.return();
                  },
                );
                s.if(
                  sql`exists (select 1 from ui.assessment_metadata_responses r where ${
                    assessmentRequiredMetadataMissingSql(sql`r`, sql`r`)
                  })`,
                  (s) => {
                    s.setScalar(
                      "assessment_error",
                      sql
                        .lit`Every required assessment detail needs a value before submitting.`,
                    );
                    s.return();
                  },
                );
                s.defTable(
                  "preview_grades",
                  sql`
                select r.item_id as response_item_id, r.response_max_points as item_points,
                  r.scoring_mode = 'partial_credit' as partial_credit,
                  (select count(*) from ui.assessment_choices c where c.item_id = r.item_id and c.is_correct) as correct_choice_count,
                  (select count(*) from ui.assessment_choices c where c.item_id = r.item_id and c.is_correct and c.selected) as correct_selected_count,
                  (select count(*) from ui.assessment_choices c where c.item_id = r.item_id and not c.is_correct and c.selected) as incorrect_selected_count
                from ui.assessment_responses r where r.type = 'multiple_choice'
              `,
                );
                s.forEachTable("preview_grades", "preview_grade", (s) => {
                  s.modify(sql`update ui.assessment_responses set
                    points_awarded = ${
                    multipleChoicePointsSql(sql`preview_grade`)
                  },
                    is_correct = ${
                    multipleChoiceExactMatchSql(sql`preview_grade`)
                  }
                    where item_id = preview_grade.response_item_id`);
                });
                s.modify(
                  sql`update ui.assessment_responses set points_awarded = response_max_points, is_correct = true
                where type = 'signature' and (signature_data is not null or nullif(trim(signature_name), '') is not null)`,
                );
                s.modify(sql`update ui.display_attempt set
                score_points = (select round(coalesce(sum(coalesce(points_awarded, 0)), 0), 2) from ui.assessment_responses where include_in_score),
                max_points = (select coalesce(sum(response_max_points), 0) from ui.assessment_responses where include_in_score)`);
                s.modify(
                  sql`update ui.display_attempt set score_percent = case when max_points = 0 then null else score_points / max_points * 100 end`,
                );
                s.modify(sql`update ui.display_attempt set status = case
                when ui.assessment_task.execution_mode = 'employee_submission_with_review'
                  or exists (select 1 from ui.assessment_responses where requires_review)
                then 'review_pending' else 'complete' end`);
                s.modify(sql`update ui.display_attempt set outcome = case
                when status = 'review_pending' then 'pending'
                when max_points > 0 and coalesce(score_percent, 0) < coalesce(nullif(passing_score_percent, 0), 100) then 'failed' else 'passed' end`);
                s.modify(sql`update ui.course_tasks set assessment_state = case
                when ui.display_attempt.status = 'review_pending' then 'review_pending'
                when ui.display_attempt.outcome = 'passed' then 'passed' else 'failed_retake_available' end,
                status = case when ui.display_attempt.status = 'complete' and ui.display_attempt.outcome = 'passed' then 'completed' else 'in_progress' end
                where id = course_task.id`);
                s.modify(
                  sql`update ui.course_assignment set done_tasks = (select count(*) from ui.course_tasks where status = 'completed')`,
                );
              }}
            >
              Submit assessment
            </Button>
          </Show>
          <Show when={sql`display_attempt.status = 'complete'`}>
            <Alert color="neutral">
              {sql`case when display_attempt.approval_simulated
                then 'Trainer approval simulated. No review request was created.'
                else case when display_attempt.outcome = 'passed' then 'Preview passed.' else 'Preview did not pass.' end ||
                case when display_attempt.max_points > 0 and (display_attempt.outcome != 'failed' or display_attempt.show_failed_attempts_to_employee) then ' Score: ' || round(display_attempt.score_percent)::string || '%.' else '' end end`}
            </Alert>
          </Show>
          <Show when={sql`display_attempt.status = 'review_pending'`}>
            <Alert color="neutral">
              This submission would wait for trainer review. No review request
              was created.
            </Alert>
          </Show>
          <Show
            when={sql`display_attempt.status = 'review_pending' or
              (assessment_task.execution_mode = 'trainer_recorded' and display_attempt.status = 'in_progress')`}
          >
            <Button
              variant="outlined"
              disabled={sql`course_task.status = 'completed'`}
              onClick={(s) => {
                s.modify(
                  sql`update ui.display_attempt set status = 'complete', outcome = 'passed', approval_simulated = true`,
                );
                s.modify(
                  sql`update ui.course_tasks set status = 'completed', assessment_state = 'passed' where id = course_task.id`,
                );
                s.modify(
                  sql`update ui.course_assignment set done_tasks = (select count(*) from ui.course_tasks where status = 'completed')`,
                );
              }}
            >
              Simulate trainer approval
            </Button>
          </Show>
          <Show
            when={sql`display_attempt.status != 'in_progress' and course_assignment.employee_final_signed_at is null
              and course_assignment.status in ('pending', 'in_progress')`}
          >
            <Button
              variant="plain"
              onClick={(s) => {
                s.modify(
                  sql`update ui.display_attempt set status = 'in_progress', outcome = 'pending', approval_simulated = false, score_points = null, max_points = null, score_percent = null`,
                );
                s.modify(
                  sql`update ui.assessment_responses set text_response = null, signature_name = null, signature_data = null, points_awarded = null, is_correct = null`,
                );
                s.modify(
                  sql`update ui.assessment_choices set selected = false`,
                );
                s.modify(
                  sql`update ui.assessment_metadata_responses set text_value = null, number_text = '', number_value = null, date_value = null, selected_choice_id = null`,
                );
                s.modify(
                  sql`update ui.course_tasks set status = 'assigned', assessment_state = 'not_started' where id = course_task.id`,
                );
                s.modify(
                  sql`update ui.course_assignment set done_tasks = (select count(*) from ui.course_tasks where status = 'completed')`,
                );
              }}
            >
              Retry assessment preview
            </Button>
          </Show>
        </Show>
      </div>
    </Data>
  );
}
