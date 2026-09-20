import { StatusChip } from "components/status_chip";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";

import type { TrainingBlockOpts } from "./types.ts";
import { activeAssessmentVersionSql } from "./helpers";

/**
 * Assessment lifecycle helpers. These own every attempt state transition:
 * UI code must not hand-roll creates, submits, grading, reviews, or task
 * completion. Attempts are execution evidence pinned to a published
 * assessment version; training progress stays on training_employee_tasks
 * and training_assignments and is only touched through
 * {@link completeAssessmentLinkedTask}.
 */

/** Open attempt (in_progress or review_pending) for a task, if any. */
export function activeAssessmentAttemptIdSql(taskId: Sql) {
  return sql`(
    select att.id
    from db.training_assessment_attempts att
    where att.training_employee_task_id = ${taskId}
      and att.status in ('in_progress', 'review_pending')
    order by att.attempt_number desc, att.id desc
    limit 1
  )`;
}

function completedAssessmentAttemptCountSql(taskId: Sql) {
  return sql`(
    select count(*)
    from db.training_assessment_attempts att
    where att.training_employee_task_id = ${taskId}
      and att.status = 'complete'
  )`;
}

function latestAssessmentAttemptFieldSql(taskId: Sql, field: string) {
  return sql`(
    select att.${sql.ref(field)}
    from db.training_assessment_attempts att
    where att.training_employee_task_id = ${taskId}
      and att.status != 'cancelled'
    order by att.attempt_number desc, att.id desc
    limit 1
  )`;
}

/** The assessment a course-item task points at. */
export function taskAssessmentIdSql(task: Sql) {
  return sql`(
    select i.training_assessment_id
    from db.training_course_section_items i
    where i.id = ${task}.training_course_section_item_id
  )`;
}

/**
 * Whether the retake policy of the assessment's current published version
 * still allows a new attempt after a failure: a published version exists
 * and max_attempts is not exhausted. Cooldown only delays a retake, so it
 * does not affect the derived state; enforce it at attempt creation.
 */
function assessmentRetakeAvailableSql(task: Sql) {
  const versionId = activeAssessmentVersionSql(taskAssessmentIdSql(task));
  return sql`(
    select v.max_attempts is null
      or ${completedAssessmentAttemptCountSql(sql`${task}.id`)} < v.max_attempts
    from db.training_assessment_versions v
    where v.id = ${versionId}
  )`;
}

/**
 * Derived assessment task state for UI and reporting. `task` must expose
 * `id` and `status` of a training_employee_tasks row. Final failure is not
 * a task status: it stays `in_progress` with a complete failed attempt and
 * an exhausted retake policy.
 */
export function assessmentTaskStateSql(task: Sql) {
  const latestStatus = latestAssessmentAttemptFieldSql(
    sql`${task}.id`,
    "status",
  );
  const latestOutcome = latestAssessmentAttemptFieldSql(
    sql`${task}.id`,
    "outcome",
  );
  return sql`case
    when ${task}.status = 'completed' then 'passed'
    when ${latestStatus} is null then 'not_started'
    when ${latestStatus} = 'in_progress' then 'in_progress'
    when ${latestStatus} = 'review_pending' then 'review_pending'
    when ${latestOutcome} = 'passed' then 'passed'
    when ${latestOutcome} = 'failed' then
      case
        when coalesce(${assessmentRetakeAvailableSql(task)}, false)
          then 'failed_retake_available'
        else 'failed_final'
      end
    else 'in_progress'
  end`;
}

/**
 * Query behind the `training_task_derived_state` view: one row per
 * training_employee_tasks row with its {@link assessmentTaskStateSql}
 * derived state, keyed by `task_id`.
 */
export function taskDerivedStateViewQuery() {
  return sql`
    select t.id as task_id,
           ${assessmentTaskStateSql(sql`t`)} as derived_state
    from db.training_employee_tasks t
  `;
}

export function assessmentTaskStateChip(state: Sql) {
  return (
    <StatusChip
      fallbackLabel={state}
      cases={[
        {
          when: sql`${state} = 'not_started'`,
          label: "Not started",
          color: "neutral",
        },
        {
          when: sql`${state} = 'in_progress'`,
          label: "In progress",
          color: "primary",
        },
        {
          when: sql`${state} = 'review_pending'`,
          label: "Review pending",
          color: "warning",
        },
        {
          when: sql`${state} = 'passed'`,
          label: "Passed",
          color: "success",
        },
        {
          when: sql`${state} = 'failed_retake_available'`,
          label: "Failed – retake available",
          color: "danger",
        },
        {
          when: sql`${state} = 'failed_final'`,
          label: "Failed – final",
          color: "danger",
        },
      ]}
    />
  );
}

/**
 * Creates or resumes the attempt for an assessment course task, enforcing
 * the retake policy of the current published version. Declares
 * `assessment_attempt_id` in the current scope with the resulting attempt
 * id. Must run inside a transaction.
 *
 * `canRecordEvaluations` gates trainer_recorded assessments: pass the
 * caller's permission check, employees must not start those themselves.
 */
export function createOrResumeAssessmentAttempt<
  T extends IServerBaseStatements,
