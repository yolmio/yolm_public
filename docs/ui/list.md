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

The List family renders styled `<ul>`/`<li>` lists for collections, navigation
menus, and settings panels.

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

## Example

```tsx
<List size="sm">
  <ListSubheader sticky>Recent notes</ListSubheader>
  <Each table="notes" recordName="note">
    <ListDivider hideOnFirstEach />
    <ListItem
      endAction={
        <IconButton size="sm" variant="plain">
          <MaterialIcon icon="MoreVert" />
        </IconButton>
      }
    >
      <ListItemButton href={sql`'/notes/' || note.id`} className="rounded-md">
        <ListItemDecorator>
          <MaterialIcon icon="Description" />
        </ListItemDecorator>
        <ListItemContent>
          <Typography level="title-sm">{sql`note.title`}</Typography>
          <Typography level="body-xs">{sql`note.date`}</Typography>
        </ListItemContent>
      </ListItemButton>
    </ListItem>
  </Each>
</List>
```

## Parts

| Component | Renders | Notes |
|-----------|---------|-------|
| `List` | `<ul>` | `size` (default `md`) sets density, font size, and icon size for every item. `orientation` is `"vertical"` (default) or `"horizontal"`. |
| `ListItem` | `<li>` | `startAction`/`endAction` are absolutely positioned, so they overlay rather than push content. `nested` for an item holding a child `List`; `sticky`; `row`/`wrap` for horizontal lists. |
| `ListItemButton` | `<div>`, or `<a>` when `href` (string or SQL) is set | Clickable item; `inRow` adjusts margins in horizontal lists. `backLink` (with `href`) returns to the earlier list page; see [Routing](./routing.md#returning-to-a-list). |
| `ListItemDecorator` | `<span>` | Icon beside the text; pass `listOrientation` inside horizontal lists. |
| `ListItemContent` | `<div>` | Fills the remaining space, for multi-line content. |
| `ListDivider` | `<li role="separator">` | `inset`: `"gutter"`, `"startContent"`, or `"startDecorator"`. `hideOnFirstEach` hides it on the first `Each` iteration (only inside `Each`). |
| `ListSubheader` | `<div>` | Uppercase section header; `sticky` pins it while scrolling. |

`variant` (default `"plain"`), `color` (default `"neutral"`), and `size` follow
the shared [styling props](./styling.md#color-variant-and-size) on `List`,
`ListItem`, and `ListItemButton`; set `size` on `List` so items inherit its
density.

## Nested Lists

Mark the parent `ListItem` as `nested` and pass the child `List` a `nestedIn`
SQL id; it is used as the child's `aria-labelledby` and switches it to nested
spacing.

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

See `ListProps`, `ListItemProps`, `ListItemButtonProps`, and `ListDividerProps`
in `components/list` for the full contract.
