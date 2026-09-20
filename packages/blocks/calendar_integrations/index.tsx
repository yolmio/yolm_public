import type {
  AnyExpr,
  BooleanExpr,
  NumericExpr,
  Sql,
} from "../../std/sql_utils";
import type { DomStatements, IServerBaseStatements } from "std/statements";
import type { Style } from "std/style_types";
import type { App, Block } from "std/system";
import type { Node } from "std/ui";

export interface GetCalendarEventsForDayOpts {
  atTimezone: Sql;
  day: AnyExpr;
}

export interface GetCalendarEventsForRangeOpts {
  atTimezone: Sql;
  start: AnyExpr;
  end: AnyExpr;
  filterUserId: (userId: Sql) => Sql;
}

export interface AddToCalendarOpts {
  /** Stable logical creation identity, reused on retries (Outlook transactionId). */
  creationId?: Sql;
  calendarId: NumericExpr;
  summary: Sql;
  start: Sql;
  end: Sql;
  eventIdScalar: string;
  description?: Sql;
  attendees?: {
    email: Sql;
    name: Sql;
  };
}

export interface AddToPrimaryUserCalendarOpts {
  /** Stable logical creation identity, reused on retries. */
  creationId?: Sql;
  userId: NumericExpr;
  summary: Sql;
  start: Sql;
  end: Sql;
  eventIdScalar: string;
  description?: Sql;
  attendees?: {
    email: Sql;
    name: Sql;
  };
}

export interface UpdateToCalendarOpts {
  calendarId: NumericExpr;
  eventId: Sql;
  summary: Sql;
  start: Sql;
  end: Sql;
  description?: Sql;
  attendees?: {
    email: Sql;
    name: Sql;
  };
}

export interface UpdatePrimaryUserCalendarEventOpts {
  userId: NumericExpr;
  eventId: Sql;
  summary: Sql;
  start: Sql;
  end: Sql;
  description?: Sql;
  attendees?: {
    email: Sql;
    name: Sql;
  };
}

export interface DeletePrimaryUserCalendarEventOpts {
  userId: NumericExpr;
  eventId: Sql;
}

export interface DeleteFromCalendarOpts {
  calendarId: NumericExpr;
  eventId: Sql;
}

export interface DeleteAccountOpts {
  accountId: NumericExpr;
}

export interface RefreshCalendarsForUserOpts {
  userId: NumericExpr;
}
interface ListEventsOpts {
  defaultTimeZone: AnyExpr;
  accountId: AnyExpr;
  /**
         Creates a table (default: calendar_event) with the following fields:

         See https://developers.google.com/calendar/api/v3/reference/events for more details.

         - id: string
         - summary: string
         - start_date: date
         - start_time: timestamptz
         - start_time_zone: sys_timezone
         - end_date: date
         - end_time: timestamptz
         - end_time_zone: sys_timezone
         - status: string 'tentative' | 'confirmed' | 'cancelled'
         - event_type: string 'default' | 'focusTime' | 'fromGmail' | 'outOfOffice' | 'workingLocation' | 'birthday'
         */
  eventsTable?: string;
  /**accountId
         Name of record with info like page token and sync token. Defaults to "list_response".

         Has fields:
         - next_sync_token
         - next_page_token
         */

  pageToken?: Sql;
  timeMin?: Sql;
  timeMax?: Sql;
  /**
         Whether to expand recurring events into instances and only return single one-off events.
         */
  singleEvents?: BooleanExpr;
  /**
         The calendar ID to list events for. Defaults to the primary calendar.
         */
  calendarId?: Sql;
  /**
     Event types to return. Optional. This parameter can be repeated multiple times to return events of different types.
     If unset, returns all event types.

      Acceptable values are:
      "birthday": Special all-day events with an annual recurrence.
      "default": Regular events.
      "focusTime": Focus time events.
      "fromGmail": Events from Gmail.
      "outOfOffice": Out of office events.
      "workingLocation": Working location events.
     */
  eventTypes?: Sql[] | Sql;
}

export interface ListAllOpts
  extends Omit<ListEventsOpts, "responseRecord" | "pageToken"> {
  /**
       Define a scalar that will hold the final sync token after the loop.

       Defaults to "final_sync_token".
       */
  finalSyncTokenScalar?: string;
}

export interface CalendarIntegration extends Block {
  /**
       Get calendar events

       Defines a table with the provided name, and populates it with calendar events for the user.
       Columns:
       - start_time: timestamp
       - end_time: timestamp
       - sys_user_id: numeric
       */
  getCalendarEventsForDay(opts: GetCalendarEventsForDayOpts): Sql;
  getCalendarEventsForRange(opts: GetCalendarEventsForRangeOpts): Sql;
  /**
   * Returns one row per active account with `sys_user_id`,
   * `has_conflict_calendar`, and `has_add_calendar` columns. Scheduling uses
   * this provider-owned shape for its optional host-configuration watchdog.
   */
  getSchedulingConditionStatus?(): Sql;
  /**
       Add an event to this calendar
       */
  addToCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: AddToCalendarOpts,
  ): void;
  addToPrimaryUserCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: AddToPrimaryUserCalendarOpts,
  ): void;
  updatePrimaryUserCalendarEvent<T extends IServerBaseStatements>(
    s: T,
    opts: UpdatePrimaryUserCalendarEventOpts,
  ): void;
  deletePrimaryUserCalendarEvent<T extends IServerBaseStatements>(
    s: T,
    opts: DeletePrimaryUserCalendarEventOpts,
  ): void;
  enqueueReconciliationJobs<T extends IServerBaseStatements>(
    s: T,
    opts: {
      forUsers: Sql;
    },
  ): void;
  watchCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
    },
  ): void;
  stopWatchCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
    },
  ): void;
  deleteEventsFromOldCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
    },
  ): void;

  /**
       Should add an api route that handles the oauth callback, this will be added on the same domain
       as the integrations page
       */
  addOauthRedirect(app: App): void;

  integrationName: string;
  navigateToOauth: (s: DomStatements) => void;
  icon: (props: { sx?: Style; className?: string }) => Node;
  accountDisplay: Node;
  deleteAccount<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteAccountOpts,
  ): void;
  accountTable: string;
  calendarTable: string;
  isActiveAccount: BooleanExpr;
  adminStatus: Node;
}

export type CalendarIntegrationConstructor = new (
  ...args: any[]
) => CalendarIntegration;
