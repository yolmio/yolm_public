import { Button } from "components/button";
import { Card, CardContent } from "components/card";
import { Chip } from "components/chip";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type {
  DomStatements,
  ServerStatementsBase,
  UiServerStatements,
} from "std/statements";
import { system } from "std/system";
import { Each, Effect, Show } from "std/ui";
import type {
  ControlledFileLifecycle,
  ControlledFileReviewSurface,
  ControlledFileReviewSurfaceProps,
} from "./controlled_lifecycle.tsx";
import { NativeDocumentPage } from "./native_document.tsx";
import type { NativeDocumentExtension } from "./native_document.tsx";
import type { DriveBlockContract, DriveExtension } from "./types.ts";

export interface NativeDocumentReviewExtensionOpts {
  control: ControlledFileLifecycle;
  nativeDocuments: NativeDocumentExtension;
}

const commentsHandle = sql.lit`native-document-review-comments`;
const contentContainerId = "native-document-review-content";

/**
 * Exact-version anchored comments for controlled native-document reviews.
 *
 * The extension is deliberately optional: Drive and native documents add no
 * review schema unless a controlled space installs this contribution.
 */
export class NativeDocumentReviewExtension implements DriveExtension {
  readonly name = "native_document_review";
  readonly threadTable = "native_document_review_threads";
  readonly commentTable = "native_document_review_comments";
  #files?: DriveBlockContract;

  readonly reviewSurface: ControlledFileReviewSurface = {
    name: "native_document_review",
    canRender: (props) => this.canRenderReviewSurface(props),
    render: (props) => <NativeDocumentReviewSurface review={this} {...props} />,
  };

  constructor(readonly opts: NativeDocumentReviewExtensionOpts) {}

  initialize(files: DriveBlockContract) {
    this.#files = files;
    this.opts.control.registerReviewSurface(this.reviewSurface);
    system.db.table(this.threadTable, (table) => {
      table.fk(
        "controlled_file_revision_id",
        this.opts.control.revisionTable,
      ).notNull().onDelete("Restrict");
      table.fk("file_version_id", files.versionTable).notNull().onDelete(
        "Restrict",
      );
      table.uint("start_offset").notNull();
      table.uint("end_offset").notNull();
      table.string("quoted_text", 300);
      table.bool("is_resolved").notNull().default(sql`false`);
      table.uint("state_version").notNull().default(sql`1`);
      table.fk("opened_by_actor_id", this.opts.control.opts.actor.actorTable)
        .notNull().onDelete("Restrict");
      table.timestampUtc("opened_at").notNull().default(sql`now()`);
      table.fk("resolved_by_actor_id", this.opts.control.opts.actor.actorTable)
        .onDelete("Restrict");
      table.timestampUtc("resolved_at");
      table.check({
        fields: ["start_offset", "end_offset"],
        errorMessage: () =>
          sql.lit`Native document comment range must have positive length.`,
        check: ([startOffset, endOffset]) => sql`${startOffset} < ${endOffset}`,
      });
      table.check({
        fields: [
          "is_resolved",
          "state_version",
          "resolved_by_actor_id",
          "resolved_at",
        ],
        errorMessage: () =>
          sql.lit`Native document comment resolution state is inconsistent.`,
        check: ([isResolved, stateVersion, resolvedBy, resolvedAt]) =>
          sql`${stateVersion} > 0
            and (
              (${isResolved} and ${resolvedBy} is not null
                and ${resolvedAt} is not null)
              or (not ${isResolved} and ${resolvedBy} is null
                and ${resolvedAt} is null)
            )`,
      });
      table.skipAutoApi();
    });
    system.db.table(this.commentTable, (table) => {
      table.fk("native_document_review_thread_id", this.threadTable).notNull()
        .onDelete("Restrict");
      table.string("body", 2000).multiline().notNull();
      table.fk("posted_by_actor_id", this.opts.control.opts.actor.actorTable)
        .notNull().onDelete("Restrict");
      table.timestampUtc("posted_at").notNull().default(sql`now()`);
      table.insertOnly();
      table.skipAutoApi();
    });
  }

