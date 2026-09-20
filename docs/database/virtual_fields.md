---
title: Virtual fields, TTL, and ordering
description: Reference for virtual (computed) fields, table TTL configuration, and the Ordering field type.
tags:
  - database
  - virtual-fields
  - ttl
  - ordering
---

# Virtual fields, TTL, and ordering

This page covers three table-shaping features that don't fit into the
plain "type column" mental model: **virtual fields** (computed columns),
**TTL** (automatic row pruning), and the **Ordering** field type
(stable user-controlled ordering).

## Virtual fields

A virtual field is a column whose value is computed by a SQL expression
on read. It is **not** a physical table field and cannot be inserted into. Useful
when several queries need the same derived value and you want to define
it once on the table:

```typescript
db.table("orders", (t) => {
  t.fk("client", "clients").notNull();
  t.money("subtotal").notNull();
  t.money("tax").notNull();
  // shorthand: virtual(name, expr, type?)
  t.virtual(
    "total",
    sql`subtotal + tax`,
  );
});
```

For a complex expression or an explicitly pinned result type, use the object
form:

```typescript
t.virtual({
  name: "is_late",
  expr: sql`due_at < now() and paid_at is null`,
  type: { type: "Bool" },
});
```

The optional `type` lets you pin the result type; without it the
compiler infers from `expr`.

## Time-to-live (TTL)

`TableBuilder.ttl(...)` configures **automatic row pruning** based on a
timestamp column:

```typescript
db.table("sessions", (t) => {
  t.uuid("token").notNull();
  t.timestampUtc("created_at").notNull().default(sql`now()`);
  t.ttl({
    fieldName: "created_at",
    expr: sql`created_at + interval '24 hours'`,
  });
});
```

The shorthand `t.ttlFrom("created_at", sql`...`)` is equivalent.

Rows are eligible for pruning when `expr` evaluates to a timestamp in
the past. Pruning runs in the background; query semantics still treat
the rows as present until they are removed.

## Ordering fields

`t.ordering(name)` adds a field of type `Ordering` — a fractional
indexing scheme designed for stable user-controlled ordering of records.
SQL exposes helpers for inserting "between" two existing values without
renumbering siblings, which makes it well-suited to drag-and-drop list
reordering.

```typescript
db.table("task", (t) => {
  t.string("title", 200).notNull();
  t.ordering("position").notNull();
});
```

Use the SQL `ordering` family of helpers to compute positions:

```sql
-- new row at the end of the list
select ordering.new((select max(position) from db.task));
```

## Related

- [Field types](./field_types.md)
- [Advanced table features](./advanced_table_features.md)
- [Query authoring](../sql/query_planning.md)
