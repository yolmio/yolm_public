---
title: Money Types and Accounting Patterns
description: Best practices for handling money, financial calculations, and double-entry accounting in Yolm.
tags:
  - database
  - money
  - accounting
  - finance
  - patterns
---

# Money Types and Accounting Patterns

## Money Type

Yolm provides a specialized `money` type for storing currency values with proper precision:

```typescript
db.table("orders", (table) => {
  table.money("total_amount");
  table.money("tax_amount");
  table.money("discount_amount");
});
```

### Money Storage

By default, `table.money("amount")` creates a fixed-point decimal money field
with precision 13 and scale 2. This avoids floating-point precision issues
without requiring you to store cents manually.

If you want explicit integer minor-unit storage, pass an integer backing type:

```typescript
table.money("amount_cents", "BigInt");
```

A bare `table.money("amount")` is signed and can hold negative values (useful
for credits/adjustments). If you pass an explicit `{ precision, scale }` object,
the field defaults to unsigned — add `signed: true` when negatives are needed.

```sql
-- Inserting decimal money values
insert into db.invoices (total) values (15.00);    -- $15.00
```

### Integer Minor-Unit Pattern

When a money field is explicitly backed by an integer type, store values in
minor units such as cents. Be careful when converting from another cents scalar:

```typescript
// In a reactor calculating fees
s.defScalar("rate_amount_billed", sql`3500::bigint`);  // $35.00 in cents

// For integer-backed money fields, insert the cents value directly.
s.modify(sql`
  insert into db.order_expenses (amount_billed)
  values (rate_amount_billed)
`);

// For decimal money fields, convert cents to a decimal dollar amount.
s.modify(sql`
  insert into db.order_expenses (amount_billed)
  values (rate_amount_billed / 100.0)
`);
```

### Rate Calculation Pattern

When storing rates as bigints (cents) and converting to decimal money fields:

```typescript
// Rates stored as bigint (cents)
s.defScalar("rate_amount_incurred", sql`2000::bigint`);  // $20.00
s.defScalar("researcher_payment", sql`1500::bigint`);    // $15.00

// Insert into decimal money fields - divide cents by 100
s.modify(sql`
  insert into db.order_expenses (
    amount_incurred,      -- money type
    amount_paid_researcher  -- money type
  ) values (
    rate_amount_incurred / 100.0,
    researcher_payment / 100.0       -- Explicit division for clarity
  )
`);
```

## Hierarchical Rate Lookups

Real-world pricing often involves hierarchical rate structures (client-specific, jurisdiction-specific, default rates):

```typescript
/**
 * Priority: Client + Jurisdiction + SearchType > Client + Jurisdiction > Client > Default
 */
s.defScalar(
  "applicable_rate",
  sql`
    COALESCE(
      (
        SELECT rate
        FROM db.client_rates cr
        WHERE cr.rate_type = 'search_fee'
          AND (cr.client_id = order.client_id OR cr.client_id IS NULL)
          AND (cr.jurisdiction_id = order.jurisdiction_id OR cr.jurisdiction_id IS NULL)
          AND (cr.search_type = order.search_type OR cr.search_type IS NULL)
          AND current_date BETWEEN cr.effective_from AND COALESCE(cr.effective_to, '2099-12-31'::date)
        ORDER BY
          (CASE WHEN cr.client_id IS NOT NULL THEN 4 ELSE 0 END) +
          (CASE WHEN cr.jurisdiction_id IS NOT NULL THEN 2 ELSE 0 END) +
          (CASE WHEN cr.search_type IS NOT NULL THEN 1 ELSE 0 END) DESC,
          cr.effective_from DESC
        LIMIT 1
      ),
      3500::bigint  -- Default $35 client rate (in cents)
    )
  `,
);
```

### Rate Table Pattern

```typescript
db.table("client_rates", (table) => {
  table.fk("client_id", "clients");  // NULL = applies to all clients
  table.fk("jurisdiction_id", "jurisdictions");  // NULL = all jurisdictions
  table.enum("search_type", "search_type");  // NULL = all search types
  table.enum("rate_type", "rate_type").notNull();

  table.money("amount_billed");  // What we charge the client
  table.money("amount_incurred");  // What it costs us
  table.bool("company_pays").notNull();  // Does company absorb cost?

  table.date("effective_from").notNull();
  table.date("effective_to");  // NULL = no end date
});
```

## Double-Entry Accounting Pattern

Implementing proper accounting with debits and credits:

### Chart of Accounts

```typescript
system.enum_({
  name: "account",
  values: [
    // Assets (debit = increase, credit = decrease)
    "cash",
    "accounts_receivable",
    "unbilled_ar",

    // Liabilities (credit = increase, debit = decrease)
    "accounts_payable",
    "accrued_research",

    // Revenue (credit = increase, debit = decrease)
    "service_revenue",

    // Expenses (debit = increase, credit = decrease)
    "cogs_researcher_fees",
    "cogs_court_fees",
  ],
});

db.table("journal_entries", (table) => {
  table.enum("book", "book").notNull();  // statutory, management, tax
  table.date("entry_date").notNull();
  table.enum("status", "ledger_status").notNull();
  table.enum("account", "account").notNull();
  table.money("amount").notNull();  // Positive = debit, Negative = credit
  table.enum("entry_type", "journal_entry_type").notNull();

  table.fk("period_id", "gl_periods");
  table.fk("order_id", "orders");
  table.fk("client_id", "clients");
  table.fk("researcher_id", "researchers");

  table.string("calculation_note", 500);
});
```