>(
  s: T,
  args: {
    taskId: Sql;
    actorId: Sql;
    canRecordEvaluations?: Sql;
  },
) {
  s.defRecord(
    "assessment_attempt_task",
    sql`select t.id, t.status, t.training_assignment_id,
               assignment.status as assignment_status,
               assignment.employee_final_signed_at,
               i.training_assessment_id,
               assessment.execution_mode,
               ${
      activeAssessmentVersionSql(sql`i.training_assessment_id`)
    } as published_version_id
        from db.training_employee_tasks t
        join db.training_assignments assignment
          on assignment.id = t.training_assignment_id
        join db.training_course_section_items i
          on i.id = t.training_course_section_item_id
         and i.type = 'assessment'
        join db.training_assessments assessment
          on assessment.id = i.training_assessment_id
        where t.id = ${args.taskId}`,
  );
  s.throwErrorIf(
    sql`assessment_attempt_task.id is null`,
    sql.lit`This task is not linked to an assessment.`,
  );
  s.throwErrorIf(
    sql`assessment_attempt_task.status not in ('assigned', 'in_progress')`,
    sql.lit`This assessment task is no longer open.`,
  );
  s.throwErrorIf(
    sql`assessment_attempt_task.assignment_status not in
        ('pending', 'in_progress', 'validation_pending')
      or assessment_attempt_task.employee_final_signed_at is not null`,
    sql.lit`Signed or completed training assignments cannot be changed.`,
  );
  s.throwErrorIf(
    sql`assessment_attempt_task.published_version_id is null`,
    sql.lit`This assessment has no published version.`,
  );
  s.throwErrorIf(
    sql`assessment_attempt_task.execution_mode = 'trainer_recorded'
      and not coalesce(${args.canRecordEvaluations ?? sql`false`}, false)`,
    sql.lit`Only an evaluator can record this assessment.`,
  );
  s.defScalar("assessment_attempt_id", {
    expr: activeAssessmentAttemptIdSql(sql`assessment_attempt_task.id`),
    allowNoRead: true,
  });
  s.if(sql`assessment_attempt_id is null`, (s) => {
    s.defRecord(
      "assessment_attempt_policy",
      sql`select v.max_attempts, v.cooldown_minutes, v.allow_retake_after_pass
          from db.training_assessment_versions v
          where v.id = assessment_attempt_task.published_version_id`,
    );
    s.throwErrorIf(
      sql`not assessment_attempt_policy.allow_retake_after_pass
        and exists (
          select 1
          from db.training_assessment_attempts att
          where att.training_employee_task_id = assessment_attempt_task.id
            and att.status = 'complete'
            and att.outcome = 'passed'
        )`,
      sql.lit`This assessment is already passed and does not allow retakes.`,
    );
    s.throwErrorIf(
      sql`assessment_attempt_policy.max_attempts is not null
        and ${
        completedAssessmentAttemptCountSql(sql`assessment_attempt_task.id`)
      } >= assessment_attempt_policy.max_attempts`,
      sql.lit`The maximum number of attempts for this assessment is reached.`,
    );
    s.throwErrorIf(
      sql`assessment_attempt_policy.cooldown_minutes is not null
        and exists (
          select 1
          from db.training_assessment_attempts att
          where att.training_employee_task_id = assessment_attempt_task.id
            and att.status = 'complete'
            and date.add(minute, assessment_attempt_policy.cooldown_minutes,
              att.completed_at) > now()
        )`,
      sql.lit`The retake cooldown for this assessment has not elapsed yet.`,
    );
    s.modify(sql`
      insert into db.training_assessment_attempts
        (training_assessment_version_id, training_employee_task_id,
         attempt_number, started_by_id)
      values
        (assessment_attempt_task.published_version_id,
         assessment_attempt_task.id,
         coalesce((
           select max(att.attempt_number)
           from db.training_assessment_attempts att
           where att.training_employee_task_id = assessment_attempt_task.id
         ), 0) + 1,
         ${args.actorId})
      returning id into assessment_attempt_id
    `);
    // One response row per item of the pinned version, with the scoring
    // snapshots that protect this attempt from later version edits.
    s.modify(sql`
      insert into db.training_assessment_responses
        (training_assessment_attempt_id, training_assessment_item_id,
         max_points, include_in_score, requires_review)
      select assessment_attempt_id, item.id, item.points,
             item.include_in_score,
             item.type = 'text_response'
               or item.requires_review
               or item.reviewer_signature_required
      from db.training_assessment_items item
      join db.training_assessment_sections section
        on section.id = item.training_assessment_section_id
      where section.training_assessment_version_id =
          assessment_attempt_task.published_version_id
    `);
    s.modify(sql`
      insert into db.training_assessment_metadata_responses
        (training_assessment_attempt_id,
         training_assessment_metadata_field_id)
      select assessment_attempt_id, field.id
      from db.training_assessment_metadata_fields field
      where field.training_assessment_version_id =
        assessment_attempt_task.published_version_id
    `);
    s.modify(sql`
      update db.training_employee_tasks
      set status = 'in_progress'
      where id = assessment_attempt_task.id
        and status = 'assigned'
    `);
  });
}

function attemptEditableWhereSql(attemptId: Sql) {
  return sql`exists (
    select 1
    from db.training_assessment_attempts att
    join db.training_employee_tasks task
      on task.id = att.training_employee_task_id
    join db.training_assignments assignment
      on assignment.id = task.training_assignment_id
    where att.id = ${attemptId}
      and att.status = 'in_progress'
      and task.status in ('assigned', 'in_progress')
      and assignment.status in
        ('pending', 'in_progress', 'validation_pending')
      and assignment.employee_final_signed_at is null
  )`;
}

/**
 * Manually scores one response of an in_progress attempt so an evaluator
 * can give partial credit while recording. The score survives submission:
 * auto-grading keeps it instead of recomputing from the recorded result.
 * A null score returns the response to auto-grading. Must run inside a
 * transaction.
 */
export function saveAssessmentResponseManualScore<
  T extends IServerBaseStatements,
>(
  s: T,
  args: {
    attemptId: Sql;
    itemId: Sql;
    pointsAwarded: Sql;
  },
) {
  s.defRecord(
    "assessment_manual_score_response",
    sql`select r.id, r.max_points
        from db.training_assessment_responses r
        join db.training_assessment_attempts att
          on att.id = r.training_assessment_attempt_id
        where r.training_assessment_attempt_id = ${args.attemptId}
          and r.training_assessment_item_id = ${args.itemId}
          and att.status = 'in_progress'
          and ${attemptEditableWhereSql(args.attemptId)}`,
  );
  s.throwErrorIf(
    sql`assessment_manual_score_response.id is null`,
    sql.lit`Only responses of an in-progress attempt accept manual scores.`,
  );
  s.throwErrorIf(
    sql`${args.pointsAwarded} is not null
      and (
        ${args.pointsAwarded} < 0
        or ${args.pointsAwarded} >
          assessment_manual_score_response.max_points
      )`,
    sql.lit`Response score must be between zero and the response max points.`,
  );
  s.modify(sql`
    update db.training_assessment_responses
    set points_awarded = ${args.pointsAwarded}
    where id = assessment_manual_score_response.id
  `);
}

