---
title: Styling & Layout
description: Guide to styling Yolm components with Tailwind classes, layout patterns, responsive design, and the semantic color system.
tags:
  - ui
  - styling
  - layout
  - tailwind
---

# Styling & Layout

Yolm components use Tailwind CSS classes via the `className` prop and a semantic color system built on Joy UI's variant/color approach.

## className

Every Yolm component accepts a `className` prop for Tailwind utility classes. These are static, generation-time strings.

```tsx
<div className="flex items-center gap-4 p-6 rounded-lg bg-surface">
  <Typography level="title-lg" className="font-bold text-primary">
    Dashboard
  </Typography>
</div>
```

**Important:** `className` is a static string. For runtime conditional styling, use `dynamicClasses` (see below).

## Layout Patterns

### Page Container

The standard page wrapper uses max-width centering with padding:

```tsx
<div className="p-8 max-w-7xl mx-auto">
  {/* page content */}
</div>

// Narrower form pages
<div className="p-8 max-w-3xl mx-auto">
  {/* form content */}
</div>

// Full-height scrollable page
<div className="h-full overflow-y-auto">
  <div className="container mx-auto p-4">
    {/* content */}
  </div>
</div>
```

### Flexbox

```tsx
// Horizontal row with centered items
<div className="flex items-center gap-2">
  <MaterialIcon icon="Dashboard" />
  <Typography level="title-lg">Title</Typography>
</div>

// Space between
<div className="flex items-center justify-between">
  <Typography level="h3">Header</Typography>
  <Button>Action</Button>
</div>

// Vertical stack
<div className="flex flex-col gap-6">
  <Card>...</Card>
  <Card>...</Card>
</div>

// Right-aligned button group
<div className="flex justify-end gap-3 pt-4 border-t border-neutral-100">
  <Button variant="plain">Cancel</Button>
  <Button>Save</Button>
</div>
```

### Responsive Grid (12-column)

The most common layout pattern uses a 12-column grid with responsive breakpoints:

```tsx
<div className="grid grid-cols-12 gap-4">
  {/* Full width on mobile, half on large screens */}
  <Card className="col-span-12 lg:col-span-6" variant="outlined">
    ...
  </Card>
  <Card className="col-span-12 lg:col-span-6" variant="outlined">
    ...
  </Card>

  {/* Full width card */}
  <Card className="col-span-12" variant="outlined">
    ...
  </Card>
</div>
```

### Simple Responsive Grid

For equal-width items that reflow:

```tsx
// 1 column on mobile, 2 on medium, 5 on large
<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
  <div className="text-center p-4">...</div>
  <div className="text-center p-4">...</div>
</div>

// 1 column on mobile, 2 on medium
<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
  <FormControl>
    <FormLabel>First Name</FormLabel>
    <Input />
  </FormControl>
  <FormControl>
    <FormLabel>Last Name</FormLabel>
    <Input />
  </FormControl>
</div>

// 1 column on mobile, 2 on large
<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <Card>...</Card>
  <Card>...</Card>
</div>
```

## Responsive Design

Use standard Tailwind breakpoint prefixes:

| Prefix | Min Width | Usage |
|--------|-----------|-------|
| `sm:` | 640px | Small tablets |
| `md:` | 768px | Tablets |
| `lg:` | 1024px | Laptops |
| `xl:` | 1280px | Desktops |

```tsx
// Responsive column span
<div className="col-span-12 md:col-span-6 xl:col-span-4">

// Responsive grid columns
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

// Responsive padding
<div className="p-4 md:p-6 lg:p-8">
```

## Semantic Color System

### Global Theme Colors

For general UI elements using the neutral palette:

```tsx
// Text hierarchy
className="text-primary"     // Main headings, important content
className="text-secondary"   // Body text, descriptions
className="text-tertiary"    // Supporting text, labels, muted
className="text-icon"        // Icons, very muted text

// Background hierarchy
className="bg-body"          // Page background
className="bg-surface"       // Cards, panels
className="bg-level1"        // Hover states, subtle highlights
className="bg-level2"        // Active/selected states
className="bg-level3"        // Strong emphasis
className="bg-popup"         // Dropdowns, modals
className="bg-tooltip"       // Tooltips

// Borders
className="border-divider"   // Standard dividers
```

### Palette Scale Colors

Direct access to color scales. Semantic palettes: `primary`, `neutral`, `danger`, `success`, `warning`. Scales: 50-950.

```tsx
// Backgrounds
className="bg-primary-100"
className="bg-danger-50"
className="bg-success-50"

// Text
className="text-primary-600"
className="text-neutral-500"
className="text-danger-700"

// Borders
className="border-neutral-100"
className="border-primary-300"

// With opacity
className="bg-primary-500/50"
```

### Variant/Color System

Component-like styling matching Joy UI patterns. Colors: `primary`, `neutral`, `danger`, `success`, `warning`. Variants: `solid`, `soft`, `outlined`, `plain`.

```tsx
// Solid (filled background, contrasting text)
className="bg-primary-solid text-primary-solid"

// Soft (subtle background, darker text) - best for badges, alerts
className="bg-primary-soft text-primary-soft"
className="bg-success-soft text-success-soft"
className="bg-danger-soft text-danger-soft"
className="bg-warning-soft text-warning-soft"

// Outlined (transparent bg, colored border)
className="bg-primary-outlined text-primary-outlined border border-primary-outlined"

// Plain (just text color)
className="text-primary-plain"
className="text-danger-plain"

// With hover states
className="bg-primary-soft hover:bg-primary-soft-hover"
```

