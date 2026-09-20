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

When a user is creating or editing database row fields, `Form` is the required
primitive. Do not build normal insert/update/merge flows with raw inputs plus
`Button`, `ActionButton`, or `s.tryServer`; that bypasses form validation,
dirty/touched state, field errors, nested relation handling, and the submit
lifecycle. Use [`ActionButton`](./action_button.md) only for command-style
server mutations that are not a field-editing form, such as approve, delete,
sync, send, archive, or recalculate.

For single-table insert/update dialogs, prefer [`AutoInsertDialog` and `AutoUpdateDialog`](./auto_dialogs.md) — they wrap Form around the common case and avoid hand-written modal state.

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

Use the exported TypeScript props for exact prop and helper signatures.

## Insert

```tsx
<Form>
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

Use `watch` on `Form` when the selected record or route parameter changes and
the form should re-initialize.

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

Use `Form.MergeMany` with `filterEmptyRecords` for repeated rows where empty
rows should not persist.

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

By default, `Form` derives required fields from editable `notNull` columns in
the form and excludes fields supplied through `values` / `setFields`. A row
counts as partial when an editable field differs from its initial/template
value, or when one of its `validatePartialRows` child rows has user input.

Use options when the required fields need to be explicit:

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

Use `ignoreFields` to exclude editable fields from automatic required-field and
row-intent derivation. Explicit `required` entries must refer to real fields and
cannot also be ignored.

For unusual row-intent rules, provide `activeWhen`. This replaces field-based
row detection for that table; `validatePartialRows` child rows still count as
parent row intent.

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

Useful field props:

| Need | Use |
| --- | --- |
| Initial value | `initialValue={sql.lit\`pending\`}` |
| Same value for every row in many-form | `shared` |
| Custom field type for temporary fields | `fieldType` |
| Default generated control | `<Form.Field field="name" />` |

### Numeric editing

Numeric form fields deliberately hold **text**, not a numeric scalar.
`NumericFieldFormControl` retains `target_value` unchanged; the form validates
and converts that text separately when saving. Money and decimal controls use
the decimal keyboard hint, while integer controls use the numeric hint.

Do not round, format, or cast the value back into the active input on each
keystroke, including indirectly through `Input.bindScalar` bound to a numeric
scalar. An unfinished number such as `-`, `12.`, or `12.30` cannot be represented
faithfully by a decimal scalar. `step="0.01"` does not solve this problem.

For standalone scenario calculations, use `NumericInput` from
`components/numeric_input` directly, without wrapping each input in a form.
It is stateless: bind caller-owned text and store the `onChange` text unchanged.
Parse separately for calculations or saving. Reset, suggestion, and dialog-open
handlers update the draft explicitly; do not synchronize it with an effect.
`NumericFieldFormControl` adapts that same input to form values and touched/errors.
Use sequential typing regression tests, not just a single `fill()` call.

`Form.Temporary` normally uses the declared state type directly (unlike
schema-backed numeric fields). `NumericFieldFormControl` ensures its temporary
field uses text state during gathering. For a custom numeric editor, explicitly
declare `fieldType="String"`; parse its value separately for the command.

## Nested Relations

Use `Form.Relation` for child tables. It auto-detects the foreign key when
there is a single relationship between parent and child.

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

Use `field` on `Form.Relation` when the foreign key is ambiguous. Use
`optional` for optional one-to-one children.

## `useCurrentTableHelper` and `useCursorHelper`

Custom controls inside `Form.Each` (or any nested `Form.Relation`)
sometimes need to act on the surrounding table or the current row.
Two hooks expose those handles:

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

Use these hooks when you're authoring a reusable child component that
must work inside any `Form.Each` / `Form.Relation`. For one-off
buttons, the built-ins (`Form.AddCurrentTableButton`,
`Form.DeleteRecordButton`, `Form.DeleteRecordIconButton`) cover the
common cases without writing custom logic.

## Submit Hooks

Use hooks when the write requires validation, derived rows, navigation, or
refreshing visible data.

```tsx
<Form
  beforeSubmitClient={(s, ctx) => {
    s.if(sql`quantity <= 0`, (s) => {
      ctx.setWriteError(s, sql.lit`Quantity must be positive`);
    });
  }}
  beforeTransactionCommit={(s) => {
    s.modify(sql`
      insert into db.order_activity_log (order_id, action)
      values (last_record_id(db.orders), 'created')
    `);
  }}
  afterSubmitClientSuccess={(s) => {
    s.refetch();
    s.navigate(sql.lit`/orders`);
  }}
>
  {/* operation */}
</Form>
```

Hook order is client validation, server transaction hooks, form writes,
transaction commit, then client success/error handling.

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

## Common Patterns

- Put persistent data in `db.*`; let `Form` manage temporary write state in
  `ui.*`.
- Use `values` for server-controlled defaults such as owner ids, status, or
  parent foreign keys.
- Use `shared` fields for batch forms where one value applies to every row.
- Use `s.refetch()` after submit when an ancestor `Data` or table component must
  refresh.
- Use `Form` hooks for validation and side effects instead of ad-hoc custom
  submit state.
- Use `Form.AutoFields` for standard CRUD and explicit `Form.Field` controls
  for workflow-specific forms.
