import type { AvailabilityPage } from "./availability_page";
import type { SampleDataScriptContext } from "std/sample_data";
import { sql } from "../../std/sql_utils";
import type { NumericExpr, Sql } from "../../std/sql_utils";
import type { IServerBaseStatements, IStatementsBase } from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";

/**
 Provides a way to display avaialable time slots for one more users, including the ability to set time off periods.

 This is a block to handle availability of users, primarily working hours and time off periods.

 It adds tables all prefixed with "availability_" to store availability settings and time off periods:
 - availability_days: Stores which days of the week a user is available
 - availability_slots: Stores time slots for each available day
 - availability_date_specific_slots: Stores one-off availability for specific dates
 - availability_time_off_periods: Stores vacation and other time off periods

 Also adds associated enums like day_of_week for handling days of the week.

 The block provides methods to:
 - Set up default availability for users
 - Get availability ranges for date ranges, months, or specific days
 - Handle timezone conversions

 The block's main component is the AvailabilityPage component.

 */
export class AvailabilityBlock implements Block {
  blockName = "AvailabilityBlock";
  definedByBlock?: string;
  componentDependencies: string[] = [];
  description: string | undefined;
  static AvailabilityPage: typeof AvailabilityPage;
  initialize() {
    const db = system.db;

    system.enum_({
      name: "day_of_week",
      values: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
      withRulesFn: [
        {
          name: "day_of_week_as_int",
          outputType: "Int",
          fields: [
            ["sun", 0],
            ["mon", 1],
            ["tue", 2],
            ["wed", 3],
            ["thu", 4],
            ["fri", 5],
            ["sat", 6],
          ],
        },
      ],
    });

    db.table("availability_days", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.enum("day", "day_of_week").notNull();
      table.fk("sys_users").notNull();
      table.bool("enabled").notNull();
    });

