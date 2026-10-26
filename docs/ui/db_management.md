---
title: DB Management Page
description: Admin page for inspecting tables, running queries, and viewing query plans against the live database.
tags:
  - ui
  - admin
  - database
  - debugging
---

# DB Management Page

`DbManagementPage` (`pages/db_management`) is a routed admin page for running
ad-hoc SQL against the system's live database. It has a query editor with
explain, metrics, and history tools, a schema and table browser, and a
virtualized result viewer.

```tsx
import { DbManagementPage } from "pages/db_management";

<DbManagementPage path="/admin/db" allow={sql`is_admin`} />
```

Props (`DbManagementPageProps`):

- `path`: the route path. Defaults to `/db-management`; the page title is
  "Database Management".
- `allow`: an optional `BooleanExpr`. The page content mounts only when it is
  true. Otherwise gate access in the surrounding app, route, or navigation.
- `wrapper`: `(children) => Node`. It wraps the content inside the page's
  `<Route>`, so you can add authorization or a layout while the page stays
  self-routing.
- `queryColumnCount` is declared but currently unused.

`DbManagement` is the same UI without the `<Route>`, for embedding in an
existing route shell.

## Related

- [Query authoring](../sql/query_planning.md): writing focused SQL queries.
- [Datagrid](./datagrid.md): user-facing tables.
