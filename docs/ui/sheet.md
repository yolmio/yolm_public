---
title: Sheet
description: Sheet component for creating styled surface containers with variant and color support.
tags:
  - ui
  - components
  - sheet
---

# Sheet

The Sheet component renders a surface container (`<div>`) with theme-aware background styling. It serves as a foundational layout primitive for panels, sidebars, sticky headers, highlighted sections, and card alternatives.

```tsx
import { Sheet } from "components/sheet";
```

## Basic Usage

```tsx
// Plain sheet (default) - uses surface background
<Sheet>
  <p>Content on a surface</p>
</Sheet>

// Soft colored sheet - subtle background tint
<Sheet variant="soft" color="primary">
  <p>Highlighted content</p>
</Sheet>

// Solid colored sheet - strong background
<Sheet variant="solid" color="danger">
  <p>Alert content</p>
</Sheet>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `Variant` | `"plain"` | Style variant: `"plain"`, `"outlined"`, `"soft"`, `"solid"` |
| `color` | `Color` | `"neutral"` | Theme color: `"primary"`, `"neutral"`, `"danger"`, `"success"`, `"warning"` |
| `harmonize` | `boolean` | `false` | Apply color harmonization to child components (only works with `soft` and `solid` variants) |
| `className` | `string` | - | Tailwind classes for layout, spacing, borders, etc. |
| `sx` | `Style` | - | Inline style object for custom CSS |
| `component` | `string` | `"div"` | Override the HTML tag |
| `children` | `Node` | - | Content rendered inside the sheet |

**Important**: `color` and `variant` are generation-time strings only, not SQL expressions.

## Variants

| Variant | Effect | Use Case |
|---------|--------|----------|
| `plain` | Surface background, no color tint | Default containers, wrappers |
| `soft` | Subtle color-tinted background | Info panels, highlighted sections |
| `solid` | Strong color background with contrasting text | Alerts, banners, prominent headers |
| `outlined` | Transparent with colored border | Bordered sections |

## Harmonization

When `harmonize` is set to `true` with a `soft` or `solid` variant, the Sheet propagates color context to child components. This means child components like Typography, Button, and others will automatically adapt their colors to match the Sheet's color scheme.

```tsx
<Sheet variant="soft" color="primary" harmonize>
  {/* Children automatically pick up harmonized primary colors */}
  <Typography level="body-md">This text adapts to the primary color context</Typography>
</Sheet>
```

## Common Patterns

### Sticky Header Bar

```tsx
<Sheet
  className="sticky top-0 z-50 w-full py-3 px-4 mb-6"
  variant="soft"
  color="primary"
  harmonize
>
  <div className="flex items-center justify-between">
    <Typography level="title-lg">Page Title</Typography>
    <Button>Action</Button>
  </div>
</Sheet>
```

### Info Panel / Highlighted Section

```tsx
<Sheet variant="soft" color="primary" className="p-4 rounded-xl">
  <Typography level="body-sm" className="mb-3 font-semibold">
    Additional Information
  </Typography>
  <p>Explanatory content goes here.</p>
</Sheet>
```

### Fixed Navigation Bar

```tsx
<Sheet
  className="fixed border-b border-divider shadow-lg py-2 top-0 z-50 w-full"
  variant="soft"
  color="primary"
  harmonize
>
  <div className="flex items-center gap-4 px-4">
    <Typography level="title-md">App Name</Typography>
    {/* Navigation items */}
  </div>
</Sheet>
```

### Inline Form Section

```tsx
<Show when={sql`show_extra_fields`}>
  <Sheet variant="soft" color="primary" className="p-3 mt-3">
    <Typography level="body-sm" className="mb-3 font-semibold">
      Please provide additional details:
    </Typography>
    <div className="flex flex-col gap-3">
      <Input value={sql`detail_1`} />
      <Input value={sql`detail_2`} />
    </div>
  </Sheet>
</Show>
```

### Centered Overlay / Modal Alternative

```tsx
<Sheet
  sx={{
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 1000,
  }}
  variant="soft"
  color="success"
  className="p-8 rounded-xl shadow-xl"
>
  <Typography level="h3">Success!</Typography>
</Sheet>
```

## Real-World Examples

```tsx
// Sticky admin toolbar with harmonized colors
<Sheet
  className="sticky top-0 z-50 w-full py-3 px-4 mb-6"
  variant="soft"
  color="primary"
  harmonize
>
  <div className="flex items-center justify-between">
    <Typography level="title-lg" startIcon="AdminPanelSettings">
      Admin Panel
    </Typography>
    <div className="flex gap-2">
      <Form.SubmitButton>Save Changes</Form.SubmitButton>
    </div>
  </div>
</Sheet>

// Collapsible info section
<Show when={sql`info_open`}>
  <Sheet
    color="primary"
    variant="soft"
    harmonize
    className="flex-col flex gap-4 px-4 py-6 rounded-xl"
  >
    <Typography level="body-md">
      Detailed explanation of the current section.
    </Typography>
  </Sheet>
</Show>

// Conditional form section
<Show when={sql`service_status = 'different'`}>
  <Sheet variant="soft" color="primary" className="p-4">
    <Typography level="body-sm" className="mb-3 font-semibold">
      Enter new service information:
    </Typography>
    <div className="flex gap-3">
      <FormControl>
        <FormLabel>Service Name</FormLabel>
        <Input value={sql`new_service_name`} />
      </FormControl>
    </div>
  </Sheet>
</Show>
```
