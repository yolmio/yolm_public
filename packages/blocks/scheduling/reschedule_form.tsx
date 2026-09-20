import type { SchedulingBlock } from "blocks/scheduling";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr, NumericExpr } from "../../std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { Form } from "std/form";
import { LabelOnTopFormField } from "../../components/label_on_top_form_field";

interface ScheduleInterfaceProps {
  appointmentId: NumericExpr;
  assigningNewUser: BooleanExpr;
  afterTransactionCommit?: (s: UiServerStatements) => void;
  beforeTransactionCommit?: (s: UiServerStatements) => void;
  form: Node;
  appointmentsTable: string;
  type: "dev" | "custom";
  afterTransactionStart?: (s: UiServerStatements) => void;
}

export function RescheduleForm(props: ScheduleInterfaceProps) {
  const {
    afterTransactionCommit,
    appointmentsTable,
    type,
    beforeTransactionCommit,
  } = props;
  const schedulingBlock = system.blockNamed<SchedulingBlock>("SchedulingBlock");
  const unavailableMessage = sql
    .lit`This appointment can no longer be rescheduled.`;
  const unavailableFormMessage = sql
    .lit`Rescheduling is unavailable because this appointment changed. Refresh the page to see its current status.`;

  return (
    <Data
      noRefetch
      pendingFallback={null}
      errorFallback={null}
      procedure={(s) => {
        s.defScalar(
          "old_user_id",
          sql`(select sys_user_id from ${
            sql.ref(appointmentsTable)
          } where id = ${props.appointmentId})`,
        );
      }}
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
          onSubmitServerError={(s, ctx, err) => {
            s.if(
              sql`${err.message} = ${unavailableMessage}`,
              (s) => ctx.setWriteError(s, unavailableFormMessage),
            );
          }}
          beforeTransactionCommit={(s) => {
            s.if(
              sql`not exists(
                select 1
                from db.${sql.ref(appointmentsTable)}
                where id = ${props.appointmentId}
                  and status = 'scheduled'
              )`,
              (s) => {
                s.throwError(unavailableMessage);
              },
            );
            beforeTransactionCommit?.(s);
          }}
          afterTransactionStart={(s) => {
            s.defScalar(
              "new_user_id",
              sql`(select sys_user_id from ${
                sql.ref(appointmentsTable)
              } where id = ${props.appointmentId})`,
            );
            if (type === "dev") {
              schedulingBlock.assertDevDefinedUserAvailable(s, {
                appointmentTable: appointmentsTable,
                appointmentId: props.appointmentId,
                userId: sql`new_user_id`,
                selectedTime: sql`selected_time`,
                selectedDate: sql`selected_date`,
                userTimezone: sql`user_timezone`,
              });
            }
            props.afterTransactionStart?.(s);
          }}
          afterTransactionCommit={(s) => {
            // this is in scheduling.tsx, and we use it to show the success message
            s.setScalar("show_success_message", true);
            s.setScalar("created_appointment_id", sql`appointment_record.id`);
            s.defRecord("appointment_record", {
              query: sql`select * from ${
                sql.ref(appointmentsTable)
              } where id = ${props.appointmentId}`,
              allowNoRead: true,
            });
            //For dev defined event types we update the calendar and meeting integrations on the "afterTransactionCommit" property

            afterTransactionCommit?.(s);
          }}
        >
          <Form.Update
            table={appointmentsTable}
            where={sql`id = appointment_record.id and status = 'scheduled'`}
            setFields={{
              start_time: sql`selected_time at time zone user_timezone`,
              sys_user_id: sql`new_user_id`,
              // generate a new public_id for the appointment each time it is rescheduled to prevent security issues
              public_id: sql`random.uuid()`,
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
              <Form.SubmitButton size="lg" className="mt-3">
                Reschedule Event
              </Form.SubmitButton>
              <Form.ErrorAlert mode="all" size="lg" />
            </div>
          </Form.Update>
        </Form>
      </div>
    </Data>
  );
}
