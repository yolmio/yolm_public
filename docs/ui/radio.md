---
title: Radio & RadioGroup
description: Radio and RadioGroup components for single-choice selection bound to SQL state, with group-level change handlers and horizontal or vertical layout.
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

`Radio` renders one radio button whose selected state is a SQL boolean.
`RadioGroup` is a layout container that arranges radios horizontally or
vertically. For on/off use [Checkbox](./checkbox.md); for long option lists use
[Select](./select.md).

```tsx
import { Radio } from "components/radio";
import { RadioGroup } from "components/radio_group";
```

## Value Binding

`Radio` has no `bindScalar` / `bindRecordField`. Set `checked` to an expression
that is true for the selected option and update state in `onCheckboxChange`
(or `onChange`); both are forwarded to the underlying `<input type="radio">`.

```tsx
<RadioGroup orientation="horizontal">
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

Alternatively, give each `Radio` a `value` and handle the change once on the
group: `RadioGroup` forwards extra props such as `onChange` to its root
`<div>`, which receives the bubbling change event with `target_value`.

```tsx
<RadioGroup onChange={(s) => s.setScalar("filter", sql`target_value`)}>
  <Radio checked={sql`filter = 'all'`} value={sql.lit`all`} label="All emails" />
  <Radio checked={sql`filter = 'unread'`} value={sql.lit`unread`} label="Unread only" />
</RadioGroup>
```

Inside a `Form`, use `Form.RadioGroupField` (boolean field, with `trueRadio` /
`falseRadio`) or `Form.RadioGroupEnumField` instead of wiring radios by hand;
see [Form](./form.md).

## Non-Obvious Props

- `Radio`: `checked`, `disabled` (SQL booleans), `value` and `name` (SQL),
  `label`, `disableIcon` (hide the dot; the variant style shows selection),
  `overlay` (stretch the click area over the parent, e.g. a card). Defaults
  `outlined` / `neutral` / `md`. Other props go to the `<input>`.
- `RadioGroup`: `orientation` (default `"vertical"`), `role` (default
  `"radiogroup"`). Defaults `plain` / `neutral` / `md`.
- `variant`, `color`, and `size` follow the shared
  [styling props](./styling.md#color-variant-and-size). On `RadioGroup` they
  style only the container: `size` sets the gap and `variant`/`color` the
  container background. They are **not** passed to child radios; set them on
  each `Radio`.

See `RadioProps` in `components/radio` and the `RadioGroup` props in
`components/radio_group` for the full contract.

## Common Mistakes

- Expecting `RadioGroup` to manage selection or propagate `size`/`color`/
  `variant` to children. Each `Radio` sets its own `checked` and styling.
- Reading `target_checked` in a group-level `onChange`; use `target_value`
  there. `target_checked` belongs to a single radio's `onCheckboxChange`.
