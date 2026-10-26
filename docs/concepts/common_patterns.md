---
title: Common Patterns
description: Compact Yolm patterns for status fields, child records and totals, change history, external IDs, inbound payloads, and alternate names without over-modeling.
tags:
  - concepts
  - patterns
  - best-practices
  - schema
related:
  - domains/overview.md
  - database/best_practices.md
  - sql/transaction_queries.md
  - concepts/pipelines.md
  - api/external_interfaces.md
---

# Common Patterns

Reusable shapes that keep the durable model small. Every table, field, and
enum value should have a concrete reader and writer; derive everything else.
For whole-domain models, see [Domain Modeling Guides](../domains/overview.md).

## Status: Enum or Timestamp, Not Both

Give each independent lifecycle one enum. Record a one-shot fact that has no
lifecycle of its own as a nullable timestamp. Do not pair an enum with
booleans that restate its values, or each boolean with a matching `_at`
timestamp: these copies disagree as soon as one writer forgets one of them.

```typescript
system.enum_({
  name: "order_status",
  values: ["draft", "submitted", "fulfilled", "cancelled"],
});

db.table("orders", (t) => {
  t.fk("customer_id", "customers").notNull();
  t.string("reference", 50).notNull().unique();
  t.enum("status", "order_status").notNull().default(sql.lit`draft`);
  t.timestampUtc("acknowledged_at"); // one-shot fact with no lifecycle of its own
});
```

When a step produces rows (an invoice, a shipment, fee lines), "done" is the
existence of those rows, not a flag. A reactor keyed on the missing output is
idempotent without extra state:

```typescript
system.addReactor({
  name: "create_shipments",
  query: sql`
    select o.id
    from db.orders o
    where o.status = 'submitted'
      and not exists (select 1 from db.shipments sh where sh.order_id = o.id)
  `,
  recordName: "pending_order",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`insert into db.shipments (order_id) values (pending_order.id)`);
    s.commitTransaction();
  },
});
```

When and by whom a status changed comes from transaction history, so the
lifecycle needs no `_at` or `_by` column per state.

## Change History Without Log Tables

Do not add activity-log, audit, or status-history tables to record who
changed what and when. [Transaction queries](../sql/transaction_queries.md)
(`db.enableTransactionQueries`, on by default) expose every write:

```sql
select tx_id, tx_timestamp, tx_creator, orders__status
from db.orders__versions
where record_id = p_order_id and orders__status__set
order by tx_id
```

Keep a separate table only for events that are business data in their own
right and are not row changes, such as notes people write or delivery receipts
received from a partner.

## Child Records and Derived Totals

Model variable-length detail as a child table with a foreign key to its
parent. Compute line amounts with a virtual field and totals with a query or
view; never store a total on the parent.

```typescript
db.table("order_lines", (t) => {
  t.fk("order_id", "orders").notNull();
  t.string("description", 200).notNull();
  t.decimal("quantity", { precision: 10, scale: 2 }).notNull();
  t.money("unit_price").notNull();
  t.virtual("amount", sql`quantity * unit_price`);
});

db.view(
  "order_totals",
  sql`
    select o.id as order_id, count(l.id) as line_count,
      coalesce(sum(l.amount), 0) as total
    from db.orders o
    left join db.order_lines l on l.order_id = o.id
    group by o.id
  `,
);
```

Do not copy parent foreign keys (such as `customer_id`) onto children; join
through the parent.

## External IDs

Map partner identifiers to internal records with one table keyed by
integration. A unique constraint on the external key makes inbound lookups
unambiguous and lets one internal record carry several external IDs:

```typescript
system.enum_({ name: "integration", values: ["storefront", "erp"] });

db.table("external_ids", (t) => {
  t.fk("customer_id", "customers").notNull();
  t.enum("integration").notNull();
  t.string("external_id", 100).notNull();
  t.unique(["integration", "external_id"]);
});
```

Keep credentials in encrypted server-side static secrets, not in mapping rows.
Translate a fixed
set of partner codes with an enum and a
[rules function](decision_tables.md); use a mapping table only when users
maintain the codes at runtime.

## Inbound Payloads

Write inbound data straight into the target tables. Parse a request inside
its procedure, holding intermediate rows in procedure tables (`s.defTable`),
then insert in one transaction:

```sql
select
  cast(l.value->>'description' as string) as description,
  cast(l.value->>'quantity' as decimal(10, 2)) as quantity,
  cast(l.value->>'unitPrice' as decimal(13, 2)) as unit_price
from json.array_each(p_body->'lines') l
```

For bulk files, import into a source database and load with a
[pipeline](pipelines.md) rather than a persistent staging table that mirrors
the target.

When processing must be asynchronous or replayable (see
[External Interfaces](../api/external_interfaces.md#audit-and-replay)), keep
one inbox row per request: the raw payload, the partner request ID for
idempotency, and a status. Do not copy the target table's columns into it.
Delete processed rows on a schedule; a table TTL would also expire `received`
and `failed` rows whose payloads are still needed for replay:

```typescript
system.enum_({ name: "inbox_status", values: ["received", "processed", "failed"] });

db.table("partner_inbox", (t) => {
  t.enum("integration").notNull();
  t.string("request_id", 100).notNull();
  t.json("payload").notNull();
  t.enum("status", "inbox_status").notNull().default(sql.lit`received`);
  t.timestampUtc("received_at").notNull().default(sql`now()`);
  t.unique(["integration", "request_id"]);
});

system.scheduledProc({
  name: "purge_processed_partner_inbox",
  schedule: "0 0 3 * * *",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      delete from db.partner_inbox
      where status = 'processed'
        and received_at < date.add(day, -90, now())
    `);
    s.commitTransaction();
  },
});
```

## Effective-Dated Values

Prices and rates that change over time are rows with `effective_from` and
`effective_to`, looked up by date. See
[Effective-Dated Rates](../database/money_and_accounting.md#effective-dated-rates).

## Alternate Names

Store alternate names for a person or organization in a child table and
search both:

```typescript
db.table("person_aliases", (t) => {
  t.fk("person_id", "people").notNull();
  t.string("first_name", 50).notNull();
  t.string("last_name", 50).notNull();
});
```

```sql
select p.id, p.first_name, p.last_name
from db.people p
where (p.last_name = p_last and p.first_name = p_first)
  or exists (
    select 1 from db.person_aliases a
    where a.person_id = p.id
      and a.last_name = p_last and a.first_name = p_first
  )
```

## Anti-Patterns

- Booleans or `_at` timestamps that restate an enum's values.
- Activity, audit, or "which job processed this" tracking tables; use
  transaction history, reactor queries keyed on missing output, and runtime
  logs.
- Persistent staging tables that duplicate a target table, or raw payloads
  kept indefinitely "for debugging".
- Stored totals, counts, or balances on a parent row.
- Foreign keys copied onto rows that can reach the same record through a
  join.
