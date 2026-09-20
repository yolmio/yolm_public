import { IconButton } from "components/icon_button";
import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { Style } from "std/style_types";
import { createStyles, getVariantStyle } from "std/style_utils";
import { Each, useUniqueId } from "std/ui";
import { Data } from "std/data";
import { FormControl } from "./form_control";
import { FormLabel } from "./form_label";
import { Input } from "./input";
import { Sheet } from "./sheet";
import type { Size } from "./types";
import { Typography } from "./typography";

const styles = createStyles({
  inputsContainer: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  container: {
    display: "flex",
    alignItems: "flex-start",
    gap: 3,
  },
  calendar: {
    p: 2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    borderRadius: "md",
  },
  calendarHeader: {
    display: "flex",
    alignItems: "center",
    mb: 2,
    position: "relative",
    width: "100%",
    justifyContent: "center",
  },
  calendarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: "1px",
    width: "240px",
  },
  dayCell: {
    aspectRatio: "1",
    display: "flex",
    height: "32px",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    borderRadius: "sm",
    fontSize: "sm",
    "&.selected": getVariantStyle("solid", "primary"),
    "&.in-range": getVariantStyle("soft", "primary"),
    "&.hover-range": getVariantStyle("soft", "primary"),
    "&:hover:not(.selected):not(.in-range):not(.hover-range)": getVariantStyle(
      "soft",
      "primary",
      "hover",
    ),
  },
});

interface DateRangeFilterProps {
  size?: Size;
  startDate: Sql;
  endDate: Sql;
  onStartDateChange: (s: DomStatements, newStartDate: Sql) => void;
  onEndDateChange: (s: DomStatements, newEndDate: Sql) => void;
}

/**
A component that renders a date range filter with start and end date inputs.

@category UI Component
@examples
[Example](../blocks/daily_log/index.tsx)
 */
export function DateRangeFilter(props: DateRangeFilterProps) {
  const startId = useUniqueId();
  const endId = useUniqueId();
  return (
    <div sx={styles.inputsContainer}>
      <FormControl>
        <FormLabel htmlFor={startId}>Start Date</FormLabel>
        <Input
          id={startId}
          size={props.size}
          type="date"
          value={props.startDate}
          onInput={(s, newValue) =>
            props.onStartDateChange(s, sql`try_cast(${newValue} as date)`)}
        />
      </FormControl>
      <FormControl>
        <FormLabel htmlFor={endId}>End Date</FormLabel>
        <Input
          id={endId}
          size={props.size}
          type="date"
          value={props.endDate}
          onInput={(s, newValue) =>
            props.onEndDateChange(s, sql`try_cast(${newValue} as date)`)}
        />
      </FormControl>
    </div>
  );
}

interface DateRangeCalendarsProps {
  sx?: Style;
  className?: string;
  startDate: Sql;
  endDate: Sql;
  onStartDateChange: (s: DomStatements, newStartDate: Sql) => void;
  onEndDateChange: (s: DomStatements, newEndDate: Sql) => void;
}

interface CalendarProps {
  currentDate: Sql;
  selectedDate: Sql;
  onDateSelect: (s: DomStatements, date: Sql) => void;
  onMonthChange: (s: DomStatements, newMonth: Sql) => void;
  startDate: Sql;
  endDate: Sql;
  hoverDate: Sql;
  isLeftCalendar: boolean;
}

