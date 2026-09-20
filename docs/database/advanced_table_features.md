---
title: Advanced Table Features
description: Advanced table definition features in Yolm including check constraints, name matching, search configuration, and field renaming.
tags:
  - database
  - tables
  - constraints
  - search
---

# Advanced Table Features

Beyond basic field definitions, Yolm tables support advanced features for data integrity, search, and schema evolution.

## Check Constraints

Check constraints validate data at the database level, ensuring business rules are always enforced.
Use `field.check(...)` for one field or `table.check(...)` when the predicate
depends on multiple fields.

### Single-field Check Constraint

```typescript
db.table("products", (table) => {
  table
    .decimal("price", { precision: 10, scale: 2 })
    .notNull()
    .check(
      (price) => sql`${price} >= 0`,
      () => sql.lit`Price must be non-negative`,
    );
});
```

### Basic Check Constraint

```typescript
db.table("products", (table) => {
  table.decimal("price", { precision: 10, scale: 2 }).notNull();
  table.decimal("sale_price", { precision: 10, scale: 2 });

  table.check({
    fields: ["sale_price", "price"],
    errorMessage: () => sql.lit`Sale price must be less than regular price`,
    check: ([salePrice, price]) =>
      sql`${salePrice} is null or ${salePrice} < ${price}`,
  });
});
```

### Multi-field Validation

```typescript
db.table("contacts", (table) => {
  table.string("first_name", 50);
  table.string("last_name", 50);

  // Require at least one name field
  table.check({
    fields: ["first_name", "last_name"],
    errorMessage: () => sql.lit`Please specify at least a first or last name`,
    check: ([firstName, lastName]) =>
      sql`not (${firstName} is null and ${lastName} is null)`,
  });
});
```

### Conditional Validation

```typescript
db.table("contacts", (table) => {
  table.bool("send_tech_tips").default(false);
  table.email("email");

  // Can't send tech tips without an email
  table.check({
    fields: ["send_tech_tips", "email"],
    errorMessage: () => sql.lit`You can not send tech tips to someone without an email`,
    check: ([sendTechTips, email]) =>
      sql`not ${sendTechTips} or ${email} is not null`,
  });
});
```

### Date Range Validation

```typescript
db.table("events", (table) => {
  table.date("start_date").notNull();
  table.date("end_date").notNull();

  table.check({
    fields: ["start_date", "end_date"],
    errorMessage: () => sql.lit`End date must be after start date`,
    check: ([startDate, endDate]) => sql`${endDate} >= ${startDate}`,
  });
});
```

### Self-reference Prevention

```typescript
system.enum_({
  name: "relation_type",
  values: ["colleague", "manager", "direct_report"],
});

db.table("contact_relations", (table) => {
  table.fk("from", "contacts").notNull();
  table.fk("to", "contacts").notNull();
  table.enum("relation", "relation_type").notNull();
  table.unique(["from", "to"]);

  // Can't relate a contact to themselves
  table.check({
    fields: ["from", "to"],
    errorMessage: () => sql.lit`Cannot add a relation to the same contact`,
    check: ([from, to]) => sql`${from} != ${to}`,
  });
});
```

## createDefaultNameMatch

Registers a default fuzzy search-match configuration for the table's display
name fields. The generated match config is used by Yolm search surfaces such as
the navbar search dialog.

### Basic Usage

```typescript
db.table("contacts", (table) => {
  table.string("first_name", 50);
  table.string("last_name", 50);

  // Registers a "contacts_name" search-match config.
  table.createDefaultNameMatch();
});
```

### How It Works

`createDefaultNameMatch()` automatically:

1. Finds the table's display-name fields, such as `name` or
   `first_name`/`last_name`
2. Registers a search-match config named `<table>_name`
3. Uses the system's default tokenizer and fuzzy-match settings

### When to Use

- Tables with person names (first_name/last_name)
- Tables with company names
- Any table where you want fuzzy search

### Custom Name Fields

If your table has non-standard name fields, use `recordDisplayNameFields()` to
tell the default match which fields to use:

```typescript
db.table("products", (table) => {
  table.string("sku", 50).notNull();
  table.string("name", 200).notNull();

  table.recordDisplayNameFields(["sku", "name"]);
  table.createDefaultNameMatch();
});
```

Use `recordDisplayName()` when you need to customize how the record label is
rendered. Use `recordDisplayNameFields()` when you need to change the fields
that `createDefaultNameMatch()` searches.

## searchConfig

Configure how table records appear in search dialogs and autocomplete.

### Basic Configuration

```typescript
db.table("contacts", (table) => {
  table.string("first_name", 50);
  table.string("last_name", 50);
  table.email("email");

  table.searchConfig({
    // Primary search fields (higher priority)
    fieldGroups: [
      { fields: ["first_name", "last_name"], priority: 1 }
    ],
    // Secondary search fields
    fields: [
      { field: "email", priority: 2 }
    ],
  });
});
```

### In UI

This configuration affects:
- Navbar search
- `TableRecordSelect` component
- Foreign key selection dialogs
- Global search functionality

```tsx
<Navbar
  searchDialog={{
    table: "contacts",
    displayValues: [
      "type",
      "email",
      {
        expr: (record) => sql`date.duration(year, ${record}.date_of_birth, current_date())`,
        name: "age",
        type: { type: "Int" },
      },
    ],
  }}
/>
```

