import { StatusChip } from "components/status_chip";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";

import type { TrainingBlockOpts, TrainingFeatureName } from "./types.ts";

export function workforceProvider(opts: TrainingBlockOpts) {
  return opts.workforce;
}

export function personTable(opts: TrainingBlockOpts) {
  return workforceProvider(opts).personTable;
}

export function employeeName(opts: TrainingBlockOpts, record: Sql) {
  return workforceProvider(opts).personDisplayName(record);
}

export function currentEmployeeId(opts: TrainingBlockOpts) {
  return workforceProvider(opts).currentPersonId();
}

const trainingApiBasePath = "/api/training";

export function trainingExternalVersionUrl(
  versionId: Sql,
  taskId: Sql,
  accessToken?: Sql,
) {
  return accessToken
    ? sql.concat(
      `${trainingApiBasePath}/invite/`,
      accessToken,
      "/tasks/",
      taskId,
      "/documents/",
      versionId,
      "/external",
    )
    : sql.concat(
      `${trainingApiBasePath}/tasks/`,
      taskId,
      "/documents/",
      versionId,
      "/external",
    );
}

export function trainingFileVersionUrl(
  versionId: Sql,
  taskId: Sql,
  accessToken?: Sql,
) {
  return accessToken
    ? sql.concat(
      `${trainingApiBasePath}/invite/`,
      accessToken,
      "/tasks/",
      taskId,
      "/documents/",
      versionId,
      "/file",
    )
    : sql.concat(
      `${trainingApiBasePath}/tasks/`,
      taskId,
      "/documents/",
      versionId,
      "/file",
    );
}

export function certificationProofUrl(
  proofBlobHash: Sql,
) {
  return sql.concat(
    `${trainingApiBasePath}/certification-proof/`,
    sql`bytes.to_hex(${proofBlobHash})`,
  );
}

export function generatedCertificateUrl(
  accessToken: Sql,
) {
  return sql.concat(`${trainingApiBasePath}/certificate/`, accessToken);
}

export function generatedCertificateDownloadUrl(
  accessToken: Sql,
) {
  return sql.concat(
    `${trainingApiBasePath}/certificate-download/`,
    accessToken,
  );
}

export function personnelDocumentUrl(blobHash: Sql) {
  return sql.concat(
    `${trainingApiBasePath}/personnel-document/`,
    sql`bytes.to_hex(${blobHash})`,
  );
}

export function competencyEvidenceUrl(
  blobHash: Sql,
) {
  return sql.concat(
    `${trainingApiBasePath}/competency-evidence/`,
    sql`bytes.to_hex(${blobHash})`,
  );
}

// The ::int cast matters: a bare sql.lit is a string literal, and
// date.add silently misparses string day counts.
export function certificationWarningDaysSql() {
  return sql`${sql.lit("45")}::int`;
}

/**
 * A certification that needs attention: expired or inside the warning
 * window, and not superseded by a renewal certification.
 */
export function certificationAlertWhereSql(
  _opts: TrainingBlockOpts,
  cert: Sql,
) {
  return sql`${cert}.approval_status = 'approved'
    and ${cert}.expires_at is not null
    and ${cert}.expires_at <= date.add(
      day, ${certificationWarningDaysSql()}, current_date()
    )
    and not exists (
      select 1
      from db.training_certifications renewal
      where renewal.renewed_from_certification_id = ${cert}.id
        and renewal.approval_status = 'approved'
    )`;
}

export function openTrainingAssignmentWhereSql(assignment: Sql) {
  return sql`${assignment}.status in (
    'pending', 'in_progress', 'validation_pending'
  )`;
}

export function completedTrainingAssignmentWhereSql(assignment: Sql) {
  return sql`${assignment}.status = 'completed'`;
}

/**
 * A competency check that needs attention: pending or failed without a
 * newer passing check of the same title, or a pass whose recheck date is
 * inside the certification warning window.
 */
export function competencyAlertWhereSql(
  _opts: TrainingBlockOpts,
  check: Sql,
) {
  return sql`(
    ${check}.result in ('pending', 'fail', 'needs_retrain')
    and not exists (
      select 1
      from db.training_competency_checks newer
      where newer.person_id = ${check}.person_id
        and newer.title = ${check}.title
        and newer.result = 'pass'
        and newer.created_at > ${check}.created_at
    )
  ) or (
    ${check}.result = 'pass'
    and ${check}.recheck_due_date is not null
    and ${check}.recheck_due_date <= date.add(
      day, ${certificationWarningDaysSql()}, current_date()
    )
  )`;
}

/**
 * Completes open retraining cases linked to an assignment once that
 * assignment itself reaches `completed`.
 */
export function closeRetrainingCasesForAssignmentSql(
  assignmentId: Sql,
) {
  return sql`
    update db.training_retraining_cases
    set status = 'completed',
        completed_at = now()
    where status = 'open'
      and training_assignment_id = ${assignmentId}
      and exists (
        select 1
        from db.training_assignments a
        where a.id = ${assignmentId}
          and a.status = 'completed'
      )
  `;
}

export function defaultLanguageSql(opts: TrainingBlockOpts) {
  return sql.lit(opts.content.opts.defaultLanguage);
}

export function trainingRetrainingSourcesQuery(opts: TrainingBlockOpts) {
  return sql.unionAll(
    ...(opts.retrainingSources ?? []).map((source, index) =>
      sql`select ${sql.lit(source.code)} as code,
                 ${sql.lit(source.name)} as name,
                 ${
        source.description === undefined
          ? sql`cast(null as string)`
          : sql.lit(source.description)
      } as description,
                 ${sql.lit(String(index))}::int as sort_order`
    ),
  );
}

export function trainingPersonnelDocumentTypesQuery(opts: TrainingBlockOpts) {
  return sql.unionAll(
    ...(opts.personnelDocumentTypes ?? []).map((documentType, index) =>
      sql`select ${sql.lit(documentType.code)} as code,
                 ${sql.lit(documentType.name)} as name,
                 ${sql.lit(String(index))}::int as sort_order`
    ),
  );
}

export const trainingPermissions = {
  manageLibrary: "can_manage_training_courses",
  manageDocumentSettings: "can_manage_training_document_settings",
  assignTraining: "can_assign_training",
  validateTraining: "can_validate_training",
  signPrimaryValidator: "can_sign_primary_training_validator",
  signSecondaryValidator: "can_sign_secondary_training_validator",
  viewEmployeeFiles: "can_view_employee_training_files",
  manageEmployeeFiles: "can_manage_employee_training_files",
  manageNotifications: "can_manage_training_notifications",
  publishTraining: "can_publish_training_courses",
  manageAssessments: "can_manage_training_assessments",
  publishAssessments: "can_publish_training_assessments",
  reviewAssessments: "can_review_training_assessments",
  recordEvaluations: "can_record_training_evaluations",
  overrideAssessmentOutcomes: "can_override_assessment_outcomes",
} as const;

