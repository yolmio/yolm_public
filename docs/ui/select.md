---
title: Select
description: Dropdown Select and table-backed EachSelect components with SQL-bound values, enum casting, dynamic options, and keyboard navigation.
tags:
  - ui
  - components
  - select
  - form
  - dropdown
related:
  - ui/radio.md
  - ui/autocomplete.md
  - ui/form.md
  - ui/styling.md
---

# Select

`Select` renders a dropdown of `Select.Option` children with keyboard
navigation and type-by-letter search.

```tsx
import { Select } from "components/select";

<Select
  value={sql`status`}
  onChange={(s) => s.setScalar("status", sql`target_value`)}
  placeholder="Pick a status"
>
  <Select.Option value="active">Active</Select.Option>
  <Select.Option value="inactive">Inactive</Select.Option>
</Select>
```

## Value Binding

`Select` has no `bindScalar`. Bind with `value` plus `onChange` (or `onInput`):

- `value` is a SQL expression for the current selection. The component copies
  it into a local `target_value` scalar and re-syncs when `value` changes.
- Clicking an option sets `target_value` to the option's value, then calls
  `onInput` and `onChange` with `(s, target_value)`. Write it back to your
  state there; otherwise the selection is not stored anywhere else.
- `target_value` is typed by `valueType` (default `String`), or as the enum
  when `enumName` is set.

`enumName="us_state"` casts values to and from that Yolm enum. With
`enumName`, an option whose `value` is `""` means null.

Without `enumName`, an empty-string option is an ordinary `''` value, handy for
"All" filters (initialize the scalar to `''`):

```tsx
<Select
  size="sm"
  value={sql`filter_rate_type`}
  onChange={(s) => s.setScalar("filter_rate_type", sql`target_value`)}
>
  <Select.Option value="">All Types</Select.Option>
  <Select.Option value="search_fee">Search Fee</Select.Option>
  <Select.Option value="court_fee">Court Fee</Select.Option>
</Select>
```

```sql
select * from db.rates
where filter_rate_type = '' or rate_type = filter_rate_type
```

## Options

- `Select.Option`: `value` (static string, or SQL inside `Each`), `searchText`
  (type-by-letter text and accessible label), `disabled` (SQL), children.
- A SQL `value` inside `Each` becomes one option per row; dynamic values are
  compared as strings.
- `Select.Group label="..."` adds a heading; `Select.Separator` adds a rule.

```tsx
<Select
  value={sql`selected_customer_id`}
  valueType="BigInt"
  onChange={(s) => s.setScalar("selected_customer_id", sql`target_value`)}
>
  <Each table="customers" recordName="customer">
    <Select.Option value={sql`customer.id`} searchText={sql`customer.name`}>
      {sql`customer.name`}
    </Select.Option>
  </Each>
</Select>
```

## Non-Obvious Props

- `placeholder` (default `"Select option"`) shows only when `target_value` is
  null and there is no `""` option and no `enumName`.
- `error` (SQL boolean) toggles danger styling; use it rather than a SQL
  `color`.
- `variant`, `color`, and `size` follow the shared
  [styling props](./styling.md#color-variant-and-size); defaults `outlined` /
  `neutral` / `md`.
- `placement` positions the popover (default `"bottom"`).
- Keyboard: Arrow Up/Down move focus, Enter/Space select and toggle, letter
  keys jump to a matching option.

See `SelectProps` in `components/select` for the full contract. Related
pickers: `EnumSelect` (`components/enum_select`) for an enum's values,
[Autocomplete](./autocomplete.md) / `QueryCombobox` for searchable type-ahead.

## EachSelect

`EachSelect` builds the options from a table query. Pass `table`,
`optionLabel`, and `optionValue` (column names); narrow with `where`,
`orderBy`, `limit`, and re-run the option query with `watch`.

```tsx
import { EachSelect } from "components/each_select";

<EachSelect
  table="available_pipelines"
  optionLabel="name"
  optionValue="id"
  value={sql`run_pipeline_id`}
  onChange={(s, recordId) => s.setScalar("run_pipeline_id", recordId)}
  placeholder="Pipeline..."
/>
```

- `value` and the `onChange` second argument are the `optionValue` column
  (usually `id`); `valueType` defaults to `BigInt`.
- `renderItem` replaces the option label with a custom node; the current row
  is available as `<table>_record` (e.g. `available_pipelines_record.name`).
- `findOnValue` picks the column for type-by-letter search (default
  `optionLabel`).
- `placeholder` is a plain string here, not SQL.
