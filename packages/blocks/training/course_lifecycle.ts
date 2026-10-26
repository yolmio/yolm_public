import { currentUserHasPermission } from "blocks/auth";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import { trainingFeatureEnabled, trainingPermissions } from "./helpers";
import type { TrainingBlockOpts } from "./types";

/** Explain why deleting a course would remove or break training history. */
export function courseDeletionBlockerSql(
  opts: TrainingBlockOpts,
  courseId: Sql,
) {
  return sql`case
    when not exists (select 1 from db.training_courses where id = ${courseId})
      then 'This course no longer exists.'
    when exists (select 1 from db.training_translation_reviews r join db.training_course_versions v on v.id = r.training_course_version_id where v.training_course_id = ${courseId})
      then 'This course has translation review history. Archive it instead.'
    when exists (select 1 from db.training_assignments where training_course_id = ${courseId})
      then 'This course has been assigned before. Archive it instead.'
    when exists (
      select 1 from db.training_employee_tasks task
      join db.training_course_section_items item
        on item.id = task.training_course_section_item_id
      join db.training_course_sections section on section.id = item.training_course_section_id
      join db.training_course_versions version on version.id = section.training_course_version_id
      where version.training_course_id = ${courseId}
    ) then 'Steps from this course have been assigned through a program. Archive it instead.'
    when exists (
      select 1 from db.training_course_section_items item
      join db.training_course_sections section on section.id = item.training_course_section_id
      join db.training_course_versions version on version.id = section.training_course_version_id
      where item.other_course_id = ${courseId} and version.training_course_id != ${courseId}
    ) then 'Another course or program links to this course. Remove that link before deleting, or archive this course.'
    when exists (select 1 from db.training_course_section_template_items where training_course_id = ${courseId})
      then 'A stored section links to this course. Remove that link before deleting, or archive this course.'
    ${
    trainingFeatureEnabled(opts, "compliance")
      ? sql`when exists (select 1 from db.training_certifications where training_course_id = ${courseId})
          or exists (select 1 from db.training_retraining_cases where training_course_id = ${courseId})
        then 'This course is linked to training history. Archive it instead.'`
      : sql``
  }
    else cast(null as string)
  end`;
}

/** Course lifecycle commands recheck permissions and history inside their transaction. */
export function registerCourseLifecycleStoredProcedures(
  opts: TrainingBlockOpts,
) {
  system.storedProcedure({
    name: "training_set_course_active",
    transaction: "standalone",
    inputScalars: [
      { name: "p_course_id", type: "BigInt" },
      { name: "p_is_active", type: "Bool" },
    ],
    procedure: (s) => {
      s.startTransaction();
      s.throwErrorIf(
        sql`not coalesce(${
          currentUserHasPermission(sql.lit(trainingPermissions.manageLibrary))
        }, false)`,
        sql.lit`You do not have permission to manage courses.`,
      );
      s.throwErrorIf(
        sql`p_is_active is null`,
        sql.lit`Choose whether to archive or restore this course.`,
      );
      s.throwErrorIf(
        sql`not exists (select 1 from db.training_courses where id = p_course_id)`,
        sql.lit`This course no longer exists.`,
      );
      s.modify(
        sql`update db.training_courses set is_active = p_is_active where id = p_course_id`,
      );
      s.commitTransaction();
    },
  });
  system.storedProcedure({
    name: "training_delete_course",
    transaction: "standalone",
    inputScalars: [{ name: "p_course_id", type: "BigInt" }],
    procedure: (s) => {
      s.startTransaction();
      s.throwErrorIf(
        sql`not coalesce(${
          currentUserHasPermission(sql.lit(trainingPermissions.manageLibrary))
        }, false)`,
        sql.lit`You do not have permission to manage courses.`,
      );
      s.defScalar(
        "delete_course_id",
        sql`(select id from db.training_courses where id = p_course_id)`,
      );
      s.defScalar(
        "delete_blocker",
        courseDeletionBlockerSql(opts, sql`delete_course_id`),
      );
      s.throwErrorIf(sql`delete_blocker is not null`, sql`delete_blocker`);
      s.defTable(
        "delete_versions",
        sql`select id from db.training_course_versions where training_course_id = delete_course_id`,
      );
      s.defTable(
        "delete_sections",
        sql`select id from db.training_course_sections where training_course_version_id in (select id from delete_versions)`,
      );
      s.defTable(
        "delete_items",
        sql`select id from db.training_course_section_items where training_course_section_id in (select id from delete_sections)`,
      );
      s.modify(
        sql`delete from db.training_course_section_item_documents where training_course_section_item_id in (select id from delete_items)`,
      );
      s.modify(
        sql`delete from db.training_course_section_items where id in (select id from delete_items)`,
      );
      s.modify(
        sql`delete from db.training_course_sections where id in (select id from delete_sections)`,
      );
      s.modify(
        sql`update db.training_courses set current_training_course_version_id = null where id = delete_course_id`,
      );
      // Translations reference their source version of the same course.
      s.modify(
        sql`update db.training_course_versions set source_version_id = null where id in (select id from delete_versions) and source_version_id is not null`,
      );
      s.modify(
        sql`delete from db.training_course_versions where id in (select id from delete_versions)`,
      );
      s.modify(
        sql`delete from db.training_requirement_audiences where training_requirement_id in (select id from db.training_requirements where training_course_id = delete_course_id)`,
      );
      s.modify(
        sql`delete from db.training_requirements where training_course_id = delete_course_id`,
      );
      s.modify(
        sql`delete from db.training_courses where id = delete_course_id`,
      );
      s.commitTransaction();
    },
  });
}
