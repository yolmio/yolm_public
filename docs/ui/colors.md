---
title: Color Palette
description: The named hue / step color values used by Yolm's theme.
tags:
  - ui
  - styling
  - colors
---

# Color Palette

`std/colors` exposes the literal hex values behind Yolm's theme. Each
named hue (`grey`, `slate`, `zinc`, `neutral`, `stone`, `lime`, `blue`,
`yellow`, `red`, `green`, `purple`) is a record of step names
(`50`, `100`, `200`, …, `950`) mapped to hex values.

```typescript
import { colors } from "std/colors";

colors.blue[500];   // "#0B6BCB"
colors.grey[100];
```

## When to reach for this

Most of the time you should rely on Yolm's `color` + `variant` props or
on `cssVar(...)` for theme-aware values. Use the literal palette when
you genuinely need a fixed hex string:

- Custom SVG fill/stroke that isn't tied to component state.
- Inline charts where the chart library wants a `string` color rather
  than a CSS variable.
- Marketing pages that need to lock to a specific brand step.

## Don't do this

```typescript
// Hard-codes "primary" — breaks when the theme is rebranded
sx={{ backgroundColor: colors.blue[500] }}
```

Prefer:

```typescript
import { cssVar } from "std/style_utils";

sx={{ backgroundColor: cssVar("palette-primary-500") }}
```

## See also

- [Styling](./styling.md) — `Color` type, theme variants.
- [Style Utils](./style_utils.md) — `cssVar` for themed values.
