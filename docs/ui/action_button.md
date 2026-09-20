---
title: ActionButton
description: Button and menu-item components that run server actions with built-in loading, error handling, success feedback, and optional confirmation dialogs.
tags:
  - ui
  - components
  - action
  - mutation
---

# ActionButton

The `ActionButton` component wraps a standard `Button` with server-action handling: loading states, error snackbars or inline alerts, optional success messages, and confirmation dialogs. It also protects against double-clicks and automatically refetches the enclosing `Data` on success.

```tsx
import { ActionButton } from "std/action_button";
```

Use `ActionButton` instead of hand-rolling `tryServer` + manual loading/error
scalars for command-style actions.

`ActionButton` is not a form primitive. If the user is creating or editing row
fields, use [`Form`](./form.md) with `Form.SubmitButton`. There is no
`Form.ActionButton`; use `ActionButton` alongside `Form` only for a separate
command that is not the form submit.

## Choosing Form, ActionButton, Or Button

| Need | Use |
| --- | --- |
| Create, update, upsert, or bulk-edit rows from user-entered fields | `Form.Insert`, `Form.Update`, `Form.Merge`, or the `Many` variants |
| Submit a normal field-editing form | `Form.SubmitButton` |
| Run a server command with no field form: delete, approve, send, sync, recalculate, import, archive | `ActionButton` |
| Put that server command in a menu | `ActionMenuItem` |
| Toggle a modal, change tabs, update local filters, or set UI-only state | `Button` with an event handler |
| Collect a few temporary command inputs, then run a command | `Data local` or `Form.Temporary` for state, then `ActionButton` for the command |

The boundary is about user intent:

- If the user is editing record fields, `Form` owns the mutation lifecycle,
  validation, dirty state, touched state, errors, nested rows, and submit button.
- If the user is pressing a command button, `ActionButton` owns loading, errors,
  success feedback, confirmation, double-click protection, and `Data` refetch.
- If the handler is not server work, keep it as a normal `Button` handler.

Do not replace `Form` with raw inputs plus `ActionButton` for ordinary inserts
or updates. That duplicates form behavior and usually loses validation and
field-level error handling.

## Basic Usage

```tsx
<ActionButton
  action={(s) => {
    s.startTransaction();
    s.modify(sql`delete from db.todos where id = todo.id`);
    s.commitTransaction();
  }}
  successMessage="Todo deleted"
>
  Delete
</ActionButton>
```

## Replacing Manual tryServer Buttons

Before: a command button with hand-rolled waiting state, server call, and refetch.

```tsx
<Data
  local
  procedure={(s) => {
    s.defScalar("sync_waiting", sql.false);
  }}
>
  <Button
    loading={sql`sync_waiting`}
    onClick={(s) => {
      s.setScalar("sync_waiting", sql.true);
      s.commitUiTreeChanges();
      s.tryServer({
        body: (s) => {
          s.callStoredProcedure("sync_contacts");
          s.refetch();
        },
        finally: (s) => {
          s.setScalar("sync_waiting", sql.false);
        },
      });
    }}
  >
    Sync Contacts
  </Button>
</Data>
```

After: the same command with `ActionButton`.

```tsx
<ActionButton
  action={(s) => {
    s.callStoredProcedure("sync_contacts");
  }}
  successMessage="Contacts synced"
>
  Sync Contacts
</ActionButton>
```

`ActionButton` handles loading, prevents duplicate clicks, reports errors, and
refetches the enclosing `Data` on success.

## With Confirmation Dialog

Pass `confirm` to gate the action on a user confirmation:

```tsx
<ActionButton
  action={(s) => {
    s.startTransaction();
    s.modify(sql`delete from db.projects where id = project.id`);
    s.commitTransaction();
  }}
  confirm={{
    description: "This will permanently delete the project and all its tasks.",
    confirmText: "Delete Project",
  }}
  color="danger"
>
  Delete Project
</ActionButton>
```

## Error Display

Errors are shown as a snackbar by default. Use `errorDisplay` to change the behavior:

