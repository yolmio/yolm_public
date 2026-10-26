---
title: Dashboards
description: Composing Yolm dashboards from StatRow, charts, DataTable, and Card in a grid, with tabbed views and skeleton loading states.
tags:
  - ui
  - dashboards
  - components
related:
  - ui/reporting.md
  - ui/charts.md
  - ui/data.md
---

# Dashboards

A dashboard is a Tailwind grid of `StatRow` KPIs, [charts](./charts.md),
`DataTable`s, and `Card` sections. Aggregate in SQL. For a multi-report
section with navigation, use [`ReportsPage`](./reporting.md#reportspage).

## Layout

Lead with the numbers the user acts on; add a section only when it supports a
decision.

Each `Stat` evaluates `value`, then `previous`, then `trend` as scalars named
`value` / `previous`, so `trend` can reference the other two. A positive trend
renders as a success chip, negative as danger. Omit chart `width`/`height` so
the chart sizes to its container.

```tsx
import { StatRow } from "components/stat_row";
import { Card, CardHeader } from "components/card";
import { DataTable } from "components/data_table";
import { cssVar } from "std/style_utils";
import { BarChart } from "vis/bar_charts";

function Dashboard() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4">
      <StatRow
        className="col-span-12"
        stats={[
          {
            title: sql.lit`Revenue, 30 days`,
            value: sql`(select sum(total) from db.orders where created_at >= today() - interval '30 days')`,
            previous: sql`(select sum(total) from db.orders where created_at >= today() - interval '60 days' and created_at < today() - interval '30 days')`,
            trend: sql`coalesce(cast((value - previous) as decimal(10,2)) / nullif(cast(previous as decimal(10,2)), 0), 0)`,
            formatValue: (v) => sql`format.currency(${v}, 'USD')`,
            formatPrevious: (v) => sql`format.currency(${v}, 'USD')`,
          },
          {
            title: sql.lit`Orders, 30 days`,
            value: sql`(select count(*) from db.orders where created_at >= today() - interval '30 days')`,
          },
          {
            title: sql.lit`Awaiting shipment`,
            value: sql`(select count(*) from db.orders where status = 'confirmed')`,
          },
        ]}
      />

      <Card className="col-span-12 lg:col-span-7">
        <CardHeader>Awaiting shipment</CardHeader>
        <DataTable
          query={sql`
            select id, order_number, customer_id, total, created_at
            from db.orders
            where status = 'confirmed'
          `}
          primaryTable="orders"
          defaultSort={{ column: "created_at", direction: "asc" }}
          pageSize={10}
          size="sm"
          variant="plain"
          columns={(b) => {
            b.field("order_number", "Order #");
            b.recordDisplayColumn("customer_id", "customers", "Customer");
            b.usdColumn("total", "Amount");
            b.dateColumn("created_at", "%b %d", "Ordered");
          }}
        />
      </Card>

      <Card className="col-span-12 lg:col-span-5">
        <CardHeader>Revenue by category, 30 days</CardHeader>
        <BarChart
          query={sql`select c.name, sum(total) as revenue from db.orders o join db.categories c on o.category_id = c.id where o.created_at >= today() - interval '30 days' group by c.name order by revenue desc`}
        >
          <BarChart.CartesianGrid />
          <BarChart.XAxisLabels columnName="name" />
          <BarChart.YAxisLabels format={(v) => sql`format.currency(${v}, 'USD')`} />
          <BarChart.Bar columnName="revenue" fill={cssVar("palette-primary-400")} />
          <BarChart.Tooltip />
        </BarChart>
      </Card>
    </div>
  );
}
```

## Tabbed Dashboards

For several views, hold the active tab in a `local` `Data` scalar and bind
[Tabs](./tabs.md) with `selectedTabScalar`; each `Tabs.Panel` renders one
dashboard.

## Loading States

Each `Stat` shows its own skeleton while loading. For cards wrapped in your own
`Data`, replace the default `CircularProgress` with a `Skeleton` sized like
the content:

```tsx
<Data
  procedure={(s) => s.defTable("top_products", sql`select ...`)}
  pendingFallback={<Skeleton className="h-64 w-full rounded-md" />}
>
  {/* card content */}
</Data>
```

## See Also

- [Reporting](./reporting.md) - `ReportsPage`, URL-synced filters
- [Charts](./charts.md) - `BarChart`, `LineChart`, `PieChart`
- [Data](./data.md) - data loading and `pendingFallback`
