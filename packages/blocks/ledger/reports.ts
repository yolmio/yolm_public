import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { TRANSLATION_ADJUSTMENT_ACCOUNT } from "./accounts.ts";
import type { LedgerBlock } from "./index.tsx";

const PROFIT_AND_LOSS_CLASSES = sql`('income', 'expense')`;

/**
 * Book scope for a report: base-book lines plus the adjustments of `book`
 * when given. Without books every line is in the base book.
 */
function bookCondition(block: LedgerBlock, book?: Sql, alias?: string): Sql {
  if (!block.books.length) return sql`true`;
  const column = alias ? sql`${sql.ref(alias)}.book` : sql`book`;
  return book
    ? sql`(${column} is null or ${column} = ${book})`
    : sql`${column} is null`;
}

/**
 * Average rate per currency and month: the mean of that month's rates up to
 * `asOf`, so re-running a past report ignores rates added since.
 */
function monthRates(asOf: Sql): Sql {
  return sql`
    select currency, date.start_of_month(rate_date) as period,
      avg(rate) as rate
    from db.ledger_exchange_rates
    where rate_date <= ${asOf}
    group by currency, date.start_of_month(rate_date)`;
}

/** Each currency's latest rate on or before `asOf`. */
function closingRates(asOf: Sql): Sql {
  return sql`select rate.currency, rate.rate
    from db.ledger_exchange_rates rate
    where rate.rate_date = (select max(latest.rate_date)
      from db.ledger_exchange_rates latest
      where latest.currency = rate.currency and latest.rate_date <= ${asOf})`;
}

/**
 * With consolidation: line sums per account, entity (lines without one
 * belong to the home entity), and month, over lines matching `lineScope`.
 */
function translationPieces(
  block: LedgerBlock,
  sums: Sql,
  lineScope: Sql,
): Sql {
  const entity = sql`coalesce(line.entity_id, home.id)`;
  return sql`select account_id, ${entity} as entity_id,
      date.start_of_month(posting_date) as period, ${sums}
    from db.ledger_lines line
    cross join (select ${block.homeEntitySql} as id) home
    where ${lineScope}
    group by account_id, ${entity}, date.start_of_month(posting_date)`;
}

/**
 * Joins each `piece`'s entity currency (`entity.currency`, null for the
 * group currency) and rates: the month's average and, with `asOf`, the
 * closing rate.
 */
function translationJoins(asOf: Sql, closing: boolean): Sql {
  return sql`
    left join db.ledger_entity_currencies entity
      on entity.entity_id = piece.entity_id
    left join (${monthRates(asOf)}) average_rate
      on average_rate.currency = entity.currency
        and average_rate.period = piece.period
    ${
    closing
      ? sql`left join (${closingRates(asOf)}) closing_rate
      on closing_rate.currency = entity.currency`
      : sql``
  }`;
}

/** True for pieces whose entity keeps a currency other than the group's. */
function isForeignSql(block: LedgerBlock): Sql {
  return sql`(entity.currency is not null
    and entity.currency <> ${sql.lit(block.functionalCurrency)})`;
}

/**
 * Group-currency units per entity-currency unit: the month's average (the
 * rate in force at month end when the month has none), or with `closing`
 * the rate in force at `asOf`. Before a currency's first rate, its earliest
 * rate stands in. Null (the amount is left out) only when the currency has
 * no rate at all; the integrity query reports that.
 */
function translationRate(block: LedgerBlock, closing: boolean): Sql {
  const inForce = sql`(select rate from db.ledger_exchange_rates in_force
    where in_force.currency = entity.currency
      and in_force.rate_date = (select max(latest.rate_date)
        from db.ledger_exchange_rates latest
        where latest.currency = entity.currency
          and latest.rate_date < date.add(month, 1, piece.period)))`;
  const earliest = sql`(select rate from db.ledger_exchange_rates earliest
    where earliest.currency = entity.currency
      and earliest.rate_date = (select min(first_rate.rate_date)
        from db.ledger_exchange_rates first_rate
        where first_rate.currency = entity.currency))`;
  const rate = closing
    ? sql`closing_rate.rate`
    : sql`coalesce(average_rate.rate, ${inForce})`;
  return sql`case when not ${isForeignSql(block)} then 1
    else coalesce(${rate}, ${earliest}) end`;
}

