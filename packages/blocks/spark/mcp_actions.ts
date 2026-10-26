import { sparkBulkUndo } from "./bulk_undo";
import {
  prepareSparkUndo,
  sparkActionReceiptTransaction,
  undoSparkActionReceipt,
} from "./action_undo";
import { type Sql, sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import type { RegisterReactorsOpts, SparkTool } from "./agent";
import { sparkSessionActionAllowed } from "./action_permissions";
export { sparkSessionActionAllowed } from "./action_permissions";

/**
 * Refuses an undo the engine would block, naming the later change. Undo is
 * not a stack: a later action that changed the same record, or the undo of
 * such an action, blocks undoing this receipt on its own, because the engine
 * reads every later write, undos included, as a change it would overwrite.
 * Runs outside a transaction.
 */
function rejectBlockedReceiptUndo(
  s: GeneralServerStatements,
  transaction: Sql,
) {
  s.analyzeUndoTransactions(transaction, "undo_receipt_analysis");
  s.defRecord(
    "undo_receipt_blocked",
    sql`select analysis.blocking_tx_id, analysis.blocking_table,
        analysis.blocking_record_id, analysis.reason,
        later.id as later_receipt_id, later.action_name as later_action,
        later.status is distinct from 'undone' as later_executed
      from undo_receipt_analysis analysis
      left join (select r.id, r.action_name, r.status, r.transaction_id,
          undone.tx_id as undo_tx_id
        from db.spark_action_log r
        join db.spark_conversations c on c.id = r.spark_conversation_id
        left join db.spark_action_log__versions undone
          on undone.record_id = r.id
          and undone.spark_action_log__status = 'undone'
          and undone.spark_action_log__status__set
        where c.sys_user_id = spark_js_owner_id) later
        on analysis.blocking_tx_id in (later.transaction_id, later.undo_tx_id)
      where analysis.status != 'Ready'
      order by later.id limit 1`,
  );
  s.if(
    sql`undo_receipt_blocked.blocking_tx_id is not null
      or undo_receipt_blocked.reason is not null`,
    (s) =>
      s.throwError(sql`'Receipt ' || cast(receipt_id as string)
        || ' cannot be undone on its own: ' || case
          when undo_receipt_blocked.blocking_table is null
            then coalesce(undo_receipt_blocked.reason, 'it is blocked') || '.'
          else (case
            when undo_receipt_blocked.later_receipt_id is null
              then 'a later change outside this Spark session (transaction '
                || cast(undo_receipt_blocked.blocking_tx_id as string)
                || ', such as a release or another user''s edit)'
            when undo_receipt_blocked.later_executed
              then 'later receipt '
                || cast(undo_receipt_blocked.later_receipt_id as string)
                || ' (' || undo_receipt_blocked.later_action || ')'
            else 'the undo of later receipt '
              || cast(undo_receipt_blocked.later_receipt_id as string)
              || ' (' || undo_receipt_blocked.later_action || ')' end)
            || ' changed the same ' || undo_receipt_blocked.blocking_table
            || ' record ' || cast(undo_receipt_blocked.blocking_record_id as string)
            || '. ' || case
              when undo_receipt_blocked.later_receipt_id is not null
                and undo_receipt_blocked.later_executed
                then 'Undo both at once with tools.previewUndo({receiptIds: ['
                  || cast(undo_receipt_blocked.later_receipt_id as string) || ', '
                  || cast(receipt_id as string)
                  || ']}) and tools.undoReceipts({preview}); undoing the later receipt alone first would leave this one blocked.'
              when undo_receipt_blocked.later_receipt_id is not null
                then 'Undo is not a stack: an undo is itself a later change, so receipts that touch the same records must be undone together. Reverse this receipt''s changes with a new action instead.'
              else 'Reverse its changes with a new action instead.' end
          end`),
  );
}

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
      if (name === "undoReceipt") {
        const receiptTransaction = sql`select ${
          sparkActionReceiptTransaction({
            id: sql`r.id`,
            transactionId: sql`r.transaction_id`,
          })
        } as tx_id
          from db.spark_action_log r
          join db.spark_conversations c on c.id = r.spark_conversation_id
          where r.id = receipt_id and r.status = 'executed'
            and c.sys_user_id = spark_js_owner_id
            and (spark_js_conversation_id is null
              or c.id = spark_js_conversation_id)`;
        prepareSparkUndo(s, receiptTransaction);
        rejectBlockedReceiptUndo(s, receiptTransaction);
        s.startTransaction();
      }
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
