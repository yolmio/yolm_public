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

Yolm provides two approaches for tabular data with row interaction:

- **DataTable** (`selectable` prop) — High-level table with built-in checkbox selection, bulk actions, and all other DataTable features. Imported from `components/data_table`.
- **Datagrid** — A low-level virtualized data grid from `std/ui` with keyboard navigation and cell focus.

## DataTable with Row Selection

The easiest way to build a table with checkbox selection is to use DataTable's `selectable` prop. See the [DataTable documentation](./data_table.md) for the full reference.

### Basic Usage

```tsx
import { DataTable } from "components/data_table";

<DataTable
  query={sql`select id, name, email, status from db.users order by name`}
  primaryTable="users"
  selectable
  bulkActions={(selectedTable) => (
    <Button
      size="sm"
      onClick={(s) => {
        s.tryServer({
          body: (s) => {
            s.startTransaction();
            s.modify(sql`
              update db.users set status = 'archived'
              where id in (select id from ${sql.ref(selectedTable)})
            `);
            s.commitTransaction();
            s.refetch();
          },
        });
      }}
    >
      Archive Selected
    </Button>
  )}
  columns={(b) => {
    b.field("name");
    b.field("email");
    b.enumColumn("status", "user_status");
  }}
/>
```

### How Selection Works

- Each row has a checkbox. Checking it adds the row's `id` to an internal `dt_selected` table; unchecking removes it.
- The header has a "select all" checkbox that toggles all visible rows.
- When any rows are selected, `bulkActions` renders above the table showing a count (e.g. "3 selected").
- The query **must** include an `id` column.

### Selection with Filters

DataTable's built-in search and filtering work alongside selection:

```tsx
<DataTable
  query={sql`
    select id, invoice_no, client_name, total_amount, status, invoice_date
    from db.invoices
    order by invoice_date desc
  `}
  primaryTable="invoices"
  selectable
  searchable={{ placeholder: "Search invoices..." }}
  filterable
  pageSize={25}
  columns={(b) => {
    b.field("invoice_no", "Invoice #");
    b.simpleColumn("client_name", "Client");
    b.usdColumn("total_amount", "Amount");
    b.enumColumn("status", "invoice_status");
    b.dateColumn("invoice_date", "%b %d, %Y", "Date");
  }}
  bulkActions={(selectedTable) => (
    <Button
      size="sm"
      color="primary"
      onClick={(s) => {
        s.tryServer({
          body: (s) => {
            s.startTransaction();
            s.modify(sql`
              update db.invoices set status = 'sent'
              where id in (select id from ${sql.ref(selectedTable)})
            `);
            s.commitTransaction();
            s.refetch();
          },
        });
      }}
    >
      Send Selected
    </Button>
  )}
/>
```

---

## Datagrid

A low-level virtualized data grid with keyboard navigation and cell focus. Imported from `std/ui`.

```tsx
import { Datagrid } from "std/ui";
```

### Datagrid Options

Use the exported TypeScript props for exact `Datagrid`, `DataGridColumn`, and
style types. A datagrid needs a source `table`, row `recordName`, column definitions,
fixed `headerHeight` / `rowHeight`, focused row and column scalars, and handlers
for keyboard navigation and cell clicks. Columns define `header`, `cell`,
`width`, and optional ordering or visibility expressions.

### When to Use Which

| Feature | DataTable (selectable) | Datagrid |
|---------|----------------------|----------|
| Checkbox selection | Built-in | Manual implementation |
| Virtualization | No | Yes |
| Keyboard navigation | No | Built-in |
| Cell focus | No | Built-in |
| Search/Filter/Sort | Built-in | Manual implementation |
| Inline editing | Built-in | Manual implementation |
| Complexity | Simple, high-level | Low-level, full control |
| Best for | Selection-based workflows (invoicing, bulk actions) | Spreadsheet-like interfaces, large datasets |