function appendAssignment(current: Sql | undefined, next: Sql) {
  return current ? sql`${current}, ${next}` : next;
}

/**
 * Saves the entered value of one response. Only in_progress attempts accept
 * response edits; complete, cancelled, and review_pending attempts are
 * read-only for the person answering.
 */
export function saveAssessmentResponseSql(args: {
  attemptId: Sql;
  itemId: Sql;
  textResponse?: Sql;
  practicalResult?: Sql;
  measuredValue?: Sql;
  measuredUnit?: Sql;
  notes?: Sql;
  signatureName?: Sql;
  signatureData?: Sql;
}) {
  let assignments: Sql | undefined;
  if (args.textResponse) {
    assignments = appendAssignment(
      assignments,
      sql`text_response = nullif(${args.textResponse}, '')`,
    );
  }
  if (args.practicalResult) {
    assignments = appendAssignment(
      assignments,
      sql`practical_result = ${args.practicalResult}`,
    );
  }
  if (args.measuredValue) {
    assignments = appendAssignment(
      assignments,
      sql`measured_value = nullif(trim(${args.measuredValue}), '')`,
    );
  }
  if (args.measuredUnit) {
    assignments = appendAssignment(
      assignments,
      sql`measured_unit = nullif(trim(${args.measuredUnit}), '')`,
    );
  }
  if (args.notes) {
    assignments = appendAssignment(
      assignments,
      sql`notes = nullif(${args.notes}, '')`,
    );
  }
  if (args.signatureName) {
    assignments = appendAssignment(
      assignments,
      sql`signature_name = nullif(trim(${args.signatureName}), '')`,
    );
  }
  if (args.signatureData) {
    assignments = appendAssignment(
      assignments,
      sql`signature_data = ${args.signatureData}`,
    );
  }
  if (!assignments) {
    throw new Error("An assessment response value is required.");
  }
  return sql`
    update db.training_assessment_responses
    set ${assignments}
    where training_assessment_attempt_id = ${args.attemptId}
      and training_assessment_item_id = ${args.itemId}
      and ${attemptEditableWhereSql(args.attemptId)}
  `;
}

export function saveAssessmentMetadataResponseSql(args: {
  attemptId: Sql;
  fieldId: Sql;
  textValue?: Sql;
  numberValue?: Sql;
  dateValue?: Sql;
  selectedChoiceId?: Sql;
}) {
  let assignments: Sql | undefined;
  if (args.textValue) {
    assignments = appendAssignment(
      assignments,
      sql`text_value = nullif(${args.textValue}, ''),
        number_value = null,
        date_value = null,
        selected_choice_id = null`,
    );
  }
  if (args.numberValue) {
    assignments = appendAssignment(
      assignments,
      sql`text_value = null,
        number_value = ${args.numberValue},
        date_value = null,
        selected_choice_id = null`,
    );
  }
  if (args.dateValue) {
    assignments = appendAssignment(
      assignments,
      sql`text_value = null,
        number_value = null,
        date_value = ${args.dateValue},
        selected_choice_id = null`,
    );
  }
  if (args.selectedChoiceId) {
    assignments = appendAssignment(
      assignments,
      sql`text_value = null,
        number_value = null,
        date_value = null,
        selected_choice_id = ${args.selectedChoiceId}`,
    );
  }
  if (!assignments) {
    throw new Error("An assessment metadata response value is required.");
  }
  return sql`
    update db.training_assessment_metadata_responses
    set ${assignments}
    where training_assessment_attempt_id = ${args.attemptId}
      and training_assessment_metadata_field_id = ${args.fieldId}
      and ${attemptEditableWhereSql(args.attemptId)}
      and (
        ${args.selectedChoiceId ?? sql`null`} is null
        or exists (
          select 1
          from db.training_assessment_metadata_field_choices choice
          where choice.id = ${args.selectedChoiceId ?? sql`null`}
            and choice.training_assessment_metadata_field_id =
              ${args.fieldId}
        )
      )
  `;
}

/**
 * Selects one choice of a single-selection multiple choice item, replacing
 * any previous selection. Validates that the choice belongs to the item.
 */
export function selectAssessmentSingleChoiceSql(args: {
  attemptId: Sql;
  itemId: Sql;
  choiceId: Sql;
}) {
  return [
    sql`
      delete from db.training_assessment_response_selected_choices
      where training_assessment_response_id in (
          select r.id
          from db.training_assessment_responses r
          where r.training_assessment_attempt_id = ${args.attemptId}
            and r.training_assessment_item_id = ${args.itemId}
        )
        and training_assessment_item_choice_id != ${args.choiceId}
        and ${attemptEditableWhereSql(args.attemptId)}
    `,
    insertAssessmentChoiceSelectionSql(args),
  ];
}

export function insertAssessmentChoiceSelectionSql(args: {
  attemptId: Sql;
  itemId: Sql;
  choiceId: Sql;
}) {
  return sql`
    insert into db.training_assessment_response_selected_choices
      (training_assessment_response_id, training_assessment_item_choice_id)
    select r.id as response_id_value, choice.id as choice_id_value
    from db.training_assessment_responses r
    join db.training_assessment_item_choices choice
      on choice.training_assessment_item_id = r.training_assessment_item_id
     and choice.id = ${args.choiceId}
    where r.training_assessment_attempt_id = ${args.attemptId}
      and r.training_assessment_item_id = ${args.itemId}
      and ${attemptEditableWhereSql(args.attemptId)}
      and not exists (
        select 1
        from db.training_assessment_response_selected_choices existing
        where existing.training_assessment_response_id = r.id
          and existing.training_assessment_item_choice_id = choice.id
      )
  `;
}

