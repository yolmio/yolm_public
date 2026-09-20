import { GoogleCalendarIntegration } from "blocks/calendar_integrations/google";
import type { MeetingIntegrationConstructor } from "blocks/meeting_integrations";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";

/** Persist before the provider call: public booking IDs rotate on reschedule. */
export function ensureCalendarCreationId<T extends IServerBaseStatements>(
  s: T,
  opts: {
    appointmentTable: string;
    appointmentId: NumericExpr;
    eventIdField: string;
  },
): Sql {
  const field = sql.ref(`${opts.eventIdField}_creation_id`);
  s.startTransaction();
  s.modify(sql`update db.${sql.ref(opts.appointmentTable)}
    set ${field} = random.uuid()
    where id = ${opts.appointmentId} and ${field} is null`);
  s.commitTransaction();
  s.defScalar(
    "calendar_creation_id",
    sql`(select cast(${field} as string)
    from db.${
      sql.ref(opts.appointmentTable)
    } where id = ${opts.appointmentId})`,
  );
  s.if(sql`calendar_creation_id is null`, (s) => {
    s.throwError(
      sql.lit`The appointment is no longer available for calendar creation`,
    );
  });
  return sql`calendar_creation_id`;
}

/** Shared statement construction; callers retain event-model and retry decisions. */
export function enqueueBackgroundTask<T extends IServerBaseStatements>(
  s: T,
  opts: {
    taskType: string;
    appointmentTable: string;
    appointmentId?: NumericExpr;
    calendarId?: NumericExpr;
    calendarTable?: string;
    emailType?: string;
    provider?: string;
    targetUserId?: NumericExpr;
    externalResourceId?: Sql;
    insideTransaction?: boolean;
  },
) {
  const idExpr = opts.taskType === "calendar_cleanup"
    ? opts.calendarId
    : opts.appointmentId;
  if (!idExpr) {
    throw new Error(`${opts.taskType} background task requires an id`);
  }
  if (opts.taskType === "calendar_cleanup" && !opts.calendarTable) {
    throw new Error(
      "calendar_cleanup background task requires a calendar table",
    );
  }
  s.if(sql`${idExpr} is not null`, (s) => {
    if (!opts.insideTransaction) {
      s.startTransaction();
    }
    s.modify(
      sql`insert into db.scheduling_background_tasks
          (task_type, appointment_table, appointment_id, calendar_id, calendar_table, email_type, provider, target_user_id, external_resource_id, created_at)
          values (${
        sql.lit(opts.taskType)
      }::enums.scheduling_background_task_type, ${
        sql.lit(opts.appointmentTable)
      }, ${opts.appointmentId ?? sql.null}, ${opts.calendarId ?? sql.null}, ${
        opts.calendarTable ? sql.lit(opts.calendarTable) : sql.null
      }, ${opts.emailType ? sql.lit(opts.emailType) : sql.null}, ${
        opts.provider ? sql.lit(opts.provider) : sql.null
      }, ${opts.targetUserId ?? sql.null}, ${
        opts.externalResourceId ?? sql.null
      }, now())`,
    );
    if (!opts.insideTransaction) {
      s.commitTransaction();
    }
  });
}

/** Runs in the background handler's `task`/`task_failed` scope. Failure policy is caller-owned. */
export function pollGoogleMeetConference<T extends IServerBaseStatements>(
  s: T,
  opts: {
    appointmentTable: string;
    eventIdField: string;
    userId: NumericExpr;
    eventId: Sql;
    conferenceDataRecord: string;
    scheduleOnSuccess: boolean;
    storeFullMeetUrl: boolean;
  },
  lifecycle: {
    setTaskMarker: (s: IServerBaseStatements, eventId: Sql) => void;
    markCreationFailed: (s: IServerBaseStatements) => void;
  },
) {
  lifecycle.setTaskMarker(s, opts.eventId);
  s.defScalar(
    "google_meet_calendar_id",
    sql`(select user_google_calendars.id
        from db.user_google_calendars
        auto join db.user_google_accounts
        where sys_user_id = ${opts.userId}
          and add_to_calendar
        limit 1)`,
  );
  s.if(sql`google_meet_calendar_id is null`, (s) => {
    s.throwError(
      sql.lit`The host does not have a writable Google Calendar.`,
    );
  });
  system.block(GoogleCalendarIntegration).getCalendarEventConferenceData(
    s,
    {
      calendarId: sql`google_meet_calendar_id`,
      eventId: opts.eventId,
      conferenceDataRecord: opts.conferenceDataRecord,
    },
  );
  const conferenceData = sql.ref(opts.conferenceDataRecord);
  s.if(
    sql`${conferenceData}.status_code = 'success'
        and ${conferenceData}.conference_id is not null`,
    (s) => {
      s.startTransaction();
      s.modify(
        sql`update db.${sql.ref(opts.appointmentTable)}
            set google_conference_link = ${
          opts.storeFullMeetUrl
            ? sql`'https://meet.google.com/' || ${conferenceData}.conference_id`
            : sql`${conferenceData}.conference_id`
        }${opts.scheduleOnSuccess ? sql`, status = 'scheduled'` : sql``}
            where id = task.appointment_id
              and ${sql.ref(opts.eventIdField)} = ${opts.eventId}`,
      );
      s.modify(
        sql`update db.scheduling_background_tasks
            set external_resource_id = null
            where id = task.id`,
      );
      s.commitTransaction();
    },
    (s) => {
      s.if(
        sql`${conferenceData}.status_code = 'failure'
            or (
              ${conferenceData}.status_code = 'success'
              and ${conferenceData}.conference_id is null
            )`,
        (s) => {
          s.startTransaction();
          lifecycle.markCreationFailed(s);
          s.commitTransaction();
          s.return();
        },
        (s) => {
          s.setScalar("task_failed", sql`true`);
          s.return();
        },
      );
    },
  );
}

export function deleteMeetingFromTable<T extends IServerBaseStatements>(
  s: T,
  tableName: string,
  meetingIntegration: {
    integration: MeetingIntegrationConstructor;
    meetingIdField: string;
  },
  hasPassword: boolean,
) {
  s.defRecord(
    "appointment",
    sql`select * from ${sql.ref(tableName)} where id = task.appointment_id`,
  );
  s.if(
    sql`appointment.${sql.ref(meetingIntegration.meetingIdField)} is not null`,
    (s) => {
      system.block(meetingIntegration.integration).deleteMeeting(
        s,
        {
          userId: sql`appointment.sys_user_id`,
          meetingId: sql`appointment.${
            sql.ref(meetingIntegration.meetingIdField)
          }`,
        },
      );
      s.startTransaction();
      if (hasPassword) {
        s.modify(
          sql`update db.${sql.ref(tableName)} set ${
            sql.ref(meetingIntegration.meetingIdField)
          } = null, ${
            sql.ref(meetingIntegration.meetingIdField)
          }_join_url = null, ${
            sql.ref(meetingIntegration.meetingIdField)
          }_password = null where id = task.appointment_id`,
        );
      } else {
        s.modify(
          sql`update db.${sql.ref(tableName)} set ${
            sql.ref(meetingIntegration.meetingIdField)
          } = null, ${
            sql.ref(meetingIntegration.meetingIdField)
          }_join_url = null where id = task.appointment_id`,
        );
      }
      s.commitTransaction();
    },
  );
}
