import { Button } from "components/button";
import { Chip } from "components/chip";
import { InlineRecordDisplay } from "components/inline_record_display";
import {
  LexicalRichTextDisplay,
} from "components/lexical/components/lexical_editor";
import { ensureLexicalRichTextFunctions } from "components/lexical/components/lexical_scalar_functions";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import type { Color } from "components/types";
import { Typography } from "components/typography";
import { Data } from "std/data";
import type { IServerBaseStatements, UiServerStatements } from "std/statements";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import { system } from "std/system";
import type { Block, TableBuilder } from "std/system";
import {
  Each,
  EventHandlers,
  Redirect,
  Route,
  Show,
  useApp,
  useOptionalICtx,
} from "std/ui";
import type { Node } from "std/ui";
import { UserNotificationsBlock } from "blocks/user_notifications";
import type { UserNotificationSourceConfig } from "blocks/user_notifications";
import { notificationAppHref } from "blocks/user_notifications/surfaces";
import { AuthApiICtxKey } from "std/ictx";
import {
  claimCommentImages,
  commentHasContent,
  initializeCommentImages,
} from "./images";
import { CommentImageEditor } from "./image_editor";
import { useCommentLinkTarget } from "./link_target";
export { CommentRecordRail } from "./record_rail";

/** Business facts required for permissioned comment links. */
export interface CommentDiscussion {
  canRead: (thread: Sql, userId: Sql) => Sql;
  canWrite: (thread: Sql, userId: Sql) => Sql;
  label: (thread: Sql) => Sql;
  parentHref: (thread: Sql) => Sql;
  additionalRecipients?: (thread: Sql) => Sql;
}

export interface CommentCreatedDetails {
  threadId: Sql;
  commentId: Sql;
  replyToCommentId: Sql;
  body: Sql;
  /** Returns `recipient_user_id`; includes mentions and the direct reply target. */
  recipientsQuery: Sql;
}

export interface CommentsBlockOpts {
  discussion?: CommentDiscussion;
  /** Add the foreign keys that identify the record a thread belongs to. */
  defineThread: (table: TableBuilder) => void;
  /** Optional integration point for notifications or other domain reactions. */
  onCommentCreated?: (
    s: IServerBaseStatements,
    details: CommentCreatedDetails,
  ) => void;
}

interface CreateThreadOpts {
  /** Suppress the automatic notification for a separately notified audit event. */
  notify?: Sql;
  values: Record<string, Sql>;
  body: Sql;
  intoThread?: string;
  intoComment?: string;
}

interface CreateCommentOpts {
  notify?: Sql;
  threadId: Sql;
  replyToCommentId: Sql;
  body: Sql;
  intoComment?: string;
  isReply?: boolean;
}

/**
 * Reusable, record-attached discussion threads. Consumers define only the
 * foreign keys on `comment_threads`; this block owns the discussion model.
 */
export class CommentsBlock implements Block {
  private notificationsEnabled = false;
  private imageApps = new Set<string>();

  registerImageApp() {
    const domain = useApp().domain;
    if (this.imageApps.has(domain)) return;
    this.imageApps.add(domain);
    const auth = useOptionalICtx(AuthApiICtxKey);
    system.api({ domain, prefix: "/api" }).get(
      "/comment-images/{image_key:uuid}",
      {
        procedure: (s) => {
          s.defScalar("comment_image_user_id", sql`current_user`);
          if (auth) {
            s.if(sql`comment_image_user_id is null`, (s) => {
              auth.authenticate(s);
              s.setScalar("comment_image_user_id", sql`user_id`);
            });
          }
          const userId = sql`comment_image_user_id`;
          s.defRecord(
            "comment_image",
            sql`select image.blob_hash, image.content_type from db.comment_images image
            where image.public_id = image_key and ${userId} is not null
              and ((image.comment_id is null and image.uploaded_by_user_id = ${userId}
                and image.created_at >= date.add(day, -1, now())) or exists (
                select 1 from db.comments comment join db.comment_threads thread on thread.id = comment.comment_thread_id
                where comment.id = image.comment_id and ${
              this.canRead(sql`thread`, userId)
            }
              ))`,
          );
          s.if(sql`comment_image.blob_hash is null`, (s) => {
            s.setHttpStatus(404);
            s.return();
          });
          s.setHeader(sql.lit`Content-Type`, sql`comment_image.content_type`);
          s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
          s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
          s.returnBlob(sql`comment_image.blob_hash`);
        },
      },
    );
  }
  readonly notificationSourceKey = "comments.comment";

  /** Include in Notifications.sources to enable automatic comment delivery. */
  notificationSource(): UserNotificationSourceConfig {
    if (!this.opts.discussion) {
      throw new Error(
        "Comment notifications require discussion access and context",
      );
    }
    this.notificationsEnabled = true;
    return {
      key: this.notificationSourceKey,
      displayName: "Comments",
      canUserAccess: ({ userId, recordKey }) =>
        sql`exists (
        select 1 from db.comments target
        join db.comment_threads thread on thread.id = target.comment_thread_id
        where target.id = try_cast(${recordKey} as bigint)
          and ${this.canRead(sql`thread`, userId)})`,
      destination: {
        href: (notification) =>
          this.commentHref(sql`try_cast(${notification}.record_key as bigint)`),
        routes: () => (
          <Route path="/comments/{linked_comment_id:id}">
            <CommentPage block={this} />
          </Route>
        ),
      },
    };
  }

  commentHref(commentId: Sql) {
    return sql`'/comments/' || cast(${commentId} as string)`;
  }

