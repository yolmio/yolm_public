---
title: Chip
description: Chip component for displaying compact labels, statuses, tags, and interactive elements.
tags:
  - ui
  - components
  - chip
---

# Chip

The Chip component displays compact elements such as status badges, tags, filters, and labels. It supports multiple variants, colors, sizes, icons, and conditional styling based on runtime SQL expressions.

```tsx
import { Chip, ChipDelete } from "components/chip";
```

## Basic Usage

```tsx
<Chip>Default Chip</Chip>

<Chip variant="soft" color="success">Active</Chip>

<Chip variant="outlined" color="primary" size="sm">Tag</Chip>
```

## Variants

The `variant` prop controls the visual style of the chip.

| Variant | Description |
|---------|-------------|
| `solid` | Filled background with contrasting text (default) |
| `soft` | Subtle background with darker text |
| `outlined` | Transparent background with colored border |
| `plain` | No background, just text color |

```tsx
<Chip variant="solid" color="primary">Solid</Chip>
<Chip variant="soft" color="success">Soft</Chip>
<Chip variant="outlined" color="danger">Outlined</Chip>
<Chip variant="plain" color="warning">Plain</Chip>
```

## Sizes

The `size` prop controls the chip dimensions and font size.

| Size | Min Height | Font Size |
|------|-----------|-----------|
| `xs` | 1.25rem | xs |
| `sm` | 1.5rem | xs |
| `md` | 2rem (default) | sm |
| `lg` | 2.5rem | base |

```tsx
<Chip size="xs">Extra Small</Chip>
<Chip size="sm">Small</Chip>
<Chip size="md">Medium</Chip>
<Chip size="lg">Large</Chip>
```

## Icons and Decorators

### startIcon / endIcon

Use `startIcon` and `endIcon` for Material Design icons by name.

```tsx
<Chip startIcon="Check" variant="soft" color="success">Approved</Chip>
<Chip endIcon="ArrowForward" variant="outlined" color="primary">Next</Chip>
```

### startDecorator / endDecorator

Use `startDecorator` and `endDecorator` for custom content (styled icons, badges, other components).

```tsx
import { MaterialIcon } from "components/material_icon";

<Chip
  variant="soft"
  startDecorator={<MaterialIcon icon="ShieldOutlined" />}
>
  Admin
</Chip>
```

**Note:** You cannot use both `startIcon` and `startDecorator` (or `endIcon` and `endDecorator`) at the same time. Choose one approach per side.

## Dynamic Content with SQL

Chip children can contain SQL expressions for runtime content:

```tsx
<Chip variant="soft" color="primary" size="sm">
  {sql`order.status`}
</Chip>

<Chip size="sm" variant="solid" color="warning">
  {sql`case when super_rush then 'SR' else 'R' end`}
</Chip>
```

## Conditional Variants

The `conditionalVariants` prop allows the chip's variant and color to change at runtime based on SQL conditions. This is the recommended pattern for dynamic status badges.

Each entry specifies a `when` condition (a SQL boolean expression) and optional `variant` and `color` overrides. If `variant` or `color` is omitted, it falls back to the chip's base value.

```tsx
<Chip
  size="sm"
  variant="soft"
  color="neutral"
  conditionalVariants={[
    { when: sql`${status} = 'active'`, variant: "soft", color: "success" },
    { when: sql`${status} = 'pending'`, variant: "soft", color: "warning" },
    { when: sql`${status} = 'inactive'`, variant: "soft", color: "neutral" },
  ]}
>
  {status}
</Chip>
```

The base `variant` and `color` serve as the default when no conditional variant matches.

## ChipDelete

The `ChipDelete` component renders a small delete button (X icon) meant to be placed inside a Chip's `endDecorator`. It supports its own `variant`, `color`, `conditionalVariants`, and `onClick`.

```tsx
import { Chip, ChipDelete } from "components/chip";

<Chip
  variant="soft"
  startDecorator={<MaterialIcon icon="ShieldOutlined" />}
  endDecorator={
    <ChipDelete
      onClick={(s) => {
        // Remove logic
      }}
    />
  }
>
  Admin Role
</Chip>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"solid" \| "soft" \| "outlined" \| "plain"` | `"solid"` | Visual style variant |
| `color` | `"primary" \| "neutral" \| "danger" \| "success" \| "warning" \| "harmonize"` | `"primary"` | Theme color |
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | `"md"` | Chip size |
| `clickable` | `boolean` | `false` | Makes the chip clickable with hover/active styles |
| `startIcon` | `IconName` | - | Material icon before the label |
| `endIcon` | `IconName` | - | Material icon after the label |
| `startDecorator` | `Node` | - | Custom content before the label |
| `endDecorator` | `Node` | - | Custom content after the label |
| `conditionalVariants` | `Array<{ when, variant?, color? }>` | - | Runtime variant/color switching based on SQL conditions |
| `className` | `string` | - | Static class string (Tailwind utilities); no SQL expressions |
| `sx` | `Style` | - | Style object (theme tokens, selectors, responsive keys) |
| `children` | `Node` | - | Label content |

