---
title: Dashboards and Manual Measurements
tags: [blocks, dashboards, reporting]
description: User-managed dashboards with developer-rendered widgets and Spark capability-scoped data.
---

# Dashboards

`DashboardBlock` uses the installed `SparkBlock` capability registry and query
policy. Viewing dashboards does not require Spark chat permission. A dashboard
has ordered sections containing ordered widgets; neither sections nor widgets
nest. Layout is scrolling or tabs. Widget widths snap to quarter, third, half,
two-thirds or full width and stack on small screens.
Section names are optional; a single unnamed section renders without a
heading or tab bar.

```tsx
import { DashboardBlock, DashboardPage, DashboardListPage } from "blocks/dashboard";
import { ManualMeasurementsBlock, ManualMeasurementsPage } from "blocks/manual_measurements";
import { SparkBlock } from "blocks/spark";
import { system } from "std/system";
import { sql } from "std/sql_utils";
import { queryParamsString } from "std/services";

const measurements = new ManualMeasurementsBlock({
  permissions: { view: canView, enter: canEnter, manage: canManage },
});
system.addBlock(measurements);
const dashboards = new DashboardBlock({
  spark: () => system.block(SparkBlock), measurements,
  sparkHref: (prompt) => sql.concat("/spark/?", queryParamsString({ prompt })),
  permissions: { create: canCreate, admin: canManageDashboards },
});
system.addBlock(dashboards);
// Include dashboards.sparkCapability in the SparkBlock capabilities option.
// Mount DashboardListPage, DashboardPage and ManualMeasurementsPage in AppRoutes.
```

The block owns `dashboards` (null owner = shared), `dashboard_sections`,
`dashboard_widgets` and `dashboard_capabilities` (audience: one row per
dashboard and Spark capability name, selected from the developer registry).

- Personal dashboards are visible and editable only by their owner, even to
  admins. Shared dashboards are created and edited only by dashboard admins.
  There is no per-user sharing table.
- A shared dashboard is visible to anyone holding any audience capability; an
  empty audience means admins only. Audience never grants data access.
- The create permission controls personal creation and copying. Copies keep
  sections, widgets and declarations, get a new owner and no audience, and
  never copy measurements.
- Spark is the only authoring interface (no manual widget, layout or settings
  editors). New dashboard and Ask Spark are plain `sparkHref` links using
  Spark's `?prompt=` parameter (Ask Spark includes the dashboard name, ID and
  current filters); opening one sends nothing. Both require Spark access;
  viewing does not. Owners/admins can request edits; viewers can request a
  personal copy.
- Host apps provide navigation and must mount the library and ID routes
  (`basePath` defaults to `/dashboards`); the same dashboard key can be mounted
  in several apps. Keep operational pages separate from reporting.

Every saved SQL execution uses the view/table/field allowlists of all
registered, non-internal Spark capabilities currently permitted to the viewer;
empty grants deny execution. Capabilities must encode record scope in views
using `current_user`. A capability granting a whole table grants every row and
column; dashboard IDs, audiences and inputs never authorize data.

Widgets are fixed renderers: `wise`, `line`, `bar`, `number`, `table` and
`manual_entry`; there is no saved JavaScript/TSX renderer or formula language.

- Chart SQL returns `x,value` with unique x and numeric or null values;
  line/WISE x values are dates. WISE weeks end Sunday unless `config.weekEnding`
  names another weekday; with `config.series2Label` a WISE query may also
  return `value2` (dashed second series, own axis). `config.inverse` sets WISE
  direction. WISE axes have 10 divisions starting at `config.graphLow`, or at
  the data low when it is omitted; `config.graphDivision` sets the division
  and grows by 1-2-5 multiples of itself when too small for the data
  (`series2GraphLow`/`series2GraphDivision` for the second axis). WISE cards
  label only the latest value per series; expanded charts label every
  observation; lines never connect across missing dates.
- Number queries return at most one row; tables allow any approved columns.
  Empty results are valid; more than 1,000 rows is rejected. Writes and
  unauthorized data are rejected.

Display metadata is an object (new writes reject legacy string formats; an
unchanged saved string may be kept and is normalized only when rendered or
copied):

