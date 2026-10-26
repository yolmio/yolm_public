---
title: Solution Page Templates
description: Solution-facing reference for routed page templates such as DatagridPage, RecordPage, form pages, reports, imports, and admin pages.
tags:
  - ui
  - pages
  - solution-patterns
  - solution-development
related:
  - ui/datagrid.md
  - ui/record_page.md
  - ui/data_table.md
  - ui/bulk_merge_import_page.md
  - ui/form.md
  - ui/routing.md
---

# Solution Page Templates

Templates in `packages/pages` cover standard routed workflows. They usually
include their own `<Route>`; do not wrap them in another `<Route>` unless the
source says it is route-less. Non-routed helper components are in the
[component catalog](./solution_components.md).

## CRUD And Record Pages

| Template | Import | Use when |
| --- | --- | --- |
| `DatagridPage` | `pages/datagrid` | Table CRUD, inline editing, saved views, filtering, sorting, bulk actions, configurable columns. |
| `RecordPage` | `pages/record_page` | Record detail page with route parameter and record context. |
| `RecordWithTabsAndDetailPage` | `pages/record_with_tabs_and_detail` | `RecordPage` with a `header`, `tabs`, and a side `details` column (`RecordWithTabsAndDetailContent` is the route-less body). |
| `InsertPage` | `pages/insert_page` | Standard `Form` create page for one table. |
| `UpdatePage` | `pages/update_page` | Standard `Form` edit page for one record. |
| `AutoInsertFormPage` | `pages/auto_insert_form` | Generated insert controls with field overrides. |
| `AutoUpdateFormPage` | `pages/auto_update_form` | Generated update controls with field overrides. |

`DatagridPage` requires `system.addDataGridTablesAndEnums([...])` in
`core.tsx`, a persistent schema change; see
[Operational UI](./operational_ui.md#pages-first). For a detail view that
keeps the grid's loaded rows, filters, and sort for Previous/Next navigation,
pass the detail node as `recordPage.content` instead of registering a separate
`RecordPage` route; for a detail page large enough to compile independently,
use `recordNavigation` with a sibling `StandaloneDatagridRecordPage`.

## Tables, Reports, And Search

| Template | Import | Use when |
| --- | --- | --- |
| `DataTablePage` | `pages/data_table_page` | Routed read-only table/report backed by SQL. |
| [`ReportsPage`](./reporting.md#reportspage) | `pages/reports_page` | Report section with sidebar navigation and relative child routes. |
| `SimpleReportsPage` | `pages/simple_reports` | Multiple simple reports or report cards. |
| `SearchCardPage` | `pages/search_card_page` | Routed search results as cards. |
| `SearchCard` | `pages/search_card_page` | Route-less inner card-search component for embedding in an existing route. |
| `BulkMergeImportPage` | `pages/bulk_merge_import` | CSV/spreadsheet import that merges rows into tables. |

## Admin Pages

| Template | Import | Use when |
| --- | --- | --- |
| `AdminCrudPage` | `pages/admin_crud_page` | Routed admin CRUD list/manage page for a table. |
| `AdminDetailPage` | `pages/admin_detail_page` | Routed admin detail page for one record. |
| `AdminRelatedTable` | `pages/admin_crud_page` | Card-wrapped related-record table for embedding in detail pages. |
| `DbManagementPage` | `pages/db_management` | Database inspection/management; gate with `AuthBlock` and high-trust permission. |
| `StaticWebhookManagementPage` | `pages/static_webhook_management` | Manually register/deregister static webhooks configured by service packages. |
| `StaticWebhookManagementPageNode` | `pages/static_webhook_management` | Route-less body for static webhook management. |
| `AuthLoginFailuresPage` | `pages/auth_login_failures` | Authentication failure records from `AuthBlock`. |
| `DefaultNotFoundPage` | `pages/default404` | Standard not-found route/page. |

Routed table templates set document titles automatically: list pages use the
table display name and `RecordPage` uses the record display name. `DatagridPage`
and `DataTablePage` accept `title` overrides; `AdminCrudPage` accepts
`documentTitle` when its visual `title` is not plain text.

## Search Card Pages

`SearchCardPage` takes a `table` and a `card` node rendered per record (under
`recordName`), with `display` `"grid"` or `"list"` and optional search,
`where`, `orderBy`, and `pageSize`. `SearchCard` takes the same props except
`path` and renders inside the current route.

## Related Admin Tables

`AdminRelatedTable` lists rows related to the current parent record: pass
`table` and `title`, plus `parentField` when there are several parent foreign
keys or `query` for a custom relationship. It takes most `DataTable` layout
options plus CRUD switches `readonly`, `insert`, `update`, `delete`, and
`detail`.

`AdminDetailPage` accepts custom tabs through the `tabs` prop. Type them with
`AdminDetailTab` from `pages/admin_detail_page`:

```tsx
import { AdminDetailPage, type AdminDetailTab } from "pages/admin_detail_page";

const tabs = [
  {
    value: "activity",
    label: "Activity",
    children: <ActivityFeed />,
  },
] satisfies AdminDetailTab[];

<AdminDetailPage table="customers" tabs={tabs} defaultTab="activity" />
```

An `AdminDetailTab` has a stable `value`, a `label` node, and `children` for
the tab body. `defaultTab` must match either a custom tab `value` or one of the
built-in tab values.

## Rules

- Keep app routes in `apps/$DOMAIN.tsx`; compose templates there.
- Build custom `Data` + [Form](./form.md) pages only when no template shape
  fits the workflow.
- Do not import `pages/datagrid_internals/*` in new code; use `DatagridPage`
  and its documented props.
