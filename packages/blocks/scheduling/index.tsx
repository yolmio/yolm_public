import {
  deleteMeetingFromTable,
  enqueueBackgroundTask,
  ensureCalendarCreationId,
  pollGoogleMeetConference,
} from "blocks/scheduling/background_task_helpers";
import { AvailabilityBlock } from "blocks/availability";
import type { CalendarIntegrationConstructor } from "blocks/calendar_integrations";
import { GoogleCalendarIntegration } from "blocks/calendar_integrations/google";
import { OutlookCalendarIntegration } from "blocks/calendar_integrations/outlook";
import type { MeetingIntegrationConstructor } from "blocks/meeting_integrations";
import { ensureLexicalRichTextFunctions } from "components/lexical/components/lexical_scalar_functions";
import type { TimezoneRegion } from "components/select_timezone";
import { getCapabilities } from "std/yolm_gen_api";
import { storedScheduledProc } from "std/scheduled_utils";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type {
  GeneralServerStatements,
  HelperProcField,
  IServerBaseStatements,
} from "std/statements";
import { system } from "std/system";
import type { Block, TableBuilder } from "std/system";
import { sourceMap } from "std/utils";
import { AppointmentsPage } from "./appointments_page";
import { DevDefinedSchedulingPages } from "./dev_defined_scheduling_pages";
import { inviteeEmailFooter, inviteeEmailWithFooter } from "./emails";
import { ErrorIntegrationsPage, IntegrationsPage } from "./integrations";
import { PreviewAvailabilityPage } from "./preview_availability_page";
import { TimeOffPage } from "./time_off_page";

interface CalendarIntegrationConfig {
  integration: CalendarIntegrationConstructor;
  addToCalendar: boolean;
  checkForConflicts: boolean;
  eventIdField: string;
}

interface DevEmailConfig {
  setupScope?: <T extends IServerBaseStatements>(
    s: T,
    appointmentRecord: Sql,
  ) => void;
  from: string;
  replyTo?: (appointmentRecord: Sql) => Sql;
  subject: (appointmentRecord: Sql) => Sql;
  body?: (appointmentRecord: Sql) => Sql;
  getUserEmail?: (appointmentRecord: Sql) => Sql;
  extraRecipients?: string[];
  // wrap the body with the footer for reschedule and cancel
  standardTemplate?: {
    body: (appointmentRecord: Sql) => Sql;
    title: Sql;
  };
}

interface DevHostEmailConfig extends DevEmailConfig {
  getUserEmail: (appointmentRecord: Sql) => Sql;
}

/**
 * A statically-defined event type whose schema, durations, and notification
 * behavior are fixed in code (rather than configured at runtime through the
 * `scheduling_event_types` table). Each entry gets its own appointment table
 * (`tableName`) and notification status table.
 */
export interface DevDefinedEventType {
  displayName: string;
  /** Name of the appointment table generated for this event type. */
  tableName: string;
  /** Default meeting length in minutes. */
  duration: number;
  /** Padding before the meeting, in minutes. */
  bufferBefore: number;
  /** Padding after the meeting, in minutes. */
  bufferAfter: number;
  /** Minimum lead time before a slot can be booked, in minutes. */
  minNotice: number;
  /** Furthest-out a slot can be booked, in minutes. */
  maxNotice: number;
  /** Spacing between offered start times, in minutes. */
  timeSlotsInterval: number;
  /** Adds event-type-specific columns to the appointment table. */
  defineFields: (table: TableBuilder) => void;
  /** Restricts which `sys_users` can host this event type. */
  sysUserFilter?: (userRecord: Sql) => Sql;
  /** Resolves the host's email address from an appointment record. */
  getUserEmail?: (appointmentRecord: Sql) => Sql;
  meetingLocation: "custom" | "google_meet" | "zoom" | "phone";
  /** Computes the external calendar event title from an appointment record. */
  calendarTitle?: (appointmentRecord: Sql) => Sql;
  /** Computes the external calendar event description. */
  calendarDescription?: (appointmentRecord: Sql) => Sql;
  /**
   * Additional fixed guests to add to the calendar event on creation, in
   * addition to the invitee and host. Only applied for the Google Meet path
   * today.
   */
  extraAttendees?: { email: string; displayName?: string }[];
  /**
   * When true, Google sends an invitation email to attendees on the created
   * event (and Google-account attendees get the event auto-added to their
   * calendar). Defaults to false: the event is created silently and the
   * invitee/extra guests are only listed as attendees on the host's calendar.
   */
  sendCalendarInvites?: boolean;
  /** Domain the public booking page for this event type is served from. */
  schedulingDomain: string;
  /** URL path (under `schedulingDomain`) of the public booking page. */
  schedulingPath: string;
  notifications?: {
    emailReminders?: (DevEmailConfig & { minutesBefore: number })[];
    confirmationEmail?: DevEmailConfig;
    cancellationEmail?: DevEmailConfig;
    hostConfirmationEmail?: DevHostEmailConfig;
    hostCancellationEmail?: DevHostEmailConfig;
    hostRescheduleEmail?: DevHostEmailConfig;
    inviteeRescheduleEmail?: DevEmailConfig;
  };
}

interface MeetingIntegrationConfig {
  integration: MeetingIntegrationConstructor;
  addToMeeting: boolean;
  meetingIdField: string;
}

/**
 * Declares an extra invitee/appointment field captured at booking time and
 * stored on the appointment table. Also exposed as a notification variable so
 * its value can be referenced in email/SMS templates.
 */
export interface AppointmentFieldType {
  name: string;
  type: "String" | "BigInt" | "Email" | "Phone" | "Text" | "Boolean" | "Uint";

  maxLength?: number; // For String/Text types
}

export interface DevDefinedSchedulingBlockOpts {
  timezoneRegion?: TimezoneRegion;
  calendarIntegrations: CalendarIntegrationConfig[];
  meetingIntegrations?: MeetingIntegrationConfig[];
  appointmentFieldTypes?: AppointmentFieldType[];
  devDefinedEventTypes?: DevDefinedEventType[];
  extensions?: SchedulingBlockExtensions;
  userDefinedEventTypes?: never;
  checkConditions?: never;
  autoUserDefinedEventTypesSchedulingApps?: never;
}

/**
 * Optional hooks for injecting custom logic into the scheduling block's
 * background-task and notification pipelines. Pass via
 * {@link DevDefinedSchedulingBlockOpts} `extensions`.
 */
export interface SchedulingBlockExtensions {
  /** Runs before each background task (calendar/meeting/email) is processed. */
  beforeBackgroundTask?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { taskRecord: Sql },
  ) => void;
  /** Runs when a background task fails, with the logged error record. */
  onBackgroundTaskError?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { taskRecord: Sql; errorRecord: Sql },
  ) => void;
  /** Runs when sending a notification fails, with the logged error record. */
  onNotificationError?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { appointmentId: AnyExpr; emailType: string; errorRecord: Sql },
  ) => void;
  /** Runs immediately before each notification of the given type is sent. */
  beforeNotification?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { appointmentId: AnyExpr; emailType: string },
  ) => void;
}

/**
 Provides a complete scheduling system with event types, appointments, and notifications.

 Provides functionality for:
 - Event types with customizable durations, buffers, and locations
 - Appointment scheduling with availability checking
 - Email and SMS notifications for confirmations, reminders and cancellations
 - Calendar integration for blocking off unavailable times
 - Webhook support for external integrations
 - Rescheduling and cancellation flows
 - ICS calendar attachments

 This package block supports dev-defined event types and provides the shared
 scheduling engine and components. Runtime-defined event types are implemented
 directly by their owning system rather than as a reusable package block.

@category Block

@example
[Example](../../../examples/scheduling/core.tsx)

 */
export class SchedulingBlock implements Block {
  blockName = "SchedulingBlock";
  blockDisplayName = "Scheduling";
  externalServiceOptions = [
    { optionKey: "send_emails", optionLabel: "Send email notifications" },
    { optionKey: "send_sms", optionLabel: "Send SMS notifications" },
  ];
  #caps = getCapabilities()?.blocks?.SchedulingBlock;
  componentDependencies: string[] = [];
  description: string | undefined;
  opts: DevDefinedSchedulingBlockOpts;

  constructor(opts: DevDefinedSchedulingBlockOpts) {
    this.opts = opts;
  }

  initialize() {
    const db = system.db;
    ensureLexicalRichTextFunctions(system);
    if (system.hasBlock(AvailabilityBlock)) {
      throw new Error(
        "SchedulingBlock automatically registers AvailabilityBlock; remove the separately registered AvailabilityBlock instance",
      );
    }
    const block = new AvailabilityBlock();
    system.addBlock(block);
    block.definedByBlock = this.blockName;

    system.enum_({
      name: "scheduling_background_task_type",
      values: [
        "calendar_add",
        "calendar_update",
        "calendar_delete",
        "meeting_create",
        "meeting_update",
        "meeting_delete",
        "notification_send",
        "email_host",
        "email_invitee_reschedule",
        "email_dev",
        "calendar_cleanup",
      ],
    });

    system.enum_({
      name: "scheduling_appointment_status",
      values: [
        "scheduled",
        "completed", // will remove on next upgrade
        "cancelled_by_invitee",
        "cancelled_by_host",
        "cancelled_by_admin",
        "no_show",
        "no_show_early",
        "creating",
      ],
    });
    system.enum_({
      name: "scheduling_appointment_email_status",
      values: [
        "pending",
        { name: "failed_confirmation", renameFrom: "failed" },
        "failed_reminder",
        "failed_cancellation",
        "sent",
      ],
    });
    system.enum_({
      name: "scheduling_appointment_email_type",
      values: ["email", "sms"],
    });

    for (const devDefinedEventType of this.opts.devDefinedEventTypes ?? []) {
      db.table(devDefinedEventType.tableName, (table) => {
        // this may not be the best behavior, but I'll just disable the sample data for now
        table.sampleData({
          skipSampleData: true,
        });
        table.fk("sys_users").notNull();
        table.timestampTz("start_time").notNull();
        table.smallUint("duration").notNull();
        table.smallUint("buffer_before").notNull();
        table.smallUint("buffer_after").notNull();
        table.enum("status", "scheduling_appointment_status").notNull();
        table.uuid("public_id").notNull().unique();
        table.string("cancel_reason", 500);
        table.timestampUtc("cancelled_at");
        table.string("reschedule_reason", 500);
        table.string("reassign_reason", 500);
        devDefinedEventType.defineFields(table);
        this.generateAppointmentFields(table);
        for (const calendarIntegration of this.opts.calendarIntegrations) {
          table.string(calendarIntegration.eventIdField, 255);
          if (calendarIntegration.integration === OutlookCalendarIntegration) {
            table.uuid(`${calendarIntegration.eventIdField}_creation_id`);
          }
        }
        for (const meetingIntegration of this.opts?.meetingIntegrations ?? []) {
          table.string(meetingIntegration.meetingIdField, 255);
          table.string(`${meetingIntegration.meetingIdField}_join_url`, 2000);
        }
        if (devDefinedEventType.meetingLocation === "google_meet") {
          table.string("google_conference_link", 2_000);
        }
      });
      system.enum_({
        name: `${devDefinedEventType.tableName}_notification_type`,
        values: [
          "invitee_confirmation_email",
          "invitee_reschedule_email",
          "invitee_cancellation_email",
          "host_confirmation_email",
          "host_reschedule_email",
          "host_cancellation_email",
          ...(devDefinedEventType.notifications?.emailReminders?.map(
            (_, i) => `email_reminder_${i}`,
          ) ?? []),
        ],
      });
      system.enum_({
        name: `${devDefinedEventType.tableName}_notification_status`,
        values: ["pending", "failed", "sent", "noop"],
      });
      db.table(
        `${devDefinedEventType.tableName}_notifications_status`,
        (table) => {
          table.sampleData({
            skipSampleData: true,
          });
          table.fk(devDefinedEventType.tableName).notNull();
          table
            .enum("type", `${devDefinedEventType.tableName}_notification_type`)
            .notNull();
          table.string("error", 5_000);
          table
            .enum(
              "status",
              `${devDefinedEventType.tableName}_notification_status`,
            )
            .notNull();
        },
      );
    }
    system.enum_({
      name: "scheduling_integration_error_type",
      values: ["google", "outlook", "calendar_task", "meeting_task"],
    });
    db.table("scheduling_integration_errors", (table) => {
      table.string("error", 5000);
      table.string("calendar_id", 500);
      table.enum("type", "scheduling_integration_error_type").notNull();
      table.timestampUtc("timestamp").notNull();
      table.json("raw_response");
      table.fk("sys_users");
      table.enum("task_type", "scheduling_background_task_type");
      table.string("appointment_table", 200);
      table.bigUint("appointment_id");
      table.ttlFrom("timestamp", sql`date.add(week, -1, now())`);
    });
    db.table("scheduling_google_integration_logs", (table) => {
      table.sampleData({ skipSampleData: true });
      table.string("operation", 100).notNull();
      table.json("raw_response");
      table.bool("success").notNull();
      table.string("error_message", 5000);
      table.fk("sys_users");
      table.string("appointment_table", 200);
      table.bigUint("appointment_id");
      table.timestampUtc("logged_at").notNull().default(sql`now()`);
      table.ttlFrom("logged_at", sql`date.add(week, -1, now())`);
    });
    db.table("scheduling_outlook_integration_logs", (table) => {
      table.sampleData({ skipSampleData: true });
      table.string("operation", 100).notNull();
      table.json("raw_response");
      table.bool("success").notNull();
      table.string("error_message", 5000);
      table.fk("sys_users");
      table.string("appointment_table", 200);
      table.bigUint("appointment_id");
      table.timestampUtc("logged_at").notNull().default(sql`now()`);
      table.ttlFrom("logged_at", sql`date.add(week, -1, now())`);
    });
    db.table("scheduling_notification_logs", (table) => {
      table.sampleData({ skipSampleData: true });
      table.string("notification_type", 100).notNull();
      table.string("appointment_table", 200).notNull();
      table.bigUint("appointment_id");
      table.string("recipient", 500);
      table.bool("success").notNull();
      table.string("error_message", 5000);
      table.timestampUtc("logged_at").notNull().default(sql`now()`);
      table.ttlFrom("logged_at", sql`date.add(day, -1, now())`);
    });

    if (this.opts.calendarIntegrations) {
      system.enum_({
        name: "integration_type",
        values: ["google", "outlook"],
      });
      db.table("integration_failed_refresh_log", (table) => {
        table.int("account_id").notNull();
        table.fk("sys_users").notNull();
        table.enum("integration_name", "integration_type").notNull();
        table.timestamp("failed_timestamp").notNull();
        table.string("error_message", 4000).notNull();
      });
    }

    db.table("scheduling_background_tasks", (table) => {
      table.sampleData({ skipSampleData: true });
      table
        .enum("task_type", "scheduling_background_task_type")
        .notNull();
      table.string("appointment_table", 200).notNull();
      table.bigInt("appointment_id");
      table.bigInt("calendar_id");
      table.string("calendar_table", 200);
      table.string("email_type", 100);
      table.string("provider", 100);
      table.bigInt("target_user_id");
      table.string("external_resource_id", 2_000);
      table.smallUint("attempt_count").default(0);
      table.timestampUtc("next_attempt_at").default(sql`now()`);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
    });

    const devTypesWithReminders = (
      this.opts.devDefinedEventTypes ?? []
    ).filter((t) => t.notifications?.emailReminders?.length);
    if (devTypesWithReminders.length > 0) {
      storedScheduledProc({
        name: "scheduling_dev_email_reminder_proc",
        schedule: "0 * * * * *",
        procedure: (s) => {
          for (const devType of devTypesWithReminders) {
            const notificationTable =
              `${devType.tableName}_notifications_status`;
            const fkField = Object.values(
              system.db.tables[notificationTable].fields,
            ).find(
              (field) =>
                field.type === "ForeignKey" &&
                field.table === devType.tableName,
            )!;
            for (
              const [i, reminder] of devType.notifications!.emailReminders!
                .entries()
            ) {
              const reminderType = `email_reminder_${i}`;
              s.forEachQuery(
                sql`select app.id as appointment_id
                  from db.${sql.ref(devType.tableName)} app
                  where
                    app.start_time > now() and
                    app.status = 'scheduled' and
                    app.start_time <= date.add(minute, ${reminder.minutesBefore}, now()) and
                    not exists (
                      select 1 from db.${sql.ref(notificationTable)}
                      where ${fkField.ident} = app.id
                        and type = ${sql.lit(reminderType)}
                    ) and
                    not exists (
                      select 1 from db.scheduling_background_tasks bg
                      where bg.task_type = 'email_dev'
                        and bg.appointment_table = ${sql.lit(devType.tableName)}
                        and bg.appointment_id = app.id
                        and bg.email_type = ${sql.lit(reminderType)}
                    )`,
                `triggered_${devType.tableName}_${i}`,
                (s) => {
                  this.enqueueBackgroundTask(s, {
                    taskType: "email_dev",
                    appointmentTable: devType.tableName,
                    appointmentId: sql`${
                      sql.ref(`triggered_${devType.tableName}_${i}`)
                    }.appointment_id`,
                    emailType: reminderType,
                  });
                },
              );
            }
          }
        },
      });
    }

    this.description =
      "Provides a way to schedule appointments and send notifications to users.";
  }

