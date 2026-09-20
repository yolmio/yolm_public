---
title: Search Dialogs
description: How to add search functionality to your Yolm apps using Navbar search and multi-table search dialogs.
tags:
  - ui
  - search
  - navbar
  - components
---

# Search Dialogs

Add search functionality to your apps using the Navbar component's built-in search features.

```typescript
import { Navbar } from "components/navbar";
```

## Prerequisites

Before enabling search in the UI:
1. Ensure tables have search configuration (see [Search Configuration](../database/search_config.md))
2. Tables need detail pages so users can navigate to search results
3. Tables need `recordDisplayName` configured for non-standard display fields

## Navbar Search

The Navbar component provides built-in search functionality. The search button
opens a search dialog that can also be opened with the Ctrl/Cmd + K keyboard
shortcut.

### Single Table Search

For apps focused on a single main table:

```typescript
<Navbar
  links={["/products", "/orders", "/customers"]}
  searchDialog={{
    table: "products",
  }}
/>
```

`searchDialog` takes `table` (required) and an optional `displayValues` array of
extra fields to show in results (same form as the multi-table `displayValues`
below).

## GlobalSearchDialog

Use `GlobalSearchDialog` directly when the app shell is not using `Navbar` or
`Sidebar`, but still wants the same Ctrl/Cmd+K behavior.

```tsx
import { GlobalSearchDialog } from "components/global_search_dialog";

<Data local procedure={(s) => s.defScalar("global_search_open", false)}>
  <GlobalSearchDialog
    openScalar="global_search_open"
    searchDialog={{ table: "products" }}
  />
</Data>
```

Props:

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `openScalar` | `string` | Yes | Boolean scalar name controlling dialog open state. |
| `searchDialog` | `{ table: string; displayValues?: (string \| TableSearchDisplay)[] }` | No | Single-table search. |
| `multiTableSearchDialog` | `{ tables: MultiTableSearchDialogTable[] }` | No | Multi-table search. |

Pass exactly one of `searchDialog` or `multiTableSearchDialog`.

### Multi-Table Search Dialog

For apps with multiple searchable tables, use `multiTableSearchDialog`:

```typescript
<Navbar
  links={["/contacts", "/matters", "/time-entries", "/reports"]}
  color="primary"
  variant="solid"
  multiTableSearchDialog={{
    tables: [
      {
        name: "matters",
        displayValues: ["type", "client_position"],
        icon: "Gavel",
      },
      {
        name: "contacts",
        displayValues: ["type", "email"],
        icon: "Person",
      },
    ],
  }}
/>
```

### Multi-Table Search Options

Each table in the `tables` array accepts:

| Property | Description |
|----------|-------------|
| `name` | Table name (required) |
| `displayValues` | Optional additional fields to show in search results |
| `icon` | Material icon name to display next to results (required) |

Each `displayValues` entry is either a field name (string) or a custom display
object `{ name, expr: (record) => Sql, type, label? }`, where `expr` builds the
value from the record row.

## Best Practices

- For most user-facing apps, add full-text search to the Navbar for main tables
- Prefer `multiTableSearchDialog` in systems with multiple tables users would want to search across
- Use descriptive icons to help users distinguish between result types
- Include relevant `displayValues` to give context in search results

## Requirements

For `multiTableSearchDialog` to work, each table must have:
- A `recordDisplayName` configured
- A detail page URL (via `getHrefToRecord` or standard routing)

See [Search Configuration](../database/search_config.md) for setting up table
search configs.
