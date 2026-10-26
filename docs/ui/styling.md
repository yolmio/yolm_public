---
title: Styling
description: How to style Yolm UI with className, sx, style, color/variant/size props, dynamic classes, semantic Tailwind colors, layout, and HTML conversion.
tags:
  - ui
  - styling
  - css
  - tailwind
  - layout
related:
  - ui/theming.md
  - ui/website_styling.md
  - ui/overview.md
---

# Styling

Yolm compiles styles at generation time. Pick the styling tool by whether the
value is static or changes at runtime:

| Need | Use | Runtime SQL? |
| --- | --- | --- |
| Static Tailwind utilities | `className="flex gap-4 p-6"` | No |
| Static style object, theme tokens, selectors, breakpoints | `sx={{ ... }}` | No |
| Existing raw CSS class names | `classes="my-class"` | No |
| Tailwind classes toggled by a condition | `dynamicClassNames` | Condition only |
| Raw class names toggled by a condition | `dynamicClass` / `dynamicClasses` | Condition only |
| A CSS value computed at runtime | `style={{ width: sql\`...\` }}` | Yes |
| Component look | `color`, `variant`, `size` props | No |

`className` is converted to an `sx` style object, and `sx` is compiled into a
generated CSS class. Neither accepts SQL. There is no `class` attribute.

## Color, Variant, and Size

Most components share these static props:

| Prop | Values |
| --- | --- |
| `color` | `primary`, `neutral`, `danger`, `success`, `warning`, `harmonize` |
| `variant` | `plain`, `outlined`, `soft`, `solid` |
| `size` | `xs`, `sm`, `md`, `lg` (components that expose `size`) |

Use the exported types when building components that accept the same values:

```tsx
import type { Color, Size, Variant } from "components/types";
```

