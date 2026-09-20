import { sql } from "std/sql_utils";
import { addCtx, createICtxKey, useOptionalICtx, useQueryParams } from "std/ui";

const CommentLinkTarget = createICtxKey<{ declared: boolean }>(
  "CommentLinkTarget",
);

/** Share the URL target between a record rail and its nested comments panel. */
export function useCommentLinkTarget() {
  if (!useOptionalICtx(CommentLinkTarget)) {
    useQueryParams([{
      name: "comment",
      type: { type: "String", maxLength: 100 },
      default: sql.lit``,
    }]);
    const context = { implementICtxs: [CommentLinkTarget], declared: true };
    addCtx(context);
  }
  return sql`try_cast(comment as bigint)`;
}