export function trainingFeatureEnabled(
  opts: TrainingBlockOpts,
  feature: TrainingFeatureName,
) {
  const config = opts.features?.[feature];
  return config?.enabled ?? false;
}

export function trainingValidationLabels(opts: TrainingBlockOpts) {
  const permissions = trainingPermissions;
  const validation = opts.labels?.validation;
  return {
    primaryStageCode: "primary_validator",
    primaryStageName: "Primary validator validation",
    primaryStagePermission: permissions.signPrimaryValidator,
    primaryStageDisplayName: validation?.primaryStageDisplayName ??
      "Primary validator",
    primaryStageSignatureLabel: validation?.primaryStageSignatureLabel ??
      "Primary validator signature",
    secondaryStageCode: "secondary_validator",
    secondaryStageName: "Secondary validator validation",
    secondaryStagePermission: validation?.secondaryStagePermission ??
      permissions.signSecondaryValidator,
    secondaryStageDisplayName: validation?.secondaryStageDisplayName ??
      "Secondary validator",
    secondaryStageSignatureLabel: validation?.secondaryStageSignatureLabel ??
      "Secondary validator signature",
    validatorGenericLabel: validation?.validatorGenericLabel ?? "validator",
  };
}

export function secondaryValidatorSignoffByPermission(
  opts: TrainingBlockOpts,
) {
  return opts.secondaryValidatorSignoff === "anyone_with_permission";
}

export const trainingComplianceLabels = {
  certificationsTitle: "Certifications",
  noCertificationsTitle: "No certifications",
  noCertificationsBody: "Certification records will appear here.",
  personnelTitle: "Personnel Documentation",
  noPersonnelTitle: "No personnel documentation",
  noPersonnelBody: "Personnel notes and supporting files will appear here.",
  personnelCreateHelpText:
    "Add a personnel note, retraining note, or supporting file.",
  competencyPlaceholder: "Practical observation",
} as const;

export function assignmentLanguageSql(
  opts: TrainingBlockOpts,
  requestedCode: Sql,
) {
  return sql`case
    when ${
    sql.inList(
      requestedCode,
      opts.content.opts.languages.map((l) => sql.lit(l.code)),
    )
  }
      then ${requestedCode}
    else ${defaultLanguageSql(opts)}
  end`;
}

export function retrainingSourceSql(
  opts: TrainingBlockOpts,
  requestedCode: Sql,
) {
  return sql`case
    when ${
    sql.inList(
      requestedCode,
      (opts.retrainingSources ?? []).map((source) => sql.lit(source.code)),
    )
  }
      then ${requestedCode}
    else ${retrainingSourceWithFallbackSql(opts, "manual")}
  end`;
}

export function retrainingSourceWithFallbackSql(
  opts: TrainingBlockOpts,
  code: string,
) {
  const sources = opts.retrainingSources ?? [];
  const fallback = sources.some((source) => source.code === code)
    ? code
    : sources.some((source) => source.code === "manual")
    ? "manual"
    : sources[0].code;
  return sql.lit(fallback);
}

export function personnelDocumentTypeWithFallbackSql(
  opts: TrainingBlockOpts,
  code: string,
) {
  const documentTypes = opts.personnelDocumentTypes ?? [];
  const fallback =
    documentTypes.some((documentType) => documentType.code === code)
      ? code
      : documentTypes.some((documentType) => documentType.code === "other")
      ? "other"
      : documentTypes[0].code;
  return sql.lit(fallback);
}

export function activeVersionSql(
  opts: TrainingBlockOpts,
  documentId: Sql,
  language: Sql,
) {
  return opts.content.resolveDirectTrainingVersion({
    documentId,
    requestedLanguage: language,
  });
}

export function activeVersionLanguageMatchesSql(
  documentVersionId: Sql,
  language: Sql,
  opts: TrainingBlockOpts,
) {
  return opts.content.directVersionMatchesCurrentResolution({
    versionId: documentVersionId,
    requestedLanguage: language,
  });
}

export function activeCourseVersionSql(courseId: Sql) {
  return sql`(
    select v.id
    from db.training_courses c
    join db.training_course_versions v
      on v.id = c.current_training_course_version_id
    where c.id = ${courseId}
      and v.training_course_id = c.id
      and v.status = 'published'
    order by v.effective_at desc nulls last, v.id desc
    limit 1
  )`;
}

/** Published version an attempt would pin: the assessment's current version
 * when it is published, like {@link activeCourseVersionSql} for courses. */
export function activeAssessmentVersionSql(assessmentId: Sql) {
  return sql`(
    select v.id
    from db.training_assessments assessment
    join db.training_assessment_versions v
      on v.id = assessment.current_training_assessment_version_id
    where assessment.id = ${assessmentId}
      and v.training_assessment_id = assessment.id
      and v.status = 'published'
    limit 1
  )`;
}

/**
 * Recursive CTE expanding course section items, following nested
 * `other_checklist` courses through their active versions and guarding
 * against cycles. Columns: root_course_id, item_id, parent_item_id,
 * section_ordinal, item_order_path, course_path, depth.
 * Use as: sql`with recursive ${expandedCourseItemsCteSql(anchor)} ...`
 */
function expandedCourseItemsCteSql(anchorWhere: Sql) {
  return sql`expanded_items(
      root_course_id, item_id, parent_item_id, section_ordinal,
      item_order_path, course_path, depth
    ) as (
      select version.training_course_id as root_course_id_value,
             i.id as item_id_value,
             null as parent_item_id_value,
             section.ordinal::bigint as section_ordinal_value,
             lpad(cast(i.sort_order as string), 10, '0') || ':' ||
               lpad(cast(i.id as string), 20, '0') as item_order_path_value,
             ',' || cast(version.training_course_id as string) || ','
               as course_path_value,
             0 as depth_value
      from db.training_course_section_items i
      join db.training_course_sections section
        on section.id = i.training_course_section_id
      join db.training_course_versions version
        on version.id = section.training_course_version_id
      where ${anchorWhere}
      union all
      select expanded.root_course_id as root_course_id_value,
             nested.id as item_id_value,
             parent.id as parent_item_id_value,
             expanded.section_ordinal as section_ordinal_value,
             expanded.item_order_path || '/' ||
               lpad(cast(nested.sort_order as string), 10, '0') || ':' ||
               lpad(cast(nested.id as string), 20, '0') as item_order_path_value,
             expanded.course_path || cast(nested_version.training_course_id as string) ||
               ',' as course_path_value,
             expanded.depth + 1 as depth_value
      from expanded_items expanded
      join db.training_course_section_items parent
        on parent.id = expanded.item_id
       and parent.type = 'other_checklist'
      join db.training_course_section_items nested
        on true
      join db.training_course_sections nested_section
        on nested_section.id = nested.training_course_section_id
       and nested_section.training_course_version_id =
         ${activeCourseVersionSql(sql`parent.other_course_id`)}
      join db.training_course_versions nested_version
        on nested_version.id = nested_section.training_course_version_id
      where expanded.depth < 50
        and expanded.course_path not like
          '%,' || cast(nested_version.training_course_id as string) || ',%'
    )`;
}

