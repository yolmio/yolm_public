---
title: Reporting And Dashboards
description: How to build Yolm reports and dashboards with ReportsPage, Data queryParams, DataTable, StatRow, BarChart, LineChart, PieChart, and URL-synced filters.
tags:
  - ui
  - reporting
  - dashboards
  - charts
related:
  - ui/charts.md
  - ui/data_table.md
  - ui/data.md
  - ui/dashboards.md
---

# Reporting And Dashboards

Use reporting primitives for read-heavy pages: KPI summaries, filtered tables,
charts, and multi-report navigation.

## Choose The Primitive

| Need | Use |
| --- | --- |
| Multi-report section with sidebar nav | `ReportsPage` |
| KPI row | `StatRow` |
| Query-backed table | `DataTable` |
| Bar/line/pie visualization | `BarChart`, `LineChart`, `PieChart` |
| URL-synced filters | `Data queryParams` |

Use the exported TypeScript props for exact prop shapes.

## ReportsPage

```tsx
import { ReportsPage } from "pages/reports_page";
import { Route } from "std/ui";

<ReportsPage
  path="/reports"
  defaultPath="overview"
  sections={[
    {
      header: "Sales",
      reports: [
        { label: "Overview", path: "overview" },
        { label: "By Product", path: "by-product" },
      ],
    },
  ]}
>
  <Route path="overview">
    <SalesOverview />
  </Route>
  <Route path="by-product">
    <SalesByProduct />
  </Route>
</ReportsPage>
```

`ReportsPage` creates its own outer route at `path`; child routes are relative
report paths.

## URL-Synced Filters

```tsx
<Data
  queryParams={{
    start_date: { default: sql`today() - interval '30 days'`, type: "Date" },
    end_date: { default: sql`today()`, type: "Date" },
  }}
>
  <DataTable
    query={sql`
      select product_name, sum(total) as revenue
      from db.orders
      where order_date between start_date and end_date
      group by product_name
      order by revenue desc
    `}
    columns={(b) => {
      b.simpleColumn("product_name", "Product");
      b.formatColumn("revenue", (v) => sql`format.currency(${v}, 'USD')`);
    }}
  />
</Data>
```

Use `default` in `queryParams`. Use `s.refetch()` after mutations that should
refresh report data.

## Dashboard Composition

```tsx
<div className="grid grid-cols-12 gap-4">
  <StatRow
    className="col-span-12"
    stats={[
      { title: "Revenue", value: sql`revenue_total`, formatValue: (v) => sql`format.currency(${v}, 'USD')` },
      { title: "Orders", value: sql`order_count` },
    ]}
  />

  <div className="col-span-12 lg:col-span-6">
    <BarChart query={sql`select status::text as name, count(*) as count from db.orders group by status`}>
      <BarChart.XAxis />
      <BarChart.YAxis />
      <BarChart.XAxisLabels columnName="name" />
      <BarChart.Bar columnName="count" fill="#3b82f6" />
      <BarChart.Tooltip />
    </BarChart>
  </div>
</div>
```

## Rules

- Aggregate in SQL; keep UI components focused on display.
- Use `Data queryParams` for filters users should bookmark or share.
- Keep charts limited to data users can compare quickly.
- Prefer `DataTable` for drill-down rows and `StatRow` for headline metrics.
- Use one report route per distinct question rather than one giant dashboard.
