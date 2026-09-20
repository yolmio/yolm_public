---
title: MultiSelectDropdown
description: Dropdown for selecting zero or more items from a SQL-driven list, with checkbox or radio toggles and a summary label.
tags:
  - ui
  - components
  - dropdown
  - select
  - form
related:
  - ui/overview.md
  - ui/select.md
  - ui/data.md
  - ui/styling.md
---

# MultiSelectDropdown

`MultiSelectDropdown` renders a button that opens a popover list of items, each with a checkbox (or radio). The button label summarizes the current selection or shows a placeholder when nothing is selected. The whole control is driven by two SQL queries plus a toggle handler that you supply.

Use it when the selectable items come from a query and you want a compact, multi-pick control with a summary label. For single-value selection from static or enum options, use [`Select`](./select.md) instead.

```tsx
import { MultiSelectDropdown } from "components/multi_select_dropdown";
```

## Usage

The component is placed inline like a form control. It creates its own internal `Data` scopes for its open/close state and for the two queries, so it needs no surrounding `Data`/`Form` context — but the SQL you pass must resolve in the scope where you render it (the referenced tables and scalars must be reachable). Each row from `availableItemsQuery` is exposed as `item` inside the toggle handler, so `item.id`, `item.name`, `item.is_selected`, etc. are available there.

```tsx
<MultiSelectDropdown
  buttonSize="xs"
  placeholder="Pick tags"
  selectedItemsQuery={sql`(select string_agg(name, ', ') from xs_multi_items where is_selected)`}
  availableItemsQuery={sql`select id, name, description, is_selected from xs_multi_items`}
  onToggleItem={() => ({
    onSelected: (s) => {
      s.modify(
        sql`update xs_multi_items set is_selected = true where id = item.id`,
      );
    },
    onDeselected: (s) => {
      s.modify(
        sql`update xs_multi_items set is_selected = false where id = item.id`,
      );
    },
  })}
/>
```

## Query Contract

`availableItemsQuery` is run as a table query (`defTable`). It must return one row per selectable item. The component itself reads `name`, `description`, and `is_selected`; include `id` so your `onToggleItem` handler can identify the clicked row.

| Column | Type | Required | Used for |
|--------|------|----------|----------|
| `name` | string | Yes | Primary label rendered for each row |
| `is_selected` | bool | Yes | Drives the checkbox/radio state and which toggle branch runs |
| `description` | string | No | Secondary label, rendered only when not null |
| `id` | scalar | For mutations | Not read by the component; available as `item.id` inside the toggle handler to target the row |

`selectedItemsQuery` (or `selectedItemsValue`) is run as a scalar (`defScalar`) and used as the button label. When that value is null, the button shows `placeholder`. The example aggregates the selected names with `string_agg`.

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `selectedItemsQuery` | `Sql` | Yes | Scalar SQL expression for the button's summary label. Shows `placeholder` when it resolves to null |
| `selectedItemsValue` | `Sql` | No | Alternative scalar label value; used in place of `selectedItemsQuery` when provided |
| `availableItemsQuery` | `Sql` | Yes | Table query for the list rows (see Query Contract above) |
| `onToggleItem` | `(isSelected: AnyExpr) => { onSelected: (s: DomStatements) => void; onDeselected: (s: DomStatements) => void }` | Yes | Called per row with the row's `is_selected` value; returns the statements to run when toggling on (`onSelected`) or off (`onDeselected`). `s` is the DOM statement builder |
| `placeholder` | `string` | No | Button text when nothing is selected. Default `"None"` |
| `buttonVariant` | `"plain" \| "outlined" \| "solid" \| "soft"` | No | Trigger button style. Default `"plain"` |
| `buttonSize` | `"xs" \| "sm" \| "md" \| "lg"` | No | Size applied to the button, list, and controls. Default `"sm"` |
| `buttonColor` | `Color` | No | Semantic color for the trigger button |
| `buttonSx` | `Style` | No | Styles for the trigger button |
| `dropdownWidth` | `number` | No | Minimum width of the popover in pixels. Default `250` |
| `maxDropdownHeight` | `number` | No | Maximum height of the popover in pixels before it scrolls. Default `300` |
| `searchPlaceholder` | `string` | No | Placeholder for the optional search input |
| `showDivider` | `boolean` | No | Show a divider and a "Done" button at the bottom of the popover. Default `true` |
| `watch` | `AnyExpr[]` | No | Expressions to watch; the label and list queries re-run when these change. Default `[]` |
| `showRadioButtons` | `boolean` | No | Render radio indicators instead of checkboxes. Default `false` |

## How Toggling Works

`onToggleItem` receives the row's `is_selected` expression and returns two callbacks, each taking the DOM statement builder `s`. When a row is clicked, the component runs `onDeselected` if the row was already selected, otherwise `onSelected`. Inside both callbacks the current row's columns are in scope under `item` (e.g. `item.id`). The component does not persist anything itself — your callbacks perform the mutation.

```tsx
onToggleItem={() => ({
  onSelected: (s) =>
    s.modify(sql`update my_items set is_selected = true where id = item.id`),
  onDeselected: (s) =>
    s.modify(sql`update my_items set is_selected = false where id = item.id`),
})}
```

The `isSelected` argument is passed in case the same logic needs to branch on the prior state; in the common case you can ignore it and rely on the two callbacks.

## Radio Variant

Set `showRadioButtons` to render radio indicators rather than checkboxes. The control still calls `onToggleItem` per row — exclusivity (clearing other rows) is up to your handler; the component does not enforce single selection.

```tsx
<MultiSelectDropdown
  showRadioButtons
  selectedItemsQuery={sql`(select name from items where is_selected limit 1)`}
  availableItemsQuery={sql`select id, name, description, is_selected from items`}
  onToggleItem={() => ({
    onSelected: (s) =>
      s.modify(sql`update items set is_selected = (id = item.id)`),
    onDeselected: (s) =>
      s.modify(sql`update items set is_selected = false where id = item.id`),
  })}
/>
```

## Common Mistakes

- Omitting `name` or `is_selected` from `availableItemsQuery` — both are read by the component. Include `id` too so your handler can target the row; `description` is optional.
- Referencing `item.*` outside `onToggleItem`. The row alias `item` only exists inside that handler's callbacks.
- Expecting `selectedItemsQuery` to return a table. It must resolve to a single scalar value for the label; aggregate (e.g. `string_agg`) when summarizing many rows.
- Passing SQL to `buttonVariant` or `buttonSize`. These are generation-time strings, not SQL expressions.
- Relying on the component to write data. It only invokes your `onSelected` / `onDeselected` statements — perform the mutation there.
