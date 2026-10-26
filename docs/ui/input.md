---
title: Input
description: Input component usage for text entry, SQL-bound values, decorators, events, validation display, and form fields.
tags:
  - ui
  - components
  - input
  - form
related:
  - ui/textarea.md
  - ui/form.md
  - ui/form_control.md
  - ui/styling.md
---

# Input

`Input` renders a styled single-line `<input>` with optional icons and
decorators, bound to a UI scalar or record field.

```tsx
import { Input } from "components/input";

<Input bindScalar="search_query" startIcon="Search" placeholder="Search..." />
```

For editing database row fields, use [`Form`](./form.md) with `Form.Field`
rather than a bare `Input`; `Form` owns validation, errors, and submit.

## Value Binding

Use exactly one mode; combining them throws.

- `bindScalar="name"`: value is `ui.name`; `onInput` sets it to `target_value`.
- `bindRecordField="record.field"` (or `ui.record.field`): value is the field;
  `onInput` runs `update record set field = target_value`. A path without a
  record part throws.
- `value` (a SQL expression, not a JS string) plus `onInput`: custom handling.
  `target_value` is the current text, also passed as the second argument.

```tsx
<Input
  value={sql`code`}
  onInput={(s, newValue) => s.setScalar("code", sql`upper(${newValue})`)}
/>
```

`onInput` fires on every keystroke. Keyboard handlers read `event.key`:

```tsx
<Input
  bindScalar="query"
  onKeyDown={(s) => {
    s.if(sql`event.key = 'Escape'`, (s) => {
      s.setScalar("query", sql.lit``);
    });
  }}
/>
```

## Non-Obvious Props

- SQL-capable: `value`, `placeholder`, `type` (also plain strings), `error`,
  `disabled`, `autoFocus`.
- Generation-time: `variant`, `color`, `size`, `className`, `startIcon`,
  `endIcon`. They follow the shared
  [styling props](./styling.md#color-variant-and-size); defaults `outlined` /
  `neutral` / `md`.
- `error` (SQL boolean) toggles danger styling at runtime.
- `startIcon` / `endIcon` take a Material icon name; `startDecorator` /
  `endDecorator` take any node (a spinner, an `IconButton`). Using both on the
  same side throws.
- Inside a `FormControl`, the input's `id` defaults to the control's id so the
  `FormLabel` links automatically.
- `type="color"` gets dedicated styling for the native color picker.
- Remaining `<input>` attributes pass through.

See `InputProps` in `components/input` for the full contract.

```tsx
<FormControl>
  <FormLabel>Email</FormLabel>
  <Input
    bindScalar="login_email"
    type="email"
    error={sql`length(login_email) > 0 and position('@' in login_email) = 0`}
    endDecorator={
      <Show when={sql`checking_email`}>
        <CircularProgress size="sm" />
      </Show>
    }
  />
</FormControl>
```

## Common Mistakes

- `value="hello"`: `value` must be SQL (``sql`my_scalar` `` or
  ``sql.lit`hello` ``).
- Combining `bindScalar` / `bindRecordField` with `value` or `onInput`.
- Saving with `s.tryServer` from `onKeyDown` or `onInput`. Use `Form` for field
  edits or [`ActionButton`](./action_button.md) for a command; both refetch
  on success by default.
  There is no `refresh_key` scalar.
