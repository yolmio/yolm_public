import type { SchedulingBlock } from "blocks/scheduling";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { CircularProgress } from "components/circular_progress";
import { ConfirmDangerDialog } from "components/confirm_danger_dialog";
import { Divider } from "components/divider";
import { Typography } from "components/typography";
import { InlineRecordDisplay } from "components/inline_record_display";
import { type AnyExpr, sql } from "../../std/sql_utils";
import { system } from "std/system";
import { Data } from "std/data";
import { Match, Route, Show, Switch } from "std/ui";

interface DevCancelPageProps {
  devDefinedEventType: string;
  path: string;
  appointmentPublicId?: AnyExpr;
}

export function DevCancelPage(props: DevCancelPageProps) {
  const schedulingBlock = system.blockNamed<SchedulingBlock>("SchedulingBlock");
  const devDefinedEventType = schedulingBlock.getDevDefinedEventType(
    props.devDefinedEventType,
  );
  if (!devDefinedEventType) {
    throw new Error(
      `DevDefinedEventType ${props.devDefinedEventType} not found`,
    );
  }
  const appointmentPublicId = props.appointmentPublicId ??
    sql`ui.appointment_public_id`;

  return (
    <Route path={props.path}>
      <Data
        local
        procedure={(s) => {
          s.defScalar("refetch_key", 0);
          s.defScalar("changing_status", false);
          s.defScalar("cancellation_succeeded", false);
          s.defScalar("cancellation_error", {
            type: { type: "String", maxLength: 1_000 },
          });
        }}
      >
        <div
          sx={{
            display: "flex",
            width: "50%",
            mx: "auto",
            flexDirection: "column",
            gap: 2,
            px: 5,
            mt: 20,
            sm: {
              minWidth: "500px",
            },
          }}
        >
          <Data
            statusScalar="status"
            watch={[sql`refetch_key`]}
            procedure={(s) => {
              s.defRecord("appointment", {
                query: sql`select * from db.${
                  sql.ref(devDefinedEventType.tableName)
                } where public_id = ${appointmentPublicId}`,
                allowNoRead: true,
              });
            }}
          >
            <Switch>
              <Match when={sql`status = 'fallback_triggered'`}>
                <CircularProgress size="sm" />
              </Match>
              <Match when={sql`status = 'failed'`}>
                <Alert color="danger" startIcon="Report">
                  Unable to get the selected appointment
                </Alert>
              </Match>
              <Match when={sql`status = 'received'`}>
                <Show
                  when={sql`not cancellation_succeeded
                    and appointment.status = 'scheduled'
                    and appointment.start_time > now()`}
                  fallback={
                    <Switch>
                      <Match when={sql`cancellation_succeeded`}>
                        <Typography level="h3" startIcon="Cancel">
                          Appointment Cancelled
                        </Typography>
                        <Typography level="body-md">
                          Your appointment has been cancelled.
                        </Typography>
                        <Typography level="body-sm">
                          You can close this page now.
                        </Typography>
                      </Match>
                      <Match
                        when={sql`appointment.status in ('cancelled_by_invitee', 'cancelled_by_host', 'cancelled_by_admin')`}
                      >
                        <Typography level="h3" startIcon="Cancel">
                          Appointment Already Cancelled
                        </Typography>
                        <Typography level="body-md">
                          This appointment was already cancelled.
                        </Typography>
                      </Match>
                      <Match
                        when={sql`appointment.status = 'scheduled'
                          and appointment.start_time <= now()`}
                      >
                        <Typography level="h3">
                          Appointment Has Passed
                        </Typography>
                        <Typography level="body-md">
                          This appointment can no longer be cancelled.
                        </Typography>
                      </Match>
                      <Match
                        when={sql`appointment.status in ('no_show', 'no_show_early', 'completed')`}
                      >
                        <Typography level="h3">
                          Cancellation Unavailable
                        </Typography>
                        <Typography level="body-md">
                          This appointment can no longer be cancelled.
                        </Typography>
                      </Match>
                      <Match when={sql`appointment.status = 'creating'`}>
                        <Typography level="h3">
                          Appointment Not Ready
                        </Typography>
                        <Typography level="body-md">
                          This appointment is still being created. Please try
                          again shortly.
                        </Typography>
                      </Match>
                      <Match when={sql`true`}>
                        <Typography level="h3">
                          Appointment Not Found
                        </Typography>
                        <Typography level="body-md">
                          We could not find this appointment.
                        </Typography>
                      </Match>
                    </Switch>
                  }
                >
                  <Show when={sql`cancellation_error is not null`}>
                    <Alert variant="soft" color="danger" startIcon="Report">
                      {sql`cancellation_error`}
                    </Alert>
                  </Show>
                  <Typography level="h3" startIcon="Cancel">
                    Cancel Appointment
                  </Typography>

                  <div>
                    Are you sure you want to cancel your appointment with{" "}
                    <InlineRecordDisplay
                      tableName="sys_users"
                      id={sql`appointment.sys_user_id`}
                    />?
                  </div>
                  <Divider />
                  <Typography startIcon="Event">
                    {sql`format.date(appointment.start_time, '%I:%M - ') ||
                      format.date(date.add(minute, appointment.duration, appointment.start_time), '%I:%M, %A, %B %d, %Y')`}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="danger"
                    sx={{ md: { width: "40%", alignSelf: "flex-end" } }}
                    onClick={(s) => {
                      s.setScalar("changing_status", true);
                    }}
                  >
                    Cancel Appointment
                  </Button>
                  <ConfirmDangerDialog
                    bindScalar="changing_status"
                    description={
                      <span>
                        Are you sure you want to cancel this appointment? This
                        action cannot be undone.
                      </span>
                    }
                    onConfirm={(s) => {
                      s.setScalar("cancellation_error", sql`null`);
                      s.tryServer({
                        body: (s) => {
                          s.startTransaction();
                          s.defRecord("appointment_record", {
                            query: sql`select * from db.${
                              sql.ref(devDefinedEventType.tableName)
                            } where public_id = ${appointmentPublicId}
                                and status = 'scheduled'
                                and start_time > now()`,
                            allowNoRead: true,
                          });
                          s.if(sql`appointment_record.id is null`, (s) => {
                            s.throwError(
                              sql
                                .lit`This appointment can no longer be cancelled.`,
                            );
                          });
                          s.modify(
                            sql`update db.${
                              sql.ref(devDefinedEventType.tableName)
                            }
                  set status = 'cancelled_by_invitee',
                      cancelled_at = now(),
                      public_id = random.uuid()
                  where id = appointment_record.id
                    and status = 'scheduled'
                    and start_time > now()`,
                          );
                          schedulingBlock
                            .retirePendingAppointmentMutationTasks(s, {
                              appointmentTable: devDefinedEventType.tableName,
                              appointmentId: sql`appointment_record.id`,
                            });
                          schedulingBlock.enqueueDevDefinedAppointmentTasks(s, {
                            eventType: devDefinedEventType,
                            appointmentId: sql`appointment_record.id`,
                            change: "cancelled",
                            insideTransaction: true,
                          });
                          s.commitTransaction();
                          s.setScalar("cancellation_succeeded", true);
                          s.setScalar("changing_status", false);
                          s.increment("refetch_key");
                        },
                        errorName: "change_status_error",
                        catch: (s) => {
                          s.setScalar(
                            "cancellation_error",
                            sql`coalesce(change_status_error.message, 'Unable to cancel this appointment.')`,
                          );
                          s.setScalar("changing_status", false);
                        },
                      });
                    }}
                  />
                </Show>
              </Match>
            </Switch>
          </Data>
        </div>
      </Data>
    </Route>
  );
}
