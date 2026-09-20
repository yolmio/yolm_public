---
title: Divider
description: Divider component for rendering horizontal or vertical separator lines with optional content.
tags:
  - ui
  - components
  - divider
---

# Divider

The Divider component renders a horizontal or vertical separator line. It can be used as a simple divider or optionally contain text or other content within the line.

```tsx
import { Divider } from "components/divider";
```

## Basic Usage

```tsx
// Horizontal divider (default)
<Divider />

// Vertical divider
<Divider orientation="vertical" />
```

## Orientation

The `orientation` prop controls whether the divider runs horizontally or vertically.

| Orientation | Description |
|-------------|-------------|
| `horizontal` | Horizontal line (default) |
| `vertical` | Vertical line |

```tsx
<Divider />
<Divider orientation="horizontal" />
<Divider orientation="vertical" />
```

## Divider with Text

Pass `children` to render content (typically text) along the divider line. The content will be centered on the line.

```tsx
<Divider>Or</Divider>

<Divider>Section Break</Divider>

// Vertical divider with content
<div style={{ display: "flex", height: "200px" }}>
  <div>Left side</div>
  <Divider orientation="vertical">Center</Divider>
  <div>Right side</div>
</div>
```

## Inset

The `inset` prop controls whether the divider respects context-based margins or uses no inset.

| Inset | Description |
|-------|-------------|
| `none` | No inset margins (full width/height) |
| `context` | Use context-based inset CSS variable |

When `inset` is omitted there is no default value: no inset variable is set on the divider.

```tsx
<Divider inset="none" />

<Divider inset="context" />

<Divider>Full width text divider</Divider>
```

## Hide on First Each

The `hideOnFirstEach` prop is useful when rendering dividers between list items. When set to `true`, the divider will not appear on the first iteration of an Each loop.

```tsx
<Each table="items" recordName="item">
  <Divider hideOnFirstEach />
  <div>{sql`item.name`}</div>
</Each>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Direction of the divider line |
| `inset` | `"none" \| "context"` | - | Whether to apply context-based margins |
| `children` | `Node` | - | Optional content to render within the divider |
| `hideOnFirstEach` | `boolean` | `false` | Hide divider on first iteration when used in Each |
| `className` | `string` | - | Tailwind classes |
| `sx` | `Style` | - | Style overrides applied to the root element |
| `component` | `string` | auto | Override the HTML tag (auto: "hr" or "div" based on children) |

## Common Patterns

### Separating List Items

```tsx
<Each table="items" recordName="item">
  <Divider hideOnFirstEach />
  <div className="py-2">
    <Typography level="body-md">{sql`item.title`}</Typography>
  </div>
</Each>
```

### Horizontal Rule in Forms

```tsx
<div>
  <FormControl>
    <Input placeholder="First name" />
  </FormControl>
  <Divider />
  <FormControl>
    <Input placeholder="Last name" />
  </FormControl>
</div>
```

### Text-Centered Divider

```tsx
<Divider>More Options</Divider>
```

### Layout Separator

```tsx
<div style={{ display: "flex" }}>
  <div style={{ flex: 1 }}>Left panel</div>
  <Divider orientation="vertical" />
  <div style={{ flex: 1 }}>Right panel</div>
</div>
```

## Styling

Apply custom styling with Tailwind classes:

```tsx
// Styled divider
<Divider className="my-4" />

// Divider with text styling
<Divider className="text-secondary">
  Advanced Options
</Divider>
```

## Real-World Examples

```tsx
// List of articles with separators
<Each table="articles" recordName="article">
  <Divider hideOnFirstEach />
  <Card>
    <Typography level="h4">{sql`article.title`}</Typography>
    <Typography level="body-sm" className="text-secondary">
      {sql`article.description`}
    </Typography>
  </Card>
</Each>

// Modal with section dividers
<div>
  <Typography level="h3">Settings</Typography>
  <Divider />

  <Typography level="title-md">General</Typography>
  <FormControl>
    <Input placeholder="Name" />
  </FormControl>

  <Divider />

  <Typography level="title-md">Privacy</Typography>
  <Checkbox>Make profile public</Checkbox>
</div>
```

## Common Mistakes

```tsx
// ❌ WRONG - Forgetting hideOnFirstEach when separating list items
<Each table="items" recordName="item">
  <Divider />  {/* Shows before first item too */}
  <p>{sql`item.name`}</p>
</Each>

// ✅ CORRECT - Use hideOnFirstEach to skip first divider
<Each table="items" recordName="item">
  <Divider hideOnFirstEach />
  <p>{sql`item.name`}</p>
</Each>
```
