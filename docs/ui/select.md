---
title: Select
description: Dropdown select component for choosing from a list of options, with SQL-bound value and keyboard navigation.
tags:
  - ui
  - components
  - select
  - form
  - dropdown
---

# Select

The Select component renders a dropdown for choosing from a list of options. It supports keyboard navigation, popover placement, decorators, and SQL-bound values.

```tsx
import { Select } from "components/select";
```

## Basic Usage

Use `Select` with `Select.Option` children. Each option has a value and
arbitrary children for display.

```tsx
<Select
  value={sql`selected_color`}
  onChange={(s) => s.setScalar("selected_color", sql`target_value`)}
  placeholder="Pick a color"
>
  <Select.Option value="red">Red</Select.Option>
  <Select.Option value="green">Green</Select.Option>
  <Select.Option value="blue">Blue</Select.Option>
</Select>
```

## How Value Binding Works

Select uses a two-phase system:

1. **`value`** - A SQL expression for the currently selected value. The component watches this and re-renders when it changes.
2. **`onChange` / `onInput`** - Called when the user picks an option. The selected option's string value is available as `target_value`.

```tsx
// In a Data procedure, define the scalar:
s.defScalar("status", sql.lit`active`);

// In the UI, bind to it:
<Select
  value={sql`status`}
  onChange={(s) => s.setScalar("status", sql`target_value`)}
>
  <Select.Option value="active">Active</Select.Option>
  <Select.Option value="inactive">Inactive</Select.Option>
</Select>
```

`target_value` is a SQL string expression containing the `value` prop of the clicked `Select.Option`.

## Common Props

Use the exported TypeScript props for the full contract. The usual solution
pattern is `value` plus `onChange` or `onInput`, with `Select.Option` children.

- `target_value` is the selected option value inside handlers.
- `enumName` casts values to and from a Yolm enum.
- `placeholder` and `error` may be SQL expressions.
- `variant`, `color`, `size`, and decorators are generation-time UI choices.

## Select.Option Props

| Prop | Type | Description |
|------|------|-------------|
| `value` | `string \| Sql` | The value for this option (must be unique among siblings) |
| `searchText` | `string \| Sql` | Text used for type-by-letter search and as the option's accessible label |
| `disabled` | `BooleanExpr` | Marks the option as disabled |
| `children` | `Node` | Display content for the option |

## Enum Select

Use `enumName` to bind to a Yolm enum. The component will cast values to and from the enum type automatically.

```tsx
<Select
  enumName="us_state"
  value={sql`form_state`}
  onChange={(s) => s.setScalar("form_state", sql`target_value`)}
>
  <Select.Option value="">Any State</Select.Option>
  <Select.Option value="CA">California</Select.Option>
  <Select.Option value="NY">New York</Select.Option>
  <Select.Option value="TX">Texas</Select.Option>
</Select>
```

When `enumName` is set and an option has `value=""`, the component treats it as null (unselected).

## With FormControl

Wrap in `FormControl` and `FormLabel` for labeled form fields.

```tsx
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";

<FormControl>
  <FormLabel>Category</FormLabel>
  <Select
    value={sql`form_category`}
    onChange={(s) => s.setScalar("form_category", sql`target_value`)}
  >
    <Select.Option value="revenue">Revenue</Select.Option>
    <Select.Option value="search_fees">Search Fees</Select.Option>
    <Select.Option value="court_fees">Court Fees</Select.Option>
  </Select>
</FormControl>
```

## Filter Pattern with "All" Option

Use an empty-string option to represent "no filter" / "all":

```tsx
<Select
  value={sql`filter_rate_type`}
  onChange={(s) => s.setScalar("filter_rate_type", sql`target_value`)}
  size="sm"
>
  <Select.Option value="">All Types</Select.Option>
  <Select.Option value="search_fee">Search Fee</Select.Option>
  <Select.Option value="court_fee">Court Fee</Select.Option>
  <Select.Option value="hit_fee">Hit Fee</Select.Option>
</Select>
```

Then filter with:

```sql
select * from db.rates
where filter_rate_type = '' or rate_type = filter_rate_type
```

## Sizes

