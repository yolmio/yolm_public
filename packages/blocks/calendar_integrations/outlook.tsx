import type {
  CalendarIntegration,
  GetCalendarEventsForRangeOpts,
} from "blocks/calendar_integrations";
import { DevLogBlock } from "blocks/dev_log";
import type { SchedulingProviderHost } from "blocks/scheduling/provider_host";
import { Alert } from "components/alert";
import { OutlookCalendarIcon } from "components/icons/outlook_calendar";
import { AzureAD } from "services/microsoft/auth";
import type { Oauth2TokenOpts } from "services/microsoft/auth";
import { AuthApiICtxKey } from "std/ictx";
import { getCapabilities } from "std/yolm_gen_api";
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
import type { App } from "std/system";
import { Show, useOptionalICtx } from "std/ui";

import type { QueryParam } from "std/yom";
import { GoogleCalendarIntegration } from "./google";
import type {
  AddToCalendarOpts,
  AddToPrimaryUserCalendarOpts,
  DeleteFromCalendarOpts,
  DeletePrimaryUserCalendarEventOpts,
  GetCalendarEventsForDayOpts,
  UpdatePrimaryUserCalendarEventOpts,
  UpdateToCalendarOpts,
} from "./index";

interface OutlookCalendarIntegrationOpts {
  provider: string;
  scopes: Sql;
  notificationDomain: string | string[];
  adminDebugToken?: string;
  extensions?: OutlookCalendarIntegrationExtensions;
}

/**
 * Optional server-statement hooks that fire at key points of the Outlook
 * Calendar (Microsoft Graph) watch/notification lifecycle. Pass via the
 * integration's `extensions` option to run extra logic without forking the
 * block.
 */
export interface OutlookCalendarIntegrationExtensions {
  /** Runs before creating or renewing a Graph subscription; receives the calendar and account records. */
  beforeWatch?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { calendarId: AnyExpr; calendarRecord: Sql; accountRecord: Sql },
  ) => void;
  /** Runs after Graph returns the subscription response, before it is persisted. */
  afterWatch?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { calendarId: AnyExpr; responseRecord: Sql },
  ) => void;
  /** Runs in the catch branch when creating or renewing a Graph subscription fails. */
  onWatchError?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { calendarId: AnyExpr; errorRecord: Sql },
  ) => void;
  /** Runs when processing an inbound change notification fails. */
  onNotificationError?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { errorRecord: Sql },
  ) => void;
  /** Runs for each inbound change notification payload received from Graph. */
  onNotificationReceived?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { body: Sql },
  ) => void;
}

/**
 * Calendar integration that syncs a user's Outlook calendar(s) via the
 * Microsoft Graph API: manages per-user Microsoft OAuth accounts, mirrors
 * events into local tables, maintains Graph change subscriptions (with
 * backoff-aware renewal reactors), and writes Yolm appointments back to
 * Outlook.
 *
 * Implements {@link CalendarIntegration}. Pass an instance to the
 * calendar-integrations registration in `core.tsx` to enable Outlook Calendar.
 *
 * @category Block
 */
export class OutlookCalendarIntegration implements CalendarIntegration {
  blockName = "OutlookCalendarIntegration";
  blockDisplayName = "Outlook Calendar";
  externalServiceOptions = [
    { optionKey: "oauth", optionLabel: "OAuth" },
    { optionKey: "read_events", optionLabel: "Read calendar events" },
    {
      optionKey: "modify_events",
      optionLabel: "Create, update & delete events",
    },
    { optionKey: "watch_changes", optionLabel: "Watch for calendar changes" },
  ];
  private azureAD: AzureAD;
  #caps = getCapabilities()?.blocks?.OutlookCalendarIntegration;

  accountTable = "user_outlook_accounts";
  calendarTable = "user_outlook_calendars";
  integrationName = "Outlook Calendar";

  icon = ({ sx, className }: { sx?: Style; className?: string }) => (
    <OutlookCalendarIcon sx={sx} className={className} />
  );

  accountDisplay = <>{sql`account.email`}</>;

  constructor(public opts: OutlookCalendarIntegrationOpts) {
    this.azureAD = new AzureAD();
  }

  getSchedulingConditionStatus(): Sql {
    return sql`select
      account.sys_user_id,
      exists(
        select 1 from db.user_outlook_calendars calendar
        where calendar.user_outlook_account_id = account.id
          and calendar.check_for_conflicts
      ) as has_conflict_calendar,
      exists(
        select 1 from db.user_outlook_calendars calendar
        where calendar.user_outlook_account_id = account.id
          and calendar.add_to_calendar
      ) as has_add_calendar
    from db.user_outlook_accounts account
    where account.status = 'active'`;
  }

  adminStatus = (
    <Show when={sql`account.status = 'reauth_required'`}>
      <Alert variant="soft" color="danger" startIcon="ErrorOutlined">
        Re-authentication is required for this account.
      </Alert>
    </Show>
  );

  initialize() {
    system.enum_({
      name: "outlook_connection_status",
      values: ["active", "reauth_required"],
    });

    system.db.table("user_outlook_accounts", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.autoCompact();
      table.fk("sys_users").notNull();
      table.bigUint("credential_id").notNull().unique();
      table.email("email");
      table.string("provider_subject", 500);
      table.string("granted_scopes", 1000);
      table.enum("status", "outlook_connection_status")
        .notNull()
        .default(sql`'active'`);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
    });