  canRead(thread: Sql, userId: Sql = sql`current_user`) {
    return this.opts.discussion?.canRead(thread, userId) ?? sql`true`;
  }
  canWrite(thread: Sql, userId: Sql = sql`current_user`) {
    return sql`${this.canRead(thread, userId)} and ${
      this.opts.discussion?.canWrite(thread, userId) ?? sql`true`
    }`;
  }
  private assertThreadWrite<T extends IServerBaseStatements>(
    s: T,
    threadId: Sql,
  ) {
    s.throwErrorIf(
      sql`not exists (select 1 from db.comment_threads permission_thread
      where permission_thread.id = ${threadId} and ${
        this.canWrite(sql`permission_thread`)
      })`,
      sql.lit`You cannot change this discussion.`,
    );
  }
  blockName = "CommentsBlock";

  readonly threadTable = "comment_threads";
  readonly commentTable = "comments";
  readonly revisionTable = "comment_revisions";
  readonly subscriptionTable = "comment_thread_subscriptions";

  constructor(readonly opts: CommentsBlockOpts) {}

  initialize() {
    ensureLexicalRichTextFunctions(system);
    initializeCommentImages();

    system.db.table(this.threadTable, (table) => {
      this.opts.defineThread(table);
      table.timestampUtc("closed_at");
      table.fk("closed_by_user_id", "sys_users").onDelete("SetToNull");
      table.check({
        fields: ["closed_at", "closed_by_user_id"],
        errorMessage: () => sql.lit`Discussion close metadata is inconsistent.`,
        check: ([closedAt, closedBy]) =>
          sql`(${closedAt} is null and ${closedBy} is null)
            or (${closedAt} is not null and ${closedBy} is not null)`,
      });
      table.skipAutoApi();
    });

    system.db.table(this.commentTable, (table) => {
      table.fk("comment_thread_id", this.threadTable).notNull().onDelete(
        "Cascade",
      );
      table.fk("reply_to_comment_id", this.commentTable).onDelete("SetToNull");
      table.fk("sys_user_id", "sys_users").notNull().onDelete("Restrict");
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.json("comments").notNull();
      table.uint("revision_no").notNull().default(sql`1`);
      table.timestampUtc("last_edited_at");
      table.fk("last_edited_by_user_id", "sys_users").onDelete("SetToNull");
      table.timestampUtc("retracted_at");
      table.fk("retracted_by_user_id", "sys_users").onDelete("SetToNull");
      table.check({
        fields: ["revision_no"],
        errorMessage: () => sql.lit`Comment revision must be positive.`,
        check: ([revisionNo]) => sql`${revisionNo} > 0`,
      });
      table.check({
        fields: ["last_edited_at", "last_edited_by_user_id"],
        errorMessage: () => sql.lit`Comment edit metadata is inconsistent.`,
        check: ([editedAt, editedBy]) =>
          sql`(${editedAt} is null and ${editedBy} is null)
            or (${editedAt} is not null and ${editedBy} is not null)`,
      });
      table.check({
        fields: ["retracted_at", "retracted_by_user_id"],
        errorMessage: () =>
          sql.lit`Comment retraction metadata is inconsistent.`,
        check: ([retractedAt, retractedBy]) =>
          sql`(${retractedAt} is null and ${retractedBy} is null)
            or (${retractedAt} is not null and ${retractedBy} is not null)`,
      });
      table.skipAutoApi();
    });

    system.db.table(this.revisionTable, (table) => {
      table.fk("comment_id", this.commentTable).notNull().onDelete("Cascade");
      table.uint("revision_no").notNull();
      table.json("comments").notNull();
      table.fk("edited_by_user_id", "sys_users").notNull().onDelete(
        "Restrict",
      );
      table.timestampUtc("edited_at").notNull();
      table.unique(["comment_id", "revision_no"]);
      table.skipAutoApi();
    });

    system.db.table(this.subscriptionTable, (table) => {
      table.fk("comment_thread_id", this.threadTable).notNull().onDelete(
        "Cascade",
      );
      table.fk("sys_user_id", "sys_users").notNull().onDelete("Cascade");
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.unique(["comment_thread_id", "sys_user_id"]);
      table.skipAutoApi();
    });
  }

  populate() {
    for (const isReply of [false, true]) {
      const name = isReply ? "comments_insert_reply" : "comments_insert_root";
      system.storedProcedure({
        name,
        transaction: "caller",
        inputScalars: [
          { name: "p_thread_id", type: "BigInt" },
          { name: "p_reply_to_comment_id", type: "BigInt" },
          { name: "p_body", type: "Json" },
          { name: "p_notify", type: "Bool" },
        ],
        outputScalars: [{ name: "p_created_comment_id", type: "BigInt" }],
        procedure: (s) =>
          this.defineInsertComment(s, {
            threadId: sql`p_thread_id`,
            replyToCommentId: sql`p_reply_to_comment_id`,
            body: sql`p_body`,
            notify: sql`p_notify`,
            intoComment: "p_created_comment_id",
            isReply,
          }),
      });
    }
    system.storedProcedure({
      name: "comments_edit",
      transaction: "caller",
      inputScalars: [
        { name: "p_comment_id", type: "BigInt" },
        { name: "p_revision_no", type: "BigInt" },
        { name: "p_body", type: "Json" },
      ],
      procedure: (s) =>
        this.defineEdit(s, {
          commentId: sql`p_comment_id`,
          revisionNo: sql`p_revision_no`,
          body: sql`p_body`,
        }),
    });
  }

