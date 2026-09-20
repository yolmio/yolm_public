import {
  GeneralServerStatements,
  type GeneralServerStatementsOrFn,
} from "./statements.ts";
import { system } from "./system.tsx";

/**
 * Registers a scheduled procedure that delegates to a stored procedure.
 *
 * Splits a scheduled job into two registrations: the actual work is
 * declared as a stored procedure (so it can also be invoked manually for
 * debugging or backfill) and the schedule entry calls into it. The
 * resulting `*_impl` stored procedure is named after the schedule unless
 * you override `storedName`.
 *
 * @param props.name           Name shown in the schedule listing.
 * @param props.schedule       Cron expression(s); pass an array to register
 *                             multiple firing rules.
 * @param props.description    Optional human-readable description.
 * @param props.storedName     Name for the underlying stored procedure
 *                             (defaults to `${name}_impl`).
 * @param props.procedure      Body to execute on each firing.
 *
 * @example
 * import { storedScheduledProc } from "std/scheduled_utils";
 * import { sql } from "std/sql_utils";
 *
 * storedScheduledProc({
 *   name: "expire_pending_invites",
 *   schedule: "0 0 * * * *", // hourly
 *   procedure: (s) => {
 *     s.startTransaction();
 *     s.modify(sql`update db.invites
 *                  set status = 'expired'
 *                  where status = 'pending'
 *                    and created_at < now() - interval '7 days'`);
 *     s.commitTransaction();
 *   },
 * });
 */
export function storedScheduledProc(props: {
  name: string;
  schedule: string | string[];
  description?: string;
  storedName?: string;
  procedure: GeneralServerStatementsOrFn;
}) {
  const storedName = props.storedName ?? `${props.name}_impl`;

  system.storedProcedure({
    name: storedName,
    transaction: "standalone",
    procedure: props.procedure,
  });

  system.scheduledProcedures.push({
    name: props.name,
    description: props.description,
    schedules: typeof props.schedule === "string"
      ? [props.schedule]
      : props.schedule,
    procedure: GeneralServerStatements.normalizeToArray((s) => {
      s.callStoredProcedure(storedName);
    }),
  });
}
