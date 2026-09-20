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

Progress indicator components display loading states, progress through tasks, and step-by-step workflows. Use them to inform users about ongoing operations and what stage of a process they're in.

## CircularProgress

A circular progress indicator for showing loading states or determinate progress.

```tsx
import { CircularProgress } from "components/circular_progress";
```

### Basic Usage

```tsx
// Indeterminate (spinning) loading indicator
<CircularProgress />

// Determinate progress with value (0-100)
<CircularProgress determinate value={sql`upload_progress`} />
```

### Variants

The `variant` prop controls the visual style.

| Variant | Description |
|---------|-------------|
| `"solid"` | Filled background with contrasting color |
| `"soft"` | Subtle background with darker color (default) |
| `"outlined"` | Transparent background with colored border |
| `"plain"` | Just the color, no background |

```tsx
<CircularProgress variant="solid" color="primary" />
<CircularProgress variant="soft" color="success" />
<CircularProgress variant="outlined" color="warning" />
<CircularProgress variant="plain" color="danger" />
```

### Colors

The `color` prop sets the semantic color.

| Color | Use Case |
|-------|----------|
| `"primary"` | General loading (default) |
| `"success"` | Success or completion state |
| `"danger"` | Error or failed state |
| `"warning"` | Caution or pending state |
| `"neutral"` | Neutral or muted loading |

```tsx
<CircularProgress color="primary" />
<CircularProgress color="success" />
<CircularProgress color="danger" />
<CircularProgress color="warning" />
```

### Sizes

The `size` prop controls the overall diameter.

| Size | Diameter |
|------|----------|
| `"xs"` | 16px |
| `"sm"` | 24px |
| `"md"` | 40px (default) |
| `"lg"` | 64px |

```tsx
<CircularProgress size="xs" />
<CircularProgress size="sm" />
<CircularProgress size="md" />
<CircularProgress size="lg" />
```

### Determinate Progress

Show specific progress values from 0 to 100. `value` sets the accessibility
attribute (`aria-valuenow`); set the `--circular-progress-percent` CSS variable
as well to control the ring's visible fill (its default is `25`):

```tsx
<CircularProgress
  determinate
  value={sql`(upload_bytes_completed * 100) / upload_total_bytes`}
  sx={{ "--circular-progress-percent": sql`(upload_bytes_completed * 100) / upload_total_bytes` }}
  color="primary"
>
  {sql`round((upload_bytes_completed * 100) / upload_total_bytes)`}%
</CircularProgress>
```

### With Child Content

Display text or other content in the center:

```tsx
<CircularProgress size="lg" determinate value={sql`75`}>
  75%
</CircularProgress>

<CircularProgress size="md" color="success">
  <MaterialIcon icon="Check" />
</CircularProgress>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | `"md"` | Diameter of the indicator |
| `variant` | `"solid" \| "soft" \| "outlined" \| "plain"` | `"soft"` | Visual style |
| `color` | `"primary" \| "neutral" \| "danger" \| "success" \| "warning"` | `"primary"` | Theme color |
| `determinate` | `boolean` | `false` | Whether progress has a specific value |
| `value` | `NumericExpr` | - | Accessibility value (`aria-valuenow`); pair with `--circular-progress-percent` for the visible fill |
| `children` | `Node` | - | Content to display in the center |

## Skeleton

A placeholder component that displays while content is loading. Reduces perceived load time by providing visual structure.

```tsx
import { Skeleton } from "components/skeleton";
```

### Basic Usage

```tsx
// Rectangular placeholder (default)
<Skeleton />

// Circular placeholder (for avatars)
<Skeleton variant="circular" />

// Text placeholder
<Skeleton variant="text" level="body-md" />
```

### Variants

The `variant` prop determines the shape of the skeleton.

| Variant | Use Case |
|---------|----------|
| `"rectangular"` | Cards, images, containers (default) |
| `"circular"` | Avatars, profile pictures |
| `"text"` | Text placeholders with proper line height |

```tsx
<div style={{ width: "100%", height: "200px" }}>
  <Skeleton variant="rectangular" />
</div>

<div style={{ width: "40px", height: "40px" }}>
  <Skeleton variant="circular" />
</div>

<Skeleton variant="text" level="h3" />
```

### Animations

The `animation` prop controls the loading animation.

| Animation | Description |
|-----------|-------------|
| `"pulse"` | Fading pulse effect (default) |
| `"wave"` | Sweeping wave effect from left to right |

```tsx
<Skeleton animation="pulse" />
<Skeleton animation="wave" variant="rectangular" />
```

### Typography Levels

For text variants, use the `level` prop to match the typography size of the content being loaded:

```tsx
<Skeleton variant="text" level="h1" />
<Skeleton variant="text" level="title-lg" />
<Skeleton variant="text" level="body-md" />
<Skeleton variant="text" level="body-sm" />
```

### Stacking Skeletons

Create a skeleton layout matching your content structure:

```tsx
<div style={{ display: "flex", gap: "1rem" }}>
  <div style={{ width: "40px", height: "40px", flexShrink: 0 }}>
    <Skeleton variant="circular" />
  </div>
  <div style={{ flex: 1 }}>
    <Skeleton variant="text" level="title-md" />
    <Skeleton variant="text" level="body-md" />
  </div>