  validate() {
    if (!system.db.tables.sys_users) {
      throw new Error(
        "CommentsBlock requires sys_users to be initialized first.",
      );
    }
    const thread = system.db.tables[this.threadTable];
    const contextualFields = Object.values(thread.fields).filter((field) =>
      field.type === "ForeignKey" &&
      !["closed_by_user_id"].includes(field.name)
    );
    if (contextualFields.length === 0) {
      throw new Error(
        "CommentsBlock defineThread must add at least one foreign key.",
      );
    }
  }

  private contextualThreadFields() {
    const thread = system.db.tables[this.threadTable];
    return Object.values(thread.fields).filter((field) =>
      field.type === "ForeignKey" && field.name !== "closed_by_user_id"
    );
  }

  createThread<T extends IServerBaseStatements>(s: T, opts: CreateThreadOpts) {
    const fields = Object.keys(opts.values);
    if (fields.length === 0) {
      throw new Error(
        "CommentsBlock.createThread requires foreign-key values.",
      );
    }
    const threadScalar = opts.intoThread ?? "created_comment_thread_id";
    const commentScalar = opts.intoComment ?? "created_comment_id";
    s.defScalar(threadScalar, sql`cast(null as bigint)`);
    if (commentScalar) {
      s.defScalar(commentScalar, { type: "BigInt" });
    }
    s.modify(sql`
      insert into db.comment_threads (${fields.map((field) => sql.ref(field))})
      values (${Object.values(opts.values)})
      returning id into ${sql.ref(threadScalar)}
    `);
    this.insertComment(s, {
      threadId: sql.ref(threadScalar),
      replyToCommentId: sql`cast(null as bigint)`,
      body: opts.body,
      intoComment: commentScalar,
      isReply: false,
      notify: opts.notify,
    });
  }

  reply<T extends IServerBaseStatements>(s: T, opts: CreateCommentOpts) {
    s.throwErrorIf(
      sql`not exists (
        select 1
        from db.comments target
        join db.comment_threads thread on thread.id = target.comment_thread_id
        where target.id = ${opts.replyToCommentId}
          and target.comment_thread_id = ${opts.threadId}
          and thread.closed_at is null
      )`,
      sql.lit`This discussion is closed or no longer exists.`,
    );
    this.insertComment(s, { ...opts, isReply: true });
  }

  private insertComment<T extends IServerBaseStatements>(
    s: T,
    opts: CreateCommentOpts,
  ) {
    const isReply = opts.isReply ?? false;
    const name = isReply ? "comments_insert_reply" : "comments_insert_root";
    const commentScalar = opts.intoComment ?? "created_comment_id";
    if (commentScalar && !opts.intoComment) {
      s.defScalar(commentScalar, { type: "BigInt" });
    }
    s.callStoredProcedure(name, {
      inputScalars: {
        p_thread_id: opts.threadId,
        p_reply_to_comment_id: opts.replyToCommentId,
        p_body: opts.body,
        p_notify: opts.notify ?? sql`true`,
      },
      outputScalars: { p_created_comment_id: commentScalar },
    });
  }

  private defineInsertComment<T extends IServerBaseStatements>(
    s: T,
    opts: CreateCommentOpts,
  ) {
    this.assertThreadWrite(s, opts.threadId);
    const contextMatch = sql.or(
      this.contextualThreadFields().map((field) =>
        sql`current_comment_thread.${sql.ref(field.name)} is not null
          and followed_comment_thread.${sql.ref(field.name)}
            = current_comment_thread.${sql.ref(field.name)}`
      ),
    );
    const commentScalar = opts.intoComment ?? "created_comment_id";
    if (commentScalar && !opts.intoComment) {
      s.defScalar(commentScalar, { type: "BigInt" });
    }
    s.throwErrorIf(
      sql`not ${commentHasContent(opts.body)}`,
      sql.lit`A comment cannot be empty.`,
    );
    s.modify(sql`
      insert into db.comments (
        comment_thread_id,
        reply_to_comment_id,
        sys_user_id,
        comments
      ) values (
        ${opts.threadId},
        ${opts.replyToCommentId},
        current_user,
        ${opts.body}
      )
      ${
      commentScalar ? sql`returning id into ${sql.ref(commentScalar)}` : sql``
    }
    `);
    claimCommentImages(s, opts.body, sql.ref(commentScalar));
    const created: CommentCreatedDetails = {
      threadId: opts.threadId,
      commentId: sql.ref(commentScalar),
      replyToCommentId: opts.replyToCommentId,
      body: opts.body,
      recipientsQuery: sql`
        select distinct subscription.sys_user_id as recipient_user_id
        from db.comment_thread_subscriptions subscription
        join db.comment_threads followed_comment_thread
          on followed_comment_thread.id = subscription.comment_thread_id
        join db.comment_threads current_comment_thread
          on current_comment_thread.id = ${opts.threadId}
        where subscription.sys_user_id != current_user
          and (${contextMatch})
        union
        ${
        opts.isReply
          ? sql`
            select target.sys_user_id as recipient_user_id
            from db.comments target
            where target.id = ${opts.replyToCommentId}
              and target.sys_user_id != current_user
          `
          : sql`
            select cast(null as bigint) as recipient_user_id
            where false
          `
      }
        union
        select try_cast(value as bigint) as recipient_user_id
        from json.array_each(lexical_extract_mention_ids(${opts.body}))
        where try_cast(value as bigint) is not null
          and try_cast(value as bigint) != current_user
      `,
    };
    this.opts.onCommentCreated?.(s, created);
    if (this.notificationsEnabled) {
      s.if(opts.notify ?? sql`true`, (s) => {
        const discussion = this.opts.discussion;
        if (!discussion) {
          throw new Error("Comment notifications require a discussion adapter");
        }
        s.block((s) => {
          s.defRecord(
            "notified_comment_thread",
            sql`select * from db.comment_threads where id = ${opts.threadId}`,
          );
          system.block(UserNotificationsBlock).source(
            this.notificationSourceKey,
          ).publish(s, {
            recordKey: created.commentId,
            recipientsQuery:
              sql`${created.recipientsQuery} union select recipient_user_id from (
              ${
                discussion.additionalRecipients?.(
                  sql`notified_comment_thread`,
                ) ??
                  sql`select cast(null as bigint) as recipient_user_id where false`
              }
            ) extra where recipient_user_id != current_user`,
            title:
              sql`coalesce((select display_name_virtual from db.sys_users where id = current_user), 'Someone')
              || ${opts.isReply ? sql.lit` replied · ` : sql.lit` commented · `}
              || ${discussion.label(sql`notified_comment_thread`)}`,
            body:
              sql`left(lexical_rich_text_to_plain_text(${created.body}), 500)`,
            href: this.commentHref(created.commentId),
          });
        });
      });
    }
  }

