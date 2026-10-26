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

Exported TypeScript props are the exact contracts. Dashboard layout and
loading states are in [Dashboards](./dashboards.md); chart query shapes are in
[Charts](./charts.md).

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

`ReportsPage` creates its own outer route at `path` with a sidebar of links
(a collapsible toggle on mobile); child `Route`s use the relative report
paths, and unmatched paths (including `path` itself) redirect to
`defaultPath`. `sections` may also be
a flat `{ label, path }[]` list without headers.

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

## Rules

- Aggregate in SQL; keep UI components focused on display.
- Use `Data queryParams` for filters users should bookmark or share.
- Use `DataTable` for drill-down rows and `StatRow` for headline metrics.
- Give each distinct question its own report route.
