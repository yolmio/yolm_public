import type { Sql } from "std/sql_utils";

/** Identity and optional native evidence destination for a Spark function. */
export interface SparkFunctionContext {
  sysUserId: Sql;
  /** Absent for MCP; never create native chat records to obtain this context. */
  nativeExecution?: { eventId: Sql; agentId: Sql };
}
