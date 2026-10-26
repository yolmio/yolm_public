import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import {
  EXCHANGE_GAIN_LOSS_ACCOUNT,
  TRANSLATION_ADJUSTMENT_ACCOUNT,
} from "./accounts.ts";
import type { LedgerBlock } from "./index.tsx";

/**
 * Invariants the posting procedures maintain. Every row should report zero
 * issues; a non-zero count means something wrote to the ledger tables
 * without going through a source.
 */
export function integrityQuery(block: LedgerBlock): Sql {
  const checks: [string, Sql][] = [
    [
      "Entries that do not balance",
      sql`select count(*) from (select entry_id from db.ledger_lines
        group by entry_id having sum(amount) <> 0) unbalanced`,
    ],
    ...(block.entities
      ? [[
        "Entries whose entities do not balance",
        sql`select count(*) from (select entry_id from db.ledger_lines line
          cross join (select ${block.homeEntitySql} as id) home
          group by entry_id, coalesce(line.entity_id, home.id)
          having sum(amount) <> 0) unbalanced`,
      ] as [string, Sql]]
      : []),
    ...(block.books.length
      ? [[
        "Lines in a different book from their entry",
        sql`select count(*) from db.ledger_lines line
          join db.ledger_entries entry on entry.id = line.entry_id
          where coalesce(cast(line.book as string), '')
            <> coalesce(cast(entry.book as string), '')`,
      ] as [string, Sql]]
      : []),
    [
      "Entries without lines",
      sql`select count(*) from db.ledger_entries entry
        where not exists (select 1 from db.ledger_lines line
          where line.entry_id = entry.id)`,
    ],
    [
      "Lines dated differently from their entry",
      sql`select count(*) from db.ledger_lines line
        join db.ledger_entries entry on entry.id = line.entry_id
        where line.posting_date <> entry.posting_date`,
    ],
    [
      "Entries reversed more than once or reversals reversed",
      sql`select count(*) from (select reversal.reverses_entry_id
        from db.ledger_entries reversal
        join db.ledger_entries original
          on original.id = reversal.reverses_entry_id
        where reversal.reverses_entry_id is not null
        group by reversal.reverses_entry_id, original.reverses_entry_id
        having count(*) > 1 or original.reverses_entry_id is not null) bad`,
    ],
    [
      "Documents with more than one active entry",
      sql`select count(*) from (select source, source_record_id
        from db.ledger_entries entry
        where entry.source_record_id is not null
          and ${block.isActiveEntrySql(sql`entry`)}
        group by source, source_record_id having count(*) > 1) duplicates`,
    ],
  ];
  // Postings the ledger makes to configured account numbers must land on
  // the right kind of account; a missing account fails the posting itself.
  const wrongAccount = (
    label: string,
    source: string,
    numbers: string[],
    classes: string[],
  ): [string, Sql] => [
    label,
    sql`select count(*) from db.ledger_lines line
      join db.ledger_entries entry on entry.id = line.entry_id
      join db.ledger_accounts account on account.id = line.account_id
      where entry.source = cast(${sql.lit(source)} as enums.ledger_source)
        and account.number in (${numbers.map((n) => sql.lit(n))})
        and account.account_class not in (${classes.map((c) => sql.lit(c))})`,
  ];
  if (block.multiCurrency) {
    checks.push([
      "Lines with only one of currency and amount_txn",
      sql`select count(*) from db.ledger_lines
        where (currency is null) <> (amount_txn is null)`,
    ]);
  }
  if (block.consolidation) {
    const entityCurrency = sql`(select currency
      from db.ledger_entity_currencies currency_row
      where currency_row.entity_id = ${block.lineEntitySql(sql`line`)})`;
    checks.push(
      [
        "Months with foreign-entity activity but no exchange rate in force",
        sql`select count(*) from (
          select distinct ${entityCurrency} as currency,
            date.start_of_month(line.posting_date) as period
          from db.ledger_lines line
          where ${entityCurrency} <> ${sql.lit(block.functionalCurrency)}
        ) needed
        where not exists (select 1 from db.ledger_exchange_rates rate
          where rate.currency = needed.currency
            and rate.rate_date < date.add(month, 1, needed.period))`,
      ],
      [
        "Translation adjustment account 3800 missing or not equity",
        sql`select case when not exists (
            select 1 from db.ledger_entity_currencies)
          or exists (select 1 from db.ledger_accounts
            where number = ${
          sql.lit(TRANSLATION_ADJUSTMENT_ACCOUNT.number)
        } and account_class = 'equity')
          then 0 else 1 end`,
      ],
    );
  }
  if (block.settlements) {
    const overApplied = (column: string) =>
      sql`select count(*) from (
        select side.line_id from (
          select debit_line_id as line_id, ${sql.ref(column)} as applied
          from db.ledger_settlements
          union all
          select credit_line_id, ${sql.ref(column)}
          from db.ledger_settlements
        ) side
        join db.ledger_lines line on line.id = side.line_id
        group by side.line_id, line.${sql.ref(column)}
        having sum(side.applied) > abs(line.${sql.ref(column)})
          or sum(side.applied) < 0
      ) over_applied`;
    checks.push(["Lines settled beyond their amount", overApplied("amount")]);
    if (block.multiCurrency) {
      checks.push(
        [
          "Foreign lines settled beyond their transaction amount",
          overApplied("amount_txn"),
        ],
        [
          "Foreign lines closed in one currency but open in the other",
          sql`select count(*) from (${block.openItemsQuery()}) item
            where item.currency is not null
              and (item.open_amount = 0) <> (item.open_amount_txn = 0)`,
        ],
        wrongAccount(
          "Exchange gains and losses on an account that is not income or expense",
          "realized_exchange",
          [EXCHANGE_GAIN_LOSS_ACCOUNT.number],
          ["income", "expense"],
        ),
      );
    }
  }
  checks.push(...block.extensionIntegrityChecks);
  return sql.unionAll(
    ...checks.map(([label, count]) =>
      sql`select ${sql.lit(label)} as check_name, (${count}) as issue_count`
    ),
  );
}
