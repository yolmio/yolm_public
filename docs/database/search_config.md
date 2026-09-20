---
title: Search Configuration
description: How to configure full-text search on Yolm database tables, including when configuration is required, field priorities, and field groups.
tags:
  - database
  - search
  - full-text-search
  - configuration
---

# Search Configuration

Yolm's database supports integrated full-text search accessible via SQL. Enable search on a table by defining a search configuration.

## When Search Configuration is Required

Search configuration is required when a search-driven component needs ranked
search for a table and the table does not receive an automatically generated
configuration. In particular:

1. When a table is directly searched (via search dialogs, comboboxes, etc.) and doesn't use auto display/search fields
2. When a foreign-key control or other search-driven component needs to search
   a referenced table without a usable display/search configuration

### Auto Display/Search Fields

Tables with these fields automatically get record display names and a
matching search configuration:
- `first_name` and `last_name`
- `name`
- `title`

### Foreign Key Requirements

When a search-driven foreign-key control targets Table B, Table B must either:
- Have auto display/search fields, OR
- Have an explicit search configuration

An ordinary foreign key alone does not require search configuration. Components
such as record selects and searchable grids do require a record display name
and search configuration when they use ranked lookup; configure those on the
referenced table or use a component/query path that does not perform ranked
search.

## Basic Configuration

```typescript
db.table("products", (table) => {
  table.string("name", 200).notNull();
  table.string("description", 1000);
  table.string("sku", 50);

  table.searchConfig({
    fields: [
      { field: "name", priority: 1 },
      { field: "description", priority: 2 },
      { field: "sku", priority: 1 }
    ],
  });
});
```

`table.searchConfig(...)` accepts:

- `fields`: individual fields with `{ field, priority }`.
- `fieldGroups`: groups of fields with `{ fields, priority }`.
- `filterExpr`: SQL predicate that filters rows before searching.
- `disabled`: SQL expression that disables this table's search when true.
- `relatedTables`: linked search configs for related records; each related
  table must include `relationField`.

Search tokenization is controlled by a tokenizer:

```typescript
tokenizer: {
  splitter: { type: "Alphanumeric" },
  filters: [{ type: "AsciiFold" }, { type: "Lowercase" }],
}
```

Supported splitters are `"None"`, `"Alphanumeric"`, and `"Whitespace"`.
Supported filters are `"Lowercase"`, `"AsciiFold"`, and
`{ type: "RemoveLong", len: number }`.

## Field Priority

Lower priority numbers are more important in search ranking:
- **Priority 1**: Most important (names, titles, identifiers)
- **Priority 2**: Important (descriptions, notes)
- **Priority 3+**: Less important

## Field Groups

Group related fields together to search them as a unit:

```typescript
db.table("contact", (table) => {
  table.string("first_name", 50).notNull();
  table.string("last_name", 50).notNull();
  table.email("email").notNull();

  table.searchConfig({
    fieldGroups: [
      { fields: ["first_name", "last_name"], priority: 1 }
    ],
    fields: [
      { field: "email", priority: 2 }
    ]
  });
});
```

Grouping `first_name` and `last_name` allows finding a contact by:
- Just first name
- Just last name
- First name followed by last name
- Last name followed by first name

When `fields` and `fieldGroups` are both provided, search includes both sets.
Priority ordering is applied across the combined list.

Without grouping, you can only match individual fields separately.

## Record Display Name

For tables without standard display fields (`name`, `title`, `first_name`/`last_name`), configure how records are displayed:

```typescript
db.table("client", (table) => {
  table.email("email").notNull().unique();

  // Simple display name: just specify the fields.
  table.recordDisplayNameFields(["email"]);
});
```

For custom formatting, use `recordDisplayName` instead of
`recordDisplayNameFields`:

```typescript
db.table("client", (table) => {
  table.email("email").notNull().unique();

  table.recordDisplayName(["email"], (email) => email);

  table.searchConfig({
    fields: [{ field: "email", priority: 1 }],
  });
});
```

## Common Patterns

### Referenced Table Configuration

When a table is referenced by foreign keys:

```typescript
// This table will be referenced by other tables
db.table("sys_users", (table) => {
  table.email("email").notNull();
  table.recordDisplayName(["email"], (email) => email);
  table.searchConfig({
    fields: [{ field: "email", priority: 1 }]
  });
});

// This table has a foreign key to sys_users
db.table("interaction", (table) => {
  table.fk("owner", "sys_users").notNull();
  table.string("subject", 200).notNull();
});
```

### Common Mistakes

**Incorrect:** Search-driven record selector targeting a table without display
name/search configuration
```typescript
db.table("sys_users", (table) => {
  table.email("email").notNull();
  // Missing search config!
});

db.table("interaction", (table) => {
  table.fk("owner", "sys_users").notNull(); // FK alone is valid; a search-driven selector still needs config
});
```

**Correct:** Referenced table with search config
```typescript
db.table("sys_users", (table) => {
  table.email("email").notNull();
  table.recordDisplayName(["email"], (email) => email);
  table.searchConfig({
    fields: [{ field: "email", priority: 1 }]
  });
});

db.table("interaction", (table) => {
  table.fk("owner", "sys_users").notNull(); // Works correctly
});
```

## Using Search in Queries

Use the `match` function in SQL queries:

```sql
select title from book where match(book, query => 'prid', record_id => id);
-- Pride and Prejudice
```

## Using Search in Procedures

Use the search statement for ranked multi-table search:

```typescript
s.search({
  resultTable: 'search_results',
  query: sql`search_term`,
  limit: sql`10`,
  offset: sql`0`,
  config: {
    tokenizer: {
      splitter: { type: "Alphanumeric" },
      filters: [{ type: "AsciiFold" }, { type: "Lowercase" }],
    },
    style: { type: "Fuzzy", ...system.searchConfig.defaultFuzzyConfig },
    tables: [
      {
        table: "users",
        fields: [{ field: "name", priority: 1 }, { field: "email", priority: 2 }]
      }
    ]
  }
});
```

The ranked search `style` is one of:

- `{ type: "Contains" }`
- `{ type: "Exact", prefix: "None" | "Last" }`
- `{ type: "Fuzzy", transpositionCostOne, tolerance, prefix }`

## Review Checklist

When creating tables:
1. Does the table have standard search fields? If not, add search configuration
2. Is the table referenced by other tables? If yes, ensure it has search configuration
3. For each foreign key in your table, verify the referenced table has search configuration
