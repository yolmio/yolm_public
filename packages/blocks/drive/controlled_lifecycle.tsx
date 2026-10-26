import { userHasPermission as authUserHasPermission } from "blocks/auth";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { Chip } from "components/chip";
import { ConfirmDangerDialog } from "components/confirm_danger_dialog";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { isPlayableVideoMime } from "components/video_player";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { checkString, sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type {
  DomStatements,
  HelperProcField,
  ServerStatementsBase,
} from "std/statements";
import { system, TableBuilder } from "std/system";
import { Each, Show } from "std/ui";
import type { Node } from "std/ui";
import type {
  DriveBlockContract,
  DriveExtension,
  DriveLifecycle,
  DriveSpaceType,
  FileCreateAccessContext,
  FileItemUpdateAccessContext,
  FileVersionAccessContext,
  FileVersionCreateAccessContext,
  FileVersionCreatedEvent,
} from "./types.ts";
import { FileViewer } from "./viewer";

const CONTROLLED_FILE_UPLOAD_CHUNK_THRESHOLD = 16 * 1024 * 1024;
const CONTROLLED_FILE_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

export interface ControlledFileActorProvider {
  actorTable: string;
  actorIdForSysUserId: (sysUserId: Sql) => Sql;
  actorSysUserId: (actorRecord: Sql) => Sql;
  actorDisplayName: (actorRecord: Sql) => Sql;
}

export interface ControlledFileLanguage {
  code: string;
  name: string;
  nativeName?: string;
}

export interface ControlledFileLifecycleOpts {
  actor: ControlledFileActorProvider;
  languages: readonly ControlledFileLanguage[];
  defaultLanguage: string;
  /**
   * Optional product-specific authority that receives proposals and configures
   * their approval route. Omit to retain the standard controlled-file manager
   * authorization and terminology.
   */
  proposalCoordinator?: {
    displayName: string;
    canConfigureReview: (sysUserId: Sql) => Sql;
    /**
     * Optional product-specific eligibility check for receiving a proposal.
     * The revision is still a draft when this predicate is evaluated.
     */
    canReceiveProposal?: (sysUserId: Sql, revisionId: Sql) => Sql;
  };
  /** Omit to retain `can_manage_controlled_files` publication authority. */
  canPublish?: (sysUserId: Sql) => Sql;
  /** Spaces where PDF, image, and video uploads publish immediately, without review. */
  publishOnUpload?: (spaceId: Sql) => Sql;
}

export interface ControlledFilePanelProps {
  files: DriveBlockContract;
  control: ControlledFileLifecycle;
  fileItemId: AnyExpr;
  language?: AnyExpr;
}

export type ControlledFileWorkspaceProps = ControlledFilePanelProps;

export interface ControlledFileReviewSurfaceProps {
  controlledRevisionId: Sql;
  files: DriveBlockContract;
  fileItemId: Sql;
  fileVersionId: Sql;
}

export interface ControlledFileReviewSurface {
  name: string;
  canRender: (props: ControlledFileReviewSurfaceProps) => Sql;
  render: (props: ControlledFileReviewSurfaceProps) => Node;
}

const permissions = {
  manage: "can_manage_controlled_files",
  review: "can_review_controlled_files",
} as const;

export function canManageControlledFiles(sysUserId: Sql) {
  return authUserHasPermission(sql.lit(permissions.manage), sysUserId);
}

export function canReviewControlledFiles(sysUserId: Sql) {
  return authUserHasPermission(sql.lit(permissions.review), sysUserId);
}

export interface ControlledFilePublishedEvent {
  fileItemId: Sql;
  languageVariantId: Sql;
  revisionId: Sql;
  fileVersionId: Sql;
  language: Sql;
  publishedByActorId: Sql;
  publicationActionConfirmed: Sql;
}

export interface ControlledFilePublicationConfirmationContext {
  fileItemId: Sql;
  revisionId: Sql;
  language: Sql;
}

export interface ControlledFilePublicationConfirmation {
  appliesWhen: Sql;
  query: Sql;
  title: Node;
  confirmLabel: Node;
  skipLabel: Node;
}

export interface ControlledFilePublicationConsumer {
  name: string;
  publicationConfirmation?: (
    context: ControlledFilePublicationConfirmationContext,
  ) => ControlledFilePublicationConfirmation;
  onPublished: (
    s: ServerStatementsBase<any>,
    event: ControlledFilePublishedEvent,
  ) => void;
}

export interface ControlledFileWorkflowEvent {
  fileItemId: Sql;
  revisionId: Sql;
  language: Sql;
}

export interface ControlledFileReviewDecisionEvent
  extends ControlledFileWorkflowEvent {
  decision: "approved" | "rejected";
  decidedByActorId: Sql;
}

export interface ControlledFileReviewerRemovedEvent
  extends ControlledFileWorkflowEvent {
  removedReviewerActorId: Sql;
  wasCurrentReviewer: Sql;
}

/** Product-owned side effects for controlled-file workflow transitions. */
export interface ControlledFileWorkflowConsumer {
  name: string;
  onProposalSubmitted?: (
    s: ServerStatementsBase<any>,
    event: ControlledFileWorkflowEvent,
  ) => void;
  onReviewStarted?: (
    s: ServerStatementsBase<any>,
    event: ControlledFileWorkflowEvent,
  ) => void;
  onReviewRouteAdvanced?: (
    s: ServerStatementsBase<any>,
    event: ControlledFileWorkflowEvent,
  ) => void;
  onReviewStopped?: (
    s: ServerStatementsBase<any>,
    event: ControlledFileWorkflowEvent,
  ) => void;
  onProposalDisregarded?: (
    s: ServerStatementsBase<any>,
    event: ControlledFileWorkflowEvent,
  ) => void;
  onReviewerRemoved?: (
    s: ServerStatementsBase<any>,
    event: ControlledFileReviewerRemovedEvent,
  ) => void;
  onReviewDecided?: (
    s: ServerStatementsBase<any>,
    event: ControlledFileReviewDecisionEvent,
  ) => void;
}

/**
 * Structured revision, review, approval, and publication over ordinary Files.
 *
 * This lifecycle owns no bytes, folders, names, tags, or space membership.
 * It controls which exact immutable `file_versions` are drafts, reviewable,
 * and published within a Drive space type.
 */
export class ControlledFileLifecycle implements DriveLifecycle {
  readonly kind = "lifecycle" as const;
  readonly name = "controlled_files";
  static permissions = [
    {
      name: permissions.manage,
      displayName: "Manage Controlled Files",
      description:
        "Validate, stop, or disregard proposals; assign reviewers; and publish files.",
      group: "Controlled Files",
    },
    {
      name: permissions.review,
      displayName: "Review Controlled Files",
      description: "Decide assigned controlled-file reviews.",
      group: "Controlled Files",
    },
  ];

  readonly variantTable = "controlled_file_language_variants";
  readonly revisionTable = "controlled_file_revisions";
  readonly checkpointTable = "controlled_file_revision_file_versions";
  readonly reviewerTable = "controlled_file_reviewers";
  #files?: DriveBlockContract;
  #publicationConsumers: ControlledFilePublicationConsumer[] = [];
  #workflowConsumers: ControlledFileWorkflowConsumer[] = [];
  #reviewSurfaces: ControlledFileReviewSurface[] = [];
  #reviewerTargetFields = ["controlled_file_revision_id"];

  constructor(readonly opts: ControlledFileLifecycleOpts) {
    if (!opts.languages.length) {
      throw new Error(
        "ControlledFileLifecycle requires at least one language.",
      );
    }
    const codes = new Set(opts.languages.map((language) => language.code));
    if (
      codes.size !== opts.languages.length ||
      !codes.has(opts.defaultLanguage) ||
      opts.languages.some((language) =>
        !/^[A-Za-z0-9_-]+$/.test(language.code) || !language.name.trim()
      )
    ) {
      throw new Error(
        "ControlledFileLifecycle languages must be unique and include defaultLanguage.",
      );
    }
    if (
      opts.proposalCoordinator && !opts.proposalCoordinator.displayName.trim()
    ) {
      throw new Error(
        "ControlledFileLifecycle proposalCoordinator requires a displayName.",
      );
    }
  }

  initialize(files: DriveBlockContract) {
    this.#files = files;
    system.enum_({
      name: "controlled_file_language",
      values: this.opts.languages.map((language) => ({
        name: language.code,
        displayName: language.name,
      })),
    });
    system.enum_({
      name: "controlled_file_revision_status",
      values: [
        { name: "draft", displayName: "Draft" },
        { name: "proposed", displayName: "Proposed" },
        { name: "in_review", displayName: "In review" },
        { name: "approved", displayName: "Approved" },
        { name: "rejected", displayName: "Rejected" },
        { name: "published", displayName: "Published" },
        { name: "superseded", displayName: "Superseded" },
      ],
    });
    system.enum_({
      name: "controlled_file_review_decision",
      values: [
        { name: "approved", displayName: "Approved" },
        { name: "rejected", displayName: "Rejected" },
      ],
    });

    system.db.table(this.variantTable, (table) => {
      table.fk("file_item_id", files.itemTable).notNull()
        .onDelete("Restrict");
      table.enum("language", "controlled_file_language").notNull();
      table.fk(
        "current_controlled_file_revision_id",
        this.revisionTable,
      ).onDelete("Restrict");
      table.unique(["file_item_id", "language"]);
      table.skipAutoApi();
    });

    system.db.table(this.revisionTable, (table) => {
      table.fk(
        "controlled_file_language_variant_id",
        this.variantTable,
      ).notNull().onDelete("Restrict");
      table.string("revision_label", 80).notNull();
      table.fk(
        "source_controlled_file_revision_id",
        this.revisionTable,
      ).onDelete("Restrict");
      table.fk("file_version_id", files.versionTable).notNull().onDelete(
        "Restrict",
      );
      table.enum("status", "controlled_file_revision_status").notNull()
        .default(sql.lit`draft`);
      table.date("effective_on").notNull().default(sql`current_date()`);
      table.string("change_summary", 2000).multiline();
      table.fk("initiated_by_actor_id", this.opts.actor.actorTable).notNull()
        .onDelete("Restrict");
      table.timestampUtc("initiated_at").notNull().default(sql`now()`);
      table.fk("approved_by_actor_id", this.opts.actor.actorTable).onDelete(
        "Restrict",
      );
      table.timestampUtc("approved_at");
      table.fk("disregarded_by_actor_id", this.opts.actor.actorTable).onDelete(
        "Restrict",
      );
      table.timestampUtc("disregarded_at");
      table.string("disregard_reason", 2000).multiline();
      table.fk("published_by_actor_id", this.opts.actor.actorTable).onDelete(
        "Restrict",
      );
      table.timestampUtc("published_at");
      table.unique([
        "controlled_file_language_variant_id",
        "revision_label",
      ]);
      table.check({
        fields: ["approved_by_actor_id", "approved_at"],
        errorMessage: () =>
          sql.lit`Controlled revision approval evidence is incomplete.`,
        check: ([actor, at]) =>
          sql`(${actor} is null and ${at} is null)
            or (${actor} is not null and ${at} is not null)`,
      });
      table.check({
        fields: [
          "status",
          "disregarded_by_actor_id",
          "disregarded_at",
          "disregard_reason",
        ],
        errorMessage: () =>
          sql.lit`Controlled revision disregard evidence is incomplete.`,
        check: ([status, actor, at, reason]) =>
          sql`(
              ${actor} is null
              and ${at} is null
              and ${reason} is null
            ) or (
              ${status}::string = ${checkString("rejected")}
              and ${actor} is not null
              and ${at} is not null
              and nullif(trim(${reason}), '') is not null
            )`,
      });
      table.check({
        fields: ["published_by_actor_id", "published_at"],
        errorMessage: () =>
          sql.lit`Controlled revision publication evidence is incomplete.`,
        check: ([actor, at]) =>
          sql`(${actor} is null and ${at} is null)
            or (${actor} is not null and ${at} is not null)`,
      });
      table.recordDisplayName(["revision_label"]);
      table.skipAutoApi();
    });

    system.db.table(this.checkpointTable, (table) => {
      table.fk(
        "controlled_file_revision_id",
        this.revisionTable,
      ).notNull().onDelete("Restrict");
      table.fk("file_version_id", files.versionTable).notNull().onDelete(
        "Restrict",
      );
      table.unique(["controlled_file_revision_id", "file_version_id"]);
      table.skipAutoApi();
    });

    // Compiled once so published requested-language preference and default
    // fallback are not re-inlined at every library, reader, and publication
    // consumer call site.
    system.db.scalarFunction({
      name: "controlled_preferred_published_revision",
      description:
        "Resolves the latest published requested-language revision for a file item, falling back to the default language only when none exists.",
      parameters: [
        { name: "file_item_id", type: "BigInt" },
        { name: "language", type: { type: "String", maxLength: 20 } },
      ],
      returnType: "BigInt",
      procedure: (s) => {
        // Copy inputs into locals: `input.*` references inside the return
        // expression's subqueries do not resolve reliably in the JIT.
        s.defScalar(
          "controlled_preferred_file_item_id",
          sql`input.file_item_id`,
        );
        s.defScalar("controlled_preferred_language", sql`input.language`);
        s.return(this.preferredPublishedRevisionPredicate({
          fileItemId: sql`controlled_preferred_file_item_id`,
          preferredLanguage: sql`controlled_preferred_language`,
        }));
      },
    });
    system.db.table(this.reviewerTable, (table) => {
      table.fk(
        "controlled_file_revision_id",
        this.revisionTable,
      ).notNull().onDelete("Restrict");
      table.uint("step_number").notNull();
      table.fk("reviewer_actor_id", this.opts.actor.actorTable).notNull()
        .onDelete("Restrict");
      table.enum("decision", "controlled_file_review_decision");
      table.string("notes", 2000).multiline();
      table.timestampUtc("decided_at");
      table.unique([
        "controlled_file_revision_id",
        "step_number",
      ]);
      table.unique([
        "controlled_file_revision_id",
        "reviewer_actor_id",
      ]);
      table.check({
        fields: ["decision", "decided_at"],
        errorMessage: () =>
          sql.lit`Review decision evidence must be set together.`,
        check: ([decision, at]) =>
          sql`(${decision} is null and ${at} is null)
            or (${decision} is not null and ${at} is not null)`,
      });
      table.skipAutoApi();
    });
  }

  validate(files: DriveBlockContract) {
    if (this.#files !== files) {
      throw new Error(
        "ControlledFileLifecycle must be initialized by its DriveBlock.",
      );
    }
    if (!system.db.tables[this.opts.actor.actorTable]) {
      throw new Error(
        `ControlledFileLifecycle actor table "${this.opts.actor.actorTable}" does not exist.`,
      );
    }
  }

  /**
   * Share the ordered reviewer records with another versioned workflow.
   * The caller owns its request lifecycle and authorization; each reviewer
   * record belongs to exactly one registered target.
   */
  registerReviewerTarget(field: string, table: string) {
    if (this.#reviewerTargetFields.includes(field)) {
      throw new Error(`Reviewer target ${field} is already registered.`);
    }
    const reviewers = system.db.tables[this.reviewerTable];
    if (!reviewers) {
      throw new Error("Initialize the controlled-file lifecycle first.");
    }
    const extension = new TableBuilder(this.reviewerTable);
    extension.fk(field, table).onDelete("Restrict");
    extension.unique([field, "step_number"]);
    extension.unique([field, "reviewer_actor_id"]);
    const added = extension.finish();
    Object.assign(reviewers.fields, added.fields);
    reviewers.uniqueConstraints.push(...added.uniqueConstraints);
    reviewers.fields.controlled_file_revision_id.notNull = false;
    this.#reviewerTargetFields.push(field);
    if (this.#reviewerTargetFields.length === 2) {
      reviewers.checks.push({
        fields: this.#reviewerTargetFields,
        errorMessage: () =>
          sql.lit`A reviewer must belong to exactly one review.`,
        check: (fields) =>
          sql`(${
            fields.map((value) =>
              sql`case when ${value} is null then 0 else 1 end`
            ).reduce((a, b) => sql`${a} + ${b}`)
          }) = 1`,
      });
    }
  }

  registerPublicationConsumer(consumer: ControlledFilePublicationConsumer) {
    if (
      this.#publicationConsumers.some((candidate) =>
        candidate.name === consumer.name
      )
    ) {
      throw new Error(
        `Controlled-file publication consumer "${consumer.name}" is duplicated.`,
      );
    }
    this.#publicationConsumers.push(consumer);
  }

  registerWorkflowConsumer(consumer: ControlledFileWorkflowConsumer) {
    if (
      this.#workflowConsumers.some((candidate) =>
        candidate.name === consumer.name
      )
    ) {
      throw new Error(
        `Controlled-file workflow consumer "${consumer.name}" is duplicated.`,
      );
    }
    this.#workflowConsumers.push(consumer);
  }

  canConfigureReview(sysUserId: Sql) {
    return this.opts.proposalCoordinator?.canConfigureReview(sysUserId) ??
      canManageControlledFiles(sysUserId);
  }

  canPublish(sysUserId: Sql) {
    return this.opts.canPublish?.(sysUserId) ??
      canManageControlledFiles(sysUserId);
  }

  get proposalCoordinatorDisplayName() {
    return this.opts.proposalCoordinator?.displayName ??
      "document-control validator";
  }

  publicationConfirmation(
    context: ControlledFilePublicationConfirmationContext,
  ) {
    const consumers = this.#publicationConsumers.filter((consumer) =>
      consumer.publicationConfirmation !== undefined
    );
    if (consumers.length > 1) {
      throw new Error(
        "Only one controlled-file publication confirmation can be registered.",
      );
    }
    return consumers[0]?.publicationConfirmation?.(context);
  }

  registerReviewSurface(surface: ControlledFileReviewSurface) {
    if (
      this.#reviewSurfaces.some((candidate) => candidate.name === surface.name)
    ) {
      throw new Error(
        `Controlled-file review surface "${surface.name}" is duplicated.`,
      );
    }
    this.#reviewSurfaces.push(surface);
  }

  get reviewSurfaces(): readonly ControlledFileReviewSurface[] {
    return this.#reviewSurfaces;
  }

  canParticipateInReview(fileVersionId: Sql, sysUserId: Sql) {
    return sql`
      exists (
        select 1
        from db.controlled_file_revisions review_revision
        where review_revision.file_version_id = ${fileVersionId}
          and ${
      this.canParticipateInRevision(
        sql`review_revision.id`,
        sysUserId,
      )
    }
      )
    `;
  }

  canReadReviewEvidence(fileVersionId: Sql, sysUserId: Sql) {
    return sql`
      exists (
        select 1
        from db.controlled_file_revisions review_evidence_revision
        where review_evidence_revision.file_version_id = ${fileVersionId}
          and ${
      this.canReadReviewEvidenceForRevision(
        sql`review_evidence_revision.id`,
        sysUserId,
      )
    }
      )
    `;
  }

  canParticipateInRevision(revisionId: Sql, sysUserId: Sql) {
    return sql`
      exists (
        select 1
        from db.controlled_file_revisions participating_revision
        where participating_revision.id = ${revisionId}
          and participating_revision.status = 'in_review'
          and ${
      this.canReadReviewEvidenceForRevision(
        sql`participating_revision.id`,
        sysUserId,
      )
    }
      )
    `;
  }

  canReadReviewEvidenceForRevision(revisionId: Sql, sysUserId: Sql) {
    return sql`
      exists (
        select 1
        from db.controlled_file_revisions evidence_revision
        where evidence_revision.id = ${revisionId}
          and (
            ${this.canConfigureReview(sysUserId)}
            or (
              ${canReviewControlledFiles(sysUserId)}
              and exists (
                select 1
                from db.controlled_file_reviewers evidence_participant
                where evidence_participant.controlled_file_revision_id =
                    evidence_revision.id
                  and evidence_participant.reviewer_actor_id =
                    ${this.opts.actor.actorIdForSysUserId(sysUserId)}
              )
            )
          )
        )
    `;
  }

  reviewContextKeyForVersion(fileVersionId: Sql, fallback: Sql) {
    return sql`coalesce(
      (
        select 'controlled-review-' || cast(revision.id as string)
        from db.controlled_file_revisions revision
        where revision.file_version_id = ${fileVersionId}
        order by
          case revision.status
            when 'in_review' then 1
            when 'proposed' then 2
            when 'draft' then 3
            when 'approved' then 4
            when 'published' then 5
            when 'rejected' then 6
            else 7
          end,
          revision.id desc
        limit 1
      ),
      ${fallback}
    )`;
  }

  canReadVersion(context: FileVersionAccessContext) {
    const policy = this.canReadVersionPolicy(
      sql`${context.itemRecord}.id`,
      sql`${context.versionRecord}.id`,
      context.sysUserId,
    );
    return this.opts.publishOnUpload
      ? sql`(${
        this.opts.publishOnUpload(sql`${context.spaceRecord}.id`)
      }) or (${policy})`
      : policy;
  }

  private canReadVersionPolicy(
    fileItemId: Sql,
    fileVersionId: Sql,
    sysUserId: Sql,
  ) {
    return sql`
      ${this.canConfigureReview(sysUserId)}
      or exists (
        select 1
        from db.controlled_file_language_variants working_variant
        join db.controlled_file_revisions working_revision
          on working_revision.controlled_file_language_variant_id =
            working_variant.id
        where working_variant.file_item_id = ${fileItemId}
          and (
            working_revision.file_version_id = ${fileVersionId}
            or exists (
              select 1
              from db.controlled_file_revision_file_versions checkpoint
              where checkpoint.controlled_file_revision_id =
                  working_revision.id
                and checkpoint.file_version_id = ${fileVersionId}
            )
          )
          and (
            working_revision.initiated_by_actor_id =
              ${this.opts.actor.actorIdForSysUserId(sysUserId)}
            or (
              ${canReviewControlledFiles(sysUserId)}
              and exists (
                select 1
                from db.controlled_file_reviewers assigned_reviewer
                where assigned_reviewer.controlled_file_revision_id =
                    working_revision.id
                  and assigned_reviewer.reviewer_actor_id =
                    ${this.opts.actor.actorIdForSysUserId(sysUserId)}
              )
            )
          )
      )
      or exists (
        select 1
        from db.controlled_file_language_variants readable_variant
        join db.controlled_file_revisions readable_revision
          on readable_revision.id =
            readable_variant.current_controlled_file_revision_id
        where readable_variant.file_item_id = ${fileItemId}
          and readable_revision.file_version_id = ${fileVersionId}
          and readable_revision.status = 'published'
          and readable_revision.effective_on <= current_date()
      )
    `;
  }

  canCreateFile(context: FileCreateAccessContext) {
    return this.canCreateFilePolicy(
      context.spaceId,
      context.parentItemId,
      context.sysUserId,
    );
  }

  private canCreateFilePolicy(
    _spaceId: Sql,
    _parentItemId: Sql,
    sysUserId: Sql,
  ) {
    return sql`${this.opts.actor.actorIdForSysUserId(sysUserId)} is not null`;
  }

  canCreateVersion(context: FileVersionCreateAccessContext) {
    return this.canCreateVersionPolicy(
      context.spaceId,
      context.itemId,
      context.sysUserId,
    );
  }

  canUpdateItemMetadata(context: FileItemUpdateAccessContext) {
    return canManageControlledFiles(context.sysUserId);
  }

  private canCreateVersionPolicy(
    spaceId: Sql,
    itemId: Sql,
    sysUserId: Sql,
  ) {
    return sql`
      exists (
        select 1
        from db.controlled_file_language_variants editable_variant
        join db.controlled_file_revisions editable_revision
          on editable_revision.controlled_file_language_variant_id =
            editable_variant.id
        join db.file_items editable_item
          on editable_item.id = editable_variant.file_item_id
        where editable_variant.file_item_id = ${itemId}
          and editable_item.file_space_id = ${spaceId}
          and editable_item.trashed_at is null
          and editable_revision.status = 'draft'
          and editable_revision.initiated_by_actor_id =
            ${this.opts.actor.actorIdForSysUserId(sysUserId)}
      )
    `;
  }

  resolvePreferredPublishedRevision(args: {
    fileItemId: Sql;
    preferredLanguage: Sql;
  }) {
    return sql`fn.controlled_preferred_published_revision(
      ${args.fileItemId},
      ${args.preferredLanguage}
    )`;
  }

  /** Inline body of `fn.controlled_preferred_published_revision`. */
  private preferredPublishedRevisionPredicate(args: {
    fileItemId: Sql;
    preferredLanguage: Sql;
  }) {
    return sql`coalesce(
      (
        select preferred_variant.current_controlled_file_revision_id
        from db.controlled_file_language_variants preferred_variant
        join db.controlled_file_revisions preferred_revision
          on preferred_revision.id =
            preferred_variant.current_controlled_file_revision_id
        where preferred_variant.file_item_id =
          ${args.fileItemId}
          and preferred_variant.language = ${args.preferredLanguage}
          and preferred_revision.status = 'published'
          and preferred_revision.effective_on <= current_date()
      ),
      (
        select default_variant.current_controlled_file_revision_id
        from db.controlled_file_language_variants default_variant
        join db.controlled_file_revisions default_revision
          on default_revision.id =
            default_variant.current_controlled_file_revision_id
        where default_variant.file_item_id =
          ${args.fileItemId}
          and default_variant.language =
            ${sql.lit(this.opts.defaultLanguage)}
          and default_revision.status = 'published'
          and default_revision.effective_on <= current_date()
      )
    )`;
  }

  revisionFileItemId(revisionId: Sql) {
    return sql`(
      select variant.file_item_id
      from db.controlled_file_revisions revision
      join db.controlled_file_language_variants variant
        on variant.id =
          revision.controlled_file_language_variant_id
      where revision.id = ${revisionId}
    )`;
  }

  versionUploadMetadataError(context: {
    spaceId: Sql;
    contentType: Sql;
    externalUrl: Sql;
  }): Sql {
    return sql`case when ${
      this.opts.publishOnUpload?.(context.spaceId) ?? sql.false
    }
      and ${context.contentType} not in ('application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp')
      and not ${isPlayableVideoMime(context.contentType)}
      and not (${context.contentType} = 'application/vnd.yolm.video-link'
        and ${context.externalUrl} is not null)
      then 'Upload a PDF, image (JPG, PNG, GIF, WebP), or video (MP4, WebM, Ogg, MOV).' end`;
  }

  onVersionCreated(
    s: ServerStatementsBase<any>,
    event: FileVersionCreatedEvent,
  ) {
    if (this.opts.publishOnUpload) {
      s.defScalar("dc_uploaded_revision_created", sql.false);
      s.if(this.opts.publishOnUpload(event.spaceId), (s) => {
        s.throwErrorIf(
          sql`not coalesce(${
            this.#requiredFiles().runtimeAccessSql(
              event.spaceId,
              event.sysUserId,
              "write",
            )
          }, false)`,
          sql.lit`You cannot upload files to this workspace.`,
        );
        s.throwErrorUnless(
          sql`${event.language ?? sql.null} is null or ${
            sql.inList(
              event.language ?? sql.null,
              this.opts.languages.map((language) => sql.lit(language.code)),
            )
          }`,
          sql.lit`Select a supported document language.`,
        );
        s.throwErrorIf(
          sql`${event.language ?? sql.null} <> ${
            sql.lit(this.opts.defaultLanguage)
          }
            and not exists (select 1 from db.controlled_file_language_variants where file_item_id = ${event.itemId})`,
          sql.lit`Add the default-language video before adding a translation.`,
        );
        s.if(
          sql`exists (
          select 1 from db.controlled_file_language_variants
          where file_item_id = ${event.itemId}
        ) and (${event.language ?? sql.null} is not null or not exists (
          select 1 from db.controlled_file_revisions revision
          join db.controlled_file_language_variants variant
            on variant.id = revision.controlled_file_language_variant_id
          where variant.file_item_id = ${event.itemId}
            and revision.status in ('draft', 'proposed', 'in_review', 'approved')
        ))`,
          (s) => {
            this.createRevision(s, {
              fileItemId: event.itemId,
              language: sql`coalesce(${event.language ?? sql.null}, ${
                sql.lit(this.opts.defaultLanguage)
              })`,
              revisionLabel: sql`${event.versionNumber}::string`,
              effectiveOn: sql`current_date()`,
              changeSummary: sql.lit`Uploaded file replacement.`,
              actingUser: event.sysUserId,
              uploadedVersionId: event.versionId,
            });
            s.setScalar("dc_uploaded_revision_created", sql.true);
          },
        );
      });
    }
    if (this.opts.publishOnUpload) {
      s.if(
        sql`not dc_uploaded_revision_created`,
        (s) => this.applyVersionToControl(s, event),
      );
    } else {
      this.applyVersionToControl(s, event);
    }
    if (this.opts.publishOnUpload) {
      s.if(this.opts.publishOnUpload(event.spaceId), (s) => {
        s.defRecord(
          "publishing_controlled_revision",
          sql`
          select revision.id, revision.controlled_file_language_variant_id,
                 revision.file_version_id, variant.file_item_id, variant.language
          from db.controlled_file_revisions revision
          join db.controlled_file_language_variants variant
            on variant.id = revision.controlled_file_language_variant_id
          where revision.file_version_id = ${event.versionId}
            and variant.file_item_id = ${event.itemId}
            and revision.status = 'draft'
        `,
        );
        s.throwErrorIf(
          sql`publishing_controlled_revision.id is null`,
          sql.lit`The uploaded revision is unavailable.`,
        );
        this.completePublication(s, event.sysUserId, sql`false`);
      });
    }
  }

  private applyVersionToControl(
    s: ServerStatementsBase<any>,
    event: FileVersionCreatedEvent,
  ) {
    s.if(
      sql`
        exists (
          select 1
          from db.controlled_file_language_variants variant
          where variant.file_item_id = ${event.itemId}
        )
      `,
      (s) => {
        s.defScalar(
          "dc_version_open_revision_id",
          sql`(
            select revision.id
            from db.controlled_file_language_variants variant
            join db.controlled_file_revisions revision
              on revision.controlled_file_language_variant_id = variant.id
            where variant.file_item_id = ${event.itemId}
              and revision.status in (
                'draft',
                'proposed',
                'in_review',
                'approved'
              )
            order by revision.id desc
            limit 1
          )`,
        );
        s.if(sql`dc_version_open_revision_id is null`, (s) =>
          s.throwError(
            sql
              .lit`Start a new controlled revision before uploading or saving a new file version.`,
          ));
        s.if(
          sql`
            exists (
              select 1
              from db.controlled_file_revisions revision
              where revision.id = dc_version_open_revision_id
                and revision.status <> 'draft'
            )
          `,
          (s) =>
            s.throwError(
              sql
                .lit`This controlled revision is locked after it is proposed.`,
            ),
        );
        s.modify(sql`
          update db.controlled_file_revisions
          set file_version_id = ${event.versionId}
          where id = dc_version_open_revision_id
        `);
        s.modify(sql`
          insert into db.controlled_file_revision_file_versions (
            controlled_file_revision_id,
            file_version_id
          ) values (
            dc_version_open_revision_id,
            ${event.versionId}
          )
        `);
      },
    ).else((s) =>
      this.createInitialRevision(s, {
        itemId: event.itemId,
        versionId: event.versionId,
        sysUserId: event.sysUserId,
      })
    );
  }

  private createInitialRevision(
    s: ServerStatementsBase<any>,
    event: {
      itemId: Sql;
      versionId: Sql;
      sysUserId: Sql;
    },
  ) {
    s.if(
      sql`${this.opts.actor.actorIdForSysUserId(event.sysUserId)} is null`,
      (s) =>
        s.throwError(
          sql.lit`A signed-in controlled-file actor is required.`,
        ),
    );
    s.modify(sql`
      insert into db.controlled_file_language_variants (
        file_item_id,
        language
      ) values (
        ${event.itemId},
        ${sql.lit(this.opts.defaultLanguage)}
      )
    `);
    s.defScalar(
      "dc_required_variant_id",
      sql`last_record_id(db.controlled_file_language_variants)`,
    );
    s.modify(sql`
      insert into db.controlled_file_revisions (
        controlled_file_language_variant_id,
        revision_label,
        file_version_id,
        effective_on,
        change_summary,
        initiated_by_actor_id
      ) values (
        dc_required_variant_id,
        'Initial',
        ${event.versionId},
        current_date(),
        'Initial controlled version.',
        ${this.opts.actor.actorIdForSysUserId(event.sysUserId)}
      )
    `);
    s.defScalar(
      "dc_required_revision_id",
      sql`last_record_id(db.controlled_file_revisions)`,
    );
    s.modify(sql`
      insert into db.controlled_file_revision_file_versions (
        controlled_file_revision_id,
        file_version_id
      ) values (
        dc_required_revision_id,
        ${event.versionId}
      )
    `);
  }

  createRevision<T extends ServerStatementsBase<any>>(
    s: T,
    opts: {
      fileItemId: Sql;
      language: Sql;
      revisionLabel: Sql;
      effectiveOn: Sql;
      changeSummary: Sql;
      actingUser?: Sql;
      into?: string;
      /** Attach an already-created upload without an insert-then-update cycle. */
      uploadedVersionId?: Sql;
    },
  ) {
    const files = this.#requiredFiles();
    const actingUser = opts.actingUser ?? sql`current_user`;
    const result = opts.into ?? "created_controlled_revision_id";
    if (this.opts.publishOnUpload) {
      s.throwErrorIf(
        sql`exists (
        select 1 from db.file_items item
        join db.file_versions version on version.id = item.current_file_version_id
        where item.id = ${opts.fileItemId}
          and ${this.opts.publishOnUpload(sql`item.file_space_id`)}
          and lower(version.content_type) like 'image/%'
          and ${opts.language} != ${sql.lit(this.opts.defaultLanguage)}
      )`,
        sql.lit`Images are shared across languages.`,
      );
    }
    s.if(
      sql`trim(${opts.revisionLabel}) = ''`,
      (s) => s.throwError(sql.lit`Enter a controlled revision label.`),
    );
    s.if(
      sql`not (${
        sql.inList(
          opts.language,
          this.opts.languages.map((language) => sql.lit(language.code)),
        )
      })`,
      (s) => s.throwError(sql.lit`Select a supported document language.`),
    );
    s.if(
      sql`
        not exists (
          select 1
          from db.file_items item
          where item.id = ${opts.fileItemId}
            and item.item_kind = 'file'
            and item.current_file_version_id is not null
            and item.trashed_at is null
            and ${
        files.extensionEnabledSql(
          sql`item.file_space_id`,
          this.name,
        )
      }
            and ${
        files.runtimeAccessSql(
          sql`item.file_space_id`,
          actingUser,
          "read",
        )
      }
            and ${this.opts.actor.actorIdForSysUserId(actingUser)} is not null
        )
      `,
      (s) => s.throwError(sql.lit`This controlled file is unavailable.`),
    );
    s.defScalar(
      "dc_work_variant_id",
      sql`(
        select variant.id
        from db.controlled_file_language_variants variant
        where variant.file_item_id = ${opts.fileItemId}
          and variant.language = ${opts.language}
      )`,
    );
    s.if(sql`dc_work_variant_id is null`, (s) => {
      s.modify(sql`
        insert into db.controlled_file_language_variants (
          file_item_id,
          language
        ) values (
          ${opts.fileItemId},
          ${opts.language}
        )
      `);
      s.setScalar(
        "dc_work_variant_id",
        sql`last_record_id(db.controlled_file_language_variants)`,
      );
    });
    s.if(
      sql`
        exists (
          select 1
          from db.controlled_file_revisions revision
          join db.controlled_file_language_variants open_variant
            on open_variant.id =
              revision.controlled_file_language_variant_id
          where open_variant.file_item_id = ${opts.fileItemId}
            and revision.status in (
              'draft',
              'proposed',
              'in_review',
              'approved'
            )
        )
      `,
      (s) =>
        s.throwError(
          sql
            .lit`Finish the open controlled revision before starting another language or revision.`,
        ),
    );
    s.if(
      sql`
        ${opts.language} <> ${sql.lit(this.opts.defaultLanguage)}
        and not exists (
          select 1
          from db.controlled_file_language_variants default_variant
          join db.controlled_file_revisions default_revision
            on default_revision.id =
              default_variant.current_controlled_file_revision_id
          where default_variant.file_item_id = ${opts.fileItemId}
            and default_variant.language =
              ${sql.lit(this.opts.defaultLanguage)}
            and default_revision.status = 'published'
        )
      `,
      (s) =>
        s.throwError(
          sql
            .lit`Publish the default-language revision before starting a translation.`,
        ),
    );
    s.defScalar(
      "dc_start_version_id",
      sql`(
          select coalesce(
            (
              select current_revision.file_version_id
              from db.controlled_file_language_variants current_variant
              join db.controlled_file_revisions current_revision
                on current_revision.id =
                  current_variant.current_controlled_file_revision_id
              where current_variant.id = dc_work_variant_id
            ),
            (
              select default_revision.file_version_id
              from db.controlled_file_language_variants default_variant
              join db.controlled_file_revisions default_revision
                on default_revision.id =
                  default_variant.current_controlled_file_revision_id
              where default_variant.file_item_id =
                ${opts.fileItemId}
                and default_variant.language =
                  ${sql.lit(this.opts.defaultLanguage)}
            ),
            (
              select item.current_file_version_id
              from db.file_items item
              where item.id = ${opts.fileItemId}
            )
          )
        )`,
    );
    s.modify(sql`
      insert into db.controlled_file_revisions (
        controlled_file_language_variant_id,
        revision_label,
        source_controlled_file_revision_id,
        file_version_id,
        effective_on,
        change_summary,
        initiated_by_actor_id
      ) values (
        dc_work_variant_id,
        trim(${opts.revisionLabel}),
        (
          select case
            when variant.language = ${sql.lit(this.opts.defaultLanguage)}
              then variant.current_controlled_file_revision_id
            else (
              select default_variant.current_controlled_file_revision_id
              from db.controlled_file_language_variants default_variant
              where default_variant.file_item_id =
                ${opts.fileItemId}
                and default_variant.language =
                  ${sql.lit(this.opts.defaultLanguage)}
            )
          end
          from db.controlled_file_language_variants variant
          where variant.id = dc_work_variant_id
        ),
        ${opts.uploadedVersionId ?? sql`dc_start_version_id`},
        ${opts.effectiveOn},
        nullif(trim(${opts.changeSummary}), ''),
        ${this.opts.actor.actorIdForSysUserId(actingUser)}
      )
    `);
    s.defScalar(
      result,
      opts.uploadedVersionId
        ? sql`(select id from db.controlled_file_revisions
          where controlled_file_language_variant_id = dc_work_variant_id
            and file_version_id = ${opts.uploadedVersionId} and status = 'draft')`
        : sql`last_record_id(db.controlled_file_revisions)`,
    );
    // This creator owns both the starting snapshot and the uploaded checkpoint.
    // Ordinary draft edits add their later checkpoints in applyVersionToControl.
    s.modify(sql`
      insert into db.controlled_file_revision_file_versions (
        controlled_file_revision_id, file_version_id
      )
      select ${sql.ref(result)}, dc_start_version_id
      ${
      opts.uploadedVersionId
        ? sql`union select ${sql.ref(result)}, ${opts.uploadedVersionId}`
        : sql``
    }
    `);
  }

  submitProposal(
    s: ServerStatementsBase<any>,
    revisionId: Sql,
    actingUser: Sql = sql`current_user`,
  ) {
    const files = this.#requiredFiles();
    this.assertRevisionAccess(s, revisionId, files, "read", actingUser);
    s.defScalar(
      "submitting_proposal_actor_id",
      this.opts.actor.actorIdForSysUserId(actingUser),
    );
    s.startTransaction();
    s.if(
      sql`
        not exists (
          select 1
          from db.controlled_file_revisions revision
          where revision.id = ${revisionId}
            and revision.status = 'draft'
            and revision.initiated_by_actor_id =
              submitting_proposal_actor_id
        )
      `,
      (s) =>
        s.throwError(
          sql.lit`Only the draft owner can submit this proposal.`,
        ),
    );
    if (
      this.opts.languages.some((language) =>
        language.code !== this.opts.defaultLanguage
      )
    ) {
      s.if(
        sql`
          exists (
            select 1
            from db.controlled_file_revisions revision
            join db.controlled_file_language_variants variant
              on variant.id =
                revision.controlled_file_language_variant_id
            where revision.id = ${revisionId}
              and variant.language <>
                ${sql.lit(this.opts.defaultLanguage)}
              and (
                select count(*)
                from db.controlled_file_revision_file_versions checkpoint
                where checkpoint.controlled_file_revision_id = revision.id
              ) <= 1
          )
        `,
        (s) =>
          s.throwError(
            sql
              .lit`Save or upload the translated content before submitting this proposal.`,
          ),
      );
    }
    if (this.opts.proposalCoordinator) {
      const coordinator = this.opts.proposalCoordinator;
      s.if(
        sql`not exists (
          select 1
          from db.${sql.ref(this.opts.actor.actorTable)} coordinator_actor
          where ${
          this.canConfigureReview(
            this.opts.actor.actorSysUserId(sql`coordinator_actor`),
          )
        }
            and ${
          coordinator.canReceiveProposal?.(
            this.opts.actor.actorSysUserId(sql`coordinator_actor`),
            revisionId,
          ) ?? sql`true`
        }
        )`,
        (s) =>
          s.throwError(
            sql.lit(
              `No eligible ${this.proposalCoordinatorDisplayName} is configured. Ask an administrator to assign one before submitting.`,
            ),
          ),
      );
    }
    s.defScalar("submitted_controlled_proposal_id", { type: "BigInt" });
    s.modify(sql`
      update db.controlled_file_revisions
      set status = 'proposed'
      where id = ${revisionId}
        and status = 'draft'
        and initiated_by_actor_id = submitting_proposal_actor_id
      returning id into submitted_controlled_proposal_id
    `);
    s.if(
      sql`submitted_controlled_proposal_id is null`,
      (s) =>
        s.throwError(sql.lit`Only the draft owner can submit this proposal.`),
    );
    for (const consumer of this.#workflowConsumers) {
      consumer.onProposalSubmitted?.(s, this.workflowEvent(revisionId));
    }
    s.commitTransaction();
  }

  assignReviewer(
    s: ServerStatementsBase<any>,
    revisionId: Sql,
    reviewerActorId: Sql,
    actingUser: Sql = sql`current_user`,
  ) {
    const files = this.#requiredFiles();
    this.assertRevisionAccess(s, revisionId, files, "read", actingUser);
    s.if(
      sql`
        not ${this.canConfigureReview(actingUser)}
      `,
      (s) => s.throwError(sql.lit`You cannot configure controlled reviews.`),
    );
    s.if(
      sql`
        not exists (
          select 1
          from db.${sql.ref(this.opts.actor.actorTable)} reviewer_actor
          join db.controlled_file_revisions revision
            on revision.id = ${revisionId}
          join db.controlled_file_language_variants variant
            on variant.id =
              revision.controlled_file_language_variant_id
          join db.file_items item on item.id = variant.file_item_id
          where reviewer_actor.id = ${reviewerActorId}
            and ${
        canReviewControlledFiles(
          this.opts.actor.actorSysUserId(sql`reviewer_actor`),
        )
      }
            and ${
        files.runtimeAccessSql(
          sql`item.file_space_id`,
          this.opts.actor.actorSysUserId(sql`reviewer_actor`),
          "read",
        )
      }
        )
      `,
      (s) =>
        s.throwError(
          sql
            .lit`The reviewer must be able to review and view this file space.`,
        ),
    );
    s.startTransaction();
    s.if(
      sql`
        not exists (
          select 1
          from db.controlled_file_revisions revision
          where revision.id = ${revisionId}
            and revision.status in ('proposed', 'in_review')
        )
      `,
      (s) =>
        s.throwError(
          sql
            .lit`Reviewers can only be changed for a proposed or in-review revision.`,
        ),
    );
    s.modify(sql`
      insert into db.controlled_file_reviewers (
        controlled_file_revision_id,
        step_number,
        reviewer_actor_id
      ) values (
        ${revisionId},
        coalesce((
          select max(reviewer.step_number) + 1
          from db.controlled_file_reviewers reviewer
          where reviewer.controlled_file_revision_id = ${revisionId}
        ), 1),
        ${reviewerActorId}
      )
    `);
    s.commitTransaction();
  }

  removeReviewer(
    s: ServerStatementsBase<any>,
    revisionId: Sql,
    reviewerId: Sql,
    actingUser: Sql = sql`current_user`,
  ) {
    const files = this.#requiredFiles();
    const reviewerRemovedConsumers = this.#workflowConsumers.filter(
      (consumer) => consumer.onReviewerRemoved !== undefined,
    );
    this.assertRevisionAccess(s, revisionId, files, "read", actingUser);
    s.if(
      sql`not ${this.canConfigureReview(actingUser)}`,
      (s) => s.throwError(sql.lit`You cannot configure controlled reviews.`),
    );
    s.block((s) => {
      s.startTransaction();
      s.defScalar(
        "removed_controlled_reviewer_was_current",
        sql`exists (
        select 1
        from db.controlled_file_reviewers reviewer
        join db.controlled_file_revisions revision
          on revision.id = reviewer.controlled_file_revision_id
        where reviewer.id = ${reviewerId}
          and reviewer.controlled_file_revision_id = ${revisionId}
          and reviewer.decision is null
          and revision.status = 'in_review'
          and not exists (
            select 1
            from db.controlled_file_reviewers earlier
            where earlier.controlled_file_revision_id =
              reviewer.controlled_file_revision_id
              and earlier.step_number < reviewer.step_number
              and earlier.decision is null
          )
        )`,
      );
      if (reviewerRemovedConsumers.length > 0) {
        s.defScalar(
          "removed_controlled_reviewer_actor_id",
          sql`(
            select reviewer.reviewer_actor_id
            from db.controlled_file_reviewers reviewer
            where reviewer.id = ${reviewerId}
              and reviewer.controlled_file_revision_id = ${revisionId}
          )`,
        );
      }
      s.if(
        sql`
        not exists (
          select 1
          from db.controlled_file_reviewers reviewer
          join db.controlled_file_revisions revision
            on revision.id = reviewer.controlled_file_revision_id
          where reviewer.id = ${reviewerId}
            and reviewer.controlled_file_revision_id = ${revisionId}
            and reviewer.decision is null
            and revision.status in ('proposed', 'in_review')
            and (
              revision.status = 'proposed'
              or exists (
                select 1
                from db.controlled_file_reviewers remaining_reviewer
                where remaining_reviewer.controlled_file_revision_id =
                  reviewer.controlled_file_revision_id
                  and remaining_reviewer.id <> reviewer.id
                  and remaining_reviewer.decision is null
              )
            )
        )
      `,
        (s) =>
          s.throwError(
            sql
              .lit`Only pending reviewers can be removed, and an in-review revision must keep at least one pending reviewer.`,
          ),
      );
      s.modify(sql`
      delete from db.controlled_file_reviewers
      where id = ${reviewerId}
        and controlled_file_revision_id = ${revisionId}
      `);
      // Move every remaining step above the route's current range before
      // compacting it. Updating 2 -> 1 and 3 -> 2 directly can transiently
      // collide with the unique (revision, step_number) constraint.
      s.modify(sql`
      update db.controlled_file_reviewers reviewer
      set step_number = reviewer.step_number + route_offset.value
      from (
        select coalesce(max(route_reviewer.step_number), 0) + 1 as value
        from db.controlled_file_reviewers route_reviewer
        where route_reviewer.controlled_file_revision_id = ${revisionId}
      ) route_offset
      where reviewer.controlled_file_revision_id = ${revisionId}
      `);
      s.modify(sql`
      update db.controlled_file_reviewers reviewer
      set step_number = (
        select count(*)
        from db.controlled_file_reviewers prior
        where prior.controlled_file_revision_id = ${revisionId}
          and (
            prior.step_number < reviewer.step_number
            or (
              prior.step_number = reviewer.step_number
              and prior.id <= reviewer.id
            )
          )
      )
      where reviewer.controlled_file_revision_id = ${revisionId}
      `);
      for (const consumer of reviewerRemovedConsumers) {
        consumer.onReviewerRemoved!(s, {
          ...this.workflowEvent(revisionId),
          removedReviewerActorId: sql`removed_controlled_reviewer_actor_id`,
          wasCurrentReviewer: sql`removed_controlled_reviewer_was_current`,
        });
      }
      s.if(sql`removed_controlled_reviewer_was_current`, (s) => {
        for (const consumer of this.#workflowConsumers) {
          consumer.onReviewRouteAdvanced?.(s, this.workflowEvent(revisionId));
        }
      });
      s.commitTransaction();
    });
  }

  submitForReview(
    s: ServerStatementsBase<any>,
    revisionId: Sql,
    actingUser: Sql = sql`current_user`,
  ) {
    const files = this.#requiredFiles();
    this.assertRevisionAccess(s, revisionId, files, "read", actingUser);
    s.if(
      sql`
        not ${this.canConfigureReview(actingUser)}
      `,
      (s) => s.throwError(sql.lit`You cannot submit controlled revisions.`),
    );
    s.startTransaction();
    s.if(
      sql`
        not exists (
          select 1
          from db.controlled_file_revisions revision
          where revision.id = ${revisionId}
            and revision.status = 'proposed'
        )
      `,
      (s) =>
        s.throwError(
          sql.lit`Only proposed revisions can be submitted for review.`,
        ),
    );
    s.if(
      sql`
        not exists (
          select 1
          from db.controlled_file_reviewers reviewer
          where reviewer.controlled_file_revision_id = ${revisionId}
        )
      `,
      (s) =>
        s.throwError(
          sql.lit`Assign at least one reviewer before submitting.`,
        ),
    );
    s.modify(sql`
      update db.controlled_file_revisions
      set status = 'in_review'
      where id = ${revisionId}
        and status = 'proposed'
    `);
    for (const consumer of this.#workflowConsumers) {
      consumer.onReviewStarted?.(s, this.workflowEvent(revisionId));
    }
    s.commitTransaction();
  }

  stopReview(
    s: ServerStatementsBase<any>,
    revisionId: Sql,
    actingUser: Sql = sql`current_user`,
  ) {
    const files = this.#requiredFiles();
    this.assertRevisionAccess(s, revisionId, files, "read", actingUser);
    s.if(
      sql`not ${this.canConfigureReview(actingUser)}`,
      (s) => s.throwError(sql.lit`You cannot stop controlled reviews.`),
    );
    s.startTransaction();
    s.if(
      sql`
        not exists (
          select 1
          from db.controlled_file_revisions revision
          where revision.id = ${revisionId}
            and revision.status = 'in_review'
            and not exists (
              select 1
              from db.controlled_file_reviewers reviewer
              where reviewer.controlled_file_revision_id = revision.id
                and reviewer.decision is not null
            )
        )
      `,
      (s) =>
        s.throwError(
          sql
            .lit`An approval review can only be stopped before a reviewer has decided. Cancel the proposal instead to preserve completed decisions.`,
        ),
    );
    s.defScalar("stopped_controlled_review_id", { type: "BigInt" });
    s.modify(sql`
      update db.controlled_file_revisions
      set status = 'proposed'
      where id = ${revisionId}
        and status = 'in_review'
        and not exists (
          select 1
          from db.controlled_file_reviewers reviewer
          where reviewer.controlled_file_revision_id = ${revisionId}
            and reviewer.decision is not null
        )
      returning id into stopped_controlled_review_id
    `);
    s.if(sql`stopped_controlled_review_id is null`, (s) =>
      s.throwError(
        sql
          .lit`The approval review changed before it could be stopped. Refresh and try again.`,
      ));
    for (const consumer of this.#workflowConsumers) {
      consumer.onReviewStopped?.(s, this.workflowEvent(revisionId));
    }
    s.modify(sql`
      delete from db.controlled_file_reviewers
      where controlled_file_revision_id = ${revisionId}
    `);
    s.commitTransaction();
  }

  disregardProposal(
    s: ServerStatementsBase<any>,
    revisionId: Sql,
    reason: Sql,
    actingUser: Sql = sql`current_user`,
  ) {
    const files = this.#requiredFiles();
    this.assertRevisionAccess(s, revisionId, files, "read", actingUser);
    s.if(
      sql`not ${this.canConfigureReview(actingUser)} and not exists (
        select 1 from db.controlled_file_revisions
        where id = ${revisionId}
          and initiated_by_actor_id = ${
        this.opts.actor.actorIdForSysUserId(actingUser)
      }
      )`,
      (s) => s.throwError(sql.lit`You cannot cancel this proposal.`),
    );
    s.if(
      sql`nullif(trim(${reason}), '') is null`,
      (s) => s.throwError(sql.lit`Enter a reason for canceling this proposal.`),
    );
    s.if(
      sql`${this.opts.actor.actorIdForSysUserId(actingUser)} is null`,
      (s) =>
        s.throwError(
          sql.lit`A signed-in controlled-file actor is required.`,
        ),
    );
    s.startTransaction();
    s.defScalar("disregarded_controlled_proposal_id", { type: "BigInt" });
    s.modify(sql`
      update db.controlled_file_revisions
      set
        status = 'rejected',
        disregarded_by_actor_id = ${
      this.opts.actor.actorIdForSysUserId(actingUser)
    },
        disregarded_at = now(),
        disregard_reason = trim(${reason})
      where id = ${revisionId}
        and status in ('draft', 'proposed', 'in_review', 'approved')
      returning id into disregarded_controlled_proposal_id
    `);
    s.if(sql`disregarded_controlled_proposal_id is null`, (s) =>
      s.throwError(
        sql
          .lit`Only a draft, proposed, in-review, or approved proposal can be canceled.`,
      ));
    for (const consumer of this.#workflowConsumers) {
      consumer.onProposalDisregarded?.(s, this.workflowEvent(revisionId));
    }
    s.commitTransaction();
  }

  decideReview(
    s: ServerStatementsBase<any>,
    revisionId: Sql,
    decision: "approved" | "rejected",
    notes: Sql,
    actingUser: Sql = sql`current_user`,
  ) {
    s.startTransaction();
    s.callStoredProcedure("controlled_file_apply_review_decision", {
      inputScalars: {
        p_revision_id: revisionId,
        p_decision: sql.lit(decision),
        p_notes: notes,
        p_user_id: actingUser,
      },
    });
    s.commitTransaction();
  }

  private applyReviewDecision(
    s: ServerStatementsBase<any>,
    revisionId: Sql,
    decision: Sql,
    notes: Sql,
    actingUser: Sql = sql`current_user`,
  ) {
    const files = this.#requiredFiles();
    this.assertRevisionAccess(s, revisionId, files, "read", actingUser);
    s.if(
      sql`
        not ${canReviewControlledFiles(actingUser)}
      `,
      (s) => s.throwError(sql.lit`You cannot review controlled revisions.`),
    );
    s.defScalar(
      "current_controlled_file_actor_id",
      this.opts.actor.actorIdForSysUserId(actingUser),
    );
    s.defScalar(
      "assigned_controlled_reviewer_id",
      sql`(
        select reviewer.id
        from db.controlled_file_reviewers reviewer
        join db.controlled_file_revisions revision
          on revision.id = reviewer.controlled_file_revision_id
        where reviewer.controlled_file_revision_id = ${revisionId}
          and reviewer.reviewer_actor_id = current_controlled_file_actor_id
          and reviewer.decision is null
          and revision.status = 'in_review'
      )`,
    );
    s.if(sql`assigned_controlled_reviewer_id is null`, (s) => {
      s.throwError(
        sql.lit`This review is not currently assigned to you.`,
      );
    });
    s.callStoredProcedure("controlled_file_record_review_decision", {
      inputScalars: {
        p_reviewer_id: sql`assigned_controlled_reviewer_id`,
        p_actor_id: sql`current_controlled_file_actor_id`,
        p_decision: decision,
        p_notes: notes,
      },
    });
    s.if(sql`${decision} = 'rejected'`, (s) => {
      s.modify(sql`update db.controlled_file_revisions
        set status = 'rejected' where id = ${revisionId}`);
    });
    s.if(
      sql`not exists (select 1 from db.controlled_file_reviewers
      where controlled_file_revision_id = ${revisionId} and decision is distinct from 'approved')`,
      (s) => {
        s.modify(sql`update db.controlled_file_revisions
        set status = 'approved', approved_by_actor_id = current_controlled_file_actor_id,
          approved_at = now() where id = ${revisionId}`);
      },
    );
    for (const outcome of ["approved", "rejected"] as const) {
      s.if(sql`${decision} = ${sql.lit(outcome)}`, (s) => {
        for (const consumer of this.#workflowConsumers) {
          consumer.onReviewDecided?.(s, {
            ...this.workflowEvent(revisionId),
            decision: outcome,
            decidedByActorId: sql`current_controlled_file_actor_id`,
          });
        }
      });
    }
  }

  publish(
    s: ServerStatementsBase<any>,
    revisionId: Sql,
    actingUser: Sql = sql`current_user`,
    publicationActionConfirmed: Sql = sql`false`,
  ) {
    const files = this.#requiredFiles();
    this.assertRevisionAccess(s, revisionId, files, "read", actingUser);
    s.if(
      sql`
        not ${this.canPublish(actingUser)}
      `,
      (s) => s.throwError(sql.lit`You cannot publish controlled revisions.`),
    );
    s.if(
      sql`${this.opts.actor.actorIdForSysUserId(actingUser)} is null`,
      (s) =>
        s.throwError(
          sql.lit`A signed-in controlled-file actor is required.`,
        ),
    );
    s.startTransaction();
    s.defRecord(
      "publishing_controlled_revision",
      sql`
        select
          revision.id,
          revision.controlled_file_language_variant_id,
          revision.file_version_id,
          revision.effective_on,
          revision.published_by_actor_id,
          variant.file_item_id,
          variant.language
        from db.controlled_file_revisions revision
        join db.controlled_file_language_variants variant
          on variant.id =
            revision.controlled_file_language_variant_id
        where revision.id = ${revisionId}
          and revision.status = 'approved'
      `,
    );
    s.if(sql`publishing_controlled_revision.id is null`, (s) => {
      s.throwError(sql.lit`Only approved revisions can be published.`);
    });
    s.if(
      sql`publishing_controlled_revision.effective_on > current_date()`,
      (s) =>
        s.throwError(
          sql.lit`This revision cannot be published before its effective date.`,
        ),
    );
    this.completePublication(s, actingUser, publicationActionConfirmed);
    s.commitTransaction();
  }

  /**
   * Imports the first revision of an existing approved document or translation.
   * The caller owns the transaction, including the draft and uploaded bytes.
   * Any external approval reference is recorded in the summary; no internal
   * reviewer or approval timestamp is fabricated. Later revisions use the normal
   * workflow.
   */
  importPublishedRevision(
    s: ServerStatementsBase<any>,
    opts: {
      fileItemId: Sql;
      language: Sql;
      /** Required for translations: the exact published default-language revision on this item. */
      sourceRevisionId?: Sql;
      revisionLabel: Sql;
      effectiveOn: Sql;
      approvalReference: Sql;
      actingUser: Sql;
    },
  ) {
    const files = this.#requiredFiles();
    const sourceRevisionId = opts.sourceRevisionId ?? sql`null::bigint`;
    s.throwErrorIf(
      sql`not coalesce(${this.canPublish(opts.actingUser)}, false)`,
      sql.lit`You cannot import published policies.`,
    );
    s.throwErrorIf(
      sql`nullif(trim(${opts.revisionLabel}), '') is null
        or ${opts.effectiveOn} is null
        or ${opts.effectiveOn} > current_date()`,
      sql
        .lit`Enter a revision and an effective date on or before today.`,
    );
    s.throwErrorIf(
      sql`not coalesce(${
        sql.inList(
          opts.language,
          this.opts.languages.map((language) => sql.lit(language.code)),
        )
      }, false)`,
      sql.lit`Select a supported document language.`,
    );
    s.throwErrorIf(
      sql`case when ${opts.language} = ${sql.lit(this.opts.defaultLanguage)}
        then ${sourceRevisionId} is not null
        else not exists (
          select 1 from db.controlled_file_revisions source
          join db.controlled_file_language_variants source_variant
            on source_variant.id = source.controlled_file_language_variant_id
          where source.id = ${sourceRevisionId}
            and source_variant.file_item_id = ${opts.fileItemId}
            and source_variant.language = ${sql.lit(this.opts.defaultLanguage)}
            and source.status in ('published', 'superseded')
            and source.published_at is not null
        ) end`,
      sql
        .lit`Select the published default-language revision this translation belongs to.`,
    );
    s.defRecord(
      "publishing_controlled_revision",
      sql`
        select revision.id, revision.controlled_file_language_variant_id,
          revision.file_version_id, variant.file_item_id,
          ${opts.language} as language
        from db.controlled_file_revisions revision
        join db.controlled_file_language_variants variant
          on variant.id = revision.controlled_file_language_variant_id
        join db.file_items item on item.id = variant.file_item_id
        where item.id = ${opts.fileItemId}
          and item.trashed_at is null
          and revision.status = 'draft'
          and variant.language = ${opts.language}
          and revision.initiated_by_actor_id = ${
        this.opts.actor.actorIdForSysUserId(opts.actingUser)
      }
          and revision.approved_at is null
          and revision.published_at is null
          and ${files.extensionEnabledSql(sql`item.file_space_id`, this.name)}
          and ${
        files.runtimeAccessSql(sql`item.file_space_id`, opts.actingUser, "read")
      }
          and ${
        files.runtimeAccessSql(
          sql`item.file_space_id`,
          opts.actingUser,
          "write",
        )
      }
          and (case when ${opts.language} = ${
        sql.lit(this.opts.defaultLanguage)
      } then
            revision.source_controlled_file_revision_id is null
            and (select count(*) from db.file_versions version
              where version.file_item_id = item.id) = 1
            and (
            select count(*) from db.controlled_file_revisions other_revision
            join db.controlled_file_language_variants other_variant
              on other_variant.id = other_revision.controlled_file_language_variant_id
            where other_variant.file_item_id = item.id
            ) = 1
          else
            revision.source_controlled_file_revision_id is not null
            and (select count(*) from db.controlled_file_revisions other_revision
              where other_revision.controlled_file_language_variant_id = variant.id) = 1
            and (select count(*) from db.controlled_file_revision_file_versions checkpoint
              where checkpoint.controlled_file_revision_id = revision.id) = 2
          end)
          and not exists (
            select 1 from db.controlled_file_reviewers reviewer
            where reviewer.controlled_file_revision_id = revision.id
          )
      `,
    );
    s.throwErrorIf(
      sql`publishing_controlled_revision.id is null`,
      sql
        .lit`Only a newly uploaded initial revision with no review history can be imported as published.`,
    );
    s.modify(sql`
      update db.controlled_file_revisions
      set revision_label = trim(${opts.revisionLabel}),
        source_controlled_file_revision_id = ${sourceRevisionId},
        effective_on = ${opts.effectiveOn},
        change_summary = 'Imported as an already-approved policy.' || coalesce(
          ' Approval reference: ' || nullif(trim(${opts.approvalReference}), ''), '')
      where id = publishing_controlled_revision.id
    `);
    this.completePublication(s, opts.actingUser, sql`false`);
  }

  private completePublication(
    s: ServerStatementsBase<any>,
    actingUser: Sql,
    publicationActionConfirmed: Sql,
  ) {
    s.modify(sql`
      update db.controlled_file_revisions
      set status = 'superseded'
      where controlled_file_language_variant_id =
        publishing_controlled_revision.controlled_file_language_variant_id
        and status = 'published'
    `);
    s.modify(sql`
      update db.controlled_file_revisions
      set
        status = 'published',
        published_by_actor_id = ${
      this.opts.actor.actorIdForSysUserId(
        actingUser,
      )
    },
        published_at = now()
      where id = publishing_controlled_revision.id
    `);
    s.modify(sql`
      update db.controlled_file_language_variants
      set current_controlled_file_revision_id =
        publishing_controlled_revision.id
      where id =
        publishing_controlled_revision.controlled_file_language_variant_id
    `);
    for (const consumer of this.#publicationConsumers) {
      consumer.onPublished(s, {
        fileItemId: sql`publishing_controlled_revision.file_item_id`,
        languageVariantId:
          sql`publishing_controlled_revision.controlled_file_language_variant_id`,
        revisionId: sql`publishing_controlled_revision.id`,
        fileVersionId: sql`publishing_controlled_revision.file_version_id`,
        language: sql`publishing_controlled_revision.language`,
        publishedByActorId: this.opts.actor.actorIdForSysUserId(
          actingUser,
        ),
        publicationActionConfirmed,
      });
    }
  }

  private assertRevisionAccess<T extends ServerStatementsBase<any>>(
    s: T,
    revisionId: Sql,
    files: DriveBlockContract,
    verb: "read" | "write",
    sysUserId: Sql = sql`current_user`,
  ) {
    s.if(
      sql`
        not exists (
          select 1
          from db.controlled_file_revisions revision
          join db.controlled_file_language_variants variant
            on variant.id = revision.controlled_file_language_variant_id
          join db.file_items item on item.id = variant.file_item_id
          where revision.id = ${revisionId}
            and ${
        files.extensionEnabledSql(
          sql`item.file_space_id`,
          this.name,
        )
      }
            and ${
        files.runtimeAccessSql(
          sql`item.file_space_id`,
          sysUserId,
          verb,
        )
      }
        )
      `,
      (s) => s.throwError(sql.lit`This controlled revision is unavailable.`),
    );
  }

  private workflowEvent(revisionId: Sql): ControlledFileWorkflowEvent {
    return {
      revisionId,
      fileItemId: sql`(
        select variant.file_item_id
        from db.controlled_file_revisions revision
        join db.controlled_file_language_variants variant
          on variant.id = revision.controlled_file_language_variant_id
        where revision.id = ${revisionId}
      )`,
      language: sql`(
        select variant.language
        from db.controlled_file_revisions revision
        join db.controlled_file_language_variants variant
          on variant.id = revision.controlled_file_language_variant_id
        where revision.id = ${revisionId}
      )`,
    };
  }

  private canUploadPublishedVersion(itemId: Sql, userId: Sql) {
    const files = this.#requiredFiles();
    return sql`exists (
      select 1 from db.file_items item
      where item.id = ${itemId} and item.item_kind = 'file'
        and item.trashed_at is null
        and ${files.extensionEnabledSql(sql`item.file_space_id`, this.name)}
        and ${this.opts.publishOnUpload?.(sql`item.file_space_id`) ?? sql.false}
        and ${files.runtimeAccessSql(sql`item.file_space_id`, userId, "write")}
    )`;
  }

  registerApi(
    context: Parameters<NonNullable<DriveExtension["registerApi"]>>[0],
  ) {
    if (!this.opts.publishOnUpload) return;
    context.api.post("/files/items/{item_id:id}/published/{language}/upload", {
      query: [
        { name: "file_name", type: { type: "String", maxLength: 500 } },
        { name: "content_type", type: { type: "String", maxLength: 255 } },
      ],
      blobBody: {
        scalar: "published_blob_hash",
        sizeScalar: "published_upload_size",
        maxSize: this.#requiredFiles().opts.maxUploadBytes ??
          2 * 1024 * 1024 * 1024,
        authorize: (s) => {
          context.authenticate(s);
          s.setHeader(sql.lit`Content-Type`, sql.lit`application/json`);
          s.if(
            sql`not coalesce(${
              this.canUploadPublishedVersion(sql`item_id`, sql`auth_user_id`)
            }, false)`,
            (s) => {
              s.setHttpStatus(403);
              s.return(
                sql`json_build_object('error', 'You cannot upload to this workspace.')`,
              );
            },
          );
          s.defScalar("published_upload_content_type", sql`content_type`);
          s.defScalar(
            "published_upload_metadata_error",
            this.#requiredFiles().versionUploadMetadataErrorSql({
              itemId: sql`item_id`,
              fileName: sql`file_name`,
              contentType: sql`published_upload_content_type`,
            }),
          );
          s.if(sql`published_upload_metadata_error is not null`, (s) => {
            s.setHttpStatus(400);
            s.return(
              sql`json_build_object('error', published_upload_metadata_error)`,
            );
          });
          s.if(
            sql`not coalesce(${
              sql.inList(
                sql`language`,
                this.opts.languages.map((language) => sql.lit(language.code)),
              )
            }, false)`,
            (s) => {
              s.setHttpStatus(400);
              s.return(
                sql`json_build_object('error', 'Select a supported document language.')`,
              );
            },
          );
          s.if(
            sql`language <> ${sql.lit(this.opts.defaultLanguage)}
              and exists (select 1 from db.file_versions
                where file_item_id = item_id and version_number = 1
                  and lower(content_type) like 'image/%')`,
            (s) => {
              s.setHttpStatus(400);
              s.return(
                sql`json_build_object('error', 'Images are shared across languages.')`,
              );
            },
          );
          s.if(sql`published_upload_size = 0`, (s) => {
            s.setHttpStatus(400);
            s.return(sql`json_build_object('error', 'Empty file upload')`);
          });
        },
      },
      procedure: (s) => {
        context.authenticate(s);
        s.try({
          body: (s) => {
            s.startTransaction();
            s.callStoredProcedure("controlled_file_upload_published_version", {
              inputScalars: {
                p_item_id: sql`item_id`,
                p_language: sql`language`,
                p_file_name: sql`file_name`,
                p_content_type: sql`content_type`,
                p_blob_hash: sql`published_blob_hash`,
                p_byte_length: sql`published_upload_size`,
                p_user_id: sql`auth_user_id`,
              },
              outputScalars: { version_id: "published_version_id" },
            });
            s.commitTransaction();
            s.setHttpStatus(201);
            s.setHeader(sql.lit`Content-Type`, sql.lit`application/json`);
            s.return(sql`json_build_object(
              'success', true, 'itemId', item_id, 'versionId', published_version_id
            )`);
          },
          errorName: "published_upload_error",
          catch: (s) => {
            s.rollbackIfInTransaction();
            s.setHttpStatus(400);
            s.setHeader(sql.lit`Content-Type`, sql.lit`application/json`);
            s.return(
              sql`json_build_object('error', published_upload_error.message)`,
            );
          },
        });
      },
    });
  }

  registerStoredProcedures() {
    // Both policy and training decisions use this compiled boundary. The
    // owning workflow validates access and its editable state in the same tx.
    const sameReview = (alias: string) =>
      sql.or(this.#reviewerTargetFields.map(
        (field) =>
          sql`${sql.ref(alias, field)} = review_step.${sql.ref(field)}`,
      ));
    system.storedProcedure({
      name: "controlled_file_record_review_decision",
      transaction: "caller",
      inputScalars: [
        { name: "p_reviewer_id", type: "BigInt" },
        { name: "p_actor_id", type: "BigInt" },
        { name: "p_decision", type: { type: "String", maxLength: 30 } },
        { name: "p_notes", type: { type: "String", maxLength: 2000 } },
      ],
      procedure: (s) => {
        s.defRecord(
          "review_step",
          sql`select * from db.controlled_file_reviewers where id = p_reviewer_id`,
        );
        s.throwErrorUnless(
          sql`review_step.id is not null
          and review_step.reviewer_actor_id = p_actor_id and review_step.decision is null
          and not exists (select 1 from db.controlled_file_reviewers earlier
            where (${
            sameReview("earlier")
          }) and earlier.step_number < review_step.step_number
              and earlier.decision is distinct from 'approved')`,
          sql.lit`This review is not currently assigned to you.`,
        );
        s.throwErrorUnless(
          sql`p_decision in ('approved', 'rejected')`,
          sql.lit`Choose approve or request changes.`,
        );
        s.modify(sql`update db.controlled_file_reviewers
          set decision = p_decision, notes = nullif(trim(p_notes), ''), decided_at = now()
          where id = review_step.id`);
      },
    });
    system.storedProcedure({
      name: "controlled_file_apply_review_decision",
      transaction: "caller",
      inputScalars: [
        { name: "p_revision_id", type: "BigInt" },
        { name: "p_decision", type: { type: "String", maxLength: 30 } },
        { name: "p_notes", type: { type: "String", maxLength: 2000 } },
        { name: "p_user_id", type: "BigInt" },
      ],
      procedure: (s) =>
        this.applyReviewDecision(
          s,
          sql`p_revision_id`,
          sql`p_decision`,
          sql`p_notes`,
          sql`p_user_id`,
        ),
    });
    if (this.opts.publishOnUpload) {
      system.storedProcedure({
        name: "controlled_file_upload_published_version",
        transaction: "caller",
        inputScalars: [
          { name: "p_item_id", type: "BigInt" },
          { name: "p_language", type: { type: "String", maxLength: 20 } },
          { name: "p_file_name", type: { type: "String", maxLength: 500 } },
          { name: "p_content_type", type: { type: "String", maxLength: 255 } },
          { name: "p_blob_hash", type: { type: "Bytes", maxLength: 32 } },
          { name: "p_byte_length", type: "BigInt" },
          { name: "p_user_id", type: "BigInt" },
        ],
        outputScalars: [{ name: "version_id", type: "BigInt" }],
        procedure: (s) => {
          s.throwErrorIf(
            sql`not coalesce(${
              this.canUploadPublishedVersion(sql`p_item_id`, sql`p_user_id`)
            }, false)`,
            sql.lit`You cannot upload to this workspace.`,
          );
          s.throwErrorIf(
            sql`p_byte_length is null or p_byte_length <= 0
              or p_byte_length > ${
              this.#requiredFiles().opts.maxUploadBytes ??
                2 * 1024 * 1024 * 1024
            }`,
            sql.lit`Choose a non-empty file within the workspace upload limit.`,
          );
          // Rebuild the version and its revision linkage together on every replay.
          this.#requiredFiles().createFileVersion(s, {
            itemId: sql`p_item_id`,
            fileName: sql`p_file_name`,
            contentType: sql`p_content_type`,
            byteLength: sql`p_byte_length`,
            blobHash: sql`p_blob_hash`,
            sysUserId: sql`p_user_id`,
            intoVersion: "version_id",
            language: sql`p_language`,
          });
        },
      });
    }
    system.storedProcedure({
      name: "controlled_file_create_revision",
      transaction: "standalone",
      inputScalars: [
        { name: "p_file_item_id", type: "BigInt" },
        { name: "p_language", type: { type: "String", maxLength: 20 } },
        { name: "p_revision_label", type: "String" },
        { name: "p_effective_on", type: "Date" },
        { name: "p_change_summary", type: "String" },
      ],
      procedure: (s) => {
        s.startTransaction();
        this.createRevision(s, {
          fileItemId: sql`p_file_item_id`,
          language: sql`p_language`,
          revisionLabel: sql`p_revision_label`,
          effectiveOn: sql`p_effective_on`,
          changeSummary: sql`p_change_summary`,
        });
        s.commitTransaction();
      },
    });
    system.storedProcedure({
      name: "controlled_file_submit_proposal",
      transaction: "standalone",
      inputScalars: [{ name: "p_revision_id", type: "BigInt" }],
      procedure: (s) => {
        this.submitProposal(s, sql`p_revision_id`);
      },
    });
    system.storedProcedure({
      name: "controlled_file_assign_reviewer",
      transaction: "standalone",
      inputScalars: [
        { name: "p_revision_id", type: "BigInt" },
        { name: "p_reviewer_actor_id", type: "BigInt" },
      ],
      procedure: (s) => {
        this.assignReviewer(s, sql`p_revision_id`, sql`p_reviewer_actor_id`);
      },
    });
    system.storedProcedure({
      name: "controlled_file_remove_reviewer",
      transaction: "standalone",
      inputScalars: [
        { name: "p_revision_id", type: "BigInt" },
        { name: "p_reviewer_id", type: "BigInt" },
      ],
      procedure: (s) => {
        this.removeReviewer(s, sql`p_revision_id`, sql`p_reviewer_id`);
      },
    });
    system.storedProcedure({
      name: "controlled_file_submit_for_review",
      transaction: "standalone",
      inputScalars: [{ name: "p_revision_id", type: "BigInt" }],
      procedure: (s) => {
        this.submitForReview(s, sql`p_revision_id`);
      },
    });
    system.storedProcedure({
      name: "controlled_file_stop_review",
      transaction: "standalone",
      inputScalars: [{ name: "p_revision_id", type: "BigInt" }],
      procedure: (s) => {
        this.stopReview(s, sql`p_revision_id`);
      },
    });
    system.storedProcedure({
      name: "controlled_file_disregard_proposal",
      transaction: "standalone",
      inputScalars: [
        { name: "p_revision_id", type: "BigInt" },
        {
          name: "p_reason",
          type: { type: "String", maxLength: 2000 },
        },
      ],
      procedure: (s) => {
        this.disregardProposal(s, sql`p_revision_id`, sql`p_reason`);
      },
    });
    system.storedProcedure({
      name: "controlled_file_approve_review",
      transaction: "standalone",
      inputScalars: [
        { name: "p_revision_id", type: "BigInt" },
        { name: "p_notes", type: "String" },
      ],
      procedure: (s) => {
        this.decideReview(s, sql`p_revision_id`, "approved", sql`p_notes`);
      },
    });
    system.storedProcedure({
      name: "controlled_file_reject_review",
      transaction: "standalone",
      inputScalars: [
        { name: "p_revision_id", type: "BigInt" },
        { name: "p_notes", type: "String" },
      ],
      procedure: (s) => {
        this.decideReview(s, sql`p_revision_id`, "rejected", sql`p_notes`);
      },
    });
    system.storedProcedure({
      name: "controlled_file_publish",
      transaction: "standalone",
      inputScalars: [
        { name: "p_revision_id", type: "BigInt" },
        { name: "p_publication_action_confirmed", type: "Bool" },
      ],
      procedure: (s) => {
        this.publish(
          s,
          sql`p_revision_id`,
          sql`current_user`,
          sql`coalesce(p_publication_action_confirmed, false)`,
        );
      },
    });
    const files = this.#requiredFiles();
    const revisionOutputFields: HelperProcField[] = [
      { name: "id", type: "BigInt" },
      { name: "controlled_file_language_variant_id", type: "BigInt" },
      { name: "revision_label", type: { type: "String", maxLength: 80 } },
      { name: "source_controlled_file_revision_id", type: "BigInt" },
      { name: "file_version_id", type: "BigInt" },
      {
        name: "status",
        type: { type: "Enum", enum: "controlled_file_revision_status" },
      },
      { name: "effective_on", type: "Date" },
      { name: "change_summary", type: { type: "String", maxLength: 2000 } },
      { name: "initiated_by_actor_id", type: "BigInt" },
      { name: "initiated_at", type: "TimestampUtc" },
      { name: "approved_by_actor_id", type: "BigInt" },
      { name: "approved_at", type: "TimestampUtc" },
      { name: "disregarded_by_actor_id", type: "BigInt" },
      { name: "disregarded_at", type: "TimestampUtc" },
      { name: "disregard_reason", type: { type: "String", maxLength: 2000 } },
      { name: "published_by_actor_id", type: "BigInt" },
      { name: "published_at", type: "TimestampUtc" },
    ];
    const revisionColumnsSql = (alias: string) =>
      sql`
        ${sql.ref(alias)}.id,
        ${sql.ref(alias)}.controlled_file_language_variant_id,
        ${sql.ref(alias)}.revision_label,
        ${sql.ref(alias)}.source_controlled_file_revision_id,
        ${sql.ref(alias)}.file_version_id,
        ${sql.ref(alias)}.status,
        ${sql.ref(alias)}.effective_on,
        ${sql.ref(alias)}.change_summary,
        ${sql.ref(alias)}.initiated_by_actor_id,
        ${sql.ref(alias)}.initiated_at,
        ${sql.ref(alias)}.approved_by_actor_id,
        ${sql.ref(alias)}.approved_at,
        ${sql.ref(alias)}.disregarded_by_actor_id,
        ${sql.ref(alias)}.disregarded_at,
        ${sql.ref(alias)}.disregard_reason,
        ${sql.ref(alias)}.published_by_actor_id,
        ${sql.ref(alias)}.published_at
      `;
    system.storedProcedure({
      name: "controlled_document_workspace_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_file_item_id", type: "BigInt" },
        { name: "p_language", type: { type: "String", maxLength: 20 } },
      ],
      outputRecords: [
        {
          name: "controlled_document_workspace",
          fields: [
            { name: "current_file_version_id", type: "BigInt" },
            { name: "displayed_file_version_id", type: "BigInt" },
            { name: "displayed_controlled_revision_id", type: "BigInt" },
            { name: "can_fork_working_version", type: "Bool" },
          ],
        },
      ],
      procedure: (s) => {
        s.defRecord(
          "controlled_document_workspace_item",
          sql`
            select
              item.current_file_version_id,
              item.file_space_id,
              item.id as file_item_id,
              variant.id as language_variant_id
            from db.file_items item
            left join db.controlled_file_language_variants variant
              on variant.file_item_id = item.id
              and variant.language = p_language
            where item.id = p_file_item_id
              and ${
            files.runtimeAccessSql(
              sql`item.file_space_id`,
              sql`current_user`,
              "read",
            )
          }
          `,
        );
        s.defRecord(
          "controlled_document_workspace_open_revision",
          sql`
            select revision.id, revision.status, revision.initiated_by_actor_id,
              revision.file_version_id
            from db.controlled_file_revisions revision
            where revision.controlled_file_language_variant_id =
                controlled_document_workspace_item.language_variant_id
              and revision.status in (
                'draft',
                'proposed',
                'in_review',
                'approved'
              )
              and (
                revision.initiated_by_actor_id =
                  ${this.opts.actor.actorIdForSysUserId(sql`current_user`)}
                or ${this.canConfigureReview(sql`current_user`)}
                or (
                  ${canReviewControlledFiles(sql`current_user`)}
                  and exists (
                    select 1
                    from db.controlled_file_reviewers reviewer
                    where reviewer.controlled_file_revision_id =
                        revision.id
                      and reviewer.reviewer_actor_id =
                        ${
            this.opts.actor.actorIdForSysUserId(
              sql`current_user`,
            )
          }
                  )
                )
              )
            order by revision.id desc
            limit 1
          `,
        );
        s.defRecord(
          "controlled_document_workspace_published_revision",
          sql`
                select exact_revision.id, exact_revision.file_version_id
                from db.controlled_file_language_variants exact_variant
                join db.controlled_file_revisions exact_revision
                  on exact_revision.id =
                    exact_variant.current_controlled_file_revision_id
                join db.file_versions exact_version
                  on exact_version.id = exact_revision.file_version_id
                join db.file_items exact_item
                  on exact_item.id = exact_version.file_item_id
                join db.file_spaces exact_space
                  on exact_space.id = exact_item.file_space_id
                where exact_variant.id =
                    controlled_document_workspace_item.language_variant_id
                  and exact_revision.status = 'published'
                  and exact_revision.effective_on <= current_date()
                  and ${
            files.canReadVersionSql({
              spaceRecord: sql`exact_space`,
              itemRecord: sql`exact_item`,
              versionRecord: sql`exact_version`,
              sysUserId: sql`current_user`,
            })
          }
`,
        );
        s.modify(sql`
          insert into controlled_document_workspace
          select
            controlled_document_workspace_item.current_file_version_id,
            coalesce(
              controlled_document_workspace_open_revision.file_version_id,
              controlled_document_workspace_published_revision.file_version_id,
              case
                when not (${
          files.extensionEnabledSql(
            sql`controlled_document_workspace_item.file_space_id`,
            this.name,
          )
        })
                  then
                    controlled_document_workspace_item.current_file_version_id
                else null
              end,
              case
                when controlled_document_workspace_item.file_item_id
                  is null
                  then
                    controlled_document_workspace_item.current_file_version_id
                else null
              end
            ) as displayed_file_version_id,
            coalesce(controlled_document_workspace_open_revision.id,
              controlled_document_workspace_published_revision.id) as displayed_controlled_revision_id,
            coalesce(
              controlled_document_workspace_open_revision.status = 'draft'
                and controlled_document_workspace_open_revision.initiated_by_actor_id =
                  ${this.opts.actor.actorIdForSysUserId(sql`current_user`)},
              false
            ) as can_fork_working_version
        `);
      },
    });
    // Keeps the publication confirmation query out of every panel route.
    const publicationConfirmation = this.publicationConfirmation({
      fileItemId: sql`controlled_file.file_item_id`,
      revisionId: sql`p_revision_id`,
      language: sql`p_language`,
    });
    if (publicationConfirmation) {
      system.storedProcedure({
        name: "controlled_file_publication_confirmation_check",
        transaction: "caller",
        inputScalars: [
          { name: "p_revision_id", type: "BigInt" },
          { name: "p_language", type: { type: "String", maxLength: 20 } },
        ],
        inputRecords: [
          {
            name: "controlled_file",
            fields: [
              { name: "file_item_id", type: "BigInt" },
              { name: "name", type: { type: "String", maxLength: 500 } },
              { name: "file_space_id", type: "BigInt" },
              { name: "current_file_version_id", type: "BigInt" },
              { name: "variant_id", type: "BigInt" },
              { name: "current_controlled_file_revision_id", type: "BigInt" },
            ],
          },
        ],
        outputScalars: [
          { name: "p_required", type: "Bool" },
          { name: "p_description", type: "String" },
        ],
        procedure: (s) => {
          s.setScalar("p_required", false);
          s.setScalar("p_description", sql.lit``);
          s.if(publicationConfirmation.appliesWhen, (s) => {
            s.defRecord(
              "control_publication_confirmation_result",
              publicationConfirmation.query,
            );
            s.setScalar(
              "p_required",
              sql`coalesce(
                control_publication_confirmation_result.required,
                false
              )`,
            );
            s.setScalar(
              "p_description",
              sql`coalesce(
                control_publication_confirmation_result.description,
                ''
              )`,
            );
          });
        },
      });
    }
    system.storedProcedure({
      name: "controlled_file_panel_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_file_item_id", type: "BigInt" },
        { name: "p_language", type: { type: "String", maxLength: 20 } },
      ],
      outputRecords: [
        {
          name: "controlled_file",
          fields: [
            { name: "file_item_id", type: "BigInt" },
            { name: "name", type: { type: "String", maxLength: 500 } },
            { name: "file_space_id", type: "BigInt" },
            { name: "current_file_version_id", type: "BigInt" },
            { name: "variant_id", type: "BigInt" },
            { name: "current_controlled_file_revision_id", type: "BigInt" },
          ],
        },
        {
          name: "open_controlled_revision",
          fields: [
            ...revisionOutputFields,
            { name: "file_version_number", type: "Uint" },
            { name: "content_type", type: { type: "String", maxLength: 255 } },
          ],
        },
      ],
      outputScalars: [
        { name: "can_propose_controlled_revision", type: "Bool" },
        { name: "can_manage_controlled_revision", type: "Bool" },
        { name: "can_review_controlled_revision", type: "Bool" },
        { name: "can_publish_controlled_revision", type: "Bool" },
        { name: "current_controlled_file_actor_id", type: "BigInt" },
        { name: "can_submit_controlled_proposal", type: "Bool" },
        {
          name: "blocking_controlled_revision_language",
          type: { type: "String", maxLength: 20 },
        },
        {
          name: "blocking_controlled_revision_status",
          type: { type: "Enum", enum: "controlled_file_revision_status" },
        },
        { name: "default_controlled_language_published", type: "Bool" },
        { name: "controlled_translation_uses_source_version", type: "Bool" },
        { name: "controlled_translation_needs_new_version", type: "Bool" },
      ],
      procedure: (s) => {
        s.modify(sql`
          insert into controlled_file
          select
            item.id as file_item_id,
            item.name,
            item.file_space_id,
            item.current_file_version_id,
            variant.id as variant_id,
            variant.current_controlled_file_revision_id
          from db.file_items item
          join db.file_spaces space on space.id = item.file_space_id
          left join db.controlled_file_language_variants variant
            on variant.file_item_id = item.id
            and variant.language = p_language
          where item.id = p_file_item_id
            and ${
          files.extensionEnabledForTypeSql(
            sql`space.space_type`,
            this.name,
          )
        }
            and ${
          files.runtimeAccessSql(
            sql`item.file_space_id`,
            sql`current_user`,
            "read",
          )
        }
            and exists (
              select 1
              from db.file_versions readable_version
              where readable_version.file_item_id = item.id
                and ${
          files.canReadVersionSql({
            spaceRecord: sql`space`,
            itemRecord: sql`item`,
            versionRecord: sql`readable_version`,
            sysUserId: sql`current_user`,
          })
        }
            )
        `);
        s.modify(sql`
          insert into open_controlled_revision
          select ${revisionColumnsSql("revision")},
            version.version_number as file_version_number,
            version.content_type
          from db.controlled_file_revisions revision
          join db.file_versions version
            on version.id = revision.file_version_id
          join db.file_items item on item.id = version.file_item_id
          join db.file_spaces space on space.id = item.file_space_id
          where revision.controlled_file_language_variant_id =
            controlled_file.variant_id
            and revision.status in (
              'draft',
              'proposed',
              'in_review',
              'approved'
            )
            and ${
          files.canReadVersionSql({
            spaceRecord: sql`space`,
            itemRecord: sql`item`,
            versionRecord: sql`version`,
            sysUserId: sql`current_user`,
          })
        }
          order by revision.id desc
          limit 1
        `);
        s.defRecord(
          "blocking_controlled_revision",
          sql`
            select
              variant.language,
              revision.status
            from db.controlled_file_revisions revision
            join db.controlled_file_language_variants variant
              on variant.id =
                revision.controlled_file_language_variant_id
            where variant.file_item_id = controlled_file.file_item_id
              and revision.status in (
                'draft',
                'proposed',
                'in_review',
                'approved'
              )
            order by revision.id desc
            limit 1
          `,
        );
        s.setScalar(
          "blocking_controlled_revision_language",
          sql`blocking_controlled_revision.language`,
        );
        s.setScalar(
          "blocking_controlled_revision_status",
          sql`blocking_controlled_revision.status`,
        );
        s.setScalar(
          "default_controlled_language_published",
          sql`
            exists (
              select 1
              from db.controlled_file_language_variants default_variant
              join db.controlled_file_revisions default_revision
                on default_revision.id =
                  default_variant.current_controlled_file_revision_id
              where default_variant.file_item_id =
                  controlled_file.file_item_id
                and default_variant.language =
                  ${sql.lit(this.opts.defaultLanguage)}
                and default_revision.status = 'published'
            )
          `,
        );
        s.setScalar(
          "controlled_translation_uses_source_version",
          sql`
            p_language <> ${sql.lit(this.opts.defaultLanguage)}
            and open_controlled_revision.source_controlled_file_revision_id
              is not null
            and open_controlled_revision.file_version_id = (
              select source_revision.file_version_id
              from db.controlled_file_revisions source_revision
              where source_revision.id =
                open_controlled_revision.source_controlled_file_revision_id
            )
          `,
        );
        s.setScalar(
          "controlled_translation_needs_new_version",
          sql`
            p_language <> ${sql.lit(this.opts.defaultLanguage)}
            and open_controlled_revision.id is not null
            and (
              select count(*)
              from db.controlled_file_revision_file_versions checkpoint
              where checkpoint.controlled_file_revision_id =
                open_controlled_revision.id
            ) <= 1
          `,
        );
        s.setScalar(
          "can_propose_controlled_revision",
          sql`
            ${this.opts.actor.actorIdForSysUserId(sql`current_user`)}
              is not null
          `,
        );
        s.setScalar(
          "can_manage_controlled_revision",
          this.canConfigureReview(sql`current_user`),
        );
        s.setScalar(
          "can_review_controlled_revision",
          canReviewControlledFiles(sql`current_user`),
        );
        s.setScalar(
          "can_publish_controlled_revision",
          this.canPublish(sql`current_user`),
        );
        s.setScalar(
          "current_controlled_file_actor_id",
          this.opts.actor.actorIdForSysUserId(sql`current_user`),
        );
        s.setScalar(
          "can_submit_controlled_proposal",
          sql`
            open_controlled_revision.status = 'draft'
            and open_controlled_revision.initiated_by_actor_id =
              current_controlled_file_actor_id
            and (
              p_language = ${sql.lit(this.opts.defaultLanguage)}
              or not controlled_translation_needs_new_version
            )
          `,
        );
      },
    });
    system.storedProcedure({
      name: "controlled_file_panel_lists_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_variant_id", type: "BigInt" },
        { name: "p_space_id", type: "BigInt" },
        { name: "p_open_revision_id", type: "BigInt" },
        {
          name: "p_review_route_editable",
          type: "Bool",
        },
      ],
      outputTables: [
        {
          name: "controlled_revision_history",
          fields: [
            ...revisionOutputFields,
            { name: "rejected_by_name", type: "String" },
            {
              name: "rejection_notes",
              type: { type: "String", maxLength: 2000 },
            },
            { name: "disregarded_by_name", type: "String" },
          ],
        },
        {
          name: "controlled_reviewers",
          fields: [
            { name: "id", type: "BigInt" },
            { name: "controlled_file_revision_id", type: "BigInt" },
            { name: "step_number", type: "Uint" },
            { name: "reviewer_actor_id", type: "BigInt" },
            {
              name: "decision",
              type: { type: "Enum", enum: "controlled_file_review_decision" },
            },
            { name: "notes", type: { type: "String", maxLength: 2000 } },
            { name: "decided_at", type: "TimestampUtc" },
            { name: "reviewer_name", type: "String" },
          ],
        },
        {
          name: "controlled_available_reviewers",
          fields: [
            { name: "id", type: "BigInt" },
            { name: "display_name", type: "String" },
          ],
        },
      ],
      procedure: (s) => {
        s.modify(sql`
          insert into controlled_revision_history
          select ${revisionColumnsSql("revision")},
            ${
          this.opts.actor.actorDisplayName(
            sql`rejecting_actor`,
          )
        } as rejected_by_name,
            rejecting_review.notes as rejection_notes,
            ${
          this.opts.actor.actorDisplayName(
            sql`disregarding_actor`,
          )
        } as disregarded_by_name
          from db.controlled_file_revisions revision
          join db.file_versions version
            on version.id = revision.file_version_id
          join db.file_items item on item.id = version.file_item_id
          join db.file_spaces space on space.id = item.file_space_id
          left join db.controlled_file_reviewers rejecting_review
            on rejecting_review.controlled_file_revision_id = revision.id
            and rejecting_review.decision = 'rejected'
          left join db.${sql.ref(this.opts.actor.actorTable)}
            rejecting_actor
            on rejecting_actor.id = rejecting_review.reviewer_actor_id
          left join db.${sql.ref(this.opts.actor.actorTable)}
            disregarding_actor
            on disregarding_actor.id = revision.disregarded_by_actor_id
          where revision.controlled_file_language_variant_id = p_variant_id
            and ${
          files.canReadVersionSql({
            spaceRecord: sql`space`,
            itemRecord: sql`item`,
            versionRecord: sql`version`,
            sysUserId: sql`current_user`,
          })
        }
          order by revision.id desc
        `);
        s.modify(sql`
          insert into controlled_reviewers
          select
            reviewer.id,
            reviewer.controlled_file_revision_id,
            reviewer.step_number,
            reviewer.reviewer_actor_id,
            reviewer.decision,
            reviewer.notes,
            reviewer.decided_at,
            ${
          this.opts.actor.actorDisplayName(
            sql`reviewer_actor`,
          )
        } as reviewer_name
          from db.controlled_file_reviewers reviewer
          join db.${sql.ref(this.opts.actor.actorTable)}
            reviewer_actor
            on reviewer_actor.id = reviewer.reviewer_actor_id
          where reviewer.controlled_file_revision_id = p_open_revision_id
          order by reviewer.step_number
        `);
        s.modify(sql`
          insert into controlled_available_reviewers
          select
            candidate.id,
            ${
          this.opts.actor.actorDisplayName(
            sql`candidate`,
          )
        } as display_name
          from db.${sql.ref(this.opts.actor.actorTable)} candidate
          where ${this.canConfigureReview(sql`current_user`)}
            and p_review_route_editable
            and ${
          canReviewControlledFiles(
            this.opts.actor.actorSysUserId(sql`candidate`),
          )
        }
            and ${
          files.runtimeAccessSql(
            sql`p_space_id`,
            this.opts.actor.actorSysUserId(sql`candidate`),
            "read",
          )
        }
            and not exists (
              select 1
              from db.controlled_file_reviewers reviewer
              where reviewer.controlled_file_revision_id =
                p_open_revision_id
                and reviewer.reviewer_actor_id = candidate.id
            )
          order by display_name collate nocase
          limit 20
        `);
      },
    });
  }

  #requiredFiles() {
    if (!this.#files) {
      throw new Error(
        "ControlledFileLifecycle is not attached to DriveBlock.",
      );
    }
    return this.#files;
  }
}

