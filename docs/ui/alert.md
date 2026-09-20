---
title: Alert
description: Alert component for displaying contextual feedback messages with customizable colors, variants, sizes, and decorators.
tags:
  - ui
  - components
  - alert
  - feedback
---

# Alert

The Alert component displays feedback messages such as errors, warnings, success confirmations, and informational notices.

```tsx
import { Alert } from "components/alert";
```

## Basic Usage

```tsx
<Alert>This is a default alert.</Alert>
<Alert color="danger">Something went wrong.</Alert>
<Alert color="success">Operation completed successfully.</Alert>
<Alert color="warning">Please review before continuing.</Alert>
```

## Color

The `color` prop sets the semantic color of the alert.

| Color | Use Case |
|-------|----------|
| `"primary"` | General information (default) |
| `"neutral"` | Neutral/contextual messages |
| `"danger"` | Errors and critical issues |
| `"success"` | Success confirmations |
| `"warning"` | Warnings and cautions |

```tsx
<Alert color="primary">Informational message</Alert>
<Alert color="danger">Error message</Alert>
<Alert color="success">Success message</Alert>
<Alert color="warning">Warning message</Alert>
<Alert color="neutral">Neutral message</Alert>
```

## Variant

The `variant` prop controls the visual style. Default is `"soft"`.

| Variant | Description |
|---------|-------------|
| `"soft"` | Subtle background with colored text (default) |
| `"solid"` | Filled background with contrasting text |
| `"outlined"` | Transparent background with colored border |
| `"plain"` | No background, just text color |

```tsx
<Alert color="danger" variant="soft">Soft danger alert</Alert>
<Alert color="danger" variant="solid">Solid danger alert</Alert>
<Alert color="danger" variant="outlined">Outlined danger alert</Alert>
<Alert color="danger" variant="plain">Plain danger alert</Alert>
```

## Size

The `size` prop controls padding, gap, icon size, and font size. Default is `"md"`.

| Size | Font Size | Padding |
|------|-----------|---------|
| `"xs"` | `text-xs` | `0.375rem` |
| `"sm"` | `text-sm` | `0.5rem` |
| `"md"` | `text-sm` (medium weight) | `0.75rem` |
| `"lg"` | `text-base` (medium weight) | `1rem` |

```tsx
<Alert size="xs" color="danger">Extra-small alert</Alert>
<Alert size="sm" color="danger">Small alert</Alert>
<Alert size="md" color="danger">Medium alert</Alert>
<Alert size="lg" color="danger">Large alert</Alert>
```

## Icons and Decorators

### startIcon / endIcon

Use `startIcon` and `endIcon` for Material Design icons. Pass the icon name as a string.

```tsx
<Alert startIcon="Warning" color="danger">
  Something went wrong
</Alert>

<Alert startIcon="CheckCircle" color="success">
  Operation completed
</Alert>

<Alert startIcon="Info" color="primary">
  Here is some information
</Alert>

<Alert startIcon="Warning" endIcon="ArrowForward" color="warning">
  Action required
</Alert>
```

### startDecorator / endDecorator

Use `startDecorator` and `endDecorator` for custom content. These accept any TSX node.

```tsx
import { MaterialIcon } from "components/material_icon";

<Alert
  color="success"
  variant="soft"
  startDecorator={<MaterialIcon icon="CheckCircle" />}
>
  All periods are up to date.
</Alert>
```

**Note:** You cannot use both `startIcon` and `startDecorator` (or `endIcon` and `endDecorator`) at the same time. Choose one approach per side.

## Harmonize

When `harmonize` is `true`, child components (buttons, icon buttons) inside the alert automatically inherit matching color styles for the alert's variant and color. Harmonization only applies with the `soft` or `solid` variant; it has no effect on `outlined` or `plain`.

```tsx
<Alert color="warning" variant="soft" harmonize>
  <span>Session expiring soon.</span>
  <Button size="sm">Extend</Button>
</Alert>
```

## Conditional Display with Show

The most common pattern is to conditionally display alerts based on state using the `Show` component:

```tsx
import { Show } from "std/ui";

// Show error when present
<Show when={sql`error is not null`}>
  <Alert color="danger">{sql`error`}</Alert>
</Show>

// Show success message
<Show when={sql`save_success`}>
  <Alert startIcon="CheckCircle" color="success">
    Changes saved successfully.
  </Alert>
</Show>

// Show warning conditionally
<Show when={sql`unsaved_changes`}>
  <Alert color="warning" startIcon="Warning">
    You have unsaved changes.
  </Alert>
</Show>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `color` | `Color` | `"primary"` | Theme color: "primary", "neutral", "danger", "success", "warning" |
| `variant` | `Variant` | `"soft"` | Style variant: "plain", "outlined", "soft", "solid" |
| `size` | `Size` | `"md"` | Size: "xs", "sm", "md", "lg" |
| `startIcon` | `IconName` | - | Material icon before content |
| `endIcon` | `IconName` | - | Material icon after content |
| `startDecorator` | `Node` | - | Custom content before children |
| `endDecorator` | `Node` | - | Custom content after children |
| `harmonize` | `boolean` | `false` | Harmonize child component colors with alert |
| `children` | `Node` | - | Alert content |
| `className` | `string` | - | Tailwind classes |

**Important**: `color`, `variant`, and `size` are generation-time strings only, not SQL expressions.

## Real-World Examples

```tsx
// Error alert with dynamic message
<Show when={sql`error is not null`}>
  <Alert color="danger">{sql`error`}</Alert>
</Show>

// Validation error with icon
<Show when={sql`error is not null`}>
  <Alert startIcon="Warning" color="danger" size="sm">{sql`error`}</Alert>
</Show>

// Success feedback with icon
<Show when={sql`valid`}>
  <Alert startIcon="CheckCircle" color="success" size="sm">
    Member found
  </Alert>
</Show>

// Warning about unsaved changes
<Show when={sql`last_saved_state_hash != current_state_hash`}>
  <Alert color="warning" startIcon="Warning">
    You have unsaved changes.
  </Alert>
</Show>

// Neutral contextual information
<Alert color="neutral" variant="soft" className="mb-4">
  <Typography level="body-md">
    Are you still on <strong>{sql`last_service_name`}</strong>?
  </Typography>
</Alert>

// Connection failure
<Match when={sql`status = 'failed'`}>
  <Alert color="danger">
    Unable to connect to the service.
  </Alert>
</Match>

// All-clear success state
<Alert color="success" variant="soft">
  <MaterialIcon icon="CheckCircle" />
  All periods are up to date. No periods need closing.
</Alert>
```

## Common Mistakes

```tsx
// ❌ WRONG - Cannot use SQL for color or variant
<Alert color={sql`case when success then 'success' else 'danger' end`}>
  Message
</Alert>

// ✅ CORRECT - Use Show/Switch for dynamic color
<Show when={sql`success`}>
  <Alert color="success">Operation succeeded</Alert>
</Show>
<Show when={sql`not success`}>
  <Alert color="danger">Operation failed</Alert>
</Show>

// ❌ WRONG - Using both startIcon and startDecorator
<Alert startIcon="Warning" startDecorator={<CustomIcon />}>
  Message
</Alert>

// ✅ CORRECT - Use one or the other
<Alert startIcon="Warning">Message</Alert>
```
