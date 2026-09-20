import type { Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import { latestStateProcess } from "std/transform_helpers";

/**
 * Migrates the latest state of a legacy one-row-per-comment table into the
 * shared thread/comment model. Each old row becomes one thread with one root
 * comment. Following remains an explicit user action.
 */
export function legacyCommentsLatestStateProcess(opts: {
  sourceDb: string;
  sourceTable: string;
  threadFields: Record<string, string>;
  rowFilter?: (sourceAlias: string) => Sql;
}) {
  const prefix = `migrate_${opts.sourceTable}`;
  const threadIdScalar = `${prefix}_thread_id`;
  const sourceAlias = `${prefix}_source`;
  const fields = [
    { name: "comment_thread_id" },
    { name: "reply_to_comment_id" },
    { name: "sys_user_id" },
    { name: "created_at" },
    { name: "comments" },
    { name: "revision_no" },
  ];

  return latestStateProcess({
    targetTable: "comments",
    sourceTable: sql.ref(opts.sourceDb, opts.sourceTable),
    fields,
    sourceAlias,
    scalarPrefix: prefix,
    rowFilter: opts.rowFilter,
    fieldExpr: (field, alias) => {
      if (field.name === "comment_thread_id") return sql.ref(threadIdScalar);
      if (field.name === "reply_to_comment_id") {
        return sql`cast(null as bigint)`;
      }
      if (field.name === "revision_no") return sql`1`;
      return sql.ref(alias, field.name);
    },
    beforeInsert: (s, { recordIdExpr }) => {
      const targetFields = Object.keys(opts.threadFields);
      const sourceFields = Object.values(opts.threadFields);
      s.defScalar(threadIdScalar, { type: "BigInt" });
      s.modify(sql`
        insert into db.comment_threads (${
        targetFields.map((field) => sql.ref(field))
      })
        select ${sourceFields.map((field) => sql.ref("legacy_comment", field))}
        from ${sql.ref(opts.sourceDb, opts.sourceTable)} legacy_comment
        where legacy_comment.id = ${recordIdExpr}
        returning id into ${sql.ref(threadIdScalar)}
      `);
    },
  });
}
