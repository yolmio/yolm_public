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

`SimplePivotTable` renders a self-contained, interactive pivot table. You declare which fields can be used as rows, columns, and aggregated values through a builder callback; the component renders dropdowns for the user to choose a row field, column field, value field, and aggregate function, then runs the query, shows row/column totals, and offers a CSV export.

Use it for ad-hoc cross-tab analysis over your schema. For a fixed, non-pivoting tabular view use `DataTable` / `Table` instead.

```tsx
import { SimplePivotTable } from "components/simple_pivot_table";
```

## Usage

The component manages its own state and data fetching, so you do not need to wrap it in a `Data` or `Form`. It is not self-routing, so place it inside your page/`Route` layout. Define fields with the `builder` callback. The component fills the height and width of its container, so give it a sized parent.

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

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `builder` | `(b: PivotTableBuilder) => void` | Yes | Callback that declares the row/column and value fields. See the builder methods below. |
| `layout` | `"horizontal" \| "vertical"` | No | Arrangement of the config controls relative to the results. Default `"horizontal"`. |
| `hideConfigCard` | `boolean` | No | Hides the dropdown/config card so only the table renders. |
| `cardSx` | `Style` | No | Extra styles merged onto the config card (which already has `p: 4`). |
| `defaultAggregateFunction` | `string` | No | Initially selected aggregate. Default `"sum"`. Must match a value in `aggregateOptions`. |
| `aggregateOptions` | `{ value: string; label: string }[]` | No | Options for the aggregate-function dropdown. Default `[{sum, Sum}, {avg, Average}, {min, Minimum}, {max, Maximum}]`. |
| `excludeTables` | `string[]` | No | Tables to omit when automatically discovering foreign-key relationships. |

## Builder methods

The `builder` callback receives a `PivotTableBuilder`. Call its methods to register the fields the user can choose from. Each `field` / `virtualField` becomes an option in **both** the Row and Column dropdowns; each value/calculated/count field becomes an option in the Value dropdown.

| Method | Arguments | Description |
|--------|-----------|-------------|
| `field` | `{ tableName: string; fieldName: string; label?: string; formatHeader?: (props: { value: Sql }) => Node }` | Adds a real schema field as a row/column option. Throws at generation time if the table or field does not exist. `label` defaults to the field's display name; `formatHeader` defaults to an `InlineFieldDisplay` of the field. |
| `virtualField` | `{ name: string; expression: string; involvedFields: string[]; tables: string[]; label?: string }` | Adds a computed row/column option. `expression` is a raw SQL string; `involvedFields` lists the underlying field names used for grouping; `tables` lists the tables the expression touches. `label` defaults to a title-cased `name`. |
| `valueField` | `{ tableName: string; fieldName: string; label?: string }` | Adds a real field as an aggregatable value option. `label` defaults to a title-cased `fieldName`. |
| `calculatedValueField` | `{ name: string; expression: string; involvedFields: string[]; tables: string[]; label?: string }` | Adds a computed (raw SQL) aggregatable value option. `label` defaults to a title-cased `name`. |
| `simpleCount` | `(tableName: string, label?: string)` | Convenience value field that counts rows of `tableName`. Positional arguments. `label` defaults to `"<Table> Count"`. |
| `relatedCount` | `{ countTable: string; parentTable: string; throughField?: string }` | Convenience value field counting `countTable` rows related to `parentTable` via a foreign key. If `throughField` is omitted, the first FK from `countTable` to `parentTable` is used. Throws if either table or the FK is not found. |

## Behavior

- **Self-contained state and fetching.** The component defines its own `selected_row`, `selected_column`, `selected_value`, and `selected_aggregate` state and runs the pivot query via a dynamic query. You do not place it inside your own `Data`/`Form` context, and it is **not** self-routing — put it inside your page/`Route` layout.
- **Automatic joins.** Table relationships are discovered from foreign keys across the whole schema, and intermediate join tables are filled in automatically. You do not declare joins.
- **Initial selection.** The row defaults to the first registered row/column field, the column to the **second**, and the value to the first registered value field.
- **Totals and export.** The results table renders per-row and per-column totals plus a grand total, and the config card includes an Export button that downloads the pivot as `pivot_table_export.csv`.

## SQL-expression expectations

`expression`, `involvedFields`, and `tables` are plain strings, not `sql` tagged templates. Reference columns with fully qualified `table.field` names (e.g. `"concat(employees.first_name, ' ', employees.last_name)"`). `involvedFields` should list the raw column names that the expression depends on so grouping works correctly.

## Common Mistakes

- **Defining fewer than two row/column fields, or no value field.** The initial column selection uses the *second* registered `field`/`virtualField`, so you must register at least two of them plus at least one value field; otherwise generation fails.
- **Passing table presentation props such as `sx` or `className`.** Use `cardSx` to style the config card and size the component through its parent container.
- **Expecting a custom label on `relatedCount`.** It always names the value option `"<CountTable> Count"`. Use `calculatedValueField` directly if you need a custom label.
- **Treating `field`/`virtualField` as row-only or column-only.** Every such call is offered as both a row and a column option; there is no separate row vs. column list.
- **Wrapping `expression` in `sql` templates.** Pass raw SQL strings with fully qualified identifiers; the component assembles the dynamic query itself.
- **Setting `defaultAggregateFunction` to a value not present in `aggregateOptions`.** The dropdown will have no matching option.
