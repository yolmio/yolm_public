---
title: Alert
description: Alert component for displaying contextual feedback messages with customizable colors, variants, sizes, and decorators.
tags:
  - ui
  - components
  - alert
  - feedback
---

# Alert

`Alert` displays inline feedback: errors, warnings, success confirmations, and
informational notices.

```tsx
import { Alert } from "components/alert";
```

## Basic Usage

Alerts are usually gated with `<Show>` on UI state; children may be SQL:

```tsx
<Show when={sql`error is not null`}>
  <Alert color="danger" startIcon="Warning" size="sm">{sql`error`}</Alert>
</Show>

<Show when={sql`last_saved_state_hash != current_state_hash`}>
  <Alert color="warning" startIcon="Warning">You have unsaved changes.</Alert>
</Show>
```

For form submit errors use `Form.ErrorAlert` ([Form](./form.md)); for command
errors `ActionButton errorDisplay="inline"` renders the alert for you
([ActionButton](./action_button.md)).

## Props

- `variant`, `color`, and `size` follow the shared
  [styling props](./styling.md#color-variant-and-size). Defaults:
  `variant="soft"`, `color="primary"`, `size="md"`. For a color chosen at
  runtime, render static variants inside `Switch`/`Match`/`Show`.
- `startIcon` / `endIcon` take an icon name; `startDecorator` /
  `endDecorator` take any node. Passing both an icon and a decorator on the
  same side throws at generation time. Decorators use the variant's text
  color.
- `harmonize`: with a `soft` or `solid` variant, descendants that use the
  default color (e.g. a `Button` with no `color`) are recolored to match the
  alert background. Not supported for `outlined`/`plain`.

```tsx
<Alert color="warning" variant="soft" harmonize>
  <span>Session expiring soon.</span>
  <Button size="sm">Extend</Button>
</Alert>
```

See `AlertProps` in `components/alert` for the full contract (including
`slots`/`slotProps` for `root`, `startDecorator`, `endDecorator`).
