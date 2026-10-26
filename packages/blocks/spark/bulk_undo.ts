import { prepareSparkUndo, undoSparkTransactions } from "./action_undo";
import { type Sql, sql } from "std/sql_utils";
import { system } from "std/system";
import type { ServerStatementsBase } from "std/statements";
import {
  type RegisterReactorsOpts,
  sparkInterruptedExecutionStart,
} from "./agent";
import { sparkSessionActionAllowed } from "./action_permissions";

export type SparkUndoOptions = Pick<
  RegisterReactorsOpts,
  "capabilities" | "accessPermission"
>;

export function reversibleSparkAction(opts: SparkUndoOptions, name: Sql): Sql {
  const names = opts.capabilities.flatMap((cap) =>
    (cap.actions ?? [])
      .filter((action) => action.mode === "reversible")
      .map((action) => `${cap.name}.${action.name}`)
  );
  return sql`${
    sql.lit(JSON.stringify(names))
  }::json @> json_build_array(${name})`;
}

interface SparkUndoInput {
  session: Sql;
  user: Sql;
  selection: Sql;
  executingAgent?: Sql;
  execute: boolean;
  grantedCapabilities?: Sql;
}

/** UI and MCP use the same runtime authorization and atomic transaction boundary. */
export function sparkBulkUndo<T extends ServerStatementsBase<any>>(
  s: T,
  input: SparkUndoInput,
  resultScalar: string,
) {
  s.callStoredProcedure(
    input.execute ? "spark_undo_selection" : "spark_preview_undo",
    {
      prewarm: "never",
      inputScalars: {
        undo_session_id: input.session,
        undo_user_id: input.user,
        undo_selection_json: input.selection,
        undo_executing_agent_id: input.executingAgent ?? sql`null::bigint`,
        undo_granted_capabilities: input.grantedCapabilities ?? sql`null::json`,
      },
      outputScalars: { undo_result: resultScalar },
    },
  );
}

export function registerSparkBulkUndo(opts: SparkUndoOptions) {
  for (const execute of [false, true]) {
    system.storedProcedure({
      name: execute ? "spark_undo_selection" : "spark_preview_undo",
      transaction: "standalone",
      inputScalars: [
        { name: "undo_session_id", type: "BigInt" },
        { name: "undo_user_id", type: "BigInt" },
        { name: "undo_selection_json", type: "Json" },
        { name: "undo_executing_agent_id", type: "BigInt" },
        { name: "undo_granted_capabilities", type: "Json" },
      ],
      outputScalars: [{ name: "undo_result", type: "Json" }],
      procedure: (s) => {
        const result = performSparkBulkUndo(s, opts, {
          session: sql`undo_session_id`,
          user: sql`undo_user_id`,
          selection: sql`undo_selection_json`,
          executingAgent: sql`undo_executing_agent_id`,
          grantedCapabilities: sql`undo_granted_capabilities`,
          execute,
        });
        s.setScalar("undo_result", result);
      },
    });
  }
}

