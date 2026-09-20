---
title: Tooltip
description: Tooltip floating popover anchored to an element, plus IconButton whose built-in tooltip prop shows it on hover.
tags:
  - ui
  - components
  - tooltip
  - popover
  - icon-button
related:
  - ui/button.md
  - ui/icons.md
  - ui/overview.md
  - ui/styling.md
---

# Tooltip

The Tooltip component displays a floating popover anchored to another element, typically used to provide additional context or labels. This page also covers [IconButton](#iconbutton), an icon-only button with built-in `Tooltip` support.

```tsx
import { Tooltip } from "components/tooltip";
```

## Basic Usage

Give the anchor element an `id`, then point the Tooltip at it with `anchorEl`.
The Tooltip content is its `children` - a plain string, or a SQL expression for
dynamic text.

```tsx
import { Tooltip } from "components/tooltip";

<button id="tooltip-anchor">Hover me</button>
<Tooltip anchorEl="tooltip-anchor" placement="right">
  Helpful hint
</Tooltip>
```

A directly rendered `Tooltip` is shown immediately - it is a controlled
floating popover, not a hover trigger on its own. To show a tooltip on hover,
use [IconButton](#iconbutton)'s built-in `tooltip` prop (see below), or gate the
`Tooltip` with a `<Show>` element driven by your own hover state.

## Placement

The `placement` prop controls where the tooltip appears relative to its anchor. Default is `"bottom"`.

```tsx
<Tooltip anchorEl="btn-top" placement="top">
  {sql.lit`Above the button`}
</Tooltip>

<Tooltip anchorEl="btn-right" placement="right-start">
  {sql.lit`To the right, aligned to start`}
</Tooltip>
```

Available placements:

| Placement | Description |
|-----------|-------------|
| `"top"` | Centered above |
| `"top-start"` | Above, aligned to start |
| `"top-end"` | Above, aligned to end |
| `"bottom"` | Centered below (default) |
| `"bottom-start"` | Below, aligned to start |
| `"bottom-end"` | Below, aligned to end |
| `"left"` | Centered to the left |
| `"left-start"` | Left, aligned to start |
| `"left-end"` | Left, aligned to end |
| `"right"` | Centered to the right |
| `"right-start"` | Right, aligned to start |
| `"right-end"` | Right, aligned to end |

Placement can also be a SQL expression for dynamic positioning:

```tsx
<Tooltip anchorEl="my-el" placement={sql`placement_scalar`}>
  {sql.lit`Dynamic placement`}
</Tooltip>
```

## Variant and Color

The `variant` and `color` props control the tooltip's visual style, following the Joy UI variant/color system.

```tsx
// Default: solid variant, neutral color
<Tooltip anchorEl="el1">
  {sql.lit`Default tooltip`}
</Tooltip>

// Soft variant with primary color
<Tooltip anchorEl="el2" variant="soft" color="primary">
  {sql.lit`Soft primary tooltip`}
</Tooltip>

// Outlined variant
<Tooltip anchorEl="el3" variant="outlined" color="danger">
  {sql.lit`Warning info`}
</Tooltip>
```

**Variants**: `"solid"` (default), `"soft"`, `"outlined"`, `"plain"`

**Colors**: `"primary"`, `"neutral"` (default), `"danger"`, `"success"`, `"warning"`

**Important**: `color` and `variant` are generation-time strings only, not SQL expressions.

## Size

The `size` prop controls padding and font size of the tooltip.

```tsx
<Tooltip anchorEl="el-xs" size="xs">
  {sql.lit`Extra-small tooltip`}
</Tooltip>

<Tooltip anchorEl="el-sm" size="sm">
  {sql.lit`Small tooltip`}
</Tooltip>

<Tooltip anchorEl="el-lg" size="lg">
  {sql.lit`Large tooltip`}
</Tooltip>
```

| Size | Font Size | Arrow Size |
|------|-----------|------------|
| `"xs"` | Extra small | 7px |
| `"sm"` | Extra small | 8px |
| `"md"` | Small (default) | 10px |
| `"lg"` | Base | 12px |

## Arrow

The Tooltip includes a built-in arrow that points toward the anchor element. The arrow automatically rotates based on placement and inherits the tooltip's variant and color styling.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `anchorEl` | `Sql \| string` | required | ID of the element the tooltip is anchored to |
| `placement` | `Sql \| string` | `"bottom"` | Where the tooltip appears relative to the anchor |
| `variant` | `Variant` | `"solid"` | Style variant: "solid", "soft", "outlined", "plain" |
| `color` | `Color` | `"neutral"` | Theme color: "primary", "neutral", "danger", "success", "warning" |
| `size` | `Size` | `"md"` | Tooltip size: "xs", "sm", "md", "lg" |
| `children` | `Node` | required | Tooltip content |
| `slots` | `object` | - | Override root (`"div"`) and arrow (`"span"`) slot components |
| `slotProps` | `object` | - | Pass props to root and arrow slots |

## IconButton

`IconButton` renders a compact, icon-only button. It has built-in tooltip
support: pass `tooltip` (and optionally `tooltipProps`) and the button shows a
`Tooltip` on hover and focus, wiring up the show/hide state for you.

```tsx
import { IconButton } from "components/icon_button";

<IconButton
  icon="Delete"
  variant="plain"
  color="danger"
  aria-label="Delete"
  tooltip="Delete"
  tooltipProps={{ placement: "top" }}
  onClick={(s) => {
    // delete logic
  }}
/>
```

Provide exactly one of `icon` or `children`. Set `href` to render an anchor
(`<a>`) instead of a `<button>`.

### IconButton Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `icon` | `IconName` | one of icon/children | Material icon to render (see [Icons](./icons.md)) |
| `children` | `Node` | one of icon/children | Content to render instead of an icon; cannot be combined with `icon` |
| `tooltip` | `Node` | No | Tooltip content shown on hover/focus (string or SQL expression) |
| `tooltipProps` | `{ placement? }` | No | Options forwarded to the tooltip; currently only `placement` |
| `variant` | `Variant` | No | Style variant; default `"solid"` |
| `color` | `Color` | No | Theme color; default `"primary"` |
| `size` | `Size` | No | `"xs"`, `"sm"`, `"md"` (default), `"lg"` |
| `disabled` | `BooleanExpr` | No | SQL expression for the disabled state |
| `href` | `Sql \| string` | No | Renders an `<a>` linking to this URL |
| `component` | `ElementType` | No | Root element; default `"button"` (`"a"` when `href` is set) |
| `aria-label` | `Sql \| string` | No | Accessible label; use it for icon-only buttons |

Standard button attributes (`onClick`, `id`, ...) are also accepted via the
underlying `<button>` element.

## Dynamic Content

Tooltip children can include SQL expressions, so content can be dynamic:

```tsx
<Tooltip anchorEl="status-icon">
  {sql`'Last updated: ' || format.date(record.updated_at, '%Y-%m-%d')`}
</Tooltip>

<Tooltip anchorEl="user-avatar">
  {sql`user.display_name || ' (' || user.role || ')'`}
</Tooltip>
```

## Common Mistakes

- `color`, `variant`, and `size` are generation-time strings, not SQL
  expressions (see the example below).
- Don't wire a `popoverTarget` on the anchor; the `Tooltip` attaches itself
  through `anchorEl` - the anchor only needs a matching `id`.
- `IconButton` requires exactly one of `icon` or `children`; passing both, or
  neither, throws at generation time.
- `IconButton` defaults to `color="primary"`; set `color`/`variant` explicitly
  when you want a neutral or plain icon button.

```tsx
// ❌ WRONG - Using SQL for color or variant
<Tooltip color={sql`'danger'`} anchorEl="el">
  Error
</Tooltip>

// ✅ CORRECT - color and variant are generation-time strings
<Tooltip color="danger" anchorEl="el">
  Error
</Tooltip>
```
