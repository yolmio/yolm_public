---
title: Dashboards
description: Guide to building interactive dashboards in Yolm with Data, charts, statistics, and grid layouts.
tags:
  - ui
  - dashboards
  - components
---

# Dashboards

Dashboards combine statistics, charts, and tables into a unified data view. Yolm provides the building blocks for rich, interactive dashboards.

Key components for building dashboards:

- `Data` - Fetches data and manages dashboard state
- `StatRow` - Row of KPI statistics with trends
- `DataTable` - Feature-rich data tables
- `BarChart` / `LineChart` / `PieChart` - Chart visualizations
- `Card` / `CardHeader` - Container components for dashboard sections

## Dashboard Layout

Use CSS grid classes for responsive dashboard layouts:

```tsx
import { Data } from "std/data";
import { StatRow } from "components/stat_row";
import { DataTable } from "components/data_table";
import { Card, CardHeader } from "components/card";
import { cssVar } from "std/style_utils";
import { BarChart } from "vis/bar_charts";
import { PieChart } from "vis/pie_chart";

function Dashboard() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4">
      {/* Full-width stats */}
      <StatRow
        className="col-span-12"
        header="Key Metrics"
        stats={[
          {
            title: sql.lit`Revenue`,
            value: sql`(select sum(total) from db.orders where created_at >= today() - interval '30 days')`,
            previous: sql`(select sum(total) from db.orders where created_at between today() - interval '60 days' and today() - interval '30 days')`,
            trend: sql`coalesce(cast((value - previous) as decimal(10,2)) / nullif(cast(previous as decimal(10,2)), 0), 0)`,
          },
          {
            title: sql.lit`Orders`,
            value: sql`(select count(*) from db.orders where created_at >= today() - interval '30 days')`,
          },
        ]}
      />

      {/* Half-width charts */}
      <Card className="col-span-12 md:col-span-6">
        <CardHeader variant="soft">Revenue by Category</CardHeader>
        <BarChart
          query={sql`select c.name, sum(total) as revenue from db.orders o join db.categories c on o.category_id = c.id group by c.name order by revenue desc`}
          width={600} height={300}
        >
          <BarChart.CartesianGrid />
          <BarChart.XAxisLabels columnName="name" />
          <BarChart.YAxisLabels format={(v) => sql`format.currency(${v}, 'USD')`} />
          <BarChart.Bar columnName="revenue" fill={cssVar("palette-primary-400")} />
          <BarChart.Tooltip />
        </BarChart>
      </Card>

      <Card className="col-span-12 md:col-span-6">
        <CardHeader variant="soft">Order Distribution</CardHeader>
        <PieChart
          query={sql`select status::text as name, count(*) as value from db.orders group by status`}
          size={400}
        >
          <PieChart.Pie columnName="value" innerRadius={80} outerRadius={150} />
          <PieChart.Tooltip />
        </PieChart>
      </Card>

      {/* Full-width table */}
      <DataTable
        className="col-span-12"
        header="Recent Orders"
        query={sql`select * from db.orders order by created_at desc limit 10`}
        primaryTable="orders"
        columns={(b) => {
          b.field("customer_id");
          b.field("order_date");
          b.field("shipped_date");
        }}
      />
    </div>
  );
}
```

## Tab-Based Dashboards

Use `Data local` to manage tab state for dashboards with multiple views:

```tsx
import { Data } from "std/data";
import { Tabs } from "components/tabs";

function TabbedDashboard() {
  return (
    <Data local procedure={(s) => {
      s.defScalar("active_tab", sql.lit`overview`);
    }}>
      <Tabs selectedTabScalar="active_tab">
        <Tabs.List>
          <Tabs.Tab value={sql.lit`overview`}>Overview</Tabs.Tab>
          <Tabs.Tab value={sql.lit`sales`}>Sales</Tabs.Tab>
          <Tabs.Tab value={sql.lit`inventory`}>Inventory</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value={sql.lit`overview`}>
          <OverviewDashboard />
        </Tabs.Panel>
        <Tabs.Panel value={sql.lit`sales`}>
          <SalesDashboard />
        </Tabs.Panel>
        <Tabs.Panel value={sql.lit`inventory`}>
          <InventoryDashboard />
        </Tabs.Panel>
      </Tabs>
    </Data>
  );
}
```

## Dashboard with ReportsPage

For dashboards that are part of a larger reports section, use `ReportsPage`:

```tsx
import { ReportsPage } from "pages/reports_page";
import { Route } from "std/ui";

<ReportsPage
  path="/"
  defaultPath="dashboard"
  sections={[
    {
      header: "Overview",
      reports: [{ label: "Dashboard", path: "dashboard" }],
    },
    {
      header: "Reports",
      reports: [
        { label: "Sales Report", path: "sales" },
        { label: "Inventory", path: "inventory" },
      ],
    },
  ]}
>
  <Route path="dashboard">
    <div className="grid grid-cols-12 gap-4 p-4">
      {/* Dashboard content... */}
    </div>
  </Route>
  <Route path="sales">
    {/* Sales report content... */}
  </Route>
  <Route path="inventory">
    {/* Inventory content... */}
  </Route>
</ReportsPage>
```

## See Also

- [Reporting](./reporting.md) - Full reporting guide with ReportsPage
- [Charts](./charts.md) - BarChart, LineChart, PieChart reference
- [Data Component](./data.md) - Data fetching and state management
