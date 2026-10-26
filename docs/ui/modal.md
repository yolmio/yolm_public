---
title: Modal / ModalDialog
description: Modal and ModalDialog components for overlaying dialogs, confirmations, forms, and focused workflows on top of a page.
tags:
  - ui
  - components
  - modal
  - dialog
---

# Modal / ModalDialog

`ModalDialog` renders a native `<dialog>` with backdrop, open/close animation,
and close handling. It is the primary way to show modal content.

```tsx
import { ModalDialog } from "components/modal";
```

## Basic Usage

```tsx
<Data procedure={(s) => s.defScalar("modal_open", sql.false)}>
  <Button onClick={(s) => s.setScalar("modal_open", sql.true)}>Open</Button>
  <ModalDialog bindScalar="modal_open">
    <Typography level="h4" className="mb-4">Dialog Title</Typography>
    <Typography level="body-md">Dialog content goes here.</Typography>
  </ModalDialog>
</Data>
```

The dialog content is wrapped in `Show`, so it is only rendered while open.

## Open State

`ModalDialogProps` extends `DialogBinding` (`components/utils`). Pass exactly
one of:

- `bindScalar="modal_open"` - opens when the UI scalar is true; closing sets it
  to `false`.
- `bindRecordField="ui.settings.show_dialog"` - opens when the record field is
  true; closing runs `update <record> set <field> = false`. The value must be
  `record.field` or `ui.record.field`.
- `open={sql`...`}` plus `onClose={(s) => ...}` - manual control, for cleanup
  logic on close.

Combining `bindScalar` with `bindRecordField`, or either with `onClose`, throws
at generation time. Omitting all of them throws `open must be specified`.

## Close Behavior

Backdrop click, the Escape key (native `cancel` event), and the dialog `close`
event all call the same resolved `onClose`, so cleanup only needs to be defined
once. Close programmatically by setting the bound scalar/field to `false` (or
running your `onClose` logic) from a button.

## Layout And Sizing

All three props are static generation-time values:

- `layout`: `"fullscreenOnMobile"` (default; fullscreen below `md`, centered
  above), `"center"` (always centered, good for small confirmations), or
  `"fullscreen"` (whole viewport, for complex forms or detail views).
- `size` (`xs` | `sm` | `md` | `lg`, default `md`) sets padding, radius, and font
  size.
- `maxWidth` (`xs` | `sm` | `md` | `lg` | `xl`) scales the centered max width to
  0.5x / 0.75x / 1x / 1.25x / 1.5x of the current breakpoint width.

`variant` is accepted by the type but currently ignored. Inside a dialog,
`Divider` bleeds to the dialog edges (`--divider-inset`). See `ModalDialogProps`
in `components/modal` for the full contract.

## Form Dialog

Use `Form` for field editing inside a dialog. `Form` refetches enclosing `Data`
on success by default (`refetchOnSuccess`), so `afterSubmitClientSuccess` only
needs to close the dialog:

```tsx
import { Form } from "std/form";

<ModalDialog bindScalar="add_budget_open" layout="center" size="sm">
  <div className="flex justify-between items-center mb-4">
    <Typography level="h4">Add Budget</Typography>
    <IconButton
      variant="plain"
      color="neutral"
      size="sm"
      onClick={(s) => s.setScalar("add_budget_open", sql.false)}
    >
      <MaterialIcon icon="Close" />
    </IconButton>
  </div>
  <Form
    afterSubmitClientSuccess={(s) => s.setScalar("add_budget_open", sql.false)}
  >
    <Form.Insert table="budgets">
      <div className="space-y-4">
        <Form.Field field="name" />
        <Form.Field field="amount" />
      </div>
      <Form.ErrorAlert />
      <div className="flex gap-2 justify-end mt-4">
        <Button
          variant="plain"
          color="neutral"
          onClick={(s) => s.setScalar("add_budget_open", sql.false)}
        >
          Cancel
        </Button>
        <Form.SubmitButton>Create</Form.SubmitButton>
      </div>
    </Form.Insert>
  </Form>
</ModalDialog>
```

For edits use `Form.Update` with a `where`; see [Form](./form.md).

## Confirmation Dialog

For destructive commands use `ConfirmDangerDialog`. With `action`, it runs an
`ActionButton` that shows errors inline, refetches enclosing `Data`, and closes
the dialog on success:

```tsx
import { ConfirmDangerDialog } from "components/confirm_danger_dialog";

<ConfirmDangerDialog
  bindScalar="confirm_delete"
  description={sql.lit`Are you sure you want to delete this item?`}
  confirmButtonText={sql.lit`Delete`}
  action={(s) => {
    s.startTransaction();
    s.modify(sql`delete from db.items where id = ui.selected_id`);
    s.commitTransaction();
  }}
/>
```

For a single button, `ActionButton`'s `confirm` prop is usually enough; see
[ActionButton](./action_button.md).
