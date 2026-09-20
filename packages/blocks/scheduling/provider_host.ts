import type { SchedulingBlock } from "blocks/scheduling";
import type { IServerBaseStatements } from "std/statements";
import type { NumericExpr, Sql } from "std/sql_utils";
import type { Block } from "std/system";

/** Scheduling callbacks consumed by calendar providers, independent of event model. */
export interface SchedulingProviderHost extends Block {
  enqueueBackgroundTask: SchedulingBlock["enqueueBackgroundTask"];
  runtimeAppointments?: {
    addAppointmentToCalendar<T extends IServerBaseStatements>(
      s: T,
      opts: { appointmentId: NumericExpr },
    ): void;
    updateAppointmentInCalendar<T extends IServerBaseStatements>(
      s: T,
      opts: { appointmentId: NumericExpr },
    ): void;
    getEffectiveMeetingLocation(opts: {
      eventTypeId: NumericExpr;
      userId: NumericExpr;
    }): Sql;
  };
  opts: Pick<
    SchedulingBlock["opts"],
    "meetingIntegrations" | "calendarIntegrations"
  >;
}
