---
title: CountrySelect
description: Searchable country picker bound to a SQL value, with built-in filtering, keyboard navigation, and optional country enum casting.
tags:
  - ui
  - components
  - country
  - select
  - form
related:
  - ui/overview.md
  - ui/select.md
  - ui/data.md
  - ui/styling.md
---

# CountrySelect

A searchable combobox over every ISO country from `countries` in
`enums/country`. For arbitrary options use [`Select`](./select.md). Inside a
`Form`, an `Enum` field of enum `country` renders it automatically via
[`FieldFormControl`](./field_form_control.md).

```tsx
import { CountrySelect } from "components/country_select";
```

```tsx
<Data
  local
  procedure={(s) => {
    s.defScalar("home_country", { type: "String", maxLength: 2 });
  }}
>
  <CountrySelect
    value={sql`home_country`}
    onChange={(s, newValue) => s.setScalar("home_country", newValue)}
  />
</Data>
```

## Value binding

- The component builds its own local `Data` for the country list and
  search/highlight state; you own the selected value.
- `value` is watched, so external changes re-sync the input.
- `onChange` and `onInput` are both called, with the same arguments, on pick
  and on clear. `newValue` (the second argument, not `target_value`) is the
  alpha-2 code such as `'US'`, or null when cleared (clear button, or Backspace
  with a value selected).
- Labels show the flag emoji plus name (`countries[].displayName`); the stored
  value is the bare code.

## Country enum

Without `enumName`, values are `String` (max length 2). To store the `country`
enum, register it once in `core.tsx` and pass `enumName`; the bound scalar
must then be enum-typed too.

```tsx
// core.tsx
import { countryEnum } from "enums/country";
countryEnum(); // registers enum `country` with alpha-2 variant names
```

```tsx
s.defScalar("home_country", { type: { type: "Enum", enum: "country" } });

<CountrySelect
  enumName="country"
  value={sql`home_country`}
  onChange={(s, newValue) => s.setScalar("home_country", newValue)}
/>
```

## Behavior

- Typing filters by case-insensitive substring on the label.
- While the list is open: ArrowDown/ArrowUp move the highlight (wrapping),
  Enter/Tab select. Backspace on a selected value clears it and reopens the
  list.
- The placeholder is fixed to `Select a country`. Built-in clear and
  dropdown-arrow buttons precede any `endDecorator` you pass.

`size`, `color` (default `neutral`), and `variant` follow the shared
[styling props](./styling.md#color-variant-and-size). See the `CountrySelect`
props in `components/country_select` for the full contract (`id`,
`immediateFocus`, `slots`/`slotProps`).
