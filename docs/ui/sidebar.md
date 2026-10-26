---
title: Sidebar
description: Sidebar layout and navigation patterns for responsive Yolm apps with grouped menus, collapsible sections, search buttons, settings, and mobile drawers.
tags:
  - ui
  - components
  - sidebar
  - navigation
  - layout
related:
  - concepts/apps.md
  - ui/routing.md
  - ui/operational_ui.md
---

# Sidebar

`Sidebar` is the app shell for multi-section apps: persistent navigation,
collapsible menus, a mobile drawer, settings, and search shortcuts.

```tsx
import { Sidebar, useSidebar } from "components/sidebar";
```

## Shared Navigation Shell

The opt-in `shell` provider option gives the shell ownership of navigation
controls and account placement; without it, pages keep their own controls.

```tsx
<Sidebar.Provider
  defaultOpen
  width={280}
  shell={{
    brand: { logo: getAssetUrl("logo.png"), name: "Example Company" },
    account: (presentation) => <AppAccountMenu {...presentation} />,
  }}
>
  <Sidebar.Root variant="soft">
    <Sidebar.Header title="Back Office" />
    <Sidebar.Content>{/* Existing navigation groups and links */}</Sidebar.Content>
  </Sidebar.Root>
  <Sidebar.MainScreen>{routes}</Sidebar.MainScreen>
</Sidebar.Provider>
```

The `account` callback runs at generation time with `compact` and `placement`;
forward them to the shared `AccountMenu`, and keep user expressions,
permissions, and URLs in the system's account wrapper. The shell places the
full account menu at the bottom of the expanded sidebar and drawer, and
compact menus in the desktop rail and mobile header, so remove existing
account footers and mobile close controls (other footer content can stay).

The callback creates several menu instances, not a singleton: load shared
identity data above `Sidebar.Provider` or inside the account component.
Scalars declared only in `Sidebar.Root.procedure` are not visible to the
mobile header in `Sidebar.MainScreen`; keep only app-specific navigation
counts there.

`Sidebar.Header` renders `shell.brand` plus collapse and mobile-close buttons.
`title` / `subtitle` set app-specific labels (omit them to show the brand name
or wordmark). Children render below the brand row (for client selectors and
similar context controls); compact actions such as a search button go in
`actions`, beside the brand and before the collapse control.

`brand.logo` is a compact symbol reused in the rail and mobile header;
`brand.wordmark` optionally supplies a full logo for the expanded header,
aspect ratio preserved. Without a compact symbol, small surfaces show
`brand.initials` (or initials derived from `brand.name`), e.g. a full logo
plus `initials: "EC"`. No automatic cropping or asset lookup is performed.

- The 48 px desktop rail shows the brand logo, swapping to the sidebar icon on
  hover or keyboard focus. With the shell, it replaces `collapsible="icon"`.
- Mobile uses a header and a full-width drawer. Menu/submenu links (even to the
  current route), route changes, and entering the desktop breakpoint close it.
- `Sidebar.Trigger` and `Sidebar.AutoTrigger` render nothing inside the shell,
  so shared pages do not duplicate controls.
- The shell keeps keyboard-inset viewport sizing, honors reduced motion, and
  still stores navigation state with the provider's cookie.

## Pinned Rail Shortcuts

Pass `rail` to `Sidebar.Root`. Use
`Sidebar.RailButton` for consistently sized icons, accessible names, right-side
tooltips, and an active-route indicator:

```tsx
<Sidebar.Root
  rail={<>
    <Sidebar.RailButton label="Orders" icon="Assignment" href="/orders" />
    <Sidebar.RailButton label="Fast Search" icon="Search" onClick={openSearch} />
  </>}
>
  {/* Header, navigation, and any expanded footer */}
</Sidebar.Root>
```

The rail uses the root's data scope and holds frequent tasks only. Wrap
permission-gated items in `Show`. `label` accepts a string or translated SQL;
`href` matches the exact path by default, so pass an `active` expression for
sections with detail routes.

Render dialogs opened from the rail outside `Sidebar.Root`, in a common parent
scope: the rail is hidden on mobile and when expanded, which would also hide
an open modal inside it.

## Localization