export function deleteAssessmentChoiceSelectionSql(args: {
  attemptId: Sql;
  itemId: Sql;
  choiceId: Sql;
}) {
  return sql`
    delete from db.training_assessment_response_selected_choices
    where training_assessment_item_choice_id = ${args.choiceId}
      and training_assessment_response_id in (
        select r.id
        from db.training_assessment_responses r
        where r.training_assessment_attempt_id = ${args.attemptId}
          and r.training_assessment_item_id = ${args.itemId}
      )
      and ${attemptEditableWhereSql(args.attemptId)}
  `;
}

/**
 * Auto-grades multiple choice responses of an attempt. Runs once at
 * submission; manual review adjustments afterwards go through
 * {@link reviewAssessmentResponse}.
 *
 * all_or_nothing items only earn their points on an exact selected-set
 * match. partial_credit items (multiple-answer only) earn a proportional
 * score: (correct selections - incorrect selections) / correct choices,
 * floored at zero so over-selecting cannot game the score.
 */
function autoGradeMultipleChoiceStatements<
  T extends IServerBaseStatements,
>(
  s: T,
  attemptId: Sql,
) {
  s.defTable(
    "assessment_mc_grades",
    sql`
      select r.id as response_id,
             item.points as item_points,
             item.scoring_mode = 'partial_credit' as partial_credit,
             (
               select count(*)
               from db.training_assessment_item_choices c
               where c.training_assessment_item_id =
                 r.training_assessment_item_id
                 and c.is_correct
             ) as correct_choice_count,
             (
               select count(*)
               from db.training_assessment_response_selected_choices sc
               join db.training_assessment_item_choices c
                 on c.id = sc.training_assessment_item_choice_id
               where sc.training_assessment_response_id = r.id
                 and c.is_correct
             ) as correct_selected_count,
             (
               select count(*)
               from db.training_assessment_response_selected_choices sc
               join db.training_assessment_item_choices c
                 on c.id = sc.training_assessment_item_choice_id
               where sc.training_assessment_response_id = r.id
                 and not c.is_correct
             ) as incorrect_selected_count
      from db.training_assessment_responses r
      join db.training_assessment_items item
        on item.id = r.training_assessment_item_id
      where r.training_assessment_attempt_id = ${attemptId}
        and item.type = 'multiple_choice'
    `,
  );
  s.defTable(
    "assessment_mc_scores",
    sql`
      select g.response_id,
             g.correct_choice_count > 0
               and g.correct_selected_count = g.correct_choice_count
               and g.incorrect_selected_count = 0 as exact_match,
             case
               when g.correct_choice_count > 0
                 and g.correct_selected_count = g.correct_choice_count
                 and g.incorrect_selected_count = 0
               then g.item_points::double
               when g.partial_credit and g.correct_choice_count > 0
               then round(
                 g.item_points::double
                   * greatest(
                     g.correct_selected_count - g.incorrect_selected_count,
                     0)::double
                   / g.correct_choice_count::double,
                 2)
               else 0::double
             end as awarded
      from assessment_mc_grades g
    `,
  );
  s.modify(sql`
    update db.training_assessment_responses
    set auto_graded = true,
        is_correct = (
          select g.exact_match
          from assessment_mc_scores g
          where g.response_id = id
        ),
        points_awarded = (
          select g.awarded
          from assessment_mc_scores g
          where g.response_id = id
        )
    where training_assessment_attempt_id = ${attemptId}
      and id in (select g.response_id from assessment_mc_scores g)
  `);
}

/**
 * Practical observations are graded from the recorded result when they count
 * toward score: pass earns the item points, every other result earns zero.
 * A manual score set through {@link saveAssessmentResponseManualScore}
 * before submission (points_awarded already present) is kept as-is for
 * partial credit and stays marked as not auto graded.
 */
function autoGradePracticalObservationStatements<
  T extends IServerBaseStatements,
>(
  s: T,
  attemptId: Sql,
) {
  s.modify(sql`
    update db.training_assessment_responses
    set auto_graded = points_awarded is null,
        is_correct = practical_result = 'pass',
        points_awarded = case
          when points_awarded is not null then points_awarded
          when practical_result = 'pass' then max_points::double
          else 0::double
        end
    where training_assessment_attempt_id = ${attemptId}
      and training_assessment_item_id in (
        select item.id
        from db.training_assessment_items item
        where item.type = 'practical_observation'
      )
      and practical_result is not null
  `);
}

function autoGradeSignatureStatements<
  T extends IServerBaseStatements,
>(
  s: T,
  attemptId: Sql,
) {
  s.modify(sql`
    update db.training_assessment_responses
    set auto_graded = true,
        is_correct = true,
        points_awarded = max_points::double
    where training_assessment_attempt_id = ${attemptId}
      and training_assessment_item_id in (
        select item.id
        from db.training_assessment_items item
        where item.type = 'signature'
      )
      and (
        signature_data is not null
        or nullif(trim(coalesce(signature_name, '')), '') is not null
      )
  `);
}

/** Required practical failure per the item-level failure rules. */
export function assessmentAttemptFailsByPracticalSql(attemptId: Sql) {
  return sql`exists (
    select 1
    from db.training_assessment_responses r
    join db.training_assessment_items item
      on item.id = r.training_assessment_item_id
    where r.training_assessment_attempt_id = ${attemptId}
      and item.type = 'practical_observation'
      and item.is_required
      and (
        (r.practical_result = 'fail' and item.fail_result_fails_attempt)
        or (r.practical_result = 'not_observed'
          and item.not_observed_fails_attempt)
      )
  )`;
}

function attemptScorePointsSql(attemptId: Sql) {
  return sql`(
    select coalesce(sum(coalesce(r.points_awarded, 0)), 0)
    from db.training_assessment_responses r
    where r.training_assessment_attempt_id = ${attemptId}
      and r.include_in_score
  )`;
}

function attemptMaxPointsSql(attemptId: Sql) {
  return sql`(
    select coalesce(sum(r.max_points), 0)
    from db.training_assessment_responses r
    where r.training_assessment_attempt_id = ${attemptId}
      and r.include_in_score
  )`;
}

/**
 * Recalculates the attempt score snapshot (score_points, max_points,
 * score_percent) from its responses. Does not touch status or outcome.
 * Rounds to two decimals so partial-credit sums stay presentable.
 */
