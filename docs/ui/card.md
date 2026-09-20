---
title: Card
description: Card component for displaying content in a contained, styled container with optional header and overflow sections.
tags:
  - ui
  - components
  - card
  - layout
---

# Card

The Card component displays content in a contained format with consistent padding, border radius, and optional styling variants.

```tsx
import { Card, CardContent, CardHeader, CardOverflow } from "components/card";
```

## Basic Usage

```tsx
<Card variant="outlined">
  <div className="p-6">
    <Typography level="title-lg">Card Title</Typography>
    <Typography level="body-md">Card content goes here</Typography>
  </div>
</Card>
```

## With CardHeader and CardContent

```tsx
<Card variant="outlined">
  <CardHeader>
    <Typography level="title-lg" startIcon="Notes">
      Notes
    </Typography>
  </CardHeader>
  <CardContent>
    <Typography level="body-md">
      Content with consistent padding
    </Typography>
  </CardContent>
</Card>
```

## Card Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `Variant` | `"plain"` | "plain", "outlined", "soft", "solid" |
| `color` | `Color` | `"neutral"` | "primary", "neutral", "danger", "success", "warning" |
| `size` | `Size` | `"md"` | "xs", "sm", "md", "lg" — controls padding and border radius |
| `orientation` | `Orientation` | `"vertical"` | "vertical" or "horizontal" flex direction |
| `harmonize` | `boolean` | `false` | Harmonize card's colors with child components |
| `className` | `string` | - | Tailwind classes |
| `component` | `string` | `"div"` | Override the HTML tag |

**Important**: `color` and `variant` are generation-time strings only, not SQL expressions.

## Sub-Components

### CardHeader

Renders a section at the top of the card with a bottom divider by default.

```tsx
<Card variant="outlined">
  <CardHeader>
    <Typography level="title-lg">Header</Typography>
  </CardHeader>
  <CardContent>Body</CardContent>
</Card>

// Without divider
<CardHeader noDivider>
  <Typography level="title-lg">No Divider</Typography>
</CardHeader>
```

### CardContent

Provides consistent padding and flex layout for the main content area.

```tsx
<CardContent orientation="horizontal">
  <div>Left</div>
  <div>Right</div>
</CardContent>
```

### CardOverflow

Allows content to overflow the card's padding (useful for images, dividers).

```tsx
<Card variant="outlined">
  <CardOverflow>
    <img src={sql`image_url`} />
  </CardOverflow>
  <CardContent>
    <Typography level="title-md">Title</Typography>
  </CardContent>
</Card>
```

## Common Patterns

### Info Card

```tsx
<Card variant="outlined">
  <CardHeader>
    <Typography level="title-lg" startIcon="Info">
      Details
    </Typography>
  </CardHeader>
  <CardContent>
    <Typography level="body-md">{sql`description`}</Typography>
  </CardContent>
</Card>
```

### Styled Card

```tsx
// Soft colored card
<Card variant="soft" color="primary">
  <CardContent>
    <Typography level="title-md">Highlighted</Typography>
    <Typography level="body-sm">Important information</Typography>
  </CardContent>
</Card>

// Extra-small card
<Card variant="outlined" size="xs">
  <div className="p-2">Compact card</div>
</Card>
```

### Horizontal Card

```tsx
<Card variant="outlined" orientation="horizontal">
  <div className="w-16 h-16 bg-primary-100 rounded" />
  <CardContent>
    <Typography level="title-md">{sql`name`}</Typography>
    <Typography level="body-sm">{sql`description`}</Typography>
  </CardContent>
</Card>
```
