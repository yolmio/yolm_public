---
title: Navbar
description: Responsive top navigation bar with links, dropdown menus, search dialog, and a primary action button, plus TransparentNavbar for landing pages.
tags:
  - ui
  - components
  - navbar
  - navigation
related:
  - ui/sidebar.md
  - ui/search_dialogs.md
  - ui/button.md
  - ui/site_pages.md
  - ui/solution_components.md
---

# Navbar

`Navbar` is the in-app top bar: a Home link, navigation links with optional
dropdowns, an optional primary action button and search dialog, and a settings
drawer. Place it once, as a sibling of `AppRoutes`. For landing pages use
[`TransparentNavbar`](#transparentnavbar).

```tsx
import { Navbar } from "components/navbar";
import { TransparentNavbar } from "components/transparent_navbar";
```

## Usage

```tsx
import { Navbar } from "components/navbar";
import { MaterialIcon } from "components/material_icon";

system.app({
  ui: (
    <>
      <Navbar
        color="primary"
        variant="solid"
        links={["/orders", "/customers", "/products", "/reports"]}
        primaryActionButton={{
          color: "harmonize",
          variant: "solid",
          size: "sm",
          children: sql.lit`Add Order`,
          href: sql.lit`/orders/add`,
          startDecorator: <MaterialIcon icon="Add" />,
        }}
        multiTableSearchDialog={{
          tables: [
            { name: "customers", icon: "Person", displayValues: ["contact_name"] },
            { name: "products", icon: "Inventory" },
          ],
        }}
      />
      <AppRoutes>{/* routes */}</AppRoutes>
    </>
  ),
});
```

A string link's label is derived from the path (split on `-` and `/`,
title-cased): `"/time-entries"` renders `Time Entries`.

## Props

See `NavbarProps` in `components/navbar` for the full contract. `variant`
(`soft` / `solid`, default `solid`), `color` (default `neutral`), `size`
(default `sm`), and `linkAlignment` (`left` default, `center`, `right`) are
static generation-time strings that follow the shared
[styling props](./styling.md#color-variant-and-size); use a link's `showIf`
for runtime visibility. Non-obvious props:

- `primaryActionButton` - full [`Button`](./button.md) props; the label goes
  in `children`.
- `searchDialog` / `multiTableSearchDialog` - add a search button and dialog
  (see below).
- `manual` - when `false` (default) the navbar also appends links registered
  through the shared navigation context (for example by page templates). Set
  `true` to show only `links`.

### Link shapes

`links` entries are a string, a `LinkItem` (`url`, optional `label` and
`showIf`), or a `LinkItemWithChildren` (`label`, `children` of strings or
`LinkItem`s, optional `showIf`) rendered as a dropdown. `showIf` is a SQL
boolean.

```tsx
<Navbar
  links={[
    "/contacts",
    { url: "/matters", label: "Cases", showIf: sql`global.can_view_matters` },
    {
      label: "Reports",
      children: [
        "/reports/coverage",
        { url: "/reports/tat", label: "TAT" },
      ],
    },
  ]}
/>
```

### Search dialog

Pass `searchDialog` for one table or `multiTableSearchDialog` for several. Either
adds a search button (`Find {table}…` or `Search…`) and the **Ctrl/Cmd + K**
shortcut; supplying both throws at generation time. Configuration is in
[Search dialogs](./search_dialogs.md).

### Responsive behavior

From `lg` up, links render as a row with dropdowns for entries with
`children`; below `lg` they move into a left-side `Drawer` behind a hamburger
button, with children expanded inline. A settings drawer button is always on
the right, and both layouts support arrow-key navigation.

## TransparentNavbar

`TransparentNavbar` is a landing-page navbar that starts transparent over a
hero and turns solid once the page scrolls past 20px.

```tsx
import { TransparentNavbar } from "components/transparent_navbar";
import { MaterialIcon } from "components/material_icon";

<TransparentNavbar
  logoIcon={({ className }) => (
    <span className={className}>
      <MaterialIcon icon="Bolt" />
    </span>
  )}
  logoText="Acme"
  links={[
    { label: "Features", href: "/features" },
    {
      label: "Resources",
      children: [
        { label: "Blog", href: "/blog" },
        { label: "Docs", href: "/docs" },
      ],
    },
  ]}
  primaryActionButton={{ label: "Sign up", href: "/signup" }}
  hideOnScrollDown
/>
```

See `TransparentNavbar` props in `components/transparent_navbar`. Note that
`logoIcon` is a render function receiving `sx` / `className`; `links` use
`href` (not `url`); `primaryActionButton` is `{ label, href, variant? }`
(`variant` default `solid`). The nav is `absolute` by default;
`positionFixed` or `hideOnScrollDown` makes it `fixed`, and `positionFixed`
also disables the solid scrolled background. `navZIndex` defaults to `1100`; and
`idPrefix` avoids element ID collisions when several navbars exist.
`textColor`, `navBackground`, and `extraDesktopContent` customize the look.

When the app uses cookie-based color schemes, `TransparentNavbar` also renders a
light/dark mode toggle button.

## Common Mistakes

- Wrapping `Navbar` in a `<Route>`. Place it once at the top of the app UI as a
  sibling of `AppRoutes`.
- Mixing link shapes: `Navbar` links use `url` and a `Button`-style
  `primaryActionButton` (label in `children`); `TransparentNavbar` links use
  `href` and `primaryActionButton` is `{ label, href, variant }`.
- Passing the received `className` / `sx` to `MaterialIcon` inside `logoIcon`;
  it accepts only `icon`, `color`, `fontSize`, and `title`, so forward them to
  a wrapping element.