    db.table("availability_slots", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("availability_days").notNull();
      table.time("start_time").notNull();
      table.time("end_time").notNull();
    });

    db.table("availability_date_specific_slots", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.date("date").notNull();
      table.time("start_time").notNull();
      table.time("end_time").notNull();
      table.fk("sys_users").notNull();
      table.check({
        fields: ["start_time", "end_time"],
        check: ([start_time, end_time]) => sql`${start_time} <= ${end_time}`,
        errorMessage: () => sql.lit`Start time must be before end time`,
      });
      table.check({
        fields: ["date"],
        check: ([date]) => sql`${date} >= now()`,
        errorMessage: () => sql.lit`The date must be in the future`,
      });
    });

    db.table("availability_time_off_periods", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.string("title", 100).notNull();
      table.date("start_date").notNull();
      table.date("end_date").notNull();
      table.string("notes", 255);
      table.fk("sys_users").notNull();
      table.check({
        fields: ["start_date", "end_date"],
        check: ([start_date, end_date]) => sql`${start_date} <= ${end_date}`,
        errorMessage: () => sql.lit`Start date must be before end date`,
      });
      table.check({
        fields: ["start_date"],
        check: ([start_date]) => sql`${start_date} >= now()`,
        errorMessage: () => sql.lit`The start date must be in the future`,
      });
    });
    this.componentDependencies = ["AvailabilityPage"];
    this.description =
      "Provides a way to display avaialable time slots for one more users, including the ability to set time off periods.";
  }

  afterGenerateSampleData(
    s: IServerBaseStatements,
    _ctx: SampleDataScriptContext,
  ) {
    s.startTransaction();
    s.forEachTable("sys_users", "user", (s) => {
      this.addDefaultAvailability(s, sql`user.id`);
    });
    s.commitTransaction();
  }

  addDefaultAvailability<T extends IStatementsBase>(s: T, userId: NumericExpr) {
    s.modify(sql`
      insert into availability_days (day, enabled, sys_user_id) values
      ('mon', true, ${userId}),
      ('tue', true, ${userId}),
      ('wed', true, ${userId}),
      ('thu', true, ${userId}),
      ('fri', true, ${userId}),
      ('sat', false, ${userId}),
      ('sun', false, ${userId})
    `);
    s.modify(sql`
      insert into availability_slots (availability_day_id, start_time, end_time) values
      ((select id from availability_days where day = 'mon' and sys_user_id = ${userId}), time '09:00', time '17:00'),
      ((select id from availability_days where day = 'tue' and sys_user_id = ${userId}), time '09:00', time '17:00'),
      ((select id from availability_days where day = 'wed' and sys_user_id = ${userId}), time '09:00', time '17:00'),
      ((select id from availability_days where day = 'thu' and sys_user_id = ${userId}), time '09:00', time '17:00'),
      ((select id from availability_days where day = 'fri' and sys_user_id = ${userId}), time '09:00', time '17:00')
    `);
  }

  getAvailabilityRangesForDateRange<T extends IServerBaseStatements>(
    s: T,
    opts: {
      // expects a query that has a date column
      query: Sql;
      targetTable: string;
      userTimezone: Sql;
      filterUserId: (userId: Sql) => Sql;
    },
  ) {
    s.defTable(
      opts.targetTable,
      sql`
    select
      sys_user_id,
      date,
      start_datetime,
      end_datetime,
      date.part(hour, start_datetime) as start_hour,
      date.part(minute, start_datetime) as start_minute,
      date.part(hour, end_datetime) as end_hour,
      date.part(minute, end_datetime) as end_minute
    from (
      select
        combined_availability.sys_user_id,
        combined_availability.date,
        date.new_timestamp(
          date.part(year, combined_availability.date),
          date.part(month, combined_availability.date),
          date.part(day, combined_availability.date),
          date.part(hour, combined_availability.start_time),
          date.part(minute, combined_availability.start_time),
          date.part(second, combined_availability.start_time)
        ) at time zone sys_users.timezone at time zone ${opts.userTimezone} as start_datetime,
        date.new_timestamp(
          date.part(year, combined_availability.date),
          date.part(month, combined_availability.date),
          date.part(day, combined_availability.date),
          date.part(hour, combined_availability.end_time),
          date.part(minute, combined_availability.end_time),
          date.part(second, combined_availability.end_time)
        ) at time zone sys_users.timezone at time zone ${opts.userTimezone} as end_datetime
      from (
        select sys_user_id, date, start_time, end_time
        from db.availability_date_specific_slots
        where date in (${opts.query}) and ${
        opts.filterUserId(sql`availability_date_specific_slots.sys_user_id`)
      }

        union all

        select da.sys_user_id, dr.date, das.start_time, das.end_time
        from (${opts.query}) dr
        join db.availability_days da on fn.day_of_week_as_int(da.day) = date.part(dow, dr.date)
        join db.availability_slots das on da.id = das.availability_day_id
        where ${opts.filterUserId(sql`da.sys_user_id`)}
          and da.enabled
          and not exists (
            select 1 from db.availability_date_specific_slots dsa
            where dsa.date = dr.date
              and dsa.sys_user_id = da.sys_user_id
          )
          and not exists (
            select 1 from db.availability_time_off_periods as top
            where top.sys_user_id = da.sys_user_id
              and top.start_date <= dr.date
              and top.end_date >= dr.date
          )
      ) combined_availability
      join db.sys_users on sys_users.id = combined_availability.sys_user_id
    ) tmp_availability_ranges
    where date.diff(minute, start_datetime, end_datetime) > 0
    order by date, start_datetime
  `,
    );
  }

  getAvailabilityRangesForMonth<T extends IServerBaseStatements>(
    s: T,
    opts: {
      month: Sql;
      targetTable: string;
      userTimezone: Sql;
      filterUserId: (userId: Sql) => Sql;
    },
  ) {
    this.getAvailabilityRangesForDateRange(s, {
      query: sql`select value as date
      from series.daily(
        date.add(day, -1, date.start_of_month(${opts.month})),
        date.diff(day, date.start_of_month(${opts.month}), date.end_of_month(${opts.month})) + 2
      )`,
      targetTable: opts.targetTable,
      userTimezone: opts.userTimezone,
      filterUserId: opts.filterUserId,
    });
  }

  getAvailabilityRangesForDay<T extends IServerBaseStatements>(
    s: T,
    opts: {
      date: Sql;
      targetTable: string;
      userTimezone: Sql;
      filterUserId: (userId: Sql) => Sql;
    },
  ) {
    this.getAvailabilityRangesForDateRange(s, {
      query:
        sql`select date from (values (${opts.date}), (date.add(day, 1, ${opts.date})), (date.add(day, -1, ${opts.date}))) as t(date)`,
      targetTable: opts.targetTable,
      userTimezone: opts.userTimezone,
      filterUserId: opts.filterUserId,
    });
  }
}
