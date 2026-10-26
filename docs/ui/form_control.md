---
title: FormControl
description: FormControl component for grouping form inputs with labels, helper text, and error state propagation.
tags:
  - ui
  - components
  - form
  - form-control
---

# FormControl

`FormControl` groups an input with its `FormLabel` and `FormHelperText`,
shares an input id with them, and propagates a runtime error state.

```tsx
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { FormHelperText } from "components/form_helper_text";
```

```tsx
<FormControl error={sql`submitted and email = ''`}>
  <FormLabel required>Email</FormLabel>
  <Input bindScalar="email" />
  <Show when={sql`submitted and email = ''`}>
    <FormHelperText>Email is required</FormHelperText>
  </Show>
</FormControl>
```

## Behavior

- `FormControl` provides `FormControlICtx` with an `id` (from `inputId`, or a
  generated unique id) and the `error` expression. `FormLabel` uses that id as
  `htmlFor` unless given one, and context-aware inputs such as `Input` use it as
  their element id, so clicking the label focuses the input.
- `error` is a SQL boolean expression evaluated at runtime. When true, the root
  gets the `error` class and `FormHelperText` switches to the danger color.
- `FormLabel required` renders a danger-colored asterisk; it does not validate.
- `FormControl` renders no input itself. Inside a `Form`, bind the input
  through the field helper (`Form.Field` children) or use
  [`FieldFormControl`](./field_form_control.md).

## Non-obvious props

- `size` sets only label and helper-text font sizes (and label spacing); size
  the input separately. Default `md`.
- `orientation="horizontal"` places the label beside the input, centered
  vertically, with right margin instead of bottom margin.
- `color` (static) tints helper text; `harmonize` is ignored here.
- `fullWidth` sets `width: 100%`.

`size` and `color` otherwise follow the shared
[styling props](./styling.md#color-variant-and-size). See the exported props of
`FormControl`, `FormLabel`, and `FormHelperText` in `components/form_control`,
`components/form_label`, and `components/form_helper_text` for the full
contract.

## Example: filter grid

```tsx
<div className="grid grid-cols-4 gap-4">
  <FormControl>
    <FormLabel>Start Date</FormLabel>
    <Input
      type="date"
      value={sql`format.date(filter_start_date, '%Y-%m-%d')`}
      onInput={(s) =>
        s.setScalar("filter_start_date", sql`cast(target_value as date)`)}
    />
  </FormControl>

  <FormControl>
    <FormLabel>Calculation Mode</FormLabel>
    <Select
      value={sql`calc_mode`}
      onChange={(s) => s.setScalar("calc_mode", sql`target_value`)}
    >
      <Select.Option value="margin">Target Margin %</Select.Option>
      <Select.Option value="rate">Fixed Rate</Select.Option>
    </Select>
  </FormControl>

  <Show when={sql`calc_mode = 'margin'`}>
    <FormControl size="sm">
      <FormLabel>Target Margin (%)</FormLabel>
      <Input size="sm" bindScalar="target_margin_text" />
      <FormHelperText>Applied to every rate.</FormHelperText>
    </FormControl>
  </Show>
</div>
```