  /**
   * Inserts a row into `scheduling_background_tasks` so the scheduled worker
   * picks up calendar/meeting/email side effects asynchronously. No-ops when
   * the relevant id is null. Wraps the insert in its own transaction unless
   * `insideTransaction` is set.
   */
  enqueueBackgroundTask<T extends IServerBaseStatements>(
    s: T,
    opts: Parameters<typeof enqueueBackgroundTask>[1],
  ) {
    enqueueBackgroundTask(s, opts);
  }

  /**
   * Removes queued work that can create or mutate external resources for an
   * appointment. The caller must already be inside the transaction that makes
   * the appointment ineligible for that work.
   */
  retirePendingAppointmentMutationTasks<T extends IServerBaseStatements>(
    s: T,
    opts: {
      appointmentTable: string;
      appointmentId: NumericExpr;
    },
  ) {
    s.block((s) => {
      s.defScalar("mutation_appointment_id", opts.appointmentId);
      s.modify(
        sql`delete from db.scheduling_background_tasks
          where appointment_table = ${sql.lit(opts.appointmentTable)}
            and appointment_id = mutation_appointment_id
            and task_type in (
              'calendar_add',
              'calendar_update',
              'meeting_create',
              'meeting_update'
            )`,
      );
    });
  }

  /**
   * Moves a dev-defined appointment to a new host while preserving immutable
   * cleanup identity for resources owned by the previous host.
   */
  transferDevDefinedAppointmentHost<T extends IServerBaseStatements>(
    s: T,
    opts: {
      eventType: DevDefinedEventType;
      appointmentRecord: Sql;
      newUserId: NumericExpr;
      reason: Sql;
    },
  ) {
    const tableName = opts.eventType.tableName;
    const requiresMeetingCreation =
      (opts.eventType.meetingLocation === "google_meet" &&
        this.opts.calendarIntegrations.some(
          (integration) =>
            integration.integration === GoogleCalendarIntegration &&
            integration.addToCalendar,
        )) ||
      (this.opts.meetingIntegrations ?? []).some((integration) => {
        const meetingBlock = system.block(integration.integration);
        return integration.addToMeeting &&
          meetingBlock.integrationName.toLowerCase().replaceAll(" ", "_") ===
            opts.eventType.meetingLocation;
      });
    for (const integration of this.opts.calendarIntegrations) {
      const calendarBlock = system.block(integration.integration);
      s.if(
        sql`${opts.appointmentRecord}.${
          sql.ref(integration.eventIdField)
        } is not null`,
        (s) => {
          this.enqueueBackgroundTask(s, {
            taskType: "calendar_delete",
            appointmentTable: tableName,
            appointmentId: sql`${opts.appointmentRecord}.id`,
            provider: calendarBlock.integrationName,
            targetUserId: sql`${opts.appointmentRecord}.sys_user_id`,
            externalResourceId: sql`${opts.appointmentRecord}.${
              sql.ref(integration.eventIdField)
            }`,
            insideTransaction: true,
          });
        },
      );
    }
    for (const integration of this.opts.meetingIntegrations ?? []) {
      const meetingBlock = system.block(integration.integration);
      s.if(
        sql`${opts.appointmentRecord}.${
          sql.ref(integration.meetingIdField)
        } is not null`,
        (s) => {
          this.enqueueBackgroundTask(s, {
            taskType: "meeting_delete",
            appointmentTable: tableName,
            appointmentId: sql`${opts.appointmentRecord}.id`,
            provider: meetingBlock.integrationName,
            targetUserId: sql`${opts.appointmentRecord}.sys_user_id`,
            externalResourceId: sql`${opts.appointmentRecord}.${
              sql.ref(integration.meetingIdField)
            }`,
            insideTransaction: true,
          });
        },
      );
    }
    this.retirePendingAppointmentMutationTasks(s, {
      appointmentTable: tableName,
      appointmentId: sql`${opts.appointmentRecord}.id`,
    });
    s.modify(
      sql`update db.${sql.ref(tableName)}
        set sys_user_id = ${opts.newUserId},
          reassign_reason = ${opts.reason},
          status = ${
        sql.lit(requiresMeetingCreation ? "creating" : "scheduled")
      },
          public_id = random.uuid()${
        opts.eventType.meetingLocation === "google_meet"
          ? sql`, google_conference_link = null`
          : sql``
      }
        where id = ${opts.appointmentRecord}.id
          and status = 'scheduled'`,
    );
    for (const integration of this.opts.calendarIntegrations) {
      s.modify(
        sql`update db.${sql.ref(tableName)}
          set ${sql.ref(integration.eventIdField)} = null${
          integration.integration === OutlookCalendarIntegration
            ? sql`, ${
              sql.ref(`${integration.eventIdField}_creation_id`)
            } = null`
            : sql``
        }
          where id = ${opts.appointmentRecord}.id`,
      );
    }
    for (const integration of this.opts.meetingIntegrations ?? []) {
      s.modify(
        sql`update db.${sql.ref(tableName)}
          set ${sql.ref(integration.meetingIdField)} = null,
            ${sql.ref(`${integration.meetingIdField}_join_url`)} = null
          where id = ${opts.appointmentRecord}.id`,
      );
    }
    for (const integration of this.opts.calendarIntegrations) {
      if (!integration.addToCalendar) continue;
      const calendarBlock = system.block(integration.integration);
      this.enqueueBackgroundTask(s, {
        taskType: "calendar_add",
        appointmentTable: tableName,
        appointmentId: sql`${opts.appointmentRecord}.id`,
        provider: calendarBlock.integrationName,
        targetUserId: opts.newUserId,
        insideTransaction: true,
      });
    }
    for (const integration of this.opts.meetingIntegrations ?? []) {
      const meetingBlock = system.block(integration.integration);
      if (
        !integration.addToMeeting ||
        meetingBlock.integrationName.toLowerCase().replaceAll(" ", "_") !==
          opts.eventType.meetingLocation
      ) {
        continue;
      }
      this.enqueueBackgroundTask(s, {
        taskType: "meeting_create",
        appointmentTable: tableName,
        appointmentId: sql`${opts.appointmentRecord}.id`,
        provider: meetingBlock.integrationName,
        targetUserId: opts.newUserId,
        insideTransaction: true,
      });
    }
  }

  getDevDefinedEventType(tableName: string) {
    return this.opts.devDefinedEventTypes?.find(
      (type) => type.tableName === tableName,
    );
  }

  private generateAppointmentFields(table: TableBuilder) {
    if (!this.opts.appointmentFieldTypes) {
      return;
    }

    for (const field of this.opts.appointmentFieldTypes) {
      switch (field.type) {
        case "String":
          table.string(field.name, field.maxLength || 255);
          break;
        case "BigInt":
          table.bigInt(field.name);
          break;
        case "Email":
          table.email(field.name);
          break;
        case "Phone":
          table.phoneNumber(field.name);
          break;
        case "Text":
          table.text(field.name, field.maxLength || 2000);
          break;
        case "Boolean":
          table.bool(field.name);
          break;
        case "Uint":
          table.uint(field.name);
          break;
      }
    }
  }

  private googleCalendarIntegrationFirst(): CalendarIntegrationConfig[] {
    return [...this.opts.calendarIntegrations].sort((a, b) => {
      const aIsGoogle = a.integration === GoogleCalendarIntegration;
      const bIsGoogle = b.integration === GoogleCalendarIntegration;
      return aIsGoogle === bIsGoogle ? 0 : aIsGoogle ? -1 : 1;
    });
  }

  private inviteeEmail(
    tableName: string,
    appointmentRecord: Sql,
    devType?: DevDefinedEventType,
  ): Sql | undefined {
    if (devType?.getUserEmail) {
      return devType.getUserEmail(appointmentRecord);
    }
    if (system.db.tables[tableName].fields.invitee_email) {
      return sql`${appointmentRecord}.invitee_email`;
    }
    return undefined;
  }

  private inviteeDisplayName(
    tableName: string,
    appointmentRecord: Sql,
    devType?: DevDefinedEventType,
  ): Sql {
    const table = system.db.tables[tableName];
    const email = this.inviteeEmail(tableName, appointmentRecord, devType) ??
      sql.null;
    if (table.fields.invitee_name) {
      return sql`coalesce(
        nullif(trim(${appointmentRecord}.invitee_name), ''),
        ${email},
        'Invitee'
      )`;
    }
    if (table.fields.invitee_first_name || table.fields.invitee_last_name) {
      const firstName = table.fields.invitee_first_name
        ? sql`coalesce(${appointmentRecord}.invitee_first_name, '')`
        : sql.lit``;
      const lastName = table.fields.invitee_last_name
        ? sql`coalesce(${appointmentRecord}.invitee_last_name, '')`
        : sql.lit``;
      return sql`coalesce(
        nullif(trim(${firstName} || ' ' || ${lastName}), ''),
        ${email},
        'Invitee'
      )`;
    }
    return sql`coalesce(${email}, 'Invitee')`;
  }

  private devDefinedMeetingTopic(
    devType: DevDefinedEventType,
    appointmentRecord: Sql,
  ): Sql {
    return sql`${sql.lit(devType.displayName)} || ' - ' || ${
      this.inviteeDisplayName(
        devType.tableName,
        appointmentRecord,
        devType,
      )
    }`;
  }