> The bundled accounting block (`packages/blocks/accounting`) instead uses
> double-entry rows with separate `money("debit")` and `money("credit")`
> columns. The single signed-`amount` design above is a simpler alternative;
> use whichever fits the system.

### Revenue Recognition

```typescript
// When order completes, recognize revenue
s.modify(sql`
  INSERT INTO db.journal_entries (
    book, entry_date, status, account, amount,
    entry_type, period_id, order_id, client_id, calculation_note
  ) VALUES (
    'statutory'::enums.book,
    current_date,
    'posted'::enums.ledger_status,
    'unbilled_ar'::enums.account,
    expense.amount_billed,  -- Positive = DEBIT (asset increases)
    'revenue'::enums.journal_entry_type,
    period_id,
    order.id,
    order.client_id,
    'Revenue recognition for order ' || order.reference
  )
`);

// Contra entry - credit revenue
s.modify(sql`
  INSERT INTO db.journal_entries (
    book, entry_date, status, account, amount,
    entry_type, period_id, order_id, client_id, calculation_note
  ) VALUES (
    'statutory'::enums.book,
    current_date,
    'posted'::enums.ledger_status,
    'service_revenue'::enums.account,
    -expense.amount_billed,  -- Negative = CREDIT (revenue increases)
    'revenue'::enums.journal_entry_type,
    period_id,
    order.id,
    order.client_id,
    'Service revenue for ' || order.reference
  )
`);
```

### Invoice Reclassification

```typescript
// When invoice is generated, reclassify unbilled_ar to accounts_receivable
s.modify(sql`
  INSERT INTO db.journal_entries (
    book, entry_date, status, account, amount,
    entry_type, period_id, ar_invoice_id, client_id, calculation_note
  ) VALUES (
    'statutory'::enums.book,
    current_date,
    'posted'::enums.ledger_status,
    'accounts_receivable'::enums.account,
    invoice_total,  -- DEBIT
    'revenue'::enums.journal_entry_type,
    period_id,
    invoice_id,
    client_id,
    'Invoice reclassification - unbilled to billed AR'
  )
`);

s.modify(sql`
  INSERT INTO db.journal_entries (
    book, entry_date, status, account, amount,
    entry_type, period_id, ar_invoice_id, client_id, calculation_note
  ) VALUES (
    'statutory'::enums.book,
    current_date,
    'posted'::enums.ledger_status,
    'unbilled_ar'::enums.account,
    -invoice_total,  -- CREDIT (reduce unbilled)
    'revenue'::enums.journal_entry_type,
    period_id,
    invoice_id,
    client_id,
    'Invoice reclassification - unbilled to billed AR'
  )
`);
```

### Expense Recognition

```typescript
// Record researcher expense
s.modify(sql`
  INSERT INTO db.journal_entries (
    book, entry_date, status, account, amount,
    entry_type, period_id, order_id, researcher_id, calculation_note
  ) VALUES (
    'statutory'::enums.book,
    current_date,
    'posted'::enums.ledger_status,
    'cogs_researcher_fees'::enums.account,
    expense.amount_paid_researcher,  -- DEBIT (expense increases)
    'expense'::enums.journal_entry_type,
    period_id,
    order.id,
    researcher_id,
    'Researcher cost for order ' || order.reference
  )
`);

// Create liability
s.modify(sql`
  INSERT INTO db.journal_entries (
    book, entry_date, status, account, amount,
    entry_type, period_id, order_id, researcher_id, calculation_note
  ) VALUES (
    'statutory'::enums.book,
    current_date,
    'posted'::enums.ledger_status,
    'accrued_research'::enums.account,
    -expense.amount_paid_researcher,  -- CREDIT (liability increases)
    'expense'::enums.journal_entry_type,
    period_id,
    order.id,
    researcher_id,
    'Accrued researcher payment for ' || order.reference
  )
`);
```

## Financial Reporting Queries

### Trial Balance

```sql
select
  account,
  sum(amount) as balance
from db.journal_entries
where period_id = current_period_id
  and status = 'posted'::enums.ledger_status
group by account
order by account
```

### Income Statement

```sql
select
  'Revenue' as category,
  sum(case when account = 'service_revenue'::enums.account then -amount else 0 end) as amount
from db.journal_entries
where period_id = current_period_id
  and status = 'posted'::enums.ledger_status

union all

select
  'Cost of Goods Sold' as category,
  sum(case
    when account in ('cogs_researcher_fees'::enums.account, 'cogs_court_fees'::enums.account)
    then amount
    else 0
  end) as amount
from db.journal_entries
where period_id = current_period_id
  and status = 'posted'::enums.ledger_status
```

## Best Practices

1. **Use money type for currency** - Avoids floating-point precision issues
2. **Store rates as bigints (cents) only when needed** - Explicit minor-unit storage can be useful, but convert deliberately when writing decimal money fields
3. **Always use transactions** - Ensure debits = credits atomically
4. **Validate entries sum to zero** - Implement checks in application logic
5. **Use effective dates for rates** - Support historical accuracy and future changes
6. **Track periods** - Associate entries with accounting periods for closing
7. **Separate books** - statutory, management, tax may have different rules
8. **Add calculation notes** - Audit trail for how amounts were calculated

## Common Pitfalls

1. **Mixing cents and decimal money** - Convert bigint cents to decimal amounts before writing decimal money fields
2. **Mixing types** - Be explicit about bigint vs money vs double
3. **Forgetting contra entries** - Every debit needs a credit
4. **Rate priority bugs** - Test hierarchical lookups thoroughly
5. **Missing effective date checks** - Rates should be time-bounded
