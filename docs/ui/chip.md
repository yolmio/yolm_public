---
title: Chip
description: Chip component for displaying compact labels, statuses, tags, and interactive elements.
tags:
  - ui
  - components
  - chip
---

# Chip

`Chip` displays compact status badges, tags, and labels; `ChipDelete` is its
remove button and `ChipButton` is a toggleable chip.

```tsx
import { Chip, ChipDelete } from "components/chip";
```

## Basic Usage

```tsx
<Chip variant="soft" color="success" startIcon="Check">Approved</Chip>

<Chip variant="soft" color="primary" size="sm">{sql`order.status`}</Chip>
```

Children may be SQL expressions.

## Runtime Variant And Color

`variant`, `color`, and `size` follow the shared
[styling props](./styling.md#color-variant-and-size) and are static. Defaults:
`variant="solid"`, `color="primary"` (`harmonize` inside a harmonize context),
`size="md"`.

To change appearance at runtime, use `conditionalVariants`: each entry is
`{ when: BooleanExpr, variant?, color? }`. Each entry's styles are generated at
generation time and toggled by a runtime class when `when` is true; a missing
`variant`/`color` falls back to the base value, and the base applies when
nothing matches. Keep conditions mutually exclusive.

```tsx
<Chip
  size="sm"
  variant="soft"
  color="neutral"
  conditionalVariants={[
    { when: sql`inv.status = 'sent'`, color: "primary" },
    { when: sql`inv.status = 'paid'`, variant: "solid", color: "success" },
    { when: sql`inv.status = 'void'`, color: "danger" },
  ]}
>
  {sql`inv.status`}
</Chip>
```

When the label also depends on the condition, use
[`StatusChip`](./reusable_helpers.md#statuschip) (`components/status_chip`),
which builds the label and `conditionalVariants` from one list of cases.

## Other Props

- `startIcon` / `endIcon` (icon names) or `startDecorator` / `endDecorator`
  (any node). Using an icon and a decorator on the same side throws at
  generation time.
- `clickable` adds a full-chip `<button>` action slot with hover, active, and
  focus styles.

See `ChipBaseProps` in `components/chip` for the full contract.

## ChipDelete

A small "x" button for a chip's `endDecorator`. It takes `onClick`, `variant`
(default `solid`), `color` (default `primary`), and its own
`conditionalVariants` so it can follow the parent chip's runtime colors. It
ignores `size`.

```tsx
<Chip
  variant="soft"
  startDecorator={<MaterialIcon icon="ShieldOutlined" />}
  endDecorator={
    <ChipDelete onClick={(s) => s.setScalar("ui.removing_role", sql.true)} />
  }
>
  {sql`role.name`}
</Chip>
```

## ChipButton

`ChipButton` (`components/chip_button`) is a selectable chip for filter toggles
and multi-select chip groups. It renders a `<label>` wrapping a hidden
checkbox.

```tsx
import { ChipButton } from "components/chip_button";

<ChipButton label="Option 1" bindScalar="option1" color="primary" />

<ChipButton
  checked={sql`exists (select 1 from selections where id = category.id)`}
  label={sql`category.name`}
  checkedVariation={{ color: "primary", variant: "soft" }}
  onCheckboxChange={(s) => {
    // toggle membership using target_checked
  }}
/>
```

- Checked state comes from exactly one of `bindScalar` (sets the scalar to
  `target_checked`), `bindRecordField` (`record.field` or `ui.record.field`;
  runs `update <record> set <field> = target_checked`), or `checked` plus
  `onCheckboxChange`. Combining the binding props with each other or with
  `onCheckboxChange` throws at generation time.
- `children` take precedence over `label`.
- `checkedVariation` (`{ variant?, color? }`, default
  `{ color: "primary", variant: "outlined" }`) is applied when checked.
- `overlay` adds a hover/focus overlay.
- Defaults differ from `Chip`: `variant="outlined"`, `color="neutral"`,
  `size="sm"`.

See `ChipButtonProps` in `components/chip_button` for the full contract.

## Common Mistakes

- Using `Switch`/`Match` to render several `Chip`s for status colors when
  `conditionalVariants` (or `StatusChip`) does it with one chip.
- Overlapping `conditionalVariants` conditions; the resulting style depends on
  generated CSS order.