**Important**: `color` and `variant` are generation-time strings only, not SQL expressions. Use `conditionalVariants` for runtime color/variant changes.

## Status Badge Pattern

The most common use of Chip is as a status badge. Wrap it in a reusable function component:

```tsx
import { Chip } from "components/chip";
import { sql } from "std/sql_utils";

export function InvoiceStatusChip(
  { status }: { status: ReturnType<typeof sql> },
) {
  return (
    <Chip
      size="sm"
      variant="soft"
      color="neutral"
      conditionalVariants={[
        { when: sql`${status} = 'draft'`, variant: "soft", color: "neutral" },
        { when: sql`${status} = 'sent'`, variant: "soft", color: "primary" },
        { when: sql`${status} = 'paid'`, variant: "solid", color: "success" },
        { when: sql`${status} = 'void'`, variant: "soft", color: "danger" },
      ]}
    >
      {status}
    </Chip>
  );
}
```

Use it in tables, cards, or anywhere status needs to be displayed:

```tsx
<Each table="invoices" recordName="inv">
  <InvoiceStatusChip status={sql`inv.status`} />
</Each>
```

## Real-World Examples

```tsx
// Simple tag inside a Select endDecorator
<Select
  endDecorator={
    <Chip size="sm" color="neutral">
      Add
    </Chip>
  }
/>

// Rush indicator with conditional escalation
<Chip
  size="sm"
  variant="solid"
  color="warning"
  conditionalVariants={[
    { when: sql`${superRush}`, variant: "solid", color: "danger" },
  ]}
>
  {sql`case when ${superRush} then 'SR' else 'R' end`}
</Chip>

// Removable role chip
<Chip
  variant="soft"
  startDecorator={<MaterialIcon icon="ShieldOutlined" />}
  endDecorator={
    <ChipDelete
      onClick={(s) => {
        // handle removal
      }}
    />
  }
>
  {sql`role.name`}
</Chip>
```

## Common Mistakes

```tsx
// ❌ WRONG - Cannot use SQL for color or variant props
<Chip color={sql`case when active then 'success' else 'danger' end`}>
  Status
</Chip>

// ✅ CORRECT - Use conditionalVariants for runtime styling
<Chip
  color="neutral"
  conditionalVariants={[
    { when: sql`active`, color: "success" },
    { when: sql`not active`, color: "danger" },
  ]}
>
  Status
</Chip>

// ❌ WRONG - Using both startIcon and startDecorator
<Chip startIcon="Check" startDecorator={<span>OK</span>}>Label</Chip>

// ✅ CORRECT - Choose one approach
<Chip startIcon="Check">Label</Chip>
```

## ChipButton

`ChipButton` is a separate component (own import) for a selectable/toggle chip. It renders as a `<label>` wrapping a hidden checkbox, so it tracks a checked state. Use it for filter toggles or multi-select chip groups; use `Chip` for static labels and status badges.

```tsx
import { ChipButton } from "components/chip_button";
```

### Usage

Bind the checked state to a UI scalar with `bindScalar` (two-way):

```tsx
<ChipButton label="Option 1" bindScalar="option1" color="primary" />
```

Or drive the checked state with a SQL boolean and handle toggling yourself:

```tsx
<ChipButton
  checked={sql`exists (select 1 from selections where id = category.id)`}
  label={sql`category.name`}
  variant="outlined"
  color="primary"
  size="sm"
  checkedVariation={{ color: "primary", variant: "soft" }}
  onCheckboxChange={(s) => {
    // toggle membership
  }}
/>
```

### ChipButton Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `Node` | - | Label content (used when no `children`) |
| `children` | `Node` | - | Label content; takes precedence over `label` |
| `checked` | `BooleanExpr` | - | SQL boolean for the checked/selected state |
| `bindScalar` | `string` | - | Name of a UI scalar to bind the checked state to (two-way) |
| `bindRecordField` | `string` | - | `record.field` (or `ui.record.field`) to bind the checked state to |
| `onCheckboxChange` | `(s) => void` | - | Statement handler called when toggled |
| `checkedVariation` | `{ variant?, color? }` | `{ variant: "outlined", color: "primary" }` | Variant/color applied when checked |
| `overlay` | `boolean` | `false` | Show a hover/focus overlay effect |
| `variant` | `Variant` | `"outlined"` | Base visual style |
| `color` | `Color` | `"neutral"` | Base theme color |
| `size` | `Size` | `"sm"` | Chip size |
| `sx` | `Style` | - | Style object |
| `className` | `string` | - | Static class string |

`bindScalar`, `bindRecordField`, and `onCheckboxChange` are mutually exclusive - supplying more than one throws at generation time. `bindRecordField` must contain at least a `record.field` pair.
