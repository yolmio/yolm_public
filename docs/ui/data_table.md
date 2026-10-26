---
title: DataTable
description: How to use the DataTable component for SQL-backed tables with inferred columns, primaryTable metadata, search, sort, filters, selection, inline editing, actions, and CSV download.
tags:
  - ui
  - components
  - table
  - data
  - reporting
related:
  - ui/solution_components.md
  - ui/operational_ui.md
  - ui/data.md
  - ui/form.md
---

# DataTable

`DataTable` is the default component for tabular query results. Use it for
admin lists, reports, lookup tables, CSV downloads, simple inline edits, and
bulk actions.

```tsx
import { DataTable } from "components/data_table";
```

## Start Here

```tsx
<DataTable
  query={sql`select * from db.orders`}
  primaryTable="orders"
  searchable
  sortable
  pageSize={25}
/>
```

Set `primaryTable` when rows come from one table. It enables table metadata,
field display names, `InlineFieldDisplay`, inline editing, and generated row
actions.

## Non-Obvious Options

| Need | Use |
| --- | --- |
| Search | `searchable` (`true`, field list, or `{ placeholder }`); `searchDebounceMs` defaults to 250, `0`/`false` searches immediately |
| Sort / filter | `sortable`, `defaultSort`; `filterable`, `filterVariant` (`"inline"` or `"panel"`), `defaultFilters` |
| Large result sets | `defaultPagedQuery` and `defaultCountQuery` together, so the table fetches one page plus its total |
| Selection | `selectable`, `bulkActions={(selectedTable) => ...}`, `selectionTable`, `selectAllFilteredResults` (bulk selection covers the filtered query, not only loaded rows) |
| Inline editing | `editable` with `primaryTable` and row `id` in the query |
| Row navigation | `recordName`, `onRowClick` |
| Runtime filter | `where` (SQL predicate) with `watch` |
| Toolbar | `toolbarStart` sits beside search; `toolbar` sits at the right end |
| CSV export | `download="orders.csv"` or `{ fileName, label }` |

`variant` is `"default"`, `"outlined"`, or `"plain"`; `size` follows the
shared [styling props](./styling.md#color-variant-and-size). See
`DataTableProps`, `ColumnsBuilder`, and `ActionsBuilder` in
`components/data_table` for the full contract (including `header`, `footer`,
`emptyState`, `loadingState`, `scrollable`, `analysisScalars`,
`minColumnWidth`, and `tableProps`).

## Columns

Use the builder for readable, typed display logic:

```tsx
<DataTable
  query={sql`
    select o.id, o.order_number, o.customer_id, o.total, o.status, o.created_at
    from db.orders o
  `}
  primaryTable="orders"
  columns={(b) => {
    b.field("order_number", "Order #");
    b.recordDisplayColumn("customer_id", "customers", "Customer");
    b.usdColumn("total", "Amount");
    b.enumColumn("status", "order_status");
    b.dateColumn("created_at", "%b %d, %Y", "Created");
  }}
/>
```

Useful builder methods include `field`, `simpleColumn`, `column`,
`decimalColumn`, `percentColumn`, `usdColumn`, `dateColumn`,
`minutesDurationColumn`, `checkColumn`, `enumColumn`, `formatColumn`, and
`recordDisplayColumn`.

## Selection and Mutations

With `selectable`, selected rows live in the procedure-scope table
`dt_selected` unless `selectionTable` names a stable table that another
component or action refers to. `bulkActions` receives that table's name:

```tsx
<DataTable
  query={sql`select id, invoice_number, total_amount from db.invoices where status = 'draft'`}
  primaryTable="invoices"
  selectable
  bulkActions={(selectedTable) => (
    <ActionButton
      size="sm"
      successMessage="Invoices sent"
      action={(s) => {
        s.startTransaction();
        s.modify(sql`
          update db.invoices
          set status = 'sent'
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

`ActionButton` (from `std/action_button`) refetches the enclosing `Data` on
success; see [Data vs Form](./data_vs_form.md#when-to-use-actionbutton).

The `actions` callback builds the row menu:

```tsx
function orderActions(b: ActionsBuilder) {
  b.edit({ ignoreFields: ["created_at"] });
  b.delete({ confirmText: "Delete this order?" });
  b.action("Archive", { icon: "Archive", successMessage: "Archived" }, (s, recordId) => {
    s.startTransaction();
    s.modify(sql`update db.orders set archived = true where id = ${recordId}`);
    s.commitTransaction();
  });
}
```

| Method | Effect |
|--------|--------|
| `edit(opts?)` | Auto-generated update dialog. `ignoreFields`, `temporaryFields`, and form lifecycle hooks (`beforeTransactionCommit`, `afterSubmitClientSuccess`, ...). |
| `delete(opts?)` | Confirmation dialog, then delete. `confirmText` plus delete lifecycle hooks. |
| `action(label, opts, action)` | Guarded server action with the row id; `opts` mirrors `ActionMenuItem` (`when`, `confirm`, `successMessage`, `errorDisplay`, `refetch`, `onSuccess`, `afterSuccessClient`). |
| `custom(label, { icon }, handler)` | Client-only menu item; `handler` receives DOM statements. |

## Dynamic Filters

Put filter state in `Data`, pass it through `where`, and list watched
expressions in `watch`.

```tsx
<Data procedure={(s) => {
  s.defScalar("status_filter", sql.lit``);
}}>
  <Select
    value={sql`status_filter`}
    onChange={(s) => s.setScalar("status_filter", sql`target_value`)}
  >
    <Select.Option value="">All</Select.Option>
    <Select.Option value="active">Active</Select.Option>
  </Select>

  <DataTable
    query={sql`select * from db.orders`}
    primaryTable="orders"
    where={sql`status_filter = '' or status = status_filter`}
    watch={[sql`status_filter`]}
  />
</Data>
```

## When Not To Use DataTable

| Need | Prefer |
| --- | --- |
| Dense keyboard-driven work queue | [Operational UI](./operational_ui.md) / `WorkQueue` |
| Fully custom virtualized grid | [Datagrid](./datagrid.md) |
| Single record detail/edit page | [RecordPage](./record_page.md) or `Form` |
| Bespoke form workflow | [Form](./form.md) |