export function gradeAssessmentAttemptSql(attemptId: Sql) {
  const score = sql`round(${attemptScorePointsSql(attemptId)}, 2)`;
  const max = attemptMaxPointsSql(attemptId);
  return sql`
    update db.training_assessment_attempts
    set score_points = ${score},
        max_points = ${max},
        score_percent = case
          when ${max} = 0 then null
          else ${score}::double / ${max}::double * 100.0
        end
    where id = ${attemptId}
  `;
}

/**
 * Outcome the grading rules produce for a graded attempt: practical failure
 * rules first, then the passing score gate. Zero-point attempts with no
 * practical failure pass (trainer-recorded evaluations); attempts needing
 * review never reach this expression before review.
 */
export function assessmentAttemptComputedOutcomeSql(attemptId: Sql) {
  return sql`case
    when ${assessmentAttemptFailsByPracticalSql(attemptId)} then 'failed'
    when (
        select att.max_points > 0
          and coalesce(att.score_percent, 0) <
            coalesce(nullif(v.passing_score_percent, 0), 100)
        from db.training_assessment_attempts att
        join db.training_assessment_versions v
          on v.id = att.training_assessment_version_id
        where att.id = ${attemptId}
      ) then 'failed'
    else 'passed'
  end`;
}

/**
 * Submits an in_progress attempt: validates completeness, snapshots the
 * grade, and either completes the attempt synchronously or parks it in
 * review_pending. Passing attempts complete their linked task. Must run
 * inside a transaction.
 */
export function submitAssessmentAttempt<
  T extends IServerBaseStatements,
>(
  s: T,
  args: {
    opts: TrainingBlockOpts;
    attemptId: Sql;
    actorId: Sql;
  },
) {
  s.defRecord(
    "assessment_submit_attempt",
    sql`select att.id, att.status,
               task.status as task_status,
               assignment.status as assignment_status,
               assignment.employee_final_signed_at,
               assessment.execution_mode
        from db.training_assessment_attempts att
        join db.training_employee_tasks task
          on task.id = att.training_employee_task_id
        join db.training_assignments assignment
          on assignment.id = task.training_assignment_id
        join db.training_assessment_versions version
          on version.id = att.training_assessment_version_id
        join db.training_assessments assessment
          on assessment.id = version.training_assessment_id
        where att.id = ${args.attemptId}`,
  );
  s.throwErrorIf(
    sql`assessment_submit_attempt.id is null`,
    sql.lit`Assessment attempt not found.`,
  );
  s.throwErrorIf(
    sql`assessment_submit_attempt.status != 'in_progress'`,
    sql.lit`This assessment attempt is already submitted.`,
  );
  s.throwErrorIf(
    sql`assessment_submit_attempt.task_status not in ('assigned', 'in_progress')
      or assessment_submit_attempt.assignment_status not in
        ('pending', 'in_progress', 'validation_pending')
      or assessment_submit_attempt.employee_final_signed_at is not null`,
    sql.lit`Signed or completed training assignments cannot be changed.`,
  );
  s.throwErrorIf(
    sql`exists (
      select 1
      from db.training_assessment_responses r
      join db.training_assessment_items item
        on item.id = r.training_assessment_item_id
      where r.training_assessment_attempt_id = assessment_submit_attempt.id
        and item.is_required
        and case item.type::string
          when 'multiple_choice' then not exists (
            select 1
            from db.training_assessment_response_selected_choices sc
            where sc.training_assessment_response_id = r.id
          )
          when 'text_response' then
            nullif(trim(coalesce(r.text_response, '')), '') is null
          when 'practical_observation' then
            item.practical_result_required and r.practical_result is null
          when 'signature' then
            r.signature_data is null
            and nullif(trim(coalesce(r.signature_name, '')), '') is null
          else false
        end
    )`,
    sql.lit`Every required question needs an answer before submitting.`,
  );
  s.throwErrorIf(
    sql`exists (
      select 1
      from db.training_assessment_metadata_responses r
      join db.training_assessment_metadata_fields field
        on field.id = r.training_assessment_metadata_field_id
      where r.training_assessment_attempt_id = assessment_submit_attempt.id
        and field.required
        and case field.type::string
          when 'text' then
            nullif(trim(coalesce(r.text_value, '')), '') is null
          when 'number' then r.number_value is null
          when 'date' then r.date_value is null
          when 'single_choice' then r.selected_choice_id is null
          else false
        end
    )`,
    sql.lit`Every required assessment detail needs a value before submitting.`,
  );
  s.throwErrorIf(
    sql`exists (
      select 1
      from db.training_assessment_responses r
      join db.training_assessment_items item
        on item.id = r.training_assessment_item_id
      where r.training_assessment_attempt_id = assessment_submit_attempt.id
        and item.type = 'practical_observation'
        and item.is_required
        and r.practical_result = 'not_applicable'
        and not item.not_applicable_allowed
    )`,
    sql.lit`Not applicable is not allowed for a required practical item.`,
  );
  autoGradeMultipleChoiceStatements(s, sql`assessment_submit_attempt.id`);
  autoGradePracticalObservationStatements(
    s,
    sql`assessment_submit_attempt.id`,
  );
  autoGradeSignatureStatements(s, sql`assessment_submit_attempt.id`);
  s.modify(gradeAssessmentAttemptSql(sql`assessment_submit_attempt.id`));
  s.defScalar(
    "assessment_submit_needs_review",
    sql`assessment_submit_attempt.execution_mode =
        'employee_submission_with_review'
      or exists (
        select 1
        from db.training_assessment_responses r
        where r.training_assessment_attempt_id = assessment_submit_attempt.id
          and r.requires_review
      )`,
  );
  s.if(
    sql`assessment_submit_needs_review`,
    (s) => {
      s.modify(sql`
        update db.training_assessment_responses
        set review_status = 'pending'
        where training_assessment_attempt_id = assessment_submit_attempt.id
          and requires_review
      `);
      s.modify(sql`
        update db.training_assessment_attempts
        set status = 'review_pending',
            submitted_at = now(),
            submitted_by_id = ${args.actorId}
        where id = assessment_submit_attempt.id
      `);
    },
    (s) => {
      s.modify(sql`
        update db.training_assessment_attempts
        set status = 'complete',
            outcome = ${
        assessmentAttemptComputedOutcomeSql(sql`assessment_submit_attempt.id`)
      },
            submitted_at = now(),
            submitted_by_id = ${args.actorId},
            completed_at = now()
        where id = assessment_submit_attempt.id
      `);
      s.if(
        sql`(select att.outcome = 'passed'
             from db.training_assessment_attempts att
             where att.id = assessment_submit_attempt.id)`,
        (s) => {
          completeAssessmentLinkedTask(s, {
            opts: args.opts,
            attemptId: sql`assessment_submit_attempt.id`,
          });
        },
      );
    },
  );
}

