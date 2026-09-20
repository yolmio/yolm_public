---
title: Advanced Form Patterns
description: Advanced patterns for Form components including MergeMany with filterEmptyRecords, nested relations, transaction hooks, cross-field validation, and undo/redo history.
tags:
  - ui
  - form
  - data-mutation
---

# Advanced Form Patterns

This document covers advanced Form usage beyond basic insert/update/merge operations. For fundamentals, see [Form Component](./form.md).

## Form.MergeMany with filterEmptyRecords

`Form.MergeMany` handles multiple records that may or may not already exist in the database. Combined with `filterEmptyRecords`, it skips persisting rows where the user left all fields empty.

```tsx
<Form.MergeMany
  table="volunteer_hours"
  values={{
    member_id: sql`current_member`,
    week_end_date: sql`current_week_end_date`,
  }}
  defaultEmptyRecord
  filterEmptyRecords
>
  <Form.Each>
    <Form.Field field="activity_id" />
    <Form.Field field="hours" />
  </Form.Each>
  <Form.AddCurrentTableButton startIcon="Add" variant="outlined" size="sm">
    Add Another
  </Form.AddCurrentTableButton>
</Form.MergeMany>
```

### How filterEmptyRecords works

- On submit, records where every user-editable field is null or empty are excluded from the database write.
- Values provided via the `values` prop (like `member_id` and `week_end_date` above) do not count as "filled" — at least one field registered via `Form.Field` must have a non-empty value.
- `defaultEmptyRecord` starts the form with one blank row so the user sees the fields immediately.
- By default, `Form.MergeMany` deletes database rows in its merge scope when they are missing from the submitted form state. Set `deleteBehavior="initial"` on long-lived bulk forms to limit deletion to rows loaded when the form was initialized, preserving rows that other users add concurrently.

## Nested Relations

Form supports multi-level nesting of relations:

Many-row merge relations use the same missing-row deletion behavior as
`Form.MergeMany`. Set `deleteBehavior="initial"` when a long-lived nested form
must preserve rows added concurrently after initialization.

```tsx
<Form>
  <Form.Insert table="orders">
    <Form.Field field="customer_name" />

    <Form.Relation table="order_items">
      <Form.Each>
        <Form.Field field="product" />
        <Form.Field field="quantity" />

        {/* Second level nesting */}
        <Form.Relation table="item_notes">
          <Form.Each fallback={
            <Form.AddCurrentTableButton variant="soft" size="sm" startIcon="Add">
              Add Note
            </Form.AddCurrentTableButton>
          }>
            <Form.Field field="note" />
          </Form.Each>
        </Form.Relation>

        <Form.DeleteRecordButton variant="plain" color="danger">
          Remove Item
        </Form.DeleteRecordButton>
      </Form.Each>
      <Form.AddCurrentTableButton startIcon="Add" variant="outlined">
        Add Item
      </Form.AddCurrentTableButton>
    </Form.Relation>

    <Form.SubmitButton>Create Order</Form.SubmitButton>
  </Form.Insert>
</Form>
```

## Transaction Hooks — Real-World Examples

### Cross-field validation

```tsx
<Form
  beforeSubmitClient={(s, ctx) => {
    // Validate that end date is after start date
    const startField = ctx.record("write_event").field("start_date");
    const endField = ctx.record("write_event").field("end_date");
    s.if(sql`${endField.value} <= ${startField.value}`, (s) => {
      endField.setError(s, sql.lit`End date must be after start date`);
    });
  }}
>
  <Form.Insert table="events">
    <Form.Field field="start_date" />
    <Form.Field field="end_date" />
    <Form.SubmitButton>Create</Form.SubmitButton>
  </Form.Insert>
</Form>
```

### Post-insert actions

```tsx
<Form
  afterTransactionStart={(s, ctx) => {
    // Look up the customer to set a computed field
    s.defRecord("customer", sql`select * from db.customers where id = ui.write_order.customer_id`);
  }}
  beforeTransactionCommit={(s, ctx) => {
    // After insert, use the generated ID for a related insert
    s.modify(sql`
      insert into db.audit_log (entity_type, entity_id, action, user_id)
      values ('order', last_record_id(db.orders), 'created', current_user)
    `);
  }}
  afterSubmitClientSuccess={(s) => {
    s.refetch();
    s.navigate(sql.lit`/orders`);
  }}
>
  {/* form content */}
</Form>
```

## Undo / Redo History

Enable undo/redo with `keepHistory`:

```tsx
<Form keepHistory historyThrottle={2000}>
  <Form.Update table="document" where={sql`id = ${docId}`}>
    <Form.Field field="content">
      {(field) => (
        <Textarea
          value={field.value}
          onInput={(s) => field.setValue(s, sql`target_value`)}
        />
      )}
    </Form.Field>
  </Form.Update>

  {/* Undo/redo buttons use the surrounding FormICtx. */}
  <FormHistoryButtons />
</Form>
```

`FormHistoryButtons` is an application helper, not a built-in component. A
custom helper can use the public context handles:

```tsx
import { FormICtxKey } from "std/ictx";
import { useICtx } from "std/ui";

function FormHistoryButtons() {
  const form = useICtx(FormICtxKey);
  return (
    <>
      <Button disabled={sql`not (${form.canUndo})`} onClick={(s) => form.undo(s)}>
        Undo
      </Button>
      <Button disabled={sql`not (${form.canRedo})`} onClick={(s) => form.redo(s)}>
        Redo
      </Button>
    </>
  );
}
```

When `keepHistory` is true:
- Parallel history tables are created with a `_write_history` suffix
- Changes are recorded whenever you use field helper functions
- History entries are throttled (default 3 seconds) to avoid recording every keystroke
- Use `ctx.undo(s)` and `ctx.redo(s)` from FormContext (gate buttons with `ctx.canUndo` / `ctx.canRedo`)

## Shared Fields Pattern

Use shared fields with `Form.InsertMany` when you want a single value to apply to all records:

```tsx
<Form>
  <Form.InsertMany table="time_entries">
    {/* Shared field: same date for all entries */}
    <Form.Field field="date" shared>
      {(field) => (
        <Input
          type="date"
          value={field.value}
          onInput={(s) => field.setValue(s, sql`target_value`)}
        />
      )}
    </Form.Field>

    {/* Per-record fields */}
    <Form.Each>
      <Form.Field field="project" />
      <Form.Field field="hours" />
      <Form.Field field="description" />
    </Form.Each>

    <Form.AddCurrentTableButton startIcon="Add">Add Entry</Form.AddCurrentTableButton>
    <Form.SubmitButton>Save All Entries</Form.SubmitButton>
  </Form.InsertMany>
</Form>
```

Shared fields are stored in a separate UI state table: `write_{table}_shared_fields`.

## Before Unload Check

Warn users before they navigate away with unsaved changes:

```tsx
<Form beforeUnloadCheck>
  <Form.Update table="profile" where={sql`id = current_user`}>
    <Form.Field field="bio" />
    <Form.SubmitButton>Save</Form.SubmitButton>
  </Form.Update>
</Form>
```

This uses `ctx.stateHash()` to compare the current form state with the last saved state.
