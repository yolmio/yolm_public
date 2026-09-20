---
title: Input
description: Input component usage for text entry, SQL-bound values, decorators, events, validation display, and form fields.
tags:
  - ui
  - components
  - input
  - form
---

# Input

The Input component renders a styled text input with support for decorators, icons, error states, and two-way binding to UI scalars or record fields.

```tsx
import { Input } from "components/input";
```

## Basic Usage

```tsx
<Input
  value={sql`input_text`}
  onInput={(s) => s.setScalar("input_text", sql`target_value`)}
  placeholder={sql.lit`Enter text...`}
/>
```

**Important:** `value` is a SQL expression evaluated at runtime. `placeholder`
and `type` may be plain strings or SQL expressions; use `sql` tagged templates
for dynamic values.

## Binding Shortcuts

Instead of manually wiring `value` and `onInput`, use `bindScalar` or `bindRecordField` for automatic two-way binding.

### bindScalar

Binds the input to a UI scalar. Automatically sets `value` to `ui.<scalar>` and generates an `onInput` handler that calls `setScalar`.

```tsx
<Data procedure={(s) => {
  s.defScalar("search_query", sql.lit``);
}}>

<Input bindScalar="search_query" placeholder={sql.lit`Search...`} />
```

### bindRecordField

Binds the input to a field on a record or table row. The field path must include the record name (e.g., `form.name` or `ui.form.name`).

```tsx
<Input bindRecordField="form.title" placeholder={sql.lit`Title`} />
```

**Note:** You cannot combine `bindScalar`, `bindRecordField`, `value`, or `onInput` with each other. Use exactly one binding approach.

## Common Props

Use the exported TypeScript props for the full `Input` contract. The solution
patterns agents usually need are:

- Choose exactly one binding mode: `bindScalar`, `bindRecordField`, or
  `value` + `onInput`.
- `placeholder`, `value`, `type`, `error`, `disabled`, and `autoFocus` may be
  SQL expressions when runtime state controls them.
- `variant`, `color`, `size`, `className`, `startIcon`, and `endIcon` are
  generation-time values. Use `<Show>` / `<Switch>` if runtime state needs a
  different variant or color.
- `size` supports `"xs"`, `"sm"`, `"md"`, and `"lg"`.
- Use `startDecorator` / `endDecorator` for custom TSX content such as buttons
  or spinners.

## Icons and Decorators

### startIcon / endIcon

Shorthand for placing a Material Design icon inside the input. Pass the icon name as a string.

```tsx
<Input startIcon="Search" placeholder={sql.lit`Search...`} bindScalar="search_query" />
<Input endIcon="Visibility" value={sql`password_field`} type="password" />
```

### startDecorator / endDecorator

For custom content (styled icons, spinners, buttons) use decorator props. These accept any TSX node.

```tsx
<Input
  value={sql`editing_text`}
  endDecorator={
    <Show when={sql`saving_edit`}>
      <CircularProgress size="sm" />
    </Show>
  }
/>
```

**Note:** You cannot use both `startIcon` and `startDecorator` (or `endIcon` and `endDecorator`) at the same time.

## Event Handling

### onInput

Fires on every keystroke. Use `target_value` to access the current input value.

```tsx
<Input
  value={sql`input_text`}
  onInput={(s) => s.setScalar("input_text", sql`target_value`)}
/>
```

The second argument `newValue` is also available as a convenience:

```tsx
<Input
  value={sql`input_text`}
  onInput={(s, newValue) => {
    s.setScalar("input_text", newValue);
  }}
/>
```

### onKeyDown

Respond to specific key presses using `event.key`:

```tsx
<Input
  value={sql`input_text`}
  onKeyDown={(s) => {
    s.if(sql`event.key = 'Enter'`, (s) => {
      // Submit logic
    });
    s.if(sql`event.key = 'Escape'`, (s) => {
      s.setScalar("input_text", sql.lit``);
    });
  }}
/>
```

## Error State

Pass a SQL boolean expression to `error` to show danger-colored styling:

```tsx
<Input
  bindScalar="email"
  error={sql`length(email) > 0 and position('@' in email) = 0`}
  placeholder={sql.lit`Email address`}
/>
```

## With FormControl

Wrap Input in a `FormControl` with `FormLabel` for accessible labeled inputs. The `id` is automatically linked between the label and input.

```tsx
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";

<FormControl fullWidth sx={{ mb: 2 }}>
  <FormLabel htmlFor="email">Email</FormLabel>
  <Input
    bindScalar="login_email"
    type="email"
    placeholder="john@example.com"
    id="email"
    fullWidth
  />
</FormControl>
```

## Common Patterns

### Search Input

```tsx
<Data procedure={(s) => {
  s.defScalar("search_query", sql.lit``);
}}>

<Input
  placeholder={sql.lit`Search`}
  bindScalar="search_query"
  startIcon="Search"
  className="md:w-[30%]"
/>
```

### Controlled Input with Server Submit

```tsx
<Data procedure={(s) => {
  s.defScalar("input_text", sql.lit``);
}}>

<Input
  value={sql`input_text`}
  onInput={(s) => s.setScalar("input_text", sql`target_value`)}
  onKeyDown={(s) => {
    s.if(sql`event.key = 'Enter'`, (s) => {
      s.tryServer({
        body: (s) => {
          s.startTransaction();
          s.modify(sql`insert into db.todos (title) values (ui.input_text)`);
          s.commitTransaction();
          s.increment("ui.refresh_key");
        },
        catch: (s) => s.setScalar("error", sql.lit`Failed to save`),
      });
    });
  }}
/>
```

### Color Picker

The Input component supports `type="color"` with special styling for the native color picker:

```tsx
<Input type="color" value={sql`selected_color`} size="sm" />
```

## Common Mistakes

```tsx
// ❌ WRONG - Using a JS string for value
<Input value="hello" />

// ✅ CORRECT - Use SQL expressions
<Input value={sql`my_scalar`} />
<Input value={sql.lit`hello`} />

// ❌ WRONG - Combining bindScalar with value or onInput
<Input bindScalar="name" value={sql`name`} />
<Input bindScalar="name" onInput={(s) => s.setScalar("name", sql`target_value`)} />

// ✅ CORRECT - Use one approach
<Input bindScalar="name" />

// ❌ WRONG - Using SQL for color or variant
<Input color={sql`'primary'`} variant={sql`'outlined'`} />

// ✅ CORRECT - Static strings only
<Input color="primary" variant="outlined" />
```
