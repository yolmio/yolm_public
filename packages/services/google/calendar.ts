import { GoogleAuth } from "services/google/auth";
import type { Oauth2TokenOpts } from "services/google/auth";
import { queryParamsString } from "std/services";
import { sql } from "../../std/sql_utils";
import type {
  AnyExpr,
  BooleanExpr,
  NumericExpr,
  Sql,
} from "../../std/sql_utils";
import type { HelperProcField, IServerBaseStatements } from "std/statements";
import { sourceMap } from "std/utils";

/**
 * Google Calendar API v3 client. Bundles authenticated REST helpers
 * for events and calendars; uses a {@link GoogleAuth} instance to mint
 * OAuth bearer tokens from managed credentials.
 *
 * Typical usage:
 *
 * ```ts
 * const calendar = new GoogleCalendar();
 * calendar.events.list(s, { calendarId: sql`'primary'`, ... });
 * ```
 */
export class GoogleCalendar {
  /** Events REST helpers (list / get / insert / patch / delete). */
  events: GoogleCalendarEvents;
  /** Auth helper used to mint OAuth tokens. */
  auth = new GoogleAuth();
  /** Calendars REST helpers (list / patch). */
  calendars: GoogleCalendarCalendars;

  constructor() {
    this.events = new GoogleCalendarEvents(this.auth);
    this.calendars = new GoogleCalendarCalendars(this.auth);
  }
}

export interface CalendarListOpts extends Oauth2TokenOpts {
  /**
       Defaults to true.
       */
  showDeleted?: BooleanExpr;
  /**
       Defaults to 2500.
       */
  maxResults?: NumericExpr;
  /**
       Table to save the calendar list to. Defaults to "calendar".

       Has fields:
       - google_calendar_id: string
       - summary: string
       - primary: boolean
       - supports_notifications: boolean
       - timezone: string
       */
  calendarTable?: string;
}

export class GoogleCalendarCalendars {
  #calendarFields: HelperProcField[] = [
    {
      name: "google_calendar_id",
      type: { type: "String", maxLength: 255 },
    },
    { name: "summary", type: { type: "String", maxLength: 255 } },
    { name: "primary", type: { type: "Bool" } },
    { name: "supports_notifications", type: { type: "Bool" } },
    { name: "timezone", type: { type: "String", maxLength: 100 } },
    { name: "scheduling_system", type: { type: "String", maxLength: 200 } },
  ];

  constructor(protected auth: GoogleAuth) {}

  list<T extends IServerBaseStatements>(s: T, opts: CalendarListOpts) {
    s.defTable(opts.calendarTable ?? "calendar", {
      fields: this.#calendarFields,
    });
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: sql.lit`GET`,
        uri: sql.concat(
          sql.lit`https://www.googleapis.com/calendar/v3/users/me/calendarList`,
          sql.lit`?`,
          queryParamsString({
            showDeleted: true,
            maxResults: 2500,
          }),
        ),
        receiveJson: "calendar_list",
      },
      afterRequest: (s) => {
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.throwError(sql`'Failed to get calendar list: ' || response.status`);
        });
        const calendarTable = opts.calendarTable ?? "calendar";
        s.modify(sql`
          insert into ${
          sql.ref(calendarTable)
        } (google_calendar_id, summary, primary, supports_notifications, timezone, scheduling_system)
          select
            value->>'id' as google_calendar_id,
            value->>'summary' as summary,
            (value->>'primary') is not null as primary,
            (value->>'notificationSettings') is not null as supports_notifications,
            value->>'timeZone' as timezone,
            null as scheduling_system
          from json.array_each(calendar_list->'items') as value
        `);
      },
    });
  }
}

