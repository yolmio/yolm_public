---
title: Duration Inputs
description: DurationInput (single hh:mm field) and SplitDurationInput (separate hours/minutes fields) for entering durations bound to SQL values.
tags:
  - ui
  - components
  - input
  - form
related:
  - ui/overview.md
  - ui/form.md
  - ui/form_control.md
  - ui/styling.md
---

# Duration Inputs

Two components for entering time durations:

- **`DurationInput`** renders a single text field formatted as `hh:mm`. Typing is restricted to digits and `:`, and the value is normalized on change.
- **`SplitDurationInput`** renders two separate, focus-linked inputs (hours and minutes) divided by a `:` separator, with optional decorators.

Both are field-level components: place them inside the form / `Data` context that owns the bound state. Neither is self-routing.

```tsx
import { DurationInput } from "components/duration_input";
import { SplitDurationInput } from "components/split_duration_input";
```

## DurationInput

Use `DurationInput` for a compact single-field duration entry. The displayed value is `hh:mm` text; on change the component hands `onChange` a normalized duration expression (it parses and re-formats the typed text for you).

```tsx
<DurationInput
  size="sm"
  value={sql`duration`}
  onChange={(s, value) => s.setScalar("duration", value)}
/>
```

`onChange` receives `(s, value)` where `value` is the already-parsed, re-formatted duration `Sql` — do not read `target_value` yourself.

### DurationInput Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `onChange` | `(s, value: Sql) => unknown` | Yes | Called when the field changes. `value` is the normalized duration expression. |
| `value` | `Sql` | No (supply one) | SQL expression for the current duration, displayed as `hh:mm`. Optional in the type, but every real call site passes it. |
| `error` | `BooleanExpr` | No | SQL expression that toggles error styling. |
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | No | Field size (generation-time string, not SQL). |

`DurationInput` builds on `Input` (`components/input`), so the standard `Input` props are also available: `startDecorator` / `endDecorator`, `startIcon` / `endIcon`, `fullWidth`, `variant`, `color`, `id` / `inputId`, `autoFocus`, `onBlur`, `sx`, and `className`. The `placeholder` defaults to `hh:mm`, and the component installs an `onKeyDown` handler that restricts typing to digits and `:`.

## SplitDurationInput

Use `SplitDurationInput` when you want two visually distinct hours/minutes fields. Typing `:` or `.` in the hours field jumps focus to the minutes field. The value is an `H:MM` string (the component splits on the first `:` for hours vs minutes), and `onChange` is called with the recombined `H:MM` string.

```tsx
<SplitDurationInput
  value={sql`duration`}
  onChange={(s, value) => s.setScalar("duration", value)}
  error={sql`duration is null`}
  size="md"
/>
```

You can let the component wire the write for you with `bindScalar` (or `bindRecordField`) instead of `value` + `onChange`:

```tsx
<SplitDurationInput bindScalar="duration" />
```

### SplitDurationInput Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `Sql` | One of value / bindScalar / bindRecordField | `H:MM` duration string expression. |
| `bindScalar` | `string` | One of value / bindScalar / bindRecordField | Two-way bind to a `ui` scalar; auto-wires the write. |
| `bindRecordField` | `string` | One of value / bindScalar / bindRecordField | Two-way bind to `record.field` or `ui.record.field`; auto-wires the write. |
| `onChange` | `(s, value: Sql) => void` | No | Called with the new `H:MM` string. Use with `value`; not needed with `bindScalar` / `bindRecordField`. |
| `error` | `BooleanExpr` | No | Error styling. Default `false`. |
| `size` | `Size` | No | Field size. Default `"md"`. |
| `variant` | `Variant` | No | Visual style. Default `"outlined"`. |
| `color` | `Color` | No | Theme color. Default `"neutral"`. |
| `fullWidth` | `boolean` | No | Stretch to container width. Default `false`. |
| `startDecorator` | `Node` | No | Content rendered before the hours input. |
| `endDecorator` | `Node` | No | Content rendered after the minutes input. |

`SplitDurationInput` also accepts `sx`, `className`, and `slotProps` for its slots (`root`, `hoursInput`, `minutesInput`, `separator`, `startDecorator`, `endDecorator`). The props type is exported as `SplitDurationInputProps`.

#### Value source rules

`SplitDurationInput` requires exactly one value source. The component throws at generation time when these are violated:

- Supplying none throws `"value is required"`.
- Combining `value` with `bindScalar` / `bindRecordField` throws `"Cannot specify both value and bindScalar/bindRecordField"`.
- Combining `bindScalar` with `bindRecordField` throws `"Cannot specify both bindScalar and bindRecordField"`.
- `bindRecordField` must be a `record.field` (or `ui.record.field`) path, otherwise it throws `"bindRecordField must be a record.field or ui.record.field"`.

## Choosing between them

- Prefer `DurationInput` for compact, free-form `hh:mm` entry (e.g. datagrid filters), where you parse/normalize on change.
- Prefer `SplitDurationInput` for forms where distinct hours and minutes fields read more clearly, or when you want `bindScalar` / `bindRecordField` to wire the write for you.

## Common Mistakes

- `DurationInput` edits minute-backed durations and requires `onChange`.
- In `DurationInput.onChange`, use the second argument `value`, not `target_value` — the raw text has already been parsed and re-formatted.
- For `SplitDurationInput`, pass exactly one of `value`, `bindScalar`, or `bindRecordField` — none throws, and combinations throw.
- `SplitDurationInput` `value` must be an `H:MM` string expression; the component splits on `:` to derive hours and minutes.
- `color`, `variant`, and `size` are generation-time strings, not SQL expressions. Use `error` (a `BooleanExpr`) for runtime error styling.
