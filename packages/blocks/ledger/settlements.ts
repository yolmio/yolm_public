import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { HelperProcField, IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import { accountTypesSql, EXCHANGE_GAIN_LOSS_ACCOUNT } from "./accounts.ts";
import { AMOUNT_TYPE } from "./currency.ts";
import type { LedgerBlock, LedgerSource } from "./index.tsx";

/** Account types whose lines are tracked as open items. */
export const OPEN_ITEM_ACCOUNT_TYPES = [
  "accounts_receivable",
  "accounts_payable",
] as const;

export function openItemAccountTypesSql(): Sql {
  return accountTypesSql(OPEN_ITEM_ACCOUNT_TYPES);
}

/** A transaction-currency amount field, with multiCurrency only. */
function txnAmountFields(block: LedgerBlock, name: string): HelperProcField[] {
  return block.multiCurrency ? [{ name, type: AMOUNT_TYPE }] : [];
}

const SETTLEMENT_ROW_FIELDS: HelperProcField[] = [
  { name: "debit_line_id", type: "BigInt" },
  { name: "credit_line_id", type: "BigInt" },
  { name: "amount", type: AMOUNT_TYPE },
  { name: "amount_txn", type: AMOUNT_TYPE },
  { name: "settled_on", type: "Date" },
];

/**
 * Settlements match a debit line to a credit line on the same receivable or
 * payable account: "this payment paid that invoice". Rows are append-only; a
 * negative amount unapplies an earlier settlement.
 *
 * With multiCurrency, foreign-currency lines settle by transaction-currency
 * amount (`amount_txn`). Each side's functional share uses its own booking
 * rate; the difference posts as realized exchange gain or loss against the
 * open-item account, and that line is settled too so both documents close.
 */
export function defineSettlements(
  block: LedgerBlock,
  exchangeSource?: LedgerSource,
) {
  system.db.table("ledger_settlements", (table) => {
    table.displayName("Settlements");
    table.fk("debit_line_id", "ledger_lines").notNull().onDelete("Restrict");
    table.fk("credit_line_id", "ledger_lines").notNull().onDelete("Restrict");
    table.money("amount", AMOUNT_TYPE).notNull().check(
      (amount) => sql`${amount} <> 0`,
      () => sql.lit`Settlement amount must be non-zero`,
    );
    table.date("settled_on").notNull();
    // Transaction-currency amount applied; null for functional-currency rows.
    if (block.multiCurrency) table.money("amount_txn", AMOUNT_TYPE);
    table.insertOnly();
    table.skipAutoApi();
  });

  system.storedProcedure({
    name: "ledger_settle",
    transaction: "caller",
    inputScalars: [
      { name: "p_debit_line_id", type: "BigInt" },
      { name: "p_credit_line_id", type: "BigInt" },
      { name: "p_amount", type: AMOUNT_TYPE },
      { name: "p_settled_on", type: "Date" },
      ...txnAmountFields(block, "p_amount_txn"),
    ],
    procedure: (s) => {
      s.throwErrorIf(
        sql`p_settled_on is null`,
        sql.lit`A settlement needs a date`,
      );
      s.defTable("settle_rows", { fields: SETTLEMENT_ROW_FIELDS });
      s.modify(sql`insert into settle_rows
        (debit_line_id, credit_line_id, settled_on)
        values (p_debit_line_id, p_credit_line_id, p_settled_on)`);
      checkSettlementRows(s, block, "settle_rows");
      const settleFunctional = <T extends IServerBaseStatements>(s: T) => {
        s.throwErrorIf(
          sql`p_amount is null or p_amount = 0`,
          sql.lit`A settlement needs a non-zero amount`,
        );
        s.if(
          sql`p_amount > 0`,
          (s) => {
            s.throwErrorIf(
              sql`p_amount > ${openAmountSql(sql`p_debit_line_id`)}
                or p_amount > ${openAmountSql(sql`p_credit_line_id`)}`,
              sql.lit`Settlement exceeds the open amount`,
            );
          },
          (s) => {
            requireUnapplyDate(s);
            s.throwErrorIf(
              sql`-p_amount > coalesce((select sum(amount)
                from db.ledger_settlements
                where debit_line_id = p_debit_line_id
                  and credit_line_id = p_credit_line_id), 0)`,
              sql.lit`Cannot unapply more than was settled`,
            );
          },
        );
        s.modify(sql`insert into db.ledger_settlements
          (debit_line_id, credit_line_id, amount, settled_on)
          values (p_debit_line_id, p_credit_line_id, p_amount, p_settled_on)`);
      };
      if (!exchangeSource) {
        settleFunctional(s);
        return;
      }
      s.defRecord(
        "debit_line",
        sql`select account_id, amount, currency, amount_txn ${
          block.dimensions.length
            ? sql`, ${block.dimensions.map((d) => sql.ref(`${d.key}_id`))}`
            : sql``
        }
        from db.ledger_lines where id = p_debit_line_id`,
      );
      s.defRecord(
        "credit_line",
        sql`select amount, amount_txn ${
          block.dimensions.length
            ? sql`, ${block.dimensions.map((d) => sql.ref(`${d.key}_id`))}`
            : sql``
        }
        from db.ledger_lines where id = p_credit_line_id`,
      );
      s.if(
        sql`debit_line.currency is null`,
        (s) => {
          s.throwErrorIf(
            sql`p_amount_txn is not null`,
            sql.lit`Functional-currency lines settle by amount, not amount_txn`,
          );
          settleFunctional(s);
        },
        (s) => settleForeign(s, block, exchangeSource),
      );
    },
  });
}

/**
 * Checks shared by `ledger_settle` and `ledger_import_settlements` over a
 * table of `debit_line_id`, `credit_line_id`, and `settled_on`: a debit
 * against a credit on the same receivable or payable account, same currency
 * and dimensions, active base-book entries, dated on or after both
 * documents and after the close that applies to them.
 */
function checkSettlementRows<T extends IServerBaseStatements>(
  s: T,
  block: LedgerBlock,
  table: string,
) {
  const rows = sql`${sql.ref(table)} row
    left join db.ledger_lines debit on debit.id = row.debit_line_id
    left join db.ledger_lines credit on credit.id = row.credit_line_id`;
  const check = (condition: Sql, message: string) =>
    s.throwErrorIf(
      sql`exists (select 1 from ${rows} where ${condition})`,
      sql.lit(message),
    );
  check(
    sql`debit.id is null or credit.id is null`,
    "Settlement lines not found",
  );
  const closed = block.entities
    ? block.closedThroughSql(block.lineEntitySql(sql`debit`))
    : block.closedThroughSql();
  s.throwErrorIf(
    sql`exists (select 1 from ${rows} where row.settled_on <= ${closed})`,
    sql`'The books are closed through ' || (select format.date(max(${closed}),
      '%m/%d/%Y') from ${rows})`,
  );
  check(
    sql`debit.amount <= 0 or credit.amount >= 0`,
    "Settle a debit line against a credit line",
  );
  check(
    sql`debit.account_id <> credit.account_id`,
    "Settled lines must be on the same account",
  );
  check(
    sql`(select type from db.ledger_accounts where id = debit.account_id)
      not in ${openItemAccountTypesSql()}`,
    "Only receivable and payable lines can be settled",
  );
  check(
    sql`row.settled_on < debit.posting_date
      or row.settled_on < credit.posting_date`,
    "A settlement cannot be dated before the documents it settles",
  );
  if (block.multiCurrency) {
    check(
      sql`coalesce(debit.currency, '') <> coalesce(credit.currency, '')`,
      "Settled lines must be in the same currency",
    );
  }
  if (block.books.length) {
    check(
      sql`debit.book is not null or credit.book is not null`,
      "Only base-book lines can be settled",
    );
  }
  // A customer's payment only settles that customer's invoices.
  for (const d of block.dimensions) {
    const column = sql.ref(`${d.key}_id`);
    const value = (line: string) =>
      d.key === "entity"
        ? block.lineEntitySql(sql.ref(line))
        : sql`${sql.ref(line)}.${column}`;
    check(
      sql`${value("debit")} is not null and ${value("credit")} is not null
        and ${value("debit")} <> ${value("credit")}`,
      `Settled lines must have the same ${
        (d.label ?? d.key.replaceAll("_", " ")).toLowerCase()
      }`,
    );
  }
  check(
    sql`exists (select 1 from db.ledger_entries entry
      where entry.id in (debit.entry_id, credit.entry_id)
        and not (${block.isActiveEntrySql(sql`entry`)}))`,
    "Reversed entries cannot be settled",
  );
}

/** An unapply cannot predate the settlement it undoes. */
function requireUnapplyDate<T extends IServerBaseStatements>(s: T) {
  s.throwErrorIf(
    sql`p_settled_on < (select max(settled_on) from db.ledger_settlements
      where debit_line_id = p_debit_line_id
        and credit_line_id = p_credit_line_id)`,
    sql.lit`An unapply cannot be dated before the settlement it undoes`,
  );
}

/** Unsettled transaction-currency amount of a foreign-currency line. */
export function openAmountTxnSql(lineId: Sql): Sql {
  return sql`(abs((select amount_txn from db.ledger_lines where id = ${lineId}))
    - coalesce((select sum(amount_txn) from db.ledger_settlements
      where debit_line_id = ${lineId} and amount_txn is not null), 0)
    - coalesce((select sum(amount_txn) from db.ledger_settlements
      where credit_line_id = ${lineId} and amount_txn is not null), 0))`;
}

/**
 * Body of `ledger_settle` for foreign-currency lines. A positive
 * `p_amount_txn` applies that much of both documents; a negative one
 * unapplies everything between the pair and reverses its exchange entries.
 */
function settleForeign<T extends IServerBaseStatements>(
  s: T,
  block: LedgerBlock,
  exchangeSource: LedgerSource,
) {
  s.throwErrorIf(
    sql`p_amount_txn is null or p_amount_txn = 0`,
    sql.lit`Settle foreign-currency lines with a non-zero amount_txn`,
  );
  // Exchange entries post on the open-item account and the gain/loss
  // account, carrying the documents' dimensions.
  const dimensionColumns = block.dimensions.map((d) => {
    const column = sql.ref(`${d.key}_id`);
    return sql`coalesce(debit_line.${column}, credit_line.${column})
      as ${column}`;
  });
  const lineColumns = dimensionColumns.length
    ? sql`, ${dimensionColumns}`
    : sql``;
  const pairRows = sql`from db.ledger_settlements
    where debit_line_id = p_debit_line_id
      and credit_line_id = p_credit_line_id`;
  s.if(
    sql`p_amount_txn > 0`,
    (s) => {
      s.throwErrorIf(
        sql`p_amount_txn > ${openAmountTxnSql(sql`p_debit_line_id`)}
          or p_amount_txn > ${openAmountTxnSql(sql`p_credit_line_id`)}`,
        sql.lit`Settlement exceeds the open amount`,
      );
      // A side's functional share at its booking rate; closing a line takes
      // exactly what is left so no rounding residue stays open.
      const share = (line: string) => {
        const id = sql.ref(`p_${line}_id`);
        return sql`case
          when p_amount_txn = ${openAmountTxnSql(id)}
            then ${openAmountSql(id)}
          else round(abs(${sql.ref(line)}.amount) * p_amount_txn
            / abs(${sql.ref(line)}.amount_txn),
            ${block.amountDecimalsSql(sql`debit_line`)})
          end`;
      };
      s.defScalar("debit_share", {
        type: AMOUNT_TYPE,
        expr: share("debit_line"),
      });
      s.defScalar("credit_share", {
        type: AMOUNT_TYPE,
        expr: share("credit_line"),
      });
      s.throwErrorIf(
        sql`least(debit_share, credit_share) <= 0`,
        sql.lit`Settlement is too small to apply`,
      );
      s.defScalar("settlement_id", { type: "BigInt" });
      s.modify(sql`insert into db.ledger_settlements
        (debit_line_id, credit_line_id, amount, amount_txn, settled_on)
        values (p_debit_line_id, p_credit_line_id,
          least(debit_share, credit_share), p_amount_txn, p_settled_on)
        returning id into settlement_id`);
      // Positive difference: the debit document was booked at more than
      // the credit document pays for it, a loss.
      s.defScalar("difference", sql`debit_share - credit_share`);
      s.if(sql`difference <> 0`, (s) => {
        s.defScalar("exchange_entry_id", { type: "BigInt" });
        exchangeSource.post(s, {
          recordId: sql`settlement_id`,
          date: sql`p_settled_on`,
          description: sql.lit`Realized exchange gain or loss`,
          lines: {
            query: sql`select debit_line.account_id as account_id,
                -difference as amount ${lineColumns}
              union all
              select ${block.account(EXCHANGE_GAIN_LOSS_ACCOUNT.number)},
                difference ${lineColumns}`,
            columns: block.dimensions.map((d) => d.key),
          },
          intoEntryId: "exchange_entry_id",
        });
        s.defScalar(
          "exchange_line_id",
          sql`(select id from db.ledger_lines
            where entry_id = exchange_entry_id
              and account_id = debit_line.account_id)`,
        );
        s.modify(sql`insert into db.ledger_settlements
          (debit_line_id, credit_line_id, amount, settled_on)
          select
            case when difference > 0 then p_debit_line_id
              else exchange_line_id end,
            case when difference > 0 then exchange_line_id
              else p_credit_line_id end,
            abs(difference), p_settled_on`);
      });
    },
    (s) => {
      requireUnapplyDate(s);
      s.throwErrorIf(
        sql`-p_amount_txn <> coalesce((select sum(amount_txn) ${pairRows}), 0)`,
        sql
          .lit`Unapply the full transaction-currency amount settled between these documents`,
      );
      // Unapply each exchange entry's settlement, then reverse the entry.
      s.forEachQuery(
        sql`select entry.id as entry_id, line.id as line_id
          from db.ledger_entries entry
          join db.ledger_lines line on line.entry_id = entry.id
          where entry.source = ${exchangeSource.enumLiteral()}
            and entry.source_record_id in
              (select id ${pairRows} and amount_txn > 0)
            and line.account_id = debit_line.account_id
            and ${block.isActiveEntrySql(sql`entry`)}`,
        "exchange",
        (s) => {
          s.modify(sql`insert into db.ledger_settlements
            (debit_line_id, credit_line_id, amount, settled_on)
            select debit_line_id, credit_line_id, -sum(amount), p_settled_on
            from db.ledger_settlements
            where debit_line_id = exchange.line_id
              or credit_line_id = exchange.line_id
            group by debit_line_id, credit_line_id
            having sum(amount) <> 0`);
          block.reverseEntry(s, {
            entryId: sql`exchange.entry_id`,
            date: sql`p_settled_on`,
          });
        },
      );
      s.modify(sql`insert into db.ledger_settlements
        (debit_line_id, credit_line_id, amount, amount_txn, settled_on)
        select p_debit_line_id, p_credit_line_id, -sum(amount), p_amount_txn,
          p_settled_on
        ${pairRows}`);
    },
  );
}

/** Unsettled amount of a line, always non-negative. */
export function openAmountSql(lineId: Sql): Sql {
  return sql`(abs((select amount from db.ledger_lines where id = ${lineId}))
    - coalesce((select sum(amount) from db.ledger_settlements
      where debit_line_id = ${lineId}), 0)
    - coalesce((select sum(amount) from db.ledger_settlements
      where credit_line_id = ${lineId}), 0))`;
}

/**
 * Open receivable/payable lines with their unsettled amounts. One scan of
 * settlements grouped per line, joined to the open-item lines. With `asOf`,
 * the items open at the end of that date: later postings, settlements, and
 * reversals are ignored.
 */
export function openItemsQuery(block: LedgerBlock, asOf?: Sql): Sql {
  const dimensionColumns = block.dimensions.map((d) =>
    d.key === "entity"
      ? sql`${block.lineEntitySql(sql`line`)} as entity_id`
      : sql`line.${sql.ref(`${d.key}_id`)} as ${sql.ref(`${d.key}_id`)}`
  );
  const settledBy = asOf ? sql`where settled_on <= ${asOf}` : sql``;
  const settledTxn = block.multiCurrency ? sql`, amount_txn` : sql``;
  const appliedTxn = block.multiCurrency
    ? sql`, sum(amount_txn) as amount_txn`
    : sql``;
  const openTxn = sql`abs(line.amount_txn) - coalesce(applied.amount_txn, 0)`;
  const active = block.isActiveEntrySql(sql`entry`, asOf);
  return sql`
    select line.id as line_id, line.entry_id, line.posting_date,
      line.account_id, account.type as account_type, entry.source,
      entry.source_record_id, entry.document_number, line.memo, line.amount,
      coalesce(line.due_date, line.posting_date) as due_date,
      abs(line.amount) - coalesce(applied.amount, 0) as open_amount
      ${
    block.multiCurrency
      ? sql`, line.currency, line.amount_txn, ${openTxn} as open_amount_txn`
      : sql``
  }
      ${dimensionColumns.length ? sql`, ${dimensionColumns}` : sql``}
    from db.ledger_lines line
    join db.ledger_accounts account on account.id = line.account_id
    join db.ledger_entries entry on entry.id = line.entry_id
    left join (
      select line_id, sum(amount) as amount ${appliedTxn} from (
        select debit_line_id as line_id, amount ${settledTxn}
        from db.ledger_settlements ${settledBy}
        union all
        select credit_line_id as line_id, amount ${settledTxn}
        from db.ledger_settlements ${settledBy}
      ) side group by line_id
    ) applied on applied.line_id = line.id
    where account.type in ${openItemAccountTypesSql()}
      ${block.books.length ? sql`and line.book is null` : sql``}
      ${
    block.revaluationSource
      ? sql`and entry.source <> ${block.revaluationSource.enumLiteral()}`
      : sql``
  }
      ${asOf ? sql`and line.posting_date <= ${asOf}` : sql``}
      and ${active}
      and (abs(line.amount) - coalesce(applied.amount, 0) <> 0
        ${block.multiCurrency ? sql`or coalesce(${openTxn}, 0) <> 0` : sql``})`;
}

/**
 * Fields of the table passed to `importSettlements`: which imported document
 * paid which, on an open-item account, identified by source record ids.
 * With multiCurrency, foreign-currency documents also need `amount_txn`.
 */
export function importSettlementFields(block: LedgerBlock): HelperProcField[] {
  return [
    { name: "debit_source_record_id", type: "BigInt" },
    { name: "credit_source_record_id", type: "BigInt" },
    /** Source of the debit document when it differs from the importing source. */
    { name: "debit_source", type: { type: "Enum", enum: "ledger_source" } },
    { name: "credit_source", type: { type: "Enum", enum: "ledger_source" } },
    { name: "account_id", type: "BigInt" },
    { name: "amount", type: AMOUNT_TYPE },
    ...txnAmountFields(block, "amount_txn"),
    { name: "settled_on", type: "Date" },
  ];
}

/**
 * Applies a batch of settlements between imported documents set-based, with
 * the same checks as `settle` plus no over-application in either currency.
 * Amounts must be positive; unapply with `settle` and a negative amount.
 * Imported history carries its own exchange entries, so none are posted.
 */
export function defineSettlementImport(block: LedgerBlock) {
  const txn = block.multiCurrency;
  system.storedProcedure({
    name: "ledger_import_settlements",
    transaction: "caller",
    inputScalars: [
      {
        name: "p_source",
        type: { type: "Enum", enum: "ledger_source" },
        notNull: true,
      },
    ],
    inputTables: [{ name: "items", fields: importSettlementFields(block) }],
    procedure: (s) => {
      const items = sql.ref("items");
      s.throwErrorIf(
        sql`exists (select 1 from ${items}
          where amount is null or amount <= 0 or settled_on is null
            ${txn ? sql`or amount_txn <= 0` : sql``})`,
        sql.lit`Imported settlements need a positive amount and a date`,
      );
      // Each document's first active base-book line per account, resolved
      // with one join over the documents in the batch.
      s.defTable("document_lines", {
        fields: [
          { name: "source", type: { type: "Enum", enum: "ledger_source" } },
          { name: "source_record_id", type: "BigInt" },
          { name: "account_id", type: "BigInt" },
          { name: "line_id", type: "BigInt" },
        ],
      });
      s.modify(sql`insert into document_lines
        select entry.source, entry.source_record_id, line.account_id,
          min(line.id)
        from db.ledger_entries entry
        join db.ledger_lines line on line.entry_id = entry.id
        where entry.source_record_id in (
            select debit_source_record_id from ${items}
            union select credit_source_record_id from ${items})
          ${block.books.length ? sql`and line.book is null` : sql``}
          and ${block.isActiveEntrySql(sql`entry`)}
        group by entry.source, entry.source_record_id, line.account_id`);
      s.defTable("resolved", { fields: SETTLEMENT_ROW_FIELDS });
      s.modify(sql`insert into resolved
        select debit_doc.line_id as debit_line_id,
          credit_doc.line_id as credit_line_id, item.amount,
          ${txn ? sql`item.amount_txn` : sql`cast(null as decimal(18, 4))`},
          item.settled_on
        from ${items} item
        left join document_lines debit_doc
          on debit_doc.source = coalesce(item.debit_source, p_source)
            and debit_doc.source_record_id = item.debit_source_record_id
            and debit_doc.account_id = item.account_id
        left join document_lines credit_doc
          on credit_doc.source = coalesce(item.credit_source, p_source)
            and credit_doc.source_record_id = item.credit_source_record_id
            and credit_doc.account_id = item.account_id`);
      s.throwErrorIf(
        sql`exists (select 1 from resolved
          where debit_line_id is null or credit_line_id is null)`,
        sql
          .lit`Every imported settlement needs posted debit and credit documents on the account`,
      );
      // Items are the source's totals per document pair; import only what
      // the ledger does not already hold, so re-runs are safe.
      s.block((s) => {
        s.defTable("synced", { fields: SETTLEMENT_ROW_FIELDS });
        s.modify(sql`insert into synced
          select item.debit_line_id, item.credit_line_id,
            item.amount - coalesce(existing.amount, 0),
            item.amount_txn - coalesce(existing.amount_txn, 0),
            item.settled_on
          from (select debit_line_id, credit_line_id, sum(amount) as amount,
              sum(amount_txn) as amount_txn, max(settled_on) as settled_on
            from resolved group by debit_line_id, credit_line_id) item
          left join (select debit_line_id, credit_line_id,
              sum(amount) as amount,
              ${
          txn ? sql`sum(amount_txn)` : sql`cast(null as decimal(18, 4))`
        } as amount_txn
              from db.ledger_settlements
              where debit_line_id in (select debit_line_id from resolved)
              group by debit_line_id, credit_line_id) existing
            on existing.debit_line_id = item.debit_line_id
              and existing.credit_line_id = item.credit_line_id`);
        s.throwErrorIf(
          sql`exists (select 1 from synced where amount < 0
            ${txn ? sql`or amount_txn < 0` : sql``})`,
          sql
            .lit`The source unapplied payments already imported; unapply them with settle`,
        );
        if (txn) {
          s.throwErrorIf(
            sql`exists (select 1 from synced where amount_txn is not null
              and (amount > 0) <> (amount_txn > 0))`,
            sql
              .lit`An imported foreign settlement must increase both its amount and amount_txn`,
          );
        }
        s.modify(sql`delete from resolved`);
        s.modify(sql`insert into resolved
          select * from synced where amount > 0
            ${txn ? sql`or amount_txn > 0` : sql``}`);
      });
      checkSettlementRows(s, block, "resolved");
      if (txn) {
        s.throwErrorIf(
          sql`exists (select 1 from resolved row
            join db.ledger_lines debit on debit.id = row.debit_line_id
            where (debit.currency is null) <> (row.amount_txn is null))`,
          sql
            .lit`Foreign-currency settlements need amount_txn; functional ones must not have it`,
        );
      }
      // Existing plus batch applications per line, in one grouped pass.
      const applied = (column: string) =>
        sql`select line_id, sum(${sql.ref(column)}) as applied from (
          select debit_line_id as line_id, ${sql.ref(column)} from resolved
          union all
          select credit_line_id, ${sql.ref(column)} from resolved
          union all
          select debit_line_id, ${sql.ref(column)} from db.ledger_settlements
          where debit_line_id in (select debit_line_id from resolved)
          union all
          select credit_line_id, ${sql.ref(column)} from db.ledger_settlements
          where credit_line_id in (select credit_line_id from resolved)
        ) applications group by line_id`;
      s.throwErrorIf(
        sql`exists (select 1 from (${applied("amount")}) applied
            join db.ledger_lines line on line.id = applied.line_id
            where applied.applied > abs(line.amount))
          ${
          txn
            ? sql`or exists (select 1 from (${applied("amount_txn")}) applied
            join db.ledger_lines line on line.id = applied.line_id
            where applied.applied > abs(line.amount_txn))`
            : sql``
        }`,
        sql.lit`Imported settlements exceed a document's open amount`,
      );
      s.modify(sql`insert into db.ledger_settlements
        (debit_line_id, credit_line_id, amount, ${
        txn ? sql`amount_txn,` : sql``
      } settled_on)
        select debit_line_id, credit_line_id, amount, ${
        txn ? sql`amount_txn,` : sql``
      } settled_on
        from resolved`);
    },
  });
}
