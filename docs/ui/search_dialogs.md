---
title: Search Dialogs
description: Add Ctrl/Cmd+K record search to Yolm apps with Navbar or Sidebar search props, multi-table search dialogs, or a standalone GlobalSearchDialog.
tags:
  - ui
  - search
  - navbar
  - components
related:
  - ui/navbar.md
  - ui/sidebar.md
  - database/search_config.md
---

# Search Dialogs

Search dialogs let users jump to records from anywhere in the app. They are
opened by a search button or the **Ctrl/Cmd + K** shortcut.

## Requirements

Each searched table needs:

1. A search configuration ([Search Configuration](../database/search_config.md)).
2. A detail page URL (via `getHrefToRecord` or standard routing) so results can
   link to records.
3. A `recordDisplayName` when its display field is not the standard one.

## Configuration

Both entry points take the same configuration; pass exactly one (both throws
at generation time).

- `searchDialog: { table, displayValues? }` - one table. The button reads
  `Find {table}…`.
- `multiTableSearchDialog: { tables }` - several tables; each entry is
  `{ name, icon, displayValues? }`, where `icon` (required) is a Material icon
  shown next to results.

`displayValues` adds context to each result. An entry is a field name or a
`TableSearchDisplay` object `{ name, expr: (record) => Sql, type, label? }`
whose `expr` builds the value from the record row.

```tsx
import { Navbar } from "components/navbar";

<Navbar
  links={["/contacts", "/matters", "/time-entries"]}
  multiTableSearchDialog={{
    tables: [
      { name: "matters", icon: "Gavel", displayValues: ["type", "client_position"] },
      { name: "contacts", icon: "Person", displayValues: ["type", "email"] },
    ],
  }}
/>
```

## Entry Points

- [`Navbar`](./navbar.md#search-dialog): `searchDialog` or
  `multiTableSearchDialog` props.
- [`Sidebar`](./sidebar.md#search-and-settings):
  `Sidebar.SearchTableButton` / `Sidebar.MultiTableSearchButton`.
- `GlobalSearchDialog` from `components/global_search_dialog`, when the shell
  uses neither but still wants Ctrl/Cmd+K. It also requires `openScalar`, the
  name of a boolean scalar controlling the open state:

```tsx
import { GlobalSearchDialog } from "components/global_search_dialog";

<Data local procedure={(s) => s.defScalar("global_search_open", false)}>
  <GlobalSearchDialog
    openScalar="global_search_open"
    searchDialog={{ table: "products" }}
  />
</Data>
```

Prefer `multiTableSearchDialog` when users search across several main tables.
