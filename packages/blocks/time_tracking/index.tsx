import { Alert } from "components/alert";
import { Button } from "components/button";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Radio } from "components/radio";
import { RadioGroup } from "components/radio_group";
import { Sidebar } from "components/sidebar";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { SidebarPresenceICtxKey } from "std/ictx";
import { storedScheduledProc } from "std/scheduled_utils";
import { type Sql, sql } from "std/sql_utils";
import { system } from "std/system";
import type { Block, TableBuilder } from "std/system";
import type {
  DomStatements,
  SendEmailOpts,
  SendSmsOpts,
  UiServerStatements,
} from "std/statements";
import { Each, Show, useOptionalICtx } from "std/ui";

export interface TimeTrackingActionContext {
  userIdExpr: Sql;
}

export interface TimeTrackingDimension {
  key: string;
  label: string;
  icon?: IconName;
  query: Sql;
  emptyMessage?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  activityOptions?: readonly {
    value: string;
    label: string;
  }[];
  clockIn: (
    s: UiServerStatements,
    choice: { id: Sql; label: Sql; detail: Sql },
    activity: Sql | undefined,
    ctx: TimeTrackingActionContext,
  ) => void;
}

export interface TimeTrackingActions {
  closeActiveEntries: (
    s: UiServerStatements,
    ctx: TimeTrackingActionContext,
  ) => void;
  clockOut: (
    s: UiServerStatements,
    entry: Sql,
    ctx: TimeTrackingActionContext,
  ) => void;
  deleteEntry: (
    s: UiServerStatements,
    entry: Sql,
    ctx: TimeTrackingActionContext,
  ) => void;
  saveEntry?: (
    s: UiServerStatements,
    entry: Sql,
    clockIn: Sql,
    clockOut: Sql,
    notes: Sql,
    ctx: TimeTrackingActionContext,
  ) => void;
  saveNotes?: (
    s: UiServerStatements,
    entry: Sql,
    notes: Sql,
    ctx: TimeTrackingActionContext,
  ) => void;
}

export interface TimeTrackingQueries {
  activeEntry: Sql;
  todayEntries: Sql;
  weekEntries: (weekStart: Sql) => Sql;
}

export interface TimeTrackingLongRunningWarning {
  thresholdMinutes: number;
  message: string;
}

export interface TimeTrackingConfig {
  userIdExpr: Sql;
  dimensions: TimeTrackingDimension[];
  queries: TimeTrackingQueries;
  actions: TimeTrackingActions;
  longRunningWarning?: TimeTrackingLongRunningWarning;
}

interface TimeClockWidgetProps extends TimeTrackingConfig {
  compactLabel?: string;
}

interface TimeTrackingPageProps extends TimeTrackingConfig {
  title?: string;
  showSidebarTrigger?: boolean;
}

export interface TimeTrackingLongRunningNotifications {
  thresholdMinutes: number;
  message: string;
  /** Omit a channel to disable it. Return null from `to` to skip a recipient. */
  email?: Pick<SendEmailOpts, "from" | "subject" | "mockProcedure"> & {
    to: (entry: Sql) => Sql;
  };
  sms?: Pick<SendSmsOpts, "from" | "mockProcedure"> & {
    to: (entry: Sql) => Sql;
  };
}

export interface TimeTrackingBlockOptions {
  tableName?: string;
  includeGenericDimensionFields?: boolean;
  extendEntryTable?: (table: TableBuilder) => void;
  longRunningNotifications?: TimeTrackingLongRunningNotifications;
}

export class TimeTrackingBlock implements Block {
  blockName = "TimeTrackingBlock";
  blockDisplayName = "Time Tracking";
  componentDependencies = ["TimeClockWidget", "TimeTrackingPage"];
  description =
    "Reusable time tracking UI and extensible clock-entry schema with injectable work dimensions.";

  constructor(private opts: TimeTrackingBlockOptions = {}) {}

