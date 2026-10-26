---
title: DatagridPage, RecordPage & DataTablePage
description: "How to choose Yolm CRUD page primitives: DatagridPage, DataTablePage, and RecordPage for routed record lists, editable grids, detail pages, and admin screens."
tags:
  - ui
  - pages
  - crud
  - records
related:
  - ui/data_table.md
  - ui/record_page.md
  - ui/operational_ui.md
  - ui/page_templates.md
---

# DatagridPage, RecordPage & DataTablePage

Use these page primitives before building custom CRUD screens.

```tsx
import { DatagridPage, DatagridToolbar } from "pages/datagrid";
import { DataTablePage } from "pages/data_table_page";
import { RecordPage } from "pages/record_page";
```

## Choose The Page

| Need | Use |
| --- | --- |
| Spreadsheet-like table with saved views, virtual columns, heavy editing | `DatagridPage` |
| Simple HTML table with search, sort, filter, inline editing, CSV download | `DataTablePage` |
| Detail route for one record | `RecordPage` |
| Fully custom workflow screen | `Data` + `Form` + components |

All three create their own routes. Do not wrap them in an extra `Route` unless
the component explicitly documents that pattern.

## DatagridPage

```tsx
<DatagridPage
  table="customers"
  selectable
  viewButton
  toolbar={
    <DatagridToolbar>
      <DatagridToolbar.AutoInsertButton />
    </DatagridToolbar>
  }
/>
```

Key options: `columns` (virtual columns, custom cells, FK virtuals), `bulk`
and `selectable`, `viewButton`/`viewButtonUrl`, `quickSearch`,
`additionalWhere` (fixed scope, also enforced on record URLs), and
`recordPage` for an integrated detail route with previous/next navigation
over the loaded rows. See [Datagrid](./datagrid.md) for details.

### Schema opt-in (persistent schema change)

`DatagridPage` throws at generation time unless its `datagridName` (default:
the table name) is registered in `core.tsx`, before globals lock:

```tsx
system.addDataGridTablesAndEnums(["customers", "orders"]);
```

This is a production schema change the system owner must opt into. The first
call adds system tables `datagrid_views`, `datagrid_view_columns`, and
`datagrid_view_filter_terms` (saved views, per-view column state, and filter
terms), the `datagrid_name` enum with one value per registered grid, and the
`dg_filter_op` enum with its filter helper functions. Later calls only add
`datagrid_name` values. Previously deployed `datagrid_name` values are kept
(following table renames). Classify it like any other schema change before
deploying.

## DataTablePage

```tsx
<DataTablePage
  table="products"
  sortable
  editable
  searchable
  deletable
  toolbar={<AutoInsertIconButton />}
/>
```

Use this for smaller admin tables where HTML table behavior is enough. Common
options mirror [DataTable](./data_table.md): `columns`, `ignoreFields`,
`searchable`, `searchDebounceMs`, `filterable`, `sortable`, `pageSize`, `editable`, `selectable`,
`actions`, `bulkActions`, `download`, `where`, `viewButton`, and `viewButtonUrl`.

When `editable` or `selectable` is enabled and a detail page exists, a view
button column is used for navigation instead of row click.

## RecordPage

```tsx
<RecordPage table="customers">
  <div className="grid grid-cols-12 gap-4 p-4">
    <StaticTableCard
      rows={["company_name", "contact_name", "phone"]}
      className="col-span-12 lg:col-span-6"
    />
  </div>
</RecordPage>
```

`RecordPage` supplies the route `/{table_base_url}/{record_id:id}`,
`ui.record_id`, the `record` row, and loading/not-found handling. See
[RecordPage](./record_page.md).

## Common Combination

Use `recordPage` when detail navigation should retain the datagrid's current
loaded rows, filters, and sort:

```tsx
<DatagridPage
  table="orders"
  quickSearch
  recordPage={{
    linkField: "order_number",
    content: (
      <StaticTableCard rows={["order_number", "status", "created_at"]} />
    ),
  }}
/>
```

Use separate list and record pages when the detail page does not need that
result-set context:

```tsx
<DataTablePage
  table="orders"
  sortable
  searchable
  viewButton
  toolbar={<AutoInsertIconButton />}
/>

<RecordPage table="orders">
  <StaticTableCard rows={["order_number", "status", "created_at"]} />
</RecordPage>
```

## Mistakes

- Wrapping self-routing page primitives in manual `Route` components.
- Using `current_record_id()` inside `RecordPage`; use `ui.record_id`.
- Using `DatagridPage` without `system.addDataGridTablesAndEnums` for its
  `datagridName`.
- Putting dense workflow queues into CRUD pages when `WorkQueue` or custom
  `Data`/`Form` screens would fit better.
