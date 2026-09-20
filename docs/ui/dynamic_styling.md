---
title: Dynamic Styling
description: How to apply dynamic CSS classes and sx styles based on runtime conditions in Yolm applications.
tags:
  - ui
  - styling
  - css
  - dynamic
---

# Dynamic Styling

Apply dynamic styles and classes based on runtime data.

## Dynamic Classes

### className vs dynamicClass

**Important:** The `className` prop does NOT support SQL expressions. It expects static strings only (generation-time values). Attempting to use SQL in className will cause CSS minification errors.

```tsx
// ❌ WRONG - SQL in className causes minification errors
<div className={sql`'base-class ' || case when active then 'active' else '' end`}>

// ✅ CORRECT - Use static className + dynamicClass
<div 
  className="base-class"
  dynamicClass={{ classes: "active", condition: sql`active` }}
>
```

### dynamicClass

Add classes conditionally based on SQL expressions:

```tsx
<Button
  dynamicClass={{
    classes: "active",
    condition: sql`is_selected`
  }}
>
  Click Me
</Button>

// When is_selected is true, renders: <button class="active">
// When is_selected is false, renders: <button>
```

### Multiple Dynamic Classes

```tsx
<div
  className="base-class"
  dynamicClasses={[
    { classes: "active", condition: sql`is_active` },
    { classes: "highlighted", condition: sql`is_highlighted` },
    { classes: "disabled", condition: sql`is_disabled` }
  ]}
>
  Content
</div>

// Can render as: <div class="base-class active highlighted">
```

### Animation Classes

Trigger animations with dynamic classes:

```tsx
function AnimatedButton() {
  const app = useApp();
  const pulse = app.registerKeyframes({
    "0%": { transform: "scale(1)" },
    "25%": { transform: "scale(1.1)" },
    "50%": { transform: "scale(1.1)" },
  });

  return (
    <Button
      sx={{
        "&.show-animation": {
          animation: `${pulse} 1s ease-in-out`,
        },
      }}
      dynamicClass={{
        classes: "show-animation",
        condition: sql`has_unsaved_changes`
      }}
    >
      Save Changes
    </Button>
  );
}
```

## Dynamic sx Styles

### Conditional Styles with SQL

```tsx
<Typography
  sx={{
    color: sql`case
      when status = 'completed' then 'success-600'
      when status = 'pending' then 'warning-600'
      else 'neutral-600'
    end`,
    fontWeight: sql`case when is_important then 'bold' else 'normal' end`
  }}
>
  {sql`message`}
</Typography>
```

### Color Variants

```tsx
<Switch>
  <Match when={sql`score >= 90`}>
    <Chip color="success">Score: {sql`score`}</Chip>
  </Match>
  <Match when={sql`score >= 70`}>
    <Chip color="primary">Score: {sql`score`}</Chip>
  </Match>
  <Match when={sql`score >= 50`}>
    <Chip color="warning">Score: {sql`score`}</Chip>
  </Match>
  <Match when={sql.true}>
    <Chip color="danger">Score: {sql`score`}</Chip>
  </Match>
</Switch>
```

**Important:** For component props like `color` and `variant`, you CANNOT use `sql` expressions in most cases. These typically expect static string values. Use conditional rendering or dynamic classes instead.

## Correct vs Incorrect Patterns

### ❌ WRONG - SQL in variant/color props

```tsx
{/* This will likely cause errors */}
<IconButton
  variant={sql`case when active then 'solid' else 'plain' end`}
  color={sql`case when success then 'success' else 'warning' end`}
/>
```

### ✅ CORRECT - Use Show for simple cases

```tsx
<Show when={sql`is_success`}>
  <Alert color="success" startIcon="CheckCircle">
    {sql`message`}
  </Alert>
</Show>
<Show when={sql`not is_success`}>
  <Alert color="danger" startIcon="Error">
    {sql`message`}
  </Alert>
</Show>
```

## Dynamic Styles in sx

The `sx` prop supports runtime expressions:

```tsx
<Card
  sx={{
    backgroundColor: sql`case
      when theme = 'dark' then '#1a1a1a'
      else '#ffffff'
    end`,
    borderColor: sql`case
      when is_highlighted then 'primary-600'
      else 'neutral.outlinedBorder'
    end`,
    opacity: sql`case when is_loading then 0.5 else 1 end`,
  }}
>
  Content
</Card>
```

