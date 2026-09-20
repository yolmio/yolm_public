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
