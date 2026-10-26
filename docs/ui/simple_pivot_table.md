---
title: SimplePivotTable
description: Configurable pivot table where users pick row/column and value fields, choose an aggregate function, view totals, and export to CSV.
tags:
  - ui
  - components
  - pivot-table
  - table
  - analytics
related:
  - ui/overview.md
  - ui/data.md
  - ui/select.md
  - ui/table.md
---

# SimplePivotTable

`SimplePivotTable` is a self-contained pivot table: users pick a row field,
column field, value field, and aggregate; it shows row, column, and grand
totals and exports CSV. Use `DataTable` or `Table` for fixed, non-pivoting
views.

```tsx
import { SimplePivotTable } from "components/simple_pivot_table";
```

## Example

It owns its state and query, so do not wrap it in `Data` or `Form`. It is not
self-routing; place it in your page layout inside a sized parent, since it
fills its container.

```tsx
<SimplePivotTable
  layout="vertical"
  builder={(b) => {
    // Fields usable as either a row or a column.
    b.field({ tableName: "categories", fieldName: "name", label: "Category" });
    b.field({
      tableName: "customers",
      fieldName: "company_name",
      label: "Customer",
    });
    b.field({ tableName: "customers", fieldName: "country" });

    // Computed row/column field (raw SQL expression).
    b.virtualField({
      name: "quarter",
      expression:
        "concat(cast(date.part(year, orders.order_date) as string), ' Q', cast(extract(quarter from orders.order_date) as string))",
      involvedFields: ["order_date"],
      tables: ["orders"],
    });

    // Values to aggregate.
    b.valueField({ tableName: "order_details", fieldName: "quantity" });
    b.calculatedValueField({
      name: "total_order_value",
      expression: `cast(
        cast(order_details.unit_price as decimal(15,2)) *
        cast(order_details.quantity as decimal(15,2)) *
        (1 - cast(order_details.discount as decimal(15,2)))
        as decimal(15,2)
      )`,
      involvedFields: ["unit_price", "quantity", "discount"],
      tables: ["order_details"],
    });
  }}
/>
```

(Adapted from `examples/northwind/apps/northwind.yolmstaging.net.tsx`.)

## Props

- `layout`: `"horizontal"` (default) or `"vertical"` placement of the config
  card relative to the results.
- `hideConfigCard`: render only the results table.
- `cardSx`: static styles merged onto the config card. There is no
  `className`/`sx`; size the component through its parent.
- `aggregateOptions` (default sum, avg, min, max) and
  `defaultAggregateFunction` (default `"sum"`, must be one of the options).
- `excludeTables`: tables skipped when discovering FK relationships.

## Builder Methods

Each `field`/`virtualField` is offered in **both** the Row and Column
dropdowns; each value, calculated, or count field in the Value dropdown.

| Method | Arguments | Notes |
|--------|-----------|-------|
| `field` | `{ tableName, fieldName, label?, formatHeader? }` | Real field; throws at generation time if missing. Headers default to `InlineFieldDisplay`. |
| `virtualField` | `{ name, expression, involvedFields, tables, label? }` | Computed row/column option. |
| `valueField` | `{ tableName, fieldName, label? }` | Real aggregatable field. |
| `calculatedValueField` | `{ name, expression, involvedFields, tables, label? }` | Computed aggregatable value. |
| `simpleCount` | `(tableName, label?)` | Counts rows; label defaults to `"<Table> Count"`. |
| `relatedCount` | `{ countTable, parentTable, throughField? }` | Counts related rows via an FK (first FK to `parentTable` when `throughField` is omitted). Label is always `"<CountTable> Count"`; use `calculatedValueField` for a custom one. |

`expression`, `involvedFields`, and `tables` are plain strings, not `sql`
templates: the component assembles a dynamic query from them. Use fully
qualified `table.field` identifiers, list in `involvedFields` the raw columns
the expression groups on, and list every table it touches in `tables`.

## Behavior

- State scalars `selected_row`, `selected_column`, `selected_value`, and
  `selected_aggregate` are declared internally. Initial selection: the first
  row/column field as row, the second (or the first, when only one exists) as
  column, and the first value field.
- At least one row/column field and one value field are required; otherwise
  generation throws.
- Joins are discovered from foreign keys across the schema, including
  intermediate tables; you never declare joins.
- Export downloads `pivot_table_export.csv`.
