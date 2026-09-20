---
title: Checkbox & Switch
description: Checkbox and Switch components for boolean input, SQL-bound state, event handling, labels, and form integration.
tags:
  - ui
  - components
  - checkbox
  - switch
  - form
---

# Checkbox & Switch

The Checkbox component renders a customizable checkbox input. The SwitchControl component renders a toggle switch for boolean values. Both share similar APIs for binding to SQL state.

```tsx
import { Checkbox } from "components/checkbox";
import { SwitchControl } from "components/switch";
```

## Checkbox

### Basic Usage

The `checked` prop accepts a SQL boolean expression, and `onCheckboxChange` receives a statements handler where `target_checked` provides the new boolean value.

```tsx
<Checkbox
  checked={sql`is_active`}
  onCheckboxChange={(s) => {
    s.setScalar("is_active", sql`target_checked`);
  }}
/>
```

### With Label

```tsx
<Checkbox
  checked={sql`use_custom_models`}
  onCheckboxChange={(s) => {
    s.setScalar("use_custom_models", sql`not use_custom_models`);
  }}
  variant="soft"
  label="Use custom models"
  size="sm"
/>
```

### bindScalar Shorthand

Instead of manually wiring `checked` and `onCheckboxChange`, use `bindScalar` to automatically bind both:

```tsx
// These two are equivalent:

<Checkbox bindScalar="is_enabled" />

<Checkbox
  checked={sql`is_enabled`}
  onCheckboxChange={(s) => {
    s.setScalar("is_enabled", sql`target_checked`);
  }}
/>
```

### bindRecordField

Bind directly to a field on a record or table row:

```tsx
<Checkbox bindRecordField="settings.notifications_enabled" />
```

This generates an `update` statement on the record rather than `setScalar`.

### Read-Only Checkbox

Use `readOnly` and prevent changes in the handler:

```tsx
<Checkbox
  checked={sql`has_appointment`}
  variant="outlined"
  color="neutral"
  readOnly
  tabIndex={-1}
  onCheckboxChange={(s) => {
    s.event.preventDefault();
  }}
/>
```

### Checked Variation

Apply different styling when checked using `checkedVariation`:

```tsx
<Checkbox
  checked={sql`is_selected`}
  variant="outlined"
  color="neutral"
  checkedVariation={{ variant: "solid", color: "primary" }}
  onCheckboxChange={(s) => {
    s.setScalar("is_selected", sql`target_checked`);
  }}
/>
```

### Checkbox Options

Use the exported TypeScript props for the full `Checkbox` contract. Use one
binding mode:

- `bindScalar` for a boolean UI scalar.
- `bindRecordField` for a boolean field in a record cursor.
- `checked` plus `onCheckboxChange` for custom handling; use
  `target_checked` for the new value.

`color`, `variant`, and `size` are generation-time strings only. Use
`checkedVariation` for the common checked-state styling case.
`size` supports `"xs"`, `"sm"`, `"md"`, and `"lg"`.

---

## SwitchControl

### Basic Usage

```tsx
<SwitchControl
  checked={sql`auth_enabled`}
  onCheckboxChange={(s) => s.setScalar("auth_enabled", sql`not auth_enabled`)}
/>
```

### bindScalar Shorthand

```tsx
<SwitchControl bindScalar="dark_mode" />
```

### With Decorators

Use `startDecorator` and `endDecorator` for content before/after the switch track:

```tsx
<SwitchControl
  checked={sql`notifications_on`}
  onCheckboxChange={(s) => s.setScalar("notifications_on", sql`not notifications_on`)}
  startDecorator={<Typography level="body-sm">Off</Typography>}
  endDecorator={<Typography level="body-sm">On</Typography>}
/>
```

### Disabled State

```tsx
<SwitchControl
  checked={sql`is_locked`}
  disabled={sql`not has_permission`}
  onCheckboxChange={(s) => s.setScalar("is_locked", sql`not is_locked`)}
/>
```

### SwitchControl Options

`SwitchControl` follows the same binding modes as `Checkbox` and adds
`startDecorator` / `endDecorator` for inline labels. Use it for settings-style
toggles; use `Checkbox` when the control represents a checklist item or
agreement.

---

## Common Patterns

### Settings Toggle Row

A common pattern for settings pages with a label/description and a switch:

```tsx
<div className="flex items-center justify-between">
  <div className="flex items-center gap-3">
    <MaterialIcon icon="Email" className="text-neutral-600" />
    <div>
      <Typography level="body-md">Email Notifications</Typography>
      <Typography level="body-sm" className="text-neutral-600">
        Receive email alerts for important updates
      </Typography>
    </div>
  </div>
  <SwitchControl
    checked={sql`email_enabled`}
    onCheckboxChange={(s) => s.setScalar("email_enabled", sql`not email_enabled`)}
  />
</div>
```

### Checkbox in a Form

```tsx
<Data procedure={(s) => {
  s.defScalar("agree_to_terms", sql`false`);
}}>

<Checkbox
  bindScalar="agree_to_terms"
  label="I agree to the terms and conditions"
  variant="outlined"
/>

<Button
  disabled={sql`not agree_to_terms`}
  onClick={(s) => { /* submit */ }}
>
  Submit
</Button>

</Data>
```

### Checkbox with Server Persist

```tsx
<Checkbox
  checked={sql`is_free`}
  variant="outlined"
  label="Free item"
  onCheckboxChange={(s) => {
    s.setScalar("is_free", sql`target_checked`);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`update db.items set free = ui.is_free where id = ui.item_id`);
        s.commitTransaction();
      },
    });
  }}
/>
```

## Common Mistakes

```tsx
// ❌ WRONG - color cannot be a SQL expression
<Checkbox color={sql`case when error then 'danger' else 'primary' end`} />

// ✅ CORRECT - use Show/Switch for dynamic color
<Show when={sql`error`}>
  <Checkbox checked={sql`val`} color="danger" onCheckboxChange={handler} />
</Show>
<Show when={sql`not error`}>
  <Checkbox checked={sql`val`} color="primary" onCheckboxChange={handler} />
</Show>

// ❌ WRONG - cannot use both bindScalar and onCheckboxChange
<Checkbox bindScalar="val" onCheckboxChange={(s) => { /* ... */ }} />

// ✅ CORRECT - use one or the other
<Checkbox bindScalar="val" />

// ❌ WRONG - cannot use both bindScalar and bindRecordField
<Checkbox bindScalar="val" bindRecordField="rec.field" />

// ✅ CORRECT - use one binding method
<Checkbox bindRecordField="rec.field" />
```
