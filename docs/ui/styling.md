---
title: Styling and Themes
description: Guidelines for styling Yolm components, theme system overview, and converting existing HTML/Tailwind CSS into Yolm-compatible code.
tags:
  - ui
  - styling
  - css
  - tailwind
---

# Styling and Themes

Yolm provides a powerful styling system that combines the ease of Tailwind CSS with the flexibility of CSS-in-JS via the `sx` prop.

## Theme Overview

Yolm themes define the visual appearance of your app. They include:

- **Color schemes** - Light and dark mode palettes
- **Text styles** - Typography scale and weights
- **Spacing** - Consistent padding and margin values
- **Breakpoints** - Screen size thresholds for responsive design (sm, md, lg, xl)
- **Shadows** - Elevation levels
- **Border radius** - Corner roundness
- **Focus styles** - Accessibility focus indicators
- **Z-index layers** - Layer ordering for overlays
- **Animation timing** - Transition durations

## Component Props

Most components accept these styling props:

| Prop | Values | Description |
|------|--------|-------------|
| `color` | `"primary"`, `"neutral"`, `"danger"`, `"success"`, `"warning"`, `"harmonize"` | Theme color |
| `variant` | `"soft"`, `"solid"`, `"outlined"`, `"plain"` | Visual style |
| `size` | `"xs"`, `"sm"`, `"md"`, `"lg"` | Component size |

**Important:** These props expect static strings, not SQL expressions. See [Dynamic Styling](./dynamic_styling.md) for conditional styling patterns.

The `Color` type (from `components/types`) is the union of valid
`color` values:

```tsx
import type { Color } from "components/types";

// Color = "primary" | "neutral" | "danger" | "success" | "warning" | "harmonize"

interface MyChipProps {
  color?: Color;
}
```

Use it as the prop type when building components that should accept
the same colors as the rest of the system. The `harmonize` value
opts in to colors from a surrounding harmonized container (e.g.
inside a `Card` whose variant set `--harmonize-*` CSS variables) — see
[Colors](./colors.md) and [Style Utils](./style_utils.md).

```tsx
// ✅ Correct
<Button variant="soft" color="primary" size="md">Click</Button>

// ❌ Wrong - will cause errors
<Button color={sql`case when active then 'primary' else 'neutral' end`} />
```

Components with a `size` prop use the shared `Size` type and support `"xs"`,
`"sm"`, `"md"`, and `"lg"`. Layout primitives that do not expose a size prop
are sized through their child components and `sx` styles.

## Style Types

Use exported style types for component style props:

```tsx
import type { Style, StyleObject } from "std/style_types";

interface BannerProps {
  sx?: Style;
}

const rootStyle = {
  display: "flex",
  gap: 2,
  ":hover": {
    bgcolor: "neutral-100",
  },
} satisfies StyleObject;
```

`StyleObject` is one `sx` object: CSS properties, Yolm aliases, pseudo
selectors, breakpoint keys, `dark`/`light`, nested selectors, and CSS variables.
`Style` is any `sx` value: a `StyleObject`, style array, or falsy conditional
value (`null`, `false`, `undefined`). Arrays merge in order.

## Theme Types

Type theme options with `ThemeOpts`:

```tsx
import type { ThemeOpts } from "std/create_theme";

export const appTheme = {
  lightColorScheme: {
    palette: {
      primary: {
        solidBg: "#14532d",
      },
    },
  },
  fontFamily: {
    body: "Inter, sans-serif",
  },
} satisfies ThemeOpts;
```

`ThemeOpts` supports these top-level keys:

| Key | Purpose |
|-----|---------|
| `lightColorScheme` | Partial light-mode color scheme overrides |
| `darkColorScheme` | Partial dark-mode color scheme overrides |
| `focus` | Focus ring and focus highlight settings |
| `typography` | Typography scale and text style overrides |
| `fontFamily` | Font family tokens |
| `transitionDurations` | Named duration tokens |
| `transitionEasings` | Named easing tokens |
| `tokens` | Shared design tokens, including color scales |

## Converting HTML and Tailwind to Yolm

When migrating existing HTML or Tailwind CSS components to Yolm, follow these transformation rules:

### Class and sx Properties

When copying HTML that uses Tailwind classes, keep static utility strings in
`className`. Convert to `sx` only when you intentionally want a style object.

- **No `class` attribute**: There is no `class` attribute on Yolm components. Use `className` for static strings of classes (no SQL expressions) and `sx` for style objects.
- **className limitations**: The `className` prop accepts only static strings, NOT SQL expressions. For dynamic classes based on runtime conditions, use the `dynamicClass` prop instead.
- **Style Objects**: Use `createStyles` or plain objects within the `sx` prop.

#### Conversion Example

Original Tailwind HTML:

```html
<div class="px-4 py-6 sm:px-0">
  <dt class="text-sm font-medium leading-6 text-gray-900">Salary expectation</dt>
  <dd class="mt-1 text-sm leading-6 text-gray-700 sm:mt-0">$120,000</dd>
</div>
```

Converted Yolm Code:

```tsx
<div
  sx={{
    px: 4,
    py: 6,
    sm: {
      px: 0,
    }
  }}
>
  <dt
    sx={{
      fontSize: "sm",
      lineHeight: "normal",
      fontWeight: "medium",
      color: "neutral-900",
    }}
  >
    Salary expectation
  </dt>
  <dd
    sx={{
      fontSize: "sm",
      lineHeight: "normal",
      color: "neutral-700",
    }}
  >
    $120,000
  </dd>
</div>
```

### Dynamic Inline Styles

For runtime-dependent styles, both `sx` and `style` accept `sql` expressions as values. Use `style` for simple inline runtime values; use `sx` when you also need theme tokens, responsive keys, or selectors. See [Dynamic Styling](./dynamic_styling.md).

## CSS Guidelines

1. **Convert to Style Objects**: When copying raw CSS, convert it to a style object format.
2. **Use createStyles**: For complex, reusable styles, use the `createStyles` utility.
3. **Responsive Design**: Use the shorthand responsive keys (e.g., `sm:`, `md:`, `lg:`) within the `sx` object.
