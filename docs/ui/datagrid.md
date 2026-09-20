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

The `DatagridPage` is Yolm's main component for handling data for a table. It is a full-featured grid editor with inline editing, validation, sorting, filtering, bulk edits, export, and more.

## Simple Usage

The simplest way to use the Datagrid is to provide a table name. By default, it will include all fields from the table.

@@{ "type": "code", "file": "examples/chinook/apps/chinook.yolmstaging.net.tsx", "name": "DATAGRID_SIMPLE", "language": "tsx"}@@

This creates a datagrid where users can:
- Sort and filter data
- Reorder columns and control visibility
- Edit individual cells
- Create, edit, and save views

## Datagrid Toolbar

The `<DatagridToolbar>` has the following layout:

| Left | Center | Right |
|------|--------|-------|
| View control \| Column visibility | | Toolbar right (children) |
| Filter \| Sort \| Row height | | Discard changes \| Save changes |

Any children passed to `<DatagridToolbar>` will be placed in the `toolbarRight` area. The `<DatagridPage>` also provides a `toolbarRight` prop for convenience.

Set `defaultRowHeight` to choose the initial row height before a saved view is loaded. Options are `"extraShort"`, `"short"`, `"medium"`, `"tall"`, and `"extraTall"`.

## Bulk Actions

You can enable bulk actions to perform operations on multiple rows at once. This automatically makes the rows selectable.

@@{ "type": "code", "file": "examples/chinook/apps/chinook.yolmstaging.net.tsx", "name": "DATAGRID_BULK", "language": "tsx"}@@

When one or more rows are selected, a popup appears at the bottom with options to:
- **Delete**: Remove selected records.
- **Bulk Update**: Open a dialog to update fields for all selected records.
- **Export**: Export selected records to CSV.
- **Custom Actions**: Any additional actions defined in the `bulk.actions` array.

## Column Customization

While columns default to direct mapping of table fields, you have total flexibility using the `columns` builder:

@@{ "type": "code", "file": "examples/chinook/apps/chinook.yolmstaging.net.tsx", "name": "DATAGRID_COLUMNS", "language": "tsx"}@@

### Customization Options

- **`b.autoFields()`**: Automatically adds all table fields. Use `ignoreFields` to exclude specific ones.
- **`b.virtualColumn()`**: Adds a computed column based on a SQL expression.
- **`b.cellOnlyColumn()`**: Adds a column that only exists in the UI (e.g., for action buttons).
- **`b.customFilterColumn()`**: Defines a custom filtering logic for a column.
- **`b.countVirtual()`**: A helper to add a column showing the count of related records.

For more details on computed columns, see [Datagrid Virtual Columns](./datagrid_virtual_columns.md).

### `FormattedCellValue` — formatting raw cell values

Use `FormattedCellValue` from `pages/datagrid` as the `cell` for a
column whose default rendering needs to be post-processed — e.g.
formatting a number as currency, capitalising a status, or composing
multiple fields into one cell. The `format` callback receives the
cell's raw `AnyExpr` value and returns a new SQL expression.

```typescript
import { FormattedCellValue } from "pages/datagrid";
import { sql } from "std/sql_utils";

b.virtualColumn({
  storageName: "formatted_amount",
  displayName: "Amount",
  expr: sql`amount`,
  cell: () => (
    <FormattedCellValue format={(v) => sql`format.currency(${v}, 'USD')`} />
  ),
});
```

### Avoid row-keyed `<Data>` in visible cells

Do not put a `<Data>` query inside a visible datagrid cell when that query is
derived from `useCellHelper().recordId` or `useCellHelper().value`.

That pattern runs once per rendered row/cell. A page that looks like one
datagrid fetch can quietly become dozens of independent point lookups, counts,
or `exists` checks. On large tables this shows up as high block usage and slow
server-side rendering even when every individual lookup is selective.

