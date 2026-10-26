---
title: Divider
description: Divider component for rendering horizontal or vertical separator lines with optional content.
tags:
  - ui
  - components
  - divider
---

# Divider

`Divider` renders a horizontal or vertical separator line, optionally with
content (usually text) centered on the line.

```tsx
import { Divider } from "components/divider";
```

## Basic Usage

```tsx
<Divider />
<Divider className="my-4" />
<Divider>Or</Divider>

<div className="flex">
  <div className="flex-1">Left panel</div>
  <Divider orientation="vertical" />
  <div className="flex-1">Right panel</div>
</div>
```

## Behavior

- `orientation`: `"horizontal"` (default) or `"vertical"`. A vertical divider
  stretches to the height of its flex container.
- Without children it renders an `<hr role="separator">` (with
  `aria-orientation="vertical"` when vertical); with children it renders a
  `<div>` with lines on both sides of the content. Override with `component`
  / `role`.
- `inset`: when omitted, the divider's margin uses the inherited
  `--divider-inset` variable, so inside a `ModalDialog` it bleeds to the dialog
  edges. `inset="none"` forces zero inset. `inset="context"` is also accepted.
- `hideOnFirstEach`: inside `Each`, hides the divider on the first iteration
  (`iteration_index != 0`), giving separators only between items. It requires
  an enclosing `Each`.

```tsx
<Each table="items" recordName="item">
  <Divider hideOnFirstEach />
  <Typography level="body-md" className="py-2">{sql`item.title`}</Typography>
</Each>
```

There are no `variant`, `color`, or `size` props; the line uses the theme
`divider` color. See `DividerBaseProps` in `components/divider` for the full
contract.
