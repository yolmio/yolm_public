import {
  type PdfMarkupRotationEvent,
  type PdfMarkupSaveEvent,
  PdfWorkspaceEditor,
  PdfWorkspaceViewer,
} from "components/pdf_markup";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type { DomStatements, ServerStatementsBase } from "std/statements";
import { system } from "std/system";
import { Show } from "std/ui";
import type {
  DriveBlockContract,
  DriveExtension,
  FileViewerContribution,
  FileViewerDocumentHref,
} from "./types.ts";

export interface PdfMarkupExtensionOpts {
  defaultContext?: string;
  assetUrl?: string;
  /**
   * Grants markup and rotation editing for one exact immutable version without
   * granting general Drive write access, such as to an assigned reviewer.
   */
  canEditVersion?: (fileVersionId: Sql, sysUserId: Sql) => Sql;
  /** Selects a workflow-specific markup context for an exact version. */
  contextKeyForVersion?: (fileVersionId: Sql) => Sql;
}

export interface PdfMarkupDriveWorkspaceProps {
  files: DriveBlockContract;
  markup: PdfMarkupExtension;
  spaceId: AnyExpr;
  initialVersionId: AnyExpr;
  contextKey?: string | Sql;
  readOnly?: AnyExpr;
  height?: string;
  handle?: Sql | string;
  initialPage?: Sql;
  initialFocus?: Sql;
  /** Product route for each document, built as `prefix || version id || suffix`. */
  documentHref?: FileViewerDocumentHref;
  includeFolderDocuments?: boolean;
  showMarkup?: boolean;
  onFileChange?: (
    s: DomStatements,
    fileItemId: Sql,
    fileVersionId: Sql,
  ) => void;
}

export interface PdfMarkupPageRenderOptions {
  fileVersionId: Sql;
  pdf: Sql;
  page: Sql;
  pageWidth: Sql;
  pageHeight: Sql;
  renderWidth: Sql;
  defOutputScalar: string;
  contextKey?: string | Sql;
}

export interface PdfMarkupReadOptions {
  fileVersionId: Sql;
  page?: Sql;
  contextKey?: string | Sql;
}

/**
 * PDF-specific composition for Files. All annotations and rotations are
 * anchored to an immutable technical file version, so revised drawings never
 * inherit marks made against different page geometry.
 */
