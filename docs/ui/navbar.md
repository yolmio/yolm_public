---
title: Navbar
description: Responsive top navigation bar with links, dropdown menus, search dialog, and a primary action button, plus TransparentNavbar for landing pages.
tags:
  - ui
  - components
  - navbar
  - navigation
related:
  - ui/overview.md
  - ui/search_dialogs.md
  - ui/button.md
  - ui/site_pages.md
  - ui/solution_components.md
---

# Navbar

`Navbar` is the standard top navigation bar for an in-app UI. It renders a Home
link, a horizontal row of navigation links (with optional dropdown menus), an
optional primary action button, an optional global search dialog, and a settings
drawer. On small screens it collapses into a hamburger menu drawer.

Place it once at the top of an app's UI, as a sibling of `AppRoutes` (not inside
a `Route`). For marketing / landing pages use `TransparentNavbar` instead.

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

A plain string link (e.g. `"/orders"`) becomes a link to that URL with a label
auto-derived from the path (split on `-` and `/`, each word title-cased, so
`"/time-entries"` renders as `Time Entries`).

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `variant` | `"soft" \| "solid"` | No | Visual variant. Default `"solid"`. |
| `color` | `ColorPaletteProp` | No | Theme color (`neutral`, `primary`, `success`, `warning`, `danger`). Default `"neutral"`. |
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | No | Size of the nav controls. Default `"sm"`. |
| `links` | `(string \| LinkItem \| LinkItemWithChildren)[]` | No | Navigation links. See link shapes below. |
| `linkAlignment` | `"left" \| "center" \| "right"` | No | Horizontal alignment of the desktop link row. Default `"left"`. |
| `primaryActionButton` | `ButtonProps` | No | A prominent action button on the right. Accepts the full [`Button`](./button.md) prop set. |
| `searchDialog` | `{ table: string; displayValues?: (string \| TableSearchDisplay)[] }` | No | Adds a single-table search dialog and a search button. |
| `multiTableSearchDialog` | `{ tables: MultiTableSearchDialogTable[] }` | No | Adds a cross-table search dialog and a search button. |
| `manual` | `boolean` | No | When `false` (default) the navbar also appends links registered through the shared navigation context. Set `true` to control links explicitly. |
| `className` | `string` | No | Class for the root `<nav>`. |
| `sx` | `Style` | No | Style overrides for the root `<nav>`. |

`variant`, `color`, `size`, and `linkAlignment` are generation-time strings, not
SQL expressions. They cannot be computed at runtime.

### Link shapes

`links` entries can be a string, a `LinkItem`, or a `LinkItemWithChildren`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | `string` | Yes (LinkItem) | Destination path. |
| `label` | `string` | No (LinkItem) / Yes (with children) | Display text. Derived from `url` when omitted. |
| `showIf` | `BooleanExpr` | No | SQL boolean controlling whether the link is shown. |
| `children` | `(string \| LinkItem)[]` | Yes (LinkItemWithChildren) | Sub-links rendered as a hover/keyboard dropdown menu. |

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

Pass `searchDialog` for a single table or `multiTableSearchDialog` for several
tables. Either one adds a search button to the navbar (labeled `Find {table}…`
for a single table, otherwise `Search…`) and wires up the **Ctrl/Cmd + K**
shortcut. The two props are mutually exclusive — supplying both throws at
generation time. See [Search dialogs](./search_dialogs.md) for the `table`,
`displayValues`, and `tables` configuration in full.

### Responsive behavior

- On large screens the links render as a horizontal row with dropdown menus for
  entries that have `children`.
- Below the `lg` breakpoint the links collapse behind a hamburger button that
  opens a left-side `Drawer`; entries with children expand inline.
- A settings drawer button is always rendered on the right.
- Both layouts support arrow-key navigation between links and child links.

## TransparentNavbar

`TransparentNavbar` (from `components/transparent_navbar`) is a marketing-style
navbar that starts transparent over a hero image and fades to a solid surface as
the user scrolls past 20px. Use it on landing pages, typically paired with a
`Footer`; for in-app navigation use `Navbar`.

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

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `logoIcon` | `({ sx?, className? }) => Node` | Yes | Render function for the logo mark; receives `sx` / `className`. |
| `logoText` | `Node` | No | Brand text beside the logo (hidden on `xs`). |
| `links` | `Array<{ label: string; href?: string; children?: { label: string; href: string }[] }>` | Yes | Nav links; entries with `children` render a dropdown. |
| `primaryActionButton` | `{ label: string; href: string; variant?: "solid" \| "outlined" \| "soft" }` | No | Right-aligned CTA. `variant` defaults to `"solid"`. |
| `positionFixed` | `boolean` | No | Use absolute positioning instead of fixed (ignored when `hideOnScrollDown` is set). |
| `textColor` | `string` | No | Override the logo and link text color. |
| `navZIndex` | `number` | No | Override the nav z-index. Default `1100`. |
| `navBackground` | `string` | No | Override the initial (pre-scroll) nav background color. |
| `idPrefix` | `string` | No | Prefix element IDs to avoid collisions when multiple navbars exist. |
| `extraDesktopContent` | `Node` | No | Extra content rendered after the links and CTA on desktop. |
| `hideOnScrollDown` | `boolean` | No | Hide the nav on scroll down and reveal it on scroll up. |

When the app uses cookie-based color schemes, `TransparentNavbar` also renders a
light/dark mode toggle button.

## Common Mistakes

- Passing both `searchDialog` and `multiTableSearchDialog` — they are mutually
  exclusive and throw at generation time. Pick one.
- Wrapping `Navbar` in a `<Route>`. It is not self-routing; place it once at the
  top of the app UI as a sibling of `AppRoutes`.
- Trying to compute `variant`, `color`, `size`, or `linkAlignment` from SQL.
  These are generation-time strings only; use a link's `showIf` for runtime
  visibility.
- Mixing up the link field names: `Navbar` links use `url`, while
  `TransparentNavbar` links use `href`.
- For `Navbar.primaryActionButton`, the label goes in `children` (it is the full
  `Button` prop set). For `TransparentNavbar.primaryActionButton`, use the
  `{ label, href, variant }` object instead.
- Passing `className` or `sx` to `MaterialIcon` inside `logoIcon` — `MaterialIcon`
  only accepts `icon`, `color`, `fontSize`, and `title`. Forward the received
  `className`/`sx` to a wrapping element (e.g. a `<span>`) instead.
- Using `TransparentNavbar` for in-app navigation. It is built for marketing /
  landing pages — use `Navbar` inside the application.
