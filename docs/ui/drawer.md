---
title: Drawer
description: Drawer component for rendering a sliding panel overlay from any edge of the screen.
tags:
  - ui
  - components
  - drawer
related:
  - ui/sidebar.md
  - ui/modal.md
---

# Drawer

`Drawer` renders a panel that slides in from any screen edge over a backdrop.
It is a native `<dialog>` with CSS open/close transitions.

```tsx
import { Drawer } from "components/drawer";
```

## Basic Usage

```tsx
<Data procedure={(s) => s.defScalar("drawer_open", sql.false)}>
  <Button onClick={(s) => s.setScalar("drawer_open", sql.true)}>
    Open Drawer
  </Button>
  <Drawer bindScalar="drawer_open" direction="right">
    <Typography level="h4">Drawer Content</Typography>
  </Drawer>
</Data>
```

## Open State

`Drawer` uses the same `DialogBinding` as [ModalDialog](./modal.md#open-state):
exactly one of `bindScalar`, `bindRecordField` (`record.field` or
`ui.record.field`, closing sets it to `false`), or `open` + `onClose`.
Combining `bindScalar` with `bindRecordField` or `onClose` throws at generation
time. Backdrop click, Escape (`cancel`), and the dialog `close` event all call
the resolved `onClose`. Content is only rendered while open.

```tsx
<Drawer
  open={sql`panel_visible`}
  onClose={(s) => {
    s.setScalar("panel_visible", sql.false);
    // additional cleanup
  }}
  direction="left"
>
  {/* content */}
</Drawer>
```

## Props

- `direction` (required, static): `"left"` | `"right"` (full height, min width
  300px) or `"top"` | `"bottom"` (full width, min height 200px).
- Size the panel with `className` (e.g. `max-w-[360px]`, `w-[280px]`) or `sx`.

There are no `variant`, `color`, or `size` props. See `DrawerProps` in
`components/drawer` for the full contract.

## Example: Filter Drawer

```tsx
<Button
  startIcon="FilterList"
  onClick={(s) => s.setScalar("filters_open", sql.true)}
>
  Filters
</Button>

<Drawer bindScalar="filters_open" direction="right" className="max-w-[400px]">
  <div className="flex justify-between mb-3">
    <Typography level="h4">Filters</Typography>
    <IconButton
      icon="Close"
      variant="plain"
      size="sm"
      aria-label="Close filters"
      onClick={(s) => s.setScalar("filters_open", sql.false)}
    />
  </div>
  <Divider />
  {/* Inputs that set UI filter scalars, e.g. status_filter */}
  <div className="flex justify-end mt-4">
    <Button onClick={(s) => s.setScalar("filters_open", sql.false)}>
      Done
    </Button>
  </div>
</Drawer>
```

Filter scalars are UI state, not mutations: the `Data` that reads them should
list them in [`watch`](./data.md#watch-and-debounce) so it re-queries when
they change. After a server mutation inside a drawer, use `Form` or `ActionButton` (both refetch
enclosing `Data`) and close the drawer from `afterSubmitClientSuccess` /
`afterSuccessClient`.

For a mobile navigation drawer, `Sidebar` (`components/sidebar.tsx`) already
wraps its content in a left `Drawer`; see [Sidebar](./sidebar.md).

## SettingsDrawer

`SettingsDrawer` is a prebuilt right-side settings drawer: a color-mode
switcher (light / system / dark), the current user's identity, and a "Log out"
button when a logout context is available. It takes only `DialogBinding` props.

```tsx
import { SettingsDrawer } from "components/settings_drawer";

<IconButton
  icon="Settings"
  aria-label="Settings"
  onClick={(s) => s.setScalar("showing_settings", sql.true)}
/>
<SettingsDrawer bindScalar="showing_settings" />
```

`components/settings_drawer` also exports its building blocks:

- `ColorSchemeControl` - the color-mode switcher; renders nothing unless the
  app's `colorSchemeType` is `"cookie"`.
- `DisplayCurrentUser` - a "Logged in as ..." line for the current `sys_users`
  row (`email` or `username` field); renders nothing without a `sys_users`
  table.
