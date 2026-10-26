import type { Sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";

export interface MaintenanceReportingOptions {
  reportPermission: string;
  managePermission: string;
  reportHref: (issue: Sql) => Sql;
  /**
   Offer "I already fixed it" on new reports; once sent, the reporter goes
   straight to the report to close it out (see MaintenanceBlock fieldCloseOut).
   */
  fixedOnTheSpot?: boolean;
  /** Runs in the submitting transaction after a report creates a new item. */
  onReportCreated?: (
    s: GeneralServerStatements,
    report: { itemId: Sql; actorId: Sql },
  ) => void;
}