interface ListEventsOpts extends Oauth2TokenOpts {
  defaultTimeZone: AnyExpr;
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
  /**
       Name of record with info like page token and sync token. Defaults to "list_response".

       Has fields:
       - next_sync_token
       - next_page_token
       */
  responseRecord?: string;
  syncToken?: Sql;
  pageToken?: Sql;
  timeMin?: Sql;
  timeMax?: Sql;
  showDeleted?: BooleanExpr;
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
interface ListAllOpts
  extends Omit<ListEventsOpts, "responseRecord" | "pageToken"> {
  /**
       Define a scalar that will hold the final sync token after the loop.

       Defaults to "final_sync_token".
       */
  finalSyncTokenScalar?: string;
  /** Retry an invalid incremental token once as a full sync using timeMin/timeMax. */
  recoverInvalidSyncToken?: boolean;
  fullSyncScalar?: string;
}

interface WatchOpts extends Oauth2TokenOpts {
  /**
       Unique identifier for the notification channel, will be put in the header X-Goog-Channel-ID.
       */
  id: Sql;
  /**
       Webhook URL that will receive notifications.
       */
  address: Sql;
  /**
       Time to live for the notification channel in seconds.
       */
  ttl?: NumericExpr;
  calendarId: Sql;
  /**
       Name of record to save the response to. Defaults to "watch_response".

       Has fields:
       - id: string
       - resource_id: string
       - resource_uri: string
       - token: string
       - expiration: timestamp
       */
  responseRecord?: string;
}

interface StopWatchOpts extends Oauth2TokenOpts {
  /**
       The ID of the notification channel to stop
       */
  id: Sql;
  /**
       The resource ID obtained from the watch response
       */
  resourceId: Sql;
}

export interface AddToCalendarOpts extends Oauth2TokenOpts {
  calendarId?: Sql;
  summary: Sql;
  start: Sql;
  end: Sql;
  timeZone?: Sql;
  eventIdScalar?: string;
  description?: Sql;
  attendees?: EventAttendee[];
}

interface EventAttendee {
  email: Sql;
  displayName?: Sql;
  optional?: BooleanExpr;
  responseStatus?: Sql; // "needsAction", "declined", "tentative", "accepted"
  comment?: Sql;
}

export interface AddToCalendarWithMeetOpts extends AddToCalendarOpts {
  attendees?: EventAttendee[];
  sendUpdates?: Sql; // "all", "externalOnly", "none"
  conferenceDataRecord?: string;
}

export interface GetEventConferenceDataOpts extends Oauth2TokenOpts {
  calendarId?: Sql;
  eventId: Sql;
  conferenceDataRecord?: string;
}

export class GoogleCalendarEvents {
  #eventFields: HelperProcField[] = [
    { name: "summary", type: "String" },
    { name: "start_date", type: "Date" },
    { name: "start_date_time", type: "String" },
    { name: "start_time_zone", type: "String" },
    { name: "end_date", type: "Date" },
    { name: "end_date_time", type: "String" },
    { name: "end_time_zone", type: "String" },
    { name: "event_type", type: "String" },
    { name: "id", type: "String" },
    { name: "status", type: "String" },
    { name: "scheduling_system", type: "String" },
    { name: "transparency", type: "String" },
    { name: "created", type: "String" },
    { name: "updated", type: "String" },
    { name: "attendees", type: "Json" },
  ];

  constructor(private auth: GoogleAuth) {}