  initialize() {
    const tableName = this.opts.tableName ?? "time_clock_entries";
    const notifications = this.opts.longRunningNotifications;
    if (
      notifications && (
        !Number.isSafeInteger(notifications.thresholdMinutes) ||
        notifications.thresholdMinutes <= 0
      )
    ) {
      throw new Error(
        "Time tracking notification threshold must be a positive integer of minutes",
      );
    }
    system.db.table(tableName, (table) => {
      table.description(
        "Time entries keyed by a user, recorded as either a clock interval or a dated duration, with system-extensible work dimensions.",
      );
      table.fk("sys_users").notNull();
      if (this.opts.includeGenericDimensionFields ?? true) {
        table.string("dimension_key", 80);
        table.bigInt("dimension_record_id");
        table.string("dimension_label", 200);
        table.string("dimension_detail", 300);
      }
      table.timestampUtc("clock_in");
      table.timestampUtc("clock_out");
      table.date("duration_date");
      table.int("duration_minutes");
      table.string("notes", 500);
      table.check({
        fields: [
          "clock_in",
          "clock_out",
          "duration_date",
          "duration_minutes",
        ],
        check: ([clockIn, clockOut, durationDate, durationMinutes]) =>
          sql`(
            ${clockIn} is not null
            and ${durationDate} is null
            and ${durationMinutes} is null
            and (${clockOut} is null or ${clockOut} >= ${clockIn})
          ) or (
            ${clockIn} is null
            and ${clockOut} is null
            and ${durationDate} is not null
            and ${durationMinutes} > 0
          )`,
        errorMessage: () =>
          sql
            .lit`Time must be recorded either as clock-in/out timestamps or as a dated positive duration.`,
      });
      if (notifications?.email) {
        table.timestampUtc("long_running_email_sent_at");
      }
      if (notifications?.sms) {
        table.timestampUtc("long_running_sms_sent_at");
      }
      for (const channel of ["email", "sms"] as const) {
        if (!notifications?.[channel]) continue;
        table.tinyUint(`long_running_${channel}_failure_count`).description(
          "Failed delivery attempts. Three failures stop automatic retries for this channel.",
        );
        table.timestampUtc(`long_running_${channel}_retry_after`);
        table.string(`long_running_${channel}_last_error`, 2_000).description(
          "Last delivery error. Retained after retry exhaustion and cleared on success.",
        );
      }
      this.opts.extendEntryTable?.(table);
    });
    if (!notifications?.email && !notifications?.sms) return;

    const entries = sql.ref(`db.${tableName}`);
    storedScheduledProc({
      name: `${tableName}_long_running_notifications`,
      schedule: "0 * * * * *",
      procedure: (s) => {
        for (const channel of ["email", "sms"] as const) {
          const config = notifications[channel];
          if (!config) continue;
          const sentAt = sql.ref(`long_running_${channel}_sent_at`);
          const failureCount = sql.ref(`long_running_${channel}_failure_count`);
          const retryAfter = sql.ref(`long_running_${channel}_retry_after`);
          const lastError = sql.ref(`long_running_${channel}_last_error`);
          const retryEligible = sql`coalesce(entry.${failureCount}, 0) < 3
            and (entry.${retryAfter} is null or entry.${retryAfter} <= now())`;
          s.block((s) => {
            s.defTable(
              "pending_notifications",
              sql`
              select candidate.id, candidate.recipient
              from (
                select entry.id, ${config.to(sql`entry`)} as recipient
                from ${entries} entry
                where entry.clock_out is null
                  and entry.clock_in < date.add(minute, ${-notifications
                .thresholdMinutes}, now())
                  and entry.${sentAt} is null
                  and ${retryEligible}
              ) candidate
              where nullif(trim(candidate.recipient), '') is not null
              order by candidate.id
              limit 100
            `,
            );
            s.forEachTable("pending_notifications", "notification", (s) => {
              // Recheck after candidate discovery: the person may have clocked out.
              s.if(
                sql`exists (
                select 1 from ${entries} entry
                where entry.id = notification.id and entry.clock_out is null
                  and entry.clock_in < date.add(minute, ${-notifications
                  .thresholdMinutes}, now())
                  and entry.${sentAt} is null
                  and ${retryEligible}
              )`,
                (s) => {
                  const delivery = {
                    from: config.from,
                    to: sql`notification.recipient`,
                    idempotencyKey: sql`${
                      sql.lit(`${tableName}:long-running:${channel}:`)
                    } || cast(notification.id as string)`,
                    resultJsonScalar: "delivery_result",
                    errorJsonScalar: "delivery_error",
                    mockProcedure: config.mockProcedure,
                  };
                  if (channel === "email" && notifications.email) {
                    s.sendEmail({
                      ...delivery,
                      subject: notifications.email.subject,
                      textBody: notifications.message,
                    });
                  } else {
                    s.sendSms({ ...delivery, body: notifications.message });
                  }
                  s.if(
                    sql`delivery_error is null and delivery_result is not null`,
                    (s) => {
                      s.startTransaction();
                      s.modify(sql`update ${entries}
                        set ${sentAt} = now(), ${retryAfter} = null, ${lastError} = null
                        where id = notification.id and ${sentAt} is null`);
                      s.commitTransaction();
                    },
                  );
                  s.else((s) => {
                    s.startTransaction();
                    s.modify(sql`update ${entries}
                      set ${failureCount} = coalesce(${failureCount}, 0) + 1,
                        ${retryAfter} = case
                          when coalesce(${failureCount}, 0) + 1 < 3
                            then date.add(minute, 5 * (coalesce(${failureCount}, 0) + 1), now())
                          else null
                        end,
                        ${lastError} = left(coalesce(
                          delivery_error->>'message',
                          delivery_error->>'code',
                          cast(delivery_error as string),
                          'Delivery service returned no result'
                        ), 2000)
                      where id = notification.id and ${sentAt} is null
                        and coalesce(${failureCount}, 0) < 3`);
                    s.commitTransaction();
                  });
                },
              );
            });
          });
        }
      },
    });
  }
}

function choiceTableName(dimension: TimeTrackingDimension) {
  return `time_tracking_${dimension.key}_choices`;
}

/**
 * Converts a `datetime-local` input string to a `timestamptz`, for use in
 * server scope. The string must be parsed with an explicit format and
 * localized with the server session timezone: the DOM runtime casts strings
 * in the browser's timezone (shifting saved times for users outside the
 * system timezone the entries render in), and the server runtime cast does
 * not parse the `datetime-local` format at all.
 */
export function editedClockTimestampExpr(raw: Sql) {
  return sql`at_time_zone_to_tz(
    date.parse_timestamp_naive(nullif(${raw}, ''), '%Y-%m-%dT%H:%M'),
    cast(date.part(timezone, now()) as string)
  )`;
}

