import { queryParamsString } from "std/services";
import { sql } from "../../std/sql_utils";
import type { NumericExpr, Sql } from "../../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { sourceMap } from "std/utils";
import type { AzureADAuth, Oauth2TokenOpts } from "./auth";

interface StopWatchOpts extends Oauth2TokenOpts {
  /**
       The resource ID obtained from the watch response
       */
  resourceId: Sql;
}

export class MicrosoftAzureAD {
  constructor(protected auth: AzureADAuth) {}

  listCalendars<T extends IServerBaseStatements>(
    s: T,
    opts: {
      saveToTable?: NumericExpr;
    } & Oauth2TokenOpts,
  ) {
    if (opts.saveToTable) {
      s.defTable("calendars", {
        fields: [
          { name: "id", type: "String" },
          { name: "name", type: "String" },
          { name: "color", type: "String" },
          { name: "is_default_calendar", type: "String" },
          { name: "owner", type: "String" },
        ],
      });
    }
    this.auth.requestWithOauth(s, {
      requestOpts: {
        uri: sql
          .lit`https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,color,isDefaultCalendar,owner`,
        // uri: sql.lit`https://graph.microsoft.com/beta/me/calendars`,
        receiveJson: "events_response",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql.concat(
              "Failed to list azure ad calendars: ",
              sql`response.status`,
            ),
          );
        });
        if (opts.saveToTable) {
          s.modify(
            sql`insert into calendars (id, name, color, is_default_calendar, owner)
            select
              (value->>'id') as id,
              (value->>'name') as name,
              (value->>'color') as color,
              (value->>'isDefaultCalendar') as is_default_calendar,
              (value->>'owner') as owner
            from json.array_each(events_response -> 'value') as value`,
          );
        }
      },
      oauthOpts: opts,
    });
  }
}

export class MicrosoftAzureEventsAD {
  constructor(protected auth: AzureADAuth) {}

  // I saw errors in the logs where the timestamp was not being cast correctly.
  // The format was 2025-01-28T22:00:00.0000000
  // So I am trying to work around it
  #castToTimestamp = (s: Sql) =>
    sql`coalesce(
      try_cast(${s} as timestamp),
      case when ${s} like '%.0000000' then try_cast(left(${s}, position('.0000000' in ${s}) - 1) as timestamp) else null end,
      try_cast(trim(trailing 'Z' from ${s}) as timestamp)
    )`;

