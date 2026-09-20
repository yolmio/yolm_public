---
title: Translations Table Block
description: Attach a related translations table to a table and serve language-specific display values when a user language context is set.
tags:
  - blocks
  - table-blocks
  - i18n
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# Translations Table Block

`TranslationsTableBlock` is a table block that adds a related
`<singular>_translations` table holding per-language values for one display
field on the parent table. When a user-language context is present, the parent
record's display name and search automatically resolve to the translated value,
falling back to the original field when no translation exists.

Use it when a record's name/label must render in the viewer's language. Reach
for it instead of hand-rolling a translations table whenever you also want the
display-name fallback and the inline edit UI it ships.

```ts
import { TranslationsTableBlock } from "table_blocks/translations";
```

## Minimal Setup

Attach the block inside `db.table(...)` with `table.addBlock(...)`. The system
must define an enum named `language` (the block adds a `language` enum field to
the generated table). You do not pass the table name yourself — `addBlock`
supplies it from the table being built.

```ts
system.enum_({
  name: "language",
  values: [
    { name: "en", displayName: "English" },
    { name: "es", displayName: "Spanish" },
    { name: "ru", displayName: "Russian" },
  ],
});

db.table("orgs", (table) => {
  table.enum("org_type").notNull();
  table.string("name", 200).notNull();
  table.addBlock(TranslationsTableBlock, {
    displayField: "name",
    defaultLanguage: "en",
  });
});
```

This creates an `org_translations` table and rewrites the `orgs` record display
name to prefer the translated `name` for the current user language.

## Configuration

`table.addBlock(TranslationsTableBlock, opts)` — `opts` is
`TranslationsTableBlockOpts`:

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `displayField` | `string` | Yes | Name of the field on the parent table whose value gets translated. The same field name is created on the translations table (string, max 2000) and holds the translated value. |
| `defaultLanguage` | `string` | No | Language code already stored on the parent record's own field. It is excluded from the language picker in the inline edit dialog (no translation row is created for it). When omitted, the picker shows every language. |
| `populate` | `(table: TableBuilder) => void` | No | Hook to add extra fields to the generated translations table during setup. |

## Tables Created

For a parent table named `orgs` (singularized to `org`):

| Table | Purpose |
| --- | --- |
| `org_translations` | One translation row per language for the parent record's display field. |

Columns on the generated table:

| Column | Notes |
| --- | --- |
| `<singular>_id` (e.g. `org_id`) | Foreign key to the parent table, not null. |
| `language` | Enum field referencing the system `language` enum, not null. |
| `<displayField>` | String (max 2000), not null — the translated value. |
| unique (`language`, `<singular>_id`) | At most one translation per language per parent record. |

Extra columns added via `populate` are appended to this table.

## Behavior

- **Translated display name.** The block overrides the parent table's record
  display name to
  `coalesce(<translated value for current language>, <original field>)`. The
  lookup only runs when a `UserLanguageICtx` is present (see below); otherwise
  the original field value is used unchanged.
- **Search.** During table finalization the block extends the parent table's
  search config so search also matches the translated display field filtered to
  the current user language. The extra related-table entry is only added when a
  `UserLanguageICtx` is present. The parent table **must** have a search config
  when one is requested; otherwise generation throws
  `TranslationsTableBlock requires a search config on table <name>`. Configure
  it with `table.searchConfig({ ... })`.
- **Datagrid column.** Datagrids built for the parent table automatically gain
  a "Translations" virtual column showing the translation count plus an "Edit"
  button. The button opens a dialog that lists existing translations (each with
  a delete button) and an inline form to add a new one, with a language picker
  that excludes `defaultLanguage`. No extra wiring is needed in the page.

## Providing the user language

Translated display names and the translated search entry only activate when a
`UserLanguageICtx` is in scope. Provide it with `setUserLanguage` from
`std/ictx`, passing a SQL expression that yields a `language` enum code (for
example a scalar already in scope, or a lookup of the signed-in user's preferred
language). Call it high enough in the tree that the descendants needing
translation are covered.

```ts
import { setUserLanguage } from "std/ictx";

// The argument is any SQL expression that resolves to a `language` enum code.
setUserLanguage(sql`current_lang`);
```

Without a surrounding `UserLanguageICtx`, the block is inert at runtime — the
translations table still exists and is editable, but the parent display name and
search fall back to the untranslated field.

## Block instance members

You rarely need these — the display-name, search, and datagrid wiring all happen
automatically. If you do need the generated table or its foreign key (for
example to reference them in schema elsewhere), retrieve the attached instance
from the finalized parent table with `Table.block`:

```ts
const block = system.db.tables["orgs"].block(TranslationsTableBlock);
block.table; // the generated `org_translations` Table
block.fkField; // the `org_id` foreign-key field on that table
```

| Member | Type | Meaning |
| --- | --- | --- |
| `table` | `Table` | The generated `<singular>_translations` table model. |
| `fkField` | field | The foreign-key field on the translations table pointing back to the parent. |

## Common Mistakes

- Adding the block without a system enum named `language`; the generated
  `language` field has nothing to reference.
- Forgetting `table.searchConfig({ ... })` on a searchable parent table —
  generation throws when the search config is requested.
- Expecting translated names to appear without calling `setUserLanguage`; with
  no `UserLanguageICtx`, display names and search use the original field only.
- Passing `displayField` that is not an actual field on the parent table; the
  fallback `coalesce` reads the parent field by that name.
- Treating `defaultLanguage` as a default for the translations rows — it only
  hides that language from the add-translation picker; it never seeds a row.
