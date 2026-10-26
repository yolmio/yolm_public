import type { Sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";

/**
 * Read-only domain computation called directly from a Spark script. Publish
 * JSON with the normal `s.return(value)` statement-builder operation.
 * A function must be read-only/idempotent; model writes as actions instead.
 */
export interface SparkFunction {
  name: string;
  description: string;
  /** TypeScript type shown to the agent for this function's input. */
  inputType?: string;
  /** Maximum wall time while JavaScript waits for this function. */
  timeoutMs?: number;
  procedure: (
    s: GeneralServerStatements,
    context: SparkFunctionContext,
  ) => void;
}

/** Identity and optional native evidence destination for a Spark function. */
export interface SparkFunctionContext {
  sysUserId: Sql;
  /** Absent for MCP; never create native chat records to obtain this context. */
  nativeExecution?: { eventId: Sql; agentId: Sql };
}
