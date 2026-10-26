---
title: Routing
description: How to use Yolm Route, Routes, and AppRoutes for URL navigation, typed route params, query params with Data, self-routing pages, and route wrappers.
tags:
  - ui
  - routing
  - navigation
  - urls
related:
  - concepts/apps.md
  - ui/record_grid.md
  - ui/data.md
---

# Routing

Use `Route`, `Routes`, and `AppRoutes` for URL-addressable UI. Use local
`Data` state for modals, tabs, filters, and other page-local state that should
not be a URL.

```tsx
import { AppRoutes, Redirect, Route, Routes } from "std/ui";
```

Reusable page components can call `useRoute(pathOrOptions)` from `std/ui` to
wrap themselves in a route:

```tsx
import { useRoute } from "std/ui";

function CustomerListPage() {
  useRoute({ path: "/customers", exact: true });
  return <CustomerList />;
}
```

## Basic App Routes

```tsx
<AppRoutes>
  <Route path="/" title="Dashboard">
    <Dashboard />
  </Route>
  <Route path="/orders/{order_id:id}" title="Order">
    <OrderPage />
  </Route>
  <DataTablePage table="customers" />
</AppRoutes>
```

`AppRoutes` wraps `Routes` and provides a default 404. `Routes` matches route
children by specificity.

`Route.title` sets the document title while the route is active and appends the
current app's `displayName`. It is especially useful for static pages and as a
loading fallback for detail pages. A nested `DocumentTitle` can replace it once
record data is available.

## Redirects

Render `Redirect` where a route or conditional branch should navigate
elsewhere:

```tsx
<Route path="/old-dashboard">
  <Redirect to="/dashboard" />
</Route>

<Authorize
  procedure={(s) => {
    // authorization statements
  }}
  unauthorized={<Redirect to="/login" />}
>
  <Account />
</Authorize>
```

On an initial server render, `Redirect` returns an HTTP 307 response. In the
browser, an app-local target uses client navigation without painting the
abandoned page. Absolute `http:` and `https:` targets perform a full-document
navigation, including cross-origin URLs.

`replace` controls browser history and defaults to `true`; it has no effect on
the HTTP response:

```tsx
<Redirect to="https://accounts.example.com/connect" replace={sql`false`} />
```

The target must be a non-null app-local path beginning with `/` or an absolute
HTTP(S) URL. Fragments are not supported. A redirect to the current URL,
multiple active redirects in one render, and a null target are application
errors. Put conditional redirect logic in `Show`, `Switch`, `Authorize`, or a
route branch. When an external target comes from user-controlled data, validate
it against an application allowlist to avoid creating an open redirect.

## Path Parameters

Route params become SQL scalars inside the route.

```tsx
<Route path="/users/{user_id:id}">
  <Data procedure={(s) => {
    s.defRecord("user_record", sql`select * from db.users where id = user_id`);
  }}>
    <span>{sql`user_record.name`}</span>
  </Data>
</Route>
```

Common param types: `id`, `bigint`, `int`, `uuid`, and `string`. If no type is
specified, the value is a string.

## Self-Routing Pages

Many page primitives return their own route. Use them directly:

```tsx
<AppRoutes>
  <DatagridPage table="users" />
  <RecordPage table="users">
    <UserDetail />
  </RecordPage>
</AppRoutes>
```

Do not wrap self-routing pages in another `Route`.

When a datagrid detail page needs previous/next navigation over the active
loaded grid rows, pass the detail content through `DatagridPage.recordPage`
as its `content` field instead of registering a sibling `RecordPage`. The datagrid then owns both its
base path and `/{record_id}` sub-path under one transient state boundary. A
direct detail URL has no navigation controls because it has no such context.

## Query Parameters

Use `Data queryParams` for bookmarkable filters.

```tsx
<Data
  queryParams={{
    search: { default: sql.lit``, type: "String" },
    page: { default: sql`1`, type: "BigInt" },
  }}
  procedure={(s) => {
    s.defTable("results", sql`
      select * from db.items
      where name like '%' || search || '%'
      limit 25 offset (page - 1) * 25
    `);
  }}
>
  <Results />
</Data>
```