/** True when statements translate entity currencies into the group's. */
function translates(block: LedgerBlock, translate?: boolean): boolean {
  return block.consolidation && translate !== false;
}

/** Joins an account's parent and grandparent for sub-account presentation. */
const ACCOUNT_ANCESTORS = sql`
  left join db.ledger_accounts parent on parent.id = account.parent_id
  left join db.ledger_accounts grandparent on grandparent.id = parent.parent_id`;

/**
 * `sort_path` orders sub-accounts under their parents; `display_name` reads
 * "Parent: Child"; `parent_path` and `parent_label` identify the parent for
 * subtotal lines.
 */
const ACCOUNT_PRESENTATION = sql`
  coalesce(grandparent.number || '.', '') || coalesce(parent.number || '.', '')
    || account.number as sort_path,
  coalesce(grandparent.name || ': ', '') || coalesce(parent.name || ': ', '')
    || account.name as display_name,
  case when parent.id is not null then
    coalesce(grandparent.number || '.', '') || parent.number end as parent_path,
  parent.number || ' ' || coalesce(grandparent.name || ': ', '')
    || parent.name as parent_label`;

/**
 * One row per account with activity, from a single scan of journal lines:
 *
 * - `activity`: net amount posted from `from` through `asOf` (inclusive).
 * - `balance`: statement balance at `asOf`; cumulative for balance-sheet
 *   accounts, fiscal-year-to-date for profit-and-loss accounts.
 * - `prior_years`: profit-and-loss amounts before the fiscal year, which the
 *   balance sheet reports as retained earnings.
 *
 * `lineFilter` restricts lines, e.g. to one dimension value for a
 * profit-and-loss by project. Amounts are signed (debits positive). Multiply by `normal_sign` for
 * presentation, where credit-normal classes read as positive.
 */
export function accountTotalsQuery(
  block: LedgerBlock,
  opts: {
    asOf: Sql;
    from?: Sql;
    lineFilter?: Sql;
    book?: Sql;
    translate?: boolean;
  },
): Sql {
  const fiscalYearStart = block.fiscalYearStartSql(opts.asOf);
  const from = opts.from ?? fiscalYearStart;
  const sums = sql`
    sum(case when posting_date >= ${from} then amount else 0 end)
      as activity,
    sum(case when posting_date >= ${fiscalYearStart} then amount else 0 end)
      as year_to_date,
    sum(amount) as cumulative`;
  const lineScope = sql`posting_date <= ${opts.asOf}
    and ${bookCondition(block, opts.book)}
    ${opts.lineFilter ? sql`and (${opts.lineFilter})` : sql``}`;
  const totals = translates(block, opts.translate)
    ? translatedTotals(block, opts.asOf, sums, lineScope)
    : sql`select account_id, ${sums} from db.ledger_lines
      where ${lineScope} group by account_id`;
  return sql`
    select account.id as account_id, account.number, account.name,
      account.type, account.account_class,
      case when account.account_class in ('asset', 'expense') then 1 else -1 end
        as normal_sign,
      totals.activity,
      case when account.account_class in ${PROFIT_AND_LOSS_CLASSES}
        then totals.year_to_date else totals.cumulative end as balance,
      case when account.account_class in ${PROFIT_AND_LOSS_CLASSES}
        then totals.cumulative - totals.year_to_date else 0 end as prior_years,
      ${ACCOUNT_PRESENTATION}
    from (${totals}) totals
    join db.ledger_accounts account on account.id = totals.account_id
    ${ACCOUNT_ANCESTORS}`;
}