  edit<T extends IServerBaseStatements>(
    s: T,
    opts: { commentId: Sql; revisionNo: Sql; body: Sql },
  ) {
    s.callStoredProcedure("comments_edit", {
      inputScalars: {
        p_comment_id: opts.commentId,
        p_revision_no: opts.revisionNo,
        p_body: opts.body,
      },
    });
  }

  private defineEdit<T extends IServerBaseStatements>(
    s: T,
    opts: { commentId: Sql; revisionNo: Sql; body: Sql },
  ) {
    this.assertThreadWrite(
      s,
      sql`(select comment_thread_id from db.comments where id = ${opts.commentId})`,
    );
    s.throwErrorIf(
      sql`not ${commentHasContent(opts.body)}`,
      sql.lit`A comment cannot be empty.`,
    );
    s.throwErrorIf(
      sql`not exists (
        select 1 from db.comments
        where id = ${opts.commentId}
          and sys_user_id = current_user
          and retracted_at is null
          and revision_no = ${opts.revisionNo}
      )`,
      sql.lit`This comment changed or can no longer be edited.`,
    );
    claimCommentImages(s, opts.body, opts.commentId);
    s.modify(sql`
      insert into db.comment_revisions (
        comment_id, revision_no, comments, edited_by_user_id, edited_at
      )
      select id, revision_no, comments, current_user, now()
      from db.comments
      where id = ${opts.commentId}
        and sys_user_id = current_user
        and retracted_at is null
        and revision_no = ${opts.revisionNo}
    `);
    s.modify(sql`
      update db.comments
      set comments = ${opts.body},
        revision_no = revision_no + 1,
        last_edited_at = now(),
        last_edited_by_user_id = current_user
      where id = ${opts.commentId}
        and sys_user_id = current_user
        and retracted_at is null
        and revision_no = ${opts.revisionNo}
    `);
  }

  retract<T extends IServerBaseStatements>(s: T, commentId: Sql) {
    this.assertThreadWrite(
      s,
      sql`(select comment_thread_id from db.comments where id = ${commentId})`,
    );
    s.modify(sql`
      update db.comments
      set retracted_at = now(), retracted_by_user_id = current_user
      where id = ${commentId}
        and sys_user_id = current_user
        and retracted_at is null
    `);
  }

  close<T extends IServerBaseStatements>(s: T, threadId: Sql) {
    this.assertThreadWrite(s, threadId);
    s.modify(sql`
      update db.comment_threads
      set closed_at = now(), closed_by_user_id = current_user
      where id = ${threadId}
        and closed_at is null
        and exists (
          select 1 from db.comments root
          where root.comment_thread_id = comment_threads.id
            and root.reply_to_comment_id is null
            and root.sys_user_id = current_user
        )
    `);
  }

  reopen<T extends IServerBaseStatements>(s: T, threadId: Sql) {
    this.assertThreadWrite(s, threadId);
    s.modify(sql`
      update db.comment_threads
      set closed_at = null, closed_by_user_id = null
      where id = ${threadId}
        and closed_at is not null
        and exists (
          select 1 from db.comments root
          where root.comment_thread_id = comment_threads.id
            and root.reply_to_comment_id is null
            and root.sys_user_id = current_user
        )
    `);
  }
}

export interface CommentsPanelProps {
  /** Display only this discussion, with no new-thread composer. */
  threadOnly?: boolean;
  targetCommentId?: Sql;
  foreignKey: string;
  recordId: AnyExpr;
  /** Additional predicate using the `comment_thread` alias. */
  threadWhere?: Sql;
  /** Values written to a new thread. Defaults to `{ [foreignKey]: recordId }`. */
  newThreadValues?: Record<string, AnyExpr>;
  title?: string;
  emptyText?: string;
  compact?: boolean;
  block?: CommentsBlock;
  additionalCreateActions?: Array<{
    label: string;
    startIcon?: IconName;
    color?: Color;
    disabled?: Sql;
    afterCreate: (
      s: UiServerStatements,
      created: { threadId: Sql; commentId: Sql },
    ) => void;
  }>;
}

const mentionConfig = {
  query: (queryText: Sql) =>
    sql`
      select id, display_name_virtual as label
      from db.sys_users
      where ${queryText} != ''
        and display_name_virtual is not null
        and contains(lower(display_name_virtual), lower(${queryText}))
      order by display_name_virtual
      limit 8
    `,
  maxResults: 8,
};

