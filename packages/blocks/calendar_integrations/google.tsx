import type {
  CalendarIntegration,
  GetCalendarEventsForRangeOpts,
  RefreshCalendarsForUserOpts,
} from "blocks/calendar_integrations";
import { DevLogBlock } from "blocks/dev_log";
import type { SchedulingProviderHost } from "blocks/scheduling/provider_host";
import { Alert } from "components/alert";
import { GoogleCalendarIcon } from "components/icons/google_calendar";
import type { Oauth2TokenOpts } from "services/google/auth";
import { GoogleCalendar } from "services/google/calendar";
import type {
  AddToCalendarWithMeetOpts,
  GetEventConferenceDataOpts,
} from "services/google/calendar";
import { AuthApiICtxKey } from "std/ictx";
import {
  isLocalhostHost,
  localhostAwareScheme,
  queryParamsString,
} from "std/services";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "../../std/sql_utils";
import type {
  DomStatements,
  EndpointStatements,
  IServerBaseStatements,
} from "std/statements";
import type { Style } from "std/style_types";
import { system } from "std/system";
import { getCapabilities } from "std/yolm_gen_api";
import type { App } from "std/system";
import { Show, useOptionalICtx } from "std/ui";

import type { QueryParam } from "std/yom";
import type {
  AddToCalendarOpts,
  AddToPrimaryUserCalendarOpts,
  DeleteAccountOpts,
  DeleteFromCalendarOpts,
  DeletePrimaryUserCalendarEventOpts,
  GetCalendarEventsForDayOpts,
  UpdatePrimaryUserCalendarEventOpts,
  UpdateToCalendarOpts,
} from "./index";
import { OutlookCalendarIntegration } from "./outlook";

interface GoogleCalendarIntegrationOptions {
  notificationDomain: string | string[];
  provider: string;
  scopes: Sql;
  adminDebugToken?: string;
  extensions?: GoogleCalendarIntegrationExtensions;
}

/**
 * Optional server-statement hooks that fire at key points of the Google
 * Calendar watch/notification lifecycle. Pass via the integration's
 * `extensions` option to run extra logic (logging, side effects) without
 * forking the block.
 */
export interface GoogleCalendarIntegrationExtensions {
  /** Runs before registering a watch channel; receives the calendar and account records. */
  beforeWatch?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { calendarId: AnyExpr; calendarRecord: Sql; accountRecord: Sql },
  ) => void;
  /** Runs after Google returns the watch response, before it is persisted. */
  afterWatch?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { calendarId: AnyExpr; responseRecord: Sql },
  ) => void;
  /** Runs in the catch branch when registering a watch channel fails. */
  onWatchError?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { calendarId: AnyExpr; errorRecord: Sql },
  ) => void;
  /** Runs when processing an inbound change notification fails. */
  onNotificationError?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { errorRecord: Sql },
  ) => void;
  /** Runs for each inbound push notification received from Google. */
  onNotificationReceived?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { channelId: Sql; resourceState: Sql },
  ) => void;
}

/**
 * Calendar integration that syncs a user's Google Calendar(s) with the
 * scheduling system: manages per-user Google OAuth accounts, mirrors events
 * into local tables, registers push-notification watch channels, and writes
 * Yolm appointments back to Google.
 *
 * Implements {@link CalendarIntegration}. Pass an instance to the
 * calendar-integrations registration in `core.tsx` to enable Google Calendar.
 *
 * @category Block
 */
export class GoogleCalendarIntegration implements CalendarIntegration {
  blockName = "GoogleCalendarIntegration";
  blockDisplayName = "Google Calendar";
  externalServiceOptions = [
    { optionKey: "read_events", optionLabel: "Read calendar events" },
    {
      optionKey: "modify_events",
      optionLabel: "Create, update & delete events",
    },
    { optionKey: "watch_changes", optionLabel: "Watch for calendar changes" },
  ];
  #googleCalendar: GoogleCalendar;
  #caps = getCapabilities()?.blocks?.GoogleCalendarIntegration;

  accountTable = "user_google_accounts";
  calendarTable = "user_google_calendars";
  integrationName = "Google Calendar";
  icon = ({ sx, className }: { sx?: Style; className?: string }) => (
    <GoogleCalendarIcon
      sx={sx}
      className={className}
    />
  );
  accountDisplay = <>{sql`account.email`}</>;

  constructor(private opts: GoogleCalendarIntegrationOptions) {
    this.#googleCalendar = new GoogleCalendar();
  }

  getSchedulingConditionStatus(): Sql {
    return sql`select
      account.sys_user_id,
      exists(
        select 1 from db.user_google_calendars calendar
        where calendar.user_google_account_id = account.id
          and calendar.check_for_conflicts
      ) as has_conflict_calendar,
      exists(
        select 1 from db.user_google_calendars calendar
        where calendar.user_google_account_id = account.id
          and calendar.add_to_calendar
      ) as has_add_calendar
    from db.user_google_accounts account
    where account.status = 'active'`;
  }