export class PdfMarkupExtension implements DriveExtension {
  readonly name = "pdf_markup";
  readonly setTable = "pdf_markup_sets";
  readonly revisionTable = "pdf_markup_revisions";
  readonly rotationTable = "pdf_page_rotations";
  #files?: DriveBlockContract;
  readonly viewer: FileViewerContribution = {
    name: "pdf_markup",
    canView: (version) =>
      sql`${version}.content_type = 'application/pdf' collate nocase`,
    render: (props) => (
      <PdfMarkupDriveWorkspace
        files={this.#requiredFiles()}
        markup={this}
        spaceId={props.fileSpaceId}
        initialVersionId={props.fileVersionId}
        readOnly={props.readOnly}
        height={props.workspace ? props.height : undefined}
        handle={props.workspace ? props.workspaceHandle : undefined}
        initialPage={props.initialPdfPage}
        initialFocus={props.initialPdfFocus}
        includeFolderDocuments={props.workspace &&
          props.presentation !== "governed"}
        documentHref={props.documentHref}
        showMarkup={props.presentation !== "governed"}
        onFileChange={props.onWorkspaceFileChange}
      />
    ),
  };

  constructor(readonly opts: PdfMarkupExtensionOpts = {}) {}

  initialize(files: DriveBlockContract) {
    this.#files = files;
    const { db } = system;

    db.table(this.setTable, (table) => {
      table.fk("file_version_id", files.versionTable).notNull().onDelete(
        "Cascade",
      );
      table.string("context_key", 100).notNull();
      table.fk("current_pdf_markup_revision_id", this.revisionTable).onDelete(
        "SetToNull",
      );
      table.unique(["file_version_id", "context_key"]);
      table.skipAutoApi();
    });

    db.table(this.revisionTable, (table) => {
      table.fk("pdf_markup_set_id", this.setTable).notNull().onDelete(
        "Cascade",
      );
      table.uint("revision_number").notNull();
      table.json("annotation_json").notNull();
      table.fk("created_by_user_id", "sys_users").notNull().onDelete(
        "Restrict",
      );
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.unique(["pdf_markup_set_id", "revision_number"]);
      table.skipAutoApi();
    });

    db.table(this.rotationTable, (table) => {
      table.fk("file_version_id", files.versionTable).notNull().onDelete(
        "Cascade",
      );
      table.smallUint("page_number").notNull();
      table.smallUint("rotation_quarter_turns").notNull();
      table.fk("updated_by_user_id", "sys_users").notNull().onDelete(
        "Restrict",
      );
      table.timestampUtc("updated_at").notNull().default(sql`now()`);
      table.unique(["file_version_id", "page_number"]);
      table.check({
        fields: ["page_number"],
        errorMessage: () => sql.lit`PDF page number must be positive.`,
        check: ([page]) => sql`${page} >= 1`,
      });
      table.check({
        fields: ["rotation_quarter_turns"],
        errorMessage: () =>
          sql.lit`PDF rotation must be between zero and three.`,
        check: ([turns]) => sql`${turns} <= 3`,
      });
      table.skipAutoApi();
    });
  }

  validate(files: DriveBlockContract) {
    if (this.#files !== files) {
      throw new Error(
        "PdfMarkupExtension must be initialized by its DriveBlock.",
      );
    }
  }

  /** Resolve the same workflow context used by the PDF workspace. */
  resolveContextKey(fileVersionId: Sql, contextKey?: string | Sql) {
    if (typeof contextKey === "string") return sql.lit(contextKey);
    if (contextKey) return contextKey;
    return this.opts.contextKeyForVersion
      ? this.opts.contextKeyForVersion(fileVersionId)
      : sql.lit(this.opts.defaultContext ?? "working");
  }

  /** Read the current saved markup, optionally narrowed to one page. */
  readMarkupJson(opts: PdfMarkupReadOptions) {
    const files = this.#requiredFiles();
    const contextKey = this.resolveContextKey(
      opts.fileVersionId,
      opts.contextKey,
    );
    const page = opts.page ?? sql`cast(null as int)`;
    return sql`(
      select json_build_object(
        'fileVersionId', version.id,
        'contextKey', params.context_key,
        'page', params.page,
        'revision', coalesce(revision.revision_number, 0),
        'savedAt', revision.created_at,
        'annotations', case
          when params.page is null
            then coalesce(revision.annotation_json, '[]'::json)
          else coalesce((
            select json_array_agg(annotation.value)
            from json.array_each(
              coalesce(revision.annotation_json, '[]'::json)
            ) annotation
            where try_cast(annotation.value->>'page' as int) = params.page
          ), '[]'::json)
        end,
        'rotations', coalesce((
          select json_array_agg(json_build_object(
            'page', rotation.page_number,
            'quarterTurns', rotation.rotation_quarter_turns
          ) order by rotation.page_number)
          from db.pdf_page_rotations rotation
          where rotation.file_version_id = version.id
            and (params.page is null or rotation.page_number = params.page)
        ), '[]'::json)
      )
      from db.${sql.ref(files.versionTable)} version
      cross join (select ${contextKey} as context_key, ${page} as page) params
      left join db.pdf_markup_sets markup_set
        on markup_set.file_version_id = version.id
        and markup_set.context_key = params.context_key
      left join db.pdf_markup_revisions revision
        on revision.id = markup_set.current_pdf_markup_revision_id
      where version.id = ${opts.fileVersionId}
    )`;
  }

  /**
   * Render one PDF page with its saved annotations and rotation. Typst is
   * skipped when the requested page has no presentation changes.
   */
  renderPage<T extends ServerStatementsBase<any>>(
    s: T,
    opts: PdfMarkupPageRenderOptions,
  ) {
    system.useTypstTemplate("drive_pdf_markup_page");
    const contextKey = this.resolveContextKey(
      opts.fileVersionId,
      opts.contextKey,
    );
    s.defRecord(
      "pdf_markup_page",
      sql`select
        coalesce((
          select ((rotation.rotation_quarter_turns % 4) + 4) % 4
          from db.pdf_page_rotations rotation
          where rotation.file_version_id = ${opts.fileVersionId}
            and rotation.page_number = ${opts.page}
        ), 0) as rotation_quarter_turns,
        coalesce((
          select json_array_agg(annotation.value)
          from db.pdf_markup_sets markup_set
          join db.pdf_markup_revisions revision
            on revision.id = markup_set.current_pdf_markup_revision_id
          cross join json.array_each(
            coalesce(revision.annotation_json, '[]'::json)
          ) annotation
          where markup_set.file_version_id = ${opts.fileVersionId}
            and markup_set.context_key = ${contextKey}
            and try_cast(annotation.value->>'page' as int) = ${opts.page}
        ), '[]'::json) as annotations`,
    );
    s.defScalar(
      "pdf_markup_page_needs_composite",
      sql`pdf_markup_page.rotation_quarter_turns != 0
        or json_array_length(pdf_markup_page.annotations) > 0`,
    );
    s.defScalar("pdf_markup_render_pdf", {
      type: { type: "Bytes", maxLength: 1000000000 },
      expr: opts.pdf,
    });
    s.if(sql`pdf_markup_page_needs_composite`, (s) => {
      s.defScalar(
        "pdf_markup_page_data",
        sql`cast(json_build_object(
          'page', ${opts.page},
          'width', ${opts.pageWidth},
          'height', ${opts.pageHeight},
          'rotationQuarterTurns', pdf_markup_page.rotation_quarter_turns,
          'annotations', pdf_markup_page.annotations
        ) as string)`,
      );
      s.renderTypst({
        template: sql.lit`drive_pdf_markup_page`,
        data: sql`pdf_markup_page_data`,
        outputFormat: "pdf",
        assets: [{ name: "source.pdf", data: opts.pdf }],
        setPdfOutputScalar: "pdf_markup_render_pdf",
      });
    });
    s.pdfRenderPage({
      pdf: sql`pdf_markup_render_pdf`,
      page:
        sql`case when pdf_markup_page_needs_composite then 1 else ${opts.page} end`,
      width: opts.renderWidth,
      defOutputScalar: opts.defOutputScalar,
    });
  }

  registerStoredProcedures = () => {
    system.storedProcedure({
      name: "pdf_markup_save_annotations",
      transaction: "standalone",
      inputScalars: [
        { name: "p_document_key", type: { type: "String", maxLength: 100 } },
        { name: "p_annotations", type: "Json" },
        { name: "p_revision", type: "BigInt" },
        { name: "p_context_key", type: { type: "String", maxLength: 100 } },
      ],
      procedure: (s) => {
        this.saveAnnotations(s, {
          documentKey: sql`p_document_key`,
          annotations: sql`p_annotations`,
          revision: sql`p_revision`,
        }, {
          contextKey: sql`p_context_key`,
        });
      },
    });
    system.storedProcedure({
      name: "pdf_markup_workspace_access_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_initial_version_id", type: "BigInt" },
        { name: "p_read_only", type: "Bool" },
        { name: "p_show_markup", type: "Bool" },
      ],
      outputScalars: [
        { name: "files_pdf_can_view", type: "Bool" },
        { name: "files_pdf_can_edit", type: "Bool" },
      ],
      procedure: (s) => {
        const files = this.#requiredFiles();
        s.setScalar(
          "files_pdf_can_view",
          sql`
            ${files.extensionEnabledSql(sql`p_space_id`, this.name)}
            and ${
            files.runtimeAccessSql(
              sql`p_space_id`,
              sql`current_user`,
              "read",
            )
          }
          `,
        );
        s.setScalar(
          "files_pdf_can_edit",
          sql`
            files_pdf_can_view
            and p_show_markup
            and not p_read_only
            and (
              ${
            files.runtimeAccessSql(
              sql`p_space_id`,
              sql`current_user`,
              "write",
            )
          }
              ${
            this.opts.canEditVersion
              ? sql`or ${
                this.opts.canEditVersion(
                  sql`p_initial_version_id`,
                  sql`current_user`,
                )
              }`
              : sql``
          }
            )
            and exists (
              select 1
              from db.file_versions editable_version
              join db.file_items editable_item
                on editable_item.id = editable_version.file_item_id
              join db.file_spaces editable_space
                on editable_space.id = editable_item.file_space_id
              where editable_version.id = p_initial_version_id
                and editable_item.file_space_id = p_space_id
                and ${
            files.canReadVersionSql({
              spaceRecord: sql`editable_space`,
              itemRecord: sql`editable_item`,
              versionRecord: sql`editable_version`,
              sysUserId: sql`current_user`,
            })
          }
            )
          `,
        );
      },
    });
    system.storedProcedure({
      name: "pdf_markup_workspace_documents_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_initial_version_id", type: "BigInt" },
        { name: "p_can_view", type: "Bool" },
        { name: "p_include_folder_documents", type: "Bool" },
        { name: "p_show_markup", type: "Bool" },
        { name: "p_context_key", type: { type: "String", maxLength: 100 } },
        { name: "p_context_key_is_fixed", type: "Bool" },
        { name: "p_read_only", type: "Bool" },
        { name: "p_href_prefix", type: { type: "String", maxLength: 200 } },
        { name: "p_href_suffix", type: { type: "String", maxLength: 200 } },
        {
          name: "p_href_id_source",
          type: { type: "String", maxLength: 20 },
        },
        // Explicit folder selection: null derives the folder from
        // p_initial_version_id and -1 selects the space root.
        { name: "p_folder_id", type: "BigInt" },
      ],
      outputScalars: [
        { name: "files_pdf_documents", type: "Json" },
        { name: "files_pdf_any_can_edit", type: "Bool" },
      ],
      procedure: (s) => {
        const files = this.#requiredFiles();
        const documentContext = sql`case
          when p_context_key_is_fixed then p_context_key
          else ${this.resolveContextKey(sql`version.id`)}
        end`;
        const documentCanEdit = sql`
          p_show_markup
          and not p_read_only
          and (
            ${
          files.runtimeAccessSql(
            sql`p_space_id`,
            sql`current_user`,
            "write",
          )
        }
            ${
          this.opts.canEditVersion
            ? sql`or ${
              this.opts.canEditVersion(
                sql`version.id`,
                sql`current_user`,
              )
            }`
            : sql``
        }
          )
        `;
        s.defScalar(
          "files_pdf_custom_ordering",
          files.customOrderingSql(sql`p_space_id`),
        );
        s.defScalar(
          "files_pdf_folder_id",
          sql`case
            when p_folder_id = -1 then cast(null as bigint)
            when p_folder_id is not null then p_folder_id
            else (
              select item.parent_file_item_id
              from db.file_versions version
              join db.file_items item on item.id = version.file_item_id
              where version.id = p_initial_version_id
                and item.file_space_id = p_space_id
            )
          end`,
        );
        s.defTable(
          "files_pdf_workspace_documents",
          sql`
            select
              cast(version.id as string) as key,
              cast(item.id as string) as file_item_id,
              ${
            files.versionBlobUrl(
              sql`version.id`,
              sql`blob.blob_hash`,
            )
          } as file_url,
              case when p_include_folder_documents then item.name
                else version.file_name end as file_name,
              case
                when p_href_prefix is null then cast(null as string)
                else p_href_prefix || cast(case
                  when p_href_id_source = 'item' then item.id
                  else version.id
                end as string) ||
                  coalesce(p_href_suffix, '')
              end as href,
              ${documentContext} as context_key,
              ${documentCanEdit} as can_edit,
              row_number() over (
                order by ${
            files.itemOrderSql(
              sql`item`,
              sql`files_pdf_custom_ordering`,
            )
          }
              ) as sort_index
            from db.file_items item
            join db.file_versions version
              on version.id = case
                when item.id = (
                  select requested_version.file_item_id
                  from db.file_versions requested_version
                  where requested_version.id = p_initial_version_id
                )
                  then p_initial_version_id
                else item.current_file_version_id
              end
            join db.file_version_blobs blob
              on blob.file_version_id = version.id
            join db.file_spaces document_space
              on document_space.id = item.file_space_id
            where item.file_space_id = p_space_id
              and (
                case
                  when p_include_folder_documents then (
                    item.parent_file_item_id = files_pdf_folder_id
                    or (
                      item.parent_file_item_id is null
                      and files_pdf_folder_id is null
                    )
                  )
                  else version.id = p_initial_version_id
                end
              )
              and (
                item.trashed_at is null
                or (p_read_only and not p_show_markup
                  and not p_include_folder_documents
                  and version.id = p_initial_version_id)
              )
              and version.content_type = 'application/pdf' collate nocase
              and p_can_view
              and ${
            files.canReadVersionSql({
              spaceRecord: sql`document_space`,
              itemRecord: sql`item`,
              versionRecord: sql`version`,
              sysUserId: sql`current_user`,
            })
          }
          `,
        );
        s.setScalar(
          "files_pdf_documents",
          sql`
            coalesce((
              select json_array_agg(
                json_build_object(
                  'key', document.key,
                  'fileItemId', document.file_item_id,
                  'fileUrl', document.file_url,
                  'fileName', document.file_name,
                  'href', document.href,
                  'dataUrl', case
                    when p_show_markup
                      then '/api/files/versions/' || document.key ||
                        '/pdf-markup/' || document.context_key
                    else cast(null as string)
                  end,
                  'contextKey', document.context_key,
                  'canEdit', document.can_edit,
                  'annotations', json_build_array(),
                  'revision', 0,
                  'rotations', json_build_array()
                )
                order by document.sort_index
              )
              from files_pdf_workspace_documents document
            ), json_build_array())
          `,
        );
        s.setScalar(
          "files_pdf_any_can_edit",
          sql`exists (
            select 1
            from files_pdf_workspace_documents document
            where document.can_edit
          )`,
        );
      },
    });
    system.storedProcedure({
      name: "pdf_markup_save_rotation",
      transaction: "standalone",
      inputScalars: [
        { name: "p_document_key", type: { type: "String", maxLength: 100 } },
        { name: "p_page", type: "BigInt" },
        { name: "p_quarter_turns", type: "BigInt" },
      ],
      procedure: (s) => {
        this.saveRotation(s, {
          documentKey: sql`p_document_key`,
          page: sql`p_page`,
          quarterTurns: sql`p_quarter_turns`,
        });
      },
    });
  };

  registerApi: NonNullable<DriveExtension["registerApi"]> = ({
    api,
    authenticate,
  }) => {
    api.get(
      "/files/versions/{version_id:id}/pdf-markup/{markup_context}",
      {
        procedure: (s) => {
          const files = this.#requiredFiles();
          authenticate(s);
          s.defRecord(
            "requested_pdf_markup",
            sql`
              select
                version.id,
                coalesce(revision.annotation_json, '[]'::json)
                  as annotation_json,
                coalesce(revision.revision_number, 0) as revision_number
              from db.file_versions version
              join db.file_items item on item.id = version.file_item_id
              join db.file_spaces space on space.id = item.file_space_id
              left join db.pdf_markup_sets markup_set
                on markup_set.file_version_id = version.id
                and markup_set.context_key = markup_context
              left join db.pdf_markup_revisions revision
                on revision.id = markup_set.current_pdf_markup_revision_id
              where version.id = version_id
                and version.content_type = 'application/pdf' collate nocase
                and ${
              files.extensionEnabledForTypeSql(
                sql`space.space_type`,
                this.name,
              )
            }
                and ${
              files.canReadVersionSql({
                spaceRecord: sql`space`,
                itemRecord: sql`item`,
                versionRecord: sql`version`,
                sysUserId: sql`auth_user_id`,
              })
            }
            `,
          );
          s.if(sql`requested_pdf_markup.id is null`, (s) => {
            s.setHttpStatus(404);
            s.return(sql.lit`PDF markup not found`);
          });
          s.setHeader(sql.lit`Content-Type`, sql.lit`application/json`);
          s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
          s.return(sql`
            json_build_object(
              'annotations', requested_pdf_markup.annotation_json,
              'revision', requested_pdf_markup.revision_number,
              'rotations', coalesce((
                select json_array_agg(
                  json_build_object(
                    'page', rotation.page_number,
                    'quarterTurns', rotation.rotation_quarter_turns
                  )
                  order by rotation.page_number
                )
                from db.pdf_page_rotations rotation
                where rotation.file_version_id = requested_pdf_markup.id
              ), json_build_array())
            )
          `);
        },
      },
    );
  };

  saveAnnotations<T extends ServerStatementsBase<any>>(
    s: T,
    event: Pick<PdfMarkupSaveEvent, "documentKey" | "annotations" | "revision">,
    opts: {
      contextKey?: Sql;
      expectedRevision?: Sql;
      intoRevision?: string;
    } = {},
  ) {
    const files = this.#requiredFiles();
    const contextKey = this.resolveContextKey(
      sql`markup_file_version_id`,
      opts.contextKey,
    );
    const expectedRevision = opts.expectedRevision ?? event.revision;
    s.defScalar(
      "markup_file_version_id",
      sql`try_cast(${event.documentKey} as bigint)`,
    );
    s.if(
      sql`
        not exists (
          select 1
          from db.file_versions version
          join db.file_items item on item.id = version.file_item_id
          join db.file_spaces space on space.id = item.file_space_id
          where version.id = markup_file_version_id
            and version.content_type = 'application/pdf' collate nocase
            and ${
        files.extensionEnabledForTypeSql(
          sql`space.space_type`,
          this.name,
        )
      }
            and (
              ${
        files.runtimeAccessSql(
          sql`item.file_space_id`,
          sql`current_user`,
          "write",
        )
      }
              ${
        this.opts.canEditVersion
          ? sql`or ${
            this.opts.canEditVersion(
              sql`markup_file_version_id`,
              sql`current_user`,
            )
          }`
          : sql``
      }
            )
            and ${
        files.canReadVersionSql({
          spaceRecord: sql`space`,
          itemRecord: sql`item`,
          versionRecord: sql`version`,
          sysUserId: sql`current_user`,
        })
      }
        )
      `,
      (s) => s.throwError(sql.lit`This PDF cannot be edited.`),
    );
    s.startTransaction();
    s.defScalar(
      "markup_set_id",
      sql`(
        select markup_set.id
        from db.pdf_markup_sets markup_set
        where markup_set.file_version_id = markup_file_version_id
          and markup_set.context_key = ${contextKey}
      )`,
    );
    s.if(sql`markup_set_id is null`, (s) => {
      s.if(sql`coalesce(${expectedRevision}, 0) <> 0`, (s) => {
        s.throwError(
          sql
            .lit`These markups changed after you opened them. Reload and try again.`,
        );
      });
      s.modify(sql`
        insert into db.pdf_markup_sets (
          file_version_id,
          context_key
        ) values (
          markup_file_version_id,
          ${contextKey}
        )
      `);
      s.setScalar("markup_set_id", sql`last_record_id(db.pdf_markup_sets)`);
    }).else((s) => {
      s.defScalar(
        "current_markup_revision_number",
        sql`coalesce((
          select revision.revision_number
          from db.pdf_markup_sets markup_set
          left join db.pdf_markup_revisions revision
            on revision.id = markup_set.current_pdf_markup_revision_id
          where markup_set.id = markup_set_id
        ), 0)`,
      );
      s.if(
        sql`current_markup_revision_number <> coalesce(${expectedRevision}, 0)`,
        (s) =>
          s.throwError(
            sql
              .lit`These markups changed after you opened them. Reload and try again.`,
          ),
      );
    });
    s.defScalar(
      "next_markup_revision_number",
      sql`coalesce(${expectedRevision}, 0) + 1`,
    );
    s.modify(sql`
      insert into db.pdf_markup_revisions (
        pdf_markup_set_id,
        revision_number,
        annotation_json,
        created_by_user_id
      ) values (
        markup_set_id,
        next_markup_revision_number,
        coalesce(${event.annotations}, '[]'::json),
        current_user
      )
    `);
    s.defScalar(
      "created_markup_revision_id",
      sql`last_record_id(db.pdf_markup_revisions)`,
    );
    s.modify(sql`
      update db.pdf_markup_sets
      set current_pdf_markup_revision_id = created_markup_revision_id
      where id = markup_set_id
    `);
    if (opts.intoRevision) {
      s.defScalar(opts.intoRevision, sql`next_markup_revision_number`);
    }
    s.commitTransaction();
  }

  saveRotation<T extends ServerStatementsBase<any>>(
    s: T,
    event: Pick<
      PdfMarkupRotationEvent,
      "documentKey" | "page" | "quarterTurns"
    >,
  ) {
    const files = this.#requiredFiles();
    s.defScalar(
      "rotation_file_version_id",
      sql`try_cast(${event.documentKey} as bigint)`,
    );
    s.if(
      sql`
        not exists (
          select 1
          from db.file_versions version
          join db.file_items item on item.id = version.file_item_id
          join db.file_spaces space on space.id = item.file_space_id
          where version.id = rotation_file_version_id
            and version.content_type = 'application/pdf' collate nocase
            and ${
        files.extensionEnabledForTypeSql(
          sql`space.space_type`,
          this.name,
        )
      }
            and (
              ${
        files.runtimeAccessSql(
          sql`item.file_space_id`,
          sql`current_user`,
          "write",
        )
      }
              ${
        this.opts.canEditVersion
          ? sql`or ${
            this.opts.canEditVersion(
              sql`rotation_file_version_id`,
              sql`current_user`,
            )
          }`
          : sql``
      }
            )
            and ${
        files.canReadVersionSql({
          spaceRecord: sql`space`,
          itemRecord: sql`item`,
          versionRecord: sql`version`,
          sysUserId: sql`current_user`,
        })
      }
        )
      `,
      (s) => s.throwError(sql.lit`This PDF cannot be rotated.`),
    );
    s.startTransaction();
    s.if(sql`${event.quarterTurns} = 0`, (s) => {
      s.modify(sql`
        delete from db.pdf_page_rotations
        where file_version_id = rotation_file_version_id
          and page_number = ${event.page}
      `);
    }).else((s) => {
      s.modify(sql`
        insert into db.pdf_page_rotations (
          file_version_id,
          page_number,
          rotation_quarter_turns,
          updated_by_user_id,
          updated_at
        ) values (
          rotation_file_version_id,
          ${event.page},
          ${event.quarterTurns},
          current_user,
          now()
        )
        on conflict (file_version_id, page_number)
        do update set
          rotation_quarter_turns = excluded.rotation_quarter_turns,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = excluded.updated_at
      `);
    });
    s.commitTransaction();
  }

  #requiredFiles() {
    if (!this.#files) {
      throw new Error("PdfMarkupExtension is not attached to DriveBlock.");
    }
    return this.#files;
  }
}