```json
{
  "format": {"type":"currency", "currency":"USD", "minimumFractionDigits":2, "maximumFractionDigits":2},
  "columnFormats": {"count": {"type":"number", "maximumFractionDigits":0}, "tat_minutes": {"type":"duration"}, "client_code": {"type":"text"}}
}
```

Format types: `number` (grouped, at most two fraction digits by default),
`number_thousands`, `currency` (default USD, two digits), `percentage` (takes
fractions: 0.125 is 12.5%), `duration` (`inputUnit` minutes by default, or
seconds/hours; shown as hours/minutes) and `text` (table-column override only).
Precision options are integers 0-20 with minimum <= maximum. `columnFormats`
keys must match returned aliases; numeric formats require numeric values. Nulls
show an em dash. The same formatter drives cards, tables, axes, tooltips and
View data.

Dashboard `parameters` and widget `config.parameters` each declare at most
twelve inputs: unique `name`, `label`, `type` (`text`, `number`, `date`,
`date_range`, `enum` with string `options`, `record` with a registered
`source`), optional `default`, and `optional` (default false; missing optional
values are null). Text is at most 1,000 characters; date ranges are ordered
and at most ten years. Required inputs need usable defaults.

`config.bindings` maps widget input names to dashboard input names. A binding
must accept the dashboard input's **entire domain**: matching type and record
source, every enum option, and null when the dashboard input is optional.
Removing a bound dashboard input is rejected. Unbound widget inputs use their
defaults.

```json
{
  "parameters": [{
    "name": "period", "label": "Reporting period", "type": "date_range",
    "default": "last_12_weeks"
  }],
  "bindings": {"period": "period"}
}
```

Parameters are values, never SQL substitutions. Widget queries read only
`current_context()->'parameters'` (a bound range is
`current_context()->'parameters'->'period'->>'start'` / `->>'end'`); there are
no top-level start/end dates or `date_filter` flag. Date-range defaults are
`{start,end}` ISO dates or `last_12_weeks` (12 completed Monday-Sunday weeks,
excluding the current week, resolved on each open).

Register `recordSources` on the block as `{name,label,permission,query,currentValue?}`.
`query` returns `id,label` and must enforce viewer row scope; `permission`
guards lookup and selected-ID validation. Search returns at most 50 choices. A
record default may be `current` only when the source provides `currentValue`.
Spark's `lookupRecords` uses the same sources.

`DashboardPage.initialValues` (server SQL JSON object) and
`DashboardWidget.parameters` (for an embedded widget) pass through the same
validation and never authorize data access.

`testWidget` uses the same executor as previews, saves and rendering and
returns validity, row count, empty status, effective viewer capabilities and up
to five sample rows. Query execution precedes the save transaction (it may
suspend); authorization and stale-edit checks run during the mutation. Spark
dashboard actions use reversible transaction receipts.

# Manual measurements

`ManualMeasurementsBlock` owns `manual_stats` (definitions: name, format,
daily/weekly frequency, unit, active flag) and `manual_stat_entries`
(observations, unique per definition and date, with value, note, actor and
timestamp). Measurements belong to no dashboard or widget: removing layout does
not remove them, and several widgets can query the same observations. Archive a
definition to stop new entry while keeping history.

- `ManualMeasurementsSetupPage` is the management-permission-gated setup route
  (default `/measurements/setup`). `ManualMeasurementsPage` handles entry only;
  `weekly` gives compact weekly entry with a sticky Save toolbar. Optional
  `statGroups` returns one row per `stat_id` with `group_name` and numeric
  `sort_order`; dashboard layout does not change entry order.
- Weekly periods end Sunday unless `weeklyPeriodDate`/`weeklyPeriodLabel` are
  configured. Percentages are stored as fractions and entered as percent.
  Blank is missing; zero is zero.
- Direction lives only on WISE widgets (`config.inverse`), not on definitions.
- `manual_entry` widgets select a definition with `config.measurementId` and
  enforce the block's entry permissions. Query capabilities for measurement
  reads are supplied by the consuming system.

See `examples/stats` for a complete registration and seeds.