function durationExpr(minutes: Sql) {
  return sql`cast(coalesce(${minutes}, 0) / 60 as integer) || 'h ' || cast(coalesce(${minutes}, 0) % 60 as integer) || 'm'`;
}

// Renders a stored `timestampUtc` as date + time in the VIEWER'S timezone
// (per the Jul-29 call: "display it in the user's time zone"). `format.date`
// already renders a UTC timestamp in the session/viewer timezone, so no
// explicit `at time zone` conversion is applied — forcing a fixed zone would
// wrongly show Pacific time to a non-Pacific user. Adding the date
// disambiguates overnight entries whose clock-out lands in the early hours,
// which read as inexplicable "wee hours" when only the time is shown.
function userLocalDateTimeExpr(timestamp: Sql) {
  return sql`format.date(${timestamp}, '%m/%d/%Y %I:%M %p')`;
}

function refreshScalar(name: string) {
  return `ui.${name}`;
}

function hasFullEntryEditing(actions: TimeTrackingActions) {
  return typeof actions.saveEntry === "function";
}

function hasEntrySaving(actions: TimeTrackingActions) {
  return hasFullEntryEditing(actions) ||
    typeof actions.saveNotes === "function";
}

function activeClockLockedExpr(useLockColumns: boolean) {
  return useLockColumns
    ? sql`coalesce(active_clock.locked_by_pay_review, false)`
    : false;
}

function activeClockTooltip(useLockColumns: boolean) {
  return useLockColumns
    ? sql`
      case
        when coalesce(active_clock.locked_by_pay_review, false) then 'Included in a pay review'
        else 'Clock out'
      end
    `
    : "Clock out";
}

function entryEditDisabled(useLockColumns: boolean) {
  return useLockColumns ? sql`coalesce(entry.can_edit, true) = false` : false;
}

function entrySaveDisabled(useFullEntryEditing: boolean) {
  return useFullEntryEditing
    ? sql`coalesce(entry.can_edit, true) = false or trim(edit_clock_in) = ''`
    : false;
}

function entryActionTooltip(useLockColumns: boolean, label: string) {
  return useLockColumns
    ? sql`
      case
        when coalesce(entry.can_edit, true) then ${sql.lit(label)}
        else coalesce(nullif(entry.lock_reason, ''), 'Locked')
      end
    `
    : label;
}

