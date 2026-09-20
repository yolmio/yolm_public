import { type Sql, sql } from "std/sql_utils";
import type { ServerStatementsBase } from "std/statements";

export function undoSparkActionBatch<T extends ServerStatementsBase<any>>(
  s: T,
  opts: {
    conversationId: Sql;
    executionEventId: Sql;
    actionId: Sql;
    agentId?: Sql;
    actionFilter: Sql;
  },
) {
  const transactions = sql`
    select transaction_id as tx_id
    from db.spark_action_log
    where spark_conversation_id = ${opts.conversationId}
      and execution_event_id = ${opts.executionEventId}
      and status = 'executed'
      and (${opts.actionFilter})
      and transaction_id is not null
  `;
  s.if(sql`not exists (${transactions})`, (s) => {
    s.throwError(
      sql.lit`These Spark changes are no longer available to undo.`,
    );
  });
  s.startTransaction();
  s.undoTransactions(transactions);
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
  s.commitTransaction();
}

/** Undo one receipt inside the caller's authorized transaction. */
export function undoSparkActionReceipt<T extends ServerStatementsBase<any>>(
  s: T,
  receipt: { id: Sql; transactionId: Sql; result: Sql },
) {
  s.defScalar(
    "undo_transaction",
    sql`coalesce(${receipt.transactionId},
    (select tx_id from db.spark_action_log__versions where record_id = ${receipt.id}
      and spark_action_log__status = 'executed' and spark_action_log__status__set order by tx_id limit 1))`,
  );
  s.if(
    sql`undo_transaction is null`,
    (s) => s.throwError(sql.lit`The transaction receipt is unavailable.`),
  );
  s.undoTransactions(sql`select undo_transaction as tx_id`);
  s.modify(
    sql`update db.spark_action_log set status = 'undone', transaction_id = undo_transaction,
    result_json = ${receipt.result} where id = ${receipt.id}`,
  );
}

/** The reserved envelope retains arbitrary action results across failed Undo attempts. */
export function sparkActionUndoResult(result: Sql): Sql {
  return sql`case when ${result} ? '__spark_undo_failure' then ${result}->'__spark_undo_failure'->'result' else ${result} end`;
}