Prefer pushing the value into the datagrid query:

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
    <Show when={helper.value}>
      <Chip size="sm" color="danger" variant="soft">Failed</Chip>
    </Show>
  ),
});
```

Use the same approach for:

- Related-row counts: `b.virtualColumn({ expr: sql\`(select count(*) ... where fk = record.id)\` })`, or `b.countVirtual(...)` when it fits.
- Related-row existence flags: `exists(select 1 ... where fk = record.id)`.
- Lookup labels for foreign keys: `b.addFkField("client_id", "acronym", { storageName: "client_id" })` instead of querying the related table from the cell.
- Status chips or formatted labels: compute the raw display value as the virtual column expression, then render from `helper.value`.

`cellOnlyColumn` is for UI-only cells such as buttons, menus, local toggles, or
pure client-side state. If the cell needs database data for every visible row,
it should almost always be a `virtualColumn` instead.

Interactive controls are the main exception. Dialog and dropdown contents may
load data lazily after the user opens them. Keep the always-visible label in the
datagrid query, and fetch the heavier option/detail list only from the opened
dialog or dropdown. For example, a multi-select cell should receive its selected
label from `helper.value`; the available-options query can remain behind the
open dropdown.

Before changing an existing cell, verify display equivalence where practical by
comparing the old row-keyed expression to the new `record.id`-based virtual
expression over a representative set of rows. The expressions should produce
the same labels/booleans/counts before the cell renderer is changed.

## CRUD Operations

The Datagrid supports full CRUD operations:
- **Create**: Via `DatagridToolbar.AutoInsertButton`.
- **Read**: The main Datagrid display.
- **Update**: Via inline cell editing or bulk update.
- **Delete**: Via bulk actions.

## Quick Search

Pass `quickSearch` to add a search input to the toolbar. The current query is bound
to the `?q=` URL param so search state is shareable.

### Shorthand

```tsx
<DatagridPage table="customers" quickSearch />
```

The shorthand requires the table to declare a
[`searchConfig`](../database/advanced_table_features.md). Each `field` becomes a
fuzzy target; each `fieldGroup` is concatenated into one fuzzy haystack — the same
match behavior `SearchDialog` uses, so a search like "John Smith" hits a row where
`first_name = "John"` and `last_name = "Smith"`.

### Explicit configuration

For mixed modes (e.g. exact match on an id column alongside fuzzy match on names)
pass an object:

```tsx
<DatagridPage
  table="orders"
  quickSearch={{
    fields: [
      { field: "br_id", mode: "exact" },
      { fields: ["first_name", "last_name"] },
      { field: "reference" },
    ],
    rank: true,
  }}
/>
```

`fields` entries are one of:

- `string` — single field, fuzzy. Shorthand for `{ field, mode: "fuzzy" }`.
- `{ field, mode?, priority? }` — single field with explicit mode/priority.
- `{ fields: [...], mode?, priority? }` — group whose fields are space-concatenated
  into one fuzzy/contains haystack. Lets cross-field input ("John Smith") match a
  row whose individual fields each hold one word. `mode: "exact"` is rejected for
  groups (the concatenated haystack rarely equals a user input verbatim).

### Match modes

| Mode | Semantics | Typical use |
|------|-----------|-------------|
| `fuzzy` (default) | `fuzzy_match(query, haystack, null)` — typo-tolerant ranked match. Requires String/PhoneNumber fields. | Names, descriptions. |
| `contains` | `contains(lower(haystack), lower(query))` — case-insensitive substring. | Codes, SKUs, partial matches. |
| `exact` | `lower(haystack) = lower(query)` — exact (case-insensitive) match. | Pasted ids/UUIDs/dates. |

### Input gates (auto-skip when input doesn't fit a column)

A target with `mode: "exact"` on a non-string column (int, date, uuid, …) is
automatically *dropped* from the runtime SQL when the input can't be cast to that
type. Typing "John" against an int `br_id` simply doesn't bother filtering by
`br_id` — the WHERE clause shrinks to the remaining (string) targets.

### Ranking

When `rank: true` and the search box has text, results are ordered by best match
first; the user's column sort becomes a tiebreaker. Per-target rank values are
tiered so cross-mode ordering is predictable:

| Tier | Rank value | Notes |
|------|-----------|-------|
| `exact` | `priority` (0..1e6) | Hard match, sorts first. |
| `contains` | `1_000_000 + priority` | Substring hit, sorts after exact. |
| `fuzzy` | `1_000_000_000 + fuzzy_rank_key(...)` | Typo-tolerant, sorts last. |

`priority` defaults to the entry's index in `fields`. Set `priority` explicitly
to bias rows that match a "more important" field above equally-confident hits in
other fields.

When `rank: false` the search acts purely as a filter — column sort wins.

### URL persistence

The current search term is two-way bound to `?q=` via `s.setQueryParam` so a
pasted-id link like `/orders?q=42` opens the grid pre-filtered to that row.

## Filtered and Sorted Deep Links

Every datagrid accepts JSON arrays in the `filters` and `sort` query params.
Column names are the storage names used by `defaultView` and saved views. URL
filters are combined with AND.

```text
/orders?filters=[{"column":"status","op":"enum_eq","value_1":"pending"}]&sort=[{"column":"request_date","sort":"asc"}]
```

Percent-encode JSON when constructing a literal URL. Prefer `datagridUrl` for
links in Yolm UI; it handles JSON and URL encoding and accepts runtime SQL
values:

```tsx
import { datagridUrl } from "pages/datagrid";

<a
  href={datagridUrl("/orders", {
    filters: [
      { column: "status", op: "enum_eq", value_1: "pending" },
      {
        column: "jurisdiction_id",
        op: "fk_eq",
        value_1: sql`county.id`,
      },
    ],
    sort: [{ column: "request_date", sort: "asc" }],
  })}
>
  View pending orders
</a>
```

Each filter supports `value_1`, `value_2`, and `value_3`, matching the datagrid
filter operators and saved-view representation. URL filters and sorting
override those parts of a selected or default view; the view's column order,
visibility, pinning, widths, and row height remain active. An explicit empty
array clears that part of the view (`filters=[]` or `sort=[]`). Malformed JSON,
unknown columns, invalid operators, and incompatible column/operator pairs are
ignored rather than producing an invalid query.

Navigating to another URL for the same datagrid reapplies changed `filters` and
`sort` parameters, including removal of those parameters to restore the
selected or default view.

## Integrated Record Pages

Pass record detail content through `recordPage` when users should browse the
current filtered and sorted result set without losing the grid context:

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

The page owns both routes:

- `/customers` renders the grid.
- `/customers/{record_id}` renders the supplied content with the same `record`
  and `ui.record_id` context as `RecordPage`.

`recordPage.linkField` makes that field the record link instead of adding a separate
View button. The linked cell retains its inline-edit affordance. It must name a
displayed string or numeric field added by the page's automatic fields, or a
displayed virtual-column storage name added by the `columns` callback.
Custom cell renderers cannot be used for the link field because their arbitrary
content cannot be safely nested inside a record link. Virtual-column links are
read-only. The link column cannot be hidden, ensuring saved views always retain
a way to open records. Omit it to retain the separate View button.

Entering a detail page with an ordinary grid link displays compact Close,
Previous, and Next controls. Navigation reuses the grid's already loaded,
ordered rows. At the end of that cache, Next extends the same bounded grid
query by one page and then advances. It never materializes the complete
filtered result set. The active quick search, filters, `additionalWhere`, and
column sort therefore all carry through, with the primary key appended as a
stable tie-breaker.

By default the controls show the position and the discovered result extent,
such as `12 of 100+`. The plus sign means the bounded query confirmed that
more records exist. Crossing the cache boundary extends it by one page. When
the query reaches the final page, the label becomes exact without a count
query, such as `201 of 275`. Set
`recordPage={{ ..., showExactResultCount: true }}` to show
`12 of 57 entries`. This runs the grid's count query, so only enable it when an
exact count is acceptably cheap for that page.

A direct detail URL, reload, or modified-click into a new tab has no grid
navigation bar because there is no in-memory result context to navigate. The
record fetch still enforces `additionalWhere`, so direct URLs cannot bypass the
grid's fixed scope; user-entered filters only determine session navigation and
do not act as record authorization.

Unsaved filters and sorts remain transient `ui.*` state and survive navigation
between these two routes in the current page session. The `view` and `q` query
parameters are preserved in record URLs and when Close returns to the grid.
Reloading or opening the record URL directly intentionally discards the
transient navigation context.

Do not register a separate `RecordPage` for the same table route when using
`recordPage`, and do not combine `recordPage` with `viewButtonUrl`.

The `recordPage` object accepts the route-less `RecordPageContent` options
directly, including `queryParams`, `routeState`, `title`, `sx`, and loading or
error fallbacks. The datagrid supplies `table`, `children`, and `recordWhere`;
application code should not wrap `content` in `RecordPageContent`. This keeps
the grid's `additionalWhere` scope enforced automatically on direct record URLs.

## Low-Level Datagrid Exports

Prefer `DatagridPage`, `Datagrid`, and toolbar exports from `pages/datagrid`.
The direct `pages/datagrid_internals/*` paths below exist for maintaining older
custom grids.

### `DatagridBuilder`

`DatagridPage`/`Datagrid` column callbacks receive `DatagridBuilder`:

```tsx
import { DatagridPage, type DatagridBuilder } from "pages/datagrid";

function configureColumns(b: DatagridBuilder) {
  b.autoFields({ ignoreFields: ["internal_notes"] });
  b.addFkField("customer_id", "name", {
    displayName: "Customer",
    initiallyDisplaying: true,
    filter: true,
    sort: true,
  });
  b.virtualColumn({
    storageName: "open_case_count",
    displayName: "Open Cases",
    expr: sql`(
      select count(*)
      from db.cases
      where cases.customer_id = record.id and not cases.closed
    )`,
    filter: { type: "number", notNull: true },
    sort: { type: "numeric" },
  });
}
```

| Method | Use |
|--------|-----|
| `autoFields({ ignoreFields?, fields? })` | Add columns for table fields, optionally skipping or configuring individual fields. |
| `addField(fieldName, config)` | Add one table field column with `FieldConfig`. |
| `addFkVirtuals(fkField)` | Add virtual columns for non-FK fields on the referenced table. |
| `addFkField(fkField, fieldName, opts?)` | Add one read-only virtual column from the referenced table. |
| `virtualColumn(config)` | Add a query-backed column with optional display, filter, sort, export, and custom cell config. |
| `cellOnlyColumn(config)` | Add a UI-only column; use for controls/buttons that do not need query-backed data. |
| `customFilterColumn(config)` | Add a filter-only predicate with optional custom filter UI. |
| `customSortColumn(config)` | Add a sort-only SQL expression generated only when actively sorted. |
| `countVirtual(tableOrOpts)` | Add a related-row count virtual column. |
| `relationCountAndDialog(config)` | Add a related-row count column whose cell opens a related-record dialog. |
| `addSnackbarBulkAction(action)` | Add a selection snackbar bulk action. |
| `column(column)` | Push a fully formed low-level column object. |

### `pages/datagrid_internals/toolbar`

```tsx
import { Button } from "components/button";
import { DatagridToolbar } from "pages/datagrid_internals/toolbar";

<DatagridToolbar disableViews disableColumns>
  <Button>Custom action</Button>
</DatagridToolbar>
```

`DatagridToolbar` must be rendered inside `Datagrid` or `DatagridPage`. Props:

| Prop | Effect |
|------|--------|
| `disableFiltering` | Hides the filter control. |
| `disableSorting` | Hides the sort control. |
| `disableColumns` | Hides the column chooser. |
| `disableViews` | Hides saved views. |
| `disableRowHeight` | Hides the row-height selector. |
| `disableSearch` | Hides quick search even when the table has search config. |
| `children` | Extra toolbar nodes. |

### `pages/datagrid_internals/action_dialog_datagrid`

```tsx
import {
  DatagridActionDialog,
  WithTotalCount,
} from "pages/datagrid_internals/action_dialog_datagrid";
import { sql } from "std/sql_utils";

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

`DatagridActionDialog` runs bulk actions on the current selection:

| Prop | Description |
|------|-------------|
| `open` | SQL boolean controlling dialog visibility. |
| `onClose` | DOM/server statements run when closing. |
| `maxWidth` | Optional `"sm"`, `"md"`, or `"lg"`. |
| `sx` | Dialog style overrides. |
| `title` | Static string or SQL title. |
| `titleProps` | Typography props for the title. |
| `header` | Optional header node. |
| `description` | Optional description node. |
| `form` | Optional form node. |
| `defaultFieldComponent` | Field component used by generated form content. |
| `confirmDisabled` | SQL boolean disabling the confirm action. |
| `action` | Transaction hooks for the selected row set. |

`action` hooks: `beforeTransactionStart`, `afterTransactionStart`,
`beforeTransactionCommit`, `afterTransactionCommit`. Each receives server
statements and a SQL table expression of selected ids. `WithTotalCount` exposes
the selected count, including "select all".

### `pages/datagrid_internals/toolbar_filter`

```tsx
import {
  FilterStringInput,
  ToolbarFilterButton,
} from "pages/datagrid_internals/toolbar_filter";
```

Low-level custom-toolbar filters:
`FilterTermHelper`, `FilterStringInput`, `FilterEnumSelect`,
`FilterDateInput`, `CheckboxFilter`, `FilterNumberInput`,
`FilterDurationInput`, `FilterEnumLikeBool`, `ToolbarFilterButton`, and
`FkFilter`. New grids should prefer `filterable`, `quickSearch`, and standard
toolbar APIs.