  validate(files: DriveBlockContract) {
    if (this.#files !== files) {
      throw new Error(
        "NativeDocumentReviewExtension must be initialized by its DriveBlock.",
      );
    }
    if (
      !system.db.tables[this.opts.nativeDocuments.contentTable] ||
      !system.db.tables[this.opts.control.revisionTable]
    ) {
      throw new Error(
        "NativeDocumentReviewExtension requires its configured native-document and controlled-file extensions.",
      );
    }
    for (
      const type of files.spaceTypes.filter((candidate) =>
        candidate.extensions.includes(this)
      )
    ) {
      if (
        type.lifecycle !== this.opts.control ||
        !type.extensions.includes(this.opts.nativeDocuments)
      ) {
        throw new Error(
          `Drive space type "${type.name}" must install NativeDocumentReviewExtension with its configured controlled lifecycle and native-document extension.`,
        );
      }
    }
  }

  registerStoredProcedures = () => {
    system.storedProcedure({
      name: "native_document_review_create_thread",
      transaction: "standalone",
      inputScalars: [
        { name: "p_controlled_file_revision_id", type: "BigInt" },
        { name: "p_file_version_id", type: "BigInt" },
        { name: "p_start_offset", type: "BigInt" },
        { name: "p_end_offset", type: "BigInt" },
        {
          name: "p_quoted_text",
          type: { type: "String", maxLength: 300 },
        },
        { name: "p_body", type: { type: "String", maxLength: 2000 } },
      ],
      procedure: (s) => {
        this.createThread(s, {
          controlledFileRevisionId: sql`p_controlled_file_revision_id`,
          fileVersionId: sql`p_file_version_id`,
          startOffset: sql`p_start_offset`,
          endOffset: sql`p_end_offset`,
          quotedText: sql`p_quoted_text`,
          body: sql`p_body`,
        });
      },
    });
    system.storedProcedure({
      name: "native_document_review_append_comment",
      transaction: "standalone",
      inputScalars: [
        { name: "p_thread_id", type: "BigInt" },
        { name: "p_body", type: { type: "String", maxLength: 2000 } },
      ],
      procedure: (s) => {
        this.appendComment(s, sql`p_thread_id`, sql`p_body`);
      },
    });
    system.storedProcedure({
      name: "native_document_review_set_resolved",
      transaction: "standalone",
      inputScalars: [
        { name: "p_thread_id", type: "BigInt" },
        { name: "p_expected_state_version", type: "BigInt" },
        { name: "p_resolved", type: "Bool" },
      ],
      procedure: (s) => {
        this.setResolved(
          s,
          sql`p_thread_id`,
          sql`p_expected_state_version`,
          sql`p_resolved`,
        );
      },
    });
  };

  canRenderReviewSurface(props: ControlledFileReviewSurfaceProps) {
    const files = this.#requiredFiles();
    return sql`
      exists (
        select 1
        from db.file_versions review_version
        join db.file_items review_item
          on review_item.id = review_version.file_item_id
        join db.controlled_file_revisions review_revision
          on review_revision.file_version_id = review_version.id
        join db.native_document_file_versions review_content
          on review_content.file_version_id = review_version.id
        where review_version.id = ${props.fileVersionId}
          and review_item.id = ${props.fileItemId}
          and review_revision.status in (
            'in_review',
            'approved',
            'rejected',
            'published',
            'superseded'
          )
          and ${
      files.extensionEnabledSql(
        sql`review_item.file_space_id`,
        this.name,
      )
    }
          and ${
      this.opts.control.canReadReviewEvidence(
        sql`review_version.id`,
        sql`current_user`,
      )
    }
      )
    `;
  }

  canParticipate(fileVersionId: Sql, sysUserId: Sql) {
    return sql`
      exists (
        select 1
        from db.controlled_file_revisions participant_revision
        where participant_revision.file_version_id = ${fileVersionId}
          and ${
      this.canParticipateInRevision(
        sql`participant_revision.id`,
        fileVersionId,
        sysUserId,
      )
    }
      )
    `;
  }

