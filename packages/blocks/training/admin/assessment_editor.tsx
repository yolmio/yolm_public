import {
  translationApprovedSql,
  translationReviewLockedSql,
} from "../translation_reviews";
import {
  TrainingLanguageControls,
  TrainingLanguageSwitch,
} from "./language_controls";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { ModalDialog } from "components/modal";
import { Select } from "components/select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { currentUserHasPermission } from "blocks/auth";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { Each, Show } from "std/ui";
import { assessmentVersionPublishIssuesSql } from "../assessment_helpers";
import {
  activeAssessmentVersionSql,
  employeeName,
  formatDateTimeSql,
  trainingPermissions,
  versionStatusChip,
} from "../helpers";
import type { TrainingBlock } from "../index.tsx";
import { BackLink, EmptyState } from "../shared";
import {
  assessmentExecutionModeLabelSql,
  assessmentKindChip,
} from "./assessments";
import {
  adminAssessmentsHref,
  adminAssessmentTaskHref,
  adminSelectClass,
  TrainingAdminFrame,
} from "./shared";

function draftAssessmentVersionSql(assessmentId: Sql) {
  return sql`(
    select v.id
    from db.training_assessment_versions v
    where v.training_assessment_id = ${assessmentId}
      and v.status = 'draft' and v.language = ui.editor_language
    order by v.id desc
    limit 1
  )`;
}

function publishedAssessmentVersionSql(assessmentId: Sql) {
  return activeAssessmentVersionSql(
    assessmentId,
    sql`ui.editor_language`,
    true,
  );
}

function editorAssessmentVersionSql(assessmentId: Sql) {
  return sql`coalesce(
    ${draftAssessmentVersionSql(assessmentId)},
    ${publishedAssessmentVersionSql(assessmentId)}
  )`;
}

/**
 * Copy-on-write draft creation via the `training_ensure_assessment_draft`
 * stored procedure: published and archived assessment versions are
 * immutable, so every edit action first ensures a draft version exists,
 * cloning the published version's policy, sections, items, and choices.
 * Declares `draft_assessment_version_id` in the current scope.
 */
function ensureAssessmentDraftVersion(
  s: UiServerStatements,
  args: { block: TrainingBlock; assessmentId: Sql },
) {
  s.callStoredProcedure("training_ensure_assessment_draft_language", {
    inputScalars: {
      p_assessment_id: args.assessmentId,
      p_language: sql`ui.editor_language`,
      p_source_version: sql`null`,
    },
    outputScalars: {
      draft_assessment_version_id: "draft_assessment_version_id",
    },
  });
}

/**
 * Maps a section shown in the editor (possibly from the published version)
 * to its row in the draft version via the stable clone key. Run after
 * ensureAssessmentDraftVersion. Rows created before `source_section_id`
 * existed have null keys and simply match nothing.
 */
function mapSectionToDraftSql(sectionId: Sql) {
  return sql`coalesce(
    (
      select section.id
      from db.training_assessment_sections section
      where section.id = ${sectionId}
        and section.training_assessment_version_id =
          draft_assessment_version_id
    ),
    (
      select new_section.id
      from db.training_assessment_sections new_section
      where new_section.training_assessment_version_id =
          draft_assessment_version_id
        and new_section.source_section_id = ${sectionId}
      limit 1
    )
  )`;
}

/** Same mapping for items. Run after ensureAssessmentDraftVersion. */
function mapItemToDraftSql(itemId: Sql) {
  return sql`coalesce(
    (
      select item.id
      from db.training_assessment_items item
      join db.training_assessment_sections section
        on section.id = item.training_assessment_section_id
      where item.id = ${itemId}
        and section.training_assessment_version_id =
          draft_assessment_version_id
    ),
    (
      select new_item.id
      from db.training_assessment_items new_item
      join db.training_assessment_sections new_section
        on new_section.id = new_item.training_assessment_section_id
      where new_section.training_assessment_version_id =
          draft_assessment_version_id
        and new_item.source_item_id = ${itemId}
      limit 1
    )
  )`;
}

function mapMetadataFieldToDraftSql(fieldId: Sql) {
  return sql`coalesce(
    (
      select field.id
      from db.training_assessment_metadata_fields field
      where field.id = ${fieldId}
        and field.training_assessment_version_id =
          draft_assessment_version_id
    ),
    (
      select new_field.id
      from db.training_assessment_metadata_fields old_field
      join db.training_assessment_metadata_fields new_field
        on new_field.training_assessment_version_id =
          draft_assessment_version_id
       and new_field.key = old_field.key
      where old_field.id = ${fieldId}
      limit 1
    )
  )`;
}

export function TrainingAdminAssessmentPage(
  props: { block: TrainingBlock },
) {
  const permissions = trainingPermissions;
  return (
    <Data
      queryParams={{
        content_language: {
          default: sql.lit(props.block.opts.content.opts.defaultLanguage),
          type: "String",
        },
      }}
    >
      <Data
        local
        watch={[sql`content_language`]}
        hoistKey={sql`content_language`}
        procedure={(s) => {
          s.defScalar("editor_language", sql`content_language`);
          s.defScalar("language_details_open", false);
          s.defScalar("assessment_edit_error", {
            type: { type: "String", maxLength: 1000 },
          });
          s.defScalar("assessment_settings_open", sql`false`);
          s.defScalar("settings_name", sql.lit``);
          s.defScalar("settings_description", sql.lit``);
          s.defScalar("settings_kind", sql.lit`test`);
          s.defScalar("settings_execution_mode", sql.lit`employee_attempt`);
          s.defScalar("settings_is_active", sql`true`);
          s.defScalar("policy_open", sql`false`);
          s.defScalar("policy_passing_score_percent", sql.lit`100`);
          s.defScalar("policy_max_attempts", sql.lit``);
          s.defScalar("policy_cooldown_minutes", sql.lit``);
          s.defScalar("policy_allow_retake_after_pass", sql`false`);
          s.defScalar("policy_score_adjustment_allowed", sql`false`);
          s.defScalar("policy_outcome_override_allowed", sql`false`);
          s.defScalar("policy_show_correct_answers", sql`false`);
          s.defScalar("policy_show_failed_attempts", sql`true`);
          s.defScalar("metadata_modal_open", sql`false`);
          s.defScalar("metadata_mode", sql.lit`add`);
          s.defScalar("metadata_id", sql.lit``);
          s.defScalar("metadata_name", sql.lit``);
          s.defScalar("metadata_label", sql.lit``);
          s.defScalar("metadata_type", sql.lit`text`);
          s.defScalar("metadata_required", sql`false`);
          s.defScalar("metadata_help_text", sql.lit``);
          s.defScalar("add_assessment_section_name", sql.lit``);
          s.defScalar("add_assessment_section_description", sql.lit``);
          s.defScalar("item_modal_open", sql`false`);
          s.defScalar("item_mode", sql.lit`add`);
          s.defScalar("item_id", sql.lit``);
          s.defScalar("item_section_id", sql.lit``);
          s.defScalar("item_type", sql.lit`multiple_choice`);
          s.defScalar("item_prompt", sql.lit``);
          s.defScalar("item_help_text", sql.lit``);
          s.defScalar("item_points", sql.lit`1`);
          s.defScalar("item_include_in_score", sql`true`);
          s.defScalar("item_is_required", sql`true`);
          s.defScalar("item_requires_review", sql`false`);
          s.defScalar("item_selection_mode", sql.lit`single`);
          s.defScalar("item_scoring_mode", sql.lit`all_or_nothing`);
          s.defScalar("item_shuffle_choices", sql`false`);
          s.defScalar("item_explanation", sql.lit``);
          s.defScalar("item_remediation_text", sql.lit``);
          s.defScalar("item_practical_result_required", sql`true`);
          s.defScalar("item_fail_result_fails_attempt", sql`false`);
          s.defScalar("item_not_observed_fails_attempt", sql`false`);
          s.defScalar("item_not_applicable_allowed", sql`false`);
          s.defScalar("item_reviewer_signature_required", sql`false`);
          s.defTable("metadata_choice_drafts", {
            fields: [
              { name: "id", type: "BigInt", notNull: true },
              {
                name: "label",
                type: { type: "String", maxLength: 255 },
                notNull: true,
              },
              {
                name: "value",
                type: { type: "String", maxLength: 255 },
                notNull: true,
              },
            ],
          });
          s.defScalar("metadata_choice_label", sql.lit``);
          s.defScalar("metadata_choice_value", sql.lit``);
          s.defTable("item_choice_drafts", {
            fields: [
              { name: "id", type: "BigInt", notNull: true },
              {
                name: "content",
                type: { type: "String", maxLength: 1000 },
                notNull: true,
              },
              { name: "is_correct", type: "Bool", notNull: true },
            ],
          });
          s.defScalar("choice_content", sql.lit``);
          s.defScalar(
            "can_publish_assessments",
            currentUserHasPermission(sql.lit(permissions.publishAssessments)),
          );
        }}
      >
        <TrainingAdminFrame>
          <AssessmentEditorWorkspace
            block={props.block}
            assessmentId={sql`assessment_id`}
          />
        </TrainingAdminFrame>
      </Data>
    </Data>
  );
}