  devDefinedDefaultSetupScope<T extends IServerBaseStatements>(
    s: T,
    opts: {
      type: DevDefinedEventType;
      appointmentId: NumericExpr;
    },
  ) {
    s.defScalar("appointment_date", {
      expr: sql`format.date(appointment_record.start_time, '%A, %B %d, %Y')`,
      allowNoRead: true,
    });
    s.defScalar("appointment_time", {
      expr: sql`format.date(appointment_record.start_time, '%I:%M %p')`,
      allowNoRead: true,
    });
    s.defScalar("user_email", {
      expr: this.inviteeEmail(
        opts.type.tableName,
        sql.ref("appointment_record"),
        opts.type,
      ) ?? sql.null,
      allowNoRead: true,
    });
    const sysUser = system.db.tables.sys_users;
    s.defScalar("user_name", {
      expr:
        sql`(select ${sysUser.getRecordDisplayNameExpr()} from sys_users where id = appointment_record.sys_user_id)`,
      allowNoRead: true,
    });
    s.defScalar("invitee_name", {
      expr: this.inviteeDisplayName(
        opts.type.tableName,
        sql.ref("appointment_record"),
        opts.type,
      ),
      allowNoRead: true,
    });
  }

  @sourceMap
  sendDevEmail<T extends IServerBaseStatements>(
    s: T,
    opts: {
      type: DevDefinedEventType;
      email: DevEmailConfig;
      appointmentId: NumericExpr;
      emailType:
        | "invitee_confirmation_email"
        | "invitee_reschedule_email"
        | "invitee_cancellation_email"
        | "host_confirmation_email"
        | "host_reschedule_email"
        | "host_cancellation_email"
        | `email_reminder_${number}`;
      idempotencyKey?: Sql;
    },
  ) {
    const isHostEmail = opts.emailType.startsWith("host_");
    s.defRecord("appointment_record", {
      query: sql`select * from db.${
        sql.ref(opts.type.tableName)
      } where id = ${opts.appointmentId}`,
      allowNoRead: true,
    });
    s.defScalar("user_email", {
      expr: opts.email.getUserEmail?.(sql.ref("appointment_record")) ??
        (isHostEmail ? sql.null : this.inviteeEmail(
          opts.type.tableName,
          sql.ref("appointment_record"),
          opts.type,
        ) ?? sql.null),
      allowNoRead: true,
    });
    const notificationTable = `${opts.type.tableName}_notifications_status`;
    function insertNotification(s: T, status: "sent" | "failed" | "noop") {
      s.startTransaction();
      s.modify(
        sql`insert into ${
          sql.ref(notificationTable)
        } (${fkField.ident}, status, type) values (${opts.appointmentId}, ${
          sql.lit(status)
        }, ${sql.lit(opts.emailType)})`,
      );
      s.commitTransaction();
    }
    const fkField = Object.values(
      system.db.tables[notificationTable].fields,
    ).find(
      (field) =>
        field.type === "ForeignKey" && field.table === opts.type.tableName,
    )!;
    const isRescheduleEmail = opts.emailType === "invitee_reschedule_email" ||
      opts.emailType === "host_reschedule_email";
    s.defScalar(
      "already_sent",
      isRescheduleEmail
        ? sql`false`
        : sql`exists(select 1 from db.${sql.ref(notificationTable)}
          where ${fkField.ident} = ${opts.appointmentId}
            and type = ${sql.lit(opts.emailType)}
            and status = 'sent')`,
    );
    s.if(sql`not already_sent and user_email is not null`, (s) => {
      s.try({
        body: (s) => {
          this.opts.extensions?.beforeNotification?.(s, {
            appointmentId: opts.appointmentId,
            emailType: opts.emailType,
          });
          s.defScalar("rendered_email", sql.lit``);
          s.defScalar("rendered_subject", sql.lit``);
          s.block((s) => {
            if (opts.email.setupScope) {
              opts.email.setupScope(s, sql.ref("appointment_record"));
            } else {
              this.devDefinedDefaultSetupScope(s, {
                type: opts.type,
                appointmentId: opts.appointmentId,
              });
            }
            let body: Sql | undefined;
            if (opts.email.standardTemplate) {
              body = SchedulingBlock.inviteeEmailWithFooter({
                title: opts.email.standardTemplate.title,
                body: opts.email.standardTemplate.body(
                  sql.ref("appointment_record"),
                ),
                schedulingDomain: opts.type.schedulingDomain,
                schedulingPath: opts.type.schedulingPath,
                appointmentRecord: sql.ref("appointment_record"),
              });
            } else {
              body = opts.email.body?.(sql.ref("appointment_record"));
            }
            if (!body) {
              throw new Error("body is required for dev email");
            }
            s.renderMjml({
              mjml: body,
              defOutputScalar: "email_template",
            });
            s.setScalar("rendered_email", sql`email_template`);
            s.setScalar(
              "rendered_subject",
              sql`${opts.email.subject(sql.ref("appointment_record"))}`,
            );
          });
          s.sendEmail({
            to: sql`user_email`,
            from: sql.lit(opts.email.from),
            subject: sql`rendered_subject`,
            htmlBody: sql`rendered_email`,
            replyTo: opts.email.replyTo?.(sql.ref("appointment_record")),
            idempotencyKey: opts.idempotencyKey,
            bcc: opts.email.extraRecipients?.length
              ? sql.lit(opts.email.extraRecipients.join(", "))
              : undefined,
            optIn: this.#caps?.send_emails,
          });
          s.if(sql`__send_email_result_json is null`, () => {});
          s.if(sql`__send_email_error_json is null`, () => {});
          insertNotification(s, "sent");
          s.startTransaction();
          s.modify(
            sql`insert into db.scheduling_notification_logs (notification_type, appointment_table, appointment_id, recipient, success, logged_at)
              values (${sql.lit(opts.emailType)}, ${
              sql.lit(opts.type.tableName)
            }, ${opts.appointmentId}, user_email, true, now())`,
          );
          s.commitTransaction();
        },
        errorName: "email_failed",
        catch: (s) => {
          s.rollbackTransaction();
          insertNotification(s, "failed");
          this.opts.extensions?.onNotificationError?.(s, {
            appointmentId: opts.appointmentId,
            emailType: opts.emailType,
            errorRecord: sql.ref("email_failed"),
          });
          s.startTransaction();
          s.modify(
            sql`insert into db.scheduling_notification_logs (notification_type, appointment_table, appointment_id, recipient, success, error_message, logged_at)
              values (${sql.lit(opts.emailType)}, ${
              sql.lit(opts.type.tableName)
            }, ${opts.appointmentId}, user_email, false, concat(email_failed.type, ': ', coalesce(email_failed.message, '')), now())`,
          );
          s.commitTransaction();
        },
      });
    });
    s.if(sql`not already_sent and user_email is null`, (s) => {
      insertNotification(s, "noop");
    });
  }

  @sourceMap
  getAvailableSlotsForDay<T extends IServerBaseStatements>(
    s: T,
    opts: {
      date: Sql;
      slotsTable: string;
      userTimezone: Sql;
      filterUserId: (userId: Sql) => Sql;
      bufferBefore: NumericExpr;
      duration: NumericExpr;
      bufferAfter: NumericExpr;
      minNotice: NumericExpr;
      maxNotice: NumericExpr;
      timeSlotsInterval: NumericExpr;
      excludeAppointment?: {
        table: string;
        id: NumericExpr;
      };
    },
  ) {
    s.defTable("scheduling_eligible_users", {
      fields: [{ name: "sys_user_id", type: "BigInt" }],
    });
    s.modify(
      sql`insert into scheduling_eligible_users select id from db.sys_users scheduling_user where ${
        opts.filterUserId(sql`scheduling_user.id`)
      }`,
    );
    s.callStoredProcedure("scheduling_available_slots", {
      inputScalars: {
        p_date: opts.date,
        p_timezone: opts.userTimezone,
        p_buffer_before: opts.bufferBefore,
        p_duration: opts.duration,
        p_buffer_after: opts.bufferAfter,
        p_min_notice: opts.minNotice,
        p_max_notice: opts.maxNotice,
        p_time_slots_interval: opts.timeSlotsInterval,
        p_exclude_table: opts.excludeAppointment
          ? sql.lit(opts.excludeAppointment.table)
          : sql.null,
        p_exclude_id: opts.excludeAppointment?.id ?? sql.null,
      },
      inputTables: { eligible_users: "scheduling_eligible_users" },
      outputTables: { slots: opts.slotsTable },
    });
  }

