---
title: Data, Form, and ActionButton
description: When to use Data for reads and UI state, Form for field editing, and ActionButton for command mutations.
tags:
  - ui
  - data
  - form
  - action-button
related:
  - ui/data.md
  - ui/form.md
  - ui/action_button.md
---

# Data, Form, and ActionButton

Yolm provides three primary components for working with data:

- **Data** — for fetching and displaying data
- **Form** — for creating and editing record fields
- **ActionButton** — for command mutations such as delete, approve, or sync

## Quick Decision Table

| You want to... | Use |
|----------------|-----|
| Display data from the database | `Data` |
| Search/filter data | `Data` with `queryParams` |
| Create a new record | `Form` with `Form.Insert` |
| Edit an existing record | `Form` with `Form.Update` |
| Upsert a record | `Form` with `Form.Merge` |
| Manage local UI state (toggles, tabs) | `Data` with `local` |
| Delete, approve, archive, send, or sync | `ActionButton` |

## When to Use Data

Use Data for **reading** data and **UI state**:

```tsx
// Fetch and display
<Data procedure={(s) => {
  s.defTable("users", sql`select * from db.users`);
}}>
  <Each table="users" recordName="user_record">
    <p>{sql`user_record.name`}</p>
  </Each>
</Data>

// Local UI state
<Data local procedure={(s) => {
  s.defScalar("show_details", sql`false`);
}}>
  <Button onClick={(s) => s.setScalar("show_details", sql`not show_details`)}>
    Toggle
  </Button>
</Data>
```

## When to Use Form

Use Form for **writing** data — creating, updating, or upserting records:

```tsx
<Form afterSubmitClientSuccess={(s) => {
  s.refetch();
  s.navigate(sql.lit`/users`);
}}>
  <Form.Insert table="users">
    <Form.Field field="name" />
    <Form.Field field="email" />
    <Form.SubmitButton>Create User</Form.SubmitButton>
  </Form.Insert>
</Form>
```

## Composing Data + Form

A common pattern: Data loads context, Form handles editing.

### Detail page with edit

```tsx
function UserPage({ userId }: { userId: NumericExpr }) {
  return (
    <Data procedure={(s) => {
      s.defRecord("user_record", sql`select * from db.users where id = ${userId}`);
    }}>
      <h1>{sql`user_record.name`}</h1>

      <Form>
        <Form.Update table="users" where={sql`id = ${userId}`}>
          <Form.Field field="name" />
          <Form.Field field="email" />
          <Form.SubmitButton>Save</Form.SubmitButton>
        </Form.Update>
      </Form>
    </Data>
  );
}
```

## When to Use ActionButton

Use `ActionButton` (or `ActionIconButton`, `ActionMenuItem`,
`FileActionButton` from `std/action_button`) for server commands that are not
field editing: delete, approve, archive, send, sync, recalculate. It owns the
loading state, double-click protection, error display, optional `confirm`
dialog and `successMessage`, and refetches enclosing `Data` on success.

```tsx
<Each table="tasks" recordName="task">
  <p>{sql`task.title`}</p>
  <ActionButton
    size="sm"
    action={(s) => {
      s.startTransaction();
      s.modify(sql`update db.tasks set status = 'done' where id = task.id`);
      s.commitTransaction();
    }}
    successMessage="Task completed"
  >
    Complete
  </ActionButton>
</Each>
```

Do not use raw inputs plus `ActionButton` for ordinary inserts or updates; that
loses `Form` validation and field errors. See [ActionButton](./action_button.md).

## Raw Event Handlers

Use a plain `Button` handler for UI-only work: toggling a modal, switching
tabs, setting filters. Write a raw `s.tryServer` handler only when the flow is
not represented by `Form` or `ActionButton`. In that case make pending state
visible with `s.commitUiTreeChanges()`, handle the error path, and call
`s.refetch()` when affected reads must refresh. Values the client continuation
needs from the server (such as a new id) go through a procedure-local scalar
declared before `tryServer`; see
[DOM statements](../procedures/dom_statements.md#returning-values-from-server-blocks).

## Anti-Patterns

Do not hand-roll form state with `Data` scalars and a save button:

```tsx
// Don't do this
<Data local procedure={(s) => {
  s.defScalar("name", sql.lit``);
}}>
  <Input value={sql`name`} onInput={(s) => s.setScalar("name", sql`target_value`)} />
  <Button onClick={(s) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`insert into db.users (name) values (ui.name)`);
        s.commitTransaction();
      },
    });
  }}>Save</Button>
</Data>

// Do this instead
<Form>
  <Form.Insert table="users">
    <Form.Field field="name" />
    <Form.SubmitButton>Save</Form.SubmitButton>
  </Form.Insert>
</Form>
```

`Form` provides validation, error handling, touched state, undo/redo, and
nested relations. The same applies to a command button built from `Button` +
`s.tryServer` + loading/error scalars: use `ActionButton`.
