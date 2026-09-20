---
title: FormControl
description: FormControl component for grouping form inputs with labels, helper text, and error state propagation.
tags:
  - ui
  - components
  - form
  - form-control
---

# FormControl

The FormControl component provides context and consistent styling for form fields. It groups an input with its label and helper text, and propagates error state to children.

```tsx
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { FormHelperText } from "components/form_helper_text";
```

## Basic Usage

Wrap an input with `FormControl`, `FormLabel`, and optionally `FormHelperText`:

```tsx
<FormControl>
  <FormLabel>Email</FormLabel>
  <Input
    value={sql`email`}
    onInput={(s) => s.setScalar("email", sql`target_value`)}
  />
  <FormHelperText>We will never share your email.</FormHelperText>
</FormControl>
```

FormControl automatically generates a unique ID. Components that consume
FormControl context, such as `Input`, connect the label via `htmlFor` so
clicking the label focuses the input.

## With Select

```tsx
<FormControl>
  <FormLabel>Calculation Mode</FormLabel>
  <Select
    value={sql`calc_mode`}
    onChange={(s) => s.setScalar("calc_mode", sql`target_value`)}
  >
    <Select.Option value="margin">Target Margin %</Select.Option>
    <Select.Option value="rate">Fixed Rate</Select.Option>
  </Select>
</FormControl>
```

## With Textarea

```tsx
<FormControl>
  <FormLabel>Description</FormLabel>
  <Textarea
    value={sql`description`}
    onInput={(s) => s.setScalar("description", sql`target_value`)}
    minRows={3}
  />
</FormControl>
```

## Error State

Pass an `error` prop (a SQL boolean expression) to indicate an error. This propagates to child components, changing the helper text color to danger automatically.

```tsx
<FormControl error={sql`email = ''`}>
  <FormLabel>Email</FormLabel>
  <Input
    value={sql`email`}
    onInput={(s) => s.setScalar("email", sql`target_value`)}
  />
  <FormHelperText>Email is required</FormHelperText>
</FormControl>
```

When `error` evaluates to true at runtime:

- The FormControl receives an `error` CSS class
- FormHelperText color changes to danger (red)

## Required Fields

Use the `required` prop on `FormLabel` to display a red asterisk:

```tsx
<FormControl>
  <FormLabel required>Full Name</FormLabel>
  <Input
    value={sql`full_name`}
    onInput={(s) => s.setScalar("full_name", sql`target_value`)}
  />
</FormControl>
```

## Horizontal Layout

Set `orientation="horizontal"` to place the label beside the input instead of above it:

```tsx
<FormControl orientation="horizontal">
  <FormLabel>Username</FormLabel>
  <Input
    value={sql`username`}
    onInput={(s) => s.setScalar("username", sql`target_value`)}
  />
</FormControl>
```

In horizontal mode, the label aligns to the center of the input and has right margin instead of bottom margin.

## Size

The `size` prop controls the font size of the label and helper text. It does not change the input size directly -- size the input separately.

```tsx
<FormControl size="sm">
  <FormLabel>Small Label</FormLabel>
  <Input size="sm" value={sql`val`} />
</FormControl>

<FormControl size="lg">
  <FormLabel>Large Label</FormLabel>
  <Input size="lg" value={sql`val`} />
</FormControl>
```

| Size | Label Font Size | Helper Text Font Size |
|------|----------------|----------------------|
| `xs` | `text-xs` | `text-xs` |
| `sm` | `text-xs` | `text-xs` |
| `md` | `text-sm` | `text-sm` |
| `lg` | `text-base` | `text-sm` |

Default size is `md`.

## Common Props

Use the exported TypeScript props for exact `FormControl`, `FormLabel`, and
`FormHelperText` types. Agents usually need `orientation`, `size`, `fullWidth`,
`inputId`, and runtime SQL `error` on `FormControl`; `required` on
`FormLabel`; and plain children on `FormHelperText`.

`color`, `orientation`, and `size` are generation-time values. `error` is a SQL
boolean expression, and `FormHelperText` automatically uses error styling when
inside an errored `FormControl`.

## Common Patterns

### Form Field with Validation

```tsx
<FormControl error={sql`submitted and email = ''`}>
  <FormLabel required>Email</FormLabel>
  <Input
    value={sql`email`}
    onInput={(s) => s.setScalar("email", sql`target_value`)}
  />
  <Show when={sql`submitted and email = ''`}>
    <FormHelperText>Email is required</FormHelperText>
  </Show>
</FormControl>
```

### Grid of Form Fields

```tsx
<div className="grid grid-cols-4 gap-4">
  <FormControl>
    <FormLabel>Start Date</FormLabel>
    <Input
      type="date"
      value={sql`format.date(start_date, '%Y-%m-%d')`}
      onInput={(s) =>
        s.setScalar("start_date", sql`cast(target_value as date)`)}
    />
  </FormControl>

  <FormControl>
    <FormLabel>End Date</FormLabel>
    <Input
      type="date"
      value={sql`format.date(end_date, '%Y-%m-%d')`}
      onInput={(s) =>
        s.setScalar("end_date", sql`cast(target_value as date)`)}
    />
  </FormControl>
</div>
```

### Input with Helper Text (No Label)

```tsx
<FormControl>
  <Input
    placeholder="John Doe"
    bindScalar="member_name"
  />
  <FormHelperText>Enter a member name and press Enter</FormHelperText>
</FormControl>
```

## Real-World Examples

```tsx
// Rates calculator with date and select controls
<div className="grid grid-cols-4 gap-4 mb-4">
  <FormControl>
    <FormLabel>Start Date</FormLabel>
    <Input
      type="date"
      value={sql`format.date(filter_start_date, '%Y-%m-%d')`}
      onInput={(s) =>
        s.setScalar("filter_start_date", sql`cast(target_value as date)`)}
    />
  </FormControl>

  <FormControl>
    <FormLabel>Calculation Mode</FormLabel>
    <Select
      value={sql`calc_mode`}
      onChange={(s) => s.setScalar("calc_mode", sql`target_value`)}
    >
      <Select.Option value="margin">Target Margin %</Select.Option>
      <Select.Option value="rate">Fixed Rate</Select.Option>
      <Select.Option value="default">Default Margins</Select.Option>
    </Select>
  </FormControl>

  <Show when={sql`calc_mode = 'margin'`}>
    <FormControl>
      <FormLabel>Target Margin (%)</FormLabel>
      <Input
        type="number"
        step="0.1"
        value={sql`target_margin`}
        onInput={(s) =>
          s.setScalar("target_margin", sql`cast(target_value as decimal(5,2))`)}
      />
    </FormControl>
  </Show>
</div>

// Service selector with FormControl wrapping a custom component
<FormControl>
  <FormLabel>{t("shared.fields.service")}</FormLabel>
  <TableRecordSelect
    tableName="services"
    value={fieldHelper.value}
  />
</FormControl>

// Event type with radio group
<FormControl>
  <FormLabel>Event Type</FormLabel>
  <EventTypeRadioGroup />
</FormControl>
```
