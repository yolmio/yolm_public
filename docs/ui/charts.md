---
title: Charts
description: How to use BarChart, LineChart, and PieChart in Yolm dashboards and reports with SQL queries, axes, labels, tooltips, and chart-ready data.
tags:
  - ui
  - charts
  - reporting
  - dashboards
related:
  - ui/reporting.md
  - ui/dashboards.md
  - ui/data.md
---

# Charts

Use query-driven SVG charts for dashboards and reports.

```tsx
import { BarChart } from "vis/bar_charts";
import { LineChart } from "vis/line_charts";
import { PieChart } from "vis/pie_chart";
```

Use the exported TypeScript props for exact signatures. This page focuses on
query shape and common composition.

## Choose A Chart

| Need | Use | Query shape |
| --- | --- | --- |
| Compare categories | `BarChart` | label column + one or more numeric columns |
| Trend over time | `LineChart` | ordered label/date column + one or more numeric columns |
| Show proportions | `PieChart` | `name` column + numeric `value` column |
| KPI line panel with light/dark theme | `WiseChart` | `label` column + `value` column |
| WISE-style stat panel with optional second series | `WiseStatLineChart` | `label`/time column + numeric value columns |

## Bar Chart

```tsx
<BarChart
  query={sql`
    select status::text as name, count(*) as count
    from db.orders
    group by status
    order by count desc
  `}
  height={300}
>
  <BarChart.CartesianGrid />
  <BarChart.XAxis />
  <BarChart.YAxis />
  <BarChart.XAxisLabels columnName="name" />
  <BarChart.YAxisLabels />
  <BarChart.Bar columnName="count" fill="#3b82f6" />
  <BarChart.Tooltip />
</BarChart>
```

## Line Chart

```tsx
<LineChart
  query={sql`
    select
      format.date(date_trunc('week', created_at), '%b %d') as week,
      count(*) as orders
    from db.orders
    where created_at >= today() - interval '12 weeks'
    group by date_trunc('week', created_at)
    order by date_trunc('week', created_at)
  `}
  height={300}
>
  <LineChart.CartesianGrid />
  <LineChart.XAxis />
  <LineChart.YAxis />
  <LineChart.XAxisLabels columnName="week" />
  <LineChart.YAxisLabels />
  <LineChart.Line column="orders" stroke="#3b82f6" strokeWidth={2} />
  <LineChart.Tooltip />
</LineChart>
```

Use multiple `LineChart.Line` children when comparing numeric series.

## Pie Chart

```tsx
<PieChart
  query={sql`
    select status::text as name, count(*) as value
    from db.orders
    group by status
  `}
  size={320}
>
  <PieChart.Pie columnName="value" labels={{}} />
  <PieChart.Tooltip />
</PieChart>
```

Keep pie charts to a small number of segments. Use `limit` or group small
categories into "Other" in SQL.

## Wise Chart

`WiseChart` is a pre-themed wrapper around `LineChart` for KPI panels.
It expects two-column rows (`label`, `value`), highlights downward
segments in red, and works in both light and dark themes.

```tsx
import { WiseChart } from "vis/wise_chart";

<WiseChart
  query={sql`
    select format.date(day, '%-m/%-d') as label,
           total_minutes / 60 as value
    from query_result
  `}
  low={0}
  high={40}
/>
```

Reach for `WiseChart` when you want a labelled KPI line without
re-styling `LineChart` from scratch; reach for `LineChart` directly
when you need full control of axes, lines, and tooltips.

## Wise Stat Line Chart

`WiseStatLineChart` from `components/wise_stat_line_chart` renders a titled
stat panel with axis divisions, optional owner header/label content, and an
optional dashed second series.

```tsx
import { WiseStatLineChart } from "components/wise_stat_line_chart";

<WiseStatLineChart
  title="Revenue"
  query={sql`
    select day as period_start_date, revenue as value
    from daily_revenue
    order by day
  `}
  valueFormat="currency"
  graphLow={sql`0`}
  graphDivision={sql`10000`}
/>
```

`valueFormat` is `WiseStatValueFormat`: `"number"`, `"number_thousands"`,
`"currency"`, `"percentage"`, or `"duration"`. Pass `series2` with its own
`query`, `label`, and optional axis settings for dual-series charts.

For dashboards that also expose a focused graph route, pass `viewHref` to add
a compact View action above the panel. Render the focused route with
`displaySize="page"`; the chart stays vector-based and expands to a larger
screen and print size. The route remains responsible for light navigation and
`@media print` page chrome; users can invoke the browser print dialog with
Ctrl+P or Cmd+P.

## Chart Data Rules

- Aggregate in SQL before rendering.
- Order time-series queries by the underlying date expression, not only the
  formatted label.
- Use `format.date`, `format.currency`, or `format.decimal` for labels/tooltips.
- Use parent `Data` when several charts share filters or date ranges.
- Prefer [Reporting](./reporting.md) / `StatRow` for dashboards that combine
  charts, KPIs, and tables.

## Shared Filter Pattern

```tsx
<Data procedure={(s) => {
  s.defScalar("date_from", sql`today() - interval '30 days'`);
}}>
  <BarChart query={sql`
    select status::text as name, count(*) as count
    from db.orders
    where created_at >= date_from
    group by status
  `}>
    <BarChart.XAxis />
    <BarChart.YAxis />
    <BarChart.XAxisLabels columnName="name" />
    <BarChart.Bar columnName="count" fill="#3b82f6" />
    <BarChart.Tooltip />
  </BarChart>
</Data>
```
