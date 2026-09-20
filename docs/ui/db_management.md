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

`pages/db_management` exports `DbManagementPage` — an admin-style page for
running ad-hoc SQL against the system's live database. It exposes:

- A query editor with tabbed tools for explain, metrics, and history.
- A schema / table browser.
- A scrollable, virtualized result viewer.

## When to use

Mount this page in an admin app so operators can run queries without leaving
the UI. Gate access with the `allow` prop (below) or in the surrounding app,
route, or navigation before rendering the page.

## Setup

```tsx
import { DbManagementPage } from "pages/db_management";

<DbManagementPage path="/admin/db" />
```

## Props

- `path` — route path (defaults to `/db-management`).
- `allow` — optional `BooleanExpr`; the page is only mounted when it is true.
- `queryColumnCount` — number of columns rendered in the query result table.

## Inner component

Use `DbManagement` (the inner component, without the `<Route>`) when embedding
the management UI inside an existing route shell. Most callers should use the
routed `DbManagementPage`.

## Related

- [Query authoring](../sql/query_planning.md) — write focused SQL queries
- [Datagrid](./datagrid.md) — for user-facing tables
