---
title: Textarea
description: Multi-line text input component with scalar or record-field binding, row sizing, error state, and decorator support.
tags:
  - ui
  - components
  - textarea
  - input
  - form
related:
  - ui/input.md
  - ui/form.md
  - ui/styling.md
---

# Textarea

`Textarea` renders a multi-line text input with optional decorators. Binding
works exactly like [`Input`](./input.md#value-binding).

```tsx
import { Textarea } from "components/textarea";

<Textarea bindScalar="note_text" minRows={4} placeholder="Note text..." />
```

## Value Binding

Use exactly one mode; combining them throws.

- `bindScalar="name"`: value is `ui.name`; `onInput` sets it to `target_value`.
- `bindRecordField="record.field"` (or `ui.record.field`): runs
  `update record set field = target_value`. A bare field name throws.
- `value` (SQL) plus `onInput`, reading `target_value`.

For editing database row fields, use [`Form`](./form.md) with `Form.Field`.

## Non-Obvious Props

- `minRows` is a generation-time number that sets a minimum height from the
  line height; `rows` is the HTML `rows` attribute and accepts SQL.
- `error`, `disabled`, `autoFocus` are SQL booleans; `placeholder` is a string
  or SQL.
- `variant`, `color`, and `size` follow the shared
  [styling props](./styling.md#color-variant-and-size); defaults `outlined` /
  `neutral` / `md`.
- `startDecorator` / `endDecorator` render above / below the text area inside
  the styled container (e.g. a counter or a send button).
- `className` applies to the outer container, not the `<textarea>`.

See `TextareaProps` in `components/textarea` for the full contract.

```tsx
<Textarea
  bindScalar="message"
  minRows={3}
  error={sql`char_length(message) > 5000`}
  endDecorator={
    <Typography level="body-xs">{sql`char_length(message) || ' / 5000'`}</Typography>
  }
/>
```

## Common Mistakes

- `bindRecordField="notes"`: include the record name (`edit_form.notes`).
- Combining `bindScalar` / `bindRecordField` with `value` or `onInput`.
- Passing SQL to `minRows`; use `rows` for a runtime row count.
