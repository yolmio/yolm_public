---
title: Slider
description: Range slider for selecting a numeric value bound to a scalar via bindScalar, with configurable min, max, step, and size.
tags:
  - ui
  - components
  - slider
  - form
related:
  - ui/overview.md
  - ui/styling.md
  - ui/data.md
  - ui/form.md
  - ui/select.md
---

# Slider

`Slider` renders a horizontal track for picking a number in a bounded range
(volume, percentage, score). For free-form numbers use [`Input`](./input.md).

```tsx
import { Slider } from "components/slider";

// In a Data procedure: s.defScalar("volume", 5);
<Slider bindScalar="volume" min={0} max={11} step={1} showValueLabel />
```

## Value Binding

Exactly one of `bindScalar` or `value` is required:

- `bindScalar` names a numeric scalar (which you must define). It is the only
  interactive mode: mouse-down and drag compute the value from the cursor,
  clamp it to `min`/`max`, round to `step`, and call `s.setScalar`. The value
  shown is `coalesce(scalar, defaultValue)`.
- `value` is a SQL numeric expression rendered as a static, non-draggable fill
  (e.g. ``value={sql`record.progress`}``).

Passing both throws `Cannot specify both value and bindScalar`. Passing neither
throws `When using defaultValue, bindScalar must be provided` (because
`defaultValue` defaults to `0`).

## Non-Obvious Props

- SQL-capable: `value`, `min` (default `0`), `max` (default `100`), `step`
  (default `1`), `disabled` (blocks dragging).
- `step` rounding applies only when `step` is a literal number greater than 0;
  a SQL `step` is not applied.
- `defaultValue` (number) is the fallback when the bound scalar is null.
- Generation-time: `size` (`xs`-`lg`, default `md`), `color`,
  `showValueLabel`, `valueLabelFormat`.
- `color` supports `primary` (default), `neutral`, `danger`, `success`,
  `warning`. Anything else, including `harmonize`, falls back to `primary`.
- ``valueLabelFormat={(v) => sql`${v} || '%'`}`` formats the bubble shown
  with `showValueLabel`.
- `startAdornment` / `endAdornment` render small `Typography` labels beside
  the track (e.g. `"16°"` / `"30°"`).

See the `Slider` props in `components/slider` for the full contract.

## Common Mistakes

- Expecting a `value`-bound slider to be draggable; use `bindScalar`.
- Binding to a scalar that was never defined with `s.defScalar`.
- Setting `variant`: it is accepted (shared `ComponentOpts`) but has no visual
  effect; only `size` and `color` change appearance.
- Expecting touch or keyboard input. Dragging is wired to mouse events only
  (`onMouseDown`/`onMouseMove`), and the underlying input is hidden.
