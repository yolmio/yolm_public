import type { SchedulingBlock } from "blocks/scheduling";
import { AddToCalendarButton } from "components/add_to_calendar";
import { Divider } from "components/divider";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { InlineRecordDisplay } from "components/inline_record_display";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import type { Node } from "std/ui";
import { Form } from "std/form";
import type { FormContext } from "std/form";

interface ScheduleInterfaceProps {
  type: string;
  beforeTransactionStart?: (s: UiServerStatements, ctx: FormContext) => void;
  beforeTransactionCommit?: (
    s: UiServerStatements,
    createdAppointmentId: NumericExpr,
    ctx: FormContext,
  ) => void;
  afterTransactionStart?: (s: UiServerStatements, ctx: FormContext) => void;
  afterTransactionCommit?: (
    s: UiServerStatements,
    createdAppointmentId: NumericExpr,
    ctx: FormContext,
  ) => void;
  insertValues?: Record<string, AnyExpr>;
  form: Node;
  backgroundColorOverride?: string;
}

export function ScheduleInterface(props: ScheduleInterfaceProps) {
  const {
    beforeTransactionCommit,
    afterTransactionCommit,
    afterTransactionStart,
    beforeTransactionStart,
  } = props;
  const schedulingBlock = system.blockNamed<SchedulingBlock>("SchedulingBlock");
  const eventType = schedulingBlock.getDevDefinedEventType(props.type);
  if (!eventType) {
    throw new Error(`DevDefinedEventType ${props.type} not found`);
  }
  const createsMeeting = (schedulingBlock.opts.meetingIntegrations ?? []).some(
    (integration) => {
      const block = system.block(integration.integration);
      return integration.addToMeeting &&
        block.integrationName.toLowerCase().replaceAll(" ", "_") ===
          eventType.meetingLocation;
    },
  );
  return (
    <Data
      local
      noRefetch
      procedure={(_s) => {}}
    >
      <div
        sx={{
          display: "flex",
          flexDirection: "column",
          minWidth: "100%",
          px: 4,
          py: 8,
          alignItems: "flex-start",
          md: {
            px: 12,
            minWidth: "500px",
            overflow: "auto",
          },
        }}
      >
        <Form
          defaultFieldComponent={LabelOnTopFormField}
          beforeTransactionStart={(s, ctx) => {
            beforeTransactionStart?.(s, ctx);
          }}
          afterTransactionStart={(s, ctx) => {
            const filter = eventType.sysUserFilter
              ? eventType.sysUserFilter(sql.ref("sys_users"))
              : sql.true;
            schedulingBlock.getAvailableSlotsForDay(s, {
              date: sql`selected_date`,
              slotsTable: "booking_available_slots",
              filterUserId: (userId) =>
                sql`${userId} in (select id from sys_users where ${filter})`,
              userTimezone: sql`user_timezone`,
              bufferBefore: sql`${eventType.bufferBefore}`,
              bufferAfter: sql`${eventType.bufferAfter}`,
              minNotice: sql`${eventType.minNotice}`,
              maxNotice: sql`${eventType.maxNotice}`,
              duration: sql`${eventType.duration}`,
              timeSlotsInterval: sql`${eventType.timeSlotsInterval}`,
            });
            s.defTable(
              "booking_available_users",
              sql`select distinct sys_user_id from booking_available_slots where start_time = selected_time and date = selected_date`,
            );
            s.defScalar(
              "selected_user",
              sql`(select sys_user_id from booking_available_users order by random.int() limit 1)`,
            );
            afterTransactionStart?.(s, ctx);
          }}
          beforeTransactionCommit={(s, ctx) => {
            s.setScalar(
              "created_appointment_id",
              sql`last_record_id(db.${sql.ref(eventType.tableName)})`,
            );
            beforeTransactionCommit?.(s, sql`created_appointment_id`, ctx);
          }}
          afterTransactionCommit={(s, ctx) => {
            s.setScalar("show_success_message", true);
            if (schedulingBlock.opts.calendarIntegrations.length > 0) {
              schedulingBlock.enqueueBackgroundTask(s, {
                taskType: "calendar_add",
                appointmentTable: eventType.tableName,
                appointmentId: sql`created_appointment_id`,
              });
            }
            if (
              createsMeeting
            ) {
              schedulingBlock.enqueueBackgroundTask(s, {
                taskType: "meeting_create",
                appointmentTable: eventType.tableName,
                appointmentId: sql`created_appointment_id`,
              });
            }
            afterTransactionCommit?.(s, sql`created_appointment_id`, ctx);
          }}
        >
          <Form.Insert
            table={eventType.tableName}
            values={{
              sys_user_id: sql`selected_user`,
              status: eventType.meetingLocation === "custom" ||
                  eventType.meetingLocation === "phone" ||
                  (eventType.meetingLocation !== "google_meet" &&
                    !createsMeeting)
                ? sql`'scheduled'`
                : sql`'creating'`,
              start_time: sql`selected_time at time zone user_timezone`,
              duration: eventType.duration,
              buffer_before: eventType.bufferBefore,
              buffer_after: eventType.bufferAfter,
              public_id: sql`random.uuid()`,
              ...props.insertValues,
            }}
          >
            <div
              sx={{
                display: "flex",
                flexDirection: "column",
                minWidth: "100%",
                gap: 2,
              }}
            >
              {props.form}

              <Form.ErrorAlert className="mt-3" mode="all" />
              <Form.SubmitButton size="lg" className="mt-3">
                Schedule Event
              </Form.SubmitButton>
            </div>
          </Form.Insert>
        </Form>
      </div>
    </Data>
  );
}

interface SuccessMessageProps {
  type: string;
  addToCalendarTitle: Sql;
}

export function SuccessMessage(props: SuccessMessageProps) {
  const schedulingBlock = system.blockNamed<SchedulingBlock>("SchedulingBlock");
  const eventType = schedulingBlock.getDevDefinedEventType(props.type);
  if (!eventType) {
    throw new Error(`DevDefinedEventType ${props.type} not found`);
  }
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "appointment",
          sql`select * from db.${
            sql.ref(eventType.tableName)
          } where id = created_appointment_id`,
        );
        s.defScalar("calendar_title", props.addToCalendarTitle);
      }}
    >
      <div
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          px: 5,
          mt: 4,
          alignItems: "center",
          width: "100%",
          sm: {
            minWidth: "500px",
          },
        }}
      >
        <Typography
          level="h3"
          startDecorator={
            <MaterialIcon icon="CheckCircle" className="text-success-500" />
          }
        >
          Event Scheduled
        </Typography>

        <Typography level="body-md" component="div">
          We've scheduled your appointment with{" "}
          <InlineRecordDisplay
            tableName="sys_users"
            id={sql`appointment.sys_user_id`}
          />
          .<br />
          You've been sent an email with the details.
        </Typography>

        <Divider />
        <Typography level="title-lg">{eventType.displayName}</Typography>
        <Typography startIcon="Event">
          {sql`format.date(appointment.start_time, '%I:%M') || ' - ' || format.date(date.add(minute, ${eventType.duration}, appointment.start_time), '%I:%M, %A, %B %d, %Y')`}
        </Typography>

        <AddToCalendarButton
          sx={{ alignSelf: "flex-end" }}
          size="md"
          variant="soft"
          color="success"
          title={sql`calendar_title`}
          startTime={sql`appointment.start_time`}
          endTime={sql`date.add(minute, ${eventType.duration}, appointment.start_time)`}
        />
      </div>
    </Data>
  );
}
