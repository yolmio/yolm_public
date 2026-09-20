---
title: Textarea
description: Multi-line text input component with styling variants, data binding, and decorator support.
tags:
  - ui
  - components
  - textarea
  - input
  - form
---

# Textarea

The Textarea component renders a multi-line text input with consistent styling, optional decorators, and convenient data binding.

```tsx
import { Textarea } from "components/textarea";
```

## Basic Usage

```tsx
<Textarea
  value={sql`notes`}
  onInput={(s) => s.setScalar("notes", sql`target_value`)}
  placeholder="Enter notes..."
/>
```

## Data Binding

### bindScalar

Automatically binds the textarea value to a UI scalar and generates the `onInput` handler. You cannot use `value`, `onInput`, or `bindRecordField` together with `bindScalar`.

```tsx
<Data procedure={(s) => {
  s.defScalar("description", sql.lit``);
}}>

<Textarea bindScalar="description" placeholder="Enter description..." />
```

This is equivalent to:

```tsx
<Textarea
  value={sql`ui.description`}
  onInput={(s) => s.setScalar("description", sql`target_value`)}
  placeholder="Enter description..."
/>
```

### bindRecordField

Binds to a field on a record or table row. The field path must include at least a record name and field name (e.g., `record.field` or `ui.record.field`). You cannot use `value`, `onInput`, or `bindScalar` together with `bindRecordField`.

```tsx
<Textarea bindRecordField="edit_form.notes" placeholder="Notes..." />
```

### Manual value + onInput

For full control, set `value` and `onInput` directly:

```tsx
<Textarea
  value={sql`on_editing_note_text`}
  onInput={(s) => s.setScalar("on_editing_note_text", sql`target_value`)}
  placeholder="Edit note..."
/>
```

## Sizing

### size

Controls the overall size of the textarea (padding, font size, min-height).

| Size | Description |
|------|-------------|
| `"xs"` | Extra compact, smallest font and padding |
| `"sm"` | Compact, smaller font and padding |
| `"md"` | Default size |
| `"lg"` | Larger padding and font |

```tsx
<Textarea size="xs" bindScalar="comment" />
<Textarea size="sm" bindScalar="comment" />
<Textarea size="md" bindScalar="comment" />
<Textarea size="lg" bindScalar="comment" />
```

### minRows

Sets the minimum height based on a number of text rows. This is a generation-time number.

```tsx
<Textarea bindScalar="note_text" minRows={4} placeholder="Note text..." />
```

### rows

Sets the visible row count via the HTML `rows` attribute. Accepts a `NumericExpr` (can be a SQL expression).

```tsx
<Textarea bindScalar="content" rows={sql`6`} />
```

## Variants and Colors

### variant

Controls the visual style of the textarea. **Generation-time string only, not a SQL expression.**

| Variant | Description |
|---------|-------------|
| `"outlined"` | Default. Border with surface background |
| `"plain"` | Minimal, surface background |
| `"soft"` | Subtle filled background |
| `"solid"` | Strong filled background |

```tsx
<Textarea variant="outlined" bindScalar="notes" />
<Textarea variant="soft" bindScalar="notes" />
```

### color

Sets the color palette. **Generation-time string only, not a SQL expression.**

Available colors: `"primary"`, `"neutral"`, `"danger"`, `"success"`, `"warning"`, `"harmonize"`

Default is `"neutral"`.

```tsx
<Textarea color="primary" variant="soft" bindScalar="notes" />
```

## Error State

The `error` prop accepts a `BooleanExpr` (SQL expression). When truthy, the textarea switches to danger styling.

```tsx
<Textarea
  bindScalar="email_body"
  error={sql`char_length(email_body) > 5000`}
  placeholder="Email body..."
/>
```

## Common Props

Use the exported TypeScript props for the full `Textarea` contract. The props
agents usually need are:

- `bindScalar` or `bindRecordField` for automatic state binding.
- `value` plus `onInput` for manual binding; use `target_value`.
- `placeholder`, `rows`, `minRows`, and `fullWidth` for input shape.
- `disabled`, `error`, and `autoFocus` for runtime SQL expression state.
- `startDecorator` / `endDecorator` for inline actions or counters.

`color`, `variant`, `size`, and `minRows` are generation-time values, not SQL
expressions.

## Decorators

Use `startDecorator` and `endDecorator` to add content above or below the textarea within the styled container.

```tsx
<Textarea
  bindScalar="message"
  minRows={3}
  endDecorator={
    <div className="flex justify-end">
      <Button size="sm" onClick={(s) => { /* send logic */ }}>
        Send
      </Button>
    </div>
  }
/>
```

## FormControl Integration

Wrap Textarea in a FormControl for labels and helper text:

```tsx
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { FormHelperText } from "components/form_helper_text";

<FormControl>
  <FormLabel>Description</FormLabel>
  <Textarea bindScalar="description" minRows={3} placeholder="Describe the item..." />
  <FormHelperText>Maximum 500 characters</FormHelperText>
</FormControl>
```

## Example Combinations

### Notes editor with binding

```tsx
<Textarea
  bindScalar="on_copy_note_text"
  minRows={4}
  placeholder="Note text..."
/>
```

### Manual value with inline editing

```tsx
<Textarea
  value={sql`on_editing_note_text`}
  onInput={(s) => s.setScalar("on_editing_note_text", sql`target_value`)}
  placeholder="Edit note..."
  minRows={2}
/>
```

### Chat input

```tsx
<Textarea
  placeholder="What are we building today?"
  bindScalar="chat_prompt"
  size="md"
/>
```

### Paste-friendly multiline input

```tsx
<Textarea
  bindScalar="spreadsheet_data"
  placeholder={`Example:
10\tActivity Name 1\tOrg Name 1\tMember Name 1
20\tActivity Name 2\tOrg Name 2\tMember Name 2`}
  minRows={6}
/>
```

## Common Mistakes

```tsx
// ❌ WRONG - Cannot use SQL for color or variant
<Textarea color={sql`'primary'`} variant={sql`'soft'`} />

// ✅ CORRECT - Use static strings
<Textarea color="primary" variant="soft" />

// ❌ WRONG - Cannot combine bindScalar with value or onInput
<Textarea bindScalar="notes" value={sql`notes`} />

// ✅ CORRECT - Use one approach or the other
<Textarea bindScalar="notes" />

// ❌ WRONG - bindRecordField needs record.field format
<Textarea bindRecordField="notes" />

// ✅ CORRECT - Include record name
<Textarea bindRecordField="edit_form.notes" />
```
