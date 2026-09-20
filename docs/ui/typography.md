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

The Typography component renders text with consistent styling levels, optional icons, and decorators.

```tsx
import { Typography } from "components/typography";
```

## Levels

The `level` prop controls text hierarchy. **Do not use `variant` for text size** — `variant` is for styling (soft, outlined, etc.).

Available levels:

| Level | HTML Tag | Usage |
|-------|----------|-------|
| `h1` | `<h1>` | Page titles |
| `h2` | `<h2>` | Section headers |
| `h3` | `<h3>` | Subsection headers |
| `h4` | `<h4>` | Card/group headers |
| `title-lg` | `<div>` | Large titles |
| `title-md` | `<div>` | Medium titles |
| `title-sm` | `<div>` | Small titles |
| `body-lg` | `<div>` | Large body text |
| `body-md` | `<div>` | Default body text |
| `body-sm` | `<div>` | Small body text |
| `body-xs` | `<span>` | Extra small text |
| `inherit` | `<div>` | Inherit from parent |

Default level is `body-md`.

## Basic Usage

```tsx
<Typography level="h3">Page Title</Typography>
<Typography level="title-lg">Section Header</Typography>
<Typography level="body-md">Regular body text</Typography>
<Typography level="body-sm">Small text</Typography>
```

## Icons and Decorators

### startIcon / endIcon

Use `startIcon` and `endIcon` for simple Material Design icons. Pass the icon name as a string — no need to import `MaterialIcon`.

```tsx
<Typography level="title-lg" startIcon="Notes">
  Notes
</Typography>

<Typography level="body-md" endIcon="ArrowForward">
  View more
</Typography>

<Typography level="title-md" startIcon="CheckCircle">
  Completed
</Typography>
```

### startDecorator / endDecorator

Use `startDecorator` and `endDecorator` for custom content (styled icons, badges, multiple elements). These accept any TSX node.

```tsx
import { MaterialIcon } from "components/material_icon";

// Custom styled icon
<Typography level="body-md" startDecorator={<MaterialIcon icon="Error" color="danger" />}>
  Something went wrong
</Typography>

// Custom content
<Typography level="body-sm" endDecorator={<span className="bg-danger-soft text-danger-soft px-1 rounded text-xs">3</span>}>
  Notifications
</Typography>
```

**Note:** You cannot use both `startIcon` and `startDecorator` (or `endIcon` and `endDecorator`) at the same time. Choose one approach per side.

## Styling

```tsx
// With Tailwind classes
<Typography level="body-md" className="text-secondary">
  Muted body text
</Typography>

<Typography level="title-md" className="text-center text-neutral-500 mt-10">
  Centered muted title
</Typography>

// With color prop (theme colors)
<Typography level="body-sm" color="neutral">
  Neutral small text
</Typography>

<Typography level="body-sm" color="danger">
  Error text
</Typography>

// With variant (adds background/border styling)
<Typography level="body-sm" variant="soft" color="success">
  Success badge-like text
</Typography>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `level` | `Level` | `"body-md"` | Typography level (see table above) |
| `color` | `Color` | - | Theme color: "primary", "neutral", "danger", "success", "warning" |
| `variant` | `Variant` | - | Style variant: "plain", "outlined", "soft", "solid" |
| `startIcon` | `IconName` | - | Material icon before text |
| `endIcon` | `IconName` | - | Material icon after text |
| `startDecorator` | `Node` | - | Custom content before text |
| `endDecorator` | `Node` | - | Custom content after text |
| `inline` | `boolean` | `false` | Render as inline element (`<span>`) |
| `noWrap` | `boolean` | `false` | Prevent text wrapping (truncate with ellipsis) |
| `gutterBottom` | `boolean` | `false` | Add bottom margin |
| `className` | `string` | - | Tailwind classes |
| `component` | `string` | auto | Override the HTML tag |

**Important**: `color` and `variant` are generation-time strings only, not SQL expressions.

## Common Mistakes

```tsx
// ❌ WRONG - "h5" and "h6" are NOT valid levels
<Typography level="h5">Wrong</Typography>

// ✅ CORRECT - use title-md or body-lg instead
<Typography level="title-md">Correct</Typography>

// ❌ WRONG - using variant to control text size
<Typography variant="h4">Wrong</Typography>

// ✅ CORRECT - use level for size, variant for styling
<Typography level="h4">Correct</Typography>
```

## Real-World Examples

```tsx
// Card header with icon
<Typography level="title-lg" startIcon="Notes">
  {props.header ?? "Notes"}
</Typography>

// Empty state message
<Typography level="title-lg" className="text-center text-neutral-500 mt-10">
  No results currently found
</Typography>

// Database query display header
<Typography level="h4" className="text-center text-neutral-300">
  No query history found
</Typography>

// Record count
<Typography level="title-md" className="text-left mt-2 mb-2 text-neutral-500">
  Found {sql`(select count(*) from dyn_result)`} records
</Typography>
```