function ClockChoiceList(props: {
  dimensions: TimeTrackingDimension[];
  config: TimeTrackingConfig;
  refreshKey: string;
  closePickerScalar: string;
  searchScalar: string;
  selectionPrefix: string;
  itemClassName: string;
}) {
  const selectedDimensionScalar = `${props.selectionPrefix}_dimension`;
  const selectedIdScalar = `${props.selectionPrefix}_id`;
  const selectedLabelScalar = `${props.selectionPrefix}_label`;
  const selectedDetailScalar = `${props.selectionPrefix}_detail`;
  const selectedActivityScalar = `${props.selectionPrefix}_activity`;
  const selectedDimension = sql`${sql.ref(selectedDimensionScalar)}`;
  const selectedChoice = {
    id: sql`${sql.ref(selectedIdScalar)}`,
    label: sql`${sql.ref(selectedLabelScalar)}`,
    detail: sql`${sql.ref(selectedDetailScalar)}`,
  };
  const firstSearchableDimension = props.dimensions.find((dimension) =>
    dimension.searchable
  );

  function clockIn(
    s: DomStatements,
    dimension: TimeTrackingDimension,
    choice: { id: Sql; label: Sql; detail: Sql },
    activity?: Sql,
  ) {
    s.setScalar("time_tracking_error", sql`null::string`);
    s.defScalar("clock_action_succeeded", sql`false`);
    s.tryServer({
      errorName: "clock_in_error",
      body: (server) => {
        server.startTransaction();
        props.config.actions.closeActiveEntries(server, {
          userIdExpr: props.config.userIdExpr,
        });
        dimension.clockIn(server, choice, activity, {
          userIdExpr: props.config.userIdExpr,
        });
        server.commitTransaction();
        server.increment(refreshScalar(props.refreshKey));
        server.setScalar("clock_action_succeeded", sql`true`);
      },
      catch: (s) => {
        s.setScalar(
          "time_tracking_error",
          sql`coalesce(
            nullif(clock_in_error.message, ''),
            'Unable to clock in. Ask a manager to review the active time entry.'
          )`,
        );
      },
    });
    s.if(sql`clock_action_succeeded`, (s) => {
      s.setScalar(props.closePickerScalar, sql`false`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Show when={sql`${selectedDimension} = ''`}>
        {props.dimensions.map((dimension) => {
          const tableName = choiceTableName(dimension);
          const search = sql`${sql.ref(props.searchScalar)}`;
          const matchesSearch = dimension.searchable
            ? sql`trim(${search}) = ''
                or coalesce(choice.label, '') ilike '%' || trim(${search}) || '%'
                or coalesce(choice.detail, '') ilike '%' || trim(${search}) || '%'`
            : sql`true`;
          const tableMatchesSearch = dimension.searchable
            ? sql`trim(${search}) = ''
                or coalesce(label, '') ilike '%' || trim(${search}) || '%'
                or coalesce(detail, '') ilike '%' || trim(${search}) || '%'`
            : sql`true`;
          return (
            <div>
              {firstSearchableDimension?.key === dimension.key && (
                <div className="sticky top-0 z-10 bg-background-surface pb-2">
                  <Input
                    bindScalar={props.searchScalar}
                    placeholder={dimension.searchPlaceholder ??
                      "Filter options"}
                    startIcon="Search"
                    size="xs"
                    fullWidth
                  />
                </div>
              )}
              <div className="rounded-lg border border-divider overflow-hidden">
                <div className="flex items-center gap-2 bg-level1 px-2 py-1.5 text-xs font-medium uppercase tracking-normal text-tertiary">
                  <MaterialIcon
                    icon={dimension.icon ?? "Work"}
                    fontSize="sm"
                  />
                  {dimension.label}
                </div>
                <Show
                  when={sql`(
                    select count(*)
                    from ${sql.ref(tableName)}
                    where ${tableMatchesSearch}
                  ) = 0`}
                >
                  <div className="px-2 py-2 text-sm text-tertiary">
                    {dimension.searchable
                      ? sql`case
                          when trim(${search}) <> '' then 'No matching jurisdictions'
                          else ${
                        sql.lit(
                          dimension.emptyMessage ?? "No options available",
                        )
                      }
                        end`
                      : dimension.emptyMessage ?? "No options available"}
                  </div>
                </Show>
                <Each
                  table={tableName}
                  recordName="choice"
                  where={matchesSearch}
                >
                  <button
                    type="button"
                    className={props.itemClassName}
                    onClick={(s) => {
                      const choice = {
                        id: sql`choice.id`,
                        label: sql`choice.label`,
                        detail: sql`choice.detail`,
                      };
                      if (dimension.activityOptions?.length) {
                        s.setScalar(
                          selectedDimensionScalar,
                          sql.lit(dimension.key),
                        );
                        s.setScalar(selectedIdScalar, choice.id);
                        s.setScalar(selectedLabelScalar, choice.label);
                        s.setScalar(selectedDetailScalar, choice.detail);
                        s.setScalar(selectedActivityScalar, sql.lit``);
                      } else {
                        clockIn(s, dimension, choice);
                      }
                    }}
                  >
                    <span className="min-w-0 truncate font-medium">
                      {sql`choice.label`}
                    </span>
                    <MaterialIcon icon="ChevronRight" fontSize="sm" />
                  </button>
                </Each>
              </div>
            </div>
          );
        })}
      </Show>
      <Show when={sql`${selectedDimension} <> ''`}>
        {props.dimensions.map((dimension) => (
          <Show when={sql`${selectedDimension} = ${sql.lit(dimension.key)}`}>
            <div className="rounded-lg border border-divider overflow-hidden">
              <div className="flex items-center justify-between gap-2 bg-level1 px-2 py-1.5">
                <span className="min-w-0 truncate text-sm font-medium">
                  {selectedChoice.label}
                </span>
                <Button
                  variant="plain"
                  color="neutral"
                  size="xs"
                  onClick={(s) => {
                    s.setScalar(selectedDimensionScalar, sql.lit``);
                    s.setScalar(selectedActivityScalar, sql.lit``);
                  }}
                >
                  Change
                </Button>
              </div>
              <div className="border-t border-divider p-2">
                <RadioGroup
                  aria-label="Activity"
                  size="xs"
                  color="primary"
                >
                  {dimension.activityOptions?.map((activity) => (
                    <Radio
                      value={sql.lit(activity.value)}
                      label={activity.label}
                      aria-label={activity.label}
                      checked={sql`${sql.ref(selectedActivityScalar)} = ${
                        sql.lit(activity.value)
                      }`}
                      onChange={(s) => {
                        s.setScalar(
                          selectedActivityScalar,
                          sql.lit(activity.value),
                        );
                        clockIn(
                          s,
                          dimension,
                          selectedChoice,
                          sql.lit(activity.value),
                        );
                      }}
                    />
                  ))}
                </RadioGroup>
              </div>
            </div>
          </Show>
        ))}
      </Show>
    </div>
  );
}

export function TimeClockWidget(props: TimeClockWidgetProps) {
  const useLockColumns = hasFullEntryEditing(props.actions);

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("clock_refresh_key", sql`0`);
        s.defScalar("show_picker", sql`false`);
        s.defScalar("clock_choice_search", sql.lit``);
        s.defScalar("clock_choice_dimension", sql.lit``);
        s.defScalar("clock_choice_id", sql`null::bigint`);
        s.defScalar("clock_choice_label", sql.lit``);
        s.defScalar("clock_choice_detail", sql.lit``);
        s.defScalar("clock_choice_activity", sql.lit``);
        s.defScalar("time_tracking_error", sql`null::string`);
      }}
    >
      <Data
        watch={[sql`clock_refresh_key`, sql`show_picker`]}
        procedure={(s) => {
          s.defRecord("active_clock", props.queries.activeEntry);
          s.if(sql`show_picker`, (s) => {
            for (const dimension of props.dimensions) {
              s.defTable(choiceTableName(dimension), dimension.query);
            }
          });
        }}
      >
        <div className="border-t border-divider px-3 py-2">
          <Show when={sql`time_tracking_error is not null`}>
            <Alert color="danger" variant="soft" className="mb-2">
              {sql`time_tracking_error`}
            </Alert>
          </Show>
          {props.longRunningWarning && (
            <Show
              when={sql`active_clock.id is not null
                and active_clock.elapsed_minutes >= ${props.longRunningWarning.thresholdMinutes}`}
            >
              <Alert
                color="warning"
                variant="soft"
                startIcon="Warning"
                className="mb-2"
                role="alert"
              >
                {props.longRunningWarning.message}
              </Alert>
            </Show>
          )}
          <Show when={sql`active_clock.id is null and not show_picker`}>
            <Button
              variant="soft"
              color="success"
              fullWidth
              startIcon="PlayArrow"
              onClick={(s) => {
                s.setScalar("clock_choice_search", sql.lit``);
                s.setScalar("clock_choice_dimension", sql.lit``);
                s.setScalar("show_picker", sql`true`);
              }}
            >
              {props.compactLabel ?? "Clock In"}
            </Button>
          </Show>

          <Show when={sql`active_clock.id is not null`}>
            <div
              className="flex items-center justify-between gap-2"
              onMount={(s) => {
                s.startTaskWithOpts({
                  detached: true,
                  procedure: (s) => {
                    s.while(sql`true`, (s) => {
                      s.sleep(60000);
                      s.increment("clock_refresh_key");
                      s.commitUiTreeChanges();
                    });
                  },
                });
              }}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={(s) =>
                  s.setScalar("show_picker", sql`not show_picker`)}
              >
                <Typography level="body-sm" color="success" startIcon="Timer">
                  Clocked In
                </Typography>
                <div className="truncate text-sm font-medium">
                  {sql`active_clock.title`}
                </div>
                <Show
                  when={sql`active_clock.subtitle is not null and active_clock.subtitle <> ''`}
                >
                  <div className="truncate text-xs text-tertiary">
                    {sql`active_clock.subtitle`}
                  </div>
                </Show>
                <div className="text-xs text-tertiary">
                  {durationExpr(sql`active_clock.elapsed_minutes`)}
                </div>
              </button>
              <IconButton
                variant="soft"
                color="danger"
                size="sm"
                icon="Stop"
                disabled={activeClockLockedExpr(useLockColumns)}
                tooltip={activeClockTooltip(useLockColumns)}
                onClick={(s) => {
                  s.setScalar("time_tracking_error", sql`null::string`);
                  s.tryServer({
                    errorName: "clock_out_error",
                    body: (server) => {
                      server.startTransaction();
                      props.actions.clockOut(server, sql`active_clock`, {
                        userIdExpr: props.userIdExpr,
                      });
                      server.commitTransaction();
                      server.increment("ui.clock_refresh_key");
                    },
                    catch: (s) => {
                      s.setScalar(
                        "time_tracking_error",
                        sql`coalesce(
                          nullif(clock_out_error.message, ''),
                          'Unable to clock out. Ask a manager to review the active time entry.'
                        )`,
                      );
                    },
                  });
                }}
              />
            </div>
          </Show>

          <Show when={sql`show_picker`}>
            <div className="mt-2 max-h-64 overflow-y-auto">
              <ClockChoiceList
                dimensions={props.dimensions}
                config={props}
                refreshKey="clock_refresh_key"
                closePickerScalar="show_picker"
                searchScalar="clock_choice_search"
                selectionPrefix="clock_choice"
                itemClassName="flex w-full items-center justify-between gap-2 border-t border-divider px-2 py-1.5 text-left text-sm hover:bg-level1"
              />
            </div>
            <Button
              variant="plain"
              color="neutral"
              size="sm"
              fullWidth
              onClick={(s) => s.setScalar("show_picker", sql`false`)}
            >
              Cancel
            </Button>
          </Show>
        </div>
      </Data>
    </Data>
  );
}

