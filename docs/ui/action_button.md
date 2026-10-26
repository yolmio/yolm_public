---
title: ActionButton
description: Button and menu-item components that run server actions with built-in loading, error handling, success feedback, and optional confirmation dialogs.
tags:
  - ui
  - components
  - action
  - mutation
related:
  - ui/button.md
  - ui/form.md
  - ui/data_vs_form.md
  - ui/data.md
---

# ActionButton

`ActionButton` wraps `Button` with a guarded server action: loading state,
double-click protection, error snackbar or inline alert, optional success
snackbar and confirmation dialog, and a refetch on success.

Before adding or changing server actions, follow
[Own The Generated-Code Cost](../ai/forge_procedures.md#own-the-generated-code-cost).
Trace copies emitted by repeated buttons, menu options, and route reuse. Do not
add substantial duplicated database logic: put shared work in stored procedures,
not another inlining TypeScript helper, and report pre-existing duplication for
a cleanup task. Preserve transaction ownership and the action lifecycle below.

```tsx
import {
  ActionButton,
  ActionIconButton,
  ActionMenuItem,
  FileActionButton,
} from "std/action_button";

<ActionButton
  action={(s) => {
    s.callStoredProcedure("sync_contacts");
  }}
  successMessage="Contacts synced"
>
  Sync Contacts
</ActionButton>
```

## Choosing Form, ActionButton, Or Button

| Need | Use |
| --- | --- |
| Create, update, upsert, or bulk-edit rows from user-entered fields | `Form.Insert`, `Form.Update`, `Form.Merge`, or the `Many` variants |
| Submit a normal field-editing form | `Form.SubmitButton` |
| Run a server command with no field form: delete, approve, send, sync, recalculate, import, archive | `ActionButton` / `ActionIconButton` |
| Put that server command in a menu | `ActionMenuItem` |
| Upload a file and run a server command on it | `FileActionButton` / `FileActionIconButton` |
| Toggle a modal, change tabs, update local filters, or set UI-only state | `Button` with an event handler |
| Collect a few temporary command inputs, then run a command | `Data local` or `Form.Temporary` for state, then `ActionButton` |

`ActionButton` is not a form primitive. Raw inputs plus `ActionButton` for an
ordinary insert/update loses validation, dirty state, and field errors; use
[`Form`](./form.md). There is no `Form.ActionButton`; place an `ActionButton`
next to a `Form` only for a separate command.

## Lifecycle

On click (or confirm), the generated handler:

1. Returns early if the action is already running (double-click guard).
2. Runs `beforeActionClient` (client), sets the loading scalar, clears errors.
3. Calls `s.tryServer` whose body runs `action`, then `onSuccess`, then the
   refetch (when `refetch` is true). `action` and `onSuccess` are both
   `UiServerStatements`, i.e. **server-side**, inside the same `tryServer`.
4. On error, stores a message and runs `onError` (client). Errors thrown on
   purpose (`thrown_error`) show their message verbatim; others show
   `type: message`.
5. On success, runs `afterSuccessClient` (client): close a modal, clear a
   selection, navigate.

Refetch increments `global_refetch_key` (the same as `s.refetch()`), so every
non-`local` `Data` without `noRefetch` re-runs. Do not add a manual
`s.refetch()` to `action`; pass `refetch={false}` only when you intentionally
skip it.

```tsx
<ActionButton
  color="danger"
  confirm={{
    description: "This will permanently delete the project and all its tasks.",
    confirmText: "Delete Project",
  }}
  action={(s) => {
    s.startTransaction();
    s.modify(sql`delete from db.tasks where project = project.id`);
    s.modify(sql`delete from db.projects where id = project.id`);
    s.commitTransaction();
  }}
  afterSuccessClient={(s) => s.navigate(sql.lit`/projects`)}
>
  Delete Project
</ActionButton>
```

## Non-Obvious Props

- `confirm: { description?, confirmText?, prepare?, disabled? }` opens a confirmation dialog first.
  The dialog's confirm button is always `color="danger"`; it shows errors in
  an inline alert inside the dialog and closes only on success. On
  `ActionButton`, `errorDisplay` is ignored when `confirm` is set.
- `confirm.prepare` loads server data when the dialog opens. Its state is shared
  by `description`, `disabled`, and the confirmed `action`. Confirmation is disabled
  until the load succeeds, including while refreshing or after a load failure.
  A failed action refreshes these details before another attempt. Use `disabled`
  for additional eligibility checks. Revalidate any displayed forecast or scope
  inside the mutation transaction; loading a confirmation does not lock records.
- `errorDisplay`: `"snackbar"` (default), `"inline"` (an `Alert` under the
  button; good in dialogs and dense panels), or `"none"` (handle it in
  `onError`).
- `successMessage` (string or SQL) shows a success snackbar for 3.5s.
- `preventDefault` (default `true`) calls `event.preventDefault()` on click.
- All other `Button` props pass through except `onClick` and `loading`.

See `ActionButtonProps` in `std/action_button` for the full contract.

## Variants

- `ActionIconButton`: `IconButton` with a required `icon`; shows a spinner in
  place of the icon while running. Same props as `ActionButton`.
- `ActionMenuItem`: a `Menu.Item` inside `Menu.Content`. Takes `icon`,
  `children`, `action`, `confirm`, `successMessage`, `refetch`, `onSuccess`,
  `afterSuccessClient`, `onError`. `errorDisplay` is only `"snackbar"` or
  `"none"`; there is no `preventDefault` or `beforeActionClient`. With
  `confirm`, the menu stays open until the dialog closes.
- `FileActionButton` / `FileActionIconButton`: render a hidden file input
  inside the button. `action(s, file)` receives `file.uuid`, `name`, `type`,
  `lastModified`, and `size` for the first selected file, which is transferred
  to the server. `inputProps` (e.g. `accept`) pass to the `<input>`. No
  `confirm`.

```tsx
<Menu>
  <Menu.Button>Options</Menu.Button>
  <Menu.Content>
    <ActionMenuItem
      icon="CheckCircle"
      successMessage="Task completed"
      action={(s) => {
        s.startTransaction();
        s.modify(sql`update db.tasks set status = 'completed' where id = task.id`);
        s.commitTransaction();
      }}
    >
      Mark Complete
    </ActionMenuItem>
  </Menu.Content>
</Menu>
```

## Temporary Command Inputs

For a command that needs one or two temporary inputs, keep them in `Data local`
(or `Form.Temporary`) and run the command with `ActionButton`. If the inputs are
normal row fields, use `Form.Update` instead.

```tsx
<Data
  local
  procedure={(s) => {
    s.defScalar("reason", sql.lit``);
  }}
>
  <Input bindScalar="reason" />
  <ActionButton
    color="danger"
    disabled={sql`length(trim(reason)) = 0`}
    errorDisplay="inline"
    confirm={{ description: "Cancel this order?" }}
    action={(s) => {
      s.startTransaction();
      s.modify(sql`
        update db.orders
        set status = 'cancelled', cancellation_reason = ui.reason
        where id = order.id
      `);
      s.commitTransaction();
    }}
    afterSuccessClient={(s) => {
      s.setScalar("reason", sql.lit``);
    }}
  >
    Cancel Order
  </ActionButton>
</Data>
```

## Common Mistakes

| Mistake | Use instead |
| --- | --- |
| Raw `Button` / `Menu.Item` + `s.tryServer` + loading scalar for a command | `ActionButton` / `ActionMenuItem` |
| Raw inputs + `ActionButton` to insert or update a row, or as a form submit | `Form.Insert` / `Form.Update` / `Form.Merge` + `Form.SubmitButton` |
| Treating `onSuccess` as client cleanup | `onSuccess` runs on the server; use `afterSuccessClient` for UI cleanup |
| `ActionMenuItem` for UI-only work such as clearing a filter (needless server round trip) | Plain `Menu.Item` `onClick` |
| Manual `s.refetch()` inside `action` | Default `refetch` |
| Several related writes without a transaction | Wrap them in `s.startTransaction()` / `s.commitTransaction()` |
