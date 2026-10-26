---
title: Auto Insert and Update Dialogs
description: Generate simple CRUD dialogs from table schema with AutoInsertDialog and AutoUpdateDialog — use these before hand-rolling a ModalDialog + Form.
tags:
  - ui
  - components
  - dialog
  - crud
  - form
related:
  - ui/form.md
  - ui/modal.md
  - ui/solution_components.md
---

# Auto Insert and Update Dialogs

`AutoInsertDialog` and `AutoUpdateDialog` build insert and update dialogs from
the table schema: a `ModalDialog` around `Form.Insert` / `Form.Update` with
fields, validation, and submit wired up. Block-owned fields on the table
(address, contact, attachments, ...) render automatically.

```tsx
import { AutoInsertDialog } from "components/auto_insert_dialog";
import { AutoUpdateDialog } from "components/auto_update_dialog";
```

Use them for any single-table insert or update. Hand-roll a `ModalDialog` +
[Form](./form.md) only for multi-step workflows, cross-table transactions
with custom preview state, or layouts these cannot express.

## Insert example

```tsx
<AutoInsertDialog
  bindScalar="add_section_dialog_open"
  table="sections"
  ignoreFields={["created_at"]}
  values={{ project_id: sql`ui.record_id` }}
/>
```

Non-obvious props (see `components/auto_insert_dialog` for the full type):

- `table` - omit to inherit the current table context.
- `ignoreFields` - fields to hide.
- `fieldOverrides` - `{ field: { label, initialValue } }`; `initialValue`
  applies on insert.
- `values` - fixed values keyed by field name (SQL allowed); those fields,
  and a prefilled parent foreign key, are hidden from the form.
- `temporaryFields` - custom field nodes rendered before the generated fields.
- `header` - custom dialog header (insert only).
- `navigateAfterInsert` - navigate to the new record's page; throws at
  generation time if the table has no record page.
- `disableAutoRefetch` - the underlying `Form` already refetches every
  non-`local` `Data` on success (`refetchOnSuccess`); the dialog also triggers
  the enclosing `Data` / `RecordPage` refetch context on commit. This prop
  turns off only that second trigger.

## Update example

```tsx
<AutoUpdateDialog
  bindScalar="edit_section_dialog_open"
  table="sections"
  recordId={sql`ui.edit_section_id`}
  ignoreFields={["created_at"]}
/>
```

It shares the binding, `table`, `ignoreFields`, `fieldOverrides`, `values`,
`temporaryFields`, `disableAutoRefetch`, `parentTable`, and `parentField`
props, and adds:

- `recordId` - record to edit; omit to inherit the current record context.
- `fields` - allowlist of fields to show (`ignoreFields` is the denylist).

`parentRecordId`, `header`, and `navigateAfterInsert` are insert-only.

## Dialog binding

Pass exactly one open-state binding (more than one throws at generation
time); the dialog closes itself after a successful submit:

- `bindScalar` - a `ui` boolean scalar; set it `true` to open, and the dialog
  sets it `false` on close.
- `bindRecordField` - a form record field, for dialogs opened inside a `Form`.
- `open` + `onClose` - a manual `BooleanExpr` and close handler.

[Triggers](#triggers) create the binding themselves.

## Linking to a parent record

To prefill the foreign key from a parent's detail page:

- `parentTable` - parent table whose foreign key to set.
- `parentField` - the foreign-key field, when the child has several to the
  parent table.
- `parentRecordId` - parent id (insert only); defaults to the current record
  context.

```tsx
<AutoInsertDialog
  bindScalar="add_task_dialog_open"
  table="tasks"
  parentTable="projects"
  parentField="project_id"
/>
```

## Lifecycle and submit hooks

Both dialogs forward the `Form` write hooks (`WriteProcExtensions`; see
[Form](./form.md) and [Advanced Form Patterns](./form_advanced.md)), each
called with `s` and the form `ctx`:

- `beforeSubmitClient` - client, before submit.
- `beforeTransactionStart` / `afterTransactionStart` - server
  (`UiServerStatements`), around opening the write transaction.
- `beforeTransactionCommit` - server, before the commit; put extra writes
  that must share the form's transaction here.
- `afterTransactionCommit` - server, after the commit; writes here run outside
  the form's transaction.
- `afterSubmitClientSuccess` - client, after success, before the dialog closes.
- `onSubmitError` / `onSubmitServerError` - client / server error handling.

## Triggers

`AutoInsertButton`, `AutoInsertIconButton`, `AutoInsertMenuItem`,
`AutoUpdateButton`, `AutoUpdateIconButton`, and `AutoUpdateMenuItem` render
the trigger plus its dialog with a local open scalar, so no binding prop is
needed. They take the dialog props plus the button/menu-item props.
`AutoInsertButton` / `AutoInsertIconButton` also accept
`addPageKeyboardShortcut` to map the page `a` key to the button.

```tsx
<AutoInsertIconButton table="sections" icon="Add" />
<AutoUpdateIconButton table="sections" recordId={sql`helper.recordId`} icon="Edit" />
```
