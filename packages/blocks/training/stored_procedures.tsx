import {
  translationApprovedSql,
  translationReviewIdSql,
  translationReviewLockedSql,
} from "./translation_reviews";
import { courseDraftStepsUnchangedSql } from "./course_introduction";
import { currentUserHasPermission, userHasPermission } from "blocks/auth";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import { system } from "std/system";

import type { TrainingBlockOpts } from "./types.ts";
import {
  assessmentVersionPublishIssuesSql,
  createOrResumeAssessmentAttempt,
  deleteAssessmentChoiceSelectionSql,
  insertAssessmentChoiceSelectionSql,
  reviewAssessmentAttempt,
  reviewAssessmentResponse,
  saveAssessmentMetadataResponseSql,
  saveAssessmentResponseSql,
  selectAssessmentSingleChoiceSql,
  submitAssessmentAttempt,
} from "./assessment_helpers";
import {
  activeAssessmentVersionSql,
  activeCourseVersionSql,
  activeVersionIdSql,
  assignableCourseItemCountSql,
  assignableCourseItemWhereSql,
  assignmentLanguageSql,
  cancelOpenAssessmentAttemptsForCourseAssignmentsSql,
  cloneCourseVersionItemDocumentsSql,
  cloneCourseVersionItemsSql,
  cloneCourseVersionSectionsSql,
  closeRetrainingCasesForAssignmentSql,
  currentEmployeeId,
  defaultLanguageSql,
  employeeName,
  expandedCourseItemsCteSql,
  finalizeNewAssignmentsSql,
  insertCertificationsForCompletedAssignmentsSql,
  insertCourseTasksForAssignmentSql,
  insertCurrentCourseAssignmentTasksSql,
  insertDocumentTasksForAssignmentBatchSql,
  insertTaskItemDocumentSnapshotsSql,
  missingActiveVersionCountSql,
  openTrainingAssignmentWhereSql,
  personLanguageSql,
  personTable,
  replaceOpenCourseAssignmentTasksSql,
  revokeTrainingAccessTokensForClosedAssignmentSql,
  secondaryValidatorSignoffByPermission,
  setCurrentCourseVersionSql,
  trainingFeatureEnabled,
  trainingPermissions,
  trainingValidationLabels,
  updateAssignmentStatusAfterTaskCompletionSql,
  updateAssignmentStatusAfterValidationSql,
} from "./helpers";

function draftCourseVersionSql(courseId: Sql, language: Sql) {
  return sql`(
    select v.id
    from db.training_course_versions v
    where v.training_course_id = ${courseId}
      and v.status = 'draft' and v.language = ${language}
    order by v.created_at desc, v.id desc
    limit 1
  )`;
}

function draftAssessmentVersionSql(assessmentId: Sql, language: Sql) {
  return sql`(
    select v.id
    from db.training_assessment_versions v
    where v.training_assessment_id = ${assessmentId}
      and v.status = 'draft' and v.language = ${language}
    order by v.id desc
    limit 1
  )`;
}

function validTranslationSourceSql(
  opts: TrainingBlockOpts,
  kind: "course" | "assessment",
  recordId: Sql,
  versionId: Sql,
) {
  const versions = sql.ref(`training_${kind}_versions`);
  const parent = sql.ref(`training_${kind}_id`);
  return sql`exists (
    select 1 from db.${versions} version
    join db.${versions} source on source.id = case
      when version.language = ${defaultLanguageSql(opts)} then version.id
      else version.source_version_id end
    where version.id = ${versionId} and version.${parent} = ${recordId}
      and source.${parent} = ${recordId}
      and source.language = ${defaultLanguageSql(opts)}
      and source.status in ('published', 'archived')
  )`;
}

/**
 * Registers the training block's stored procedures: copy-on-write draft
 * creation for course and assessment versions, and the assessment attempt
 * lifecycle mutations with their authorization checks server-side.
 *
 * Draft creation runs entirely inside one transaction and the engine
 * serializes transactions, so the check-or-create of the single open draft
 * per course/assessment cannot race with a concurrent creation.
 */
