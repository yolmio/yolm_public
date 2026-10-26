import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { HelperProcField } from "std/statements";
import { system } from "std/system";
import type { LedgerAccountType } from "./accounts.ts";
import { AMOUNT_TYPE } from "./currency.ts";
import type { LedgerBlock } from "./index.tsx";

/**
 * Fields of the entries table passed to `importEntries`. `source_record_id`
 * is the document's id in the source system (e.g. a NetSuite internal id) and
 * must be unique within the batch. With books, `book` selects an adjustment
 * book (null for the base book).
 */
export function importEntryFields(block: LedgerBlock): HelperProcField[] {
  return [
    { name: "source_record_id", type: "BigInt" },
    { name: "posting_date", type: "Date" },
    { name: "description", type: { type: "String", maxLength: 500 } },
    { name: "document_number", type: { type: "String", maxLength: 50 } },
    ...(block.books.length
      ? [{ name: "book", type: { type: "Enum", enum: "ledger_book" } }]
      : []) as HelperProcField[],
  ];
}

/**
 * Fields of the lines table passed to `importEntries`: `source_record_id`,
 * `account_id`, `amount`, then the block's optional line columns (`memo`,
 * `currency` and `amount_txn` with multi-currency, `<dimension>_id`).
 */
export function importLineFields(block: LedgerBlock): HelperProcField[] {
  return [
    { name: "source_record_id", type: "BigInt" },
    { name: "account_id", type: "BigInt" },
    { name: "amount", type: AMOUNT_TYPE },
    ...block.lineColumnSpecs.map((spec) => spec.field),
  ];
}

/**
 * Posts a batch of historical entries set-based. Checks match single
 * postings (balance, existing accounts, closing date, one active entry per
 * document) except that inactive accounts and required dimensions are
 * allowed, since migrated history often predates current rules.
 */
export function defineImport(block: LedgerBlock) {
  const books = block.books.length > 0;
  const lineColumns = [
    "account_id",
    ...block.lineColumnSpecs.map((spec) => spec.name),
  ];
  system.storedProcedure({
    name: "ledger_import_entries",
    transaction: "caller",
    inputScalars: [
      {
        name: "p_source",
        type: { type: "Enum", enum: "ledger_source" },
        notNull: true,
      },
    ],
    inputTables: [
      { name: "entries", fields: importEntryFields(block) },
      { name: "lines", fields: importLineFields(block) },
    ],
    outputScalars: [{ name: "entry_count", type: "BigInt" }],
    procedure: (s) => {
      const entries = sql.ref("entries");
      const lines = sql.ref("lines");
      if (block.entities) {
        s.modify(sql`update ${lines} set entity_id = ${block.homeEntitySql}
          where entity_id is null`);
      }
      // Rounded once up front; with consolidation, to each entity's currency.
      s.modify(sql`update ${lines}
        set amount = round(amount, ${block.amountDecimalsSql(lines)})`);
      s.throwErrorIf(
        sql`exists (select 1 from ${entries}
          where source_record_id is null or posting_date is null)`,
        sql.lit`Imported entries need a source_record_id and posting_date`,
      );
      s.throwErrorIf(
        sql`exists (select source_record_id from ${entries}
          group by source_record_id having count(*) > 1)`,
        sql.lit`Imported entries repeat a source_record_id`,
      );
      s.throwErrorIf(
        sql`exists (select 1 from ${lines} line
          where line.amount is null or line.account_id is null
            or not exists (select 1 from ${entries} entry
              where entry.source_record_id = line.source_record_id)
            or not exists (select 1 from db.ledger_accounts account
              where account.id = line.account_id))`,
        sql
          .lit`Imported lines need an amount, an existing account, and an entry`,
      );
      s.defScalar(
        "unbalanced_record_id",
        sql`(select source_record_id from ${lines}
          group by source_record_id
          having sum(amount) <> 0
          limit 1)`,
      );
      s.throwErrorIf(
        sql`unbalanced_record_id is not null`,
        sql`'Imported entry ' || unbalanced_record_id || ' does not balance'`,
      );
      if (block.entities) {
        s.throwErrorIf(
          sql`exists (select source_record_id from ${lines}
            group by source_record_id, entity_id
            having sum(amount) <> 0)`,
          sql.lit`Each entity's lines must balance within an imported entry`,
        );
      }
      if (block.multiCurrency) {
        s.throwErrorIf(
          sql`exists (select 1 from ${lines}
            where (currency is null) <> (amount_txn is null))`,
          sql.lit`A foreign-currency line needs both currency and amount`,
        );
      }
      s.throwErrorIf(
        sql`exists (select 1 from ${entries} entry
          where not exists (select 1 from ${lines} line
            where line.source_record_id = entry.source_record_id
              and line.amount <> 0))`,
        sql.lit`Every imported entry needs at least one non-zero line`,
      );
      // Each line against the close that applies to its entity.
      const closed = block.entities
        ? block.closedThroughSql(sql`line.entity_id`)
        : block.closedThroughSql();
      s.throwErrorIf(
        sql`exists (select 1 from ${lines} line
          join ${entries} entry
            on entry.source_record_id = line.source_record_id
          where entry.posting_date <= ${closed})`,
        sql`'The books are closed through ' || (select format.date(
          max(${closed}), '%m/%d/%Y') from ${lines} line)`,
      );
      s.throwErrorIf(
        sql`exists (select 1 from ${entries} imported
          join db.ledger_entries entry
            on entry.source = p_source
              and entry.source_record_id = imported.source_record_id
          where ${block.isActiveEntrySql(sql`entry`)})`,
        sql.lit`Some imported documents are already posted`,
      );
      s.modify(sql`insert into db.ledger_entries
        (posting_date, source, source_record_id, description, document_number,
          ${books ? sql`book,` : sql``} posted_by)
        select posting_date, p_source, source_record_id, description,
          document_number, ${books ? sql`book,` : sql``} current_user
        from ${entries} order by posting_date, source_record_id`);
      s.setScalar("entry_count", sql`(select count(*) from ${entries})`);
      // The new entries are the only active ones for these documents.
      s.modify(sql`insert into db.ledger_lines
        (entry_id, posting_date, ${books ? sql`book,` : sql``} amount,
          ${lineColumns.map((c) => sql.ref(c))})
        select entry.id, entry.posting_date, ${books ? sql`entry.book,` : sql``}
          line.amount,
          ${lineColumns.map((c) => sql`line.${sql.ref(c)}`)}
        from ${lines} line
        join db.ledger_entries entry
          on entry.source = p_source
            and entry.source_record_id = line.source_record_id
        where line.amount <> 0
          and ${block.isActiveEntrySql(sql`entry`)}`);
    },
  });
}

