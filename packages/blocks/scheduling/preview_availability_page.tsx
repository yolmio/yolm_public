import { DurationInput } from "components/duration_input";
import { FormLabel } from "components/form_label";
import { DefaultNotFoundPage } from "pages/default404";
import { type Sql, sql } from "../../std/sql_utils";
import type { DomStatements } from "std/statements";
import { system, useBlockNamed } from "std/system";
import { Route, Show } from "std/ui";
import { Data } from "std/data";
import type { SchedulingBlock } from "./index";
import { Scheduling } from "./scheduling";

export function PreviewAvailabilityPage() {
  const block = useBlockNamed<SchedulingBlock>("SchedulingBlock");
  return (
    <Route path="/availability-preview/{sys_user_id:id}">
      <Data
        local
        procedure={(s) => {
          s.defScalar("current_month", sql`date.trunc(month, current_date())`);
          s.defScalar("user_timezone", sql`date.part(timezone, now())`);
          s.defScalar("duration", {
            type: "Int",
            expr: sql`30`,
          });
          s.defScalar("display_duration", sql.lit`0:30`);
          s.defScalar("buffer_before", {
            type: "Int",
            expr: sql`0`,
          });
          s.defScalar("display_buffer_before", sql.lit`0:00`);
          s.defScalar("buffer_after", {
            type: "Int",
            expr: sql`15`,
          });
          s.defScalar("display_buffer_after", sql.lit`0:15`);
          s.defScalar("min_notice", {
            type: "Int",
            expr: sql`60 `,
          });
          s.defScalar("display_min_notice", sql.lit`1:00`);
          s.defScalar("max_notice", {
            type: "Int",
            expr: sql`60 * 960`,
          });
          s.defScalar("display_max_notice", sql.lit`960:00`);
          s.defScalar("time_slots_interval", {
            type: "Int",
            expr: sql`30`,
          });
          s.defScalar("display_time_slots_interval", sql.lit`0:30`);
          s.defScalar("selected_date", {
            type: "Date",
          });
        }}
      >
        <Data
          watch={[
            sql`current_month`,
            sql`user_timezone`,
            sql`duration`,
            sql`buffer_before`,
            sql`buffer_after`,
            sql`min_notice`,
            sql`max_notice`,
            sql`time_slots_interval`,
            sql`selected_date`,
          ]}
          procedure={(s) => {
            const userTable = system.db.tables.sys_users;
            s.defRecord(
              "user_record",
              sql`select id, ${userTable.getRecordDisplayNameExpr()} as name from sys_users where id = ui.sys_user_id`,
            );

            block.getFullMonthCalendar(s, {
              month: sql`current_month`,
              calendarDaysTable: "calendar_days",
              slotsTable: "all_slots",
              filterUserId: (userId) => sql`${userId} = user_record.id`,
              userTimezone: sql`user_timezone`,
              minNotice: sql`min_notice`,
              maxNotice: sql`max_notice`,
              bufferBefore: sql`buffer_before`,
              bufferAfter: sql`buffer_after`,
              duration: sql`duration`,
              timeSlotsInterval: sql`time_slots_interval`,
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
          <Show
            when={sql`user_record.id is not null`}
            fallback={<DefaultNotFoundPage />}
          >
            <Scheduling
              name={sql`'Previewing' || ' ' || user_record.name`}
              appointmentsTable="scheduling_appointments"
              duration={sql`duration`}
              description={
                <div className="flex flex-col gap-2">
                  <SchedulingDurationInput
                    label="Duration"
                    id="duration"
                    value={sql`display_duration`}
                    onChange={(s, v) => {
                      s.setScalar("display_duration", v);
                      s.setScalar(
                        "duration",
                        sql`fn.parse_minutes_duration(${v})`,
                      );
                    }}
                  />
                  <SchedulingDurationInput
                    label="Buffer Before"
                    id="buffer_before"
                    value={sql`display_buffer_before`}
                    onChange={(s, v) => {
                      s.setScalar("display_buffer_before", v);
                      s.setScalar(
                        "buffer_before",
                        sql`fn.parse_minutes_duration(${v})`,
                      );
                    }}
                  />
                  <SchedulingDurationInput
                    label="Buffer After"
                    id="buffer_after"
                    value={sql`display_buffer_after`}
                    onChange={(s, v) => {
                      s.setScalar("display_buffer_after", v);
                      s.setScalar(
                        "buffer_after",
                        sql`fn.parse_minutes_duration(${v})`,
                      );
                    }}
                  />
                  <SchedulingDurationInput
                    label="Min Notice"
                    id="min_notice"
                    value={sql`display_min_notice`}
                    onChange={(s, v) => {
                      s.setScalar("display_min_notice", v);
                      s.setScalar(
                        "min_notice",
                        sql`fn.parse_minutes_duration(${v})`,
                      );
                    }}
                  />
                  <SchedulingDurationInput
                    label="Max Notice"
                    id="max_notice"
                    value={sql`display_max_notice`}
                    onChange={(s, v) => {
                      s.setScalar("display_max_notice", v);
                      s.setScalar(
                        "max_notice",
                        sql`fn.parse_minutes_duration(${v})`,
                      );
                    }}
                  />
                  <SchedulingDurationInput
                    label="Time Slots Interval"
                    id="time_slots_interval"
                    value={sql`display_time_slots_interval`}
                    onChange={(s, v) => {
                      s.setScalar("display_time_slots_interval", v);
                      s.setScalar(
                        "time_slots_interval",
                        sql`fn.parse_minutes_duration(${v})`,
                      );
                    }}
                  />
                </div>
              }
              selectedDateScalar="selected_date"
              timeSlotsTable="time_slots"
              calendarTable="calendar_days"
              preview
              scheduleInterface={<span>Preview</span>}
              successMessage={<span>Preview complete</span>}
            />
          </Show>
        </Data>
      </Data>
    </Route>
  );
}

function SchedulingDurationInput({
  label,
  id,
  value,
  onChange,
}: {
  label: string;
  id: string;
  value: Sql;
  onChange: (s: DomStatements, value: Sql) => void;
}) {
  return (
    <>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <DurationInput
        size="sm"
        id={sql.lit`${id}`}
        value={value}
        onChange={onChange}
      />
    </>
  );
}