export function registerTrainingStoredProcedures(opts: TrainingBlockOpts) {
  const permissions = trainingPermissions;
  const complianceEnabled = trainingFeatureEnabled(opts, "compliance");
  const inviteEnabled = trainingFeatureEnabled(opts, "inviteAccess");
  // True when the caller presented an invite token that grants the
  // assignment. Compiled to false when invite access is disabled (the token
  // table does not exist then).
  const tokenGrantsAssignmentSql = (assignmentId: Sql) =>
    inviteEnabled
      ? sql`(
          p_access_token is not null
          and exists (
            select 1
            from db.training_access_tokens token
            where token.token = p_access_token
              and token.training_assignment_id = ${assignmentId}
              and token.revoked_at is null
              and token.expires_at > now()
              and exists (
                select 1
                from db.training_assignments token_assignment
                where token_assignment.id = token.training_assignment_id
                  and ${openTrainingAssignmentWhereSql(sql`token_assignment`)}
              )
          )
        )`
      : sql`(p_access_token is not null and false)`;
  const attemptActorSql = (accessPersonId: Sql) =>
    sql`case
      when p_access_token is not null then ${accessPersonId}
      else ${currentEmployeeId(opts)}
    end`;

  system.storedProcedure({
    name: "training_withdraw_course_assignment",
    transaction: "standalone",
    inputScalars: [
      { name: "p_assignment_id", type: "BigInt" },
      { name: "p_reason", type: { type: "String", maxLength: 1000 } },
    ],
    procedure: (s) => {
      s.startTransaction();
      s.throwErrorUnless(
        currentUserHasPermission(sql.lit(permissions.assignTraining)),
        sql.lit`You cannot withdraw training assignments.`,
      );
      s.defScalar("withdrawn_by_id", currentEmployeeId(opts));
      s.throwErrorIf(
        sql`withdrawn_by_id is null`,
        sql.lit`A workforce profile is required.`,
      );
      s.throwErrorIf(
        sql`nullif(trim(p_reason), '') is null`,
        sql.lit`Enter a reason for withdrawing this assignment.`,
      );
      s.throwErrorUnless(
        sql`exists (
        select 1 from db.training_assignments assignment
        where assignment.id = p_assignment_id
          and assignment.training_course_id is not null
          and assignment.status in ('pending', 'in_progress')
          and exists (select 1 from db.training_employee_tasks task
            where task.training_assignment_id = assignment.id
              and task.status in ('assigned', 'in_progress'))
      )`,
        sql.lit`This course assignment has no outstanding tasks to withdraw.`,
      );
      s.modify(sql`update db.training_assessment_attempts
        set status = 'cancelled', outcome = null, cancelled_at = now(),
            cancelled_by_id = withdrawn_by_id
        where status in ('in_progress', 'review_pending')
          and training_employee_task_id in (
            select id from db.training_employee_tasks
            where training_assignment_id = p_assignment_id
              and status in ('assigned', 'in_progress'))`);
      s.modify(sql`update db.training_employee_tasks
        set status = 'waived', waived_by_id = withdrawn_by_id,
            waived_at = now(), waiver_reason = trim(p_reason)
        where training_assignment_id = p_assignment_id
          and status in ('assigned', 'in_progress')`);
      s.modify(sql`update db.training_assignments set status = 'waived'
        where id = p_assignment_id`);
      if (inviteEnabled) {
        s.modify(revokeTrainingAccessTokensForClosedAssignmentSql({
          opts,
          assignmentId: sql`p_assignment_id`,
        }));
      }
      s.commitTransaction();
    },
  });

  system.storedProcedure({
    name: "training_discard_assessment_draft",
    transaction: "caller",
    inputScalars: [{ name: "p_assessment_id", type: "BigInt" }, {
      name: "p_version_id",
      type: "BigInt",
    }, { name: "p_language", type: { type: "String", maxLength: 20 } }],
    procedure: (s) => {
      s.throwErrorUnless(
        sql`${
          currentUserHasPermission(sql.lit(permissions.manageAssessments))
        } and exists (
        select 1 from db.training_assessment_versions where id = p_version_id
          and training_assessment_id = p_assessment_id and language = p_language and status = 'draft')`,
        sql.lit`This draft is no longer editable. Refresh the page.`,
      );
      s.throwErrorIf(
        translationReviewLockedSql("assessment", sql`p_version_id`),
        sql
          .lit`Withdraw the translation review before discarding these changes.`,
      );
      s.if(
        sql`${
          translationReviewIdSql("assessment", sql`p_version_id`)
        } is not null`,
        (s) => {
          s.modify(
            sql`update db.training_assessment_versions set status = 'archived', archived_at = now() where id = p_version_id`,
          );
          s.return();
        },
      );
      s.modify(sql`
                              delete from db.training_assessment_metadata_field_choices
                              where training_assessment_metadata_field_id in (
                                select field.id
                                from db.training_assessment_metadata_fields field
                                where field.training_assessment_version_id =
                                  p_version_id
                              )
                            `);
      s.modify(sql`
                              delete from db.training_assessment_metadata_fields
                              where training_assessment_version_id =
                                p_version_id
                            `);
      s.modify(sql`
                              delete from db.training_assessment_item_choices
                              where training_assessment_item_id in (
                                select item.id
                                from db.training_assessment_items item
                                join db.training_assessment_sections section
                                  on section.id = item.training_assessment_section_id
                                where section.training_assessment_version_id =
                                  p_version_id
                              )
                            `);
      s.modify(sql`
                              delete from db.training_assessment_items
                              where training_assessment_section_id in (
                                select section.id
                                from db.training_assessment_sections section
                                where section.training_assessment_version_id =
                                  p_version_id
                              )
                            `);
      s.modify(sql`
                              delete from db.training_assessment_sections
                              where training_assessment_version_id =
                                p_version_id
                            `);
      s.modify(sql`
                              delete from db.training_assessment_versions
                              where id = p_version_id
                                and status = 'draft'
                            `);
    },
  });

  system.storedProcedure({
    name: "training_ensure_course_draft",
    transaction: "caller",
    inputScalars: [{ name: "p_course_id", type: "BigInt" }],
    outputScalars: [{ name: "draft_course_version_id", type: "BigInt" }, {
      name: "source_course_version_id",
      type: "BigInt",
    }],
    procedure: (s) =>
      s.callStoredProcedure("training_ensure_course_draft_language", {
        inputScalars: {
          p_course_id: sql`p_course_id`,
          p_language: defaultLanguageSql(opts),
          p_source_version: sql`null`,
        },
        outputScalars: {
          draft_course_version_id: "draft_course_version_id",
          source_course_version_id: "source_course_version_id",
        },
      }),
  });
  system.storedProcedure({
    name: "training_publish_course_draft",
    transaction: "caller",
    inputScalars: [{ name: "p_course_id", type: "BigInt" }],
    outputScalars: [],
    procedure: (s) =>
      s.callStoredProcedure("training_publish_course_draft_language", {
        inputScalars: {
          p_course_id: sql`p_course_id`,
          p_language: defaultLanguageSql(opts),
        },
        outputScalars: {},
      }),
  });
  system.storedProcedure({
    name: "training_ensure_assessment_draft",
    transaction: "caller",
    inputScalars: [{ name: "p_assessment_id", type: "BigInt" }],
    outputScalars: [{ name: "draft_assessment_version_id", type: "BigInt" }],
    procedure: (s) =>
      s.callStoredProcedure("training_ensure_assessment_draft_language", {
        inputScalars: {
          p_assessment_id: sql`p_assessment_id`,
          p_language: defaultLanguageSql(opts),
          p_source_version: sql`null`,
        },
        outputScalars: {
          draft_assessment_version_id: "draft_assessment_version_id",
        },
      }),
  });
  system.storedProcedure({
    name: "training_publish_assessment_draft",
    transaction: "caller",
    inputScalars: [{ name: "p_assessment_id", type: "BigInt" }],
    outputScalars: [],
    procedure: (s) =>
      s.callStoredProcedure("training_publish_assessment_draft_language", {
        inputScalars: {
          p_assessment_id: sql`p_assessment_id`,
          p_language: defaultLanguageSql(opts),
        },
        outputScalars: {},
      }),
  });
  system.storedProcedure({
    name: "training_ensure_course_draft_language",
    transaction: "caller",
    inputScalars: [
      { name: "p_course_id", type: "BigInt" },
      { name: "p_language", type: { type: "String", maxLength: 20 } },
      { name: "p_source_version", type: "BigInt" },
    ],
    outputScalars: [
      { name: "draft_course_version_id", type: "BigInt" },
      // The version the caller's UI was showing when it triggered the edit:
      // the pre-existing draft, or the published version the new draft was
      // cloned from. Section/item ids the UI holds belong to this version.
      { name: "source_course_version_id", type: "BigInt" },
    ],
    procedure: (s) => {
      s.throwErrorUnless(
        sql.inList(
          sql`p_language`,
          opts.content.opts.languages.map((l) => sql.lit(l.code)),
        ),
        sql.lit`Choose a supported language.`,
      );
      s.throwErrorUnless(
        currentUserHasPermission(sql.lit(permissions.manageLibrary)),
        sql.lit`You do not have permission to edit this training content.`,
      );
      s.throwErrorIf(
        sql`p_source_version is not null and not exists (select 1 from db.training_course_versions where id = p_source_version and training_course_id = p_course_id and status = 'published' and language = ${
          defaultLanguageSql(opts)
        })`,
        sql.lit`Choose a published source version.`,
      );

      s.defScalar(
        "existing_draft_course_version_id",
        draftCourseVersionSql(sql`p_course_id`, sql`p_language`),
      );
      s.defScalar(
        "published_course_version_id",
        sql`coalesce(p_source_version, ${
          activeCourseVersionSql(sql`p_course_id`, sql`p_language`)
        })`,
      );
      s.throwErrorIf(
        translationReviewLockedSql(
          "course",
          sql`existing_draft_course_version_id`,
        ),
        sql
          .lit`This translation is locked for review. Withdraw the review before editing.`,
      );
      s.if(
        sql`${
          translationReviewIdSql(
            "course",
            sql`existing_draft_course_version_id`,
          )
        } is not null`,
        (s) => {
          // Keep the reviewed text and its decisions together; edit a fresh copy.
          s.setScalar(
            "published_course_version_id",
            sql`existing_draft_course_version_id`,
          );
          s.modify(
            sql`update db.training_course_versions set status = 'archived', archived_at = now() where id = existing_draft_course_version_id`,
          );
          s.setScalar("existing_draft_course_version_id", sql`null`);
        },
      );
      s.throwErrorIf(
        sql`p_language != ${defaultLanguageSql(opts)} and not ${
          validTranslationSourceSql(
            opts,
            "course",
            sql`p_course_id`,
            sql`coalesce(existing_draft_course_version_id, published_course_version_id)`,
          )
        }`,
        sql
          .lit`A translated draft must be linked to a published default-language version of this course. Publish that version first.`,
      );
      s.modify(sql`
        insert into db.training_course_versions
          (training_course_id, version_label, status, effective_at,
           created_by_id, language, source_version_id, localized_name, localized_description)
        select p_course_id, 'Draft', 'draft', current_date(),
               ${currentEmployeeId(opts)}, p_language,
               (select case when language != p_language then id else source_version_id end from db.training_course_versions where id = published_course_version_id),
               (select coalesce(v.localized_name,c.name) from db.training_courses c left join db.training_course_versions v on v.id = published_course_version_id where c.id = p_course_id),
               (select case when v.localized_name is null then c.description else v.localized_description end from db.training_courses c left join db.training_course_versions v on v.id = published_course_version_id where c.id = p_course_id)
        where existing_draft_course_version_id is null
      `);
      s.setScalar(
        "draft_course_version_id",
        draftCourseVersionSql(sql`p_course_id`, sql`p_language`),
      );
      s.if(
        sql`existing_draft_course_version_id is null
          and published_course_version_id is not null`,
        (s) => {
          s.modify(sql`update db.training_course_versions set introduction =
            (select introduction from db.training_course_versions where id = published_course_version_id)
            where id = draft_course_version_id`);
          s.modify(
            sql`insert into db.training_course_introduction_images (training_course_version_id, file_version_id)
            select draft_course_version_id, file_version_id from db.training_course_introduction_images
            where training_course_version_id = published_course_version_id`,
          );
          s.modify(cloneCourseVersionSectionsSql({
            oldCourseVersionId: sql`published_course_version_id`,
            newCourseVersionId: sql`draft_course_version_id`,
          }));
          s.modify(cloneCourseVersionItemsSql({
            oldCourseVersionId: sql`published_course_version_id`,
            newCourseVersionId: sql`draft_course_version_id`,
          }));
          s.modify(cloneCourseVersionItemDocumentsSql({
            oldCourseVersionId: sql`published_course_version_id`,
            newCourseVersionId: sql`draft_course_version_id`,
          }));
        },
      );
      s.setScalar(
        "source_course_version_id",
        sql`coalesce(
          existing_draft_course_version_id,
          published_course_version_id
        )`,
      );
      // Pre-feature drafts have no localized metadata; initialize it before editing.
      s.modify(sql`update db.training_course_versions set
        localized_name = (select name from db.training_courses where id = p_course_id),
        localized_description = coalesce(localized_description, (select description from db.training_courses where id = p_course_id))
        where id = draft_course_version_id and localized_name is null`);
    },
  });

  system.storedProcedure({
    name: "training_ensure_assessment_draft_language",
    transaction: "caller",
    inputScalars: [
      { name: "p_assessment_id", type: "BigInt" },
      { name: "p_language", type: { type: "String", maxLength: 20 } },
      { name: "p_source_version", type: "BigInt" },
    ],
    outputScalars: [
      { name: "draft_assessment_version_id", type: "BigInt" },
    ],
    procedure: (s) => {
      s.throwErrorUnless(
        sql.inList(
          sql`p_language`,
          opts.content.opts.languages.map((l) => sql.lit(l.code)),
        ),
        sql.lit`Choose a supported language.`,
      );
      s.throwErrorUnless(
        currentUserHasPermission(sql.lit(permissions.manageAssessments)),
        sql.lit`You do not have permission to edit this training content.`,
      );
      s.throwErrorIf(
        sql`p_source_version is not null and not exists (select 1 from db.training_assessment_versions where id = p_source_version and training_assessment_id = p_assessment_id and status = 'published' and language = ${
          defaultLanguageSql(opts)
        })`,
        sql.lit`Choose a published source version.`,
      );

      s.defScalar(
        "published_assessment_version_id",
        sql`coalesce(p_source_version, ${
          activeAssessmentVersionSql(sql`p_assessment_id`, sql`p_language`)
        })`,
      );
      s.setScalar(
        "draft_assessment_version_id",
        draftAssessmentVersionSql(sql`p_assessment_id`, sql`p_language`),
      );
      s.throwErrorIf(
        translationReviewLockedSql(
          "assessment",
          sql`draft_assessment_version_id`,
        ),
        sql
          .lit`This translation is locked for review. Withdraw the review before editing.`,
      );
      s.if(
        sql`${
          translationReviewIdSql("assessment", sql`draft_assessment_version_id`)
        } is not null`,
        (s) => {
          // Keep the reviewed text and its decisions together; edit a fresh copy.
          s.setScalar(
            "published_assessment_version_id",
            sql`draft_assessment_version_id`,
          );
          s.modify(
            sql`update db.training_assessment_versions set status = 'archived', archived_at = now() where id = draft_assessment_version_id`,
          );
          s.setScalar("draft_assessment_version_id", sql`null`);
        },
      );
      s.throwErrorIf(
        sql`p_language != ${defaultLanguageSql(opts)} and not ${
          validTranslationSourceSql(
            opts,
            "assessment",
            sql`p_assessment_id`,
            sql`coalesce(draft_assessment_version_id, published_assessment_version_id)`,
          )
        }`,
        sql
          .lit`A translated draft must be linked to a published default-language version of this assessment. Publish that version first.`,
      );
      s.if(sql`draft_assessment_version_id is null`, (s) => {
        s.modify(sql`
          insert into db.training_assessment_versions
            (training_assessment_id, version_label, status, created_by_id, language, source_version_id, localized_name, localized_description)
          values
            (p_assessment_id, 'Draft', 'draft',
             ${currentEmployeeId(opts)}, p_language,
              (select case when language != p_language then id else source_version_id end from db.training_assessment_versions where id = published_assessment_version_id),
              (select coalesce(v.localized_name,a.name) from db.training_assessments a left join db.training_assessment_versions v on v.id = published_assessment_version_id where a.id = p_assessment_id),
              (select case when v.localized_name is null then a.description else v.localized_description end from db.training_assessments a left join db.training_assessment_versions v on v.id = published_assessment_version_id where a.id = p_assessment_id))
        `);
        s.setScalar(
          "draft_assessment_version_id",
          draftAssessmentVersionSql(sql`p_assessment_id`, sql`p_language`),
        );
        s.if(sql`published_assessment_version_id is not null`, (s) => {
          s.defRecord(
            "published_assessment_policy",
            sql`select passing_score_percent, max_attempts, cooldown_minutes,
                       allow_retake_after_pass, score_adjustment_allowed,
                       outcome_override_allowed,
                       show_correct_answers_after_submission,
                       show_failed_attempts_to_employee
                from db.training_assessment_versions
                where id = published_assessment_version_id`,
          );
          s.modify(sql`
            update db.training_assessment_versions
            set passing_score_percent =
                  published_assessment_policy.passing_score_percent,
                max_attempts = published_assessment_policy.max_attempts,
                cooldown_minutes =
                  published_assessment_policy.cooldown_minutes,
                allow_retake_after_pass =
                  published_assessment_policy.allow_retake_after_pass,
                score_adjustment_allowed =
                  published_assessment_policy.score_adjustment_allowed,
                outcome_override_allowed =
                  published_assessment_policy.outcome_override_allowed,
                show_correct_answers_after_submission =
                  published_assessment_policy.show_correct_answers_after_submission,
                show_failed_attempts_to_employee =
                  published_assessment_policy.show_failed_attempts_to_employee
            where id = draft_assessment_version_id
          `);
          s.modify(sql`
            insert into db.training_assessment_metadata_fields
              (training_assessment_version_id, key, label, type, required,
               ordinal, help_text)
            select draft_assessment_version_id, field.key, field.label,
                   field.type, field.required,
                   field.ordinal, field.help_text
            from db.training_assessment_metadata_fields field
            where field.training_assessment_version_id =
              published_assessment_version_id
          `);
          s.modify(sql`
            insert into db.training_assessment_metadata_field_choices
              (training_assessment_metadata_field_id, label, value, sort_order)
            select new_field.id, choice.label, choice.value, choice.sort_order
            from db.training_assessment_metadata_field_choices choice
            join db.training_assessment_metadata_fields old_field
              on old_field.id = choice.training_assessment_metadata_field_id
            join db.training_assessment_metadata_fields new_field
              on new_field.training_assessment_version_id =
                draft_assessment_version_id
             and new_field.key = old_field.key
            where old_field.training_assessment_version_id =
              published_assessment_version_id
          `);
          // The draft is created fresh inside this transaction, so every
          // cloned row below carries its stable clone key
          // (source_section_id / source_item_id); the joins that map
          // published rows to draft rows rely on them. Null keys (rows
          // predating the columns) simply match nothing.
          s.modify(sql`
            insert into db.training_assessment_sections
              (training_assessment_version_id, name, description, ordinal,
               source_section_id)
            select draft_assessment_version_id,
                   section.name, section.description, section.ordinal,
                   section.id
            from db.training_assessment_sections section
            where section.training_assessment_version_id =
              published_assessment_version_id
          `);
          s.modify(sql`
            insert into db.training_assessment_items
              (training_assessment_section_id, type, prompt, help_text, ordinal,
               points, include_in_score, is_required, requires_review,
               selection_mode, scoring_mode, shuffle_choices, explanation,
               remediation_text,
               practical_result_required, fail_result_fails_attempt,
               not_observed_fails_attempt, not_applicable_allowed,
               reviewer_signature_required, source_item_id)
            select (
                     select new_section.id
                     from db.training_assessment_sections new_section
                     where new_section.training_assessment_version_id =
                       draft_assessment_version_id
                       and new_section.source_section_id = old_section.id
                     limit 1
                   ),
                   item.type, item.prompt, item.help_text, item.ordinal,
                   item.points, item.include_in_score, item.is_required,
                   item.requires_review, item.selection_mode, item.scoring_mode,
                   item.shuffle_choices,
                   item.explanation, item.remediation_text,
                   item.practical_result_required,
                   item.fail_result_fails_attempt,
                   item.not_observed_fails_attempt, item.not_applicable_allowed,
                   item.reviewer_signature_required, item.id
            from db.training_assessment_items item
            join db.training_assessment_sections old_section
              on old_section.id = item.training_assessment_section_id
            where old_section.training_assessment_version_id =
              published_assessment_version_id
          `);
          s.modify(sql`
            insert into db.training_assessment_item_choices
              (training_assessment_item_id, content, is_correct, sort_order,
               explanation)
            select new_item.id, choice.content, choice.is_correct,
                   choice.sort_order, choice.explanation
            from db.training_assessment_item_choices choice
            join db.training_assessment_items old_item
              on old_item.id = choice.training_assessment_item_id
            join db.training_assessment_sections old_section
              on old_section.id = old_item.training_assessment_section_id
            join db.training_assessment_items new_item
              on new_item.source_item_id = old_item.id
            join db.training_assessment_sections new_section
              on new_section.id = new_item.training_assessment_section_id
             and new_section.training_assessment_version_id =
               draft_assessment_version_id
            where old_section.training_assessment_version_id =
              published_assessment_version_id
          `);
        });
      });
      // Pre-feature drafts have no localized metadata; initialize it before editing.
      s.modify(sql`update db.training_assessment_versions set
        localized_name = (select name from db.training_assessments where id = p_assessment_id),
        localized_description = coalesce(localized_description, (select description from db.training_assessments where id = p_assessment_id))
        where id = draft_assessment_version_id and localized_name is null`);
    },
  });

  // Publishing a course draft moves open course assignments onto it; the
  // admin editor and Spark share this one compiled path.
  system.storedProcedure({
    name: "training_publish_course_draft_language",
    transaction: "caller",
    inputScalars: [{ name: "p_course_id", type: "BigInt" }, {
      name: "p_language",
      type: { type: "String", maxLength: 20 },
    }],
    procedure: (s) => {
      s.throwErrorUnless(
        sql.inList(
          sql`p_language`,
          opts.content.opts.languages.map((l) => sql.lit(l.code)),
        ),
        sql.lit`Choose a supported language.`,
      );

      s.throwErrorUnless(
        currentUserHasPermission(sql.lit(permissions.publishTraining)),
        sql.lit`You do not have permission to publish training.`,
      );
      s.defScalar(
        "published_course_version_id",
        draftCourseVersionSql(sql`p_course_id`, sql`p_language`),
      );
      s.throwErrorIf(
        sql`published_course_version_id is null`,
        sql.lit`This course has no draft changes to publish.`,
      );
      s.throwErrorIf(
        sql`p_language != ${defaultLanguageSql(opts)} and not ${
          translationApprovedSql("course", sql`published_course_version_id`)
        }`,
        sql
          .lit`All assigned translation reviewers must approve before publication.`,
      );
      s.throwErrorIf(
        sql`p_language != ${defaultLanguageSql(opts)} and not ${
          validTranslationSourceSql(
            opts,
            "course",
            sql`p_course_id`,
            sql`published_course_version_id`,
          )
        }`,
        sql
          .lit`This translation has no valid default-language source. Recreate it from the published default-language course before publishing.`,
      );
      s.throwErrorUnless(
        sql`(select is_active from db.training_courses where id = p_course_id)`,
        sql.lit`Restore this course before publishing.`,
      );
      // Validate the draft's full program before replacing any existing tasks.
      s.throwErrorUnless(
        sql`exists (
          with recursive ${
          expandedCourseItemsCteSql(
            sql`version.id = published_course_version_id`,
            sql`p_language`,
          )
        }
          select 1 from expanded_items expanded
          join db.training_course_section_items i on i.id = expanded.item_id
          where ${assignableCourseItemWhereSql()}
        )`,
        sql.lit`Add at least one assignable training item before publishing.`,
      );
      s.throwErrorIf(
        sql`exists (
          with recursive ${
          expandedCourseItemsCteSql(
            sql`section.training_course_version_id = published_course_version_id`,
          )
        }
          select 1
          from expanded_items expanded
          join db.training_course_section_items item on item.id = expanded.item_id
          join db.training_courses linked_course on linked_course.id = item.other_course_id
          where item.type = 'other_checklist' and not linked_course.is_active
        )`,
        sql
          .lit`This program contains archived courses. Restore or remove them before publishing.`,
      );
      s.defScalar(
        "previous_course_version_id",
        activeCourseVersionSql(sql`p_course_id`, sql`p_language`, true),
      );
      s.defScalar(
        "steps_unchanged",
        sql`(${
          courseDraftStepsUnchangedSql(
            sql`published_course_version_id`,
            sql`previous_course_version_id`,
          )
        })`,
      );
      s.modify(sql`
        update db.training_course_versions
        set status = 'archived',
            archived_at = coalesce(archived_at, now())
        where id = ${
        activeCourseVersionSql(sql`p_course_id`, sql`p_language`, true)
      }
      `);
      s.modify(sql`
        update db.training_course_versions
        set status = 'published',
            version_label = 'Rev ' || (
              select coalesce(count(*), 0) + 1
              from db.training_course_versions
              where training_course_id = p_course_id
                and status != 'draft'
            ),
            published_by_id = ${currentEmployeeId(opts)},
            published_at = now()
        where id = published_course_version_id
          and status = 'draft'
      `);
      s.if(
        sql`p_language = ${defaultLanguageSql(opts)}`,
        (s) =>
          s.modify(setCurrentCourseVersionSql({
            courseId: sql`p_course_id`,
            courseVersionId: sql`published_course_version_id`,
          })),
      );
      s.modify(sql`update db.training_courses set
        name = coalesce((select localized_name from db.training_course_versions where id = published_course_version_id), name),
        description = case when (select localized_name from db.training_course_versions where id = published_course_version_id) is null
              then description else (select localized_description from db.training_course_versions where id = published_course_version_id) end
        where id = p_course_id and p_language = ${defaultLanguageSql(opts)}`);
      s.modify(
        sql`update db.training_assignments set training_course_version_id = published_course_version_id
        where training_course_id = p_course_id and status in ('pending', 'in_progress')
          and ${
          activeCourseVersionSql(sql`p_course_id`, sql`training_language`)
        } = published_course_version_id`,
      );
      s.if(sql`not steps_unchanged`, (s) => {
        s.modify(cancelOpenAssessmentAttemptsForCourseAssignmentsSql({
          courseId: sql`p_course_id`,
          cancelledById: currentEmployeeId(opts),
          versionId: sql`published_course_version_id`,
        }));
        s.modify(replaceOpenCourseAssignmentTasksSql({
          courseId: sql`p_course_id`,
          versionId: sql`published_course_version_id`,
        }));
        s.defTable(
          "publication_languages",
          sql`select distinct training_language as language from db.training_assignments where training_course_id = p_course_id and training_course_version_id = published_course_version_id and status in ('pending', 'in_progress')`,
        );
        s.forEachTable(
          "publication_languages",
          "publication_language",
          (s) =>
            s.modify(insertCurrentCourseAssignmentTasksSql({
              courseId: sql`p_course_id`,
              newCourseVersionId: sql`published_course_version_id`,
              language: sql`publication_language.language`,
            })),
        );
        s.modify(insertTaskItemDocumentSnapshotsSql(
          opts,
          sql`t.status in ('assigned', 'in_progress')
            and task_assignment.training_course_id = p_course_id
            and task_assignment.training_course_version_id = published_course_version_id
            and task_assignment.status in ('pending', 'in_progress')`,
        ));
      });
    },
  });

  system.storedProcedure({
    name: "training_publish_assessment_draft_language",
    transaction: "caller",
    inputScalars: [{ name: "p_assessment_id", type: "BigInt" }, {
      name: "p_language",
      type: { type: "String", maxLength: 20 },
    }],
    procedure: (s) => {
      s.throwErrorUnless(
        sql.inList(
          sql`p_language`,
          opts.content.opts.languages.map((l) => sql.lit(l.code)),
        ),
        sql.lit`Choose a supported language.`,
      );

      s.throwErrorUnless(
        currentUserHasPermission(sql.lit(permissions.publishAssessments)),
        sql.lit`You do not have permission to publish assessments.`,
      );
      s.defScalar(
        "published_assessment_version_id",
        draftAssessmentVersionSql(sql`p_assessment_id`, sql`p_language`),
      );
      s.throwErrorIf(
        sql`published_assessment_version_id is null`,
        sql.lit`The draft assessment version no longer exists.`,
      );
      s.throwErrorIf(
        sql`p_language != ${defaultLanguageSql(opts)} and not ${
          translationApprovedSql(
            "assessment",
            sql`published_assessment_version_id`,
          )
        }`,
        sql
          .lit`All assigned translation reviewers must approve before publication.`,
      );
      s.throwErrorIf(
        sql`p_language != ${defaultLanguageSql(opts)} and not ${
          validTranslationSourceSql(
            opts,
            "assessment",
            sql`p_assessment_id`,
            sql`published_assessment_version_id`,
          )
        }`,
        sql
          .lit`This translation has no valid default-language source. Recreate it from the published default-language assessment before publishing.`,
      );
      s.defScalar(
        "assessment_publish_issue_text",
        sql`(select string_agg(issue, ' ') from (${
          assessmentVersionPublishIssuesSql(
            sql`published_assessment_version_id`,
          )
        }) issues)`,
      );
      s.throwErrorIf(
        sql`assessment_publish_issue_text is not null`,
        sql`'Resolve these blockers before publishing: ' ||
          assessment_publish_issue_text`,
      );
      s.modify(sql`
        update db.training_assessment_versions
        set status = 'archived',
            archived_at = coalesce(archived_at, now())
        where training_assessment_id = p_assessment_id
          and status = 'published' and language = p_language
      `);
      s.modify(sql`
        update db.training_assessment_versions
        set status = 'published',
            version_label = 'Rev ' || ((
              select count(*)
              from db.training_assessment_versions v
              where v.training_assessment_id = p_assessment_id
                and v.status != 'draft'
            ) + 1)::string,
            published_by_id = ${currentEmployeeId(opts)},
            published_at = now()
        where id = published_assessment_version_id
          and status = 'draft'
      `);
      s.modify(sql`
        update db.training_assessments
        set current_training_assessment_version_id = published_assessment_version_id,
            name = coalesce((select localized_name from db.training_assessment_versions where id = published_assessment_version_id), name),
            description = case when (select localized_name from db.training_assessment_versions where id = published_assessment_version_id) is null
              then description else (select localized_description from db.training_assessment_versions where id = published_assessment_version_id) end
        where id = p_assessment_id and p_language = ${defaultLanguageSql(opts)}
      `);
    },
  });

  system.storedProcedure({
    name: "training_decide_assessment_attempt",
    transaction: "standalone",
    inputScalars: [
      { name: "p_attempt_id", type: "BigInt" },
      { name: "p_action", type: { type: "String", maxLength: 40 } },
      { name: "p_notes", type: { type: "String", maxLength: 2000 } },
      { name: "p_override_reason", type: { type: "String", maxLength: 1000 } },
      {
        name: "p_signature_data",
        type: { type: "String", maxLength: 1000000 },
      },
    ],
    procedure: (s) => {
      s.startTransaction();
      s.defRecord(
        "assessment_decision_attempt",
        sql`select att.id, task.training_assignment_id, task.status as task_status,
               assignment.status as assignment_status,
               version.outcome_override_allowed
            from db.training_assessment_attempts att
            join db.training_employee_tasks task
              on task.id = att.training_employee_task_id
            join db.training_assignments assignment
              on assignment.id = task.training_assignment_id
            join db.training_assessment_versions version
              on version.id = att.training_assessment_version_id
            where att.id = p_attempt_id`,
      );
      s.throwErrorIf(
        sql`assessment_decision_attempt.id is null`,
        sql.lit`Assessment attempt not found.`,
      );
      s.throwErrorIf(
        sql`assessment_decision_attempt.task_status not in
            ('assigned', 'in_progress')
          or assessment_decision_attempt.assignment_status not in
            ('pending', 'in_progress', 'validation_pending')`,
        sql.lit`This assessment attempt is no longer active.`,
      );
      s.defScalar(
        "assessment_decision_can_review",
        currentUserHasPermission(sql.lit(permissions.reviewAssessments)),
      );
      s.defScalar(
        "assessment_decision_can_override",
        currentUserHasPermission(
          sql.lit(permissions.overrideAssessmentOutcomes),
        ),
      );
      s.defScalar(
        "assessment_decision_can_record",
        currentUserHasPermission(sql.lit(permissions.recordEvaluations)),
      );
      s.throwErrorIf(
        sql`not case p_action
          when 'approve' then assessment_decision_can_review
          when 'fail' then assessment_decision_can_review
          when 'request_retake' then assessment_decision_can_review
            or assessment_decision_can_override
          when 'pass_override' then assessment_decision_can_override
          when 'fail_override' then assessment_decision_can_override
          when 'cancel' then assessment_decision_can_review
            or assessment_decision_can_record
          else true
        end`,
        sql.lit`You do not have permission to apply this review action.`,
      );
      s.throwErrorIf(
        sql`p_action in ('pass_override', 'fail_override')
          and not assessment_decision_attempt.outcome_override_allowed`,
        sql.lit`Outcome overrides are not allowed for this assessment.`,
      );
      reviewAssessmentAttempt(s, {
        opts,
        attemptId: sql`assessment_decision_attempt.id`,
        reviewerId: currentEmployeeId(opts),
        action: sql`p_action`,
        notes: sql`p_notes`,
        overrideReason: sql`p_override_reason`,
        signatureData: sql`p_signature_data`,
      });
      // Certification issuance is owned by training_complete_task (reached
      // through the assessment bridge when the attempt passes).
      s.commitTransaction();
    },
  });

  system.storedProcedure({
    name: "training_review_assessment_response",
    transaction: "standalone",
    inputScalars: [
      { name: "p_response_id", type: "BigInt" },
      { name: "p_action", type: { type: "String", maxLength: 40 } },
      { name: "p_points_awarded", type: "Double" },
      { name: "p_notes", type: { type: "String", maxLength: 2000 } },
    ],
    procedure: (s) => {
      s.startTransaction();
      s.throwErrorIf(
        sql`not ${
          currentUserHasPermission(sql.lit(permissions.reviewAssessments))
        }`,
        sql.lit`You do not have permission to review assessment responses.`,
      );
      reviewAssessmentResponse(s, {
        responseId: sql`p_response_id`,
        reviewerId: currentEmployeeId(opts),
        action: sql`p_action`,
        pointsAwarded: sql`p_points_awarded`,
        notes: sql`p_notes`,
      });
      s.commitTransaction();
    },
  });

  system.storedProcedure({
    name: "training_start_assessment_attempt",
    transaction: "standalone",
    inputScalars: [
      { name: "p_task_id", type: "BigInt" },
      { name: "p_access_token", type: { type: "String", maxLength: 120 } },
    ],
    procedure: (s) => {
      s.startTransaction();
      s.defRecord(
        "assessment_start_access",
        sql`select t.id, a.id as training_assignment_id, a.person_id,
            (
              select assessment.execution_mode
              from db.training_course_section_items item
              join db.training_assessments assessment
                on assessment.id = item.training_assessment_id
              where item.id = t.training_course_section_item_id
            ) as execution_mode
            from db.training_employee_tasks t
            join db.training_assignments a
              on a.id = t.training_assignment_id
            where t.id = p_task_id`,
      );
      s.throwErrorIf(
        sql`assessment_start_access.id is null`,
        sql.lit`Training task not found.`,
      );
      // Evaluators may only act on trainer-recorded assessments; the other
      // execution modes stay employee-driven (mirrors the UI gating).
      s.defScalar(
        "assessment_start_can_record",
        sql`p_access_token is null
          and assessment_start_access.execution_mode = 'trainer_recorded'
          and ${
          currentUserHasPermission(sql.lit(permissions.recordEvaluations))
        }`,
      );
      s.throwErrorIf(
        sql`not (
          ${
          tokenGrantsAssignmentSql(
            sql`assessment_start_access.training_assignment_id`,
          )
        }
          or (p_access_token is null
            and assessment_start_access.person_id = ${currentEmployeeId(opts)})
          or assessment_start_can_record
        )`,
        sql.lit`You are not allowed to start this assessment attempt.`,
      );
      createOrResumeAssessmentAttempt(s, {
        taskId: sql`assessment_start_access.id`,
        actorId: attemptActorSql(sql`assessment_start_access.person_id`),
        canRecordEvaluations: sql`assessment_start_can_record`,
      });
      s.commitTransaction();
    },
  });

  system.storedProcedure({
    name: "training_submit_assessment_attempt",
    transaction: "standalone",
    inputScalars: [
      { name: "p_attempt_id", type: "BigInt" },
      { name: "p_access_token", type: { type: "String", maxLength: 120 } },
    ],
    procedure: (s) => {
      s.startTransaction();
      s.defRecord(
        "assessment_submit_access",
        sql`select att.id, a.id as training_assignment_id, a.person_id,
            (
              select assessment.execution_mode
              from db.training_course_section_items item
              join db.training_assessments assessment
                on assessment.id = item.training_assessment_id
              where item.id = t.training_course_section_item_id
            ) as execution_mode
            from db.training_assessment_attempts att
            join db.training_employee_tasks t
              on t.id = att.training_employee_task_id
            join db.training_assignments a
              on a.id = t.training_assignment_id
            where att.id = p_attempt_id`,
      );
      s.throwErrorIf(
        sql`assessment_submit_access.id is null`,
        sql.lit`Assessment attempt not found.`,
      );
      s.defScalar(
        "assessment_submit_can_record",
        sql`p_access_token is null
          and assessment_submit_access.execution_mode = 'trainer_recorded'
          and ${
          currentUserHasPermission(sql.lit(permissions.recordEvaluations))
        }`,
      );
      s.throwErrorIf(
        sql`not (
          ${
          tokenGrantsAssignmentSql(
            sql`assessment_submit_access.training_assignment_id`,
          )
        }
          or (p_access_token is null
            and assessment_submit_access.person_id = ${currentEmployeeId(opts)})
          or assessment_submit_can_record
        )`,
        sql.lit`You are not allowed to submit this assessment attempt.`,
      );
      submitAssessmentAttempt(s, {
        opts,
        attemptId: sql`assessment_submit_access.id`,
        actorId: attemptActorSql(sql`assessment_submit_access.person_id`),
      });
      // Certification issuance is owned by training_complete_task (reached
      // through the assessment bridge when the attempt passes).
      s.commitTransaction();
    },
  });

  const defAttemptAccess = (s: GeneralServerStatements) => {
    s.defRecord(
      "assessment_save_access",
      sql`select att.id, a.id as training_assignment_id, a.person_id,
          (
              select assessment.execution_mode
              from db.training_course_section_items item
              join db.training_assessments assessment
                on assessment.id = item.training_assessment_id
              where item.id = t.training_course_section_item_id
            ) as execution_mode
          from db.training_assessment_attempts att
          join db.training_employee_tasks t
            on t.id = att.training_employee_task_id
          join db.training_assignments a
            on a.id = t.training_assignment_id
          where att.id = p_attempt_id`,
    );
    s.throwErrorIf(
      sql`assessment_save_access.id is null`,
      sql.lit`Assessment attempt not found.`,
    );
    s.throwErrorIf(
      sql`not (
        ${
        tokenGrantsAssignmentSql(
          sql`assessment_save_access.training_assignment_id`,
        )
      }
        or (p_access_token is null
          and assessment_save_access.person_id = ${currentEmployeeId(opts)})
        or (p_access_token is null
          and assessment_save_access.execution_mode = 'trainer_recorded'
          and ${
        currentUserHasPermission(sql.lit(permissions.recordEvaluations))
      })
      )`,
      sql.lit`You are not allowed to modify this assessment attempt.`,
    );
  };

  system.storedProcedure({
    name: "training_save_assessment_response",
    transaction: "standalone",
    inputScalars: [
      { name: "p_attempt_id", type: "BigInt" },
      { name: "p_item_id", type: "BigInt" },
      { name: "p_field", type: { type: "String", maxLength: 40 } },
      { name: "p_value", type: { type: "String", maxLength: 1000000 } },
      { name: "p_access_token", type: { type: "String", maxLength: 120 } },
    ],
    procedure: (s) => {
      s.startTransaction();
      defAttemptAccess(s);
      s.throwErrorIf(
        sql`p_field not in (
          'text_response', 'practical_result', 'measured_value',
          'measured_unit', 'notes', 'signature_name', 'signature_data'
        )`,
        sql.lit`Unsupported assessment response field.`,
      );
      // The saved field must belong to the item's question type (signature
      // fields also apply to practical observations, which can require a
      // reviewer signature).
      s.throwErrorIf(
        sql`not exists (
          select 1
          from db.training_assessment_items item
          where item.id = p_item_id
            and case
              when p_field = 'text_response'
                then item.type = 'text_response'
              when p_field in (
                'practical_result', 'measured_value', 'measured_unit', 'notes'
              )
                then item.type = 'practical_observation'
              when p_field in ('signature_name', 'signature_data')
                then item.type in ('signature', 'practical_observation')
              else false
            end
        )`,
        sql.lit`Response field does not match the assessment question type.`,
      );
      const responseFields = {
        text_response: "textResponse",
        practical_result: "practicalResult",
        measured_value: "measuredValue",
        measured_unit: "measuredUnit",
        notes: "notes",
        signature_name: "signatureName",
        signature_data: "signatureData",
      } as const;
      for (const [code, field] of Object.entries(responseFields)) {
        s.if(
          sql`p_field = ${sql.lit(code)}`,
          (s) =>
            s.modify(saveAssessmentResponseSql({
              attemptId: sql`assessment_save_access.id`,
              itemId: sql`p_item_id`,
              [field]: sql`p_value`,
            })),
        );
      }
      s.commitTransaction();
    },
  });

  system.storedProcedure({
    name: "training_save_assessment_metadata_response",
    transaction: "standalone",
    inputScalars: [
      { name: "p_attempt_id", type: "BigInt" },
      { name: "p_metadata_field_id", type: "BigInt" },
      { name: "p_field", type: { type: "String", maxLength: 40 } },
      { name: "p_text_value", type: { type: "String", maxLength: 4000 } },
      { name: "p_number_value", type: "Double" },
      { name: "p_date_value", type: "Date" },
      { name: "p_choice_id", type: "BigInt" },
      { name: "p_access_token", type: { type: "String", maxLength: 120 } },
    ],
    procedure: (s) => {
      s.startTransaction();
      defAttemptAccess(s);
      s.throwErrorIf(
        sql`p_field not in ('text', 'number', 'date', 'single_choice')`,
        sql.lit`Unsupported assessment detail field.`,
      );
      s.throwErrorIf(
        sql`not exists (
          select 1
          from db.training_assessment_metadata_fields field
          where field.id = p_metadata_field_id
            and field.type::string = p_field
        )`,
        sql.lit`Detail value does not match the field type.`,
      );
      s.if(
        sql`p_field = 'text'`,
        (s) =>
          s.modify(saveAssessmentMetadataResponseSql({
            attemptId: sql`assessment_save_access.id`,
            fieldId: sql`p_metadata_field_id`,
            textValue: sql`p_text_value`,
          })),
      );
      s.if(
        sql`p_field = 'number'`,
        (s) =>
          s.modify(saveAssessmentMetadataResponseSql({
            attemptId: sql`assessment_save_access.id`,
            fieldId: sql`p_metadata_field_id`,
            numberValue: sql`p_number_value`,
          })),
      );
      s.if(
        sql`p_field = 'date'`,
        (s) =>
          s.modify(saveAssessmentMetadataResponseSql({
            attemptId: sql`assessment_save_access.id`,
            fieldId: sql`p_metadata_field_id`,
            dateValue: sql`p_date_value`,
          })),
      );
      s.if(
        sql`p_field = 'single_choice'`,
        (s) =>
          s.modify(saveAssessmentMetadataResponseSql({
            attemptId: sql`assessment_save_access.id`,
            fieldId: sql`p_metadata_field_id`,
            selectedChoiceId: sql`p_choice_id`,
          })),
      );
      s.commitTransaction();
    },
  });

  // Keeps the multiple-choice toggle SQL out of every assessment route.
  system.storedProcedure({
    name: "training_toggle_assessment_choice",
    transaction: "caller",
    inputScalars: [
      { name: "p_attempt_id", type: "BigInt" },
      { name: "p_item_id", type: "BigInt" },
      { name: "p_choice_id", type: "BigInt" },
      { name: "p_single_selection", type: "Bool" },
      { name: "p_checked", type: "Bool" },
    ],
    procedure: (s) => {
      const choice = {
        attemptId: sql`p_attempt_id`,
        itemId: sql`p_item_id`,
        choiceId: sql`p_choice_id`,
      };
      s.if(
        sql`p_single_selection`,
        (s) => {
          for (const statement of selectAssessmentSingleChoiceSql(choice)) {
            s.modify(statement);
          }
        },
        (s) => {
          s.if(
            sql`p_checked`,
            (s) => {
              s.modify(insertAssessmentChoiceSelectionSql(choice));
            },
            (s) => {
              s.modify(deleteAssessmentChoiceSelectionSql(choice));
            },
          );
        },
      );
    },
  });

  // Shared by blur saves and the completion/submission transaction. Only dirty
  // responses are sent, so saving one step cannot overwrite another step's work.
  system.storedProcedure({
    name: "training_save_course_responses",
    transaction: "caller",
    inputScalars: [
      { name: "p_assignment_id", type: "BigInt" },
      { name: "p_access_token", type: { type: "String", maxLength: 120 } },
    ],
    inputTables: [{
      name: "p_responses",
      fields: [
        { name: "task_id", type: "BigInt", notNull: true },
        { name: "essay_response", type: { type: "String", maxLength: 4000 } },
      ],
    }],
    procedure: (s) => {
      s.returnIf(sql`not exists (select 1 from p_responses)`);
      s.throwErrorUnless(
        sql`exists (select 1 from db.training_assignments a
          where a.id = p_assignment_id and a.training_course_id is not null
            and a.status in ('pending', 'in_progress')
            and a.employee_final_signed_at is null
            and coalesce((p_access_token is null and a.person_id = ${
          currentEmployeeId(opts)
        })
              or ${tokenGrantsAssignmentSql(sql`a.id`)}, false))`,
        sql.lit`This course cannot be edited.`,
      );
      s.throwErrorIf(
        sql`exists (select 1 from p_responses response where not exists (
          select 1 from db.training_employee_tasks task
          join db.training_course_section_items item on item.id = task.training_course_section_item_id
          where task.id = response.task_id and task.training_assignment_id = p_assignment_id
            and task.status in ('assigned', 'in_progress', 'completed')
            and (item.requires_essay or item.type = 'essay')
        )) or exists (select task_id from p_responses group by task_id having count(*) > 1)`,
        sql.lit`One of these responses can no longer be edited.`,
      );
      s.modify(sql`update db.training_employee_tasks task
        set essay_response = nullif(trim(response.essay_response), ''),
            completed_at = case when nullif(trim(response.essay_response), '') is null then null else task.completed_at end,
            training_language = case when nullif(trim(response.essay_response), '') is null then null else task.training_language end,
            signature_name = case when nullif(trim(response.essay_response), '') is null then null else task.signature_name end,
            signature_data = case when nullif(trim(response.essay_response), '') is null then null else task.signature_data end,
            completion_attestation = case when nullif(trim(response.essay_response), '') is null then null else task.completion_attestation end,
            status = case when task.status = 'assigned' or nullif(trim(response.essay_response), '') is null then 'in_progress' else task.status end
        from p_responses response
        where task.id = response.task_id and task.training_assignment_id = p_assignment_id`);
    },
  });

  // Explicit submission is the only path from finished course steps to
  // verification/completion. Task completion alone keeps courses editable.
  system.storedProcedure({
    name: "training_submit_course",
    transaction: "caller",
    inputScalars: [
      { name: "p_signature_data", type: "String" },
      { name: "p_assignment_id", type: "BigInt" },
      { name: "p_access_token", type: { type: "String", maxLength: 120 } },
      { name: "p_primary_validator_id", type: "BigInt" },
      { name: "p_secondary_validator_id", type: "BigInt" },
    ],
    procedure: (s) => {
      const labels = trainingValidationLabels(opts);
      s.defRecord(
        "submission",
        sql`select a.id, a.person_id, a.status,
          c.requires_final_signature, c.generates_certification
        from db.training_assignments a
        join db.training_courses c on c.id = a.training_course_id
        where a.id = p_assignment_id`,
      );
      s.throwErrorUnless(
        sql`coalesce((submission.person_id = ${
          currentEmployeeId(opts)
        } and p_access_token is null)
          or ${tokenGrantsAssignmentSql(sql`p_assignment_id`)}, false)`,
        sql.lit`You are not allowed to submit this course.`,
      );
      s.throwErrorIf(
        sql`submission.id is null or submission.status not in ('pending', 'in_progress')
          or not exists (select 1 from db.training_employee_tasks t
            where t.training_assignment_id = p_assignment_id and t.status = 'completed')
          or exists (select 1 from db.training_employee_tasks t
            where t.training_assignment_id = p_assignment_id and t.status in ('assigned', 'in_progress'))`,
        sql.lit`Complete every step before submitting this course.`,
      );
      s.throwErrorIf(
        sql`exists (select 1 from db.training_employee_tasks t
          join db.training_course_section_items item on item.id = t.training_course_section_item_id
          where t.training_assignment_id = p_assignment_id
            and t.status = 'completed' and (item.requires_essay or item.type = 'essay') and item.type not in ('signature', 'assessment')
            and nullif(trim(t.essay_response), '') is null)`,
        sql.lit`Write every required response before submitting this course.`,
      );
      s.if(sql`submission.requires_final_signature`, (s) => {
        s.throwErrorIf(
          sql`nullif(trim(coalesce(p_signature_data, '')), '') is null`,
          sql.lit`A final signature is required.`,
        );
        s.throwErrorUnless(
          sql`exists (select 1 from db.${sql.ref(personTable(opts))} p
            where p.id = p_primary_validator_id and ${
            userHasPermission(
              sql.lit(labels.primaryStagePermission),
              opts.workforce.personSysUserId(sql`p`),
            )
          })`,
          sql.lit`Choose an eligible validator before submitting this course.`,
        );
        if (!secondaryValidatorSignoffByPermission(opts)) {
          s.throwErrorIf(
            sql`submission.generates_certification and not exists (
              select 1 from db.${sql.ref(personTable(opts))} p
              where p.id = p_secondary_validator_id and ${
              userHasPermission(
                sql.lit(labels.secondaryStagePermission),
                opts.workforce.personSysUserId(sql`p`),
              )
            })`,
            sql
              .lit`Choose an eligible certification validator before submitting this course.`,
          );
        }
        s.modify(sql`update db.training_assignments
          set final_primary_validator_id = p_primary_validator_id,
              final_secondary_validator_id = case when submission.generates_certification
                then p_secondary_validator_id else null end,
              employee_final_signature_data = p_signature_data,
              employee_final_signed_at = now()
          where id = p_assignment_id`);
      });
      s.modify(updateAssignmentStatusAfterTaskCompletionSql({
        opts,
        assignmentId: sql`p_assignment_id`,
        submitCourse: true,
      }));
      if (inviteEnabled) {
        s.modify(revokeTrainingAccessTokensForClosedAssignmentSql({
          opts,
          assignmentId: sql`p_assignment_id`,
        }));
      }
      if (complianceEnabled) {
        s.modify(closeRetrainingCasesForAssignmentSql(sql`p_assignment_id`));
        s.modify(insertCertificationsForCompletedAssignmentsSql({
          opts,
          assignmentWhere: sql`a.id = p_assignment_id`,
        }));
      }
    },
  });

  const assertCanAssignTraining = (s: GeneralServerStatements) => {
    s.throwErrorIf(
      sql`not ${currentUserHasPermission(sql.lit(permissions.assignTraining))}`,
      sql.lit`You do not have permission to assign Training.`,
    );
  };
  const notifyAssignmentCreated = (
    s: GeneralServerStatements,
    assignmentId: Sql,
  ) => {
    s.block((s) => {
      s.defTable("p_notification_scope", {
        fields: [
          { name: "assignment_id", type: "BigInt" },
          { name: "event_code", type: { type: "String", maxLength: 120 } },
          { name: "template_id", type: "BigInt" },
          { name: "rule_id", type: "BigInt" },
          { name: "direct", type: "Bool" },
        ],
      });
      s.modify(sql`
        insert into p_notification_scope
          (assignment_id, event_code, template_id, rule_id, direct)
        select ${assignmentId}, 'assignment_created', null, null, false
      `);
      s.callStoredProcedure("training_publish_assignment_notification", {
        inputScalars: {
          p_message: sql`null`,
        },
        inputTables: {
          p_notification_scope: "p_notification_scope",
        },
      });
    });
  };

  // Assignment creation: one compiled insert-assignment → insert-tasks →
  // finalize (snapshots + tokens) → notification pipeline per target kind.
  // Callers own the transaction so batch flows stay atomic.
  system.storedProcedure({
    name: "training_assign_document",
    transaction: "caller",
    inputScalars: [
      { name: "p_person_id", type: "BigInt" },
      { name: "p_document_id", type: "BigInt" },
      { name: "p_language", type: { type: "String", maxLength: 20 } },
      { name: "p_due_date", type: "Date" },
      { name: "p_reason", type: { type: "String", maxLength: 1000 } },
      { name: "p_source", type: { type: "String", maxLength: 80 } },
      { name: "p_notify", type: "Bool" },
    ],
    outputScalars: [
      { name: "assigned_training_assignment_id", type: "BigInt" },
    ],
    procedure: (s) => {
      assertCanAssignTraining(s);
      s.defRecord(
        "assign_document_person",
        sql`select person.id,
               ${
          assignmentLanguageSql(
            opts,
            sql`coalesce(nullif(p_language, ''), ${
              personLanguageSql(opts, sql`person`)
            })`,
          )
        } as assignment_language
            from db.${sql.ref(personTable(opts))} person
            where person.id = p_person_id`,
      );
      s.throwErrorIf(
        sql`assign_document_person.id is null`,
        sql.lit`Choose a person before assigning.`,
      );
      s.throwErrorIf(
        sql`not exists (
          select 1
          from db.training_content_documents document
          where document.id = p_document_id
            and document.is_active
            and ${
          opts.content.canReadDocument(sql`document.id`, sql`current_user`)
        }
        )`,
        sql.lit`Training can only be assigned for an active document.`,
      );
      s.throwErrorIf(
        sql`${
          activeVersionIdSql(
            sql`p_document_id`,
            sql`assign_document_person.assignment_language`,
            opts,
          )
        } is null`,
        sql
          .lit`This person does not have an active published version in their language or the default language.`,
      );
      s.throwErrorIf(
        sql`exists (
          select 1
          from db.training_assignments assignment
          where assignment.person_id = assign_document_person.id
            and assignment.document_id = p_document_id
            and assignment.training_course_id is null
            and ${openTrainingAssignmentWhereSql(sql`assignment`)}
        )`,
        sql.lit`This person already has an open assignment for this document.`,
      );
      s.modify(sql`
        insert into db.training_assignments
          (person_id, document_id, training_language, due_date, reason,
           assignment_source, assigned_by_id)
        select assign_document_person.id,
               p_document_id,
               assign_document_person.assignment_language,
               coalesce(
                 p_due_date,
                 date.add(
                   day,
                   coalesce(training_settings.due_within_days, 7),
                   current_date()
                 )
               ),
               coalesce(
                 nullif(trim(coalesce(p_reason, '')), ''),
                 'Manual document assignment'
               ),
               coalesce(nullif(p_source, ''), 'manual'),
               ${currentEmployeeId(opts)}
        from db.training_content_documents document
        left join db.training_document_settings training_settings
          on training_settings.document_id = document.id
        where document.id = p_document_id
        returning id into assigned_training_assignment_id
      `);
      s.modify(insertDocumentTasksForAssignmentBatchSql({
        opts,
        documentId: sql`p_document_id`,
        assignmentWhere: sql`a.id = assigned_training_assignment_id`,
        dueDate: sql`(
          select due_date
          from db.training_assignments
          where id = assigned_training_assignment_id
        )`,
      }));
      for (
        const statement of finalizeNewAssignmentsSql({
          opts,
          assignmentWhere: sql`a.id = assigned_training_assignment_id`,
          actorId: currentEmployeeId(opts),
        })
      ) {
        s.modify(statement);
      }
      s.if(sql`coalesce(p_notify, false)`, (s) => {
        notifyAssignmentCreated(s, sql`assigned_training_assignment_id`);
      });
    },
  });

  system.storedProcedure({
    name: "training_assign_course",
    transaction: "caller",
    inputScalars: [
      { name: "p_person_id", type: "BigInt" },
      { name: "p_course_id", type: "BigInt" },
      { name: "p_language", type: { type: "String", maxLength: 20 } },
      { name: "p_due_date", type: "Date" },
      { name: "p_reason", type: { type: "String", maxLength: 1000 } },
      { name: "p_source", type: { type: "String", maxLength: 80 } },
      { name: "p_notify", type: "Bool" },
    ],
    outputScalars: [
      { name: "assigned_training_assignment_id", type: "BigInt" },
    ],
    procedure: (s) => {
      assertCanAssignTraining(s);
      s.defRecord(
        "assign_course_person",
        sql`select person.id,
               ${
          assignmentLanguageSql(
            opts,
            sql`coalesce(nullif(p_language, ''), ${
              personLanguageSql(opts, sql`person`)
            })`,
          )
        } as assignment_language
            from db.${sql.ref(personTable(opts))} person
            where person.id = p_person_id`,
      );
      s.throwErrorIf(
        sql`assign_course_person.id is null`,
        sql.lit`Choose a person before assigning.`,
      );
      s.throwErrorIf(
        sql`not exists (
          select 1
          from db.training_courses course
          where course.id = p_course_id
            and course.is_active
        )`,
        sql.lit`Training can only be assigned for an active course.`,
      );
      s.throwErrorIf(
        sql`exists (
          select 1
          from db.training_assignments assignment
          where assignment.person_id = assign_course_person.id
            and assignment.training_course_id = p_course_id
            and ${openTrainingAssignmentWhereSql(sql`assignment`)}
        )`,
        sql
          .lit`This person already has an active assignment for this course.`,
      );
      s.throwErrorIf(
        sql`${
          missingActiveVersionCountSql(
            sql`p_course_id`,
            sql`assign_course_person.assignment_language`,
          )
        } > 0`,
        sql
          .lit`Every course item needs an active published version in the employee language or the default language before assignment.`,
      );
      s.throwErrorIf(
        sql`${
          assignableCourseItemCountSql(
            sql`p_course_id`,
            sql`assign_course_person.assignment_language`,
          )
        } = 0`,
        sql
          .lit`Add at least one assignable training item before assignment.`,
      );
      s.modify(sql`
        insert into db.training_assignments
          (person_id, training_course_id, training_course_version_id, training_language, due_date, reason,
           assignment_source, assigned_by_id)
        select assign_course_person.id,
               p_course_id,
               ${
        activeCourseVersionSql(
          sql`p_course_id`,
          sql`assign_course_person.assignment_language`,
        )
      },
               assign_course_person.assignment_language,
               coalesce(
                 p_due_date,
                 date.add(day, course.due_within_days, current_date())
               ),
               coalesce(
                 nullif(trim(coalesce(p_reason, '')), ''),
                 'Manual course assignment'
               ),
               coalesce(nullif(p_source, ''), 'manual'),
               ${currentEmployeeId(opts)}
        from db.training_courses course
        where course.id = p_course_id
        returning id into assigned_training_assignment_id
      `);
      s.modify(insertCourseTasksForAssignmentSql({
        assignmentId: sql`assigned_training_assignment_id`,
        courseId: sql`p_course_id`,
        dueDate: sql`(
          select due_date
          from db.training_assignments
          where id = assigned_training_assignment_id
        )`,
      }));
      for (
        const statement of finalizeNewAssignmentsSql({
          opts,
          assignmentWhere: sql`a.id = assigned_training_assignment_id`,
          actorId: currentEmployeeId(opts),
        })
      ) {
        s.modify(statement);
      }
      s.if(sql`coalesce(p_notify, false)`, (s) => {
        notifyAssignmentCreated(s, sql`assigned_training_assignment_id`);
      });
    },
  });

  // Task completion: the single compiled path from an open task to a
  // completed task, assignment status recompute, retraining-case closure,
  // and certification, all inside the caller's transaction. Already-closed
  // tasks are skipped silently (matching the previous inline sites and the
  // assessment bridge).
  system.storedProcedure({
    name: "training_complete_task",
    transaction: "caller",
    inputScalars: [
      { name: "p_task_id", type: "BigInt" },
      { name: "p_access_token", type: { type: "String", maxLength: 120 } },
      {
        name: "p_signature_data",
        type: { type: "String", maxLength: 1000000 },
      },
      {
        name: "p_completion_attestation",
        type: { type: "String", maxLength: 1000 },
      },
      { name: "p_essay_response", type: { type: "String", maxLength: 4000 } },
    ],
    procedure: (s) => {
      s.defRecord(
        "complete_task_target",
        sql`select t.id, t.status, t.training_assignment_id,
               t.document_version_id, t.training_course_section_item_id,
               t.essay_response,
               a.person_id,
               a.status as assignment_status,
               a.employee_final_signed_at,
               coalesce(a.training_language, ${defaultLanguageSql(opts)})
                 as assignment_language,
               item.type as item_type,
               coalesce(item.requires_essay, false) as requires_essay,
               ${employeeName(opts, sql`person`)} as employee_name
            from db.training_employee_tasks t
            join db.training_assignments a
              on a.id = t.training_assignment_id
            join db.${sql.ref(personTable(opts))} person
              on person.id = a.person_id
            left join db.training_course_section_items item
              on item.id = t.training_course_section_item_id
            where t.id = p_task_id`,
      );
      s.throwErrorIf(
        sql`complete_task_target.id is null`,
        sql.lit`Training task not found.`,
      );
      s.throwErrorIf(
        sql`not (
          ${
          tokenGrantsAssignmentSql(
            sql`complete_task_target.training_assignment_id`,
          )
        }
          or (p_access_token is null
            and complete_task_target.person_id = ${currentEmployeeId(opts)})
          or (
            complete_task_target.item_type = 'assessment'
            and exists (
              select 1
              from db.training_assessment_attempts att
              where att.training_employee_task_id = complete_task_target.id
                and att.status = 'complete'
                and att.outcome = 'passed'
            )
          )
        )`,
        sql.lit`You are not allowed to complete this training task.`,
      );
      s.if(
        sql`complete_task_target.status not in ('assigned', 'in_progress')`,
        (s) => s.return(),
      );
      s.throwErrorIf(
        sql`complete_task_target.assignment_status not in ('pending', 'in_progress')
          or complete_task_target.employee_final_signed_at is not null`,
        sql.lit`Signed or completed training assignments cannot be changed.`,
      );
      s.throwErrorIf(
        sql`complete_task_target.document_version_id is null
          and complete_task_target.item_type not in ('signature', 'assessment')
          and complete_task_target.requires_essay
          and nullif(
            trim(coalesce(complete_task_target.essay_response, '')),
            ''
          ) is null`,
        sql.lit`Write the required response before completing this step.`,
      );
      s.throwErrorIf(
        sql`complete_task_target.document_version_id is not null
          and (
            nullif(trim(coalesce(p_signature_data, '')), '') is null
            or nullif(trim(coalesce(p_completion_attestation, '')), '') is null
          )`,
        sql
          .lit`A signature and acknowledgment are required to complete this document.`,
      );
      s.throwErrorIf(
        sql`complete_task_target.item_type = 'signature'
          and nullif(trim(coalesce(p_signature_data, '')), '') is null`,
        sql.lit`A signature is required to complete this step.`,
      );
      s.if(
        sql`complete_task_target.status in ('assigned', 'in_progress')`,
        (s) => {
          s.modify(sql`
            update db.training_employee_tasks
            set status = 'completed',
                completed_at = now(),
                training_language = complete_task_target.assignment_language,
                signature_name = case
                  when complete_task_target.document_version_id is not null
                    or complete_task_target.item_type = 'signature'
                  then complete_task_target.employee_name
                  else signature_name
                end,
                signature_data = case
                  when complete_task_target.document_version_id is not null
                    or complete_task_target.item_type = 'signature'
                  then p_signature_data
                  else signature_data
                end,
                completion_attestation = case
                  when complete_task_target.document_version_id is not null
                  then p_completion_attestation
                  else completion_attestation
                end,
                essay_response = case
                  when complete_task_target.document_version_id is not null
                  then nullif(trim(coalesce(p_essay_response, '')), '')
                  else essay_response
                end
            where id = complete_task_target.id
              and status in ('assigned', 'in_progress')
          `);
          s.modify(updateAssignmentStatusAfterTaskCompletionSql({
            opts,
            assignmentId: sql`complete_task_target.training_assignment_id`,
          }));
          if (inviteEnabled) {
            s.modify(revokeTrainingAccessTokensForClosedAssignmentSql({
              opts,
              assignmentId: sql`complete_task_target.training_assignment_id`,
            }));
          }
          if (complianceEnabled) {
            s.modify(closeRetrainingCasesForAssignmentSql(
              sql`complete_task_target.training_assignment_id`,
            ));
            s.modify(insertCertificationsForCompletedAssignmentsSql({
              opts,
              assignmentWhere:
                sql`a.id = complete_task_target.training_assignment_id`,
            }));
          }
        },
      );
    },
  });

  // Validator sign-off: records the primary or secondary validation
  // attestation with its authorization check, then recomputes the
  // assignment status, closes linked retraining cases, and issues
  // certifications inside the caller's transaction.
  {
    const validationLabels = trainingValidationLabels(opts);
    const secondaryByPermission = secondaryValidatorSignoffByPermission(opts);
    system.storedProcedure({
      name: "training_record_assignment_validation",
      transaction: "caller",
      inputScalars: [
        { name: "p_assignment_id", type: "BigInt" },
        { name: "p_stage", type: { type: "String", maxLength: 40 } },
        {
          name: "p_signature_data",
          type: { type: "String", maxLength: 1000000 },
        },
      ],
      procedure: (s) => {
        s.throwErrorIf(
          sql`p_stage not in ('primary', 'secondary')`,
          sql.lit`Unsupported validation stage.`,
        );
        s.defRecord(
          "assignment_validation_target",
          sql`select a.id,
                 a.status,
                 a.training_course_id,
                 a.employee_final_signed_at,
                 a.final_primary_validator_id,
                 a.final_secondary_validator_id,
                 (
                   select ${employeeName(opts, sql`validator`)}
                   from db.${sql.ref(personTable(opts))} validator
                   where validator.id = a.final_primary_validator_id
                 ) as primary_validator_name,
                 (
                   select ${employeeName(opts, sql`validator`)}
                   from db.${sql.ref(personTable(opts))} validator
                   where validator.id = a.final_secondary_validator_id
                 ) as secondary_validator_name,
                 (
                   select ${employeeName(opts, sql`signer`)}
                   from db.${sql.ref(personTable(opts))} signer
                   where signer.id = ${currentEmployeeId(opts)}
                 ) as current_user_name
              from db.training_assignments a
              where a.id = p_assignment_id`,
        );
        s.throwErrorIf(
          sql`assignment_validation_target.id is null`,
          sql.lit`Training assignment not found.`,
        );
        s.throwErrorIf(
          sql`assignment_validation_target.training_course_id is null
            or assignment_validation_target.status != 'validation_pending'
            or exists (
              select 1
              from db.training_employee_tasks task
              where task.training_assignment_id =
                assignment_validation_target.id
                and task.status in ('assigned', 'in_progress')
            )
            or (
              exists (
                select 1
                from db.training_courses course
                join db.training_assignments assignment
                  on assignment.training_course_id = course.id
                where assignment.id = assignment_validation_target.id
                  and course.requires_final_signature
              )
              and assignment_validation_target.employee_final_signed_at is null
            )`,
          sql.lit`This assignment is not ready for validation.`,
        );
        s.throwErrorIf(
          sql`nullif(trim(coalesce(p_signature_data, '')), '') is null`,
          sql.lit`A validator signature is required.`,
        );
        s.throwErrorIf(
          sql`p_stage = 'primary'
            and not coalesce(
              ${currentEmployeeId(opts)} =
                assignment_validation_target.final_primary_validator_id,
              false
            )`,
          sql.lit(
            `Only the selected ${validationLabels.primaryStageDisplayName} can validate this course.`,
          ),
        );
        s.throwErrorIf(
          secondaryByPermission
            ? sql`p_stage = 'secondary'
              and not ${
              currentUserHasPermission(
                sql.lit(validationLabels.secondaryStagePermission),
              )
            }`
            : sql`p_stage = 'secondary'
              and not coalesce(
                ${currentEmployeeId(opts)} =
                  assignment_validation_target.final_secondary_validator_id,
                false
              )`,
          secondaryByPermission
            ? sql.lit(
              `Only a user with ${validationLabels.secondaryStageDisplayName} permission can validate this course.`,
            )
            : sql.lit(
              `Only the selected ${validationLabels.secondaryStageDisplayName} can validate this course.`,
            ),
        );
        s.throwErrorIf(
          sql`p_stage = 'primary'
            and (
              assignment_validation_target.final_primary_validator_id is null
              or exists (
                select 1
                from db.training_assignment_validations validation
                where validation.training_assignment_id =
                  assignment_validation_target.id
                  and validation.validation_stage_code = ${
            sql.lit(validationLabels.primaryStageCode)
          }
              )
            )`,
          sql.lit`Primary validation is not pending for this assignment.`,
        );
        s.throwErrorIf(
          sql`p_stage = 'secondary'
            and (
              ${
            secondaryByPermission
              ? sql`not exists (
                  select 1
                  from db.training_courses course
                  where course.id =
                    assignment_validation_target.training_course_id
                    and course.generates_certification
                )`
              : sql`assignment_validation_target.final_secondary_validator_id
                  is null`
          }
              or exists (
                select 1
                from db.training_assignment_validations validation
                where validation.training_assignment_id =
                  assignment_validation_target.id
                  and validation.validation_stage_code = ${
            sql.lit(validationLabels.secondaryStageCode)
          }
              )
            )`,
          sql.lit`Secondary validation is not pending for this assignment.`,
        );
        s.modify(sql`
          insert into db.training_assignment_validations
            (training_assignment_id, validation_stage_code,
             validation_stage_name, validated_by_id,
             validator_signature_name, validator_signature_data)
          values
            (assignment_validation_target.id,
             case when p_stage = 'primary'
               then ${sql.lit(validationLabels.primaryStageCode)}
               else ${sql.lit(validationLabels.secondaryStageCode)}
             end,
             case when p_stage = 'primary'
               then ${sql.lit(validationLabels.primaryStageName)}
               else ${sql.lit(validationLabels.secondaryStageName)}
             end,
             ${currentEmployeeId(opts)},
             case when p_stage = 'primary'
               then coalesce(
                 assignment_validation_target.primary_validator_name,
                 ${sql.lit(validationLabels.primaryStageDisplayName)}
               )
               else ${
          secondaryByPermission
            ? sql`coalesce(
                 assignment_validation_target.current_user_name,
                 ${sql.lit(validationLabels.secondaryStageDisplayName)}
               )`
            : sql`coalesce(
                 assignment_validation_target.secondary_validator_name,
                 ${sql.lit(validationLabels.secondaryStageDisplayName)}
               )`
        }
             end,
             p_signature_data)
          on conflict (training_assignment_id, validation_stage_code)
            do nothing
        `);
        s.modify(updateAssignmentStatusAfterValidationSql({
          opts,
          assignmentId: sql`assignment_validation_target.id`,
        }));
        if (inviteEnabled) {
          s.modify(revokeTrainingAccessTokensForClosedAssignmentSql({
            opts,
            assignmentId: sql`assignment_validation_target.id`,
          }));
        }
        if (complianceEnabled) {
          s.modify(closeRetrainingCasesForAssignmentSql(
            sql`assignment_validation_target.id`,
          ));
          s.modify(insertCertificationsForCompletedAssignmentsSql({
            opts,
            assignmentWhere: sql`a.id = assignment_validation_target.id`,
          }));
        }
      },
    });
  }
}