function AssessmentEditorWorkspace(
  props: { block: TrainingBlock; assessmentId: Sql },
) {
  const assessmentId = props.assessmentId;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-ml-2">
          <BackLink
            href={adminAssessmentsHref(props.block)}
            label="Back to assessments"
          />
        </div>
        <TrainingLanguageSwitch block={props.block} />
      </div>
      <Data
        hoistKey={sql`assessment_id`}
        watch={[sql`assessment_id`, sql`ui.editor_language`]}
        procedure={(s) => {
          s.defRecord(
            "selected_assessment",
            sql`select assessment.id, coalesce((select localized_name from db.training_assessment_versions where id = ${
              editorAssessmentVersionSql(assessmentId)
            }), assessment.name) as name, case when (select localized_name from db.training_assessment_versions where id = ${
              editorAssessmentVersionSql(assessmentId)
            }) is null then assessment.description else (select localized_description from db.training_assessment_versions where id = ${
              editorAssessmentVersionSql(assessmentId)
            }) end as description,
                       assessment.kind, assessment.execution_mode,
                       assessment.is_active,
                       ${
              draftAssessmentVersionSql(assessmentId)
            } as draft_version_id,
                       ${
              publishedAssessmentVersionSql(assessmentId)
            } as published_version_id,
                       ${
              activeAssessmentVersionSql(assessmentId, sql`ui.editor_language`)
            } as available_published_version_id,
                       ${
              editorAssessmentVersionSql(assessmentId)
            } as editor_version_id
                from db.training_assessments assessment
                where assessment.id = ${assessmentId}`,
          );
          s.defRecord(
            "editor_version",
            sql`select v.id, v.version_label, v.status,
                       v.passing_score_percent, v.max_attempts,
                       v.cooldown_minutes, v.allow_retake_after_pass,
                       v.score_adjustment_allowed, v.outcome_override_allowed,
                       v.show_correct_answers_after_submission,
                       v.show_failed_attempts_to_employee
                from db.training_assessment_versions v
                where v.id = selected_assessment.editor_version_id`,
          );
          s.defScalar(
            "translation_edit_locked",
            translationReviewLockedSql(
              "assessment",
              sql`selected_assessment.editor_version_id`,
            ),
          );
          s.defScalar(
            "translation_is_approved",
            translationApprovedSql(
              "assessment",
              sql`selected_assessment.draft_version_id`,
            ),
          );
          s.defTable(
            "assessment_sections",
            sql`select section.id, section.name, section.description,
                       section.ordinal,
                       (
                         select count(*)
                         from db.training_assessment_items item
                         where item.training_assessment_section_id =
                           section.id
                       ) as item_count
                from db.training_assessment_sections section
                where section.training_assessment_version_id =
                  selected_assessment.editor_version_id
                order by section.ordinal, section.id`,
          );
          s.defTable(
            "assessment_metadata_fields",
            sql`select field.id, field.key as name, field.label, field.type,
                       field.required, field.ordinal, field.help_text,
                       case field.type::string
                         when 'text' then 'Text'
                         when 'number' then 'Number'
                         when 'date' then 'Date'
                         else 'Single choice'
                       end as type_label,
                       (
                         select count(*)
                         from db.training_assessment_metadata_field_choices choice
                         where choice.training_assessment_metadata_field_id =
                           field.id
                       ) as choice_count
                from db.training_assessment_metadata_fields field
                where field.training_assessment_version_id =
                  selected_assessment.editor_version_id
                order by field.ordinal, field.id`,
          );
          s.defTable(
            "assessment_metadata_field_choices",
            sql`select choice.id,
                       choice.training_assessment_metadata_field_id,
                       choice.label, choice.value, choice.sort_order
                from db.training_assessment_metadata_field_choices choice
                join db.training_assessment_metadata_fields field
                  on field.id =
                    choice.training_assessment_metadata_field_id
                where field.training_assessment_version_id =
                  selected_assessment.editor_version_id
                order by choice.sort_order, choice.id`,
          );
          s.defTable(
            "assessment_items",
            sql`select item.id, item.training_assessment_section_id,
                       item.type, item.prompt, item.help_text, item.ordinal,
                       item.points, item.include_in_score, item.is_required,
                       item.requires_review, item.selection_mode,
                       item.scoring_mode,
                       item.shuffle_choices, item.explanation,
                       item.remediation_text, item.practical_result_required,
                       item.fail_result_fails_attempt,
                       item.not_observed_fails_attempt,
                       item.not_applicable_allowed,
                       item.reviewer_signature_required,
                       case item.type::string
                         when 'multiple_choice' then 'Multiple choice'
                         when 'text_response' then 'Text response'
                         when 'practical_observation' then 'Practical'
                         else 'Signature'
                       end as type_label,
                       (
                         select count(*)
                         from db.training_assessment_item_choices choice
                         where choice.training_assessment_item_id = item.id
                       ) as choice_count
                from db.training_assessment_items item
                join db.training_assessment_sections section
                  on section.id = item.training_assessment_section_id
                where section.training_assessment_version_id =
                  selected_assessment.editor_version_id
                order by item.ordinal, item.id`,
          );
          s.defTable(
            "assessment_item_choices",
            sql`select choice.id, choice.training_assessment_item_id,
                       choice.content, choice.is_correct, choice.sort_order
                from db.training_assessment_item_choices choice
                join db.training_assessment_items item
                  on item.id = choice.training_assessment_item_id
                join db.training_assessment_sections section
                  on section.id = item.training_assessment_section_id
                where section.training_assessment_version_id =
                  selected_assessment.editor_version_id
                order by choice.sort_order, choice.id`,
          );
          s.defTable(
            "assessment_publish_issues",
            assessmentVersionPublishIssuesSql(
              sql`selected_assessment.editor_version_id`,
            ),
          );
        }}
      >
        <Show when={sql`selected_assessment.id is null`}>
          <EmptyState
            icon="Grading"
            title="Assessment not found"
            body="The assessment may have been removed."
          />
        </Show>
        <Show when={sql`selected_assessment.id is not null`}>
          <TrainingLanguageControls
            block={props.block}
            kind="assessment"
            recordId={assessmentId}
            versionId={sql`selected_assessment.editor_version_id`}
          />
        </Show>
        <Show
          when={sql`selected_assessment.id is not null and (selected_assessment.editor_version_id is not null or ui.editor_language = ${
            sql.lit(props.block.opts.content.opts.defaultLanguage)
          })`}
        >
          <Show when={sql`assessment_edit_error is not null`}>
            <Alert color="danger" startIcon="Error">
              {sql`assessment_edit_error`}
            </Alert>
          </Show>
          <Card variant="outlined">
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Typography level="h4" className="text-balance">
                      {sql`selected_assessment.name`}
                    </Typography>
                    <IconButton
                      icon="Edit"
                      size="sm"
                      variant="plain"
                      color="neutral"
                      disabled={sql`translation_edit_locked`}
                      aria-label="Edit title and description"
                      tooltip="Edit title and description"
                      onClick={(s) =>
                        s.setScalar("language_details_open", sql`true`)}
                    />
                    {assessmentKindChip(sql`selected_assessment.kind`)}
                    <Chip size="sm" variant="soft" color="neutral">
                      {assessmentExecutionModeLabelSql(
                        sql`selected_assessment.execution_mode`,
                      )}
                    </Chip>
                    {versionStatusChip(sql`editor_version.status`)}
                    <Show when={sql`not selected_assessment.is_active`}>
                      <Chip size="sm" variant="soft" color="warning">
                        Archived
                      </Chip>
                    </Show>
                  </div>
                  <Typography level="body-sm" className="text-neutral-600 mt-1">
                    {sql`coalesce(selected_assessment.description,
                      'No description yet.')`}
                  </Typography>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outlined"
                    color="neutral"
                    disabled={sql`translation_edit_locked`}
                    startIcon="Tune"
                    onClick={(s) => {
                      s.setScalar(
                        "settings_name",
                        sql`selected_assessment.name`,
                      );
                      s.setScalar(
                        "settings_description",
                        sql`coalesce(selected_assessment.description, '')`,
                      );
                      s.setScalar(
                        "settings_kind",
                        sql`selected_assessment.kind`,
                      );
                      s.setScalar(
                        "settings_execution_mode",
                        sql`selected_assessment.execution_mode`,
                      );
                      s.setScalar(
                        "settings_is_active",
                        sql`selected_assessment.is_active`,
                      );
                      s.setScalar("assessment_settings_open", sql`true`);
                    }}
                  >
                    Settings
                  </Button>
                  <Button
                    variant="outlined"
                    color="neutral"
                    disabled={sql`translation_edit_locked`}
                    startIcon="Rule"
                    onClick={(s) => {
                      s.setScalar(
                        "policy_passing_score_percent",
                        sql`coalesce(editor_version.passing_score_percent::string, '')`,
                      );
                      s.setScalar(
                        "policy_max_attempts",
                        sql`coalesce(editor_version.max_attempts::string, '')`,
                      );
                      s.setScalar(
                        "policy_cooldown_minutes",
                        sql`coalesce(editor_version.cooldown_minutes::string, '')`,
                      );
                      s.setScalar(
                        "policy_allow_retake_after_pass",
                        sql`editor_version.allow_retake_after_pass`,
                      );
                      s.setScalar(
                        "policy_score_adjustment_allowed",
                        sql`editor_version.score_adjustment_allowed`,
                      );
                      s.setScalar(
                        "policy_outcome_override_allowed",
                        sql`editor_version.outcome_override_allowed`,
                      );
                      s.setScalar(
                        "policy_show_correct_answers",
                        sql`editor_version.show_correct_answers_after_submission`,
                      );
                      s.setScalar(
                        "policy_show_failed_attempts",
                        sql`editor_version.show_failed_attempts_to_employee`,
                      );
                      s.setScalar("policy_open", sql`true`);
                    }}
                  >
                    Scoring & retakes
                  </Button>
                  <Show
                    when={sql`can_publish_assessments
                      and selected_assessment.draft_version_id is not null`}
                  >
                    <Button
                      disabled={sql`ui.editor_language != ${
                        sql.lit(props.block.opts.content.opts.defaultLanguage)
                      } and not translation_is_approved`}
                      startIcon="Publish"
                      onClick={(s) => {
                        s.setScalar("assessment_edit_error", sql`null`);
                        s.if(
                          sql`exists (select 1 from assessment_publish_issues)`,
                          (s) => {
                            s.setScalar(
                              "assessment_edit_error",
                              sql
                                .lit`Resolve the publish blockers listed below first.`,
                            );
                            s.return();
                          },
                        );
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            s.callStoredProcedure(
                              "training_publish_assessment_draft_language",
                              {
                                inputScalars: {
                                  p_assessment_id: sql`selected_assessment.id`,
                                  p_language: sql`ui.editor_language`,
                                },
                              },
                            );
                            s.commitTransaction();
                            s.refetch();
                          },
                          errorName: "publish_failure",
                          catch: (s) => {
                            s.setScalar(
                              "assessment_edit_error",
                              sql`coalesce(publish_failure.message, 'The assessment version could not be published.')`,
                            );
                          },
                        });
                      }}
                    >
                      Publish
                    </Button>
                  </Show>
                  <Show
                    when={sql`selected_assessment.draft_version_id is not null`}
                  >
                    <Button
                      variant="outlined"
                      color="danger"
                      disabled={sql`translation_edit_locked`}
                      startIcon="Delete"
                      onClick={(s) => {
                        s.setScalar("assessment_edit_error", sql`null`);
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            s.callStoredProcedure(
                              "training_discard_assessment_draft",
                              {
                                inputScalars: {
                                  p_assessment_id: sql`selected_assessment.id`,
                                  p_version_id:
                                    sql`selected_assessment.draft_version_id`,
                                  p_language: sql`ui.editor_language`,
                                },
                              },
                            );
                            s.commitTransaction();
                            s.refetch();
                          },
                          catch: (s) => {
                            s.setScalar(
                              "assessment_edit_error",
                              sql.lit`The changes could not be discarded.`,
                            );
                          },
                        });
                      }}
                    >
                      Discard changes
                    </Button>
                  </Show>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Show
                when={sql`selected_assessment.published_version_id is null`}
              >
                <Alert color="warning" startIcon="Info" className="mb-3">
                  <Show
                    when={sql`selected_assessment.available_published_version_id is not null`}
                  >
                    This language has no published translation yet. Learners use
                    the published default-language assessment until you publish
                    it.
                  </Show>
                  <Show
                    when={sql`selected_assessment.available_published_version_id is null`}
                  >
                    This assessment has no published version yet. Courses cannot
                    be assigned with it until you publish.
                  </Show>
                </Alert>
              </Show>
              <Show
                when={sql`exists (select 1 from assessment_publish_issues)`}
              >
                <Alert color="warning" startIcon="Rule" className="mb-3">
                  <div className="flex flex-col gap-1">
                    <Typography level="title-sm">
                      Publish blockers
                    </Typography>
                    <Each
                      table="assessment_publish_issues"
                      recordName="publish_issue"
                    >
                      <Typography level="body-sm">
                        {sql`publish_issue.issue`}
                      </Typography>
                    </Each>
                  </div>
                </Alert>
              </Show>
              <Typography level="body-sm" className="text-neutral-600">
                {sql`'Editing version ' || editor_version.version_label ||
                  case when editor_version.status = 'draft'
                    then ' (draft). Attempts already in progress keep the version they started on.'
                    else ' (published). Your first edit starts a new draft.'
                  end`}
              </Typography>
            </CardContent>
          </Card>
          <Card
            component="fieldset"
            disabled={sql`translation_edit_locked`}
            variant="outlined"
          >
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
                <Typography level="title-md" startIcon="FactCheck">
                  Assessment details
                </Typography>
                <Button
                  startIcon="Add"
                  variant="outlined"
                  color="neutral"
                  onClick={(s) => {
                    s.setScalar("assessment_edit_error", sql`null`);
                    s.setScalar("metadata_mode", sql.lit`add`);
                    s.setScalar("metadata_id", sql.lit``);
                    s.setScalar("metadata_name", sql.lit``);
                    s.setScalar("metadata_label", sql.lit``);
                    s.setScalar("metadata_type", sql.lit`text`);
                    s.setScalar("metadata_required", sql`false`);
                    s.setScalar("metadata_help_text", sql.lit``);
                    s.modify(sql`delete from ui.metadata_choice_drafts`);
                    s.setScalar("metadata_choice_label", sql.lit``);
                    s.setScalar("metadata_choice_value", sql.lit``);
                    s.setScalar("metadata_modal_open", sql`true`);
                  }}
                >
                  Add field
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Show
                when={sql`not exists (
                  select 1 from assessment_metadata_fields
                )`}
              >
                <EmptyState
                  icon="FactCheck"
                  title="No assessment details yet"
                  body="Add fields for details captured once per attempt, such as truck type, powered by, facility, or testing date."
                />
              </Show>
              <Each
                table="assessment_metadata_fields"
                recordName="metadata_field"
              >
                <div className="flex items-center justify-between gap-3 px-4 py-2 border border-divider rounded-md mb-2 bg-white">
                  <div className="min-w-0">
                    <Typography level="body-md">
                      {sql`metadata_field.label`}
                    </Typography>
                    <Typography level="body-sm" className="text-neutral-600">
                      {sql`metadata_field.name || ' · ' ||
                        metadata_field.type_label ||
                        case
                          when metadata_field.type = 'single_choice'
                          then ' · ' || metadata_field.choice_count::string ||
                            ' choices'
                          else ''
                        end ||
                        case when metadata_field.required
                          then ' · required'
                          else ' · optional'
                        end`}
                    </Typography>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <IconButton
                      icon="Edit"
                      aria-label="Edit field"
                      variant="plain"
                      color="neutral"
                      onClick={(s) => {
                        s.setScalar("assessment_edit_error", sql`null`);
                        s.setScalar("metadata_mode", sql.lit`edit`);
                        s.setScalar(
                          "metadata_id",
                          sql`metadata_field.id::string`,
                        );
                        s.setScalar(
                          "metadata_name",
                          sql`metadata_field.name`,
                        );
                        s.setScalar(
                          "metadata_label",
                          sql`metadata_field.label`,
                        );
                        s.setScalar(
                          "metadata_type",
                          sql`metadata_field.type`,
                        );
                        s.setScalar(
                          "metadata_required",
                          sql`metadata_field.required`,
                        );
                        s.setScalar(
                          "metadata_help_text",
                          sql`coalesce(metadata_field.help_text, '')`,
                        );
                        s.modify(sql`delete from ui.metadata_choice_drafts`);
                        s.modify(sql`
                          insert into metadata_choice_drafts
                            (id, label, value)
                          select row_number() over (),
                                 choice.label, choice.value
                          from assessment_metadata_field_choices choice
                          where choice.training_assessment_metadata_field_id =
                            metadata_field.id
                          order by choice.sort_order, choice.id
                        `);
                        s.setScalar("metadata_choice_label", sql.lit``);
                        s.setScalar("metadata_choice_value", sql.lit``);
                        s.setScalar("metadata_modal_open", sql`true`);
                      }}
                    />
                    <IconButton
                      icon="Delete"
                      aria-label="Delete field"
                      variant="plain"
                      color="danger"
                      onClick={(s) => {
                        s.setScalar("assessment_edit_error", sql`null`);
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            ensureAssessmentDraftVersion(s, {
                              block: props.block,
                              assessmentId,
                            });
                            s.defScalar(
                              "draft_metadata_field_id",
                              mapMetadataFieldToDraftSql(
                                sql`metadata_field.id`,
                              ),
                            );
                            s.modify(sql`
                              delete from db.training_assessment_metadata_field_choices
                              where training_assessment_metadata_field_id =
                                draft_metadata_field_id
                            `);
                            s.modify(sql`
                              delete from db.training_assessment_metadata_fields
                              where id = draft_metadata_field_id
                            `);
                            s.commitTransaction();
                            s.refetch();
                          },
                          catch: (s) => {
                            s.setScalar(
                              "assessment_edit_error",
                              sql
                                .lit`The assessment detail field could not be deleted.`,
                            );
                          },
                        });
                      }}
                    />
                  </div>
                </div>
              </Each>
            </CardContent>
          </Card>
          <Card
            component="fieldset"
            disabled={sql`translation_edit_locked`}
            variant="outlined"
          >
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
                <Typography level="title-md" startIcon="ViewAgenda">
                  Sections & questions
                </Typography>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-col md:flex-row gap-3 md:items-end">
                <FormControl className="flex-1">
                  <FormLabel>New section name</FormLabel>
                  <Input
                    bindScalar="add_assessment_section_name"
                    placeholder="Written questions"
                  />
                </FormControl>
                <FormControl className="flex-1">
                  <FormLabel>Description</FormLabel>
                  <Input
                    bindScalar="add_assessment_section_description"
                    placeholder="Optional"
                  />
                </FormControl>
                <Button
                  startIcon="Add"
                  variant="outlined"
                  color="neutral"
                  onClick={(s) => {
                    s.setScalar("assessment_edit_error", sql`null`);
                    s.if(
                      sql`nullif(trim(add_assessment_section_name), '') is null`,
                      (s) => {
                        s.setScalar(
                          "assessment_edit_error",
                          sql.lit`Enter the section name before adding it.`,
                        );
                        s.return();
                      },
                    );
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        ensureAssessmentDraftVersion(s, {
                          block: props.block,
                          assessmentId,
                        });
                        s.modify(sql`
                          insert into db.training_assessment_sections
                            (training_assessment_version_id, name,
                             description, ordinal)
                          values
                            (draft_assessment_version_id,
                             trim(ui.add_assessment_section_name),
                             nullif(trim(ui.add_assessment_section_description), ''),
                             (
                               select coalesce(max(ordinal), 0) + 10
                               from db.training_assessment_sections
                               where training_assessment_version_id =
                                 draft_assessment_version_id
                             ))
                        `);
                        s.commitTransaction();
                        s.setScalar(
                          "add_assessment_section_name",
                          sql.lit``,
                        );
                        s.setScalar(
                          "add_assessment_section_description",
                          sql.lit``,
                        );
                        s.refetch();
                      },
                      catch: (s) => {
                        s.setScalar(
                          "assessment_edit_error",
                          sql.lit`The section could not be added.`,
                        );
                      },
                    });
                  }}
                >
                  Add section
                </Button>
              </div>
              <Show
                when={sql`not exists (select 1 from assessment_sections)`}
              >
                <EmptyState
                  icon="ViewAgenda"
                  title="No sections yet"
                  body="Add a section, then add questions to it."
                />
              </Show>
              <Each table="assessment_sections" recordName="assessment_section">
                <div className="border border-divider rounded-md mb-3 bg-white">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-divider">
                    <div>
                      <Typography level="title-sm">
                        {sql`assessment_section.name`}
                      </Typography>
                      <Typography level="body-sm" className="text-neutral-600">
                        {sql`coalesce(assessment_section.description, '')`}
                      </Typography>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="plain"
                        startIcon="Add"
                        onClick={(s) => {
                          s.setScalar("assessment_edit_error", sql`null`);
                          s.setScalar("item_mode", sql.lit`add`);
                          s.setScalar("item_id", sql.lit``);
                          s.setScalar(
                            "item_section_id",
                            sql`assessment_section.id::string`,
                          );
                          s.setScalar("item_type", sql.lit`multiple_choice`);
                          s.setScalar("item_prompt", sql.lit``);
                          s.setScalar("item_help_text", sql.lit``);
                          s.setScalar("item_points", sql.lit`1`);
                          s.setScalar("item_include_in_score", sql`true`);
                          s.setScalar("item_is_required", sql`true`);
                          s.setScalar("item_requires_review", sql`false`);
                          s.setScalar("item_selection_mode", sql.lit`single`);
                          s.setScalar(
                            "item_scoring_mode",
                            sql.lit`all_or_nothing`,
                          );
                          s.setScalar("item_shuffle_choices", sql`false`);
                          s.setScalar("item_explanation", sql.lit``);
                          s.setScalar("item_remediation_text", sql.lit``);
                          s.setScalar(
                            "item_practical_result_required",
                            sql`true`,
                          );
                          s.setScalar(
                            "item_fail_result_fails_attempt",
                            sql`false`,
                          );
                          s.setScalar(
                            "item_not_observed_fails_attempt",
                            sql`false`,
                          );
                          s.setScalar(
                            "item_not_applicable_allowed",
                            sql`false`,
                          );
                          s.setScalar(
                            "item_reviewer_signature_required",
                            sql`false`,
                          );
                          s.modify(sql`delete from ui.item_choice_drafts`);
                          s.setScalar("choice_content", sql.lit``);
                          s.setScalar("item_modal_open", sql`true`);
                        }}
                      >
                        Add question
                      </Button>
                      <IconButton
                        icon="Delete"
                        aria-label="Delete section"
                        variant="plain"
                        color="danger"
                        tooltip="Delete section and its questions"
                        onClick={(s) => {
                          s.setScalar("assessment_edit_error", sql`null`);
                          s.tryServer({
                            body: (s) => {
                              s.startTransaction();
                              ensureAssessmentDraftVersion(s, {
                                block: props.block,
                                assessmentId,
                              });
                              s.defScalar(
                                "draft_section_id",
                                mapSectionToDraftSql(
                                  sql`assessment_section.id`,
                                ),
                              );
                              s.modify(sql`
                                delete from db.training_assessment_item_choices
                                where training_assessment_item_id in (
                                  select item.id
                                  from db.training_assessment_items item
                                  where item.training_assessment_section_id =
                                    draft_section_id
                                )
                              `);
                              s.modify(sql`
                                delete from db.training_assessment_items
                                where training_assessment_section_id =
                                  draft_section_id
                              `);
                              s.modify(sql`
                                delete from db.training_assessment_sections
                                where id = draft_section_id
                              `);
                              s.commitTransaction();
                              s.refetch();
                            },
                            catch: (s) => {
                              s.setScalar(
                                "assessment_edit_error",
                                sql.lit`The section could not be deleted.`,
                              );
                            },
                          });
                        }}
                      />
                    </div>
                  </div>
                  <Show
                    when={sql`not exists (
                      select 1
                      from assessment_items item
                      where item.training_assessment_section_id =
                        assessment_section.id
                    )`}
                  >
                    <div className="px-4 py-3">
                      <Typography level="body-sm" className="text-neutral-500">
                        No questions in this section yet.
                      </Typography>
                    </div>
                  </Show>
                  <Each
                    table="assessment_items"
                    recordName="assessment_item"
                    where={sql`assessment_item.training_assessment_section_id =
                      assessment_section.id`}
                  >
                    <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-divider last:border-b-0">
                      <div className="min-w-0">
                        <Typography level="body-md">
                          {sql`assessment_item.prompt`}
                        </Typography>
                        <Typography
                          level="body-sm"
                          className="text-neutral-600"
                        >
                          {sql`assessment_item.type_label ||
                            case
                              when assessment_item.type = 'multiple_choice'
                              then ' · ' ||
                                assessment_item.choice_count::string ||
                                ' choices'
                              else ''
                            end ||
                            case
                              when assessment_item.include_in_score
                              then ' · ' ||
                                assessment_item.points::string || ' pts'
                              else ' · not scored'
                            end ||
                            case
                              when assessment_item.scoring_mode =
                                'partial_credit'
                              then ' · partial credit' else ''
                            end ||
                            case
                              when assessment_item.is_required
                              then '' else ' · optional'
                            end ||
                            case
                              when assessment_item.requires_review
                              then ' · needs review' else ''
                            end`}
                        </Typography>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <IconButton
                          icon="Edit"
                          aria-label="Edit question"
                          variant="plain"
                          color="neutral"
                          onClick={(s) => {
                            s.setScalar("assessment_edit_error", sql`null`);
                            s.setScalar("item_mode", sql.lit`edit`);
                            s.setScalar(
                              "item_id",
                              sql`assessment_item.id::string`,
                            );
                            s.setScalar(
                              "item_section_id",
                              sql`assessment_item.training_assessment_section_id::string`,
                            );
                            s.setScalar(
                              "item_type",
                              sql`assessment_item.type`,
                            );
                            s.setScalar(
                              "item_prompt",
                              sql`assessment_item.prompt`,
                            );
                            s.setScalar(
                              "item_help_text",
                              sql`coalesce(assessment_item.help_text, '')`,
                            );
                            s.setScalar(
                              "item_points",
                              sql`assessment_item.points::string`,
                            );
                            s.setScalar(
                              "item_include_in_score",
                              sql`assessment_item.include_in_score`,
                            );
                            s.setScalar(
                              "item_is_required",
                              sql`assessment_item.is_required`,
                            );
                            s.setScalar(
                              "item_requires_review",
                              sql`assessment_item.requires_review`,
                            );
                            s.setScalar(
                              "item_selection_mode",
                              sql`coalesce(assessment_item.selection_mode::string, 'single')`,
                            );
                            s.setScalar(
                              "item_scoring_mode",
                              sql`assessment_item.scoring_mode::string`,
                            );
                            s.setScalar(
                              "item_shuffle_choices",
                              sql`assessment_item.shuffle_choices`,
                            );
                            s.setScalar(
                              "item_explanation",
                              sql`coalesce(assessment_item.explanation, '')`,
                            );
                            s.setScalar(
                              "item_remediation_text",
                              sql`coalesce(assessment_item.remediation_text, '')`,
                            );
                            s.setScalar(
                              "item_practical_result_required",
                              sql`assessment_item.practical_result_required`,
                            );
                            s.setScalar(
                              "item_fail_result_fails_attempt",
                              sql`assessment_item.fail_result_fails_attempt`,
                            );
                            s.setScalar(
                              "item_not_observed_fails_attempt",
                              sql`assessment_item.not_observed_fails_attempt`,
                            );
                            s.setScalar(
                              "item_not_applicable_allowed",
                              sql`assessment_item.not_applicable_allowed`,
                            );
                            s.setScalar(
                              "item_reviewer_signature_required",
                              sql`assessment_item.reviewer_signature_required`,
                            );
                            s.modify(sql`delete from ui.item_choice_drafts`);
                            s.modify(sql`
                              insert into item_choice_drafts
                                (id, content, is_correct)
                              select row_number() over (),
                                     choice.content, choice.is_correct
                              from assessment_item_choices choice
                              where choice.training_assessment_item_id =
                                assessment_item.id
                              order by choice.sort_order, choice.id
                            `);
                            s.setScalar("choice_content", sql.lit``);
                            s.setScalar("item_modal_open", sql`true`);
                          }}
                        />
                        <IconButton
                          icon="Delete"
                          aria-label="Delete question"
                          variant="plain"
                          color="danger"
                          onClick={(s) => {
                            s.setScalar("assessment_edit_error", sql`null`);
                            s.tryServer({
                              body: (s) => {
                                s.startTransaction();
                                ensureAssessmentDraftVersion(s, {
                                  block: props.block,
                                  assessmentId,
                                });
                                s.defScalar(
                                  "draft_item_id",
                                  mapItemToDraftSql(sql`assessment_item.id`),
                                );
                                s.modify(sql`
                                  delete from db.training_assessment_item_choices
                                  where training_assessment_item_id =
                                    draft_item_id
                                `);
                                s.modify(sql`
                                  delete from db.training_assessment_items
                                  where id = draft_item_id
                                `);
                                s.commitTransaction();
                                s.refetch();
                              },
                              catch: (s) => {
                                s.setScalar(
                                  "assessment_edit_error",
                                  sql
                                    .lit`The question could not be deleted.`,
                                );
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                  </Each>
                </div>
              </Each>
            </CardContent>
          </Card>
          <AssessmentAttemptsCard block={props.block} />
          <AssessmentSettingsModal block={props.block} />
          <AssessmentPolicyModal block={props.block} />
          <AssessmentMetadataFieldModal block={props.block} />
          <AssessmentItemModal block={props.block} />
        </Show>
      </Data>
    </div>
  );
}

function AssessmentAttemptsCard(props: { block: TrainingBlock }) {
  return (
    <Card variant="outlined">
      <CardHeader>
        <Typography level="title-md" startIcon="History">
          Attempts
        </Typography>
      </CardHeader>
      <CardContent>
        <Data
          procedure={(s) => {
            s.defTable(
              "assessment_attempts",
              sql`select att.id, att.attempt_number, att.status, att.outcome,
                         att.score_percent, att.submitted_at, att.started_at,
                         att.training_employee_task_id,
                         v.version_label,
                         ${
                employeeName(props.block.opts, sql`person`)
              } as person_name
                  from db.training_assessment_attempts att
                  join db.training_assessment_versions v
                    on v.id = att.training_assessment_version_id
                  join db.training_employee_tasks task
                    on task.id = att.training_employee_task_id
                  join db.training_assignments assignment
                    on assignment.id = task.training_assignment_id
                  join db.${
                sql.ref(props.block.opts.workforce.personTable)
              } person
                    on person.id = assignment.person_id
                  where v.training_assessment_id = selected_assessment.id
                  order by att.started_at desc, att.id desc
                  limit 100`,
            );
          }}
        >
          <Show
            when={sql`not exists (select 1 from assessment_attempts)`}
          >
            <EmptyState
              icon="History"
              title="No attempts yet"
              body="Attempts appear here once employees open assessment tasks."
            />
          </Show>
          <Each table="assessment_attempts" recordName="assessment_attempt">
            <div className="flex items-center justify-between gap-3 border border-divider rounded-md px-4 py-2 mb-2 bg-white">
              <div>
                <Typography level="body-md">
                  {sql`assessment_attempt.person_name ||
                    ' · attempt ' ||
                    assessment_attempt.attempt_number::string ||
                    ' · ' || assessment_attempt.version_label`}
                </Typography>
                <Typography level="body-sm" className="text-neutral-600">
                  {sql`case assessment_attempt.status::string
                      when 'in_progress' then 'In progress'
                      when 'review_pending' then 'Review pending'
                      when 'cancelled' then 'Cancelled'
                      else case assessment_attempt.outcome::string
                        when 'passed' then 'Passed'
                        when 'failed' then 'Failed'
                        else 'Complete'
                      end
                    end ||
                    coalesce(
                      ' · ' ||
                        round(assessment_attempt.score_percent)::string ||
                        '%',
                      ''
                    ) ||
                    coalesce(
                      ' · submitted ' || ${
                    formatDateTimeSql(sql`assessment_attempt.submitted_at`)
                  },
                      ''
                    )`}
                </Typography>
              </div>
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                startIcon="OpenInNew"
                onClick={(s) =>
                  s.navigate(
                    adminAssessmentTaskHref(
                      props.block,
                      sql`assessment_attempt.training_employee_task_id`,
                    ),
                  )}
              >
                Open
              </Button>
            </div>
          </Each>
        </Data>
      </CardContent>
    </Card>
  );
}

function AssessmentSettingsModal(props: { block: TrainingBlock }) {
  return (
    <ModalDialog bindScalar="assessment_settings_open" maxWidth="lg">
      <div className="flex items-start justify-between gap-3 mb-4">
        <Typography level="title-lg" startIcon="Tune">
          Assessment Settings
        </Typography>
        <IconButton
          icon="Close"
          aria-label="Close"
          variant="plain"
          color="neutral"
          onClick={(s) => s.setScalar("assessment_settings_open", sql`false`)}
        />
      </div>
      <div className="grid gap-3">
        <FormControl>
          <FormLabel>Name</FormLabel>
          <Input bindScalar="settings_name" />
        </FormControl>
        <FormControl>
          <FormLabel>Purpose</FormLabel>
          <Textarea bindScalar="settings_description" minRows={2} />
        </FormControl>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormControl>
            <FormLabel>Kind</FormLabel>
            <Select
              className={adminSelectClass}
              value={sql`settings_kind`}
              onInput={(s) => s.setScalar("settings_kind", sql`target_value`)}
            >
              <Select.Option value="test">Test</Select.Option>
              <Select.Option value="evaluation">Evaluation</Select.Option>
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel>Who enters responses</FormLabel>
            <Select
              className={adminSelectClass}
              value={sql`settings_execution_mode`}
              onInput={(s) =>
                s.setScalar("settings_execution_mode", sql`target_value`)}
            >
              <Select.Option value="employee_attempt">
                Employee attempt
              </Select.Option>
              <Select.Option value="employee_submission_with_review">
                Employee submission with review
              </Select.Option>
              <Select.Option value="trainer_recorded">
                Trainer recorded
              </Select.Option>
            </Select>
          </FormControl>
        </div>
        <Checkbox
          checked={sql`settings_is_active`}
          label="Active (available to add to courses)"
          onCheckboxChange={(s) =>
            s.setScalar("settings_is_active", sql`target_checked`)}
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("assessment_settings_open", sql`false`)}
          >
            Cancel
          </Button>
          <Button
            startIcon="Save"
            onClick={(s) => {
              s.setScalar("assessment_edit_error", sql`null`);
              s.if(sql`nullif(trim(settings_name), '') is null`, (s) => {
                s.setScalar(
                  "assessment_edit_error",
                  sql.lit`The assessment name cannot be empty.`,
                );
                s.return();
              });
              s.tryServer({
                body: (s) => {
                  s.startTransaction();
                  ensureAssessmentDraftVersion(s, {
                    block: props.block,
                    assessmentId: sql`selected_assessment.id`,
                  });
                  s.modify(
                    sql`update db.training_assessment_versions set localized_name = trim(ui.settings_name), localized_description = nullif(trim(ui.settings_description),'') where id = draft_assessment_version_id`,
                  );
                  s.modify(sql`
                    update db.training_assessments
                    set kind = ui.settings_kind,
                        execution_mode = ui.settings_execution_mode,
                        is_active = ui.settings_is_active,
                        archived_at = case
                          when ui.settings_is_active then null
                          else coalesce(archived_at, now())
                        end
                    where id = selected_assessment.id
                  `);
                  s.commitTransaction();
                  s.setScalar("assessment_settings_open", sql`false`);
                  s.refetch();
                },
                catch: (s) => {
                  s.setScalar(
                    "assessment_edit_error",
                    sql.lit`The assessment settings could not be saved.`,
                  );
                },
              });
            }}
          >
            Save settings
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}

function AssessmentPolicyModal(props: { block: TrainingBlock }) {
  return (
    <ModalDialog bindScalar="policy_open" maxWidth="lg">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <Typography level="title-lg" startIcon="Rule">
            Scoring & Retakes
          </Typography>
          <Typography level="body-sm" className="text-neutral-600 mt-1">
            Saved to the draft version; publishing makes it the active policy.
          </Typography>
        </div>
        <IconButton
          icon="Close"
          aria-label="Close"
          variant="plain"
          color="neutral"
          onClick={(s) => s.setScalar("policy_open", sql`false`)}
        />
      </div>
      <div className="grid gap-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FormControl>
            <FormLabel>Passing score %</FormLabel>
            <Input
              type="number"
              min="1"
              max="100"
              bindScalar="policy_passing_score_percent"
              placeholder="100"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Max attempts</FormLabel>
            <Input
              type="number"
              min="1"
              bindScalar="policy_max_attempts"
              placeholder="Unlimited"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Retake cooldown (minutes)</FormLabel>
            <Input
              type="number"
              min="0"
              bindScalar="policy_cooldown_minutes"
              placeholder="None"
            />
          </FormControl>
        </div>
        <Checkbox
          checked={sql`policy_allow_retake_after_pass`}
          label="Allow retake after a pass"
          onCheckboxChange={(s) =>
            s.setScalar("policy_allow_retake_after_pass", sql`target_checked`)}
        />
        <Checkbox
          checked={sql`policy_score_adjustment_allowed`}
          label="Reviewers may adjust scores"
          onCheckboxChange={(s) =>
            s.setScalar(
              "policy_score_adjustment_allowed",
              sql`target_checked`,
            )}
        />
        <Checkbox
          checked={sql`policy_outcome_override_allowed`}
          label="Reviewers may override the outcome"
          onCheckboxChange={(s) =>
            s.setScalar(
              "policy_outcome_override_allowed",
              sql`target_checked`,
            )}
        />
        <Checkbox
          checked={sql`policy_show_correct_answers`}
          label="Show correct answers to the employee after submission"
          onCheckboxChange={(s) =>
            s.setScalar("policy_show_correct_answers", sql`target_checked`)}
        />
        <Checkbox
          checked={sql`policy_show_failed_attempts`}
          label="Show failed attempt details to the employee"
          onCheckboxChange={(s) =>
            s.setScalar("policy_show_failed_attempts", sql`target_checked`)}
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("policy_open", sql`false`)}
          >
            Cancel
          </Button>
          <Button
            startIcon="Save"
            onClick={(s) => {
              s.setScalar("assessment_edit_error", sql`null`);
              s.tryServer({
                body: (s) => {
                  s.throwErrorIf(
                    sql`try_cast(trim(ui.policy_passing_score_percent) as int)
                        is null
                      or try_cast(trim(ui.policy_passing_score_percent) as int)
                        not between 1 and 100`,
                    sql
                      .lit`Passing score must be a whole number from 1 to 100.`,
                  );
                  s.throwErrorIf(
                    sql`nullif(trim(ui.policy_max_attempts), '') is not null
                      and (
                        try_cast(trim(ui.policy_max_attempts) as int) is null
                        or try_cast(trim(ui.policy_max_attempts) as int) < 1
                      )`,
                    sql
                      .lit`Maximum attempts must be a whole number of at least 1.`,
                  );
                  s.throwErrorIf(
                    sql`nullif(trim(ui.policy_cooldown_minutes), '') is not null
                      and (
                        try_cast(trim(ui.policy_cooldown_minutes) as int) is null
                        or try_cast(trim(ui.policy_cooldown_minutes) as int) < 0
                      )`,
                    sql
                      .lit`Retake cooldown must be a non-negative whole number.`,
                  );
                  s.startTransaction();
                  ensureAssessmentDraftVersion(s, {
                    block: props.block,
                    assessmentId: sql`selected_assessment.id`,
                  });
                  s.modify(sql`
                    update db.training_assessment_versions
                        set passing_score_percent =
                          try_cast(
                            trim(ui.policy_passing_score_percent) as int
                          ),
                        max_attempts =
                          try_cast(
                            nullif(trim(ui.policy_max_attempts), '') as int
                          ),
                        cooldown_minutes =
                          try_cast(
                            nullif(trim(ui.policy_cooldown_minutes), '') as int
                          ),
                        allow_retake_after_pass =
                          ui.policy_allow_retake_after_pass,
                        score_adjustment_allowed =
                          ui.policy_score_adjustment_allowed,
                        outcome_override_allowed =
                          ui.policy_outcome_override_allowed,
                        show_correct_answers_after_submission =
                          ui.policy_show_correct_answers,
                        show_failed_attempts_to_employee =
                          ui.policy_show_failed_attempts
                    where id = draft_assessment_version_id
                  `);
                  s.commitTransaction();
                  s.setScalar("policy_open", sql`false`);
                  s.refetch();
                },
                catch: (s) => {
                  s.setScalar(
                    "assessment_edit_error",
                    sql
                      .lit`The policy could not be saved. Check the numeric fields.`,
                  );
                },
              });
            }}
          >
            Save policy
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}

function AssessmentMetadataFieldModal(props: { block: TrainingBlock }) {
  return (
    <ModalDialog bindScalar="metadata_modal_open" maxWidth="lg">
      <div className="grid gap-4">
        <Typography level="title-lg" startIcon="FactCheck">
          {sql`case when metadata_mode = 'edit'
            then 'Edit Assessment Detail'
            else 'Add Assessment Detail'
          end`}
        </Typography>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormControl>
            <FormLabel>Name</FormLabel>
            <Input
              bindScalar="metadata_name"
              placeholder="truck_type"
              disabled={sql`metadata_mode = 'edit'`}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Type</FormLabel>
            <Select
              className={adminSelectClass}
              value={sql`metadata_type`}
              onInput={(s) => s.setScalar("metadata_type", sql`target_value`)}
            >
              <Select.Option value="text">Text</Select.Option>
              <Select.Option value="number">Number</Select.Option>
              <Select.Option value="date">Date</Select.Option>
              <Select.Option value="single_choice">
                Single choice
              </Select.Option>
            </Select>
          </FormControl>
        </div>
        <FormControl>
          <FormLabel>Label</FormLabel>
          <Input bindScalar="metadata_label" placeholder="Truck type" />
        </FormControl>
        <FormControl>
          <FormLabel>Help text</FormLabel>
          <Input bindScalar="metadata_help_text" placeholder="Optional" />
        </FormControl>
        <Checkbox
          checked={sql`metadata_required`}
          label="Required"
          onCheckboxChange={(s) =>
            s.setScalar("metadata_required", sql`target_checked`)}
        />
        <Show when={sql`metadata_type = 'single_choice'`}>
          <div className="border border-divider rounded-md p-3 grid gap-3">
            <Typography level="title-sm">Choices</Typography>
            <Each
              table="metadata_choice_drafts"
              recordName="choice_draft"
              orderBy={sql`choice_draft.id`}
            >
              <div className="flex items-center justify-between gap-3 py-1">
                <Typography level="body-sm">
                  {sql`choice_draft.label || ' · ' || choice_draft.value`}
                </Typography>
                <IconButton
                  icon="Delete"
                  aria-label="Remove choice"
                  size="sm"
                  variant="plain"
                  color="danger"
                  onClick={(s) => {
                    s.modify(sql`
                      delete from ui.metadata_choice_drafts
                      where id = choice_draft.id
                    `);
                  }}
                />
              </div>
            </Each>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:items-end">
              <FormControl className="md:col-span-1">
                <FormLabel>Choice label</FormLabel>
                <Input bindScalar="metadata_choice_label" />
              </FormControl>
              <FormControl className="md:col-span-1">
                <FormLabel>Value</FormLabel>
                <Input
                  bindScalar="metadata_choice_value"
                  placeholder="Defaults to label"
                />
              </FormControl>
              <Button
                variant="outlined"
                color="neutral"
                startIcon="Add"
                onClick={(s) => {
                  s.if(
                    sql`nullif(trim(metadata_choice_label), '') is null`,
                    (s) => s.return(),
                  );
                  s.modify(sql`
                    insert into metadata_choice_drafts
                      (id, label, value)
                    values
                      (coalesce((
                         select max(id) + 1
                         from ui.metadata_choice_drafts
                       ), 1),
                       trim(metadata_choice_label),
                       coalesce(
                         nullif(trim(metadata_choice_value), ''),
                         trim(metadata_choice_label)
                       ))
                  `);
                  s.setScalar("metadata_choice_label", sql.lit``);
                  s.setScalar("metadata_choice_value", sql.lit``);
                }}
              >
                Add choice
              </Button>
            </div>
          </div>
        </Show>
        <div className="flex justify-end gap-2">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("metadata_modal_open", sql`false`)}
          >
            Cancel
          </Button>
          <Button
            startIcon="Save"
            onClick={(s) => {
              s.setScalar("assessment_edit_error", sql`null`);
              s.if(
                sql`nullif(trim(metadata_name), '') is null
                  or nullif(trim(metadata_label), '') is null`,
                (s) => {
                  s.setScalar(
                    "assessment_edit_error",
                    sql.lit`Enter the field name and label before saving.`,
                  );
                  s.return();
                },
              );
              s.if(
                sql`metadata_type = 'single_choice'
                  and not exists (select 1 from ui.metadata_choice_drafts)`,
                (s) => {
                  s.setScalar(
                    "assessment_edit_error",
                    sql.lit`A single-choice detail needs at least one choice.`,
                  );
                  s.return();
                },
              );
              s.tryServer({
                body: (s) => {
                  s.startTransaction();
                  ensureAssessmentDraftVersion(s, {
                    block: props.block,
                    assessmentId: sql`selected_assessment.id`,
                  });
                  s.defScalar("saved_metadata_field_id", {
                    type: "BigInt",
                  });
                  s.if(
                    sql`ui.metadata_mode = 'edit'`,
                    (s) => {
                      s.setScalar(
                        "saved_metadata_field_id",
                        mapMetadataFieldToDraftSql(
                          sql`nullif(ui.metadata_id, '')::bigint`,
                        ),
                      );
                      s.throwErrorIf(
                        sql`saved_metadata_field_id is null`,
                        sql
                          .lit`The assessment detail field was not found in the draft.`,
                      );
                      s.modify(sql`
                        update db.training_assessment_metadata_fields
                        set label = trim(ui.metadata_label),
                            type = ui.metadata_type,
                            required = ui.metadata_required,
                            help_text =
                              nullif(trim(ui.metadata_help_text), '')
                        where id = saved_metadata_field_id
                      `);
                      s.modify(sql`
                        delete from db.training_assessment_metadata_field_choices
                        where training_assessment_metadata_field_id =
                          saved_metadata_field_id
                      `);
                    },
                    (s) => {
                      s.modify(sql`
                        insert into db.training_assessment_metadata_fields
                          (training_assessment_version_id, key, label,
                           type, required, ordinal, help_text)
                        values
                          (draft_assessment_version_id,
                           lower(trim(ui.metadata_name)),
                           trim(ui.metadata_label),
                           ui.metadata_type,
                           ui.metadata_required,
                           (
                             select coalesce(max(ordinal), 0) + 10
                             from db.training_assessment_metadata_fields
                             where training_assessment_version_id =
                               draft_assessment_version_id
                           ),
                           nullif(trim(ui.metadata_help_text), ''))
                        returning id into saved_metadata_field_id
                      `);
                    },
                  );
                  s.if(sql`ui.metadata_type = 'single_choice'`, (s) => {
                    s.modify(sql`
                      insert into db.training_assessment_metadata_field_choices
                        (training_assessment_metadata_field_id, label, value,
                         sort_order)
                      select saved_metadata_field_id, draft.label,
                             draft.value,
                             row_number() over (order by draft.id) * 10
                      from ui.metadata_choice_drafts draft
                      order by draft.id
                    `);
                  });
                  s.commitTransaction();
                  s.setScalar("metadata_modal_open", sql`false`);
                  s.modify(sql`delete from ui.metadata_choice_drafts`);
                  s.refetch();
                },
                catch: (s) => {
                  s.setScalar(
                    "assessment_edit_error",
                    sql
                      .lit`The assessment detail field could not be saved. Check the name and choices.`,
                  );
                },
              });
            }}
          >
            Save field
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}

function AssessmentItemModal(props: { block: TrainingBlock }) {
  return (
    <ModalDialog bindScalar="item_modal_open" maxWidth="lg">
      <div className="flex items-start justify-between gap-3 mb-4">
        <Typography level="title-lg" startIcon="Help">
          {sql`case
            when item_mode = 'edit' then 'Edit Question'
            else 'Add Question'
          end`}
        </Typography>
        <IconButton
          icon="Close"
          aria-label="Close"
          variant="plain"
          color="neutral"
          onClick={(s) => s.setScalar("item_modal_open", sql`false`)}
        />
      </div>
      <div className="grid gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormControl>
            <FormLabel>Question type</FormLabel>
            <Select
              className={adminSelectClass}
              value={sql`item_type`}
              onInput={(s) => {
                s.setScalar("item_type", sql`target_value`);
                s.if(sql`target_value = 'text_response'`, (s) => {
                  s.setScalar("item_requires_review", sql`true`);
                });
                s.if(sql`target_value = 'signature'`, (s) => {
                  s.setScalar("item_include_in_score", sql`false`);
                });
              }}
            >
              <Select.Option value="multiple_choice">
                Multiple choice
              </Select.Option>
              <Select.Option value="text_response">
                Text response
              </Select.Option>
              <Select.Option value="practical_observation">
                Practical observation
              </Select.Option>
              <Select.Option value="signature">Signature</Select.Option>
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel>Points</FormLabel>
            <Input bindScalar="item_points" />
          </FormControl>
        </div>
        <FormControl>
          <FormLabel>Prompt</FormLabel>
          <Textarea
            bindScalar="item_prompt"
            minRows={2}
            placeholder="The question or instruction shown to the person answering"
          />
        </FormControl>
        <FormControl>
          <FormLabel>Help text</FormLabel>
          <Input bindScalar="item_help_text" placeholder="Optional" />
        </FormControl>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3">
          <Checkbox
            checked={sql`item_include_in_score`}
            label="Counts toward the score"
            onCheckboxChange={(s) =>
              s.setScalar("item_include_in_score", sql`target_checked`)}
          />
          <Checkbox
            checked={sql`item_is_required`}
            label="Required"
            onCheckboxChange={(s) =>
              s.setScalar("item_is_required", sql`target_checked`)}
          />
          <Show
            when={sql`item_type = 'text_response'`}
            fallback={
              <Checkbox
                checked={sql`item_requires_review`}
                label="Needs reviewer approval"
                onCheckboxChange={(s) =>
                  s.setScalar("item_requires_review", sql`target_checked`)}
              />
            }
          >
            <Checkbox
              checked={sql`true`}
              color="neutral"
              disabled
              label="Needs reviewer approval"
              sx={{ color: "text.tertiary", opacity: 0.7 }}
            />
          </Show>
        </div>
        <Show when={sql`item_type = 'multiple_choice'`}>
          <div className="border border-divider rounded-md p-3 grid gap-3">
            <Typography level="title-sm">Multiple choice</Typography>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FormControl>
                <FormLabel>Selection</FormLabel>
                <Select
                  className={adminSelectClass}
                  value={sql`item_selection_mode`}
                  onInput={(s) =>
                    s.setScalar("item_selection_mode", sql`target_value`)}
                >
                  <Select.Option value="single">Single answer</Select.Option>
                  <Select.Option value="multiple">
                    Multiple answers
                  </Select.Option>
                </Select>
              </FormControl>
              <Show when={sql`item_selection_mode = 'multiple'`}>
                <FormControl>
                  <FormLabel>Scoring</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`item_scoring_mode`}
                    onInput={(s) =>
                      s.setScalar("item_scoring_mode", sql`target_value`)}
                  >
                    <Select.Option value="all_or_nothing">
                      All or nothing
                    </Select.Option>
                    <Select.Option value="partial_credit">
                      Partial credit
                    </Select.Option>
                  </Select>
                </FormControl>
              </Show>
            </div>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3">
              <Checkbox
                checked={sql`item_shuffle_choices`}
                label="Shuffle choices"
                onCheckboxChange={(s) =>
                  s.setScalar("item_shuffle_choices", sql`target_checked`)}
              />
            </div>
            <FormControl>
              <FormLabel>Explanation shown after grading</FormLabel>
              <Input bindScalar="item_explanation" placeholder="Optional" />
            </FormControl>
            <FormControl>
              <FormLabel>Remediation text on a wrong answer</FormLabel>
              <Input
                bindScalar="item_remediation_text"
                placeholder="Optional"
              />
            </FormControl>
            <div className="border-t border-divider pt-3">
              <Typography level="title-sm">Choices</Typography>
              <Each
                table="item_choice_drafts"
                recordName="choice_draft"
                orderBy={sql`choice_draft.id`}
              >
                <div className="flex items-center justify-between gap-3 py-1">
                  <Typography level="body-sm">
                    {sql`choice_draft.content`}
                  </Typography>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={sql`choice_draft.is_correct`}
                      label="Correct"
                      onCheckboxChange={(s) => {
                        s.if(sql`target_checked`, (s) => {
                          s.if(
                            sql`item_selection_mode = 'single'`,
                            (s) => {
                              s.modify(sql`
                                update ui.item_choice_drafts
                                set is_correct = false
                              `);
                            },
                          );
                        });
                        s.modify(sql`
                          update choice_draft
                          set is_correct = target_checked
                        `);
                      }}
                    />
                    <IconButton
                      icon="Delete"
                      aria-label="Remove choice"
                      size="sm"
                      variant="plain"
                      color="danger"
                      onClick={(s) => {
                        s.modify(sql`
                          delete from ui.item_choice_drafts
                          where id = choice_draft.id
                        `);
                      }}
                    />
                  </div>
                </div>
              </Each>
              <Show
                when={sql`item_selection_mode = 'single'
                  and (
                    select count(*)
                    from ui.item_choice_drafts
                    where is_correct
                  ) > 1`}
              >
                <Alert color="warning" startIcon="Warning">
                  Single-answer questions can only have one correct choice.
                  Remove extra correct choices or switch to multiple answers.
                </Alert>
              </Show>
              <div className="flex flex-col md:flex-row gap-2 md:items-end mt-2">
                <FormControl className="flex-1">
                  <FormLabel>Choice text</FormLabel>
                  <Input bindScalar="choice_content" />
                </FormControl>
                <Button
                  variant="outlined"
                  color="neutral"
                  startIcon="Add"
                  onClick={(s) => {
                    s.if(
                      sql`nullif(trim(choice_content), '') is null`,
                      (s) => s.return(),
                    );
                    s.modify(sql`
                      insert into item_choice_drafts
                        (id, content, is_correct)
                      values
                        (coalesce((
                           select max(id) + 1 from ui.item_choice_drafts
                         ), 1),
                         trim(choice_content),
                         false)
                    `);
                    s.setScalar("choice_content", sql.lit``);
                  }}
                >
                  Add choice
                </Button>
              </div>
            </div>
          </div>
        </Show>
        <Show when={sql`item_type = 'practical_observation'`}>
          <div className="border border-divider rounded-md p-3 grid gap-2">
            <Typography level="title-sm">Practical observation</Typography>
            <Checkbox
              checked={sql`item_practical_result_required`}
              label="A recorded result is required"
              onCheckboxChange={(s) =>
                s.setScalar(
                  "item_practical_result_required",
                  sql`target_checked`,
                )}
            />
            <Checkbox
              checked={sql`item_fail_result_fails_attempt`}
              label="A fail result fails the whole attempt"
              onCheckboxChange={(s) =>
                s.setScalar(
                  "item_fail_result_fails_attempt",
                  sql`target_checked`,
                )}
            />
            <Checkbox
              checked={sql`item_not_observed_fails_attempt`}
              label="Not observed fails the whole attempt"
              onCheckboxChange={(s) =>
                s.setScalar(
                  "item_not_observed_fails_attempt",
                  sql`target_checked`,
                )}
            />
            <Checkbox
              checked={sql`item_not_applicable_allowed`}
              label="Not applicable is allowed"
              onCheckboxChange={(s) =>
                s.setScalar(
                  "item_not_applicable_allowed",
                  sql`target_checked`,
                )}
            />
            <Checkbox
              checked={sql`item_reviewer_signature_required`}
              label="Evaluator signature required"
              onCheckboxChange={(s) =>
                s.setScalar(
                  "item_reviewer_signature_required",
                  sql`target_checked`,
                )}
            />
          </div>
        </Show>
        <div className="flex justify-end gap-2">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("item_modal_open", sql`false`)}
          >
            Cancel
          </Button>
          <Button
            startIcon="Save"
            onClick={(s) => {
              s.setScalar("assessment_edit_error", sql`null`);
              s.if(sql`nullif(trim(item_prompt), '') is null`, (s) => {
                s.setScalar(
                  "assessment_edit_error",
                  sql.lit`Enter the question prompt before saving.`,
                );
                s.return();
              });
              s.if(
                sql`item_type = 'multiple_choice'
                  and item_selection_mode = 'single'
                  and (
                    select count(*)
                    from ui.item_choice_drafts
                    where is_correct
                  ) > 1`,
                (s) => {
                  s.setScalar(
                    "assessment_edit_error",
                    sql
                      .lit`A single-answer question can only have one correct choice.`,
                  );
                  s.return();
                },
              );
              s.tryServer({
                body: (s) => {
                  s.startTransaction();
                  ensureAssessmentDraftVersion(s, {
                    block: props.block,
                    assessmentId: sql`selected_assessment.id`,
                  });
                  s.defScalar("saved_assessment_item_id", {
                    type: "BigInt",
                  });
                  s.if(
                    sql`ui.item_mode = 'edit'`,
                    (s) => {
                      s.setScalar(
                        "saved_assessment_item_id",
                        mapItemToDraftSql(
                          sql`nullif(ui.item_id, '')::bigint`,
                        ),
                      );
                      s.throwErrorIf(
                        sql`saved_assessment_item_id is null`,
                        sql.lit`The question was not found in the draft.`,
                      );
                      s.modify(sql`
                        update db.training_assessment_items
                        set type = ui.item_type,
                            prompt = trim(ui.item_prompt),
                            help_text = nullif(trim(ui.item_help_text), ''),
                            points = coalesce(
                              nullif(trim(ui.item_points), '')::int, 1),
                            include_in_score = ui.item_type != 'signature'
                              and ui.item_include_in_score,
                            is_required = ui.item_is_required,
                            requires_review = ui.item_type = 'text_response'
                              or ui.item_requires_review,
                            selection_mode = case
                              when ui.item_type = 'multiple_choice'
                              then ui.item_selection_mode
                              else null
                            end,
                            scoring_mode = case
                              when ui.item_type = 'multiple_choice'
                                and ui.item_selection_mode = 'multiple'
                              then ui.item_scoring_mode
                              else 'all_or_nothing'
                            end,
                            shuffle_choices =
                              ui.item_type = 'multiple_choice'
                              and ui.item_shuffle_choices,
                            explanation = case
                              when ui.item_type = 'multiple_choice'
                              then nullif(trim(ui.item_explanation), '')
                              else null
                            end,
                            remediation_text = case
                              when ui.item_type = 'multiple_choice'
                              then nullif(trim(ui.item_remediation_text), '')
                              else null
                            end,
                            practical_result_required =
                              ui.item_type = 'practical_observation'
                              and ui.item_practical_result_required,
                            fail_result_fails_attempt =
                              ui.item_type = 'practical_observation'
                              and ui.item_fail_result_fails_attempt,
                            not_observed_fails_attempt =
                              ui.item_type = 'practical_observation'
                              and ui.item_not_observed_fails_attempt,
                            not_applicable_allowed =
                              ui.item_type = 'practical_observation'
                              and ui.item_not_applicable_allowed,
                            reviewer_signature_required =
                              ui.item_type = 'practical_observation'
                              and ui.item_reviewer_signature_required
                        where id = saved_assessment_item_id
                      `);
                      s.modify(sql`
                        delete from db.training_assessment_item_choices
                        where training_assessment_item_id =
                          saved_assessment_item_id
                      `);
                    },
                    (s) => {
                      s.defScalar(
                        "draft_section_id",
                        mapSectionToDraftSql(
                          sql`nullif(ui.item_section_id, '')::bigint`,
                        ),
                      );
                      s.throwErrorIf(
                        sql`draft_section_id is null`,
                        sql.lit`The section was not found in the draft.`,
                      );
                      s.modify(sql`
                        insert into db.training_assessment_items
                          (training_assessment_section_id, type, prompt,
                           help_text, ordinal, points, include_in_score,
                           is_required, requires_review, selection_mode,
                           scoring_mode,
                           shuffle_choices, explanation, remediation_text,
                           practical_result_required,
                           fail_result_fails_attempt,
                           not_observed_fails_attempt,
                           not_applicable_allowed,
                           reviewer_signature_required)
                        values
                          (draft_section_id,
                           ui.item_type,
                           trim(ui.item_prompt),
                           nullif(trim(ui.item_help_text), ''),
                           (
                             select coalesce(max(item.ordinal), 0) + 10
                             from db.training_assessment_items item
                             join db.training_assessment_sections section
                               on section.id = item.training_assessment_section_id
                             where section.training_assessment_version_id =
                                 draft_assessment_version_id
                           ),
                           coalesce(nullif(trim(ui.item_points), '')::int, 1),
                           ui.item_type != 'signature'
                             and ui.item_include_in_score,
                           ui.item_is_required,
                           ui.item_type = 'text_response'
                             or ui.item_requires_review,
                           case
                             when ui.item_type = 'multiple_choice'
                             then ui.item_selection_mode
                             else null
                           end,
                           case
                             when ui.item_type = 'multiple_choice'
                               and ui.item_selection_mode = 'multiple'
                             then ui.item_scoring_mode
                             else 'all_or_nothing'
                           end,
                           ui.item_type = 'multiple_choice'
                             and ui.item_shuffle_choices,
                           case
                             when ui.item_type = 'multiple_choice'
                             then nullif(trim(ui.item_explanation), '')
                             else null
                           end,
                           case
                             when ui.item_type = 'multiple_choice'
                             then nullif(trim(ui.item_remediation_text), '')
                             else null
                           end,
                           ui.item_type = 'practical_observation'
                             and ui.item_practical_result_required,
                           ui.item_type = 'practical_observation'
                             and ui.item_fail_result_fails_attempt,
                           ui.item_type = 'practical_observation'
                             and ui.item_not_observed_fails_attempt,
                           ui.item_type = 'practical_observation'
                             and ui.item_not_applicable_allowed,
                           ui.item_type = 'practical_observation'
                             and ui.item_reviewer_signature_required)
                        returning id into saved_assessment_item_id
                      `);
                    },
                  );
                  s.if(sql`ui.item_type = 'multiple_choice'`, (s) => {
                    s.modify(sql`
                      insert into db.training_assessment_item_choices
                        (training_assessment_item_id, content, is_correct,
                         sort_order)
                      select saved_assessment_item_id, draft.content,
                             draft.is_correct,
                             row_number() over (order by draft.id) * 10
                      from ui.item_choice_drafts draft
                      order by draft.id
                    `);
                  });
                  s.commitTransaction();
                  s.setScalar("item_modal_open", sql`false`);
                  s.modify(sql`delete from ui.item_choice_drafts`);
                  s.refetch();
                },
                catch: (s) => {
                  s.setScalar(
                    "assessment_edit_error",
                    sql
                      .lit`The question could not be saved. Check the points and choices.`,
                  );
                },
              });
            }}
          >
            Save question
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
