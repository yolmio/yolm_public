---
title: Progress Indicators
description: Components for displaying loading states, progress, and step-by-step workflows.
tags:
  - ui
  - components
  - progress
  - loading
---

# Progress Indicators

`CircularProgress`, `Skeleton`, and `Stepper` cover loading states, determinate
progress, and multi-step workflows.

Often you do not need to render one yourself: non-`local` `Data` shows a small
`CircularProgress` as its default `pendingFallback`, and `Button` /
`ActionButton` / `Form.SubmitButton` render their own spinner via `loading`.
For dense dashboards and cards, pass a `Skeleton` layout as `pendingFallback`
instead ([Data](./data.md)).

## CircularProgress

```tsx
import { CircularProgress } from "components/circular_progress";

<CircularProgress />                                  {/* indeterminate spinner */}
<CircularProgress determinate value={sql`upload_pct`} /> {/* 0-100 */}
```

- `determinate` (static boolean) switches from the spinning animation to a
  fixed ring.
- `value` is a SQL numeric expression (0-100). When `determinate`, it drives
  both the visible fill (it sets the `--circular-progress-percent` inline
  style) and `aria-valuenow` (rounded). You do not need to set the CSS
  variable yourself.
- `children` render centered in the ring (text scales with the ring size),
  e.g. `{sql`round(upload_pct)`}%` or a `MaterialIcon`.
- `size`: `xs` 16px, `sm` 24px, `md` 40px (default), `lg` 64px. Override the
  diameter or stroke with the `--circular-progress-size` /
  `--circular-progress-thickness` CSS variables in static `sx`.
- `variant` (default `soft`) and `color` (default `primary`) follow the shared
  [styling props](./styling.md#color-variant-and-size).

## Skeleton

A placeholder that mimics content while it loads.

```tsx
import { Skeleton } from "components/skeleton";
```

- `variant`: `"rectangular"` (default) or `"circular"` fill their parent
  (width 100%; circular also height 100%), so size the parent element.
  `"text"` reserves a line matching the typography `level`.
- `level` (static, default `"inherit"`): a typography level such as
  `"title-md"` or `"body-sm"`.
- `animation`: `"pulse"` (default) or `"wave"`.

See `SkeletonBaseProps` in `components/skeleton` for the full contract.

## Stepper

Compose `Stepper` with `Step` children; pass a `StepIndicator` as each step's
`indicator`. `StepButton` renders a step's content as a clickable `<button>`
for navigable steps.

```tsx
import { Step, StepIndicator, Stepper } from "components/stepper";
```

- `Step` `active`, `completed`, and `disabled` are SQL boolean expressions;
  each toggles the matching CSS class (`active`, `completed`, `disabled`) at
  runtime.
- `activeLineColor` (static `Color`) colors the connector after an active
  step; `dotted` renders that connector as dots.
- `StepIndicator` takes base `color` (default `neutral`) / `variant` (default
  `soft`) plus `activeColor` / `activeVariant`, applied when the parent `Step`
  is active.
- `Stepper` takes `size` (default `md`) and `orientation`
  (`"horizontal"` default, or `"vertical"`; also set it on each `Step`).

See `StepperProps`, `StepProps`, and `StepIndicatorProps` in
`components/stepper` for the full contract.

## Example

An import wizard with a stepper, a determinate upload ring, and a skeleton
while the preview loads:

```tsx
<Stepper size="lg">
  <Step
    activeLineColor="primary"
    dotted
    active={sql`step >= 1`}
    completed={sql`step > 1`}
    indicator={
      <StepIndicator color="primary" variant="soft" activeVariant="solid">
        <MaterialIcon icon="FilePresent" />
      </StepIndicator>
    }
  >
    Select File
  </Step>
  <Step
    activeLineColor="primary"
    dotted
    active={sql`step >= 2`}
    indicator={
      <StepIndicator color="primary" variant="soft" activeVariant="solid">
        <MaterialIcon icon="Edit" />
      </StepIndicator>
    }
  >
    Map Fields
  </Step>
</Stepper>

<Show when={sql`file_uploading`}>
  <div className="flex items-center gap-4">
    <CircularProgress determinate value={sql`upload_pct`}>
      {sql`round(upload_pct)`}%
    </CircularProgress>
    <Typography level="body-sm">Uploading {sql`file_name`}...</Typography>
  </div>
</Show>

<Data
  procedure={(s) => { /* load preview rows */ }}
  pendingFallback={
    <div className="flex gap-4">
      <div className="w-10 h-10 shrink-0">
        <Skeleton variant="circular" />
      </div>
      <div className="flex-1">
        <Skeleton variant="text" level="title-md" />
        <Skeleton variant="text" level="body-md" />
      </div>
    </div>
  }
>
  {/* preview */}
</Data>
```
