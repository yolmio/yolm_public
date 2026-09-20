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

`GlossaryBlock` adds a shared glossary: terms (`glossary_words`), one or more
definitions per term, usage examples, and categories for grouping. It also
ships a ready-made page for browsing, searching, filtering, and editing the
glossary. Use it when an app needs a single source of truth for product
jargon, regulatory terms, or any controlled vocabulary, instead of building
the schema and CRUD UI by hand.

```ts
import { GlossaryBlock } from "blocks/glossary";
// The page is also exported standalone:
import { GlossaryPage } from "blocks/glossary";
```

## Minimal Setup

Register the block in `core.tsx`:

```ts
import { GlossaryBlock } from "blocks/glossary";

system.addBlock(new GlossaryBlock());
```

Then render the page inside an app's `<AppRoutes>`:

```tsx
import { GlossaryBlock } from "blocks/glossary";
import { AppRoutes } from "std/ui";
import { system } from "std/system";

system.app({
  ui: (
    <AppRoutes>
      <GlossaryBlock.GlossaryPage />
    </AppRoutes>
  ),
});
```

`GlossaryBlock` takes no constructor options — call `new GlossaryBlock()`.

## Tables Created

`initialize()` creates these tables. Every foreign key is `notNull`.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `glossary_words` | Glossary entries (terms). | `name` (string 100) |
| `glossary_categories` | Categories used to group terms. | `name` (string 50), `description` (string 150) |
| `glossary_category_words` | Join table linking words to categories. | `glossary_word_id`, `glossary_category_id` |
| `glossary_definitions` | One or more definitions per word. | `glossary_word_id`, `description` (string 200) |
| `glossary_examples` | Usage examples per definition. | `glossary_definition_id`, `text` (string 200) |

## Pages

### `GlossaryBlock.GlossaryPage`

Also exported directly as `GlossaryPage` from `blocks/glossary`. Self-routing —
do **not** wrap it in `<Route>`; place it directly inside `<AppRoutes>`.

```tsx
<GlossaryBlock.GlossaryPage />
{/* or with a custom main route */}
<GlossaryBlock.GlossaryPage path="/terms" />
```

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | No | Route for the main glossary browser. Defaults to `/glossary`. |

What it renders:

- The main glossary browser at `path` (default `/glossary`): a searchable,
  category-filterable list of word cards, each showing its definitions,
  examples, and category chips, with add / edit / delete dialogs that manage
  definitions and examples inline.
- A fixed management route `/glossary-categories` — a data table page for
  `glossary_categories` (editable, sortable, deletable, with an insert
  toolbar). This route is always registered and is **not** affected by the
  `path` prop.

To surface both routes in navigation, add links for each:

```tsx
import { Navbar } from "components/navbar";

<Navbar
  links={[
    "/glossary",
    { url: "/glossary-categories", label: "Word Categories" },
  ]}
/>;
```

## Search

`GlossaryPage` checks at generation time that the `glossary_words` table has a
search config and throws if it does not. With the default schema this is
automatic: the single `name` display field makes Yolm derive a search config,
so no manual `searchConfig` call is required. The page's search box fuzzy-matches
the query against each word's `name`.

## Common Mistakes

- Wrapping `<GlossaryBlock.GlossaryPage />` in a `<Route>`. It is self-routing
  and also registers `/glossary-categories`; wrapping it breaks routing.
- Expecting the `path` prop to move the categories page. `path` only changes
  the main glossary route; `/glossary-categories` is hardcoded.
- Passing options to the constructor. `GlossaryBlock` accepts none — use
  `new GlossaryBlock()`.
- Removing or renaming the `name` field on `glossary_words` so no display field
  remains. Without a derivable search config, `GlossaryPage` throws at
  generation time.