/**
 * Account types by the source system's type code. `null` marks accounts that
 * do not post to the general ledger (NetSuite non-posting and statistical).
 */
const NETSUITE_ACCOUNT_TYPES: Record<string, LedgerAccountType | null> = {
  Bank: "bank",
  AcctRec: "accounts_receivable",
  UnbilledRec: "other_current_asset",
  OthCurrAsset: "other_current_asset",
  DeferExpense: "other_current_asset",
  FixedAsset: "fixed_asset",
  OthAsset: "other_asset",
  AcctPay: "accounts_payable",
  CredCard: "credit_card",
  OthCurrLiab: "other_current_liability",
  DeferRevenue: "other_current_liability",
  LongTermLiab: "long_term_liability",
  Equity: "equity",
  Income: "income",
  COGS: "cost_of_goods_sold",
  Expense: "expense",
  OthIncome: "other_income",
  OthExpense: "other_expense",
  NonPosting: null,
  Stat: null,
};

/** QuickBooks Online `AccountType` values map one-to-one. */
const QUICKBOOKS_ACCOUNT_TYPES: Record<string, LedgerAccountType> = {
  "Bank": "bank",
  "Accounts Receivable": "accounts_receivable",
  "Other Current Asset": "other_current_asset",
  "Fixed Asset": "fixed_asset",
  "Other Asset": "other_asset",
  "Accounts Payable": "accounts_payable",
  "Credit Card": "credit_card",
  "Other Current Liability": "other_current_liability",
  "Long Term Liability": "long_term_liability",
  "Equity": "equity",
  "Income": "income",
  "Cost of Goods Sold": "cost_of_goods_sold",
  "Expense": "expense",
  "Other Income": "other_income",
  "Other Expense": "other_expense",
};

/**
 * SQL mapping a source system's account type string to `ledger_account_type`
 * (null when the account does not post), for use in import pipelines.
 */
export function accountTypeFromExternalSql(
  system: "netsuite" | "quickbooks",
  typeCode: Sql,
): Sql {
  const map: Record<string, LedgerAccountType | null> = system === "netsuite"
    ? NETSUITE_ACCOUNT_TYPES
    : QUICKBOOKS_ACCOUNT_TYPES;
  return sql.caseWhen({
    conditions: Object.entries(map).map(([code, type]) => ({
      condition: sql`${typeCode} = ${sql.lit(code)}`,
      expr: type
        ? sql`cast(${sql.lit(type)} as enums.ledger_account_type)`
        : sql`cast(null as enums.ledger_account_type)`,
    })),
    default: sql`cast(null as enums.ledger_account_type)`,
  });
}
