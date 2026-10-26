---
title: OneTimePasswordInput
description: Code-entry input for one-time passwords in auth flows, with paste, focus, backspace, and keyboard handling backed by an otpDigits record.
tags:
  - ui
  - components
  - auth
  - input
related:
  - ui/overview.md
  - ui/data.md
  - ui/form.md
  - ui/input.md
  - ui/button.md
  - ui/styling.md
---

# OneTimePasswordInput

A row of single-digit boxes for numeric verification codes (sign-in, 2FA,
email/SMS verification). For free-form text use [Input](./input.md).

```tsx
import {
  OneTimePasswordInput,
  otpDigits,
} from "components/one_time_password_input";
```

```tsx
<Data
  local
  procedure={(s) => {
    s.defScalar("error", { type: "String", expr: sql.null });
    otpDigits(s, "code_digits", 6);
  }}
>
  <OneTimePasswordInput
    size="lg"
    digits={6}
    digitsRecord="code_digits"
    error={sql`error is not null`}
    focusFirstImmediately
    onComplete={(s, code) => verifyCode(s, code)}
  />
  <Show when={sql`error is not null`}>
    <Alert color="danger">{sql`error`}</Alert>
  </Show>
</Data>
```

## Backing record

The component owns no state. `otpDigits(s, name, digits)` declares a UI record
`name` with `TinyUint` fields `digit_0 … digit_{digits-1}`, all null. Call it in
an enclosing `Data` procedure, pass the same name as `digitsRecord`, and use
the same count for `digits`.

## Completion and errors

- `onComplete(s, code)` runs when every box is non-null, and again whenever the
  concatenated code changes while all boxes stay filled (e.g. the user edits a
  digit). `code` is a SQL string expression to verify or store.
- `error` is a runtime SQL boolean that applies danger styling. To show a failed
  verification, set an error scalar in your verify handler and bind it here.

## Built-in input handling

Typing a digit advances focus; Backspace/Delete clears and moves back;
Arrow Left/Right and Tab move between boxes; non-numeric keys are ignored.
Pasting a code (or Android's OTP autofill input event) fills the remaining boxes
with non-digits stripped.

## Non-obvious props

- `focusFirstImmediately` (generation-time) focuses the first box on render.
- `color` tints the focus ring (default `primary`); `harmonize` throws at
  generation time.
- `size` sets box dimensions: `xs` 32px, `sm` 40px, `md` 48px (default), `lg`
  56px.
- `slotProps` targets the `root` (`div`) and `input` (each digit `<input>`)
  slots.

Otherwise `color` and `size` follow the shared
[styling props](./styling.md#color-variant-and-size). See the
`OneTimePasswordInput` props in `components/one_time_password_input` for the
full contract.
