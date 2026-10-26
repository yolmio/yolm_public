---
title: Checkbox & Switch
description: Checkbox and SwitchControl components for boolean input, with bindScalar, bindRecordField, or checked plus onCheckboxChange binding.
tags:
  - ui
  - components
  - checkbox
  - switch
  - form
related:
  - ui/radio.md
  - ui/form.md
  - ui/action_button.md
  - ui/styling.md
---

# Checkbox & Switch

`Checkbox` renders a checkbox with an optional label; `SwitchControl` renders a
toggle switch. Both bind a boolean the same way.

```tsx
import { Checkbox } from "components/checkbox";
import { SwitchControl } from "components/switch";

<Checkbox bindScalar="agree_to_terms" label="I agree to the terms" />
<SwitchControl bindScalar="dark_mode" />
```

## Value Binding

Use exactly one mode. Combining modes throws, and omitting all of them throws
`checked must be specified`.

- `bindScalar="name"`: reads `name` and sets it to `target_checked` on change.
- `bindRecordField="record.field"` (or `ui.record.field`): reads the field and
  runs `update record set field = target_checked` on the UI record.
- `checked` (SQL boolean) plus `onCheckboxChange`: custom handling. Inside the
  handler `target_checked` is the new value (also passed as the second
  argument).

```tsx
<Checkbox
  checked={sql`show_archived`}
  label="Show archived"
  onCheckboxChange={(s) => {
    s.setScalar("show_archived", sql`target_checked`);
    s.setScalar("page", sql`0`);
  }}
/>
```

These bindings change UI state only. To persist a boolean column, use
[`Form`](./form.md) (`Form.CheckboxField field="..."`) for field edits, or an
[`ActionButton`](./action_button.md) for a command such as "mark complete".

## Non-Obvious Props

- `variant`, `color`, and `size` follow the shared
  [styling props](./styling.md#color-variant-and-size). Checkbox defaults:
  `outlined` / `primary` / `md`; SwitchControl defaults: `solid` / `primary` /
  `md`.
- `checkedVariation={{ variant, color }}` (Checkbox only) applies a different
  style while checked, toggled at runtime by `checked`. Use it instead of
  swapping components for the checked state.
- `error` (Checkbox, SQL boolean) applies danger styling.
- `disableIcon` hides the checkmark; `overlay` stretches the click target over
  the parent (e.g. a whole card).
- `disabled` is a SQL boolean on both.
- `SwitchControl` has no `label`; use `startDecorator` / `endDecorator` for
  inline text.
- Other props (`readOnly`, `tabIndex`, `aria-*`) pass to the `<input>`.
  `readOnly` does not stop a checkbox from toggling; also call
  `s.event.preventDefault()` in `onCheckboxChange`.

```tsx
<Checkbox
  checked={sql`has_appointment`}
  readOnly
  tabIndex={-1}
  onCheckboxChange={(s) => {
    s.event.preventDefault();
  }}
/>
```

See `SwitchProps` in `components/switch` and the `Checkbox` props in
`components/checkbox` for the full contract. Use `SwitchControl` for
settings-style toggles and `Checkbox` for checklist items or agreements.

## Common Mistakes

- Passing `bindScalar` together with `bindRecordField` or `onCheckboxChange`.
- Writing a `tryServer` save inside `onCheckboxChange` to persist each click.
  Use `Form` or `ActionButton` as above.
- Reading `target_value` in `onCheckboxChange`; the new state is
  `target_checked`.
