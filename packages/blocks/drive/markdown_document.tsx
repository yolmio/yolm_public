import { Button } from "components/button";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { MarkdownDisplay } from "components/markdown_display";
import { ModalDialog } from "components/modal";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type { DomStatements, ServerStatementsBase } from "std/statements";
import { system } from "std/system";
import { EventHandlers, Show } from "std/ui";
import type { Node } from "std/ui";
import type {
  DriveBlockContract,
  DriveExtension,
  FileViewerContribution,
} from "./types.ts";

export const markdownDocumentContentType = "text/markdown";
const MAX_MARKDOWN_BYTES = 1024 * 1024;

export interface MarkdownDocumentEditorProps {
  files: DriveBlockContract;
  documents: MarkdownDocumentExtension;
  fileItemId: AnyExpr;
  fileVersionId?: AnyExpr;
  readOnly?: AnyExpr;
  allowNewVersionFromHistorical?: AnyExpr;
  /** Uses a viewport-filling document surface instead of the reusable card. */
  workspaceLayout?: boolean;
  /** Optional destination for the workspace layout's leading back action. */
  backHref?: AnyExpr;
  /** Optional product-shell control rendered at the start of the toolbar. */
  toolbarLeading?: Node;
  /** Optional display-only transform; stored and edited Markdown stays exact. */
  renderContent?: (content: Sql) => Sql;
}

/**
 * Exact Markdown content stored against immutable Drive versions. This is a
 * representation extension only: Drive continues to own identity, folders,
 * version history, access, and trash.
 */
export class MarkdownDocumentExtension implements DriveExtension {
  readonly name = "markdown_document";
  readonly contentTable = "markdown_file_versions";
  #files?: DriveBlockContract;

