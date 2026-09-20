import { Button } from "components/button";
import { IconButton } from "components/icon_button";
import { YolmIcon } from "components/icons/yolm";
import { MaterialIcon } from "components/material_icon";
import { SelectTimeZone } from "components/select_timezone";
import type { TimezoneRegion } from "components/select_timezone";
import { Typography } from "components/typography";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type { DomStatements } from "std/statements";
import { createStyles, flexGrowStyles, getVariantStyle } from "std/style_utils";
import type { Node } from "std/ui";
import { Conditional, Each, Match, Show, Switch } from "std/ui";
import { Data } from "std/data";
import { formatSchedulingDuration } from "./duration";

export const styles = createStyles({
  root: (app) => ({
    maxWidth: app.theme.tokens.breakpoints.xl,
    minHeight: "fit-content",
    height: "auto",
    position: "relative",
    ...getVariantStyle("outlined", "neutral"),
    display: "flex",
    flexDirection: "column",
    mx: 0,
    mt: "var(--page-header-height, 0px)",
    borderRadius: "xl",
    boxShadow: "lg",
    borderBottom: "none",
    sm: {
      minHeight: "450px",
      borderBottom: "1px solid",
      borderColor: "divider",
      mt: 0,
      mx: "auto",
      minWidth: "0px",
    },
    // hardcoded breakpoint for now
    "@media (min-width: 950px)": {
      minHeight: "600px",
      mt: `calc(var(--page-header-height, 0px) + ${16}px)`,
      flexDirection: "row",
      mx: "auto",
      mb: 8,
    },
  }),
  infoSection: {
    width: "100%",
    borderBottom: "1px solid",
    borderColor: "divider",
    display: "flex",
    flexDirection: "column",
    flexGrow: 0,
    flexShrink: 0,
    p: 4,
    backgroundColor: "background-surface",
    sm: {
      p: 3,
    },
    "@media (min-width: 950px)": {
      borderRight: "1px solid",
      borderColor: "divider",
      borderBottom: "none",
      width: "280px",
      p: 4,
    },
  },
  calendarGrid: () => ({
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    width: `calc(100vw - ${8}px)`,
    maxWidth: "300px",
    gap: 2.5,
    sm: {
      width: "350px",
      maxWidth: "350px",
      gap: "4px",
    },
    md: {
      width: "380px",
      maxWidth: "380px",
      gap: "6px",
    },
    mb: 0,
    minWidth: "280px",
  }),
  dayCell: {
    aspectRatio: "1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    borderRadius: "md",
    sm: {
      borderRadius: "sm",
      p: 0,
    },
    "&.current-month": {
      color: "text-primary",
    },
    "&.other-month": {
      ...getVariantStyle("plain", "neutral"),
      visibility: "hidden",
    },
    "&.has-availability": {
      ...getVariantStyle("soft", "primary"),

      fontWeight: "bold",
    },
    "&.no-availability": {
      ...getVariantStyle("plain", "neutral"),

      pointerEvents: "none",
    },
    "&.selected": getVariantStyle("solid", "primary"),
    "&:hover.has-availability:not(.selected)": getVariantStyle(
      "soft",
      "primary",
      "hover",
    ),
  },
  calendarContainer: {
    // New style
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
    minHeight: 0, // Important for flex child
    backgroundColor: "background-surface",
  },
});

interface SchedulingProps {
  duration: NumericExpr;
  name: Sql;
  description?: Node;
  scheduleInterface: Node;
  successMessage: Node;
  reschedule?: boolean;
  rescheduleAppointmentPublicId?: AnyExpr;
  timeSlotsTable: string;
  calendarTable: string;
  selectedDateScalar: string;
  getMonthUrl?: (month: AnyExpr) => Sql;
  poweredByYolm?: boolean;
  appointmentsTable: string;
  preview?: boolean;
  timezoneRegion?: TimezoneRegion;
  forcedTimezone?: Sql;
  backgroundColorOverride?: string;
  /**
   * If provided, replaces the default "Next" click handler that opens the
   * schedule form. Implementations are responsible for setting
   * `time_slots_time`, `selected_time`, `show_schedule_interface`, and
   * (optionally) `slot_just_taken` themselves — typically wrapping a fresh
   * server-side availability check in `s.tryServer` so a slot that was taken
   * between page load and click can refresh the calendar instead of opening
   * the form.
   */
  onNextSlotClick?: (s: DomStatements, value: AnyExpr) => void;
}

