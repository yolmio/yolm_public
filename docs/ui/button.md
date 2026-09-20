---
title: Button
description: Button and IconButton components for user interactions with various styles, sizes, and loading states.
tags:
  - ui
  - components
  - button
  - interaction
---

# Button

The Button component renders an interactive button with consistent styling, optional icons, decorators, and loading states.

```tsx
import { Button } from "components/button";
```

## Basic Usage

```tsx
<Button
  onClick={(s) => {
    s.setScalar("clicked", sql.true);
  }}
>
  Click Me
</Button>
```

## Variants

The `variant` prop controls the button's visual style.

| Variant | Description |
|---------|-------------|
| `solid` | Filled background with contrasting text (default) |
| `soft` | Subtle background with darker text |
| `outlined` | Transparent background with colored border |
| `plain` | Transparent background, just text color |

```tsx
<Button variant="solid">Solid</Button>
<Button variant="soft">Soft</Button>
<Button variant="outlined">Outlined</Button>
<Button variant="plain">Plain</Button>
```

## Colors

The `color` prop sets the theme color. Default is `"primary"`.

| Color | Usage |
|-------|-------|
| `primary` | Primary actions (default) |
| `neutral` | Secondary/subtle actions |
| `danger` | Destructive actions |
| `success` | Positive/confirmation actions |
| `warning` | Caution actions |

```tsx
<Button color="primary">Submit</Button>
<Button color="danger">Delete</Button>
<Button color="success">Approve</Button>
<Button variant="soft" color="warning">Caution</Button>
```

## Sizes

The `size` prop controls the button dimensions. Default is `"md"`.

| Size | Min Height |
|------|------------|
| `xs` | 1.5rem |
| `sm` | 2rem |
| `md` | 2.5rem |
| `lg` | 3rem |

```tsx
<Button size="xs">Extra Small</Button>
<Button size="sm">Small</Button>
<Button size="md">Medium</Button>
<Button size="lg">Large</Button>
```

## Icons and Decorators

### startIcon / endIcon

Use `startIcon` and `endIcon` for Material Design icons. Pass the icon name as a string.

```tsx
<Button startIcon="Add">Add Item</Button>
<Button endIcon="ArrowForward">Next</Button>
<Button startIcon="ArrowBack" variant="plain" color="primary" href="/">
  Back
</Button>
```

### startDecorator / endDecorator

Use `startDecorator` and `endDecorator` for custom content. These accept any TSX node.

```tsx
import { MaterialIcon } from "components/material_icon";

<Button startDecorator={<MaterialIcon icon="Save" />}>
  Save Changes
</Button>
```

**Note:** You cannot use both `startIcon` and `startDecorator` (or `endIcon` and `endDecorator`) at the same time. Choose one approach per side.

## Loading State

The `loading` prop accepts a SQL boolean expression to show a loading indicator and disable interaction.

```tsx
<Button loading={sql`waiting`} onClick={handleSubmit}>
  Submit
</Button>
```

The `loadingPosition` prop controls where the loading indicator appears:

| Position | Description |
|----------|-------------|
| `center` | Replaces button text (default when no decorators) |
| `start` | Replaces start decorator |
| `end` | Replaces end decorator |

The loading position is automatically inferred: if only a start decorator exists, it defaults to `"start"`; if only an end decorator, `"end"`; otherwise `"center"`.

## Disabled State

The `disabled` prop accepts a SQL boolean expression.

```tsx
<Button disabled={sql`form_invalid`} onClick={handleSubmit}>
  Submit
</Button>
```

## Full Width

```tsx
<Button fullWidth>Full Width Button</Button>
```

## Link Button

When `href` is provided, the button renders as an anchor tag (`<a>`).

```tsx
<Button href="/orders/new" startIcon="Add">
  New Order
</Button>

<Button variant="soft" href="/reports/coverage" startIcon="Map">
  Coverage Report
</Button>
```

## onClick Event Handler

Event handlers receive a statements object `s` for defining procedure code.

```tsx
<Button
  onClick={(s) => {
    s.setScalar("selected_id", sql`item.id`);
  }}
>
  Select
</Button>
```

### Server Interaction Pattern

Use `tryServer` for operations that modify the main database.

```tsx
<Button
  loading={sql`saving`}
  onClick={(s) => {
    s.setScalar("saving", sql.true);
    s.commitUiTreeChanges();

    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`insert into db.todos (title) values (ui.input_text)`);
        s.commitTransaction();
        s.increment("ui.refresh_key");
      },
      catch: (s) => s.setScalar("error", sql.lit`Unable to save`),
      finally: (s) => s.setScalar("saving", sql.false),
    });
  }}
>
  Save
</Button>
```

## Common Props

Use the exported TypeScript props for the full `Button` contract. The props
agents usually need are:

- `variant`, `color`, and `size` for generation-time styling.
- `disabled` and `loading` for runtime SQL expression state.
- `href` for navigation links.
- `startIcon` / `endIcon` for Material icons, or decorators for custom nodes.
- `fullWidth` and `className` for layout.

`color`, `variant`, and `size` are generation-time strings only, not SQL
expressions. Use `Show` / `Switch` to choose different button variants at
runtime.