export function CommentsPanel(props: CommentsPanelProps) {
  const block = props.block ?? system.block(CommentsBlock);
  block.registerImageApp();
  const values = props.newThreadValues ??
    { [props.foreignKey]: props.recordId };
  const where = props.threadWhere ?? sql`true`;
  const linkedCommentId = useCommentLinkTarget();
  const targetCommentId = props.targetCommentId ?? linkedCommentId;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("comments_record_id", props.recordId);
        s.defScalar("comments_new_images_pending", false);
        s.defScalar("comments_reply_images_pending", false);
        s.defScalar("comments_edit_images_pending", false);
        s.defScalar("comments_refresh_key", 0);
        s.defScalar("comments_editor_key", 0);
        s.defScalar("comments_new_body", sql`lexical_simple_paragraph('')`);
        s.defScalar("comments_reply_thread_id", sql`cast(null as bigint)`);
        s.defScalar("comments_reply_to_id", sql`cast(null as bigint)`);
        s.defScalar("comments_reply_body", sql`lexical_simple_paragraph('')`);
        s.defScalar("comments_edit_id", sql`cast(null as bigint)`);
        s.defScalar("comments_edit_revision", sql`cast(null as bigint)`);
        s.defScalar("comments_edit_body", sql`lexical_simple_paragraph('')`);
        s.defScalar("comments_history_id", sql`cast(null as bigint)`);
      }}
    >
      <div
        className={props.compact
          ? "grid min-w-0 grid-cols-1 gap-3"
          : "grid min-w-0 grid-cols-1 gap-4"}
      >
        <div
          className={props.compact
            ? "min-w-0"
            : "min-w-0 rounded-md border border-divider bg-surface p-3"}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MaterialIcon icon="Forum" className="text-secondary" />
              <Typography level="title-sm" className="whitespace-nowrap">
                {props.title ?? "Comments"}
              </Typography>
              <Data
                procedure={(s) => {
                  s.defScalar(
                    "comments_is_following",
                    sql`exists (
                      select 1
                      from db.comment_thread_subscriptions subscription
                      join db.comment_threads followed_thread
                        on followed_thread.id = subscription.comment_thread_id
                      where followed_thread.${sql.ref(props.foreignKey)}
                        = comments_record_id
                        and subscription.sys_user_id = current_user
                    )`,
                  );
                  s.defScalar(
                    "comments_has_threads",
                    sql`exists (
                      select 1
                      from db.comment_threads followed_thread
                      where followed_thread.${sql.ref(props.foreignKey)}
                        = comments_record_id
                    )`,
                  );
                }}
                watch={[sql`comments_refresh_key`]}
              >
                <Button
                  size="xs"
                  variant="plain"
                  color="neutral"
                  disabled={sql`not comments_has_threads`}
                  onClick={(s) => {
                    s.server((s) => {
                      s.startTransaction();
                      s.if(sql`ui.comments_is_following`, (s) => {
                        s.modify(sql`
                          delete from db.comment_thread_subscriptions
                          where sys_user_id = current_user
                            and comment_thread_id in (
                              select followed_thread.id
                              from db.comment_threads followed_thread
                              where followed_thread.${sql.ref(props.foreignKey)}
                                = ui.comments_record_id
                            )
                        `);
                      }, (s) => {
                        s.modify(sql`
                          insert into db.comment_thread_subscriptions (
                            comment_thread_id,
                            sys_user_id
                          )
                          select followed_thread.id, current_user
                          from db.comment_threads followed_thread
                          where followed_thread.${sql.ref(props.foreignKey)}
                            = ui.comments_record_id
                          on conflict (comment_thread_id, sys_user_id)
                            do nothing
                        `);
                      });
                      s.commitTransaction();
                    });
                    s.increment("comments_refresh_key");
                    s.refetch();
                  }}
                >
                  {sql`case when comments_is_following then 'Unfollow' else 'Follow' end`}
                </Button>
              </Data>
            </div>
            <Typography level="body-xs" className="text-right text-tertiary">
              Use @name to notify a teammate
            </Typography>
          </div>
          {!props.threadOnly && (
            <>
              <Show
                when={sql`comments_editor_key % 2 = 0`}
                fallback={
                  <CommentEditor
                    id="comments-new-editor-alt"
                    scalar="comments_new_body"
                  />
                }
              >
                <CommentEditor
                  id="comments-new-editor"
                  scalar="comments_new_body"
                />
              </Show>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {props.additionalCreateActions?.map((action) => (
                  <Button
                    size="sm"
                    variant="outlined"
                    color={action.color ?? "neutral"}
                    startIcon={action.startIcon}
                    disabled={sql`
                  not ${
                      commentHasContent(sql`comments_new_body`)
                    } or comments_new_images_pending
                  or coalesce(${action.disabled ?? sql`false`}, false)
                `}
                    onClick={(s) => {
                      s.server((s) => {
                        s.startTransaction();
                        block.createThread(s, {
                          values: Object.fromEntries(
                            Object.entries(values).map(([field, value]) => [
                              field,
                              sql`${value}`,
                            ]),
                          ),
                          body: sql`ui.comments_new_body`,
                          intoThread: "created_action_comment_thread_id",
                          intoComment: "created_action_comment_id",
                        });
                        action.afterCreate(s, {
                          threadId: sql`created_action_comment_thread_id`,
                          commentId: sql`created_action_comment_id`,
                        });
                        s.commitTransaction();
                      });
                      s.setScalar(
                        "comments_new_body",
                        sql`lexical_simple_paragraph('')`,
                      );
                      s.increment("comments_editor_key");
                      s.increment("comments_refresh_key");
                      s.refetch();
                    }}
                  >
                    {action.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  startIcon="AddComment"
                  disabled={sql`not ${
                    commentHasContent(sql`comments_new_body`)
                  } or comments_new_images_pending`}
                  onClick={(s) => {
                    s.server((s) => {
                      s.startTransaction();
                      block.createThread(s, {
                        values: Object.fromEntries(
                          Object.entries(values).map(([field, value]) => [
                            field,
                            sql`${value}`,
                          ]),
                        ),
                        body: sql`ui.comments_new_body`,
                      });
                      s.commitTransaction();
                    });
                    s.setScalar(
                      "comments_new_body",
                      sql`lexical_simple_paragraph('')`,
                    );
                    s.increment("comments_editor_key");
                    s.increment("comments_refresh_key");
                    s.refetch();
                  }}
                >
                  Post comment
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="order-2">
          <Data
            procedure={(s) => {
              s.defTable(
                "comment_threads_for_record",
                sql`
                select
                  comment_thread.*,
                  ${block.canWrite(sql`comment_thread`)} as can_write,
                  root.id as root_comment_id,
                  root.sys_user_id as root_user_id,
                  root.created_at as root_created_at,
                  root.comments as root_comments,
                  root.revision_no as root_revision_no,
                  root.last_edited_at as root_last_edited_at,
                  root.retracted_at as root_retracted_at,
                  root.sys_user_id = current_user as root_is_author,
                  (select count(*) from db.comments reply
                    where reply.comment_thread_id = comment_thread.id
                      and reply.reply_to_comment_id is not null) as reply_count,
                  (select max(activity.created_at) from db.comments activity
                    where activity.comment_thread_id = comment_thread.id) as latest_activity_at
                from db.comment_threads comment_thread
                join db.comments root
                  on root.comment_thread_id = comment_thread.id
                  and root.reply_to_comment_id is null
                where comment_thread.${
                  sql.ref(props.foreignKey)
                } = comments_record_id
                  and ${where}
                  and ${block.canRead(sql`comment_thread`)}
                order by case when comment_thread.id = (
                  select target.comment_thread_id from db.comments target
                  where target.id = ${targetCommentId}
                ) then 0 else 1 end,
                  latest_activity_at desc, comment_thread.id desc
                limit 100
              `,
              );
              s.defScalar(
                "comment_thread_count",
                sql`(select count(*) from comment_threads_for_record)`,
              );
            }}
            watch={[sql`comments_refresh_key`, targetCommentId]}
          >
            <Show
              when={sql`comment_thread_count > 0`}
              fallback={
                <div className="rounded-md border border-divider bg-level1 p-4 text-sm text-secondary">
                  {props.emptyText ?? "No comments yet."}
                </div>
              }
            >
              <div className="divide-y divide-divider rounded-md border border-divider">
                <Each
                  table="comment_threads_for_record"
                  recordName="comment_thread"
                >
                  <div
                    id={sql`'comment-thread-' || cast(comment_thread.id as string)`}
                    className="p-3"
                  >
                    <CommentTarget
                      commentId={sql`comment_thread.root_comment_id`}
                      targetCommentId={targetCommentId}
                    >
                      <CommentHeader
                        authorId={sql`comment_thread.root_user_id`}
                        createdAt={sql`comment_thread.root_created_at`}
                        editedAt={sql`comment_thread.root_last_edited_at`}
                      />
                      <CommentBody
                        body={sql`comment_thread.root_comments`}
                        retractedAt={sql`comment_thread.root_retracted_at`}
                      />
                      <CommentActions
                        block={block}
                        canWrite={sql`comment_thread.can_write`}
                        commentId={sql`comment_thread.root_comment_id`}
                        threadId={sql`comment_thread.id`}
                        revisionNo={sql`comment_thread.root_revision_no`}
                        body={sql`comment_thread.root_comments`}
                        retractedAt={sql`comment_thread.root_retracted_at`}
                        closedAt={sql`comment_thread.closed_at`}
                        isAuthor={sql`comment_thread.root_is_author`}
                        threadRoot
                      />
                    </CommentTarget>
                    <Data
                      procedure={(s) => {
                        s.defTable(
                          "comment_replies",
                          sql`
                          select comments.*,
                            comments.sys_user_id = current_user as is_author
                          from db.comments comments
                          where comments.comment_thread_id = comment_thread.id
                            and comments.reply_to_comment_id is not null
                          order by created_at, id
                        `,
                        );
                      }}
                      watch={[sql`comments_refresh_key`]}
                    >
                      <div className="ml-6 mt-2 border-l border-divider pl-3">
                        <Each
                          table="comment_replies"
                          recordName="comment_reply"
                        >
                          <CommentTarget
                            commentId={sql`comment_reply.id`}
                            targetCommentId={targetCommentId}
                          >
                            <CommentHeader
                              authorId={sql`comment_reply.sys_user_id`}
                              createdAt={sql`comment_reply.created_at`}
                              editedAt={sql`comment_reply.last_edited_at`}
                            />
                            <CommentBody
                              body={sql`comment_reply.comments`}
                              retractedAt={sql`comment_reply.retracted_at`}
                            />
                            <CommentActions
                              block={block}
                              canWrite={sql`comment_thread.can_write`}
                              commentId={sql`comment_reply.id`}
                              threadId={sql`comment_thread.id`}
                              revisionNo={sql`comment_reply.revision_no`}
                              body={sql`comment_reply.comments`}
                              retractedAt={sql`comment_reply.retracted_at`}
                              closedAt={sql`comment_thread.closed_at`}
                              isAuthor={sql`comment_reply.is_author`}
                            />
                          </CommentTarget>
                        </Each>
                      </div>
                    </Data>
                    <Show
                      when={sql`comments_reply_thread_id = comment_thread.id`}
                    >
                      <div className="ml-6 mt-3 grid gap-2 border-l border-divider pl-3">
                        <CommentEditor
                          id={sql`'comment-reply-' || cast(comment_thread.id as string)`}
                          scalar="comments_reply_body"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="plain"
                            color="neutral"
                            onClick={(s) =>
                              s.setScalar(
                                "comments_reply_thread_id",
                                sql`null`,
                              )}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={sql`not ${
                              commentHasContent(sql`comments_reply_body`)
                            } or comments_reply_images_pending`}
                            onClick={(s) => {
                              s.server((s) => {
                                s.startTransaction();
                                block.reply(s, {
                                  threadId: sql`ui.comments_reply_thread_id`,
                                  replyToCommentId:
                                    sql`ui.comments_reply_to_id`,
                                  body: sql`ui.comments_reply_body`,
                                });
                                s.commitTransaction();
                              });
                              s.setScalar(
                                "comments_reply_thread_id",
                                sql`null`,
                              );
                              s.setScalar(
                                "comments_reply_body",
                                sql`lexical_simple_paragraph('')`,
                              );
                              s.increment("comments_refresh_key");
                              s.refetch();
                            }}
                          >
                            Reply
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Each>
              </div>
            </Show>
          </Data>
        </div>

        <Show when={sql`comments_edit_id is not null`}>
          <div className="order-1 rounded-md border border-divider bg-surface p-3">
            <Typography level="title-sm" className="mb-2">
              Edit comment
            </Typography>
            <CommentEditor
              id="comments-edit-editor"
              scalar="comments_edit_body"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                onClick={(s) => s.setScalar("comments_edit_id", sql`null`)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={sql`comments_edit_images_pending or not ${
                  commentHasContent(sql`comments_edit_body`)
                }`}
                onClick={(s) => {
                  s.server((s) => {
                    s.startTransaction();
                    block.edit(s, {
                      commentId: sql`ui.comments_edit_id`,
                      revisionNo: sql`ui.comments_edit_revision`,
                      body: sql`ui.comments_edit_body`,
                    });
                    s.commitTransaction();
                  });
                  s.setScalar("comments_edit_id", sql`null`);
                  s.increment("comments_refresh_key");
                  s.refetch();
                }}
              >
                Save edit
              </Button>
            </div>
          </div>
        </Show>

        <Show when={sql`comments_history_id is not null`}>
          <Data
            procedure={(s) => {
              s.defTable(
                "comment_history",
                sql`
                select revision_no, comments, edited_by_user_id, edited_at
                from db.comment_revisions
                where comment_id = comments_history_id
                  and exists (select 1 from db.comments history_comment
                    join db.comment_threads history_thread on history_thread.id = history_comment.comment_thread_id
                    where history_comment.id = comments_history_id and ${
                  block.canRead(sql`history_thread`)
                })
                order by revision_no desc
              `,
              );
            }}
          >
            <div className="order-1 rounded-md border border-divider bg-level1 p-3">
              <div className="mb-2 flex items-center justify-between">
                <Typography level="title-sm">Earlier versions</Typography>
                <Button
                  size="sm"
                  variant="plain"
                  color="neutral"
                  onClick={(s) => s.setScalar("comments_history_id", sql`null`)}
                >
                  Close
                </Button>
              </div>
              <Each table="comment_history" recordName="comment_version">
                <div className="border-t border-divider py-2">
                  <Typography level="body-xs" className="text-tertiary">
                    Version {sql`comment_version.revision_no`} ·{" "}
                    {sql`format.date(comment_version.edited_at, '%b %-d, %Y %-I:%M %p')`}
                  </Typography>
                  <div className="mt-1 text-sm">
                    <LexicalRichTextDisplay
                      value={sql`comment_version.comments`}
                    />
                  </div>
                </div>
              </Each>
            </div>
          </Data>
        </Show>
      </div>
    </Data>
  );
}

function CommentTarget(
  props: {
    commentId: Sql;
    targetCommentId?: Sql;
    children: Node;
  },
) {
  const id = sql`'comment-' || cast(${props.commentId} as string)`;
  const selected = sql`${props.commentId} = ${
    props.targetCommentId ?? sql`cast(null as bigint)`
  }`;
  return (
    <div
      id={id}
      tabIndex={-1}
      className="rounded-md py-2 outline-none scroll-mt-4"
      dynamicClassNames={[{
        condition: selected,
        classNames: "bg-primary-50 ring-2 ring-primary-300 px-3",
      }]}
    >
      <Show when={selected}>
        <EventHandlers
          mount={(s) => {
            s.element(id).scrollIntoView({ block: sql.lit`center` });
            s.element(id).focus();
          }}
        />
      </Show>
      {props.children}
    </div>
  );
}

function CommentPage(props: { block: CommentsBlock }) {
  const discussion = props.block.opts.discussion;
  if (!discussion) {
    throw new Error("Comment permalinks require a discussion adapter");
  }
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "linked_discussion",
          sql`select thread.*,
      ${discussion.parentHref(sql`thread`)} as parent_href
      from db.comments target join db.comment_threads thread on thread.id = target.comment_thread_id
      where target.id = linked_comment_id and ${
            props.block.canRead(sql`thread`)
          }`,
        );
      }}
    >
      <Show
        when={sql`linked_discussion.id is not null and linked_discussion.parent_href is not null`}
        fallback={
          <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
            <Button href="/notifications" variant="plain" startIcon="ArrowBack">
              Notifications
            </Button>
            <div role="status" className="rounded-md border border-divider p-6">
              This discussion is unavailable or you no longer have access.
            </div>
          </main>
        }
      >
        <Redirect
          to={sql`linked_discussion.parent_href
            || case when contains(linked_discussion.parent_href, '?') then '&' else '?' end
            || 'comment=' || cast(linked_comment_id as string)`}
        />
      </Show>
    </Data>
  );
}

function CommentEditor(props: { id: Sql | string; scalar: string }) {
  const pendingScalar = props.scalar.replace("_body", "_images_pending");
  return (
    <CommentImageEditor
      {...props}
      pendingScalar={pendingScalar}
      mentions={mentionConfig}
    />
  );
}

function CommentHeader(
  props: { authorId: Sql; createdAt: Sql; editedAt: Sql },
) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Typography level="body-sm" className="font-medium">
        <InlineRecordDisplay tableName="sys_users" id={props.authorId} />
      </Typography>
      <Typography level="body-xs" className="text-tertiary">
        {sql`format.date(${props.createdAt}, '%b %-d, %Y %-I:%M %p')`}
      </Typography>
      <Show when={sql`${props.editedAt} is not null`}>
        <Typography level="body-xs" className="text-tertiary">
          edited
        </Typography>
      </Show>
    </div>
  );
}

