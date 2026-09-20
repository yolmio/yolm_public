---
title: Style Utilities
description: cssVar and the CSS-variable conventions that back Yolm's theme.
tags:
  - ui
  - styling
  - css
---

# Style Utilities

`std/style_utils` exposes the small primitives that bridge TypeScript
style objects and Yolm's CSS variable system.

## `cssVar(name)`

Returns a `var(--{name})` CSS expression for one of Yolm's themed
variables. The `CssVar` type is an enumeration of every variable
Yolm registers on `:root` — autocomplete lists every valid name, and
typos fail at generation time.

```typescript
import { cssVar } from "std/style_utils";

const styles = {
  color: cssVar("palette-primary-700"),
  borderRadius: cssVar("radius-md"),
  boxShadow: cssVar("shadow-sm"),
};
```

Use `cssVar` whenever you need a themed value from inline styles, a
custom CSS rule, or a chart library that expects a CSS-string colour.
Prefer it over the raw hex values in [`std/colors`](./colors.md) so the
result respects light/dark mode and any per-app brand overrides.

## When to use what

| Need | Reach for |
| --- | --- |
| Themed component (`Button`, `Chip`, …) | `color` + `variant` props |
| Themed value in a custom style block | `cssVar("palette-primary-500")` |
| Fixed hex outside the theme system | `colors.blue[500]` |
| Variant-derived foreground/background pair | `getVariantStyle(variant, color)` |
| Visually hidden accessible text | `visuallyHiddenStyles` |

## `visuallyHiddenStyles`

`visuallyHiddenStyles` is a `StyleObject` for content that should remain
available to assistive technology but not be visible on screen:

```tsx
import { visuallyHiddenStyles } from "std/style_utils";

<span sx={visuallyHiddenStyles}>Loading shipment photos</span>
```

## See also

- [Styling](./styling.md) — color/variant/size system.
- [Colors](./colors.md) — raw palette literals.
- [Dynamic Styling](./dynamic_styling.md) — conditional class/style patterns.
