---
title: Foreign Keys
description: How to define foreign key relationships, record display names, and relational links between Yolm database tables.
tags:
  - database
  - foreign-keys
  - relationships
---

# Foreign Keys

Foreign key fields are defined using the `fk` method.

## Basic Usage

Pass the referenced table name as the only argument when you want Yolm to
derive the field name. The table name is plural, and the generated field is
`<singular_table_name>_id`:

```tsx
db.table("orders", (table) => {
  table.fk("customers").notNull();  // Creates `customer_id` field
  // ...
});
```

Use that generated field name in SQL:

```tsx
sql`select * from db.orders where customer_id = 1`;
sql`insert into db.orders (customer_id) values (1)`;
```

## Summary

- Table names: plural (e.g., `orders`)
- One-argument FK: `table.fk("customers")` creates `customer_id`
- Two-argument FK: `table.fk("customer", "customers")` creates `customer`
- SQL must use the field name actually created by the schema

## Custom Field Name

Pass two arguments when you want to choose the field name yourself. The first
argument is the exact field name. The second argument is the referenced table.

```tsx
db.table("orders", (table) => {
  table.fk("billing_customer", "customers").notNull();  // Creates field `billing_customer` → customers
  table.fk("shipping_customer", "customers");           // Creates field `shipping_customer` → customers
});
```

Use those exact field names in SQL:

```tsx
sql`
  select *
  from db.orders o
  join db.customers c on o.billing_customer = c.id
`;
```

Do not mix the two forms:

```tsx
db.table("shipments", (table) => {
  table.fk("customer", "customers").notNull(); // Field is `customer`, not `customer_id`
});

// Correct
sql`select * from db.shipments where customer = 1`;

// Wrong: this column was never created
sql`select * from db.shipments where customer_id = 1`;
```

## Self-Referencing

Tables can reference themselves:

```tsx
db.table("employees", (table) => {
  table.string("name", 100).notNull();
  table.fk("manager", "employees");  // Creates field `manager` → employees (self-ref)
});
```

## On Delete Behavior

Foreign keys default to `Cascade`. Override this with `.onDelete(...)` when the
referenced row can be deleted independently:

```tsx
db.table("orders", (table) => {
  table.fk("customer", "customers").notNull().onDelete("Restrict");
  table.fk("sales_rep", "employees").onDelete("SetToNull");
});
```

Supported values:

- `"Cascade"` — deleting the referenced row deletes dependent rows.
- `"Restrict"` — deleting the referenced row is rejected while dependents exist.
- `"SetToNull"` — deleting the referenced row sets this FK field to NULL.

Use `"SetToNull"` only on nullable FK fields.

`onDelete` applies only when deleting the referenced row. Yolm primary keys are
immutable: ordinary `UPDATE` and the update arm of `MERGE` reject assignment to
the primary-key field. Consequently there is no parent-side cascade or restrict
work for UPDATE. Updating a child foreign-key field still validates that the
new referenced row exists.

## Bulk Delete Performance

Keep a bulk parent deletion as one set-oriented SQL statement:

```tsx
sql`delete from db.orders where imported_batch_id = ${batchId}`;
```

Yolm creates private referential-action procedures from the foreign-key schema
before runtime and lazily compiles them. Both static `Modify` statements and
runtime `DynamicModify` statements use those procedures to batch `Restrict`,
`Cascade`, and `SetToNull` work by relationship. Do not replace one bulk delete
with a procedure loop that selects parent IDs and deletes them one at a time;
that multiplies query setup and block preparation by the number of parent rows.
When a populated direct or descendant restriction, or a fallible set-null edge,
requires the historical row failure order, the generated dispatcher detects
that data and uses the row-ordered path for that invocation. An unused
restriction in the schema does not disable batching for successful deletes.

When changing a high-cardinality delete, test the exact static or dynamic entry
point on production-shaped data. Verify the final parent and child rows as well
as CPU and blocks used; a fast request that skipped or changed referential work
is not a valid performance result.

## sys_users Table

When using `AuthBlock`, do not define `sys_users` yourself. Define the
user-type table, then pass it through `userTypes`; `AuthBlock` creates
`sys_users` and adds the foreign key from `sys_users` to the user type
table.

```tsx
// ✅ Correct
db.table("employees", (table) => {
  table.string("name", 100).notNull();
});

system.addBlock(new AuthBlock({
  appAuthTypes: ["otp"],
  permissions: [],
  userTypes: ["employees"], // AuthBlock adds sys_users.employee_id
}));

// ❌ Wrong - never add the reverse FK from a user-type table
db.table("employees", (table) => {
  table.fk("sys_users");  // Don't do this
});
```
