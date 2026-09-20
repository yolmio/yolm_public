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

## Common Options

| Need | Use |
| --- | --- |
| Explicit columns | `columns={(b) => { ... }}` |
| Search box | `searchable` or `searchable={{ placeholder: "Search..." }}` |
| Density | `size="xs"`, `size="sm"`, `size="md"`, or `size="lg"` |
| Sortable headers | `sortable`, `defaultSort` |
| Column filters | `filterable` |
| Pagination | `pageSize` |
| CSV export | `download="orders.csv"` |
| Checkbox selection | `selectable`, `bulkActions={(selectedTable) => ...}` |
| Externally named selection table | `selectionTable="selected_orders"` |
| Inline editing | `editable` with `primaryTable` and row `id` |
| Row menu actions | `actions={(b) => { b.edit(); b.delete(); ... }}` |
| Row navigation | `recordName`, `onRowClick` |
| Dynamic filter | `where`, `watch` |

For large result sets, provide `defaultPagedQuery` and
`defaultCountQuery` together so the table can fetch a page and its total
count. `filterVariant` and `defaultFilters` choose the filter UI and initial
filters. `selectAllFilteredResults` lets bulk selection cover the filtered
query rather than only loaded rows. Use `header`, `footer`, `emptyState`, and
`loadingState` for surrounding states; `scrollable`, `toolbar`,
`analysisScalars`, and `minColumnWidth` control table layout and analysis.

Use the exported props for full prop/builder signatures.

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

## Selection State

Pass `selectable` to enable checkbox selection. By default selected rows are
stored in the procedure-scope table `dt_selected`; pass `selectionTable` to
choose a stable table name when another component or action needs to refer to
the same selection state.

## Mutation Patterns

Inline editing is best for direct field updates on the `primaryTable`. The
query must include the source row `id`.

```tsx
<DataTable
  query={sql`select id, name, active from db.products`}
  primaryTable="products"
  editable
/>
```

For multi-step mutations, prefer row actions or bulk actions:

```tsx
<DataTable
  query={sql`select id, invoice_number, total_amount from db.invoices where status = 'draft'`}
  primaryTable="invoices"
  selectable
  bulkActions={(selectedTable) => (
    <Button
      size="sm"
      onClick={(s) => {
        s.tryServer({
          body: (s) => {
            s.startTransaction();
            s.modify(sql`
              update db.invoices
              set status = 'sent'
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

Use `s.refetch()` after mutations when the displayed query should refresh.

### Row action builder

The `actions` callback receives `ActionsBuilder`:

```tsx
import { DataTable, type ActionsBuilder } from "components/data_table";

function orderActions(b: ActionsBuilder) {
  b.edit({ ignoreFields: ["created_at"] });
  b.delete({ confirmText: "Delete this order?" });
  b.custom("Archive", { icon: "Archive" }, (s) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`update db.orders set archived = true where id = record_id`);
        s.commitTransaction();
        s.refetch();
      },
    });
  });
}
```

| Method | Effect |
|--------|--------|
| `edit(opts?)` | Opens an auto-generated update dialog for the row. `opts.ignoreFields` hides fields; form lifecycle hooks can run before/after transaction start/commit and after client success/server error. |
| `delete(opts?)` | Opens a confirmation dialog and deletes the row. `opts.confirmText` customizes the prompt; delete lifecycle hooks are supported. |
| `custom(label, opts, onClick)` | Adds a custom row-menu action. `opts.icon` sets the menu icon; `onClick` receives DOM statements. |

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
