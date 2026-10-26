import { sql } from "../../std/sql_utils";
import type { AnyExpr, NumericExpr } from "../../std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { Route } from "std/ui";
import type { FormContext } from "std/form";
import { ScheduleInterface, SuccessMessage } from "./dev_schedule_form";
import type { SchedulingBlock } from "./index";
import type { DevDefinedEventType } from "./index";
import { RescheduleForm } from "./reschedule_form";
import { Scheduling } from "./scheduling";

interface DevSchedulingPageProps {
  devDefinedEventType: string;
  path: string;
  description?: Node;
  form: Node;
  appointmentPublicId?: AnyExpr;
  insertValues?: Record<string, AnyExpr>;
  afterTransactionStart?: (s: UiServerStatements, ctx: FormContext) => void;
  afterTransactionCommit?: (
    s: UiServerStatements,
    createdAppointmentId: NumericExpr,
    ctx: FormContext,
  ) => void;
  beforeTransactionCommit?: (
    s: UiServerStatements,
    createdAppointmentId: NumericExpr,
    ctx: FormContext,
  ) => void;
  poweredByYolm?: boolean;
  backgroundColorOverride?: string;
}

function SchedulingPageInner(props: DevSchedulingPageProps) {
  const schedulingBlock = system.blockNamed<SchedulingBlock>("SchedulingBlock");
  const eventType = schedulingBlock.getDevDefinedEventType(
    props.devDefinedEventType,
  ) as DevDefinedEventType;
  if (!eventType) {
    throw new Error(
      `DevDefinedEventType ${props.devDefinedEventType} not found`,
    );
  }
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("current_month", sql`date.trunc(month, current_date())`);
        s.defScalar("user_timezone", sql`date.part(timezone, now())`);
        s.defScalar("selected_date", {
          type: "Date",
        });
      }}
    >
      <Data
        watch={[
          sql`current_month`,
          sql`user_timezone`,
          sql`selected_date`,
        ]}
        pendingFallback={null}
        errorFallback={null}
        procedure={(s) => {
          schedulingBlock.getFullMonthCalendar(s, {
            month: sql`current_month`,
            calendarDaysTable: "calendar_days",
            slotsTable: "all_slots",
            filterUserId: (userId) =>
              eventType.sysUserFilter
                ? sql`${userId} in (select id from sys_users where ${
                  eventType.sysUserFilter(sql.ref("sys_users"))
                })`
                : sql.true,
            userTimezone: sql`user_timezone`,
            minNotice: eventType.minNotice,
            maxNotice: eventType.maxNotice,
            bufferBefore: eventType.bufferBefore,
            bufferAfter: eventType.bufferAfter,
            duration: eventType.duration,
            timeSlotsInterval: eventType.timeSlotsInterval,
            selectedDate: sql`selected_date`,
          });
          s.if(sql`selected_date is not null`, (s) => {
            s.defTable(
              "time_slots",
              sql`
          select start_time
          from all_slots
          where date = selected_date
          group by start_time
          order by start_time`,
            );
          });
        }}
      >
        <>
          <title>{eventType.displayName}</title>
          <Scheduling
            name={sql.lit(eventType.displayName)}
            duration={eventType.duration}
            description={props.description}
            selectedDateScalar="selected_date"
            appointmentsTable={eventType.tableName}
            timeSlotsTable="time_slots"
            calendarTable="calendar_days"
            poweredByYolm={props.poweredByYolm}
            backgroundColorOverride={props.backgroundColorOverride}
            onNextSlotClick={(s, value) => {
              s.tryServer({
                body: (s) => {
                  schedulingBlock.getAvailableSlotsForDay(s, {
                    date: sql`selected_date`,
                    slotsTable: "fresh_slots",
                    filterUserId: (userId) =>
                      eventType.sysUserFilter
                        ? sql`${userId} in (select id from sys_users where ${
                          eventType.sysUserFilter(sql.ref("sys_users"))
                        })`
                        : sql.true,
                    userTimezone: sql`user_timezone`,
                    minNotice: eventType.minNotice,
                    maxNotice: eventType.maxNotice,
                    bufferBefore: eventType.bufferBefore,
                    bufferAfter: eventType.bufferAfter,
                    duration: eventType.duration,
                    timeSlotsInterval: eventType.timeSlotsInterval,
                  });
                  s.if(
                    sql`exists(select 1 from fresh_slots where start_time = ${value})`,
                    (s) => {
                      s.setScalar("time_slots_time", sql`${value}`);
                      s.setScalar("selected_time", sql`${value}`);
                      s.setScalar("show_schedule_interface", true);
                      s.setScalar("slot_just_taken", false);
                    },
                    (s) => {
                      s.setScalar("slot_just_taken", true);
                      s.refetch();
                    },
                  );
                },
              });
            }}
            scheduleInterface={
              <ScheduleInterface
                type={props.devDefinedEventType}
                form={props.form}
                afterTransactionStart={props.afterTransactionStart}
                beforeTransactionCommit={(s, createdAppointmentId, ctx) => {
                  props.beforeTransactionCommit?.(
                    s,
                    createdAppointmentId,
                    ctx,
                  );
                }}
                afterTransactionCommit={props.afterTransactionCommit}
                insertValues={props.insertValues}
              />
            }
            successMessage={
              <SuccessMessage
                type={props.devDefinedEventType}
                addToCalendarTitle={sql
                  .lit`Scheduled appointment for ${eventType.displayName}`}
              />
            }
          />
        </>
      </Data>
    </Data>
  );
}

