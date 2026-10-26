import {
  AuthBlock,
  currentUserHasPermission,
  userHasPermission,
} from "blocks/auth";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import type { EndpointStatements } from "std/statements";
import type { TrainingBlockOpts } from "./types";
import {
  openTrainingAssignmentWhereSql,
  personTable,
  trainingFeatureEnabled,
  trainingPermissions,
} from "./helpers";

export const introductionImagePrefix = "/api/training/introduction-images/";

export function introductionHasContentSql(content: Sql) {
  return sql`coalesce(trim(lexical_rich_text_to_plain_text(${content})), '') != ''
    or coalesce(json_array_length(lexical_extract_nodes(${content}, 'image')), 0) > 0`;
}

/** Compare authored steps, using the draft's clone keys instead of new row IDs. */
export function courseDraftStepsUnchangedSql(draftId: Sql, sourceId: Sql) {
  const sectionFields =
    sql`name, description, ordinal, training_course_section_template_id`;
  const itemFields = sql`type, content, other_course_id, training_assessment_id,
    external_url, external_title, sort_order, requires_essay, essay_prompt, source_template_item_id`;
  const sections = (draft: boolean) =>
    sql`select ${draft ? sql`source_section_id` : sql`id`}, ${sectionFields}
    from db.training_course_sections where training_course_version_id = ${
      draft ? draftId : sourceId
    }`;
  const items = (draft: boolean) =>
    sql`select ${
      draft
        ? sql`i.source_item_id as item_id, s.source_section_id as section_id`
        : sql`i.id as item_id, s.id as section_id`
    }, ${itemFields}
    from db.training_course_section_items i join db.training_course_sections s on s.id = i.training_course_section_id
    where s.training_course_version_id = ${draft ? draftId : sourceId}`;
  const documents = (draft: boolean) =>
    sql`select ${
      draft ? sql`i.source_item_id` : sql`i.id`
    }, d.document_id, d.sort_order, d.label
    from db.training_course_section_item_documents d
    join db.training_course_section_items i on i.id = d.training_course_section_item_id
    join db.training_course_sections s on s.id = i.training_course_section_id
    where s.training_course_version_id = ${draft ? draftId : sourceId}`;
  return sql`${sourceId} is not null
    and not exists (${sections(true)} except ${sections(false)})
    and not exists (${sections(false)} except ${sections(true)})
    and not exists (${items(true)} except ${items(false)})
    and not exists (${items(false)} except ${items(true)})
    and not exists (${documents(true)} except ${documents(false)})
    and not exists (${documents(false)} except ${documents(true)})`;
}

export function registerCourseIntroductionProcedures(opts: TrainingBlockOpts) {
  system.storedProcedure({
    name: "training_save_course_introduction",
    transaction: "caller",
    inputScalars: [{ name: "p_course_id", type: "BigInt" }, {
      name: "p_introduction",
      type: "Json",
    }, { name: "p_previous_introduction", type: "Json" }],
    procedure: (s) =>
      s.callStoredProcedure("training_save_course_introduction_language", {
        inputScalars: {
          p_course_id: sql`p_course_id`,
          p_introduction: sql`p_introduction`,
          p_previous_introduction: sql`p_previous_introduction`,
          p_language: sql.lit(opts.content.opts.defaultLanguage),
        },
      }),
  });

  system.storedProcedure({
    name: "training_save_course_introduction_language",
    transaction: "caller",
    inputScalars: [
      { name: "p_course_id", type: "BigInt" },
      { name: "p_language", type: { type: "String", maxLength: 20 } },
      { name: "p_introduction", type: "Json" },
      { name: "p_previous_introduction", type: "Json" },
    ],
    procedure: (s) => {
      if (!trainingFeatureEnabled(opts, "courseIntroduction")) {
        s.throwError(
          sql.lit`Course introductions are disabled for this system.`,
        );
        return;
      }
      s.throwErrorUnless(
        currentUserHasPermission(sql.lit(trainingPermissions.manageLibrary)),
        sql.lit`You do not have permission to edit courses.`,
      );
      s.throwErrorUnless(
        sql`exists (select 1 from db.training_courses where id = p_course_id)`,
        sql.lit`This course no longer exists.`,
      );
      s.throwErrorIf(
        sql`length(p_introduction::string) > 1000000`,
        sql.lit`The introduction is too large.`,
      );
      s.callStoredProcedure("training_ensure_course_draft_language", {
        inputScalars: {
          p_course_id: sql`p_course_id`,
          p_language: sql`p_language`,
          p_source_version: sql`null`,
        },
        outputScalars: {
          draft_course_version_id: "introduction_draft_id",
          source_course_version_id: "introduction_source_id",
        },
      });
      s.throwErrorUnless(
        sql`coalesce((select introduction::string from db.training_course_versions where id = introduction_draft_id), 'null') = coalesce(p_previous_introduction::string, 'null')`,
        sql
          .lit`The introduction changed while you were editing. Cancel and reopen it to load the latest content.`,
      );
      s.throwErrorIf(
        sql`exists (
        select 1 from json.array_each(lexical_extract_nodes(p_introduction, 'image')) image
        where not exists (
          select 1 from db.file_versions version
          join db.file_version_blobs blob on blob.file_version_id = version.id
          join db.controlled_file_revisions revision on revision.file_version_id = version.id
          where image.value->>'src' = ${
          sql.lit(introductionImagePrefix)
        } || version.id::string
            and version.content_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
            and blob.blob_hash is not null
            and ${
          opts.content.canReadDocument(
            sql`version.file_item_id`,
            sql`current_user`,
          )
        }
            and (revision.status = 'published' or exists (
              select 1 from db.training_course_introduction_images existing
              where existing.training_course_version_id = introduction_draft_id
                and existing.file_version_id = version.id
            ))
        )
      )`,
        sql
          .lit`Choose published images from Company Files. An image is unavailable or you no longer have access to it.`,
      );
      s.modify(
        sql`delete from db.training_course_introduction_images where training_course_version_id = introduction_draft_id`,
      );
      s.modify(
        sql`insert into db.training_course_introduction_images (training_course_version_id, file_version_id)
        select distinct introduction_draft_id, version.id
        from json.array_each(lexical_extract_nodes(p_introduction, 'image')) image
        join db.file_versions version on image.value->>'src' = ${
          sql.lit(introductionImagePrefix)
        } || version.id::string`,
      );
      s.modify(
        sql`update db.training_course_versions set introduction = case when ${
          introductionHasContentSql(sql`p_introduction`)
        } then p_introduction else null end
        where id = introduction_draft_id`,
      );
    },
  });
}

