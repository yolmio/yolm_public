import {
  AuthBlock,
  currentUserHasPermission,
  userHasPermission,
} from "blocks/auth";
import type { WorkforceProvider } from "blocks/workforce";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { EndpointStatements } from "std/statements";
import { system } from "std/system";
import {
  activeVersionIdSql,
  defaultLanguageSql,
  employeeText,
  personLanguageSql,
  trainingFeatureEnabled,
  trainingPermissions,
} from "./helpers";
import type { TrainingBlockOpts } from "./types";

export type TranslationReviewKind = "course" | "assessment";

export function translationReviewerLanguageSql(opts: TrainingBlockOpts) {
  return sql`coalesce((select ${personLanguageSql(opts, sql`person`)}
    from db.${sql.ref(opts.workforce.personTable)} person
    where ${
    opts.workforce.personSysUserId(sql`person`)
  } = current_user), 'en')`;
}

export function translationReviewerEligibleSql(
  workforce: WorkforceProvider,
  userId: Sql,
) {
  return sql`exists (
    select 1 from db.${sql.ref(workforce.personTable)} reviewer_person
    join db.sys_users reviewer_user on ${
    workforce.personSysUserJoin(sql`reviewer_person`, sql`reviewer_user`)
  }
    where reviewer_user.id = ${userId} and not reviewer_user.disabled
      and ${workforce.personAccessEligible(sql`reviewer_person`)}
  )`;
}

export function translationReviewAccessSql(
  workforce: WorkforceProvider,
  reviewId: Sql,
  userId: Sql = sql`current_user`,
) {
  return sql`${translationReviewerEligibleSql(workforce, userId)} and exists (
    select 1 from db.training_translation_reviews access_review
    where access_review.id = ${reviewId} and (
      access_review.requested_by_id = ${userId}
      or exists (select 1 from db.training_translation_reviewers reviewer
        where reviewer.training_translation_review_id = access_review.id and reviewer.reviewer_id = ${userId})
      or (access_review.training_course_version_id is not null and ${
    userHasPermission(sql.lit(trainingPermissions.manageLibrary), userId)
  })
      or (access_review.training_assessment_version_id is not null and ${
    userHasPermission(sql.lit(trainingPermissions.manageAssessments), userId)
  })
    )
  )`;
}

export function translationReviewIdSql(
  kind: TranslationReviewKind,
  version: Sql,
) {
  return sql`(select id from db.training_translation_reviews
    where ${sql.ref(`training_${kind}_version_id`)} = ${version}
    order by id desc limit 1)`;
}

export function translationReviewLockedSql(
  kind: TranslationReviewKind,
  version: Sql,
) {
  return sql`exists (select 1 from db.training_translation_review_state
    where id = ${
    translationReviewIdSql(kind, version)
  } and version_status = 'draft' and state in ('in_review', 'approved'))`;
}

export function translationApprovedSql(
  kind: TranslationReviewKind,
  version: Sql,
) {
  return sql`exists (select 1 from db.training_translation_review_state
    where id = ${
    translationReviewIdSql(kind, version)
  } and state = 'approved')`;
}

export function translationReviewHref(
  opts: TrainingBlockOpts,
  reviewId?: Sql,
  admin = false,
) {
  const base = admin
    ? opts.routes?.adminBasePath ?? "/training-admin"
    : opts.routes?.employeeBasePath ?? "/training";
  return reviewId
    ? sql`${sql.lit(`${base}/translation-reviews/`)} || ${reviewId}::string`
    : sql.lit(`${base}/translation-reviews`);
}

export function translationReviewFileHref(reviewId: Sql, fileVersionId: Sql) {
  return sql`'/api/training/translation-reviews/' || ${reviewId}::string || '/files/' || ${fileVersionId}::string`;
}

function reviewCourseVersionsSql(
  opts: TrainingBlockOpts,
  reviewId: Sql,
  userId: Sql,
) {
  return sql`select v.id, v.language from db.training_translation_reviews r
    join db.training_course_versions target on target.id = r.training_course_version_id
    join db.training_course_versions v on v.id in (target.id, target.source_version_id)
    where r.id = ${reviewId} and ${
    translationReviewAccessSql(opts.workforce, sql`r.id`, userId)
  }`;
}