```tsx
// Default — shows a Snackbar on error
<ActionButton action={saveAction}>Save</ActionButton>

// Show an inline Alert below the button instead
<ActionButton action={saveAction} errorDisplay="inline">
  Save
</ActionButton>

// Suppress error UI entirely (handle it yourself)
<ActionButton action={saveAction} errorDisplay="none">
  Save
</ActionButton>
```

## Disabling Automatic Refetch

By default the enclosing `Data` is refetched after the action succeeds. Disable this if you are managing the refresh yourself:

```tsx
<ActionButton action={markReadAction} refetch={false}>
  Mark as Read
</ActionButton>
```

## onSuccess Callback

Run additional UI state changes after the server action succeeds:

```tsx
<ActionButton
  action={(s) => {
    s.startTransaction();
    s.modify(sql`insert into db.notes (content) values (ui.draft_text)`);
    s.commitTransaction();
  }}
  onSuccess={(s) => {
    s.setScalar("draft_text", sql.lit``);
  }}
  successMessage="Note saved"
>
  Save Note
</ActionButton>
```

Use `onSuccess` for client-side cleanup after the server work completes. Common
uses are closing a modal, clearing temporary scalars, or resetting a local
selection. Keep server writes in `action`, not `onSuccess`.

## Temporary Command Inputs

For command dialogs that need one or two temporary inputs, keep that state in
`Data local` or `Form.Temporary`, then run the server command through
`ActionButton`. Use `Form` instead when those inputs are normal editable fields
for a row.

```tsx
<Data
  local
  procedure={(s) => {
    s.defScalar("reason", sql.lit``);
  }}
>
  <Input
    value={sql`reason`}
    onInput={(s) => {
      s.setScalar("reason", sql`target_value`);
    }}
  />
  <ActionButton
    disabled={sql`length(trim(reason)) = 0`}
    errorDisplay="inline"
    action={(s) => {
      s.startTransaction();
      s.modify(sql`
        update db.orders
        set status = 'cancelled',
            cancellation_reason = reason
        where id = order.id
      `);
      s.modify(sql`
        insert into db.order_activity (order_id, note)
        values (order.id, reason)
      `);
      s.commitTransaction();
    }}
    onSuccess={(s) => {
      s.setScalar("reason", sql.lit``);
    }}
    confirm={{ description: "Cancel this order?" }}
    color="danger"
  >
    Cancel Order
  </ActionButton>
</Data>
```

If `reason` is part of a normal order edit form, use `Form.Update` and
`Form.Field` instead.

## Props

`ActionButton` accepts all `Button` props except `onClick` and `loading`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `action` | `(s: UiServerStatements) => void` | **required** | Server-side code to run inside `tryServer` |
| `successMessage` | `string \| Sql` | - | Message shown in a success Snackbar |
| `errorDisplay` | `"snackbar" \| "inline" \| "none"` | `"snackbar"` | How to display errors |
| `refetch` | `boolean` | `true` | Whether to refetch enclosing `Data` on success |
| `preventDefault` | `boolean` | `true` | Calls `event.preventDefault()` on click |
| `confirm` | `{ description?: Node; confirmText?: Node }` | - | Optional confirmation dialog |
| `onSuccess` | `(s: UiServerStatements) => void` | - | Callback fired after the action succeeds |

**Important**: `color` and `variant` are generation-time strings only, not SQL expressions. Same rules as `Button`.

---

# ActionMenuItem

`ActionMenuItem` is the menu-item variant of `ActionButton`. Use it inside a `Menu` for actions that need loading, error, and confirm behavior.

```tsx
import { ActionMenuItem } from "std/action_button";
```

## Basic Usage