</div>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"rectangular" \| "circular" \| "text"` | `"rectangular"` | Shape of the skeleton |
| `animation` | `"pulse" \| "wave"` | `"pulse"` | Loading animation effect |
| `level` | `TypographyKeys \| "inherit"` | `"inherit"` | Typography level for text variants |
| `component` | `string` | `"div"` | HTML element to render as |
| `className` | `string` | - | Tailwind classes |
| `sx` | `StyleObject` | - | Style object |

## Stepper

A horizontal or vertical sequence of steps for multi-step workflows. Compose `Stepper` with `Step` children, and pass a `StepIndicator` as each step's `indicator`. Drive each step's active/completed/disabled state with SQL boolean expressions.

```tsx
import { Step, StepIndicator, Stepper } from "components/stepper";
```

### Usage

```tsx
<Stepper size="lg">
  <Step
    activeLineColor="primary"
    dotted
    active={sql`step >= 'file_select'`}
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
    active={sql`step >= 'mapping'`}
    indicator={
      <StepIndicator color="primary" variant="soft" activeVariant="solid">
        <MaterialIcon icon="Edit" />
      </StepIndicator>
    }
  >
    Select fields
  </Step>
</Stepper>
```

### Stepper Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `Node` | required | `Step` components |
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | `"md"` | Step sizing |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Layout direction |

### Step Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `Node` | required | Step label content |
| `active` | `BooleanExpr` | - | Marks the step active (adds the `active` class) |
| `completed` | `BooleanExpr` | - | Marks the step completed |
| `disabled` | `BooleanExpr` | - | Marks the step disabled |
| `indicator` | `Node` | - | Indicator content, typically a `StepIndicator` |
| `activeLineColor` | `Color` | - | Connector color when the step is active |
| `dotted` | `boolean` | `false` | Render the trailing connector as dots when active |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Step layout direction |

### StepIndicator Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `Node` | required | Indicator content (icon or number) |
| `color` | `Color` | `"neutral"` | Base color |
| `variant` | `Variant` | `"soft"` | Base variant |
| `activeColor` | `Color` | - | Color applied when the parent `Step` is active |
| `activeVariant` | `Variant` | - | Variant applied when the parent `Step` is active |

`StepButton` is also exported for rendering a step's content as a clickable `<button>`; use it when steps must be navigable.

## Loading Button Pattern

Combine `CircularProgress` with buttons to show loading states:

```tsx
<Button
  loading={sql`is_uploading`}
  onClick={(s) => {
    s.setScalar("is_uploading", sql.true);
    s.tryServer({
      body: (s) => {
        // upload logic
        s.increment("upload_progress");
      },
      finally: (s) => s.setScalar("is_uploading", sql.false),
    });
  }}
>
  Upload File
</Button>
```

The Button component automatically handles positioning the `CircularProgress` indicator.

## Real-World Examples

### File Upload with Progress

```tsx
<Show when={sql`file_uploading`}>
  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
    <CircularProgress
      determinate
      value={sql`upload_progress`}
      size="md"
    >
      {sql`upload_progress`}%
    </CircularProgress>
    <Typography level="body-sm">
      Uploading {sql`file_name`}...
    </Typography>
  </div>
</Show>
```

### Data Loading State

```tsx
<Show
  when={sql`records_loading`}
  fallback={
    <Each table="records" recordName="rec">
      <RecordRow record={sql`rec`} />
    </Each>
  }
>
  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
    <Skeleton variant="text" level="body-md" />
    <Skeleton variant="text" level="body-md" />
    <Skeleton variant="text" level="body-md" />
  </div>
</Show>
```

### Avatar with Skeleton

```tsx
<div style={{ width: "48px", height: "48px", borderRadius: "50%" }}>
  <Show
    when={sql`user_avatar_loading`}
    fallback={
      <img src={sql`user.avatar_url`} style={{ width: "100%", height: "100%", borderRadius: "50%" }} />
    }
  >
    <Skeleton variant="circular" />
  </Show>
</div>
```

### Multi-Step Form Progress

Use `Stepper` for step-by-step workflows:

```tsx
import { Step, Stepper } from "components/stepper";

<Stepper size="md">
  <Step active={sql`current_step >= 0`} completed={sql`current_step > 0`}>
    Profile
  </Step>
  <Step active={sql`current_step >= 1`} completed={sql`current_step > 1`}>
    Payment
  </Step>
  <Step active={sql`current_step >= 2`} completed={sql`current_step > 2`}>
    Confirmation
  </Step>
</Stepper>
```

## Common Patterns

### Conditional Loading Display

```tsx
<Show when={sql`loading`}>
  <CircularProgress size="sm" color="primary" />
</Show>
```

### Loading Overlay

```tsx
<Show when={sql`saving`}>
  <div style={{
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    zIndex: 1000,
  }}>
    <CircularProgress size="lg" />
  </div>
</Show>
```

### Skeleton Paragraph

```tsx
<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
  <Skeleton variant="text" level="title-md" />
  <Skeleton variant="text" level="body-md" />
  <Skeleton variant="text" level="body-md" />
  <Skeleton variant="text" level="body-sm" style={{ width: "80%" }} />
</div>
```

## Common Mistakes

```tsx
// ❌ WRONG - Cannot use SQL for variant or color
<CircularProgress variant={sql`determinate_mode ? 'solid' : 'outlined'`} />

// ✅ CORRECT - Use Show for conditional display
<Show when={sql`determinate_mode`}>
  <CircularProgress variant="solid" />
</Show>
<Show when={sql`not determinate_mode`}>
  <CircularProgress variant="outlined" />
</Show>

// ❌ WRONG - level is a generation-time string, not SQL
<Skeleton variant="text" level={sql`'body-md'`} />

// ✅ CORRECT - level is a generation-time string
<Skeleton variant="text" level="body-md" />
```
