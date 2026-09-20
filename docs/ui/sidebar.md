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

Use `Sidebar` for multi-section apps that need persistent navigation,
collapsible menus, mobile drawer behavior, settings, and search shortcuts.

```tsx
import { Sidebar, useSidebar } from "components/sidebar";
```

## Shared Navigation Shell

Use the opt-in `shell` provider option to give the shell ownership of navigation
controls and account placement. Existing providers without `shell` keep their
page-owned controls and collapse behavior.

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
    <Sidebar.Header title="Back Office" subtitle="Example Company" />
    <Sidebar.Content>{/* Existing navigation groups and links */}</Sidebar.Content>
  </Sidebar.Root>
  <Sidebar.MainScreen>{routes}</Sidebar.MainScreen>
</Sidebar.Provider>
```

The `account` callback runs at generation time and receives `compact` and
`placement`; forward them to the shared `AccountMenu`. Keep user expressions,
app permissions and URLs in the system's account wrapper.
The shell inserts the full account menu at the bottom of the expanded sidebar
and drawer, and compact menus in the desktop rail and mobile header. Remove
existing account footers and mobile close controls when adopting it. Other
footer content, such as clock-in actions, can remain.

The callback creates several menu instances; it is not a singleton. Load shared
identity data above `Sidebar.Provider`, or let the account component load its own
data. Scalars declared only in `Sidebar.Root.procedure` are unavailable to the
mobile header in `Sidebar.MainScreen`. Keep app-specific navigation counts in
the root's procedure.

`Sidebar.Header` renders branding from `shell.brand` and adds collapse and
mobile-close buttons. Pass `title` and optionally `subtitle` for app-specific
labels; omit them to show the brand name or full wordmark. Header children are
rendered below the brand/control row, with automatic header height. Use them
for client selectors or other context controls. Put compact header actions,
such as Spark's search button, in `actions`; they appear beside the brand and
before the shared collapse control.

`brand.logo` is a compact symbol, reused in the rail and mobile header.
`brand.wordmark` optionally supplies a full logo for the expanded brand-only
header; its aspect ratio is preserved. If no compact symbol is supplied, those
small surfaces display `brand.initials` (or initials derived from `brand.name`)
instead of shrinking a detailed wordmark into an unreadable square.

For example, an app can use an existing square logo or provide a compact symbol
and full wordmark separately. A company can supply its full logo with
`initials: "EC"` until a dedicated compact asset is available. No automatic
cropping or asset lookup is performed.

The 48 px desktop rail shows the brand logo, swapping to the sidebar icon on hover or keyboard focus.
Mobile uses a header and a full drawer. Menu and submenu links dismiss the
drawer, including same-route selections; route changes also dismiss it. The
drawer closes when the viewport enters the desktop breakpoint. Its contents
fit the available mobile width even when the desktop sidebar is wider.
`Sidebar.Trigger` and `Sidebar.AutoTrigger` render nothing inside this shell,
so shared pages do not create duplicate controls.

The shell preserves keyboard-inset viewport sizing and honors reduced motion.
It uses a single width transition, and replaces `collapsible="icon"` with the
compact brand/account rail when enabled. Navigation state still uses the
existing provider and cookie mechanism.

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

The rail uses the root's data scope. Keep the rail focused on frequent tasks;
the expanded sidebar remains the full navigation. Wrap permission-gated items
in `Show`. Labels accept strings or translated SQL expressions. Links match
exact paths by default; use `active` for sections with detail routes.

Render dialogs opened by shortcuts outside `Sidebar.Root`, in a common parent
state scope. The rail is hidden on mobile and when expanded; putting a modal
inside it would also hide the open modal during a viewport change.

## Localization

The shared shell and `AccountMenu` follow the language supplied through
`setUserLanguage` from `std/ictx`. English and Spanish are included, with English
as the fallback. This covers navigation buttons, tooltips, accessible labels,
the apps heading, and logout. `AccountMenu.logoutLabel` remains an optional
application override.

Set the language in the scope containing the provider and render translated app
titles and navigation items as usual. An app that sets this context from the
person's preferred language needs no shell label props. Add shared chrome
translations in `components/navigation_text` when supporting another language.

## Standard Layout

```tsx
<Sidebar.Provider width={300} defaultOpen>
  <Sidebar.Root color="primary" variant="soft" collapsible="icon">
    <Sidebar.Header>
      <Typography level="title-lg">Operations</Typography>
    </Sidebar.Header>

    <Sidebar.Content>
      <Sidebar.Group label="Work">
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton href="/" icon="Dashboard">
              Dashboard
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
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

Use the exported TypeScript props for exact props.

`Sidebar.Trigger` accepts the shared `Size` values: `"xs"`, `"sm"`, `"md"`,
and `"lg"`.

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

- Use `href` on menu buttons for route navigation.
- Use `requiredPermission` on groups/items for permission-gated navigation.
- Use `collapsible="icon"` for dense admin apps where users benefit from an
  icon rail.
- Keep the route tree in `AppRoutes`/`Routes`; keep the sidebar focused on
  navigation.

```tsx
<Sidebar.Group label="Admin" requiredPermission="users_manage">
  <Sidebar.Menu>
    <Sidebar.MenuItem>
      <Sidebar.MenuButton href="/admin/users" icon="Group">
        Users
      </Sidebar.MenuButton>
    </Sidebar.MenuItem>
  </Sidebar.Menu>
</Sidebar.Group>
```

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

Use search buttons for operational apps where users frequently jump to records:

```tsx
<Sidebar.SearchTableButton
  searchDialog={{ table: "orders", displayValues: ["order_number"] }}
  startIcon="Search"
>
  Search Orders
</Sidebar.SearchTableButton>
```

`Sidebar.Settings` is useful when the app supports color-mode changes or logout
from the nav shell.

## Programmatic Control

Use `useSidebar()` only when an event handler must open/close/refresh the
sidebar directly.

```tsx
const sidebar = useSidebar();

<Button onClick={(s) => sidebar.sidebarToggle(s)}>
  Toggle
</Button>
```

Use `Sidebar.refresh(s)` after a mutation if sidebar data is backed by a `Data`
query watching `Sidebar.watchKeySql`.
