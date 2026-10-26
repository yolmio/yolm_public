---
title: Money and Decimal Types
description: Reference for table.money and table.decimal fields, precision, scale, signed vs unsigned defaults, integer cents, rounding, and effective-dated rate lookups.
tags:
  - database
  - money
  - decimal
  - finance
related:
  - database/field_types.md
  - domains/accounting.md
  - database/advanced_table_features.md
---

# Money and Decimal Types

This page is the type reference for currency amounts. For modeling a ledger,
invoices, and payments, see [Accounting Domain Model](../domains/accounting.md).

## Money Type

`table.money(name)` stores a currency amount as a fixed-point decimal, which
avoids floating-point rounding errors:

```typescript
db.table("payments", (table) => {
  table.money("amount").notNull();
  table.money("fee_amount");
});
```

Money values are written as decimal literals:

```sql
insert into db.payments (amount) values (15.00);  -- $15.00
```

## Precision, Scale, and Sign

The signed default differs between `money` and `decimal` when you pass
explicit options:

| Declaration | Storage | Negative values |
| --- | --- | --- |
| `table.money("amount")` | decimal(13, 2) | allowed (signed) |
| `table.money("amount", { precision: 13, scale: 2 })` | decimal(13, 2) | **rejected** (unsigned) |
| `table.money("amount", { precision: 13, scale: 2, signed: true })` | decimal(13, 2) | allowed |
| `table.decimal("rate", { precision: 9, scale: 4 })` | decimal(9, 4) | allowed (signed) |
| `table.decimal("rate", { precision: 9, scale: 4, signed: false })` | decimal(9, 4) | rejected |
| `table.money("amount_cents", "BigInt")` | bigint minor units | allowed |
| `table.money("amount_cents", "BigUint")` | unsigned bigint minor units | rejected |

Use the bare `money` form for amounts that can be negative, such as
adjustments, credits, and refunds. Use explicit precision without `signed`
when negatives are invalid, for example debit and credit columns; the type
then enforces non-negativity without a check constraint. Add `signed: true`
whenever you pass `{ precision, scale }` for an amount that may go negative.

## Integer Minor Units

Pass an integer type to store whole minor units (such as cents) instead of a
decimal. Convert deliberately when moving between the two representations:

```typescript
db.table("ledger_amounts", (t) => {
  t.money("amount_cents", "BigInt");
  t.money("price");
});
```

```sql
-- decimal money -> integer cents
round(rate_amount * 100)::bigint
-- integer cents -> decimal money
3500 / 100.0  -- 35.00
```

Prefer the decimal default unless an external system exchanges integer minor
units. Mixing the two in one calculation without converting is the most
common money bug.

## Rounding

Multiplying money by a quantity, rate, or percentage can produce more decimal
places than the field stores. Round explicitly with `round(value, 2)` at the
point where a calculated amount becomes a stored amount, and compute totals
from stored line amounts so they match what customers see.

## Effective-Dated Rates

Prices and rates that change over time are rows with an effective date range,
not updates to a single value. Nullable scope columns let one table hold
defaults and overrides:

```typescript
db.table("customer_rates", (t) => {
  t.fk("customer_id", "customers"); // null = applies to every customer
  t.enum("service_type"); // null = applies to every service type
  t.money("amount").notNull();
  t.date("effective_from").notNull();
  t.date("effective_to"); // exclusive; null = open-ended
  t.check({
    fields: ["effective_from", "effective_to"],
    errorMessage: () => sql.lit`effective_to must be after effective_from`,
    check: ([from, to]) => sql`${to} is null or ${from} < ${to}`,
  });
});
```

Look up the most specific rate in effect on a date. The specificity score
prefers a customer-specific rate over a service-specific one, and either over
the default:

```typescript
s.defScalar(
  "rate_amount",
  sql`(
    select amount
    from db.customer_rates
    where (customer_id = p_customer_id or customer_id is null)
      and (service_type = p_service_type or service_type is null)
      and effective_from <= p_on_date
      and (effective_to is null or p_on_date < effective_to)
    order by
      case when customer_id is null then 0 else 2 end
        + case when service_type is null then 0 else 1 end desc,
      effective_from desc
    limit 1
  )`,
);
```

Pass the order or service date as `p_on_date` to price historical work with
the rate that applied then. A null result means no rate matched; handle it
explicitly rather than falling back to a hard-coded amount.

## Pitfalls

- **Floating-point amounts.** Never store currency in `real` or `double`
  fields.
- **Unsigned by accident.** `money` with explicit `{ precision, scale }` is
  unsigned; refunds and adjustments then fail to insert.
- **Cents and decimals mixed.** Convert integer minor units before writing a
  decimal money field, and the reverse.
- **Stored totals.** Derive totals and balances from line rows with queries
  or views instead of storing them; see
  [Accounting Domain Model](../domains/accounting.md#derived-values).
- **Open-ended overlaps.** Two rates with the same scope and overlapping
  dates make the lookup ambiguous; end the old rate when adding a new one.
