---
title: Icons (MaterialIcon)
description: Material Design icons for use in buttons, typography, lists, and standalone display.
tags:
  - ui
  - components
  - icons
---

# Icons

Yolm uses Material Design icons via the `MaterialIcon` component. Icons are SVG-based and integrate with the theme system.

## Import

```tsx
import { MaterialIcon } from "components/material_icon";
```

### `IconName` type

The `icon` prop is typed as `IconName` — a union of every Material
Symbol that ships with Yolm. Autocomplete lists every available value;
unknown names fail at generation time.

```tsx
import type { IconName } from "components/material_icon_names";

interface MyButtonProps {
  icon: IconName;
}
```

Suffixed variants (`Outlined`, `Rounded`, `Sharp`, `TwoTone`) are
exposed as separate values; the unsuffixed name is the filled
"default" symbol.

## Basic Usage

```tsx
<MaterialIcon icon="Delete" />
<MaterialIcon icon="Search" />
<MaterialIcon icon="Add" />
<MaterialIcon icon="Settings" />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `IconName` | (required) | Material Design icon name |
| `color` | `SvgIconColor` | `"inherit"` | "primary", "neutral", "danger", "success", "warning", "harmonize", "inherit" |
| `fontSize` | `SvgIconFontSize` | - | Theme font size or "inherit" |
| `title` | `Sql` | - | Accessible title text |
| `className` | `string` | - | Tailwind classes |

## Icon Names

Icons use PascalCase names from Material Design. Each icon has style variants:

- Base: `"Add"`, `"Delete"`, `"Search"`
- Outlined: `"AddOutlined"`, `"DeleteOutlined"`
- Rounded: `"AddRounded"`, `"DeleteRounded"`
- Sharp: `"AddSharp"`, `"DeleteSharp"`
- TwoTone: `"AddTwoTone"`, `"DeleteTwoTone"`

### Common Icon Names

**Navigation**: `ArrowBack`, `ArrowForward`, `Menu`, `Close`, `ExpandMore`, `ExpandLess`, `ChevronLeft`, `ChevronRight`, `MoreVert`, `MoreHoriz`

**Actions**: `Add`, `Delete`, `Edit`, `Save`, `Search`, `Refresh`, `Download`, `Upload`, `Share`, `Print`, `FilterList`, `Sort`

**Content**: `Notes`, `Article`, `Description`, `Folder`, `AttachFile`, `Link`, `Image`, `VideoLibrary`

**Communication**: `Email`, `Phone`, `Chat`, `Forum`, `Comment`, `Notifications`

**Status**: `Check`, `CheckCircle`, `Error`, `Warning`, `Info`, `Help`, `Block`, `Cancel`

**People**: `Person`, `People`, `Groups`, `AccountCircle`, `PersonAdd`

**Business**: `Business`, `Work`, `ShoppingCart`, `AttachMoney`, `Receipt`, `Inventory`, `Analytics`, `TrendingUp`, `Dashboard`

**Time**: `Schedule`, `CalendarToday`, `Event`, `History`, `Timer`, `AccessTime`

**Toggle**: `LightMode`, `DarkMode`, `Visibility`, `VisibilityOff`, `Star`, `StarBorder`, `Favorite`, `FavoriteBorder`

## Using Icons in Components

### startIcon / endIcon Props

Many components accept `startIcon` and `endIcon` props directly — no need to wrap `MaterialIcon` manually:

```tsx
// Button
<Button startIcon="Add" variant="solid" color="primary">
  Add Item
</Button>

<Button endIcon="ArrowForward">
  Next
</Button>

// Typography
<Typography level="title-lg" startIcon="Notes">
  Notes Section
</Typography>

// IconButton (use MaterialIcon as child)
<IconButton variant="plain" color="danger">
  <MaterialIcon icon="Delete" />
</IconButton>
```

### startDecorator / endDecorator Props

For custom icon styling or non-icon content, use decorator props:

```tsx
// Custom styled icon
<Button startDecorator={<MaterialIcon icon="Add" color="success" />}>
  Add Item
</Button>

// Icon in Select
<Select
  placeholder="Choose..."
  startDecorator={<MaterialIcon icon="Article" />}
>
  {/* options */}
</Select>
```

**Note:** You cannot use both `startIcon` and `startDecorator` at the same time.

## Standalone Icons

```tsx
// With color
<MaterialIcon icon="CheckCircle" color="success" />
<MaterialIcon icon="Error" color="danger" />
<MaterialIcon icon="Warning" color="warning" />

// With size via className
<MaterialIcon icon="Search" className="text-4xl" />
<MaterialIcon icon="Dashboard" className="text-2xl text-primary-500" />

// With fontSize prop
<MaterialIcon icon="Info" fontSize="lg" />
```

## Dynamic Icons (Show/Switch Pattern)

Since icon names are generation-time strings, use Show/Switch for dynamic icons:

```tsx
<Show when={sql`is_completed`}>
  <MaterialIcon icon="CheckCircle" color="success" />
</Show>
<Show when={sql`not is_completed`}>
  <MaterialIcon icon="RadioButtonUnchecked" color="neutral" />
</Show>
```

## Common Patterns

### Icon in a Header Row

```tsx
<div className="flex items-center gap-2">
  <MaterialIcon icon="Inventory" className="text-neutral-400" />
  <Typography level="title-md">Inventory</Typography>
</div>
```

### Icon in List Items

```tsx
<ListItemButton>
  <ListItemDecorator>
    <MaterialIcon icon="Settings" />
  </ListItemDecorator>
  Settings
</ListItemButton>
```

### Icon Button with Tooltip

```tsx
<IconButton
  icon="Delete"
  variant="plain"
  color="danger"
  tooltip={sql.lit`Delete this record`}
  onClick={(s) => { /* delete logic */ }}
/>
```
