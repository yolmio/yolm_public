---
title: Operational UI Components
description: Concise guide to Yolm components and page primitives for admin apps, work queues, dialogs, exports, loading states, and dense operational screens.
tags:
  - ui
  - components
  - work-queue
  - admin
  - dialogs
related:
  - ui/data.md
  - ui/form.md
  - ui/record_grid.md
  - ui/data_table.md
  - ui/mobile_capture_scanning.md
  - ui/sidebar.md
  - api/files_blobs_exports.md
  - concepts/operational_systems.md
---

# Operational UI Components

Use this guide for dense internal apps: queues, review screens, admin CRUD,
management pages, exports, and workflow actions. Use the exported TypeScript
types for exact prop contracts.

For dense admin CRUD screens, combine `DataTable` record lists, generated
`AutoInsert` / update / delete dialogs, `TableRecordSelect` or `QueryCombobox`
for searchable foreign-key selectors, and `DownloadButton` for CSV exports.

## Page Primitives

- `RecordPage` from `pages/record_page` for a detail route backed by one table
  record and current-record context.
- `InsertPage` and `UpdatePage` from `pages/insert_page` /
  `pages/update_page` for standard CRUD pages with `Form` handling.
- `DatagridPage` from `pages/datagrid` for configurable table views. Call
  `system.addDataGridTablesAndEnums([...])` in `core.tsx` for tables that need
  saved view names.
- `DbManagementPage` from `pages/db_management` for admin database management
  surfaces.
- `AuthBlock` admin pages for users, roles, and auth-related management.
- `QrScanner`, `ExpandableImage`, and `ImageGallery` for mobile scan/capture
  workflows and photo review.

Use page primitives first. Build custom `Data` + `Form` pages when the workflow
has custom state, multiple tables, or task-specific layout.

## WorkQueue

Import `WorkQueue` from `components/work_queue` for a split queue/detail
workflow with row selection in the URL, keyboard navigation, sortable columns,
and an optional footer detail panel.

```tsx
<WorkQueue.Root
  query={sql`
    select id, received_at, status, assigned_to
    from db.tasks
    where status in ('new', 'pending')
    order by received_at
  `}
  rowKey="id"
  emptyMessage="No work is waiting"
>
  <WorkQueue.Header>
    {(_selected, count) => <Typography level="title-md">{count} open</Typography>}
  </WorkQueue.Header>
  <WorkQueue.Table>
    <WorkQueue.Column field="received_at" format="datetime" width={180} />
    <WorkQueue.Column field="status" />
  </WorkQueue.Table>
  <WorkQueue.Footer height={360} resizable>
    {(selected) => <TaskDetail taskId={sql`${selected}.id`} />}
  </WorkQueue.Footer>
</WorkQueue.Root>
```

The query must include `rowKey`. WorkQueue infers columns from the query; add
`WorkQueue.Column` children when you need custom labels, formatting, widths, or
ordering. Use `conditionalFilters` for optional predicates that should be
appended only when their `when` expression is true. Filter clauses are
predicates over the projected query columns and scoped SQL values.

```tsx
conditionalFilters={[
  {
    when: sql`ui.assigned_only`,
    clause: sql`assigned_to = ui.current_user_id`,
  },
]}
```

## Record Actions

Use context-aware actions inside record pages, datagrids, menus, and detail
panels:

- `AutoInsertDialog`, `AutoInsertButton`, `AutoInsertIconButton`, and
  `AutoInsertMenuItem` from `components/auto_insert_dialog`.
- `DeleteRecordDialog`, `DeleteRecordButton`, `DeleteRecordIconButton`, and
  `DeleteRecordMenuItem` from `components/delete_record_dialog`.
- `DownloadButton` from `components/download_button` for CSV exports from a
  SQL query.

These components can resolve current table/record context. Pass `table`,
`recordId`, parent fields, or values explicitly when the action is outside a
record context.

## Menus And Compact Actions

Use `Menu` from `components/menu` for grouped row actions:

```tsx
<Menu>
  <Menu.Button variant="plain" size="sm" endIcon="MoreVert">
    Actions
  </Menu.Button>
  <Menu.Content>
    <AutoInsertMenuItem table="notes">Add note</AutoInsertMenuItem>
    <DeleteRecordMenuItem />
  </Menu.Content>
</Menu>
```

Use icon buttons with tooltips for repeated table actions. Keep destructive
actions behind confirmation dialogs.

## Inputs For Operational Forms

- `EnumSelect` from `components/enum_select` renders enum variants with labels
  and colors from `system.enum_`.
- `TableRecordSelect` and `QueryCombobox` are the default foreign-key and lookup
  controls.
- `FieldFormControl`, `LabelOnTopFormField`, and
  `LabelOnLeftFormField` are useful inside `Form.Field` when generated field
  metadata should drive labels, errors, and default input selection.
- `InlineRecordDisplay` and `InlineFieldDisplay` render record references and
  typed field values in compact summaries.

## Loading And Progressive Disclosure

- `Skeleton` from `components/skeleton` is the preferred pending UI for dense
  dashboards and cards.
- `CollapseControl` from `components/collapse_component` hides optional detail
  sections without adding route state.
- `Progress` indicators or compact status chips work well for step-by-step
  physical workflows where users need to see the current phase.
- `Tabs`, `Card`, `Sheet`, `Table`, `DataTable`, and `StatRow` compose dense
  management screens. Prefer `DataTable` for record lists and `Table` for fully
  custom markup.

## Navigation Shells

Use `Sidebar` for multi-section operational apps and `Navbar` for simpler admin
or utility apps. Keep route registration in `AppRoutes`, and put app-specific
permissions in the auth wrapper rather than inside individual page components.