  private getAvailableSlotsForDayStatements<T extends IServerBaseStatements>(
    s: T,
    opts: {
      date: Sql;
      slotsTable: string;
      userTimezone: Sql;
      filterUserId: (userId: Sql) => Sql;
      bufferBefore: NumericExpr;
      duration: NumericExpr;
      bufferAfter: NumericExpr;
      minNotice: NumericExpr;
      maxNotice: NumericExpr;
      timeSlotsInterval: NumericExpr;
      excludeAppointment?: {
        table: Sql;
        id: NumericExpr;
      };
    },
  ) {
    system.block(AvailabilityBlock).getAvailabilityRangesForDay(s, {
      date: opts.date,
      targetTable: "availability_ranges",
      userTimezone: opts.userTimezone,
      filterUserId: opts.filterUserId,
    });
    const dayStart = sql`date.new_timestamp(
      date.part(year, ${opts.date}),
      date.part(month, ${opts.date}),
      date.part(day, ${opts.date}),
      0,
      0,
      0
    )`;
    const nextDayStart = sql`date.add(day, 1, ${dayStart})`;
    const blockedOffQueries: Sql[] = [];

    for (const eventType of this.opts.devDefinedEventTypes ?? []) {
      const excludeCurrentAppointment = opts.excludeAppointment
        ? sql`and ((${opts.excludeAppointment.table} is distinct from ${
          sql.lit(eventType.tableName)
        }) or a.id != ${opts.excludeAppointment.id})`
        : sql``;
      blockedOffQueries.push(
        sql`select
        (date.add(
          minute,
          -${eventType.bufferBefore},
          a.start_time
        ) at time zone ${opts.userTimezone}) as start_time,
        (date.add(
          minute,
          ${eventType.duration} + ${eventType.bufferAfter},
          a.start_time
        ) at time zone ${opts.userTimezone}) as end_time,
        (date.add(minute, -${eventType.bufferBefore}, a.start_time) at time zone ${opts.userTimezone})::date as day,
        a.sys_user_id as sys_user_id
        from db.${sql.ref(eventType.tableName)} a
        where (date.add(minute, -${eventType.bufferBefore}, a.start_time) at time zone ${opts.userTimezone}) < ${nextDayStart}
        and (date.add(minute, ${eventType.duration} + ${eventType.bufferAfter}, a.start_time) at time zone ${opts.userTimezone}) > ${dayStart}
        and a.status not in ('cancelled_by_invitee', 'cancelled_by_host', 'cancelled_by_admin')
        ${excludeCurrentAppointment}
        and ${opts.filterUserId(sql`a.sys_user_id`)}`,
      );
    }
    for (const calendarIntegration of this.opts.calendarIntegrations) {
      if (!calendarIntegration.checkForConflicts) {
        continue;
      }
      const query = system
        .block(calendarIntegration.integration)
        .getCalendarEventsForDay({
          day: opts.date,
          atTimezone: opts.userTimezone,
        });
      blockedOffQueries.push(
        sql`select start_time,
        end_time,
        start_time::date as day,
        sys_user_id
        from (${query})`,
      );
    }
    this.#defineSlotsTable(s, {
      slotsTable: opts.slotsTable,
    });
    this.#defineBlockedOffTable(s, blockedOffQueries);
    this.#mergeSlotsForDay(s, {
      slotsTable: opts.slotsTable,
      blockedOffTable: "blocked_off",
      bufferBefore: opts.bufferBefore,
      duration: opts.duration,
      bufferAfter: opts.bufferAfter,
      minNotice: opts.minNotice,
      maxNotice: opts.maxNotice,
      userTimezone: opts.userTimezone,
      day: opts.date,
      users:
        sql`select id as sys_user_id from db.sys_users as user_to_filter where ${
          opts.filterUserId(sql`user_to_filter.id`)
        }`,
      timeSlotsInterval: opts.timeSlotsInterval,
    });
  }

  #defineSlotsTable<T extends IServerBaseStatements>(
    s: T,
    opts: {
      slotsTable: string;
    },
  ) {
    s.defTable(opts.slotsTable, {
      fields: [
        { name: "start_time", type: "TimestampNaive" },
        { name: "end_time", type: "TimestampNaive" },
        { name: "date", type: "Date" },
        { name: "sys_user_id", type: "BigInt" },
      ],
    });
  }

  #defineBlockedOffTable<T extends IServerBaseStatements>(
    s: T,
    queries: Sql[],
  ) {
    if (queries.length === 0) {
      s.defTable("blocked_off", {
        fields: [
          { name: "start_time", type: "TimestampNaive" },
          { name: "end_time", type: "TimestampNaive" },
          { name: "day", type: "Date" },
          { name: "sys_user_id", type: "BigInt" },
        ],
      });
      return;
    }
    s.defTable("blocked_off", sql.unionAll(...queries));
  }

  #mergeSlotsForDay<T extends IServerBaseStatements>(
    s: T,
    opts: {
      slotsTable: string;
      blockedOffTable: string;
      bufferBefore: NumericExpr;
      duration: NumericExpr;
      bufferAfter: NumericExpr;
      minNotice: NumericExpr;
      maxNotice: NumericExpr;
      userTimezone: Sql;
      day: Sql;
      users: Sql;
      timeSlotsInterval: NumericExpr;
    },
  ) {
    const slotInterval = sql`case
      when ${opts.timeSlotsInterval} is null or ${opts.timeSlotsInterval} <= 0 then 30
      else ${opts.timeSlotsInterval}
    end`;
    const dayStart = sql`date.new_timestamp(
      date.part(year, ${opts.day}),
      date.part(month, ${opts.day}),
      date.part(day, ${opts.day}),
      0,
      0,
      0
    )`;
    const nextDayStart = sql`date.add(day, 1, ${dayStart})`;

    // I've pushed everything into a single query to avoid the overhead of proc tables and such
    s.modify(sql`
    insert into ${sql.ref(opts.slotsTable)}
    select start_time, end_time, date, sys_user_id
    from (
      with slot_candidates as (
        select
          aar.sys_user_id,
          aar.start_datetime as range_start,
          aar.end_datetime as range_end,
          date.add(
            minute,
            ${slotInterval} * slot_number.value,
            aar.start_datetime
          ) as slot_start,
          date.add(
            minute,
            ${opts.duration},
            date.add(
              minute,
              ${slotInterval} * slot_number.value,
              aar.start_datetime
            )
          ) as meeting_end
        from availability_ranges aar
        join (${opts.users}) users on users.sys_user_id = aar.sys_user_id
        join series.int(0, 1440) slot_number on true
        where aar.start_datetime < ${nextDayStart}
          and aar.end_datetime > ${dayStart}
      ),
      slots as (
        select slot_start, meeting_end, sys_user_id
        from slot_candidates
        where slot_start >= ${dayStart}
          and slot_start < ${nextDayStart}
          and date.add(minute, -${opts.bufferBefore}, slot_start) >= range_start
          and date.add(minute, ${opts.bufferAfter}, meeting_end) <= range_end
      )
      select
        s.slot_start as start_time,
        s.meeting_end as end_time,
        s.sys_user_id as sys_user_id,
        s.slot_start::date as date
      from
        (select slot_start, meeting_end, sys_user_id from slots order by slot_start) s
      where
        not exists (
          select 1
          from ${sql.ref(opts.blockedOffTable)} as blocked_off
          where
            blocked_off.day <= ${opts.day} and
            blocked_off.end_time > ${dayStart} and
            blocked_off.start_time < ${nextDayStart} and
            (date.add(minute, -${opts.bufferBefore}, s.slot_start) < blocked_off.end_time
              and date.add(minute, ${opts.duration} + ${opts.bufferAfter}, s.slot_start) > blocked_off.start_time) and
            blocked_off.sys_user_id = s.sys_user_id
        )
        and date.add(minute, ${opts.minNotice}, current_timestamp at time zone ${opts.userTimezone}) <= s.slot_start
        and (${opts.maxNotice} is null or date.add(minute, ${opts.maxNotice}, current_timestamp at time zone ${opts.userTimezone}) >= s.slot_start)
      order by start_time
    )`);
  }

  @sourceMap
  getFullMonthCalendar<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarDaysTable: string;
      slotsTable: string;
      month: Sql;
      filterUserId: (userId: Sql) => Sql;
      userTimezone: Sql;
      minNotice: NumericExpr;
      maxNotice: NumericExpr;
      bufferBefore: NumericExpr;
      bufferAfter: NumericExpr;
      duration: NumericExpr;
      timeSlotsInterval: NumericExpr;
      selectedDate?: Sql;
      excludeAppointment?: {
        table: string;
        id: NumericExpr;
      };
    },
  ) {
    s.defTable("scheduling_eligible_users", {
      fields: [{ name: "sys_user_id", type: "BigInt" }],
    });
    s.modify(
      sql`insert into scheduling_eligible_users select id from db.sys_users scheduling_user where ${
        opts.filterUserId(sql`scheduling_user.id`)
      }`,
    );
    s.callStoredProcedure(
      opts.selectedDate ? "scheduling_month_selected" : "scheduling_month_all",
      {
        inputScalars: {
          p_date: opts.month,
          p_timezone: opts.userTimezone,
          p_buffer_before: opts.bufferBefore,
          p_duration: opts.duration,
          p_buffer_after: opts.bufferAfter,
          p_min_notice: opts.minNotice,
          p_max_notice: opts.maxNotice,
          p_time_slots_interval: opts.timeSlotsInterval,
          p_exclude_table: opts.excludeAppointment
            ? sql.lit(opts.excludeAppointment.table)
            : sql.null,
          p_exclude_id: opts.excludeAppointment?.id ?? sql.null,
          p_selected_date: opts.selectedDate ?? sql.null,
        },
        inputTables: { eligible_users: "scheduling_eligible_users" },
        outputTables: {
          slots: opts.slotsTable,
          calendar_days: opts.calendarDaysTable,
        },
      },
    );
  }

  private getFullMonthCalendarStatements<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarDaysTable: string;
      slotsTable: string;
      month: Sql;
      filterUserId: (userId: Sql) => Sql;
      userTimezone: Sql;
      minNotice: NumericExpr;
      maxNotice: NumericExpr;
      bufferBefore: NumericExpr;
      bufferAfter: NumericExpr;
      duration: NumericExpr;
      timeSlotsInterval: NumericExpr;
      selectedDate?: Sql;
      excludeAppointment?: {
        table: Sql;
        id: NumericExpr;
      };
    },
  ) {
    s.defScalar("first_day_of_month", sql`date.start_of_month(${opts.month})`);
    s.defScalar("last_day_of_month", sql`date.end_of_month(${opts.month})`);
    s.defScalar(
      "start_of_calendar",
      sql`case
      when date.part(dow, first_day_of_month) = 7 then first_day_of_month
      else date.add(day, -(date.part(dow, first_day_of_month)), first_day_of_month)
    end`,
    );
    s.defScalar(
      "end_of_calendar",
      sql`date.add(
      day,
      6 - date.part(dow, last_day_of_month),
      last_day_of_month
    )`,
    );
    system.block(AvailabilityBlock).getAvailabilityRangesForMonth(s, {
      month: opts.month,
      targetTable: "availability_ranges",
      userTimezone: opts.userTimezone,
      filterUserId: opts.filterUserId,
    });
    const blockedOffQueries: Sql[] = [];

    for (const eventType of this.opts.devDefinedEventTypes ?? []) {
      const excludeCurrentAppointment = opts.excludeAppointment
        ? sql`and ((${opts.excludeAppointment.table} is distinct from ${
          sql.lit(eventType.tableName)
        }) or a.id != ${opts.excludeAppointment.id})`
        : sql``;
      blockedOffQueries.push(
        sql`select
        (date.add(
          minute,
          -${eventType.bufferBefore},
          a.start_time
        ) at time zone ${opts.userTimezone}) as start_time,
        (date.add(
          minute,
          ${eventType.duration} + ${eventType.bufferAfter},
          a.start_time
        ) at time zone ${opts.userTimezone}) as end_time,
        (date.add(minute, -${eventType.bufferBefore}, a.start_time) at time zone ${opts.userTimezone})::date as day,
        a.sys_user_id as sys_user_id
        from db.${sql.ref(eventType.tableName)} a
        where (date.add(minute, -${eventType.bufferBefore}, a.start_time) at time zone ${opts.userTimezone}) < date.add(day, 1, end_of_calendar)
        and (date.add(minute, ${eventType.duration} + ${eventType.bufferAfter}, a.start_time) at time zone ${opts.userTimezone}) > start_of_calendar
        and a.status not in ('cancelled_by_invitee', 'cancelled_by_host', 'cancelled_by_admin')
        ${excludeCurrentAppointment}
        and ${opts.filterUserId(sql`a.sys_user_id`)}`,
      );
    }
    for (const calendarIntegration of this.opts.calendarIntegrations) {
      if (!calendarIntegration.checkForConflicts) {
        continue;
      }
      const query = system
        .block(calendarIntegration.integration)
        .getCalendarEventsForRange({
          atTimezone: opts.userTimezone,
          start: sql`start_of_calendar`,
          end: sql`end_of_calendar`,
          filterUserId: opts.filterUserId,
        });
      blockedOffQueries.push(
        sql`select start_time,
        end_time,
        start_time::date as day,
        sys_user_id
        from (${query})`,
      );
    }
    this.#defineBlockedOffTable(s, blockedOffQueries);
    const selectedDate = opts.selectedDate;
    if (selectedDate) {
      this.#defineSlotsTable(s, opts);
      this.#defineCalendarDaysTable(s, opts);
      s.if(sql`${selectedDate} is not null`, (s) => {
        this.#mergeSlotsForDay(s, {
          slotsTable: opts.slotsTable,
          blockedOffTable: "blocked_off",
          bufferBefore: opts.bufferBefore,
          duration: opts.duration,
          bufferAfter: opts.bufferAfter,
          minNotice: opts.minNotice,
          maxNotice: opts.maxNotice,
          userTimezone: opts.userTimezone,
          timeSlotsInterval: opts.timeSlotsInterval,
          day: selectedDate,
          users: sql`select id as sys_user_id from db.sys_users where ${
            opts.filterUserId(sql`sys_users.id`)
          }`,
        });
      });
      return;
    }
    this.#defineSlotsTable(s, opts);
    // Currently I don't support modifying ui tables in a task, but once I do I can use parallelForEachQuery here
    s.forEachQueryWithLabel({
      query:
        sql`select value from series.daily(start_of_calendar, date.diff(day, start_of_calendar, end_of_calendar) + 1)`,
      cursorName: "day",
      // maxConcurrency: 50,
      body: (s) => {
        s.continueIf(sql`day.value < today()`);
        s.continueIf(
          sql`not exists (
            select 1 from availability_ranges
            where start_datetime < date.add(day, 1, day.value)
              and end_datetime > day.value
          )`,
        );
        s.continueIf(
          sql`date.add(minute, ${opts.maxNotice}, now())::date < day.value`,
        );
        this.#mergeSlotsForDay(s, {
          slotsTable: opts.slotsTable,
          blockedOffTable: "blocked_off",
          bufferBefore: opts.bufferBefore,
          duration: opts.duration,
          bufferAfter: opts.bufferAfter,
          minNotice: opts.minNotice,
          maxNotice: opts.maxNotice,
          userTimezone: opts.userTimezone,
          timeSlotsInterval: opts.timeSlotsInterval,
          day: sql`day.value`,
          users: sql`select id as sys_user_id from db.sys_users where ${
            opts.filterUserId(sql`sys_users.id`)
          }`,
        });
      },
    });
    s.defTable(
      opts.calendarDaysTable,
      sql`select value as date , exists(select 1 from ${
        sql.ref(opts.slotsTable)
      } where date = value) as available_hours
      from series.daily(start_of_calendar, date.diff(day, start_of_calendar, end_of_calendar) + 1)`,
    );
  }

  #defineCalendarDaysTable<T extends IServerBaseStatements>(
    s: T,
    opts: {
      calendarDaysTable: string;
      bufferBefore: NumericExpr;
      duration: NumericExpr;
      bufferAfter: NumericExpr;
      minNotice: NumericExpr;
      maxNotice: NumericExpr;
      userTimezone: Sql;
      timeSlotsInterval: NumericExpr;
    },
  ) {
    const slotInterval = sql`case
      when ${opts.timeSlotsInterval} is null or ${opts.timeSlotsInterval} <= 0 then 30
      else ${opts.timeSlotsInterval}
    end`;
    s.defTable(
      "available_calendar_days",
      sql`
      with slot_candidates as (
        select
          aar.sys_user_id,
          aar.start_datetime as range_start,
          aar.end_datetime as range_end,
          date.add(
            minute,
            ${slotInterval} * slot_number.value,
            aar.start_datetime
          ) as slot_start,
          date.add(
            minute,
            ${opts.duration},
            date.add(
              minute,
              ${slotInterval} * slot_number.value,
              aar.start_datetime
            )
          ) as meeting_end
        from availability_ranges aar
        join series.int(0, 1440) slot_number on true
        where aar.start_datetime < date.add(day, 1, end_of_calendar)
          and aar.end_datetime > start_of_calendar
      ),
      slots as (
        select sys_user_id, slot_start::date as date, slot_start, meeting_end
        from slot_candidates
        where date.add(minute, -${opts.bufferBefore}, slot_start) >= range_start
          and date.add(minute, ${opts.bufferAfter}, meeting_end) <= range_end
      )
      select distinct s.date
      from slots s
      where not exists (
        select 1
        from blocked_off
        where
          blocked_off.day <= s.date and
          blocked_off.end_time > date.new_timestamp(
            date.part(year, s.date),
            date.part(month, s.date),
            date.part(day, s.date),
            0,
            0,
            0
          ) and
          blocked_off.start_time < date.add(
            day,
            1,
            date.new_timestamp(
              date.part(year, s.date),
              date.part(month, s.date),
              date.part(day, s.date),
              0,
              0,
              0
            )
          ) and
          date.add(minute, -${opts.bufferBefore}, s.slot_start) < blocked_off.end_time and
          date.add(minute, ${opts.duration} + ${opts.bufferAfter}, s.slot_start) > blocked_off.start_time and
          blocked_off.sys_user_id = s.sys_user_id
      )
      and date.add(minute, ${opts.minNotice}, current_timestamp at time zone ${opts.userTimezone}) <= s.slot_start
      and (${opts.maxNotice} is null or date.add(minute, ${opts.maxNotice}, current_timestamp at time zone ${opts.userTimezone}) >= s.slot_start)`,
    );
    s.defTable(
      opts.calendarDaysTable,
      sql`select value as date, exists(
        select 1 from available_calendar_days ad where ad.date = value
      ) as available_hours
      from series.daily(start_of_calendar, date.diff(day, start_of_calendar, end_of_calendar) + 1)`,
    );
  }

  @sourceMap
  assertDevDefinedUserAvailable<T extends IServerBaseStatements>(
    s: T,
    opts: {
      appointmentTable: string;
      appointmentId: NumericExpr;
      userId: NumericExpr;
      selectedTime: AnyExpr;
      selectedDate: Sql;
      userTimezone: Sql;
    },
  ) {
    const eventType = this.getDevDefinedEventType(opts.appointmentTable);
    if (!eventType) {
      throw new Error(
        `Unknown dev-defined appointment table ${opts.appointmentTable}`,
      );
    }
    this.getAvailableSlotsForDay(s, {
      date: opts.selectedDate,
      slotsTable: "available_slots_for_dev_reschedule",
      filterUserId: (userId) => sql`${userId} = ${opts.userId}`,
      userTimezone: opts.userTimezone,
      bufferBefore: eventType.bufferBefore,
      bufferAfter: eventType.bufferAfter,
      minNotice: eventType.minNotice,
      maxNotice: eventType.maxNotice,
      duration: eventType.duration,
      timeSlotsInterval: eventType.timeSlotsInterval,
      excludeAppointment: {
        table: opts.appointmentTable,
        id: opts.appointmentId,
      },
    });
    s.if(
      sql`not exists(
        select 1 from available_slots_for_dev_reschedule
        where sys_user_id = ${opts.userId}
          and start_time = ${opts.selectedTime}
          and date = ${opts.selectedDate}
      )`,
      (s) => {
        s.throwError(
          sql.lit`The selected time is no longer available.`,
          sql`'dev_scheduling_slot_unavailable: appointment_table=' || ${
            sql.lit(opts.appointmentTable)
          }
            ${
            opts.appointmentId
              ? sql`|| ', appointment_id=' || cast(${opts.appointmentId} as string)`
              : sql``
          }
            || ', selected_time=' || cast(${opts.selectedTime} as string)`,
        );
      },
    );
  }

  private registerAvailabilityProcedures() {
    const inputs: HelperProcField[] = [
      { name: "p_date", type: "Date" },
      { name: "p_timezone", type: { type: "String", maxLength: 255 } },
      { name: "p_buffer_before", type: "BigInt" },
      { name: "p_duration", type: "BigInt" },
      { name: "p_buffer_after", type: "BigInt" },
      { name: "p_min_notice", type: "BigInt" },
      { name: "p_max_notice", type: "BigInt" },
      { name: "p_time_slots_interval", type: "BigInt" },
      { name: "p_exclude_table", type: "String" },
      { name: "p_exclude_id", type: "BigInt" },
    ];
    const slots: HelperProcField[] = [
      { name: "start_time", type: "TimestampNaive" },
      { name: "end_time", type: "TimestampNaive" },
      { name: "date", type: "Date" },
      { name: "sys_user_id", type: "BigInt" },
    ];
    const eligibleUsers = [{
      name: "eligible_users",
      fields: [{ name: "sys_user_id", type: "BigInt" as const }],
    }];
    const options = {
      userTimezone: sql`p_timezone`,
      bufferBefore: sql`p_buffer_before`,
      duration: sql`p_duration`,
      bufferAfter: sql`p_buffer_after`,
      minNotice: sql`p_min_notice`,
      maxNotice: sql`p_max_notice`,
      timeSlotsInterval: sql`p_time_slots_interval`,
      filterUserId: (id: Sql) =>
        sql`exists(select 1 from eligible_users eligible where eligible.sys_user_id = ${id})`,
      excludeAppointment: {
        table: sql`p_exclude_table`,
        id: sql`p_exclude_id`,
      },
      slotsTable: "calculated_slots",
    };
    system.storedProcedure({
      name: "scheduling_available_slots",
      transaction: "caller",
      inputScalars: inputs,
      inputTables: eligibleUsers,
      outputTables: [{ name: "slots", fields: slots }],
      procedure: (s) => {
        this.getAvailableSlotsForDayStatements(s, {
          ...options,
          date: sql`p_date`,
        });
        s.modify(
          sql`insert into slots select start_time, end_time, date, sys_user_id from calculated_slots`,
        );
      },
    });
    for (const selected of [false, true]) {
      system.storedProcedure({
        name: selected ? "scheduling_month_selected" : "scheduling_month_all",
        transaction: "caller",
        inputScalars: [...inputs, { name: "p_selected_date", type: "Date" }],
        inputTables: eligibleUsers,
        outputTables: [
          { name: "slots", fields: slots },
          {
            name: "calendar_days",
            fields: [{ name: "date", type: "Date" }, {
              name: "available_hours",
              type: "Bool",
            }],
          },
        ],
        procedure: (s) => {
          this.getFullMonthCalendarStatements(s, {
            ...options,
            month: sql`p_date`,
            calendarDaysTable: "calculated_calendar_days",
            selectedDate: selected ? sql`p_selected_date` : undefined,
          });
          s.modify(
            sql`insert into slots select start_time, end_time, date, sys_user_id from calculated_slots`,
          );
          s.modify(
            sql`insert into calendar_days select date, available_hours from calculated_calendar_days`,
          );
        },
      });
    }
  }

  populate() {
    this.registerAvailabilityProcedures();
    this.addBackgroundTaskRetryScheduler();
    this.addBackgroundTaskStoredProcedures();
    this.addBackgroundTaskReactor();
  }

  private addBackgroundTaskRetryScheduler() {
    storedScheduledProc({
      name: "scheduling_background_task_retry_wakeup",
      schedule: "0 * * * * *",
      procedure: (s) => {
        s.startTransaction();
        s.modify(
          sql`update db.scheduling_background_tasks
            set next_attempt_at = now()
            where coalesce(next_attempt_at, created_at) <= now()`,
        );
        s.commitTransaction();
      },
    });
  }

  private deferBackgroundTask<T extends IServerBaseStatements>(s: T) {
    s.startTransaction();
    s.modify(
      sql`update db.scheduling_background_tasks
        set next_attempt_at = date.add(minute, 1, now())
        where id = task.id`,
    );
    s.commitTransaction();
  }

  private backgroundTaskHandlers(): {
    taskType: string;
    procedure: (s: GeneralServerStatements) => void;
  }[] {
    return [
      {
        taskType: "calendar_add",
        procedure: (s) => this.handleCalendarAdd(s),
      },
      {
        taskType: "calendar_update",
        procedure: (s) => this.handleCalendarUpdate(s),
      },
      {
        taskType: "calendar_delete",
        procedure: (s) => this.handleCalendarDelete(s),
      },
      {
        taskType: "meeting_create",
        procedure: (s) => this.handleMeetingCreate(s),
      },
      {
        taskType: "meeting_update",
        procedure: (s) => this.handleMeetingUpdate(s),
      },
      {
        taskType: "meeting_delete",
        procedure: (s) => this.handleMeetingDelete(s),
      },
      {
        taskType: "email_dev",
        procedure: (s) => this.handleEmailDev(s),
      },
      {
        taskType: "calendar_cleanup",
        procedure: (s) => this.handleCalendarCleanup(s),
      },
    ];
  }

  private backgroundTaskStoredProcedureName(taskType: string) {
    return `scheduling_background_${taskType}`;
  }

  private addBackgroundTaskStoredProcedures() {
    for (const handler of this.backgroundTaskHandlers()) {
      system.storedProcedure({
        name: this.backgroundTaskStoredProcedureName(handler.taskType),
        transaction: "standalone",
        inputScalars: [
          { name: "p_task_id", type: "BigInt" },
        ],
        outputScalars: [
          { name: "task_failed", type: "Bool" },
        ],
        procedure: (s) => {
          s.defRecord("task", {
            query:
              sql`select * from db.scheduling_background_tasks where id = p_task_id`,
            allowNoRead: true,
          });
          s.setScalar("task_failed", sql`false`);
          handler.procedure(s);
        },
      });
    }
  }

  private setGoogleMeetTaskMarker<T extends IServerBaseStatements>(
    s: T,
    taskId: NumericExpr,
    marker: Sql,
  ) {
    s.startTransaction();
    s.modify(
      sql`update db.scheduling_background_tasks
        set external_resource_id = ${marker}
        where id = ${taskId}`,
    );
    s.commitTransaction();
  }

  private markGoogleMeetCreationFailed<T extends IServerBaseStatements>(s: T) {
    const failureReason = sql
      .lit`Appointment creation failed because Google Meet could not be created.`;
    const googleIntegration = this.opts.calendarIntegrations.find(
      (integration) =>
        integration.integration === GoogleCalendarIntegration &&
        integration.addToCalendar,
    );

    for (
      const devType of (this.opts.devDefinedEventTypes ?? []).filter(
        (type) => type.meetingLocation === "google_meet",
      )
    ) {
      if (!googleIntegration) continue;
      s.if(
        sql`task.appointment_table = ${sql.lit(devType.tableName)}
          and (
            (select external_resource_id
              from db.scheduling_background_tasks
              where id = task.id) = 'google_meet_creation'
            or (
              (select ${sql.ref(googleIntegration.eventIdField)}
                from db.${sql.ref(devType.tableName)}
                where id = task.appointment_id) is not null
              and (select external_resource_id
                from db.scheduling_background_tasks
                where id = task.id) = cast(
                  (select ${sql.ref(googleIntegration.eventIdField)}
                    from db.${sql.ref(devType.tableName)}
                    where id = task.appointment_id)
                  as string
                )
            )
          )
          and exists(
            select 1
            from db.${sql.ref(devType.tableName)}
            where id = task.appointment_id
              and status in ('creating', 'scheduled')
              and google_conference_link is null
          )`,
        (s) => {
          for (const integration of this.opts.calendarIntegrations) {
            const calendarBlock = system.block(integration.integration);
            s.if(
              sql`(select ${sql.ref(integration.eventIdField)} from db.${
                sql.ref(devType.tableName)
              } where id = task.appointment_id) is not null`,
              (s) => {
                this.enqueueBackgroundTask(s, {
                  taskType: "calendar_delete",
                  appointmentTable: devType.tableName,
                  appointmentId: sql`task.appointment_id`,
                  provider: calendarBlock.integrationName,
                  targetUserId: sql`(select sys_user_id from db.${
                    sql.ref(devType.tableName)
                  } where id = task.appointment_id)`,
                  externalResourceId: sql`(select ${
                    sql.ref(integration.eventIdField)
                  } from db.${
                    sql.ref(devType.tableName)
                  } where id = task.appointment_id)`,
                  insideTransaction: true,
                });
                s.modify(
                  sql`update db.${sql.ref(devType.tableName)}
                    set ${sql.ref(integration.eventIdField)} = null${
                    integration.integration === OutlookCalendarIntegration
                      ? sql`, ${
                        sql.ref(`${integration.eventIdField}_creation_id`)
                      } = null`
                      : sql``
                  }
                    where id = task.appointment_id`,
                );
              },
            );
          }
          s.modify(
            sql`update db.${sql.ref(devType.tableName)}
              set status = 'cancelled_by_admin',
                cancel_reason = ${failureReason},
                cancelled_at = now(),
                public_id = random.uuid(),
                google_conference_link = null
              where id = task.appointment_id
                and status in ('creating', 'scheduled')
                and google_conference_link is null`,
          );
        },
      );
    }
  }

  private pollGoogleMeetConference<T extends IServerBaseStatements>(
    s: T,
    opts: Parameters<typeof pollGoogleMeetConference>[1],
  ) {
    pollGoogleMeetConference(s, opts, {
      setTaskMarker: (s, eventId) =>
        this.setGoogleMeetTaskMarker(s, sql`task.id`, eventId),
      markCreationFailed: (s) => this.markGoogleMeetCreationFailed(s),
    });
  }

  private addBackgroundTaskReactor() {
    system.addReactor({
      name: "process_scheduling_background_tasks",
      query: sql`select id from db.scheduling_background_tasks
        where coalesce(next_attempt_at, created_at) <= now()`,
      recordName: "bg_task",
      procedure: (s) => {
        s.defRecord(
          "task",
          sql`select * from db.scheduling_background_tasks where id = bg_task.id`,
        );
        s.defScalar("task_failed", sql`false`);

        s.if(
          sql`(task.task_type = 'calendar_cleanup' and task.calendar_id is not null and task.calendar_table is not null)
            or (task.task_type != 'calendar_cleanup' and task.appointment_id is not null)`,
          (s) => {
            s.try({
              body: (s) => {
                this.opts.extensions?.beforeBackgroundTask?.(s, {
                  taskRecord: sql.ref("task"),
                });
                this.dispatchBackgroundTask(s);
              },
              errorName: "task_error",
              catch: (s) => {
                s.rollbackIfInTransaction();
                s.setScalar("task_failed", sql`true`);
                this.opts.extensions?.onBackgroundTaskError?.(s, {
                  taskRecord: sql.ref("task"),
                  errorRecord: sql.ref("task_error"),
                });
                s.if(
                  sql`task.task_type in ('calendar_add', 'calendar_update', 'calendar_delete', 'meeting_create', 'meeting_update', 'meeting_delete')`,
                  (s) => {
                    s.defScalar(
                      "error_sys_user_id",
                      sql`task.target_user_id::biguint`,
                    );

                    for (
                      const devType of this.opts.devDefinedEventTypes ?? []
                    ) {
                      s.if(
                        sql`task.target_user_id is null
                          and task.appointment_table = ${
                          sql.lit(devType.tableName)
                        }`,
                        (s) => {
                          s.setScalar(
                            "error_sys_user_id",
                            sql`(select sys_user_id from ${
                              sql.ref(devType.tableName)
                            } where id = task.appointment_id)`,
                          );
                        },
                      );
                    }
                    s.startTransaction();
                    s.modify(
                      sql`insert into db.scheduling_integration_errors
                        (error, type, timestamp, task_type, appointment_table, appointment_id, sys_user_id)
                      values (
                        concat(task_error.type, ': ', coalesce(task_error.message, ''), ' ', coalesce(task_error.description, '')),
                        case when task.task_type in ('meeting_create', 'meeting_update', 'meeting_delete') then 'meeting_task' else 'calendar_task' end,
                        now(),
                        task.task_type,
                        task.appointment_table,
                        task.appointment_id,
                        error_sys_user_id
                      )`,
                    );
                    for (
                      const integration of this.opts.calendarIntegrations
                    ) {
                      if (
                        integration.integration === GoogleCalendarIntegration
                      ) {
                        s.modify(
                          sql`insert into db.scheduling_google_integration_logs (operation, success, error_message, sys_user_id, appointment_table, appointment_id, logged_at)
                            values (task.task_type, false, concat(task_error.type, ': ', coalesce(task_error.message, '')), error_sys_user_id, task.appointment_table, task.appointment_id, now())`,
                        );
                      }
                      if (
                        integration.integration === OutlookCalendarIntegration
                      ) {
                        s.modify(
                          sql`insert into db.scheduling_outlook_integration_logs (operation, success, error_message, sys_user_id, appointment_table, appointment_id, logged_at)
                            values (task.task_type, false, concat(task_error.type, ': ', coalesce(task_error.message, '')), error_sys_user_id, task.appointment_table, task.appointment_id, now())`,
                        );
                      }
                    }
                    s.if(
                      sql`task.task_type in ('calendar_add', 'meeting_create')`,
                      (s) => {
                        for (
                          const tableName of this.allAppointmentTableNames()
                        ) {
                          const devType = this.opts.devDefinedEventTypes?.find(
                            (type) => type.tableName === tableName,
                          );
                          const canCompleteAfterError =
                            devType?.meetingLocation === "google_meet"
                              ? sql`exists (
                                select 1
                                from db.${sql.ref(tableName)}
                                where id = task.appointment_id
                                  and google_conference_link is not null
                              )`
                              : sql`true`;
                          s.if(
                            sql`task.appointment_table = ${sql.lit(tableName)}`,
                            (s) => {
                              s.modify(
                                sql`update db.${sql.ref(tableName)}
                                  set status = 'scheduled'
                                  where id = task.appointment_id
                                    and status = 'creating'
                                    and ${canCompleteAfterError}`,
                              );
                            },
                          );
                        }
                      },
                    );
                    s.commitTransaction();
                  },
                );
              },
            });

            s.startTransaction();
            s.if(
              sql`exists(
                select 1
                from db.scheduling_background_tasks
                where id = bg_task.id
                  and next_attempt_at > now()
              )`,
              (s) => {
                s.modify(
                  sql`update db.scheduling_background_tasks
                    set next_attempt_at = date.add(minute, 1, now())
                    where id = bg_task.id`,
                );
              },
              (s) => {
                s.if(
                  sql`task_failed
                    and task.task_type in ('calendar_add', 'calendar_update', 'calendar_delete', 'meeting_create', 'meeting_update', 'meeting_delete', 'email_host', 'email_invitee_reschedule')
                    and coalesce(task.attempt_count, 0) < 4`,
                  (s) => {
                    s.modify(
                      sql`update db.scheduling_background_tasks
                        set attempt_count = coalesce(attempt_count, 0) + 1,
                          next_attempt_at = date.add(
                            minute,
                            case coalesce(attempt_count, 0)
                              when 0 then 1
                              when 1 then 5
                              when 2 then 15
                              else 60
                            end,
                            now()
                          )
                        where id = bg_task.id`,
                    );
                  },
                  (s) => {
                    s.if(
                      sql`task_failed
                        and task.task_type in ('calendar_add', 'calendar_update')
                        and coalesce(task.attempt_count, 0) >= 4`,
                      (s) => {
                        this.markGoogleMeetCreationFailed(s);
                      },
                    );
                    s.modify(
                      sql`delete from db.scheduling_background_tasks where id = bg_task.id`,
                    );
                  },
                );
              },
            );
            s.commitTransaction();
          },
          (s) => {
            s.startTransaction();
            s.modify(
              sql`delete from db.scheduling_background_tasks where id = bg_task.id`,
            );
            s.commitTransaction();
          },
        );
      },
    });
  }

  private allAppointmentTableNames(): string[] {
    const tables: string[] = [];

    for (const devType of this.opts.devDefinedEventTypes ?? []) {
      tables.push(devType.tableName);
    }
    return tables;
  }

  private dispatchBackgroundTask<T extends IServerBaseStatements>(s: T) {
    for (const handler of this.backgroundTaskHandlers()) {
      s.if(
        sql`task.task_type = ${sql.lit(handler.taskType)}`,
        (s) => {
          s.callStoredProcedure(
            this.backgroundTaskStoredProcedureName(handler.taskType),
            {
              inputScalars: {
                p_task_id: sql`bg_task.id`,
              },
              outputScalars: {
                task_failed: "task_failed",
              },
            },
          );
        },
      );
    }
  }

  private handleCalendarAdd<T extends IServerBaseStatements>(s: T) {
    for (const devType of this.opts.devDefinedEventTypes ?? []) {
      s.if(
        sql`task.appointment_table = ${sql.lit(devType.tableName)}`,
        (s) => {
          s.if(
            sql`not exists(
              select 1
              from db.${sql.ref(devType.tableName)}
              where id = task.appointment_id
                and status in ('creating', 'scheduled')
            )`,
            (s) => s.return(),
          );
          const devGoogleIntegration = this.opts.calendarIntegrations.find(
            (integration) =>
              integration.integration === GoogleCalendarIntegration &&
              integration.addToCalendar,
          );
          if (
            devType.meetingLocation === "google_meet" &&
            devGoogleIntegration
          ) {
            s.if(
              sql`exists(
                select 1
                from db.${sql.ref(devType.tableName)}
                where id = task.appointment_id
                  and ${sql.ref(devGoogleIntegration.eventIdField)} is not null
                  and google_conference_link is null
              )`,
              (s) => {
                this.pollGoogleMeetConference(s, {
                  appointmentTable: devType.tableName,
                  eventIdField: devGoogleIntegration.eventIdField,
                  userId: sql`(select sys_user_id from db.${
                    sql.ref(devType.tableName)
                  } where id = task.appointment_id)`,
                  eventId: sql`(select ${
                    sql.ref(devGoogleIntegration.eventIdField)
                  } from db.${
                    sql.ref(devType.tableName)
                  } where id = task.appointment_id)`,
                  conferenceDataRecord: "dev_existing_google_conference_data",
                  scheduleOnSuccess: true,
                  storeFullMeetUrl: false,
                });
              },
            );
            s.if(sql`task_failed`, (s) => s.return());
            s.if(
              sql`not exists(
                select 1
                from db.${sql.ref(devType.tableName)}
                where id = task.appointment_id
                  and status in ('creating', 'scheduled')
              )`,
              (s) => s.return(),
            );
          }
          s.defRecord(
            "appointment",
            sql`select * from ${
              sql.ref(devType.tableName)
            } where id = task.appointment_id`,
          );
          const inviteeEmail = this.inviteeEmail(
            devType.tableName,
            sql.ref("appointment"),
            devType,
          );
          const inviteeName = this.inviteeDisplayName(
            devType.tableName,
            sql.ref("appointment"),
            devType,
          );
          for (const integration of this.googleCalendarIntegrationFirst()) {
            if (!integration.addToCalendar) continue;
            const calendarBlock = system.block(integration.integration);
            const conditionStatus = calendarBlock
              .getSchedulingConditionStatus?.();
            const hasWritableCalendar = conditionStatus
              ? sql`exists(
                  select 1 from (${conditionStatus}) condition_status
                  where condition_status.sys_user_id = task.target_user_id
                    and condition_status.has_add_calendar
                )`
              : sql`exists(
                  select 1 from db.${sql.ref(calendarBlock.accountTable)}
                  where sys_user_id = task.target_user_id
                    and ${calendarBlock.isActiveAccount}
                )`;
            s.if(
              sql`(
                  appointment.${sql.ref(integration.eventIdField)} is null
                  ${
                integration.integration === GoogleCalendarIntegration &&
                  devType.meetingLocation === "google_meet"
                  ? sql`or appointment.google_conference_link is null`
                  : sql``
              }
                )
                and (task.provider is null or task.provider = ${
                sql.lit(calendarBlock.integrationName)
              })`,
              (s) => {
                if (
                  integration.integration === GoogleCalendarIntegration &&
                  devType.meetingLocation === "google_meet"
                ) {
                  s.if(
                    sql`task.provider is null
                      or (
                        task.target_user_id is not null
                        and appointment.sys_user_id = task.target_user_id
                      )`,
                    (s) => {
                      this.setGoogleMeetTaskMarker(
                        s,
                        sql`task.id`,
                        sql.lit`google_meet_creation`,
                      );
                    },
                  );
                }
                s.if(
                  sql`task.provider is not null
                    and (
                      task.target_user_id is null
                      or appointment.sys_user_id != task.target_user_id
                      or not ${hasWritableCalendar}
                    )`,
                  (s) => {
                    s.throwError(
                      sql
                        .lit`The new host's calendar connection is unavailable.`,
                    );
                  },
                );
                if (
                  integration.integration === GoogleCalendarIntegration &&
                  devType.meetingLocation === "google_meet"
                ) {
                  s.defScalar(
                    "user_google_calendar_id",
                    sql`(select user_google_calendars.id
                      from user_google_calendars
                        auto join user_google_accounts
                      where sys_user_id = appointment.sys_user_id and add_to_calendar)`,
                  );
                  s.if(
                    sql`user_google_calendar_id is not null`,
                    (s) => {
                      const createGoogleMeetEvent = (
                        s: IServerBaseStatements,
                        includeInvitee: boolean,
                      ) => {
                        system.block(GoogleCalendarIntegration)
                          .addToCalendarWithMeet(s, {
                            calendarId: sql`user_google_calendar_id`,
                            summary: devType.calendarTitle
                              ? devType.calendarTitle(sql.ref("appointment"))
                              : sql.lit(devType.displayName),
                            description: devType.calendarDescription
                              ? devType.calendarDescription(
                                sql.ref("appointment"),
                              )
                              : undefined,
                            start: sql`appointment.start_time`,
                            end:
                              sql`date.add(minute, ${devType.duration}, appointment.start_time)`,
                            sendUpdates: devType.sendCalendarInvites
                              ? sql.lit`all`
                              : sql.lit`none`,
                            attendees: [
                              ...(includeInvitee && inviteeEmail
                                ? [{
                                  email: inviteeEmail,
                                  displayName: inviteeName,
                                }]
                                : []),
                              {
                                email:
                                  sql`(select email from user_google_accounts auto join user_google_calendars where sys_user_id = appointment.sys_user_id and add_to_calendar limit 1)`,
                              },
                              ...(devType.extraAttendees ?? []).map((a) => ({
                                email: sql.lit(a.email),
                                ...(a.displayName
                                  ? { displayName: sql.lit(a.displayName) }
                                  : {}),
                              })),
                            ],
                            eventIdScalar: "cal_event_id",
                            conferenceDataRecord: "cal_conference_data",
                          });
                        s.startTransaction();
                        s.modify(
                          sql`update db.${sql.ref(devType.tableName)} set ${
                            sql.ref(integration.eventIdField)
                          } = cal_event_id,
                          google_conference_link = cal_conference_data.conference_id
                          where id = task.appointment_id`,
                        );
                        s.modify(
                          sql`update db.scheduling_background_tasks
                            set external_resource_id = case
                              when cal_conference_data.conference_id is null
                                then cast(cal_event_id as string)
                              else null
                            end
                            where id = task.id`,
                        );
                        s.commitTransaction();
                      };
                      s.if(
                        sql`appointment.${
                          sql.ref(integration.eventIdField)
                        } is null`,
                        (s) => {
                          s.try({
                            body: (s) => {
                              if (inviteeEmail) {
                                s.if(
                                  sql`${inviteeEmail} is not null`,
                                  (s) => createGoogleMeetEvent(s, true),
                                  (s) => createGoogleMeetEvent(s, false),
                                );
                              } else {
                                createGoogleMeetEvent(s, false);
                              }
                            },
                            errorName: "calendar_error",
                            catch: (s) => {
                              s.rollbackTransaction();
                              s.setScalar("task_failed", sql`true`);
                              s.startTransaction();
                              s.modify(
                                sql`insert into db.scheduling_integration_errors
                                  (error, type, timestamp, task_type, appointment_table, appointment_id, sys_user_id)
                                values (
                                  concat(calendar_error.type, ': ', coalesce(calendar_error.message, ''), ' ', coalesce(calendar_error.description, '')),
                                  'calendar_task',
                                  now(),
                                  task.task_type,
                                  task.appointment_table,
                                  task.appointment_id,
                                  appointment.sys_user_id
                                )`,
                              );
                              s.commitTransaction();
                            },
                          });
                        },
                      );
                      s.if(
                        sql`exists(
                          select 1
                          from db.${sql.ref(devType.tableName)}
                          where id = task.appointment_id
                            and ${sql.ref(integration.eventIdField)} is not null
                            and google_conference_link is null
                        )`,
                        (s) => {
                          this.pollGoogleMeetConference(s, {
                            appointmentTable: devType.tableName,
                            eventIdField: integration.eventIdField,
                            userId: sql`appointment.sys_user_id`,
                            eventId: sql`(select ${
                              sql.ref(integration.eventIdField)
                            } from db.${
                              sql.ref(devType.tableName)
                            } where id = task.appointment_id)`,
                            conferenceDataRecord: "dev_google_conference_data",
                            scheduleOnSuccess: true,
                            storeFullMeetUrl: false,
                          });
                        },
                      );
                    },
                    (s) => {
                      s.throwError(
                        sql
                          .lit`The host does not have a writable Google Calendar.`,
                      );
                    },
                  );
                } else {
                  calendarBlock.addToPrimaryUserCalendar(s, {
                    creationId:
                      integration.integration === OutlookCalendarIntegration
                        ? ensureCalendarCreationId(s, {
                          appointmentTable: devType.tableName,
                          appointmentId: sql`appointment.id`,
                          eventIdField: integration.eventIdField,
                        })
                        : undefined,
                    userId: sql`appointment.sys_user_id`,
                    eventIdScalar: "cal_event_id",
                    summary: devType.calendarTitle
                      ? devType.calendarTitle(sql.ref("appointment"))
                      : sql.lit(devType.displayName),
                    start: sql`appointment.start_time`,
                    end:
                      sql`date.add(minute, ${devType.duration}, appointment.start_time)`,
                  });
                  s.startTransaction();
                  s.modify(
                    sql`update db.${sql.ref(devType.tableName)} set ${
                      sql.ref(integration.eventIdField)
                    } = cal_event_id where id = task.appointment_id`,
                  );
                  s.commitTransaction();
                }
              },
            );
          }
          if (devType.meetingLocation === "google_meet") {
            s.startTransaction();
            s.modify(
              sql`update db.${sql.ref(devType.tableName)}
                set status = 'scheduled'
                where id = task.appointment_id
                  and status = 'creating'
                  and google_conference_link is not null`,
            );
            s.commitTransaction();
          }
        },
      );
    }
  }

  private handleCalendarUpdate<T extends IServerBaseStatements>(s: T) {
    for (const devType of this.opts.devDefinedEventTypes ?? []) {
      s.if(
        sql`task.appointment_table = ${sql.lit(devType.tableName)}`,
        (s) => {
          s.if(
            sql`not exists(
              select 1
              from db.${sql.ref(devType.tableName)}
              where id = task.appointment_id
                and status = 'scheduled'
            )`,
            (s) => s.return(),
          );
          s.defRecord(
            "appointment",
            sql`select * from ${
              sql.ref(devType.tableName)
            } where id = task.appointment_id`,
          );
          const inviteeEmail = this.inviteeEmail(
            devType.tableName,
            sql.ref("appointment"),
            devType,
          );
          const inviteeName = this.inviteeDisplayName(
            devType.tableName,
            sql.ref("appointment"),
            devType,
          );
          for (const integration of this.opts.calendarIntegrations) {
            const calendarBlock = system.block(integration.integration);
            s.if(
              sql`appointment.${sql.ref(integration.eventIdField)} is not null`,
              (s) => {
                const updateCalendarEvent = (s: IServerBaseStatements) => {
                  calendarBlock.updatePrimaryUserCalendarEvent(s, {
                    userId: sql`appointment.sys_user_id`,
                    eventId: sql`appointment.${
                      sql.ref(integration.eventIdField)
                    }`,
                    summary: devType.calendarTitle
                      ? devType.calendarTitle(sql.ref("appointment"))
                      : this.devDefinedMeetingTopic(
                        devType,
                        sql.ref("appointment"),
                      ),
                    start: sql`appointment.start_time`,
                    end:
                      sql`date.add(minute, appointment.duration, appointment.start_time)`,
                  });
                };
                if (
                  integration.integration === GoogleCalendarIntegration &&
                  devType.meetingLocation === "google_meet"
                ) {
                  s.if(
                    sql`appointment.google_conference_link is null`,
                    (s) => {
                      this.pollGoogleMeetConference(s, {
                        appointmentTable: devType.tableName,
                        eventIdField: integration.eventIdField,
                        userId: sql`appointment.sys_user_id`,
                        eventId: sql`appointment.${
                          sql.ref(integration.eventIdField)
                        }`,
                        conferenceDataRecord:
                          "dev_update_google_conference_data",
                        scheduleOnSuccess: false,
                        storeFullMeetUrl: false,
                      });
                    },
                    updateCalendarEvent,
                  );
                } else {
                  updateCalendarEvent(s);
                }
              },
              (s) => {
                if (!integration.addToCalendar) {
                  return;
                }
                // No calendar event exists — create one (mirrors handleCalendarAdd)
                if (
                  integration.integration === GoogleCalendarIntegration &&
                  devType.meetingLocation === "google_meet"
                ) {
                  this.setGoogleMeetTaskMarker(
                    s,
                    sql`task.id`,
                    sql.lit`google_meet_creation`,
                  );
                  s.defScalar(
                    "user_google_calendar_id",
                    sql`(select user_google_calendars.id
                      from user_google_calendars
                        auto join user_google_accounts
                      where sys_user_id = appointment.sys_user_id and add_to_calendar)`,
                  );
                  s.if(
                    sql`user_google_calendar_id is not null`,
                    (s) => {
                      const createGoogleMeetEvent = (
                        s: IServerBaseStatements,
                        includeInvitee: boolean,
                      ) => {
                        system.block(GoogleCalendarIntegration)
                          .addToCalendarWithMeet(s, {
                            calendarId: sql`user_google_calendar_id`,
                            summary: devType.calendarTitle
                              ? devType.calendarTitle(sql.ref("appointment"))
                              : sql.lit(devType.displayName),
                            description: devType.calendarDescription
                              ? devType.calendarDescription(
                                sql.ref("appointment"),
                              )
                              : undefined,
                            start: sql`appointment.start_time`,
                            end:
                              sql`date.add(minute, ${devType.duration}, appointment.start_time)`,
                            sendUpdates: devType.sendCalendarInvites
                              ? sql.lit`all`
                              : sql.lit`none`,
                            attendees: [
                              ...(includeInvitee && inviteeEmail
                                ? [{
                                  email: inviteeEmail,
                                  displayName: inviteeName,
                                }]
                                : []),
                              {
                                email:
                                  sql`(select email from user_google_accounts auto join user_google_calendars where sys_user_id = appointment.sys_user_id and add_to_calendar limit 1)`,
                              },
                              ...(devType.extraAttendees ?? []).map((a) => ({
                                email: sql.lit(a.email),
                                ...(a.displayName
                                  ? { displayName: sql.lit(a.displayName) }
                                  : {}),
                              })),
                            ],
                            eventIdScalar: "cal_event_id",
                            conferenceDataRecord: "cal_conference_data",
                          });
                        s.startTransaction();
                        s.modify(
                          sql`update db.${sql.ref(devType.tableName)} set ${
                            sql.ref(integration.eventIdField)
                          } = cal_event_id,
                          google_conference_link = cal_conference_data.conference_id
                          where id = task.appointment_id`,
                        );
                        s.modify(
                          sql`update db.scheduling_background_tasks
                            set external_resource_id = case
                              when cal_conference_data.conference_id is null
                                then cast(cal_event_id as string)
                              else null
                            end
                            where id = task.id`,
                        );
                        s.commitTransaction();
                      };
                      s.try({
                        body: (s) => {
                          if (inviteeEmail) {
                            s.if(
                              sql`${inviteeEmail} is not null`,
                              (s) => createGoogleMeetEvent(s, true),
                              (s) => createGoogleMeetEvent(s, false),
                            );
                          } else {
                            createGoogleMeetEvent(s, false);
                          }
                        },
                        errorName: "calendar_error",
                        catch: (s) => {
                          s.rollbackTransaction();
                          s.setScalar("task_failed", sql`true`);
                          s.startTransaction();
                          s.modify(
                            sql`insert into db.scheduling_integration_errors
                              (error, type, timestamp, task_type, appointment_table, appointment_id, sys_user_id)
                            values (
                              concat(calendar_error.type, ': ', coalesce(calendar_error.message, ''), ' ', coalesce(calendar_error.description, '')),
                              'calendar_task',
                              now(),
                              task.task_type,
                              task.appointment_table,
                              task.appointment_id,
                              appointment.sys_user_id
                            )`,
                          );
                          s.commitTransaction();
                        },
                      });
                      s.if(
                        sql`exists(
                          select 1
                          from db.${sql.ref(devType.tableName)}
                          where id = task.appointment_id
                            and ${sql.ref(integration.eventIdField)} is not null
                            and google_conference_link is null
                        )`,
                        (s) => {
                          this.pollGoogleMeetConference(s, {
                            appointmentTable: devType.tableName,
                            eventIdField: integration.eventIdField,
                            userId: sql`appointment.sys_user_id`,
                            eventId: sql`(select ${
                              sql.ref(integration.eventIdField)
                            } from db.${
                              sql.ref(devType.tableName)
                            } where id = task.appointment_id)`,
                            conferenceDataRecord:
                              "dev_created_update_google_conference_data",
                            scheduleOnSuccess: false,
                            storeFullMeetUrl: false,
                          });
                        },
                      );
                    },
                  );
                } else {
                  calendarBlock.addToPrimaryUserCalendar(s, {
                    creationId:
                      integration.integration === OutlookCalendarIntegration
                        ? ensureCalendarCreationId(s, {
                          appointmentTable: devType.tableName,
                          appointmentId: sql`appointment.id`,
                          eventIdField: integration.eventIdField,
                        })
                        : undefined,
                    userId: sql`appointment.sys_user_id`,
                    eventIdScalar: "cal_event_id",
                    summary: devType.calendarTitle
                      ? devType.calendarTitle(sql.ref("appointment"))
                      : sql.lit(devType.displayName),
                    start: sql`appointment.start_time`,
                    end:
                      sql`date.add(minute, ${devType.duration}, appointment.start_time)`,
                  });
                  s.startTransaction();
                  s.modify(
                    sql`update db.${sql.ref(devType.tableName)} set ${
                      sql.ref(integration.eventIdField)
                    } = cal_event_id where id = task.appointment_id`,
                  );
                  s.commitTransaction();
                }
              },
            );
          }
        },
      );
    }
  }

  private handleCalendarDelete<T extends IServerBaseStatements>(s: T) {
    for (const integration of this.opts.calendarIntegrations) {
      const calendarBlock = system.block(integration.integration);
      s.if(
        sql`task.provider = ${sql.lit(calendarBlock.integrationName)}
          and task.target_user_id is not null
          and task.external_resource_id is not null`,
        (s) => {
          s.if(
            sql`not exists(
              select 1 from db.${sql.ref(calendarBlock.accountTable)}
              where sys_user_id = task.target_user_id
                and ${calendarBlock.isActiveAccount}
            )`,
            (s) => {
              s.throwError(
                sql
                  .lit`The previous host's calendar connection is unavailable.`,
              );
            },
          );
          calendarBlock.deletePrimaryUserCalendarEvent(s, {
            userId: sql`task.target_user_id`,
            eventId: sql`task.external_resource_id`,
          });
        },
      );
    }
    for (const tableName of this.allAppointmentTableNames()) {
      s.if(
        sql`task.provider is null
          and task.appointment_table = ${sql.lit(tableName)}`,
        (s) => {
          s.defRecord(
            "appointment",
            sql`select * from ${
              sql.ref(tableName)
            } where id = task.appointment_id`,
          );
          for (const integration of this.opts.calendarIntegrations) {
            const calendarBlock = system.block(integration.integration);
            s.if(
              sql`appointment.${sql.ref(integration.eventIdField)} is not null`,
              (s) => {
                calendarBlock.deletePrimaryUserCalendarEvent(s, {
                  userId: sql`appointment.sys_user_id`,
                  eventId: sql`appointment.${
                    sql.ref(integration.eventIdField)
                  }`,
                });
                s.startTransaction();
                s.modify(
                  sql`update db.${sql.ref(tableName)} set ${
                    sql.ref(integration.eventIdField)
                  } = null where id = task.appointment_id`,
                );
                s.commitTransaction();
              },
            );
          }
        },
      );
    }
  }

  private handleMeetingCreate<T extends IServerBaseStatements>(s: T) {
    for (
      const meetingIntegration of this.opts.meetingIntegrations ?? []
    ) {
      if (!meetingIntegration.addToMeeting) continue;
      const meetingBlock = system.block(meetingIntegration.integration);
      const integrationLocation = meetingBlock.integrationName.toLowerCase()
        .replaceAll(" ", "_");

      for (const devType of this.opts.devDefinedEventTypes ?? []) {
        if (devType.meetingLocation !== integrationLocation) {
          continue;
        }
        s.if(
          sql`task.appointment_table = ${sql.lit(devType.tableName)}
            and (task.provider is null or task.provider = ${
            sql.lit(meetingBlock.integrationName)
          })`,
          (s) => {
            s.if(
              sql`not exists(
                select 1
                from db.${sql.ref(devType.tableName)}
                where id = task.appointment_id
                  and status in ('creating', 'scheduled')
              )`,
              (s) => s.return(),
            );
            s.defRecord(
              "appointment",
              sql`select * from ${
                sql.ref(devType.tableName)
              } where id = task.appointment_id`,
            );
            s.if(
              sql`task.provider is not null
                and (
                  task.target_user_id is null
                  or appointment.sys_user_id != task.target_user_id
                  or not exists(
                    select 1 from db.${sql.ref(meetingBlock.accountTable)}
                    where sys_user_id = task.target_user_id
                      and ${meetingBlock.isActiveAccount}
                  )
                )`,
              (s) => {
                s.throwError(
                  sql.lit`The new host's meeting connection is unavailable.`,
                );
              },
            );
            s.if(
              sql`appointment.${
                sql.ref(meetingIntegration.meetingIdField)
              } is null`,
              (s) => {
                s.defScalar("meeting_id", {
                  type: { type: "String", maxLength: 255 },
                });
                s.defScalar("meeting_url", {
                  type: { type: "String", maxLength: 255 },
                });
                s.defScalar("meeting_password", {
                  type: { type: "String", maxLength: 255 },
                });
                s.try({
                  body: (s) => {
                    meetingBlock.createMeeting(s, {
                      userId: sql`appointment.sys_user_id`,
                      topic: this.devDefinedMeetingTopic(
                        devType,
                        sql.ref("appointment"),
                      ),
                      startTime: sql`appointment.start_time`,
                      duration: devType.duration,
                      meetingIdScalar: "meeting_id",
                      meetingUrlScalar: "meeting_url",
                      meetingPasswordScalar: "meeting_password",
                      timeZone:
                        sql`date.part(timezone, appointment.start_time)`,
                    });
                  },
                  errorName: "meeting_error",
                  catch: (s) => {
                    s.rollbackTransaction();
                    s.setScalar("task_failed", sql`true`);
                    s.startTransaction();
                    s.modify(
                      sql`insert into db.scheduling_integration_errors
                        (error, type, timestamp, task_type, appointment_table, appointment_id, sys_user_id)
                      values (
                        concat(meeting_error.type, ': ', coalesce(meeting_error.message, ''), ' ', coalesce(meeting_error.description, '')),
                        'meeting_task',
                        now(),
                        task.task_type,
                        task.appointment_table,
                        task.appointment_id,
                        appointment.sys_user_id
                      )`,
                    );
                    s.commitTransaction();
                  },
                });
                s.startTransaction();
                s.if(
                  sql`meeting_id is not null`,
                  (s) => {
                    s.modify(
                      sql`update db.${sql.ref(devType.tableName)} set ${
                        sql.ref(meetingIntegration.meetingIdField)
                      } = meeting_id,
                      ${
                        sql.ref(meetingIntegration.meetingIdField)
                      }_join_url = meeting_url,
                      status = 'scheduled'
                      where id = task.appointment_id`,
                    );
                  },
                  (s) => {
                    s.modify(
                      sql`update db.${
                        sql.ref(devType.tableName)
                      } set status = 'scheduled'
                      where id = task.appointment_id`,
                    );
                  },
                );
                s.commitTransaction();
              },
            );
          },
        );
      }
    }
  }

  private handleMeetingUpdate<T extends IServerBaseStatements>(s: T) {
    for (
      const meetingIntegration of this.opts.meetingIntegrations ?? []
    ) {
      const meetingBlock = system.block(meetingIntegration.integration);

      for (const devType of this.opts.devDefinedEventTypes ?? []) {
        s.if(
          sql`task.appointment_table = ${sql.lit(devType.tableName)}`,
          (s) => {
            s.if(
              sql`not exists(
                select 1
                from db.${sql.ref(devType.tableName)}
                where id = task.appointment_id
                  and status = 'scheduled'
              )`,
              (s) => s.return(),
            );
            s.defRecord(
              "appointment",
              sql`select * from ${
                sql.ref(devType.tableName)
              } where id = task.appointment_id`,
            );
            s.if(
              sql`appointment.${
                sql.ref(meetingIntegration.meetingIdField)
              } is not null`,
              (s) => {
                meetingBlock.updateMeeting(
                  s,
                  {
                    meetingId: sql`appointment.${
                      sql.ref(meetingIntegration.meetingIdField)
                    }`,
                    topic: this.devDefinedMeetingTopic(
                      devType,
                      sql.ref("appointment"),
                    ),
                    startTime: sql`appointment.start_time`,
                    duration: sql`${devType.duration}`,
                    userId: sql`appointment.sys_user_id`,
                    timezone: sql`date.part(timezone, appointment.start_time)`,
                  },
                );
              },
            );
          },
        );
      }
    }
  }

  private handleMeetingDelete<T extends IServerBaseStatements>(s: T) {
    for (
      const meetingIntegration of this.opts.meetingIntegrations ?? []
    ) {
      const meetingBlock = system.block(meetingIntegration.integration);
      s.if(
        sql`task.provider = ${sql.lit(meetingBlock.integrationName)}
          and task.target_user_id is not null
          and task.external_resource_id is not null`,
        (s) => {
          s.if(
            sql`not exists(
              select 1 from db.${sql.ref(meetingBlock.accountTable)}
              where sys_user_id = task.target_user_id
                and ${meetingBlock.isActiveAccount}
            )`,
            (s) => {
              s.throwError(
                sql.lit`The previous host's meeting connection is unavailable.`,
              );
            },
          );
          meetingBlock.deleteMeeting(s, {
            userId: sql`task.target_user_id`,
            meetingId: sql`task.external_resource_id`,
          });
        },
      );
      // User-defined appointments have a password column, dev-defined don't

      for (const devType of this.opts.devDefinedEventTypes ?? []) {
        s.if(
          sql`task.provider is null
            and task.appointment_table = ${sql.lit(devType.tableName)}`,
          (s) => {
            deleteMeetingFromTable(
              s,
              devType.tableName,
              meetingIntegration,
              false,
            );
          },
        );
      }
    }
  }

  private handleEmailDev<T extends IServerBaseStatements>(s: T) {
    const idempotencyKey =
      sql`'scheduling-background-email-' || cast(task.id as string)`;
    for (const devType of this.opts.devDefinedEventTypes ?? []) {
      s.if(
        sql`task.appointment_table = ${sql.lit(devType.tableName)}`,
        (s) => {
          s.if(
            sql`task.email_type in (
                'invitee_reschedule_email',
                'host_reschedule_email',
                'invitee_confirmation_email',
                'host_confirmation_email'
              )
              and not exists(
                select 1
                from db.${sql.ref(devType.tableName)}
                where id = task.appointment_id
                  and status in ('creating', 'scheduled')
                  and cast(public_id as string) = task.external_resource_id
                  and (
                    task.email_type not in (
                      'host_reschedule_email',
                      'host_confirmation_email'
                    )
                    or sys_user_id = task.target_user_id
                  )
              )`,
            (s) => {
              s.return();
            },
          );
          const waitingForMeeting = sql`
            task.email_type in (
              'invitee_confirmation_email',
              'host_confirmation_email',
              'invitee_reschedule_email',
              'host_reschedule_email'
            )
            and exists(
              select 1
              from db.${sql.ref(devType.tableName)}
              where id = task.appointment_id
                and status = 'creating'
            )
          `;
          s.if(
            waitingForMeeting,
            (s) => {
              this.deferBackgroundTask(s);
              s.return();
            },
          );
          s.if(
            sql`task.email_type in (
                'invitee_confirmation_email',
                'host_confirmation_email'
              )
              and not exists(
                select 1
                from db.${sql.ref(devType.tableName)}
                where id = task.appointment_id
                  and status = 'scheduled'
              )`,
            (s) => {
              s.return();
            },
          );
          if (devType.notifications?.confirmationEmail) {
            s.if(
              sql`task.email_type = 'invitee_confirmation_email'`,
              (s) => {
                this.sendDevEmail(s, {
                  type: devType,
                  email: devType.notifications!.confirmationEmail!,
                  appointmentId: sql`task.appointment_id`,
                  emailType: "invitee_confirmation_email",
                  idempotencyKey,
                });
              },
            );
          }
          if (devType.notifications?.cancellationEmail) {
            s.if(
              sql`task.email_type = 'invitee_cancellation_email'`,
              (s) => {
                this.sendDevEmail(s, {
                  type: devType,
                  email: devType.notifications!.cancellationEmail!,
                  appointmentId: sql`task.appointment_id`,
                  emailType: "invitee_cancellation_email",
                  idempotencyKey,
                });
              },
            );
          }
          for (
            const [i, reminder] of (
              devType.notifications?.emailReminders ?? []
            ).entries()
          ) {
            s.if(
              sql`task.email_type = ${sql.lit(`email_reminder_${i}`)}`,
              (s) => {
                this.sendDevEmail(s, {
                  type: devType,
                  email: reminder,
                  appointmentId: sql`task.appointment_id`,
                  emailType: `email_reminder_${i}`,
                  idempotencyKey,
                });
              },
            );
          }
          if (devType.notifications?.hostConfirmationEmail) {
            s.if(
              sql`task.email_type = 'host_confirmation_email'`,
              (s) => {
                this.sendDevEmail(s, {
                  type: devType,
                  email: devType.notifications!.hostConfirmationEmail!,
                  appointmentId: sql`task.appointment_id`,
                  emailType: "host_confirmation_email",
                  idempotencyKey,
                });
              },
            );
          }
          if (devType.notifications?.hostCancellationEmail) {
            s.if(
              sql`task.email_type = 'host_cancellation_email'`,
              (s) => {
                this.sendDevEmail(s, {
                  type: devType,
                  email: devType.notifications!.hostCancellationEmail!,
                  appointmentId: sql`task.appointment_id`,
                  emailType: "host_cancellation_email",
                  idempotencyKey,
                });
              },
            );
          }
          if (devType.notifications?.hostRescheduleEmail) {
            s.if(
              sql`task.email_type = 'host_reschedule_email'`,
              (s) => {
                this.sendDevEmail(s, {
                  type: devType,
                  email: devType.notifications!.hostRescheduleEmail!,
                  appointmentId: sql`task.appointment_id`,
                  emailType: "host_reschedule_email",
                  idempotencyKey,
                });
              },
            );
          }
          if (devType.notifications?.inviteeRescheduleEmail) {
            s.if(
              sql`task.email_type = 'invitee_reschedule_email'`,
              (s) => {
                this.sendDevEmail(s, {
                  type: devType,
                  email: devType.notifications!.inviteeRescheduleEmail!,
                  appointmentId: sql`task.appointment_id`,
                  emailType: "invitee_reschedule_email",
                  idempotencyKey,
                });
              },
            );
          }
        },
      );
    }
  }

  private handleCalendarCleanup<T extends IServerBaseStatements>(s: T) {
    for (const integration of this.opts.calendarIntegrations) {
      const calendarBlock = system.block(integration.integration);
      s.if(
        sql`task.calendar_table = ${sql.lit(calendarBlock.calendarTable)}
          and exists(select 1 from ${
          sql.ref(calendarBlock.calendarTable)
        } where id = task.calendar_id and not add_to_calendar)`,
        (s) => {
          calendarBlock.deleteEventsFromOldCalendar(s, {
            calendarId: sql`task.calendar_id`,
          });
        },
      );
    }
  }

  // Use getters for imports that have circular dependencies with this file
  // No circular dependencies for these
  static AppointmentsPage = AppointmentsPage;
  static PreviewAvailabilityPage = PreviewAvailabilityPage;
  static IntegrationsPage = IntegrationsPage;
  static inviteeEmailFooter = inviteeEmailFooter;
  static inviteeEmailWithFooter = inviteeEmailWithFooter;
  static DevDefinedSchedulingPages = DevDefinedSchedulingPages;
  static ErrorIntegrationsPage = ErrorIntegrationsPage;
  static TimeOffPage = TimeOffPage;
}
