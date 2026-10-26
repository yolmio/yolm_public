---
title: Theming Reference
description: ThemeOpts, theme CSS variables with cssVar, harmonized surfaces, std/style_utils helpers, and the std/colors literal palette.
tags:
  - ui
  - styling
  - theme
  - colors
related:
  - ui/styling.md
  - ui/website_styling.md
---

# Theming Reference

How to configure a theme and reach theme values from code. For day-to-day
styling (`className`, `sx`, `style`, dynamic classes) see [Styling](./styling.md).

## Theme Options

An app theme is a `ThemeOpts` object passed as `theme` to `system.app(...)`, or
set for all apps with `system.setDefaultTheme(...)`.

```tsx
import type { ThemeOpts } from "std/create_theme";

export const appTheme = {
  lightColorScheme: { palette: { primary: { solidBg: "#14532d" } } },
  fontFamily: { body: "Inter, sans-serif" },
} satisfies ThemeOpts;

system.app({ domain: "app.example.com", theme: appTheme, ui: <App /> });
```

| Key | Purpose |
| --- | --- |
| `lightColorScheme` / `darkColorScheme` | Partial color scheme overrides per mode |
| `focus` | Focus ring and focus highlight settings |
| `typography` | Typography scale and text style overrides |
| `fontFamily` | Font family tokens |
| `transitionDurations` / `transitionEasings` | Named motion tokens |
| `tokens` | Design tokens: `colors` scales, `breakpoints`, `borderRadius`, `shadow`, `fontSize`, `fontWeight`, `lineHeight`, `easing`, `animation`, and more (see `Tokens` in `std/theme`) |

Overrides are partial; unspecified values keep the defaults.

## Theme CSS Variables

Every theme value is published as a CSS variable on `:root`, for example
`--palette-primary-500`, `--palette-text-secondary`,
`--palette-danger-soft-bg`, `--radius-md`, and `--shadow-sm`. `cssVar(name)`
returns `var(--name)` and is typed by `CssVar`, so invalid names fail at
generation time.

```typescript
import { cssVar } from "std/style_utils";

const accent = {
  color: cssVar("palette-primary-700"),
  borderRadius: cssVar("radius-md"),
  boxShadow: cssVar("shadow-sm"),
};
```

Use `cssVar` (or the literal `var(--palette-...)` string) in custom CSS, chart
libraries that take CSS color strings, and runtime `style` expressions. Inside
static `sx`, theme shorthands such as `primary-500` work directly.

## Harmonized Surfaces

A harmonized container recolors its descendants to fit its background.
`<Card harmonize variant="soft" color="primary">` (soft or solid only) sets
`--harmonize-*` variables and palette overrides on the card; descendants that
use `color="harmonize"` take their colors from it.

```tsx
<Card harmonize variant="solid" color="primary">
  <Typography level="title-md">Upgrade available</Typography>
  <Button color="harmonize" variant="soft">Review</Button>
</Card>
```

For a custom container, apply `createHarmonizeVars(variant, color)` in its
`sx`.

## Style Utilities

`std/style_utils` exports:

| Export | Use |
| --- | --- |
| `cssVar(name)` | Typed `var(--name)` reference |
| `getVariantStyle(variant, color, state?)` | Color/background (and border for `outlined`) for a variant; `state` is `hover`, `active`, or `disabled`; accepts `"harmonize"` |
| `createHarmonizeVars(variant, color)` | Harmonize variables for a `soft` or `solid` custom surface |
| `createStyles({...})` | Named reusable styles; entries may be functions of `App`, memoized per app |
| `visuallyHiddenStyles` | Hide content visually but keep it for screen readers |
| `containerStyles()` | Centered, breakpoint-padded page container |
| `baseGridStyles`, `flexGrowStyles` | 12-column grid and `flex-grow: 1` |
| `fadeIn()`, `fadeOut()` | Registered opacity keyframe names |

```tsx
import { createStyles, getVariantStyle, visuallyHiddenStyles } from "std/style_utils";

const styles = createStyles({
  badge: { px: 1, borderRadius: "sm", ...getVariantStyle("soft", "success") },
});

<span sx={styles.badge}>Paid</span>
<span sx={visuallyHiddenStyles}>Loading shipment photos</span>
```

## Literal Palette

`std/colors` exports fixed hex scales for `grey`, `slate`, `zinc`, `neutral`,
`stone`, `lime`, `blue`, `yellow`, `red`, `green`, and `purple`, each with
steps `50`-`950`.

```typescript
import { colors } from "std/colors";

colors.blue[500];
```

Use it only for values that must not follow the theme, such as fixed SVG
fills. A literal does not change with light/dark mode or brand overrides, so
for themed UI prefer `cssVar("palette-primary-500")`.
