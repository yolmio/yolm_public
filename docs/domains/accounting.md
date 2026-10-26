---
title: Accounting Domain Model
description: Double-entry accounting with LedgerBlock and LedgerDocumentsBlock, covering accounts, journal, invoices, credit memos, posting, reversal, and derived balances.
tags:
  - domain
  - accounting
  - finance
  - schema
related:
  - domains/overview.md
  - database/money_and_accounting.md
  - blocks/accounting.md
  - sql/transaction_queries.md
  - concepts/stored_procedures.md
---

# Accounting Domain Model

## Purpose

Record money movements as balanced double-entry journal entries against a
chart of accounts, posted from business documents such as invoices, credit
memos, and payments. Balances, totals, and statements are queries over lines.

## Blocks To Use

Use the ledger block family; do not build a custom ledger.

| Block | Import | Use |
| --- | --- | --- |
| `LedgerBlock` | `blocks/ledger` | Always. Chart of accounts, immutable journal, posting sources, reversal, closing date, statements, and UI (`LedgerRoutes`, `ledgerNavItems`). Requires `AuthBlock`. |
| `LedgerDocumentsBlock` | `blocks/ledger_documents` | When the system has no billing documents of its own: invoices, sales receipts, credit memos, bills, vendor credits, payments, deposits, refunds, write-offs, and optional sales tax (`LedgerDocumentsRoutes`). Needs ledger `settlements`. |
| `LedgerPartyTableBlock`, `LedgerItemTableBlock` | `blocks/ledger_documents` | Table blocks that add finance fields to the system's own customer, vendor, and product tables instead of duplicating them. |
| `LedgerBankingBlock` | `blocks/ledger_banking` | Bank and card reconciliation (on by default); `feeds` and `payouts` only when used. |
| `LedgerAssetsBlock` | `blocks/ledger_assets` | Fixed-asset register with depreciation and disposal. |

`AccountingBlock` (`blocks/accounting`) is deprecated and built for a
research-services model (clients, jurisdictions, researchers, orders, cases);
use it only for that model. See [Accounting Block](../blocks/accounting.md).
`examples/ledger` is the full reference system.

Tables `LedgerBlock` always owns:

| Table | Purpose |
| --- | --- |
| `ledger_accounts` | Chart of accounts as rows: `number`, `name`, `type`, `is_active`, `parent_id`. |
| `ledger_entries` | Insert-only entry headers: `posting_date`, `source`, `source_record_id`, `reverses_entry_id`, `posted_by`. |
| `ledger_lines` | Insert-only lines: `account_id`, signed `amount` (positive debit, negative credit), one `<key>_id` per dimension; virtual `debit` and `credit`. |
| `ledger_closings` | Insert-only closing-date history; nothing posts on or before the latest. |

`LedgerDocumentsBlock` owns `ledger_documents` and `ledger_document_lines`
(trade documents and their lines), `ledger_payments` (money movements
without lines), `ledger_payment_terms` and
`ledger_payment_term_installments`, `ledger_document_sequences` (document
numbering), and with `salesTax` `ledger_tax_agencies` and `ledger_tax_rates`.

## Minimal Model

Customers, vendors, and products are the system's own tables. Seed the
starter chart with `ledger.insertChartOfAccounts(s)` in a pipeline or setup
action; amounts use `decimal(18,4)` rounded to the functional currency
(see [Money Types](../database/money_and_accounting.md)).

```typescript
import { AuthBlock } from "blocks/auth";
import { LedgerBlock } from "blocks/ledger";
import {
  LedgerDocumentsBlock,
  LedgerItemTableBlock,
  LedgerPartyTableBlock,
} from "blocks/ledger_documents";
import { sql } from "std/sql_utils";
import { system } from "std/system";

const { db } = system;

db.table("employees", (table) => {
  table.string("first_name", 100).notNull();
  table.string("last_name", 100).notNull();
  table.email("email").notNull().unique();
});

system.addBlock(
  new AuthBlock({
    appAuthTypes: ["otp"],
    permissions: ["manage_books", "view_books"],
    userTypes: ["employees"],
  }),
);

db.table("customers", (table) => {
  table.string("name", 200).notNull();
  table.addBlock(LedgerPartyTableBlock); // default terms, tax exemption
});

db.table("vendors", (table) => {
  table.string("name", 200).notNull();
  table.addBlock(LedgerPartyTableBlock);
});

db.table("products", (table) => {
  table.string("name", 200).notNull().unique();
  table.addBlock(LedgerItemTableBlock); // income and expense accounts
});

export const ledger = new LedgerBlock({
  dimensions: [
    { key: "customer", table: "customers" },
    { key: "vendor", table: "vendors" },
  ],
  settlements: true, // open items: which payment paid which invoice
  permissions: { manage: "manage_books", view: "view_books" },
});

export const documents = new LedgerDocumentsBlock({
  ledger,
  customers: { table: "customers", dimension: "customer" },
  vendors: { table: "vendors", dimension: "vendor" },
  items: { table: "products" },
});

system.addBlock(ledger);
system.addBlock(documents);
```

