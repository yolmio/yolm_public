---
title: Manual Stats Block
description: Developer-defined manual stat metrics with an enum-backed entries table, ready-made entry and dashboard pages, and WISE-style line charts.
tags:
  - blocks
  - stats
  - metrics
  - charts
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# Manual Stats Block

`ManualStatsBlock` defines a fixed set of developer-declared metrics ("manual
stats") that users enter by hand for a reporting period. It generates an enum
of stat types, an entries table keyed by `(stat_type, period_start_date)`, and
ships ready-made entry and dashboard pages plus WISE-style line-chart helpers.

Use it when the values are hand-entered each period (finance figures, outreach
counts, meeting numbers). For metrics derived from existing tables, render
`WiseStatLineChart` from `components/wise_stat_line_chart` with a query instead
of storing manual rows.

```ts
import {
  ManualStatsBlock,
  ManualStatsDashboardPage,
  ManualStatsDualLineChart,
  ManualStatsEntryPage,
  ManualStatsLineChart,
} from "blocks/manual_stats";
import type {
  ManualStatCadence,
  ManualStatDefinition,
  ManualStatsBlockOptions,
  ManualStatsDateRange,
  ManualStatTargetDirection,
  ManualStatValueFormat,
} from "blocks/manual_stats";
```

## Setup

Construct the block in `core.tsx`, export the instance, and register it. Each
entry in `stats` declares one metric.

```tsx
import { ManualStatsBlock } from "blocks/manual_stats";
import { sql } from "std/sql_utils";
import { system } from "std/system";

export const exampleManualStatsBlock = new ManualStatsBlock({
  name: "example",
  defaultEntryDate: sql`date.last_weekday(current_date(), date.thursday())`,
  stats: [
    {
      name: "income_weekly",
      displayName: "Div 3_1 Income Weekly",
      description: "Weekly income reported by finance.",
      valueFormat: "currency",
      unit: "In Dollars",
      graphDivision: sql`50000`,
      ownerHeader: "Finance Manager",
      ownerLabel: "Laura Thompson",
      sortOrder: 30,
    },
  ],
});

system.addBlock(exampleManualStatsBlock);
```

Then mount the pages and/or charts inside an app `.tsx`, importing the exported
instance:

```tsx
import { ManualStatsEntryPage, ManualStatsLineChart } from "blocks/manual_stats";
import { exampleManualStatsBlock } from "../core";

// Inside <AppRoutes> — the page self-routes, do NOT wrap it in <Route>.
<ManualStatsEntryPage
  block={exampleManualStatsBlock}
  path="/manual-entries"
  title="Enter Staff Meeting Stats"
  subtitle="Enter the manual outreach and finance values for the stat date."
/>;

// Anywhere in a page body:
<ManualStatsLineChart block={exampleManualStatsBlock} stat="income_weekly" />;
```

## Configuration

`ManualStatsBlockOptions`:

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | yes | snake_case prefix for the generated enum and table. Must match `^[a-z][a-z0-9_]*$`. |
| `stats` | `ManualStatDefinition[]` | yes | The metric definitions. At least one, and at least one with `active` not `false`, is required. |
| `enumName` | `string` | no | Stat-type enum name. Default `` `${name}_manual_stat_type` ``. |
| `tableName` | `string` | no | Entries table name. Default `` `${name}_manual_stat_entries` ``. |
| `trackEnteredBy` | `boolean` | no | When `true`, adds an `entered_by` FK to `sys_users`. Default `true`. |
| `includeNotes` | `boolean` | no | When `false`, omits the optional notes column. Default `true`. |
| `defaultEntryDate` | `Sql` | no | Default period date for the entry page. Default `` sql`current_date()` ``. |
| `defaultStartDate` | `Sql` | no | Default chart/dashboard range start. Default `` sql`date.add(day, -84, current_date())` ``. |
| `defaultEndDate` | `Sql` | no | Default chart/dashboard range end. Default `` sql`current_date()` ``. |
| `extendEntryTable` | `(table: TableBuilder) => void` | no | Callback to add extra columns/constraints to the entries table. |

### Stat definition

`ManualStatDefinition`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | yes | snake_case enum value for this metric. Must be unique within the block. |
| `displayName` | `string` | yes | Human label shown on charts, entry rows, and the enum. |
| `description` | `string` | no | Longer explanation; shown on entry rows and as a chart empty-state hint. |
| `valueFormat` | `ManualStatValueFormat` | no | Display/formatting mode. Default `"number"`. |
| `cadence` | `ManualStatCadence` | no | Informational cadence label. Default `"weekly"`. |
| `unit` | `string` | no | Unit label passed to the chart. |
| `quota` | `NumericExpr` | no | Target value shown on entry rows (`number` or `sql` expr). |
| `graphLow` | `NumericExpr` | no | Chart lower bound. |
| `graphDivision` | `NumericExpr` | no | Chart gridline division size. |
| `targetDirection` | `ManualStatTargetDirection` | no | `"lower_is_better"` reverses the chart axis. Default `"higher_is_better"`. |
| `ownerHeader` | `string` | no | Chart owner header (e.g. role). |
| `ownerLabel` | `string` | no | Chart owner label (e.g. person). |
| `sortOrder` | `number` | no | Order on dashboard/entry page. Default = array index. |
| `active` | `boolean` | no | When `false`, the stat is excluded from charts and the entry page but remains in the enum. Default `true`. |
| `renameFrom` | `string` | no | Previous `name` for this enum value, to preserve history when renaming. |

The `active` flag filters which stats appear in `block.stats` (used by charts
and pages), but the enum is built from **all** `stats` (including inactive and
`renameFrom`) so existing entry rows stay valid.

### Type aliases

| Type | Values |
| --- | --- |
| `ManualStatValueFormat` | `"number"` \| `"number_thousands"` \| `"currency"` \| `"percentage"` \| `"ratio"` \| `"duration"` |
| `ManualStatCadence` | `"daily"` \| `"weekly"` \| `"monthly"` |
| `ManualStatTargetDirection` | `"higher_is_better"` \| `"lower_is_better"` \| `"target_is_best"` |
| `ManualStatsDateRange` | `{ startDate?: Sql; endDate?: Sql }` |

`number_thousands` and `ratio` have no dedicated formatting branch in the block:
on charts `ratio` is rendered as `number`, and labeling for thousands is left to
the chart `unit`. Format the currency/percentage/duration values to get their
special rendering.

## Tables Created

The block generates one enum and one table (names derive from `name` unless
overridden).

| Object | Default name | Notes |
| --- | --- | --- |
| Enum | `` `${name}_manual_stat_type` `` | One value per stat definition (`name` / `displayName`). |
| Table | `` `${name}_manual_stat_entries` `` | One row per stat type and period. |

Entries table columns:

| Column | Type | Notes |
| --- | --- | --- |
| `stat_type` | enum (the stat-type enum) | not null |
| `period_start_date` | date | not null |
| `value` | decimal(18, 4) | nullable; rows with null `value` are treated as "not entered". |
| `notes` | string(2000), multiline | only when `includeNotes` is `true`; retained for imported/custom historical data and not surfaced by the ready-made pages. |
| `entered_by` | FK `sys_users` | only when `trackEnteredBy` is `true` |
| `entered_at` | timestamp (UTC) | not null, defaults to `now()` |

A unique constraint on `(stat_type, period_start_date)` enforces one row per
metric per period.

## Components

### `ManualStatsLineChart`

Import from `blocks/manual_stats`. Renders a single stat as a WISE-style line
chart, pulling chart options (format, unit, axis direction, gridlines) from the
stat definition.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `block` | `ManualStatsBlock` | yes | The block instance. |
| `stat` | `string` | yes | A defined stat `name`. Throws at generation if unknown. |
| `startDate` | `Sql` | no | Range start. Defaults to the block's `defaultStartDate`. |
| `endDate` | `Sql` | no | Range end. Defaults to the block's `defaultEndDate`. |
| `title` | `Node` | no | Overrides the chart title (default is the stat's `displayName`). |
| `ownerHeader` | `Node` | no | Overrides the owner header. |
| `ownerLabel` | `Node` | no | Overrides the owner label. |
| `emptyFallback` | `Node` | no | Shown when no values fall in range. |
| `errorFallback` | `Node` | no | Shown on query error. |
| `pendingFallback` | `Node` | no | Shown while loading. |
| `viewHref` | `Sql \| string` | no | Adds the compact focused-view link used by `WiseStatLineChart`. |
| `displaySize` | `WiseStatDisplaySize` | no | Uses the larger focused-page chart dimensions when set to `"page"`. |

### `ManualStatsDualLineChart`

Import from `blocks/manual_stats`. Plots two stats on one chart: the first as a
solid line on the left axis, the second dashed on its own right axis. Both
stats must share the same `valueFormat` or it throws at generation.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `block` | `ManualStatsBlock` | yes | The block instance. |
| `stat` | `string` | yes | First (left-axis) stat `name`. |
| `stat2` | `string` | yes | Second (right-axis) stat `name`. |
| `title` | `Node` | yes | Chart title. |
| `startDate` | `Sql` | no | Range start. Defaults to `defaultStartDate`. |
| `endDate` | `Sql` | no | Range end. Defaults to `defaultEndDate`. |
| `ownerHeader` | `Node` | no | Overrides the owner header. |
| `ownerLabel` | `Node` | no | Overrides the owner label. |
| `emptyFallback` | `Node` | no | Shown when no values fall in range. |
| `errorFallback` | `Node` | no | Shown on query error. |
| `pendingFallback` | `Node` | no | Shown while loading. |

```tsx
<ManualStatsDualLineChart
  block={exampleManualStatsBlock}
  stat="cash_on_hand"
  stat2="bills_outstanding"
  title="Div 3_3 Cash/Bills"
/>;
```

## Pages

Both pages are **self-routing** (they render their own `<Route>`). Place them
directly inside `<AppRoutes>` — do NOT wrap them in another `<Route>`.

### `ManualStatsDashboardPage`

Import from `blocks/manual_stats`. A date-range filtered dashboard: a snapshot
`StatRow`, a grid of one line chart per active stat, and a recent-entries list.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `block` | `ManualStatsBlock` | yes | The block instance. |
| `path` | `string` | no | Route path. Default `"/manual-stats"`. |
| `title` | `string` | no | Page heading. Default `"Manual Stats"`. |
| `subtitle` | `string` | no | Page subheading. Default `"Review manually entered stat trends and recent submissions."`. |

### `ManualStatsEntryPage`

Import from `blocks/manual_stats`. A compact responsive batch-entry sheet lets
users enter a `value` for every active stat for the chosen
`period_start_date`. Its light sticky toolbar keeps the period picker and save
action available while scrolling. Currency fields show a `$` prefix;
percentage fields show a `%` suffix and convert the entered percentage to the
stored fractional value. Rows with a null value are not saved. Users can also
submit with Ctrl+Enter or Cmd+Enter.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `block` | `ManualStatsBlock` | yes | The block instance. |
| `path` | `string` | no | Route path. Default `"/manual-stats/entries"`. |
| `title` | `string` | no | Page heading. Default `"Enter Manual Stats"`. |
| `subtitle` | `string` | no | Optional page subheading. Omitted by default. |
| `wrapper` | `(children: Node) => Node` | no | Wraps the registered route content, for example with a permission check. |
| `periodSelection` | `"date" \| "week"` | no | Uses previous/next reporting-week navigation when set to `"week"`; defaults to the date input. |
| `groupByOwnerHeader` | `boolean` | no | Shows an `ownerHeader` heading before the first stat in each owner group. Default `false`. |
| `successSnackbar` | `boolean` | no | Shows a week-specific success snackbar after saving. Default `false`. |

## Block methods

The block instance exposes helpers for building custom queries and charts
against the entries table:

| Method | Returns | Use |
| --- | --- | --- |
| `stat(name)` | `ManualStatDefinition` | Looks up a definition; throws if undefined. |
| `statTypeExpr(name)` | `Sql` | A cast expression for filtering `stat_type = ...` (throws if `name` is undefined). |
| `entriesTableRef()` | `Sql` | `sql.ref` to the entries table for use in custom SQL. |
| `statQuery(name, range?)` | `Sql` | `(period_start_date, value)` series query, averaged per period over an optional `ManualStatsDateRange`. |
| `statDefinitionsQuery()` | `Sql` | A `union all` of all active stat definitions (metadata) as rows. |

Readonly properties resolved from options/defaults are also available:
`enumName`, `tableName`, `trackEnteredBy`, `defaultEntryDate`,
`defaultStartDate`, `defaultEndDate`, and `stats` (active stats only).

```tsx
// Count entered values for one period using the entries table directly.
sql`(
  select count(*)
  from ${exampleManualStatsBlock.entriesTableRef()}
  where period_start_date = ${statsEndDate}
    and value is not null
)`;
```

## Common Mistakes

- Wrapping `ManualStatsDashboardPage` / `ManualStatsEntryPage` in a `<Route>`.
  They self-route; mount them directly in `<AppRoutes>`.
- Passing a `stat`/`stat2` string that is not a defined `name`. The block
  throws at generation time (`Manual stat "x" is not defined.`).
- Using `ManualStatsDualLineChart` with two stats that have different
  `valueFormat` values — it throws. Match the formats.
- Non-snake_case `name` or stat `name` (must match `^[a-z][a-z0-9_]*$`) — the
  constructor throws.
- Renaming a stat's `name` without setting `renameFrom`, which breaks existing
  enum-backed entry rows. To retire a metric instead, set `active: false` so it
  drops from charts/entry but stays in the enum and keeps history.
- Storing query-derived metrics here. Manual stats are for hand-entered values;
  for series computed from other tables, render `WiseStatLineChart` (from
  `components/wise_stat_line_chart`) directly.
