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
Section names are optional. A single unnamed section renders without a heading
or tab bar; multi-section navigation uses numbered fallback labels where needed.

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

The block owns `dashboards`, `dashboard_sections`, `dashboard_widgets` and
`dashboard_capabilities`.
Null owners denote shared dashboards; only dashboard admins create or edit them.
Personal dashboards are visible and editable only by their owner, including when
another user is an admin. There is no individual viewer/editor sharing table.

`dashboard_capabilities` stores audience selections: one row per dashboard and
capability name, with a uniqueness constraint and cascade deletion. These are
selections from Spark's developer registry, not user-authored capabilities.
Any matching current capability permission permits viewing; an empty audience
permits only dashboard admins. Audience selection never grants data access.
There is no capability kind or saved dashboard data selection.
The create permission controls personal creation/copying; shared creation also
requires admin permission. Copies preserve sections, widgets and declarations,
but receive a new owner and no audience. Measurements are never copied.

Mount the same dashboard key in multiple apps to expose the same saved layout.
Host apps provide dashboard navigation, such as database-backed sidebar links.
Empty personal dashboard groups are hidden. There is no dashboard switcher modal. Spark is the only user-facing authoring interface; there are no
manual widget, layout or settings editors. New dashboard and Ask Spark are plain
links through `sparkHref`, using Spark's existing `?prompt=` parameter to prefill
the editable composer. Ask Spark includes the dashboard name, ID and current
filters. Opening either link creates no conversation and sends no message;
the user submits when ready. No Spark panel is embedded in the dashboard.
Owners/admins can request edits; viewers can request a
personal copy. Both entry points require Spark access, while viewing does not. Switching changes the current route, not an
app's configured default. Mount the library and ID route in every host app;
`basePath` defaults to `/dashboards`. Keep operational pages such as Sales Home
separate from reporting.

Every saved SQL execution derives all registered, non-internal Spark capabilities
currently permitted to the viewer, then uses their view/table/field allowlists.
Empty grants deny query execution. Developer capabilities must encode record
scope in views using `current_user`; dashboard IDs, audiences and input parameters
are not substitutes for tenant/record authorization. A capability granting a
whole table grants every row and column in it.

Widgets are fixed renderers: `wise`, `line`, `bar`, `number`, `table`, and
`manual_entry`. Chart SQL returns `x,value`, with unique x and numeric or null
values. Line/WISE x values are dates; WISE dates are Sunday week ends. Number
queries return at most one row with a value column. Tables allow arbitrary
approved columns. Empty results are valid; results exceeding 1,000 rows are
rejected. Queries may be bespoke, but writes and unauthorized data are rejected.
There is no saved JavaScript/TSX renderer or formula language. Users describe
changes to Spark; it uses the validated mutation tools.

Dashboard `parameters` and widget `config.parameters` each declare at most twelve
inputs. Each input has a unique `name`, `label`, `type`, optional `default`, and
`optional` (false by default). Types are text, number, date, date_range, enum and
record. Enums declare string `options`; records reference a developer-registered
`source`. Optional missing values resolve to null. Numbers must be finite, text
is bounded to 1,000 characters, and date ranges must be ordered and at most ten
years long. Required inputs need usable defaults for saving/initial rendering.

Widgets explicitly bind their input names to dashboard input names using
`config.bindings`. A binding must accept the dashboard input's **entire domain**:
matching types and record sources, every offered enum option, and null when the
dashboard input is optional. These checks run during execution, preview/save,
Spark creation and declaration edits. Removing an input used by a widget is
rejected until its binding is updated. Unbound widget inputs use their defaults.
A current-state widget can declare no inputs and ignore the reporting period.

```json
{
  "parameters": [{
    "name": "period", "label": "Reporting period", "type": "date_range",
    "default": "last_12_weeks"
  }],
  "bindings": {"period": "period"}
}
```

Query parameters are values, never SQL substitutions. Widget queries read only
`current_context()->'parameters'`; a bound range is
`current_context()->'parameters'->'period'->>'start'` / `->>'end'`. There are no
special top-level start/end dates or `date_filter` flag. Context is restored on
success and failure. Date ranges can default to `last_12_weeks`: exactly 12 completed Monday–Sunday
weeks, excluding the current week. This is resolved on each
open, or `{start,end}` ISO dates. Inputs stay visible above the widgets. Date ranges open the shared calendar picker in an anchored popover;
Apply updates both endpoints together. Record inputs use a scoped searchable picker.
Viewing controls use dates, enum choices and searchable record selectors. Spark
manages their declarations and bindings.

Register `recordSources` on the block: `{name,label,permission,query,currentValue?}`.
The developer SQL relation returns `id,label` and must enforce viewer row scope;
the permission expression guards lookup and selected-ID validation. Search is
bounded to fifty choices. A record default may be `current` only when its source
provides `currentValue`; arbitrary saved lookup SQL is unsupported. Spark's
`lookupRecords` uses the same sources and permission checks.

`DashboardPage.initialValues` can supply a server SQL JSON object of initial
values; `DashboardWidget.parameters` supplies dashboard values to an embedded
widget. Both pass through the same validation. Initial values and record IDs
never authorize data access: capability views must independently enforce scope.

`testWidget` uses the same query executor as previews, saves and rendering. It
returns validity, row count, empty status, effective viewer capabilities and
at most five sample rows. Query execution precedes the save transaction because
it may suspend; authorization and stale edit checks run during mutation. Runtime
execution always rechecks permissions. Spark actions create private or admin-managed shared dashboards,
save/remove/move widgets, save/remove sections, configure inputs/audience, make
personal copies and remove dashboards.
Mutating actions use Spark's reversible transaction receipts.

# Manual measurements

`ManualMeasurementsBlock` owns `manual_stats` and `manual_stat_entries`.
`ManualMeasurementsSetupPage` provides a separate, management-permission-gated
Stats setup route (default `/measurements/setup`) for definitions and archiving.
`ManualMeasurementsPage` only handles entry and supports `weekly` for compact weekly entry with a sticky
Save toolbar and guarded previous/next navigation. Its optional `statGroups`
relation returns one row per `stat_id`, with `group_name` and numeric `sort_order`.
System 6 uses its existing measurement definitions for division order; changing a
dashboard layout does not change measurement entry order. Existing notes remain
stored when using the compact entry view.

Definitions have a name, format, daily/weekly frequency, unit and active flag.
Direction belongs exclusively to WISE widgets through `config.inverse`; it is
not stored on stat definitions. Observations are unique per definition/date and retain
value, note, actor and timestamp. Percentage storage is fractional; entry fields
display percent. Blank is missing, zero is zero. Weekly entry dates map to Sunday.

Manual definitions and observations do not belong to a dashboard or widget.
Removing dashboard layout does not remove measurements. Multiple widgets can
query the same observations. Archive definitions to stop new entry while retaining
history. `manual_entry` widgets select a definition using `config.measurementId`
and enforce the block's entry permissions. Query capabilities for measurement
reads are supplied by the consuming system, as with other application data.

See `examples/stats` and System 6 for complete registrations and seeds.
