---
title: Database Design Best Practices
description: Guidelines for designing Yolm databases including user tables, attachments, and contact management.
tags:
  - database
  - design
  - best-practices
---

# Database Design Best Practices

## Keep The Durable Model Compact

Every table, field, enum value, and relationship must have a concrete purpose,
reader, and writer. Prefer block-provided schema before adding custom tables,
and derive inexpensive values with queries or virtual fields instead of storing
duplicates.

Yolm is a columnar HTAP engine with fast scans. It does not expose user-defined
secondary indexes, physical partition keys, clustering keys, or sort keys. Do
not add denormalized, cache, or summary tables as speculative row-store
optimization. Start with the clearest minimal relational model and use query
plans when measured performance requires investigation.

## User Type Tables First

When defining the database, start with user type tables:

1. Define user type tables (employees, members, customers, etc.)
2. Add AuthBlock with user type references
3. Define other tables and blocks

```tsx
// 1. User type table
db.table("employees", (table) => {
  table.string("first_name", 50).notNull();
  table.string("last_name", 50).notNull();
  table.email("email").notNull();
});

// 2. AuthBlock
system.addBlock(new AuthBlock({
  appAuthTypes: ["otp"],
  permissions: [],
  userTypes: ["employees"],
}));

// 3. Other tables
db.table("projects", (table) => {
  table.string("name", 200).notNull();
  table.fk("lead", "employees");
});
```

## Handling Files/Attachments

Store files externally and reference them by the blob hash returned by the
upload path. Create attachment tables per entity:

```tsx
db.table("companies", (table) => {
  // ... fields
  table.addBlock(AttachmentsTableBlock);
});
```

This creates a `company_attachments` table. Use
`AttachmentsTableBlock.AttachmentsCard` to display.

## Contacts/Leads/Customers

Keep prospects/leads and clients/customers in the same table with a type enum:

```tsx
system.enum_({
  name: "contact_type",
  values: ["prospect", "lead", "client", "other"],
});

db.table("contacts", (table) => {
  table.string("name", 200).notNull();
  table.enum("type", "contact_type").notNull();
  // ...
});
```

Only separate tables if you have vastly different numbers (many leads, few clients).

## sys_users Table

Required for authentication (usually added via AuthBlock).

- Does NOT include display fields (name, email)
- Display fields go in user type tables (employees, members, customers)
- Username/password CAN go here (handled by AuthBlock)
- Foreign keys go FROM sys_users TO user type tables, never reverse

## Virtual Fields

Use virtual fields for calculated values:

```tsx
db.table("employees", (table) => {
  table.string("first_name", 50).notNull();
  table.string("last_name", 50).notNull();
  table.virtual("full_name", sql`first_name || ' ' || last_name`);
});
```

Virtual fields are computed, not stored.