function CommentBody(props: { body: Sql; retractedAt: Sql }) {
  return (
    <div className="mt-1 text-sm">
      <div
        style={{
          "text-decoration":
            sql`case when ${props.retractedAt} is not null then 'line-through' else 'none' end`,
          opacity:
            sql`case when ${props.retractedAt} is not null then 0.6 else 1 end`,
        }}
      >
        <LexicalRichTextDisplay value={props.body} expandImages />
      </div>
      <Show when={sql`${props.retractedAt} is not null`}>
        <Typography level="body-xs" className="mt-1 text-tertiary">
          Retracted{" "}
          {sql`format.date(${props.retractedAt}, '%b %-d, %Y %-I:%M %p')`}
        </Typography>
      </Show>
    </div>
  );
}

function CommentActions(props: {
  block: CommentsBlock;
  commentId: Sql;
  threadId: Sql;
  revisionNo: Sql;
  body: Sql;
  retractedAt: Sql;
  closedAt: Sql;
  isAuthor: Sql;
  canWrite: Sql;
  threadRoot?: boolean;
}) {
  const appDomain = useApp().domain;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {props.block.opts.discussion && (
        <Button
          size="xs"
          variant="plain"
          color="neutral"
          startIcon="Link"
          onClick={(s) =>
            s.clipboard.writeText(
              notificationAppHref(
                appDomain,
                props.block.commentHref(props.commentId),
              ),
            )}
        >
          Copy link
        </Button>
      )}
      <Show when={sql`${props.closedAt} is null and ${props.canWrite}`}>
        <Button
          size="xs"
          variant="plain"
          color="neutral"
          onClick={(s) => {
            s.setScalar("comments_reply_thread_id", props.threadId);
            s.setScalar("comments_reply_to_id", props.commentId);
            s.setScalar(
              "comments_reply_body",
              sql`lexical_simple_paragraph('')`,
            );
          }}
        >
          Reply
        </Button>
      </Show>
      <Show
        when={sql`${props.canWrite} and ${props.isAuthor} and ${props.retractedAt} is null`}
      >
        <Button
          size="xs"
          variant="plain"
          color="neutral"
          onClick={(s) => {
            s.setScalar("comments_edit_id", props.commentId);
            s.setScalar("comments_edit_revision", props.revisionNo);
            s.setScalar("comments_edit_body", props.body);
          }}
        >
          Edit
        </Button>
        <Button
          size="xs"
          variant="plain"
          color="danger"
          onClick={(s) => {
            s.server((s) => {
              s.startTransaction();
              props.block.retract(s, props.commentId);
              s.commitTransaction();
            });
            s.increment("comments_refresh_key");
            s.refetch();
          }}
        >
          Retract
        </Button>
      </Show>
      <Show when={sql`${props.revisionNo} > 1`}>
        <Button
          size="xs"
          variant="plain"
          color="neutral"
          onClick={(s) => s.setScalar("comments_history_id", props.commentId)}
        >
          History
        </Button>
      </Show>
      {props.threadRoot && (
        <Show when={sql`${props.canWrite} and ${props.isAuthor}`}>
          <Button
            size="xs"
            variant="plain"
            color="neutral"
            onClick={(s) => {
              s.server((s) => {
                s.startTransaction();
                s.if(
                  sql`${props.closedAt} is null`,
                  (s) =>
                    props.block.close(s, props.threadId),
                  (s) => props.block.reopen(s, props.threadId),
                );
                s.commitTransaction();
              });
              s.increment("comments_refresh_key");
              s.refetch();
            }}
          >
            {sql`case when ${props.closedAt} is null then 'Close thread' else 'Reopen thread' end`}
          </Button>
        </Show>
      )}
      {props.threadRoot && (
        <Show when={sql`${props.closedAt} is not null`}>
          <Chip size="sm" variant="soft" color="neutral">Closed</Chip>
        </Show>
      )}
    </div>
  );
}
