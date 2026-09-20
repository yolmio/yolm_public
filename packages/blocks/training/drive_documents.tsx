import { AuthBlock, userHasPermission } from "blocks/auth";
import type {
  ControlledFileLifecycle,
  ControlledFilePublicationConfirmation,
} from "blocks/drive/controlled_lifecycle";
import type { ExternalLinkExtension } from "blocks/drive/external_link";
import type { NativeDocumentExtension } from "blocks/drive/native_document";
import type { DriveBlockContract, DriveExtension } from "blocks/drive/types";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { ServerStatementsBase } from "std/statements";
import {
  DirectDocumentAssignmentPanel,
  initializeTrainingDocumentAssignmentState,
} from "./admin/document_assignment";
import {
  initializeTrainingDocumentDetailState,
  saveTrainingDocumentDetailSettings,
  TrainingDocumentSettingsPanel,
} from "./document_settings";
import { trainingPermissions } from "./helpers";
import type { TrainingBlock } from "./index.tsx";

export interface TrainingDriveExtensionOpts {
  control: ControlledFileLifecycle;
  nativeDocuments: NativeDocumentExtension;
  externalLinks?: ExternalLinkExtension;
  routes: {
    adminBasePath: string;
    readerBasePath: string;
    submissionsHref?: string;
  };
}

export interface TrainingContentPublicationEvent {
  documentId: Sql;
  language: Sql;
  versionId: Sql;
  reassignCourseReaders?: Sql;
}

export interface TrainingContentPublicationConsumer {
  name: string;
  publicationConfirmation?: (
    event: TrainingContentPublicationEvent,
  ) => ControlledFilePublicationConfirmation;
  afterVersionPublished: (
    s: ServerStatementsBase<any>,
    event: TrainingContentPublicationEvent,
  ) => void;
}

/**
 * Installs Training's governed-content integration on a controlled Drive
 * space type. File identities and immutable bytes stay in Drive; the
 * controlled lifecycle supplies language variants and publishable revisions.
 */
export class TrainingDriveExtension implements DriveExtension {
  readonly name = "training_documents";
  readonly opts: {
    languages: ControlledFileLifecycle["opts"]["languages"];
    defaultLanguage: string;
  };
  readonly routes: {
    adminBasePath: string;
    readerBasePath: string;
    submissionsHref?: string;
  };
  #files?: DriveBlockContract;

  constructor(readonly config: TrainingDriveExtensionOpts) {
    this.opts = {
      languages: config.control.opts.languages,
      defaultLanguage: config.control.opts.defaultLanguage,
    };
    this.routes = config.routes;
  }

  initialize(files: DriveBlockContract) {
    this.#files = files;
  }

  get documentTable() {
    return this.#requiredFiles().itemTable;
  }

  get versionTable() {
    return this.config.control.revisionTable;
  }

  validate(files: DriveBlockContract) {
    if (this.#files !== files) {
      throw new Error(
        "TrainingDriveExtension must be initialized by its DriveBlock.",
      );
    }
    const trainingSpaceTypes = files.spaceTypes.filter((type) =>
      type.extensions.includes(this)
    );
    if (
      trainingSpaceTypes.length === 0 ||
      trainingSpaceTypes.some((type) =>
        type.lifecycle !== this.config.control ||
        !type.extensions.includes(this.config.nativeDocuments) ||
        (
          this.config.externalLinks !== undefined &&
          !type.extensions.includes(this.config.externalLinks)
        )
      )
    ) {
      throw new Error(
        "Drive training documents require their configured content extensions on the same controlled space type.",
      );
    }
  }

  trainingDocumentsQuery() {
    const files = this.#requiredFiles();
    return sql`
      select
        item.id,
        item.name as title,
        item.trashed_at is null as is_active
      from db.file_items item
      join db.file_spaces space on space.id = item.file_space_id
      where ${
      files.extensionEnabledSql(
        sql`space.id`,
        this.name,
      )
    }
    `;
  }

  trainingLanguageVariantsQuery() {
    const files = this.#requiredFiles();
    return sql`
      select
        variant.id,
        variant.file_item_id as document_id,
        variant.language,
        variant.current_controlled_file_revision_id
          as current_document_version_id
      from db.controlled_file_language_variants variant
      join db.file_items item on item.id = variant.file_item_id
      where ${
      files.extensionEnabledSql(
        sql`item.file_space_id`,
        this.name,
      )
    }
    `;
  }

  trainingVersionsQuery() {
    const files = this.#requiredFiles();
    const externalLinkJoin = this.config.externalLinks
      ? sql`
        left join db.${
        sql.ref(this.config.externalLinks.contentTable)
      } external_link
          on external_link.file_version_id = version.id
      `
      : sql``;
    const externalUrl = this.config.externalLinks
      ? sql`external_link.url`
      : sql`cast(null as string)`;
    return sql`
      select
        revision.id,
        revision.controlled_file_language_variant_id
          as document_language_variant_id,
        revision.revision_label as version_label,
        cast(revision.status as string) as status,
        version.file_name,
        version.content_type,
        case
          when native_content.file_version_id is not null then 'native_yolm'
          when ${externalUrl} is not null then 'external_link'
          when lower(version.content_type) = 'application/pdf'
            then 'pdf_attachment'
          else 'file_attachment'
        end as content_mode,
        blob.blob_hash,
        native_content.rich_content,
        ${externalUrl} as external_url,
        revision.published_at
      from db.controlled_file_revisions revision
      join db.controlled_file_language_variants variant
        on variant.id =
          revision.controlled_file_language_variant_id
      join db.file_items item on item.id = variant.file_item_id
      join db.file_versions version
        on version.id = revision.file_version_id
      left join db.file_version_blobs blob
        on blob.file_version_id = version.id
      left join db.native_document_file_versions native_content
        on native_content.file_version_id = version.id
      ${externalLinkJoin}
      where ${
      files.extensionEnabledSql(
        sql`item.file_space_id`,
        this.name,
      )
    }
    `;
  }