/**
 * Query behind the `training_expanded_course_items` view: the recursive
 * expansion of {@link expandedCourseItemsCteSql} anchored on every course's
 * current published version. Callers filter with
 * `where root_course_id = <courseId>`.
 */
export function expandedCourseItemsViewQuery() {
  return sql`
    with recursive ${
    expandedCourseItemsCteSql(
      sql`version.id =
        ${activeCourseVersionSql(sql`version.training_course_id`)}`,
    )
  }
    select * from expanded_items
  `;
}

/** Items a trainee can actually receive as tasks. */
function assignableCourseItemWhereSql() {
  return sql`i.type != 'other_checklist'
    and (
      (
        i.type = 'external_link'
        and nullif(trim(coalesce(i.external_url, '')), '') is not null
      )
      or (
        i.type = 'assessment'
        and i.training_assessment_id is not null
      )
      or i.type in ('essay', 'practical', 'signature')
    )`;
}

export function setCurrentCourseVersionSql(args: {
  courseId: Sql;
  courseVersionId: Sql;
}) {
  return sql`
    update db.training_courses
    set current_training_course_version_id = ${args.courseVersionId}
    where id = ${args.courseId}
      and exists (
        select 1
        from db.training_course_versions version
        where version.id = ${args.courseVersionId}
          and version.training_course_id = ${args.courseId}
          and version.status = 'published'
      )
  `;
}

export function insertCourseSectionFromTemplateSql(args: {
  courseVersionId: Sql;
  templateId: Sql;
}) {
  return sql`
    insert into db.training_course_sections
      (training_course_version_id, training_course_section_template_id,
       name, description, ordinal)
    select ${args.courseVersionId}, template.id,
           template.name, template.description,
           coalesce((
             select max(section.ordinal) + 10
             from db.training_course_sections section
             where section.training_course_version_id = ${args.courseVersionId}
           ), 10)
    from db.training_course_section_templates template
    where template.id = ${args.templateId}
      and template.is_active
      and not exists (
        select 1
        from db.training_course_sections section
        where section.training_course_version_id = ${args.courseVersionId}
          and section.training_course_section_template_id = template.id
      )
  `;
}

export function insertCourseSectionItemsFromTemplateSql(args: {
  courseVersionId: Sql;
  templateId: Sql;
}) {
  return sql`
    insert into db.training_course_section_items
      (training_course_section_id, other_course_id, training_assessment_id,
       sort_order, external_url, external_title,
       requires_essay, essay_prompt,
       content, type, source_template_item_id)
    select section.id,
           item.training_course_id,
           item.training_assessment_id,
           item.sort_order,
           item.external_url,
           item.external_title,
           item.requires_essay,
           item.essay_prompt,
           item.content,
           item.type,
           item.id as source_template_item_id_value
    from db.training_course_section_template_items item
    join db.training_course_sections section
      on section.training_course_version_id = ${args.courseVersionId}
     and section.training_course_section_template_id = item.training_course_section_template_id
    where item.training_course_section_template_id = ${args.templateId}
      and not exists (
        select 1
        from db.training_course_section_items existing
        where existing.training_course_section_id = section.id
          and existing.source_template_item_id = item.id
      )
  `;
}

export function insertCourseSectionItemDocumentsFromTemplateSql(args: {
  courseVersionId: Sql;
  templateId: Sql;
}) {
  return sql`
    insert into db.training_course_section_item_documents
      (training_course_section_item_id, document_id, sort_order, label)
    select course_item.id,
           template_doc.document_id,
           template_doc.sort_order,
           template_doc.label
    from db.training_course_section_template_item_documents template_doc
    join db.training_course_section_template_items template_item
      on template_item.id =
        template_doc.training_course_section_template_item_id
    join db.training_course_section_items course_item
      on course_item.source_template_item_id = template_item.id
     and course_item.type != 'signature'
    join db.training_course_sections section
      on section.id = course_item.training_course_section_id
     and section.training_course_version_id = ${args.courseVersionId}
     and section.training_course_section_template_id =
        template_item.training_course_section_template_id
    where template_item.training_course_section_template_id = ${args.templateId}
      and not exists (
        select 1
        from db.training_course_section_item_documents existing
        where existing.training_course_section_item_id = course_item.id
          and existing.document_id = template_doc.document_id
      )
  `;
}

/**
 * NOTE: the clone helpers below record stable clone keys
 * (`source_section_id`, `source_item_id`) on the new rows and match cloned
 * rows across versions through them. Rows created before these columns
 * existed have null keys; a null key simply matches nothing.
 */
export function cloneCourseVersionSectionsSql(args: {
  oldCourseVersionId: Sql;
  newCourseVersionId: Sql;
  excludeSectionId?: Sql;
}) {
  return sql`
    insert into db.training_course_sections
      (training_course_version_id, training_course_section_template_id,
       name, description, ordinal, source_section_id)
    select ${args.newCourseVersionId},
           source_section.training_course_section_template_id,
           source_section.name, source_section.description,
           source_section.ordinal,
           source_section.id
    from db.training_course_sections source_section
    where source_section.training_course_version_id = ${args.oldCourseVersionId}
      ${
    args.excludeSectionId
      ? sql`and source_section.id != ${args.excludeSectionId}`
      : sql``
  }
  `;
}

export function cloneCourseVersionItemsSql(args: {
  oldCourseVersionId: Sql;
  newCourseVersionId: Sql;
  excludeItemId?: Sql;
  excludeSectionId?: Sql;
}) {
  return sql`
    insert into db.training_course_section_items
      (training_course_section_id, sort_order,
       external_url, external_title,
       requires_essay, essay_prompt,
       content, type, other_course_id,
       training_assessment_id, source_item_id,
       source_template_item_id)
    select coalesce(
             (
               select new_section.id
               from db.training_course_sections new_section
               where new_section.training_course_version_id =
                   ${args.newCourseVersionId}
                 and new_section.source_section_id =
                   source_item.training_course_section_id
               limit 1
             ),
             (
               select new_section.id
               from db.training_course_sections new_section
               where new_section.training_course_version_id =
                 ${args.newCourseVersionId}
               order by new_section.ordinal, new_section.id
               limit 1
             )
           ),
           source_item.sort_order,
           source_item.external_url,
           source_item.external_title,
           source_item.requires_essay,
           source_item.essay_prompt,
           source_item.content,
           source_item.type,
           source_item.other_course_id,
           source_item.training_assessment_id,
           source_item.id,
           source_item.source_template_item_id
    from db.training_course_section_items source_item
    join db.training_course_sections source_section
      on source_section.id = source_item.training_course_section_id
    where source_section.training_course_version_id = ${args.oldCourseVersionId}
      ${
    args.excludeItemId
      ? sql`and source_item.id != ${args.excludeItemId}`
      : sql``
  }
      ${
    args.excludeSectionId
      ? sql`and source_item.training_course_section_id != ${args.excludeSectionId}`
      : sql``
  }
  `;
}

