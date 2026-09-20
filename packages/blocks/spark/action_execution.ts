import { type Sql, sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import type { CapabilityAction } from "./agent";
import { sparkActionFailureResult } from "./action_errors.ts";

/** Shared immediate action transaction. Callers supply receipt identity and native events. */
export function executeSparkReversibleAction(
  s: GeneralServerStatements,
  opts: {
    action: CapabilityAction;
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
      opts.action.procedure?.(s);
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
