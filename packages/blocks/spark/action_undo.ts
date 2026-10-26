import { type Sql, sql } from "std/sql_utils";
import type { ServerStatementsBase } from "std/statements";

interface SparkActionBatchUndoOpts {
  conversationId: Sql;
  executionEventId: Sql;
  actionId: Sql;
  agentId?: Sql;
  actionFilter: Sql;
}

export function undoSparkActionBatch<T extends ServerStatementsBase<any>>(
  s: T,
  opts: SparkActionBatchUndoOpts,
) {
  assertSparkActionBatchUndoable(s, opts);
  prepareSparkUndo(s, sparkActionBatchTransactions(opts));
  s.startTransaction();
  undoSparkActionBatchInTransaction(s, opts);
  s.commitTransaction();
}

export function sparkActionBatchTransactions(opts: SparkActionBatchUndoOpts) {
  return sql`
    select transaction_id as tx_id
    from db.spark_action_log
    where spark_conversation_id = ${opts.conversationId}
      and execution_event_id = ${opts.executionEventId}
      and status = 'executed'
      and (${opts.actionFilter})
      and transaction_id is not null
  `;
}

/** Pre-transaction availability check for undoSparkActionBatch. */
export function assertSparkActionBatchUndoable<
  T extends ServerStatementsBase<any>,
>(
  s: T,
  opts: SparkActionBatchUndoOpts,
) {
  s.if(sql`not exists (${sparkActionBatchTransactions(opts)})`, (s) => {
    s.throwError(
      sql.lit`These Spark changes are no longer available to undo.`,
    );
  });
}

/** Transaction body of undoSparkActionBatch; the caller owns start/commit. */
export function undoSparkActionBatchInTransaction<
  T extends ServerStatementsBase<any>,
>(
  s: T,
  opts: SparkActionBatchUndoOpts,
) {
  undoSparkTransactions(
    s,
    sparkActionBatchTransactions(opts),
    sql`
    select action_name, result_json from db.spark_action_log
    where spark_conversation_id = ${opts.conversationId}
      and execution_event_id = ${opts.executionEventId}
      and status = 'executed' and (${opts.actionFilter})
      and transaction_id is not null
  `,
  );
  s.modify(sql`
    update db.spark_action_log
    set status = 'undone'
    where spark_conversation_id = ${opts.conversationId}
      and execution_event_id = ${opts.executionEventId}
      and status in ('approved', 'executed')
      and (${opts.actionFilter})
      and transaction_id is not null
  `);
  s.modify(sql`
    insert into db.spark_agent_events (
      spark_agent_id, type, content, action_id, created_at
    ) values (
      ${
    opts.agentId ?? sql`(select spark_agent_id
        from db.spark_agent_events
        where id = ${opts.executionEventId})`
  },
      'action_undone', 'Undone: Spark changes', ${opts.actionId}, now()
    )
  `);
}

/** Undo one receipt inside the caller's authorized transaction. */
export function undoSparkActionReceipt<T extends ServerStatementsBase<any>>(
  s: T,
  receipt: { id: Sql; transactionId: Sql; result: Sql },
) {
  s.defScalar(
    "undo_transaction",
    sparkActionReceiptTransaction(receipt),
  );
  s.if(
    sql`undo_transaction is null`,
    (s) => s.throwError(sql.lit`The transaction receipt is unavailable.`),
  );
  undoSparkTransactions(
    s,
    sql`select undo_transaction as tx_id`,
    sql`
    select action_name, ${receipt.result} as result_json
    from db.spark_action_log where id = ${receipt.id}
  `,
  );
  s.modify(
    sql`update db.spark_action_log set status = 'undone', transaction_id = undo_transaction,
    result_json = ${receipt.result} where id = ${receipt.id}`,
  );
}

/** The reserved envelope retains arbitrary action results across failed Undo attempts. */
export function sparkActionUndoResult(result: Sql): Sql {
  return sql`case when ${result} ? '__spark_undo_failure' then ${result}->'__spark_undo_failure'->'result' else ${result} end`;
}

/**
 * Removes rows derived in later transactions (for example by reactors) from
 * rows the undone transactions inserted, so Undo can delete those rows. It
 * runs in its own transaction because Undo must be its transaction's first
 * write; such rows must be regenerable, since the Undo can still fail after
 * they are removed.
 */
export type SparkUndoPreparation = (
  s: ServerStatementsBase<any>,
  transactions: Sql,
) => void;

const undoPreparations: SparkUndoPreparation[] = [];

/** Runs `preparation` before every Spark Undo of the selected transactions. */
export function registerSparkUndoPreparation(
  preparation: SparkUndoPreparation,
) {
  undoPreparations.push(preparation);
}

/**
 * Runs the registered preparations for `transactions` (a query with a tx_id
 * column of authorized receipts) in their own transaction. Call it before
 * starting the transaction that undoes them.
 */
export function prepareSparkUndo<T extends ServerStatementsBase<any>>(
  s: T,
  transactions: Sql,
) {
  if (undoPreparations.length === 0) return;
  s.startTransaction();
  // Preparations read the transaction ids from a local table: evaluating the
  // selection inside their queries repeats it for every scanned row.
  s.block((s) => {
    s.defTable(
      "spark_undo_preparation_transactions",
      sql`select tx_id from (${transactions}) undone`,
    );
    for (const preparation of undoPreparations) {
      preparation(
        s,
        sql`select tx_id from spark_undo_preparation_transactions`,
      );
    }
  });
  s.commitTransaction();
}

/** The receipt's transaction, as undoSparkActionReceipt resolves it. */
export function sparkActionReceiptTransaction(receipt: {
  id: Sql;
  transactionId: Sql;
}): Sql {
  return sql`coalesce(${receipt.transactionId},
    (select tx_id from db.spark_action_log__versions where record_id = ${receipt.id}
      and spark_action_log__status = 'executed' and spark_action_log__status__set order by tx_id limit 1))`;
}

/** Restore business data and validate invariants before the caller commits Undo. */
export function undoSparkTransactions<T extends ServerStatementsBase<any>>(
  s: T,
  transactions: Sql,
  receipts: Sql,
) {
  // A block scopes the frozen receipts so one procedure can undo repeatedly.
  s.block((s) => {
    // Undo can restore/remove receipt rows too; freeze their identities first.
    s.defScalar(
      "undo_validation_receipts",
      sql`(select json_agg(json_build_object('action',action_name,'result',result_json)) from (${receipts}) receipts)`,
    );
    s.undoTransactions(transactions);
    s.callStoredProcedure("spark_validate_transaction_undo", {
      inputScalars: { undo_receipts: sql`undo_validation_receipts` },
    });
  });
}