export function DevSchedulingPage(props: DevSchedulingPageProps) {
  return (
    <Route path={props.path}>
      <SchedulingPageInner {...props} />
    </Route>
  );
}

function ReschedulingPageInner(props: DevSchedulingPageProps) {
  const schedulingBlock = system.blockNamed<SchedulingBlock>("SchedulingBlock");
  const eventType = schedulingBlock.getDevDefinedEventType(
    props.devDefinedEventType,
  );
  if (!eventType) {
    throw new Error(
      `DevDefinedEventType ${props.devDefinedEventType} not found`,
    );
  }
  const appointmentPublicId = props.appointmentPublicId ??
    sql`ui.appointment_public_id`;
  return (
    <Data
      pendingFallback={null}
      errorFallback={null}
      procedure={(s) => {
        s.defRecord(
          "appointment_record",
          sql`select * from ${sql.ref(eventType.tableName)} where ${
            sql.ref(eventType.tableName)
          }.public_id = ${appointmentPublicId}
            and ${sql.ref(eventType.tableName)}.status = 'scheduled'`,
        );
        s.defScalar("current_month", sql`date.trunc(month, current_date())`);
        s.defScalar("user_timezone", sql`date.part(timezone, now())`);
        s.defScalar("selected_date", {
          type: "Date",
        });
      }}
    >
      <Data
        watch={[
          sql`current_month`,
          sql`user_timezone`,
          sql`selected_date`,
        ]}
        pendingFallback={null}
        errorFallback={null}
        procedure={(s) => {
          schedulingBlock.getFullMonthCalendar(s, {
            month: sql`current_month`,
            calendarDaysTable: "calendar_days",
            slotsTable: "all_slots",
            filterUserId: (userId) =>
              sql`${userId} = (select sys_user_id from ${
                sql.ref(eventType.tableName)
              } where public_id = ${appointmentPublicId})`,
            userTimezone: sql`user_timezone`,
            minNotice: eventType.minNotice,
            maxNotice: eventType.maxNotice,
            bufferBefore: eventType.bufferBefore,
            bufferAfter: eventType.bufferAfter,
            duration: eventType.duration,
            timeSlotsInterval: eventType.timeSlotsInterval,
            selectedDate: sql`selected_date`,
            excludeAppointment: {
              table: eventType.tableName,
              id: sql`(select id from ${
                sql.ref(eventType.tableName)
              } where public_id = ${appointmentPublicId})`,
            },
          });
          s.if(sql`selected_date is not null`, (s) => {
            s.defTable(
              "time_slots",
              sql`
          select start_time
          from all_slots
          where date = selected_date
          group by start_time
          order by start_time`,
            );
          });
        }}
      >
        <>
          <title>{eventType.displayName}</title>
          <Scheduling
            name={sql.lit(eventType.displayName)}
            duration={eventType.duration}
            description={props.description}
            selectedDateScalar="selected_date"
            appointmentsTable={eventType.tableName}
            timeSlotsTable="time_slots"
            calendarTable="calendar_days"
            poweredByYolm={props.poweredByYolm}
            reschedule
            rescheduleAppointmentPublicId={appointmentPublicId}
            scheduleInterface={
              <RescheduleForm
                form={props.form}
                appointmentId={sql`appointment_record.id`}
                appointmentsTable={eventType.tableName}
                type="dev"
                beforeTransactionCommit={(s) => {
                  schedulingBlock.enqueueDevDefinedAppointmentTasks(s, {
                    eventType,
                    appointmentId: sql`appointment_record.id`,
                    change: "rescheduled",
                    insideTransaction: true,
                  });
                }}
              />
            }
            successMessage={
              <SuccessMessage
                type={props.devDefinedEventType}
                addToCalendarTitle={sql
                  .lit`Scheduled appointment for ${eventType.displayName}`}
              />
            }
          />
        </>
      </Data>
    </Data>
  );
}

export function DevReschedulingPage(props: DevSchedulingPageProps) {
  return (
    <Route path={props.path}>
      <ReschedulingPageInner {...props} />
    </Route>
  );
}