  canParticipateInRevision(
    revisionId: Sql,
    fileVersionId: Sql,
    sysUserId: Sql,
  ) {
    const files = this.#requiredFiles();
    return sql`
      ${this.opts.control.canParticipateInRevision(revisionId, sysUserId)}
      and exists (
        select 1
        from db.file_versions participant_version
        join db.file_items participant_item
          on participant_item.id = participant_version.file_item_id
        join db.file_spaces participant_space
          on participant_space.id = participant_item.file_space_id
        join db.native_document_file_versions participant_content
          on participant_content.file_version_id = participant_version.id
        where participant_version.id = ${fileVersionId}
          and exists (
            select 1
            from db.controlled_file_revisions exact_revision
            where exact_revision.id = ${revisionId}
              and exact_revision.file_version_id = participant_version.id
          )
          and ${
      files.extensionEnabledForTypeSql(
        sql`participant_space.space_type`,
        this.name,
      )
    }
          and ${
      files.canReadVersionSql({
        spaceRecord: sql`participant_space`,
        itemRecord: sql`participant_item`,
        versionRecord: sql`participant_version`,
        sysUserId,
      })
    }
      )
    `;
  }

  private createThread<T extends ServerStatementsBase<any>>(
    s: T,
    args: {
      controlledFileRevisionId: Sql;
      fileVersionId: Sql;
      startOffset: Sql;
      endOffset: Sql;
      quotedText: Sql;
      body: Sql;
    },
  ) {
    s.defScalar(
      "native_review_thread_actor_id",
      this.opts.control.opts.actor.actorIdForSysUserId(sql`current_user`),
    );
    s.defRecord(
      "native_review_thread_version",
      sql`
        select
          version.id,
          revision.id as controlled_file_revision_id,
          lexical_rich_text_to_plain_text(content.rich_content) as plain_text
        from db.file_versions version
        join db.native_document_file_versions content
          on content.file_version_id = version.id
        join db.controlled_file_revisions revision
          on revision.file_version_id = version.id
        where version.id = ${args.fileVersionId}
          and revision.id = ${args.controlledFileRevisionId}
          and ${
        this.canParticipateInRevision(
          sql`revision.id`,
          sql`version.id`,
          sql`current_user`,
        )
      }
      `,
    );
    s.throwErrorIf(
      sql`
        native_review_thread_actor_id is null
        or native_review_thread_version.id is null
        or ${args.startOffset} >= ${args.endOffset}
        or ${args.endOffset} > length(native_review_thread_version.plain_text)
        or nullif(trim(coalesce(${args.body}, '')), '') is null
      `,
      sql.lit`The native review comment is invalid or no longer editable.`,
    );
    s.startTransaction();
    s.modify(sql`
      insert into db.native_document_review_threads (
        controlled_file_revision_id,
        file_version_id,
        start_offset,
        end_offset,
        quoted_text,
        opened_by_actor_id
      ) values (
        native_review_thread_version.controlled_file_revision_id,
        ${args.fileVersionId},
        ${args.startOffset},
        ${args.endOffset},
        nullif(trim(coalesce(${args.quotedText}, '')), ''),
        native_review_thread_actor_id
      )
    `);
    s.modify(sql`
      insert into db.native_document_review_comments (
        native_document_review_thread_id,
        body,
        posted_by_actor_id
      ) values (
        last_record_id(db.native_document_review_threads),
        trim(${args.body}),
        native_review_thread_actor_id
      )
    `);
    s.commitTransaction();
  }

