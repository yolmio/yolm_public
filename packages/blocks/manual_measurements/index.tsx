import type { Block } from "std/system";
import { addMinuteDurationFns, system } from "std/system";
import type { Sql } from "std/sql_utils";
import type { HelperProcField } from "std/statements";
import { sql } from "std/sql_utils";
export {
  ManualEntry,
  ManualMeasurementsPage,
  ManualMeasurementsSetupPage,
} from "./page";
export const measurementFormats = [
  "number",
  "number_thousands",
  "currency",
  "percentage",
  "duration",
] as const;

export class ManualMeasurementsBlock implements Block {
  blockName = "ManualMeasurementsBlock";
  componentDependencies = [
    "ManualMeasurementsPage",
    "ManualMeasurementsSetupPage",
    "ManualEntry",
  ];
  readonly statsTable = "manual_stats";
  readonly entriesTable = "manual_stat_entries";
  readonly formatEnum = "measurement_format";
  constructor(
    readonly opts: {
      permissions: { view: Sql; manage: Sql; enter: Sql };
      /** Maps an arbitrary date to the stored label for a weekly period. */
      weeklyPeriodDate?: (date: Sql) => Sql;
      /** Compact-entry caption for the configured weekly period label. */
      weeklyPeriodLabel?: string;
    },
  ) {}
  weeklyPeriodDate(date: Sql) {
    return this.opts.weeklyPeriodDate?.(date) ?? sql`date.end_of_week(${date})`;
  }
  ref(table: string) {
    return sql.ref("db", table);
  }
  initialize() {
    addMinuteDurationFns();
    system.enum_({ name: this.formatEnum, values: [...measurementFormats] });
    system.enum_({
      name: "measurement_frequency",
      values: ["daily", "weekly"],
    });
    system.db.table(this.statsTable, (t) => {
      t.string("name", 160).notNull();
      t.string("description", 2000).multiline();
      t.enum("value_format", this.formatEnum).notNull().default(
        sql.lit`number`,
      );
      t.enum("frequency", "measurement_frequency").notNull().default(
        sql.lit`weekly`,
      );
      t.string("unit", 80);
      t.bool("active").notNull().default(sql.true);
      t.recordDisplayName(["name"], (name) => name);
      t.check({
        fields: ["name"],
        check: ([name]) => sql`length(trim(${name})) > 0`,
        errorMessage: () => sql.lit`Enter a measurement name.`,
      });
    });
    system.db.table(this.entriesTable, (t) => {
      t.fk("stat_id", this.statsTable).notNull().onDelete("Restrict");
      t.date("period_date").notNull();
      t.decimal("value", { precision: 18, scale: 4 });
      t.string("note", 2000).multiline();
      t.fk("entered_by", "sys_users");
      t.timestampUtc("entered_at").notNull().default(sql`now()`);
      t.unique(["stat_id", "period_date"]);
    });
  }
  requirePermission<T extends import("std/statements").IStatementsBase>(
    s: T,
    action: "view" | "manage" | "enter",
  ) {
    s.throwErrorIf(
      sql`not coalesce((${this.opts.permissions.view}), false) or not coalesce((${
        this.opts.permissions[action]
      }), false)`,
      sql.lit`You do not have permission to perform this measurement action.`,
    );
  }
  validateEntries<T extends import("std/statements").IStatementsBase>(
    s: T,
    rows: Sql,
  ) {
    this.requirePermission(s, "enter");
    s.throwErrorIf(
      sql`exists(select 1 from (${rows}) input left join db.manual_stats stat on stat.id = input.stat_id
      where stat.id is null or not stat.active or input.period_date is null
      or (stat.frequency = 'weekly' and input.period_date != ${
        this.weeklyPeriodDate(sql`input.period_date`)
      })
      or (stat.value_format = 'percentage' and input.value is not null and input.value not between 0 and 1))`,
      sql
        .lit`Entries require an active measurement, a valid reporting date, and percentages between 0% and 100%.`,
    );
    s.throwErrorIf(
      sql`exists(select 1 from (${rows}) input group by stat_id, period_date having count(*) > 1)`,
      sql.lit`A measurement can have only one value per date.`,
    );
  }
  /** Entry-form rows checked by `manual_stats_validate_entry_rows`. */
  readonly entryRowsFields: HelperProcField[] = [
    { name: "stat_id", type: "BigUint" },
    { name: "period_date", type: "Date" },
    {
      name: "value",
      type: { type: "Decimal", precision: 18, scale: 4, signed: true },
    },
    { name: "write_db_id", type: "BigUint" },
    { name: "entered_at", type: "TimestampTz" },
  ];
  populate() {
    // Keeps the entry validation SQL out of every route that renders ManualEntry.
    system.storedProcedure({
      name: "manual_stats_validate_entry_rows",
      transaction: "caller",
      inputTables: [
        { name: "manual_stat_entry_rows", fields: this.entryRowsFields },
      ],
      procedure: (s) => {
        this.validateEntries(
          s,
          sql`select stat_id, period_date, value from manual_stat_entry_rows`,
        );
        s.throwErrorIf(
          sql`exists(select 1 from manual_stat_entry_rows input where input.write_db_id is not null and not exists(select 1 from ${
            this.ref(this.entriesTable)
          } entry where entry.id = input.write_db_id and entry.stat_id = input.stat_id and entry.period_date = input.period_date and entry.entered_at = cast(input.entered_at as timestamptz)))`,
          sql.lit`The entry changed. Reload before saving.`,
        );
      },
    });
  }
  valuesQuery(statId: Sql, range: { startDate: Sql; endDate: Sql }) {
    return sql`select period_date, value::double as value from db.manual_stat_entries where stat_id = ${statId} and period_date between ${range.startDate} and ${range.endDate} and value is not null and (${this.opts.permissions.view})`;
  }
}