export function cloneCourseVersionItemDocumentsSql(args: {
  oldCourseVersionId: Sql;
  newCourseVersionId: Sql;
  excludeItemId?: Sql;
}) {
  return sql`
    insert into db.training_course_section_item_documents
      (training_course_section_item_id, document_id, sort_order, label)
    select new_item.id,
           doc.document_id,
           doc.sort_order,
           doc.label
    from db.training_course_section_item_documents doc
    join db.training_course_section_items old_item
      on old_item.id = doc.training_course_section_item_id
    join db.training_course_sections old_section
      on old_section.id = old_item.training_course_section_id
    join db.training_course_section_items new_item
      on new_item.source_item_id = old_item.id
    join db.training_course_sections new_section
      on new_section.id = new_item.training_course_section_id
     and new_section.training_course_version_id = ${args.newCourseVersionId}
    where old_section.training_course_version_id = ${args.oldCourseVersionId}
      and old_item.type != 'signature'
      ${
    args.excludeItemId ? sql`and old_item.id != ${args.excludeItemId}` : sql``
  }
      and not exists (
        select 1
        from db.training_course_section_item_documents existing
        where existing.training_course_section_item_id = new_item.id
          and existing.document_id = doc.document_id
      )
  `;
}

export function missingActiveVersionCountSql(courseId: Sql) {
  return sql`(
    select count(*)
    from db.training_expanded_course_items expanded
    join db.training_course_section_items i on i.id = expanded.item_id
    where expanded.root_course_id = ${courseId}
      and (
      (
        i.type = 'external_link'
        and nullif(trim(coalesce(i.external_url, '')), '') is null
      )
      or (
        i.type = 'other_checklist'
        and ${activeCourseVersionSql(sql`i.other_course_id`)} is null
      )
      or (
        i.type = 'assessment'
        and ${activeAssessmentVersionSql(sql`i.training_assessment_id`)} is null
      )
    )
  )`;
}
export function assignableCourseItemCountSql(courseId: Sql) {
  return sql`(
    select count(*)
    from db.training_expanded_course_items expanded
    join db.training_course_section_items i on i.id = expanded.item_id
    where expanded.root_course_id = ${courseId}
      and ${assignableCourseItemWhereSql()}
  )`;
}
export function activeVersionIdSql(
  documentId: Sql,
  language: Sql,
  opts: TrainingBlockOpts,
) {
  return activeVersionSql(
    opts,
    documentId,
    assignmentLanguageSql(opts, language),
  );
}

export function insertDocumentTasksForAssignmentBatchSql(args: {
  opts: TrainingBlockOpts;
  documentId: Sql;
  assignmentWhere: Sql;
  dueDate: Sql;
}) {
  return sql`
    insert into db.training_employee_tasks
      (training_assignment_id, document_version_id, due_date)
    select a.id,
           ${
    activeVersionIdSql(
      args.documentId,
      sql`a.training_language`,
      args.opts,
    )
  },
           ${args.dueDate}
    from db.training_assignments a
    where ${args.assignmentWhere}
      and a.document_id = ${args.documentId}
      and a.training_course_id is null
  `;
}

export function insertCourseTasksForAssignmentSql(args: {
  assignmentId: Sql;
  courseId: Sql;
  dueDate: Sql;
}) {
  return sql`
    insert into db.training_employee_tasks
      (training_assignment_id, training_course_section_item_id,
       parent_training_course_section_item_id, due_date)
    select ${args.assignmentId} as assignment_id_value,
           i.id as course_item_id_value,
           expanded.parent_item_id as parent_item_id_value,
           ${args.dueDate} as due_date_value
    from db.training_expanded_course_items expanded
    join db.training_course_section_items i on i.id = expanded.item_id
    join db.training_assignments assignment
      on assignment.id = ${args.assignmentId}
     and assignment.training_course_id = ${args.courseId}
     and assignment.document_id is null
    where expanded.root_course_id = ${args.courseId}
      and ${assignableCourseItemWhereSql()}
    order by expanded.section_ordinal, expanded.item_order_path
  `;
}

export function replaceOpenCourseAssignmentTasksSql(args: {
  courseId: Sql;
}) {
  return sql`
    update db.training_employee_tasks
    set status = 'waived'
    where training_assignment_id in (
        select a.id
        from db.training_assignments a
        where a.training_course_id = ${args.courseId}
          and a.document_id is null
          and a.status in ('pending', 'in_progress')
      )
      and status in ('assigned', 'in_progress')
  `;
}

export function cancelOpenAssessmentAttemptsForCourseAssignmentsSql(args: {
  courseId: Sql;
  cancelledById: Sql;
}) {
  return sql`
    update db.training_assessment_attempts
    set status = 'cancelled',
        outcome = null,
        cancelled_at = now(),
        cancelled_by_id = ${args.cancelledById}
    where status in ('in_progress', 'review_pending')
      and training_employee_task_id in (
        select task.id
        from db.training_employee_tasks task
        join db.training_assignments assignment
          on assignment.id = task.training_assignment_id
        where assignment.training_course_id = ${args.courseId}
          and assignment.document_id is null
          and assignment.status in ('pending', 'in_progress')
          and task.status in ('assigned', 'in_progress')
      )
  `;
}

/**
 * Keeps the inline recursive CTE instead of the
 * `training_expanded_course_items` view: it anchors on the explicitly
 * passed `newCourseVersionId`, which is not necessarily the course's
 * current published version pointer (the view only expands current
 * published versions).
 */
export function insertCurrentCourseAssignmentTasksSql(args: {
  courseId: Sql;
  newCourseVersionId: Sql;
}) {
  return sql`
    insert into db.training_employee_tasks
      (training_assignment_id, training_course_section_item_id,
       parent_training_course_section_item_id, due_date)
    with recursive ${
    expandedCourseItemsCteSql(
      sql`exists (
        select 1
        from db.training_course_sections current_section
        where current_section.id = i.training_course_section_id
          and current_section.training_course_version_id = ${args.newCourseVersionId}
      )`,
    )
  }
    select a.id as assignment_id_value,
           i.id as course_item_id_value,
           expanded.parent_item_id as parent_item_id_value,
           a.due_date as due_date_value
    from db.training_assignments a
    join expanded_items expanded on expanded.root_course_id = a.training_course_id
    join db.training_course_section_items i on i.id = expanded.item_id
    where a.training_course_id = ${args.courseId}
      and a.document_id is null
      and a.status in ('pending', 'in_progress')
      and ${assignableCourseItemWhereSql()}
      and not exists (
        select 1
        from db.training_employee_tasks existing
          where existing.training_assignment_id = a.id
            and existing.training_course_section_item_id = i.id
            and coalesce(existing.parent_training_course_section_item_id, 0) =
              coalesce(expanded.parent_item_id, 0)
            and existing.status in ('assigned', 'in_progress', 'completed')
      )
    order by a.id, expanded.section_ordinal, expanded.item_order_path
  `;
}
/**
 * System-waives open direct-document tasks superseded by a publication.
 * Runs after the controlled lifecycle has already moved the variant's
 * current revision pointer, so the pinned version is compared against the
 * freshly resolved revision for each assignment's language: any open task
 * pinned to a different revision is waived (evidence-free system waiver),
 * covering both same-language replacements and language-fallback moves.
 */
