import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import { storedScheduledProc } from "std/scheduled_utils";

/** Images live outside the comment JSON; the row pins the private blob. */
export function initializeCommentImages() {
  system.db.table("comment_images", (t) => {
    t.uuid("public_id").notNull().unique();
    t.fk("comment_id", "comments").onDelete("Cascade");
    t.fk("uploaded_by_user_id", "sys_users").notNull().onDelete("Restrict");
    t.blobRef("blob_hash").notNull();
    t.string("content_type", 100).notNull();
    t.timestampUtc("created_at").notNull().default(sql`now()`);
    t.skipAutoApi();
  });
  storedScheduledProc({
    name: "comment_image_cleanup",
    schedule: "0 30 3 * * *",
    description: "Remove abandoned comment image uploads after one day.",
    procedure: (s) => {
      s.startTransaction();
      s.modify(
        sql`delete from db.comment_images where comment_id is null and created_at < date.add(day, -1, now())`,
      );
      s.commitTransaction();
    },
  });
}

export function commentHasContent(body: Sql) {
  return sql`(trim(lexical_rich_text_to_plain_text(${body})) != '' or json_array_length(lexical_extract_nodes(${body}, 'image')) > 0)`;
}

/** Claim only the author's completed uploads, retaining old images for history. */
export function claimCommentImages<T extends IServerBaseStatements>(
  s: T,
  body: Sql,
  commentId: Sql,
) {
  s.throwErrorIf(
    sql`exists (
    select 1 from json.array_each(lexical_extract_nodes(${body}, 'image')) node
    where not exists (
      select 1 from db.comment_images image
      where image.public_id = try_cast(node.value->>'assetKey' as uuid)
        and node.value->>'src' = '/api/comment-images/' || cast(image.public_id as string)
        and (image.comment_id = ${commentId} or (
          image.comment_id is null and image.uploaded_by_user_id = current_user
          and image.created_at >= date.add(day, -1, now())
        ))
    )
  )`,
    sql
      .lit`An image is not ready. Retry its upload or remove it before posting.`,
  );
  s.modify(sql`update db.comment_images set comment_id = ${commentId}
    where comment_id is null and uploaded_by_user_id = current_user
      and public_id in (select try_cast(value->>'assetKey' as uuid) from json.array_each(lexical_extract_nodes(${body}, 'image')))`);
}
