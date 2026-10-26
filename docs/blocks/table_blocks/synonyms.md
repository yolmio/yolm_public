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

`SynonymsTableBlock` gives each record of a main table alternate names: a child
synonyms table, wired into the main table's search (a synonym hit returns the
parent record), plus a "Synonyms" datagrid column with an inline edit dialog.

## Minimal Setup

The main table must have a search config, either explicit
(`table.searchConfig(...)`) or derived from its display-name field (e.g.
`name` or `title`); otherwise generation throws
`SynonymsTableBlock requires a search config on table <name>` when the config
is resolved.

```ts
import { SynonymsTableBlock } from "table_blocks/synonyms";

db.table("services", (table) => {
  table.string("name", 200).notNull().unique();
  table.addBlock(SynonymsTableBlock);
});
```

## Configuration

One optional option (the options type is not exported): `populate`, a
`(table: TableBuilder) => void` hook that adds fields or constraints to the
synonyms table. It runs after `synonym` is added and before the unique
constraint.

## Tables Created

| Table | Purpose |
| --- | --- |
| `${singularize(mainTable.name)}_synonyms` (e.g. `service_synonyms`) | One `synonym` per row, FK `<singular>_id` (e.g. `service_id`); unique on (`synonym`, `<singular>_id`). |

## Search Integration

The block wraps the main table's `getSearchConfig` to append the synonyms table
as a related search table (`synonym` at priority `3`).

## Datagrid Column

`populateDatagrid` adds a virtual "Synonyms" column to every datagrid built for
the table (e.g. `DatagridPage` / `SimpleDatagridPage`); there is no component
to import. It shows the synonym count (filterable as a number, sortable) and an
"Edit" button opening a dialog to list, add, and delete synonyms.
