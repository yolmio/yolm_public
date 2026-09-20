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

Common options:

- `table` for the database table.
- `fields` / `ignoreFields` for table field configuration.
- `columns` for virtual columns, custom cells, related counts, and FK virtuals.
- `selectable`, `bulk`, `viewButton`, `viewButtonUrl` for workflows.
- `recordPage` for integrated detail pages with previous/next navigation over
  the grid rows loaded in the current session.
- `recordPage.linkField` to make a displayed string or numeric field open the
  integrated detail page instead of showing a separate View button column.
- `recordPage.showExactResultCount` to opt into an up-front result
  count. Without it, the label progressively reports `N of loaded+` and
  becomes exact when navigation discovers the final page.
- `additionalWhere` to scope the grid.

Use `system.addDataGridTablesAndEnums([...])` in `core.tsx` when saved datagrid
views should support named tables/enums.

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
`searchable`, `filterable`, `sortable`, `pageSize`, `editable`, `selectable`,
`actions`, `bulkActions`, `download`, `where`, and `viewButtonUrl`.

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

`RecordPage` supplies:

- a route like `/{table_base_url}/{record_id:id}`,
- `ui.record_id`,
- a `record` row available to children,
- loading and not-found handling.

Use `path` only when the default route is not acceptable.

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
- Building custom CRUD before trying a page primitive.
- Guessing field names instead of reading `core.tsx`.
- Putting dense workflow queues into CRUD pages when `WorkQueue` or custom
  `Data`/`Form` screens would fit better.
