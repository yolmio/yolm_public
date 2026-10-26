---
title: Sheet
description: Sheet component for creating styled surface containers with variant and color support.
tags:
  - ui
  - components
  - sheet
---

# Sheet

`Sheet` is a bare surface container (`<div>`) with a theme surface background
and variant/color styling. Use it for panels, toolbars, sticky headers, and
highlighted sections. It adds no padding, radius, or shadow; add those with
`className`.

```tsx
import { Sheet } from "components/sheet";
```

## Example

```tsx
<Sheet
  className="sticky top-0 z-50 w-full py-3 px-4 mb-6"
  variant="soft"
  color="primary"
  harmonize
>
  <div className="flex items-center justify-between">
    <Typography level="title-lg">Admin Panel</Typography>
    <Button>Action</Button>
  </div>
</Sheet>
```

## Props

- `variant` (default `plain`) and `color` (default `neutral`) follow the shared
  [styling props](./styling.md#color-variant-and-size). `Sheet` has no `size`
  prop.
- `harmonize`: with a `soft`/`solid` variant and a non-`harmonize` color,
  exposes the sheet's colors as harmonize CSS variables and provides a
  harmonize context, so descendants that use their default color (e.g. the
  `Button` above) blend with the sheet.

See `SheetProps` in `components/sheet` for the full contract. For a padded,
rounded container with header/content sections, use [Card](./card.md).