`harmonize` takes its colors from the nearest harmonized container, such as
`<Card harmonize variant="soft" color="primary">`; see
[Theming](./theming.md#harmonized-surfaces).

These props are generation-time strings. To choose a color from data, render
static variants with `Switch`/`Match` or `Show`:

```tsx
<Switch>
  <Match when={sql`order.status = 'late'`}>
    <Chip color="danger">Late</Chip>
  </Match>
  <Match when={sql.true}>
    <Chip color="neutral">{sql`order.status`}</Chip>
  </Match>
</Switch>
```

## Dynamic Classes

Three props toggle classes from a SQL condition. They differ in what the class
string means:

| Prop | Shape | Class string is |
| --- | --- | --- |
| `dynamicClassNames` | `{ condition, classNames }[]` | Tailwind utilities, compiled like `className` |
| `dynamicClass` | `{ condition, classes }` | Raw CSS class names |
| `dynamicClasses` | `{ condition, classes }[]` | Raw CSS class names (several entries) |

Use `dynamicClassNames` for conditional Tailwind. All entries whose condition
is true are applied alongside the static `className`.

```tsx
<span
  className="text-sm"
  dynamicClassNames={[
    { condition: sql`actual >= budget`, classNames: "text-success-700" },
    { condition: sql`actual < budget`, classNames: "text-danger-700 font-semibold" },
  ]}
>
  {sql`format.decimal(variance) || '%'`}
</span>
```

Use `dynamicClass`/`dynamicClasses` when the class is a plain name that some
CSS already targets, usually an `sx` selector on the same element. Tailwind
utilities in `classes` are not compiled and have no effect.

```tsx
<div
  sx={{
    borderLeft: "3px solid transparent",
    "&.selected": { borderLeftColor: "primary-500", bgcolor: "background-level1" },
  }}
  dynamicClass={{ condition: sql`row.id = selected_id`, classes: "selected" }}
>
  {sql`row.name`}
</div>
```

Animations follow the same pattern: register keyframes once and enable them
with a raw class.

```tsx
const pulse = useApp().registerKeyframes({
  "0%": { transform: "scale(1)" },
  "50%": { transform: "scale(1.1)" },
});

<Button
  sx={{ "&.pulse": { animation: `${pulse} 1s ease-in-out` } }}
  dynamicClass={{ condition: sql`has_unsaved_changes`, classes: "pulse" }}
>
  Save Changes
</Button>
```

## Runtime Values With style

`style` values may be SQL expressions. They are written as inline CSS, so they
must evaluate to real CSS values; theme shorthands such as `primary-500` are
only translated inside `sx`. Use `var(--palette-...)` for theme colors.

```tsx
<div className="h-2 rounded bg-neutral-100 overflow-hidden">
  <div
    className="h-full"
    style={{
      width: sql`cast(task.completion as string) || '%'`,
      backgroundColor: sql`case
        when task.completion = 100 then 'var(--palette-success-500)'
        else 'var(--palette-primary-500)'
      end`,
    }}
  />
</div>
```

Prefer a static class plus `dynamicClassNames` when the set of looks is small;
use `style` for continuous values such as widths and positions.

## The sx Prop

`sx` takes a `StyleObject` (or an array of them, merged in order; falsy entries
are skipped): CSS properties, aliases (`p`, `px`, `m`, `bgcolor`, ...),
pseudo selectors, nested selectors, CSS variables, `dark`/`light` keys, and
breakpoint keys `sm`, `md`, `lg`, `xl`, `2xl`.

```tsx
import type { Style, StyleObject } from "std/style_types";

const rowStyle = {
  display: "flex",
  gap: 2,
  px: 4,
  sm: { px: 0 },
  ":hover": { bgcolor: "background-level1" },
  dark: { borderColor: "neutral-700" },
} satisfies StyleObject;

interface BannerProps {
  sx?: Style;
}
```

Color properties accept theme tokens: palette steps (`primary-500`), variant
tokens (`danger-soft-bg`, `neutral-outlined-border`), and semantic tokens
(`text-secondary`, `background-surface`, `divider`). Dots are normalized to
dashes, but camelCase names such as `outlinedBorder` are not recognized.
Use `createStyles` from `std/style_utils` for reusable named style sets; see
[Theming](./theming.md#style-utilities).

## Semantic Tailwind Colors

Prefer semantic classes so light/dark mode and app themes keep working.

| Purpose | Classes |
| --- | --- |
| Text hierarchy | `text-primary`, `text-secondary`, `text-tertiary`, `text-icon` |
| Backgrounds | `bg-body`, `bg-surface`, `bg-level1`, `bg-level2`, `bg-level3`, `bg-popup`, `bg-tooltip`, `bg-backdrop` |
| Borders | `border-divider` |
| Palette steps | `bg-primary-100`, `text-danger-700`, `border-neutral-200`, `bg-primary-500/50` |
| Variant pairs | `bg-{color}-{variant}` + `text-{color}-{variant}`, with `-hover`, `-active`, `-disabled` suffixes; `border-{color}-outlined` |

Palette and variant colors are `primary`, `neutral`, `danger`, `success`, and
`warning`; steps are `50`-`950`.

```tsx
<span className="bg-success-soft text-success-soft px-2 py-0.5 rounded text-xs">
  Completed
</span>
<div className="px-4 py-3 hover:bg-level1 transition-colors">Row content</div>
```

## Layout

Tailwind layout utilities work as usual. Density and width depend on the users
and device (see [UX](../ai/review.md#ux)): back-office screens use the available
width with tight spacing; public or portal forms may cap their width. Common
app patterns:

```tsx
// Back-office page: full width, compact padding
<div className="p-4">...</div>

// Public or portal form page
<div className="p-6 max-w-3xl mx-auto">...</div>

// 12-column responsive grid
<div className="grid grid-cols-12 gap-4">
  <Card className="col-span-12 lg:col-span-6" variant="outlined">...</Card>
  <Card className="col-span-12 lg:col-span-6" variant="outlined">...</Card>
</div>

// Header row and right-aligned actions
<div className="flex items-center justify-between">...</div>
<div className="flex justify-end gap-3 pt-4 border-t border-divider">...</div>

// Empty state
<div className="p-6 text-center text-tertiary">No results found</div>
```

Breakpoint prefixes are `sm:` (640px), `md:` (768px), `lg:` (1024px), and
`xl:` (1280px) in `className`. In `sx`, use the same names as object keys
(`sm: { ... }`), not prefixes.

## Converting HTML and Tailwind

- Rename `class` to `className` and keep static Tailwind utilities as they are.
- Replace runtime-built class strings with `dynamicClassNames`.
- Map hard-coded grays and brand colors to semantic classes (`text-gray-900` to
  `text-primary`, `text-gray-500` to `text-tertiary`, `bg-white` to
  `bg-surface`).
- Convert raw CSS to `sx` objects only when Tailwind cannot express it
  (complex selectors, CSS variables, keyframes).

```html
<div class="px-4 py-6 sm:px-0">
  <dt class="text-sm font-medium text-gray-900">Salary expectation</dt>
  <dd class="mt-1 text-sm text-gray-700 sm:mt-0">$120,000</dd>
</div>
```

```tsx
<div className="px-4 py-6 sm:px-0">
  <dt className="text-sm font-medium text-primary">Salary expectation</dt>
  <dd className="mt-1 text-sm text-secondary sm:mt-0">{sql`job.salary_label`}</dd>
</div>
```

## Common Mistakes

- Putting SQL in `sx` or `className`; use `style` or `dynamicClassNames`.
- Putting Tailwind utilities in `dynamicClass`/`dynamicClasses`; they are raw
  class names and are not compiled.
- Using `sm:` prefixes inside `sx`; use `sm: { ... }` keys.
- Returning theme shorthands like `'success-600'` from a `style` expression;
  return `'var(--palette-success-600)'`.
- Hard-coding hex colors where a semantic class or theme token exists.