export function Scheduling({
  duration,
  name,
  description,
  reschedule,
  rescheduleAppointmentPublicId = sql`ui.appointment_public_id`,
  scheduleInterface,
  successMessage,
  timeSlotsTable,
  calendarTable,
  getMonthUrl,
  poweredByYolm,
  appointmentsTable,
  preview,
  timezoneRegion,
  forcedTimezone,
  backgroundColorOverride,
  onNextSlotClick,
}: SchedulingProps) {
  const hideOnMobileSelectedDate = {
    "&.selected-date": {
      display: "none",
      sm: {
        display: "block",
      },
    },
  };
  const selectedDateDynamicClass = {
    classes: "selected-date",
    condition: sql`selected_date is not null and not show_schedule_interface`,
  };
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("selected_time", {
          type: "TimestampNaive",
        });
        s.defScalar("time_slots_time", {
          type: { type: "TimestampNaive" },
        });
        s.defScalar("show_schedule_interface", sql`false`);
        s.defScalar("show_success_message", sql`false`);
        s.defScalar("slot_just_taken", sql`false`);
        s.defScalar("created_appointment_id", {
          type: "BigInt",
          expr: sql`null::bigint`,
          allowNoRead: true,
        });
      }}
    >
      <div sx={styles.root()}>
        <Conditional
          when={sql`show_success_message`}
          then={successMessage}
          else={
            <>
              <div
                sx={{
                  ...styles.infoSection,
                  backgroundColor: backgroundColorOverride
                    ? backgroundColorOverride
                    : "background-surface",
                }}
              >
                <Show
                  when={sql`selected_date is not null and not show_schedule_interface`}
                >
                  <div className="block sm:hidden">
                    <MobileSelectedDateHeader />
                  </div>
                </Show>
                <Typography
                  level="h4"
                  sx={{
                    mb: 2,
                    fontWeight: "bold",
                    fontSize: "1.125rem",
                    sm: {
                      mb: 3,
                    },
                    md: {
                      mb: 4,
                      fontSize: "1.25rem",
                    },
                    ...hideOnMobileSelectedDate,
                  }}
                  dynamicClass={selectedDateDynamicClass}
                  startDecorator={
                    <Show when={sql`show_schedule_interface`}>
                      <IconButton
                        variant="outlined"
                        color="primary"
                        aria-label="Back"
                        icon="ArrowBack"
                        onClick={(s) =>
                          s.setScalar("show_schedule_interface", false)}
                        size="sm"
                        sx={{ alignSelf: "flex-start", mr: 1 }}
                      />
                    </Show>
                  }
                >
                  {name}
                </Typography>

                <Typography
                  level="body-md"
                  startIcon="Timer"
                  sx={{
                    mb: 2,
                    ...hideOnMobileSelectedDate,
                  }}
                  dynamicClass={selectedDateDynamicClass}
                >
                  {formatSchedulingDuration(duration)}
                </Typography>
                {reschedule && (
                  <Data
                    procedure={(s) => {
                      s.defRecord(
                        "previous_event",
                        sql`select start_time from db.${
                          sql.ref(appointmentsTable)
                        } where public_id = ${rescheduleAppointmentPublicId}`,
                      );
                    }}
                  >
                    <Typography
                      level="body-sm"
                      sx={{ mb: 2, ml: 1, ...hideOnMobileSelectedDate }}
                    >
                      (Reschedule your event)
                    </Typography>
                    <div
                      sx={{
                        mb: 2,
                        ml: 1,
                        color: "neutral-500",
                        fontSize: "sm",
                        ...hideOnMobileSelectedDate,
                        "&.show_crossed_out": {
                          textDecoration: "line-through",
                        },
                      }}
                      dynamicClass={{
                        classes: "show_crossed_out",
                        condition:
                          sql`selected_date is not null and show_schedule_interface`,
                      }}
                    >
                      <div className="mb-2">Former Time:</div>
                      {sql`format.date(previous_event.start_time, '%A, %B %d, %Y')`}
                      <div className="mb-2">
                        {sql`format.date(previous_event.start_time, '%-I:%M%P')`}
                      </div>
                      <div className="flex items-center text-sm text-neutral-500">
                        <MaterialIcon icon="Language" />
                        {sql`date.part(timezone, previous_event.start_time)`}
                      </div>
                    </div>
                  </Data>
                )}
                <Show when={sql`show_schedule_interface`}>
                  <Typography
                    level="body-md"
                    startIcon="CalendarToday"
                    className="mb-4"
                  >
                    {sql`format.date(selected_time, '%-I:%M%P')`} at{" "}
                    {sql`format.date(selected_date, '%A, %B %d, %Y')`}
                  </Typography>
                </Show>

                {description && (
                  <div
                    sx={{
                      mb: 2,
                      ...hideOnMobileSelectedDate,
                    }}
                    dynamicClass={selectedDateDynamicClass}
                  >
                    {description}
                  </div>
                )}
                {poweredByYolm && (
                  <Typography
                    component="a"
                    href="https://yolm.ai"
                    target="_blank"
                    level="body-sm"
                    sx={{
                      mt: "auto",
                      display: "flex",
                      alignItems: "center",
                      textDecoration: "none",
                    }}
                    startDecorator={<YolmIcon />}
                  >
                    Powered by Yolm
                  </Typography>
                )}
              </div>
              <Switch>
                <Match when={sql`show_schedule_interface`}>
                  {scheduleInterface}
                </Match>
                <Match when={sql`not show_schedule_interface`}>
                  <CalendarInterface
                    calendarTable={calendarTable}
                    timeSlotsTable={timeSlotsTable}
                    getMonthUrl={getMonthUrl}
                    preview={preview}
                    timezoneRegion={timezoneRegion}
                    forcedTimezone={forcedTimezone}
                    backgroundColorOverride={backgroundColorOverride}
                    onDateClick={(s, value) => {
                      s.setScalar("selected_date", sql`${value}`);
                      s.setScalar("selected_time", sql`null`);
                      s.setScalar("slot_just_taken", false);
                    }}
                    onNextTimeClick={onNextSlotClick ?? ((s, value) => {
                      s.setScalar("time_slots_time", sql`${value}`);
                      s.setScalar("selected_time", sql`${value}`);
                      s.setScalar("show_schedule_interface", true);
                    })}
                  />
                </Match>
              </Switch>
            </>
          }
        />
      </div>
    </Data>
  );
}

