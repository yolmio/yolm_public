import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { HelperProcField, IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import type { TableBuilder } from "std/system";
import { AMOUNT_TYPE } from "./currency.ts";
import type { LedgerBlock, LedgerSource } from "./index.tsx";

/** Months a schedule can run at most. */
const MAX_MONTHS = 600;

function dimensionFields(block: LedgerBlock, table: TableBuilder) {
  for (const d of block.dimensions) {
    table.fk(`${d.key}_id`, d.table).onDelete("Restrict");
  }
}

/**
 * Posts `pending` rows (`schedule_id`, `period`, `account_id`,
 * `offset_account_id`, `amount`, dimension columns): one entry per period,
 * the account receiving `amount` and the offset its negative, then records
 * each row in `postings` so reruns skip it. A period on or before the
 * closing date posts on the first open day instead, so one closed month
 * does not stop every schedule.
 */
export function postSchedulePending<T extends IServerBaseStatements>(
  s: T,
  block: LedgerBlock,
  source: LedgerSource,
  opts: {
    pending: string;
    postings: string;
    scheduleColumn: string;
    description: string;
  },
) {
  const pending = sql.ref(opts.pending);
  const dims = block.dimensions.map((d) => sql.ref(`${d.key}_id`));
  const dimList = dims.length ? sql`, ${dims}` : sql``;
  // One entry per period, and per entity with entities, so one entity's
  // close does not move another entity's postings.
  const scope = sql`period = schedule_period.period ${
    block.entities
      ? sql`and (entity_id = schedule_period.entity_id
        or (entity_id is null and schedule_period.entity_id is null))`
      : sql``
  }`;
  s.forEachQuery(
    sql`select distinct period ${block.entities ? sql`, entity_id` : sql``}
      from ${pending} order by period`,
    "schedule_period",
    (s) => {
      const entry = block.uniqueName("schedule_entry");
      s.defScalar(entry, { type: "BigInt" });
      source.post(s, {
        date: block.openDateSql(
          sql`schedule_period.period`,
          sql`(select * from ${pending} where ${scope})`,
        ),
        description: sql.lit(opts.description),
        lines: {
          query: sql`select account_id, amount ${dimList} from ${pending}
            where ${scope}
            union all
            select offset_account_id, -amount ${dimList} from ${pending}
            where ${scope}`,
          columns: block.dimensions.map((d) => d.key),
        },
        intoEntryId: entry,
      });
      s.modify(sql`insert into db.${sql.ref(opts.postings)}
        (${sql.ref(opts.scheduleColumn)}, period, amount, entry_id)
        select schedule_id, period, amount, ${sql.ref(entry)}
        from ${pending} where ${scope}`);
    },
  );
}

export const schedulePendingFields = (
  block: LedgerBlock,
): HelperProcField[] => [
  { name: "schedule_id", type: "BigInt" },
  { name: "period", type: "Date" },
  { name: "account_id", type: "BigInt" },
  { name: "offset_account_id", type: "BigInt" },
  { name: "amount", type: AMOUNT_TYPE },
  ...block.dimensions.map((d): HelperProcField => ({
    name: `${d.key}_id`,
    type: "BigInt",
  })),
];

/** Last day of the month `k` months after `start`'s month. */
export function schedulePeriodEnd(start: Sql, k: Sql): Sql {
  return sql`date.subtract(day, 1,
    date.add(month, ${k} + 1, date.start_of_month(${start})))`;
}

/**
 * Deferrals: revenue billed ahead (deferred revenue) or costs paid ahead
 * (prepaid expenses) recognized evenly over months. `amount` is what the
 * recognition account receives in total: negative for revenue (a credit),
 * positive for expense.
 */
export function defineDeferrals(block: LedgerBlock, source: LedgerSource) {
  const { db } = system;
  db.table("ledger_deferrals", (table) => {
    table.displayName("Deferrals");
    table.string("description", 200).notNull();
    table.fk("deferral_account_id", "ledger_accounts").notNull()
      .onDelete("Restrict");
    table.fk("recognition_account_id", "ledger_accounts").notNull()
      .onDelete("Restrict");
    table.money("amount", AMOUNT_TYPE).notNull();
    table.date("start_on").notNull();
    table.smallInt("months").notNull().check(
      (months) => sql`${months} between 1 and ${MAX_MONTHS}`,
      () => sql.lit`A deferral runs 1 to 600 months`,
    );
    /** Stops recognition after this date; `cancelDeferral` sets it. */
    table.date("cancelled_on");
    /** The document that created it, e.g. an invoice. */
    table.enum("source", "ledger_source");
    table.bigInt("source_record_id");
    dimensionFields(block, table);
    table.skipAutoApi();
  });
  db.table("ledger_deferral_postings", (table) => {
    table.displayName("Deferral postings");
    table.fk("deferral_id", "ledger_deferrals").notNull().onDelete("Restrict");
    table.date("period").notNull();
    table.money("amount", AMOUNT_TYPE).notNull();
    table.fk("entry_id", "ledger_entries").notNull().onDelete("Restrict");
    table.insertOnly();
    table.skipAutoApi();
  });

  system.storedProcedure({
    name: "ledger_recognize_deferrals",
    transaction: "caller",
    inputScalars: [{ name: "p_through", type: "Date" }],
    procedure: (s) => {
      const dims = block.dimensions.map((d) =>
        sql`d.${sql.ref(`${d.key}_id`)}`
      );
      // Cast before rounding: compiled, rounding a raw quotient can land a
      // hundredth off (99.7099 for 99.7058).
      const per = sql`round(cast(d.amount / d.months as decimal(18, 6)), ${
        block.amountDecimalsSql(sql`d`)
      })`;
      s.defTable("pending_deferrals", { fields: schedulePendingFields(block) });
      s.modify(sql`insert into pending_deferrals
        select d.id, ${schedulePeriodEnd(sql`d.start_on`, sql`k.value`)},
          d.recognition_account_id, d.deferral_account_id,
          case when k.value = d.months - 1
            then d.amount - ${per} * (d.months - 1) else ${per} end
          ${dims.length ? sql`, ${dims}` : sql``}
        from db.ledger_deferrals d
        join series.int(0, ${MAX_MONTHS - 1}) k on k.value < d.months
        where ${schedulePeriodEnd(sql`d.start_on`, sql`k.value`)} <= p_through
          and d.cancelled_on is null
          and not exists (select 1 from db.ledger_deferral_postings posted
            where posted.deferral_id = d.id
              and posted.period = ${
        schedulePeriodEnd(sql`d.start_on`, sql`k.value`)
      })`);
      s.modify(sql`delete from pending_deferrals where amount = 0`);
      postSchedulePending(s, block, source, {
        pending: "pending_deferrals",
        postings: "ledger_deferral_postings",
        scheduleColumn: "deferral_id",
        description: "Deferral recognition",
      });
    },
  });

  // Stops a deferral and moves what was recognized back to the deferral
  // account: on `p_date` (an invoice voided later), or without one in each
  // recognized month (an invoice edited or voided on its own date), so
  // reposting a document does not shift revenue between months.
  system.storedProcedure({
    name: "ledger_cancel_deferral",
    transaction: "caller",
    inputScalars: [
      { name: "p_deferral_id", type: "BigInt" },
      { name: "p_date", type: "Date" },
    ],
    procedure: (s) => {
      s.defRecord(
        "deferral",
        sql`select d.id, d.deferral_account_id, d.recognition_account_id,
            d.cancelled_on,
            coalesce((select sum(amount) from db.ledger_deferral_postings
              where deferral_id = d.id), 0) as recognized
            ${
          block.dimensions.length
            ? sql`, ${
              block.dimensions.map((d) => sql`d.${sql.ref(`${d.key}_id`)}`)
            }`
            : sql``
        }
          from db.ledger_deferrals d where d.id = p_deferral_id`,
      );
      s.throwErrorIf(
        sql`deferral.id is null or deferral.cancelled_on is not null`,
        sql.lit`This deferral is not active`,
      );
      s.if(sql`p_date is null`, (s) => {
        s.defTable("undone_deferrals", {
          fields: schedulePendingFields(block),
        });
        s.modify(sql`insert into undone_deferrals
          select d.id, posted.period, d.recognition_account_id,
            d.deferral_account_id, -sum(posted.amount)
            ${
          block.dimensions.length
            ? sql`, ${
              block.dimensions.map((d) => sql`d.${sql.ref(`${d.key}_id`)}`)
            }`
            : sql``
        }
          from db.ledger_deferral_postings posted
          join db.ledger_deferrals d on d.id = posted.deferral_id
          where d.id = p_deferral_id
          group by d.id, posted.period, d.recognition_account_id,
            d.deferral_account_id ${
          block.dimensions.length
            ? sql`, ${
              block.dimensions.map((d) => sql`d.${sql.ref(`${d.key}_id`)}`)
            }`
            : sql``
        }
          having sum(posted.amount) <> 0`);
        postSchedulePending(s, block, source, {
          pending: "undone_deferrals",
          postings: "ledger_deferral_postings",
          scheduleColumn: "deferral_id",
          description: "Cancelled deferral",
        });
      });
      s.if(sql`p_date is not null and deferral.recognized <> 0`, (s) => {
        const dims = Object.fromEntries(
          block.dimensions.map((d) => [
            d.key,
            sql`deferral.${sql.ref(`${d.key}_id`)}`,
          ]),
        );
        s.defScalar("cancel_entry_id", { type: "BigInt" });
        source.post(s, {
          date: sql`p_date`,
          description: sql.lit`Cancelled deferral`,
          intoEntryId: "cancel_entry_id",
          lines: [
            {
              account: sql`deferral.recognition_account_id`,
              amount: sql`-deferral.recognized`,
              dimensions: dims,
            },
            {
              account: sql`deferral.deferral_account_id`,
              amount: sql`deferral.recognized`,
              dimensions: dims,
            },
          ],
        });
        // Keeps the postings equal to what the ledger recognized.
        s.modify(sql`insert into db.ledger_deferral_postings
          (deferral_id, period, amount, entry_id)
          values (p_deferral_id, p_date, -deferral.recognized,
            cancel_entry_id)`);
      });
      s.modify(sql`update db.ledger_deferrals
        set cancelled_on = coalesce(p_date, current_date())
        where id = p_deferral_id`);
    },
  });
}
