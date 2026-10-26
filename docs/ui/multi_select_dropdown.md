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

A button whose label summarizes the current selection and opens a popover of
checkbox (or radio) rows. Items come from a SQL query; your toggle handler
performs every write. For single-value static or enum options, use
[`Select`](./select.md).

```tsx
import { MultiSelectDropdown } from "components/multi_select_dropdown";
```

```tsx
<MultiSelectDropdown
  placeholder="All people"
  selectedItemsQuery={sql`(select string_agg(name, ', ') from audiences
    where (',' || coalesce(selected_ids, '') || ',') like '%,' || id::string || ',%')`}
  availableItemsQuery={sql`select id, name, description,
    (',' || coalesce(selected_ids, '') || ',') like '%,' || id::string || ',%' as is_selected
    from audiences`}
  watch={[sql`selected_ids`]}
  onToggleItem={() => ({
    onSelected: (s) =>
      s.setScalar("selected_ids", sql`case when coalesce(selected_ids, '') = ''
        then item.id::string else selected_ids || ',' || item.id::string end`),
    onDeselected: (s) =>
      s.setScalar("selected_ids", sql`coalesce((select string_agg(value, ',' order by ordinal)
        from string.split(coalesce(selected_ids, ''), ',')
        where value != item.id::string and value != ''), '')`),
  })}
/>
```

## Query contract

- `availableItemsQuery` is a table query (one row per item). The component
  reads `name`, `is_selected` (checked state and which toggle branch runs), and
  `description` (secondary text, shown when not null). Include `id` (or any key)
  so handlers can target the row.
- `selectedItemsQuery` is a **scalar** expression for the button label;
  aggregate with `string_agg` for many rows. A null value shows `placeholder`
  (default `"None"`). `selectedItemsValue`, when given, replaces it.
- The SQL is evaluated in the scope where the component renders; it needs no
  surrounding `Form`.

## Toggling and refresh

- On click (or Space/Enter), the component runs `onDeselected` when
  `item.is_selected` is true, otherwise `onSelected`. `item.*` (the clicked row)
  is in scope only inside these callbacks. `onToggleItem` receives
  `item.is_selected` if you need to branch further.
- Handlers run detached from the node, so a save completes even when "Done"
  closes the popover.
- The label and list live in `local` `Data` nodes, so `s.refetch()` does not
  refresh them. Pass `watch` with an expression your handlers change (the
  selection scalar, or a counter you increment after a server write).
- `showRadioButtons` changes only the indicator; single selection is not
  enforced, so `onSelected` must clear other rows itself.

## Non-obvious props

- `searchPlaceholder`: setting it enables a search input that fuzzy-matches
  `name` and `description`.
- `buttonSize` (default `sm`) also sizes the list, search input, and toggles.
- `buttonVariant` (default `plain`), `buttonColor`, and `buttonSize` are static
  strings; see [styling props](./styling.md#color-variant-and-size).
- `showDivider` (default `true`) adds the divider and "Done" button.
- `dropdownWidth` (min px, default 250) and `maxDropdownHeight` (px, default
  300).

See the `MultiSelectDropdown` props in `components/multi_select_dropdown` for the
full contract.
