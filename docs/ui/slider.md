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

The Slider component renders a horizontal track for selecting a numeric value
from a range. Use it for bounded numeric input (volume, percentage, score)
where a draggable control is clearer than a text field. For free-form numeric
entry, use `Input` instead.

```tsx
import { Slider } from "components/slider";
```

## Usage

The interactive slider binds to a numeric scalar with `bindScalar`. Define the
scalar first (for example in a page or `Data` setup), then drag the slider to
read and write it.

```tsx
// In a setup / Data procedure:
s.defScalar("xs_slider", 35);

// In the UI:
<Slider size="xs" bindScalar="xs_slider" />
```

Dragging updates the bound scalar directly. The component clamps the position
to the `min`/`max` range and rounds to the nearest `step` (only when `step` is
a number greater than 0).

## Value Binding

A Slider needs exactly one of `bindScalar` or `value`:

- **`bindScalar`** — the name of a numeric scalar. The slider reads from it and
  writes back on drag. This is the only mode that is interactive. Mouse-down
  and mouse-drag recompute the value from the cursor position and call
  `s.setScalar(bindScalar, ...)`.
- **`value`** — a SQL numeric expression. This renders a static fill at the
  given value but does **not** respond to dragging. Use it for read-only or
  externally-controlled display.

Passing both throws `Cannot specify both value and bindScalar`. Passing neither
also throws `When using defaultValue, bindScalar must be provided` — because
`defaultValue` defaults to `0`, the slider always falls into the path that
requires `bindScalar` when no `value` is given.

```tsx
// Interactive, read/write
<Slider bindScalar="volume" min={0} max={11} step={1} />

// Display only, driven by a query value
<Slider value={sql`record.progress`} min={0} max={100} />
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `bindScalar` | `string` | One of `bindScalar`/`value` | Name of a numeric scalar to read and write. Enables drag interaction. |
| `value` | `NumericExpr` | One of `bindScalar`/`value` | SQL numeric expression for display. Static (non-interactive). Mutually exclusive with `bindScalar`. |
| `min` | `number \| NumericExpr` | No | Minimum value. Default `0`. |
| `max` | `number \| NumericExpr` | No | Maximum value. Default `100`. |
| `step` | `number \| NumericExpr` | No | Increment to snap to on drag. Default `1`. Rounding is applied only when `step` is a number greater than 0. |
| `defaultValue` | `number` | No | Fallback used when the bound scalar is null (`coalesce(bindScalar, defaultValue)`). Default `0`. |
| `disabled` | `BooleanExpr` | No | SQL boolean disabling the slider. Default `false`. |
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | No | Track and thumb size. Default `"md"`. |
| `color` | `Color` | No | Fill and thumb color. Default `"primary"`. |
| `showValueLabel` | `boolean` | No | Shows a label bubble above the thumb. Default `false`. |
| `valueLabelFormat` | `(value: NumericExpr) => Node` | No | Formats the value-label content. Receives the current value expression. |
| `startAdornment` | `Node` | No | Content rendered before the track. |
| `endAdornment` | `Node` | No | Content rendered after the track. |
| `className` | `string` | No | Class applied to the root element. |

`size`, `color`, `showValueLabel`, and `valueLabelFormat` are generation-time
configuration. `value`, `min`, `max`, `step`, and `disabled` accept SQL
expressions.

### Color

`color` controls the fill and thumb color. Supported values are `primary`
(default), `neutral`, `danger`, `success`, and `warning`. Any other value
(including `harmonize`) falls back to `primary`.

```tsx
<Slider bindScalar="score" color="success" />
```

## Value Label

Set `showValueLabel` to display a bubble above the thumb. Use
`valueLabelFormat` to format it.

```tsx
<Slider
  bindScalar="completion"
  showValueLabel
  valueLabelFormat={(v) => sql`${v} || '%'`}
/>
```

## Adornments

`startAdornment` and `endAdornment` render small `Typography` labels on either
side of the track.

```tsx
<Slider
  bindScalar="temperature"
  min={16}
  max={30}
  startAdornment="16°"
  endAdornment="30°"
/>
```

## Common Mistakes

- Providing neither `bindScalar` nor `value`, or providing both — exactly one
  is required.
- Expecting `value` to be interactive. A `value`-bound slider is display-only;
  use `bindScalar` for a draggable control that writes back.
- Forgetting to define the scalar (`s.defScalar("name", 0)`) before binding to
  it with `bindScalar`.
- Relying on `variant`, `marks`, or `gradient`. These appear in the prop type
  but have no visual effect in the current implementation — only `size` and
  `color` affect appearance.
- Expecting touch drag. Dragging is wired to mouse events
  (`onMouseDown`/`onMouseMove`) only; there are no touch handlers.
