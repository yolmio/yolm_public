import { type Sql, sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import { system } from "std/system";
import type { CapabilityAction } from "./agent";
import { sparkActionFailureResult } from "./action_errors.ts";

/** Shared immediate action transaction. Callers supply receipt identity and native events. */
export function executeSparkReversibleAction(
  s: GeneralServerStatements,
  opts: {
    action: CapabilityAction;
    /** Stored procedure that runs `action.procedure` (see registerSparkActionProcedures). */
    storedProcedureName?: string;
    receiptId: Sql;
    cacheTransactionId?: boolean;
    beforeMutation?: (s: GeneralServerStatements) => void;
    afterRollback?: (s: GeneralServerStatements) => void;
    beforeFailure?: (s: GeneralServerStatements) => void;
    event?: (s: GeneralServerStatements, failed: boolean) => void;
  },
) {
  s.defScalar("action_result", { type: "String" });
  if (opts.cacheTransactionId) {
    s.defScalar("act_transaction_id", { type: "BigInt" });
  }
  s.try({
    body: (s) => {
      opts.action.preflight?.(s);
      s.startTransaction();
      opts.beforeMutation?.(s);
      if (opts.action.procedure) {
        if (opts.storedProcedureName && sparkActionUsesProcedure(opts.action)) {
          callSparkActionProcedure(s, opts.storedProcedureName);
        } else {
          opts.action.procedure(s);
        }
      }
      opts.event?.(s, false);
      s.commitTransaction(
        opts.cacheTransactionId ? "act_transaction_id" : undefined,
      );
    },
    errorName: "act_execution_error",
    catch: (s) => {
      // Keep this first: the compiler restores the caught error after rollback.
      s.rollbackTransaction();
      opts.afterRollback?.(s);
      s.setScalar(
        "action_result",
        sparkActionFailureResult("act_execution_error"),
      );
      s.startTransaction();
      opts.beforeFailure?.(s);
      s.modify(
        sql`update db.spark_action_log set status = 'failed',
          input_json = action_input,
          transaction_id = null,
          result_json = action_result::json
        where id = ${opts.receiptId} and status = 'approved'`,
      );
      opts.event?.(s, true);
      s.commitTransaction();
    },
  });
  if (opts.cacheTransactionId) {
    s.if(sql`act_transaction_id is not null`, (s) => {
      s.startTransaction();
      s.modify(
        sql`update db.spark_action_log set status = 'executed',
          transaction_id = act_transaction_id,
          result_json = coalesce(try_cast(action_result as json), '{}'::json)
        where id = ${opts.receiptId} and status = 'approved'`,
      );
      s.commitTransaction();
    });
  } else {
    s.startTransaction();
    s.modify(
      sql`update db.spark_action_log set status = 'executed',
        result_json = coalesce(try_cast(action_result as json), '{}'::json)
      where id = ${opts.receiptId} and status = 'approved'`,
    );
    s.commitTransaction();
  }
}

/** Actions whose body runs as a stored procedure: no preflight state to share. */
export function sparkActionUsesProcedure(action: CapabilityAction) {
  return action.procedure !== undefined && action.preflight === undefined;
}

/** Stored procedure name for a capability action's `procedure`. */
export function sparkActionProcedureName(qualifiedName: string) {
  return `spark_action_${qualifiedName.replace(/[^a-z0-9_]/gi, "_")}`;
}

/**
 * Registers each capability action body as a caller stored procedure. Action
 * bodies read `action_input` and `action_sys_user_id` and set `action_result`
 * inside the executor's transaction; separate procedures keep the Spark
 * executor and action reactor small enough to compile quickly.
 */
export function registerSparkActionProcedures(
  actions: readonly (CapabilityAction & { qualifiedName: string })[],
) {
  system.storedProcedure({
    name: "spark_validate_transaction_undo",
    transaction: "caller",
    inputScalars: [{ name: "undo_receipts", type: "Json" }],
    procedure: (s) => {
      for (const action of actions) {
        if (action.mode !== "reversible" || !action.validateUndo) continue;
        const validate = action.validateUndo;
        s.forEachQuery(
          sql`select value->'result' as result from json.array_each(undo_receipts) where value->>'action'=${
            sql.lit(action.qualifiedName)
          }`,
          "undo_receipt",
          (s) => validate(s, sql`undo_receipt.result`),
        );
      }
    },
  });
  const names = new Set<string>();
  for (const action of actions) {
    const procedure = action.procedure;
    if (!procedure || !sparkActionUsesProcedure(action)) continue;
    const name = sparkActionProcedureName(action.qualifiedName);
    if (names.has(name)) {
      throw new Error(`Spark action procedure name "${name}" is not unique.`);
    }
    names.add(name);
    system.storedProcedure({
      name,
      transaction: "caller",
      inputScalars: [
        { name: "action_input", type: "Json" },
        { name: "action_sys_user_id", type: "BigInt" },
      ],
      outputScalars: [{ name: "action_result", type: "String" }],
      procedure,
    });
  }
}

export function callSparkActionProcedure(
  s: GeneralServerStatements,
  storedProcedureName: string,
) {
  s.callStoredProcedure(storedProcedureName, {
    prewarm: "never",
    inputScalars: {
      action_input: sql`action_input`,
      action_sys_user_id: sql`action_sys_user_id`,
    },
    outputScalars: { action_result: "action_result" },
  });
}
