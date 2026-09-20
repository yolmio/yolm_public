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

Snackbars display brief temporary messages to users, typically at the bottom of the screen. They inform users of a process that an app has performed or will perform.

```tsx
import { Snackbar } from "components/snackbar";
```

## Basic Usage

```tsx
<Snackbar color="success" startIcon="CheckCircle">
  Operation completed successfully
</Snackbar>
```

## Positioning

Use `anchorOrigin` to position the snackbar on the screen.

```tsx
// Bottom left (default)
<Snackbar anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
  Message
</Snackbar>

// Bottom center
<Snackbar anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
  Message
</Snackbar>

// Bottom right
<Snackbar anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
  Message
</Snackbar>

// Top center
<Snackbar anchorOrigin={{ vertical: "top", horizontal: "center" }}>
  Message
</Snackbar>

// Top with offset
<Snackbar
  anchorOrigin={{ vertical: "top", horizontal: "center", verticalOffset: 20 }}
>
  Message
</Snackbar>
```

## Colors and Variants

Control appearance with `color` and `variant` props.

```tsx
// Success message
<Snackbar color="success" variant="soft" startIcon="CheckCircle">
  Successfully saved
</Snackbar>

// Error message
<Snackbar color="danger" variant="soft" startIcon="Error">
  Something went wrong
</Snackbar>

// Warning message
<Snackbar color="warning" variant="soft" startIcon="Warning">
  Please review this action
</Snackbar>

// Info message
<Snackbar color="primary" variant="soft" startIcon="Info">
  New information available
</Snackbar>
```

Available colors: `primary`, `neutral`, `danger`, `success`, `warning`

Available variants: `soft` (default), `solid`

## Icons and Decorators

### Icons

Use `startIcon` and `endIcon` for Material Design icons.

```tsx
<Snackbar startIcon="CheckCircle" color="success">
  Success
</Snackbar>

<Snackbar startIcon="Error" color="danger">
  Error
</Snackbar>

<Snackbar startIcon="Undo" color="primary">
  Undo available
</Snackbar>
```

### Custom Decorators

Use `startDecorator` and `endDecorator` for custom content (buttons, close icons, etc.).

```tsx
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";

<Snackbar
  startDecorator={<MaterialIcon icon="CheckCircle" />}
  endDecorator={
    <IconButton
      icon="Close"
      variant="plain"
      onClick={(s) => s.setScalar("show_snackbar", sql.false)}
    />
  }
>
  Message with close button
</Snackbar>
```

## Sizes

Control snackbar size with the `size` prop.

```tsx
<Snackbar size="xs">Extra-small snackbar</Snackbar>
<Snackbar size="sm">Small snackbar</Snackbar>
<Snackbar size="md">Medium snackbar (default)</Snackbar>
<Snackbar size="lg">Large snackbar</Snackbar>
```

## Auto-dismiss

Use `onMount` with `s.sleep()` to automatically dismiss the snackbar after a delay.

```tsx
<Snackbar
  color="success"
  startIcon="CheckCircle"
  onMount={(s) => {
    s.sleep(3500);  // milliseconds
    s.setScalar("show_snackbar", sql.false);
  }}
>
  This will close after 3.5 seconds
</Snackbar>
```

## Conditional Display

Show snackbars based on state.

```tsx
import { Show } from "std/ui";
import { Data } from "std/data";

export function MyComponent() {
  return (
    <Data procedure={(s) => {
      s.defScalar("show_success", sql.false);
      s.defScalar("error_message", { type: "String", expr: sql.null });
    }}>
      <Show when={sql`show_success`}>
        <Snackbar
          color="success"
          startIcon="CheckCircle"
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          onMount={(s) => {
            s.sleep(3500);
            s.setScalar("show_success", sql.false);
          }}
        >
          Operation successful
        </Snackbar>
      </Show>

      <Show when={sql`error_message is not null`}>
        <Snackbar
          color="danger"
          startIcon="Error"
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          onMount={(s) => {
            s.sleep(5000);
            s.setScalar("error_message", sql.null);
          }}
        >
          {sql`error_message`}
        </Snackbar>
      </Show>
    </Data>
  );
}
```

## Helper Components

### SnackbarButton

A button that shows a success snackbar after executing an action.

```tsx
import { SnackbarButton } from "components/snackbar_button";

<SnackbarButton
  statementProc={(s) => {
    s.modify(sql`update db.items set title = 'new title'`);
  }}
  successMessage="Changes saved successfully"
  successMessageDuration={3500}
  snackbarColor="success"
>
  Save
</SnackbarButton>
```

### SnackbarServerButton

A button that shows loading, success, and error snackbars for server operations.

```tsx
import { SnackbarServerButton } from "components/snackbar_server_button";

<SnackbarServerButton
  serverProc={(s) => {
    s.modify(sql`delete from db.items where id = ${itemId}`);
  }}
  successMessage="Item deleted successfully"
  errorMessage="Failed to delete item"
>
  Delete
</SnackbarServerButton>
```

