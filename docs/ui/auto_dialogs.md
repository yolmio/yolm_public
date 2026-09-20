---
title: Auto Insert and Update Dialogs
description: Generate simple CRUD dialogs from table schema with AutoInsertDialog and AutoUpdateDialog — use these before hand-rolling a ModalDialog + Form.
tags:
  - ui
  - components
  - dialog
  - crud
  - form
---

# Auto Insert and Update Dialogs

`AutoInsertDialog` and `AutoUpdateDialog` build insert and update dialogs
directly from the table schema. They wrap `Form.Insert` / `Form.Update` with a
`ModalDialog` and wire up fields, validation, and submit for you.

Reach for these before building a custom `ModalDialog` + `Form` by hand. Any
address, contact, attachment, or other block-owned fields on the table render
automatically.

```tsx
import { AutoInsertDialog } from "components/auto_insert_dialog";
import { AutoUpdateDialog } from "components/auto_update_dialog";
```

## When to use

Use these primitives when the dialog is a straightforward insert or update of
a single database table.

Keep a hand-rolled `ModalDialog` only when the flow is not a normal
single-table insert/update — e.g. a multi-step workflow, a cross-table
transaction with custom preview state, or a layout the auto dialog can't
express.

## Insert example

```tsx
<AutoInsertDialog
  bindScalar="add_section_dialog_open"
  table="sections"
  ignoreFields={["created_at"]}
  values={{ project_id: sql`ui.record_id` }}
  afterSubmitClientSuccess={(s) => s.refetch()}
/>
```

Common props:

- `table` — the table to insert into. Omit to inherit from the nearest `CurrentTableICtxKey` context.
- `ignoreFields` — fields to hide from the form.
- `fieldOverrides` — `{ fieldName: { label, initialValue } }` for per-field customization (`initialValue` applies on insert).
- `values` — pre-filled values keyed by field name (SQL expressions OK).
- `header` — custom dialog header `Node` (insert only).
- `temporaryFields` — custom field nodes rendered before the generated database fields. Available for insert and update dialogs.
- `navigateAfterInsert` — if `true`, navigate to the inserted record's page after submit.
- `disableAutoRefetch` — by default the dialog refetches the surrounding `Data`/`RecordPage` after a successful submit; set `true` to skip it.

See [Dialog binding](#dialog-binding) for opening/closing, [Linking to a parent
record](#linking-to-a-parent-record) for foreign-key prefill, and [Lifecycle and
submit hooks](#lifecycle-and-submit-hooks) for `afterSubmitClientSuccess` and the
transaction callbacks (all shared with `Form`).

## Update example

```tsx
<AutoUpdateDialog
  bindScalar="edit_section_dialog_open"
  table="sections"
  recordId={sql`ui.edit_section_id`}
  ignoreFields={["created_at"]}
  afterSubmitClientSuccess={(s) => s.refetch()}
/>
```

Same binding, `table`, `ignoreFields`, `fieldOverrides`, `values`,
`temporaryFields`, and `disableAutoRefetch` props as insert. Additional:

- `recordId` — SQL expression for the record to edit. Omit to inherit the
  record id from the nearest `CurrentRecordICtxKey` context.
- `fields` — an allowlist of field names to show (the complement of
  `ignoreFields`, which is a denylist). Omit to show all editable fields.

`AutoUpdateDialog` accepts `parentTable` / `parentField` but not
`parentRecordId` or `header` (those are insert-only).

## Dialog binding

Both dialogs share one of three mutually-exclusive ways to control open state
(passing more than one throws at generation time):

- `bindScalar` — name of a `ui` boolean scalar that gates the dialog (set `true`
  to open; the dialog sets it back to `false` on close).
- `bindRecordField` — name of a form record field used as the open-state binding,
  for dialogs opened from inside a `Form`.
- `open` + `onClose` — a manual `BooleanExpr` and close handler, when you manage
  the open state yourself.

The trigger components below (`AutoInsertButton`, `AutoUpdateIconButton`, …) set
this up for you, so you do not pass a binding prop when using them.

## Linking to a parent record

When inserting or updating a child record from a parent's detail page, prefill
the foreign key to the parent:

- `parentRecordId` — the parent record id (`NumericExpr`, insert only). When
  omitted, the id is inherited from the nearest `CurrentRecordICtxKey` context.
- `parentTable` — the parent table whose foreign key should be set.
- `parentField` — the specific foreign-key field to set (use when the child has
  more than one foreign key to the parent table).

```tsx
<AutoInsertDialog
  bindScalar="add_task_dialog_open"
  table="tasks"
  parentTable="projects"
  parentField="project_id"
/>
```

## Lifecycle and submit hooks

Both dialogs forward the standard `Form` write hooks (see
[Form](./form.md) and [Advanced Form Patterns](./form_advanced.md)). Each
receives the statement builder `s` and the form `ctx`:

- `beforeSubmitClient` — runs on the client before submit (`DomStatements`).
- `beforeTransactionStart` / `afterTransactionStart` — server, around opening the
  write transaction (`UiServerStatements`).
- `beforeTransactionCommit` / `afterTransactionCommit` — server, around the
  commit; use these for extra writes that must be in the same transaction.
- `afterSubmitClientSuccess` — runs on the client after a successful submit; the
  usual place to call `s.refetch()`.
- `onSubmitError` / `onSubmitServerError` — client/server error handling.

## Triggers

Matching button/menu components wire the dialog open/close and hoist the
record id for you:

- `AutoInsertButton`, `AutoInsertIconButton`, `AutoInsertMenuItem`
- `AutoUpdateButton`, `AutoUpdateIconButton`, `AutoUpdateMenuItem`

```tsx
<AutoInsertIconButton table="sections" icon="Add" />
<AutoUpdateIconButton table="sections" recordId={sql`helper.recordId`} icon="Edit" />
```

These render both the trigger and the dialog — no separate `bindScalar`
needed.