Documents post with `documents.actions.post(s, id)` and void with
`documents.actions.void(s, id, date?)`. A credit memo is its own document
kind with positive line amounts; the block posts it as the invoice pattern
reversed and `documents.actions.applyCredit(s, { creditId, documentId,
amount, date })` settles it against an invoice. Payments go through
`documents.actions.recordPayment`.

### Facets

Options add tables or nullable columns only when enabled, and enabling one
later is a compatible deploy. Turn on only what a real reader needs:

| Option | Adds |
| --- | --- |
| `dimensions` | A nullable `<key>_id` on `ledger_lines` per analysis axis (customer, project, department). |
| `settlements` | `ledger_settlements` and `ledger_lines.due_date`: open items and aging. |
| `manualJournals` | `ledger_manual_journals` and `ledger_manual_journal_lines`: editable drafts, auto-reversing and recurring journals. |
| `budgets` | `ledger_budgets` and `ledger_budget_lines`. |
| `deferrals` | `ledger_deferrals` and `ledger_deferral_postings`: revenue or expense recognized by month. |
| `multiCurrency` | `ledger_exchange_rates` and `currency` / `amount_txn` on lines. |
| `entities`, `consolidation` | `ledger_entities` (and `ledger_entity_currencies`) for multi-company books. |
| `books` | A nullable `book` on entries and lines for tax or IFRS adjustments. |

`functionalCurrency` and `fiscalYearStartMonth` are one-way choices; set them
before the first posting.

### Posting the system's own documents

A system that already has its own billing document (orders, jobs, usage
charges) skips `LedgerDocumentsBlock` and posts that document through a
registered source. `post` checks balance, active accounts, the closing date,
and that the document has no other active entry, in the caller's
transaction:

```typescript
db.table("orders", (table) => {
  table.fk("customer_id", "customers").notNull();
  table.date("order_date").notNull();
});

db.table("order_lines", (table) => {
  table.fk("order_id", "orders").notNull();
  table.string("description", 200).notNull();
  table.decimal("quantity", { precision: 10, scale: 2 }).notNull();
  table.money("unit_price").notNull();
  table.virtual("amount", sql`quantity * unit_price`);
});

// Register before system.addBlock(ledger).
export const orderSource = ledger.registerSource({
  key: "order",
  displayName: "Order",
});

system.storedProcedure({
  name: "post_order",
  transaction: "caller",
  inputScalars: [{ name: "p_order_id", type: "BigInt", notNull: true }],
  procedure: (s) => {
    s.defRecord("ord", sql`select * from db.orders where id = p_order_id`);
    s.defScalar(
      "order_total",
      sql`(select sum(amount) from db.order_lines where order_id = p_order_id)`,
    );
    // Positive amounts debit, negative amounts credit. A credit order
    // (negative total) posts the same two lines on opposite sides.
    orderSource.post(s, {
      recordId: sql`p_order_id`,
      date: sql`ord.order_date`,
      description: sql`'Order ' || p_order_id::string`,
      lines: [
        {
          account: ledger.account("1200"), // Accounts Receivable
          amount: sql`order_total`,
          dimensions: { customer: sql`ord.customer_id` },
        },
        {
          account: ledger.account("4000"), // Sales
          amount: sql`-order_total`,
          dimensions: { customer: sql`ord.customer_id` },
        },
      ],
    });
  },
});

system.storedProcedure({
  name: "reverse_order",
  transaction: "caller",
  inputScalars: [
    { name: "p_order_id", type: "BigInt", notNull: true },
    { name: "p_date", type: "Date" }, // null reverses on the original date
  ],
  procedure: (s) => {
    orderSource.reverse(s, { recordId: sql`p_order_id`, date: sql`p_date` });
  },
});
```