/**
 * Task completion bridge: the only path from an assessment attempt to
 * training progress. Marks the linked task completed and lets the existing
 * assignment status helper decide the assignment. Never completes
 * training_assignments directly. Must run inside a transaction; callers
 * that need certification follow-up run
 * createCertificationForCompletedAssignment after their commit.
 */
export function completeAssessmentLinkedTask<
  T extends IServerBaseStatements,
>(
  s: T,
  args: {
    opts: TrainingBlockOpts;
    attemptId: Sql;
  },
) {
  s.defRecord(
    "assessment_bridge_attempt",
    sql`select att.id, att.status, att.outcome,
               t.id as task_id,
               t.status as task_status, t.training_assignment_id,
               (
                 select a.training_language
                 from db.training_assignments a
                 where a.id = t.training_assignment_id
               ) as assignment_language
        from db.training_assessment_attempts att
        join db.training_employee_tasks t
          on t.id = att.training_employee_task_id
        where att.id = ${args.attemptId}`,
  );
  s.throwErrorIf(
    sql`assessment_bridge_attempt.id is null`,
    sql.lit`Assessment attempt or its linked task not found.`,
  );
  s.throwErrorIf(
    sql`assessment_bridge_attempt.status != 'complete'
      or assessment_bridge_attempt.outcome != 'passed'`,
    sql.lit`Only passed assessment attempts can complete their task.`,
  );
  s.if(
    sql`assessment_bridge_attempt.task_status in ('assigned', 'in_progress')`,
    (s) => {
      s.callStoredProcedure("training_complete_task", {
        inputScalars: {
          p_task_id: sql`assessment_bridge_attempt.task_id`,
          p_access_token: sql`null`,
          p_signature_data: sql`null`,
          p_completion_attestation: sql`null`,
          p_essay_response: sql`null`,
        },
      });
    },
  );
}

/**
 * Attempt-level review: decides final outcome, override, retake request,
 * or cancellation, and records the decision. Permission checks
 * (review/override) belong to the caller. Must run inside a transaction.
 *
 * Actions: `approve` finalizes with the graded outcome; `fail`,
 * `pass_override`, and `fail_override` force an outcome; `request_retake`
 * completes as failed so a new attempt can start; `cancel` invalidates the
 * attempt so it does not count against the retake policy.
 */
export function reviewAssessmentAttempt<
  T extends IServerBaseStatements,
>(
  s: T,
  args: {
    opts: TrainingBlockOpts;
    attemptId: Sql;
    reviewerId: Sql;
    /** One of the training_assessment_attempt_review_action values. */
    action: Sql;
    notes?: Sql;
    overrideReason?: Sql;
    signatureData?: Sql;
  },
) {
  s.defScalar("assessment_review_action", sql`${args.action}::string`);
  s.throwErrorIf(
    sql`assessment_review_action not in (
      'approve',
      'fail',
      'pass_override',
      'fail_override',
      'request_retake',
      'cancel'
    )`,
    sql.lit`Unsupported assessment attempt review action.`,
  );
  s.throwErrorIf(
    sql`assessment_review_action in ('pass_override', 'fail_override')
      and nullif(trim(coalesce((${
      args.overrideReason ?? sql`null`
    })::string, '')), '') is null`,
    sql.lit`An override reason is required for assessment outcome overrides.`,
  );
  s.defRecord(
    "assessment_review_attempt",
    sql`select att.id, att.status,
               task.status as task_status,
               assignment.status as assignment_status,
               exists (
                 select 1
                 from db.training_assessment_responses response
                 join db.training_assessment_items item
                   on item.id = response.training_assessment_item_id
                 where response.training_assessment_attempt_id = att.id
                   and item.reviewer_signature_required
               ) as requires_evaluator_signature
        from db.training_assessment_attempts att
        join db.training_employee_tasks task
          on task.id = att.training_employee_task_id
        join db.training_assignments assignment
          on assignment.id = task.training_assignment_id
        where att.id = ${args.attemptId}`,
  );
  s.throwErrorIf(
    sql`assessment_review_attempt.id is null`,
    sql.lit`Assessment attempt not found.`,
  );
  s.throwErrorIf(
    sql`assessment_review_attempt.task_status not in ('assigned', 'in_progress')
      or assessment_review_attempt.assignment_status not in
        ('pending', 'in_progress', 'validation_pending')`,
    sql.lit`This assessment attempt is no longer active.`,
  );
  s.throwErrorIf(
    sql`assessment_review_action != 'cancel'
      and assessment_review_attempt.requires_evaluator_signature
      and nullif(trim(coalesce((${
      args.signatureData ?? sql`null`
    })::string, '')), '') is null`,
    sql.lit`An evaluator signature is required for this assessment.`,
  );
  s.throwErrorIf(
    sql`assessment_review_action in ('approve', 'fail')
      and assessment_review_attempt.status != 'review_pending'`,
    sql.lit`Only attempts pending review can be approved or failed.`,
  );
  s.throwErrorIf(
    sql`assessment_review_action in
        ('pass_override', 'fail_override', 'request_retake')
      and assessment_review_attempt.status not in
        ('review_pending', 'complete')`,
    sql.lit`Only submitted attempts can be overridden.`,
  );
  s.throwErrorIf(
    sql`assessment_review_action = 'cancel'
      and assessment_review_attempt.status not in
        ('in_progress', 'review_pending')`,
    sql.lit`Only open attempts can be cancelled.`,
  );
  s.throwErrorIf(
    sql`assessment_review_action in ('approve', 'fail')
      and exists (
        select 1
        from db.training_assessment_responses response
        where response.training_assessment_attempt_id =
          assessment_review_attempt.id
          and response.requires_review
          and coalesce(response.review_status::string, 'pending') in
            ('pending', 'changes_requested')
      )`,
    sql.lit`Review every pending response before deciding the attempt.`,
  );
  // Re-snapshot the grade so review-adjusted response scores are reflected
  // before the outcome is decided.
  s.modify(gradeAssessmentAttemptSql(sql`assessment_review_attempt.id`));
  s.defScalar(
    "assessment_review_outcome",
    sql`case assessment_review_action
      when 'approve' then ${
      assessmentAttemptComputedOutcomeSql(sql`assessment_review_attempt.id`)
    }
      when 'pass_override' then 'passed'
      when 'fail' then 'failed'
      when 'fail_override' then 'failed'
      when 'request_retake' then 'failed'
      else null
    end`,
  );
  s.modify(sql`
    insert into db.training_assessment_attempt_reviews
      (training_assessment_attempt_id, reviewed_by_id, review_action,
       outcome, score_points, notes, override_reason, signature_data)
    select assessment_review_attempt.id, ${args.reviewerId},
           ${args.action},
           assessment_review_outcome::enums.training_assessment_outcome,
           att.score_points,
           ${args.notes ?? sql`null`},
           ${args.overrideReason ?? sql`null`},
           ${args.signatureData ?? sql`null`}
    from db.training_assessment_attempts att
    where att.id = assessment_review_attempt.id
  `);
  s.if(
    sql`assessment_review_action = 'cancel'`,
    (s) => {
      s.modify(sql`
        update db.training_assessment_attempts
        set status = 'cancelled',
            outcome = null,
            cancelled_at = now(),
            cancelled_by_id = ${args.reviewerId}
        where id = assessment_review_attempt.id
      `);
    },
    (s) => {
      s.modify(sql`
        update db.training_assessment_attempts
        set status = 'complete',
            outcome =
              assessment_review_outcome::enums.training_assessment_outcome,
            completed_at = coalesce(completed_at, now())
        where id = assessment_review_attempt.id
      `);
      s.if(sql`assessment_review_outcome = 'passed'`, (s) => {
        completeAssessmentLinkedTask(s, {
          opts: args.opts,
          attemptId: sql`assessment_review_attempt.id`,
        });
      });
    },
  );
}