/**
 * Account totals translated into the group currency from one scan: line
 * sums per account, entity, and month; asset and liability balances at the
 * closing rate, everything else at the month's average rate. A second copy
 * of each foreign-currency piece, negated, lands on the translation
 * adjustment account so the translated trial balance still sums to zero (a
 * union with a separate adjustment row would scan the lines twice).
 * Group-currency pieces translate at 1 and need no adjustment.
 */
function translatedTotals(
  block: LedgerBlock,
  asOf: Sql,
  sums: Sql,
  lineScope: Sql,
): Sql {
  const average = translationRate(block, false);
  const closing = translationRate(block, true);
  const own = sql`copy.side = 1`;
  return sql`
    select case when ${own} then piece.account_id else adjustment.id end
        as account_id,
      sum(case when ${own} then piece.activity * ${average} else 0 end)
        as activity,
      sum(case when ${own} then piece.year_to_date * ${average} else 0 end)
        as year_to_date,
      sum(case when ${own} then 1 else -1 end * piece.cumulative
        * case when account.account_class in ('asset', 'liability')
          then ${closing} else ${average} end) as cumulative
    from (${translationPieces(block, sums, lineScope)}) piece
    join db.ledger_accounts account on account.id = piece.account_id
    ${translationJoins(asOf, true)}
    join (select 1 as side union all select 2 as side) copy
      on copy.side = 1 or ${isForeignSql(block)}
    left join db.ledger_accounts adjustment
      on adjustment.number = ${sql.lit(TRANSLATION_ADJUSTMENT_ACCOUNT.number)}
    group by case when ${own} then piece.account_id else adjustment.id end`;
}

/**
 * Lines on one account between two dates, with a running balance that starts
 * from the account's opening balance at `from`.
 */
export function accountRegisterQuery(
  block: LedgerBlock,
  opts: { accountId: Sql; from: Sql; to: Sql; book?: Sql },
): Sql {
  const dimensionColumns = block.dimensions.map((d) =>
    sql`line.${sql.ref(`${d.key}_id`)}`
  );
  return sql`
    select line.id as line_id, line.entry_id, line.posting_date, entry.source,
      entry.source_record_id, entry.description, line.memo, line.amount,
      line.debit, line.credit,
      ${openingBalanceSql(block, opts.accountId, opts.from, opts.book)}
        + sum(line.amount) over (
          order by line.posting_date, line.id
          rows between unbounded preceding and current row) as balance
      ${dimensionColumns.length ? sql`, ${dimensionColumns}` : sql``}
    from db.ledger_lines line
    join db.ledger_entries entry on entry.id = line.entry_id
    where line.account_id = ${opts.accountId}
      and ${bookCondition(block, opts.book, "line")}
      and line.posting_date >= ${opts.from}
      and line.posting_date <= ${opts.to}`;
}

/**
 * Account balance before `date`. Profit-and-loss accounts start each fiscal
 * year at zero.
 */
export function openingBalanceSql(
  block: LedgerBlock,
  accountId: Sql,
  date: Sql,
  book?: Sql,
): Sql {
  return sql`coalesce((
    select sum(line.amount) from db.ledger_lines line
    where line.account_id = ${accountId}
      and line.posting_date < ${date}
      and ${bookCondition(block, book, "line")}
      and (line.posting_date >= ${block.fiscalYearStartSql(date)}
        or (select account_class from db.ledger_accounts
          where id = ${accountId}) not in ${PROFIT_AND_LOSS_CLASSES})
  ), 0)`;
}

/** Entries between two dates with their debit total and line count. */
export function journalQuery(
  block: LedgerBlock,
  opts: { from: Sql; to: Sql },
): Sql {
  return sql`
    select entry.id as entry_id, entry.posting_date, entry.source,
      entry.source_record_id, entry.document_number, entry.description,
      ${
    block.books.length
      ? sql`cast(entry.book as string)`
      : sql`cast(null as string)`
  } as book,
      entry.reverses_entry_id,
      entry.posted_at, totals.debits, totals.line_count,
      exists (select 1 from db.ledger_entries reversal
        where reversal.reverses_entry_id is not null
          and reversal.reverses_entry_id = entry.id) as is_reversed
    from db.ledger_entries entry
    join (
      select entry_id, sum(case when amount > 0 then amount else 0 end)
        as debits, count(*) as line_count
      from db.ledger_lines
      where posting_date >= ${opts.from} and posting_date <= ${opts.to}
      group by entry_id
    ) totals on totals.entry_id = entry.id`;
}

