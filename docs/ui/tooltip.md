---
title: Tooltip
description: Tooltip floating popover anchored to an element, plus IconButton whose built-in tooltip prop shows it on hover.
tags:
  - ui
  - components
  - tooltip
  - popover
  - icon-button
related:
  - ui/button.md
  - ui/icons.md
  - ui/overview.md
  - ui/styling.md
---

# Tooltip

`Tooltip` is a floating popover anchored to another element by id. This page
also covers [IconButton](#iconbutton), whose `tooltip` prop wires hover/focus
behavior for you.

```tsx
import { Tooltip } from "components/tooltip";
```

## Basic Usage

```tsx
<button id="tooltip-anchor">Hover me</button>
<Tooltip anchorEl="tooltip-anchor" placement="right">
  Helpful hint
</Tooltip>
```

A rendered `Tooltip` is shown immediately (`popover="auto"`, positioned with
`strategy: fixed` and an arrow). It is not a hover trigger on its own: use
`IconButton`'s `tooltip` prop, or gate the `Tooltip` with `<Show>` driven by
your own hover state.

## Yolm-Specific Behavior

- `anchorEl` (required) is the anchor element's `id`, as a static string or a
  SQL expression. The anchor needs only a matching `id`; do not add a
  `popoverTarget`.
- `placement` accepts a static string or SQL expression (e.g.
  `placement={sql`placement_scalar`}`). Values: `top`, `bottom` (default),
  `left`, `right`, each optionally suffixed `-start` / `-end`.
- `children` may be a string or SQL expression for dynamic text:

  ```tsx
  <Tooltip anchorEl="status-icon">
    {sql`'Last updated: ' || format.date(record.updated_at, '%Y-%m-%d')`}
  </Tooltip>
  ```

- `variant`, `color`, and `size` follow the shared
  [styling props](./styling.md#color-variant-and-size). Defaults:
  `variant="solid"`, `color="neutral"` (`harmonize` inside a harmonize
  context), `size="md"`. The arrow inherits variant and color.
- `slots` / `slotProps` override the `root` (`div`) and `arrow` (`span`) slots.

See `TooltipProps` in `components/tooltip` for the full contract.

## IconButton

`IconButton` is a compact icon-only button. Pass `tooltip` (and optionally
`tooltipProps={{ placement }}`, currently the only option) to show a `Tooltip`
on mouse hover and keyboard (`:focus-visible`) focus; it hides on click, blur,
and mouse leave. The button gets a generated `id` if you do not pass one.

```tsx
import { IconButton } from "components/icon_button";

<IconButton
  icon="Delete"
  variant="plain"
  color="danger"
  aria-label="Delete"
  tooltip="Delete"
  tooltipProps={{ placement: "top" }}
  onClick={(s) => s.setScalar("confirm_delete", sql.true)}
/>
```

- Provide exactly one of `icon` (an [icon name](./icons.md)) or `children`.
- `href` renders an `<a>` instead of a `<button>`.
- `disabled` takes a SQL boolean expression.
- Defaults: `variant="solid"`, `color="primary"`, `size="md"`; inside a
  `ButtonGroup` the group's defaults apply.

For server commands use `ActionIconButton` from `std/action_button`
([ActionButton](./action_button.md)). See `IconButtonProps` in
`components/icon_button` for the full contract.

## Common Mistakes

- `IconButton` with both `icon` and `children`, or neither, throws at
  generation time.
- `IconButton` defaults to `color="primary"` and `variant="solid"`; set them
  explicitly for a neutral or plain toolbar button.
- An icon-only button without `aria-label` has no accessible name; `tooltip`
  does not provide one.