/**
 * Resolves the one space type carrying this lifecycle, when exactly one
 * does, so lifecycle surfaces can statically narrow `FileViewer` emission
 * to the viewers enabled on that type.
 */
export function lifecycleSpaceType(
  files: DriveBlockContract,
  control: ControlledFileLifecycle,
): DriveSpaceType | undefined {
  const types = files.spaceTypes.filter((type) => type.lifecycle === control);
  return types.length === 1 ? types[0] : undefined;
}

function controlledLanguageName(
  control: ControlledFileLifecycle,
  language: Sql,
) {
  return control.opts.languages.reduceRight<Sql>(
    (fallback, option) =>
      sql`
        case
          when ${language} = ${sql.lit(option.code)}
            then ${sql.lit(option.name)}
          else ${fallback}
        end
      `,
    language,
  );
}

/**
 * Exact working-revision viewer composed with the controlled lifecycle. A draft may
 * fork a new immutable technical version from its language's last published
 * version; reviewed, approved, published, and historical versions remain
 * read-only.
 */
export function ControlledFileWorkspace(
  props: ControlledFileWorkspaceProps,
) {
  const language = props.language
    ? props.language as Sql
    : sql.lit(props.control.opts.defaultLanguage);
  const languageName = controlledLanguageName(props.control, language);
  const reviewSurfaceProps: ControlledFileReviewSurfaceProps = {
    controlledRevisionId:
      sql`controlled_document_workspace.displayed_controlled_revision_id`,
    files: props.files,
    fileItemId: sql`${props.fileItemId}`,
    fileVersionId: sql`controlled_document_workspace.displayed_file_version_id`,
  };
  const reviewSurfaceMatches = props.control.reviewSurfaces.map((
    _surface,
    index,
  ) => sql.ref(`controlled_review_surface_${index}`));
  const hasReviewSurface = reviewSurfaceMatches.length
    ? reviewSurfaceMatches.reduce((left, right) => sql`${left} or ${right}`)
    : sql`false`;
  return (
    <Data
      procedure={(s) => {
        s.callStoredProcedure("controlled_document_workspace_state", {
          inputScalars: {
            p_file_item_id: props.fileItemId,
            p_language: language,
          },
          outputRecords: {
            controlled_document_workspace: "controlled_document_workspace",
          },
        });
        props.control.reviewSurfaces.forEach((surface, index) => {
          s.defScalar(
            `controlled_review_surface_${index}`,
            surface.canRender(reviewSurfaceProps),
          );
        });
      }}
    >
      <div className="space-y-5">
        <Show when={sql`not (${hasReviewSurface})`}>
          <Show
            when={sql`controlled_document_workspace.displayed_file_version_id is not null`}
            fallback={
              <div className="flex min-h-96 items-center justify-center rounded-lg border border-divider bg-surface text-center">
                <div className="max-w-md px-6">
                  <MaterialIcon
                    icon="Translate"
                    className="text-5xl text-secondary"
                  />
                  <Typography level="h4" className="mt-2">
                    {sql`'No ' || ${languageName} || ' version yet'`}
                  </Typography>
                  <p className="mt-2 text-sm text-secondary">
                    Use the controlled file section below to see what needs to
                    happen before this language can be added.
                  </p>
                </div>
              </div>
            }
          >
            <FileViewer
              files={props.files}
              fileItemId={props.fileItemId}
              fileVersionId={sql`controlled_document_workspace.displayed_file_version_id`}
              controlledRevisionId={sql`controlled_document_workspace.displayed_controlled_revision_id`}
              readOnly={sql`
                controlled_document_workspace.displayed_file_version_id is null
                or (
                  controlled_document_workspace.displayed_file_version_id <>
                    controlled_document_workspace.current_file_version_id
                  and not controlled_document_workspace.can_fork_working_version
                )
              `}
              allowNewVersionFromHistorical={sql`
                controlled_document_workspace.can_fork_working_version
              `}
            />
          </Show>
        </Show>
        {props.control.reviewSurfaces.map((surface, index) => (
          <Show when={reviewSurfaceMatches[index]}>
            {surface.render(reviewSurfaceProps)}
          </Show>
        ))}
        <ControlledFilePanel
          files={props.files}
          control={props.control}
          fileItemId={props.fileItemId}
          language={language}
        />
      </div>
    </Data>
  );
}