  list = <T extends IServerBaseStatements>(s: T, opts: ListEventsOpts) => {
    s.defTable(opts.eventsTable ?? "calendar_event", {
      fields: this.#eventFields,
    });
    s.defRecord(opts.responseRecord ?? "list_response", {
      fields: [
        { name: "next_sync_token", type: "String" },
        { name: "next_page_token", type: "String" },
      ],
    });
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: "GET",
        uri: sql.concat(
          sql.lit`https://www.googleapis.com/calendar/v3/calendars/`,
          opts.calendarId
            ? sql`uri.encode_component(${opts.calendarId})`
            : sql.lit`primary`,
          sql.lit`/events`,
          sql.lit`?`,
          queryParamsString({
            syncToken: opts.syncToken,
            pageToken: opts.pageToken,
            singleEvents: opts.singleEvents,
            timeMin: opts.timeMin,
            timeMax: opts.timeMax,
            showDeleted: opts.showDeleted,
            maxResults: 2500,
          }),
        ),
        receiveJson: "json_response",
      },
      afterRequest: (s) => {
        this.insertEventResponseLogs(s, {
          response: sql`json_response`,
          calendarId: opts.calendarId,
        });
        s.if(sql`response.status != 200`, (s) => {
          this.insertEventErrorLogs(s, {
            response: sql`json_response`,
            calendarId: opts.calendarId,
          });
          s.if(sql`response.status = 410`, (s) => {
            s.throwError(sql.lit`Google Calendar full sync required`);
          });
          s.throwError(sql`'Failed to get events: ' || response.status`);
        });
        const responseRecord = opts.responseRecord ?? "list_response";
        s.modify(sql`
      insert into ${sql.ref(responseRecord)} (next_sync_token, next_page_token)
      values (json_response->>'nextSyncToken', json_response->>'nextPageToken')
    `);
        const eventsTable = opts.eventsTable ?? "calendar_event";
        s.modify(sql`
      insert into ${sql.ref(eventsTable)}
      select
        (value->>'id') as id,
        (value->>'summary') as summary,
        (value->>'status') as status,
        (value->>'eventType') as event_type,
        try_cast(((value->'start')->>'date') as date) as start_date,
        ((value->'start')->>'dateTime') as start_date_time,
        ((value->'start')->>'timeZone') as start_time_zone,
        try_cast(((value->'end')->>'date') as date) as end_date,
        ((value->'end')->>'dateTime') as end_date_time,
        ((value->'end')->>'timeZone') as end_time_zone,
        (value->'extendedProperties'->'shared'->>'schedulingSystem') as scheduling_system,
        (value->>'transparency') as transparency,
        (value->>'created') as created,
        (value->>'updated') as updated,
        (value->'attendees') as attendees
      from json.array_each(json_response -> 'items') as value
    `);
      },
    });
  };

  @sourceMap
  listAll<T extends IServerBaseStatements>(s: T, opts: ListAllOpts) {
    const eventsTable = opts.eventsTable ?? "calendar_event";
    s.defTable(eventsTable, {
      fields: this.#eventFields,
    });
    const finalSyncTokenScalar = opts.finalSyncTokenScalar ??
      "final_sync_token";
    s.defScalar(finalSyncTokenScalar, {
      type: "String",
      allowNoRead: true,
    });
    const fullSyncScalar = opts.fullSyncScalar ?? "calendar_full_sync";
    s.defScalar(fullSyncScalar, {
      expr: sql`${opts.syncToken ?? sql.null} is null`,
      allowNoRead: true,
    });
    s.block((s) => {
      s.defScalar("next_page_token", { type: "String" });
      s.loop((s) => {
        s.try({
          body: (s) => {
            this.list(s, {
              ...opts,
              eventsTable: "tmp_event",
              responseRecord: "tmp_response",
              // Every incremental page must use the ORIGINAL sync token.
              syncToken: sql`case when ${
                sql.ref(fullSyncScalar)
              } then null else ${opts.syncToken ?? sql.null} end`,
              timeMin: sql`case when ${sql.ref(fullSyncScalar)} then ${
                opts.timeMin ?? sql.null
              } else null end`,
              timeMax: sql`case when ${sql.ref(fullSyncScalar)} then ${
                opts.timeMax ?? sql.null
              } else null end`,
              pageToken: sql`next_page_token`,
            });
            s.modify(sql`insert into ${sql.ref(eventsTable)}
              select * from tmp_event where transparency != 'transparent' or transparency is null`);
            s.setScalar(
              finalSyncTokenScalar,
              sql`tmp_response.next_sync_token`,
            );
            s.setScalar("next_page_token", sql`tmp_response.next_page_token`);
            s.if(
              sql`next_page_token is null or next_page_token = ''`,
              (s) => s.break(),
            );
          },
          errorName: "calendar_list_error",
          catch: (s) => {
            s.if(
              sql`${!!opts.recoverInvalidSyncToken} and not ${
                sql.ref(fullSyncScalar)
              }
                and calendar_list_error.message = 'Google Calendar full sync required'`,
              (s) => {
                s.setScalar(fullSyncScalar, sql`true`);
                s.setScalar("next_page_token", sql.null);
                s.setScalar(finalSyncTokenScalar, sql.null);
                s.modify(sql`delete from ${sql.ref(eventsTable)}`);
              },
              (s) =>
                s.throwError(
                  sql`calendar_list_error.message`,
                  sql`calendar_list_error.description`,
                ),
            );
          },
        });
      });
    });
  }

  insertEventResponseLogs<T extends IServerBaseStatements>(
    _s: T,
    _opts: { response: Sql; calendarId?: Sql },
  ) {
  }

  insertEventErrorLogs<T extends IServerBaseStatements>(
    s: T,
    opts: { response: Sql; calendarId?: Sql },
  ) {
    s.startTransaction();
    s.modify(
      sql`insert into scheduling_integration_errors (calendar_id, error, type, timestamp, raw_response) values (${opts.calendarId}, 'Failed to get events: ' || response.status, 'google', now(), ${opts.response})`,
    );
    s.commitTransaction();
  }

  @sourceMap
  watch<T extends IServerBaseStatements>(s: T, opts: WatchOpts) {
    s.defRecord(opts.responseRecord ?? "watch_response", {
      fields: [
        { name: "id", type: "String" },
        { name: "resource_id", type: "String" },
        { name: "resource_uri", type: "String" },
        { name: "token", type: "String" },
        { name: "expiration", type: "TimestampTz" },
      ],
    });
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: "POST",
        uri: sql.concat(
          sql.lit`https://www.googleapis.com/calendar/v3/calendars/`,
          opts.calendarId
            ? sql`uri.encode_component(${opts.calendarId})`
            : sql.lit`primary`,
          sql.lit`/events/watch`,
        ),
        json: sql.jsonBuildObject({
          id: opts.id,
          type: sql.lit`web_hook`,
          address: opts.address,
          params: opts.ttl ? { ttl: opts.ttl } : undefined,
        }),
        receiveJson: "subscription_response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.throwError(sql`'Failed to watch calendar: ' || response.status`);
        });
        const responseRecord = opts.responseRecord ?? "watch_response";
        s.modify(sql`
      insert into ${
          sql.ref(responseRecord)
        } (id, resource_id, resource_uri, token, expiration)
      values (
        subscription_response->>'id',
        subscription_response->>'resourceId',
        subscription_response->>'resourceUri',
        subscription_response->>'token',
        date.add(second, (subscription_response->>'expiration')::bigint / 1000, cast('1970-01-01T00:00:00Z' as timestamptz))
      )
    `);
      },
    });
  }

  @sourceMap
  create<T extends IServerBaseStatements>(s: T, opts: AddToCalendarOpts) {
    s.defScalar(opts.eventIdScalar ?? "created_event_id", {
      type: "String",
    });
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: sql.lit`POST`,
        uri: sql.concat(
          sql.lit`https://www.googleapis.com/calendar/v3/calendars/`,
          opts.calendarId ?? sql.lit`primary`,
          //Added sendNotifications to the request to ensure that notifications are sent.
          sql.lit`/events?sendNotifications=true`,
        ),
        json: sql.jsonBuildObject({
          summary: opts.summary,
          description: opts.description,
          start: sql.jsonBuildObject({
            dateTime: sql`${opts.start}`,
            timeZone: sql`date.part(timezone, ${opts.start})`,
          }),
          sendUpdates: "all",
          end: sql.jsonBuildObject({
            dateTime: sql`${opts.end}`,
            timeZone: sql`date.part(timezone, ${opts.end})`,
          }),
          //for now I just added a field to the event to indicate that it was created by Yolm
          extendedProperties: sql.jsonBuildObject({
            shared: {
              schedulingSystem: sql.lit`Yolm`,
            },
          }),
          attendees: opts.attendees?.map((attendee) =>
            sql.jsonBuildObject({
              email: attendee.email,
              displayName: attendee.displayName,
              responseStatus: attendee.responseStatus,
            })
          ),
        }),
        receiveJson: "event_result",
      },
      afterRequest: (s) => {
        s.setScalar(
          opts.eventIdScalar ?? "created_event_id",
          sql`event_result->>'id'`,
        );
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.throwError(
            sql`'Failed to create event: ' || (event_result->'error'->>'message')`,
          );
        });
        s.if(sql`event_result->'id' is null`, (s) => {
          s.throwError(
            sql`'Failed to create event: ' || (event_result->'error'->>'message')`,
          );
        });
      },
    });
  }

  @sourceMap
  createWithMeet<T extends IServerBaseStatements>(
    s: T,
    opts: AddToCalendarWithMeetOpts,
  ) {
    s.defScalar(opts.eventIdScalar ?? "created_event_id", {
      type: "String",
    });
    s.defRecord(opts.conferenceDataRecord ?? "conference_data", {
      fields: [
        { name: "meet_link", type: { type: "String", maxLength: 2000 } },
        { name: "conference_id", type: { type: "String", maxLength: 100 } },
        { name: "status_code", type: { type: "String", maxLength: 20 } },
      ],
    });
    const sendUpdates = opts.sendUpdates ?? sql.lit`all`;
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: sql.lit`POST`,
        uri: sql.concat(
          sql.lit`https://www.googleapis.com/calendar/v3/calendars/`,
          opts.calendarId ?? sql.lit`primary`,
          sql.lit`/events?`,
          queryParamsString({
            conferenceDataVersion: 1,
            sendUpdates: sendUpdates,
          }),
        ),
        json: sql.jsonBuildObject({
          summary: opts.summary,
          description: opts.description,
          start: sql.jsonBuildObject({
            dateTime: sql`${opts.start}`,
            timeZone: sql`date.part(timezone, ${opts.start})`,
          }),
          end: sql.jsonBuildObject({
            dateTime: sql`${opts.end}`,
            timeZone: sql`date.part(timezone, ${opts.end})`,
          }),
          attendees: opts.attendees?.map((attendee) =>
            sql.jsonBuildObject({
              email: attendee.email,
              displayName: attendee.displayName,
              optional: attendee.optional,
              responseStatus: attendee.responseStatus,
              comment: attendee.comment,
            })
          ),
          conferenceData: sql.jsonBuildObject({
            createRequest: sql.jsonBuildObject({
              requestId: sql`random.uuid()`,
              conferenceSolutionKey: sql.jsonBuildObject({
                type: sql.lit`hangoutsMeet`,
              }),
            }),
          }),
        }),
        receiveJson: "event_result",
      },
      afterRequest: (s) => {
        s.setScalar(
          opts.eventIdScalar ?? "created_event_id",
          sql`event_result->>'id'`,
        );
        s.modify(sql`
          insert into ${sql.ref(opts.conferenceDataRecord ?? "conference_data")}
          (meet_link, conference_id, status_code)
          values (
            event_result->'conferenceData'->>'uri',
            event_result->'conferenceData'->>'conferenceId',
            event_result->'conferenceData'->'createRequest'->'status'->>'statusCode'
          )
        `);
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.throwError(
            sql`'Failed to create event: ' || (event_result->'error'->>'message')`,
          );
        });
        s.if(sql`event_result->'id' is null`, (s) => {
          s.throwError(
            sql`'Failed to create event: ' || (event_result->'error'->>'message')`,
          );
        });
      },
    });
  }

  @sourceMap
  getConferenceData<T extends IServerBaseStatements>(
    s: T,
    opts: GetEventConferenceDataOpts,
  ) {
    s.defRecord(opts.conferenceDataRecord ?? "conference_data", {
      fields: [
        { name: "conference_id", type: { type: "String", maxLength: 100 } },
        { name: "status_code", type: { type: "String", maxLength: 20 } },
      ],
    });
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: sql.lit`GET`,
        uri: sql.concat(
          sql.lit`https://www.googleapis.com/calendar/v3/calendars/`,
          opts.calendarId
            ? sql`uri.encode_component(${opts.calendarId})`
            : sql.lit`primary`,
          sql.lit`/events/`,
          sql`uri.encode_component(${opts.eventId})`,
        ),
        receiveJson: "event_result",
      },
      afterRequest: (s) => {
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.throwError(
            sql`'Failed to get event: ' || (event_result->'error'->>'message')`,
          );
        });
        s.modify(sql`
          insert into ${sql.ref(opts.conferenceDataRecord ?? "conference_data")}
          (conference_id, status_code)
          values (
            event_result->'conferenceData'->>'conferenceId',
            event_result->'conferenceData'->'createRequest'->'status'->>'statusCode'
          )
        `);
      },
    });
  }

  @sourceMap
  update<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId?: Sql;
      summary: Sql;
      start: Sql;
      end: Sql;
      timeZone?: Sql;
      eventId: Sql;
      description?: Sql;
      attendees?: EventAttendee[];
    } & Oauth2TokenOpts,
  ) {
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: sql.lit`PUT`,
        uri: sql.concat(
          sql.lit`https://www.googleapis.com/calendar/v3/calendars/`,
          opts.calendarId
            ? sql`uri.encode_component(${opts.calendarId})`
            : sql.lit`primary`,
          sql.lit`/events/`,
          sql`uri.encode_component(${opts.eventId})`,
          sql.lit`?sendNotifications=true`,
        ),
        json: sql.jsonBuildObject({
          summary: opts.summary,
          description: opts.description,
          start: sql.jsonBuildObject({
            dateTime: sql`${opts.start}`,
            timeZone: sql`date.part(timezone, ${opts.start})`,
          }),
          sendUpdates: sql.lit`all`,
          end: sql.jsonBuildObject({
            dateTime: sql`${opts.end}`,
            timeZone: sql`date.part(timezone, ${opts.end})`,
          }),
          // Yolm marker to keep the event identifiable to reconciliation.
          extendedProperties: sql.jsonBuildObject({
            shared: {
              schedulingSystem: sql.lit`Yolm`,
            },
          }),
          attendees: opts.attendees?.map((attendee) =>
            sql.jsonBuildObject({
              email: attendee.email,
              displayName: attendee.displayName,
              responseStatus: attendee.responseStatus,
            })
          ),
        }),
        receiveJson: "event_result",
      },
      afterRequest: (s) => {
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.throwError(
            sql`'Failed to update event: ' || (event_result->'error'->>'message')`,
          );
        });
      },
    });
  }

  @sourceMap
  delete<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId?: Sql;
      eventId: Sql;
    } & Oauth2TokenOpts,
  ) {
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: sql.lit`DELETE`,
        uri: sql.concat(
          sql.lit`https://www.googleapis.com/calendar/v3/calendars/`,
          opts.calendarId ?? sql.lit`primary`,
          sql.lit`/events/`,
          opts.eventId,
        ),
        receiveText: "event_result",
      },
      afterRequest: (s) => {
        s.if(
          sql`response.status not between 200 and 299 and response.status != 404`,
          (s) => {
            s.throwError(
              sql`concat('Failed to delete event: HTTP ', response.status::string, coalesce(' ' || event_result, ''))`,
            );
          },
        );
      },
    });
  }

  stopWatch<T extends IServerBaseStatements>(s: T, opts: StopWatchOpts) {
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: sql.lit`POST`,
        uri: sql.lit`https://www.googleapis.com/calendar/v3/channels/stop`,
        json: sql.jsonBuildObject({
          id: opts.id,
          resourceId: opts.resourceId,
        }),
        receiveText: "response_text",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response_text is null`, () => {});
        s.if(sql`response.status != 204 and response.status != 404`, (s) => {
          s.throwError(
            sql`'Failed to stop notification channel: ' || response.status`,
          );
        });
      },
    });
  }
}
