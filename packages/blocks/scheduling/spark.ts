import type { SparkCapability } from "blocks/spark";
import {
  blockToolset,
  toolId,
  toolInteger,
  toolObject,
  toolPage,
  toolString,
  toolValue,
} from "blocks/spark/tool_contract";
import type { GeneralServerStatements } from "std/statements";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import type { SchedulingBlock } from "./index";

/** Tools for configured developer-defined event types, using existing availability and queues. */
export function schedulingSparkCapability(
  block: SchedulingBlock,
  opts: { permission: string },
): SparkCapability {
  const tools = blockToolset("scheduling", opts.permission);
  const types = block.opts.devDefinedEventTypes ?? [];
  if (!types.length) {
    throw new Error(
      "Scheduling Spark requires a developer-defined event type.",
    );
  }
  const functions = [];
  const actions = [];
  for (const event of types) {
    const table = event.tableName;
    const protectedFields = new Set([
      "sys_user_id",
      "start_time",
      "duration",
      "buffer_before",
      "buffer_after",
      "status",
      "public_id",
      "cancel_reason",
      "cancelled_at",
      "reschedule_reason",
      "reassign_reason",
      "google_conference_link",
      ...block.opts.calendarIntegrations.flatMap(
        (i) => [i.eventIdField, `${i.eventIdField}_creation_id`],
      ),
      ...(block.opts.meetingIntegrations ?? []).flatMap(
        (i) => [i.meetingIdField, `${i.meetingIdField}_join_url`],
      ),
    ]);
    const fields = Object.values(system.db.tables[table].fields).filter((f) =>
      !protectedFields.has(f.name)
    );
    const supported = fields.filter((f) =>
      !["Bytes", "Json", "ForeignKey"].includes(f.type)
    );
    const bookable = fields.every((f) =>
      supported.includes(f) || !f.notNull || f.default !== undefined
    );
    const eligible = (user: import("std/sql_utils").Sql) =>
      sql`exists(select 1 from db.sys_users where id=${user} and not disabled and ${
        event.sysUserFilter?.(sql`sys_users`) ?? sql.true
      })`;
    const timeInput = (s: GeneralServerStatements) => {
      toolString(s, "date", 10, true);
      toolString(s, "timezone", 100, true);
      s.defScalar("slot_date", sql`try_cast(${toolValue("date")} as date)`);
      s.defScalar(
        "slot_timezone",
        sql`try_cast(${toolValue("timezone")} as enums.sys_timezone)`,
      );
      s.throwErrorIf(
        sql`slot_date is null or slot_timezone is null`,
        sql.lit`Supply a valid date and timezone.`,
      );
    };
    functions.push(
      tools.read(
        `slots_${table}`,
        `Find bookable slots for ${event.displayName} on one day.`,
        "{date:string;timezone:string;user_id?:number;offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["date", "timezone", "user_id", "offset", "limit"]);
          timeInput(s);
          toolInteger(s, "user_id");
          toolPage(s);
          block.getAvailableSlotsForDay(s, {
            date: sql`slot_date`,
            slotsTable: "slots",
            userTimezone: sql`slot_timezone`,
            filterUserId: (user) =>
              sql`${eligible(user)} and (${
                toolId("user_id")
              } is null or ${user}=${toolId("user_id")})`,
            duration: event.duration,
            bufferBefore: event.bufferBefore,
            bufferAfter: event.bufferAfter,
            minNotice: event.minNotice,
            maxNotice: event.maxNotice,
            timeSlotsInterval: event.timeSlotsInterval,
          });
          s.setScalar(
            "tool_output",
            sql`json_build_object('slots',coalesce((select json_agg(json_build_object('user_id',sys_user_id,'date',date,'time',start_time,'timezone',slot_timezone)) from (select * from slots order by start_time,sys_user_id limit tool_limit offset tool_offset)),'[]'::json))`,
          );
        },
      ),
    );
    functions.push(
      tools.read(
        `appointments_${table}`,
        `List ${event.displayName} appointments without public access tokens or provider credentials.`,
        "{offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["offset", "limit"]);
          toolPage(s);
          s.setScalar(
            "tool_output",
            sql`json_build_object('items',coalesce((select json_agg(json_build_object('id',id,'user_id',sys_user_id,'start_time',start_time,'status',status)) from (select id,sys_user_id,start_time,status from db.${
              sql.ref(table)
            } order by id limit tool_limit offset tool_offset)),'[]'::json))`,
          );
        },
      ),
    );
    if (bookable) {
      actions.push(
        tools.action(
          `book_${table}`,
          `Approve booking ${event.displayName}. Configured calendar, meeting and email effects will run.`,
          `{user_id:number;date:string;time:string;timezone:string;details:{${
            supported.map((f) =>
              `${f.name}${
                f.notNull && f.default === undefined ? "" : "?"
              }:string${f.notNull ? "" : "|null"}`
            ).join(";")
          }}}`,
          (s) => {
            toolObject(s, ["user_id", "date", "time", "timezone", "details"]);
            toolInteger(s, "user_id", true);
            timeInput(s);
            toolString(s, "time", 30, true);
            s.throwErrorIf(
              sql`not ${eligible(toolId("user_id"))}`,
              sql.lit`Host is not eligible for this event type.`,
            );
            s.throwErrorIf(
              sql`json_typeof(p_input->'details') is distinct from 'object'`,
              sql.lit`Supply booking details.`,
            );
            s.throwErrorIf(
              sql`exists(select 1 from json.object_each(p_input->'details') f where ${
                supported.length
                  ? sql`f.key not in (${supported.map((f) => sql.lit(f.name))})`
                  : sql.true
              })`,
              sql.lit`Unsupported booking detail.`,
            );
            for (const f of supported) {
              const value = sql`p_input->'details'->>${sql.lit(f.name)}`;
              s.throwErrorIf(
                sql`(${
                  f.notNull && f.default === undefined
                } and ${value} is null) or (${value} is not null and (json_typeof(p_input->'details'->${
                  sql.lit(f.name)
                }) <> 'string' or ${f.tryCastToType(value)} is null))`,
                sql.lit(`Invalid ${f.name}.`),
              );
              if (f.type === "String") {
                s.throwErrorIf(
                  sql`length(${value})>${f.maxLength}`,
                  sql.lit(`${f.name} is too long.`),
                );
              }
            }
            block.getAvailableSlotsForDay(s, {
              date: sql`slot_date`,
              slotsTable: "slots",
              userTimezone: sql`slot_timezone`,
              filterUserId: (user) =>
                sql`${user}=${toolId("user_id")} and ${eligible(user)}`,
              duration: event.duration,
              bufferBefore: event.bufferBefore,
              bufferAfter: event.bufferAfter,
              minNotice: event.minNotice,
              maxNotice: event.maxNotice,
              timeSlotsInterval: event.timeSlotsInterval,
            });
            s.defScalar(
              "selected_time",
              sql`try_cast(${toolValue("time")} as timestamp)`,
            );
            s.throwErrorIf(
              sql`selected_time is null or not exists(select 1 from slots where start_time=selected_time and date=slot_date)`,
              sql
                .lit`The selected slot is no longer available. Use a time returned by slots.`,
            );
            const bookingValues = block.devDefinedBookingValues(
              event,
              toolId("user_id"),
              sql`selected_time at time zone slot_timezone`,
            );
            s.defScalar("saved_id", { type: "BigInt" });
            s.modify(
              sql`insert into db.${sql.ref(table)}(${
                Object.keys(bookingValues).map((name) => sql.ref(name))
              }${
                supported.length
                  ? sql`,${supported.map((f) => sql.ref(f.name))}`
                  : sql``
              }) values(${Object.values(bookingValues)}${
                supported.length
                  ? sql`,${
                    supported.map((f) =>
                      sql`case when p_input->'details' ? ${
                        sql.lit(f.name)
                      } then ${
                        f.tryCastToType(
                          sql`p_input->'details'->>${sql.lit(f.name)}`,
                        )
                      } else ${f.default ?? sql.null} end`
                    )
                  }`
                  : sql``
              }) returning id into saved_id`,
            );
            block.enqueueDevDefinedAppointmentTasks(s, {
              eventType: event,
              appointmentId: sql`saved_id`,
              change: "booked",
              insideTransaction: true,
            });
            s.setScalar(
              "tool_output",
              sql`json_build_object('id',saved_id,'start_time',selected_time at time zone slot_timezone)`,
            );
          },
          true,
        ),
      );
    }
    actions.push(
      tools.action(
        `reschedule_${table}`,
        `Approve moving ${event.displayName} to another available time with the same host.`,
        "{id:number;date:string;time:string;timezone:string;reason:string}",
        (s) => {
          toolObject(s, ["id", "date", "time", "timezone", "reason"]);
          toolInteger(s, "id", true);
          timeInput(s);
          toolString(s, "time", 30, true);
          toolString(s, "reason", 500, true);
          s.defRecord(
            "appointment",
            sql`select * from db.${sql.ref(table)} where id=${
              toolId("id")
            } and status='scheduled' and start_time>now()`,
          );
          s.throwErrorIf(
            sql`appointment.id is null or not ${
              eligible(sql`appointment.sys_user_id`)
            }`,
            sql.lit`Appointment or host is no longer available.`,
          );
          s.defScalar(
            "selected_time",
            sql`try_cast(${toolValue("time")} as timestamp)`,
          );
          block.assertDevDefinedUserAvailable(s, {
            appointmentTable: table,
            appointmentId: toolId("id"),
            userId: sql`appointment.sys_user_id`,
            selectedTime: sql`selected_time`,
            selectedDate: sql`slot_date`,
            userTimezone: sql`slot_timezone`,
          });
          s.modify(
            sql`update db.${
              sql.ref(table)
            } set start_time=selected_time at time zone slot_timezone,public_id=random.uuid(),reschedule_reason=${
              toolValue("reason")
            } where id=appointment.id`,
          );
          block.enqueueDevDefinedAppointmentTasks(s, {
            eventType: event,
            appointmentId: sql`appointment.id`,
            change: "rescheduled",
            insideTransaction: true,
          });
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',appointment.id,'start_time',selected_time at time zone slot_timezone)`,
          );
        },
        true,
      ),
    );
    actions.push(
      tools.action(
        `cancel_${table}`,
        `Approve cancellation of ${event.displayName}, including configured notifications and provider cleanup.`,
        "{id:number;reason:string}",
        (s) => {
          toolObject(s, ["id", "reason"]);
          toolInteger(s, "id", true);
          toolString(s, "reason", 500, true);
          s.defRecord(
            "appointment",
            sql`select id from db.${sql.ref(table)} where id=${
              toolId("id")
            } and status='scheduled' and start_time>now()`,
          );
          s.throwErrorIf(
            sql`appointment.id is null`,
            sql.lit`Appointment can no longer be cancelled.`,
          );
          s.modify(
            sql`update db.${
              sql.ref(table)
            } set status='cancelled_by_admin',cancelled_at=now(),cancel_reason=${
              toolValue("reason")
            },public_id=random.uuid() where id=appointment.id`,
          );
          block.retirePendingAppointmentMutationTasks(s, {
            appointmentTable: table,
            appointmentId: sql`appointment.id`,
          });
          block.enqueueDevDefinedAppointmentTasks(s, {
            eventType: event,
            appointmentId: sql`appointment.id`,
            change: "cancelled",
            insideTransaction: true,
          });
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',appointment.id,'status','cancelled_by_admin')`,
          );
        },
        true,
      ),
    );
  }
  return {
    name: "scheduling",
    label: "Scheduling",
    permission: opts.permission,
    description: "Find slots and manage developer-defined appointments.",
    functions,
    actions,
    doc:
      "Requires organization-wide calendar administration. Use the exact local timestamp and timezone returned by slots. Approval rechecks availability; a preview never reserves a slot. Book/reschedule/cancel may send notifications and update external calendars and meetings. Custom booking details are strings converted to the configured field types; provider IDs, status and access tokens are not editable. Runtime-defined event types and page-specific form hooks are not part of this capability.",
  };
}