```tsx
<Menu>
  <Menu.Button>Options</Menu.Button>
  <Menu.Content>
    <ActionMenuItem
      action={(s) => {
        s.startTransaction();
        s.modify(sql`update db.tasks set status = 'completed' where id = task.id`);
        s.commitTransaction();
      }}
      icon="CheckCircle"
      successMessage="Task completed"
    >
      Mark Complete
    </ActionMenuItem>
    <ActionMenuItem
      action={(s) => {
        s.startTransaction();
        s.modify(sql`delete from db.tasks where id = task.id`);
        s.commitTransaction();
      }}
      icon="Delete"
      confirm={{ description: "Delete this task?" }}
    >
      Delete
    </ActionMenuItem>
  </Menu.Content>
</Menu>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `action` | `(s: UiServerStatements) => void` | **required** | Server-side code to run |
| `children` | `Node` | **required** | Menu item label |
| `icon` | `IconName` | - | Material icon shown on the left |
| `successMessage` | `string \| Sql` | - | Success snackbar message |
| `errorDisplay` | `"snackbar" \| "none"` | `"snackbar"` | How to display errors |
| `refetch` | `boolean` | `true` | Refetch enclosing `Data` on success |
| `confirm` | `{ description?: Node; confirmText?: Node }` | - | Optional confirmation dialog |
| `onSuccess` | `(s: UiServerStatements) => void` | - | Callback after action succeeds |

## Common Patterns

### Delete button with inline error inside a dialog

```tsx
<ActionButton
  action={(s) => {
    s.startTransaction();
    s.modify(sql`delete from db.customers where id = customer.id`);
    s.commitTransaction();
  }}
  errorDisplay="inline"
  confirm={{ description: "Delete this customer?" }}
  color="danger"
>
  Delete
</ActionButton>
```

### Menu item that resets a filter

```tsx
<ActionMenuItem
  action={(s) => {
    s.setScalar("status_filter", sql.null);
  }}
  refetch={false}
  icon="FilterListOff"
>
  Clear Filter
</ActionMenuItem>
```

### Status transition command

```tsx
<ActionButton
  action={(s) => {
    s.startTransaction();
    s.modify(sql`
      update db.invoices
      set status = 'approved'
      where id = invoice.id
    `);
    s.modify(sql`
      insert into db.invoice_activity (invoice_id, event)
      values (invoice.id, 'approved')
    `);
    s.commitTransaction();
  }}
  confirm={{ description: "Approve this invoice?" }}
  successMessage="Invoice approved"
>
  Approve
</ActionButton>
```

### Form submit plus separate command

Use `Form.SubmitButton` for the form save. Use `ActionButton` only for a
separate command outside the form submit path.

```tsx
<Form>
  <Form.Update table="customers" where={sql`id = customer.id`}>
    <Form.Field field="name" />
    <Form.Field field="email" />
    <Form.ErrorAlert />
    <Form.SubmitButton>Save</Form.SubmitButton>
  </Form.Update>
</Form>

<ActionButton
  action={(s) => {
    s.startTransaction();
    s.modify(sql`update db.customers set archived = true where id = customer.id`);
    s.commitTransaction();
  }}
  confirm={{ description: "Archive this customer?" }}
>
  Archive
</ActionButton>
```

## Common Misuse

| Misuse | Use instead |
| --- | --- |
| Raw `Button` + `s.tryServer` + loading scalar for delete/approve/sync | `ActionButton` |
| `MenuItem` + custom server handler for row actions | `ActionMenuItem` |
| Raw inputs + `ActionButton` to insert or update a row | `Form.Insert`, `Form.Update`, or `Form.Merge` |
| `ActionButton` to submit a field-editing form | `Form.SubmitButton` |
| Manual `s.refetch()` after every command button | Default `ActionButton` refetch, unless `refetch={false}` is intentional |
| Server writes in `onSuccess` | Put writes in `action`; reserve `onSuccess` for UI cleanup |
| Dynamic SQL for `color` / `variant` | Render separate variants with `Show` / `Switch` |

## Migration Checklist

When reviewing an existing command button:

1. If it edits user-entered row fields, migrate to `Form` instead.
2. If it runs a server command, replace raw `Button` / `MenuItem` handlers with
   `ActionButton` / `ActionMenuItem`.
3. Move server writes into the `action` callback.
4. Keep related writes inside `s.startTransaction()` / `s.commitTransaction()`.
5. Use `confirm` for destructive or irreversible actions.
6. Use `errorDisplay="inline"` inside dialogs or dense panels where a snackbar
   would be easy to miss.
7. Remove manual loading/error scalars that only existed for the command button.
8. Rely on default refetch unless the surrounding `Data` intentionally opts out.
