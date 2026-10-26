---
title: Datagrid Virtual Columns
description: How to add computed columns, cross-table queries, and custom cells to datagrids using virtual columns.
tags:
  - ui
  - datagrid
  - virtual-columns
  - computed-fields
---

# Datagrid Virtual Columns

Virtual columns add SQL-computed values to a [`DatagridPage`](./datagrid.md)
query without adding database fields. They can be filtered, sorted, exported,
and custom-rendered. Inside `expr`, `record` is the grid's current table row.

```tsx
<DatagridPage
  table="contacts"
  columns={(b) => {
    b.autoFields();
    b.virtualColumn({
      storageName: "company_state",
      displayName: "Company State",
      expr: sql`(select state from db.companies where id = record.company_id)`,
      filter: { type: "enum", enum: "us_state", notNull: false },
    });
    b.virtualColumn({
      storageName: "company_industry",
      expr: sql`(select industry_id from db.companies where id = record.company_id)`,
      filter: { type: "table", table: "industries", notNull: true },
    });
    b.countVirtual("calendly_appointments");
    b.countVirtual({
      storageName: "additional_emails",
      table: "client_additional_emails",
    });
  }}
/>
```

`storageName` (unique; used in saved views and URL filters) and `expr` are
required. Common optional properties: `displayName`, `valueType`, `cell`,
`filter`, `sort`, `initialWidth`, `initiallyDisplaying`, and `pin`. When
`filter` is omitted, `valueType` (or analysis of `expr`) still selects
field-aware default cells and exports: `table` values render as the record's
display text and `enum` values via the enum's display function.

## Filter and Sort Types

`filter.type` is one of `string`, `number`, `date`, `timestamp`, `bool`,
`minutes_duration` (each with `notNull`), `table` (`table`), `enum` (`enum`,
optional `optionsQuery` with `value`/`label` columns), `enum_like_bool`, or
`custom`. A custom predicate is passed as `filterExpr(value1, value2, value3)`
and requires `filterExampleValues` for query validation.

`sort.type` is `string`, `numeric`, `checkbox`, or `custom`. Use `numeric` for
boolean `exists(...)` columns. `customSortColumn` adds a sort expression that is
generated only while actively sorted.

See `FilterType` and `SortConfig` in `pages/datagrid_internals/dynamic_datagrid`
for the full contract.

### Related String Values

When a column displays an aggregate of related strings, add a `relation` so
comparisons run against each related value instead of the aggregate:

```tsx
b.virtualColumn({
  storageName: "notes",
  expr: sql`coalesce((
    select string_agg(n.note, ' | ')
    from db.notes n
    where n.contact_id = record.id
  ), '')`,
  filter: {
    type: "string",
    notNull: false,
    relation: {
      from: sql`db.notes n`,
      value: sql`n.note`,
      where: sql`n.contact_id = record.id`,
    },
  },
});
```

Positive comparisons use `exists` over matching related rows; negative ones
use `not exists`, so "does not contain X" means no related value contains X.
Empty/not-empty test whether any non-null, non-empty related value exists. The
outer query is not joined, so related rows never duplicate records or change
pagination.

## Custom Cells

`cell` accepts a node or `({ helper }) => Node`. Inside a cell component,
`useCellHelper()` returns the same helper:

- `value`: this column's value from the grid query. Values are strings, so
  booleans compare against `'true'`.
- `recordId`: the row's primary key.
- `record`: reference to the current grid row.

A boolean column renders as a read-only checkbox like this:

```tsx
function ScheduledAppointment() {
  const cell = useCellHelper();
  return (
    <Checkbox
      sx={{ mx: "auto" }}
      checked={sql`${cell.value} = 'true'`}
      variant="outlined"
      color="neutral"
      readOnly
      tabIndex={-1}
      onCheckboxChange={(s) => s.event.preventDefault()}
    />
  );
}
```

Compute everything the cell displays in `expr`; keep only transient UI state
(such as dialog open flags) in the cell:

```tsx
function NotificationStatus() {
  const cell = useCellHelper();
  const failed = sql`${cell.value} = 'true'`;
  return (
    <State procedure={(s) => s.defScalar("dialog_open", sql`false`)}>
      <Button
        variant="soft"
        color="primary"
        onClick={(s) => s.setScalar("dialog_open", sql`true`)}
      >
        <Show when={failed} fallback="Notifications sent">
          Notifications failed
        </Show>
      </Button>
      <NotificationsDialog
        bindScalar="dialog_open"
        appointmentId={cell.recordId}
        onClose={(s) => s.setScalar("dialog_open", sql`false`)}
      />
    </State>
  );
}

b.virtualColumn({
  storageName: "notification_failed",
  displayName: "Notifications",
  expr: sql`exists(
    select 1 from db.scheduling_appointment_notifications_status
    where scheduling_appointment_id = record.id and status = 'failed'
  )`,
  filter: { type: "bool", notNull: true },
  sort: { type: "numeric" },
  initialWidth: 200,
  cell: <NotificationStatus />,
});
```

Use `b.cellOnlyColumn({ storageName, displayName, cell })` only for UI-only
cells (action buttons, menus) that need no per-row database data. A `Data`
keyed on `cell.recordId` runs once per visible row; see
[Keep cell data in the grid query](./datagrid.md#keep-cell-data-in-the-grid-query).

## Query Cost

Virtual columns run in the list query for every visible row. See
[Yolm SQL Query Authoring Notes](../sql/query_planning.md).

- Prefer `exists(...)` over `count(*)` when only a yes/no is needed.
- Add `filter`/`sort` only where users need them.
- Avoid per-row top-1 scans (`select ... where child.parent_id = record.id
  order by ... limit 1`). When many rows need the latest child value, rank the
  child table once with `row_number() over (partition by parent_id order by
  ...)` and filter to `rn = 1`.
- When several columns share an expensive match predicate, compute the matched
  ids once in a CTE or local SQL helper and reuse it, keeping counts, lists,
  and "latest in group" aligned.
- Before landing a performance rewrite, compare old and new SQL on
  representative rows, including null and duplicate cases.
