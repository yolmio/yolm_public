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

The `ModalDialog` component renders a native `<dialog>` element with backdrop, animations, and close handling. It is the primary way to show modal content in Yolm.

```tsx
import { ModalDialog } from "components/modal";
```

## Basic Usage

A `ModalDialog` requires an `open` expression and an `onClose` handler. The dialog renders when `open` is truthy and closes when the user clicks the backdrop or triggers `onClose`.

```tsx
<Data procedure={(s) => {
  s.defScalar("modal_open", sql.false);
}}>

<Button onClick={(s) => s.setScalar("modal_open", sql.true)}>
  Open Modal
</Button>

<ModalDialog
  open={sql`modal_open`}
  onClose={(s) => s.setScalar("modal_open", sql.false)}
>
  <Typography level="h4" className="mb-4">
    Dialog Title
  </Typography>
  <Typography level="body-md">
    Dialog content goes here.
  </Typography>
</ModalDialog>
```

## Open / Close with UI Scalars

The dialog's visibility is driven by a boolean UI scalar. Set it to `true` to open, `false` to close.

### Manual open/onClose

```tsx
<ModalDialog
  open={sql`modal_open`}
  onClose={(s) => s.setScalar("modal_open", sql.false)}
>
  {/* content */}
</ModalDialog>
```

### bindScalar shorthand

The `bindScalar` prop automatically binds `open` to the named scalar and generates an `onClose` that sets it to `false`. This is equivalent to the manual pattern above.

```tsx
<ModalDialog bindScalar="modal_open">
  {/* content */}
</ModalDialog>
```

### bindRecordField

For dialogs whose open state lives on a record field:

```tsx
<ModalDialog bindRecordField="ui.settings.show_dialog">
  {/* content */}
</ModalDialog>
```

You cannot combine `bindScalar`/`bindRecordField` with `onClose`.

## Common Props

Use the exported TypeScript props for the full `ModalDialog` contract. Use one
open state mode:

- `bindScalar` for a boolean UI scalar.
- `bindRecordField` for a boolean record field.
- `open` plus `onClose` for custom handling.

Use `layout`, `size`, and `maxWidth` for generation-time sizing.

## Layout

The `layout` prop controls how the dialog is positioned:

- **`center`** - Always centered on screen with a max-width constraint. Good for small confirmation dialogs.
- **`fullscreen`** - Takes up the entire viewport. Good for complex forms or detail views.
- **`fullscreenOnMobile`** (default) - Fullscreen on small screens, centered on medium+ screens. The best default for most dialogs.

```tsx
// Extra-small centered confirmation
<ModalDialog open={sql`confirm_open`} onClose={onClose} layout="center" size="xs">
  {/* ... */}
</ModalDialog>

// Full-screen detail view
<ModalDialog open={sql`detail_open`} onClose={onClose} layout="fullscreen">
  {/* ... */}
</ModalDialog>
```

## Structuring Dialog Content

Since `ModalDialog` renders a plain container, structure your content using Typography, Divider, and layout elements:

```tsx
<ModalDialog bindScalar="modal_open">
  <Typography level="h4" className="mb-4">
    Edit Item
  </Typography>

  <div className="space-y-4">
    {/* Form fields */}
  </div>

  <div className="flex gap-2 justify-end mt-4">
    <Button
      variant="plain"
      color="neutral"
      onClick={(s) => s.setScalar("modal_open", sql.false)}
    >
      Cancel
    </Button>
    <Button
      variant="solid"
      color="primary"
      onClick={(s) => {
        // save logic
      }}
    >
      Save
    </Button>
  </div>
</ModalDialog>
```

## Common Patterns

### Confirmation Dialog

For simple yes/no confirmations, use the built-in `ConfirmDangerDialog` component:

```tsx
import { ConfirmDangerDialog } from "components/confirm_danger_dialog";

<ConfirmDangerDialog
  bindScalar="confirm_delete"
  description={sql.lit`Are you sure you want to delete this item?`}
  confirmButtonText={sql.lit`Delete`}
  onConfirm={(s, close) => {
    s.setScalar("dialog_waiting", sql.true);
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`delete from db.items where id = selected_id`);
        s.commitTransaction();
        s.increment("ui.refresh_key");
      },
      catch: (s) => s.setScalar("dialog_error", sql.lit`Failed to delete`),
      finally: (s) => {
        s.setScalar("dialog_waiting", sql.false);
        s.statements(close);
      },
    });
  }}
/>
```

### Form Dialog

A modal containing a form with loading state and error handling:

```tsx
<ModalDialog
  open={sql`modal_open`}
  onClose={(s) => s.setScalar("modal_open", sql.false)}
>
  <Typography level="h4" className="mb-4">
    <Show when={sql`editing_id is null`} fallback="Edit Budget">
      Add Budget
    </Show>
  </Typography>

  <div className="space-y-4">
    <FormControl>
      <FormLabel>Name</FormLabel>
      <Input
        value={sql`form_name`}
        onInput={(s) => s.setScalar("form_name", sql`target_value`)}
      />
    </FormControl>

    <FormControl>
      <FormLabel>Amount</FormLabel>
      <Input
        value={sql`form_amount`}
        onInput={(s) => s.setScalar("form_amount", sql`target_value`)}
      />
    </FormControl>
  </div>

  <div className="flex gap-2 justify-end mt-4">
    <Button
      variant="plain"
      color="neutral"
      onClick={(s) => s.setScalar("modal_open", sql.false)}
    >
      Cancel
    </Button>
    <Button
      variant="solid"
      color="primary"
      loading={sql`saving`}
      onClick={(s) => {
        s.setScalar("saving", sql.true);
        s.commitUiTreeChanges();
        s.tryServer({
          body: (s) => {
            s.startTransaction();
            s.modify(
              sql`insert into db.budgets (name, amount) values (ui.form_name, ui.form_amount)`,
            );
            s.commitTransaction();
            s.increment("ui.refresh_key");
          },
          catch: (s) => s.setScalar("error", sql.lit`Failed to save`),
          finally: (s) => {
            s.setScalar("saving", sql.false);
            s.setScalar("modal_open", sql.false);
          },
        });
      }}
    >
      <Show when={sql`editing_id is null`} fallback="Update">
        Create
      </Show>
    </Button>
  </div>
</ModalDialog>
```

### Close Button Inside Dialog

Add an icon button in the top-right corner for an explicit close action:

```tsx
<ModalDialog bindScalar="modal_open">
  <div className="flex justify-between items-center mb-4">
    <Typography level="h4">Details</Typography>
    <IconButton
      variant="plain"
      color="neutral"
      size="sm"
      onClick={(s) => s.setScalar("modal_open", sql.false)}
    >
      <MaterialIcon icon="Close" />
    </IconButton>
  </div>
  {/* content */}
</ModalDialog>
```

## Close Behavior

The dialog closes in three ways:

1. **Backdrop click** - Clicking outside the dialog triggers `onClose`.
2. **Escape key** - The native `<dialog>` cancel event triggers `onClose`.
3. **Programmatic** - Setting the bound scalar to `false` or calling `onClose` from a button.

All three go through the same `onClose` handler, so cleanup logic only needs to be defined once.
