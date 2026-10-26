import { Button } from "components/button";
import { ButtonGroup } from "components/button_group";
import { IconButton } from "components/icon_button";
import {
  lexicalDocumentFormattingStyles,
  LexicalRichTextDisplay,
} from "components/lexical/components/lexical_editor";
import {
  ensureLexicalRichTextFunctions,
  ensureLexicalStandardDocumentFunction,
} from "components/lexical/components/lexical_scalar_functions";
import { editorContentStyles } from "components/lexical/components/word_editor/editor_styles";
import { Ribbon } from "components/lexical/components/word_editor/ribbon";
import { StatusBar } from "components/lexical/components/word_editor/status_bar";
import { Sheet } from "components/sheet";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type {
  EndpointStatements,
  GeneralServerStatements,
  ServerStatementsBase,
} from "std/statements";
import { system } from "std/system";
import { storedScheduledProc } from "std/scheduled_utils";
import { Show, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import type {
  DriveBlockContract,
  DriveExtension,
  FileViewerContribution,
} from "./types.ts";

const nativeContentType = "application/vnd.yolm.document+json";
const NATIVE_IMAGE_CHUNK_THRESHOLD = 4 * 1024 * 1024;
const NATIVE_IMAGE_CHUNK_SIZE = 4 * 1024 * 1024;

function contentTypeIsNotSupportedImage(contentType: Sql) {
  return sql`${contentType} not in (
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  )`;
}

export interface NativeDocumentLayoutProps {
  /** A caller-authorized export route, e.g. an assigned training task. */
  pdfHref?: Sql;
  controlledRevisionId?: Sql;
  children: Node;
  fileVersionId: Sql;
  pageId: string | Sql;
}

export function NativeDocumentSheet(
  props: { children: Node; pageId: string | Sql },
) {
  return (
    <div className="flex justify-center overflow-auto bg-neutral-200 px-3 py-6 md:px-8">
      <Sheet
        id={props.pageId}
        className="min-h-[1056px] w-full max-w-[816px] p-6 shadow-md sm:p-12 md:p-24"
      >
        {props.children}
      </Sheet>
    </div>
  );
}

export function NativeDocumentPage(
  {
    value,
    contentId,
    pageId = "native-document-page",
    documents,
    fileVersionId,
    controlledRevisionId,
    pdfHref,
    imageSrcPrefixRewrite,
  }: {
    value: Sql;
    contentId?: string;
    pageId?: string | Sql;
    documents?: NativeDocumentExtension;
    fileVersionId?: Sql;
    controlledRevisionId?: Sql;
    pdfHref?: Sql;
    imageSrcPrefixRewrite?: { prefix: Sql; replacement: Sql };
  },
) {
  const children = (
    <LexicalRichTextDisplay
      id={contentId}
      value={documents?.normalizeContent(value) ?? value}
      imageSrcPrefixRewrite={imageSrcPrefixRewrite}
      sx={{
        ...editorContentStyles,
        ...(documents?.opts.standardFormatting
          ? lexicalDocumentFormattingStyles
          : {}),
        display: "flow-root",
        boxSizing: "border-box",
      }}
    />
  );
  return documents && fileVersionId
    ? documents.renderPage({
      children,
      fileVersionId,
      controlledRevisionId,
      pdfHref,
      pageId,
    })
    : <NativeDocumentSheet pageId={pageId}>{children}</NativeDocumentSheet>;
}

export interface NativeDocumentEditorProps {
  controlledRevisionId?: Sql;
  files: DriveBlockContract;
  documents: NativeDocumentExtension;
  fileItemId: AnyExpr;
  fileVersionId?: AnyExpr;
  readOnly?: AnyExpr;
  allowNewVersionFromHistorical?: AnyExpr;
}

/**
 * Optional rich-text representation for Files. It supplies content editing,
 * not approval; compose it with ControlledFileLifecycle where governance is
 * required.
 */
export class NativeDocumentExtension implements DriveExtension {
  readonly name = "native_document";
  readonly contentTable = "native_document_file_versions";
  readonly imageTable = "native_document_images";
  readonly versionImageTable = "native_document_file_version_images";
  #files?: DriveBlockContract;

  constructor(
    readonly opts: {
      /** Presentation only; never put letterhead or publication metadata in the editable body. */
      renderPage?: (props: NativeDocumentLayoutProps) => Node;
      /** Render an exact revision already authorized by the caller. No ambient transaction. */
      renderAuthorizedPdf?: (
        s: GeneralServerStatements | EndpointStatements,
        props: {
          fileVersionId: Sql;
          controlledRevisionId: Sql;
          intoBytes: string;
        },
      ) => void;
      /** Shared semantic typography for editing, display, and print; no inline CSS. */
      standardFormatting?: boolean;
    } = {},
  ) {}

  normalizeContent(value: Sql): Sql {
    return this.opts.standardFormatting
      ? sql`fn.lexical_standard_document(${value})`
      : value;
  }

  renderPage(props: NativeDocumentLayoutProps): Node {
    return this.opts.renderPage?.(props) ??
      <NativeDocumentSheet {...props} />;
  }

  readonly viewer: FileViewerContribution = {
    name: "native_document",
    canView: (version) =>
      sql`${version}.content_type = ${sql.lit(nativeContentType)}`,
    render: (props) => (
      <NativeDocumentEditor
        files={this.#requiredFiles()}
        documents={this}
        fileItemId={props.fileItemId}
        fileVersionId={props.fileVersionId}
        controlledRevisionId={props.controlledRevisionId}
        readOnly={props.readOnly}
        allowNewVersionFromHistorical={props.allowNewVersionFromHistorical}
      />
    ),
    renderReadOnly: (props) => (
      <NativeDocumentReadOnly
        documents={this}
        fileVersionId={props.fileVersionId}
        controlledRevisionId={props.controlledRevisionId}
        fileName={props.fileName}
        versionNumber={props.versionNumber}
      />
    ),
  };

  initialize(files: DriveBlockContract) {
    this.#files = files;
    ensureLexicalRichTextFunctions(system);
    if (this.opts.standardFormatting) {
      ensureLexicalStandardDocumentFunction(system);
    }
    system.db.table(this.contentTable, (table) => {
      table.fk("file_version_id", files.versionTable).notNull().unique()
        .onDelete("Cascade");
      table.json("rich_content").notNull();
      table.skipAutoApi();
    });
    system.db.table(this.imageTable, (table) => {
      table.fk("file_item_id", files.itemTable).notNull().onDelete("Restrict");
      table.blobRef("blob_hash", 64).notNull();
      table.string("content_type", 120).notNull();
      table.uint("byte_length").notNull();
      table.timestampUtc("pending_until");
      table.unique(["file_item_id", "blob_hash"]);
      table.skipAutoApi();
    });
    system.db.table(this.versionImageTable, (table) => {
      table.fk("file_version_id", files.versionTable).notNull().onDelete(
        "Cascade",
      );
      table.fk("native_document_image_id", this.imageTable).notNull().onDelete(
        "Cascade",
      );
      table.unique(["file_version_id", "native_document_image_id"]);
      table.skipAutoApi();
    });
    system.db.scalarFunction({
      name: "native_document_restore_image_hashes",
      parameters: [{ name: "node", type: "Json" }, {
        name: "item_id",
        type: "BigInt",
      }],
      returnType: "Json",
      procedure: (s) => {
        s.defScalar("result", sql`input.node`);
        s.if(sql`input.node->>'type' = 'image'`, (s) => {
          s.defScalar(
            "registered_hash",
            sql`(select bytes.to_hex(image.blob_hash)
            from db.native_document_images image
            where image.file_item_id = input.item_id
              and input.node->>'src' = '/api/files/native-images/' || input.item_id::string || '/' || bytes.to_hex(image.blob_hash)
              and (image.pending_until is null or image.pending_until > now()))`,
          );
          s.setScalar(
            "result",
            sql`result || json_build_object('blobHash', registered_hash)`,
          );
        });
        s.if(sql`input.node->'root' is not null`, (s) => {
          s.setScalar(
            "result",
            sql`result || json_build_object('root', fn.native_document_restore_image_hashes(input.node->'root', input.item_id))`,
          );
        });
        s.if(sql`input.node->'children' is not null`, (s) => {
          s.setScalar(
            "result",
            sql`result || json_build_object('children', coalesce((
            select json_array_agg(fn.native_document_restore_image_hashes(child.value, input.item_id) order by child.index)
            from json.array_each(input.node->'children') child
          ), '[]'::json))`,
          );
        });
        s.return(sql`result`);
      },
    });
    storedScheduledProc({
      name: "native_document_image_cleanup",
      schedule: "0 15 3 * * *",
      description:
        "Removes expired, unreferenced native-document image uploads.",
      procedure: (s) => {
        s.startTransaction();
        s.modify(sql`
          delete from db.native_document_images image
          where image.pending_until < now()
            and not exists (
              select 1
              from db.native_document_file_version_images reference
              where reference.native_document_image_id = image.id
            )
        `);
        s.commitTransaction();
      },
    });
  }

  registerApi = (
    context: Parameters<NonNullable<DriveExtension["registerApi"]>>[0],
  ) => {
    context.api.post(
      "/files/items/{item_id:id}/native-images/upload",
      {
        query: [
          { name: "file_name", type: { type: "String", maxLength: 500 } },
          { name: "content_type", type: { type: "String", maxLength: 120 } },
        ],
        blobBody: {
          scalar: "native_image_blob_hash",
          sizeScalar: "native_image_upload_size",
          maxSize: 10 * 1024 * 1024,
          authorize: (s) => {
            context.authenticate(s);
            s.defRecord(
              "native_image_upload_item",
              sql`
                select id, file_space_id
                from db.file_items
                where id = item_id
                  and item_kind = 'file'
                  and trashed_at is null
              `,
            );
            s.if(
              sql`
                native_image_upload_item.id is null
                or ${contentTypeIsNotSupportedImage(sql`content_type`)}
                or not (${
                this.#requiredFiles().canCreateVersionSql({
                  spaceId: sql`native_image_upload_item.file_space_id`,
                  itemId: sql`native_image_upload_item.id`,
                  sysUserId: sql`auth_user_id`,
                })
              })
              `,
              (s) => {
                s.setHttpStatus(403);
                s.return(sql.lit`Native image upload is not authorized`);
              },
            );
          },
        },
        procedure: (s) => {
          context.authenticate(s);
          s.defRecord(
            "native_image_upload_item",
            sql`
              select id, file_space_id
              from db.file_items
              where id = item_id
                and item_kind = 'file'
                and trashed_at is null
            `,
          );
          s.if(
            sql`
              native_image_upload_item.id is null
              or ${contentTypeIsNotSupportedImage(sql`content_type`)}
              or native_image_upload_size = 0
              or not (${
              this.#requiredFiles().canCreateVersionSql({
                spaceId: sql`native_image_upload_item.file_space_id`,
                itemId: sql`native_image_upload_item.id`,
                sysUserId: sql`auth_user_id`,
              })
            })
            `,
            (s) => {
              s.setHttpStatus(403);
              s.return(sql.lit`Native image upload is not authorized`);
            },
          );
          s.startTransaction();
          s.modify(sql`
            insert into db.native_document_images (
              file_item_id,
              blob_hash,
              content_type,
              byte_length,
              pending_until
            ) values (
              item_id,
              native_image_blob_hash,
              content_type,
              native_image_upload_size,
              date.add(hour, 6, now())
            )
            on conflict (file_item_id, blob_hash) do update set
              pending_until = case
                when native_document_images.pending_until is null then null
                else excluded.pending_until
              end
          `);
          s.commitTransaction();
          s.setHttpStatus(201);
          s.setHeader(sql.lit`Content-Type`, sql.lit`application/json`);
          s.return(sql`
            json_build_object(
              'success', true,
              'blobHash', bytes.to_hex(native_image_blob_hash),
              'contentType', content_type,
              'fileName', file_name,
              'url', '/api/files/native-images/' ||
                cast(item_id as string) || '/' ||
                bytes.to_hex(native_image_blob_hash)
            )
          `);
        },
      },
    );
    context.api.get(
      "/files/native-images/{image_file_item_id:id}/{hash_hex}",
      {
        procedure: (s) => {
          context.authenticate(s);
          s.defScalar(
            "native_image_api_user",
            sql`coalesce(auth_user_id, current_user)`,
          );
          s.defRecord(
            "authorized_native_image",
            sql`
              select
                image.blob_hash,
                image.content_type,
                image.byte_length
              from db.native_document_images image
              join db.file_items item on item.id = image.file_item_id
              join db.file_spaces space on space.id = item.file_space_id
              where image.file_item_id = image_file_item_id
                and image.blob_hash = bytes.from_hex(hash_hex)
                and (
                  (
                    image.pending_until > now()
                    and ${
              this.#requiredFiles().canCreateVersionSql({
                spaceId: sql`item.file_space_id`,
                itemId: sql`item.id`,
                sysUserId: sql`native_image_api_user`,
              })
            }
                  )
                  or exists (
                    select 1
                    from db.native_document_file_version_images reference
                    join db.file_versions version
                      on version.id = reference.file_version_id
                    where reference.native_document_image_id = image.id
                      and ${
              this.#requiredFiles().canReadVersionSql({
                spaceRecord: sql`space`,
                itemRecord: sql`item`,
                versionRecord: sql`version`,
                sysUserId: sql`native_image_api_user`,
              })
            }
                  )
                )
              limit 1
            `,
          );
          s.if(sql`authorized_native_image.blob_hash is null`, (s) => {
            s.setHttpStatus(404);
            s.return(sql.lit`Native document image not found`);
          });
          s.setHeader(
            sql.lit`Content-Type`,
            sql`authorized_native_image.content_type`,
          );
          s.setHeader(
            sql.lit`Content-Length`,
            sql`authorized_native_image.byte_length::string`,
          );
          s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
          s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
          s.returnBlob(sql`authorized_native_image.blob_hash`);
        },
      },
    );
  };

  validate(files: DriveBlockContract) {
    if (this.#files !== files) {
      throw new Error(
        "NativeDocumentExtension must be initialized by its DriveBlock.",
      );
    }
  }

  registerStoredProcedures = () => {
    const files = this.#requiredFiles();
    system.storedProcedure({
      name: "native_document_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_file_item_id", type: "BigInt" },
        { name: "p_has_file_version", type: "Bool" },
        { name: "p_file_version_id", type: "BigInt" },
        { name: "p_read_only", type: "Bool" },
        { name: "p_allow_historical", type: "Bool" },
      ],
      outputRecords: [
        {
          name: "native_document",
          fields: [
            { name: "file_item_id", type: "BigInt" },
            { name: "name", type: { type: "String", maxLength: 500 } },
            { name: "file_space_id", type: "BigInt" },
            { name: "current_file_version_id", type: "BigInt" },
            { name: "displayed_file_version_id", type: "BigInt" },
            { name: "rich_content", type: "Json" },
            { name: "version_number", type: "Uint" },
          ],
        },
      ],
      outputScalars: [
        { name: "native_document_can_edit", type: "Bool" },
      ],
      procedure: (s) => {
        s.modify(sql`
          insert into native_document
          select
            item.id as file_item_id,
            item.name,
            item.file_space_id,
            item.current_file_version_id,
            version.id as displayed_file_version_id,
            content.rich_content,
            version.version_number
          from db.file_items item
          join db.file_spaces space on space.id = item.file_space_id
          join db.file_versions version
            on version.file_item_id = item.id
            and version.id = case
              when p_has_file_version then p_file_version_id
              else item.current_file_version_id
            end
          join db.native_document_file_versions content
            on content.file_version_id = version.id
          where item.id = p_file_item_id
            and version.content_type = ${sql.lit(nativeContentType)}
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
            sysUserId: sql`current_user`,
          })
        }
        `);
        s.setScalar(
          "native_document_can_edit",
          sql`
            not p_read_only
            and (
              native_document.displayed_file_version_id =
                native_document.current_file_version_id
              or p_allow_historical
            )
            and ${
            files.canCreateVersionSql({
              spaceId: sql`native_document.file_space_id`,
              itemId: sql`native_document.file_item_id`,
              sysUserId: sql`current_user`,
            })
          }
          `,
        );
      },
    });
    system.storedProcedure({
      name: "native_document_save",
      transaction: "standalone",
      inputScalars: [
        { name: "p_file_item_id", type: "BigInt" },
        { name: "p_displayed_file_version_id", type: "BigInt" },
        { name: "p_current_file_version_id", type: "BigInt" },
        { name: "p_allow_historical", type: "Bool" },
        { name: "p_snapshot", type: "Json" },
      ],
      procedure: (s) => {
        s.if(
          sql`
            not (${
            files.canCreateVersionSql({
              spaceId:
                sql`(select file_space_id from db.file_items where id = p_file_item_id)`,
              itemId: sql`p_file_item_id`,
              sysUserId: sql`current_user`,
            })
          })
          `,
          (s) => s.throwError(sql.lit`You cannot edit this document.`),
        );
        s.if(
          sql`
            p_displayed_file_version_id <> p_current_file_version_id
            and not p_allow_historical
          `,
          (s) => s.throwError(sql.lit`This historical version is read-only.`),
        );
        s.startTransaction();
        this.saveDocument(s, {
          fileItemId: sql`p_file_item_id`,
          content: sql`p_snapshot->'editorState'`,
          imageBlobHashes: sql`coalesce(
            p_snapshot->'imageBlobHashes',
            json_build_array()
          )`,
          sysUserId: sql`current_user`,
        });
        s.commitTransaction();
      },
    });
  };

  createDocument<T extends ServerStatementsBase<any>>(
    s: T,
    opts: {
      spaceId: Sql;
      parentItemId?: Sql;
      name: Sql;
      description?: Sql;
      content: Sql;
      sysUserId: Sql;
      intoItem?: string;
      intoVersion?: string;
    },
  ) {
    const files = this.#requiredFiles();
    const parentItemId = opts.parentItemId ?? sql`cast(null as bigint)`;
    s.if(
      sql`not (${
        files.canCreateFileSql({
          spaceId: opts.spaceId,
          parentItemId,
          sysUserId: opts.sysUserId,
        })
      })`,
      (s) => s.throwError(sql.lit`You cannot create documents in this space.`),
    );
    s.if(
      sql`not (${files.extensionEnabledSql(opts.spaceId, this.name)})`,
      (s) =>
        s.throwError(
          sql.lit`Native documents are not enabled for this space.`,
        ),
    );
    const itemResult = opts.intoItem ?? "created_native_document_item_id";
    const versionResult = opts.intoVersion ??
      "created_native_document_version_id";
    files.createFileItem(s, {
      spaceId: opts.spaceId,
      parentItemId: opts.parentItemId,
      name: opts.name,
      description: opts.description,
      into: itemResult,
    });
    files.createFileVersion(s, {
      itemId: sql.ref(itemResult),
      fileName: opts.name,
      contentType: sql.lit(nativeContentType),
      byteLength: sql`0`,
      sysUserId: opts.sysUserId,
      intoVersion: versionResult,
    });
    s.modify(sql`
      insert into db.native_document_file_versions (
        file_version_id,
        rich_content
      ) values (
        ${sql.ref(versionResult)},
        ${this.normalizeContent(opts.content)}
      )
    `);
  }

  saveDocument<T extends ServerStatementsBase<any>>(
    s: T,
    opts: {
      fileItemId: Sql;
      content: Sql;
      sysUserId: Sql;
      note?: Sql;
      imageBlobHashes?: Sql;
      intoVersion?: string;
    },
  ) {
    const files = this.#requiredFiles();
    const versionResult = opts.intoVersion ??
      "saved_native_document_version_id";
    s.if(
      sql`
        not exists (
          select 1
          from db.file_items item
          join db.file_versions version
            on version.id = item.current_file_version_id
          where item.id = ${opts.fileItemId}
            and item.item_kind = 'file'
            and item.trashed_at is null
            and version.content_type = ${sql.lit(nativeContentType)}
            and ${
        files.extensionEnabledSql(
          sql`item.file_space_id`,
          this.name,
        )
      }
        )
      `,
      (s) => s.throwError(sql.lit`This native document is unavailable.`),
    );
    s.if(
      sql`
        not (${
        files.canCreateVersionSql({
          spaceId:
            sql`(select file_space_id from db.file_items where id = ${opts.fileItemId})`,
          itemId: opts.fileItemId,
          sysUserId: opts.sysUserId,
        })
      })
      `,
      (s) => s.throwError(sql.lit`You cannot edit this document.`),
    );
    files.createFileVersion(s, {
      itemId: opts.fileItemId,
      fileName:
        sql`(select name from db.file_items where id = ${opts.fileItemId})`,
      contentType: sql.lit(nativeContentType),
      byteLength: sql`0`,
      note: opts.note,
      sysUserId: opts.sysUserId,
      intoVersion: versionResult,
    });
    s.modify(sql`
      insert into db.native_document_file_versions (
        file_version_id,
        rich_content
      ) values (
        ${sql.ref(versionResult)},
        ${this.normalizeContent(opts.content)}
      )
    `);
    const imageBlobHashes = opts.imageBlobHashes ?? sql`json_build_array()`;
    s.modify(sql`
      insert into db.native_document_file_version_images (
        file_version_id,
        native_document_image_id
      )
      select
        ${sql.ref(versionResult)},
        image.id
        from json.array_each(coalesce(
          ${imageBlobHashes},
          json_build_array()
        )) image_hash
        join db.native_document_images image
          on image.file_item_id = ${opts.fileItemId}
          and bytes.to_hex(image.blob_hash) =
            string.from_json_string(image_hash.value)
      on conflict (
        file_version_id,
        native_document_image_id
      ) do nothing
    `);
    s.modify(sql`
      update db.native_document_images image
      set pending_until = null
      where image.file_item_id = ${opts.fileItemId}
        and image.id in (
          select reference.native_document_image_id
          from db.native_document_file_version_images reference
          where reference.file_version_id = ${sql.ref(versionResult)}
        )
    `);
    s.modify(sql`
      delete from db.native_document_images image
      where image.pending_until < now()
        and not exists (
          select 1
          from db.native_document_file_version_images reference
          where reference.native_document_image_id = image.id
        )
    `);
  }

  #requiredFiles() {
    if (!this.#files) {
      throw new Error("NativeDocumentExtension is not attached to DriveBlock.");
    }
    return this.#files;
  }
}

