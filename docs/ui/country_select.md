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

`CountrySelect` renders a searchable combobox pre-populated with every ISO
country (alpha-2 code + flag display name). Use it when the choice is a country
and you want type-to-filter search without wiring up options yourself. For a
generic dropdown over arbitrary options use [`Select`](./select.md) instead.

```tsx
import { CountrySelect } from "components/country_select";
```

The country list comes from the `countries` array in `enums/country`. To store
the value as a typed enum rather than a plain string, register the matching
enum with `countryEnum()` and pass `enumName="country"` (see
[Country enum](#country-enum)).

## Usage

`CountrySelect` is self-contained: it builds its own local `Data` context with
the country list and its own search/highlight state, so it does not need an
enclosing `Data`/`Form` context. You only bind the selected value and react to
changes. `onChange` / `onInput` receive the new value as the second argument
(not via `target_value`).

```tsx
<CountrySelect
  onChange={(s, newValue) => {
    s.debugExpr(newValue);
  }}
/>
```

To persist the selection, bind `value` to a scalar you control and update it in
`onChange`:

```tsx
<Data
  local
  procedure={(s) => {
    s.defScalar("home_country", { type: "String", maxLength: 2 });
  }}
>
  <CountrySelect
    value={sql`home_country`}
    onChange={(s, newValue) => {
      s.setScalar("home_country", newValue);
    }}
  />
</Data>
```

`newValue` is the selected country's ISO alpha-2 code (e.g. `'US'`), or
`sql.null` when the user clears the field (clear button or Backspace on a
selected value).

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `Sql` | No | SQL expression for the currently selected country code. The component watches it and recomputes its bound state when it changes. |
| `onChange` | `(s, newValue) => void` | No | Called when a country is picked or cleared. `newValue` is the country value (or `sql.null`). |
| `onInput` | `(s, newValue) => void` | No | Same signature/timing as `onChange`; called alongside it on pick and clear. |
| `enumName` | `string` | No | Types the value as a Yolm enum (e.g. `"country"`). When omitted, values are plain 2-char strings. |
| `id` | `Sql \| string` | No | Element id for the input. Auto-generated when omitted. |
| `endDecorator` | `Node` | No | Extra content rendered after the built-in clear and dropdown-arrow buttons. |
| `immediateFocus` | `boolean` | No | Focus the input on render. |
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | No | Input size. |
| `color` | `Color` | No | Theme color. Defaults to `"neutral"`. |
| `variant` | `"soft" \| "solid" \| "outlined" \| "plain"` | No | Input/listbox variant. Listbox styling defaults to `"outlined"`. |
| `sx` | `Style` | No | Style overrides for the root element. |
| `className` | `string` | No | Class applied to the root element. |
| `slots` | object | No | Override slot element types for `root`, `select`, `startDecorator`, `endDecorator`, and `icon`. |
| `slotProps` | object | No | Per-slot props for `root`, `select`, `startDecorator`, `endDecorator`, and `icon`. |

The handler signature is `(s: DomStatements, newValue: AnyExpr) => void`.
`size`, `color`, and `variant` are generation-time strings, not SQL
expressions.

## Country enum

The country list is shared with the `country` enum exported from
`enums/country`. If you want the selected value typed as that enum rather than a
2-char string, register it once in `system.tsx` and pass its name to
`enumName`:

```tsx
// system.tsx
import { countryEnum } from "enums/country";

countryEnum(); // registers the `country` enum (alpha-2 variant names)
```

```tsx
// page
<Data
  local
  procedure={(s) => {
    s.defScalar("home_country", { type: { type: "Enum", enum: "country" } });
  }}
>
  <CountrySelect
    enumName="country"
    value={sql`home_country`}
    onChange={(s, newValue) => {
      s.setScalar("home_country", newValue);
    }}
  />
</Data>
```

When `enumName` is set, the component's internal value scalars are typed as that
enum; otherwise they are `String` (max length 2). Match the type of the scalar
you bind to `value` accordingly.

## Behavior

- Search: typing filters the list by a case-insensitive substring match on the
  country display label.
- Keyboard navigation (active only while the list is open):
  - **Arrow Down / Arrow Up** move the highlight (wrapping at the ends).
  - **Enter / Tab** select the highlighted option.
  - **Backspace** clears the current selection when one is set, and reopens the
    list.
- The input shows a fixed `Select a country` placeholder and includes a clear
  button and a dropdown-arrow toggle as built-in end decorators.
- Display labels include the flag emoji (from `countries[].displayName`); the
  stored value is the bare alpha-2 code.

## Common Mistakes

- Reading `target_value` in the handler. `CountrySelect` passes the new value as
  the second handler argument (`newValue`) — use that, not `sql\`target_value\``.
- Binding `value` to a scalar whose type does not match `enumName`. With
  `enumName` set the value is enum-typed; without it, it is a 2-char string.
- Expecting `color` / `variant` / `size` to accept SQL expressions. They are
  generation-time props only. The placeholder is a fixed literal and is not
  configurable.
- Forgetting to register the enum. `enumName="country"` requires calling
  `countryEnum()` from `enums/country` in `system.tsx` first.
