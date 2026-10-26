---
title: Glossary Block
description: Shared glossary of terms, definitions, examples, and categories with a ready-made admin page for browsing and editing entries.
tags:
  - blocks
  - glossary
  - content
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# Glossary Block

`GlossaryBlock` adds a shared glossary of terms, definitions, usage examples,
and categories, plus a ready-made page for browsing and editing it. Use it for
product jargon, regulatory terms, or any controlled vocabulary instead of
building the schema and CRUD UI by hand.

## Minimal Setup

`GlossaryBlock` takes no constructor options. Register it in `core.tsx`, then
render the page inside an app's `<AppRoutes>`:

```tsx
import { GlossaryBlock } from "blocks/glossary";
import { AppRoutes } from "std/ui";
import { system } from "std/system";

system.addBlock(new GlossaryBlock());

system.app({
  ui: (
    <AppRoutes>
      <GlossaryBlock.GlossaryPage />
    </AppRoutes>
  ),
});
```

## Tables Created

| Table | Purpose |
| --- | --- |
| `glossary_words` | Glossary terms. |
| `glossary_categories` | Categories for grouping terms. |
| `glossary_category_words` | Links words to categories. |
| `glossary_definitions` | One or more definitions per word. |
| `glossary_examples` | Usage examples per definition. |

## Pages

`GlossaryBlock.GlossaryPage` (also exported as `GlossaryPage` from
`blocks/glossary`) is self-routing; place it directly inside `<AppRoutes>`,
not in a `<Route>`. It registers:

- the glossary browser at `path` (default `/glossary`): searchable,
  category-filterable word cards with add, edit, and delete dialogs that manage
  definitions and examples inline;
- a categories data-table page at `/glossary-categories`. This route is
  hardcoded and not affected by `path`, so add a navigation link for it
  separately.

## Gotchas

- `GlossaryPage` throws at generation time if `glossary_words` has no search
  config. The default single `name` display field derives one automatically;
  do not remove or rename it. Search fuzzy-matches each word's `name`.