/**
 * Saves the workspace's active document markups when they are dirty, then
 * runs `then`. Use before replacing the document set: `setDocuments` discards
 * in-memory edits, unlike in-set navigation which the editor guards itself.
 */
export function savePdfWorkspaceMarkupsThen(
  s: DomStatements,
  opts: {
    handle: Sql;
    contextKey: Sql;
    canEdit: Sql;
    errorScalar: string;
  },
  then: (s: DomStatements) => void,
) {
  s.setScalar(opts.errorScalar, sql.lit``);
  s.if(sql`${opts.canEdit}`, (s) => {
    s.jsCall({
      module: "pdf_markup",
      exportName: "getAnnotations",
      handle: opts.handle,
      argJson: sql`json_build_object('handle', ${opts.handle})`,
      resultJsonScalar: "files_pdf_flush_payload",
    });
    s.defScalar(
      "files_pdf_flush_result",
      sql`coalesce(files_pdf_flush_payload->'json', files_pdf_flush_payload)`,
    );
    s.if(
      sql`
        coalesce(try_cast(files_pdf_flush_result->>'success' as bool), false)
        and coalesce(try_cast(files_pdf_flush_result->>'dirty' as bool), false)
      `,
      (s) => {
        s.defScalar("files_pdf_flush_saved", sql`false`);
        s.tryServer({
          body: (s) => {
            s.callStoredProcedure("pdf_markup_save_annotations", {
              inputScalars: {
                p_document_key:
                  sql`coalesce(files_pdf_flush_result->>'documentKey', '')`,
                p_annotations:
                  sql`coalesce(files_pdf_flush_result->'annotations', '[]'::json)`,
                p_revision:
                  sql`coalesce(try_cast(files_pdf_flush_result->>'revision' as int), 0)`,
                p_context_key: opts.contextKey,
              },
            });
            s.setScalar("files_pdf_flush_saved", true);
          },
          errorName: "files_pdf_flush_error",
          catch: (s) =>
            s.setScalar(
              opts.errorScalar,
              sql`coalesce(
                files_pdf_flush_error.message,
                'Unable to save markups.'
              )`,
            ),
        });
        s.if(sql`files_pdf_flush_saved`, (s) => {
          s.jsCall({
            module: "pdf_markup",
            exportName: "markClean",
            handle: opts.handle,
            argJson: sql`json_build_object(
              'handle', ${opts.handle},
              'revision', coalesce(
                try_cast(files_pdf_flush_result->>'revision' as int),
                0
              ) + 1,
              'changeSequence', coalesce(
                try_cast(files_pdf_flush_result->>'changeSequence' as int),
                0
              )
            )`,
            resultJsonScalar: "files_pdf_flush_clean_payload",
          });
        });
      },
    );
  });
  s.if(sql`${sql.ref(opts.errorScalar)} = ''`, then);
}