  trainingLanguagesQuery() {
    return sql.unionAll(
      ...this.opts.languages.map((language, index) =>
        sql`
          select
            ${sql.lit(language.code)} as code,
            ${sql.lit(language.name)} as name,
            ${sql.lit(language.nativeName ?? language.name)} as native_name,
            ${sql.lit(String(index))}::int as sort_order
        `
      ),
    );
  }

  trainingNativeImageQuery(args: {
    versionId: Sql;
    imageFileItemId: Sql;
    hashHex: Sql;
  }) {
    return sql`
      select image.blob_hash, image.content_type
      from db.${sql.ref(this.config.nativeDocuments.versionImageTable)}
        image_reference
      join db.${sql.ref(this.config.nativeDocuments.imageTable)} image
        on image.id = image_reference.native_document_image_id
      join db.${sql.ref(this.config.control.revisionTable)} revision
        on revision.id = ${args.versionId}
       and revision.file_version_id = image_reference.file_version_id
      where image.file_item_id = ${args.imageFileItemId}
        and image.blob_hash = bytes.from_hex(${args.hashHex})
      limit 1
    `;
  }

  resolveDirectTrainingVersion(args: {
    documentId: Sql;
    requestedLanguage: Sql;
  }) {
    return this.config.control.resolvePreferredPublishedRevision({
      fileItemId: args.documentId,
      preferredLanguage: args.requestedLanguage,
    });
  }

  directVersionMatchesCurrentResolution(args: {
    versionId: Sql;
    requestedLanguage: Sql;
  }) {
    return sql`${args.versionId} = ${
      this.resolveDirectTrainingVersion({
        documentId: this.config.control.revisionFileItemId(args.versionId),
        requestedLanguage: args.requestedLanguage,
      })
    }`;
  }

  resolveCourseSupportingDocumentVersion(args: {
    documentId: Sql;
    assignmentLanguage: Sql;
  }) {
    return this.resolveDirectTrainingVersion({
      documentId: args.documentId,
      requestedLanguage: args.assignmentLanguage,
    });
  }

  registerPublicationConsumer(consumer: TrainingContentPublicationConsumer) {
    const files = this.#requiredFiles();
    const publicationConfirmation = consumer.publicationConfirmation;
    this.config.control.registerPublicationConsumer({
      name: consumer.name,
      publicationConfirmation: publicationConfirmation
        ? (event) => {
          const confirmation = publicationConfirmation({
            documentId: event.fileItemId,
            language: event.language,
            versionId: event.revisionId,
          });
          return {
            ...confirmation,
            appliesWhen: sql`
              (${confirmation.appliesWhen})
              and ${
              files.extensionEnabledSql(
                sql`controlled_file.file_space_id`,
                this.name,
              )
            }
            `,
          };
        }
        : undefined,
      onPublished: (s, event) => {
        s.defScalar(
          "drive_training_publication_space_id",
          sql`(
            select item.file_space_id
            from db.file_items item
            where item.id = ${event.fileItemId}
          )`,
        );
        s.if(
          files.extensionEnabledSql(
            sql`drive_training_publication_space_id`,
            this.name,
          ),
          (s) =>
            consumer.afterVersionPublished(s, {
              documentId: event.fileItemId,
              language: event.language,
              versionId: event.revisionId,
              reassignCourseReaders: event.publicationActionConfirmed,
            }),
        );
      },
    });
  }

  readerLibraryHref() {
    return this.routes.readerBasePath;
  }

  readerSubmissionsHref() {
    return this.routes.submissionsHref ?? this.routes.adminBasePath;
  }

  #requiredFiles() {
    if (!this.#files) {
      throw new Error(
        "TrainingDriveExtension is not attached to DriveBlock.",
      );
    }
    return this.#files;
  }
}

/**
 * Renders Training-owned settings and assignment tools beside a controlled
 * Drive file. Drive only supplies the stable controlled-document identity
 * for the selected item.
 */
export function DriveTrainingDocumentAdmin(props: {
  block: TrainingBlock;
  fileItemId: Sql;
}) {
  const block = props.block;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar(
          "drive_training_document_id",
          props.fileItemId,
        );
        initializeTrainingDocumentDetailState(
          s,
          sql`ui.drive_training_document_id`,
        );
        initializeTrainingDocumentAssignmentState(s, block);
      }}
    >
      <section className="space-y-4 rounded-xl border border-divider bg-surface p-5">
        <div>
          <Typography level="title-lg">Training</Typography>
          <Typography level="body-sm" className="mt-1 text-secondary">
            Configure who needs this controlled content and assign its exact
            published revision.
          </Typography>
        </div>
        <TrainingDocumentSettingsPanel />
        <AuthBlock.PermissionCheck permission="can_manage_training_document_settings">
          <div className="flex justify-end border-t border-divider pt-4">
            <ActionButton
              action={(s) => {
                s.if(
                  userHasPermission(
                    sql.lit(
                      trainingPermissions.manageDocumentSettings,
                    ),
                    sql`current_user`,
                  ),
                  (s) =>
                    saveTrainingDocumentDetailSettings(
                      s,
                      block,
                      sql`ui.drive_training_document_id`,
                    ),
                );
              }}
              successMessage="Training settings updated"
            >
              Save training settings
            </ActionButton>
          </div>
        </AuthBlock.PermissionCheck>
        <DirectDocumentAssignmentPanel
          block={block}
          documentId={sql`ui.drive_training_document_id`}
        />
      </section>
    </Data>
  );
}