## Unique Constraints

Use `field.unique()` for a single-field unique constraint and `table.unique(...)`
for multi-field or partial unique constraints.

```typescript
db.table("contacts", (table) => {
  table.email("email").unique();
  table.fk("tenant", "tenants").notNull();
  table.string("external_id", 100);
  table.timestampUtc("archived_at");

  table.unique(["tenant", "external_id"]);
  table.unique({
    name: "active_email_per_tenant",
    fields: ["tenant", "email"],
    where: sql`archived_at is null`,
  });
});
```

`distinctNulls` controls whether null values are treated as distinct for a
unique constraint. It can be set for the whole constraint or for an individual
field:

```typescript
table.unique({
  fields: [
    "tenant",
    { field: "external_id", distinctNulls: false },
  ],
});
```

## Field and Table Renaming

When evolving your schema, rename fields while preserving data.

### Basic Rename

```typescript
db.table("deliveries", (table) => {
  table.fk("auditors").notNull().onDelete("Restrict").renameFrom("auditor");
});
```

This:
1. Creates a migration that renames `auditor` to `auditor_id`
2. Preserves all data
3. Updates all foreign key references

### Multiple Renames

```typescript
db.table("contacts", (table) => {
  table
    .fk("calculation_start_id", "calculation_starts")
    .onDelete("SetToNull")
    .renameFrom("calculation_start");
  table.fk("primary_address_id", "addresses").renameFrom("address");
});
```

Use `table.renameFrom("old_table_name")` for table renames:

```typescript
db.table("contacts", (table) => {
  table.renameFrom("people");
  table.string("name", 200).notNull();
});
```

## enumLike for Booleans

Display boolean fields with custom labels:

```typescript
db.table("contacts", (table) => {
  table.bool("is_male").displayName("Gender").enumLike({
    false: "Female",
    true: "Male",
    null: "Unspecified",
  });
});
```

In the UI, this displays as a dropdown with three options instead of a checkbox.

## Legacy Patterns

### Legacy Country Fields

For systems migrating from older schemas with non-standard country codes:

```typescript
db.table("contacts", (table) => {
  table.addBlock(AddressTableBlock, {
    name: "permanent_address",
    prefix: "permanent_",
    legacyCountry: true,  // Allows non-ISO country codes
    createFields: { streetTwo: true },
  });
});
```

## Combined Example

A table can combine field metadata, blocks, foreign keys, constraints, and
search configuration:

```typescript
db.table("contacts", (table) => {
  // Basic fields
  table.enum("type", "contact_type").notNull();
  table.string("first_name", 50);
  table.string("last_name", 50);
  table.bool("send_tech_tips").notNull().default(false);
  table.bool("deadfile").notNull().default(false);
  table.bool("deceased").notNull().default(false);
  table.string("company", 125);
  table.email("email");
  table.email("email_two");
  table.phoneNumberString("work_phone");
  table.phoneNumberString("cell_phone");
  table.phoneNumberString("home_phone");
  table.bool("is_male").displayName("Gender").enumLike({
    false: "Female",
    true: "Male",
    null: "Unspecified",
  });
  table.date("date_of_birth");

  // Address blocks
  table.addBlock(AddressTableBlock, {
    name: "permanent_address",
    prefix: "permanent_",
    legacyCountry: true,
    createFields: { streetTwo: true },
  });

  table.addBlock(AddressTableBlock, {
    name: "local_address",
    prefix: "local_",
    legacyCountry: true,
    createFields: { streetTwo: true },
  });

  // Foreign keys
  table
    .fk("calculation_starts")
    .onDelete("SetToNull")
    .renameFrom("calculation_start");

  table.bool("mailing_list").default(false);
  simpleImageSetFieldGroup(table);
  table.date("next_contact_date");
  table.date("next_arrival_date");

  // Check constraints
  table.check({
    fields: ["first_name", "last_name"],
    errorMessage: () => sql.lit`Please specify at least a first or last name`,
    check: ([firstName, lastName]) =>
      sql`not (${firstName} is null and ${lastName} is null)`,
  });

  table.check({
    fields: ["send_tech_tips", "email"],
    errorMessage: () => sql.lit`You can not send tech tips to someone without an email`,
    check: ([sendTechTips, email]) =>
      sql`not ${sendTechTips} or ${email} is not null`,
  });

  // Search configuration
  table.createDefaultNameMatch();

  table.searchConfig({
    fieldGroups: [
      { fields: ["first_name", "last_name"], priority: 1 }
    ],
    fields: [
      { field: "email", priority: 2 }
    ],
  });

  // Notes block
  table.addBlock(NotesListTableBlock);
});
```

## Best Practices

1. **Use check constraints** for invariants - Rules that must always be true
2. **Keep error messages clear** - Users see these messages
3. **Enable name matching** - For any table with name fields
4. **Configure search** - Helps users find records quickly
5. **Rename, don't delete** - Use `renameFrom()` to preserve data
6. **Document constraints** - Explain why each constraint exists

## Write Considerations

- Check constraints are evaluated on INSERT and UPDATE
- Name matching and search configuration affect generated search surfaces
- Use constraints judiciously - they add overhead to write operations