For a variable number of lines, pass `lines: { query, columns }` where the
query returns `account_id`, signed `amount`, and any listed optional columns.

## Derived Values

Nothing stores a balance or total. Read them from the block's queries:

- `ledger.accountTotalsQuery({ asOf, from? })` — per-account `activity`,
  statement `balance`, and `prior_years`; trial balance and balance sheet.
- `ledger.profitAndLossActivityQuery({ from, to, byMonth? })`,
  `ledger.accountRegisterQuery({ accountId, from, to })`, and
  `ledger.openingBalanceSql(accountId, date)`.
- `ledger.openItemsQuery({ asOf? })` and `ledger.openAmountSql(lineId)` —
  open receivables and payables (with `settlements`).
- `documents.totalSql(id)`, `documents.openBalanceSql(id)`, and
  `documents.statusSql(id)` (`draft`, `posted`, `void`), all derived from
  lines, settlements, and active entries.
- `source.isPosted(recordId)` and `source.activeEntryId(recordId)` for the
  system's own documents.
- `ledger.integrityQuery()` — one row per ledger invariant; every count
  should be zero.

```typescript
import type { Sql } from "std/sql_utils";

const trialBalance = (asOf: Sql) =>
  sql`select totals.number, totals.name, totals.balance
    from (${ledger.accountTotalsQuery({ asOf })}) totals
    order by totals.number`;
```

Filter on `posting_date` ranges rather than wrapping it in functions so the
engine can prune storage blocks. Who posted and when is on
`ledger_entries.posted_by` and `posted_at`; edits to drafts come from
[transaction queries](../sql/transaction_queries.md).

## Safe-Edit State

- **Draft is working state.** Unposted documents, document lines, and manual
  journal drafts are freely editable by users, imports, and agents.
- **Posted is released state.** `ledger_entries`, `ledger_lines`,
  `ledger_settlements`, and `ledger_closings` are insert-only; every write
  goes through a source or block action so balance, account, closing-date,
  and one-active-entry checks run.
- **Corrections are reversals.** `source.reverse` posts negated lines with
  `reverses_entry_id`, so history shows both. To change a posted document,
  reverse it and post again in one transaction; the documents block does
  this when an edited posted document is saved, and voids by reversing on a
  chosen date. Reversal is refused while payments are applied (unapply
  first) and on or before the closing date; for a closed month, reverse on
  the first open day.
- **Status is derived.** Posted, void, and reversed follow from active
  entries and reversal links, not from status columns the system updates.

## Anti-Patterns

- **A custom ledger.** Hand-written journal tables duplicate `LedgerBlock`
  without its posting checks, statements, closing, and UI.
- **Writing `ledger_entries` or `ledger_lines` directly.** Post through a
  registered source or a block action.
- **Stored balances or period totals.** A balance column or monthly summary
  table drifts from the journal; query lines instead.
- **Accounts per customer or as an enum.** Accounts are rows referenced with
  `ledger.account("number")`; slice by customer or project with dimensions.
- **Unsigned debit and credit columns in posting code.** Lines carry one
  signed `amount`; credit notes and refunds post with the opposite sign, or
  use the documents block's credit memo and refund kinds.
- **Enabling every facet.** Each facet adds schema; enable it when a reader
  exists.
- **Deleting a posted source document.** Reverse its entry first; guard
  delete paths with `source.isPosted(recordId)`.
- **Bespoke audit tables.** Entries record who posted them, and transaction
  history records every draft edit.

## References

- `examples/ledger` (`core.tsx`, `tests/ledger.ts`, `tests/documents.ts`) —
  full setup, posting, reversal, settlement, and credit memo tests.
- `packages/blocks/ledger/index.tsx` — `LedgerBlockOptions`,
  `LedgerSource`, and report helpers.
- [Money Types](../database/money_and_accounting.md) — precision,
  signedness, and minor units.
- [Accounting Block](../blocks/accounting.md) — deprecated
  research-services module.
- [Transaction Queries](../sql/transaction_queries.md) — change history and
  point-in-time data.
- [Stored procedures](../concepts/stored_procedures.md) — `transaction:
  "caller"` posting procedures.
