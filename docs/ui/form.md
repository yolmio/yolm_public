---
title: Form Component
description: How to use Form for Yolm inserts, updates, merges, validation, nested relations, submit hooks, Form.Update, and s.refetch after mutations.
tags:
  - ui
  - form
  - data-mutation
  - validation
related:
  - ui/data.md
  - ui/data_vs_form.md
  - ui/action_button.md
  - ui/form_advanced.md
  - procedures/patterns.md
---

# Form Component

Use `Form` for user-driven writes: inserts, updates, upserts, multi-row edits,
validation, nested relations, and submit lifecycle hooks. Use `Data` for
query-backed reads and filters.

```tsx
import { Form } from "std/form";
```

`Form` is the required primitive for editing database row fields; raw inputs
plus `Button`/`s.tryServer` bypass validation, dirty/touched state, field
errors, nested relations, and the submit lifecycle. Use
[`ActionButton`](./action_button.md) for commands with no editable row fields
(approve, delete, sync, send, archive). For single-table insert/update dialogs,
prefer [`AutoInsertDialog` / `AutoUpdateDialog`](./auto_dialogs.md).

Before adding or changing server submit hooks, follow
[Own The Generated-Code Cost](../ai/forge_procedures.md#own-the-generated-code-cost).
Trace copies emitted through controls and route reuse, not just TypeScript call
sites. Do not add substantial duplicated database logic: put shared work in
stored procedures while preserving the form's transaction, hook order,
validation, and rollback, and report pre-existing duplication for a cleanup
task. Keep UI state and route-specific callbacks in the form.

## Choose An Operation

| Need | Use |
| --- | --- |
| Create one row | `Form.Insert` |
| Create many rows | `Form.InsertMany` |
| Edit one row | `Form.Update` |
| Edit many rows | `Form.UpdateMany` |
| Upsert one row | `Form.Merge` |
| Upsert many rows | `Form.MergeMany` |
| Child rows | `Form.Relation` + `Form.Each` |
| UI-only fields | `Form.Temporary` |
| Generated fields | `Form.AutoFields` |
| Read-only display of form state | `Form.ReadField` |
| Single-field inline edit | `Form.InlineEdit` |
| Separate command with no editable row fields | `ActionButton` |

## Insert

Bare `<Form.Field field="..." />` renders the `Form`'s `defaultFieldComponent`
and throws at generation time if none is set. `LabelOnTopFormField`
(`components/label_on_top_form_field`) adds a label and error text around
[`FieldFormControl`](./field_form_control.md); later examples assume one is set.

```tsx
<Form defaultFieldComponent={LabelOnTopFormField}>
  <Form.Insert table="customers" values={{ created_by: sql`current_user` }}>
    <Form.Field field="name" />
    <Form.Field field="email" />
    <Form.ErrorAlert />
    <Form.SubmitButton>Create Customer</Form.SubmitButton>
  </Form.Insert>
</Form>
```

## Update

`where` is a SQL boolean expression that selects the record(s) to edit.

```tsx
<Form>
  <Form.Update table="customers" where={sql`id = ${customerId}`}>
    <Form.Field field="name" />
    <Form.Field field="email" />
    <Form.SubmitButton>Save Changes</Form.SubmitButton>
  </Form.Update>
</Form>
```

Set `watch` on `Form` to re-initialize when the selected record or route
parameter changes.

## Merge / Upsert

Use `Form.Merge` when the row may or may not exist.

```tsx
<Form>
  <Form.Merge
    table="user_settings"
    where={sql`user_id = ${userId}`}
    values={{ user_id: sql`${userId}` }}
    defaultEmptyRecord
  >
    <Form.Field field="theme" />
    <Form.Field field="notifications_enabled" />
    <Form.SubmitButton>Save Settings</Form.SubmitButton>
  </Form.Merge>
</Form>
```

`Form.MergeMany` with `filterEmptyRecords` skips rows the user left empty; see
[Advanced Form Patterns](./form_advanced.md#formmergemany-with-filteremptyrecords).

## Partial Rows

Use `validatePartialRows` when empty rows should be ignored, but partially
filled rows should show client-side required-field errors before submit.

```tsx
<Form.MergeMany
  table="donations"
  values={{ member_id: sql`current_member` }}
  defaultEmptyRecord
  filterEmptyRecords
  validatePartialRows
>
  <Form.Each>
    <Form.Field field="amount" />
    <Form.Field field="donor_name" />
  </Form.Each>
</Form.MergeMany>
```

By default, required fields are the editable `notNull` columns, excluding
fields supplied through `values` / `setFields`. A row is partial when an
editable field differs from its initial/template value, or when one of its
`validatePartialRows` child rows has user input. Make required fields explicit
with options:

```tsx
<Form.MergeMany
  table="events"
  validatePartialRows={{
    required: ["name", "date", "attendance"],
  }}
>
  {/* fields */}
</Form.MergeMany>
```

`ignoreFields` excludes editable fields from automatic required-field and
row-intent derivation. Explicit `required` entries must be real fields and
cannot also be ignored. `activeWhen` replaces field-based row detection for
that table; `validatePartialRows` child rows still count as parent row intent.

```tsx
validatePartialRows={{
  activeWhen: (row) => sql.or(
    row.hasText("name"),
    row.changedFromInitial("org_id"),
    row.isTrue("send_invite"),
  ),
}}
```

## Fields

`Form.Field` registers a field and provides a helper through function children.

```tsx
<Form.Field field="title">
  {(field) => (
    <FormControl error={field.hasError}>
      <Input
        value={field.value}
        onInput={(s) => field.setValue(s, sql`target_value`)}
        onBlur={(s) => field.setTouched(s, sql.true)}
      />
      <Show when={field.hasError}>
        <FormHelperText>{field.error}</FormHelperText>
      </Show>
    </FormControl>
  )}
</Form.Field>
```

Other `Form.Field` props:
`initialValue` (defaults to the column default or a type-appropriate empty
value), `required` (for fields not backed by a `notNull` column), `fieldType`
(required on `Form.Temporary` fields), and `shared` (one value for every row;
`Form.InsertMany` only, see
[shared fields](./form_advanced.md#shared-fields-pattern)).

### Numeric editing

Numeric form fields deliberately hold **text**, not a numeric scalar.
`NumericFieldFormControl` keeps `target_value` unchanged; the form validates
and converts the text when saving. Decimal and money controls use the decimal
keyboard hint; integer controls use the numeric hint.

Never round, format, or cast the value back into the active input on each
keystroke, including indirectly through `Input.bindScalar` on a numeric
scalar: unfinished numbers such as `-`, `12.`, or `12.30` cannot round-trip
through a decimal scalar, and `step="0.01"` does not help.

For standalone calculations, use `NumericInput` from `components/numeric_input`
without a form. It is stateless: bind caller-owned text, store the `onChange`
text unchanged, and parse separately. Reset, suggestion, and dialog-open
handlers update the draft explicitly; do not synchronize it with an effect.
Test with sequential typing, not a single `fill()` call.

`Form.Temporary` fields normally use their declared type.
`NumericFieldFormControl` forces text state for its temporary field during
gathering; a custom numeric editor must declare `fieldType="String"` and parse
the value separately.

## Nested Relations

`Form.Relation` edits child tables, auto-detecting the foreign key when there
is a single relationship.

```tsx
<Form>
  <Form.Insert table="orders" values={{ status: sql.lit`pending` }}>
    <Form.Field field="customer_id" />

    <Form.Relation table="order_items" many dontInitialize>
      <Form.Each recordName="item">
        <Form.Field field="product_id" />
        <Form.Field field="quantity" />
        <Form.DeleteRecordButton>Remove</Form.DeleteRecordButton>
      </Form.Each>
      <Form.AddCurrentTableButton startIcon="Add">
        Add Item
      </Form.AddCurrentTableButton>
    </Form.Relation>

    <Form.SubmitButton>Create Order</Form.SubmitButton>
  </Form.Insert>
</Form>
```

Set `field` when the foreign key is ambiguous and `optional` for optional
one-to-one children. Multi-level nesting and `deleteBehavior` are covered in
[Advanced Form Patterns](./form_advanced.md#nested-relations).

## `useCurrentTableHelper` and `useCursorHelper`

Reusable controls inside `Form.Each` / `Form.Relation` can act on the
surrounding table or current row:

| Hook | Returns |
| --- | --- |
| `useCurrentTableHelper()` | A `TableHelper` for the nearest `Form.Insert` / `Form.Update` / `Form.Merge` / `Form.Relation`. `addRecord(s, values)` is available for many-row tables and relations; use record/field helpers for single-row forms. Throws if called outside one of those. |
| `useCursorHelper()` | A `CursorHelper` for the row currently iterated by `Form.Each` — exposes `delete(s)`, `duplicate(s)`, `addRecord(s, values)`, and the SQL identifiers `recordIdent`, `recordUiId`, `iterationIndex`, `isLast`. Throws if called outside `Form.Each`. |

```tsx
import { useCurrentTableHelper, useCursorHelper } from "std/form";
import { Button } from "components/button";
import { IconButton } from "components/icon_button";
import { sql } from "std/sql_utils";

// Custom "duplicate this row" control inside Form.Each
function DuplicateRowButton() {
  const cursor = useCursorHelper();
  return (
    <IconButton
      icon="ContentCopy"
      variant="plain"
      onClick={(s) => cursor.duplicate(s)}
    />
  );
}

// Custom "add row with preset values" control inside Form.Relation
function AddBlankItemButton() {
  const tableHelper = useCurrentTableHelper();
  return (
    <Button
      startIcon="Add"
      onClick={(s) =>
        tableHelper.addRecord(s, { quantity: sql`1`, status: sql.lit`new` })
      }
    >
      Add Item
    </Button>
  );
}
```

For one-off buttons, prefer the built-ins (`Form.AddCurrentTableButton`,
`Form.DeleteRecordButton`, `Form.DeleteRecordIconButton`).

## Submit Hooks

Hooks add validation, derived rows, navigation, or other side effects.

```tsx
<Form
  beforeSubmitClient={(s, ctx) => {
    s.if(sql`ui.write_order_line.quantity <= 0`, (s) => {
      ctx.setWriteError(s, sql.lit`Quantity must be positive`);
    });
  }}
  beforeTransactionCommit={(s) => {
    s.callStoredProcedure("reserve_stock", {
      inputScalars: {
        p_product_id: sql`ui.write_order_line.product_id`,
        p_quantity: sql`ui.write_order_line.quantity`,
      },
    });
  }}
  afterSubmitClientSuccess={(s) => {
    s.navigate(sql.lit`/orders`);
  }}
>
  <Form.Insert table="order_lines">{/* fields */}</Form.Insert>
</Form>
```

Order: `beforeSubmitClient` (setting an error aborts) -> server
`beforeTransactionStart` -> `afterTransactionStart` -> form writes ->
`beforeTransactionCommit` -> commit -> `afterTransactionCommit` -> client
`afterSubmitClientSuccess` or `onSubmitError`.

After a successful commit `Form` calls `s.refetch()` itself
(`refetchOnSuccess`, default `true`), so every non-`local` `Data` refreshes.
Do not add another `s.refetch()` in `afterSubmitClientSuccess`; it is only
needed when `refetchOnSuccess={false}`.

`onSubmitServerError` receives the caught server error after the transaction is
rolled back. Set a field error or `ctx.setWriteError(...)` to translate it into
a handled form error. If the hook does not set an error, `Form` rethrows the
original failure.

## Built-In Controls And Actions

| Need | Use |
| --- | --- |
| Checkbox field | `Form.CheckboxField` |
| Boolean radio field | `Form.RadioGroupField` |
| Enum radio field | `Form.RadioGroupEnumField` |
| Submit button | `Form.SubmitButton` |
| Form error display | `Form.ErrorAlert` |
| Add row to current many table | `Form.AddCurrentTableButton` |
| Delete row in `Form.Each` | `Form.DeleteRecordButton`, `Form.DeleteRecordIconButton` |

`Form.ErrorAlert` shows write/server errors by default. Use
`mode="validation"` for submit-blocking field validation errors, or `mode="all"`
when one alert should cover both categories. Write/server errors take priority;
validation errors use `validationMessage`.

For field layout helpers, see [Solution UI Helper Components](./solution_components.md).

## Form State

`Form` keeps its working rows in `ui.*` state named `write_<singular table>`
(single row) or `write_<table>` (many), overridable with `stateName`; `db.*` is
written only on submit. Like other UI state it is visible only to the `Form`
and its descendants ([UI state scope](./overview.md#ui-state-scope)). Use
`values` for server-controlled columns (owner ids, status, parent keys) rather
than hidden fields, and `Form.AutoFields` for standard CRUD.