  private appendComment<T extends ServerStatementsBase<any>>(
    s: T,
    threadId: Sql,
    body: Sql,
  ) {
    s.defScalar(
      "native_review_comment_actor_id",
      this.opts.control.opts.actor.actorIdForSysUserId(sql`current_user`),
    );
    s.defRecord(
      "native_review_comment_thread",
      sql`
        select
          stored_thread.id,
          stored_thread.controlled_file_revision_id,
          stored_thread.file_version_id
        from db.native_document_review_threads stored_thread
        where stored_thread.id = ${threadId}
          and ${
        this.canParticipateInRevision(
          sql`stored_thread.controlled_file_revision_id`,
          sql`stored_thread.file_version_id`,
          sql`current_user`,
        )
      }
      `,
    );
    s.throwErrorIf(
      sql`
        native_review_comment_actor_id is null
        or native_review_comment_thread.id is null
        or nullif(trim(coalesce(${body}, '')), '') is null
      `,
      sql.lit`This review thread is not available for comments.`,
    );
    s.startTransaction();
    s.modify(sql`
      insert into db.native_document_review_comments (
        native_document_review_thread_id,
        body,
        posted_by_actor_id
      ) values (
        native_review_comment_thread.id,
        trim(${body}),
        native_review_comment_actor_id
      )
    `);
    s.commitTransaction();
  }

  private setResolved<T extends ServerStatementsBase<any>>(
    s: T,
    threadId: Sql,
    expectedStateVersion: Sql,
    resolved: Sql,
  ) {
    s.defScalar(
      "native_review_resolution_actor_id",
      this.opts.control.opts.actor.actorIdForSysUserId(sql`current_user`),
    );
    s.defRecord(
      "native_review_resolvable_thread",
      sql`
        select stored_thread.id
        from db.native_document_review_threads stored_thread
        where stored_thread.id = ${threadId}
          and stored_thread.state_version = ${expectedStateVersion}
          and ${
        this.canParticipateInRevision(
          sql`stored_thread.controlled_file_revision_id`,
          sql`stored_thread.file_version_id`,
          sql`current_user`,
        )
      }
      `,
    );
    s.throwErrorIf(
      sql`
        native_review_resolution_actor_id is null
        or native_review_resolvable_thread.id is null
      `,
      sql.lit`This review thread changed or is no longer editable.`,
    );
    s.startTransaction();
    s.modify(sql`
      update db.native_document_review_threads
      set is_resolved = ${resolved},
          state_version = state_version + 1,
          resolved_by_actor_id = case
            when ${resolved} then native_review_resolution_actor_id
            else null
          end,
          resolved_at = case when ${resolved} then now() else null end
      where id = native_review_resolvable_thread.id
        and state_version = ${expectedStateVersion}
    `);
    s.throwErrorIf(
      sql`
        not exists (
          select 1
          from db.native_document_review_threads
          where id = native_review_resolvable_thread.id
            and state_version = ${expectedStateVersion} + 1
        )
      `,
      sql.lit`This review thread changed; reload before saving.`,
    );
    s.commitTransaction();
  }

  #requiredFiles() {
    if (!this.#files) {
      throw new Error(
        "NativeDocumentReviewExtension is not attached to DriveBlock.",
      );
    }
    return this.#files;
  }
}

function formatDateTime(value: Sql) {
  return sql`format.date(${value}, '%m/%d/%Y %-I:%M%P')`;
}

function focusThread(s: DomStatements, threadId: Sql) {
  s.jsCall({
    module: "doc_comments",
    exportName: "setActiveThread",
    handle: commentsHandle,
    argJson: sql`json_build_object(
      'handle', ${commentsHandle},
      'id', ${threadId}::string
    )`,
  });
}

function createThread(s: UiServerStatements) {
  s.callStoredProcedure("native_document_review_create_thread", {
    inputScalars: {
      p_controlled_file_revision_id:
        sql`review_document.controlled_file_revision_id`,
      p_file_version_id: sql`review_document.file_version_id`,
      p_start_offset: sql`ui.native_review_pending_start`,
      p_end_offset: sql`ui.native_review_pending_end`,
      p_quoted_text: sql`ui.native_review_pending_quote`,
      p_body: sql`ui.native_review_new_comment`,
    },
  });
}

function appendComment(s: UiServerStatements) {
  s.callStoredProcedure("native_document_review_append_comment", {
    inputScalars: {
      p_thread_id: sql`ui.native_review_active_thread_id`,
      p_body: sql`ui.native_review_reply`,
    },
  });
}

