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

`TranslationsTableBlock` adds a related `<singular>_translations` table holding
per-language values for one display field of the parent table. When a user
language context is set, the parent's record display name and search resolve to
the translated value, falling back to the original field.

## Minimal Setup

The system must define an enum named `language`; the generated table has a
`language` field of that enum.

```ts
import { TranslationsTableBlock } from "table_blocks/translations";

system.enum_({
  name: "language",
  values: [
    { name: "en", displayName: "English" },
    { name: "es", displayName: "Spanish" },
  ],
});

db.table("orgs", (table) => {
  table.string("name", 200).notNull();
  table.addBlock(TranslationsTableBlock, {
    displayField: "name",
    defaultLanguage: "en",
  });
});
```

## Configuration

`TranslationsTableBlockOpts` in `packages/table_blocks/translations/index.tsx`:

| Option | Meaning |
| --- | --- |
| `displayField` (required) | Parent field to translate. A field with the same name (string, max 2000) holds the translated value on the translations table. |
| `defaultLanguage` | Language already stored in the parent field. It is only hidden from the add-translation picker; it never seeds a row. |
| `populate` | `(table: TableBuilder) => void` hook to add extra fields to the translations table. |

## Tables Created

| Table | Purpose |
| --- | --- |
| `<singular>_translations` (e.g. `org_translations`) | One translated value per `language` per parent record (unique on `language`, `<singular>_id`). |

## Behavior

- **Display name.** The parent's record display name becomes
  `coalesce(<translation for current language>, <displayField>)` when a
  `UserLanguageICtx` is present; otherwise the original field.
- **Search.** The block wraps the parent's search config to also match the
  translated field filtered to the current language (only with a
  `UserLanguageICtx`). The parent **must** have a search config
  (`table.searchConfig({ ... })`); otherwise generation throws
  `TranslationsTableBlock requires a search config on table <name>`.
- **Datagrid.** Parent datagrids gain a "Translations" virtual column (count
  plus "Edit"), opening a dialog to list, delete, and add translations.

## Providing the User Language

Call `setUserLanguage` from `std/ictx` high enough in the tree, with any SQL
expression yielding a `language` enum code. Without it, the translations table
still exists and is editable, but display names and search use the original
field.

```ts
import { setUserLanguage } from "std/ictx";

setUserLanguage(sql`current_lang`);
```

## Block Instance Members

`system.db.tables["orgs"].block(TranslationsTableBlock)` exposes `table` (the
generated translations `Table`) and `fkField` (its FK back to the parent).