  readonly viewer: FileViewerContribution = {
    name: "markdown_document",
    canView: (version) =>
      sql`${version}.content_type = ${sql.lit(markdownDocumentContentType)}`,
    render: (props) => (
      <MarkdownDocumentEditor
        files={this.#requiredFiles()}
        documents={this}
        fileItemId={props.fileItemId}
        fileVersionId={props.fileVersionId}
        readOnly={props.readOnly}
        allowNewVersionFromHistorical={props.allowNewVersionFromHistorical}
      />
    ),
    renderReadOnly: (props) => (
      <MarkdownDocumentReadOnly
        fileVersionId={props.fileVersionId}
        fileName={props.fileName}
        versionNumber={props.versionNumber}
      />
    ),
  };

  initialize(files: DriveBlockContract) {
    this.#files = files;
    system.db.table(this.contentTable, (table) => {
      table.fk("file_version_id", files.versionTable).notNull().unique()
        .onDelete("Cascade");
      table.string("content", MAX_MARKDOWN_BYTES).notNull();
      table.skipAutoApi();
    });
  }

  validate(files: DriveBlockContract) {
    if (this.#files !== files) {
      throw new Error(
        "MarkdownDocumentExtension must be initialized by its DriveBlock.",
      );
    }
  }

  registerStoredProcedures = () => {
    system.storedProcedure({
      name: "markdown_document_create",
      transaction: "standalone",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_parent_item_id", type: "BigInt" },
        { name: "p_name", type: { type: "String", maxLength: 500 } },
        { name: "p_content", type: "String" },
      ],
      procedure: (s) => {
        s.startTransaction();
        this.createDocument(s, {
          spaceId: sql`p_space_id`,
          parentItemId: sql`p_parent_item_id`,
          name: sql`p_name`,
          content: sql`p_content`,
          sysUserId: sql`current_user`,
        });
        s.commitTransaction();
      },
    });
    system.storedProcedure({
      name: "markdown_document_save",
      transaction: "standalone",
      inputScalars: [
        { name: "p_file_item_id", type: "BigInt" },
        { name: "p_content", type: "String" },
      ],
      procedure: (s) => {
        s.startTransaction();
        this.saveDocument(s, {
          fileItemId: sql`p_file_item_id`,
          content: sql`p_content`,
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
      (s) => s.throwError(sql.lit`You cannot create documents in this folder.`),
    );
    s.if(
      sql`not (${files.extensionEnabledSql(opts.spaceId, this.name)})`,
      (s) =>
        s.throwError(
          sql.lit`Markdown documents are not enabled for this space.`,
        ),
    );
    s.if(
      sql`octet_length(string.to_utf8(${opts.content})) > ${MAX_MARKDOWN_BYTES}`,
      (s) => s.throwError(sql.lit`Markdown documents are limited to 1 MB.`),
    );
    const itemResult = opts.intoItem ?? "created_markdown_document_item_id";
    const versionResult = opts.intoVersion ??
      "created_markdown_document_version_id";
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
      contentType: sql.lit(markdownDocumentContentType),
      byteLength: sql`octet_length(string.to_utf8(${opts.content}))`,
      sysUserId: opts.sysUserId,
      intoVersion: versionResult,
    });
    s.modify(sql`
      insert into db.markdown_file_versions (file_version_id, content)
      values (${sql.ref(versionResult)}, ${opts.content})
    `);
  }

  saveDocument<T extends ServerStatementsBase<any>>(
    s: T,
    opts: {
      fileItemId: Sql;
      content: Sql;
      sysUserId: Sql;
      note?: Sql;
      intoVersion?: string;
    },
  ) {
    const files = this.#requiredFiles();
    s.if(
      sql`octet_length(string.to_utf8(${opts.content})) > ${MAX_MARKDOWN_BYTES}`,
      (s) => s.throwError(sql.lit`Markdown documents are limited to 1 MB.`),
    );
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
            and version.content_type = ${sql.lit(markdownDocumentContentType)}
            and ${
        files.extensionEnabledSql(
          sql`item.file_space_id`,
          this.name,
        )
      }
        )
      `,
      (s) => s.throwError(sql.lit`This Markdown document is unavailable.`),
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
    const versionResult = opts.intoVersion ??
      "saved_markdown_document_version_id";
    files.createFileVersion(s, {
      itemId: opts.fileItemId,
      fileName:
        sql`(select name from db.file_items where id = ${opts.fileItemId})`,
      contentType: sql.lit(markdownDocumentContentType),
      byteLength: sql`octet_length(string.to_utf8(${opts.content}))`,
      note: opts.note,
      sysUserId: opts.sysUserId,
      intoVersion: versionResult,
    });
    s.modify(sql`
      insert into db.markdown_file_versions (file_version_id, content)
      values (${sql.ref(versionResult)}, ${opts.content})
    `);
  }

  #requiredFiles() {
    if (!this.#files) {
      throw new Error(
        "MarkdownDocumentExtension is not attached to DriveBlock.",
      );
    }
    return this.#files;
  }
}

export function CreateMarkdownDocumentButton(props: {
  documents: MarkdownDocumentExtension;
  spaceId: AnyExpr;
  parentItemId: AnyExpr;
}) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("markdown_create_open", false);
        s.defScalar("markdown_create_name", sql.lit``);
        s.defScalar("markdown_create_content", sql.lit``);
        s.defScalar("markdown_create_error", sql.lit``);
      }}
    >
      <Button
        size="sm"
        variant="outlined"
        startIcon="NoteAdd"
        onClick={(s) => s.setScalar("markdown_create_open", true)}
      >
        New document
      </Button>
      <ModalDialog
        open={sql`ui.markdown_create_open`}
        onClose={(s) => s.setScalar("markdown_create_open", false)}
      >
        <div className="flex w-[min(44rem,90vw)] flex-col gap-3 p-4">
          <Typography level="title-lg">New Markdown document</Typography>
          <label className="text-sm font-medium">
            Name
            <input
              className="mt-1 w-full rounded border border-divider bg-surface px-3 py-2"
              value={sql`ui.markdown_create_name`}
              onInput={(s) =>
                s.setScalar("markdown_create_name", sql`target_value`)}
              autoFocus
            />
          </label>
          <label className="text-sm font-medium">
            Content
            <Textarea
              className="mt-1 font-mono"
              minRows={14}
              fullWidth
              bindScalar="markdown_create_content"
            />
          </label>
          <Show when={sql`ui.markdown_create_error <> ''`}>
            <p className="text-sm text-danger">
              {sql`ui.markdown_create_error`}
            </p>
          </Show>
          <div className="flex justify-end gap-2">
            <Button
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("markdown_create_open", false)}
            >
              Cancel
            </Button>
            <Button
              disabled={sql`trim(ui.markdown_create_name) = ''`}
              onClick={(s) => {
                s.setScalar("markdown_create_error", sql.lit``);
                s.tryServer({
                  body: (s) => {
                    s.callStoredProcedure("markdown_document_create", {
                      inputScalars: {
                        p_space_id: sql`${props.spaceId}`,
                        p_parent_item_id: sql`${props.parentItemId}`,
                        p_name: sql`ui.markdown_create_name`,
                        p_content: sql`ui.markdown_create_content`,
                      },
                    });
                    s.setScalar("markdown_create_open", false);
                    s.setScalar("markdown_create_name", sql.lit``);
                    s.setScalar("markdown_create_content", sql.lit``);
                    s.refetch();
                  },
                  errorName: "markdown_create_failure",
                  catch: (s) =>
                    s.setScalar(
                      "markdown_create_error",
                      sql`coalesce(markdown_create_failure.message, 'Could not create the document.')`,
                    ),
                });
              }}
            >
              Create
            </Button>
          </div>
        </div>
      </ModalDialog>
    </Data>
  );
}

/**
 * Display-only rendering for statically read-only surfaces. FileViewer has
 * already resolved and authorized the exact item/version (and matched the
 * content type) before dispatching here, so this fetches only the
 * representation payload by version id, with no second access predicate.
 */
function MarkdownDocumentReadOnly(props: {
  fileVersionId: Sql;
  fileName: Sql;
  versionNumber: Sql;
}) {
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "markdown_document_display",
          sql`
            select content.content
            from db.markdown_file_versions content
            where content.file_version_id = ${props.fileVersionId}
          `,
        );
      }}
    >
      <Show when={sql`markdown_document_display.content is not null`}>
        <section className="overflow-hidden rounded-lg border border-divider bg-surface">
          <header className="border-b border-divider px-4 py-3">
            <Typography level="title-md">
              {props.fileName}
            </Typography>
            <p className="text-xs text-secondary">
              {sql`'Version ' || cast(${props.versionNumber} as string)`}
            </p>
          </header>
          <MarkdownDisplay
            className="max-h-[70vh] overflow-auto p-5"
            content={sql`markdown_document_display.content`}
          />
        </section>
      </Show>
    </Data>
  );
}

export function MarkdownDocumentEditor(props: MarkdownDocumentEditorProps) {
  const readOnly = props.readOnly ?? sql`false`;
  const allowHistorical = props.allowNewVersionFromHistorical ?? sql`false`;
  const renderedContent = (content: Sql) =>
    props.renderContent ? props.renderContent(content) : content;
  const beginEditing = (s: DomStatements) => {
    s.setScalar("markdown_draft", sql`markdown_document.content`);
    s.setScalar("markdown_editing", true);
  };
  const cancelEditing = (s: DomStatements) => {
    s.setScalar("markdown_editing", false);
    s.setScalar("markdown_error", sql.lit``);
  };
  const saveDocument = (s: DomStatements) => {
    s.setScalar("markdown_error", sql.lit``);
    s.tryServer({
      body: (s) => {
        s.callStoredProcedure("markdown_document_save", {
          inputScalars: {
            p_file_item_id: sql`markdown_document.file_item_id`,
            p_content: sql`ui.markdown_draft`,
          },
        });
        s.setScalar("markdown_editing", false);
        s.refetch();
      },
      errorName: "markdown_save_failure",
      catch: (s) =>
        s.setScalar(
          "markdown_error",
          sql`coalesce(markdown_save_failure.message, 'Could not save the document.')`,
        ),
    });
  };
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("markdown_editing", false);
        s.defScalar("markdown_draft", sql.lit``);
        s.defScalar("markdown_error", sql.lit``);
      }}
    >
      <Data
        procedure={(s) => {
          s.defRecord(
            "markdown_document",
            sql`
              select
                item.id as file_item_id,
                item.name,
                item.file_space_id,
                item.current_file_version_id,
                version.id as displayed_file_version_id,
                version.version_number,
                content.content
              from db.file_items item
              join db.file_spaces space on space.id = item.file_space_id
              join db.file_versions version
                on version.file_item_id = item.id
                and version.id = ${
              props.fileVersionId === undefined
                ? sql`item.current_file_version_id`
                : sql`${props.fileVersionId}`
            }
              join db.markdown_file_versions content
                on content.file_version_id = version.id
              where item.id = ${props.fileItemId}
                and version.content_type = ${
              sql.lit(markdownDocumentContentType)
            }
                and ${
              props.files.canReadVersionSql({
                spaceRecord: sql`space`,
                itemRecord: sql`item`,
                versionRecord: sql`version`,
                sysUserId: sql`current_user`,
              })
            }
            `,
          );
          s.defScalar(
            "markdown_can_edit",
            sql`
              not (${readOnly})
              and (
                markdown_document.displayed_file_version_id =
                  markdown_document.current_file_version_id
                or ${allowHistorical}
              )
              and ${
              props.files.canCreateVersionSql({
                spaceId: sql`markdown_document.file_space_id`,
                itemId: sql`markdown_document.file_item_id`,
                sysUserId: sql`current_user`,
              })
            }
            `,
          );
        }}
      >
        <Show when={sql`markdown_document.file_item_id is not null`}>
          <section
            className={props.workspaceLayout
              ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface"
              : "overflow-hidden rounded-lg border border-divider bg-surface"}
          >
            <header className="flex items-center justify-between gap-1 border-b border-divider px-2 py-3 sm:gap-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-1 sm:gap-2">
                {props.toolbarLeading}
                {props.backHref !== undefined
                  ? (
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="neutral"
                      aria-label="Back to Spark workspace"
                      href={sql`${props.backHref}`}
                      backLink
                    >
                      <MaterialIcon icon="ArrowBack" />
                    </IconButton>
                  )
                  : null}
                <div className="min-w-0">
                  <Typography level="title-md" className="truncate">
                    {sql`markdown_document.name`}
                  </Typography>
                  <p
                    className="whitespace-nowrap text-xs text-secondary"
                    aria-label={sql`'Version ' || cast(markdown_document.version_number as string)`}
                  >
                    <span className="mr-1 hidden sm:inline">Version</span>
                    {sql`cast(markdown_document.version_number as string)`}
                  </p>
                </div>
              </div>
              <Show
                when={sql`ui.markdown_editing`}
                fallback={
                  <Show when={sql`markdown_can_edit`}>
                    <Button
                      size="sm"
                      variant="outlined"
                      startIcon="Edit"
                      onClick={beginEditing}
                    >
                      Edit
                    </Button>
                  </Show>
                }
              >
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="plain"
                    color="neutral"
                    onClick={cancelEditing}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    aria-label="Save new version"
                    onClick={saveDocument}
                  >
                    <span className="sm:hidden">Save</span>
                    <span className="hidden sm:inline">Save new version</span>
                  </Button>
                </div>
              </Show>
            </header>
            <Show
              when={sql`ui.markdown_editing`}
              fallback={props.workspaceLayout
                ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <MarkdownDisplay
                      className="mx-auto w-full max-w-4xl p-6 md:p-8"
                      content={renderedContent(sql`markdown_document.content`)}
                    />
                  </div>
                )
                : (
                  <MarkdownDisplay
                    className="max-h-[70vh] overflow-auto p-5"
                    content={renderedContent(sql`markdown_document.content`)}
                  />
                )}
            >
              <EventHandlers
                document={{
                  keydown: (s) =>
                    s.if(
                      sql`(event.ctrl_key or event.meta_key)
                        and lower(event.key) = 's'`,
                      (s) => {
                        s.event.preventDefault();
                        saveDocument(s);
                      },
                    ),
                }}
              />
              <div
                className={props.workspaceLayout
                  ? "grid min-h-0 flex-1 grid-rows-2 divide-y divide-divider overflow-hidden md:grid-cols-2 md:grid-rows-1 md:divide-x md:divide-y-0"
                  : "grid min-h-[32rem] grid-cols-2 divide-x divide-divider"}
              >
                <div className="flex min-h-0 flex-col overflow-hidden p-4">
                  <Textarea
                    className="h-full min-h-0 flex-1 overflow-hidden font-mono"
                    fullWidth
                    minRows={props.workspaceLayout ? undefined : 24}
                    bindScalar="markdown_draft"
                    slotProps={{
                      textarea: {
                        className: "h-full min-h-0 resize-none overflow-auto",
                        sx: { fieldSizing: "fixed" },
                      },
                    }}
                  />
                </div>
                <MarkdownDisplay
                  className={props.workspaceLayout
                    ? "min-h-0 overflow-auto p-5"
                    : "max-h-[70vh] overflow-auto p-5"}
                  content={renderedContent(sql`ui.markdown_draft`)}
                />
              </div>
              <Show when={sql`ui.markdown_error <> ''`}>
                <p className="border-t border-divider px-4 py-2 text-sm text-danger">
                  {sql`ui.markdown_error`}
                </p>
              </Show>
            </Show>
          </section>
        </Show>
      </Data>
    </Data>
  );
}
