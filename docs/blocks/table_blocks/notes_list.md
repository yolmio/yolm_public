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

`NotesListTableBlock` adds a separate, related notes table to a main table: one
row per note, each with free-text content and a date. It ships a `NotesListCard`
component that lists, adds, edits, and deletes those notes inside a record page.
Use it when you want timestamped notes stored in their own table (one-to-many per
record) rather than a single inline notes field on the record.

```tsx
import { NotesListTableBlock } from "table_blocks/notes_list";
import { NotesListCard } from "table_blocks/notes_list/notes_list_card";
```

`NotesListCard` is not re-exported from the block index; import it from
`table_blocks/notes_list/notes_list_card`.

## Minimal Setup

Attach the block inside a `db.table(...)` definition. Pass the class (not an
instance) to `table.addBlock` — `addBlock` constructs it for you and passes the
parent table name.

```tsx
// core.tsx
db.table("contacts", (table) => {
  table.string("first_name", 50).notNull();
  table.string("last_name", 50).notNull();
  table.fk("companies");
  table.addBlock(NotesListTableBlock); // creates the `contact_notes` table
});
```

Render the card inside a record page (which supplies the current table/record
context). It is a card, not a page — place it directly in the page body, never
inside a `<Route>`.

```tsx
// apps/<domain>.tsx
<RecordPage table="contacts">
  {/* ...other cards... */}
  <NotesListCard className="col-span-12 md:col-span-6" />
</RecordPage>;
```

## Configuration

`table.addBlock(NotesListTableBlock, opts?)` takes optional
`NotesListTableBlockOpts`:

| Option     | Type                            | Required | Meaning                                                                                                                                |
| ---------- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `populate` | `(table: TableBuilder) => void` | No       | Hook to add extra fields/indexes to the generated notes table during setup. Receives the notes `TableBuilder`, not the main table. |

```tsx
table.addBlock(NotesListTableBlock, {
  populate: (notes) => {
    notes.fk("users").notNull(); // e.g. add a note author column
  },
});
```

Only one instance of the block may be attached to a table
(`allowMultipleInstances` is `false`); adding it twice throws at generation time.

## Tables Created

| Table                              | Purpose                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `${singularize(mainTable.name)}_notes` | One row per note attached to a main-table record. For a `contacts` main table this is `contact_notes`; for `people` it is `person_notes`. |

> Note: the class JSDoc describes the name as `${mainTable}_note`; that text is
> stale. The code generates `${singularize(mainTable.name)}_notes` (singularized
> stem, `_notes` plural suffix).

Columns on the generated notes table:

| Column        | Type                | Notes                                                                          |
| ------------- | ------------------- | ------------------------------------------------------------------------------ |
| (foreign key) | FK to the main table | `notNull`. Created via `table.fk(mainTable.name)`. The card auto-detects it.   |
| `content`     | `string(2000)`      | `notNull`. The note body.                                                       |
| `date`        | `date`              | `notNull`. Set to `current_date()` when a note is added (insert value, not a column default). |
| (extra)       | —                   | Any fields added by the `populate` hook.                                         |

The generated table model is available at generation time via
`table.block(NotesListTableBlock).table` (a `Table`), resolved lazily from
`system.db.tables`.

## Components

### `NotesListCard`

Import: `table_blocks/notes_list/notes_list_card`

Displays the notes for the current record and provides inline add / edit / delete
(with undo) flows. It must be rendered inside a record context (e.g.
`RecordPage`) that provides the current table and current record, and the current
table must have `NotesListTableBlock` attached — the card resolves the notes
table via `currentTable.block(NotesListTableBlock)`.

| Prop              | Type     | Required | Meaning                                                                                                                |
| ----------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `sx`              | `Style`  | No       | Style overrides applied to the card.                                                                                  |
| `className`       | `string` | No       | Extra class name applied to the card.                                                                                 |
| `foreignKeyField` | `string` | No       | Override the FK field name linking notes back to the current record. Auto-detected from the notes table when omitted. |
| `notesTable`      | `string` | No       | Currently unused — the notes table is always resolved from the current table's `NotesListTableBlock`.                 |

The card's props interface is exported as `Props` from the same module, but
consumers rarely need to import it.

## Detail Tab

`NotesListTableBlock` overrides `getDetailTab`, contributing a record-page detail
tab (`value: "notes"`, header "Notes", content `<NotesListCard />`). The CRM
block's record detail page iterates `table.allBlocks()` and renders each block's
`getDetailTab`, so a table managed by the CRM block that has
`NotesListTableBlock` attached gets a Notes tab automatically — you do not render
`NotesListCard` yourself there. On a plain `RecordPage` (which does not consume
block detail tabs), render `NotesListCard` explicitly, as in Minimal Setup.

## Common Mistakes

- Rendering `NotesListCard` outside a record page/context. It reads
  `CurrentTableICtxKey` and `CurrentRecordICtxKey`, and throws if no FK field
  links the notes table to the current table.
- Forgetting to `table.addBlock(NotesListTableBlock)` on the table before
  rendering the card. `currentTable.block(NotesListTableBlock)` throws when the
  block is not attached.
- Passing an instance: use `table.addBlock(NotesListTableBlock, opts?)` — pass
  the class and let `addBlock` construct it; do not call
  `new NotesListTableBlock(...)`.
- Expecting the generated table to be named `<table>_note`. It is
  `${singularize(mainTable.name)}_notes` (singularized stem, plural suffix).
- Setting the `notesTable` prop expecting it to switch tables — it is unused.
- Wrapping `NotesListCard` in `<Route>`. It is a card component, not a
  self-routing page.
- Adding the block twice to one table — only one instance is allowed per table.