/** Ordered, virtualized PDF workspace over the selected file's folder. */
export function PdfMarkupDriveWorkspace(
  props: PdfMarkupDriveWorkspaceProps,
) {
  useJsModule("pdf_markup", {
    assetUrl: props.markup.opts.assetUrl,
  });
  const context = props.markup.resolveContextKey(
    sql`${props.initialVersionId}`,
    props.contextKey,
  );
  const readOnly = props.readOnly ?? sql`false`;
  const includeFolderDocuments = props.includeFolderDocuments ?? true;
  const showMarkup = props.showMarkup ?? true;
  const onFileChange = props.onFileChange;
  return (
    <Data
      procedure={(s) => {
        s.callStoredProcedure("pdf_markup_workspace_access_state", {
          inputScalars: {
            p_space_id: props.spaceId,
            p_initial_version_id: props.initialVersionId,
            p_read_only: readOnly,
            p_show_markup: showMarkup,
          },
          outputScalars: {
            files_pdf_can_view: "files_pdf_can_view",
            files_pdf_can_edit: "files_pdf_can_edit",
          },
        });
        s.callStoredProcedure("pdf_markup_workspace_documents_state", {
          inputScalars: {
            p_space_id: props.spaceId,
            p_initial_version_id: props.initialVersionId,
            p_can_view: sql`files_pdf_can_view`,
            p_include_folder_documents: includeFolderDocuments,
            p_show_markup: showMarkup,
            p_context_key: context,
            p_context_key_is_fixed: props.contextKey !== undefined
              ? sql`true`
              : sql`false`,
            p_read_only: readOnly,
            p_href_prefix: props.documentHref
              ? sql.lit(props.documentHref.prefix)
              : sql`cast(null as string)`,
            p_href_suffix: props.documentHref?.suffix
              ? sql.lit(props.documentHref.suffix)
              : sql`cast(null as string)`,
            p_href_id_source: props.documentHref
              ? sql.lit(props.documentHref.id ?? "version")
              : sql.lit`version`,
            p_folder_id: sql`cast(null as bigint)`,
          },
          outputScalars: {
            files_pdf_documents: "files_pdf_documents",
            files_pdf_any_can_edit: "files_pdf_any_can_edit",
          },
        });
      }}
    >
      <div
        className="min-h-0"
        sx={props.height ? { height: props.height } : undefined}
      >
        <Show when={sql`files_pdf_can_view`}>
          <Show
            when={sql`files_pdf_any_can_edit`}
            fallback={
              <PdfWorkspaceViewer
                handle={props.handle}
                documents={sql`files_pdf_documents`}
                initialDocumentKey={sql`cast(${props.initialVersionId} as string)`}
                initialPage={props.initialPage}
                initialFocus={props.initialFocus}
                height={props.height}
                allowRotation={false}
                allowDownloadFlattened
                onDocumentChange={onFileChange
                  ? (s, event) =>
                    onFileChange(s, event.fileItemId, event.documentKey)
                  : undefined}
              />
            }
          >
            <PdfWorkspaceEditor
              handle={props.handle}
              documents={sql`files_pdf_documents`}
              initialDocumentKey={sql`cast(${props.initialVersionId} as string)`}
              initialPage={props.initialPage}
              initialFocus={props.initialFocus}
              height={props.height}
              allowDownloadFlattened
              onDocumentChange={onFileChange
                ? (s, event) =>
                  onFileChange(s, event.fileItemId, event.documentKey)
                : undefined}
              onSave={(s, event) => {
                s.callStoredProcedure("pdf_markup_save_annotations", {
                  inputScalars: {
                    p_document_key: event.documentKey,
                    p_annotations: event.annotations,
                    p_revision: event.revision,
                    p_context_key: event.contextKey,
                  },
                });
              }}
              onRotationChange={(s, event) =>
                s.callStoredProcedure("pdf_markup_save_rotation", {
                  inputScalars: {
                    p_document_key: event.documentKey,
                    p_page: event.page,
                    p_quarter_turns: event.quarterTurns,
                  },
                })}
            />
          </Show>
        </Show>
      </div>
    </Data>
  );
}