function MobileSelectedDateHeader() {
  return (
    <>
      <div
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <div sx={{ alignSelf: "flex-start" }}>
          <IconButton
            variant="outlined"
            color="primary"
            size="sm"
            aria-label="Back"
            icon="ArrowBack"
            onClick={(s) => s.setScalar("selected_date", sql`null`)}
            className="grow"
          />
        </div>
        <div className="flex flex-col items-center grow">
          <Typography level="title-lg" className="mb-2 whitespace-nowrap">
            {sql`format.date(selected_date, '%A')`}
          </Typography>
          <Typography level="body-md" className="whitespace-nowrap">
            {sql`format.date(selected_date, '%B %d, %Y')`}
          </Typography>
        </div>
        <div sx={flexGrowStyles} />
      </div>
    </>
  );
}
/**
This component takes a timeSlotsTable with a start_time and end_time column and displays them in a list of buttons.
It also takes an CalendarTable with the dates of the month and a table with the availability ranges for each date with the columns:
agent_id,date,start_hour,start_minute,end_hour,end_minute.
*/
function CalendarInterface({
  calendarTable,
  timeSlotsTable,
  getMonthUrl,
  onDateClick,
  onNextTimeClick,
  preview,
  timezoneRegion,
  forcedTimezone,
  backgroundColorOverride,
}: {
  calendarTable: string;
  timeSlotsTable: string;
  getMonthUrl?: (month: AnyExpr) => Sql;
  onDateClick: (s: DomStatements, value: AnyExpr) => void;
  onNextTimeClick: (s: DomStatements, value: AnyExpr) => void;
  preview?: boolean;
  timezoneRegion?: TimezoneRegion;
  forcedTimezone?: Sql;
  backgroundColorOverride?: string;
}) {
  return (
    <div
      sx={{
        ...styles.calendarContainer,
        backgroundColor: backgroundColorOverride
          ? backgroundColorOverride
          : "background-surface",
      }}
    >
      <div
        sx={{
          py: 4,
          px: 2,
          sm: {
            px: 8,
            py: 4,
            "&.selected-date": {
              px: 1,
            },
          },
          md: {
            px: 4,
            py: 2,
            "&.selected-date": {
              px: 2,
            },
          },
          "@media (min-width: 950px)": {
            px: 8,
            py: 6,
            "&.selected-date": {
              px: 8,
            },
          },
        }}
        dynamicClass={{
          classes: "selected-date",
          condition: sql`selected_date is not null`,
        }}
      >
        <Typography
          level="h4"
          sx={{
            mb: 8,
            textAlign: "center",
            sm: {
              fontSize: "1rem",
              mb: 2,
            },
            md: {
              fontSize: "1.25rem",
              mb: 3,
            },
            "@media (min-width: 950px)": {
              mb: 16,
              textAlign: "left",
            },
          }}
        >
          <span className="hidden sm:inline md:inline">
            Select a Date & Time
          </span>
          <span
            sx={{
              display: "inline",
              sm: { display: "none" },
              "&.selected-day": { display: "none" },
            }}
            dynamicClass={{
              classes: "selected-day",
              condition: sql`selected_date is not null`,
            }}
          >
            Select a Day
          </span>
          <span
            sx={{
              display: "none",
              "&.selected-day": { display: "inline", sm: { display: "none" } },
            }}
            dynamicClass={{
              classes: "selected-day",
              condition: sql`selected_date is not null`,
            }}
          >
            Select a Time
          </span>
        </Typography>
        <div className="flex flex-col justify-center items-center md:flex-row md:items-start">
          <div
            sx={{
              display: "flex",
              flexDirection: "column",
              "&.selected-date": {
                display: "none",
                md: {
                  display: "flex",
                },
              },
            }}
            dynamicClass={{
              classes: "selected-date",
              condition: sql`selected_date is not null`,
            }}
          >
            <MonthSelector
              onPreviousMonth={(s) => {
                const month = sql`date.add(month, -1, current_month)`;
                if (getMonthUrl) {
                  s.location.assign(getMonthUrl(month));
                } else {
                  s.setScalar("current_month", month);
                }
                s.setScalar("selected_date", sql`null`);
              }}
              currentMonth={sql`current_month`}
              previousMonthUrl={getMonthUrl?.(
                sql`date.add(month, -1, current_month)`,
              )}
              onNextMonth={(s) => {
                const month = sql`date.add(month, 1, current_month)`;
                if (getMonthUrl) {
                  s.location.assign(getMonthUrl(month));
                } else {
                  s.setScalar("current_month", month);
                }
                s.setScalar("selected_date", sql`null`);
              }}
              nextMonthUrl={getMonthUrl?.(
                sql`date.add(month, 1, current_month)`,
              )}
            />
            <CalendarGrid
              calendarTable={calendarTable}
              onDateClick={onDateClick}
              currentMonth={sql`current_month`}
              currentDate={sql`selected_date`}
              userTimezone={sql`user_timezone`}
              timezoneRegion={timezoneRegion}
              forcedTimezone={forcedTimezone}
            />
          </div>

          <div
            sx={{
              width: 0,
              md: {
                transitionProperty: "width",
                transitionTimingFunction: "drawer",
                transitionDuration: "drawer",
              },
              ml: 0,
              overflow: "hidden",
              "&.showing": {
                width: "100%",
                "@media (min-width: 950px)": {
                  width: "180px",
                  ml: 6,
                },
              },
            }}
            dynamicClass={{
              classes: "showing",
              condition: sql`selected_date is not null`,
            }}
          >
            {/* Header for medium screens only */}
            <div
              sx={{
                display: "none",
                sm: {
                  display: "flex",
                  flexDirection: "column",
                  mb: 3,
                },
                md: {
                  display: "none",
                },
              }}
            >
              <div
                sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}
              >
                <IconButton
                  variant="outlined"
                  color="primary"
                  size="sm"
                  aria-label="Back"
                  icon="ArrowBack"
                  onClick={(s) => s.setScalar("selected_date", sql`null`)}
                />
                <Typography level="title-md" sx={{ fontWeight: "bold" }}>
                  {sql`format.date(selected_date, '%A')`}
                </Typography>
              </div>
              <Typography level="body-md" sx={{ ml: 10 }}>
                {sql`format.date(selected_date, '%B %d, %Y')`}
              </Typography>
            </div>

            <Typography
              level="title-sm"
              className="mb-4 whitespace-nowrap hidden"
              sx={{
                md: {
                  display: "block",
                  textAlign: "left",
                },
              }}
            >
              {sql`format.date(selected_date, '%A, %B %d')`}
            </Typography>
            <TimeSlots
              timeSlotsTable={timeSlotsTable}
              onNextTimeClick={onNextTimeClick}
              preview={preview}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TimeSlots({
  timeSlotsTable,
  onNextTimeClick,
  preview,
}: {
  timeSlotsTable: string;
  onNextTimeClick: (s: DomStatements, value: AnyExpr) => void;
  preview?: boolean;
}) {
  return (
    <div className="flex flex-col h-full gap-4 overflow-x-hidden">
      <div
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          maxHeight: "calc(100vh - 200px)",
          sm: {
            maxHeight: "400px",
          },
          "@media (min-width: 950px)": {
            maxHeight: "450px",
            pl: 0,
          },
          overflowY: "auto",
          overflowX: "hidden",
          pl: 2,
          pr: 2,
          pb: 4,
          "&::-webkit-scrollbar": {
            width: "6px",
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: "neutral-400",
            borderRadius: "sm",
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: "transparent",
          },
        }}
      >
        <Show when={sql`slot_just_taken`}>
          <div
            sx={{
              p: 1.5,
              borderRadius: "sm",
              backgroundColor: "warning-100",
              color: "warning-700",
              fontSize: "sm",
            }}
          >
            That time was just booked by someone else. Pick another slot.
          </div>
        </Show>
        <Each table={timeSlotsTable} recordName="slot">
          <div
            sx={{
              display: "flex",
              overflow: "hidden",
              minHeight: "48px",
              width: "100%",
              "@media (min-width: 640px)": {
                width: "600px",
              },
              md: {
                width: "160px",
              },
            }}
          >
            <Button
              variant="outlined"
              color="primary"
              size="lg"
              sx={{
                width: "100%",
                p: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                transitionTimingFunction: "popover",
                transitionDuration: "popover",
                transitionProperty: "width",
                "@media (min-width: 950px)": {
                  width: "160px",
                },
                "&.selected": {
                  width: "50%",
                  "@media (min-width: 950px)": {
                    width: "80px",
                  },
                  backgroundColor: "neutral-500",
                  color: "common-white",
                  cursor: "initial",
                },
              }}
              dynamicClass={{
                classes: "selected",
                condition: sql`slot.start_time = time_slots_time`,
              }}
              onClick={(s) => {
                s.setScalar("time_slots_time", sql`slot.start_time`);
                // onTimeClick(s, sql`slot.start_time`);
              }}
            >
              {sql`format.date(slot.start_time, '%-I:%M%P')`}
            </Button>
            <Show when={sql`slot.start_time = time_slots_time`}>
              <div
                sx={{
                  transitionTimingFunction: "popover",
                  transitionDuration: "popover",
                  transitionProperty: "width",
                  ml: 0.5,
                  overflow: "hidden",
                  width: "50%",
                  "@media (min-width: 950px)": {
                    width: "80px",
                  },
                  "@starting-style": {
                    width: "0px",
                  },
                }}
              >
                <Button
                  size="lg"
                  sx={{
                    width: "100%",
                    "@media (min-width: 950px)": {
                      width: "75px",
                    },
                  }}
                  disabled={preview}
                  onClick={(s) => onNextTimeClick(s, sql`slot.start_time`)}
                >
                  Next
                </Button>
              </div>
            </Show>
          </div>
        </Each>
      </div>
    </div>
  );
}

