---
title: Table
description: Table component for displaying tabular data with styling options for borders, stripes, hover effects, and sticky headers.
tags:
  - ui
  - components
  - table
  - data
---

# Table

`Table` renders a styled HTML `<table>`; you write the `thead`/`tbody` markup
and iterate rows with `Each`. Use it when you need direct control over markup,
captions, row layout, or custom cells. For record lists with built-in columns,
search, actions, and paging, use [DataTable](./data_table.md) or
`DataTablePage`.

```tsx
import { Table } from "components/table";
```

## Example

```tsx
<Data procedure={(s) => {
  s.defTable("orders", sql`select id, customer_name, total, status from db.orders order by id desc`);
}}>
  <Sheet variant="outlined" className="max-h-[400px] overflow-auto">
    <Table stickyHeader hoverRow stripe="odd" size="sm">
      <thead>
        <tr>
          <th>ID</th>
          <th>Customer</th>
          <th>Total</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <Each table="orders" recordName="order">
          <tr>
            <td>{sql`order.id`}</td>
            <td>{sql`order.customer_name`}</td>
            <td>{sql`order.total`}</td>
            <td>{sql`order.status`}</td>
          </tr>
        </Each>
      </tbody>
    </Table>
  </Sheet>
</Data>
```

`stickyHeader` (and `stickyFooter` for `tfoot`) only pins when the table sits
in a scroll container with a bounded height, as above.

## Props

`variant`, `color`, and `size` follow the shared
[styling props](./styling.md#color-variant-and-size). All props are static
generation-time values.

- `borderAxis`: `"xBetween"` (default, lines between rows), `"x"` (rows plus
  outer edges), `"yBetween"`, `"y"`, `"bothBetween"`, `"both"`, or `"none"`.
- `stripe`: `"odd"` or `"even"` zebra rows. `hoverRow` highlights body rows.
- `noWrap`: truncate overflowing cell text with an ellipsis, for dense
  operational tables.

See `TableProps` in `components/table` for the full contract.