/**
 * Response-level review: approves, rejects, or re-scores one answer and
 * refreshes the attempt grade snapshot. Never sets the attempt outcome and
 * never requests retakes; that stays with {@link reviewAssessmentAttempt}.
 * Must run inside a transaction.
 */
export function reviewAssessmentResponse<
  T extends IServerBaseStatements,
>(
  s: T,
  args: {
    responseId: Sql;
    reviewerId: Sql;
    /** One of the training_assessment_response_review_action values. */
    action: Sql;
    pointsAwarded?: Sql;
    notes?: Sql;
    overrideReason?: Sql;
    signatureData?: Sql;
  },
) {
  s.defScalar(
    "assessment_response_review_action",
    sql`${args.action}::string`,
  );
  s.throwErrorIf(
    sql`assessment_response_review_action not in (
      'approve', 'reject', 'adjust_score', 'request_changes'
    )`,
    sql.lit`Unsupported assessment response review action.`,
  );
  s.defRecord(
    "assessment_review_response",
    sql`select r.id, r.max_points, r.points_awarded,
               att.id as attempt_id, att.status as attempt_status,
               task.status as task_status,
               assignment.status as assignment_status,
               assignment.employee_final_signed_at,
               version.score_adjustment_allowed
        from db.training_assessment_responses r
        join db.training_assessment_attempts att
          on att.id = r.training_assessment_attempt_id
        join db.training_assessment_versions version
          on version.id = att.training_assessment_version_id
        join db.training_employee_tasks task
          on task.id = att.training_employee_task_id
        join db.training_assignments assignment
          on assignment.id = task.training_assignment_id
        where r.id = ${args.responseId}`,
  );
  s.throwErrorIf(
    sql`assessment_review_response.id is null`,
    sql.lit`Assessment response not found.`,
  );
  s.throwErrorIf(
    sql`assessment_review_response.attempt_status != 'review_pending'`,
    sql.lit`Only attempts pending review accept response reviews.`,
  );
  s.throwErrorIf(
    sql`assessment_review_response.task_status not in ('assigned', 'in_progress')
      or assessment_review_response.assignment_status not in
        ('pending', 'in_progress', 'validation_pending')
      or assessment_review_response.employee_final_signed_at is not null`,
    sql.lit`This assessment response is no longer active.`,
  );
  s.throwErrorIf(
    sql`assessment_response_review_action = 'request_changes'
      and nullif(trim(coalesce((${
      args.notes ?? sql`null`
    })::string, '')), '') is null`,
    sql.lit`Explain the requested changes.`,
  );
  s.throwErrorIf(
    sql`assessment_response_review_action = 'adjust_score'
      and ${args.pointsAwarded ?? sql`null`} is null`,
    sql.lit`Enter a response score to save.`,
  );
  s.throwErrorIf(
    sql`${args.pointsAwarded ?? sql`null`} is not null
      and not assessment_review_response.score_adjustment_allowed`,
    sql.lit`Score adjustments are not allowed for this assessment.`,
  );
  s.throwErrorIf(
    sql`${args.pointsAwarded ?? sql`null`} is not null
      and (
        ${args.pointsAwarded ?? sql`null`} < 0
        or ${args.pointsAwarded ?? sql`null`} >
          assessment_review_response.max_points
      )`,
    sql.lit`Response score must be between zero and the response max points.`,
  );
  s.modify(sql`
    insert into db.training_assessment_response_reviews
      (training_assessment_response_id, reviewed_by_id, review_action,
       points_awarded, notes, override_reason, signature_data)
    values
      (
        assessment_review_response.id,
        ${args.reviewerId},
        ${args.action},
        case assessment_response_review_action
          when 'approve' then coalesce(
            ${args.pointsAwarded ?? sql`null`},
            assessment_review_response.points_awarded,
            assessment_review_response.max_points
          )
          when 'reject' then coalesce(${args.pointsAwarded ?? sql`null`}, 0)
          when 'adjust_score' then coalesce(
            ${args.pointsAwarded ?? sql`null`},
            assessment_review_response.points_awarded
          )
          else assessment_review_response.points_awarded
        end,
        ${args.notes ?? sql`null`},
        ${args.overrideReason ?? sql`null`},
        ${args.signatureData ?? sql`null`}
      )
  `);
  s.modify(sql`
    update db.training_assessment_responses
    set review_status = case assessment_response_review_action
          when 'approve' then 'approved'
          when 'reject' then 'rejected'
          when 'request_changes' then 'changes_requested'
          else review_status
        end::enums.training_assessment_response_review_status,
        points_awarded = case assessment_response_review_action
          when 'approve' then coalesce(
            ${args.pointsAwarded ?? sql`null`}, points_awarded, max_points)
          when 'reject' then coalesce(${args.pointsAwarded ?? sql`null`}, 0)
          when 'adjust_score' then coalesce(
            ${args.pointsAwarded ?? sql`null`}, points_awarded)
          else points_awarded
        end,
        auto_graded = case
          when assessment_response_review_action = 'adjust_score' then false
          else auto_graded
        end
    where id = assessment_review_response.id
  `);
  s.modify(
    gradeAssessmentAttemptSql(sql`assessment_review_response.attempt_id`),
  );
  s.if(
    sql`assessment_response_review_action = 'request_changes'`,
    (s) => {
      s.modify(sql`
        update db.training_assessment_attempts
        set status = 'in_progress',
            outcome = null,
            submitted_at = null,
            submitted_by_id = null,
            completed_at = null
        where id = assessment_review_response.attempt_id
          and status = 'review_pending'
      `);
    },
  );
}

