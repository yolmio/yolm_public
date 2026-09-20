---
title: List
description: List components for displaying collections of items, navigation menus, and interactive lists.
tags:
  - ui
  - components
  - list
  - navigation
---

# List

The List family of components provides structured, styled lists for displaying collections of items, navigation menus, settings panels, and more. Based on Joy UI's List design.

```tsx
import {
  List,
  ListItem,
  ListItemButton,
  ListItemContent,
  ListItemDecorator,
  ListDivider,
  ListSubheader,
} from "components/list";
```

## Basic Usage

```tsx
<List>
  <ListItem>First item</ListItem>
  <ListItem>Second item</ListItem>
  <ListItem>Third item</ListItem>
</List>
```

## Components

### List

The outer container. Renders as `<ul>` by default.

```tsx
<List size="md" variant="plain" color="neutral" orientation="vertical">
  {/* ListItem children */}
</List>
```

#### List Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | `"md"` | Controls spacing, font size, and min-height of items |
| `variant` | `Variant` | `"plain"` | Style variant: "plain", "outlined", "soft", "solid" |
| `color` | `Color` | `"neutral"` | Theme color: "primary", "neutral", "danger", "success", "warning" |
| `orientation` | `"horizontal" \| "vertical"` | `"vertical"` | Layout direction of items |
| `nestedIn` | `Sql` | - | ID of parent list when this is a nested list |
| `className` | `string` | - | Tailwind classes |
| `children` | `Node` | required | List content |

### ListItem

Individual list item. Renders as `<li>` by default.

```tsx
<ListItem
  variant="plain"
  color="neutral"
  startAction={<IconButton size="sm"><MaterialIcon icon="DragIndicator" /></IconButton>}
  endAction={<IconButton size="sm"><MaterialIcon icon="Delete" /></IconButton>}
>
  Item content
</ListItem>
```

#### ListItem Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `Variant` | `"plain"` | Style variant |
| `color` | `Color` | `"neutral"` | Theme color |
| `nested` | `boolean` | `false` | Whether this item contains a nested list |
| `sticky` | `boolean` | `false` | Stick to top when scrolling |
| `row` | `boolean` | `false` | Layout in row direction (for horizontal lists) |
| `wrap` | `boolean` | `false` | Allow wrapping in row mode |
| `startAction` | `Node` | - | Content positioned at the start (absolutely positioned) |
| `endAction` | `Node` | - | Content positioned at the end (absolutely positioned) |
| `className` | `string` | - | Tailwind classes |
| `children` | `Node` | required | Item content |

### ListItemButton

Makes a list item interactive/clickable. Renders as `<div>` or `<a>` (when `href` is provided).

```tsx
<ListItem>
  <ListItemButton variant="plain" color="neutral">
    Click me
  </ListItemButton>
</ListItem>
```

#### ListItemButton Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `Variant` | `"plain"` | Style variant |
| `color` | `Color` | `"neutral"` | Theme color |
| `href` | `Sql \| string` | - | Navigation URL. When provided, renders as `<a>` tag |
| `inRow` | `boolean` | `false` | Adjusts margins for horizontal layout |
| `className` | `string` | - | Tailwind classes |
| `children` | `Node` | required | Button content |

### ListItemDecorator

Displays an icon or small element beside the list item text. Renders as `<span>`.

```tsx
<ListItemDecorator>
  <MaterialIcon icon="Inbox" />
</ListItemDecorator>
```

#### ListItemDecorator Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `listOrientation` | `"horizontal" \| "vertical"` | `"vertical"` | Orientation of the parent list |
| `children` | `Node` | required | Decorator content (typically an icon) |

### ListItemContent

Flexible content area that fills remaining space in a list item. Renders as `<div>`.

```tsx
<ListItem>
  <ListItemDecorator>
    <MaterialIcon icon="Person" />
  </ListItemDecorator>
  <ListItemContent>
    <Typography level="title-sm">Username</Typography>
    <Typography level="body-xs">Online</Typography>
  </ListItemContent>
</ListItem>
```

#### ListItemContent Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `className` | `string` | - | Tailwind classes |
| `children` | `Node` | required | Content |

### ListDivider

A visual separator between list items. Renders as `<li>` with `role="separator"`.