export function replaceOpenDocumentAssignmentTasksSql(args: {
  opts: TrainingBlockOpts;
  documentId: Sql;
  language: Sql;
  newDocumentVersionId: Sql;
}) {
  return sql`
    update db.training_employee_tasks
    set status = 'waived'
    where status in ('assigned', 'in_progress')
      and exists (
        select 1
        from db.training_assignments a
        where a.id = training_assignment_id
          and a.document_id = ${args.documentId}
          and a.training_course_id is null
          and a.status in ('pending', 'in_progress')
          and coalesce(document_version_id, 0) != coalesce(
            ${
    activeVersionSql(args.opts, args.documentId, sql`a.training_language`)
  },
            0
          )
      )
  `;
}

export function insertCurrentDocumentAssignmentTasksSql(args: {
  opts: TrainingBlockOpts;
  documentId: Sql;
  language: Sql;
  newDocumentVersionId: Sql;
}) {
  return sql`
    insert into db.training_employee_tasks
      (training_assignment_id, document_version_id, due_date)
    select a.id as assignment_id_value,
           ${args.newDocumentVersionId} as version_id_value,
           a.due_date as due_date_value
    from db.training_assignments a
    where a.document_id = ${args.documentId}
      and a.training_course_id is null
      and a.status in ('pending', 'in_progress')
      and ${
    activeVersionLanguageMatchesSql(
      args.newDocumentVersionId,
      sql`a.training_language`,
      args.opts,
    )
  }
      and not exists (
        select 1
        from db.training_employee_tasks existing
        where existing.training_assignment_id = a.id
          and existing.document_version_id = ${args.newDocumentVersionId}
          and existing.status in ('assigned', 'in_progress', 'completed')
      )
  `;
}

export function trainingCompletionAttestation(opts: TrainingBlockOpts) {
  return opts.completionAttestation ??
    "I acknowledge that I read and understand this controlled document.";
}

export function updateAssignmentStatusAfterTaskCompletionSql(args: {
  opts: TrainingBlockOpts;
  assignmentId: Sql;
}) {
  const validationLabels = trainingValidationLabels(args.opts);
  const secondaryByPermission = secondaryValidatorSignoffByPermission(
    args.opts,
  );
  return sql`
    update db.training_assignments
    set status = case
          when not exists (
            select 1
            from db.training_employee_tasks t
            where t.training_assignment_id = ${args.assignmentId}
              and t.status in ('assigned', 'in_progress')
          )
          then case
            when training_course_id is not null
              and exists (
                select 1
                from db.training_courses final_signature_course
                where final_signature_course.id = training_course_id
                  and final_signature_course.requires_final_signature
              )
              and employee_final_signed_at is null
            then 'in_progress'
            when training_course_id is not null
              and (
                (
                  final_primary_validator_id is not null
                  and not exists (
                    select 1
                    from db.training_assignment_validations av
                    where av.training_assignment_id = ${args.assignmentId}
                      and av.validation_stage_code = ${
    sql.lit(validationLabels.primaryStageCode)
  }
                  )
                )
                or (
                  ${
    secondaryByPermission
      ? sql`exists (
                    select 1
                    from db.training_courses secondary_validation_course
                    where secondary_validation_course.id = training_course_id
                      and secondary_validation_course.generates_certification
                  )`
      : sql`final_secondary_validator_id is not null`
  }
                  and not exists (
                    select 1
                    from db.training_assignment_validations av
                    where av.training_assignment_id = ${args.assignmentId}
                      and av.validation_stage_code = ${
    sql.lit(validationLabels.secondaryStageCode)
  }
                  )
                )
              )
            then 'validation_pending'
            else 'completed'
          end
          when status = 'pending' then 'in_progress'
          else status
        end
    where id = ${args.assignmentId}
  `;
}

export function updateAssignmentStatusAfterValidationSql(args: {
  opts: TrainingBlockOpts;
  assignmentId: Sql;
}) {
  const validationLabels = trainingValidationLabels(args.opts);
  const secondaryByPermission = secondaryValidatorSignoffByPermission(
    args.opts,
  );
  return sql`
    update db.training_assignments
    set status = case
          when status = 'validation_pending'
          and not exists (
            select 1
            from db.training_employee_tasks task
            where task.training_assignment_id = ${args.assignmentId}
              and task.status in ('assigned', 'in_progress')
          )
          and (
            training_course_id is null
            or not exists (
              select 1
              from db.training_courses final_signature_course
              where final_signature_course.id = training_course_id
                and final_signature_course.requires_final_signature
            )
            or employee_final_signed_at is not null
          )
          and (
            final_primary_validator_id is null
            or exists (
              select 1
              from db.training_assignment_validations primary_validation
              where primary_validation.training_assignment_id =
                ${args.assignmentId}
                and primary_validation.validation_stage_code =
                  ${sql.lit(validationLabels.primaryStageCode)}
            )
          )
          and (
            (${
    secondaryByPermission
      ? sql`not exists (
                select 1
                from db.training_courses secondary_validation_course
                where secondary_validation_course.id = training_course_id
                  and secondary_validation_course.generates_certification
              )`
      : sql`final_secondary_validator_id is null`
  })
            or exists (
              select 1
              from db.training_assignment_validations secondary_validation
              where secondary_validation.training_assignment_id =
                ${args.assignmentId}
                and secondary_validation.validation_stage_code =
                  ${sql.lit(validationLabels.secondaryStageCode)}
            )
          )
          then 'completed'
          else status
        end
    where id = ${args.assignmentId}
  `;
}

export function pendingAssignmentValidationWhereSql(
  opts: TrainingBlockOpts,
  assignment: Sql,
) {
  const validationLabels = trainingValidationLabels(opts);
  const secondaryByPermission = secondaryValidatorSignoffByPermission(opts);
  return sql`
    ${assignment}.status = 'validation_pending'
    and (
      (
        ${assignment}.training_course_id is not null
        and (
          (
            ${assignment}.final_primary_validator_id is not null
            and not exists (
              select 1
              from db.training_assignment_validations tm
              where tm.training_assignment_id = ${assignment}.id
                and tm.validation_stage_code = ${
    sql.lit(validationLabels.primaryStageCode)
  }
            )
          )
          or (
            ${
    secondaryByPermission
      ? sql`exists (
                select 1
                from db.training_courses secondary_validation_course
                where secondary_validation_course.id =
                  ${assignment}.training_course_id
                  and secondary_validation_course.generates_certification
              )`
      : sql`${assignment}.final_secondary_validator_id is not null`
  }
            and not exists (
              select 1
              from db.training_assignment_validations cm
              where cm.training_assignment_id = ${assignment}.id
                and cm.validation_stage_code = ${
    sql.lit(validationLabels.secondaryStageCode)
  }
            )
          )
        )
      )
    )
  `;
}