/** Authorize the recorded image reference, then serve current Company Files bytes. */
export function renderCourseIntroductionImage(
  s: EndpointStatements,
  opts: TrainingBlockOpts,
  assignmentId?: Sql,
  accessToken?: Sql,
) {
  if (!trainingFeatureEnabled(opts, "courseIntroduction")) {
    s.setHttpStatus(404);
    s.return();
    return;
  }
  if (!accessToken) {
    AuthBlock.validateApi(s, sql.lit`y-t`);
    s.defScalar(
      "introduction_api_user",
      sql`coalesce(auth_user_id, current_user)`,
    );
  }
  if (assignmentId) {
    if (!accessToken) {
      s.defScalar(
        "introduction_can_review",
        sql`${
          userHasPermission(
            sql.lit(trainingPermissions.viewEmployeeFiles),
            sql`introduction_api_user`,
          )
        } or ${
          userHasPermission(
            sql.lit(trainingPermissions.validateTraining),
            sql`introduction_api_user`,
          )
        }`,
      );
    }
    s.defScalar(
      "introduction_assignment_id",
      sql`(select assignment.id from db.training_assignments assignment
      join db.${
        sql.ref(personTable(opts))
      } person on person.id = assignment.person_id
      where assignment.id = ${assignmentId}
        and (${
        accessToken
          ? sql`false`
          : sql`${
            opts.workforce.personSysUserId(sql`person`)
          } = introduction_api_user or introduction_can_review`
      } or ${
        accessToken && trainingFeatureEnabled(opts, "inviteAccess")
          ? sql`exists (
        select 1 from db.training_access_tokens token where token.token = ${accessToken}
          and token.training_assignment_id = assignment.id and token.revoked_at is null
          and token.expires_at > now() and ${
            openTrainingAssignmentWhereSql(sql`assignment`)
          }
      )`
          : sql`false`
      }))`,
    );
    s.if(sql`introduction_assignment_id is null`, (s) => {
      s.setHttpStatus(404);
      s.return(sql.lit`Image not found`);
    });
    s.defTable(
      "introduction_image_versions",
      sql`
      select training_course_version_id as version_id from db.training_assignments where id = introduction_assignment_id
      union
      select section.training_course_version_id as version_id
      from db.training_employee_tasks task
      join db.training_course_section_items item on item.id = task.training_course_section_item_id
      join db.training_course_sections section on section.id = item.training_course_section_id
      join db.training_course_versions version on version.id = section.training_course_version_id
      where task.training_assignment_id = introduction_assignment_id and task.status != 'waived'
        and version.training_course_id != (select training_course_id from db.training_assignments where id = introduction_assignment_id)
    `,
    );
  }
  const authorized = assignmentId
    ? sql`exists (select 1 from db.training_course_introduction_images reference
        where reference.file_version_id = version.id and reference.training_course_version_id in (select version_id from introduction_image_versions))`
    : sql`${
      userHasPermission(
        sql.lit(trainingPermissions.manageLibrary),
        sql`introduction_api_user`,
      )
    }
      and ${
      opts.content.canReadDocument(
        sql`version.file_item_id`,
        sql`introduction_api_user`,
      )
    }
      and (exists (select 1 from db.controlled_file_revisions revision where revision.file_version_id = version.id and revision.status = 'published')
        or exists (select 1 from db.training_course_introduction_images reference where reference.file_version_id = version.id))`;
  s.defRecord(
    "introduction_image",
    sql`select blob.blob_hash, displayed_version.content_type
    from db.file_versions version
    join db.file_items item on item.id = version.file_item_id
    left join db.controlled_file_revisions current_revision
      on current_revision.id = case when ${
      opts.content.config.control.opts.publishOnUpload?.(
        sql`item.file_space_id`,
      ) ??
        sql.false
    } then ${
      opts.content.resolveCourseSupportingDocumentVersion({
        documentId: sql`item.id`,
        assignmentLanguage: sql.lit(opts.content.opts.defaultLanguage),
      })
    } end
    join db.file_versions displayed_version
      on displayed_version.id = coalesce(current_revision.file_version_id, version.id)
    join db.file_version_blobs blob on blob.file_version_id = displayed_version.id
    where version.id = try_cast(requested_file_version_id as bigint)
      and version.content_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
      and displayed_version.content_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
      and ${authorized}`,
  );
  s.if(sql`introduction_image.blob_hash is null`, (s) => {
    s.setHttpStatus(404);
    s.return(sql.lit`Image not found`);
  });
  s.setHeader(sql.lit`Content-Type`, sql`introduction_image.content_type`);
  s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
  s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
  s.returnBlob(sql`introduction_image.blob_hash`);
}