function CalendarGrid({
  calendarTable,
  onDateClick,
  currentMonth,
  currentDate,
  userTimezone,
  timezoneRegion,
  forcedTimezone,
}: {
  calendarTable: string;
  onDateClick: (s: DomStatements, value: AnyExpr) => void;
  currentMonth: AnyExpr;
  currentDate: AnyExpr;
  userTimezone: NumericExpr;
  timezoneRegion?: TimezoneRegion;
  forcedTimezone?: Sql;
}) {
  const forcedTimezoneValue = forcedTimezone ?? sql`null`;
  return (
    <>
      <div sx={styles.calendarGrid()}>
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => (
          <div
            className="text-center py-0.5 text-xs font-normal text-gray-600"
            sx={{ fontSize: "0.625rem" }}
          >
            {day}
          </div>
        ))}

        <Each table={calendarTable} recordName="day" eachKey={sql`day.date`}>
          <div
            sx={{
              ...styles.dayCell,
              minWidth: 0,
              minHeight: "36px",
            }}
            dynamicClasses={[
              {
                classes: "current-month",
                condition:
                  sql`date.part(month, day.date) = date.part(month, ${currentMonth})`,
              },
              {
                classes: "other-month",
                condition:
                  sql`date.part(month, day.date) != date.part(month, ${currentMonth})`,
              },
              {
                classes: "has-availability",
                condition: sql`day.available_hours`,
              },
              {
                classes: "no-availability",
                condition: sql`not day.available_hours`,
              },
              {
                classes: "selected",
                condition: sql`day.date = ${currentDate}`,
              },
            ]}
            onClick={(s) => {
              onDateClick(s, sql`day.date`);
            }}
          >
            {sql`date.part(day, day.date)`}
          </div>
        </Each>
      </div>
      <div sx={{ mt: 1 }}>
        <Typography
          level="body-sm"
          sx={{
            mb: 0.5,
            color: "text-secondary",
          }}
        >
          Time zone
        </Typography>
        <Show
          when={sql`${forcedTimezoneValue} is not null`}
          fallback={
            <SelectTimeZone
              variant="plain"
              value={userTimezone}
              region={timezoneRegion}
              onUnfilteredTimezoneChange={(s, value) => {
                s.setScalar("user_timezone", value);
              }}
              onInput={(s, value) => s.setScalar("user_timezone", value)}
            />
          }
        >
          <Typography level="body-sm" sx={{ color: "text-secondary" }}>
            {sql`'Timeslots displayed in ' || ${forcedTimezoneValue} || ' time zone'`}
          </Typography>
        </Show>
      </div>
    </>
  );
}