/**
 * Profit-and-loss activity between two dates, one row per income or expense
 * account and `period`. With `byMonth`, `period` is each month's first day;
 * otherwise it is null. `normal_sign` flips credit-normal accounts for
 * presentation.
 */
export function profitAndLossActivityQuery(
  block: LedgerBlock,
  opts: {
    from: Sql;
    to: Sql;
    byMonth?: Sql;
    lineFilter?: Sql;
    book?: Sql;
    translate?: boolean;
  },
): Sql {
  const periodOf = (month: Sql) =>
    opts.byMonth
      ? sql`case when ${opts.byMonth} then ${month}
        else cast(null as date) end`
      : sql`cast(null as date)`;
  const period = periodOf(sql`date.start_of_month(posting_date)`);
  const lineScope = sql`posting_date >= ${opts.from}
    and posting_date <= ${opts.to}
    and ${bookCondition(block, opts.book)}
    ${opts.lineFilter ? sql`and (${opts.lineFilter})` : sql``}`;
  // Translated: sums per entity and month at the month's average rate.
  const activity = translates(block, opts.translate)
    ? sql`select piece.account_id, ${periodOf(sql`piece.period`)} as period,
        sum(piece.amount * ${translationRate(block, false)})
          as amount
      from (${
      translationPieces(block, sql`sum(amount) as amount`, lineScope)
    }) piece
      ${translationJoins(opts.to, false)}
      group by piece.account_id, ${periodOf(sql`piece.period`)}`
    : sql`select account_id, ${period} as period, sum(amount) as amount
      from db.ledger_lines where ${lineScope}
      group by account_id, ${period}`;
  return sql`
    select account.id as account_id, account.number, account.name,
      account.type,
      case when account.account_class = 'expense' then 1 else -1 end
        as normal_sign,
      activity.period, activity.amount, ${ACCOUNT_PRESENTATION}
    from (${activity}) activity
    join db.ledger_accounts account on account.id = activity.account_id
    ${ACCOUNT_ANCESTORS}
    where account.account_class in ${PROFIT_AND_LOSS_CLASSES}
      and activity.amount <> 0`;
}

/** Net activity per account number and month, debits positive. */
export function activityByMonthQuery(
  block: LedgerBlock,
  opts: { from: Sql; to: Sql; book?: Sql },
): Sql {
  return sql`
    select account.number as account_number, activity.period,
      activity.activity
    from (
      select account_id, date.start_of_month(posting_date) as period,
        sum(amount) as activity
      from db.ledger_lines
      where posting_date >= ${opts.from} and posting_date <= ${opts.to}
        and ${bookCondition(block, opts.book)}
      group by account_id, date.start_of_month(posting_date)
    ) activity
    join db.ledger_accounts account on account.id = activity.account_id`;
}

/**
 * Account and month pairs whose ledger activity differs from `expected`
 * (`account_number`, `period`, `activity`). One aggregation over both sides.
 */
export function reconcileQuery(
  block: LedgerBlock,
  opts: { expected: Sql; from: Sql; to: Sql; book?: Sql },
): Sql {
  return sql`
    select account_number, period, sum(ledger) as ledger_activity,
      sum(expected) as expected_activity,
      sum(ledger) - sum(expected) as difference
    from (
      select account_number, period, activity as ledger, 0 as expected
      from (${activityByMonthQuery(block, opts)}) ledger_side
      union all
      select account_number, period, 0, activity
      from (${opts.expected}) expected_side
    ) both_sides
    group by account_number, period
    having sum(ledger) <> sum(expected)`;
}