```tsx
<List>
  <ListItem>Item 1</ListItem>
  <ListDivider />
  <ListItem>Item 2</ListItem>
</List>
```

#### ListDivider Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `inset` | `"gutter" \| "startContent" \| "startDecorator"` | - | Controls left/right margin inset |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Divider direction |
| `hideOnFirstEach` | `boolean` | `false` | Hides divider on first iteration when used inside `Each` |

### ListSubheader

A section header within a list. Renders as `<div>` with uppercase, smaller text.

```tsx
<List>
  <ListSubheader>Section A</ListSubheader>
  <ListItem>Item 1</ListItem>
  <ListItem>Item 2</ListItem>
  <ListSubheader sticky>Section B</ListSubheader>
  <ListItem>Item 3</ListItem>
</List>
```

#### ListSubheader Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `sticky` | `boolean` | `false` | Stick to top when scrolling |
| `className` | `string` | - | Tailwind classes |
| `children` | `Node` | required | Subheader content |

## Sizes

The `size` prop on `List` controls the density of all items within:

| Size | Min Height | Font Size | Padding | Icon Size |
|------|-----------|-----------|---------|-----------|
| `xs` | 1.5rem | text-xs | 0.125rem / 0.375rem | 1rem |
| `sm` | 2rem | text-sm | 0.25rem / 0.5rem | 1.125rem |
| `md` | 2.5rem | text-base | 0.375rem / 0.75rem | 1.25rem |
| `lg` | 3rem | text-base | 0.5rem / 1rem | 1.5rem |

## Common Patterns

### Navigation Menu with Icons

```tsx
<List size="sm">
  <ListItem>
    <ListItemButton className="rounded-md">
      <ListItemDecorator>
        <MaterialIcon icon="Dashboard" />
      </ListItemDecorator>
      Dashboard
    </ListItemButton>
  </ListItem>
  <ListItem>
    <ListItemButton className="rounded-md">
      <ListItemDecorator>
        <MaterialIcon icon="Settings" />
      </ListItemDecorator>
      Settings
    </ListItemButton>
  </ListItem>
  <ListItem>
    <ListItemButton className="rounded-md">
      <ListItemDecorator>
        <MaterialIcon icon="Logout" />
      </ListItemDecorator>
      Log out
    </ListItemButton>
  </ListItem>
</List>
```

### Data List with Dividers and Each

Use `hideOnFirstEach` on `ListDivider` to automatically hide the divider before the first item:

```tsx
<List>
  <Each table="notes" recordName="note">
    <ListDivider hideOnFirstEach />
    <ListItem
      endAction={
        <IconButton size="sm" variant="plain">
          <MaterialIcon icon="MoreVert" />
        </IconButton>
      }
    >
      {sql`note.content`} at {sql`note.date`}
    </ListItem>
  </Each>
</List>
```

### List with Multi-line Content

```tsx
<List>
  <ListItem>
    <ListItemDecorator>
      <MaterialIcon icon="Person" />
    </ListItemDecorator>
    <ListItemContent>
      <Typography level="title-sm">Jane Doe</Typography>
      <Typography level="body-xs">Software Engineer</Typography>
    </ListItemContent>
  </ListItem>
</List>
```

### Highlighted ListItemButton

Use `color` and `variant` on `ListItemButton` for emphasis:

```tsx
<ListItem>
  <ListItemButton className="rounded-md" color="harmonize" variant="soft">
    <ListItemDecorator>
      <MaterialIcon icon="AutoAwesome" />
    </ListItemDecorator>
    Upgrade to Pro
  </ListItemButton>
</ListItem>
```

### Nested List

Use `nested` on `ListItem` and `nestedIn` on the child `List`:

```tsx
<List>
  <ListItem nested>
    <ListSubheader>Category A</ListSubheader>
    <List nestedIn={sql`'category-a'`}>
      <ListItem>Sub-item 1</ListItem>
      <ListItem>Sub-item 2</ListItem>
    </List>
  </ListItem>
</List>
```

## Important Notes

- `color` and `variant` are **generation-time strings only**, not SQL expressions.
- `ListDivider` with `hideOnFirstEach` only works inside an `Each` component.
- `ListItemButton` with `href` renders as an `<a>` tag for proper navigation semantics.
- The `startAction` and `endAction` props on `ListItem` are absolutely positioned, so they overlay rather than push content.
