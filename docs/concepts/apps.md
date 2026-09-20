---
title: Apps
description: How to define Yolm web apps with system.app, domain files, authentication wrappers, routes, layouts, query params, and app-level state.
tags:
  - concepts
  - apps
  - domains
  - routing
  - authentication
related:
  - ui/routing.md
  - ui/sidebar.md
  - blocks/auth.md
  - ui/data.md
---

# Apps

An app is a web UI registered with `system.app(...)`. A system can define
multiple apps, usually one file per primary domain under `apps/`.

```tsx
// apps/admin.example.com.tsx
import { system } from "std/system";

system.app({
  domain: "admin.example.com",
  displayName: "Example Admin",
  ui: <AdminApp />,
});
```

Do not export an app for the framework to discover. Registration happens
through `system.app(...)`.

## File Placement

Put app definitions in `apps/<domain>.tsx`. Keep global schema, enums, blocks,
and shared system configuration in `core.tsx`.

For large apps, keep the registration file small and put screens/components in a
subfolder named after the domain:

```text
apps/admin.example.com.tsx
apps/admin.example.com/routes.tsx
apps/admin.example.com/layout.tsx
apps/admin.example.com/orders.tsx
```

## App Options Agents Usually Need

| Option | Use |
| --- | --- |
| `domain` | primary app hostname (defaults to the file stem) |
| `domainAliases` | additional hostnames for the same app |
| `displayName` | human app name used as the root document title and default PWA manifest name |
| `ui` | root node tree; required |
| `colorSchemeType` | `"light"`, `"dark"`, or `"cookie"` |
| `logoGeneration` | favicon/logo strategy; use `{ type: "Custom" }` when providing app assets yourself |
| `webAppManifest` | PWA metadata and icons |
| `fonts` | opt-in font asset IDs from the shared global font registry |
| `jsModules` | explicit bridge for external browser JavaScript |
| `viewTransitionConfig` | navigation view transitions; `{}` enables defaults |

Use `AppOpts` for the full option shape.

## Standard admin app

For the conventional database, roles, users, authentication-failure, and
block-management pages, use `adminApp` from `apps/admin`:

```tsx
import { adminApp } from "apps/admin";

adminApp({
  domain: "admin.example.com",
  links: ["/reports"],
  routes: <Route path="/reports"><ReportsPage /></Route>,
  requiredPermission: "can_access_admin_app",
  userManagement: { /* StandardUserManagementProps */ },
});
```

`domain` is required. `links` adds navbar entries, `routes` adds content to
the app's route tree, `requiredPermission` defaults to
`can_access_admin_app`, `userManagement` is forwarded to the standard user
pages, and `logoGeneration` is forwarded to the registered app. The standard
navbar also adds static/outgoing webhook links when those capabilities are
present.

## Document Titles

Set `displayName` once on the app. It becomes the root browser title and,
unless explicitly set there too, `webAppManifest.name`.

```tsx
system.app({
  displayName: "Acme Operations",
  ui: <OperationsApp />,
});
```

Full-page table components such as `DatagridPage`, `DataTablePage`,
`RecordPage`, and `AdminCrudPage` set their own titles from table metadata.
Use a route title for static screens and loading fallbacks:

```tsx
<Route path="/dashboard" title="Dashboard">
  <Dashboard />
</Route>
```

For a data-backed detail screen, place `DocumentTitle` inside the `Data` scope
that owns the display text. The app name is appended automatically.

```tsx
import { DocumentTitle } from "std/ui";

<Data procedure={(s) => s.defRecord("order", sql`select * from db.orders where id = ui.order_id`)}>
  <DocumentTitle>{sql`order.order_number`}</DocumentTitle>
  <OrderDetail />
</Data>
```

This produces a title such as `SO-1042 | Acme Operations`. A data-backed title
takes precedence over its route fallback while mounted.

## Authentication

Wrap protected app UI with an auth component from `AuthBlock`.

```tsx
<AuthBlock.DefaultEmailOtpAuth requiredPermission="orders_read">
  <AdminLayout />
</AuthBlock.DefaultEmailOtpAuth>
```

Common choices:

| Need | Use |
| --- | --- |
| OTP login | `AuthBlock.DefaultEmailOtpAuth` or `OTPAuth` |
| Email/password login | `EmailPasswordAuth` |
| Permission-gated app | `requiredPermission` on the auth wrapper |
| Permission-gated section | `AuthBlock.PermissionCheck` |
| Admin user/role screens | `StandardUserManagement`, role pages |

See [AuthBlock](../blocks/auth.md) for configuration.

## Routing And Layout

Use `Routes`, `Route`, and `AppRoutes` for URL-based UI. Layout components
usually wrap the routed content:

```tsx
function AdminApp() {
  return (
    <AuthBlock.DefaultEmailOtpAuth requiredPermission="admin_access">
      <SidebarLayout>
        <Routes>
          <Route path="/">
            <Dashboard />
          </Route>
          <Route path="/orders/{order_id:id}">
            <OrderPage />
          </Route>
        </Routes>
      </SidebarLayout>
    </AuthBlock.DefaultEmailOtpAuth>
  );
}
```

Route parameters are SQL-accessible runtime values. Keep selected record IDs,
filters, and search strings in `Data` state near the screens that use them.

## App State Pattern

Use a small root `Data local` for state shared by the layout, and nested `Data`
for screen-specific queries.

```tsx
<Data local procedure={(s) => {
  s.defScalar("sidebar_open", sql.true);
}}>
  <Routes>
    <Route path="/orders">
      <OrdersPage />
    </Route>
  </Routes>
</Data>
```

Use `Data watch` for query parameters and filters; use `Form` or event handlers
for mutations, followed by `s.refetch()` when visible query data must refresh.

## External JavaScript

Use `jsModules` only for browser features that need JavaScript beyond Yolm
components/procedures. Most framework components call `useJsModule(...)`
themselves; app-level `jsModules` is for app code or custom components:

```tsx
import { getAssetUrl } from "std/yolm_gen_api";

system.app({
  jsModules: [
    { id: "qr_scanner", assetUrl: getAssetUrl("qr_scanner.js") },
    { id: "signature_pad" },
  ],
  ui: <LoaderApp />,
});
```

Prefer existing components before adding a module.

## Global Fonts

Inter is registered and preloaded by default. Register additional shared fonts
for only the apps that use them:

```tsx
system.app({
  fonts: ["noto-sans-v42-latin", "noto-sans-v42-italic-latin"],
  ui: <ProposalApp />,
});
```

Selecting an asset registers its manifest-defined `@font-face` rules. Optional
fonts are not preloaded unless their registry entries explicitly enable it.

## Navigation View Transitions

Set `viewTransitionConfig: {}` to enable default navigation transitions. Omit
it for the platform default; use `AppOpts` for all options.

## App Vs API

| Need | Define |
| --- | --- |
| HTML/interactive UI | `system.app(...)` in `apps/` |
| External HTTP endpoint | `system.api(...)` in `apis/` |
| Shared UI route | route/component inside an app |
| Background workflow | reactor or scheduled procedure |
