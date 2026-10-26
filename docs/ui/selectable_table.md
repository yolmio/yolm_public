---
title: DataTable Selection & DataGrid
description: Row selection with DataTable and low-level virtualized data grid with keyboard navigation.
tags:
  - ui
  - components
  - table
  - data-grid
  - selection
---

# DataTable Selection & DataGrid

Two approaches cover tabular data with row interaction:

- `DataTable` with `selectable` (from `components/data_table`): checkbox
  selection plus bulk actions, search, filters, and editing.
- `Datagrid` (from `std/ui`): a low-level virtualized grid with keyboard
  navigation and cell focus. `DatagridPage` is built on it; prefer
  [`DatagridPage`](./datagrid.md) unless you need a custom grid.

## DataTable Selection

```tsx
<DataTable
  query={sql`select id, invoice_no, client_name, total_amount, status from db.invoices`}
  primaryTable="invoices"
  selectable
  searchable={{ placeholder: "Search invoices..." }}
  filterable
  pageSize={25}
  bulkActions={(selectedTable) => (
    <ActionButton
      size="sm"
      action={(s) => {
        s.startTransaction();
        s.modify(sql`
          update db.invoices set status = 'sent'
          where id in (select id from ${sql.ref(selectedTable)})
        `);
        s.commitTransaction();
      }}
    >
      Send Selected
    </ActionButton>
  )}
/>
```

- The query must include an `id` column. Checking a row adds its `id` to the
  selection table (`dt_selected`, or the `selectionTable` you name).
- The header checkbox toggles all visible rows; `selectAllFilteredResults`
  extends selection to the whole filtered query.
- While rows are selected, `bulkActions` renders above the table with a count
  ("3 selected"). `ActionButton` refetches the table on success.

See [DataTable](./data_table.md#selection-and-mutations) for row actions and
the full option list.

## Datagrid

```tsx
import { Datagrid } from "std/ui";
```

A `Datagrid` needs a source `table`, row `recordName`, `columns`, fixed
`headerHeight`/`rowHeight`, `focusedRow`/`focusedColumn` expressions,
`shouldFocusCell`, and `onKeyboardNavigation`/`onCellClick` handlers
(optional `onCellDoubleClick`, `onCellKeydown`, `onFetchMore` for infinite
scroll). Each column has `header`, `cell`, `width`, and optional `ordering`,
`visible`, `pinLeft`, and `pinRight` expressions. See `DatagridProps` and
`DataGridColumn` in `std/ui`.

| Feature | DataTable (`selectable`) | Datagrid |
|---------|--------------------------|----------|
| Checkbox selection, search/filter/sort, inline editing | Built-in | Manual |
| Virtualization, keyboard navigation, cell focus | No | Built-in |
| Best for | Selection workflows (invoicing, bulk actions) | Spreadsheet-like interfaces, large datasets |