/**
 * Query behind the `training_assignment_validation_state` view: one row per
 * assignment matching {@link pendingAssignmentValidationWhereSql}, with a
 * flag per validation stage that is still missing its sign-off.
 */
export function assignmentValidationStateViewQuery(opts: TrainingBlockOpts) {
  const validationLabels = trainingValidationLabels(opts);
  const secondaryByPermission = secondaryValidatorSignoffByPermission(opts);
  return sql`
    select a.id as assignment_id,
           (
             a.final_primary_validator_id is not null
             and not exists (
               select 1
               from db.training_assignment_validations tm
               where tm.training_assignment_id = a.id
                 and tm.validation_stage_code = ${
    sql.lit(validationLabels.primaryStageCode)
  }
             )
           ) as needs_primary_validation,
           (
             ${
    secondaryByPermission
      ? sql`exists (
               select 1
               from db.training_courses secondary_validation_course
               where secondary_validation_course.id = a.training_course_id
                 and secondary_validation_course.generates_certification
             )`
      : sql`a.final_secondary_validator_id is not null`
  }
             and not exists (
               select 1
               from db.training_assignment_validations cm
               where cm.training_assignment_id = a.id
                 and cm.validation_stage_code = ${
    sql.lit(validationLabels.secondaryStageCode)
  }
             )
           ) as needs_secondary_validation
    from db.training_assignments a
    where ${pendingAssignmentValidationWhereSql(opts, sql`a`)}
  `;
}

/**
 * Query behind the `training_person_training_status` view: one row per
 * person with training rollup counts. The `cert_alert_count` column is
 * only present when the compliance feature is enabled.
 */
export function personTrainingStatusViewQuery(opts: TrainingBlockOpts) {
  return sql`
    select person.id as person_id,
           (select count(*)
            from db.training_assignments a
            where a.person_id = person.id
              and ${openTrainingAssignmentWhereSql(sql`a`)})
             as open_assignment_count,
           (select count(*)
            from db.training_employee_tasks t
            join db.training_assignments task_assignment
              on task_assignment.id = t.training_assignment_id
            where task_assignment.person_id = person.id
              and t.status in ('assigned', 'in_progress')) as open_task_count,
           (select count(*)
            from db.training_employee_tasks t
            join db.training_assignments task_assignment
              on task_assignment.id = t.training_assignment_id
            where task_assignment.person_id = person.id
              and t.status in ('assigned', 'in_progress')
              and t.due_date is not null
              and t.due_date < current_date()) as overdue_task_count,
           (select count(*)
            from db.training_employee_tasks t
            join db.training_assignments task_assignment
              on task_assignment.id = t.training_assignment_id
            where task_assignment.person_id = person.id
              and t.status = 'completed') as completed_task_count,
           (select count(*)
            from db.training_assignments a
            where a.person_id = person.id
              and ${completedTrainingAssignmentWhereSql(sql`a`)})
             as completed_assignment_count,
           (select count(*)
            from db.training_assignments a
            where a.person_id = person.id
              and ${
    pendingAssignmentValidationWhereSql(opts, sql`a`)
  }) as pending_validation_count,
           (select max(t.completed_at)
            from db.training_employee_tasks t
            join db.training_assignments task_assignment
              on task_assignment.id = t.training_assignment_id
            where task_assignment.person_id = person.id
              and ${completedTrainingAssignmentWhereSql(sql`task_assignment`)}
              and t.status = 'completed') as last_completion_at${
    trainingFeatureEnabled(opts, "compliance")
      ? sql`,
           (select count(*)
            from db.training_certifications c
            where c.person_id = person.id
              and ${
        certificationAlertWhereSql(opts, sql`c`)
      }) as cert_alert_count`
      : sql``
  }
    from db.${sql.ref(personTable(opts))} person
  `;
}

function htmlTextSql(value: Sql) {
  return sql`
    replace(
      replace(
        replace(coalesce(${value}, ''), '&', '&amp;'),
        '<',
        '&lt;'
      ),
      '>',
      '&gt;'
    )
  `;
}

function htmlAttrSql(value: Sql) {
  return sql`replace(${htmlTextSql(value)}, '"', '&quot;')`;
}

export function certificationTemplateOrganizationNameSql(
  opts: TrainingBlockOpts,
  fallback: Sql,
) {
  return opts.certificationTemplate?.organizationName
    ? sql.lit(opts.certificationTemplate.organizationName)
    : fallback;
}

export function certificationTemplateApprovalLabelSql(
  opts: TrainingBlockOpts,
  fallback: Sql,
) {
  return opts.certificationTemplate?.approvalLabel
    ? sql.lit(opts.certificationTemplate.approvalLabel)
    : fallback;
}

export function certificationTemplateLogoPathSql(opts: TrainingBlockOpts) {
  return opts.certificationTemplate?.logoPath
    ? sql.lit(opts.certificationTemplate.logoPath)
    : undefined;
}

export function certificationTemplateSealPathSql(opts: TrainingBlockOpts) {
  return opts.certificationTemplate?.sealPath
    ? sql.lit(opts.certificationTemplate.sealPath)
    : undefined;
}

function certificationExpiresAtSql(course: Sql) {
  return sql`
    case
      when ${course}.certification_expires_after_days is null
        then null
      else date.add(
        day,
        ${course}.certification_expires_after_days,
        current_date()
      )
    end
  `;
}