### useUndoSnackbar

Hook for creating undo snackbar UI. It opens success/failure snackbars and
runs your `afterUndo` statements after transaction-log undo succeeds.

```tsx
import { useUndoSnackbar } from "components/undo_snackbars";

export function MyComponent() {
  const undoSnackbar = useUndoSnackbar({
    successSnackbarContent: "Item deleted successfully",
    afterUndo: (s) => {
      // Custom logic after undo
    },
  });

  return (
    <>
      <Button
        onClick={(s) => {
          undoSnackbar.setUndoTx(s);
          undoSnackbar.openSuccess(s);
          // Then delete the item...
        }}
      >
        Delete
      </Button>
    </>
  );
}
```

### useGlobalUndoSnackbar

Creates a global undo snackbar that persists across page navigation.

```tsx
import { useGlobalUndoSnackbar } from "components/global_undo_snackbar";

export function MyComponent() {
  const undoSnackbar = useGlobalUndoSnackbar("contact");

  return (
    <Button
      onClick={(s) => {
        undoSnackbar.setUndoTx(s);
        s.statements(undoSnackbar.open);
        // Delete and navigate...
      }}
    >
      Delete
    </Button>
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | `"md"` | Snackbar size |
| `color` | `Color` | `"primary"` | Theme color: "primary", "neutral", "danger", "success", "warning" |
| `variant` | `"soft" \| "solid"` | `"soft"` | Style variant |
| `anchorOrigin` | `AnchorOrigin` | `{ vertical: "bottom", horizontal: "left" }` | Position on screen |
| `verticalOffset` | `NumericExpr` | - | Offset from the selected vertical edge |
| `startIcon` | `IconName` | - | Material icon before content |
| `endIcon` | `IconName` | - | Material icon after content |
| `startDecorator` | `Node` | - | Custom content before text |
| `endDecorator` | `Node` | - | Custom content after text |
| `harmonize` | `boolean` | `false` | Harmonize colors with background |
| `children` | `Node` | - | Snackbar message content |
| `className` | `string` | - | Tailwind classes |

**Important**: `color` and `variant` are generation-time strings only, not SQL expressions.

## Real-World Examples

### Transactional Operation with Success/Error

```tsx
import { Data } from "std/data";
import { Show } from "std/ui";

export function SaveComponent() {
  return (
    <Data procedure={(s) => {
      s.defScalar("is_loading", sql.false);
      s.defScalar("show_success", sql.false);
      s.defScalar("error", { type: "String", expr: sql.null });
    }}>
      <Button
        loading={sql`is_loading`}
        onClick={(s) => {
          s.setScalar("is_loading", sql.true);
          s.commitUiTreeChanges();
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              s.modify(sql`insert into db.records (data) values ('new data')`);
              s.commitTransaction();
              s.setScalar("show_success", sql.true);
            },
            catch: (s) => {
              s.setScalar("error", sql`error.message`);
            },
            finally: (s) => {
              s.setScalar("is_loading", sql.false);
              s.commitUiTreeChanges();
              s.sleep(3500);
              s.setScalar("show_success", sql.false);
              s.setScalar("error", sql.null);
            },
          });
        }}
      >
        Save
      </Button>

      <Show when={sql`show_success`}>
        <Snackbar color="success" startIcon="CheckCircle">
          Data saved successfully
        </Snackbar>
      </Show>

      <Show when={sql`error is not null`}>
        <Snackbar color="danger" startIcon="Error">
          {sql`error`}
        </Snackbar>
      </Show>
    </Data>
  );
}
```

### File Upload Status

```tsx
<Show when={sql`upload_status = 'success'`}>
  <Snackbar
    color="success"
    startIcon="CheckCircle"
    anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    onMount={(s) => {
      s.sleep(5000);
      s.setScalar("upload_status", sql.lit``);
    }}
  >
    File uploaded successfully
  </Snackbar>
</Show>

<Show when={sql`upload_status = 'error'`}>
  <Snackbar
    color="danger"
    startIcon="Error"
    anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    onMount={(s) => {
      s.sleep(7000);
      s.setScalar("upload_status", sql.lit``);
    }}
  >
    Upload failed
  </Snackbar>
</Show>
```

## Common Patterns

### Duration Guidelines

- Success messages: 3.5 seconds (quick confirmation)
- Error messages: 5-7 seconds (allow time to read)
- Undo messages: 7.5 seconds (time to react)

### Always Use Conditional Display

Use `<Show>` to conditionally render snackbars based on UI state. This prevents multiple snackbars from stacking unintentionally.

### Close Button

Add a close button for user control over dismissal:

```tsx
<Snackbar
  startIcon="CheckCircle"
  endDecorator={
    <IconButton
      icon="Close"
      variant="plain"
      onClick={(s) => s.setScalar("show_snackbar", sql.false)}
    />
  }
>
  Message
</Snackbar>
```
