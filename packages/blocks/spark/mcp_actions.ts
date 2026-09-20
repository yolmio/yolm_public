import { sparkBulkUndo } from "./bulk_undo";
import { undoSparkActionReceipt } from "./action_undo";
import { sql } from "std/sql_utils";
import type { RegisterReactorsOpts, SparkTool } from "./agent";
import { sparkSessionActionAllowed } from "./action_permissions";
export { sparkSessionActionAllowed } from "./action_permissions";

/** Receipts retain their native event ownership and exact Undo target. */
export function externalSparkReceiptTools(
  opts: RegisterReactorsOpts,
): SparkTool[] {
  return ["previewUndo", "undoReceipts", "actionReceipt", "undoReceipt"].map((
    name,
  ) => ({
    name,
    statements: (s) => {
      if (name === "previewUndo" || name === "undoReceipts") {
        s.defScalar("bulk_undo_result", { type: "Json" });
        sparkBulkUndo(s, {
          session: sql`spark_js_conversation_id`,
          user: sql`spark_js_owner_id`,
          executingAgent: sql`spark_js_agent_id`,
          grantedCapabilities: sql`spark_granted_capabilities`,
          execute: name === "undoReceipts",
          selection: name === "previewUndo"
            ? sql`(select json_array_agg(json_build_object('receiptId', value)) from json.array_each(tool_input->0->'receiptIds'))`
            : sql`tool_input->0->'preview'->'receipts'`,
        }, "bulk_undo_result");
        s.return(sql`bulk_undo_result`);
        return;
      }
      s.defScalar(
        "receipt_id",
        sql`try_cast(tool_input->0->>'receiptId' as bigint)`,
      );
      if (name === "undoReceipt") s.startTransaction();
      s.defRecord(
        "receipt",
        sql`select r.* from db.spark_action_log r join db.spark_conversations c on c.id = r.spark_conversation_id where r.id = receipt_id and c.sys_user_id = spark_js_owner_id and (spark_js_conversation_id is null or c.id = spark_js_conversation_id)`,
      );
      s.if(
        sql`receipt.id is null`,
        (s) => s.throwError(sql.lit`Receipt not found.`),
      );
      if (name === "undoReceipt") {
        const reversible = opts.capabilities.flatMap((c) =>
          (c.actions ?? []).filter((a) => a.mode === "reversible").map((a) =>
            `${c.name}.${a.name}`
          )
        );
        s.if(
          sql`not (${
            sql.lit(JSON.stringify(reversible))
          }::json @> json_build_array(receipt.action_name))`,
          (s) => s.throwError(sql.lit`This action is not reversible.`),
        );
        s.if(
          sql`not (${
            sparkSessionActionAllowed(
              opts,
              sql`spark_js_owner_id`,
              sql`receipt.spark_conversation_id`,
              sql`receipt.action_name`,
            )
          })`,
          (s) => s.throwError(sql.lit`The action is no longer authorized.`),
        );
        s.if(
          sql`receipt.status = 'executed'`,
          (s) =>
            undoSparkActionReceipt(s, {
              id: sql`receipt.id`,
              transactionId: sql`receipt.transaction_id`,
              result: sql`receipt.result_json`,
            }),
        );
        s.if(
          sql`receipt.status not in ('executed', 'undone')`,
          (s) =>
            s.throwError(
              sql.lit`Only completed reversible actions can be undone.`,
            ),
        );
        s.commitTransaction();
      }
      s.return(
        sql`(select json_build_object('receiptId', id, 'action', action_name, 'status', status, 'result', result_json) from db.spark_action_log where id = receipt_id)`,
      );
    },
  }));
}

export const externalSparkImage: SparkTool = {
  name: "__sparkEmitImage",
  statements: (s) => {
    s.defScalar("image_mime", sql`tool_input->0->>'mimeType'`);
    s.if(
      sql`coalesce(image_mime, '') not in ('image/png', 'image/jpeg', 'image/webp')`,
      (s) => s.throwError(sql.lit`Use PNG, JPEG, or WebP images.`),
    );
    s.getJsBytes(sql`try_cast(tool_input->0->>'bytesId' as bigint)`, {
      defBytesScalar: "image_bytes",
    });
    s.if(
      sql`octet_length(image_bytes) not between 1 and 4194304`,
      (s) => s.throwError(sql.lit`Images must be between 1 byte and 4 MiB.`),
    );
    s.return(
      sql`json_build_object('type', 'image', 'mimeType', image_mime, 'data', encode.base64(image_bytes))`,
    );
  },
};
