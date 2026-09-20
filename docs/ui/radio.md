---
title: Radio & RadioGroup
description: Radio and RadioGroup components for single-choice selection bound to SQL state, with variants, sizes, labels, and horizontal or vertical layout.
tags:
  - ui
  - components
  - radio
  - form
related:
  - ui/overview.md
  - ui/checkbox.md
  - ui/select.md
  - ui/form.md
  - ui/styling.md
---

# Radio & RadioGroup

`Radio` renders a single radio button whose selected state is driven by a SQL
boolean expression. `RadioGroup` is a layout/styling container that arranges
several `Radio` controls horizontally or vertically. Use them for mutually
exclusive choices; for boolean on/off use [Checkbox](./checkbox.md), and for
long option lists use [Select](./select.md).

```tsx
import { Radio } from "components/radio";
import { RadioGroup } from "components/radio_group";
```

## Usage

`Radio` has no `bindScalar`/`bindRecordField` shorthand — wire selection
manually. Set `checked` to a SQL boolean expression that is true for the
selected option, and update your state in `onCheckboxChange` (or `onChange`),
which is forwarded to the underlying `<input type="radio">`. The example assumes
a `mode` UI scalar is in scope (e.g. from `Data`/`scalarDef`).

```tsx
<RadioGroup orientation="horizontal" size="sm">
  <Radio
    label="Link existing"
    checked={sql`mode = 'link'`}
    onCheckboxChange={(s) => s.setScalar("mode", sql.lit`link`)}
  />
  <Radio
    label="Create new"
    checked={sql`mode = 'create'`}
    onCheckboxChange={(s) => s.setScalar("mode", sql.lit`create`)}
  />
</RadioGroup>
```

### Group-level change handler

Because a `Radio`'s `onChange`/`value` are forwarded to its `<input>`, you can
also catch changes once on the group: give each `Radio` a `value` and read
`target_value` in the group's `onChange`.

```tsx
<RadioGroup
  onChange={(s) => s.setScalar("selected_label", sql`target_value`)}
>
  <Radio
    checked={sql`selected_label = 'all'`}
    label="All emails"
    value={sql.lit`all`}
  />
  <Radio
    checked={sql`selected_label = 'unread'`}
    label="Unread only"
    value={sql.lit`unread`}
  />
</RadioGroup>
```

## Radio props

| Prop          | Type                                                  | Required | Description                                                                          |
| ------------- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `checked`     | SQL boolean expression                               | No       | True for the selected radio; also drives the dot indicator.                          |
| `value`       | `Sql`                                                 | No       | Submitted value of the underlying `<input type="radio">`; read as `target_value`.    |
| `label`       | `Node`                                                | No       | Label content rendered beside the control.                                           |
| `disabled`    | SQL boolean expression                               | No       | Disables the input when true.                                                        |
| `name`        | `Sql`                                                 | No       | Shared group name tying mutually exclusive radios together on the input.             |
| `disableIcon` | `boolean`                                             | No       | Hide the circular dot; the variant style alone shows selection. Default `false`.     |
| `overlay`     | `boolean`                                             | No       | Stretch the clickable area to cover the parent (e.g. a whole card). Default `false`. |
| `color`       | `"primary" \| "neutral" \| "danger" \| "success" \| "warning" \| "harmonize"` | No | Generation-time string. Default `"neutral"`.                              |
| `variant`     | `"plain" \| "outlined" \| "soft" \| "solid"`         | No       | Generation-time string. Default `"outlined"`.                                        |
| `size`        | `"xs" \| "sm" \| "md" \| "lg"`                       | No       | Generation-time string. Default `"md"`.                                              |
| `sx`          | `Style`                                               | No       | Style overrides for the root element.                                                |
| `className`   | `string`                                              | No       | Extra class names for the root element.                                              |
| `component`   | `ElementType`                                         | No       | Override the root host element (defaults to `span`).                                 |
| `slots`       | `Partial<Record<"root"\|"radio"\|"icon"\|"action"\|"input"\|"label", ElementType>>` | No | Per-slot element overrides.                          |
| `slotProps`   | per-slot prop overrides                               | No       | Per-slot prop overrides keyed by slot name.                                          |

Any other props (event handlers such as `onCheckboxChange` and `onChange`, and
attributes like `aria-label`) are forwarded to the underlying
`<input type="radio">`. `onCheckboxChange` exposes `target_checked`; `onChange`
exposes `target_value`. The exported prop type is `RadioProps`.

## RadioGroup props

| Prop          | Type                            | Required | Description                                                       |
| ------------- | ------------------------------- | -------- | ---------------------------------------------------------------- |
| `children`    | `Node`                          | Yes      | The `Radio` controls to render.                                  |
| `orientation` | `"horizontal" \| "vertical"`    | No       | Layout direction. Default `"vertical"`.                          |
| `role`        | `Sql`                           | No       | ARIA role on the root. Default `"radiogroup"`.                   |
| `color`       | same as `Radio`                 | No       | Generation-time string. Default `"neutral"`.                     |
| `variant`     | same as `Radio`                 | No       | Generation-time string. Default `"plain"`.                       |
| `size`        | `"xs" \| "sm" \| "md" \| "lg"`  | No       | Generation-time string. Default `"md"`.                          |
| `sx`          | `Style`                         | No       | Style overrides for the root element.                            |
| `className`   | `string`                        | No       | Extra class names for the root element.                          |
| `component`   | `ElementType`                   | No       | Override the root host element (defaults to `div`).              |

Other props (e.g. an `onChange` handler) are forwarded to the root `<div>`,
which is how change events bubbling up from child radios are captured.

`RadioGroup` does not manage selection or propagate state to its children. Set
`checked` (and any `value`/`name`) on each `Radio` directly.

## Common Mistakes

- Expecting `RadioGroup` to drive selection — it is a layout container. Each
  `Radio` must set its own `checked` expression.
- Assuming a `bindScalar` shorthand exists like on `Checkbox`. `Radio` has none;
  wire `checked` plus `onCheckboxChange`/`onChange` yourself.
- Passing a SQL expression to `color`, `variant`, or `size`. These are
  generation-time strings; use [`Show`/`Switch`](./control_flow.md) to vary them
  by condition.
- Using `target_checked` with a group-level `onChange` — read `target_value`
  there; `target_checked` is only meaningful on a single radio's
  `onCheckboxChange`.
