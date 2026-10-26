---
title: Advanced Form Patterns
description: Advanced patterns for Form components including MergeMany with filterEmptyRecords, nested relations, transaction hooks, cross-field validation, and undo/redo history.
tags:
  - ui
  - form
  - data-mutation
---

# Advanced Form Patterns

Patterns beyond basic insert/update/merge. Start with
[Form Component](./form.md); bare `Form.Field` elements below assume the `Form`
sets `defaultFieldComponent`.

## Form.MergeMany with filterEmptyRecords

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

- `filterEmptyRecords` excludes rows on submit whose registered `Form.Field`
  values are all empty or still equal to their initial value. Columns supplied
  through `values` do not make a row "filled".
- `defaultEmptyRecord` starts with one blank row.
- `Form.MergeMany` deletes rows in its merge scope that are missing from the
  submitted state. On long-lived bulk forms set `deleteBehavior="initial"` to
  delete only rows loaded at initialization, preserving rows other users add
  concurrently.

## Nested Relations

Relations nest to any depth. Many-row merge relations share `Form.MergeMany`'s
missing-row deletion and accept the same `deleteBehavior`.

```tsx
<Form defaultFieldComponent={LabelOnTopFormField}>
  <Form.Insert table="orders">
    <Form.Field field="customer_name" />
    <Form.Relation table="order_items">
      <Form.Each>
        <Form.Field field="product" />
        <Form.Field field="quantity" />
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

## Transaction Hooks

Hook order and the automatic post-commit `s.refetch()` are described in
[Submit Hooks](./form.md#submit-hooks). Form state records are named
`write_<singular table>` for single-row forms.

Cross-field validation on the client (setting an error aborts the submit):

```tsx
<Form
  beforeSubmitClient={(s, ctx) => {
    const start = ctx.record("write_event").field("start_date");
    const end = ctx.record("write_event").field("end_date");
    s.if(sql`${end.value} <= ${start.value}`, (s) => {
      end.setError(s, sql.lit`End date must be after start date`);
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

Server-side lookups and validation inside the transaction:

```tsx
<Form
  afterTransactionStart={(s) => {
    s.defRecord("customer", sql`select * from db.customers where id = ui.write_order.customer_id`);
    s.throwErrorIf(sql`customer.credit_hold`, sql.lit`Customer is on credit hold`);
  }}
>
  {/* form content */}
</Form>
```

## Undo / Redo History

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
  <FormHistoryButtons />
</Form>
```

`keepHistory` creates parallel `_write_history` tables and records changes made
through field helpers, throttled by `historyThrottle` (default 3000 ms). There
is no built-in undo control; read the `FormICtx` handles:

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

## Shared Fields Pattern

`shared` fields on `Form.InsertMany` hold one value applied to every row. They
live in `ui.write_<table>_shared_fields`, outside `Form.Each`.

```tsx
<Form defaultFieldComponent={LabelOnTopFormField}>
  <Form.InsertMany table="time_entries">
    <Form.Field field="date" shared />
    <Form.Each>
      <Form.Field field="project" />
      <Form.Field field="hours" />
    </Form.Each>
    <Form.AddCurrentTableButton startIcon="Add">Add Entry</Form.AddCurrentTableButton>
    <Form.SubmitButton>Save All Entries</Form.SubmitButton>
  </Form.InsertMany>
</Form>
```

## Before Unload Check

`<Form beforeUnloadCheck>` prompts before leaving the page with unsaved changes,
comparing `ctx.stateHash()` with the hash recorded at the last save.