export function generatedCertificateHtmlSql(args: {
  employeeName: Sql;
  courseName: Sql;
  issuedAt: Sql;
  organizationName: Sql;
  approvalLabel: Sql;
  logoPath?: Sql;
  sealPath?: Sql;
}) {
  return sql`
    '<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Training Certificate</title>
  <style>
    @page { size: letter landscape; margin: 0.25in; }
    * { box-sizing: border-box; }
    html,
    body {
      margin: 0;
      min-height: 100%;
      font-family: Arial, Helvetica, sans-serif;
      color: #111;
      background: #fff;
    }
    .certificate {
      position: relative;
      width: 9.5in;
      min-height: 6.55in;
      border: 3px solid #111;
      background: #fff;
      padding: 0.08in 0.55in 0.3in;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      margin: 0 auto;
    }
    .date {
      position: absolute;
      top: 0.18in;
      right: 0.15in;
      font-family: Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif;
      font-size: 20px;
      font-weight: 700;
      line-height: 1;
    }
    .seal {
      position: absolute;
      top: 0.75in;
      left: 1.0in;
      width: 1.48in;
      height: 1.48in;
      object-fit: contain;
      transform: rotate(-9deg);
    }
    .logo-lockup {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-top: 0.12in;
      margin-bottom: 0.22in;
      min-height: 1.33in;
    }
    .logo {
      width: 2.42in;
      height: auto;
      object-fit: contain;
    }
    .eyebrow {
      font-family: "Times New Roman", Times, serif;
      font-size: 38px;
      font-weight: 700;
      letter-spacing: 0;
      line-height: 1.1;
    }
    h1 {
      margin: 0.1in 0 0;
      font-family: "Times New Roman", Times, serif;
      font-size: 37px;
      line-height: 1;
      letter-spacing: 0;
    }
    .title-rule {
      width: 6.5in;
      border-top: 3px solid #111;
      margin: 0.1in 0 0.18in;
    }
    .body {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.18;
    }
    .employee {
      margin: 0.12in 0 0.1in;
      font-size: 40px;
      font-weight: 700;
      line-height: 1;
    }
    .course {
      margin: 0.1in 0 0;
      font-size: 31px;
      font-weight: 700;
      line-height: 1;
    }
    .approval {
      margin-top: 0.52in;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.15;
    }
    @media screen {
      body { padding: 24px; }
      .certificate {
        box-shadow: 0 16px 50px rgba(31, 41, 51, 0.18);
      }
    }
  </style>
</head>
<body>
  <main class="certificate">
    <div class="date">Date: ' || ${
    htmlTextSql(formatDateSql(args.issuedAt))
  } || '</div>
    ' || ${
    args.sealPath
      ? sql`'<img class="seal" src="' || ${
        htmlAttrSql(args.sealPath)
      } || '" alt="">'`
      : sql`''`
  } || '
    <div class="logo-lockup">
    ' || ${
    args.logoPath
      ? sql`'<img class="logo" src="' || ${
        htmlAttrSql(args.logoPath)
      } || '" alt="">'`
      : sql`'<div class="logo"></div>'`
  } || '
    </div>
    <div class="eyebrow">TRAINING</div>
    <h1>CERTIFICATE OF COMPLETION</h1>
    <div class="title-rule"></div>
    <div class="body">This certifies that</div>
    <div class="employee">' || ${htmlTextSql(args.employeeName)} || '</div>
    <div class="body">has successfully completed the ' || ${
    htmlTextSql(args.organizationName)
  } || ':</div>
    <div class="course">' || ${htmlTextSql(args.courseName)} || '</div>
    <div class="approval">Approved by the ' || ${
    htmlTextSql(args.approvalLabel)
  } || '</div>
  </main>
</body>
</html>'
  `;
}

export function insertCertificationsForCompletedAssignmentsSql(args: {
  opts: TrainingBlockOpts;
  assignmentWhere: Sql;
}) {
  return sql`
    insert into db.training_certifications
      (person_id, training_assignment_id, training_course_id, name,
       issued_at, expires_at, issuing_authority, source, approval_status,
       approved_by_id, approved_at)
    select a.person_id as person_id_value,
           a.id as assignment_id_value,
           c.id as course_id_value,
           c.name as course_name_value,
           current_date(),
           ${certificationExpiresAtSql(sql`c`)},
           ${
    certificationTemplateOrganizationNameSql(
      args.opts,
      sql.lit`Training`,
    )
  },
           'training_course_completion',
           'approved',
           a.final_secondary_validator_id,
           now()
    from db.training_assignments a
    join db.training_courses c on c.id = a.training_course_id
    where ${args.assignmentWhere}
      and a.status = 'completed'
      and c.generates_certification
      and not exists (
        select 1
        from db.training_certifications existing
        where existing.training_assignment_id = a.id
      )
  `;
}

export function createCertificationForCompletedAssignment<
  T extends IServerBaseStatements,
>(
  s: T,
  args: { opts: TrainingBlockOpts; assignmentId: Sql },
) {
  if (!trainingFeatureEnabled(args.opts, "compliance")) {
    return;
  }
  s.startTransaction();
  s.modify(insertCertificationsForCompletedAssignmentsSql({
    opts: args.opts,
    assignmentWhere: sql`a.id = ${args.assignmentId}`,
  }));
  s.commitTransaction();
}

/**
 * Pins the documents linked to a course step onto its tasks: resolves the
 * active published version (preferring the assignment language, then the
 * default language) and snapshots it into `training_task_item_documents`.
 * Idempotent per (task, item document); documents without a published
 * version are skipped and picked up by the publish rollout later.
 * `taskWhere` filters `db.training_employee_tasks` under the alias `t`.
 */
export function insertTaskItemDocumentSnapshotsSql(
  opts: TrainingBlockOpts,
  taskWhere: Sql,
) {
  const resolvedVersionId = opts.content
    .resolveCourseSupportingDocumentVersion({
      documentId: sql`item_doc.document_id`,
      assignmentLanguage: sql`task_assignment.training_language`,
    });
  return sql`
    insert into db.training_task_item_documents
      (training_employee_task_id, training_course_section_item_document_id,
       document_version_id)
    select t.id as task_id_value,
           item_doc.id as item_document_id_value,
           ${resolvedVersionId} as version_id_value
    from db.training_employee_tasks t
    join db.training_assignments task_assignment
      on task_assignment.id = t.training_assignment_id
    join db.training_course_section_item_documents item_doc
      on item_doc.training_course_section_item_id =
        t.training_course_section_item_id
    join db.training_course_section_items item
      on item.id = t.training_course_section_item_id
    where ${taskWhere}
      and item.type != 'signature'
      and ${resolvedVersionId} is not null
      and not exists (
        select 1
        from db.training_task_item_documents existing
        where existing.training_employee_task_id = t.id
          and existing.training_course_section_item_document_id = item_doc.id
      )
    order by t.id, item_doc.sort_order, item_doc.id
  `;
}

/**
 * Re-pins open course-step tasks onto a freshly published document version.
 * Completed tasks keep the version they were signed against.
 */
export function replaceOpenTaskItemDocumentVersionsSql(args: {
  opts: TrainingBlockOpts;
  documentId: Sql;
  newDocumentVersionId: Sql;
}) {
  return sql`
    update db.training_task_item_documents
    set document_version_id = ${args.newDocumentVersionId}
    where exists (
        select 1
        from db.training_course_section_item_documents source_document
        where source_document.id =
          training_course_section_item_document_id
          and source_document.document_id = ${args.documentId}
      )
      and document_version_id != ${args.newDocumentVersionId}
      and exists (
        select 1
        from db.training_employee_tasks task
        join db.training_assignments assignment
          on assignment.id = task.training_assignment_id
        where task.id = training_employee_task_id
          and task.status in ('assigned', 'in_progress')
          and ${
    args.opts.content.resolveCourseSupportingDocumentVersion({
      documentId: args.documentId,
      assignmentLanguage: sql`assignment.training_language`,
    })
  } = ${args.newDocumentVersionId}
      )
  `;
}

export function insertTrainingAccessTokensForAssignmentsSql(args: {
  opts: TrainingBlockOpts;
  assignmentWhere: Sql;
  createdById: Sql;
  expiresAt?: Sql;
}) {
  if (!trainingFeatureEnabled(args.opts, "inviteAccess")) {
    return sql``;
  }
  return sql`
    insert into db.training_access_tokens
      (token, training_assignment_id, expires_at, created_by_id)
    select random.uuid(),
           a.id,
           ${args.expiresAt ?? sql`date.add(day, 30, now())`},
           ${args.createdById}
    from db.training_assignments a
    where ${args.assignmentWhere}
      and not exists (
        select 1
        from db.training_access_tokens existing
        where existing.training_assignment_id = a.id
          and existing.revoked_at is null
          and existing.expires_at > now()
      )
  `;
}

