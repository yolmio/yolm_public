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

The Drawer component renders a sliding panel that appears from any edge of the screen, overlaying the main content with a backdrop. It uses the native HTML `<dialog>` element with CSS animations for smooth open/close transitions.

```tsx
import { Drawer } from "components/drawer";
```

## Basic Usage

```tsx
// Define a scalar to track open/close state
<Data procedure={(s) => {
  s.defScalar("drawer_open", sql.false);
}}>

// Toggle with a button
<Button onClick={(s) => s.setScalar("drawer_open", sql.true)}>
  Open Drawer
</Button>

// Render the drawer
<Drawer bindScalar="drawer_open" direction="right">
  <Typography level="h4">Drawer Content</Typography>
  <p>Any content can go here.</p>
</Drawer>
```

## Direction

The `direction` prop controls which edge the drawer slides in from.

| Direction | Behavior |
|-----------|----------|
| `"left"` | Slides in from the left edge, full height |
| `"right"` | Slides in from the right edge, full height |
| `"top"` | Slides in from the top edge, full width |
| `"bottom"` | Slides in from the bottom edge, full width |

Left/right drawers have a minimum width of 300px. Top/bottom drawers have a minimum height of 200px.

```tsx
<Drawer bindScalar="nav_open" direction="left">
  {/* Navigation content */}
</Drawer>

<Drawer bindScalar="filters_open" direction="bottom">
  {/* Filter controls */}
</Drawer>
```

## Open/Close Binding

There are three ways to control the drawer's open/close state:

### bindScalar (recommended)

The simplest approach. Provide the name of a boolean UI scalar. The drawer will automatically open when the scalar is truthy and set it to `false` when the user closes the drawer (via backdrop click or cancel).

```tsx
<Data procedure={(s) => {
  s.defScalar("showing_panel", sql.false);
}}>

<Drawer bindScalar="showing_panel" direction="right">
  {/* content */}
</Drawer>
```

### bindRecordField

Bind to a field on a record instead of a standalone scalar.

```tsx
<Drawer bindRecordField="ui_state.panel_open" direction="right">
  {/* content */}
</Drawer>
```

### open + onClose (manual)

For full control, pass `open` as a SQL boolean expression and `onClose` as an event handler.

```tsx
<Drawer
  open={sql`panel_visible`}
  onClose={(s) => {
    s.setScalar("panel_visible", sql.false);
    // additional cleanup logic
  }}
  direction="left"
>
  {/* content */}
</Drawer>
```

**Note:** You cannot combine `bindScalar` with `onClose`, or `bindScalar` with `bindRecordField`.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `"left" \| "right" \| "top" \| "bottom"` | *required* | Edge from which the drawer slides in |
| `bindScalar` | `string` | - | Name of a boolean UI scalar to bind open/close state |
| `bindRecordField` | `string` | - | Record field path to bind open/close state (e.g. `"record.field"`) |
| `open` | `BooleanExpr` | - | SQL boolean expression controlling visibility |
| `onClose` | `DomStatementsOrFn` | - | Event handler called when the drawer should close |
| `children` | `Node` | *required* | Content rendered inside the drawer |
| `className` | `string` | - | Tailwind classes applied to the drawer element |
| `sx` | `Style` | - | Style overrides |

**Important**: The drawer closes on backdrop click and on the cancel event (e.g., pressing Escape) by default.

## Common Patterns

### Settings / Side Panel

A right-side drawer with a header, close button, and content sections.

```tsx
<Drawer
  bindScalar="showing_settings"
  direction="right"
  className="max-w-[360px]"
>
  <div className="flex justify-between mb-3">
    <Typography level="h4">Settings</Typography>
    <IconButton
      icon="Close"
      variant="plain"
      size="sm"
      aria-label="Close settings"
      onClick={(s) => s.setScalar("showing_settings", sql.false)}
    />
  </div>
  <Divider />
  {/* Settings content */}
</Drawer>
```

