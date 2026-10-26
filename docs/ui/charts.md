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
  - sql/date_functions.md
---

# Charts

Use query-driven SVG charts for dashboards and reports.

```tsx
import { BarChart } from "vis/bar_charts";
import { LineChart } from "vis/line_charts";
import { PieChart } from "vis/pie_chart";
```

Charts are composed from sub-components (grid, axes, labels, series, tooltip)
inside the chart root; the exported TypeScript props are the exact contracts.

## Choose A Chart

| Need | Use | Query shape |
| --- | --- | --- |
| Compare categories | `BarChart` | label column + one or more numeric columns |
| Trend over time | `LineChart` | ordered label/date column + one or more numeric columns |
| Show proportions | `PieChart` | `name` column + numeric `value` column |
| KPI line panel | `WiseChart` | `label` + numeric `value` |
| WISE-style stat panel, optional second series | `WiseStatLineChart` | `period_start_date` (date) + numeric `value` |

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

Group small categories into "Other" in SQL to keep segments few.

## WiseChart

`WiseChart` (`vis/wise_chart`) is a pre-themed `LineChart` for KPI panels: it
reads `label` and `value` (other columns are ignored), clamps the y-axis to
`low`/`high`, highlights downward segments in red, and supports light and dark
themes.

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

## WiseStatLineChart

`WiseStatLineChart` (`components/wise_stat_line_chart`) renders a titled stat
panel. `query` must select `period_start_date` and `value`; the y-axis has 10
divisions from the data low (or `graphLow`), and a too-small `graphDivision`
grows by 1-2-5 multiples of itself until the data fits.

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

Build period queries with
[`time_bucket_gapfill`](../sql/date_functions.md#per-period-series).

`valueFormat` is `"number"`, `"number_thousands"`, `"currency"`,
`"percentage"`, or `"duration"` (minutes, shown as hours and minutes), or a
runtime SQL expression. `reverseAxis` puts low values on top for
lower-is-better stats. `series2` (`query`, `label`, optional axis settings,
same value format) adds a dashed series on a right-hand axis.

For a focused graph route, pass `viewHref` to add a compact View action, and
render the route with `displaySize="page"` (vector output enlarged for screen
and print). That route owns its navigation and `@media print` page chrome.

## Chart Data Rules

- Aggregate in SQL before rendering.
- Order time-series queries by the underlying date expression, not only the
  formatted label.
- Use `time_bucket_gapfill` for one row per period, not a date-range join.
- Use `format.date`, `format.currency`, or `format.decimal` for labels/tooltips.

- Chart queries can reference scalars from an enclosing `Data` (for example a
  shared `date_from` filter).