/**
 * Display-only rendering for statically read-only surfaces. FileViewer has
 * already resolved and authorized the exact item/version (and matched the
 * content type) before dispatching here, so this fetches only the
 * representation payload by version id, with no second access predicate.
 */
function NativeDocumentReadOnly(props: {
  controlledRevisionId?: Sql;
  documents: NativeDocumentExtension;
  fileVersionId: Sql;
  fileName: Sql;
  versionNumber: Sql;
}) {
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "native_document_display",
          sql`
            select content.rich_content
            from db.native_document_file_versions content
            where content.file_version_id = ${props.fileVersionId}
          `,
        );
      }}
    >
      <Show when={sql`native_document_display.rich_content is not null`}>
        <section className="overflow-hidden rounded-lg border border-divider bg-surface">
          <header className="border-b border-divider px-4 py-3">
            <Typography level="title-md">
              {props.fileName}
            </Typography>
            <p className="text-xs text-secondary">
              {sql`'Version ' || cast(${props.versionNumber} as string)`}
            </p>
          </header>
          <NativeDocumentPage
            documents={props.documents}
            fileVersionId={props.fileVersionId}
            controlledRevisionId={props.controlledRevisionId}
            value={sql`native_document_display.rich_content`}
          />
        </section>
      </Show>
    </Data>
  );
}

