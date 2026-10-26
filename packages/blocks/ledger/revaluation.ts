import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { UNREALIZED_EXCHANGE_ACCOUNT } from "./accounts.ts";
import type { LedgerBlock, LedgerSource } from "./index.tsx";

/** Functional-currency units per unit of `currency` on `date`; 1 for functional. */
function rateOnSql(block: LedgerBlock, currency: Sql, date: Sql): Sql {
  return sql`case when ${currency} = ${sql.lit(block.functionalCurrency)}
    then 1 else ${block.exchangeRateSql(currency, date)} end`;
}

/**
 * Revalues open foreign-currency receivables and payables at `date`'s rate:
 * each item's open transaction amount at the current rate against its open
 * amount at the booking rate. The difference posts against the open-item
 * account and 7950 Unrealized Exchange Gain or Loss, and reverses the next
 * day, so balance sheets at `date` show current values while settlement
 * still realizes against the booking rate. One revaluation per date; runs in
 * the caller's transaction.
 */
export function revalueOpenItems<T extends IServerBaseStatements>(
  s: T,
  block: LedgerBlock,
  source: LedgerSource,
  date: Sql,
) {
  const at = block.uniqueName("revaluation_date");
  const entry = block.uniqueName("revaluation_entry");
  const recordId = sql`cast(format.date(${sql.ref(at)}, '%Y%m%d') as bigint)`;
  s.defScalar(at, { type: "Date", expr: date });
  s.throwErrorIf(
    sql`exists (select 1 from db.ledger_entries
      where source = ${source.enumLiteral()}
        and source_record_id = ${recordId})`,
    sql.lit`Open items are already revalued on this date`,
  );
  const entityCurrency = block.consolidation
    ? sql`coalesce((select currency from db.ledger_entity_currencies
        where entity_id = item.entity_id),
        ${sql.lit(block.functionalCurrency)})`
    : sql.lit(block.functionalCurrency);
  const dims = block.dimensions.map((d) => sql.ref(`${d.key}_id`));
  const dimList = dims.length ? sql`, ${dims}` : sql``;
  // Signed like the line: receivable debits positive, payable credits
  // negative.
  const sign = sql`case when item.amount > 0 then 1 else -1 end`;
  const differences = sql`select item.account_id, round(${sign} * (
        item.open_amount_txn * ${
    rateOnSql(block, sql`item.currency`, sql.ref(at))
  } / ${rateOnSql(block, entityCurrency, sql.ref(at))}
        - item.open_amount), ${block.amountDecimalsSql(sql`item`)}) as amount
      ${dims.length ? sql`, ${dims.map((d) => sql`item.${d}`)}` : sql``}
    from (${block.openItemsQuery({ asOf: sql.ref(at) })}) item
    where item.currency is not null and item.open_amount_txn <> 0`;
  s.throwErrorIf(
    sql`exists (select 1
      from (${block.openItemsQuery({ asOf: sql.ref(at) })}) item
      where item.currency is not null and item.open_amount_txn <> 0
        and (${rateOnSql(block, sql`item.currency`, sql.ref(at))} is null
          or ${rateOnSql(block, entityCurrency, sql.ref(at))} is null))`,
    sql
      .lit`Load exchange rates for every open item's currency on this date first`,
  );
  const entityColumn = block.entities ? sql`entity_id` : sql`null`;
  s.defScalar(entry, { type: "BigInt" });
  s.if(
    sql`exists (select 1 from (${differences}) difference
      where amount <> 0)`,
    (s) => {
      source.post(s, {
        recordId,
        date: sql.ref(at),
        description: sql.lit`Unrealized exchange revaluation`,
        lines: {
          query: sql`select account_id, amount ${dimList}
            from (${differences}) difference where amount <> 0
            union all
            select ${block.account(UNREALIZED_EXCHANGE_ACCOUNT.number)},
              -sum(amount) ${
            dims.length
              ? sql`, ${
                block.dimensions.map((d) =>
                  d.key === "entity"
                    ? sql`${entityColumn}`
                    : sql`cast(null as bigint)`
                )
              }`
              : sql``
          }
            from (${differences}) difference where amount <> 0
            ${block.entities ? sql`group by entity_id` : sql``}`,
          columns: block.dimensions.map((d) => d.key),
        },
        intoEntryId: entry,
      });
      block.reverseEntry(s, {
        entryId: sql.ref(entry),
        date: sql`date.add(day, 1, ${sql.ref(at)})`,
        description: sql.lit`Reversal of unrealized exchange revaluation`,
      });
    },
  );
}