/**
 * Publish blockers for an assessment version, one row per issue. Publish
 * only when this query is empty.
 */
export function assessmentVersionPublishIssuesSql(versionId: Sql) {
  return sql`
    select 'Passing score must be between 1 and 100 percent.' as issue
    from db.training_assessment_versions version
    where version.id = ${versionId}
      and version.passing_score_percent not between 1 and 100
    union all
    select 'Maximum attempts must be at least 1 when specified.'
    from db.training_assessment_versions version
    where version.id = ${versionId}
      and version.max_attempts is not null
      and version.max_attempts < 1
    union all
    select 'The version has no questions yet.'
    where not exists (
      select 1
      from db.training_assessment_items item
    join db.training_assessment_sections section
      on section.id = item.training_assessment_section_id
    where section.training_assessment_version_id = ${versionId}
    )
    union all
    select 'Multiple choice question "' || item.prompt ||
      '" needs at least one correct choice.'
    from db.training_assessment_items item
    join db.training_assessment_sections section
      on section.id = item.training_assessment_section_id
    where section.training_assessment_version_id = ${versionId}
      and item.type = 'multiple_choice'
      and not exists (
        select 1
        from db.training_assessment_item_choices choice
        where choice.training_assessment_item_id = item.id
          and choice.is_correct
      )
    union all
    select 'Single-answer question "' || item.prompt ||
      '" can only have one correct choice.'
    from db.training_assessment_items item
    join db.training_assessment_sections section
      on section.id = item.training_assessment_section_id
    where section.training_assessment_version_id = ${versionId}
      and item.type = 'multiple_choice'
      and item.selection_mode = 'single'
      and (
        select count(*)
        from db.training_assessment_item_choices choice
        where choice.training_assessment_item_id = item.id
          and choice.is_correct
      ) > 1
    union all
    select 'Question "' || item.prompt ||
      '" is not multiple choice but has choices.'
    from db.training_assessment_items item
    join db.training_assessment_sections section
      on section.id = item.training_assessment_section_id
    where section.training_assessment_version_id = ${versionId}
      and item.type != 'multiple_choice'
      and exists (
        select 1
        from db.training_assessment_item_choices choice
        where choice.training_assessment_item_id = item.id
      )
    union all
    select 'Question "' || item.prompt ||
      '" has multiple-choice settings but is not multiple choice.'
    from db.training_assessment_items item
    join db.training_assessment_sections section
      on section.id = item.training_assessment_section_id
    where section.training_assessment_version_id = ${versionId}
      and item.type != 'multiple_choice'
      and (
        item.shuffle_choices
        or nullif(trim(coalesce(item.explanation, '')), '') is not null
        or nullif(trim(coalesce(item.remediation_text, '')), '') is not null
      )
    union all
    select 'Question "' || item.prompt ||
      '" has practical settings but is not a practical observation.'
    from db.training_assessment_items item
    join db.training_assessment_sections section
      on section.id = item.training_assessment_section_id
    where section.training_assessment_version_id = ${versionId}
      and item.type != 'practical_observation'
      and (
        item.practical_result_required
        or item.fail_result_fails_attempt
        or item.not_observed_fails_attempt
        or item.not_applicable_allowed
        or item.reviewer_signature_required
      )
    union all
    select 'Assessment detail "' || field.label ||
      '" needs at least one choice.'
    from db.training_assessment_metadata_fields field
    where field.training_assessment_version_id = ${versionId}
      and field.type = 'single_choice'
      and not exists (
        select 1
        from db.training_assessment_metadata_field_choices choice
        where choice.training_assessment_metadata_field_id = field.id
      )
    union all
    select 'Assessment detail "' || field.label ||
      '" is not single choice but has choices.'
    from db.training_assessment_metadata_fields field
    where field.training_assessment_version_id = ${versionId}
      and field.type != 'single_choice'
      and exists (
        select 1
        from db.training_assessment_metadata_field_choices choice
        where choice.training_assessment_metadata_field_id = field.id
      )
  `;
}
