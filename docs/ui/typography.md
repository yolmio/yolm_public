---
title: Typography
description: Typography component for displaying text with various levels, colors, icons, and decorators.
tags:
  - ui
  - components
  - typography
  - text
---

# Typography

`Typography` renders text at a theme typography level, with optional icons and
decorators.

```tsx
import { Typography } from "components/typography";
```

## Basic Usage

```tsx
<Typography level="h3">Page Title</Typography>
<Typography level="title-lg">Notes</Typography>
<Typography level="body-sm" color="warning" startIcon="Warning">
  {sql`overdue_count`} invoices overdue
</Typography>
<Typography level="body-sm" className="text-secondary">
  Found {sql`record_count`} records
</Typography>
```

## Levels

`level` (static, default `body-md`) sets the text style and the default tag:

| Level | Tag |
|-------|-----|
| `h1`, `h2`, `h3`, `h4` | matching `<h1>`-`<h4>` |
| `title-lg`, `title-md`, `title-sm` | `<div>` |
| `body-lg`, `body-md`, `body-sm` | `<div>` |
| `body-xs` | `<span>` |
| `inherit` | `<div>`, no level styles |

There is no `h5`/`h6`; use `title-*` or `body-*`. `inline` renders a `<span>`;
`component` overrides the tag (e.g. `component="h2" level="title-lg"`).

## Other Props

- `startIcon` / `endIcon` (icon names) or `startDecorator` / `endDecorator`
  (any node). If both an icon and a decorator are given for a side, the icon
  wins and the decorator is ignored.
- `color` sets the text color from the palette (static `Color`).
- `variant` adds background/border styling and padding, but only when `color`
  is also set. It never controls text size; use `level`.
- `noWrap` truncates with an ellipsis; `gutterBottom` adds `0.35em` bottom
  margin.

Shared `variant`/`color` semantics are in
[styling props](./styling.md#color-variant-and-size). See `TypographyOpts` in
`components/typography` for the full contract.

## Common Mistakes

- `level="h5"` or `level="h6"`: not valid levels.
- `variant="h4"`: `variant` is a style variant (`soft`, `outlined`, ...), not
  a text level.
- `variant` without `color`: no styling is applied.