### Common Color Patterns

**Status badges:**

```tsx
<span className="bg-success-soft text-success-soft px-2 py-0.5 rounded text-xs">
  Completed
</span>
<span className="bg-danger-soft text-danger-soft px-2 py-0.5 rounded text-xs">
  Error
</span>
<span className="bg-warning-soft text-warning-soft px-2 py-0.5 rounded text-xs">
  Pending
</span>

// Pill badge with palette colors
<span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
  Active
</span>
```

**Alert boxes:**

```tsx
<div className="bg-danger-soft text-danger-soft border border-danger-outlined p-3 rounded-md">
  Error message
</div>
```

**Hover rows:**

```tsx
<div className="px-4 py-3 hover:bg-level1 transition-colors">
  Row content
</div>
```

## dynamicClasses

Use `dynamicClasses` to apply CSS classes conditionally at runtime based on SQL expressions. It is the main low-level API for runtime conditional classes.

```tsx
<span
  className="text-sm"
  dynamicClasses={[
    {
      condition: sql`actual >= budget`,
      classes: "text-success-700",
    },
    {
      condition: sql`actual < budget`,
      classes: "text-danger-700",
    },
  ]}
>
  {sql`format.decimal(variance) || '%'`}
</span>
```

Each entry has a `condition` (boolean SQL expression) and `classes` (Tailwind class string). Multiple conditions can be true simultaneously; all matching classes are applied alongside the static `className`.

### Step Indicator Example

```tsx
<div
  className="flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all"
  dynamicClasses={[
    {
      classes: "bg-success-500 text-white border-success-500",
      condition: sql`current_step > 1`,
    },
    {
      classes: "border-primary-500 text-primary-500",
      condition: sql`current_step = 1`,
    },
    {
      classes: "border-neutral-300 text-neutral-400",
      condition: sql`current_step < 1`,
    },
  ]}
>
  1
</div>
```

## Card Layouts

### Basic Card with Header

```tsx
<Card variant="outlined">
  <CardHeader className="border-b border-neutral-100">
    <div className="flex items-center gap-2">
      <MaterialIcon icon="Inventory" className="text-neutral-400" />
      <Typography level="title-md">Inventory</Typography>
    </div>
  </CardHeader>
  <div className="p-4">
    {/* card body */}
  </div>
</Card>
```

### Stats Grid Inside a Card

```tsx
<Card variant="outlined">
  <CardHeader>
    <Typography level="title-md">Statistics</Typography>
  </CardHeader>
  <div className="p-4 grid grid-cols-2 gap-4">
    <div className="text-center">
      <Typography level="title-lg">{sql`count_value`}</Typography>
      <Typography level="body-xs" className="text-tertiary">
        Total Orders
      </Typography>
    </div>
    <div className="text-center">
      <Typography level="title-lg">{sql`total_value`}</Typography>
      <Typography level="body-xs" className="text-tertiary">
        Revenue
      </Typography>
    </div>
  </div>
</Card>
```

### List Card with Dividers

```tsx
<Card variant="outlined">
  <CardHeader>
    <Typography level="title-md">Recent Items</Typography>
  </CardHeader>
  <div className="divide-y">
    <Each table="items" recordName="item">
      <div className="px-4 py-3 hover:bg-level1 transition-colors">
        <Typography level="body-sm" className="font-medium">
          {sql`item.name`}
        </Typography>
        <Typography level="body-xs" className="text-tertiary">
          {sql`item.description`}
        </Typography>
      </div>
    </Each>
  </div>
</Card>
```

### Empty State

```tsx
<div className="p-6 text-center">
  <MaterialIcon icon="SearchOff" className="text-4xl text-neutral-300 mb-2" />
  <Typography level="body-sm" className="text-tertiary">
    No results found
  </Typography>
</div>
```

## Spacing Reference

Common spacing values used across the codebase:

| Class | Size | Usage |
|-------|------|-------|
| `gap-2` | 0.5rem | Icon + text pairs |
| `gap-3` | 0.75rem | Button groups |
| `gap-4` | 1rem | Grid items, form fields |
| `gap-6` | 1.5rem | Card groups, sections |
| `p-4` | 1rem | Card body padding |
| `p-6` | 1.5rem | Spacious card padding |
| `p-8` | 2rem | Page-level padding |
| `px-4 py-3` | - | List row padding |
| `px-2 py-0.5` | - | Badge padding |
| `mb-6` | 1.5rem | Section bottom margin |
| `mb-8` | 2rem | Page header bottom margin |

## Common Mistakes

```tsx
// WRONG - Using SQL for color/variant props (generation-time only)
<Button color={sql`case when ok then 'success' else 'danger' end`}>

// CORRECT - Use Show/Switch for conditional color
<Show when={sql`ok`}>
  <Button color="success">OK</Button>
</Show>
<Show when={sql`not ok`}>
  <Button color="danger">Error</Button>
</Show>

// WRONG - Trying runtime logic in className (static string)
<div className={`bg-${color}-500`}>

// CORRECT - Use dynamicClasses for runtime conditional styling
<div
  className="rounded p-2"
  dynamicClasses={[
    { condition: sql`status = 'active'`, classes: "bg-success-500" },
    { condition: sql`status = 'error'`, classes: "bg-danger-500" },
  ]}
>
```
