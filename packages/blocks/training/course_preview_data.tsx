import { currentUserHasPermission } from "blocks/auth";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { StateStatements } from "std/statements";
import type { TrainingBlock } from "./index.tsx";
import {
  activeCourseVersionSql,
  expandedCourseItemsCteSql,
  trainingPermissions,
} from "./helpers";

/** Read course content once; all progress belongs to this mounted UI only. */
export function defineCoursePreview(
  s: StateStatements,
  block: TrainingBlock,
  courseId: Sql,
) {
  s.defRecord(
    "preview_course",
    sql`
    select preview_source.id, preview_source.name, preview_source.requires_final_signature, preview_source.generates_certification,
      coalesce((select v.id from db.training_course_versions v
        where v.training_course_id = preview_source.id and v.status = 'draft' and v.language = ui.preview_language
        order by v.created_at desc, v.id desc limit 1),
        ${
      activeCourseVersionSql(
        sql`preview_source.id`,
        sql`ui.preview_language`,
        true,
      )
    }) as version_id
    from db.training_courses preview_source
    where preview_source.id = ${courseId}
      and ${
      currentUserHasPermission(sql.lit(trainingPermissions.manageLibrary))
    }
  `,
  );
  s.defScalar(
    "preview_version_label",
    sql`(
    select case when status = 'draft' then 'Draft' else version_label end
    from db.training_course_versions where id = preview_course.version_id
  )`,
  );
  s.defTable(
    "preview_items",
    sql`
    with recursive ${
      expandedCourseItemsCteSql(
        sql`version.id = preview_course.version_id`,
        sql`ui.preview_language`,
      )
    }
    select row_number() over (order by expanded.section_ordinal, expanded.item_order_path) as preview_id,
      i.*, section.name as section_name, section.description as section_description,
      section.training_course_version_id as section_version_id,
      (select introduction from db.training_course_versions where id = section.training_course_version_id and training_course_id != preview_course.id) as nested_introduction,
      (select coalesce(v.localized_name, c.name) from db.training_courses c join db.training_course_versions v on v.training_course_id = c.id where v.id = section.training_course_version_id) as nested_course_name,
      expanded.section_ordinal, expanded.item_order_path, expanded.course_path,
      expanded.depth
    from expanded_items expanded
    join db.training_course_section_items i on i.id = expanded.item_id
    join db.training_course_sections section on section.id = i.training_course_section_id
    order by expanded.section_ordinal, expanded.item_order_path
  `,
  );
  s.defTable(
    "course_tasks",
    sql`
    select preview_id as id, preview_id as task_id, id as course_item_id,
      training_assessment_id, 'assigned'::string as status,
      training_course_section_id as section_id, section_name, section_description,
      section_version_id, nested_introduction, nested_course_name,
      section_ordinal, preview_id as item_ordinal,
      coalesce(external_title, content) as title,
      case type when 'external_link' then 'External link'
        when 'essay' then 'Essay' when 'signature' then 'Signature'
        when 'assessment' then 'Assessment' else 'Practical' end as kind,
      type as item_type, 'not_started'::string as assessment_state,
      coalesce(requires_essay, false) or type = 'essay' as requires_essay,
      essay_prompt, cast(null as string) as essay_response, false as response_dirty,
      cast(null as string) as signature_name, cast(null as string) as signature_data,
      external_url
    from preview_items where type != 'other_checklist'
    order by section_ordinal, item_order_path
  `,
  );
  s.defRecord(
    "course_assignment",
    sql`
    select id, coalesce((select localized_name from db.training_course_versions where id = preview_course.version_id), name) as title, requires_final_signature, generates_certification,
      (select introduction from db.training_course_versions where id = preview_course.version_id) as introduction,
      'in_progress'::string as status, ui.preview_language as employee_language,
      cast(null as date) as due_date,
      (select count(*) from course_tasks) as total_tasks, 0::bigint as done_tasks,
      cast(null as bigint) as final_primary_validator_id,
      cast(null as bigint) as final_secondary_validator_id,
      cast(null as string) as final_primary_validator_name,
      cast(null as string) as final_secondary_validator_name,
      cast(null as string) as employee_final_signature_data,
      cast(null as timestamp) as employee_final_signed_at,
      false as primary_validator_validated, false as secondary_validator_validated,
      false as current_user_is_primary_validator, false as current_user_is_secondary_validator
    from preview_course
  `,
  );
  s.defTable(
    "course_task_item_documents",
    sql`
    select doc.id, task.id as training_employee_task_id, doc.document_id,
      coalesce(doc.label, document.title) as title,
      revision.file_version_id, revision.id as document_version_id,
      variant.language
    from course_tasks task
    join db.training_course_section_item_documents doc on doc.training_course_section_item_id = task.course_item_id
    join db.training_content_documents document on document.id = doc.document_id
    left join db.controlled_file_revisions revision on revision.id = ${
      block.opts.content.resolveCourseSupportingDocumentVersion({
        documentId: sql`doc.document_id`,
        assignmentLanguage: sql`ui.preview_language`,
      })
    }
    left join db.controlled_file_language_variants variant on variant.id = revision.controlled_file_language_variant_id
    where task.item_type != 'signature'
    order by task.id, doc.sort_order, doc.id
  `,
  );
  s.defTable(
    "preview_issues",
    sql`
    select 'This course has no steps yet.' as issue
    where not exists (select 1 from course_tasks)
    union
    select 'Linked course "' || coalesce(preview_source.name, 'Unknown course') || '" has no published version.'
    from preview_items i left join db.training_courses preview_source on preview_source.id = i.other_course_id
    where i.type = 'other_checklist' and ${
      activeCourseVersionSql(sql`preview_source.id`, sql`ui.preview_language`)
    } is null
    union
    select 'A linked course contains a circular reference or exceeds the nesting limit.'
    from preview_items i
    where i.type = 'other_checklist' and
      (i.depth >= 50 or i.course_path like '%,' || i.other_course_id::string || ',%')
    union
    select 'Linked course "' || preview_source.name || '" uses its published version; its draft changes are not included.'
    from preview_items i join db.training_courses preview_source on preview_source.id = i.other_course_id
    where i.type = 'other_checklist' and ${
      activeCourseVersionSql(sql`preview_source.id`, sql`ui.preview_language`)
    } is not null and exists (
      select 1 from db.training_course_versions v where v.training_course_id = preview_source.id and v.status = 'draft' and v.language = ui.preview_language)
    union
    select 'Step "' || title || '" is missing its external link.'
    from course_tasks where item_type = 'external_link' and nullif(trim(external_url), '') is null
  `,
  );
}