/** Freeze and validate the exact receipt set before touching business data. */
function performSparkBulkUndo<T extends ServerStatementsBase<any>>(
  s: T,
  opts: SparkUndoOptions,
  input: SparkUndoInput,
) {
  if (input.execute) {
    // The selected receipts of this owner's session that are still executed.
    prepareSparkUndo(
      s,
      sql`select log.transaction_id as tx_id
      from db.spark_action_log log
      join db.spark_conversations conversation
        on conversation.id = log.spark_conversation_id
      where conversation.id = ${input.session}
        and conversation.sys_user_id = ${input.user}
        and log.status = 'executed' and log.transaction_id is not null
        and exists(select 1 from json.array_each(${input.selection}) chosen
          where try_cast(chosen.value->>'receiptId' as bigint) = log.id
            and try_cast(chosen.value->>'transactionId' as bigint)
              = log.transaction_id)`,
    );
    s.startTransaction();
  }
  s.if(
    sql`not exists(select 1 from db.spark_conversations where id = ${input.session}
    and sys_user_id = ${input.user} and status = 'active')`,
    (s) =>
      s.throwError(
        sql.lit`Only the owner of an active session can undo its changes.`,
      ),
  );
  // Other running work in the session blocks Undo; the caller's own execution
  // does not. An external execution cut off by a server restart stays
  // 'executing', so one whose latest execution started before the
  // interruption window no longer counts.
  s.if(
    sql`exists(select 1 from db.spark_agents agent where agent.spark_conversation_id = ${input.session}
    and (agent.id is distinct from ${input.executingAgent ?? sql`null::bigint`})
    and (coalesce(agent.execution_mode, 'native') != 'external'
      or coalesce((select max(event.created_at) from db.spark_agent_events event
        where event.spark_agent_id = agent.id
          and event.type in ('execute_script_success', 'execute_script_error'))
        >= ${sparkInterruptedExecutionStart}, true))
    and agent.status in ('awaiting_plan', 'awaiting_execute', 'executing', 'failed_retrying_plan'))`,
    (s) =>
      s.throwError(
        sql
          .lit`Wait for this session's running work to finish before undoing changes.`,
      ),
  );
  s.if(
    sql`coalesce(json_typeof(${input.selection}), '') != 'array'`,
    (s) => s.throwError(sql.lit`Select completed reversible actions to undo.`),
  );
  s.if(
    sql`exists(select 1 from json.array_each(${input.selection}) where
    coalesce(json_typeof(value->'receiptId'), '') != 'number'
    or not regex.is_match(value->>'receiptId', '^[0-9]+$')
    ${
      input.execute
        ? sql`or coalesce(json_typeof(value->'transactionId'), '') != 'number' or not regex.is_match(value->>'transactionId', '^[0-9]+$')`
        : sql``
    })`,
    (s) =>
      s.throwError(
        sql.lit`Receipt and transaction IDs must be nonnegative integers.`,
      ),
  );
  s.defTable(
    "undo_requested",
    sql`select try_cast(value->>'receiptId' as bigint) as id,
    try_cast(value->>'transactionId' as bigint) as expected_tx from json.array_each(${input.selection})`,
  );
  s.if(
    sql`(select count(*) from undo_requested) not between 1 and 1000
    or (select count(*) from undo_requested) != (select count(distinct id) from undo_requested)`,
    (s) => s.throwError(sql.lit`Select between 1 and 1,000 distinct actions.`),
  );
  s.defTable(
    "undo_selected",
    sql`select r.id, r.action_name, r.result_json, r.execution_event_id,
    coalesce(r.transaction_id, (select tx_id from db.spark_action_log__versions
      where record_id = r.id and spark_action_log__status = 'executed'
      and spark_action_log__status__set order by tx_id limit 1)) as tx_id
    from db.spark_action_log r join undo_requested requested on requested.id = r.id
    where r.spark_conversation_id = ${input.session} and r.status = 'executed'
    and (${reversibleSparkAction(opts, sql`r.action_name`)})
    and (${
      input.grantedCapabilities
        ? sql`(${input.grantedCapabilities} is null or ${input.grantedCapabilities} @> json_build_array(split_part(r.action_name, '.', 1)))`
        : sql`true`
    })
    and (${
      sparkSessionActionAllowed(
        opts,
        input.user,
        input.session,
        sql`r.action_name`,
      )
    })`,
  );
  s.if(
    sql`(select count(*) from undo_selected) != (select count(*) from undo_requested)
    or exists(select 1 from undo_selected where tx_id is null)`,
    (s) =>
      s.throwError(
        sql
          .lit`Selection changed, is unavailable, or contains an action you cannot undo. Refresh and select again.`,
      ),
  );
  if (input.execute) {
    s.if(
      sql`exists(select 1 from undo_selected chosen join undo_requested requested on requested.id = chosen.id
      where requested.expected_tx is distinct from chosen.tx_id)`,
      (s) =>
        s.throwError(
          sql.lit`The undo preview is stale. Preview these changes again.`,
        ),
    );
    // One engine operation rechecks conflicts and reverses the whole selected set.
    undoSparkTransactions(
      s,
      sql`select distinct tx_id from undo_selected`,
      sql`select action_name, result_json from undo_selected`,
    );
    s.modify(sql`update db.spark_action_log set status = 'undone',
      transaction_id = chosen.tx_id, result_json = chosen.result_json
      from undo_selected chosen where spark_action_log.id = chosen.id`);
    s.modify(
      sql`insert into db.spark_agent_events (spark_agent_id, type, content, action_id)
      select e.spark_agent_id, 'action_undone', 'Undone: selected Spark changes', chosen.id
      from undo_selected chosen join db.spark_agent_events e on e.id = chosen.execution_event_id`,
    );
    s.commitTransaction();
    return sql`json_build_object('status', 'undone', 'count', (select count(*) from undo_selected))`;
  } else {
    s.analyzeUndoTransactions(
      sql`select distinct tx_id from undo_selected`,
      "undo_analysis",
    );
    return sql`json_build_object(
      'ready', not exists(select 1 from undo_analysis where status != 'Ready'),
      'receipts', (select json_array_agg(json_build_object('receiptId',id,'transactionId',tx_id) order by id) from undo_selected),
      'analysis', (select json_array_agg(json_build_object('transactionId',tx_id,'status',status,
        'affectedRecords',affected_records,'reason',reason,'blockingTable',blocking_table,
        'blockingRecordId',blocking_record_id)) from undo_analysis))`;
  }
}