function Calendar({
  currentDate,
  selectedDate,
  onDateSelect,
  onMonthChange,
  startDate,
  endDate,
  hoverDate,
  isLeftCalendar,
}: CalendarProps) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("hover_end_date", {
          type: "Date",
          expr: sql.null,
          allowNoRead: true,
        });
      }}
    >
      <Data
        local
        watch={[currentDate]}
        procedure={(s) => {
          s.defScalar(
            "first_day_of_month",
            sql`date.start_of_month(${currentDate})`,
          );
          s.defScalar(
            "last_day_of_month",
            sql`date.end_of_month(${currentDate})`,
          );
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
          //   s.defTable(
          //     "calendar_days",
          //     sql`select value as date
          // from series.daily(start_of_calendar, date.diff(day, start_of_calendar, end_of_calendar) + 1)`,
          //   );
          s.defTable(
            "calendar_days",
            sql`select date.add(day, n.value, start_of_calendar) as date
          from (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19),(20),(21),(22),(23),(24),(25),(26),(27),(28),(29),(30),(31),(32),(33),(34),(35),(36),(37),(38),(39),(40),(41)) as n(value)
          where date.add(day, n.value, start_of_calendar) <= end_of_calendar`,
          );
        }}
      >
        {/*Example_Sheet_Start*/}
        <Sheet variant="outlined" sx={styles.calendar}>
          <div sx={styles.calendarHeader}>
            {isLeftCalendar && (
              <IconButton
                variant="plain"
                color="primary"
                aria-label="Previous Month"
                onClick={(s) =>
                  onMonthChange(s, sql`date.add(month, -1, ${currentDate})`)}
                icon="ChevronLeft"
                className="absolute left-0"
              />
            )}
            <Typography level="title-md">
              {sql`format.date(${currentDate}, '%b %Y')`}
            </Typography>
            {!isLeftCalendar && (
              <IconButton
                variant="plain"
                color="primary"
                aria-label="Next Month"
                onClick={(s) =>
                  onMonthChange(s, sql`date.add(month, 1, ${currentDate})`)}
                icon="ChevronRight"
                className="absolute right-0"
              />
            )}
          </div>
          <div sx={styles.calendarGrid}>
            {["S", "M", "T", "W", "T", "F", "S"].map((day) => (
              <div className="text-center py-1 text-xs font-medium text-tertiary">
                {day}
              </div>
            ))}
            <Each table="calendar_days" recordName="day">
              <div
                sx={styles.dayCell}
                dynamicClasses={[
                  {
                    classes: "current-month",
                    condition:
                      sql`date.part(month, day.date) = date.part(month, ${currentDate})`,
                  },
                  {
                    classes: "other-month",
                    condition:
                      sql`date.part(month, day.date) != date.part(month, ${currentDate})`,
                  },
                  {
                    classes: "selected",
                    condition:
                      sql`day.date = ${selectedDate} or day.date = ${startDate} or day.date = ${endDate}`,
                  },
                  {
                    classes: "in-range",
                    condition:
                      sql`day.date > ${startDate} and day.date < ${endDate}`,
                  },
                  {
                    classes: "hover-range",
                    condition:
                      sql`${startDate} is not null and ${endDate} is null and ${hoverDate} is not null and
                  day.date > ${startDate} and day.date < ${hoverDate}`,
                  },
                ]}
                onClick={(s) => onDateSelect(s, sql`day.date`)}
                onMouseEnter={(s) => s.setScalar("hover_date", sql`day.date`)}
                onMouseLeave={(s) => s.setScalar("hover_date", sql`null`)}
              >
                {sql`date.part(day, day.date)`}
              </div>
            </Each>
          </div>
        </Sheet>
        {/*Example_Sheet_End*/}
      </Data>
    </Data>
  );
}

/**
A component that renders a date range filter with side-by-side calendars.

@category UI Component
@examples
[Example](../blocks/scheduling/appointments_page.tsx)
 */
export function DateRangeCalendars(props: DateRangeCalendarsProps) {
  return (
    <Data
      local
      procedure={(s) => {
        // Single base month instead of two separate months
        s.defScalar(
          "base_month",
          sql`coalesce(${props.startDate}, current_date())`,
        );
        s.defScalar("hover_date", {
          type: "Date",
        });
      }}
    >
      <div sx={[styles.container, props.sx]} className={props.className}>
        <Calendar
          currentDate={sql`base_month`}
          selectedDate={props.startDate}
          startDate={props.startDate}
          endDate={props.endDate}
          hoverDate={sql`hover_date`}
          isLeftCalendar
          onDateSelect={(s, date) => {
            s.conditional({
              condition:
                sql`${props.startDate} is not null and ${props.endDate} is not null`,
              then: (s) => {
                props.onEndDateChange(s, sql`null`);
                props.onStartDateChange(s, date);
              },
              else: (s) => {
                s.conditional({
                  condition: sql`${props.startDate} is null`,
                  then: (s) => {
                    props.onStartDateChange(s, date);
                  },
                  else: (s) => {
                    s.conditional({
                      condition: sql`${date} <= ${props.startDate}`,
                      then: (s) => {
                        props.onStartDateChange(s, date);
                      },
                      else: (s) => {
                        props.onEndDateChange(s, date);
                      },
                    });
                  },
                });
              },
            });
          }}
          onMonthChange={(s, newMonth) => s.setScalar("base_month", newMonth)} // Updates base month
        />
        <Calendar
          currentDate={sql`date.add(month, 1, base_month)`}
          selectedDate={props.endDate}
          startDate={props.startDate}
          endDate={props.endDate}
          hoverDate={sql`hover_date`}
          isLeftCalendar={false}
          onDateSelect={(s, date) => {
            s.conditional({
              condition:
                sql`${props.startDate} is not null and ${props.endDate} is not null`,
              then: (s) => {
                props.onEndDateChange(s, sql`null`);
                props.onStartDateChange(s, date);
              },
              else: (s) => {
                s.conditional({
                  condition: sql`${props.startDate} is null`,
                  then: (s) => {
                    props.onStartDateChange(s, date);
                  },
                  else: (s) => {
                    s.conditional({
                      condition: sql`${date} <= ${props.startDate}`,
                      then: (s) => {
                        props.onStartDateChange(s, date);
                      },
                      else: (s) => {
                        props.onEndDateChange(s, date);
                      },
                    });
                  },
                });
              },
            });
          }}
          onMonthChange={(s, newMonth) =>
            s.setScalar("base_month", sql`date.add(month, -1, ${newMonth})`)}
        />
      </div>
    </Data>
  );
}