export function TimeTrackingPage(props: TimeTrackingPageProps) {
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  const showSidebarTrigger = props.showSidebarTrigger ?? true;
  const useFullEntryEditing = hasFullEntryEditing(props.actions);
  const useEntrySaving = hasEntrySaving(props.actions);

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("time_refresh_key", sql`0`);
        s.defScalar("show_picker", sql`false`);
        s.defScalar("time_choice_search", sql.lit``);
        s.defScalar("time_choice_dimension", sql.lit``);
        s.defScalar("time_choice_id", sql`null::bigint`);
        s.defScalar("time_choice_label", sql.lit``);
        s.defScalar("time_choice_detail", sql.lit``);
        s.defScalar("time_choice_activity", sql.lit``);
        s.defScalar("week_offset", sql`0`);
        s.defScalar("editing_entry_id", sql`null::bigint`);
        // Kept as raw datetime-local strings and cast to timestamptz on the
        // server: the DOM runtime casts strings in the browser's timezone
        // while entries render in the system timezone, so a client-side cast
        // shifts the saved times for any user outside the system timezone.
        s.defScalar("edit_clock_in", sql.lit``);
        s.defScalar("edit_clock_out", sql.lit``);
        s.defScalar("edit_notes", sql.lit``);
        s.defScalar("time_tracking_error", sql`null::string`);
      }}
    >
      <Data
        watch={[sql`time_refresh_key`]}
        procedure={(s) => {
          s.defRecord("active_clock", props.queries.activeEntry);
          s.defTable("today_entries", props.queries.todayEntries);
          for (const dimension of props.dimensions) {
            s.defTable(choiceTableName(dimension), dimension.query);
          }
        }}
      >
        <div className="h-full overflow-y-auto bg-background-body">
          <div className="mx-auto flex w-full max-w-5xl flex-col px-3 py-4 sm:px-6 sm:py-6">
            <div className="flex items-center gap-2">
              {showSidebarTrigger && hasSidebar?.autoTrigger && (
                <Sidebar.Trigger />
              )}
              <Typography level="h3">{props.title ?? "Time"}</Typography>
            </div>
            <Show when={sql`time_tracking_error is not null`}>
              <Alert color="danger" variant="soft" className="mt-4">
                {sql`time_tracking_error`}
              </Alert>
            </Show>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
              <div className="flex min-w-0 flex-col gap-4">
                <section className="rounded-lg border border-divider bg-background-surface p-4">
                  {props.longRunningWarning && (
                    <Show
                      when={sql`active_clock.id is not null
                        and active_clock.elapsed_minutes >= ${props.longRunningWarning.thresholdMinutes}`}
                    >
                      <Alert
                        color="warning"
                        variant="soft"
                        startIcon="Warning"
                        className="mb-4"
                        role="alert"
                      >
                        {props.longRunningWarning.message}
                      </Alert>
                    </Show>
                  )}
                  <Show
                    when={sql`active_clock.id is not null`}
                    fallback={
                      <div>
                        <div className="flex items-center gap-2">
                          <MaterialIcon icon="TimerOff" fontSize="lg" />
                          <Typography level="title-md">
                            Not Clocked In
                          </Typography>
                        </div>
                        <Show when={sql`not show_picker`}>
                          <Button
                            className="mt-4"
                            fullWidth
                            size="lg"
                            color="success"
                            startIcon="PlayArrow"
                            onClick={(s) => {
                              s.setScalar("time_choice_search", sql.lit``);
                              s.setScalar("time_choice_dimension", sql.lit``);
                              s.setScalar("show_picker", sql`true`);
                            }}
                          >
                            Clock In
                          </Button>
                        </Show>
                      </div>
                    }
                  >
                    <div
                      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                      onMount={(s) => {
                        s.startTaskWithOpts({
                          detached: true,
                          procedure: (s) => {
                            s.while(sql`true`, (s) => {
                              s.sleep(60000);
                              s.increment("time_refresh_key");
                              s.commitUiTreeChanges();
                            });
                          },
                        });
                      }}
                    >
                      <div className="min-w-0">
                        <Typography
                          level="body-sm"
                          color="success"
                          startIcon="Timer"
                        >
                          Clocked In
                        </Typography>
                        <Typography level="h4" className="truncate">
                          {sql`active_clock.title`}
                        </Typography>
                        <Show
                          when={sql`active_clock.subtitle is not null and active_clock.subtitle <> ''`}
                        >
                          <Typography level="body-sm" className="text-tertiary">
                            {sql`active_clock.subtitle`}
                          </Typography>
                        </Show>
                        <Typography level="body-sm" className="text-tertiary">
                          Started{" "}
                          {userLocalDateTimeExpr(sql`active_clock.clock_in`)}
                        </Typography>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                        <div className="text-3xl font-semibold">
                          {durationExpr(sql`active_clock.elapsed_minutes`)}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outlined"
                            color="neutral"
                            startIcon="SwapHoriz"
                            onClick={(s) => {
                              s.setScalar("time_choice_search", sql.lit``);
                              s.setScalar("time_choice_dimension", sql.lit``);
                              s.setScalar("show_picker", sql`true`);
                            }}
                          >
                            Switch
                          </Button>
                          <Button
                            color="danger"
                            startIcon="Stop"
                            disabled={activeClockLockedExpr(
                              useFullEntryEditing,
                            )}
                            onClick={(s) => {
                              s.setScalar(
                                "time_tracking_error",
                                sql`null::string`,
                              );
                              s.tryServer({
                                errorName: "clock_out_error",
                                body: (server) => {
                                  server.startTransaction();
                                  props.actions.clockOut(
                                    server,
                                    sql`active_clock`,
                                    { userIdExpr: props.userIdExpr },
                                  );
                                  server.commitTransaction();
                                  server.increment("ui.time_refresh_key");
                                },
                                catch: (s) => {
                                  s.setScalar(
                                    "time_tracking_error",
                                    sql`coalesce(
                                      nullif(clock_out_error.message, ''),
                                      'Unable to clock out. Ask a manager to review the active time entry.'
                                    )`,
                                  );
                                },
                              });
                            }}
                          >
                            Stop
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <Show when={sql`show_picker`}>
                    <div className="mt-4">
                      <ClockChoiceList
                        dimensions={props.dimensions}
                        config={props}
                        refreshKey="time_refresh_key"
                        closePickerScalar="show_picker"
                        searchScalar="time_choice_search"
                        selectionPrefix="time_choice"
                        itemClassName="flex w-full items-center justify-between gap-2 border-t border-divider px-2 py-1.5 text-left text-sm hover:bg-level1"
                      />
                      <Button
                        className="mt-2"
                        fullWidth
                        variant="plain"
                        color="neutral"
                        onClick={(s) => s.setScalar("show_picker", sql`false`)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </Show>
                </section>

                <section className="rounded-lg border border-divider bg-background-surface">
                  <div className="border-b border-divider px-4 py-3">
                    <Typography level="title-md">Recent Entries</Typography>
                  </div>
                  <div className="divide-y divide-divider">
                    <Show when={sql`(select count(*) from today_entries) = 0`}>
                      <div className="px-4 py-8 text-center text-sm text-tertiary">
                        No recent entries
                      </div>
                    </Show>
                    <Each table="today_entries" recordName="entry">
                      <div className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {sql`entry.title`}
                            </div>
                            <Show
                              when={sql`entry.subtitle is not null and entry.subtitle <> ''`}
                            >
                              <div className="truncate text-xs text-tertiary">
                                {sql`entry.subtitle`}
                              </div>
                            </Show>
                            <Show
                              when={sql`entry.is_duration`}
                              fallback={
                                <div className="text-xs text-tertiary">
                                  {userLocalDateTimeExpr(sql`entry.clock_in`)}
                                  {" - "}
                                  <Show when={sql`entry.clock_out is not null`}>
                                    {userLocalDateTimeExpr(
                                      sql`entry.clock_out`,
                                    )}
                                  </Show>
                                  <Show when={sql`entry.clock_out is null`}>
                                    <span className="text-success-700">
                                      ongoing
                                    </span>
                                  </Show>
                                </div>
                              }
                            >
                              <div className="text-xs text-tertiary">
                                {sql`format.date(entry.duration_date, '%m/%d/%Y')`}
                                {" · Manual duration"}
                              </div>
                            </Show>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <div className="mr-1 text-sm font-medium">
                              {durationExpr(sql`entry.minutes`)}
                            </div>
                            {useEntrySaving && (
                              <IconButton
                                variant="plain"
                                color="neutral"
                                size="sm"
                                icon="Edit"
                                disabled={entryEditDisabled(
                                  useFullEntryEditing,
                                )}
                                tooltip={entryActionTooltip(
                                  useFullEntryEditing,
                                  useFullEntryEditing
                                    ? "Edit entry"
                                    : "Edit notes",
                                )}
                                onClick={(s) => {
                                  s.setScalar(
                                    "editing_entry_id",
                                    sql`entry.id`,
                                  );
                                  if (useFullEntryEditing) {
                                    s.setScalar(
                                      "edit_clock_in",
                                      sql`format.date(entry.clock_in, '%Y-%m-%dT%H:%M')`,
                                    );
                                    s.setScalar(
                                      "edit_clock_out",
                                      sql`coalesce(format.date(entry.clock_out, '%Y-%m-%dT%H:%M'), '')`,
                                    );
                                  }
                                  s.setScalar(
                                    "edit_notes",
                                    sql`coalesce(entry.notes, '')`,
                                  );
                                }}
                              />
                            )}
                            <IconButton
                              variant="plain"
                              color="danger"
                              size="sm"
                              icon="Delete"
                              disabled={entryEditDisabled(useFullEntryEditing)}
                              tooltip={entryActionTooltip(
                                useFullEntryEditing,
                                "Delete entry",
                              )}
                              onClick={(s) => {
                                s.setScalar(
                                  "time_tracking_error",
                                  sql`null::string`,
                                );
                                s.tryServer({
                                  errorName: "delete_entry_error",
                                  body: (server) => {
                                    server.startTransaction();
                                    props.actions.deleteEntry(
                                      server,
                                      sql`entry`,
                                      { userIdExpr: props.userIdExpr },
                                    );
                                    server.commitTransaction();
                                    server.increment("ui.time_refresh_key");
                                  },
                                  catch: (s) => {
                                    s.setScalar(
                                      "time_tracking_error",
                                      sql`coalesce(
                                        nullif(delete_entry_error.message, ''),
                                        'Unable to delete this time entry.'
                                      )`,
                                    );
                                  },
                                });
                              }}
                            />
                          </div>
                        </div>
                        {useEntrySaving && (
                          <Show when={sql`editing_entry_id = entry.id`}>
                            <div
                              className={useFullEntryEditing
                                ? "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                                : "mt-3 flex flex-col gap-2 sm:flex-row"}
                            >
                              {useFullEntryEditing && (
                                <>
                                  <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-secondary">
                                    Start
                                    <input
                                      className="min-h-9 rounded border border-divider bg-background-surface px-3 text-sm text-primary"
                                      type="datetime-local"
                                      required
                                      value={sql`edit_clock_in`}
                                      onInput={(s) =>
                                        s.setScalar(
                                          "edit_clock_in",
                                          sql`target_value`,
                                        )}
                                    />
                                  </label>
                                  <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-secondary">
                                    End (optional)
                                    <input
                                      className="min-h-9 rounded border border-divider bg-background-surface px-3 text-sm text-primary"
                                      type="datetime-local"
                                      value={sql`edit_clock_out`}
                                      onInput={(s) =>
                                        s.setScalar(
                                          "edit_clock_out",
                                          sql`target_value`,
                                        )}
                                    />
                                  </label>
                                </>
                              )}
                              <input
                                className={useFullEntryEditing
                                  ? "min-h-9 rounded border border-divider bg-background-surface px-3 text-sm sm:col-span-2"
                                  : "min-h-9 flex-1 rounded border border-divider bg-background-surface px-3 text-sm"}
                                placeholder="Add notes..."
                                value={sql`edit_notes`}
                                onInput={(s) =>
                                  s.setScalar("edit_notes", sql`target_value`)}
                              />
                              <Button
                                size="sm"
                                color="primary"
                                disabled={entrySaveDisabled(
                                  useFullEntryEditing,
                                )}
                                onClick={(s) => {
                                  s.setScalar(
                                    "time_tracking_error",
                                    sql`null::string`,
                                  );
                                  s.defScalar(
                                    "save_entry_succeeded",
                                    sql`false`,
                                  );
                                  s.tryServer({
                                    errorName: "save_entry_error",
                                    body: (server) => {
                                      server.startTransaction();
                                      if (props.actions.saveEntry) {
                                        props.actions.saveEntry(
                                          server,
                                          sql`entry`,
                                          editedClockTimestampExpr(
                                            sql`ui.edit_clock_in`,
                                          ),
                                          editedClockTimestampExpr(
                                            sql`ui.edit_clock_out`,
                                          ),
                                          sql`ui.edit_notes`,
                                          { userIdExpr: props.userIdExpr },
                                        );
                                      } else if (props.actions.saveNotes) {
                                        props.actions.saveNotes(
                                          server,
                                          sql`entry`,
                                          sql`ui.edit_notes`,
                                          { userIdExpr: props.userIdExpr },
                                        );
                                      }
                                      server.commitTransaction();
                                      server.increment("ui.time_refresh_key");
                                      server.setScalar(
                                        "save_entry_succeeded",
                                        sql`true`,
                                      );
                                    },
                                    catch: (s) => {
                                      s.setScalar(
                                        "time_tracking_error",
                                        sql`coalesce(
                                          nullif(save_entry_error.message, ''),
                                          ${
                                          useFullEntryEditing
                                            ? sql
                                              .lit`Unable to save this time entry.`
                                            : sql
                                              .lit`Unable to save these notes.`
                                        }
                                        )`,
                                      );
                                    },
                                  });
                                  s.if(sql`save_entry_succeeded`, (s) => {
                                    s.setScalar(
                                      "editing_entry_id",
                                      sql`null::bigint`,
                                    );
                                  });
                                }}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="plain"
                                color="neutral"
                                onClick={(s) =>
                                  s.setScalar(
                                    "editing_entry_id",
                                    sql`null::bigint`,
                                  )}
                              >
                                Cancel
                              </Button>
                            </div>
                          </Show>
                        )}
                        <Show
                          when={sql`entry.notes is not null and entry.notes <> '' and editing_entry_id <> entry.id`}
                        >
                          <div className="mt-2 text-sm text-tertiary">
                            {sql`entry.notes`}
                          </div>
                        </Show>
                      </div>
                    </Each>
                  </div>
                </section>
              </div>

              <section className="rounded-lg border border-divider bg-background-surface lg:sticky lg:top-4 lg:self-start">
                <div className="flex items-center justify-between gap-2 border-b border-divider px-4 py-3">
                  <Typography level="title-md">Week</Typography>
                  <div className="flex items-center gap-1">
                    <IconButton
                      variant="plain"
                      color="neutral"
                      size="sm"
                      icon="ChevronLeft"
                      tooltip="Previous week"
                      onClick={(s) =>
                        s.setScalar("week_offset", sql`week_offset - 1`)}
                    />
                    <Button
                      variant="plain"
                      color="neutral"
                      size="sm"
                      onClick={(s) => s.setScalar("week_offset", sql`0`)}
                    >
                      This Week
                    </Button>
                    <IconButton
                      variant="plain"
                      color="neutral"
                      size="sm"
                      icon="ChevronRight"
                      tooltip="Next week"
                      onClick={(s) =>
                        s.setScalar("week_offset", sql`week_offset + 1`)}
                    />
                  </div>
                </div>
                <Data
                  watch={[sql`week_offset`, sql`time_refresh_key`]}
                  procedure={(s) => {
                    s.defScalar(
                      "week_start",
                      sql`date.add(day, -((cast(extract(dow from current_date()) as integer) + 6) % 7) + (week_offset * 7), current_date())`,
                    );
                    s.defTable(
                      "weekly_entries",
                      props.queries.weekEntries(sql`week_start`),
                    );
                    s.defScalar(
                      "week_total_minutes",
                      sql`(select coalesce(sum(total_minutes), 0) from weekly_entries)`,
                    );
                  }}
                >
                  <div className="px-4 py-3">
                    <div className="mb-3 flex items-center gap-1 rounded bg-level1 px-3 py-2 text-sm">
                      <span className="text-tertiary">Total</span>
                      <span className="font-semibold">
                        {durationExpr(sql`week_total_minutes`)}
                      </span>
                    </div>
                    <div className="divide-y divide-divider">
                      <Show
                        when={sql`(select count(*) from weekly_entries) = 0`}
                      >
                        <div className="py-6 text-center text-sm text-tertiary">
                          No entries this week
                        </div>
                      </Show>
                      <Each table="weekly_entries" recordName="we">
                        <div className="flex items-center justify-between gap-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium">
                              {sql`format.date(we.entry_date, '%a %m/%d')`}
                            </div>
                            <div className="truncate text-tertiary">
                              {sql`we.area_name`}
                            </div>
                          </div>
                          <div className="shrink-0 font-medium">
                            {durationExpr(sql`we.total_minutes`)}
                          </div>
                        </div>
                      </Each>
                    </div>
                  </div>
                </Data>
              </section>
            </div>
          </div>
        </div>
      </Data>
    </Data>
  );
}
