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
  <Each table="users" recordName="user">
    <p>{sql`user.name`}</p>
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
      s.defRecord("user", sql`select * from db.users where id = ${userId}`);
    }}>
      <h1>{sql`user.name`}</h1>

      <Form afterSubmitClientSuccess={(s) => s.refetch()}>
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

### Dashboard with action form

```tsx
function Dashboard() {
  return (
    <Data procedure={(s) => {
      s.defTable("tasks", sql`select * from db.tasks where status = 'pending'`);
      s.defScalar("task_count", sql`(select count(*) from tasks)`);
    }}>
      <h2>Pending Tasks ({sql`task_count`})</h2>

      <Each table="tasks" recordName="task">
        <p>{sql`task.title`}</p>
      </Each>

      {/* Quick add form */}
      <Form afterSubmitClientSuccess={(s) => s.refetch()}>
        <Form.Insert table="tasks">
          <Form.Field field="title">
            {(field) => (
              <Input value={field.value} onInput={(s) => field.setValue(s, sql`target_value`)} placeholder="New task..." />
            )}
          </Form.Field>
          <Form.SubmitButton size="sm">Add</Form.SubmitButton>
        </Form.Insert>
      </Form>
    </Data>
  );
}
```

## Anti-Patterns

### Do not manage form state manually

```tsx
// Don't do this
<Data procedure={(s) => {
  s.defScalar("name", sql.lit``);
  s.defScalar("email", sql.lit``);
}}>
  <Input value={sql`name`} onInput={(s) => s.setScalar("name", sql`target_value`)} />
  <Button onClick={(s) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`insert into db.users (name, email) values (ui.name, ui.email)`);
        s.commitTransaction();
      },
    });
  }}>Save</Button>
</Data>

// Do this instead
<Form>
  <Form.Insert table="users">
    <Form.Field field="name" />
    <Form.Field field="email" />
    <Form.SubmitButton>Save</Form.SubmitButton>
  </Form.Insert>
</Form>
```

Form gives you validation, error handling, touched state, undo/redo, and nested relations — all for free.

### Do not use Data for mutations

Data is for reading. Use Form for writing:

```tsx
// Don't use Data for form state
<Data procedure={(s) => { s.defScalar("edit_name", sql.lit``); }}>
  {/* manual save button with tryServer */}
</Data>

// Use Form instead
<Form>
  <Form.Update table="users" where={sql`id = ${userId}`}>
    <Form.Field field="name" />
    <Form.SubmitButton>Save</Form.SubmitButton>
  </Form.Update>
</Form>
```
