import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import { AMOUNT_TYPE } from "./currency.ts";
import type { LedgerBlock } from "./index.tsx";

/**
 * Budgets: named plans of amounts per account and month, optionally by
 * dimension, signed like journal lines (expenses positive, income
 * negative). Several can exist for a year, e.g. "Plan" and "Forecast".
 */
export function defineBudgets(block: LedgerBlock) {
  const { db } = system;
  db.table("ledger_budgets", (table) => {
    table.displayName("Budgets");
    table.string("name", 200).notNull().unique();
    table.skipAutoApi();
  });
  db.table("ledger_budget_lines", (table) => {
    table.displayName("Budget lines");
    table.fk("budget_id", "ledger_budgets").notNull().onDelete("Cascade");
    table.fk("account_id", "ledger_accounts").notNull().onDelete("Restrict");
    /** First day of the month. */
    table.date("period").notNull();
    table.money("amount", AMOUNT_TYPE).notNull();
    for (const d of block.dimensions) {
      table.fk(`${d.key}_id`, d.table).onDelete("Restrict");
    }
    table.skipAutoApi();
  });

  // Seeds a budget from actual activity between two dates, shifted forward
  // by `p_shift_months` (12 for "last year's actuals as this year's plan"),
  // replacing the budget's lines for those months.
  system.storedProcedure({
    name: "ledger_budget_from_actuals",
    transaction: "caller",
    inputScalars: [
      { name: "p_budget_id", type: "BigInt" },
      { name: "p_from", type: "Date" },
      { name: "p_to", type: "Date" },
      { name: "p_shift_months", type: "Int" },
    ],
    procedure: (s) => {
      const dims = block.dimensions.map((d) => sql.ref(`${d.key}_id`));
      const dimList = dims.length ? sql`, ${dims}` : sql``;
      const period = sql`date.add(month, p_shift_months,
        date.start_of_month(posting_date))`;
      s.modify(sql`delete from db.ledger_budget_lines
        where budget_id = p_budget_id
          and period >= date.add(month, p_shift_months,
            date.start_of_month(p_from))
          and period <= date.add(month, p_shift_months, p_to)`);
      s.modify(sql`insert into db.ledger_budget_lines
        (budget_id, account_id, period, amount ${dimList})
        select p_budget_id, account_id, ${period}, sum(amount) ${dimList}
        from db.ledger_lines line
        where posting_date >= p_from and posting_date <= p_to
          ${block.books.length ? sql`and book is null` : sql``}
          and (select account_class from db.ledger_accounts
            where id = line.account_id) in ('income', 'expense')
        group by account_id, ${period} ${dimList}
        having sum(amount) <> 0`);
    },
  });
}

/**
 * Budget against actual per account and month (`period` is the month's
 * first day) between two dates, signed like journal lines. `lineFilter`
 * applies to both sides, e.g. one department.
 */
export function budgetVsActualQuery(
  block: LedgerBlock,
  opts: { budgetId: Sql; from: Sql; to: Sql; lineFilter?: Sql },
): Sql {
  const filter = opts.lineFilter ? sql`and (${opts.lineFilter})` : sql``;
  return sql`
    select account_id, period, sum(budget) as budget, sum(actual) as actual,
      sum(actual) - sum(budget) as variance
    from (
      select account_id, period, amount as budget, 0 as actual
      from db.ledger_budget_lines
      where budget_id = ${opts.budgetId} and period >= date.start_of_month(${opts.from})
        and period <= ${opts.to} ${filter}
      union all
      select account_id, date.start_of_month(posting_date), 0, amount
      from db.ledger_lines
      where posting_date >= ${opts.from} and posting_date <= ${opts.to}
        ${block.books.length ? sql`and book is null` : sql``} ${filter}
    ) both_sides
    group by account_id, period`;
}
