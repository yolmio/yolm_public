---
title: Synonyms Table Block
description: Table block that adds a related synonyms table, extends the main table's search to match synonyms, and adds an inline-edit datagrid column.
tags:
  - blocks
  - table-blocks
  - search
  - synonyms
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
  - database/overview.md
---

# Synonyms Table Block

`SynonymsTableBlock` attaches a child synonyms table to a main table so that
each record can have alternate names. It wires those synonyms into the main
table's search (a search hit on a synonym returns the parent record) and adds a
"Synonyms" datagrid column with an inline add/list/delete dialog.

Use it when records have well-known aliases that users will search by. Prefer it
over hand-rolling a child table plus custom search wiring.

```ts
import { SynonymsTableBlock } from "table_blocks/synonyms";
```

## Minimal Setup

Attach the block inside a `db.table(...)` definition with `table.addBlock`. The
main table must have a search config — either an explicit `table.searchConfig(...)`
or one derived automatically when the table has a `name` or `title` field —
otherwise generation throws when the search config is resolved.

```ts
db.table("services", (table) => {
  table.string("name", 200).notNull().unique();
  table.addBlock(SynonymsTableBlock);
});
```

This generates a `service_synonyms` table, extends the `services` search config
to also match the `synonym` field, and adds the "Synonyms" column to any datagrid
built for `services`.

## Configuration

`addBlock` supplies the main table name automatically; you only pass the options
object (the type itself is not exported). All fields are optional.

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `populate` | `(table: TableBuilder) => void` | No | Hook to add extra fields/constraints to the generated synonyms table during initialization. Runs after `synonym` is added but before the unique constraint. |

Example adding an extra column to the synonyms table:

```ts
db.table("services", (table) => {
  table.string("name", 200).notNull().unique();
  table.addBlock(SynonymsTableBlock, {
    populate: (t) => {
      t.string("source", 100);
    },
  });
});
```

## Tables Created

The block creates one table named `${singularize(mainTable.name)}_synonyms`
(e.g. `services` → `service_synonyms`).

| Column | Type | Notes |
| --- | --- | --- |
| `${singular}_id` | foreign key → main table | Not null. E.g. `service_id`. |
| `synonym` | `string(2000)` | Not null. |
| (unique) | — | Unique on (`synonym`, `${singular}_id`) — a synonym is unique per parent record. |

Any fields added via the `populate` option are appended to this table.

## Search Integration

The block overrides the main table's `getSearchConfig` to append the synonyms
table as a related search table (the `synonym` field is indexed with priority
`3`). A search query that matches a synonym therefore returns the associated
main-table records. The wrapped config requires the main table to have a search
config: when it is resolved during generation with none present, the block
throws `SynonymsTableBlock requires a search config on table <name>`.

## Datagrid Column

`populateDatagrid` adds a virtual "Synonyms" column. Datagrids built for the
table (for example via `DatagridPage` / `SimpleDatagridPage`) call this hook
automatically — there is no separate component to import or render.

The column:

- Shows the synonym count for each row (formatted as a decimal).
- Renders an "Edit" button that opens a modal dialog listing existing synonyms,
  with controls to add a new one and delete existing ones.
- Is initially displayed at width 150, filterable as a number, and sortable
  numerically.

## Common Mistakes

- Adding the block to a table with no search config (and no `name`/`title`
  field). Generation throws when the search config is resolved — configure
  `table.searchConfig(...)` or a display-name field first.
- Expecting to import a standalone synonyms component. The datagrid column is
  contributed by the block automatically; do not render it manually.
- Referencing the synonyms table by the plural main-table name. The generated
  table and foreign key use the singularized name (e.g. `service_synonyms`,
  `service_id`).
- Inserting duplicate synonyms for the same parent record — blocked by the
  unique (`synonym`, `${singular}_id`) constraint.