/**
 This component requires a scalar called current_month to be set in the parent component.
 */
function MonthSelector({
  onPreviousMonth,
  onNextMonth,
  currentMonth,
  previousMonthUrl,
  nextMonthUrl,
}: {
  onPreviousMonth: (s: DomStatements) => void;
  onNextMonth: (s: DomStatements) => void;
  currentMonth: AnyExpr;
  previousMonthUrl?: Sql;
  nextMonthUrl?: Sql;
}) {
  const previousDisabled = sql`${currentMonth} <= date.trunc(month, today())`;
  const previousButton = (
    <IconButton
      variant="plain"
      color="primary"
      aria-label="Previous Month"
      href={previousMonthUrl}
      onClick={previousMonthUrl ? undefined : (s) => {
        onPreviousMonth(s);
      }}
      sx={{
        "&:disabled": {
          // default disabled background draws too much attention
          backgroundColor: "transparent",
        },
      }}
      icon="ChevronLeft"
      disabled={previousMonthUrl ? undefined : previousDisabled}
    />
  );
  return (
    <>
      <div className="flex gap-1 items-center self-center mb-0.5 sm:gap-2 sm:mb-1">
        {previousMonthUrl
          ? (
            <IconButton
              component="a"
              variant="plain"
              color="primary"
              aria-label="Previous Month"
              aria-disabled={previousDisabled}
              target="_self"
              href={sql`case
                when ${previousDisabled} then null
                else ${previousMonthUrl}
              end`}
              sx={{
                "&[aria-disabled='true']": {
                  ...getVariantStyle("plain", "neutral", "disabled"),
                  backgroundColor: "transparent",
                  pointerEvents: "none",
                },
              }}
              icon="ChevronLeft"
            />
          )
          : previousButton}
        <Typography level="title-md">
          {sql`format.date(${currentMonth}, '%B %Y')`}
        </Typography>
        {nextMonthUrl
          ? (
            <IconButton
              component="a"
              variant="plain"
              color="primary"
              aria-label="Next Month"
              href={nextMonthUrl}
              target="_self"
              icon="ChevronRight"
            />
          )
          : (
            <IconButton
              variant="plain"
              color="primary"
              aria-label="Next Month"
              onClick={(s) => onNextMonth(s)}
              icon="ChevronRight"
            />
          )}
      </div>
    </>
  );
}
