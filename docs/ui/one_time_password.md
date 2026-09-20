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

`OneTimePasswordInput` renders a row of single-character boxes for entering a
numeric one-time code (OTP / verification code) during sign-in, 2FA, and
email/SMS verification flows. It handles pasting a full code, per-digit
backspace, arrow-key/tab navigation, numeric-only filtering, and focus
management, then fires `onComplete` once every box is filled.

Use this instead of a plain `Input` whenever you need a fixed-length code
entry. For free-form text use [Input](./input.md).

```tsx
import {
  OneTimePasswordInput,
  otpDigits,
} from "components/one_time_password_input";
```

## Backing record

The component does not own its state. It reads and writes a UI-state record
whose fields hold each digit. Create that record with the `otpDigits` helper
inside the surrounding `Data` procedure, then pass its name as `digitsRecord`.
The `digits` prop must match the count passed to `otpDigits`.

```tsx
otpDigits(s, "code_digits", 6);
```

`otpDigits(s, name, digits)` defines a record named `name` with `TinyUint`
fields `digit_0 … digit_{digits-1}`, all initialized to null.

## Usage

```tsx
import {
  OneTimePasswordInput,
  otpDigits,
} from "components/one_time_password_input";
import { Data } from "std/data";
import { sql } from "std/sql_utils";

<Data
  local
  procedure={(s) => {
    s.defScalar("error", { type: "String", expr: sql.null });
    s.defScalar("entered_code", { type: "String", expr: sql.null });
    // Backing record: fields digit_0 … digit_5
    otpDigits(s, "code_digits", 6);
  }}
>
  <OneTimePasswordInput
    size="lg"
    digits={6}
    digitsRecord="code_digits"
    error={sql`error is not null`}
    focusFirstImmediately
    onComplete={(s, code) => {
      // `code` is a SQL expression with the full entered code
      s.setScalar("entered_code", code);
    }}
  />
</Data>;
```

Compact variant (mirrors the kitchen-sink example):

```tsx
otpDigits(s, "xs_otp", 4);

<OneTimePasswordInput size="xs" digits={4} digitsRecord="xs_otp" />;
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `digits` | `number` | Yes | Number of input boxes to render. Must match the `digits` passed to `otpDigits`. |
| `digitsRecord` | `string` | Yes | Name of the UI record (created with `otpDigits`) that stores each entered digit. |
| `error` | `BooleanExpr` | No | SQL boolean expression; when true, applies error styling to the inputs. |
| `focusFirstImmediately` | `boolean` | No | Generation-time boolean. When true, focuses the first box as soon as it renders. |
| `onComplete` | `(s: DomStatements, code: Sql) => void` | No | Called once every box is filled. `code` is a SQL expression holding the concatenated code. |
| `color` | `"primary" \| "neutral" \| "danger" \| "success" \| "warning"` | No | Focus highlight color. Default `"primary"`. `"harmonize"` is not supported and throws. |
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | No | Box dimensions. Default `"md"` (`xs` 32px, `sm` 40px, `md` 48px, `lg` 56px). |

`color` and `size` are generation-time string literals, not SQL expressions.
The component also accepts the standard styling props `sx`, `className`, and
per-slot `slotProps` (see [Styling slots](#styling-slots)).

## otpDigits

```tsx
otpDigits(s, name: string, digits: number): void
```

Helper that declares the digit-holding record for the component. Call it once
in the same `Data` procedure scope that renders the `OneTimePasswordInput`,
before the component reads `digitsRecord`.

## onComplete and reading the code

`onComplete` fires only when all `digits` boxes are non-null. Its second
argument, `code`, is a `Sql` expression you can pass straight into a verify
call or store. Typical auth usage runs a server verification:

```tsx
<OneTimePasswordInput
  size="lg"
  digits={6}
  digitsRecord="code_digits"
  error={sql`error is not null`}
  focusFirstImmediately
  onComplete={(s, code) => verifyCode(s, code)}
/>
```

To surface a failed verification, set an error scalar and bind it to `error`.
`Show` is exported from `std/ui` and `Alert` from `components/alert`:

```tsx
<Show when={sql`error is not null`}>
  <Alert color="danger">{sql`error`}</Alert>
</Show>
```

## Built-in keyboard and paste behavior

You do not wire these up; the component handles them:

- Typing a digit advances focus to the next box.
- Backspace/Delete clears the current box (or the previous one) and moves back.
- Arrow Left / Right and Tab / Shift+Tab move between boxes.
- Non-numeric keypresses are ignored.
- Pasting a code (or an Android OTP autofill event) fills the remaining boxes,
  stripping non-digits.

## Styling slots

The component accepts `sx` and `className`, plus per-slot overrides through
`slotProps` for the `root` (a `div`) and `input` (the digit `<input>`) slots.
See [Styling](./styling.md).

## Common Mistakes

- Forgetting to call `otpDigits(s, name, digits)` in the surrounding `Data`
  procedure, or passing a `digitsRecord` name that does not match the record
  you created.
- Mismatching `digits` between `otpDigits` and the component prop, so some
  boxes have no backing field.
- Passing `color="harmonize"` — unsupported; it throws. Use one of `primary`,
  `neutral`, `danger`, `success`, `warning`.
- Treating `color`/`size` as runtime values; they are generation-time literals.
  Use `error` (a SQL expression) for dynamic error styling.
- Expecting `onComplete` to fire on every keystroke — it runs only once all
  boxes are filled.