## Computed Styles

```tsx
<div
  className="progress-bar"
  sx={{
    width: sql`cast(progress as string) || '%'`,
    backgroundColor: sql`case
      when progress = 100 then 'success-600'
      when progress >= 50 then 'primary-600'
      else 'warning-600'
    end`
  }}
/>
```

## State-Based Styling

```tsx
function StatusIndicator() {
  return (
  <Data procedure={(s) => {
    s.defScalar("status", sql`(select status from db.orders where id = order_id)`);
  }}>
    <Switch>
      <Match when={sql`status = 'completed'`}>
        <Sheet variant="soft" color="success" sx={{ borderLeft: "4px solid var(--variant-success-plainColor)" }}>
          <Typography>{sql`status`}</Typography>
        </Sheet>
      </Match>
      <Match when={sql`status = 'processing'`}>
        <Sheet variant="soft" color="primary" sx={{ borderLeft: "4px solid var(--variant-primary-plainColor)" }}>
          <Typography>{sql`status`}</Typography>
        </Sheet>
      </Match>
      <Match when={sql`status = 'pending'`}>
        <Sheet variant="soft" color="warning" sx={{ borderLeft: "4px solid var(--variant-warning-plainColor)" }}>
          <Typography>{sql`status`}</Typography>
        </Sheet>
      </Match>
      <Match when={sql.true}>
        <Sheet variant="soft" color="neutral" sx={{ borderLeft: "4px solid var(--variant-neutral-plainColor)" }}>
          <Typography>{sql`status`}</Typography>
        </Sheet>
      </Match>
    </Switch>
  </Data>
  );
}
```

## Complete Example

```tsx
function DynamicStyledCard() {
  return (
  <Data procedure={(s) => {
    s.defScalar("priority", sql`(select priority from db.tasks where id = task_id)`);
    s.defScalar("is_overdue", sql`(select due_date < current_date from db.tasks where id = task_id)`);
    s.defScalar("completion", sql`(select completion_percentage from db.tasks where id = task_id)`);
  }}>
    <Card
      className="task-card"
      dynamicClasses={[
        { classes: "overdue", condition: sql`is_overdue` },
        { classes: "high-priority", condition: sql`priority = 'high'` }
      ]}
      sx={{
        borderLeftWidth: 4,
        borderLeftStyle: "solid",
        borderLeftColor: sql`case
          when priority = 'high' then 'danger-600'
          when priority = 'medium' then 'warning-600'
          else 'neutral.outlinedBorder'
        end`,
        backgroundColor: sql`case
          when is_overdue then 'danger.softBg'
          else 'background.surface'
        end`,
        "&.overdue": {
          animation: "pulse 2s infinite"
        }
      }}
    >
      <Typography level="title-md">{sql`task_name`}</Typography>

      <div
        className="progress-bar"
        sx={{
          width: "100%",
          height: 8,
          backgroundColor: "neutral.outlinedBorder",
          borderRadius: 4,
          overflow: "hidden"
        }}
      >
        <div
          sx={{
            width: sql`cast(completion as string) || '%'`,
            height: "100%",
            backgroundColor: sql`case
              when completion = 100 then 'success-600'
              when completion >= 75 then 'primary-600'
              when completion >= 50 then 'warning-600'
              else 'neutral-600'
            end`,
            transition: "width 0.3s ease-in-out"
          }}
        />
      </div>

      <Typography level="body-sm">
        {sql`cast(completion as string) || '% complete'`}
      </Typography>
    </Card>
  </Data>
  );
}
```

## Best Practices

1. **Static vs Dynamic**
   - Use static classes for base styles
   - Use dynamic classes for state changes
   - Use sx for computed values

2. **Performance**
   - Minimize SQL expressions in frequently updated components
   - Use CSS classes over inline styles when possible
   - Cache computed values in state when expensive

3. **Maintainability**
   - Keep styling logic readable
   - Document complex conditional styles
   - Reuse common patterns in functions

4. **Component Props**
   - Most component `variant` and `color` props expect static strings
   - Use `<Switch>` or `<Show>` to conditionally render different variants
   - Use `sx` for truly dynamic style values

5. **Animations**
   - Define keyframes once with `app.registerKeyframes()`
   - Apply animation classes conditionally
   - Use CSS transitions for simple state changes