function reviewDocumentVersionsSql(
  opts: TrainingBlockOpts,
  reviewId: Sql,
  userId: Sql,
) {
  return sql`select distinct ${
    activeVersionIdSql(sql`link.document_id`, sql`v.language`, opts)
  } as id
    from (${reviewCourseVersionsSql(opts, reviewId, userId)}) v
    join db.training_course_sections section on section.training_course_version_id = v.id
    join db.training_course_section_items item on item.training_course_section_id = section.id
    join db.training_course_section_item_documents link on link.training_course_section_item_id = item.id`;
}

/** Reviewers can read referenced media, never browse the underlying workspace. */
export function renderTranslationReviewFile(
  s: EndpointStatements,
  opts: TrainingBlockOpts,
  kind: "file" | "nativeImage" | "nativePdf" = "file",
) {
  AuthBlock.validateApi(s, sql.lit`y-t`);
  s.defScalar("review_file_user", sql`coalesce(auth_user_id, current_user)`);
  s.defScalar("requested_review_id", sql`try_cast(review_id as bigint)`);
  if (kind !== "file") {
    s.defScalar(
      "requested_document_version_id",
      sql`try_cast(version_id as bigint)`,
    );
    if (kind === "nativeImage") {
      s.defScalar(
        "requested_image_item_id",
        sql`try_cast(image_file_item_id as bigint)`,
      );
      s.defScalar("requested_image_hash", sql`hash_hex`);
    }
  } else {
    s.defScalar(
      "requested_file_version_id",
      sql`try_cast(file_version_id as bigint)`,
    );
  }
  s.defTable(
    "review_document_versions",
    reviewDocumentVersionsSql(
      opts,
      sql`requested_review_id`,
      sql`review_file_user`,
    ),
  );
  if (kind !== "file") {
    s.if(
      sql`not exists (select 1 from review_document_versions where id = requested_document_version_id)`,
      (s) => {
        s.setHttpStatus(404);
        s.return(sql.lit`Image not found`);
      },
    );
    if (kind === "nativePdf") {
      opts.content.renderAuthorizedDocumentPdf(
        s,
        sql`requested_document_version_id`,
        "review_policy_pdf",
      );
      s.setHeader(sql.lit`Content-Type`, sql.lit`application/pdf`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
      s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
      s.return(sql`review_policy_pdf`);
      return;
    }
    s.defRecord(
      "review_file",
      opts.content.trainingNativeImageQuery({
        versionId: sql`requested_document_version_id`,
        imageFileItemId: sql`requested_image_item_id`,
        hashHex: sql`requested_image_hash`,
      }),
    );
  } else {
    s.defRecord(
      "review_file",
      sql`select blob.blob_hash, file.content_type
      from db.file_versions file join db.file_version_blobs blob on blob.file_version_id = file.id
      where file.id = requested_file_version_id and (
        exists (select 1 from db.controlled_file_revisions revision where revision.file_version_id = file.id
          and revision.id in (select id from review_document_versions))
        or (${
        trainingFeatureEnabled(opts, "courseIntroduction")
          ? sql`true`
          : sql`false`
      } and exists (
          select 1 from db.training_course_introduction_images image
          where image.file_version_id = file.id and image.training_course_version_id in (
            select id from (${
        reviewCourseVersionsSql(
          opts,
          sql`requested_review_id`,
          sql`review_file_user`,
        )
      }) versions)))
      )`,
    );
  }
  s.if(sql`review_file.blob_hash is null`, (s) => {
    s.setHttpStatus(404);
    s.return(sql.lit`File not found`);
  });
  s.setHeader(
    sql.lit`Content-Type`,
    sql`case when lower(trim(split_part(review_file.content_type, ';', 1))) in ('application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'text/plain') then review_file.content_type else 'application/octet-stream' end`,
  );
  s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
  s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
  s.returnBlob(sql`review_file.blob_hash`);
}

/** A reviewed version is immutable. Further edits clone it through ensure-draft. */
export function registerTranslationReviews(opts: TrainingBlockOpts) {
  const control = opts.content.config.control;
  const actor = control.opts.actor;
  system.db.table("training_translation_reviews", (t) => {
    t.fk("training_course_version_id", "training_course_versions").onDelete(
      "Restrict",
    );
    t.fk("training_assessment_version_id", "training_assessment_versions")
      .onDelete("Restrict");
    t.fk("requested_by_id", "sys_users").notNull().onDelete("Restrict");
    t.timestampUtc("requested_at").notNull().default(sql`now()`);
    t.timestampUtc("withdrawn_at");
    t.check({
      fields: ["training_course_version_id", "training_assessment_version_id"],
      errorMessage: () =>
        sql
          .lit`A review must reference exactly one course or assessment version.`,
      check: ([course, assessment]) =>
        sql`(${course} is null) != (${assessment} is null)`,
    });
  });
  control.registerReviewerTarget(
    "training_translation_review_id",
    "training_translation_reviews",
  );
  // Scope the shared rows to training and resolve the configured actor to a
  // login. Some providers use sys_users; others use workforce people.
  system.db.view(
    "training_translation_reviewers",
    sql`
    select reviewer.id, reviewer.training_translation_review_id,
      ${actor.actorSysUserId(sql`review_actor`)} as reviewer_id,
      reviewer.step_number as position, reviewer.decision,
      reviewer.decided_at, reviewer.notes as comments
    from db.controlled_file_reviewers reviewer
    join db.${
      sql.ref(actor.actorTable)
    } review_actor on review_actor.id = reviewer.reviewer_actor_id
    where reviewer.training_translation_review_id is not null
  `,
  );
  system.db.view(
    "training_translation_review_state",
    sql`
    select review.*,
      case when review.withdrawn_at is not null then 'withdrawn'
        when exists (select 1 from db.training_translation_reviewers r where r.training_translation_review_id = review.id and r.decision = 'rejected') then 'changes_requested'
        when exists (select 1 from db.training_translation_reviewers r where r.training_translation_review_id = review.id)
          and not exists (select 1 from db.training_translation_reviewers r where r.training_translation_review_id = review.id and r.decision is distinct from 'approved') then 'approved'
        else 'in_review' end as state,
      (select r.reviewer_id from db.training_translation_reviewers r
        where r.training_translation_review_id = review.id and r.decision is null
        order by r.position limit 1) as next_reviewer_id,
      coalesce(course_version.localized_name, assessment_version.localized_name, course.name, assessment.name) as name,
      coalesce(course_version.language, assessment_version.language) as language,
      coalesce(course_version.source_version_id, assessment_version.source_version_id) as source_version_id,
      coalesce(course_version.status::string, assessment_version.status::string) as version_status
    from db.training_translation_reviews review
    left join db.training_course_versions course_version on course_version.id = review.training_course_version_id
    left join db.training_courses course on course.id = course_version.training_course_id
    left join db.training_assessment_versions assessment_version on assessment_version.id = review.training_assessment_version_id
    left join db.training_assessments assessment on assessment.id = assessment_version.training_assessment_id
  `,
  );

  // A single stored notification boundary avoids duplicating delivery machinery.
  system.storedProcedure({
    name: "training_notify_translation_review",
    transaction: "caller",
    inputScalars: [{ name: "p_review_id", type: "BigInt" }],
    procedure: (s) => {
      s.defRecord(
        "review",
        sql`select * from db.training_translation_review_state where id = p_review_id`,
      );
      s.modify(
        sql`update db.user_notifications set read_at = coalesce(read_at, now()), snoozed_until = null
        where source = ${sql.lit(opts.notifications.config.key)}
          and record_key = 'translation-review:' || p_review_id::string`,
      );
      s.defScalar(
        "review_title",
        sql`case review.state
        when 'in_review' then 'Translation ready for review: '
        when 'approved' then 'Translation approved: '
        when 'changes_requested' then 'Translation changes requested: '
        else 'Translation review withdrawn: ' end || review.name`,
      );
      s.defScalar(
        "review_body",
        sql`case review.state
        when 'in_review' then 'It is your turn to review this translation.'
        when 'approved' then 'All reviewers approved. The translation is ready to publish.'
        when 'changes_requested' then 'Read the reviewer comments, make the changes, and submit for review again.'
        else 'This review was withdrawn. No further decisions are needed.' end`,
      );
      opts.notifications.publish(s, {
        recordKey: sql`'translation-review:' || p_review_id::string`,
        recipientsQuery:
          sql`select review.next_reviewer_id as recipient_user_id where review.state = 'in_review'
          union select review.requested_by_id where review.state != 'in_review'
          union select reviewer_id from db.training_translation_reviewers where training_translation_review_id = p_review_id and review.state = 'withdrawn'`,
        title: sql`review_title`,
        body: sql`review_body`,
        href: translationReviewHref(opts, sql`p_review_id`),
        payload: sql`json_build_object('kind', 'translation_review',
          'trainingModuleName', review.name, 'emailSubject', review_title,
          'emailHtmlBody', '<p>' || string.html_escape(review_body) || '</p>')`,
      });
    },
  });

  for (const kind of ["course", "assessment"] as const) {
    const versionTable = `training_${kind}_versions`;
    const versionFk = `training_${kind}_version_id`;
    const manage = kind === "course"
      ? trainingPermissions.manageLibrary
      : trainingPermissions.manageAssessments;
    system.storedProcedure({
      name: `training_request_${kind}_translation_review`,
      transaction: "caller",
      inputScalars: [
        { name: "p_version_id", type: "BigInt" },
        { name: "p_reviewer_ids", type: { type: "String", maxLength: 4000 } },
      ],
      procedure: (s) => {
        s.throwErrorUnless(
          sql`${currentUserHasPermission(sql.lit(manage))} and ${
            translationReviewerEligibleSql(opts.workforce, sql`current_user`)
          }`,
          sql.lit`You do not have permission to request translation review.`,
        );
        s.throwErrorUnless(
          sql`exists (select 1 from db.${sql.ref(versionTable)}
          where id = p_version_id and status = 'draft' and language != ${
            defaultLanguageSql(opts)
          } and source_version_id is not null)`,
          sql
            .lit`Choose an unpublished translation linked to its source version.`,
        );
        s.throwErrorIf(
          translationReviewLockedSql(kind, sql`p_version_id`),
          sql
            .lit`Withdraw the existing review before choosing a new review route.`,
        );
        s.defTable(
          "selected_reviewers",
          sql`select try_cast(value as bigint) as user_id, ordinal from string.split(coalesce(p_reviewer_ids, ''), ',')`,
        );
        s.throwErrorIf(
          sql`not exists (select 1 from selected_reviewers)
          or exists (select 1 from selected_reviewers where user_id is null or not ${
            translationReviewerEligibleSql(opts.workforce, sql`user_id`)
          } or ${actor.actorIdForSysUserId(sql`user_id`)} is null)
          or (select count(*) from selected_reviewers) != (select count(distinct user_id) from selected_reviewers)`,
          sql
            .lit`Choose at least one active reviewer with a login, without duplicates.`,
        );
        // Legacy versions inherit metadata from the parent. Freeze the displayed
        // values before review so later English publication cannot change them.
        s.defRecord(
          "review_identity",
          sql`select parent.id, parent.name, parent.description, target.source_version_id
          from db.${sql.ref(versionTable)} target
          join db.${
            sql.ref(`training_${kind}s`)
          } parent on parent.id = target.${sql.ref(`training_${kind}_id`)}
          where target.id = p_version_id`,
        );
        s.modify(
          sql`update db.${sql.ref(versionTable)}
          set localized_name = review_identity.name, localized_description = review_identity.description
          where id in (p_version_id, review_identity.source_version_id)
            and ${sql.ref(`training_${kind}_id`)} = review_identity.id
            and localized_name is null`,
        );
        s.defScalar("new_review_id", { type: "BigInt" });
        s.modify(
          sql`insert into db.training_translation_reviews (${
            sql.ref(versionFk)
          }, requested_by_id)
          values (p_version_id, current_user) returning id into new_review_id`,
        );
        s.modify(
          sql`insert into db.controlled_file_reviewers (training_translation_review_id, reviewer_actor_id, step_number)
          select new_review_id, ${
            actor.actorIdForSysUserId(sql`user_id`)
          }, ordinal from selected_reviewers`,
        );
        s.callStoredProcedure("training_notify_translation_review", {
          inputScalars: { p_review_id: sql`new_review_id` },
        });
      },
    });
  }
  system.storedProcedure({
    name: "training_withdraw_translation_review",
    transaction: "caller",
    inputScalars: [{ name: "p_review_id", type: "BigInt" }],
    procedure: (s) => {
      s.defRecord(
        "review",
        sql`select * from db.training_translation_review_state where id = p_review_id`,
      );
      s.throwErrorUnless(
        sql`review.version_status = 'draft' and review.state in ('in_review', 'approved')
        and ${translationReviewerEligibleSql(opts.workforce, sql`current_user`)}
        and ((review.training_course_version_id is not null and ${
          currentUserHasPermission(sql.lit(trainingPermissions.manageLibrary))
        })
          or (review.training_assessment_version_id is not null and ${
          currentUserHasPermission(
            sql.lit(trainingPermissions.manageAssessments),
          )
        }))`,
        sql
          .lit`This review cannot be withdrawn, or you do not have permission.`,
      );
      s.modify(
        sql`update db.training_translation_reviews set withdrawn_at = now() where id = p_review_id`,
      );
      s.callStoredProcedure("training_notify_translation_review", {
        inputScalars: { p_review_id: sql`p_review_id` },
      });
    },
  });
  system.storedProcedure({
    name: "training_decide_translation_review",
    transaction: "caller",
    inputScalars: [
      { name: "p_review_id", type: "BigInt" },
      { name: "p_decision", type: { type: "String", maxLength: 30 } },
      { name: "p_comments", type: { type: "String", maxLength: 2000 } },
    ],
    procedure: (s) => {
      s.defRecord(
        "review",
        sql`select * from db.training_translation_review_state where id = p_review_id`,
      );
      s.defScalar("reviewer_language", translationReviewerLanguageSql(opts));
      s.throwErrorUnless(
        sql`review.state = 'in_review' and review.version_status = 'draft'
        and review.next_reviewer_id = current_user and ${
          translationReviewerEligibleSql(opts.workforce, sql`current_user`)
        }`,
        employeeText(sql`reviewer_language`, {
          en: "This review is no longer awaiting your decision.",
          es: "Esta revisión ya no está esperando tu decisión.",
        }),
      );
      s.throwErrorUnless(
        sql`p_decision in ('approved', 'changes_requested')`,
        employeeText(sql`reviewer_language`, {
          en: "Choose approve or request changes.",
          es: "Elige aprobar o solicitar cambios.",
        }),
      );
      s.throwErrorIf(
        sql`p_decision = 'changes_requested' and nullif(trim(p_comments), '') is null`,
        employeeText(sql`reviewer_language`, {
          en: "Explain what needs to change before returning the translation.",
          es: "Explica qué se debe cambiar antes de devolver la traducción.",
        }),
      );
      s.callStoredProcedure("controlled_file_record_review_decision", {
        inputScalars: {
          p_reviewer_id: sql`(select id from db.training_translation_reviewers
            where training_translation_review_id = p_review_id and reviewer_id = current_user)`,
          p_actor_id: actor.actorIdForSysUserId(sql`current_user`),
          p_decision:
            sql`case p_decision when 'changes_requested' then 'rejected' else p_decision end`,
          p_notes: sql`p_comments`,
        },
      });
      s.callStoredProcedure("training_notify_translation_review", {
        inputScalars: { p_review_id: sql`p_review_id` },
      });
    },
  });
}