function setResolved(s: UiServerStatements, resolved: boolean) {
  s.callStoredProcedure("native_document_review_set_resolved", {
    inputScalars: {
      p_thread_id: sql`ui.native_review_active_thread_id`,
      p_expected_state_version: sql`(
        select state_version
        from native_review_threads
        where id = ui.native_review_active_thread_id
      )`,
      p_resolved: resolved ? sql`true` : sql`false`,
    },
  });
}

function NewCommentComposer() {
  return (
    <Card variant="soft" color="primary">
      <CardContent>
        <Typography level="title-sm" startIcon="AddComment">
          New comment
        </Typography>
        <Typography level="body-xs" className="mt-1 italic text-neutral-700">
          “{sql`coalesce(native_review_pending_quote, '')`}”
        </Typography>
        <Textarea
          bindScalar="native_review_new_comment"
          minRows={2}
          placeholder="Write a comment for this selection"
          className="mt-2"
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            startIcon="Send"
            onClick={(s) => {
              s.setScalar("native_review_error", sql.null);
              s.if(
                sql`coalesce(trim(native_review_new_comment), '') = ''`,
                (s) => {
                  s.setScalar(
                    "native_review_error",
                    sql.lit`Comment text is required.`,
                  );
                  s.return();
                },
              );
              s.tryServer({
                body: (s) => {
                  createThread(s);
                  s.setScalar("ui.native_review_pending_start", sql.null);
                  s.setScalar("ui.native_review_pending_end", sql.null);
                  s.setScalar("ui.native_review_pending_quote", sql.null);
                  s.setScalar("ui.native_review_new_comment", sql.null);
                  s.refetch();
                },
                errorName: "native_review_create_error",
                catch: (s) =>
                  s.setScalar(
                    "native_review_error",
                    sql`coalesce(native_review_create_error.message, 'The comment could not be added.')`,
                  ),
              });
            }}
          >
            Comment
          </Button>
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            onClick={(s) => {
              s.setScalar("native_review_pending_start", sql.null);
              s.setScalar("native_review_pending_end", sql.null);
              s.setScalar("native_review_pending_quote", sql.null);
              s.setScalar("native_review_new_comment", sql.null);
              s.jsCall({
                module: "doc_comments",
                exportName: "clearSelection",
                handle: commentsHandle,
                argJson: sql`json_build_object('handle', ${commentsHandle})`,
              });
            }}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewThreadCard() {
  return (
    <div
      className="cursor-pointer rounded-md border p-3 transition-colors"
      dynamicClassNames={[
        {
          condition: sql`native_review_active_thread_id = review_thread.id`,
          classNames: "border-primary-400 bg-primary-50",
        },
        {
          condition: sql`
            native_review_active_thread_id is null
            or native_review_active_thread_id != review_thread.id
          `,
          classNames: "border-divider bg-white",
        },
      ]}
      onClick={(s) => {
        s.setScalar("native_review_active_thread_id", sql`review_thread.id`);
        s.setScalar("native_review_reply", sql.null);
        focusThread(s, sql`review_thread.id`);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <Typography level="body-xs" className="italic text-neutral-600">
          “{sql`coalesce(review_thread.quoted_text, '')`}”
        </Typography>
        <Show when={sql`review_thread.resolved`}>
          <Chip size="sm" variant="soft" color="success">
            Resolved
          </Chip>
        </Show>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <Each
          table="native_review_comments"
          recordName="review_comment"
          where={sql`review_comment.thread_id = review_thread.id`}
        >
          <div>
            <Typography level="body-xs" className="font-medium">
              {sql`coalesce(review_comment.author_name, 'Unknown')`}{" "}
              <span className="font-normal text-neutral-500">
                {formatDateTime(sql`review_comment.posted_at`)}
              </span>
            </Typography>
            <Typography
              level="body-sm"
              className="whitespace-pre-wrap break-words"
            >
              {sql`review_comment.body`}
            </Typography>
          </div>
        </Each>
      </div>
      <Show
        when={sql`
          review_thread.resolved
          and review_thread.resolver_name is not null
        `}
      >
        <Typography level="body-xs" className="mt-2 text-neutral-500">
          Resolved by {sql`review_thread.resolver_name`}
          {sql`case
            when review_thread.resolved_at is not null
              then ' · ' || ${formatDateTime(sql`review_thread.resolved_at`)}
            else ''
          end`}
        </Typography>
      </Show>
      <Show
        when={sql`
          native_review_active_thread_id = review_thread.id
          and review_document.can_comment
        `}
      >
        <div className="mt-2 border-t border-divider pt-2">
          <Textarea
            bindScalar="native_review_reply"
            minRows={1}
            placeholder="Reply"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outlined"
              startIcon="Reply"
              onClick={(s) => {
                s.event.stopPropagation();
                s.setScalar("native_review_error", sql.null);
                s.if(
                  sql`coalesce(trim(native_review_reply), '') = ''`,
                  (s) => {
                    s.setScalar(
                      "native_review_error",
                      sql.lit`Reply text is required.`,
                    );
                    s.return();
                  },
                );
                s.tryServer({
                  body: (s) => {
                    appendComment(s);
                    s.setScalar("ui.native_review_reply", sql.null);
                    s.refetch();
                  },
                  errorName: "native_review_reply_error",
                  catch: (s) =>
                    s.setScalar(
                      "native_review_error",
                      sql`coalesce(native_review_reply_error.message, 'The reply could not be added.')`,
                    ),
                });
              }}
            >
              Reply
            </Button>
            <Show
              when={sql`review_thread.resolved`}
              fallback={
                <Button
                  size="sm"
                  variant="outlined"
                  color="success"
                  startIcon="CheckCircle"
                  onClick={(s) => {
                    s.event.stopPropagation();
                    s.setScalar("native_review_error", sql.null);
                    s.tryServer({
                      body: (s) => {
                        setResolved(s, true);
                        s.refetch();
                      },
                      errorName: "native_review_resolution_error",
                      catch: (s) =>
                        s.setScalar(
                          "native_review_error",
                          sql`coalesce(native_review_resolution_error.message, 'The thread could not be updated.')`,
                        ),
                    });
                  }}
                >
                  Resolve
                </Button>
              }
            >
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                startIcon="Undo"
                onClick={(s) => {
                  s.event.stopPropagation();
                  s.setScalar("native_review_error", sql.null);
                  s.tryServer({
                    body: (s) => {
                      setResolved(s, false);
                      s.refetch();
                    },
                    errorName: "native_review_resolution_error",
                    catch: (s) =>
                      s.setScalar(
                        "native_review_error",
                        sql`coalesce(native_review_resolution_error.message, 'The thread could not be updated.')`,
                      ),
                  });
                }}
              >
                Reopen
              </Button>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

export function NativeDocumentReviewSurface(
  props: ControlledFileReviewSurfaceProps & {
    review: NativeDocumentReviewExtension;
  },
) {
  const actorTable = sql.ref(props.review.opts.control.opts.actor.actorTable);
  const authorName = props.review.opts.control.opts.actor.actorDisplayName(
    sql`review_author`,
  );
  const resolverName = props.review.opts.control.opts.actor.actorDisplayName(
    sql`review_resolver`,
  );
  useJsModule("doc_comments");
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("native_review_active_thread_id", { type: "BigInt" });
        s.defScalar("native_review_pending_start", { type: "Int" });
        s.defScalar("native_review_pending_end", { type: "Int" });
        s.defScalar("native_review_pending_quote", {
          type: { type: "String", maxLength: 300 },
        });
        s.defScalar("native_review_new_comment", {
          type: { type: "String", maxLength: 2000 },
        });
        s.defScalar("native_review_reply", {
          type: { type: "String", maxLength: 2000 },
        });
        s.defScalar("native_review_error", {
          type: { type: "String", maxLength: 500 },
        });
        s.defScalar("native_review_show_resolved", false);
      }}
    >
      <Data
        watch={[props.fileVersionId]}
        procedure={(s) => {
          s.defRecord(
            "review_document",
            sql`
              select
                version.id as file_version_id,
                revision.id as controlled_file_revision_id,
                content.rich_content,
                ${
              props.review.canParticipateInRevision(
                sql`revision.id`,
                sql`version.id`,
                sql`current_user`,
              )
            } as can_comment
              from db.file_versions version
              join db.file_items item on item.id = version.file_item_id
              join db.file_spaces space on space.id = item.file_space_id
              join db.native_document_file_versions content
                on content.file_version_id = version.id
              join db.controlled_file_revisions revision
                on revision.file_version_id = version.id
              where version.id = ${props.fileVersionId}
                and item.id = ${props.fileItemId}
                and revision.status in (
                  'in_review',
                  'approved',
                  'rejected',
                  'published',
                  'superseded'
                )
                and ${
              props.files.extensionEnabledForTypeSql(
                sql`space.space_type`,
                props.review.name,
              )
            }
                and ${
              props.review.opts.control.canReadReviewEvidenceForRevision(
                sql`revision.id`,
                sql`current_user`,
              )
            }
                and ${
              props.files.canReadVersionSql({
                spaceRecord: sql`space`,
                itemRecord: sql`item`,
                versionRecord: sql`version`,
                sysUserId: sql`current_user`,
              })
            }
              order by
                case revision.status
                  when 'in_review' then 1
                  when 'approved' then 2
                  when 'published' then 3
                  when 'rejected' then 4
                  else 5
                end,
                revision.id desc
              limit 1
            `,
          );
          s.defTable(
            "native_review_threads",
            sql`
              select
                thread.id,
                thread.start_offset,
                thread.end_offset,
                thread.quoted_text,
                thread.is_resolved as resolved,
                thread.state_version,
                thread.opened_at,
                thread.resolved_at,
                ${resolverName} as resolver_name
              from db.native_document_review_threads thread
              left join db.${actorTable} review_resolver
                on review_resolver.id = thread.resolved_by_actor_id
              where thread.file_version_id = ${props.fileVersionId}
                and thread.controlled_file_revision_id =
                  review_document.controlled_file_revision_id
                and review_document.file_version_id is not null
              order by thread.start_offset, thread.id
            `,
          );
          s.defTable(
            "native_review_comments",
            sql`
              select
                comment.id,
                comment.native_document_review_thread_id as thread_id,
                comment.body,
                comment.posted_at,
                ${authorName} as author_name
              from db.native_document_review_comments comment
              join db.native_document_review_threads thread
                on thread.id = comment.native_document_review_thread_id
              left join db.${actorTable} review_author
                on review_author.id = comment.posted_by_actor_id
              where thread.file_version_id = ${props.fileVersionId}
                and thread.controlled_file_revision_id =
                  review_document.controlled_file_revision_id
                and review_document.file_version_id is not null
              order by comment.posted_at, comment.id
            `,
          );
          s.defScalar(
            "native_review_threads_json",
            sql`
              coalesce((
                select json_array_agg(json_build_object(
                  'id', thread.id::string,
                  'start', thread.start_offset,
                  'end', thread.end_offset,
                  'resolved', thread.is_resolved
                ) order by thread.start_offset, thread.id)
                from db.native_document_review_threads thread
                where thread.file_version_id = ${props.fileVersionId}
                  and thread.controlled_file_revision_id =
                    review_document.controlled_file_revision_id
                  and review_document.file_version_id is not null
              ), json_build_array())
            `,
          );
        }}
      >
        <section className="rounded-lg border border-divider bg-neutral-50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <Typography level="title-md">Review comments</Typography>
              <Typography level="body-sm" className="text-neutral-600">
                Select text in the document to start an anchored thread.
              </Typography>
            </div>
            <Show when={sql`not review_document.can_comment`}>
              <Chip size="sm" variant="soft" color="neutral">
                Review history
              </Chip>
            </Show>
          </div>
          <div
            js={{
              handles: [{
                module: "doc_comments",
                cleanup: "cleanup",
                handle: commentsHandle,
              }],
              on: {
                "doc_comments.commentRequested": (s) => {
                  s.setScalar(
                    "native_review_pending_start",
                    sql`try_cast(event.payload_json->>'start' as int)`,
                  );
                  s.setScalar(
                    "native_review_pending_end",
                    sql`try_cast(event.payload_json->>'end' as int)`,
                  );
                  s.setScalar(
                    "native_review_pending_quote",
                    sql`event.payload_json->>'quote'`,
                  );
                  s.setScalar("native_review_active_thread_id", sql.null);
                },
                "doc_comments.threadClicked": (s) => {
                  s.setScalar(
                    "native_review_active_thread_id",
                    sql`try_cast(event.payload_json->>'id' as bigint)`,
                  );
                  s.setScalar("native_review_reply", sql.null);
                },
                "doc_comments.error": (s) =>
                  s.setScalar(
                    "native_review_error",
                    sql`coalesce(event.payload_json->>'message', 'The review comments could not be loaded.')`,
                  ),
              },
            }}
            className="flex flex-col items-start gap-3 lg:flex-row"
          >
            <div
              className="min-w-0 grow overflow-auto rounded-md border border-divider"
              style={{ maxHeight: "calc(100vh - 220px)" }}
              onMount={(s) => {
                s.sleep(100);
                s.jsCall({
                  module: "doc_comments",
                  exportName: "init",
                  handle: commentsHandle,
                  argJson: sql`json_build_object(
                    'handle', ${commentsHandle},
                    'containerId', ${sql.lit(contentContainerId)},
                    'threads', coalesce(native_review_threads_json, '[]'::json),
                    'canComment', coalesce(review_document.can_comment, false)
                  )`,
                });
              }}
            >
              <NativeDocumentPage
                contentId={contentContainerId}
                pageId="native-document-review-page"
                value={sql`review_document.rich_content`}
              />
            </div>
            <div
              className="flex w-full shrink-0 flex-col gap-3 overflow-auto lg:w-96"
              style={{ maxHeight: "calc(100vh - 220px)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <Typography level="title-sm" startIcon="Comment">
                  Comments ({sql`(
                    select count(*)
                    from native_review_threads
                    where not resolved
                  )::string`})
                </Typography>
                <Button
                  size="sm"
                  variant="plain"
                  color="neutral"
                  onClick={(s) =>
                    s.setScalar(
                      "native_review_show_resolved",
                      sql`not native_review_show_resolved`,
                    )}
                >
                  {sql`case
                    when native_review_show_resolved then 'Hide resolved'
                    else 'Show resolved (' || (
                      select count(*)
                      from native_review_threads
                      where resolved
                    )::string || ')'
                  end`}
                </Button>
              </div>
              <Show when={sql`native_review_error is not null`}>
                <Typography level="body-sm" className="text-danger-600">
                  {sql`native_review_error`}
                </Typography>
              </Show>
              <Show
                when={sql`
                  native_review_pending_start is not null
                  and native_review_pending_end is not null
                  and review_document.can_comment
                `}
              >
                <NewCommentComposer />
              </Show>
              <Show
                when={sql`
                  review_document.can_comment
                  and native_review_pending_start is null
                  and (select count(*) from native_review_threads) = 0
                `}
              >
                <Typography level="body-sm" className="text-neutral-600">
                  No comments yet. Select text and choose Comment to start a
                  thread.
                </Typography>
              </Show>
              <Each
                table="native_review_threads"
                recordName="review_thread"
                where={sql`
                  native_review_show_resolved
                  or not review_thread.resolved
                `}
              >
                <ReviewThreadCard />
              </Each>
            </div>
          </div>
          <Effect
            watch={[sql`native_review_threads_json`]}
            onChange={(s) => {
              s.jsCall({
                module: "doc_comments",
                exportName: "setThreads",
                handle: commentsHandle,
                argJson: sql`json_build_object(
                  'handle', ${commentsHandle},
                  'threads', coalesce(native_review_threads_json, '[]'::json)
                )`,
              });
            }}
          />
        </section>
      </Data>
    </Data>
  );
}