/** Rich-text editor/viewer whose saves append immutable technical versions. */
export function NativeDocumentEditor(props: NativeDocumentEditorProps) {
  useJsModule("http_file_upload");
  useJsModule("lexical_editor");
  const editorContainerId = useUniqueId();
  const readOnly = props.readOnly ?? sql`false`;
  const allowNewVersionFromHistorical = props.allowNewVersionFromHistorical ??
    sql`false`;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("native_document_editing", false);
        s.defScalar(
          "native_document_content",
          sql`lexical_simple_paragraph('')`,
        );
        s.defScalar("native_document_error", sql.lit``);
        s.defScalar("native_document_image_upload_handle", sql`random.uuid()`);
        s.defScalar("native_document_image_uploading", false);
        s.defScalar("native_document_image_upload_status", sql.lit``);
        s.defScalar("editor_handle", {
          type: "Uuid",
          expr: sql`random.uuid()`,
        });
        s.defScalar("is_bold", false);
        s.defScalar("is_italic", false);
        s.defScalar("is_underline", false);
        s.defScalar("is_strikethrough", false);
        s.defScalar("is_subscript", false);
        s.defScalar("is_superscript", false);
        s.defScalar("font_size", { type: "String" });
        s.defScalar("font_color", { type: "String" });
        s.defScalar("background_color", { type: "String" });
        s.defScalar("font_family", { type: "String" });
        s.defScalar("alignment", sql.lit`left`);
        s.defScalar("link_url", { type: "String" });
        s.defScalar("selected_block_type", sql.lit`normal`);
        s.defScalar("can_undo", false);
        s.defScalar("can_redo", false);
        s.defScalar("selected_image", false);
        s.defScalar("word_count", sql`0`);
        s.defScalar("char_count", sql`0`);
        s.defScalar("ribbon_tab", sql`0`);
        s.defScalar("save_status", sql.lit``);
        s.defTable(
          "fonts",
          props.documents.opts.standardFormatting
            ? sql`select ${sql.lit`Noto Sans`} as name`
            : sql`select * from (values ('Arial'), ('Calibri'), ('Courier New'), ('Georgia'), ('Helvetica'), ('Times New Roman'), ('Verdana')) as t(name)`,
        );
      }}
    >
      <Data
        procedure={(s) => {
          s.callStoredProcedure("native_document_state", {
            inputScalars: {
              p_file_item_id: props.fileItemId,
              p_has_file_version: props.fileVersionId !== undefined,
              p_file_version_id: props.fileVersionId ??
                sql`cast(null as bigint)`,
              p_read_only: readOnly,
              p_allow_historical: allowNewVersionFromHistorical,
            },
            outputRecords: {
              native_document: "native_document",
            },
            outputScalars: {
              native_document_can_edit: "native_document_can_edit",
            },
          });
        }}
      >
        <Show when={sql`native_document.file_item_id is not null`}>
          <section
            className="overflow-hidden rounded-lg border border-divider bg-surface"
            js={{
              handles: [{
                module: "http_file_upload",
                cleanup: "cleanup",
                handle: sql`native_document_image_upload_handle`,
              }],
              on: {
                "http_file_upload.filesSelected": (s) => {
                  s.if(
                    sql`coalesce(event.payload_json->>'success', 'false') = 'true'`,
                    (s) => {
                      s.setScalar("native_document_image_uploading", true);
                      s.setScalar(
                        "native_document_image_upload_status",
                        sql.lit`Uploading image…`,
                      );
                      s.jsCall({
                        module: "http_file_upload",
                        exportName: "upload",
                        handle: sql`native_document_image_upload_handle`,
                        argJson: sql`json_build_object(
                          'handle', native_document_image_upload_handle,
                          'endpoint',
                            '/api/files/items/' ||
                            cast(native_document.file_item_id as string) ||
                            '/native-images/upload',
                          'concurrency', 1,
                          'chunkThreshold', ${NATIVE_IMAGE_CHUNK_THRESHOLD},
                          'chunkSize', ${NATIVE_IMAGE_CHUNK_SIZE}
                        )`,
                      });
                    },
                  );
                },
                "http_file_upload.filesUploaded": (s) => {
                  s.setScalar("native_document_image_uploading", false);
                  s.setScalar(
                    "native_document_image_upload_status",
                    sql.lit``,
                  );
                  s.defRecord(
                    "uploaded_native_image",
                    sql`
                      select
                        result.value->'response'->>'blobHash' as blob_hash,
                        result.value->'response'->>'contentType'
                          as content_type,
                        result.value->'response'->>'fileName' as file_name,
                        result.value->'response'->>'url' as url
                      from json.array_each(
                        coalesce(
                          event.payload_json->'results',
                          json_build_array()
                        )
                      ) result
                      limit 1
                    `,
                  );
                  s.if(sql`uploaded_native_image.url is not null`, (s) => {
                    s.jsCall({
                      module: "lexical_editor",
                      exportName: "executeCommand",
                      handle: sql`ui.editor_handle`,
                      argJson: sql`json_build_object(
                        'handle', ui.editor_handle,
                        'command', 'insertImage',
                        'src', uploaded_native_image.url,
                        'altText', coalesce(
                          uploaded_native_image.file_name,
                          'Image'
                        ),
                        'blobHash', uploaded_native_image.blob_hash,
                        'contentType', uploaded_native_image.content_type,
                        'width', 560
                      )`,
                    });
                  });
                },
                "http_file_upload.uploadProgress": (s) => {
                  s.setScalar(
                    "native_document_image_upload_status",
                    sql`'Uploading ' || coalesce(
                      event.payload_json->>'currentFileName',
                      'image'
                    ) || '…'`,
                  );
                },
                "http_file_upload.uploadError": (s) => {
                  s.setScalar("native_document_image_uploading", false);
                  s.setScalar(
                    "native_document_image_upload_status",
                    sql.lit``,
                  );
                  s.setScalar(
                    "native_document_error",
                    sql`coalesce(
                      event.payload_json->>'error',
                      'Image upload failed.'
                    )`,
                  );
                },
                "http_file_upload.selectionCancelled": (s) => {
                  s.setScalar("native_document_image_uploading", false);
                  s.setScalar(
                    "native_document_image_upload_status",
                    sql.lit``,
                  );
                },
              },
            }}
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-4 py-3">
              <div>
                <Typography level="title-md">
                  {sql`native_document.name`}
                </Typography>
                <p className="text-xs text-secondary">
                  {sql`'Version ' || cast(native_document.version_number as string)`}
                </p>
              </div>
              <Show when={sql`native_document_can_edit`}>
                <Show
                  when={sql`ui.native_document_editing`}
                  fallback={
                    <Button
                      size="sm"
                      variant="outlined"
                      startIcon="Edit"
                      onClick={(s) => {
                        s.setScalar(
                          "native_document_content",
                          sql`native_document.rich_content`,
                        );
                        s.setScalar("native_document_error", sql.lit``);
                        s.setScalar("save_status", sql.lit``);
                        s.setScalar("native_document_editing", true);
                      }}
                    >
                      Edit
                    </Button>
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Typography level="body-xs" className="text-neutral-600">
                      {sql`ui.save_status`}
                    </Typography>
                    <Button
                      size="sm"
                      variant="plain"
                      color="neutral"
                      disabled={sql`ui.native_document_image_uploading`}
                      onClick={(s) => {
                        s.setScalar("native_document_editing", false);
                        s.setScalar("native_document_error", sql.lit``);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      startIcon="Save"
                      disabled={sql`ui.native_document_image_uploading`}
                      onClick={(s) => {
                        s.setScalar("native_document_error", sql.lit``);
                        s.jsCall({
                          module: "lexical_editor",
                          exportName: "getContent",
                          handle: sql`ui.editor_handle`,
                          argJson:
                            sql`json_build_object('handle', ui.editor_handle)`,
                          resultJsonScalar: "native_document_save_content",
                        });
                        s.tryServer({
                          body: (s) => {
                            s.callStoredProcedure("native_document_save", {
                              inputScalars: {
                                p_file_item_id:
                                  sql`native_document.file_item_id`,
                                p_displayed_file_version_id:
                                  sql`native_document.displayed_file_version_id`,
                                p_current_file_version_id:
                                  sql`native_document.current_file_version_id`,
                                p_allow_historical:
                                  allowNewVersionFromHistorical,
                                p_snapshot: sql`native_document_save_content`,
                              },
                            });
                            s.setScalar("native_document_editing", false);
                            s.setScalar("save_status", sql.lit``);
                            s.refetch();
                          },
                          errorName: "native_document_save_error",
                          catch: (s) =>
                            s.setScalar(
                              "native_document_error",
                              sql`coalesce(native_document_save_error.message, 'Unable to save document.')`,
                            ),
                        });
                      }}
                    >
                      Save new version
                    </Button>
                  </div>
                </Show>
              </Show>
            </header>
            <Show
              when={sql`ui.native_document_editing`}
              fallback={
                <NativeDocumentPage
                  documents={props.documents}
                  fileVersionId={sql`native_document.displayed_file_version_id`}
                  controlledRevisionId={props.controlledRevisionId}
                  value={sql`native_document.rich_content`}
                />
              }
            >
              <div className="flex min-h-[720px] flex-col">
                <Ribbon
                  standardFormatting={props.documents.opts.standardFormatting}
                  pictureControl={
                    <Button
                      size="sm"
                      variant="outlined"
                      startIcon="Image"
                      disabled={sql`ui.native_document_image_uploading`}
                      onClick={(s) => {
                        s.setScalar("native_document_error", sql.lit``);
                        s.jsCall({
                          module: "http_file_upload",
                          exportName: "selectFiles",
                          handle: sql`native_document_image_upload_handle`,
                          argJson: sql`json_build_object(
                            'handle', native_document_image_upload_handle,
                            'multiple', false,
                            'accept',
                              'image/png,image/jpeg,image/gif,image/webp'
                          )`,
                        });
                      }}
                    >
                      Picture
                    </Button>
                  }
                />
                <Show when={sql`ui.selected_image`}>
                  <div className="flex items-center gap-3 border-b border-divider bg-surface px-4 py-2">
                    <Typography level="body-sm">Picture layout</Typography>
                    <ButtonGroup
                      variant="outlined"
                      color="neutral"
                      size="sm"
                    >
                      <IconButton
                        aria-label="Align Picture Left"
                        tooltip="Place left and wrap text"
                        icon="FormatAlignLeft"
                        onClick={(s) => {
                          s.jsCall({
                            module: "lexical_editor",
                            exportName: "executeCommand",
                            handle: sql`ui.editor_handle`,
                            argJson:
                              sql`json_build_object('handle', ui.editor_handle, 'command', 'alignSelectedImage', 'align', 'left')`,
                          });
                        }}
                      />
                      <IconButton
                        aria-label="Align Picture Center"
                        tooltip="Center without text wrapping"
                        icon="FormatAlignCenter"
                        onClick={(s) => {
                          s.jsCall({
                            module: "lexical_editor",
                            exportName: "executeCommand",
                            handle: sql`ui.editor_handle`,
                            argJson:
                              sql`json_build_object('handle', ui.editor_handle, 'command', 'alignSelectedImage', 'align', 'center')`,
                          });
                        }}
                      />
                      <IconButton
                        aria-label="Align Picture Right"
                        tooltip="Place right and wrap text"
                        icon="FormatAlignRight"
                        onClick={(s) => {
                          s.jsCall({
                            module: "lexical_editor",
                            exportName: "executeCommand",
                            handle: sql`ui.editor_handle`,
                            argJson:
                              sql`json_build_object('handle', ui.editor_handle, 'command', 'alignSelectedImage', 'align', 'right')`,
                          });
                        }}
                      />
                    </ButtonGroup>
                  </div>
                </Show>
                <Show
                  when={sql`ui.native_document_image_upload_status <> ''`}
                >
                  <div className="border-b border-divider bg-primary-50 px-4 py-2 text-sm text-primary-700">
                    {sql`ui.native_document_image_upload_status`}
                  </div>
                </Show>
                {props.documents.renderPage({
                  fileVersionId: sql`native_document.displayed_file_version_id`,
                  controlledRevisionId: props.controlledRevisionId,
                  pageId: "native-document-page",
                  children: (
                    <div
                      contentEditable
                      id={editorContainerId}
                      sx={{
                        ...editorContentStyles,
                        ...(props.documents.opts.standardFormatting
                          ? lexicalDocumentFormattingStyles
                          : {}),
                        display: "flow-root",
                        minHeight: "600px",
                        boxSizing: "border-box",
                        "& a": { pointerEvents: "none" },
                      }}
                      js={{
                        handles: [{
                          module: "lexical_editor",
                          handle: sql`ui.editor_handle`,
                          cleanup: "cleanup",
                        }],
                        on: {
                          "lexical_editor.stateChanged": (s) => {
                            s.setScalar(
                              "is_bold",
                              sql`coalesce(event.payload_json->>'is_bold' = 'true', false)`,
                            );
                            s.setScalar(
                              "is_italic",
                              sql`coalesce(event.payload_json->>'is_italic' = 'true', false)`,
                            );
                            s.setScalar(
                              "is_underline",
                              sql`coalesce(event.payload_json->>'is_underline' = 'true', false)`,
                            );
                            s.setScalar(
                              "is_strikethrough",
                              sql`coalesce(event.payload_json->>'is_strikethrough' = 'true', false)`,
                            );
                            s.setScalar(
                              "is_subscript",
                              sql`coalesce(event.payload_json->>'is_subscript' = 'true', false)`,
                            );
                            s.setScalar(
                              "is_superscript",
                              sql`coalesce(event.payload_json->>'is_superscript' = 'true', false)`,
                            );
                            s.setScalar(
                              "alignment",
                              sql`coalesce(event.payload_json->>'alignment', 'left')`,
                            );
                            s.setScalar(
                              "selected_block_type",
                              sql`coalesce(event.payload_json->>'selected_block_type', 'normal')`,
                            );
                            s.setScalar(
                              "link_url",
                              sql`event.payload_json->>'link_url'`,
                            );
                            s.setScalar(
                              "font_size",
                              sql`case
                                when event.payload_json->>'font_size' is null
                                  or event.payload_json->>'font_size' = 'null'
                                  then null
                                else replace(
                                  event.payload_json->>'font_size',
                                  'px',
                                  ''
                                )
                              end`,
                            );
                            s.setScalar(
                              "font_color",
                              sql`event.payload_json->>'font_color'`,
                            );
                            s.setScalar(
                              "background_color",
                              sql`event.payload_json->>'background_color'`,
                            );
                            s.setScalar(
                              "font_family",
                              sql`event.payload_json->>'font_family'`,
                            );
                            s.setScalar(
                              "can_undo",
                              sql`coalesce(event.payload_json->>'can_undo' = 'true', false)`,
                            );
                            s.setScalar(
                              "can_redo",
                              sql`coalesce(event.payload_json->>'can_redo' = 'true', false)`,
                            );
                            s.setScalar(
                              "selected_image",
                              sql`coalesce(event.payload_json->>'selected_image' = 'true', false)`,
                            );
                          },
                          "lexical_editor.contentChanged": (s) => {
                            s.setScalar(
                              "native_document_content",
                              sql`event.payload_json->'editorState'`,
                            );
                            s.setScalar(
                              "word_count",
                              sql`coalesce(
                                try_cast(
                                  event.payload_json->>'word_count' as int
                                ),
                                0
                              )`,
                            );
                            s.setScalar(
                              "char_count",
                              sql`coalesce(
                                try_cast(
                                  event.payload_json->>'char_count' as int
                                ),
                                0
                              )`,
                            );
                            s.setScalar(
                              "save_status",
                              sql.lit`Unsaved changes`,
                            );
                          },
                          "lexical_editor.error": (s) =>
                            s.setScalar(
                              "native_document_error",
                              sql`coalesce(event.payload_json->>'message', 'The editor could not complete that action.')`,
                            ),
                        },
                      }}
                      onMount={(s) => {
                        s.sleep(100);
                        s.jsCall({
                          module: "lexical_editor",
                          exportName: "init",
                          handle: sql`ui.editor_handle`,
                          argJson: sql`json_build_object(
                            'handle', ui.editor_handle,
                            'containerId', ${editorContainerId},
                            'initialContent', ${
                            props.documents.normalizeContent(
                              sql`ui.native_document_content`,
                            )
                          },
                            'standardFormatting', ${!!props.documents.opts
                            .standardFormatting},
                            'preserveStoredTextStyles', ${!props.documents.opts
                            .standardFormatting},
                            'preservePastedTextStyles', ${!props.documents.opts
                            .standardFormatting}
                          )`,
                        });
                        s.jsCall({
                          module: "http_file_upload",
                          exportName: "enableCapture",
                          handle: sql`ui.native_document_image_upload_handle`,
                          argJson: sql`json_build_object(
                            'handle',
                              ui.native_document_image_upload_handle,
                            'targetId', ${editorContainerId},
                            'sources', json_build_array('paste'),
                            'accept',
                              'image/png,image/jpeg,image/gif,image/webp',
                            'multiple', false
                          )`,
                        });
                      }}
                    />
                  ),
                })}
                <StatusBar />
              </div>
            </Show>
            <div className="px-5 pb-5">
              <Show when={sql`ui.native_document_error <> ''`}>
                <p className="mt-3 text-sm text-danger-600">
                  {sql`ui.native_document_error`}
                </p>
              </Show>
            </div>
          </section>
        </Show>
      </Data>
    </Data>
  );
}
