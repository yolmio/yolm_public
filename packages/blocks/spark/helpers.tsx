import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { defineVirtualizedChatTimelineState } from "components/virtualized_chat_timeline";

// Predicate: the conversation aliased `${conv}` is visible to `${userExpr}` —
// they own it, it is `organization`-visible, or it is shared with them. The
// single access rule for conversation contents.
export function conversationVisibleTo(conv: Sql, userExpr: Sql): Sql {
  return sql`(
    ${conv}.sys_user_id = ${userExpr}
    or ${conv}.visibility = 'organization'
    or exists (
      select 1 from db.spark_conversation_shares sh
      where sh.spark_conversation_id = ${conv}.id
        and sh.shared_with_sys_user_id = ${userExpr})
  )`;
}

// Resolves a route-supplied conversation id to itself only when the current
// user may see it, else null — so downstream reads keyed by
// active_conversation_id are access-checked in one place (closes the direct
// object reference: reading a conversation you don't own by guessing its id).
export function visibleConversationId(routeExpr: Sql): Sql {
  // coalesce to -1 so the list route (null::bigint) and garbage/undecodable
  // ids resolve to "no conversation" without an `= null` comparison (which the
  // compiler rejects), rather than leaking a row.
  return sql`(select c.id from db.spark_conversations c
    where c.id = coalesce(${routeExpr}, -1)
      and ${conversationVisibleTo(sql`c`, sql`current_user`)})`;
}

// The sidebar conversation-list query (status badges + search filter),
// parameterized by a visibility WHERE clause so the "my conversations" and
// "shared with me" lists share one definition. Requires `conv_search` in scope.
export function conversationListQuery(whereExpr: Sql): Sql {
  return sql`select
      c.id, c.status, c.label, c.last_message_at, c.is_paused,
      (exists(select 1 from db.spark_agents q
          where q.spark_conversation_id = c.id
            and q.status = 'waiting_on_questions')
        or exists(select 1 from db.spark_action_log al
          where al.spark_conversation_id = c.id
            and al.status = 'proposed')) as needs_attention,
      (not c.is_paused and exists(select 1 from db.spark_agents a
          where a.spark_conversation_id = c.id
            and a.status in (
              'awaiting_plan', 'awaiting_execute', 'executing',
              'failed_retrying_plan'))
        ) as is_working
    from db.spark_conversations c
    where ${whereExpr}
      and (conv_search = ''
        or contains(lower(coalesce(c.label, '')), lower(conv_search)))
    order by c.last_message_at desc`;
}

// URL helpers for per-conversation routing. basePath "" => list at "/",
// conversation at "/{id}". A consumer can mount SparkPage under a prefix
// (e.g. "/spark") => list at "/spark", conversation at "/spark/{id}".
export function sparkListPath(basePath: string): Sql {
  return sql.lit(basePath === "" ? "/" : basePath);
}

export function sparkConvPath(basePath: string, idExpr: Sql): Sql {
  return sql.concat(sql.lit(`${basePath}/`), sql`cast(${idExpr} as string)`);
}

// Full-page artifact view for a single card: `${base}/{conv}/card/{event}`.
export function sparkCardPath(
  basePath: string,
  convExpr: Sql,
  cardExpr: Sql,
): Sql {
  return sql.concat(
    sql.lit(`${basePath}/`),
    sql`cast(${convExpr} as string)`,
    sql.lit("/card/"),
    sql`cast(${cardExpr} as string)`,
  );
}

// Shared composer/attachment scalars used by the timeline + composer tree.
export function defConversationScalars(
  s: import("std/statements").StateStatements,
) {
  s.defScalar("message_input", sql.lit``);
  s.defScalar("archive_dialog_open", false);
  s.defScalar("share_dialog_open", false);
  s.defScalar("changes_panel_open", false);
  s.defScalar("work_tab", sql.lit`changes`);
  s.defScalar("requested_artifact_id", sql`null::bigint`);
  s.defScalar("changes_execution_id", sql`null::bigint`);
  s.defScalar("refresh_key", 0);
  defineVirtualizedChatTimelineState(s);
  // Attachments staged in the composer but not yet sent. `kind` is
  // 'text' | 'image' | 'binary'; text keeps its body inline (`body`), image /
  // binary reference an already-created blob by hex hash. The
  // db.spark_attachments rows are created by sendMessageProcedure when the
  // message is actually sent (the conversation may not exist until then).
  s.defTable("staged_attachments", {
    fields: [
      { name: "id", type: "BigInt", notNull: true },
      { name: "name", type: { type: "String", maxLength: 500 }, notNull: true },
      { name: "mime", type: { type: "String", maxLength: 200 }, notNull: true },
      { name: "size", type: "BigInt", notNull: true },
      { name: "kind", type: { type: "String", maxLength: 20 }, notNull: true },
      { name: "body", type: { type: "String", maxLength: 50000 } },
      { name: "blob_hash_hex", type: { type: "String", maxLength: 64 } },
    ],
  });
  s.defScalar("attachment_uploading", false);
  s.defScalar("attachment_upload_error", sql.lit``);
  s.defScalar("composer_drag_active", false);
  s.defScalar("composer_expanded", false);
  s.defScalar("pending_reasoning_effort", sql.lit`low`);
  s.defScalar("pending_model", sql.lit`gpt-5.6-luna`);
  // Attachment preview dialog (opened from a timeline chip).
  s.defScalar("attachment_preview_open", false);
  s.defScalar("attachment_preview_name", sql.lit``);
  s.defScalar("attachment_preview_body", sql.lit``);
  // Inline conversation-title rename (header). Kept in the page scope so an
  // in-flight edit survives the timeline's refetch on agent activity.
  s.defScalar("editing_title", false);
  s.defScalar("title_draft", sql.lit``);
  s.defScalar(
    "active_conv_owner_id",
    sql`(select sys_user_id from db.spark_conversations
      where id = active_conversation_id)`,
  );
  s.defScalar(
    "active_conv_capabilities",
    sql`coalesce((select capabilities_json from db.spark_conversations
      where id = active_conversation_id), '[]'::json)`,
  );
  // Whether current_user owns the active conversation. Drives the read-only
  // treatment for viewers of shared / organization-visible conversations: the
  // composer and every conversation control (rename, AI menu, pause, archive)
  // are owner-only. Null active id (new/list route) counts as owner — a new
  // conversation will be created owned by current_user.
  s.defScalar(
    "active_conv_is_owner",
    sql`active_conversation_id is null or active_conv_owner_id = current_user`,
  );
  // For a non-owner: shares are view-only today, whether targeted or via
  // organization visibility.
  s.defScalar(
    "active_conv_access_label",
    sql.lit`View only`,
  );
  // For the owner: whether this conversation is shared at all (organization-
  // visible or shared with specific people), so the header can flag it.
  s.defScalar(
    "active_conv_is_shared",
    sql`active_conversation_id is not null and exists(
      select 1 from db.spark_conversations c
      where c.id = active_conversation_id
        and (c.visibility = 'organization'
          or exists(select 1 from db.spark_conversation_shares sh
            where sh.spark_conversation_id = c.id)))`,
  );
  // Context (json) stamped onto a conversation created from this mount, so a
  // client-portal embed can bind new conversations to a tenant/record scope
  // (like start()'s `context`). Null by default; a SparkPage/SparkPanel
  // `context` prop overrides it. Read by sendMessageProcedure on creation.
  s.defScalar("pending_conversation_context", sql`null::json`);
}