### Mobile Navigation Drawer

A left-side drawer used for mobile navigation, commonly paired with a sidebar.

```tsx
<Data procedure={(s) => {
  s.defScalar("mobile_nav_open", sql.false);
}}>

// Hamburger button (visible on small screens)
<IconButton
  icon="Menu"
  className="md:hidden"
  onClick={(s) => s.setScalar("mobile_nav_open", sql.true)}
/>

// Navigation drawer
<Drawer
  bindScalar="mobile_nav_open"
  direction="left"
  className="w-[280px]"
  sx={{ padding: 0 }}
>
  {/* Navigation links */}
</Drawer>
```

### Filter Drawer

A bottom or right drawer for filters on a data page.

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
      onClick={(s) => s.setScalar("filters_open", sql.false)}
    />
  </div>
  <Divider />
  {/* Filter form controls */}
  <div className="flex justify-end gap-2 mt-4">
    <Button variant="outlined" onClick={(s) => {
      // Reset filters
    }}>
      Clear
    </Button>
    <Button onClick={(s) => {
      s.setScalar("filters_open", sql.false);
      s.increment("refresh_key");
    }}>
      Apply
    </Button>
  </div>
</Drawer>
```

## Real-World Examples

From the `SettingsDrawer` component (`components/settings_drawer.tsx`):

```tsx
<Drawer
  open={open}
  onClose={onClose}
  direction="right"
  className="max-w-[360px]"
>
  <div className="flex justify-between mb-3">
    <Typography level="h4">Settings</Typography>
    <IconButton
      icon="Close"
      variant="plain"
      size="sm"
      aria-label="Close settings"
      onClick={onClose}
    />
  </div>
  <Divider />
  <ColorSchemeControl />
  <DisplayCurrentUser />
  {logout && (
    <div className="flex justify-end mt-2">
      <Button variant="soft" startIcon="Logout" onClick={logout.logout}>
        Log out
      </Button>
    </div>
  )}
</Drawer>
```

From the `Sidebar` component (`components/sidebar.tsx`), used as a mobile navigation drawer:

```tsx
<Drawer
  bindScalar={MOBILE_DRAWER_OPEN_SCALAR}
  direction="left"
  className="w-[var(--sidebar-width)]"
  sx={{ padding: 0 }}
>
  <Sheet sx={styles.sidebar} variant={variant} color={color}>
    {children}
  </Sheet>
</Drawer>
```

For the full `Sidebar` navigation component (which uses `Drawer` internally for its mobile drawer), see [Sidebar](./sidebar.md).

## SettingsDrawer

`SettingsDrawer` is a prebuilt right-side drawer for application settings. It renders a color-mode switcher (light / system / dark), the current user's identity, and a "Log out" button when a logout context is available. Use it instead of assembling a settings panel from `Drawer` by hand.

```tsx
import { SettingsDrawer } from "components/settings_drawer";
```

```tsx
<SettingsDrawer bindScalar="showing_settings" />
```

Open it from a trigger by setting the bound scalar:

```tsx
<IconButton
  icon="Settings"
  aria-label="Settings"
  onClick={(s) => s.setScalar("showing_settings", sql.true)}
/>
```

### Props

`SettingsDrawer` takes only the shared open/close binding props (`DialogBinding`) — the same `bindScalar` / `bindRecordField` / `open` + `onClose` options documented for `Drawer` above. It has no other props.

### Related exports

`components/settings_drawer` also exports the two building blocks `SettingsDrawer` composes:

| Export | Description |
|--------|-------------|
| `ColorSchemeControl` | The light / system / dark color-mode switcher. Renders nothing unless the app's `colorSchemeType` is `"cookie"`. |
| `DisplayCurrentUser` | A "Logged in as ..." line for the current `sys_users` row (uses the `email` or `username` field). Renders nothing if there is no `sys_users` table. |