  initialize() {
    const db = system.db;
    system.enum_({
      name: "google_connection_status",
      values: ["active", "reauth_required"],
    });

    db.table("user_google_accounts", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.autoCompact();
      table.fk("sys_users").notNull();
      table.bigUint("credential_id").notNull().unique();
      table.string("email", 500).notNull();
      table.string("provider_subject", 500);
      table.string("granted_scopes", 1000);
      table.enum("status", "google_connection_status")
        .notNull()
        .default(sql`'active'`);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
    });
    db.table("user_google_calendars", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.autoCompact();
      table.fk("user_google_accounts").notNull();
      table.string("google_calendar_id", 500).notNull();
      table.string("summary", 500);
      table.bool("supports_notifications").notNull().default(false);
      table.string("sync_token", 1000);
      table.enum("timezone", "sys_timezone").notNull();
      table.bool("check_for_conflicts").notNull().default(false);
      table.bool("add_to_calendar").notNull().default(false);
      // notification channel
      table.string("notification_channel_id", 500);
      table.string("notification_resource_id", 500);
      table.timestampUtc("notification_expiration");
      table.recordDisplayNameFields(["summary"]);
    });
    db.table("user_google_calendar_events", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.autoCompact();
      table.fk("user_google_calendars").notNull();
      table.string("summary", 500).notNull();
      table.timestampTz("start_time").notNull();
      table.timestampTz("end_time").notNull();
      // Google event ids can appear on overlapping calendars; all lookup paths
      // must include user_google_calendar_id.
      table.string("google_event_id", 500).collation("Binary").notNull();
      table.unique(["user_google_calendar_id", "google_event_id"]);
    });
    db.table("deleted_yolm_google_events", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.string("google_event_id", 500).notNull();
      table.timestampUtc("deleted_at").notNull();
    });
    db.table("user_google_calendar_error_logs", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("user_google_calendars");
      table.fk("sys_users");
      table.string("operation", 200).notNull();
      table.string("error_type", 500);
      table.string("error_message", 5000);
      table.string("error_description", 5000);
      table.json("raw_error");
      table.timestampUtc("logged_at").notNull().default(sql`now()`);
      table.ttlFrom("logged_at", sql`date.add(week, -1, now())`);
    });
    db.table("google_calendar_reconciliation_jobs", (table) => {
      table.sampleData({ skipSampleData: true });
      table.autoCompact();
      table.fk("user_google_accounts").notNull();
      table.fk("user_google_calendars").notNull();
      table.timestampUtc("enqueued_at").notNull().default(sql`now()`);
      table.ttlFrom("enqueued_at", sql`date.add(day, -2, now())`);
    });
  }

  isActiveAccount: BooleanExpr = sql`status = 'active'`;

  adminStatus = (
    <Show when={sql`account.status = 'reauth_required'`}>
      <Alert variant="soft" color="danger" startIcon="ErrorOutlined">
        Re-authentication is required for this account.
      </Alert>
    </Show>
  );

  #getOauthOpts = (credentialId: AnyExpr): Oauth2TokenOpts => {
    return {
      managedOauthCredentialId: sql`${credentialId}`,
      onReauthRequired: (s) => {
        s.startTransaction();
        s.modify(
          sql`update user_google_accounts set status = 'reauth_required'
          where credential_id = ${credentialId}`,
        );
        s.commitTransaction();
      },
    };
  };

  #markReauthOnTokenError<T extends IServerBaseStatements>(
    s: T,
    opts: { errorMessage: Sql; accountWhere: Sql },
  ): void {
    s.if(
      sql`(lower(coalesce(${opts.errorMessage}, '')) like '%token refresh%'
           or lower(coalesce(${opts.errorMessage}, '')) like '%token exchange%')
          and lower(coalesce(${opts.errorMessage}, '')) not like '%internal oauth request failed%'`,
      (s) => {
        s.startTransaction();
        s.modify(
          sql`update user_google_accounts set status = 'reauth_required'
            where ${opts.accountWhere}`,
        );
        s.commitTransaction();
      },
    );
  }

  watchCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
    },
  ) {
    s.callStoredProcedure("google_calendar_watch", {
      inputScalars: { p_calendar_id: opts.calendarId },
    });
  }

  private watchCalendarStatements<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
    },
  ) {
    s.block((s) => {
      s.defRecord(
        "db_calendar",
        sql`select * from user_google_calendars where id = ${opts.calendarId}`,
      );
      s.defRecord(
        "account",
        sql`select * from user_google_accounts where id = db_calendar.user_google_account_id`,
      );
      this.opts.extensions?.beforeWatch?.(s, {
        calendarId: opts.calendarId,
        calendarRecord: sql.ref("db_calendar"),
        accountRecord: sql.ref("account"),
      });
      s.if(
        sql`account.status = 'active'`,
        (s) => {
          s.defScalar("channel_id", sql`random.uuid()`);
          s.defScalar("watch_persisted", sql`false`);
          const notificationDomain = Array.isArray(this.opts.notificationDomain)
            ? this.opts.notificationDomain[0]
            : this.opts.notificationDomain;
          s.try({
            body: (s) => {
              this.#googleCalendar.events.watch(s, {
                calendarId: sql`db_calendar.google_calendar_id`,
                id: sql`channel_id`,
                address: sql
                  .lit`https://${notificationDomain}/api/google-calendar-notifications`,
                ...this.#getOauthOpts(sql`account.credential_id`),
                optIn: !!this.#caps?.watch_changes,
              });
              this.opts.extensions?.afterWatch?.(s, {
                calendarId: opts.calendarId,
                responseRecord: sql.ref("watch_response"),
              });
              s.if(
                sql`watch_response.id is null or watch_response.resource_id is null or watch_response.expiration is null`,
                (s) => {
                  s.throwError(
                    sql`concat('google watch response missing required fields: id=', coalesce(watch_response.id, 'NULL'), ' resource_id=', coalesce(watch_response.resource_id, 'NULL'), ' expiration=', coalesce(watch_response.expiration::string, 'NULL'))`,
                  );
                },
              );
              s.startTransaction();
              s.modify(
                sql`update user_google_calendars
          set notification_channel_id = watch_response.id,
              notification_resource_id = watch_response.resource_id,
              notification_expiration = watch_response.expiration
          where id = ${opts.calendarId}
            and user_google_account_id = account.id
            and check_for_conflicts
            and notification_channel_id is null
            and notification_resource_id is null
            and notification_expiration is null
            and exists (
              select 1
              from user_google_accounts current_account
              where current_account.id = account.id
                and current_account.credential_id = account.credential_id
                and current_account.status = 'active'
            )`,
              );
              s.commitTransaction();
              s.setScalar(
                "watch_persisted",
                sql`exists (
                  select 1
                  from user_google_calendars
                  where id = ${opts.calendarId}
                    and notification_channel_id = watch_response.id
                    and notification_resource_id = watch_response.resource_id
                )`,
              );
              s.unless(sql`watch_persisted`, (s) => {
                this.stopWatchChannel(s, {
                  calendarId: opts.calendarId,
                  channelId: sql`watch_response.id`,
                  resourceId: sql`watch_response.resource_id`,
                  credentialId: sql`account.credential_id`,
                  operation: "cleanup_stop_watch",
                });
              });
            },
            errorName: "watch_error",
            catch: (s) => {
              this.opts.extensions?.onWatchError?.(s, {
                calendarId: opts.calendarId,
                errorRecord: sql.ref("watch_error"),
              });
              if (system.hasBlockNamed("SchedulingBlock")) {
                s.startTransaction();
                s.modify(
                  sql`insert into scheduling_google_integration_logs (operation, success, error_message, logged_at)
                  values ('watch', false, concat(watch_error.type, ': ', coalesce(watch_error.message, '')), now())`,
                );
                s.commitTransaction();
              }
              s.startTransaction();
              s.modify(
                sql`insert into user_google_calendar_error_logs (user_google_calendar_id, operation, error_type, error_message, error_description)
              values (${opts.calendarId}, 'watch', watch_error.type, watch_error.message, watch_error.description)`,
              );
              s.commitTransaction();
              this.#markReauthOnTokenError(s, {
                errorMessage: sql`watch_error.message`,
                accountWhere: sql`credential_id = account.credential_id`,
              });
            },
          });
        },
        () => {},
      );
    });
  }

  private stopWatchChannel<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
      channelId: Sql;
      resourceId: Sql;
      credentialId: AnyExpr;
      successScalar?: string;
      operation?: "stop_watch" | "cleanup_stop_watch";
    },
  ) {
    const operation = opts.operation ?? "stop_watch";
    s.try({
      body: (s) => {
        this.#googleCalendar.events.stopWatch(s, {
          id: opts.channelId,
          resourceId: opts.resourceId,
          ...this.#getOauthOpts(opts.credentialId),
          optIn: !!this.#caps?.watch_changes,
        });
        if (opts.successScalar) {
          s.setScalar(opts.successScalar, sql`true`);
        }
      },
      errorName: "stop_watch_error",
      catch: (s) => {
        if (system.hasBlockNamed("SchedulingBlock")) {
          s.startTransaction();
          s.modify(
            sql`insert into scheduling_google_integration_logs (operation, success, error_message, logged_at)
              values (${
              sql.lit(operation)
            }, false, concat(stop_watch_error.type, ': ', coalesce(stop_watch_error.message, '')), now())`,
          );
          s.commitTransaction();
        }
        s.startTransaction();
        s.modify(
          sql`insert into user_google_calendar_error_logs (user_google_calendar_id, operation, error_type, error_message, error_description)
            values (${opts.calendarId}, ${
            sql.lit(operation)
          }, stop_watch_error.type, stop_watch_error.message, stop_watch_error.description)`,
        );
        s.commitTransaction();
        this.#markReauthOnTokenError(s, {
          errorMessage: sql`stop_watch_error.message`,
          accountWhere: sql`credential_id = ${opts.credentialId}`,
        });
      },
    });
  }

  stopWatchCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
      preserveSyncToken?: boolean;
    },
  ) {
    s.callStoredProcedure(
      opts.preserveSyncToken
        ? "google_calendar_stop_watch_preserve"
        : "google_calendar_stop_watch",
      {
        inputScalars: { p_calendar_id: opts.calendarId },
      },
    );
  }

  private stopWatchCalendarStatements<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
      preserveSyncToken?: boolean;
    },
  ) {
    s.block((s) => {
      s.defRecord(
        "db_calendar",
        sql`select * from user_google_calendars where id = ${opts.calendarId}`,
      );
      s.defRecord("account", {
        query:
          sql`select * from user_google_accounts where id = db_calendar.user_google_account_id`,
        allowNoRead: true,
      });
      s.if(
        sql`account.status = 'active'
          and db_calendar.notification_channel_id is not null
          and db_calendar.notification_resource_id is not null`,
        (s) => {
          s.defScalar("stop_watch_succeeded", sql`false`);
          this.stopWatchChannel(s, {
            calendarId: opts.calendarId,
            channelId: sql`db_calendar.notification_channel_id`,
            resourceId: sql`db_calendar.notification_resource_id`,
            credentialId: sql`account.credential_id`,
            successScalar: "stop_watch_succeeded",
          });
          s.if(sql`stop_watch_succeeded`, (s) => {
            const clearSyncToken = opts.preserveSyncToken
              ? sql``
              : sql`, sync_token = null`;
            s.startTransaction();
            s.modify(
              sql`update user_google_calendars
      set notification_channel_id = null,
          notification_resource_id = null,
          notification_expiration = null${clearSyncToken}
      where id = ${opts.calendarId}
        and notification_channel_id = db_calendar.notification_channel_id
        and notification_resource_id = db_calendar.notification_resource_id`,
            );
            s.commitTransaction();
          });
        },
      );
    });
  }

  getCalendarEventsForDay(opts: GetCalendarEventsForDayOpts): Sql {
    return sql`
    select
      start_time at time zone ${opts.atTimezone} as start_time,
      end_time at time zone ${opts.atTimezone} as end_time,
      sys_user_id
    from db.user_google_calendar_events
      auto join db.user_google_calendars
      auto join db.user_google_accounts
    where start_time at time zone ${opts.atTimezone} < date.add(day, 1, ${opts.day})
      and end_time at time zone ${opts.atTimezone} > ${opts.day}
      and check_for_conflicts
      and user_google_accounts.status = 'active'
  `;
  }

  getCalendarEventsForRange(opts: GetCalendarEventsForRangeOpts): Sql {
    return sql`
    select
      e.start_time at time zone ${opts.atTimezone} as start_time,
      e.end_time at time zone ${opts.atTimezone} as end_time,
      a.sys_user_id
    from db.user_google_calendar_events e
    join db.user_google_calendars c on e.user_google_calendar_id = c.id
    join (
      select ga.id, ga.sys_user_id
      from db.user_google_accounts ga
      where ${opts.filterUserId(sql`ga.sys_user_id`)}
        and ga.status = 'active'
    ) a on c.user_google_account_id = a.id
    where e.start_time at time zone ${opts.atTimezone} < date.add(day, 1, ${opts.end})
      and e.end_time at time zone ${opts.atTimezone} > ${opts.start}
      and c.check_for_conflicts
  `;
  }

  /**
   * Debug-only: list all events on the given calendar via Google's
   * events.list API (singleEvents=true). Returns into `opts.eventsTable`
   * with the standard listAll fields. Bypasses the local mirror entirely
   * and ignores the `is_yolm_event` filter — use this to verify what
   * Google actually has for a calendar.
   */
  debugListEvents<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarRecord: Sql;
      accountRecord: Sql;
      timeMin: Sql;
      timeMax: Sql;
      eventsTable: string;
    },
  ): void {
    this.#googleCalendar.events.listAll(s, {
      eventsTable: opts.eventsTable,
      defaultTimeZone: sql`${opts.calendarRecord}.timezone`,
      calendarId: sql`${opts.calendarRecord}.google_calendar_id`,
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      singleEvents: true,
      showDeleted: true,
      ...this.#getOauthOpts(sql`${opts.accountRecord}.credential_id`),
      optIn: !!this.#caps?.read_events,
    });
  }

  addToCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: Omit<AddToCalendarOpts, keyof Oauth2TokenOpts>,
  ): void {
    s.defRecord(
      "google_calendar_record",
      sql`select
        google_calendar_id,
        user_google_accounts.credential_id as credential_id,
        user_google_accounts.status as account_status
      from user_google_calendars
      auto join user_google_accounts
      where user_google_calendars.id = ${opts.calendarId}`,
    );
    s.defScalar(opts.eventIdScalar, {
      type: "String",
    });
    s.if(sql`google_calendar_record.account_status = 'active'`, (s) => {
      s.try({
        body: (s) => {
          this.#googleCalendar.events.create(s, {
            calendarId: sql`google_calendar_record.google_calendar_id`,
            summary: opts.summary,
            start: opts.start,
            end: opts.end,
            eventIdScalar: "created_event_id",
            description: opts.description,
            ...(opts.attendees
              ? {
                attendees: [
                  {
                    displayName: opts.attendees.name,
                    email: opts.attendees.email,
                    responseStatus: sql.lit`accepted`,
                  },
                ],
              }
              : {}),
            ...this.#getOauthOpts(
              sql`google_calendar_record.credential_id`,
            ),
            optIn: !!this.#caps?.modify_events,
          });
          s.setScalar(opts.eventIdScalar, sql`created_event_id`);
        },
        errorName: "google_create_err",
        catch: (s) => {
          if (system.hasBlockNamed("SchedulingBlock")) {
            s.startTransaction();
            s.modify(
              sql`insert into scheduling_google_integration_logs (operation, success, error_message, logged_at)
                values ('create', false, concat(google_create_err.type, ': ', coalesce(google_create_err.message, '')), now())`,
            );
            s.commitTransaction();
          }
          this.#markReauthOnTokenError(s, {
            errorMessage: sql`google_create_err.message`,
            accountWhere:
              sql`credential_id = google_calendar_record.credential_id`,
          });
          s.throwError(
            sql`coalesce(google_create_err.message, 'Google Calendar create failed')`,
          );
        },
      });
    });
  }

  addToCalendarWithMeet<T extends IServerBaseStatements>(
    s: T,
    opts:
      & Omit<
        AddToCalendarWithMeetOpts,
        "calendarId" | keyof Oauth2TokenOpts
      >
      & {
        calendarId: AnyExpr;
      },
  ): void {
    s.defRecord(
      "google_calendar_record",
      sql`select
        google_calendar_id,
        user_google_accounts.credential_id as credential_id
      from user_google_calendars
      auto join user_google_accounts
      where user_google_calendars.id = ${opts.calendarId}`,
    );
    s.if(sql`google_calendar_record.credential_id is null`, (s) => {
      s.throwError(
        sql.concat(
          "No managed OAuth credential for calendar ",
          sql`coalesce(${opts.calendarId}::string, 'NULL')`,
        ),
      );
    });
    this.#googleCalendar.events.createWithMeet(s, {
      ...opts,
      calendarId: sql`google_calendar_record.google_calendar_id`,
      ...this.#getOauthOpts(sql`google_calendar_record.credential_id`),
      optIn: !!this.#caps?.modify_events,
    });
  }

  getCalendarEventConferenceData<T extends IServerBaseStatements>(
    s: T,
    opts:
      & Omit<
        GetEventConferenceDataOpts,
        "calendarId" | keyof Oauth2TokenOpts
      >
      & {
        calendarId: AnyExpr;
      },
  ): void {
    s.defRecord(
      "google_calendar_record",
      sql`select
        google_calendar_id,
        user_google_accounts.credential_id as credential_id
      from user_google_calendars
      auto join user_google_accounts
      where user_google_calendars.id = ${opts.calendarId}`,
    );
    s.if(sql`google_calendar_record.credential_id is null`, (s) => {
      s.throwError(
        sql.concat(
          "No managed OAuth credential for calendar ",
          sql`coalesce(${opts.calendarId}::string, 'NULL')`,
        ),
      );
    });
    this.#googleCalendar.events.getConferenceData(s, {
      ...opts,
      calendarId: sql`google_calendar_record.google_calendar_id`,
      ...this.#getOauthOpts(sql`google_calendar_record.credential_id`),
      optIn: !!this.#caps?.modify_events,
    });
  }

  addToPrimaryUserCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: AddToPrimaryUserCalendarOpts,
  ): void {
    s.defScalar(
      "user_google_calendar_id",
      sql`(select user_google_calendars.id
      from user_google_calendars
        auto join user_google_accounts
      where sys_user_id = ${opts.userId} and add_to_calendar)`,
    );
    this.addToCalendar(s, {
      calendarId: sql`user_google_calendar_id`,
      summary: opts.summary,
      start: opts.start,
      end: opts.end,
      eventIdScalar: opts.eventIdScalar,
      description: opts.description,
      attendees: opts.attendees,
    });
  }

  updateToCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: UpdateToCalendarOpts,
  ): void {
    s.defRecord(
      "google_calendar_record",
      sql`select
        google_calendar_id,
        user_google_accounts.credential_id as credential_id
      from user_google_calendars
      auto join user_google_accounts
      where user_google_calendars.id = ${opts.calendarId}`,
    );
    s.try({
      body: (s) => {
        this.#googleCalendar.events.update(s, {
          calendarId: sql`google_calendar_record.google_calendar_id`,
          eventId: opts.eventId,
          summary: opts.summary,
          start: opts.start,
          end: opts.end,
          description: opts.description,
          ...(opts.attendees
            ? {
              attendees: [
                {
                  displayName: opts.attendees.name,
                  email: opts.attendees.email,
                  responseStatus: sql.lit`accepted`,
                },
              ],
            }
            : {}),
          ...this.#getOauthOpts(
            sql`google_calendar_record.credential_id`,
          ),
          optIn: !!this.#caps?.modify_events,
        });
      },
      errorName: "google_update_err",
      catch: (s) => {
        if (system.hasBlockNamed("SchedulingBlock")) {
          s.startTransaction();
          s.modify(
            sql`insert into scheduling_google_integration_logs (operation, success, error_message, logged_at)
              values ('update', false, concat(google_update_err.type, ': ', coalesce(google_update_err.message, '')), now())`,
          );
          s.commitTransaction();
        }
        this.#markReauthOnTokenError(s, {
          errorMessage: sql`google_update_err.message`,
          accountWhere:
            sql`credential_id = google_calendar_record.credential_id`,
        });
        s.throwError(
          sql`coalesce(google_update_err.message, 'Google Calendar update failed')`,
        );
      },
    });
  }

  updatePrimaryUserCalendarEvent<T extends IServerBaseStatements>(
    s: T,
    opts: UpdatePrimaryUserCalendarEventOpts,
  ): void {
    s.defScalar(
      "user_google_calendar_id",
      sql`(select user_google_calendars.id
      from user_google_calendars
        auto join user_google_accounts
      where sys_user_id = ${opts.userId} and add_to_calendar)`,
    );
    this.updateToCalendar(s, {
      calendarId: sql`user_google_calendar_id`,
      eventId: opts.eventId,
      summary: opts.summary,
      start: opts.start,
      end: opts.end,
      description: opts.description,
      attendees: opts.attendees,
    });
  }

  deleteFromCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteFromCalendarOpts,
  ) {
    s.defRecord(
      "google_calendar_record",
      sql`select
        google_calendar_id,
        user_google_accounts.credential_id as credential_id
      from user_google_calendars
      auto join user_google_accounts
      where user_google_calendars.id = ${opts.calendarId}`,
    );
    s.try({
      body: (s) => {
        this.#googleCalendar.events.delete(s, {
          calendarId: sql`google_calendar_record.google_calendar_id`,
          eventId: opts.eventId,
          ...this.#getOauthOpts(sql`google_calendar_record.credential_id`),
          optIn: !!this.#caps?.modify_events,
        });
      },
      errorName: "google_delete_err",
      catch: (s) => {
        if (system.hasBlockNamed("SchedulingBlock")) {
          s.startTransaction();
          s.modify(
            sql`insert into scheduling_google_integration_logs (operation, success, error_message, logged_at)
              values ('delete', false, concat(google_delete_err.type, ': ', coalesce(google_delete_err.message, '')), now())`,
          );
          s.commitTransaction();
        }
        this.#markReauthOnTokenError(s, {
          errorMessage: sql`google_delete_err.message`,
          accountWhere:
            sql`credential_id = google_calendar_record.credential_id`,
        });
        s.throwError(
          sql`coalesce(google_delete_err.message, 'Google Calendar delete failed')`,
        );
      },
    });
  }

  deletePrimaryUserCalendarEvent<T extends IServerBaseStatements>(
    s: T,
    opts: DeletePrimaryUserCalendarEventOpts,
  ): void {
    s.forEachQuery(
      sql`select calendar.id as calendar_id
        from db.user_google_calendars calendar
        join db.user_google_accounts account
          on account.id = calendar.user_google_account_id
        where account.sys_user_id = ${opts.userId}
          and account.status = 'active'`,
      "google_calendar_for_event_delete",
      (s) => {
        this.deleteFromCalendar(s, {
          calendarId: sql`google_calendar_for_event_delete.calendar_id`,
          eventId: opts.eventId,
        });
      },
    );
  }

  navigateToOauth(s: DomStatements) {
    s.defScalar("oauth_start_error", {
      type: "String",
    });
    s.defScalar("authorize_url", {
      type: "String",
    });
    s.tryServer({
      body: (s) => {
        s.getHeader(sql.lit`yolm-origin-domain`, "oauth_origin_domain");
        s.defScalar(
          "oauth_origin_domain_lower",
          sql`lower(coalesce(oauth_origin_domain, ''))`,
        );
        s.defScalar(
          "oauth_redirect_uri",
          sql`case when ${
            isLocalhostHost(sql`oauth_origin_domain_lower`)
          } then 'http://localhost:3000/can-write/google-calendar-oauth-redirect' else 'https://yolmglobalapi.com/can-write/google-calendar-oauth-redirect' end`,
        );
        s.serviceRequest({
          serviceType: sql.lit`managed_oauth`,
          operation: sql.lit`start_flow`,
          optIn: !!this.#caps?.oauth,
          requestJson: sql`json_build_object(
            'provider', ${sql.lit(this.opts.provider)},
            'scopes', ${this.opts.scopes},
            'redirect_uri', oauth_redirect_uri
          )`,
          resultJsonScalar: "start_flow_result",
          errorJsonScalar: "start_flow_error",
        });
        s.if(sql`start_flow_error is not null`, (s) => {
          s.startTransaction();
          s.modify(
            sql`insert into user_google_calendar_error_logs
              (sys_user_id, operation, error_type, error_message, error_description, raw_error)
              values (
                current_user,
                'oauth_start_flow',
                start_flow_error->>'type',
                start_flow_error->>'message',
                start_flow_error->>'description',
                start_flow_error
              )`,
          );
          s.commitTransaction();
          s.setScalar(
            "oauth_start_error",
            sql`coalesce(start_flow_error->>'message', 'Failed to start OAuth flow')`,
          );
          s.return();
        });
        s.setScalar("authorize_url", sql`start_flow_result->>'authorize_url'`);
      },
      errorName: "start_flow_proc_error",
      catch: (s) => {
        s.setScalar(
          "oauth_start_error",
          sql`coalesce(start_flow_proc_error.message, 'Failed to start OAuth flow')`,
        );
      },
    });
    s.if(sql`oauth_start_error is not null`, (s) => {
      s.location.assign(
        sql.concat(
          "/oauth-error?error_msg=",
          sql`uri.encode_component(oauth_start_error)`,
        ),
      );
    }, (s) => {
      s.location.assign(sql`authorize_url`);
    });
  }

  enqueueReconciliationJobs<T extends IServerBaseStatements>(
    s: T,
    opts: { forUsers: Sql },
  ): void {
    s.startTransaction();
    s.modify(
      sql`insert into db.google_calendar_reconciliation_jobs
            (user_google_account_id, user_google_calendar_id, enqueued_at)
          select c.user_google_account_id, c.id, now()
          from db.user_google_calendars c
          join db.user_google_accounts a on a.id = c.user_google_account_id
          where a.sys_user_id in (${opts.forUsers})
            and a.status = 'active'
            and a.credential_id is not null
            and (c.add_to_calendar or c.check_for_conflicts)`,
    );
    s.commitTransaction();
  }

  reconcileCalendarEvents<T extends IServerBaseStatements>(
    s: T,
    opts: { accountRecord: Sql; calendarRecord: Sql },
  ): void {
    const schedulingBlock = system.blockNamed<SchedulingProviderHost>(
      "SchedulingBlock",
    );
    this.#googleCalendar.events.listAll(s, {
      eventsTable: "calendar_event",
      defaultTimeZone: sql`${opts.calendarRecord}.timezone`,
      calendarId: sql`${opts.calendarRecord}.google_calendar_id`,
      timeMin: sql`format.date(date.add(day, -7, now()), '%Y-%m-%dT%H:%M:%SZ')`,
      timeMax:
        sql`format.date(date.add(month, 6, now()), '%Y-%m-%dT%H:%M:%SZ')`,
      singleEvents: true,
      finalSyncTokenScalar: "final_sync_token",
      ...this.#getOauthOpts(sql`${opts.accountRecord}.credential_id`),
      optIn: !!this.#caps?.read_events,
    });
    this.#normalizeEvents(s, {
      eventsTable: "calendar_event",
      outputTable: "normalized_events",
      calendarTimezone: sql`${opts.calendarRecord}.timezone`,
    });
    s.if(sql`${opts.calendarRecord}.check_for_conflicts`, (s) => {
      s.startTransaction();
      s.modify(
        sql`update user_google_calendars
          set sync_token = coalesce(final_sync_token, sync_token)
          where id = ${opts.calendarRecord}.id`,
      );
      this.#mergeEvents(s, {
        normalizedEvents: "normalized_events",
        googleCalendarId: sql`${opts.calendarRecord}.id`,
      });
      s.defTable(
        "incoming_google_calendar_event_ids",
        {
          fields: [
            { name: "id", type: "Int", notNull: true },
            {
              name: "google_event_id",
              type: { type: "String", maxLength: 500, collation: "Binary" },
              notNull: true,
            },
          ],
          query: sql`select distinct
                  1 as id,
                  (coalesce(google_event_id, '') collate Binary) as google_event_id
                from normalized_events
                where google_event_id is not null`,
        },
      );
      s.defTable(
        "google_calendar_events_to_prune",
        {
          fields: [{ name: "id", type: "Int", notNull: true }],
          query: sql`select target.id
                from user_google_calendar_events target
                left join incoming_google_calendar_event_ids incoming
                  on incoming.google_event_id = target.google_event_id
                where target.user_google_calendar_id = ${opts.calendarRecord}.id
                  and incoming.id is null`,
        },
      );
      s.modify(
        sql`delete from user_google_calendar_events
            where id in (select id from google_calendar_events_to_prune)`,
      );
      s.commitTransaction();
    });
    const runtimeAppointments = schedulingBlock.runtimeAppointments;
    if (runtimeAppointments) {
      s.if(sql`${opts.calendarRecord}.add_to_calendar`, (s) => {
        s.forEachQuery(
          sql`select * from normalized_events where is_yolm_event`,
          "event",
          (s) => {
            s.conditional({
              condition:
                sql`exists(select 1 from scheduling_appointments where google_event_id = event.google_event_id and status = 'scheduled' and start_time > now())`,
              then: (s) => {
                s.defRecord(
                  "appointment_linked_to_event_record",
                  sql`select * from scheduling_appointments where google_event_id = event.google_event_id`,
                );
                s.if(
                  sql`appointment_linked_to_event_record.start_time != event.start_date_time::timestamptz`,
                  (s) => {
                    runtimeAppointments.updateAppointmentInCalendar(s, {
                      appointmentId: sql`appointment_linked_to_event_record.id`,
                    });
                    s.increment("updated_events");
                  },
                );
              },
              else: (s) => {
                // this.#googleCalendar.events.delete(s, {
                //   eventId: sql`event.google_event_id`,
                //   ...this.#getOauthOpts(sql`${opts.accountRecord}.id`),
                // });
                s.increment("deleted_events");
              },
            });
          },
        );
        s.forEachQuery(
          sql`select * from scheduling_appointments where start_time > now() and sys_user_id = ${opts.accountRecord}.sys_user_id and status = 'scheduled'`,
          "appointment_record",
          (s) => {
            s.if(
              sql`appointment_record.google_event_id is null or
                not exists(select 1 from normalized_events where google_event_id = appointment_record.google_event_id)`,
              (s) => {
                s.try({
                  body: (s) => {
                    s.startTransaction();
                    s.modify(
                      sql`update db.scheduling_appointments
                        set google_event_id = null
                        where id = appointment_record.id
                          and sys_user_id = ${opts.accountRecord}.sys_user_id
                          and status = 'scheduled'
                          and appointment_record.google_event_id is not null
                          and google_event_id = appointment_record.google_event_id`,
                    );
                    s.if(
                      sql`exists(
                          select 1
                          from db.scheduling_appointments
                          where id = appointment_record.id
                            and sys_user_id = ${opts.accountRecord}.sys_user_id
                            and status = 'scheduled'
                            and google_event_id is null
                        )
                        and not exists(
                          select 1
                          from db.scheduling_background_tasks
                          where task_type = 'calendar_add'
                            and appointment_table = 'scheduling_appointments'
                            and appointment_id = appointment_record.id
                            and (
                              provider is null
                              or provider = ${sql.lit(this.integrationName)}
                            )
                            and (
                              target_user_id is null
                              or target_user_id = appointment_record.sys_user_id
                            )
                        )`,
                      (s) => {
                        schedulingBlock.enqueueBackgroundTask(s, {
                          taskType: "calendar_add",
                          appointmentTable: "scheduling_appointments",
                          appointmentId: sql`appointment_record.id`,
                          provider: this.integrationName,
                          targetUserId: sql`appointment_record.sys_user_id`,
                          insideTransaction: true,
                        });
                        s.increment("created_events");
                      },
                    );
                    s.commitTransaction();
                  },
                  errorName: "add_event_error",
                  catch: (s) => {
                    s.rollbackIfInTransaction();
                    s.startTransaction();
                    s.modify(
                      sql`insert into db.scheduling_integration_errors
                        (error, type, timestamp, task_type, appointment_table, appointment_id, sys_user_id, calendar_id)
                      values (
                        concat(add_event_error.type, ': ', coalesce(add_event_error.message, ''), ' ', coalesce(add_event_error.description, '')),
                        'calendar_task',
                        now(),
                        'calendar_add',
                        'scheduling_appointments',
                        appointment_record.id,
                        ${opts.accountRecord}.sys_user_id,
                        ${opts.calendarRecord}.id::string
                      )`,
                    );
                    s.commitTransaction();
                  },
                });
              },
            );
          },
        );
      });
    }
  }

  #normalizeEvents<T extends IServerBaseStatements>(
    s: T,
    opts: {
      eventsTable: string;
      outputTable: string;
      calendarTimezone: Sql;
    },
  ): void {
    s.defTable(
      opts.outputTable,
      sql`
        select
        id collate Binary as google_event_id,
        summary,
        status,
        case
        when start_date_time is not null
          then case when start_time_zone is not null and try_cast(start_time_zone as enums.sys_timezone) is not null
            then (start_date_time::timestamptz) at time zone start_time_zone at time zone start_time_zone
            when ${opts.calendarTimezone} is not null
            then (start_date_time::timestamptz) at time zone ${opts.calendarTimezone} at time zone ${opts.calendarTimezone}
            else ((start_date_time::timestamptz) at time zone 'UTC') at time zone 'UTC'
          end
        when start_date is not null
          then date.new_timestamp(
            date.part(year, start_date),
            date.part(month, start_date),
            date.part(day, start_date),
            0,
            0,
            0
          ) at time zone coalesce(try_cast(${opts.calendarTimezone} as enums.sys_timezone), ${
        sql.lit(system.timezone)
      }::enums.sys_timezone)
        else null
      end as start_date_time,
      case
        when end_date_time is not null
          then case when end_time_zone is not null and try_cast(end_time_zone as enums.sys_timezone) is not null
            then (end_date_time::timestamptz) at time zone end_time_zone at time zone end_time_zone
            when ${opts.calendarTimezone} is not null
            then (end_date_time::timestamptz) at time zone ${opts.calendarTimezone} at time zone ${opts.calendarTimezone}
            else ((end_date_time::timestamptz) at time zone 'UTC') at time zone 'UTC'
          end
        when end_date is not null
          then date.new_timestamp(
            date.part(year, end_date),
            date.part(month, end_date),
            date.part(day, end_date),
            0,
            0,
            0
          ) at time zone coalesce(try_cast(${opts.calendarTimezone} as enums.sys_timezone), ${
        sql.lit(system.timezone)
      }::enums.sys_timezone)
        else null
      end as end_date_time,
      coalesce(scheduling_system = 'Yolm', false) as is_yolm_event
      from (
        select *, row_number() over (
          partition by id collate Binary
          order by
            case when status = 'cancelled' and try_cast(updated as timestamptz) is null then 1 else 0 end desc,
            try_cast(updated as timestamptz) desc nulls last,
            case when status = 'cancelled' then 1 else 0 end desc
        ) as event_revision_rank
        from ${sql.ref(opts.eventsTable)}
      ) where event_revision_rank = 1`,
    );
  }

  addOauthRedirect(app: App): void {
    const body = (s: EndpointStatements) => {
      const authCtx = useOptionalICtx(AuthApiICtxKey);
      if (authCtx) {
        authCtx.authenticate(s);
      } else {
        throw new Error("No auth context for api");
      }
      s.if(sql`error is not null and error != ''`, (s) => {
        s.startTransaction();
        s.modify(
          sql`insert into user_google_calendar_error_logs
            (sys_user_id, operation, error_type, error_message, error_description, raw_error)
            values (
              user_id,
              'oauth_google_redirect_error',
              error,
              error_description,
              error_uri,
              json_build_object(
                'error', error,
                'error_description', error_description,
                'error_uri', error_uri
              )
            )`,
        );
        s.commitTransaction();
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component(
              concat(
                'Error: ', coalesce(error, ''), '\n',
                'Description: ', coalesce(error_description, ''), '\n',
                'URI: ', coalesce(error_uri, '')
              )
            )`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.if(sql`code is null`, (s) => {
        s.startTransaction();
        s.modify(
          sql`insert into user_google_calendar_error_logs
            (sys_user_id, operation, error_message)
            values (user_id, 'oauth_google_redirect_no_code', 'No auth code found in Google OAuth callback')`,
        );
        s.commitTransaction();
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component('No auth code found in Google OAuth callback')`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.serviceRequest({
        serviceType: sql.lit`managed_oauth`,
        operation: sql.lit`complete_callback`,
        optIn: !!this.#caps?.oauth,
        requestJson: sql`json_build_object(
          'provider', ${sql.lit(this.opts.provider)},
          'code', code,
          'state', state
        )`,
        resultJsonScalar: "callback_result",
        errorJsonScalar: "callback_error",
      });
      s.if(sql`callback_error is not null`, (s) => {
        s.startTransaction();
        s.modify(
          sql`insert into user_google_calendar_error_logs
            (sys_user_id, operation, error_type, error_message, error_description, raw_error)
            values (
              user_id,
              'oauth_complete_callback',
              callback_error->>'type',
              callback_error->>'message',
              callback_error->>'description',
              callback_error
            )`,
        );
        s.commitTransaction();
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component(coalesce(callback_error->>'message', 'OAuth callback failed'))`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.startTransaction();
      s.modify(
        sql`merge into user_google_accounts as target
          using (select
            user_id as sys_user_id,
            (callback_result->>'credential_id')::bigint as credential_id,
            callback_result->>'provider_email' as email,
            callback_result->>'provider_subject' as provider_subject,
            callback_result->>'granted_scopes' as granted_scopes,
            'active' as status
          ) as source
          on target.sys_user_id = source.sys_user_id and target.email = source.email
          when matched then
            update set
              credential_id = source.credential_id,
              email = source.email,
              provider_subject = source.provider_subject,
              granted_scopes = source.granted_scopes,
              status = source.status
          when not matched then
            insert (sys_user_id, credential_id, email, provider_subject, granted_scopes, status)
            values (source.sys_user_id, source.credential_id, source.email, source.provider_subject, source.granted_scopes, source.status)`,
      );

      s.defScalar(
        "user_google_account_id",
        sql`(select id from user_google_accounts where sys_user_id = user_id and credential_id = (callback_result->>'credential_id')::bigint)`,
      );
      s.commitTransaction();
      this.refreshCalendarsForAccount(s, {
        accountId: sql`user_google_account_id`,
      });
      s.setHeader(sql.lit`Location`, sql.lit`/integrations`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
      s.setHttpStatus(303);
    };
    const callbackQueryParams = [
      { name: "code", type: { type: "String", maxLength: 8_000 } },
      { name: "state", type: { type: "String", maxLength: 8_000 } },
      { name: "error", type: { type: "String", maxLength: 8_000 } },
      { name: "error_description", type: { type: "String", maxLength: 8_000 } },
      { name: "error_uri", type: { type: "String", maxLength: 8_000 } },
    ] as QueryParam[];
    const redirectQueryParams = [
      ...callbackQueryParams,
      { name: "scope", type: { type: "String", maxLength: 8_000 } },
    ] as QueryParam[];
    system.api({ prefix: "/api", domain: app.domain }).get(
      "/can-write/google-calendar-oauth-callback",
      {
        query: callbackQueryParams,
        procedure: body,
      },
    );
    for (const alias of app.domainAliases) {
      system.api({ prefix: "/api", domain: alias }).get(
        "/can-write/google-calendar-oauth-callback",
        {
          query: callbackQueryParams,
          procedure: body,
        },
      );
    }
    system.globalApi.get("/can-write/google-calendar-oauth-redirect", {
      query: redirectQueryParams,
      procedure: (s) => {
        s.serviceRequest({
          serviceType: sql.lit`managed_oauth`,
          operation: sql.lit`resolve_callback_target`,
          optIn: !!this.#caps?.oauth,
          requestJson: sql`json_build_object(
            'provider', ${sql.lit(this.opts.provider)},
            'state', state
          )`,
          resultJsonScalar: "callback_target_result",
          errorJsonScalar: "callback_target_error",
        });
        s.if(sql`callback_target_error is not null`, (s) => {
          s.startTransaction();
          s.modify(
            sql`insert into user_google_calendar_error_logs
              (sys_user_id, operation, error_type, error_message, error_description, raw_error)
              values (
                null,
                'oauth_resolve_callback_target',
                callback_target_error->>'type',
                callback_target_error->>'message',
                callback_target_error->>'description',
                callback_target_error
              )`,
          );
          s.commitTransaction();
          s.setHeader(
            sql.lit`Location`,
            sql.concat(
              "/oauth-error?error_msg=",
              sql`uri.encode_component(coalesce(callback_target_error->>'message', 'OAuth redirect callback resolution failed'))`,
            ),
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        });
        s.defScalar(
          "original_host",
          sql`callback_target_result->>'original_host'`,
        );
        const queryParamValues = queryParamsString({
          code: sql`code`,
          state: sql`state`,
          scope: sql`scope`,
          error: sql`error`,
          error_description: sql`error_description`,
          error_uri: sql`error_uri`,
        });
        s.if(sql`original_host is null`, (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql
              .lit`http://localhost:${
              3001 + system.appIndex(app)
            }/oauth-error?error_msg=no_original_host`,
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        });
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            localhostAwareScheme(sql`lower(original_host)`),
            sql`original_host`,
            "/api/can-write/google-calendar-oauth-callback?",
            queryParamValues,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
      },
    });
  }

  refreshCalendarsForAccount<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: AnyExpr;
    },
  ) {
    s.callStoredProcedure("google_calendar_refresh_account", {
      inputScalars: { p_account_id: opts.accountId, p_user_id: sql`user_id` },
    });
  }

  private refreshCalendarsForAccountStatements<T extends IServerBaseStatements>(
    s: T,
    opts: { accountId: AnyExpr; userId: AnyExpr },
  ) {
    s.defRecord(
      "google_account_record",
      sql`select
        credential_id,
        user_google_accounts.id as user_google_account_id,
        sys_user_id
      from user_google_accounts
      where id = ${opts.accountId}`,
    );
    this.#googleCalendar.calendars.list(s, {
      calendarTable: "calendar",
      ...this.#getOauthOpts(sql`google_account_record.credential_id`),
      optIn: !!this.#caps?.read_events,
    });
    s.startTransaction();
    s.defScalar(
      "had_add_to_calendar",
      sql`exists(select 1 from user_google_accounts auto join user_google_calendars where sys_user_id = ${opts.userId} and add_to_calendar)`,
    );
    if (system.blockOptional(OutlookCalendarIntegration)) {
      s.setScalar(
        "had_add_to_calendar",
        sql`had_add_to_calendar or exists(select 1 from user_outlook_accounts auto join user_outlook_calendars where sys_user_id = ${opts.userId} and add_to_calendar)`,
      );
    }
    s.forEachTableWithOpts({
      table: "calendar",
      cursorName: "calendar",
      where: sql`
      not exists (select 1 from db.user_google_calendars where user_google_account_id = google_account_record.user_google_account_id and google_calendar_id = calendar.google_calendar_id)`,
      body: (s) => {
        // filter out system calendars (holiday, contacts) inside the body
        // because # in string literals is broken in forEachTableWithOpts WHERE clauses
        s.if(
          sql`not contains(calendar.google_calendar_id, '#holiday@') and not contains(calendar.google_calendar_id, '#contacts@')`,
          (s) => {
            s.modify(sql`merge into user_google_calendars as target
      using (select
      ${opts.accountId} as account_id,
      calendar.google_calendar_id as google_calendar_id,
      calendar.summary as summary,
      calendar.supports_notifications as supports_notifications,
       coalesce(try_cast(calendar.timezone as enums.sys_timezone), ${
              sql.lit(system.timezone)
            }::enums.sys_timezone) as timezone,
      calendar.primary as primary,
      not had_add_to_calendar and calendar.primary as check_for_conflicts) as source

      on target.user_google_account_id = source.account_id and target.google_calendar_id = source.google_calendar_id

      when matched then
        update set
          summary = source.summary,
          supports_notifications = source.supports_notifications,
          timezone = source.timezone,
          check_for_conflicts = source.check_for_conflicts,
          add_to_calendar = source.primary and not had_add_to_calendar

      when not matched then
        insert (user_google_account_id, google_calendar_id, summary, supports_notifications, timezone, check_for_conflicts, add_to_calendar)
        values (source.account_id, source.google_calendar_id, source.summary, source.supports_notifications, source.timezone, source.check_for_conflicts,
        source.primary and not had_add_to_calendar)
      `);
          },
        );
      },
    });
    s.commitTransaction();
  }

  refreshCalendarsForUser<T extends IServerBaseStatements>(
    s: T,
    opts: RefreshCalendarsForUserOpts,
  ) {
    s.forEachTableWithOpts({
      table: "user_google_accounts",
      cursorName: "account",
      where: sql`sys_user_id = ${opts.userId}`,
      body: (s) => {
        s.try({
          body: (s) => {
            this.refreshCalendarsForAccount(s, {
              accountId: sql`account.id`,
            });
          },
          errorName: "error",
          catch: () => {},
        });
      },
    });
  }

  deleteAccount<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteAccountOpts,
  ): void {
    s.defRecord(
      "account_to_delete",
      sql`select * from user_google_accounts where id = ${opts.accountId}`,
    );
    s.startTransaction();
    s.modify(
      sql`update user_google_calendars
        set check_for_conflicts = false
        where user_google_account_id = ${opts.accountId}`,
    );
    s.commitTransaction();
    s.forEachTableWithOpts({
      table: "user_google_calendars",
      cursorName: "calendar",
      where:
        sql`user_google_account_id = ${opts.accountId} and notification_channel_id is not null`,
      body: (s) => {
        s.try({
          body: (s) => {
            this.stopWatchCalendar(s, { calendarId: sql`calendar.id` });
          },
          errorName: "error",
          catch: () => {},
        });
      },
    });
    s.if(
      sql`exists (
        select 1
        from user_google_calendars
        where user_google_account_id = ${opts.accountId}
          and (
            notification_channel_id is not null
            or notification_resource_id is not null
          )
      )`,
      (s) => {
        s.throwError(
          sql
            .lit`Could not disconnect the Google account because one or more notification channels could not be stopped. Please try again.`,
        );
      },
    );
    s.if(sql`account_to_delete.status = 'active'`, (s) => {
      s.serviceRequest({
        serviceType: sql.lit`managed_oauth`,
        operation: sql.lit`disconnect`,
        optIn: !!this.#caps?.oauth,
        requestJson: sql`json_build_object(
          'credential_id', account_to_delete.credential_id
        )`,
        resultJsonScalar: "__google_disconnect_result",
        errorJsonScalar: "__google_disconnect_error",
      });
    });
    s.startTransaction();
    s.modify(
      sql`delete from user_google_accounts where id = ${opts.accountId}`,
    );
    s.commitTransaction();
  }

  #mergeEvents<T extends IServerBaseStatements>(
    s: T,
    opts: {
      normalizedEvents: string;
      googleCalendarId: AnyExpr;
    },
  ): void {
    const ROWWISE_MERGE_EVENT_LIMIT = 64;
    const userDefinedEventTypes = Boolean(
      system.blockNamed<SchedulingProviderHost>("SchedulingBlock")
        .runtimeAppointments,
    );

    if (system.hasBlockNamed("SchedulingBlock")) {
      s.modify(sql`
        insert into deleted_yolm_google_events (google_event_id, deleted_at)
        select google_event_id, now()
        from ${sql.ref(opts.normalizedEvents)}
        where is_yolm_event and status = 'cancelled'
        and not exists (
          select 1 from deleted_yolm_google_events
          where deleted_yolm_google_events.google_event_id = ${
        sql.ref(opts.normalizedEvents)
      }.google_event_id
        )
      `);
    }

    const sourceQuery = userDefinedEventTypes
      ? sql`select ev.* from ${sql.ref(opts.normalizedEvents)} ev
            left join db.scheduling_appointments sa on sa.google_event_id = ev.google_event_id
            where not ev.is_yolm_event and sa.id is null and
            ((ev.status in ('confirmed', 'tentative') and ev.start_date_time is not null and ev.end_date_time is not null)
              or (ev.status = 'cancelled'))`
      : sql`select * from ${sql.ref(opts.normalizedEvents)}
            where not is_yolm_event and
            ((status in ('confirmed', 'tentative') and start_date_time is not null and end_date_time is not null)
              or (status = 'cancelled'))`;

    s.defTable("incoming_google_calendar_events", sourceQuery);
    s.defScalar(
      "incoming_google_calendar_event_count",
      sql`(select count(*) from incoming_google_calendar_events)`,
    );
    s.defScalar(
      "incoming_google_calendar_distinct_event_count",
      sql`(select count(distinct google_event_id) from incoming_google_calendar_events)`,
    );
    s.if(
      sql`incoming_google_calendar_event_count <= ${ROWWISE_MERGE_EVENT_LIMIT}
        and incoming_google_calendar_distinct_event_count = incoming_google_calendar_event_count`,
      (s) => {
        s.modify(sql`
          delete from user_google_calendar_events
          where user_google_calendar_id = ${opts.googleCalendarId}
            and google_event_id in (
              select google_event_id
              from incoming_google_calendar_events
              where status = 'cancelled'
            )
        `);
        s.modify(sql`
          merge into user_google_calendar_events as target
          using (
            select summary, start_date_time, end_date_time, google_event_id
            from incoming_google_calendar_events
            where status in ('confirmed', 'tentative')
          ) as source
          on target.user_google_calendar_id = ${opts.googleCalendarId}
            and target.google_event_id = source.google_event_id
          when matched and (
            (target.summary is distinct from coalesce(source.summary, '<No summary>'))
            or (target.start_time is distinct from source.start_date_time)
            or (target.end_time is distinct from source.end_date_time)
          ) then update set
            summary = coalesce(source.summary, '<No summary>'),
            start_time = source.start_date_time,
            end_time = source.end_date_time
          when not matched then insert
            (summary, start_time, end_time, google_event_id, user_google_calendar_id)
          values (
            coalesce(source.summary, '<No summary>'),
            source.start_date_time,
            source.end_date_time,
            source.google_event_id,
            ${opts.googleCalendarId}
          )
        `);
      },
      (s) => {
        s.defTable(
          "google_calendar_events_to_update",
          sql`
        select
          target.id,
          source.summary,
          source.start_date_time,
          source.end_date_time
        from user_google_calendar_events target
        join incoming_google_calendar_events source
          on target.user_google_calendar_id = ${opts.googleCalendarId}
          and target.google_event_id = source.google_event_id
        where source.status in ('confirmed', 'tentative')
          and (
            (target.summary is distinct from coalesce(source.summary, '<No summary>'))
            or (target.start_time is distinct from source.start_date_time)
            or (target.end_time is distinct from source.end_date_time)
          )
      `,
        );
        s.defTable(
          "google_calendar_events_to_delete",
          sql`
        select target.id
        from user_google_calendar_events target
        join incoming_google_calendar_events source
          on target.user_google_calendar_id = ${opts.googleCalendarId}
          and target.google_event_id = source.google_event_id
        where source.status = 'cancelled'
      `,
        );
        s.defTable(
          "google_calendar_events_to_insert",
          sql`
        select
          source.summary,
          source.start_date_time,
          source.end_date_time,
          source.google_event_id
        from incoming_google_calendar_events source
        left join db.user_google_calendar_events target
          on target.user_google_calendar_id = ${opts.googleCalendarId}
          and target.google_event_id = source.google_event_id
        where source.status in ('confirmed', 'tentative')
          and target.id is null
      `,
        );

        s.modify(sql`
      update user_google_calendar_events
      set
        summary = (
          select coalesce(u.summary, '<No summary>')
          from google_calendar_events_to_update u
          where u.id = user_google_calendar_events.id
        ),
        start_time = (
          select u.start_date_time
          from google_calendar_events_to_update u
          where u.id = user_google_calendar_events.id
        ),
        end_time = (
          select u.end_date_time
          from google_calendar_events_to_update u
          where u.id = user_google_calendar_events.id
        )
      where id in (select id from google_calendar_events_to_update)
    `);
        s.modify(sql`
      delete from user_google_calendar_events
      where id in (select id from google_calendar_events_to_delete)
    `);
        s.modify(sql`
      insert into user_google_calendar_events
        (summary, start_time, end_time, google_event_id, user_google_calendar_id)
      select
        coalesce(summary, '<No summary>'),
        start_date_time,
        end_date_time,
        google_event_id,
        ${opts.googleCalendarId}
      from google_calendar_events_to_insert
    `);
      },
    );
  }

  deleteEventsFromOldCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
    },
  ) {
    s.defRecord(
      "calendar_record",
      sql`select * from user_google_calendars where id = ${opts.calendarId}`,
    );
    s.defRecord(
      "account_record",
      sql`select * from user_google_accounts where id = calendar_record.user_google_account_id`,
    );

    this.#googleCalendar.events.listAll(s, {
      eventsTable: "event",
      defaultTimeZone: sql`calendar_record.timezone`,
      calendarId: sql`calendar_record.google_calendar_id`,
      // Google complains if you provide both a sync token and a time min
      timeMin: sql`format.date(now(), '%Y-%m-%dT%H:%M:%SZ')`,
      timeMax:
        sql`format.date(date.add(month, 6, now()), '%Y-%m-%dT%H:%M:%SZ')`,
      singleEvents: true,
      finalSyncTokenScalar: "final_sync_token",
      ...this.#getOauthOpts(sql`account_record.credential_id`),
      optIn: !!this.#caps?.read_events,
    });
    this.#normalizeEvents(s, {
      eventsTable: "event",
      outputTable: "normalized_events",
      calendarTimezone: sql`calendar_record.timezone`,
    });
    s.forEachQuery(
      sql`select * from normalized_events where is_yolm_event`,
      "event",
      (s) => {
        this.#googleCalendar.events.delete(s, {
          eventId: sql`event.google_event_id`,
          ...this.#getOauthOpts(sql`account_record.credential_id`),
          optIn: !!this.#caps?.modify_events,
        });
      },
    );
  }

  /** Recover expired incremental tokens without losing cached conflicts on failure. */
  syncCalendarEvents<T extends IServerBaseStatements>(
    s: T,
    opts: { calendarRecord: Sql; accountRecord: Sql },
  ): void {
    s.block((s) => {
      s.defScalar("sync_start_token", sql`${opts.calendarRecord}.sync_token`);
      s.defScalar("sync_attempt", sql`0`);
      s.loop((s) => {
        s.if(
          sql`not exists(select 1 from db.user_google_calendars
          where id = ${opts.calendarRecord}.id and check_for_conflicts)`,
          (s) => s.break(),
        );
        s.if(sql`sync_attempt >= 3`, (s) => {
          s.throwError(
            sql.lit`Google Calendar sync needs retry after concurrent changes`,
          );
        });
        s.increment("sync_attempt");
        s.defScalar("sync_complete", sql`false`);
        this.#googleCalendar.events.listAll(s, {
          eventsTable: "event",
          defaultTimeZone: sql`${opts.calendarRecord}.timezone`,
          calendarId: sql`${opts.calendarRecord}.google_calendar_id`,
          syncToken: sql`sync_start_token`,
          timeMin: sql`format.date(now(), '%Y-%m-%dT%H:%M:%SZ')`,
          timeMax:
            sql`format.date(date.add(month, 6, now()), '%Y-%m-%dT%H:%M:%SZ')`,
          singleEvents: true,
          recoverInvalidSyncToken: true,
          fullSyncScalar: "full_sync",
          finalSyncTokenScalar: "final_sync_token",
          ...this.#getOauthOpts(sql`${opts.accountRecord}.credential_id`),
          optIn: !!this.#caps?.read_events,
        });
        s.if(sql`final_sync_token is null`, (s) => {
          s.throwError(
            sql.lit`Google Calendar sync did not return a sync token`,
          );
        });
        this.#normalizeEvents(s, {
          eventsTable: "event",
          outputTable: "normalized_events",
          calendarTimezone: sql`${opts.calendarRecord}.timezone`,
        });
        s.startTransaction();
        // Commit only results fetched from the current token. Retry a lost race.
        s.if(
          sql`exists(select 1 from db.user_google_calendars
            where id = ${opts.calendarRecord}.id and check_for_conflicts
              and sync_token is not distinct from sync_start_token)`,
          (s) => {
            s.setScalar("sync_complete", sql`true`);
            s.if(sql`full_sync`, (s) => {
              s.modify(sql`delete from db.user_google_calendar_events
              where user_google_calendar_id = ${opts.calendarRecord}.id`);
            });
            this.#mergeEvents(s, {
              normalizedEvents: "normalized_events",
              googleCalendarId: sql`${opts.calendarRecord}.id`,
            });
            s.modify(
              sql`update db.user_google_calendars set sync_token = final_sync_token
            where id = ${opts.calendarRecord}.id`,
            );
          },
        );
        s.commitTransaction();
        s.if(sql`sync_complete`, (s) => s.break());
        s.setScalar(
          "sync_start_token",
          sql`(select sync_token from db.user_google_calendars where id = ${opts.calendarRecord}.id)`,
        );
      });
    });
  }

  populate() {
    system.storedProcedure({
      name: "google_calendar_refresh_account",
      transaction: "standalone",
      inputScalars: [{ name: "p_account_id", type: "BigInt" }, {
        name: "p_user_id",
        type: "BigInt",
      }],
      procedure: (s) =>
        this.refreshCalendarsForAccountStatements(s, {
          accountId: sql`p_account_id`,
          userId: sql`p_user_id`,
        }),
    });
    system.storedProcedure({
      name: "google_calendar_watch",
      transaction: "standalone",
      inputScalars: [{ name: "p_calendar_id", type: "BigInt" }],
      procedure: (s) =>
        this.watchCalendarStatements(s, { calendarId: sql`p_calendar_id` }),
    });
    system.storedProcedure({
      name: "google_calendar_stop_watch",
      transaction: "standalone",
      inputScalars: [{ name: "p_calendar_id", type: "BigInt" }],
      procedure: (s) =>
        this.stopWatchCalendarStatements(s, {
          calendarId: sql`p_calendar_id`,
          preserveSyncToken: false,
        }),
    });
    system.storedProcedure({
      name: "google_calendar_stop_watch_preserve",
      transaction: "standalone",
      inputScalars: [{ name: "p_calendar_id", type: "BigInt" }],
      procedure: (s) =>
        this.stopWatchCalendarStatements(s, {
          calendarId: sql`p_calendar_id`,
          preserveSyncToken: true,
        }),
    });
    const notificationDomains = Array.isArray(this.opts.notificationDomain)
      ? this.opts.notificationDomain
      : [this.opts.notificationDomain];
    for (const notificationDomain of notificationDomains) {
      system.api({ prefix: "/api", domain: notificationDomain }).post(
        "/google-calendar-notifications",
        {
          procedure: (s) => {
            s.getHeader(sql.lit`X-Goog-Channel-ID`, {
              defScalar: "channel_id",
            });
            s.getHeader(sql.lit`X-Goog-Resource-State`, {
              defScalar: "resource_state",
            });
            s.getHeader(sql.lit`X-Goog-Resource-ID`, {
              defScalar: "resource_id",
            });
            this.opts.extensions?.onNotificationReceived?.(s, {
              channelId: sql`channel_id`,
              resourceState: sql`resource_state`,
            });
            s.defRecord(
              "calendar_record",
              sql`select * from user_google_calendars where notification_channel_id = channel_id`,
            );
            s.if(sql`calendar_record.id is null`, (s) => {
              s.defRecord(
                "stale_channel_calendar",
                sql`select
                    g.id,
                    a.credential_id
                  from user_google_calendars g
                  join user_google_accounts a on a.id = g.user_google_account_id
                  where g.notification_resource_id = resource_id
                    and a.status = 'active'
                  limit 1`,
              );
              s.if(
                sql`channel_id is not null
                  and resource_id is not null
                  and stale_channel_calendar.id is not null`,
                (s) => {
                  this.stopWatchChannel(s, {
                    calendarId: sql`stale_channel_calendar.id`,
                    channelId: sql`channel_id`,
                    resourceId: sql`resource_id`,
                    credentialId: sql`stale_channel_calendar.credential_id`,
                    operation: "cleanup_stop_watch",
                  });
                },
              );
              s.setHttpStatus(204);
              s.return();
            });
            s.if(
              sql`resource_id is null
                or calendar_record.notification_resource_id != resource_id`,
              (s) => {
                s.setHttpStatus(204);
                s.return();
              },
            );
            s.if(sql`not calendar_record.check_for_conflicts`, (s) => {
              s.setHttpStatus(204);
              s.return();
            });
            s.if(
              sql`resource_state = 'sync' and calendar_record.sync_token is not null`,
              (s) => {
                s.setHttpStatus(204);
                s.return();
              },
            );
            s.defRecord(
              "account",
              sql`select * from user_google_accounts where id = calendar_record.user_google_account_id`,
            );
            s.try({
              body: (s) => {
                this.syncCalendarEvents(s, {
                  calendarRecord: sql`calendar_record`,
                  accountRecord: sql`account`,
                });
              },
              errorName: "event_error",
              catch: (s) => {
                // Rollback clears procedure-local error state. Log it first.
                s.logError(
                  sql`concat('Google calendar sync failed; calendar_id=', calendar_record.id,
                    '; type=', coalesce(event_error.type, 'unknown'),
                    '; message=', left(coalesce(event_error.message, 'No message'), 2000),
                    '; description=', left(coalesce(event_error.description, ''), 2000))`,
                  sql`coalesce(event_error.type, 'google_calendar_sync_error')`,
                );
                s.rollbackIfInTransaction();
                // Failed reconciliation must not acknowledge the notification.
                s.setHttpStatus(503);
                this.opts.extensions?.onNotificationError?.(s, {
                  errorRecord: sql.ref("event_error"),
                });
                if (system.hasBlockNamed("SchedulingBlock")) {
                  s.startTransaction();
                  s.modify(
                    sql`insert into scheduling_google_integration_logs (operation, success, error_message, sys_user_id, logged_at)
                      values ('receive_notification', false, concat(event_error.type, ': ', coalesce(event_error.message, '')), account.sys_user_id, now())`,
                  );
                  s.commitTransaction();
                }
              },
            });
          },
        },
      );

      const adminDebugToken = this.opts.adminDebugToken;
      if (adminDebugToken) {
        const schedulingBlock = system.blockNamedOptional<
          SchedulingProviderHost
        >(
          "SchedulingBlock",
        );
        const googleSchedulingIntegration = schedulingBlock?.opts
          .calendarIntegrations.find(
            (integration) =>
              integration.integration === GoogleCalendarIntegration,
          );
        const schedulingDiagnostics = schedulingBlock?.runtimeAppointments &&
            googleSchedulingIntegration
          ? sql`,
                'appointments', coalesce(
                  (select json_array_agg(json_build_object(
                    'id', appointment.id,
                    'invitee_name', appointment.invitee_name,
                    'invitee_email', appointment.invitee_email,
                    'start_time', appointment.start_time::string,
                    'status', appointment.status::string,
                    'google_event_id', appointment.google_event_id,
                    'created_at', appointment.created_at::string
                  ) order by appointment.start_time)
                  from (
                    select
                      app.id,
                      app.invitee_name,
                      app.invitee_email,
                      app.start_time,
                      app.status,
                      app.${
            sql.ref(googleSchedulingIntegration.eventIdField)
          } as google_event_id,
                      app.created_at
                    from db.scheduling_appointments app
                    where app.sys_user_id = user_id
                      and app.start_time >= try_cast(time_min as timestamptz)
                      and app.start_time <= try_cast(time_max as timestamptz)
                    order by app.start_time
                    limit 100
                  ) appointment),
                  json_build_array()
                ),
                'background_tasks', coalesce(
                  (select json_array_agg(json_build_object(
                    'id', task.id,
                    'task_type', task.task_type::string,
                    'appointment_id', task.appointment_id,
                    'provider', task.provider,
                    'target_user_id', task.target_user_id,
                    'attempt_count', task.attempt_count,
                    'next_attempt_at', task.next_attempt_at::string,
                    'created_at', task.created_at::string
                  ) order by task.created_at)
                  from db.scheduling_background_tasks task
                  where task.appointment_table = 'scheduling_appointments'
                    and exists(
                      select 1 from db.scheduling_appointments app
                      where app.id = task.appointment_id
                        and app.sys_user_id = user_id
                        and app.start_time >= try_cast(time_min as timestamptz)
                        and app.start_time <= try_cast(time_max as timestamptz)
                    )),
                  json_build_array()
                ),
                'recent_integration_errors', coalesce(
                  (select json_array_agg(json_build_object(
                    'id', integration_error.id,
                    'timestamp', integration_error.timestamp::string,
                    'type', integration_error.type::string,
                    'task_type', integration_error.task_type::string,
                    'appointment_table', integration_error.appointment_table,
                    'appointment_id', integration_error.appointment_id,
                    'calendar_id', integration_error.calendar_id,
                    'error', integration_error.error
                  ) order by integration_error.timestamp)
                  from (
                    select * from db.scheduling_integration_errors
                    where sys_user_id = user_id
                    order by timestamp desc
                    limit 100
                  ) integration_error),
                  json_build_array()
                ),
                'recent_google_logs', coalesce(
                  (select json_array_agg(json_build_object(
                    'id', google_log.id,
                    'logged_at', google_log.logged_at::string,
                    'operation', google_log.operation,
                    'success', google_log.success,
                    'appointment_table', google_log.appointment_table,
                    'appointment_id', google_log.appointment_id,
                    'error_message', google_log.error_message
                  ) order by google_log.logged_at)
                  from (
                    select * from db.scheduling_google_integration_logs
                    where sys_user_id = user_id
                    order by logged_at desc
                    limit 100
                  ) google_log),
                  json_build_array()
                )`
          : sql``;
        // Admin diagnostics: correlate raw Google events with local scheduling
        // state without changing calendar synchronization behavior.
        system.api({ prefix: "/api", domain: notificationDomain }).post(
          "/admin/agent-google-events",
          {
            jsonBodyScalar: "body",
            procedure: (s) => {
              s.getHeader(sql.lit`X-Admin-Token`, { defScalar: "auth_token" });
              s.if(
                sql`auth_token is null or auth_token != ${
                  sql.lit(adminDebugToken)
                }`,
                (s) => {
                  s.setHttpStatus(401);
                  s.return(sql`json_build_object('error', 'Unauthorized')`);
                },
              );

              s.defScalar("user_id", sql`(body->>'sys_user_id')::bigint`);
              s.defScalar(
                "time_min",
                sql`coalesce(
                body->>'time_min',
                format.date(date.add(day, -7, now()), '%Y-%m-%dT%H:%M:%SZ')
              )`,
              );
              s.defScalar(
                "time_max",
                sql`coalesce(
                body->>'time_max',
                format.date(date.add(day, 14, now()), '%Y-%m-%dT%H:%M:%SZ')
              )`,
              );

              s.if(sql`user_id is null`, (s) => {
                s.setHttpStatus(400);
                s.return(
                  sql`json_build_object('error', 'Missing sys_user_id in body')`,
                );
              });

              s.defRecord(
                "account_record",
                sql`select * from db.user_google_accounts
                  where sys_user_id = user_id
                  order by (status = 'active') desc, id desc
                  limit 1`,
              );
              s.defRecord(
                "calendar_record",
                sql`select * from db.user_google_calendars
                  where user_google_account_id = account_record.id
                    and add_to_calendar
                  limit 1`,
              );
              const diagnosticResponse = (opts: {
                queryStatus: Sql;
                queryError?: Sql;
                eventCount?: Sql;
                events?: Sql;
              }) =>
                sql`json_build_object(
                'sys_user_id', user_id,
                'account_id', account_record.id,
                'account_email', account_record.email,
                'account_status', account_record.status::string,
                'calendar_id', calendar_record.id,
                'google_calendar_id', calendar_record.google_calendar_id,
                'calendar_timezone', calendar_record.timezone::string,
                'time_min', time_min,
                'time_max', time_max,
                'google_query_status', ${opts.queryStatus},
                'google_query_error', ${opts.queryError ?? sql.null},
                'event_count', ${opts.eventCount ?? sql`0`},
                'events', ${opts.events ?? sql`json_build_array()`}
                ${schedulingDiagnostics}
              )`;

              s.if(sql`account_record.id is null`, (s) => {
                s.return(diagnosticResponse({
                  queryStatus: sql.lit`no_google_account`,
                }));
              });
              s.if(sql`account_record.status != 'active'`, (s) => {
                s.return(diagnosticResponse({
                  queryStatus: sql.lit`account_not_active`,
                }));
              });
              s.if(sql`calendar_record.id is null`, (s) => {
                s.return(diagnosticResponse({
                  queryStatus: sql.lit`no_write_calendar`,
                }));
              });

              s.try({
                body: (s) => {
                  this.debugListEvents(s, {
                    calendarRecord: sql.ref("calendar_record"),
                    accountRecord: sql.ref("account_record"),
                    timeMin: sql`time_min`,
                    timeMax: sql`time_max`,
                    eventsTable: "google_events",
                  });
                  s.return(diagnosticResponse({
                    queryStatus: sql.lit`ok`,
                    eventCount: sql`(select count(*) from google_events)`,
                    events: sql`coalesce(
                      (select json_array_agg(json_build_object(
                        'id', id,
                        'summary', summary,
                        'status', status,
                        'event_type', event_type,
                        'transparency', transparency,
                        'scheduling_system', scheduling_system,
                        'start_date', start_date::string,
                        'start_date_time', start_date_time,
                        'start_time_zone', start_time_zone,
                        'end_date', end_date::string,
                        'end_date_time', end_date_time,
                        'end_time_zone', end_time_zone,
                        'created', created,
                        'updated', updated,
                        'attendees', attendees
                      ) order by coalesce(start_date_time, start_date::string)) from google_events),
                      json_build_array()
                    )`,
                  }));
                },
                errorName: "google_query_error",
                catch: (s) => {
                  s.return(diagnosticResponse({
                    queryStatus: sql.lit`google_query_failed`,
                    queryError:
                      sql`concat(google_query_error.type, ': ', coalesce(google_query_error.message, ''), ' ', coalesce(google_query_error.description, ''))`,
                  }));
                },
              });
            },
          },
        );
      }
    }
    const allowWatchChanges = this.#caps?.watch_changes !== false;
    if (allowWatchChanges) {
      const INITIAL_RETRY_DELAY = 60;
      const BACKOFF_FACTOR = 2.0;
      const MAX_RETRY_DELAY = 3600 * 24 * 3;
      const retryReadyCondition = (calendarId: Sql, operation: string) =>
        sql`(
          not exists (
              select 1 from db.user_google_calendar_error_logs e
              where e.user_google_calendar_id = ${calendarId}
                and e.operation = ${sql.lit(operation)}
            )
            or date.add(
              second,
              least(
                ((${INITIAL_RETRY_DELAY}::real) * power(${BACKOFF_FACTOR}::real, (select count(*) from db.user_google_calendar_error_logs e where e.user_google_calendar_id = ${calendarId} and e.operation = ${
          sql.lit(operation)
        }) + 1) * (0.5::real + random.real() / 2))::int,
                ${MAX_RETRY_DELAY}
              ),
              (select max(logged_at) from db.user_google_calendar_error_logs e where e.user_google_calendar_id = ${calendarId} and e.operation = ${
          sql.lit(operation)
        })
            ) <= now()
        )`;
      system.addReactor({
        name: "subscribe_google_calendar",
        query: sql`select g.id
              from db.user_google_calendars g
              join db.user_google_accounts a on a.id = g.user_google_account_id
              where g.notification_channel_id is null
                and g.notification_resource_id is null
                and g.notification_expiration is null
                and g.check_for_conflicts
                and a.status = 'active'
                and ${retryReadyCondition(sql`g.id`, "watch")}`,
        recordName: "calendar_record",
        maxConcurrent: 1,
        procedure: (s) => {
          this.watchCalendar(s, { calendarId: sql`calendar_record.id` });
        },
      });
      system.addReactor({
        name: "renew_expiring_google_subscription",
        query: sql`select g.id
              from db.user_google_calendars g
              join db.user_google_accounts a on a.id = g.user_google_account_id
              where g.notification_channel_id is not null
                and g.notification_resource_id is not null
                and (
                  g.notification_expiration is null
                  or g.notification_expiration <= date.add(hour, 6, now())
                )
                and g.check_for_conflicts
                and a.status = 'active'
                and ${retryReadyCondition(sql`g.id`, "stop_watch")}`,
        recordName: "calendar_record",
        procedure: (s) => {
          this.stopWatchCalendar(s, {
            calendarId: sql`calendar_record.id`,
            preserveSyncToken: true,
          });
        },
      });
      system.addReactor({
        name: "unsubscribe_google_calendar",
        query: sql`select g.id
              from db.user_google_calendars g
              join db.user_google_accounts a on a.id = g.user_google_account_id
              where not g.check_for_conflicts
                and g.notification_channel_id is not null
                and g.notification_resource_id is not null
                and a.status = 'active'
                and ${retryReadyCondition(sql`g.id`, "stop_watch")}`,
        recordName: "calendar_record",
        procedure: (s) => {
          this.stopWatchCalendar(s, { calendarId: sql`calendar_record.id` });
          s.startTransaction();
          s.modify(
            sql`delete from db.user_google_calendar_events where user_google_calendar_id = calendar_record.id`,
          );
          s.commitTransaction();
        },
      });
    }
    if (system.blockOptional(DevLogBlock)) {
      system.block(DevLogBlock).addCategory("google_calendar_reconciliation");
    }
    system.addReactor({
      name: "google_calendar_reconcile_job",
      query: sql`select id from db.google_calendar_reconciliation_jobs`,
      recordName: "job",
      maxConcurrent: 1,
      procedure: (s) => {
        s.sleep(1000);
        s.defRecord(
          "google_account_record",
          sql`select a.* from db.user_google_accounts a
                join db.google_calendar_reconciliation_jobs j on j.user_google_account_id = a.id
                where j.id = job.id`,
        );
        s.defRecord(
          "calendar_record",
          sql`select c.* from db.user_google_calendars c
                join db.google_calendar_reconciliation_jobs j on j.user_google_calendar_id = c.id
                where j.id = job.id`,
        );
        s.defScalar("created_events", { expr: 0, allowNoRead: true });
        s.defScalar("updated_events", { expr: 0, allowNoRead: true });
        s.defScalar("deleted_events", { expr: 0, allowNoRead: true });
        s.if(
          sql`google_account_record.id is not null
              and calendar_record.id is not null
              and google_account_record.status = 'active'
              and google_account_record.credential_id is not null`,
          (s) => {
            s.try({
              body: (s) => {
                this.reconcileCalendarEvents(s, {
                  accountRecord: sql.ref("google_account_record"),
                  calendarRecord: sql.ref("calendar_record"),
                });
                if (system.blockOptional(DevLogBlock)) {
                  s.startTransaction();
                  system.block(DevLogBlock).log(s, {
                    category: "google_calendar_reconciliation",
                    level: "info",
                    message: sql.concat(
                      "Reconciled google calendar ",
                      sql`calendar_record.id::string`,
                      " for account ",
                      sql`google_account_record.id::string`,
                    ),
                    description: sql.concat(
                      "created=",
                      sql`created_events::string`,
                      " updated=",
                      sql`updated_events::string`,
                      " deleted=",
                      sql`deleted_events::string`,
                    ),
                  });
                  s.commitTransaction();
                }
              },
              errorName: "reconcile_error",
              catch: (s) => {
                s.rollbackIfInTransaction();
                if (system.blockOptional(DevLogBlock)) {
                  s.startTransaction();
                  system.block(DevLogBlock).log(s, {
                    category: "google_calendar_reconciliation",
                    level: "error",
                    message: sql.concat(
                      "Failed to reconcile google calendar ",
                      sql`calendar_record.id::string`,
                      " for account ",
                      sql`google_account_record.id::string`,
                    ),
                    description: sql`concat(
                      reconcile_error.type, ': ',
                      coalesce(reconcile_error.message, ''), ' ',
                      coalesce(reconcile_error.description, '')
                    )`,
                  });
                  s.commitTransaction();
                }
                s.startTransaction();
                s.modify(
                  sql`insert into db.scheduling_integration_errors
                    (error, type, timestamp, sys_user_id, calendar_id)
                  values (
                    concat(reconcile_error.type, ': ', coalesce(reconcile_error.message, ''), ' ', coalesce(reconcile_error.description, '')),
                    'google',
                    now(),
                    google_account_record.sys_user_id,
                    calendar_record.id::string
                  )`,
                );
                s.commitTransaction();
                this.#markReauthOnTokenError(s, {
                  errorMessage: sql`reconcile_error.message`,
                  accountWhere: sql`id = google_account_record.id`,
                });
              },
            });
          },
        );
        s.startTransaction();
        s.modify(
          sql`delete from db.google_calendar_reconciliation_jobs where id = job.id`,
        );
        s.commitTransaction();
      },
    });
  }

  // it will make sense to have the notification domain just be yolmglobalapi.com
  static globalYolmOauth(opts: {
    notificationDomain: string;
  }) {
    return new GoogleCalendarIntegration({
      notificationDomain: opts.notificationDomain,
      provider: "google_calendar",
      scopes: sql`json_build_array(
       'https://www.googleapis.com/auth/userinfo.email',
       'https://www.googleapis.com/auth/calendar.readonly',
       'https://www.googleapis.com/auth/calendar.events'
      )`,
    });
  }
}
