---
title: Database Definition Overview
description: How to define tables for Yolm DB, Yolm's own database engine, using TypeScript schema definitions, naming conventions, field types, and best practices.
tags:
  - database
  - tables
  - schema
---

# Database Definition

A Yolm database is defined in TypeScript, not SQL (there is no CREATE TABLE statement).
Yolm DB is Yolm's own database engine, not PostgreSQL and not a layer that
compiles to PostgreSQL. Its SQL dialect is close to PostgreSQL for familiarity,
but schema definition and SQL behavior follow Yolm's documented contracts.

This section documents the Studio-facing schema builder API (`db.table`,
field builders, `db.view`, `db.scalarFunction`, etc.). Lower-level YOM
interfaces may contain fields used by generated packages or internal tooling
that are not exposed as public schema-builder methods.

## Basic Table Definition

```ts
db.table("companies", (table) => {
  table.string("name", 200).notNull().unique();
  table.decimal("annual_revenue", { precision: 15, scale: 2 });
  table.phoneNumber("phone");
});
```

**Important**: Fields are nullable by default. Only specify `notNull()` if required.

## Database Defaults

The database object exposes defaults that apply to table fields unless a field
overrides them:

```ts
db.collation = "NoCase"; // default for string comparison/order
db.autoTrim = "Both";    // default string trimming on writes
db.enableTransactionQueries = true;
```

- `collation` is `"NoCase"` or `"Binary"`.
- `autoTrim` is `"None"`, `"Left"`, `"Right"`, or `"Both"`.
- `enableTransactionQueries` controls whether transaction-log query tables are
  generated. Leave it enabled unless you have a specific reason to remove that
  SQL surface.

## Naming Conventions

- **Tables**: plural, snake_case (e.g., `companies`, `order_items`)
- **Fields**: singular, snake_case (e.g., `company_id`, `first_name`)
- **Foreign keys**: use the actual schema field name. `table.fk("customers")`
  creates `customer_id`; `table.fk("customer", "customers")` creates
  `customer`.

## Automatic Fields

Every table automatically gets:
- `id` - Primary key (auto-generated)

If you need creation or modification timestamps, define them as explicit physical fields:

```ts
db.table("orders", (table) => {
  table.timestampUtc("created_at").notNull().default(sql`now()`);
  table.timestampUtc("last_modified_at").notNull().default(sql`now()`);
});
```

Use `table.primaryKeyFieldName("...")` only when a table must expose a
different primary-key field name. Most tables should keep the default `id`.

## Table Options

`TableBuilder` supports table-level metadata and behavior:

```ts
db.table("events", (table) => {
  table.displayName("Events");
  table.description("Calendar events imported from external systems.");
  table.renameFrom("calendar_events");
  table.skipAutoApi();
  table.autoCompact();

  table.uuid("external_id").notNull().unique();
  table.timestampUtc("created_at").notNull().default(sql`now()`);
});
```

- `displayName(...)` changes generated UI/docs labels.
- `description(...)` surfaces explanatory text to generated docs/tooling.
- `renameFrom(...)` preserves existing table data across a table rename.
- `skipAutoApi()` disables generated API endpoints for that table.
- `autoCompact()` opts high-churn tables into transaction-log compaction.
- `insertOnly()` makes the table append-only: inserts are allowed, updates and
  deletes are rejected.

Do not enable both `autoCompact()` and `insertOnly()` on the same table.

## Views

Use `db.view(name, query, description?)` for read-only named SQL queries. Views
are addressed as `db.<name>` in other SQL.

```ts
db.view(
  "active_contacts",
  sql`
    select id, first_name, last_name, email
    from db.contacts
    where archived_at is null
  `,
  "Contacts that are still active",
);
```

Views are for reads. Write to the underlying tables for inserts, updates, and
deletes.

## recordDisplayName

Configure how records are displayed in UI (search dialogs, comboboxes, etc.):

```ts
db.table("products", (table) => {
  table.string("sku", 50).notNull();
  table.string("name", 200).notNull();
  table.recordDisplayName(["sku", "name"], (sku, name) => sql`${sku} || ' - ' || ${name}`);
});
```

### recordDisplayName with Function

For more complex display logic, use a function that receives field values:

```ts
db.table("servers", (table) => {
  table.enum("region", "server_region").notNull();
  table.uint("server_id").notNull().unique();

  table.recordDisplayName(
    ["region", "server_id"],
    (region, serverId) => sql.concat(region, sql.lit` - `, serverId)
  );
});

// Displays as: "us-miami - 1000002"
```

This pattern is useful when:
- Combining multiple fields with custom formatting
- Need type-safe access to field values
- Building complex display strings with conditionals

### Auto Display Names

Not needed if table has `name`, `first_name`/`last_name` fields (used automatically):

```ts
// Automatically uses 'name' field
db.table("companies", (table) => {
  table.string("name", 200).notNull();
  // No recordDisplayName needed
});

// Automatically uses 'first_name || last_name'
db.table("people", (table) => {
  table.string("first_name", 100).notNull();
  table.string("last_name", 100).notNull();
  // No recordDisplayName needed
});
```