Use `default`, not `expr`, in `queryParams`. Query-param scalars, like other
`Data` state, are visible to that `Data` and its descendants, including nested
routes. The low-level `QueryParams` node and `useQueryParams` hook (array of
`{ name, type, default }`) exist for package primitives; solution code should
use `Data` `queryParams`.

Every write to a query-param scalar updates the URL: `s.setScalar`,
`bindScalar`, and `s.setQueryParam` all behave the same. By default a write
replaces the current history entry, which is right for filters, search, sort,
and paging. Declare `history: "push"` on navigation-like state where the
browser Back button should step back, such as page-like tabs or folder
navigation:

```tsx
<Data
  queryParams={{
    search: { default: sql.lit``, type: "String" },
    tab: { default: sql.lit`overview`, type: "String", history: "push" },
  }}
>
  <Results />
</Data>
```

`s.setQueryParam(param, value, replace)` can still override the history mode
for one write.

## Returning to a List

A link back to a list or parent page should set `backLink`. It is supported on
`Link`, `Button`, `IconButton`, and `ListItemButton`, and requires `href`.
When the user came from that page, the link returns to the most recent earlier
history entry whose path exactly matches `href`'s path, restoring that entry's
query string (filters, search, paging) and scroll position. With no matching
entry, such as a fresh tab, or without the Navigation API, it is a plain link to
`href`. Older runtimes treat it as a plain link. Hover, focus, and press
rewrite the rendered `href` to the resolved URL, so middle-click and copy-link
carry the filters.

Keep the list's filters in `Data queryParams` (not local `defScalar` state) so
there is something to restore.

```tsx
// List page at /issues
<Data
  queryParams={{ status: { default: sql.lit`open`, type: "String" } }}
  procedure={(s) => {
    s.defTable("issues", sql`select * from db.issues where status = status`);
  }}
>
  <Input
    value={sql`status`}
    onInput={(s) => s.setScalar("status", sql`target_value`)}
  />
  <Each table="issues" recordName="issue">
    <Link href={sql`'/issues/' || issue.id`}>{sql`issue.title`}</Link>
  </Each>
</Data>

// Detail page at /issues/{issue_id:id}
<Button href="/issues" backLink startIcon="ArrowBack" variant="plain">
  Issues
</Button>
```

The path match is exact, including IDs: a link to `/projects/12/parts` returns
only to an earlier `/projects/12/parts` entry, and `/issues/` does not match
`/issues`.

Do not use `backLink` for sidebar or nav items, breadcrumbs (a fixed
hierarchy, not history), forward navigation, in-page "back" state driven by
`setScalar` such as wizard steps or panels, buttons that do work before
navigating, external links, or links whose target is chosen by explicit
return-source logic.

## Route Wrappers

Use wrappers for repeated layout/auth around a set of routes.

```tsx
function AdminRoute({ children }: { children: Node }) {
  return (
    <AuthBlock.DefaultEmailOtpAuth requiredPermission="admin_access">
      <Sidebar.Provider>{children}</Sidebar.Provider>
    </AuthBlock.DefaultEmailOtpAuth>
  );
}

<AppRoutes>
  <Route path="/admin">
    <AdminRoute>
      <AdminDashboard />
    </AdminRoute>
  </Route>
</AppRoutes>
```

## Mistakes

- Wrapping `RecordPage`, `DatagridPage`, or `DataTablePage` in manual `Route`.
- Using routes for transient UI state such as open dialogs.
- Using local state for pages users should bookmark/share.
- Using `expr` instead of `default` in `Data queryParams`.
- Reading route params from JavaScript variables instead of SQL scalars.
- Hardcoding a back link to a list without `backLink`, which drops the list's
  filters and scroll.
- Using `s.history.back()` to return to a list; it is not a reliable return
  target. Use `backLink`.
- Keeping list filters in local `defScalar` state instead of `queryParams`.
- Declaring `history: "push"` on filters or search, which floods history.