```tsx
<Select size="xs" value={sql`val`} onChange={(s) => s.setScalar("val", sql`target_value`)}>
  <Select.Option value="a">Extra small</Select.Option>
</Select>

<Select size="sm" value={sql`val`} onChange={(s) => s.setScalar("val", sql`target_value`)}>
  <Select.Option value="a">Small</Select.Option>
</Select>

<Select size="md" value={sql`val`} onChange={(s) => s.setScalar("val", sql`target_value`)}>
  <Select.Option value="a">Medium (default)</Select.Option>
</Select>

<Select size="lg" value={sql`val`} onChange={(s) => s.setScalar("val", sql`target_value`)}>
  <Select.Option value="a">Large</Select.Option>
</Select>
```

## Error State

Pass a SQL boolean expression to `error` to show error styling:

```tsx
<Select
  value={sql`form_category`}
  onChange={(s) => s.setScalar("form_category", sql`target_value`)}
  error={sql`form_category is null or form_category = ''`}
>
  <Select.Option value="a">Option A</Select.Option>
  <Select.Option value="b">Option B</Select.Option>
</Select>
```

## Keyboard Navigation

The Select component has built-in keyboard support:

- **Arrow Down / Arrow Up** - Navigate through options
- **Enter / Space** - Select the focused option and toggle the popover
- **Letter keys** - Jump to the first option starting with that letter

## Common Mistakes

```tsx
// Wrong - color/variant cannot be SQL expressions
<Select color={sql`case when error then 'danger' else 'neutral' end`}>

// Correct - use the error prop for dynamic error styling
<Select color="neutral" error={sql`has_error`}>
```

## Dynamic Options

Use SQL-valued `Select.Option` values inside `Each` when options come from a
database query:

```tsx
<Select
  value={sql`selected_customer_id`}
  onChange={(s) => s.setScalar("selected_customer_id", sql`target_value`)}
>
  <Each table="customers" recordName="customer">
    <Select.Option
      value={sql`customer.id`}
      searchText={sql`customer.name`}
    >
      {sql`customer.name`}
    </Select.Option>
  </Each>
</Select>
```

For table-backed selection controls with built-in fetching/search behavior,
prefer `EachSelect` from `components/each_select`.

## EachSelect

`EachSelect` is a `Select` whose options are populated from rows in a database
table. Use it for table-backed selection - e.g. a small status table or a
foreign-key picker that fits comfortably in a dropdown. The selected value is
always the record id, and `onChange` receives the picked record id. Provide
`table` plus `optionLabel` / `optionValue` (column names); narrow the option
query with `where`, `orderBy`, and `limit`.

```tsx
import { EachSelect } from "components/each_select";
```

### Usage

Unlike `Select`, you do not pass `Select.Option` children - the options come
from the table:

```tsx
<EachSelect
  table="available_pipelines"
  value={sql`run_pipeline_id`}
  onChange={(s, recordId) => s.setScalar("run_pipeline_id", recordId)}
  optionLabel="name"
  optionValue="id"
  placeholder="Pipeline..."
  size="sm"
/>
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `table` | `string` | Yes | Table whose rows become options |
| `optionLabel` | `string` | Yes | Column name shown as each option's label |
| `optionValue` | `string` | Yes | Column name used as each option's value (usually `id`) |
| `value` | `NumericExpr` | No | Currently selected record id |
| `onChange` | `(s, recordId) => void` | No | Called with the picked record id |
| `where` | `BooleanExpr` | No | Filter applied to the option query |
| `orderBy` | `AnyExpr` | No | Ordering applied to the option query |
| `limit` | `NumericExpr` | No | Row limit on the option query |
| `findOnValue` | `string` | No | Column used for type-by-letter search (default: `optionLabel`) |
| `valueType` | `HelperFieldType` | No | Type of the value scalar (default `BigInt`) |
| `watch` | `AnyExpr[]` | No | Expressions that re-run the option query when they change |
| `placeholder` | `string` | No | Text shown when nothing is selected (default `"Select option"`) |
| `error` | `BooleanExpr` | No | Toggles error styling |
| `startDecorator` / `endDecorator` | `Node` | No | Content rendered before / after the value |
| `fullWidth` | `boolean` | No | Stretch to the container width |
| `variant`, `color`, `size` | generation-time | No | Trigger styling (defaults `outlined` / `neutral` / `md`) |
| `id` | `Sql \| string` | No | Element id (auto-generated when omitted) |

`value` and `onChange` operate on the record id (a number), not a string
option value. Supports the same keyboard navigation as `Select` (Arrow keys,
Enter/Space, and type-by-letter search via `findOnValue`).
