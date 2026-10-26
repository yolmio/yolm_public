---
title: Snackbar
description: Snackbar component for displaying brief temporary notifications and messages to users.
tags:
  - ui
  - components
  - snackbar
  - notification
---

# Snackbar

`Snackbar` is a fixed-position, temporary message pinned to a screen edge.

```tsx
import { Snackbar } from "components/snackbar";
```

## Basic Usage

A `Snackbar` is visible while rendered, so gate it with `<Show>` on UI state and
dismiss it from `onMount` with `s.sleep()`:

```tsx
<Data procedure={(s) => s.defScalar("show_saved", sql.false)}>
  <Show when={sql`show_saved`}>
    <Snackbar
      color="success"
      startIcon="CheckCircle"
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      onMount={(s) => {
        s.sleep(3500); // milliseconds
        s.setScalar("show_saved", sql.false);
      }}
    >
      Saved
    </Snackbar>
  </Show>
</Data>
```

Children may be a SQL expression, e.g. `{sql`error_message`}` gated by
`error_message is not null`.

For server commands you usually do not need a hand-built snackbar:
`ActionButton`'s `successMessage` and default `errorDisplay="snackbar"` render
one for you ([ActionButton](./action_button.md)).

## Props

- `anchorOrigin`: `{ vertical: "top" | "bottom", horizontal: "left" | "center" |
  "right", verticalOffset?: number }`. Default bottom-left. `verticalOffset` is
  extra pixels added to the vertical inset (e.g. to clear a fixed header); it
  is a static number inside `anchorOrigin`, not a separate prop.
- `startIcon` / `endIcon`: icon-name shortcuts that fill the
  `startDecorator` / `endDecorator` slots (and take precedence over them).
  Use the decorators for custom nodes such as a close `IconButton`.
- `harmonize`: inverts the snackbar colors to contrast with the surface and
  provides a harmonize context, so children using the default color (e.g.
  `IconButton color="harmonize"`) match. Only supported for `soft`/`solid`
  variants with a non-`harmonize` color.
- `variant`, `color`, and `size` follow the shared
  [styling props](./styling.md#color-variant-and-size). Defaults:
  `variant="soft"`, `color="primary"`, `size="md"`.

See `SnackbarProps` in `components/snackbar` for the full contract.

## Undo Snackbars

`useUndoSnackbar` (`components/undo_snackbars`) renders a success snackbar with
an Undo button that runs `s.undoTx` on the recorded transaction, then your
`afterUndo` (server) / `afterUndoClient` statements. `setUndoTx(s, tx?)`
defaults `tx` to `info.current_tx()`, so call it inside the mutating
transaction; open the snackbar on the client after success. It auto-closes
after 7.5 seconds.

```tsx
import { useUndoSnackbar } from "components/undo_snackbars";
import { ActionButton } from "std/action_button";

const undoSnackbar = useUndoSnackbar({
  successSnackbarContent: sql.lit`Deleted note`,
  afterUndo: (s) => s.refetch(),
});

<ActionButton
  action={(s) => {
    s.startTransaction();
    s.modify(sql`delete from db.notes where id = note.id`);
    undoSnackbar.setUndoTx(s);
    s.commitTransaction();
  }}
  afterSuccessClient={undoSnackbar.openSuccess}
>
  Delete
</ActionButton>
```

`useGlobalUndoSnackbar(key)` (`components/global_undo_snackbar`) is the global
variant: its state and snackbar live in global nodes, so it survives
navigation (e.g. delete a record, then leave its page). `setUndoTx` also
records `ui.location.pathname` as the return URL (override with
`setReturnUrl`); open it with `s.statements(undoSnackbar.open)`.
`DeleteRecordButton` wires this up via `globalUndoSnackbarKey`.

## Snackbar Buttons

- `SnackbarButton` (`components/snackbar_button`) runs client-side
  `statementProc` (DOM statements, no server work) and then shows
  `successMessage` for `successMessageDuration` ms (default 3500) in
  `snackbarColor` (default `success`).
- `SnackbarServerButton` (`components/snackbar_server_button`) runs
  `serverProc` in `tryServer`, refetches unless `disableRefetch`, and shows a
  success or error snackbar. Prefer `ActionButton` for new code.

## Common Mistakes

- Rendering a `Snackbar` without a `<Show>` gate: it stays on screen forever.
- Calling `setUndoTx` on the client before the server mutation: the default
  `info.current_tx()` then does not point at the mutating transaction.