export function revokeTrainingAccessTokensForClosedAssignmentSql(args: {
  opts: TrainingBlockOpts;
  assignmentId: Sql;
}) {
  if (!trainingFeatureEnabled(args.opts, "inviteAccess")) {
    return sql``;
  }
  return sql`
    update db.training_access_tokens
    set revoked_at = now()
    where training_assignment_id = ${args.assignmentId}
      and revoked_at is null
      and exists (
        select 1
        from db.training_assignments assignment
        where assignment.id = ${args.assignmentId}
          and not ${openTrainingAssignmentWhereSql(sql`assignment`)}
      )
  `;
}
/**
 * Statements that finish creating assignments after the assignment and task
 * rows exist: pin course-step document versions and mint portal access tokens.
 * Apply with one `s.modify` per statement.
 *
 * `assignmentWhere` filters `db.training_assignments` under the alias `a`.
 */
export function finalizeNewAssignmentsSql(args: {
  opts: TrainingBlockOpts;
  assignmentWhere: Sql;
  actorId: Sql;
}): Sql[] {
  const taskWhere = sql`t.training_assignment_id in (
    select a.id
    from db.training_assignments a
    where ${args.assignmentWhere}
  )`;
  const statements = [
    insertTaskItemDocumentSnapshotsSql(args.opts, taskWhere),
  ];
  if (trainingFeatureEnabled(args.opts, "inviteAccess")) {
    statements.push(insertTrainingAccessTokensForAssignmentsSql({
      opts: args.opts,
      assignmentWhere: args.assignmentWhere,
      createdById: args.actorId,
    }));
  }
  return statements;
}

/**
 * Full login-free invite URL for an assignment's active access token, or
 * null when no valid token (or no access domain) exists. The link uses the
 * configured `accessDomain`, the access portal app.
 */
export function assignmentInviteLinkSql(
  opts: TrainingBlockOpts,
  assignmentId: Sql,
) {
  const domain = opts.accessDomain;
  if (!domain || !trainingFeatureEnabled(opts, "inviteAccess")) {
    return sql`cast(null as string)`;
  }
  const basePath = opts.routes?.accessBasePath ?? "/training";
  return sql`(
    select ${sql.lit`https://${domain}${basePath}/invite/`} || token.token
    from db.training_access_tokens token
    join db.training_assignments assignment
      on assignment.id = token.training_assignment_id
    where token.training_assignment_id = ${assignmentId}
      and token.revoked_at is null
      and token.expires_at > now()
      and ${openTrainingAssignmentWhereSql(sql`assignment`)}
    order by token.id
    limit 1
  )`;
}

export function personLanguageSql(
  opts: TrainingBlockOpts,
  employee: Sql,
) {
  return workforceProvider(opts).personLanguage?.(employee) ?? sql.lit`en`;
}

// Fallbacks are typed string nulls so expressions like
// `coalesce(<accessor>, '-')` still compile when a provider omits the
// accessor.
const nullString = sql`cast(null as string)`;

export function personEmailSql(opts: TrainingBlockOpts, person: Sql) {
  return workforceProvider(opts).personEmail?.(person) ?? nullString;
}

// Worker type comes from the person's active worker relationship.
export function personTypeSql(opts: TrainingBlockOpts, person: Sql) {
  return workforceProvider(opts).personWorkerType?.(person) ?? nullString;
}

// "Status" facets resolve against the active relationship/assignment.
export function personStatusSql(opts: TrainingBlockOpts, person: Sql) {
  return workforceProvider(opts).personRelationshipStatus?.(person) ??
    nullString;
}

export function personAssignmentStatusSql(
  opts: TrainingBlockOpts,
  person: Sql,
) {
  return workforceProvider(opts).personPrimaryAssignmentStatus?.(person) ??
    nullString;
}

export function personPrimaryJobProfileSql(
  opts: TrainingBlockOpts,
  person: Sql,
) {
  return workforceProvider(opts).personPrimaryJobProfileDisplay?.(person) ??
    nullString;
}

export function audienceMatchesEmployeeSql(
  opts: TrainingBlockOpts,
  audience: Sql,
  employee: Sql,
) {
  return workforceProvider(opts).audienceMatchSql({
    audienceRecord: audience,
    personRecord: employee,
  });
}

/** Formats a date expression with the training date format. */
export function formatDateSql(expr: Sql) {
  return sql`format.date(${expr}, ${sql.lit("%m/%d/%Y")})`;
}

/** Formats a timestamp expression with the training timestamp format. */
export function formatDateTimeSql(expr: Sql) {
  return sql`format.date(${expr}, ${sql.lit("%m/%d/%Y %-I:%M%P")})`;
}

export function employeeText(
  language: Sql,
  variants: { en: string } & Record<string, string>,
) {
  const branches = Object.entries(variants).filter(([code]) => code !== "en");
  if (branches.length === 0) {
    return sql.lit(variants.en);
  }
  let expr = sql`case`;
  for (const [code, text] of branches) {
    expr = sql`${expr} when ${language} = ${sql.lit(code)} then ${
      sql.lit(text)
    }`;
  }
  return sql`(${expr} else ${sql.lit(variants.en)} end)`;
}

/**
 * Localized relative due-date phrase: "Overdue by N days", "Due today",
 * "Due tomorrow", "Due in N days", or "Due <date>" for far-out dates.
 * Returns null when the due date is null.
 */
export function relativeDueSql(language: Sql, dueDate: Sql) {
  const days = sql`date.diff(day, current_date(), ${dueDate})`;
  return sql`case
    when ${dueDate} is null then null
    when ${days} < 0 then ${
    employeeText(language, { en: "Overdue by ", es: "Atrasada por " })
  } || abs(${days})::string || case when abs(${days}) = 1 then ${
    employeeText(language, { en: " day", es: " día" })
  } else ${employeeText(language, { en: " days", es: " días" })} end
    when ${days} = 0 then ${
    employeeText(language, { en: "Due today", es: "Vence hoy" })
  }
    when ${days} = 1 then ${
    employeeText(language, { en: "Due tomorrow", es: "Vence mañana" })
  }
    when ${days} <= 14 then ${
    employeeText(language, { en: "Due in ", es: "Vence en " })
  } || ${days}::string || ${
    employeeText(language, { en: " days", es: " días" })
  }
    else ${employeeText(language, { en: "Due ", es: "Vence el " })} ||
      ${formatDateSql(dueDate)}
  end`;
}

export function versionStatusChip(status: Sql) {
  return (
    <StatusChip
      fallbackLabel={status}
      cases={[
        {
          when: sql`${status} = 'published'`,
          label: "Published",
          color: "success",
        },
        { when: sql`${status} = 'draft'`, label: "Draft", color: "neutral" },
        {
          when: sql`${status} = 'archived'`,
          label: "Retired",
          color: "warning",
        },
      ]}
    />
  );
}
