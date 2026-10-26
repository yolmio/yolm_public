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

- **`DurationInput`**: one `hh:mm` text field.
- **`SplitDurationInput`**: separate, focus-linked hours and minutes fields.

Both edit duration **text** (`H:MM`), not a number of minutes. Inside a `Form`,
a minutes `Duration`-usage numeric field renders `DurationInput` automatically
via [`FieldFormControl`](./field_form_control.md), and the form converts between
stored minutes and text.

```tsx
import { DurationInput } from "components/duration_input";
import { SplitDurationInput } from "components/split_duration_input";
```

## DurationInput

```tsx
<DurationInput
  size="sm"
  value={sql`duration_text`}
  onChange={(s, value) => s.setScalar("duration_text", value)}
/>
```

- `onChange` is required and fires on the input's change event (commit), not
  per keystroke. Its `value` is already normalized:
  `fn.display_minutes_duration(fn.parse_minutes_duration(target_value))`. Use
  it instead of `target_value`.
- To store minutes, parse the text: `fn.parse_minutes_duration(duration_text)`.
- Keystrokes other than digits and `:` are blocked; `placeholder` defaults to
  `hh:mm`. It deliberately does not set `inputMode="numeric"` (iOS would hide
  `:`).
- Bind with `value` + `onChange`. Other `Input` props pass through (`error`,
  decorators, `fullWidth`, `onBlur`, `sx`, `className`).

## SplitDurationInput

```tsx
<SplitDurationInput bindScalar="duration_text" error={sql`duration_text is null`} />
```

- Exactly one value source: `value` (with `onChange`), `bindScalar`, or
  `bindRecordField` (`record.field` or `ui.record.field`). None, or more than
  one, throws at generation time.
- The value is split at the first `:` into hours and minutes. Each edit writes
  the recombined string (missing hours become `0`, minutes are padded to two
  digits) to the bound scalar/field, or passes it to `onChange` when using
  `value`; `onChange` is not called when binding.
- Typing `:` or `.` in the hours field moves focus to minutes; the minutes
  field accepts at most two digits.
- `slotProps` targets `root`, `hoursInput`, `minutesInput`, `separator`,
  `startDecorator`, and `endDecorator`.

`variant`, `color`, and `size` follow the shared
[styling props](./styling.md#color-variant-and-size). See
`SplitDurationInputProps` in `components/split_duration_input` and `InputProps`
in `components/input` for the full contracts.
