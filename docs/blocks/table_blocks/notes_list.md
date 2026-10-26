---
title: Notes List Table Block
description: Attaches a related notes table to any table and ships a NotesListCard for adding, editing, and deleting timestamped record notes.
tags:
  - blocks
  - table-block
  - notes
  - ui
related:
  - concepts/blocks.md
  - blocks/solution_blocks.md
  - ui/blocks_reference.md
  - blocks/crm.md
  - ui/data_vs_form.md
---

# Notes List Table Block

`NotesListTableBlock` adds a related notes table (one row per dated note) to a
main table, and a `NotesListCard` that lists, adds, edits, and deletes those
notes on a record page. Use it for one-to-many notes rather than a single
inline notes field.

## Minimal Setup

Pass the class (not an instance) to `table.addBlock`. One instance per table
(adding it twice throws).

```tsx
// core.tsx
import { NotesListTableBlock } from "table_blocks/notes_list";

db.table("contacts", (table) => {
  table.string("first_name", 50).notNull();
  table.addBlock(NotesListTableBlock); // creates `contact_notes`
});
```

```tsx
// apps/<domain>.tsx
import { NotesListCard } from "table_blocks/notes_list/notes_list_card";

<RecordPage table="contacts">
  <NotesListCard className="col-span-12 md:col-span-6" />
</RecordPage>;
```

## Configuration

Optional `NotesListTableBlockOpts`: `populate`, a
`(table: TableBuilder) => void` hook that receives the notes table builder (not
the main table) to add extra fields.

## Tables Created

| Table | Purpose |
| --- | --- |
| `${singularize(mainTable.name)}_notes` | Notes for a main-table record (`contacts` -> `contact_notes`, `people` -> `person_notes`): FK to the main table, `content`, `date`. |

The class JSDoc's `${mainTable}_note` name is stale; the code above is
authoritative. The card sets `date` to `current_date()` on insert; it is not a
column default. The generated `Table` is available as
`table.block(NotesListTableBlock).table`.

## Components

`NotesListCard`, from `table_blocks/notes_list/notes_list_card` (not
re-exported from the index). A card, not a page. It shows the current record's
notes with add / edit / delete (with undo), and must render inside a record
context (e.g. `RecordPage`) whose table has the block; it throws if the block
is missing or no FK links the notes table to the current table.

| Prop | Meaning |
| --- | --- |
| `foreignKeyField` | Override the FK field linking notes to the current record; auto-detected when omitted. |
| `notesTable` | Unused; the notes table always comes from the current table's block. |

Also `sx` and `className`; see `Props` in the same module.

## Detail Tab

`getDetailTab` contributes a "Notes" tab (`value: "notes"`) rendering
`<NotesListCard />`. The [CRM block](../crm.md) record page renders block
detail tabs, so CRM tables get the tab automatically; on a plain `RecordPage`,
render `NotesListCard` explicitly.
