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

`Card` is a padded, rounded surface container. `CardHeader`, `CardContent`,
and `CardOverflow` structure its content.

```tsx
import { Card, CardContent, CardHeader, CardOverflow } from "components/card";
```

## Basic Usage

```tsx
<Card variant="outlined">
  <CardOverflow>
    <img src={sql`product.image_url`} className="w-full" />
  </CardOverflow>
  <CardHeader>
    <Typography level="title-lg">Details</Typography>
  </CardHeader>
  <CardContent>
    <Typography level="body-md">{sql`product.description`}</Typography>
  </CardContent>
</Card>
```

## Card

- `size` (`xs` | `sm` | `md` default | `lg`) sets `--card-padding`
  (0.375rem / 0.5rem / 1rem / 1.5rem) and `--card-radius`.
- `orientation`: `"vertical"` (default) or `"horizontal"` flex direction.
- `variant` (default `plain`) and `color` (default `neutral`) follow the shared
  [styling props](./styling.md#color-variant-and-size). The card has a surface
  background and small shadow unless the variant overrides it.
- `harmonize`: with a `soft`/`solid` variant, recolors descendants that use the
  default color to match the card background.
- A `Divider` directly in a card bleeds to the card edges (`--divider-inset`).

See `CardProps` in `components/card` for the full contract.

## Sub-Components

- `CardOverflow` cancels the card padding so content (images, banners, accent
  strips) reaches the card edges, with corner radii adjusted for the first and
  last child. `row` bleeds vertically for horizontal cards. It accepts its own
  `variant`, `color`, and `harmonize`.
- `CardHeader` is a full-width `CardOverflow` with a bottom divider; pass
  `noDivider` to remove it.
- `CardContent` is a flex area (`orientation`, default vertical) that adds its
  own `--card-padding`.

For read-only record display and data-backed cards, see the card helpers in
[Solution Components](./solution_components.md).
