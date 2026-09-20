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

The Table component renders an HTML `<table>` with consistent styling, supporting borders, striped rows, hover effects, sticky headers, and size variants.

```tsx
import { Table } from "components/table";
```

## Basic Usage

```tsx
<Table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Email</th>
      <th>Role</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Alice</td>
      <td>alice@example.com</td>
      <td>Admin</td>
    </tr>
    <tr>
      <td>Bob</td>
      <td>bob@example.com</td>
      <td>User</td>
    </tr>
  </tbody>
</Table>
```

## Common Props

Use the exported TypeScript props for the full `Table` contract. The props
agents usually need are:

- `size`, `variant`, `color`, and `borderAxis` for generation-time styling.
- `hoverRow`, `stripe`, `stickyHeader`, and `stickyFooter` for table behavior.
- `noWrap` for dense operational tables where cells should truncate.
- `className` for layout and scroll-container sizing.

`color`, `variant`, `size`, and `borderAxis` are generation-time strings only,
not SQL expressions.

## Border Axis

The `borderAxis` prop controls which borders appear:

| Value | Description |
|-------|-------------|
| `"none"` | No borders |
| `"x"` | Horizontal borders on all rows including outer edges |
| `"xBetween"` | Horizontal borders between rows only (default) |
| `"y"` | Vertical borders on all columns including outer edges |
| `"yBetween"` | Vertical borders between columns only |
| `"both"` | Full grid with outer borders |
| `"bothBetween"` | Full grid without outer borders |

```tsx
// Full grid borders
<Table borderAxis="both">...</Table>

// No borders at all
<Table borderAxis="none">...</Table>

// Only horizontal lines between rows (default)
<Table borderAxis="xBetween">...</Table>
```

## Size Variants

```tsx
// Extra-compact table
<Table size="xs">...</Table>

// Compact table
<Table size="sm">...</Table>

// Default
<Table size="md">...</Table>

// Spacious table
<Table size="lg">...</Table>
```

## Striped and Hover Rows

```tsx
// Striped odd rows with hover effect
<Table stripe="odd" hoverRow>
  <thead>
    <tr>
      <th>Product</th>
      <th>Price</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Widget</td><td>$10</td></tr>
    <tr><td>Gadget</td><td>$20</td></tr>
    <tr><td>Doohickey</td><td>$15</td></tr>
  </tbody>
</Table>
```

## Sticky Header

Wrap the table in a scrollable container and enable `stickyHeader` to keep column headers visible:

```tsx
<div className="max-h-[400px] overflow-auto">
  <Table stickyHeader>
    <thead>
      <tr>
        <th>Name</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {/* many rows */}
    </tbody>
  </Table>
</div>
```

## Rendering Dynamic Data with Each

Use the `Each` component from `std/ui` to iterate over query results:

```tsx
import { Table } from "components/table";
import { Each } from "std/ui";
import { Data } from "std/data";
import { sql } from "std/sql_utils";

function OrdersTable() {

  return (
    <Data procedure={(s) => {
      s.defTable("orders", sql`select id, customer_name, total, status from db.orders order by id desc`);
    }}>
      <Table stickyHeader hoverRow stripe="odd">
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
    </Data>
  );
}
```

## Wrapping in a Sheet

For a bordered, elevated table container, wrap in a `Sheet` component:

```tsx
import { Sheet } from "components/sheet";
import { Table } from "components/table";

<Sheet className="overflow-auto" variant="outlined">
  <Table stickyHeader hoverRow borderAxis="xBetween" size="sm">
    <thead>
      <tr>
        <th>Column A</th>
        <th>Column B</th>
      </tr>
    </thead>
    <tbody>
      <Each table="data" recordName="row">
        <tr>
          <td>{sql`row.col_a`}</td>
          <td>{sql`row.col_b`}</td>
        </tr>
      </Each>
    </tbody>
  </Table>
</Sheet>
```

## Selection Guidance

Use `Table` when you need direct control over markup, captions, row layout, or
custom cells. Use `DataTable` / `DataTablePage` when you want a higher-level
record list with built-in column configuration, actions, and page scaffolding.