function publishControlledRevision(
  s: DomStatements,
  publicationActionConfirmed: Sql,
) {
  s.setScalar("control_error", sql.lit``);
  s.setScalar("control_publish_confirmation_open", false);
  s.tryServer({
    body: (s) => {
      s.callStoredProcedure(
        "controlled_file_publish",
        {
          inputScalars: {
            p_revision_id: sql`open_controlled_revision.id`,
            p_publication_action_confirmed: publicationActionConfirmed,
          },
        },
      );
      s.refetch();
    },
    errorName: "control_publish_error",
    catch: (s) =>
      s.setScalar(
        "control_error",
        sql`coalesce(control_publish_error.message, 'Unable to publish revision.')`,
      ),
  });
}

/**
 * Reviewable side panel for the controlled identity of one file. Access comes
 * from Files; workflow permissions only enable actions on already-readable
 * content.
 */
export function ControlledFilePanel(props: ControlledFilePanelProps) {
  useJsModule("http_file_upload");
  const language = props.language
    ? props.language as Sql
    : sql.lit(props.control.opts.defaultLanguage);
  const languageName = controlledLanguageName(props.control, language);
  const defaultLanguageName = controlledLanguageName(
    props.control,
    sql.lit(props.control.opts.defaultLanguage),
  );
  const publicationConfirmation = props.control.publicationConfirmation({
    fileItemId: sql`controlled_file.file_item_id`,
    revisionId: sql`open_controlled_revision.id`,
    language,
  });
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("control_revision_label", sql.lit``);
        s.defScalar("control_change_summary", sql.lit``);
        s.defScalar("control_effective_on", sql`current_date()`);
        s.defScalar("control_review_notes", sql.lit``);
        s.defScalar("control_error", sql.lit``);
        s.defScalar("control_publish_confirmation_open", false);
        s.defScalar("control_stop_review_confirmation_open", false);
        s.defScalar("control_disregard_confirmation_open", false);
        s.defScalar("control_disregard_reason", sql.lit``);
        if (publicationConfirmation) {
          s.defScalar(
            "control_publication_confirmation_checked",
            false,
          );
          s.defScalar(
            "control_publication_confirmation_required",
            false,
          );
          s.defScalar(
            "control_publication_confirmation_description",
            sql.lit``,
          );
        }
        s.defScalar("control_upload_handle", sql`random.uuid()`);
        s.defScalar("control_uploading", false);
        s.defScalar("control_upload_status", sql.lit``);
      }}
    >
      <Data
        procedure={(s) => {
          s.callStoredProcedure("controlled_file_panel_state", {
            inputScalars: {
              p_file_item_id: props.fileItemId,
              p_language: language,
            },
            outputRecords: {
              controlled_file: "controlled_file",
              open_controlled_revision: "open_controlled_revision",
            },
            outputScalars: {
              can_propose_controlled_revision:
                "can_propose_controlled_revision",
              can_manage_controlled_revision: "can_manage_controlled_revision",
              can_review_controlled_revision: "can_review_controlled_revision",
              can_publish_controlled_revision:
                "can_publish_controlled_revision",
              current_controlled_file_actor_id:
                "current_controlled_file_actor_id",
              can_submit_controlled_proposal: "can_submit_controlled_proposal",
              blocking_controlled_revision_language:
                "blocking_controlled_revision_language",
              blocking_controlled_revision_status:
                "blocking_controlled_revision_status",
              default_controlled_language_published:
                "default_controlled_language_published",
              controlled_translation_uses_source_version:
                "controlled_translation_uses_source_version",
              controlled_translation_needs_new_version:
                "controlled_translation_needs_new_version",
            },
          });
          s.callStoredProcedure("controlled_file_panel_lists_state", {
            inputScalars: {
              p_variant_id: sql`controlled_file.variant_id`,
              p_space_id: sql`controlled_file.file_space_id`,
              p_open_revision_id: sql`open_controlled_revision.id`,
              p_review_route_editable:
                sql`open_controlled_revision.status in ('proposed', 'in_review')`,
            },
            outputTables: {
              controlled_revision_history: "controlled_revision_history",
              controlled_reviewers: "controlled_reviewers",
              controlled_available_reviewers: "controlled_available_reviewers",
            },
          });
        }}
      >
        <Show when={sql`controlled_file.file_item_id is not null`}>
          <section
            className="rounded-lg border border-divider bg-surface p-4"
            js={{
              handles: [{
                module: "http_file_upload",
                cleanup: "cleanup",
                handle: sql`control_upload_handle`,
              }],
              on: {
                "http_file_upload.filesSelected": (s) => {
                  s.if(
                    sql`coalesce(event.payload_json->>'success', 'false') = 'true'`,
                    (s) => {
                      s.setScalar("control_uploading", true);
                      s.setScalar(
                        "control_upload_status",
                        sql.lit`Uploading file…`,
                      );
                      s.setScalar("control_error", sql.lit``);
                      s.jsCall({
                        module: "http_file_upload",
                        exportName: "upload",
                        handle: sql`control_upload_handle`,
                        argJson: sql`json_build_object(
                          'handle', control_upload_handle,
                          'endpoint',
                            '/api/files/items/' ||
                            cast(controlled_file.file_item_id as string) ||
                            '/versions/upload',
                          'concurrency', 1,
                          'chunkThreshold',
                            ${CONTROLLED_FILE_UPLOAD_CHUNK_THRESHOLD},
                          'chunkSize', ${CONTROLLED_FILE_UPLOAD_CHUNK_SIZE}
                        )`,
                      });
                    },
                  );
                },
                "http_file_upload.filesUploaded": (s) => {
                  s.setScalar("control_uploading", false);
                  s.setScalar("control_upload_status", sql.lit``);
                  s.refetch();
                },
                "http_file_upload.uploadProgress": (s) => {
                  s.setScalar(
                    "control_upload_status",
                    sql`'Uploading ' || coalesce(
                      event.payload_json->>'currentFileName',
                      'file'
                    ) || '…'`,
                  );
                },
                "http_file_upload.uploadError": (s) => {
                  s.setScalar("control_uploading", false);
                  s.setScalar("control_upload_status", sql.lit``);
                  s.setScalar(
                    "control_error",
                    sql`coalesce(
                      event.payload_json->>'error',
                      'Upload failed.'
                    )`,
                  );
                  s.refetch();
                },
                "http_file_upload.selectionCancelled": (s) => {
                  s.setScalar("control_uploading", false);
                  s.setScalar("control_upload_status", sql.lit``);
                },
              },
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Typography level="title-md" startIcon="FactCheck">
                  {sql`${languageName} || ' controlled file'`}
                </Typography>
                <p className="mt-1 text-xs text-secondary">
                  {sql`'You are working with the ' || ${languageName} || ' version.'`}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Chip size="sm" variant="outlined">
                  {languageName}
                </Chip>
                <Show when={sql`open_controlled_revision.id is not null`}>
                  <Chip
                    size="sm"
                    color="neutral"
                  >
                    {sql`replace(open_controlled_revision.status, '_', ' ')`}
                  </Chip>
                </Show>
              </div>
            </div>

            <Show when={sql`ui.control_error <> ''`}>
              <Alert color="danger" className="mt-3">
                {sql`ui.control_error`}
              </Alert>
            </Show>

            <Show
              when={sql`controlled_file.file_item_id is not null`}
            >
              <Show
                when={sql`open_controlled_revision.id is null`}
                fallback={
                  <div className="mt-4 space-y-4">
                    <div className="rounded-md bg-level1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {sql`'Revision ' || open_controlled_revision.revision_label`}
                        </span>
                        <span className="text-xs text-secondary">
                          {sql`'Technical version ' || cast(open_controlled_revision.file_version_number as string)`}
                        </span>
                      </div>
                      <Show
                        when={sql`coalesce(open_controlled_revision.change_summary, '') <> ''`}
                      >
                        <p className="mt-2 text-sm text-secondary">
                          {sql`open_controlled_revision.change_summary`}
                        </p>
                      </Show>
                    </div>

                    <Show
                      when={sql`
                        open_controlled_revision.status = 'draft'
                        and open_controlled_revision.initiated_by_actor_id =
                          current_controlled_file_actor_id
                        and controlled_translation_uses_source_version
                      `}
                    >
                      <Alert color="warning" startIcon="Translate">
                        {sql`
                          'This ' || ${languageName} ||
                          ' draft still contains the published ' ||
                          ${defaultLanguageName} ||
                          ' source. Translate or replace the content before submitting it.'
                        `}
                      </Alert>
                    </Show>

                    <Show
                      when={sql`
                        open_controlled_revision.status = 'draft'
                        and open_controlled_revision.initiated_by_actor_id =
                          current_controlled_file_actor_id
                        and open_controlled_revision.content_type in (
                          'application/vnd.yolm.document+json',
                          'text/markdown',
                          'application/vnd.yolm.external-link'
                        )
                        and controlled_translation_needs_new_version
                      `}
                    >
                      <div className="rounded-md border border-divider p-3 text-sm text-secondary">
                        Select <span className="font-medium">Edit</span>{" "}
                        in the document above, add the {languageName}{" "}
                        content, and save a new version.
                      </div>
                    </Show>

                    <Show
                      when={sql`
                        open_controlled_revision.status = 'draft'
                        and open_controlled_revision.initiated_by_actor_id =
                          current_controlled_file_actor_id
                        and open_controlled_revision.content_type not in (
                          'application/vnd.yolm.document+json',
                          'text/markdown',
                          'application/vnd.yolm.external-link'
                        )
                      `}
                    >
                      <div className="rounded-md border border-divider p-3">
                        <p className="text-sm text-secondary">
                          {sql`
                            case
                              when controlled_translation_needs_new_version
                                then 'Upload the ' || ${languageName} ||
                                  ' file before submitting this translation.'
                              else 'The current ' || ${languageName} ||
                                ' file is already attached to this draft. Upload a replacement only if you need to change it.'
                            end
                          `}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Button
                            size="sm"
                            startIcon="UploadFile"
                            loading={sql`ui.control_uploading`}
                            onClick={(s) => {
                              s.setScalar("control_error", sql.lit``);
                              s.jsCall({
                                module: "http_file_upload",
                                exportName: "selectFiles",
                                handle: sql`ui.control_upload_handle`,
                                argJson: sql`json_build_object(
                                  'handle', ui.control_upload_handle,
                                  'multiple', false,
                                  'accept',
                                    open_controlled_revision.content_type
                                )`,
                              });
                            }}
                          >
                            {sql`
                              case
                                when controlled_translation_needs_new_version
                                  then 'Upload ' || ${languageName} || ' file'
                                else 'Upload replacement ' ||
                                  ${languageName} || ' file'
                              end
                            `}
                          </Button>
                          <Show when={sql`ui.control_upload_status <> ''`}>
                            <span className="text-sm text-secondary">
                              {sql`ui.control_upload_status`}
                            </span>
                          </Show>
                        </div>
                      </div>
                    </Show>

                    <div>
                      <div className="mb-2 text-xs font-medium text-secondary">
                        Review route
                      </div>
                      <div className="space-y-2">
                        <Each
                          table="controlled_reviewers"
                          recordName="controlled_reviewer"
                        >
                          <div className="flex items-center gap-2 rounded-md border border-divider p-2 text-sm">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-level2 text-xs">
                              {sql`cast(controlled_reviewer.step_number as string)`}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {sql`controlled_reviewer.reviewer_name`}
                            </span>
                            <Chip
                              size="sm"
                              color="neutral"
                            >
                              {sql`coalesce(controlled_reviewer.decision, 'pending')`}
                            </Chip>
                            <Show
                              when={sql`
                                open_controlled_revision.status in (
                                  'proposed',
                                  'in_review'
                                )
                                and controlled_reviewer.decision is null
                                and can_manage_controlled_revision
                              `}
                            >
                              <Button
                                size="sm"
                                variant="plain"
                                color="danger"
                                disabled={sql`
                                  open_controlled_revision.status = 'in_review'
                                  and (
                                    select count(*)
                                    from controlled_reviewers pending_reviewer
                                    where pending_reviewer.decision is null
                                  ) <= 1
                                `}
                                onClick={(s) => {
                                  s.setScalar("control_error", sql.lit``);
                                  s.tryServer({
                                    body: (s) => {
                                      s.callStoredProcedure(
                                        "controlled_file_remove_reviewer",
                                        {
                                          inputScalars: {
                                            p_revision_id:
                                              sql`open_controlled_revision.id`,
                                            p_reviewer_id:
                                              sql`controlled_reviewer.id`,
                                          },
                                        },
                                      );
                                      s.refetch();
                                    },
                                    errorName: "control_reviewer_error",
                                    catch: (s) =>
                                      s.setScalar(
                                        "control_error",
                                        sql`coalesce(control_reviewer_error.message, 'Unable to remove reviewer.')`,
                                      ),
                                  });
                                }}
                              >
                                Remove
                              </Button>
                            </Show>
                          </div>
                        </Each>
                      </div>
                      <Show
                        when={sql`
                          open_controlled_revision.status = 'in_review'
                          and can_manage_controlled_revision
                          and (
                            select count(*)
                            from controlled_reviewers pending_reviewer
                            where pending_reviewer.decision is null
                          ) <= 1
                        `}
                      >
                        <p className="mt-2 text-xs text-secondary">
                          Add another reviewer before removing the final pending
                          reviewer.
                        </p>
                      </Show>
                      <Show
                        when={sql`
                          open_controlled_revision.status in (
                            'proposed',
                            'in_review'
                          )
                          and can_manage_controlled_revision
                        `}
                      >
                        <div className="mt-2 max-h-40 space-y-1 overflow-auto rounded-md bg-level1 p-2">
                          <Each
                            table="controlled_available_reviewers"
                            recordName="controlled_reviewer_candidate"
                          >
                            <button
                              type="button"
                              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-surface"
                              onClick={(s) => {
                                s.setScalar("control_error", sql.lit``);
                                s.tryServer({
                                  body: (s) => {
                                    s.callStoredProcedure(
                                      "controlled_file_assign_reviewer",
                                      {
                                        inputScalars: {
                                          p_revision_id:
                                            sql`open_controlled_revision.id`,
                                          p_reviewer_actor_id:
                                            sql`controlled_reviewer_candidate.id`,
                                        },
                                      },
                                    );
                                    s.refetch();
                                  },
                                  errorName: "control_reviewer_error",
                                  catch: (s) =>
                                    s.setScalar(
                                      "control_error",
                                      sql`coalesce(control_reviewer_error.message, 'Unable to add reviewer.')`,
                                    ),
                                });
                              }}
                            >
                              <span className="truncate">
                                {sql`controlled_reviewer_candidate.display_name`}
                              </span>
                              <Chip size="sm" variant="outlined">
                                Add reviewer
                              </Chip>
                            </button>
                          </Each>
                        </div>
                      </Show>
                    </div>

                    <Show
                      when={sql`
                        open_controlled_revision.status = 'draft'
                        and open_controlled_revision.initiated_by_actor_id =
                          current_controlled_file_actor_id
                        and controlled_translation_needs_new_version
                      `}
                    >
                      <Alert color="warning" startIcon="Lock">
                        {sql`
                          'Save or upload the ' || ${languageName} ||
                          ' content before this proposal can be submitted.'
                        `}
                      </Alert>
                    </Show>

                    <Show when={sql`can_submit_controlled_proposal`}>
                      <div className="rounded-md border border-divider bg-level1 p-3">
                        <p className="text-sm text-secondary">
                          {sql`
                            'Submit this draft when its content is ready. The ' ||
                            ${
                            sql.lit(
                              props.control.proposalCoordinatorDisplayName,
                            )
                          } ||
                            ' will select the approvers.'
                          `}
                        </p>
                        <Button
                          className="mt-3"
                          size="sm"
                          startIcon="Send"
                          onClick={(s) => {
                            s.setScalar("control_error", sql.lit``);
                            s.tryServer({
                              body: (s) => {
                                s.callStoredProcedure(
                                  "controlled_file_submit_proposal",
                                  {
                                    inputScalars: {
                                      p_revision_id:
                                        sql`open_controlled_revision.id`,
                                    },
                                  },
                                );
                                s.refetch();
                              },
                              errorName: "control_submit_error",
                              catch: (s) =>
                                s.setScalar(
                                  "control_error",
                                  sql`coalesce(control_submit_error.message, 'Unable to submit proposal.')`,
                                ),
                            });
                          }}
                        >
                          Submit proposal
                        </Button>
                      </div>
                    </Show>

                    <Show
                      when={sql`
                        open_controlled_revision.status = 'proposed'
                        and not can_manage_controlled_revision
                      `}
                    >
                      <div className="rounded-md bg-level1 p-3 text-sm text-secondary">
                        {sql`
                          'This proposal is waiting for the ' ||
                          ${
                          sql.lit(
                            props.control.proposalCoordinatorDisplayName,
                          )
                        } ||
                          ' to select its approval route.'
                        `}
                      </div>
                    </Show>

                    <Show
                      when={sql`
                      open_controlled_revision.status = 'in_review'
                      and can_review_controlled_revision
                      and exists (
                        select 1
                        from controlled_reviewers reviewer
                        where reviewer.reviewer_actor_id =
                          current_controlled_file_actor_id
                          and reviewer.decision is null
                          and not exists (
                            select 1
                            from controlled_reviewers earlier
                            where earlier.step_number < reviewer.step_number
                              and earlier.decision is null
                          )
                      )
                    `}
                    >
                      <div className="rounded-md border border-divider p-3">
                        <Input
                          bindScalar="control_review_notes"
                          placeholder="Review notes (optional)"
                          fullWidth
                        />
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            color="success"
                            startIcon="Check"
                            onClick={(s) => {
                              s.setScalar("control_error", sql.lit``);
                              s.tryServer({
                                body: (s) => {
                                  s.callStoredProcedure(
                                    "controlled_file_approve_review",
                                    {
                                      inputScalars: {
                                        p_revision_id:
                                          sql`open_controlled_revision.id`,
                                        p_notes: sql`ui.control_review_notes`,
                                      },
                                    },
                                  );
                                  s.setScalar(
                                    "control_review_notes",
                                    sql.lit``,
                                  );
                                  s.refetch();
                                },
                                errorName: "control_review_error",
                                catch: (s) =>
                                  s.setScalar(
                                    "control_error",
                                    sql`coalesce(control_review_error.message, 'Unable to save review.')`,
                                  ),
                              });
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            color="danger"
                            variant="outlined"
                            startIcon="Close"
                            onClick={(s) => {
                              s.setScalar("control_error", sql.lit``);
                              s.tryServer({
                                body: (s) => {
                                  s.callStoredProcedure(
                                    "controlled_file_reject_review",
                                    {
                                      inputScalars: {
                                        p_revision_id:
                                          sql`open_controlled_revision.id`,
                                        p_notes: sql`ui.control_review_notes`,
                                      },
                                    },
                                  );
                                  s.setScalar(
                                    "control_review_notes",
                                    sql.lit``,
                                  );
                                  s.refetch();
                                },
                                errorName: "control_review_error",
                                catch: (s) =>
                                  s.setScalar(
                                    "control_error",
                                    sql`coalesce(control_review_error.message, 'Unable to save review.')`,
                                  ),
                              });
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    </Show>

                    <Show
                      when={sql`open_controlled_revision.status = 'proposed' and can_manage_controlled_revision`}
                    >
                      <Button
                        size="sm"
                        startIcon="RateReview"
                        onClick={(s) => {
                          s.setScalar("control_error", sql.lit``);
                          s.tryServer({
                            body: (s) => {
                              s.callStoredProcedure(
                                "controlled_file_submit_for_review",
                                {
                                  inputScalars: {
                                    p_revision_id:
                                      sql`open_controlled_revision.id`,
                                  },
                                },
                              );
                              s.refetch();
                            },
                            errorName: "control_submit_error",
                            catch: (s) =>
                              s.setScalar(
                                "control_error",
                                sql`coalesce(control_submit_error.message, 'Unable to submit revision.')`,
                              ),
                          });
                        }}
                      >
                        Start approval review
                      </Button>
                    </Show>
                    <Show
                      when={sql`
                        open_controlled_revision.status = 'in_review'
                        and can_manage_controlled_revision
                        and not exists (
                          select 1
                          from controlled_reviewers reviewer
                          where reviewer.decision is not null
                        )
                      `}
                    >
                      <Button
                        size="sm"
                        variant="outlined"
                        color="danger"
                        startIcon="Undo"
                        onClick={(s) =>
                          s.setScalar(
                            "control_stop_review_confirmation_open",
                            true,
                          )}
                      >
                        Undo approval flow
                      </Button>
                    </Show>
                    <Show
                      when={sql`open_controlled_revision.status = 'approved' and can_publish_controlled_revision`}
                    >
                      <Button
                        size="sm"
                        color="success"
                        startIcon="Publish"
                        onClick={(s) => {
                          if (publicationConfirmation) {
                            s.setScalar(
                              "control_publication_confirmation_checked",
                              false,
                            );
                            s.setScalar(
                              "control_publication_confirmation_required",
                              false,
                            );
                            s.setScalar(
                              "control_publication_confirmation_description",
                              sql.lit``,
                            );
                            s.setScalar("control_error", sql.lit``);
                            s.tryServer({
                              body: (s) => {
                                s.defScalar(
                                  "control_publication_confirmation_check_required",
                                  { type: "Bool" },
                                );
                                s.defScalar(
                                  "control_publication_confirmation_check_description",
                                  { type: "String" },
                                );
                                s.callStoredProcedure(
                                  "controlled_file_publication_confirmation_check",
                                  {
                                    inputScalars: {
                                      p_revision_id:
                                        sql`open_controlled_revision.id`,
                                      p_language: language,
                                    },
                                    inputRecords: {
                                      controlled_file: "controlled_file",
                                    },
                                    outputScalars: {
                                      p_required:
                                        "control_publication_confirmation_check_required",
                                      p_description:
                                        "control_publication_confirmation_check_description",
                                    },
                                  },
                                );
                                s.setScalar(
                                  "control_publication_confirmation_required",
                                  sql`control_publication_confirmation_check_required`,
                                );
                                s.setScalar(
                                  "control_publication_confirmation_description",
                                  sql`control_publication_confirmation_check_description`,
                                );
                                s.setScalar(
                                  "control_publication_confirmation_checked",
                                  true,
                                );
                              },
                              errorName:
                                "control_publication_confirmation_error",
                              catch: (s) =>
                                s.setScalar(
                                  "control_error",
                                  sql`coalesce(
                                    control_publication_confirmation_error.message,
                                    'Unable to check affected readers.'
                                  )`,
                                ),
                            });
                            s.if(
                              sql`
                                control_publication_confirmation_checked
                                and control_publication_confirmation_required
                              `,
                              (s) => {
                                s.setScalar(
                                  "control_publish_confirmation_open",
                                  true,
                                );
                              },
                            );
                            s.if(
                              sql`
                                control_publication_confirmation_checked
                                and not control_publication_confirmation_required
                              `,
                              (s) => publishControlledRevision(s, sql`false`),
                            );
                          } else {
                            publishControlledRevision(s, sql`false`);
                          }
                        }}
                      >
                        Publish revision
                      </Button>
                    </Show>
                    <Show
                      when={sql`
                        open_controlled_revision.status in (
                          'draft',
                          'proposed',
                          'in_review',
                          'approved'
                        )
                        and (can_manage_controlled_revision
                          or open_controlled_revision.initiated_by_actor_id = current_controlled_file_actor_id)
                      `}
                    >
                      <Button
                        size="sm"
                        variant="plain"
                        color="danger"
                        startIcon="Block"
                        onClick={(s) => {
                          s.setScalar("control_disregard_reason", sql.lit``);
                          s.setScalar(
                            "control_disregard_confirmation_open",
                            true,
                          );
                        }}
                      >
                        Cancel proposal
                      </Button>
                    </Show>
                    <ConfirmDangerDialog
                      open={sql`ui.control_stop_review_confirmation_open`}
                      onClose={(s) =>
                        s.setScalar(
                          "control_stop_review_confirmation_open",
                          false,
                        )}
                      description={`Undo this approval flow and return the policy to proposed? No reviewer has decided yet. The current reviewer route will be cleared so the ${props.control.proposalCoordinatorDisplayName} can build it again.`}
                      confirmButtonText="Undo approval flow"
                      action={(s) => {
                        s.callStoredProcedure(
                          "controlled_file_stop_review",
                          {
                            inputScalars: {
                              p_revision_id: sql`open_controlled_revision.id`,
                            },
                          },
                        );
                      }}
                      afterSuccessClient={(s) => s.refetch()}
                    />
                    <ModalDialog
                      open={sql`ui.control_disregard_confirmation_open`}
                      onClose={(s) =>
                        s.setScalar(
                          "control_disregard_confirmation_open",
                          false,
                        )}
                      maxWidth="sm"
                      role="alertdialog"
                    >
                      <div className="flex flex-col gap-4 p-5">
                        <div>
                          <Typography
                            level="title-lg"
                            startIcon="WarningRounded"
                          >
                            Cancel proposal
                          </Typography>
                          <Typography
                            level="body-sm"
                            className="mt-1 text-secondary"
                          >
                            The proposal will leave active document-control work
                            and cannot be approved or published. Existing
                            published policy content and approval evidence are
                            retained.
                          </Typography>
                        </div>
                        <FormControl>
                          <FormLabel required>Reason</FormLabel>
                          <Textarea
                            aria-label="Reason"
                            bindScalar="control_disregard_reason"
                            minRows={3}
                            maxLength={2000}
                            required
                            placeholder="Explain why this proposal is being canceled"
                          />
                        </FormControl>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="plain"
                            color="neutral"
                            onClick={(s) =>
                              s.setScalar(
                                "control_disregard_confirmation_open",
                                false,
                              )}
                          >
                            Cancel
                          </Button>
                          <ActionButton
                            color="danger"
                            disabled={sql`nullif(trim(control_disregard_reason), '') is null`}
                            action={(s) => {
                              s.callStoredProcedure(
                                "controlled_file_disregard_proposal",
                                {
                                  inputScalars: {
                                    p_revision_id:
                                      sql`open_controlled_revision.id`,
                                    p_reason: sql`control_disregard_reason`,
                                  },
                                },
                              );
                            }}
                            afterSuccessClient={(s) => {
                              s.setScalar(
                                "control_disregard_confirmation_open",
                                false,
                              );
                              s.refetch();
                            }}
                          >
                            Cancel proposal
                          </ActionButton>
                        </div>
                      </div>
                    </ModalDialog>
                    {publicationConfirmation && (
                      <ModalDialog
                        open={sql`ui.control_publish_confirmation_open`}
                        onClose={(s) =>
                          s.setScalar(
                            "control_publish_confirmation_open",
                            false,
                          )}
                        maxWidth="sm"
                      >
                        <div className="flex flex-col gap-4 p-5">
                          <div>
                            <Typography level="title-lg">
                              {publicationConfirmation.title}
                            </Typography>
                            <Typography
                              level="body-sm"
                              className="mt-2 text-secondary"
                            >
                              {sql`control_publication_confirmation_description`}
                            </Typography>
                          </div>
                          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <Button
                              variant="plain"
                              color="neutral"
                              onClick={(s) =>
                                s.setScalar(
                                  "control_publish_confirmation_open",
                                  false,
                                )}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="outlined"
                              color="neutral"
                              onClick={(s) =>
                                publishControlledRevision(s, sql`false`)}
                            >
                              {publicationConfirmation.skipLabel}
                            </Button>
                            <Button
                              color="success"
                              startIcon="AssignmentInd"
                              onClick={(s) =>
                                publishControlledRevision(s, sql`true`)}
                            >
                              {publicationConfirmation.confirmLabel}
                            </Button>
                          </div>
                        </div>
                      </ModalDialog>
                    )}
                  </div>
                }
              >
                <Show when={sql`controlled_file.variant_id is null`}>
                  <Alert color="neutral" className="mt-4" startIcon="Translate">
                    {sql`
                      'No ' || ${languageName} ||
                      ' version has been added to this policy yet.'
                    `}
                  </Alert>
                </Show>
                <Show
                  when={sql`
                    blocking_controlled_revision_status is not null
                  `}
                >
                  <Alert color="warning" className="mt-4" startIcon="Schedule">
                    {sql`
                      'The ' ||
                      ${
                      controlledLanguageName(
                        props.control,
                        sql`blocking_controlled_revision_language`,
                      )
                    } ||
                      ' revision is currently ' ||
                      replace(blocking_controlled_revision_status, '_', ' ') ||
                      '. Finish and publish it before starting the ' ||
                      ${languageName} || ' version.'
                    `}
                  </Alert>
                </Show>
                <Show
                  when={sql`
                    blocking_controlled_revision_status is null
                    and ${language} <>
                      ${sql.lit(props.control.opts.defaultLanguage)}
                    and not default_controlled_language_published
                  `}
                >
                  <Alert color="warning" className="mt-4" startIcon="Publish">
                    {sql`
                      'Publish the ' || ${defaultLanguageName} ||
                      ' version before starting the ' ||
                      ${languageName} || ' translation.'
                    `}
                  </Alert>
                </Show>
                <Show
                  when={sql`
                    can_propose_controlled_revision
                    and blocking_controlled_revision_status is null
                    and (
                      ${language} =
                        ${sql.lit(props.control.opts.defaultLanguage)}
                      or default_controlled_language_published
                    )
                  `}
                >
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-secondary">
                      {sql`
                        case
                          when controlled_file.variant_id is null
                            then 'Start the ' || ${languageName} ||
                              ' version for this same policy.'
                          else 'Start a new ' || ${languageName} ||
                            ' revision.'
                        end
                      `}
                    </p>
                    <Input
                      bindScalar="control_revision_label"
                      placeholder="Revision label, e.g. 2.0"
                      fullWidth
                    />
                    <Input
                      type="date"
                      bindScalar="control_effective_on"
                      fullWidth
                    />
                    <Input
                      bindScalar="control_change_summary"
                      placeholder="Change summary"
                      fullWidth
                    />
                    <Button
                      size="sm"
                      startIcon="Add"
                      disabled={sql`trim(ui.control_revision_label) = ''`}
                      onClick={(s) => {
                        s.setScalar("control_error", sql.lit``);
                        s.tryServer({
                          body: (s) => {
                            s.callStoredProcedure(
                              "controlled_file_create_revision",
                              {
                                inputScalars: {
                                  p_file_item_id: props.fileItemId,
                                  p_language: language,
                                  p_revision_label:
                                    sql`ui.control_revision_label`,
                                  p_effective_on: sql`ui.control_effective_on`,
                                  p_change_summary:
                                    sql`ui.control_change_summary`,
                                },
                              },
                            );
                            s.setScalar("control_revision_label", sql.lit``);
                            s.setScalar("control_change_summary", sql.lit``);
                            s.refetch();
                          },
                          errorName: "control_create_error",
                          catch: (s) =>
                            s.setScalar(
                              "control_error",
                              sql`coalesce(control_create_error.message, 'Unable to start revision.')`,
                            ),
                        });
                      }}
                    >
                      {sql`
                        case
                          when controlled_file.variant_id is null
                            then 'Start ' || ${languageName} || ' version'
                          else 'Start ' || ${languageName} || ' revision'
                        end
                      `}
                    </Button>
                  </div>
                </Show>
              </Show>

              <Show
                when={sql`exists (select 1 from controlled_revision_history)`}
              >
                <div className="mt-5 border-t border-divider pt-4">
                  <div className="mb-2 text-xs font-medium text-secondary">
                    Controlled revision history
                  </div>
                  <div className="space-y-2">
                    <Each
                      table="controlled_revision_history"
                      recordName="controlled_revision"
                    >
                      <div className="rounded-md border border-divider p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {sql`'Revision ' || controlled_revision.revision_label`}
                          </span>
                          <Chip size="sm">
                            {sql`case when controlled_revision.disregarded_at is not null then 'canceled' else replace(controlled_revision.status, '_', ' ') end`}
                          </Chip>
                        </div>
                        <Show
                          when={sql`controlled_revision.status = 'rejected'
                            and controlled_revision.disregarded_at is not null`}
                        >
                          <div className="mt-2 rounded-md bg-level1 p-2">
                            <p className="font-medium">
                              {sql`
                                'Canceled by ' || coalesce(
                                  controlled_revision.disregarded_by_name,
                                  ${
                                sql.lit(
                                  props.control.proposalCoordinatorDisplayName,
                                )
                              }
                                ) || ' on ' ||
                                to_char(
                                  controlled_revision.disregarded_at,
                                  'YYYY-MM-DD HH24:MI'
                                ) || ' UTC'
                              `}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-secondary">
                              {sql`controlled_revision.disregard_reason`}
                            </p>
                          </div>
                        </Show>
                        <Show
                          when={sql`controlled_revision.status = 'rejected'
                            and controlled_revision.disregarded_at is null`}
                        >
                          <div className="mt-2 rounded-md bg-level1 p-2">
                            <p className="font-medium">
                              {sql`
                                'Rejected by ' || coalesce(
                                  controlled_revision.rejected_by_name,
                                  'assigned reviewer'
                                )
                              `}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-secondary">
                              {sql`coalesce(
                                nullif(controlled_revision.rejection_notes, ''),
                                'No rejection note was provided.'
                              )`}
                            </p>
                          </div>
                        </Show>
                      </div>
                    </Each>
                  </div>
                </div>
              </Show>
            </Show>
          </section>
        </Show>
      </Data>
    </Data>
  );
}

export function sysUsersControlledFileActor(): ControlledFileActorProvider {
  return {
    actorTable: "sys_users",
    actorIdForSysUserId: (sysUserId) => sysUserId,
    actorSysUserId: (actor) => sql`${actor}.id`,
    actorDisplayName: (actor) => {
      const table = system.db.tables.sys_users;
      return table.recordDisplayName
        ? table.getRecordDisplayNameExpr(actor)
        : sql`'User #' || cast(${actor}.id as string)`;
    },
  };
}
