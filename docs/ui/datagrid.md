---
title: Datagrid
description: A detailed guide on how to use the Datagrid component in Yolm, covering simple usage, bulk actions, and column customization.
tags:
  - ui
  - components
  - datagrid
  - crud
---

# Datagrid

`DatagridPage` is Yolm's full-featured grid editor for one table: inline
editing with validation, sorting, filtering, saved views, bulk edits, export,
and integrated record pages. It registers its own route (default
`/{table_base_url}`) and navigation item.

```tsx
import { DatagridPage, DatagridToolbar } from "pages/datagrid";
```

## Required Schema Opt-In

`DatagridPage` stores saved views in system tables and throws at generation
time unless its `datagridName` (default: `table`) is registered in `core.tsx`:

```tsx
system.addDataGridTablesAndEnums(["customers", "orders"]);
```

This is a persistent schema change; see
[Schema opt-in](./record_grid.md#schema-opt-in-persistent-schema-change) for what it adds.

## Simple Usage

With only `table`, the grid includes every table field. Users can sort, filter,
reorder and hide columns, edit cells, and save views.

@@{ "type": "code", "file": "examples/chinook/apps/chinook.yolmstaging.net.tsx", "name": "DATAGRID_SIMPLE", "language": "tsx"}@@

## Toolbar

The default `DatagridToolbar` shows view and column controls, filter, sort, and
row height on the left, and discard/save changes on the right. Children of
`DatagridToolbar` go in the right-hand area; `toolbarRight` on `DatagridPage`
is the shorthand. `toolbar` replaces the whole toolbar and cannot be combined
with `toolbarRight`.

`DatagridToolbar` must be rendered inside `DatagridPage` (or the low-level
`Datagrid` from `std/ui`). It accepts `disableFiltering`, `disableSorting`,
`disableColumns`, `disableViews`, `disableRowHeight`, and `disableSearch`
(hides quick search even when configured). Static parts include
`DatagridToolbar.AutoInsertButton`, `DeleteButton`, `RowHeightSelect`,
`ViewsButton`, and `Count`.

`defaultRowHeight` sets the initial row height before a saved view loads:
`"extraShort"`, `"short"`, `"medium"`, `"tall"`, or `"extraTall"`.

CRUD: create with `DatagridToolbar.AutoInsertButton`, update by inline cell
editing or bulk update, and delete through bulk actions.

## Bulk Actions

Enabling any `bulk` option (`delete`, `update`, `export`, `merge`, `actions`)
makes rows selectable. Selected rows show a bottom popup with delete, bulk
update dialog, CSV export, and any custom `bulk.actions`. `maxSelectedRows`
caps the selection.

@@{ "type": "code", "file": "examples/chinook/apps/chinook.yolmstaging.net.tsx", "name": "DATAGRID_BULK", "language": "tsx"}@@

## Columns

`columns` receives a `DatagridBuilder`; when it is provided, `fields` and
`ignoreFields` on the page are ignored and auto-generation is skipped unless
you call `b.autoFields()`.

@@{ "type": "code", "file": "examples/chinook/apps/chinook.yolmstaging.net.tsx", "name": "DATAGRID_COLUMNS", "language": "tsx"}@@

| Method | Use |
|--------|-----|
| `autoFields({ ignoreFields?, fields? })` | Columns for table fields, optionally skipping or configuring fields. |
| `addField(fieldName, config)` | One table field column with `FieldConfig`. |
| `addFkVirtuals(fkField)` | Virtual columns for non-FK fields on the referenced table. |
| `addFkField(fkField, fieldName, opts?)` | One read-only virtual column from the referenced table. |
| `virtualColumn(config)` | Query-backed column with optional filter, sort, export, and custom `cell`. |
| `cellOnlyColumn(config)` | UI-only column (buttons, menus, local toggles); no query data. |
| `customFilterColumn(config)` | Filter-only predicate with optional custom filter UI. |
| `customSortColumn(config)` | Sort-only SQL expression, generated only when actively sorted. |
| `countVirtual(tableOrOpts)` | Related-row count column. |
| `relationCountAndDialog(config)` | Related-row count whose cell opens a related-record dialog. |
| `addSnackbarBulkAction(action)` | Selection snackbar bulk action. |
| `column(column)` | Push a fully formed low-level column object. |

See [Datagrid Virtual Columns](./datagrid_virtual_columns.md) for virtual
column configuration and the `record` alias.

`FormattedCellValue` (from `pages/datagrid`) post-processes the default cell
value: `format` receives the raw `AnyExpr` and returns a SQL expression.

```tsx
b.virtualColumn({
  storageName: "formatted_amount",
  displayName: "Amount",
  expr: sql`amount`,
  cell: <FormattedCellValue format={(v) => sql`format.currency(${v}, 'USD')`} />,
});
```

### Keep cell data in the grid query

Do not put a `<Data>` inside a visible cell keyed on
`useCellHelper().recordId` or `.value`. It runs once per rendered row, turning
one grid fetch into dozens of point lookups, counts, or `exists` checks, with
high block usage and slow server rendering on large tables. Compute the value
as a virtual column and render from `helper.value`:

```tsx
b.virtualColumn({
  storageName: "failed_notification",
  displayName: "Notification",
  expr: sql`exists(
    select 1
    from db.scheduling_appointment_notifications_status ns
    where ns.scheduling_appointment_id = record.id
      and ns.status = 'failed'
  )`,
  cell: ({ helper }) => (
    <Show when={sql`${helper.value} = 'true'`}>
      <Chip size="sm" color="danger" variant="soft">Failed</Chip>
    </Show>
  ),
});
```

The same applies to related-row counts (`b.countVirtual(...)` or a
`(select count(*) ... where fk = record.id)` expression), existence flags, FK
labels (`b.addFkField("client_id", "acronym", { storageName: "client_id" })`),
and status labels. Grid query values reach cells as strings (booleans are
`'true'`/`'false'`). If a cell needs database data for every visible row, it
should be a `virtualColumn`, not a `cellOnlyColumn`. Exception: dialog and
dropdown contents may load lazily once opened; keep the always-visible label
in the grid query. When migrating an existing cell, compare the old row-keyed
expression with the new `record.id`-based expression over representative rows
before changing the renderer.

## Quick Search

`quickSearch` adds a toolbar search input bound two-way to the `?q=` URL
param (updating the URL with replace, so typing does not add history
entries), so `/orders?q=42` opens pre-filtered.

- `<DatagridPage table="customers" quickSearch />` requires the table's
  [`searchConfig`](../database/advanced_table_features.md). Each `field` is a
  fuzzy target and each `fieldGroup` one concatenated fuzzy haystack, matching
  `SearchDialog` (so "John Smith" hits `first_name = "John"`,
  `last_name = "Smith"`). Results are ranked.
- The object form is required without a `searchConfig` or when mixing modes:

```tsx
<DatagridPage
  table="orders"
  quickSearch={{
    fields: [
      { field: "br_id", mode: "exact" },
      { fields: ["first_name", "last_name"] },
      "reference",
    ],
    rank: true,
  }}
/>
```

`fields` entries: a `string` (fuzzy), `{ field, mode?, priority? }`, or
`{ fields: [...], mode?, priority? }` (space-concatenated haystack;
`mode: "exact"` is rejected for groups). `placeholder` defaults to "Search…".

| Mode | Semantics | Typical use |
|------|-----------|-------------|
| `fuzzy` (default) | `fuzzy_match(query, haystack, null)`; String/PhoneNumber fields only. | Names, descriptions. |
| `contains` | `contains(lower(haystack), lower(query))`. | Codes, SKUs. |
| `exact` | `lower(haystack) = lower(query)`. | Pasted ids, UUIDs, dates. |

An `exact` target on a non-string column (int, date, uuid, ...) is dropped from
the runtime SQL when the input cannot be cast to that type.

With `rank: true` and text present, best matches sort first and the column sort
becomes a tiebreaker. Rank tiers: `exact` = `priority` (0..1e6), `contains` =
`1_000_000 + priority`, `fuzzy` = `1_000_000_000 + fuzzy_rank_key(...)`.
`priority` defaults to the entry's index (lower ranks higher). With
`rank: false`, search only filters and column sort wins.

## Filtered and Sorted Deep Links

Every datagrid accepts JSON arrays in the `filters` and `sort` query params,
using column storage names (as in `defaultView` and saved views). URL filters
are AND-ed.

```text
/orders?filters=[{"column":"status","op":"enum_eq","value_1":"pending"}]&sort=[{"column":"request_date","sort":"asc"}]
```

Percent-encode the JSON when writing a literal URL. Prefer `datagridUrl` from
`pages/datagrid`; it handles JSON and URL encoding and accepts runtime SQL
values:

```tsx
<a
  href={datagridUrl("/orders", {
    filters: [
      { column: "status", op: "enum_eq", value_1: "pending" },
      { column: "jurisdiction_id", op: "fk_eq", value_1: sql`county.id` },
    ],
    sort: [{ column: "request_date", sort: "asc" }],
  })}
>
  View pending orders
</a>
```

Filters take `value_1`..`value_3`, matching the saved-view operators. URL
filters and sort override those parts of the selected or default view; column
order, visibility, pinning, widths, and row height stay. An explicit empty
array (`filters=[]`) clears that part. Malformed JSON, unknown columns, invalid
operators, and incompatible column/operator pairs are ignored. Navigating to
another URL for the same grid reapplies changed params, and removing them
restores the view.

## Integrated Record Pages

`recordPage` registers a detail route next to the grid so users can browse the
current filtered, sorted result set:

```tsx
<DatagridPage
  table="customers"
  quickSearch
  recordPage={{
    linkField: "name",
    content: (
      <div className="p-4">
        <Typography level="h3">{sql`record.name`}</Typography>
        <StaticTableCard rows={["email", "phone", "company"]} />
      </div>
    ),
  }}
/>
```

`/customers` renders the grid; `/customers/{record_id}` renders `content` with
the same `record` and `ui.record_id` context as [`RecordPage`](./record_page.md).
`recordPage` accepts the other `RecordPageContent` options (`queryParams`,
`routeState`, `title`, `sx`, loading/error fallbacks); the grid supplies
`table`, `children`, and `recordWhere`, so do not wrap `content` in
`RecordPageContent`.

- `linkField` makes that field the record link instead of a View button. It
  must be a displayed string or numeric auto field, or a virtual-column
  storage name. Custom cell renderers cannot be link fields; virtual-column
  links are read-only; the link column cannot be hidden. Linked field cells
  keep inline editing.
- Entering from the grid shows Close, Previous, and Next. Close is a
  [back link](./routing.md#returning-to-a-list) to the grid: it restores the
  grid's query, filters, and scroll. Navigation reuses
  the loaded ordered rows; past the cache, Next extends the same bounded query
  by one page; it never materializes the full filtered result set. Quick
  search, filters, `additionalWhere`, and sort carry through, with the primary
  key as tie-breaker.
- The position label shows the discovered extent (`12 of 100+`) and becomes
  exact on the final page (`201 of 275`). `showExactResultCount: true` runs
  the grid's count query up front (`12 of 57 entries`); enable only when the
  count is cheap.
- Direct URLs, reloads, and new tabs have no navigation bar. The record fetch
  still enforces `additionalWhere`; user filters never act as authorization.
- Unsaved filters and sorts are transient `ui.*` state that survive moving
  between the two routes in the current page session. `view` and `q` are kept
  in record URLs and on Close.

Do not also register a `RecordPage` for the same route, and do not combine
`recordPage` with `viewButtonUrl`. For a detail page large enough to compile
separately, use `recordNavigation={{ linkField? }}` on the grid with a sibling
`StandaloneDatagridRecordPage` (`table`, `listPath`, `content`).

See `DatagridPageProps`, `DatagridRecordPage`, and `QuickSearchConfig` in
`pages/datagrid` for the full contract.

## Low-Level Exports

New grids should use `DatagridPage` with `columns`, `quickSearch`, and the
toolbar props above. The `pages/datagrid_internals/*` modules exist for
maintaining older custom grids:

- `action_dialog_datagrid`: `DatagridActionDialog` runs an action on the
  current selection. `open` is a SQL boolean and `onClose` runs on close;
  optional props are `title` (string or SQL), `titleProps`, `header`,
  `description`, `form`, `defaultFieldComponent`, `confirmDisabled` (SQL
  boolean), `maxWidth` (`"sm"`, `"md"`, `"lg"`), and `sx`. `action` takes
  `beforeTransactionStart`, `afterTransactionStart`, `beforeTransactionCommit`,
  and `afterTransactionCommit`, each receiving server statements and a SQL
  table expression of selected ids. `WithTotalCount` exposes the selected
  count, including "select all".
- `toolbar_filter`: `FilterTermHelper`, `FilterStringInput`,
  `FilterEnumSelect`, `FilterDateInput`, `CheckboxFilter`, `FilterNumberInput`,
  `FilterDurationInput`, `FilterEnumLikeBool`, `ToolbarFilterButton`, `FkFilter`.

```tsx
import {
  DatagridActionDialog,
  WithTotalCount,
} from "pages/datagrid_internals/action_dialog_datagrid";

<DatagridActionDialog
  open={sql`ui.archive_open`}
  onClose={(s) => s.setScalar("archive_open", false)}
  title="Archive selected rows"
  action={{
    beforeTransactionCommit: (s, selectedIds) => {
      s.modify(sql`
        update db.customers
        set archived = true
        where id in (select id from ${selectedIds})
      `);
    },
  }}
>
  <WithTotalCount>
    {(totalCount) => <span>{sql`${totalCount} || ' selected'`}</span>}
  </WithTotalCount>
</DatagridActionDialog>
```