The shared shell and `AccountMenu` follow the language supplied through
`setUserLanguage` from `std/ictx`. English and Spanish are included, with English
as the fallback. This covers navigation buttons, tooltips, accessible labels,
the apps heading, and logout. `AccountMenu.logoutLabel` remains an optional
application override.

Set the language in the scope containing the provider; no shell label props
are needed. Add shared chrome translations for another language in
`components/navigation_text`.

## Standard Layout

```tsx
<Sidebar.Provider width={300} defaultOpen>
  <Sidebar.Root color="primary" variant="soft" collapsible="icon">
    <Sidebar.Header>
      <Typography level="title-lg">Operations</Typography>
    </Sidebar.Header>

    <Sidebar.Content>
      <Sidebar.Group label="Work" requiredPermission="orders_view">
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton href="/orders" icon="ListAlt">
              Orders
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Group>
    </Sidebar.Content>

    <Sidebar.Footer>
      <Sidebar.Settings />
    </Sidebar.Footer>
  </Sidebar.Root>

  <Sidebar.MainScreen>
    <div className="flex items-center gap-2 border-b border-divider p-3">
      <Sidebar.Trigger size="xs" />
      <Typography level="title-md">Orders</Typography>
    </div>
    <AppRoutes>{/* routes */}</AppRoutes>
  </Sidebar.MainScreen>
</Sidebar.Provider>
```

See the `Sidebar*Props` types in `components/sidebar` for exact props.
`Sidebar.Trigger` takes `size` (`xs`-`lg`), `icon`, and `desktopWhen` (a SQL
condition for showing the desktop trigger).

## Main Pieces

| Component | Use |
| --- | --- |
| `Sidebar.Provider` | wraps sidebar plus main screen and owns open/collapsed state |
| `Sidebar.Root` | sidebar panel/drawer |
| `Sidebar.Header`, `Sidebar.Content`, `Sidebar.Footer` | panel sections |
| `Sidebar.MainScreen` | page content next to the sidebar |
| `Sidebar.Trigger` | open/collapse button, usually in the page header |
| `Sidebar.Group`, `Sidebar.Menu`, `Sidebar.MenuItem` | menu structure |
| `Sidebar.MenuButton` | route link or action with optional Material icon |
| `Sidebar.Collapsible`, `Sidebar.MenuSub` | nested navigation |
| `Sidebar.Settings` | color mode/logout dropdown |
| `Sidebar.SearchTableButton`, `Sidebar.MultiTableSearchButton` | search dialog entry points |

## Navigation Rules

- `href` on menu buttons navigates.
- `requiredPermission` on `Sidebar.Group` / `Sidebar.MenuItem` hides the entry
  unless the current user has that permission.
- `collapsible="icon"` gives dense admin apps an icon rail.
- Keep the route tree in `AppRoutes`; the sidebar only navigates.

## Collapsible Sections

```tsx
<Sidebar.MenuItem>
  <Sidebar.Collapsible label="Reports" icon="Assessment" defaultOpen={sql.true}>
    <Sidebar.MenuSub>
      <Sidebar.MenuSubItem>
        <Sidebar.MenuSubButton href="/reports/sales">
          Sales
        </Sidebar.MenuSubButton>
      </Sidebar.MenuSubItem>
    </Sidebar.MenuSub>
  </Sidebar.Collapsible>
</Sidebar.MenuItem>
```

## Search And Settings

`Sidebar.SearchTableButton` (`searchDialog`) and
`Sidebar.MultiTableSearchButton` (`multiTableSearchDialog`) open the
[search dialogs](./search_dialogs.md); they take `Button` props and children.

`Sidebar.Settings` is a dropdown with a color-mode switch (cookie color
schemes only) and logout (when a logout context is provided). It shows only
while the sidebar or mobile drawer is open.

## Programmatic Control

`useSidebar()` returns `sidebarToggle`, `sidebarOpen`, and `sidebarClose`
statement helpers for event handlers.

```tsx
const sidebar = useSidebar();

<Button onClick={(s) => sidebar.sidebarToggle(s)}>
  Toggle
</Button>
```

After a mutation that changes sidebar data (such as navigation counts), call
`Sidebar.refresh(s)`; it refetches `Sidebar.Root` and any `Data` watching
`Sidebar.watchKeySql`.
