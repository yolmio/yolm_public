import type { GeneralServerStatements } from "std/statements";
import { sql } from "std/sql_utils";

const validationTag = "spark.action_validation";

/** Only application-authored text is public. Never pass server/service errors. */
export function throwSparkActionValidationError(
  s: GeneralServerStatements,
  message: string,
) {
  s.throwError(sql.lit(message), sql.lit(validationTag));
}

export function sparkActionFailureResult(errorRecord: string) {
  return sql`json_build_object('error', case
    when ${sql.ref(errorRecord, "description")} = ${sql.lit(validationTag)}
      then left(${sql.ref(errorRecord, "message")}, 1000)
    else 'Action failed; no changes were committed.'
  end)::string`;
}

/**
 * Rethrows a caught error for a reversible action. Messages from `throwError`
 * statements and declared table checks are application-authored, so they
 * stay visible; every other error keeps the generic rollback message.
 */
export function rethrowSparkActionError(
  s: GeneralServerStatements,
  errorRecord: string,
) {
  s.throwError(
    sql`${sql.ref(errorRecord, "message")}`,
    sql`case when cast(${sql.ref(errorRecord, "type")} as string)
        in ('thrown_error', 'check_violation')
      then ${sql.lit(validationTag)} end`,
  );
}