    system.db.table("user_outlook_calendars", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.autoCompact();
      table.fk("user_outlook_accounts").notNull();
      table.string("azure_calendar_id", 500).notNull();
      table.string("summary", 500).notNull();
      table.bool("check_for_conflicts").notNull().default(false);
      table.bool("add_to_calendar").notNull().default(false);
      table.timestampTz("expiration_date_time");
      table.string("notification_resource_id", 500);
      table.timestampUtc("last_event_sync_at").default(sql`now()`);
      table.recordDisplayNameFields(["summary"]);
    });

    system.db.table("user_outlook_calendar_events", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.autoCompact();
      table.fk("user_outlook_calendars").notNull();
      table.string("summary", 500).notNull();
      table.timestampTz("start_time").notNull();
      table.timestampTz("end_time").notNull();
      // remove unique, because sometimes we have overlapping outlook calendars
      table.string("outlook_event_id", 500).notNull();
      table.string("series_master_id", 600);
    });
    system.db.table("deleted_yolm_outlook_events", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.string("outlook_event_id", 500).notNull();
      table.timestampUtc("deleted_at").notNull();
    });
    system.db.table("user_outlook_calendar_error_logs", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("user_outlook_calendars");
      table.string("operation", 200).notNull();
      table.string("error_type", 500);
      table.string("error_message", 2000);
      table.string("error_description", 2000);
      table.timestampUtc("logged_at").notNull().default(sql`now()`);
      table.ttlFrom("logged_at", sql`date.add(week, -1, now())`);
    });
    system.db.table("outlook_calendar_reconciliation_jobs", (table) => {
      table.sampleData({ skipSampleData: true });
      table.autoCompact();
      table.fk("user_outlook_accounts").notNull();
      table.fk("user_outlook_calendars").notNull();
      table.timestampUtc("enqueued_at").notNull().default(sql`now()`);
      table.ttlFrom("enqueued_at", sql`date.add(day, -2, now())`);
    });
  }

  isActiveAccount: BooleanExpr = sql`status = 'active'`;

  #getOauthOpts = (
    accountId: AnyExpr,
    optIn?: BooleanExpr,
    reauthRequiredScalar?: string,
  ): Oauth2TokenOpts => {
    return {
      managedOauthCredentialId:
        sql`(select credential_id from user_outlook_accounts where id = ${accountId})`,
      onReauthRequired: (s) => {
        s.startTransaction();
        s.modify(
          sql`update user_outlook_accounts
          set status = 'reauth_required'
          where id = ${accountId}`,
        );
        s.commitTransaction();
        if (reauthRequiredScalar) {
          s.setScalar(reauthRequiredScalar, sql`true`);
        }
      },
      optIn,
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
          sql`update user_outlook_accounts set status = 'reauth_required'
            where ${opts.accountWhere}`,
        );
        s.commitTransaction();
      },
    );
  }

  /**
   * Debug-only: list all events on the given outlook calendar via Microsoft
   * Graph (no `showAs` filter, includes free/tentative/busy/oof). Returns
   * into `opts.eventsTable` with the standard listAllEvents schema. Use to
   * verify what Outlook actually has for a calendar.
   */
  debugListEvents<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarRecord: Sql;
      accountRecord: Sql;
      startDateTime: Sql;
      endDateTime: Sql;
      eventsTable: string;
    },
  ): void {
    this.azureAD.events.listAllEvents(s, {
      saveToTable: opts.eventsTable,
      calendarId: sql`${opts.calendarRecord}.azure_calendar_id`,
      startDateTime: opts.startDateTime,
      endDateTime: opts.endDateTime,
      includeAllStatuses: true,
      ...this.#getOauthOpts(
        sql`${opts.accountRecord}.id`,
        !!this.#caps?.read_events,
      ),
    });
  }

  addToCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: AddToCalendarOpts,
  ): void {
    s.defRecord(
      "outlook_calendar_record",
      sql`select
        azure_calendar_id,
        user_outlook_accounts.id as user_outlook_account_id,
        user_outlook_accounts.status as account_status
      from db.user_outlook_calendars
      auto join db.user_outlook_accounts
      where user_outlook_calendars.id = ${opts.calendarId}`,
    );
    s.defScalar(opts.eventIdScalar, {
      type: "String",
    });
    s.if(sql`outlook_calendar_record.account_status = 'active'`, (s) => {
      s.try({
        body: (s) => {
          this.azureAD.events.create(s, {
            calendarId: sql`outlook_calendar_record.azure_calendar_id`,
            event: {
              transactionId: opts.creationId
                ? sql`concat(${opts.creationId}, ':', ${opts.calendarId})`
                : undefined,
              body: {
                contentType: sql.lit`html`,
                // outlook does not support \n, so we need to replace it with <br>
                content: opts.description
                  ? sql`regex.replace_all(regex.replace_all(${opts.description}, '\\\\n', '<br>'), '\n', '<br>')`
                  : sql`''`,
              },
              subject: opts.summary,
              start: {
                dateTime: opts.start,
                timeZone: sql`date.part(timezone, ${opts.start})::string`,
              },
              end: {
                dateTime: opts.end,
                timeZone: sql`date.part(timezone, ${opts.end})::string`,
              },
              extensions: [
                {
                  "@odata.type": sql.lit`microsoft.graph.openTypeExtension`,
                  extensionName: sql.lit`com.yolm.scheduling`,
                  schedulingSystem: sql.lit`Yolm`,
                },
              ],
              ...(opts.attendees
                ? {
                  attendees: [
                    {
                      emailAddress: {
                        address: opts.attendees.email,
                        name: opts.attendees.name,
                      },
                      type: sql.lit`required`,
                    },
                  ],
                }
                : {}),
            },
            eventIdScalar: "tmp_event_id",
            ...this.#getOauthOpts(
              sql`outlook_calendar_record.user_outlook_account_id`,
              !!this.#caps?.modify_events,
            ),
          });
          s.setScalar(opts.eventIdScalar, sql`tmp_event_id`);
        },
        errorName: "outlook_create_err",
        catch: (s) => {
          if (system.hasBlockNamed("SchedulingBlock")) {
            s.startTransaction();
            s.modify(
              sql`insert into scheduling_outlook_integration_logs (operation, success, error_message, logged_at)
                values ('create', false, concat(outlook_create_err.type, ': ', coalesce(outlook_create_err.message, '')), now())`,
            );
            s.commitTransaction();
          }
          this.#markReauthOnTokenError(s, {
            errorMessage: sql`outlook_create_err.message`,
            accountWhere:
              sql`id = outlook_calendar_record.user_outlook_account_id`,
          });
          s.throwError(
            sql`coalesce(outlook_create_err.message, 'Outlook Calendar create failed')`,
          );
        },
      });
    });
  }

  addToPrimaryUserCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: AddToPrimaryUserCalendarOpts,
  ): void {
    s.defScalar(
      "user_outlook_calendar_id",
      sql`(select user_outlook_calendars.id
      from user_outlook_calendars
        auto join user_outlook_accounts
      where sys_user_id = ${opts.userId} and add_to_calendar)`,
    );

    this.addToCalendar(s, {
      calendarId: sql`user_outlook_calendar_id`,
      creationId: opts.creationId,
      summary: opts.summary,
      start: opts.start,
      end: opts.end,
      eventIdScalar: opts.eventIdScalar,
      description: opts.description,
      attendees: opts.attendees,
    });
  }

  getCalendarEventsForDay(opts: GetCalendarEventsForDayOpts): Sql {
    return sql`
    select
      start_time at time zone ${opts.atTimezone} as start_time,
      end_time at time zone ${opts.atTimezone} as end_time,
      sys_user_id
    from db.user_outlook_calendar_events
      auto join db.user_outlook_calendars
      auto join db.user_outlook_accounts
    where start_time at time zone ${opts.atTimezone} < date.add(day, 1, ${opts.day})
      and end_time at time zone ${opts.atTimezone} > ${opts.day}
      and check_for_conflicts
      and user_outlook_accounts.status = 'active'
  `;
  }

  getCalendarEventsForRange(opts: GetCalendarEventsForRangeOpts): Sql {
    return sql`
    select
      e.start_time at time zone ${opts.atTimezone} as start_time,
      e.end_time at time zone ${opts.atTimezone} as end_time,
      a.sys_user_id
    from db.user_outlook_calendar_events e
    join db.user_outlook_calendars c on e.user_outlook_calendar_id = c.id
    join (
      select oa.id, oa.sys_user_id
      from db.user_outlook_accounts oa
      where ${opts.filterUserId(sql`oa.sys_user_id`)}
        and oa.status = 'active'
    ) a on c.user_outlook_account_id = a.id
    where e.start_time at time zone ${opts.atTimezone} < date.add(day, 1, ${opts.end})
      and e.end_time at time zone ${opts.atTimezone} > ${opts.start}
      and c.check_for_conflicts
  `;
  }

  updateToCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: UpdateToCalendarOpts,
  ): void {
    s.defRecord(
      "outlook_calendar_record",
      sql`select
        azure_calendar_id,
        user_outlook_accounts.id as user_outlook_account_id,
        user_outlook_accounts.status as account_status
      from user_outlook_calendars
      auto join user_outlook_accounts
      where user_outlook_calendars.id = ${opts.calendarId}`,
    );
    s.if(sql`outlook_calendar_record.account_status = 'active'`, (s) => {
      s.try({
        body: (s) => {
          this.azureAD.events.update(s, {
            calendarId: sql`outlook_calendar_record.azure_calendar_id`,
            eventId: opts.eventId,
            event: {
              subject: opts.summary,
              body: {
                contentType: sql.lit`HTML`,
                content: opts.description ?? sql`''`,
              },
              start: {
                dateTime: opts.start,
                timeZone: sql`date.part(timezone, ${opts.start})`,
              },
              end: {
                dateTime: opts.end,
                timeZone: sql`date.part(timezone, ${opts.end})`,
              },
              ...(opts.attendees
                ? {
                  attendees: [
                    {
                      emailAddress: {
                        address: opts.attendees.email,
                        name: opts.attendees.name,
                      },
                      type: sql.lit`required`,
                    },
                  ],
                }
                : {}),
            },
            ...this.#getOauthOpts(
              sql`outlook_calendar_record.user_outlook_account_id`,
              !!this.#caps?.modify_events,
            ),
          });
        },
        errorName: "outlook_update_err",
        catch: (s) => {
          if (system.hasBlockNamed("SchedulingBlock")) {
            s.startTransaction();
            s.modify(
              sql`insert into scheduling_outlook_integration_logs (operation, success, error_message, logged_at)
                values ('update', false, concat(outlook_update_err.type, ': ', coalesce(outlook_update_err.message, '')), now())`,
            );
            s.commitTransaction();
          }
          this.#markReauthOnTokenError(s, {
            errorMessage: sql`outlook_update_err.message`,
            accountWhere:
              sql`id = outlook_calendar_record.user_outlook_account_id`,
          });
          s.throwError(
            sql`coalesce(outlook_update_err.message, 'Outlook Calendar update failed')`,
          );
        },
      });
    });
  }

  updatePrimaryUserCalendarEvent<T extends IServerBaseStatements>(
    s: T,
    opts: UpdatePrimaryUserCalendarEventOpts,
  ): void {
    s.defScalar(
      "user_outlook_calendar_id",
      sql`(select user_outlook_calendars.id
      from user_outlook_calendars
        auto join user_outlook_accounts
      where sys_user_id = ${opts.userId} and add_to_calendar)`,
    );
    this.updateToCalendar(s, {
      calendarId: sql`user_outlook_calendar_id`,
      eventId: opts.eventId,
      summary: opts.summary,
      description: opts.description,
      start: opts.start,
      end: opts.end,
      attendees: opts.attendees,
    });
  }

  deleteFromCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteFromCalendarOpts,
  ) {
    s.defRecord(
      "outlook_calendar_record",
      sql`select
        azure_calendar_id,
        user_outlook_accounts.id as user_outlook_account_id
      from user_outlook_calendars
      auto join user_outlook_accounts
      where user_outlook_calendars.id = ${opts.calendarId}`,
    );
    s.try({
      body: (s) => {
        this.azureAD.events.delete(s, {
          eventId: opts.eventId,
          ...this.#getOauthOpts(
            sql`outlook_calendar_record.user_outlook_account_id`,
            !!this.#caps?.modify_events,
          ),
        });
      },
      errorName: "outlook_delete_err",
      catch: (s) => {
        if (system.hasBlockNamed("SchedulingBlock")) {
          s.startTransaction();
          s.modify(
            sql`insert into scheduling_outlook_integration_logs (operation, success, error_message, logged_at)
              values ('delete', false, concat(outlook_delete_err.type, ': ', coalesce(outlook_delete_err.message, '')), now())`,
          );
          s.commitTransaction();
        }
        this.#markReauthOnTokenError(s, {
          errorMessage: sql`outlook_delete_err.message`,
          accountWhere:
            sql`id = outlook_calendar_record.user_outlook_account_id`,
        });
        s.throwError(
          sql`coalesce(outlook_delete_err.message, 'Outlook Calendar delete failed')`,
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
        from db.user_outlook_calendars calendar
        join db.user_outlook_accounts account
          on account.id = calendar.user_outlook_account_id
        where account.sys_user_id = ${opts.userId}
          and account.status = 'active'`,
      "outlook_calendar_for_event_delete",
      (s) => {
        this.deleteFromCalendar(s, {
          calendarId: sql`outlook_calendar_for_event_delete.calendar_id`,
          eventId: opts.eventId,
        });
      },
    );
  }

  watchCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
      successScalar?: string;
    },
  ) {
    s.block((s) => {
      s.callStoredProcedure("outlook_calendar_watch", {
        inputScalars: { p_calendar_id: opts.calendarId },
        outputScalars: { watch_published: "calendar_watch_published" },
      });
      const successScalar = opts.successScalar;
      if (successScalar) {
        s.if(sql`calendar_watch_published is not null`, (s) => {
          s.setScalar(successScalar, sql`calendar_watch_published`);
        });
      }
    });
  }

  /** @internal Statement factory for registration and transport fault-injection tests. */
  watchCalendarStatements<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
      successScalar?: string;
    },
  ) {
    s.block((s) => {
      s.defRecord(
        "db_calendar",
        sql`select * from user_outlook_calendars where id = ${opts.calendarId}`,
      );
      s.defRecord(
        "account",
        sql`select * from user_outlook_accounts where id = db_calendar.user_outlook_account_id`,
      );
      s.if(
        sql`account.status = 'active'`,
        (s) => {
          const notificationDomain = Array.isArray(this.opts.notificationDomain)
            ? this.opts.notificationDomain[0]
            : this.opts.notificationDomain;
          const notificationUrl = sql
            .lit`https://${notificationDomain}/api/azure-notifications`;
          this.opts.extensions?.beforeWatch?.(s, {
            calendarId: opts.calendarId,
            calendarRecord: sql.ref("db_calendar"),
            accountRecord: sql.ref("account"),
          });
          s.defRecord("created_subscription", {
            fields: [{ name: "id", type: "String" }],
          });
          s.try({
            body: (s) => {
              s.defScalar("watch_reauth_required", sql`false`);
              this.azureAD.events.watch(s, {
                calendarId: sql`db_calendar.azure_calendar_id`,
                subscriptionId: sql`db_calendar.notification_resource_id`,
                createdSubscriptionRecord: "created_subscription",
                notificationUrl: notificationUrl,
                ...this.#getOauthOpts(
                  sql`account.id`,
                  !!this.#caps?.watch_changes,
                  "watch_reauth_required",
                ),
              });
              s.if(sql`not watch_reauth_required`, (s) => {
                this.opts.extensions?.afterWatch?.(s, {
                  calendarId: opts.calendarId,
                  responseRecord: sql.ref("watch_response"),
                });
                s.if(sql`watch_response.id is null`, (s) => {
                  s.throwError(
                    sql`concat('outlook watch response missing resource id for calendar_id=', ${opts.calendarId}::string, ' expiration=', coalesce(watch_response.expiration, 'NULL'))`,
                  );
                });
                s.startTransaction();
                // The provider request ran outside the transaction. Revalidate its
                // snapshot before publishing, including disconnects/settings changes.
                s.defScalar(
                  "publish_watch",
                  sql`exists(
                  select 1 from user_outlook_calendars c
                  join user_outlook_accounts a on a.id = c.user_outlook_account_id
                  where c.id = ${opts.calendarId}
                    and (c.notification_resource_id is not distinct from db_calendar.notification_resource_id)
                    and c.user_outlook_account_id = account.id
                    and c.azure_calendar_id = db_calendar.azure_calendar_id
                    and c.check_for_conflicts and a.status = 'active'
                )`,
                );
                s.if(sql`publish_watch`, (s) => {
                  s.modify(
                    sql`update user_outlook_calendars
            set notification_resource_id = watch_response.id,
            expiration_date_time = coalesce(
              try_cast(watch_response.expiration as timestamptz) at time zone current_timezone at time zone current_timezone,
              try_cast(watch_response.expiration as timestamp) at time zone 'UTC',
              date.add(day, 2, now() at time zone current_timezone) at time zone current_timezone
            ),
            last_event_sync_at = now()
            where id = ${opts.calendarId}`,
                  );
                });
                s.commitTransaction();
                s.debugExpr(sql`json_build_object(
                  'provider', 'outlook',
                  'stage', case when not publish_watch then 'subscription_superseded'
                    when watch_response.id = db_calendar.notification_resource_id then 'subscription_renewed'
                    else 'subscription_published' end,
                  'calendar_id', ${opts.calendarId},
                  'previous_subscription_id', db_calendar.notification_resource_id,
                  'subscription_id', watch_response.id
                )`);
                // Delete the superseded ID after publication, outside the transaction.
                this.#cleanupSubscription(s, {
                  calendarId: opts.calendarId,
                  accountId: sql`account.id`,
                  subscriptionId: sql`case when publish_watch
                    then db_calendar.notification_resource_id else watch_response.id end`,
                });
                if (opts.successScalar) {
                  s.setScalar(opts.successScalar, sql`publish_watch`);
                }
              });
            },
            errorName: "watch_error",
            catch: (s) => {
              s.rollbackIfInTransaction();
              this.#cleanupSubscription(s, {
                calendarId: opts.calendarId,
                accountId: sql`account.id`,
                subscriptionId: sql`created_subscription.id`,
              });
              s.defScalar(
                "watch_error_message",
                sql`left(coalesce(watch_error.message, ''), 2000)`,
              );
              s.defScalar(
                "watch_error_description",
                sql`left(coalesce(watch_error.description, ''), 2000)`,
              );
              s.logError(
                sql`concat('Outlook subscription watch failed; calendar_id=',
                ${opts.calendarId}, '; subscription_id=', coalesce(created_subscription.id, db_calendar.notification_resource_id, 'NULL'),
                '; error=', watch_error_message)`,
              );
              s.try({
                body: (s) => {
                  s.startTransaction();
                  s.modify(
                    sql`insert into db.scheduling_integration_errors
                (error, type, timestamp, sys_user_id, calendar_id)
              values (
                concat(
                  watch_error.type, ': ',
                  watch_error_message, ' ',
                  watch_error_description
                ),
                'outlook',
                now(),
                (select id from sys_users where id = account.sys_user_id),
                ${opts.calendarId}::string
              )`,
                  );
                  s.modify(
                    sql`insert into db.user_outlook_calendar_error_logs (user_outlook_calendar_id, operation, error_type, error_message, error_description)
              values ((select id from user_outlook_calendars where id = ${opts.calendarId}), 'watch', watch_error.type, watch_error_message,
                left(concat('calendar_id=', ${opts.calendarId}, '; subscription_id=', coalesce(created_subscription.id, db_calendar.notification_resource_id, 'NULL'), '; ', watch_error_description), 2000))`,
                  );
                  s.commitTransaction();
                },
                errorName: "watch_log_error",
                catch: (s) => {
                  s.rollbackIfInTransaction();
                  s.logError(
                    sql`concat('Outlook watch database logging failed; calendar_id=',
                    ${opts.calendarId}, '; subscription_id=', coalesce(created_subscription.id, db_calendar.notification_resource_id, 'NULL'),
                    '; error=', coalesce(watch_log_error.message, 'Unknown logging failure'))`,
                  );
                },
              });
              this.#markReauthOnTokenError(s, {
                errorMessage: sql`watch_error_message`,
                accountWhere: sql`id = account.id`,
              });
              this.opts.extensions?.onWatchError?.(s, {
                calendarId: opts.calendarId,
                errorRecord: sql.ref("watch_error"),
              });
              s.defScalar(
                "is_handled_ms_watch_error",
                sql`watch_error_message like '%MailboxCrossSiteFailoverException%'
                or watch_error_message like '%MapiExceptionMdbOffline%'
                or watch_error_message like '%QuotaExceededException%'
                or watch_error_message like '%MapiExceptionShutoffQuotaExceeded%'
                or watch_error_message like '%Too Many Requests%'
                or watch_error_message like '%Status Code: 429%'
                or watch_error_message like '%Failed to watch outlook events: 429%'
                or watch_error_message like '%Notification URL%verification failed%'
                or watch_error_message like '%Subscription validation request timed out%'`,
              );
              s.if(sql`is_handled_ms_watch_error`, () => {}, (s) => {
                s.throwError(
                  sql`coalesce(nullif(watch_error_message, ''), 'Outlook watch failed')`,
                );
              });
            },
          });
        },
      );
    });
  }

  #cleanupSubscription<T extends IServerBaseStatements>(
    s: T,
    opts: { calendarId: AnyExpr; accountId: Sql; subscriptionId: Sql },
  ) {
    s.block((s) => {
      s.defScalar("cleanup_subscription_id", opts.subscriptionId);
      s.if(
        sql`cleanup_subscription_id is not null
        and not exists(select 1 from user_outlook_calendars
          where notification_resource_id = cleanup_subscription_id)`,
        (s) => {
          s.try({
            body: (s) => {
              s.defScalar("cleanup_reauth_required", sql`false`);
              this.azureAD.events.stopWatch(s, {
                resourceId: sql`cleanup_subscription_id`,
                ...this.#getOauthOpts(
                  opts.accountId,
                  !!this.#caps?.watch_changes,
                  "cleanup_reauth_required",
                ),
              });
              s.if(sql`cleanup_reauth_required`, (s) => {
                s.throwError(
                  sql
                    .lit`Outlook subscription cleanup requires reauthorization`,
                );
              });
            },
            errorName: "cleanup_error",
            catch: (s) => {
              s.rollbackIfInTransaction();
              s.logError(
                sql`concat('Outlook subscription cleanup failed; calendar_id=',
            ${opts.calendarId}, '; subscription_id=', cleanup_subscription_id,
            '; error=', left(coalesce(cleanup_error.message, ''), 2000))`,
              );
              s.try({
                body: (s) => {
                  s.startTransaction();
                  s.modify(sql`insert into user_outlook_calendar_error_logs
                (user_outlook_calendar_id, operation, error_type, error_message, error_description)
                values ((select id from user_outlook_calendars where id = ${opts.calendarId}),
                  'cleanup_subscription', cleanup_error.type,
                  left(coalesce(cleanup_error.message, ''), 2000),
                  concat('calendar_id=', ${opts.calendarId}, '; subscription_id=', cleanup_subscription_id))`);
                  s.commitTransaction();
                },
                errorName: "cleanup_log_error",
                catch: (s) => {
                  s.rollbackIfInTransaction();
                  s.logError(
                    sql`concat('Outlook cleanup database logging failed; calendar_id=',
                ${opts.calendarId}, '; subscription_id=', cleanup_subscription_id,
                '; error=', coalesce(cleanup_log_error.message, 'Unknown logging failure'))`,
                  );
                },
              });
            },
          });
        },
      );
    });
  }

  stopWatchCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
      /** Revalidate an unsubscribe reactor's candidate and clear events only while disabled. */
      onlyIfDisabled?: boolean;
    },
  ) {
    s.callStoredProcedure(
      opts.onlyIfDisabled
        ? "outlook_calendar_stop_watch_disabled"
        : "outlook_calendar_stop_watch",
      {
        inputScalars: { p_calendar_id: opts.calendarId },
      },
    );
  }

  /** @internal Statement factory for registration and transport fault-injection tests. */
  stopWatchCalendarStatements<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
      /** Revalidate an unsubscribe reactor's candidate and clear events only while disabled. */
      onlyIfDisabled?: boolean;
    },
  ) {
    s.block((s) => {
      // Claim the ID before DELETE: renewals with an older snapshot can no longer
      // publish it, and a re-enabled calendar must create a fresh subscription.
      s.startTransaction();
      s.defRecord(
        "stop_calendar",
        sql`select c.id, c.notification_resource_id, c.user_outlook_account_id
          from user_outlook_calendars c
          join user_outlook_accounts a on a.id = c.user_outlook_account_id
          where c.id = ${opts.calendarId} and a.status = 'active'
            and c.notification_resource_id is not null
            and ${
          opts.onlyIfDisabled ? sql`not c.check_for_conflicts` : sql`true`
        }`,
      );
      s.modify(
        sql`update user_outlook_calendars set notification_resource_id = null
        where id = stop_calendar.id`,
      );
      s.commitTransaction();
      s.exitBlockIf(sql`stop_calendar.id is null`);
      this.#cleanupSubscription(s, {
        calendarId: sql`stop_calendar.id`,
        accountId: sql`stop_calendar.user_outlook_account_id`,
        subscriptionId: sql`stop_calendar.notification_resource_id`,
      });
      if (opts.onlyIfDisabled) {
        s.startTransaction();
        s.modify(sql`delete from user_outlook_calendar_events
          where user_outlook_calendar_id = stop_calendar.id
            and exists(select 1 from user_outlook_calendars c
              where c.id = stop_calendar.id and not c.check_for_conflicts
                and c.notification_resource_id is null)`);
        s.commitTransaction();
      }
    });
  }

  addOauthRedirect(app: App): void {
    const getOutlookCalendars = (s: EndpointStatements) => {
      this.azureAD.calendars.listCalendars(s, {
        saveToTable: sql`calendars`,
        ...this.#getOauthOpts(
          sql`callback_outlook_account_id`,
          !!this.#caps?.oauth,
        ),
      });
      s.startTransaction();
      s.defScalar(
        "had_add_to_calendar",
        sql`exists(
          select 1
          from user_outlook_accounts
          auto join user_outlook_calendars
          where sys_user_id = user_id
            and user_outlook_accounts.status = 'active'
            and add_to_calendar
        )`,
      );
      if (system.blockOptional(GoogleCalendarIntegration)) {
        s.setScalar(
          "had_add_to_calendar",
          sql`had_add_to_calendar or exists(
            select 1
            from user_google_accounts
            auto join user_google_calendars
            where sys_user_id = user_id
              and user_google_accounts.status = 'active'
              and add_to_calendar
          )`,
        );
      }
      s.forEachTableWithOpts({
        table: "calendars",
        cursorName: "calendars",
        where: sql`
    not exists (select 1 from user_outlook_calendars where azure_calendar_id = calendars.id and user_outlook_account_id = callback_outlook_account_id)`,
        body: (s) => {
          s.if(
            sql`not contains(calendars.name, '#holiday@') and not contains(calendars.name, '#contacts@')`,
            (s) => {
              s.modify(sql`merge into user_outlook_calendars as target
          using (
            select callback_outlook_account_id as id
          ) as source
          on target.azure_calendar_id = calendars.id and target.user_outlook_account_id = source.id
          when matched then update set
          summary = calendars.name,
          check_for_conflicts = calendars.is_default_calendar::boolean,
          add_to_calendar = not had_add_to_calendar and calendars.is_default_calendar::boolean
          when not matched then
          insert (user_outlook_account_id, azure_calendar_id, summary, check_for_conflicts, add_to_calendar)
          values (source.id, calendars.id, calendars.name, calendars.is_default_calendar::boolean, not had_add_to_calendar and calendars.is_default_calendar::boolean)
          `);
            },
          );
        },
      });
      s.commitTransaction();
    };

    const queryParams = [
      { name: "code", type: { type: "String", maxLength: 8_000 } },
      { name: "state", type: { type: "String", maxLength: 8_000 } },
      { name: "error", type: { type: "String", maxLength: 8_000 } },
    ] as QueryParam[];

    const body = (s: EndpointStatements) => {
      const authCtx = useOptionalICtx(AuthApiICtxKey);
      if (authCtx) {
        authCtx.authenticate(s);
      } else {
        throw new Error("No auth context for api");
      }
      s.if(sql`error is not null and error != ''`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component(
              concat('Outlook OAuth denied: ', coalesce(error, 'unknown_error'))
            )`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.if(sql`code is null`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component('No auth code found in Outlook OAuth callback')`,
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

      s.modify(sql`merge into user_outlook_accounts as target
      using (
        select
          user_id as sys_user_id,
          (callback_result->>'credential_id')::bigint as credential_id,
          callback_result->>'provider_email' as email,
          callback_result->>'provider_subject' as provider_subject,
          callback_result->>'granted_scopes' as granted_scopes,
          'active' as status
      ) as source
      on target.sys_user_id = source.sys_user_id
         and coalesce(target.provider_subject, target.email) = coalesce(source.provider_subject, source.email)
      when matched then update set
        credential_id = source.credential_id,
        email = source.email,
        provider_subject = source.provider_subject,
        granted_scopes = source.granted_scopes,
        status = source.status
      when not matched then insert
        (sys_user_id, credential_id, email, provider_subject, granted_scopes, status)
        values (
          source.sys_user_id,
          source.credential_id,
          source.email,
          source.provider_subject,
          source.granted_scopes,
          source.status
        )`);

      s.defScalar(
        "callback_outlook_account_id",
        sql`(select id from user_outlook_accounts where sys_user_id = user_id and credential_id = (callback_result->>'credential_id')::bigint)`,
      );
      s.commitTransaction();

      s.try({
        body: (s) => {
          getOutlookCalendars(s);
        },
        errorName: "outlook_calendar_setup_error",
        catch: (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql.concat(
              "/integrations?oauth_status=connected_setup_failed&setup_error=",
              sql`uri.encode_component(coalesce(outlook_calendar_setup_error.message, 'Calendar discovery failed'))`,
            ),
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        },
      });
      s.setHeader(sql.lit`Location`, sql.lit`/integrations`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
      s.setHttpStatus(303);
    };

    system.api({ prefix: "/api", domain: app.domain }).get(
      "/can-write/outlook-calendar-oauth-callback",
      {
        query: queryParams,
        procedure: body,
      },
    );
    for (const alias of app.domainAliases) {
      system.api({ prefix: "/api", domain: alias }).get(
        "/can-write/outlook-calendar-oauth-callback",
        {
          query: queryParams,
          procedure: body,
        },
      );
    }

    system.globalApi.get("/can-write/outlook-calendar-oauth-redirect", {
      query: queryParams,
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
          error: sql`error`,
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
            "/api/can-write/outlook-calendar-oauth-callback?",
            queryParamValues,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
      },
    });
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
          } then 'http://localhost:3000/can-write/outlook-calendar-oauth-redirect' else 'https://yolmglobalapi.com/can-write/outlook-calendar-oauth-redirect' end`,
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

  deleteAccount<T extends IServerBaseStatements>(
    s: T,
    opts: { accountId: AnyExpr },
  ) {
    s.defRecord(
      "account_to_delete",
      sql`select * from user_outlook_accounts where id = ${opts.accountId}`,
    );
    s.forEachTableWithOpts({
      table: "user_outlook_calendars",
      cursorName: "calendar",
      where:
        sql`user_outlook_account_id = ${opts.accountId} and notification_resource_id is not null`,
      body: (s) => {
        s.try({
          body: (s) => {
            this.stopWatchCalendar(s, {
              calendarId: sql`calendar.id`,
            });
          },
          errorName: "error",
          catch: () => {},
        });
      },
    });
    s.if(sql`account_to_delete.status = 'active'`, (s) => {
      s.serviceRequest({
        serviceType: sql.lit`managed_oauth`,
        operation: sql.lit`disconnect`,
        optIn: !!this.#caps?.oauth,
        requestJson: sql`json_build_object(
          'credential_id', account_to_delete.credential_id
        )`,
        resultJsonScalar: "__outlook_disconnect_result",
        errorJsonScalar: "__outlook_disconnect_error",
      });
    });
    s.startTransaction();
    s.modify(
      sql`delete from user_outlook_accounts where id = ${opts.accountId}`,
    );
    s.commitTransaction();
  }

  enqueueReconciliationJobs<T extends IServerBaseStatements>(
    s: T,
    opts: { forUsers: Sql },
  ): void {
    s.startTransaction();
    s.modify(
      sql`insert into db.outlook_calendar_reconciliation_jobs
            (user_outlook_account_id, user_outlook_calendar_id, enqueued_at)
          select c.user_outlook_account_id, c.id, now()
          from db.user_outlook_calendars c
          join db.user_outlook_accounts a on a.id = c.user_outlook_account_id
          where a.sys_user_id in (${opts.forUsers})
            and a.status = 'active'
            and (c.add_to_calendar or c.check_for_conflicts)`,
    );
    s.commitTransaction();
  }

  reconcileCalendarEvents<T extends IServerBaseStatements>(
    s: T,
    opts: { accountRecord: Sql; calendarRecord: Sql },
  ): void {
    this.azureAD.events.listAllEvents(s, {
      calendarId: sql`${opts.calendarRecord}.azure_calendar_id`,
      saveToTable: "temp_outlook_calendar_event",
      endDateTime:
        sql`date.to_rfc3339(date.add(month, 6, now()), 'milliseconds', false)`,
      ...this.#getOauthOpts(
        sql`${opts.accountRecord}.id`,
        !!this.#caps?.read_events,
      ),
    });
    s.if(sql`${opts.calendarRecord}.check_for_conflicts`, (s) => {
      s.startTransaction();
      this.#mergeEvents(s, {
        eventsTable: "temp_outlook_calendar_event",
        calendarId: sql`${opts.calendarRecord}.id`,
      });
      s.defTable(
        "incoming_outlook_calendar_event_ids",
        {
          fields: [
            { name: "id", type: "Int", notNull: true },
            {
              name: "outlook_event_id",
              type: { type: "String", maxLength: 500 },
              notNull: true,
            },
          ],
          query: sql`select distinct
                  1 as id,
                  coalesce(outlook_event_id, '') as outlook_event_id
                from temp_outlook_calendar_event
                where outlook_event_id is not null`,
        },
      );
      s.defTable(
        "outlook_calendar_events_to_prune",
        {
          fields: [{ name: "id", type: "Int", notNull: true }],
          query: sql`select target.id
                from user_outlook_calendar_events target
                left join incoming_outlook_calendar_event_ids incoming
                  on incoming.outlook_event_id = target.outlook_event_id
                where target.user_outlook_calendar_id = ${opts.calendarRecord}.id
                  and incoming.id is null`,
        },
      );
      s.modify(
        sql`delete from user_outlook_calendar_events
            where id in (select id from outlook_calendar_events_to_prune)`,
      );
      s.commitTransaction();
      s.if(
        sql`${opts.calendarRecord}.notification_resource_id is null
          or ${opts.calendarRecord}.expiration_date_time is null
          or ${opts.calendarRecord}.expiration_date_time < date.add(day, 1, now())`,
        (s) => {
          this.watchCalendar(s, {
            calendarId: sql`${opts.calendarRecord}.id`,
          });
        },
      );
    });
    const schedulingBlock = system.blockNamed<SchedulingProviderHost>(
      "SchedulingBlock",
    );
    const runtimeAppointments = schedulingBlock.runtimeAppointments;
    if (runtimeAppointments) {
      s.if(sql`${opts.calendarRecord}.add_to_calendar`, (s) => {
        s.forEachQuery(
          sql`select * from temp_outlook_calendar_event where scheduling_system = 'Yolm'`,
          "event",
          (s) => {
            s.conditional({
              condition:
                sql`exists(select 1 from scheduling_appointments where outlook_event_id = event.outlook_event_id and status = 'scheduled' and start_time > now())`,
              then: (s) => {
                s.defRecord(
                  "appointment_linked_to_event_record",
                  sql`select * from scheduling_appointments where outlook_event_id = event.outlook_event_id `,
                );
                s.if(
                  sql`appointment_linked_to_event_record.start_time != event.start_date_time at time zone event.start_time_zone`,
                  (s) => {
                    runtimeAppointments.updateAppointmentInCalendar(s, {
                      appointmentId: sql`appointment_linked_to_event_record.id`,
                    });
                    s.increment("updated_events");
                  },
                );
              },
              else: (s) => {
                this.azureAD.events.delete(s, {
                  eventId: sql`event.outlook_event_id`,
                  ...this.#getOauthOpts(
                    sql`${opts.accountRecord}.id`,
                    !!this.#caps?.modify_events,
                  ),
                });
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
              sql`appointment_record.outlook_event_id is null or
              not exists(select 1 from temp_outlook_calendar_event where outlook_event_id = appointment_record.outlook_event_id)`,
              (s) => {
                runtimeAppointments.addAppointmentToCalendar(s, {
                  appointmentId: sql`appointment_record.id`,
                });
                s.increment("created_events");
              },
            );
          },
        );
      });
    }
  }

  deleteEventsFromOldCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: AnyExpr;
    },
  ) {
    s.defRecord(
      "calendar_record",
      sql`select * from user_outlook_calendars where id = ${opts.calendarId}`,
    );
    s.defRecord(
      "account_record",
      sql`select * from user_outlook_accounts where id = calendar_record.user_outlook_account_id`,
    );
    this.azureAD.events.listAllEvents(s, {
      calendarId: sql`calendar_record.azure_calendar_id`,
      saveToTable: "temp_outlook_calendar_event",
      endDateTime:
        sql`date.to_rfc3339(date.add(month, 6, now()), 'milliseconds', false)`,
      ...this.#getOauthOpts(sql`account_record.id`, !!this.#caps?.read_events),
    });
    s.forEachQuery(
      sql`select * from temp_outlook_calendar_event where scheduling_system = 'Yolm'`,
      "event",
      (s) => {
        this.azureAD.events.delete(s, {
          eventId: sql`event.outlook_event_id`,
          ...this.#getOauthOpts(
            sql`account_record.id`,
            !!this.#caps?.modify_events,
          ),
        });
      },
    );
  }

  #mergeEvents<T extends IServerBaseStatements>(
    s: T,
    opts: {
      eventsTable: string;
      calendarId: Sql;
    },
  ) {
    const hasRuntimeDefinedAppointments = !!system.db.tables
      .scheduling_appointments;

    // Put both match keys on the source so MERGE can hash-match the batch.
    const sourceQuery = hasRuntimeDefinedAppointments
      ? sql`select ev.*, ${opts.calendarId} as merge_calendar_id from ${
        sql.ref(opts.eventsTable)
      } ev
            left join db.scheduling_appointments sa on sa.outlook_event_id = ev.outlook_event_id
            where coalesce(ev.scheduling_system, '') != 'Yolm' and sa.id is null`
      : sql`select *, ${opts.calendarId} as merge_calendar_id from ${
        sql.ref(opts.eventsTable)
      } where coalesce(scheduling_system, '') != 'Yolm'`;

    s.modify(sql`merge into db.user_outlook_calendar_events as target
          using (${sourceQuery}) as source
          on target.outlook_event_id = source.outlook_event_id and target.user_outlook_calendar_id = source.merge_calendar_id
          when matched then
          update set
          summary = source.summary,
          start_time = source.start_date_time at time zone source.start_time_zone,
          end_time = source.end_date_time at time zone source.end_time_zone
          when not matched then
          insert (outlook_event_id, summary, start_time, end_time, user_outlook_calendar_id, series_master_id) values
          (source.outlook_event_id,
          source.summary,
          source.start_date_time at time zone source.start_time_zone,
          source.end_date_time at time zone source.end_time_zone,
          ${opts.calendarId},
          source.series_master_id
          )`);
    s.modify(
      sql`update db.user_outlook_calendars set last_event_sync_at = now() where id = ${opts.calendarId}`,
    );
  }

  /**
       Makes requests to outlook to get all events for a calendar and merges them into the database.
       */
  mergeAllEventsFromCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: Sql;
    },
  ) {
    s.block((s) => {
      s.defRecord(
        "db_calendar",
        sql`select * from user_outlook_calendars where id = ${opts.calendarId}`,
      );
      s.defRecord(
        "account",
        sql`select * from user_outlook_accounts where id = db_calendar.user_outlook_account_id`,
      );
      s.if(
        sql`account.status = 'active'`,
        (s) => {
          this.azureAD.events.listAllEvents(s, {
            calendarId: sql`db_calendar.azure_calendar_id`,
            saveToTable: "temp_outlook_calendar_event",
            ...this.#getOauthOpts(sql`account.id`, !!this.#caps?.read_events),
          });
          s.startTransaction();
          this.#mergeEvents(s, {
            eventsTable: "temp_outlook_calendar_event",
            calendarId: opts.calendarId,
          });
          s.commitTransaction();
        },
      );
    });
  }

  // I saw errors in the logs where the timestamp was not being cast correctly.
  // The format was 2025-01-28T22:00:00.0000000
  // So I am trying to work around it
  #castToTimestamp = (s: Sql) =>
    sql`coalesce(
      try_cast(${s} as timestamp),
      case when ${s} like '%.0000000' then try_cast(left(${s}, position('.0000000' in ${s}) - 1) as timestamp) else null end,
      try_cast(trim(trailing 'Z' from ${s}) as timestamp)
    )`;

  populate() {
    system.storedProcedure({
      name: "outlook_calendar_watch",
      transaction: "standalone",
      inputScalars: [{ name: "p_calendar_id", type: "BigInt" }],
      outputScalars: [{ name: "watch_published", type: "Bool" }],
      procedure: (s) =>
        this.watchCalendarStatements(s, {
          calendarId: sql`p_calendar_id`,
          successScalar: "watch_published",
        }),
    });
    system.storedProcedure({
      name: "outlook_calendar_stop_watch",
      transaction: "standalone",
      inputScalars: [{ name: "p_calendar_id", type: "BigInt" }],
      procedure: (s) =>
        this.stopWatchCalendarStatements(s, {
          calendarId: sql`p_calendar_id`,
          onlyIfDisabled: false,
        }),
    });
    system.storedProcedure({
      name: "outlook_calendar_stop_watch_disabled",
      transaction: "standalone",
      inputScalars: [{ name: "p_calendar_id", type: "BigInt" }],
      procedure: (s) =>
        this.stopWatchCalendarStatements(s, {
          calendarId: sql`p_calendar_id`,
          onlyIfDisabled: true,
        }),
    });
    const allowWatchChanges = this.#caps?.watch_changes !== false;
    const INITIAL_RETRY_DELAY = 60;
    const BACKOFF_FACTOR = 2.0;
    const MAX_RETRY_DELAY = 3600 * 24 * 3;
    const watchRetryReadyCondition = (calendarId: Sql) =>
      sql`(
        not exists (
          select 1 from db.user_outlook_calendar_error_logs e
          where e.user_outlook_calendar_id = ${calendarId}
            and e.operation = 'watch'
        )
        or date.add(
          second,
          least(
            ((${INITIAL_RETRY_DELAY}::real) * power(${BACKOFF_FACTOR}::real, (select count(*) from db.user_outlook_calendar_error_logs e where e.user_outlook_calendar_id = ${calendarId} and e.operation = 'watch') + 1) * (0.5::real + random.real() / 2))::int,
            ${MAX_RETRY_DELAY}
          ),
          (select max(logged_at) from db.user_outlook_calendar_error_logs e where e.user_outlook_calendar_id = ${calendarId} and e.operation = 'watch')
        ) <= now()
      )`;
    if (allowWatchChanges) {
      system.addReactor({
        name: "subscribe_outlook_calendar",

        query: sql`select c.id
              from db.user_outlook_calendars c
              join db.user_outlook_accounts a on a.id = c.user_outlook_account_id
              where c.notification_resource_id is null
                and c.check_for_conflicts
                and a.status = 'active'
                and ${watchRetryReadyCondition(sql`c.id`)}`,
        recordName: "calendar_record",
        procedure: (s) => {
          this.watchCalendar(s, {
            calendarId: sql`calendar_record.id`,
          });
          this.mergeAllEventsFromCalendar(s, {
            calendarId: sql`calendar_record.id`,
          });
        },
      });
      system.addReactor({
        name: "renew_expired_outlook_subscription",

        query: sql`select c.id
            from db.user_outlook_calendars c
            join db.user_outlook_accounts a on a.id = c.user_outlook_account_id
            where c.expiration_date_time is not null
              and c.notification_resource_id is not null
              and c.check_for_conflicts
              and c.expiration_date_time <= date.add(hour, 6, now())
              and a.status = 'active'
              and ${watchRetryReadyCondition(sql`c.id`)}`,
        recordName: "calendar_record",
        procedure: (s) => {
          this.watchCalendar(s, {
            calendarId: sql`calendar_record.id`,
          });
        },
      });
      system.addReactor({
        name: "unsubscribe_outlook_calendar",

        query: sql`select c.id
              from db.user_outlook_calendars c
              join db.user_outlook_accounts a on a.id = c.user_outlook_account_id
              where not c.check_for_conflicts
                and c.notification_resource_id is not null
                and a.status = 'active'`,
        recordName: "calendar_record",
        procedure: (s) => {
          this.stopWatchCalendar(s, {
            calendarId: sql`calendar_record.id`,
            onlyIfDisabled: true,
          });
        },
      });
    }
    system.addReactor({
      name: "refresh_stale_outlook_calendars",
      query: sql`select oc.id
        from db.user_outlook_calendars oc
        join db.user_outlook_accounts oa on oa.id = oc.user_outlook_account_id
        where oc.check_for_conflicts and
        oc.notification_resource_id is not null and
        oa.status = 'active' and
        (oc.last_event_sync_at is null or
        oc.last_event_sync_at < date.add(day, -2, now())) and
        ${watchRetryReadyCondition(sql`oc.id`)}`,
      recordName: "calendar_record",
      procedure: (s) => {
        this.watchCalendar(s, {
          calendarId: sql`calendar_record.id`,
        });
      },
    });
    if (system.blockOptional(DevLogBlock)) {
      system.block(DevLogBlock).addCategory("outlook_calendar_reconciliation");
    }
    system.addReactor({
      name: "outlook_calendar_reconcile_job",
      query: sql`select id from db.outlook_calendar_reconciliation_jobs`,
      recordName: "job",
      maxConcurrent: 1,
      procedure: (s) => {
        s.sleep(1000);
        s.defRecord(
          "outlook_account_record",
          sql`select a.* from db.user_outlook_accounts a
                join db.outlook_calendar_reconciliation_jobs j on j.user_outlook_account_id = a.id
                where j.id = job.id`,
        );
        s.defRecord(
          "calendar_record",
          sql`select c.* from db.user_outlook_calendars c
                join db.outlook_calendar_reconciliation_jobs j on j.user_outlook_calendar_id = c.id
                where j.id = job.id`,
        );
        s.defScalar("created_events", { expr: 0, allowNoRead: true });
        s.defScalar("updated_events", { expr: 0, allowNoRead: true });
        s.defScalar("deleted_events", { expr: 0, allowNoRead: true });
        s.if(
          sql`outlook_account_record.id is not null
              and calendar_record.id is not null
              and outlook_account_record.status = 'active'`,
          (s) => {
            s.try({
              body: (s) => {
                this.reconcileCalendarEvents(s, {
                  accountRecord: sql.ref("outlook_account_record"),
                  calendarRecord: sql.ref("calendar_record"),
                });
                if (system.blockOptional(DevLogBlock)) {
                  s.startTransaction();
                  system.block(DevLogBlock).log(s, {
                    category: "outlook_calendar_reconciliation",
                    level: "info",
                    message: sql.concat(
                      "Reconciled outlook calendar ",
                      sql`calendar_record.id::string`,
                      " for account ",
                      sql`outlook_account_record.id::string`,
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
                    category: "outlook_calendar_reconciliation",
                    level: "error",
                    message: sql.concat(
                      "Failed to reconcile outlook calendar ",
                      sql`calendar_record.id::string`,
                      " for account ",
                      sql`outlook_account_record.id::string`,
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
                    'outlook',
                    now(),
                    outlook_account_record.sys_user_id,
                    calendar_record.id::string
                  )`,
                );
                s.commitTransaction();
                this.#markReauthOnTokenError(s, {
                  errorMessage: sql`reconcile_error.message`,
                  accountWhere: sql`id = outlook_account_record.id`,
                });
              },
            });
          },
        );
        s.startTransaction();
        s.modify(
          sql`delete from db.outlook_calendar_reconciliation_jobs where id = job.id`,
        );
        s.commitTransaction();
      },
    });
    const notificationDomains = Array.isArray(this.opts.notificationDomain)
      ? this.opts.notificationDomain
      : [this.opts.notificationDomain];
    for (const notificationDomain of notificationDomains) {
      system.api({ prefix: "/api", domain: notificationDomain }).post(
        "/azure-notifications",
        {
          textBodyScalar: "body",
          query: [
            {
              name: "validationToken",
              type: { type: "String", maxLength: 1000 },
            },
          ],
          procedure: (s) => {
            s.if(sql`nullif(validationToken, '') is not null`, (s) => {
              s.setHttpStatus(200);
              s.return(sql`validationToken`);
            });
            this.opts.extensions?.onNotificationReceived?.(s, {
              body: sql`body`,
            });
            s.try({
              body: (s) => {
                s.defTable(
                  "events",
                  sql`select
            (value->'resourceData'->>'id') as event_id,
            (value->>'changeType') as change_type,
            (value->>'subscriptionId') as subscription_id

          from json.array_each(try_cast(body as json) -> 'value') as value`,
                );
                s.defTable("processed_outlook_series", {
                  fields: [
                    {
                      name: "series_master_id",
                      type: { type: "String", maxLength: 600 },
                      notNull: true,
                    },
                  ],
                });
                s.forEachTable("events", "event", (s) => {
                  s.defRecord(
                    "db_calendar",
                    sql`select * from user_outlook_calendars where notification_resource_id = event.subscription_id`,
                  );
                  s.if(sql`db_calendar.id is null`, (s) => {
                    s.continue();
                  });
                  s.startTransaction();
                  s.modify(
                    sql`update user_outlook_calendars set last_event_sync_at = now() where id = db_calendar.id`,
                  );
                  s.commitTransaction();
                  s.defRecord(
                    "account",
                    sql`select * from user_outlook_accounts where id = db_calendar.user_outlook_account_id`,
                  );
                  s.if(sql`event.change_type = 'deleted'`, (s) => {
                    s.startTransaction();
                    if (system.db.tables.scheduling_appointments) {
                      s.if(
                        sql`exists(select 1 from db.scheduling_appointments where outlook_event_id = event.event_id)`,
                        (s) => {
                          s.startTransaction();
                          s.modify(sql`
                          insert into deleted_yolm_outlook_events (outlook_event_id, deleted_at)
                          select event.event_id, now()
                          where not exists (
                            select 1 from deleted_yolm_outlook_events
                            where outlook_event_id = event.event_id
                          )
                        `);
                        },
                      );
                    }
                    s.modify(
                      sql`delete from user_outlook_calendar_events
                        where user_outlook_calendar_id = db_calendar.id
                          and (
                            outlook_event_id = event.event_id
                            or series_master_id = event.event_id
                          )`,
                    );
                    s.commitTransaction();
                    s.continue();
                  });
                  this.azureAD.events.getEvent(s, {
                    eventId: sql`event.event_id`,
                    ...this.#getOauthOpts(
                      sql`account.id`,
                      !!this.#caps?.read_events,
                    ),
                  });

                  s.if(
                    sql`(event_response->'extensions'->0->>'extensionName') = 'com.yolm.scheduling'`,
                    (s) => {
                      s.continue();
                    },
                  );

                  s.defScalar(
                    "notified_series_master_id",
                    sql`case
                      when event_response->>'seriesMasterId' is not null
                        then event_response->>'seriesMasterId'
                      when event_response->>'type' = 'seriesMaster'
                        or event_response->>'recurrence' is not null
                        then event_response->>'id'
                    end`,
                  );
                  s.if(
                    sql`notified_series_master_id is not null`,
                    (s) => {
                      s.if(
                        sql`exists(
                          select 1
                          from processed_outlook_series
                          where series_master_id = notified_series_master_id
                        )`,
                        (s) => {
                          s.continue();
                        },
                      );
                      this.azureAD.events.listAllEvents(s, {
                        calendarId: sql`db_calendar.azure_calendar_id`,
                        seriesMasterId: sql`notified_series_master_id`,
                        saveToTable: "temp_notified_outlook_series",
                        ...this.#getOauthOpts(
                          sql`account.id`,
                          !!this.#caps?.read_events,
                        ),
                      });
                      s.startTransaction();
                      s.modify(
                        sql`delete from user_outlook_calendar_events
                          where user_outlook_calendar_id = db_calendar.id
                            and series_master_id = notified_series_master_id`,
                      );
                      this.#mergeEvents(s, {
                        eventsTable: "temp_notified_outlook_series",
                        calendarId: sql`db_calendar.id`,
                      });
                      s.modify(
                        sql`insert into processed_outlook_series
                          (series_master_id)
                        values (notified_series_master_id)`,
                      );
                      s.commitTransaction();
                      s.continue();
                    },
                  );

                  s.if(
                    sql`event_response->>'showAs' = 'free'`,
                    (s) => {
                      s.startTransaction();
                      s.modify(
                        sql`delete from user_outlook_calendar_events where outlook_event_id = event.event_id and user_outlook_calendar_id = db_calendar.id`,
                      );
                      s.commitTransaction();
                      s.continue();
                    },
                  );
                  const startTime = sql`${
                    this.#castToTimestamp(
                      sql`(event_response->'start'->>'dateTime')`,
                    )
                  } at time zone (event_response->'start'->>'timeZone')`;
                  const endTime = sql`${
                    this.#castToTimestamp(
                      sql`(event_response->'end'->>'dateTime')`,
                    )
                  } at time zone (event_response->'end'->>'timeZone')`;

                  s.startTransaction();
                  s.modify(
                    sql`merge into user_outlook_calendar_events as target
                      using (
                        select
                          event.event_id as outlook_event_id,
                          coalesce(
                            event_response->>'subject',
                            '<no summary>'
                          ) as summary,
                          ${startTime} as start_time,
                          ${endTime} as end_time
                      ) as source
                      on target.outlook_event_id = source.outlook_event_id
                        and target.user_outlook_calendar_id = db_calendar.id
                      when matched then
                        update set
                          summary = source.summary,
                          start_time = source.start_time,
                          end_time = source.end_time
                      when not matched then
                        insert (
                          outlook_event_id,
                          summary,
                          start_time,
                          end_time,
                          user_outlook_calendar_id
                        )
                        values (
                          source.outlook_event_id,
                          source.summary,
                          source.start_time,
                          source.end_time,
                          db_calendar.id
                        )`,
                  );
                  s.commitTransaction();
                });
                s.setHttpStatus(200);
                s.return();
              },
              errorName: "error",
              catch: (s) => {
                //always return 200 even after internally throwing an error because Outlook will keep sending the same notification over and over if we don't
                s.rollbackIfInTransaction();
                this.opts.extensions?.onNotificationError?.(s, {
                  errorRecord: sql.ref("error"),
                });
                if (system.hasBlockNamed("SchedulingBlock")) {
                  s.startTransaction();
                  s.modify(
                    sql`insert into scheduling_outlook_integration_logs (operation, raw_response, success, error_message, logged_at)
                      values ('receive_notification', try_cast(body as json), false, concat(error.type, ': ', coalesce(error.message, '')), now())`,
                  );
                  s.commitTransaction();
                }
                s.setHttpStatus(200);
                s.return();
              },
            });
          },
        },
      );

      const adminDebugToken = this.opts.adminDebugToken;
      if (adminDebugToken) {
        // Admin debug API: list raw Outlook calendar events for an agent.
        system.api({ prefix: "/api", domain: notificationDomain }).post(
          "/admin/agent-outlook-events",
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
                date.to_rfc3339(date.add(day, -7, now()), 'milliseconds', false)
              )`,
              );
              s.defScalar(
                "time_max",
                sql`coalesce(
                body->>'time_max',
                date.to_rfc3339(date.add(day, 14, now()), 'milliseconds', false)
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
                sql`select * from db.user_outlook_accounts
                  where sys_user_id = user_id and status = 'active'
                  limit 1`,
              );
              s.if(sql`account_record.id is null`, (s) => {
                s.setHttpStatus(404);
                s.return(
                  sql`json_build_object('error', 'No active Outlook account for this sys_user_id')`,
                );
              });

              s.defRecord(
                "calendar_record",
                sql`select * from db.user_outlook_calendars
                  where user_outlook_account_id = account_record.id
                    and add_to_calendar
                  limit 1`,
              );
              s.if(sql`calendar_record.id is null`, (s) => {
                s.setHttpStatus(404);
                s.return(
                  sql`json_build_object('error', 'No add_to_calendar=true calendar for this user')`,
                );
              });

              this.debugListEvents(s, {
                calendarRecord: sql.ref("calendar_record"),
                accountRecord: sql.ref("account_record"),
                startDateTime: sql`time_min`,
                endDateTime: sql`time_max`,
                eventsTable: "outlook_events",
              });

              s.return(
                sql`json_build_object(
                'sys_user_id', user_id,
                'calendar_id', calendar_record.id,
                'azure_calendar_id', calendar_record.azure_calendar_id,
                'time_min', time_min,
                'time_max', time_max,
                'event_count', (select count(*) from outlook_events),
                'events', coalesce(
                  (select json_array_agg(json_build_object(
                    'id', outlook_event_id,
                    'summary', summary,
                    'start_date_time', start_date_time::string,
                    'start_time_zone', start_time_zone,
                    'end_date_time', end_date_time::string,
                    'end_time_zone', end_time_zone,
                    'series_master_id', series_master_id,
                    'scheduling_system', scheduling_system,
                    'show_as', show_as,
                    'created', created,
                    'updated', updated
                  ) order by start_date_time) from outlook_events),
                  json_build_array()
                )
              )`,
              );
            },
          },
        );
      }
    }
  }

  static globalYolmOauth(opts: {
    notificationDomain: string;
  }) {
    return new OutlookCalendarIntegration({
      notificationDomain: opts.notificationDomain,
      provider: "outlook_calendar",
      scopes:
        sql`json_build_array('offline_access', 'https://graph.microsoft.com/Calendars.ReadWrite', 'https://graph.microsoft.com/User.Read')`,
    });
  }
}
