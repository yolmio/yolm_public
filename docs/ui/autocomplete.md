---
title: Autocomplete & Select Components
description: Components for selecting values from lists — searchable comboboxes, database-backed selects, and static option selects.
tags:
  - ui
  - components
  - autocomplete
  - combobox
  - select
---

# Autocomplete & Select Components

| Scenario | Component | Import |
|----------|-----------|--------|
| Pick a record from a `db` table, configured from the table's schema | `TableRecordSelect` | `components/table_record_select` |
| Searchable input over a custom query | `QueryCombobox` | `components/query_combobox` |
| Small dropdown over a table already in scope | `EachSelect` | `components/each_select` |
| Static options known at generation time | `Select` ([Select](./select.md)) | `components/select` |

Inside a `Form`, a `ForeignKey` field already renders `TableRecordSelect`
through [`FieldFormControl`](./field_form_control.md).

## TableRecordSelect

```tsx
<TableRecordSelect
  tableName="clients"
  value={sql`client_id`}
  onSelectValue={(s, id) => s.setScalar("client_id", id)}
  placeholder="Search clients..."
/>
```

The table's `control` config in `core.tsx` picks the rendering:

- `"Combobox"` (default): a `QueryCombobox` with ranked fuzzy search from the
  table's `searchConfig`. Requires `recordDisplayName` and `searchConfig` on
  the table; otherwise it throws at generation time. With an empty query it
  lists `order by id desc limit 50` (table `limit` / `emptyQuery` override).
- `"Select"`: an `EachSelect` over all records.
- `"Custom"`: the table's custom component.

`value` is the selected id; the display text is looked up from
`recordDisplayName`. `where` filters the offered records (it replaces a
`where` from the table's `control` config). `onComboboxSelectValue(s, id,
label, record)` replaces `onSelectValue` when you need the label or extra
columns. `dialogInsert` adds an "Add" row that opens an `AutoInsertDialog`;
`disableDialogInsert` suppresses it even when the table enables it. See
`TableRecordSelectProps` (extends `TableControlOpts`) in
`components/table_record_select` for the full contract.

## QueryCombobox

The low-level searchable combobox. `populateResultTable`, `onSelect`, `onClear`,
and `onBlur` are all required.

```tsx
<QueryCombobox
  placeholder="Search client..."
  initialInputText={sql`initial_text`}
  populateResultTable={(s, query, resultTable) => {
    s.conditional({
      condition: sql`trim(${query}) = ''`,
      then: (s) => {
        s.modify(sql`insert into ${resultTable}
          select name as label, rank() over () - 1 as index, id
          from db.clients order by id desc limit 50`);
      },
      else: (s) => {
        s.modify(sql`insert into ${resultTable}
          select name as label, rank() over () - 1 as index, id
          from db.clients
          where fuzzy_match(${query}, name)
          order by fuzzy_rank_key(${query}, name)
          limit 50`);
      },
    });
  }}
  onSelect={(s, result) => s.setScalar("client_id", sql`${result}.id`)}
  onClear={(s) => s.setScalar("client_id", sql.null)}
  onBlur={() => {}}
/>
```

### populateResultTable

Runs in a state procedure (`StateStatements`) only while the list is showing,
re-running as the input changes.

By default this is a server procedure. For a small reference catalog already
loaded into ancestor `ui.*` state, pass `local` and query that UI table instead
of `db.*`. Load the scoped catalog once outside the individual controls and
refresh it when its parent scope or reference data changes. Selection callbacks
should reuse the loaded fields as well. Keep authoritative save validation on
the server. See [Interactive request cost](../ai/review.md#interactive-request-cost)
for the required request-count and keyboard regression checks.

- `query` is the current text, or `''` when the text still equals the last
  valid selection (so reopening shows the default list).
- `resultTable` must receive `label` (String), `index` (BigInt, zero-based,
  usually `rank() over () - 1`), and `id` (BigInt). For extra columns, pass
  `resultTableInferQuery` so the result table's schema is inferred from a query.
- `onSelect` receives `result`, a record of the selected row
  (`${result}.id`, `${result}.label`, extra columns).

### Non-obvious props

- `local`: run `populateResultTable` in the browser over already-loaded UI data,
  without a server request. Do not read `db.*` in this mode. The default remains
  server-backed for large/dynamic searches.
- `initialInputText`: SQL text shown before the user types, e.g. the label of
  an existing foreign-key value.
- `clearOnSelect`: empty the input after each selection (multi-add flows).
- `selectFirstResultOnEnterOrTab`: commit the first result when Enter/Tab is
  pressed without highlighting an option.
- `displayItem={({ record }) => ...}`: custom row rendering.
- `addItem`: a create-new row with `component`, `onClick(s, { query,
  openScalar })`, and optional `dialog` whose `onConfirm(s, { id, label })`
  selects the created record.
- Keyboard navigation: ArrowUp/ArrowDown move the highlight; Enter/Tab select.
- The combobox resets when an enclosing `Form` resets.

See the `QueryCombobox` props in `components/query_combobox` for the full contract.

```tsx
addItem={{
  component: (props) => <>Add "{props.query}"</>,
  onClick: (s, { openScalar }) => s.setScalar(openScalar, sql.true),
  dialog: (props) => (
    <MyInsertDialog
      open={sql`${props.openScalar}`}
      onConfirm={(s, id, label) => props.onConfirm(s, { id, label })}
    />
  ),
}}
```

## EachSelect

A dropdown over rows of `table` (`select * from <table>`), typically a table
declared by an enclosing `Data`. `value` and the `onChange` argument are the
record id; `optionLabel` / `optionValue` name columns. `where`, `orderBy`, and
`limit` filter the rows. See the `EachSelect` props in `components/each_select`.

```tsx
<Data procedure={(s) => {
  s.defTable("statuses", sql`select id, label from db.statuses order by label`);
}}>
  <EachSelect
    table="statuses"
    optionLabel="label"
    optionValue="id"
    value={sql`selected_status_id`}
    onChange={(s, id) => s.setScalar("selected_status_id", id)}
  />
</Data>
```

## Common Mistakes

- Omitting `onClear` or `onBlur` on `QueryCombobox`; both are required (pass
  `() => {}` for a no-op blur).
- Hand-building a `QueryCombobox` for a standard table lookup that
  `TableRecordSelect` configures from `searchConfig`.
- Using `TableRecordSelect` on a table without `recordDisplayName` /
  `searchConfig` (generation-time error for the Combobox control).
- Inserting result rows without `index`; selection and keyboard navigation
  are keyed by it.