  #defineEventsTable = (s: IServerBaseStatements, name: string) => {
    s.defTable(name, {
      fields: [
        { name: "outlook_event_id", type: "String" },
        { name: "summary", type: "String" },
        { name: "start_date_time", type: "TimestampNaive" },
        { name: "start_time_zone", type: "String" },
        { name: "end_date_time", type: "TimestampNaive" },
        { name: "end_time_zone", type: "String" },
        { name: "series_master_id", type: "String" },
        { name: "scheduling_system", type: "String" },
        { name: "show_as", type: "String" },
        { name: "created", type: "String" },
        { name: "updated", type: "String" },
      ],
    });
  };

  #insertIntoEventsTable = (
    s: IServerBaseStatements,
    table: string,
    eventsResponse: Sql,
    includeAllStatuses: boolean,
  ) => {
    // Free events never block availability. Tentative events DO block —
    // they show on the user's calendar and a "maybe" should still prevent
    // double-booking. `includeAllStatuses` skips the filter for debug paths.
    const whereClause = includeAllStatuses
      ? sql.true
      : sql`(value->>'showAs') is null or (value->>'showAs') != 'free'`;
    s.modify(
      sql`insert into ${
        sql.ref(table)
      } (outlook_event_id, summary, start_date_time, start_time_zone, end_date_time, end_time_zone, series_master_id, scheduling_system, show_as, created, updated)
        select
          (value->>'id'),
          case when (value->>'subject') is not null then (value->>'subject') else 'Outlook Event' end,
          ${this.#castToTimestamp(sql`(value->'start'->>'dateTime')`)},
          (value->'start'->>'timeZone'),
          ${this.#castToTimestamp(sql`(value->'end'->>'dateTime')`)},
          (value->'end'->>'timeZone'),
          (value->>'seriesMasterId'),
          (value->'extensions'->0->>'schedulingSystem'),
          (value->>'showAs'),
          (value->>'createdDateTime'),
          (value->>'lastModifiedDateTime')

        from json.array_each(${eventsResponse} -> 'value') as value
        where ${whereClause}`,
    );
  };

  @sourceMap
  listAllEvents<T extends IServerBaseStatements>(
    s: T,
    opts: {
      saveToTable?: string;
      calendarId: Sql;
      /**
       * When provided, list only the occurrences and exceptions belonging to
       * this recurring series instead of the calendar's full event view.
       */
      seriesMasterId?: Sql;
      startDateTime?: Sql;
      endDateTime?: Sql;
      /**
       * Skip the showAs='free' filter and return every event Microsoft
       * Graph returns (free, busy, tentative, oof). Use this from debug
       * tools so you can see exactly what's on the calendar.
       */
      includeAllStatuses?: boolean;
    } & Oauth2TokenOpts,
  ) {
    if (opts.saveToTable) {
      this.#defineEventsTable(s, opts.saveToTable);
    }
    const queryParams = queryParamsString({
      startDateTime: opts.startDateTime ??
        sql`date.to_rfc3339(now(), 'milliseconds', false)`,
      endDateTime: opts.endDateTime ??
        sql`date.to_rfc3339(date.add(year, 1, now()), 'milliseconds', false)`,
      $select: sql.lit(
        "id,subject,start,end,seriesMasterId,showAs,createdDateTime,lastModifiedDateTime",
      ),
      $orderby: opts.seriesMasterId ? undefined : sql.lit`start/dateTime asc`,
      $expand: sql.lit`extensions($filter=Id eq 'com.yolm.scheduling')`,
      $top: 100,
    });
    s.block((s) => {
      s.defScalar("next_page_link", {
        type: "String",
      });
      this.auth.requestWithOauth(s, {
        requestOpts: {
          uri: opts.seriesMasterId
            ? sql.concat(
              sql.lit`https://graph.microsoft.com/v1.0/me/calendars/`,
              opts.calendarId,
              sql.lit`/events/`,
              opts.seriesMasterId,
              sql.lit`/instances?`,
              queryParams,
            )
            : sql.concat(
              sql.lit`https://graph.microsoft.com/v1.0/me/calendars/`,
              opts.calendarId,
              sql.lit`/calendarView?`,
              queryParams,
            ),
          receiveJson: "events_response",
          responseRecord: "response",
        },
        afterRequest: (s) => {
          this.insertEventResponseLogs(s, {
            response: sql`events_response`,
            calendarId: opts.calendarId,
          });
          s.if(sql`response.status != 200`, (s) => {
            this.insertEventErrorLogs(s, {
              response: sql`events_response`,
              calendarId: opts.calendarId,
            });
            s.throwError(
              sql.concat(
                "Failed to list outlook events: ",
                sql`response.status`,
              ),
            );
          });
          if (opts.saveToTable) {
            this.#insertIntoEventsTable(
              s,
              opts.saveToTable,
              sql`events_response`,
              !!opts.includeAllStatuses,
            );
          }
          s.setScalar(
            "next_page_link",
            sql`events_response->>'@odata.nextLink'`,
          );
        },
        oauthOpts: opts,
      });
      s.while(sql`next_page_link is not null`, (s) => {
        s.breakIf(sql`trim(next_page_link) = ''`);
        this.auth.requestWithOauth(s, {
          requestOpts: {
            uri: sql`next_page_link`,
            receiveJson: "events_response",
            responseRecord: "response",
          },
          afterRequest: (s) => {
            this.insertEventResponseLogs(s, {
              response: sql`events_response`,
              calendarId: opts.calendarId,
            });
            s.if(sql`response.status != 200`, (s) => {
              this.insertEventErrorLogs(s, {
                response: sql`events_response`,
                calendarId: opts.calendarId,
              });
              s.throwError(
                sql.concat(
                  "Failed to list outlook events: ",
                  sql`response.status`,
                ),
              );
            });
            if (opts.saveToTable) {
              this.#insertIntoEventsTable(
                s,
                opts.saveToTable,
                sql`events_response`,
                !!opts.includeAllStatuses,
              );
            }
            s.setScalar(
              "next_page_link",
              sql`events_response->>'@odata.nextLink'`,
            );
          },
          oauthOpts: opts,
        });
      });
    });
  }

  insertEventErrorLogs<T extends IServerBaseStatements>(
    s: T,
    opts: { response: Sql; calendarId?: Sql },
  ) {
    s.startTransaction();
    s.modify(
      sql`insert into scheduling_integration_errors (calendar_id, error, type, timestamp, raw_response) values (${opts.calendarId}, 'Failed to list outlook events: ' || response.status, 'outlook', now(), ${opts.response})`,
    );
    s.commitTransaction();
  }

  insertEventResponseLogs<T extends IServerBaseStatements>(
    _s: T,
    _opts: { response: Sql; calendarId?: Sql },
  ) {
  }

  @sourceMap
  watch<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: Sql;
      responseRecord?: string;
      notificationUrl: Sql;
      /** Renew this subscription; create a replacement only if Graph returns 404. */
      subscriptionId?: Sql;
      /** Capture a newly created ID before response validation so callers can clean up on failure. */
      createdSubscriptionRecord?: string;
    } & Oauth2TokenOpts,
  ) {
    const responseRecord = opts.responseRecord ?? "watch_response";
    s.defRecord(responseRecord, {
      fields: [
        { name: "id", type: "String" },
        { name: "resource_id", type: "String" },
        { name: "resource_uri", type: "String" },
        { name: "token", type: "String" },
        { name: "expiration", type: "String" },
      ],
    });
    s.defScalar(
      "current_timezone",
      sql`date.part(timezone,current_timestamp())`,
    );
    s.defScalar(
      "watch_needs_create",
      sql`${opts.subscriptionId ?? sql.null} is null`,
    );
    s.if(sql`not watch_needs_create`, (s) => {
      this.auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.concat(
            "https://graph.microsoft.com/v1.0/subscriptions/",
            opts.subscriptionId ?? sql.null,
          ),
          method: "PATCH",
          json: {
            notificationUrl: opts.notificationUrl,
            expirationDateTime:
              sql`date.to_rfc3339(date.add(day, 2, now()), 'auto', false)`,
          },
          receiveText: "renew_subscription_text",
          responseRecord: "renew_subscription_response",
        },
        afterRequest: (s) => {
          s.if(sql`renew_subscription_response.status = 404`, (s) => {
            s.setScalar("watch_needs_create", sql`true`);
          }, (s) => {
            s.if(sql`renew_subscription_response.status != 200`, (s) => {
              s.throwError(
                sql`concat('Failed to watch outlook events: ', renew_subscription_response.status, ' (renew subscription)')`,
              );
            });
            s.defScalar(
              "renew_subscription_json",
              sql`try_cast(renew_subscription_text as json)`,
            );
            s.if(
              sql`((renew_subscription_json->>'id') is distinct from ${
                opts.subscriptionId ?? sql.null
              })
              or try_cast(renew_subscription_json->>'expirationDateTime' as timestamptz) is null`,
              (s) => {
                s.throwError(
                  sql
                    .lit`Outlook renewal returned an invalid subscription response`,
                );
              },
            );
            s.modify(
              sql`insert into ${
                sql.ref(responseRecord)
              } (id, resource_id, expiration)
              values (renew_subscription_json->>'id', renew_subscription_json->>'resource', renew_subscription_json->>'expirationDateTime')`,
            );
          });
        },
        oauthOpts: opts,
      });
    });
    s.if(sql`watch_needs_create`, (s) => {
      this.auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.lit`https://graph.microsoft.com/v1.0/subscriptions`,
          method: "POST",
          json: {
            changeType: sql.lit`created,updated,deleted`,
            notificationUrl: opts.notificationUrl,
            resource: sql.concat(
              sql.lit`/me/calendars/`,
              opts.calendarId,
              sql.lit`/events`,
            ),
            expirationDateTime: sql`date.to_rfc3339(
          date.add(day,2, current_timestamp at time zone current_timezone) at time zone current_timezone,
          'auto',
          false
        )`,
            clientState: "secretClientValue",
          },
          receiveText: "notification_channel_response_text",
          responseRecord: "response",
        },
        afterRequest: (s) => {
          s.defScalar(
            "notification_channel_response",
            sql`try_cast(notification_channel_response_text as json)`,
          );
          s.if(sql`response.status != 201`, (s) => {
            s.throwError(
              sql.concat(
                "Failed to watch outlook events: ",
                sql`response.status`,
                " code=",
                sql`coalesce(notification_channel_response->'error'->>'code', 'NULL')`,
                " message=",
                sql`left(coalesce(notification_channel_response->'error'->>'message', 'NULL'), 700)`,
                " body=",
                sql`left(coalesce(notification_channel_response_text, ''), 700)`,
              ),
            );
          });
          if (opts.createdSubscriptionRecord) {
            s.modify(
              sql`insert into ${sql.ref(opts.createdSubscriptionRecord)} (id)
              values (nullif(notification_channel_response->>'id', ''))`,
            );
          }
          s.if(
            sql`coalesce(json_typeof(notification_channel_response), 'null') != 'object'
            or nullif(notification_channel_response->>'id', '') is null
            or nullif(notification_channel_response->>'expirationDateTime', '') is null`,
            (s) => {
              s.throwError(
                sql.concat(
                  "Outlook watch returned an invalid subscription response: ",
                  sql`left(coalesce(notification_channel_response_text, ''), 700)`,
                ),
              );
            },
          );
          s.modify(
            sql`insert into ${
              sql.ref(responseRecord)
            }  (id, resource_id, expiration)
      values (notification_channel_response->>'id', notification_channel_response->>'resource', (notification_channel_response->>'expirationDateTime'))`,
          );
        },
        oauthOpts: opts,
      });
    });
  }

  @sourceMap
  create<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: Sql;
      eventIdScalar?: string;
      event: {
        transactionId?: Sql;
        subject: Sql;
        body?: {
          contentType: Sql;
          content: Sql;
        };
        start: {
          dateTime: Sql;
          timeZone: Sql;
        };
        end: {
          dateTime: Sql;
          timeZone: Sql;
        };
        extensions?: Array<{
          "@odata.type": Sql;
          extensionName: Sql;
          [key: string]: Sql | Record<string, Sql>;
        }>;
        attendees?: Array<{
          emailAddress: {
            address: Sql;
            name: Sql;
          };
          type: Sql;
        }>;
      };
    } & Oauth2TokenOpts,
  ) {
    s.defScalar(opts.eventIdScalar ?? "created_event_id", {
      type: "String",
    });
    const eventIdScalar = opts.eventIdScalar ?? "created_event_id";
    s.block((s) => {
      s.defScalar("outlook_create_recovered", sql`false`);
      const reconcile = (s: IServerBaseStatements) => {
        if (opts.event.transactionId) {
          this.findByTransactionId(s, {
            ...opts,
            transactionId: opts.event.transactionId,
            eventIdScalar,
          });
          s.setScalar(
            "outlook_create_recovered",
            sql`${sql.ref(eventIdScalar)} is not null`,
          );
        }
      };
      reconcile(s);
      s.if(sql`${sql.ref(eventIdScalar)} is null`, (s) => {
        this.auth.requestWithOauth(s, {
          requestOpts: {
            uri: sql.concat(
              sql.lit`https://graph.microsoft.com/v1.0/me/calendars/`,
              opts.calendarId,
              sql.lit`/events`,
            ),
            method: "POST",
            json: opts.event,
            receiveJson: "create_event_response",
            responseRecord: "response",
            responseHeadersTable: "create_event_headers",
          },
          afterRequest: (s) => {
            s.if(
              sql`response.status = 201 and nullif(create_event_response->>'id', '') is not null`,
              (s) => {
                s.setScalar(eventIdScalar, sql`create_event_response->>'id'`);
              },
              (s) => {
                s.defScalar(
                  "create_error_message",
                  sql.concat(
                    "Failed to create outlook event: ",
                    sql`response.status`,
                    " code=",
                    sql`left(coalesce(create_event_response->'error'->>'code', 'Unknown'), 200)`,
                    " message=",
                    sql`left(coalesce(create_event_response->'error'->>'message', 'Missing event ID'), 700)`,
                    " request-id=",
                    sql`left(coalesce(
                    (select value from create_event_headers where lower(name) = 'request-id' limit 1),
                    create_event_response->'error'->'innerError'->>'request-id', ''), 200)`,
                  ),
                );
                // A failed response can still leave a committed provider event.
                s.try({
                  body: reconcile,
                  errorName: "reconcile_error",
                  catch: (s) =>
                    s.throwError(
                      sql`concat(create_error_message, '; reconciliation failed: ', reconcile_error.message)`,
                    ),
                });
                s.if(sql`${sql.ref(eventIdScalar)} is null`, (s) => {
                  s.throwError(sql`create_error_message`);
                });
              },
            );
          },
          oauthOpts: opts,
        });
      });
      s.if(sql`${sql.ref(eventIdScalar)} is null`, (s) => {
        s.throwError(
          sql.lit`Outlook Calendar creation did not return an event ID`,
        );
      });
      // A reschedule may have occurred since the ambiguous create. Reuse the
      // recovered object but apply the current appointment details.
      s.if(sql`outlook_create_recovered`, (s) => {
        this.update(s, {
          ...opts,
          onReauthRequired: (s) => {
            opts.onReauthRequired?.(s);
            s.throwError(
              sql
                .lit`Outlook Calendar recovery update requires reauthorization`,
            );
          },
          eventId: sql.ref(eventIdScalar),
          event: {
            subject: opts.event.subject,
            body: opts.event.body,
            start: opts.event.start,
            end: opts.event.end,
            attendees: opts.event.attendees,
          },
        });
      });
    });
  }

  private findByTransactionId<T extends IServerBaseStatements>(
    s: T,
    opts:
      & { calendarId: Sql; transactionId: Sql; eventIdScalar: string }
      & Oauth2TokenOpts,
  ): void {
    s.block((s) => {
      s.defScalar(
        "lookup_url",
        sql.concat(
          sql.lit`https://graph.microsoft.com/v1.0/me/calendars/`,
          opts.calendarId,
          sql.lit`/events?$select=id,transactionId&$top=1000`,
        ),
      );
      s.loop((s) => {
        s.defScalar("lookup_received", sql`false`);
        this.auth.requestWithOauth(s, {
          requestOpts: {
            uri: sql`lookup_url`,
            method: "GET",
            receiveJson: "lookup_response",
            responseRecord: "lookup_status",
          },
          afterRequest: (s) => {
            s.setScalar("lookup_received", sql`true`);
            s.if(
              sql`lookup_status.status != 200 or coalesce(json_typeof(lookup_response->'value'), '') != 'array'`,
              (s) => {
                s.throwError(
                  sql`concat('Failed to reconcile Outlook event: ', lookup_status.status)`,
                );
              },
            );
            s.defScalar(
              "matching_event_id",
              sql`(select value->>'id'
              from json.array_each(lookup_response->'value')
              where value->>'transactionId' = ${opts.transactionId} limit 1)`,
            );
            s.if(sql`matching_event_id is not null`, (s) => {
              s.setScalar(opts.eventIdScalar, sql`matching_event_id`);
              s.break();
            });
            s.setScalar("lookup_url", sql`lookup_response->>'@odata.nextLink'`);
          },
          oauthOpts: opts,
        });
        s.if(sql`not lookup_received`, (s) => {
          s.throwError(
            sql.lit`Outlook Calendar reconciliation requires reauthorization`,
          );
        });
        s.if(sql`lookup_url is null or lookup_url = ''`, (s) => s.break());
      });
    });
  }

  @sourceMap
  getEvent<T extends IServerBaseStatements>(
    s: T,
    opts: {
      eventId: Sql;
      eventResponseScalar?: string;
    } & Oauth2TokenOpts,
  ) {
    s.defScalar(opts.eventResponseScalar ?? "event_response", {
      type: "Json",
    });
    this.auth.requestWithOauth(s, {
      requestOpts: {
        uri: sql.concat(
          sql.lit`https://graph.microsoft.com/v1.0/me/events/`,
          opts.eventId,
          sql.lit`?`,
          queryParamsString({
            $expand: sql.lit`extensions($filter=Id eq 'com.yolm.scheduling')`,
          }),
        ),
        receiveJson: "event_response_json",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql.concat("Failed to get outlook event: ", sql`response.status`),
          );
        });
        s.setScalar(
          opts.eventResponseScalar ?? "event_response",
          sql`event_response_json`,
        );
      },
      oauthOpts: opts,
    });
  }

  @sourceMap
  update<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarId: Sql;
      eventId: Sql;
      event: {
        subject: Sql;
        body?: {
          contentType: Sql;
          content: Sql;
        };
        start: {
          dateTime: Sql;
          timeZone: Sql;
        };
        end: {
          dateTime: Sql;
          timeZone: Sql;
        };
        attendees?: Array<{
          emailAddress: {
            address: Sql;
            name: Sql;
          };
          type: Sql;
        }>;
      };
    } & Oauth2TokenOpts,
  ) {
    this.auth.requestWithOauth(s, {
      requestOpts: {
        uri: sql.concat(
          sql.lit`https://graph.microsoft.com/v1.0/me/events/`,
          opts.eventId,
        ),
        method: "PATCH",
        json: opts.event,
        receiveJson: "update_event_response",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql.concat(
              "Failed to update outlook event: ",
              sql`response.status`,
              " ",
              sql`coalesce(update_event_response->'error'->>'message', '')`,
            ),
          );
        });
      },
      oauthOpts: opts,
    });
  }

  @sourceMap
  delete<T extends IServerBaseStatements>(
    s: T,
    opts: {
      eventId: Sql;
    } & Oauth2TokenOpts,
  ) {
    this.auth.requestWithOauth(s, {
      requestOpts: {
        uri: sql.concat(
          sql.lit`https://graph.microsoft.com/v1.0/me/events/`,
          opts.eventId,
        ),
        method: "DELETE",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status != 204 and response.status != 404`, (s) => {
          s.throwError(
            sql.concat(
              "Failed to delete outlook event: ",
              sql`response.status`,
            ),
          );
        });
      },
      oauthOpts: opts,
    });
  }

  @sourceMap
  stopWatch<T extends IServerBaseStatements>(s: T, opts: StopWatchOpts) {
    this.auth.requestWithOauth(s, {
      requestOpts: {
        uri: sql.concat(
          sql.lit`https://graph.microsoft.com/v1.0/subscriptions/`,
          opts.resourceId,
        ),
        method: "DELETE",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status != 204 and response.status != 404`, (s) => {
          s.throwError(
            sql.concat(
              "Failed to stop notification channel: ",
              sql`response.status`,
            ),
          );
        });
      },
      oauthOpts: opts,
    });
  }
}