## Common Patterns

### Submit Button with Loading

```tsx
<Button loading={sql`waiting`} fullWidth size="lg" onClick={submitLogin}>
  Sign In
</Button>
```

### Delete Button

```tsx
<Button variant="soft" color="danger" startIcon="Delete" onClick={handleDelete}>
  Delete Record
</Button>
```

### Navigation Button

```tsx
<Button variant="plain" color="primary" startIcon="ArrowBack" href="/">
  Back to Home
</Button>
```

### Add Button

```tsx
<Button size="sm" startIcon="Add" href="/members/add">
  Add Member
</Button>
```

---

# ButtonGroup

`ButtonGroup` (from `components/button_group`) wraps a set of related
buttons so they share a default `variant`, `color`, and `size` and
render with consistent dividers/spacing.

```tsx
import { ButtonGroup } from "components/button_group";
import { Button } from "components/button";

<ButtonGroup variant="outlined" color="primary">
  <Button>Day</Button>
  <Button>Week</Button>
  <Button>Month</Button>
</ButtonGroup>
```

Children inherit the group's defaults but can still override them
individually. Pass `orientation: "vertical"` for a stacked layout,
`spacing` to add gaps between buttons, or `buttonFlex` to make all
children share width equally.

`ButtonGroup` supports the same sizes as `Button`, including `xs`.

Use `ButtonGroup` for action toolbars, segmented filters, and
view-mode switchers. For a single-purpose icon toolbar, prefer a row
of plain `IconButton`s.

---

# IconButton

The IconButton component renders a compact button containing a single icon.

```tsx
import { IconButton } from "components/icon_button";
```

## Basic Usage

```tsx
<IconButton icon="Close" variant="plain" color="neutral" />

<IconButton icon="Home" href="/" variant="plain" color="neutral" />
```

You can use either the `icon` prop (pass the icon name as a string) or provide a child node, but not both.

```tsx
import { MaterialIcon } from "components/material_icon";

// Using icon prop (preferred)
<IconButton icon="Delete" variant="soft" color="danger" />

// Using children
<IconButton variant="plain" color="neutral">
  <MaterialIcon icon="Settings" />
</IconButton>
```

## Tooltip

IconButton supports a built-in `tooltip` prop for hover tooltips.

```tsx
<IconButton
  icon="ContentCopy"
  variant="plain"
  color="neutral"
  tooltip="Copy to clipboard"
  tooltipProps={{ placement: "top" }}
/>
```

## Common Props

Use the exported TypeScript props for the full `IconButton` contract. Prefer
`icon` with a Material icon name, add `tooltip` for unlabeled controls, and use
`aria-label` when the visible icon is the only accessible text. Use either
`icon` or custom `children`, not both.

---

# MaterialIcon

The MaterialIcon component renders a single Material Design icon as an SVG. Use
it for custom decorators, `IconButton` children, or any icon outside a button.
For buttons, prefer the `startIcon` / `endIcon` / `icon` string props, which
wrap `MaterialIcon` for you.

```tsx
import { MaterialIcon } from "components/material_icon";

<MaterialIcon icon="Save" />
<MaterialIcon icon="Warning" color="warning" fontSize="xl" />
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `icon` | `IconName` | Yes | Name of the Material icon to render. |
| `color` | palette name, `"harmonize"`, or `"inherit"` | No | Icon color. Defaults to `"inherit"` (current text color). |
| `fontSize` | font-size token (`xs`–`9xl`) or `"inherit"` | No | Icon size from the theme font-size scale. Defaults to `"inherit"`. |
| `title` | `Sql` | No | Accessible title; when set the icon is exposed to assistive tech, otherwise it is hidden. |

## Common Mistakes

```tsx
// Cannot use SQL for color or variant
<Button color={sql`case when active then 'success' else 'neutral' end`}>Wrong</Button>

// Use Show/Switch for dynamic styling instead
<Show when={sql`active`}>
  <Button color="success">Active</Button>
</Show>
<Show when={sql`not active`}>
  <Button color="neutral">Inactive</Button>
</Show>

// Cannot have both icon and children on IconButton
<IconButton icon="Close"><MaterialIcon icon="Close" /></IconButton>

// Cannot have both startIcon and startDecorator on Button
<Button startIcon="Add" startDecorator={<span>+</span>}>Wrong</Button>
```

## Example Combinations

```tsx
// Navigation with icon
<Button variant="plain" color="primary" startIcon="ArrowBack" href="/">
  Back to Home
</Button>

// Add record button
<Button size="sm" startIcon="Add" href="/orders/manual-entry">
  Manual Entry
</Button>

// Soft action button
<Button variant="soft" color="primary" size="sm" startIcon="Add">
  Add Case
</Button>

// Report link cards
<Button variant="soft" href="/reports/tat" startIcon="Speed">
  TAT Report
</Button>

// Dialog actions
<Button variant="outlined" onClick={onClose}>
  Cancel
</Button>
<Button variant="solid" color="primary" onClick={onConfirm}>
  Confirm
</Button>

// Icon button navigation
<IconButton icon="Home" href="/" variant="plain" color="neutral" />
```
