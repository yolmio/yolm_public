---
title: Operational UI Components
description: Guidance for dense operational screens in Yolm admin apps - work queues, CRUD lists, record actions, foreign-key selectors, exports, and loading states.
tags:
  - ui
  - components
  - work-queue
  - admin
  - dialogs
related:
  - ui/solution_components.md
  - ui/page_templates.md
  - ui/data_table.md
  - ui/mobile_capture_scanning.md
  - api/files_blobs_exports.md
  - concepts/operational_systems.md
---

# Operational UI Components

Guidance for dense internal screens: queues, review screens, admin CRUD, and
exports. Imports for every component are in the
[component catalog](./solution_components.md).

For dense admin CRUD screens, combine `DataTable` record lists, generated
`AutoInsert` / update / delete dialogs, `TableRecordSelect` or `QueryCombobox`
for searchable foreign-key selectors, and `DownloadButton` for CSV exports.

## Pages First

Start from a [page template](./page_templates.md) (`DatagridPage`,
`RecordPage`, `InsertPage` / `UpdatePage`, `AdminCrudPage`,
`DbManagementPage`) and build custom `Data` + `Form` pages only when the
workflow has custom state, several tables, or a task-specific layout.

`DatagridPage` needs its saved-view schema. Call
`system.addDataGridTablesAndEnums([...])` in `core.tsx` with every datagrid
name (defaults to the table name). It is an opt-in, persistent schema change:
it adds the system db tables `datagrid_views`, `datagrid_view_columns`, and
`datagrid_view_filter_terms` and the `datagrid_name` enum, and adds each name
as a variant. `DatagridPage` throws at generation time when the tables or its
name are missing (`pages/datagrid_internals/db_state.ts`).

## WorkQueue

`WorkQueue` (`components/work_queue`) is a split queue/detail workflow: the
selected row lives in the URL (`wq_selected_id`), with keyboard navigation
(Up/Down move, Escape clears; ignored while focus is on an interactive element),
click-to-sort column headers, and an optional footer detail panel.

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
  conditionalFilters={[
    { when: sql`ui.assigned_only`, clause: sql`assigned_to = ui.current_user_id` },
  ]}
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

- The query must select `rowKey`; the selection query param is a `BigInt`.
- Only declared `WorkQueue.Column` entries render, in declaration order;
  fields missing from the query are skipped. `format` is `date`, `datetime`,
  `currency`, `decimal`, or `percent`; a function child renders the cell.
- `conditionalFilters` clauses are appended only while `when` is true; they are
  predicates over the projected columns and scoped SQL values.
- Query inputs are watched automatically (`autoWatch`, default true). With
  `autoWatch={false}`, list every UI input in `watch`.
- `WorkQueue.Footer` defaults to height 280; `resizable` uses `minHeight` 100
  and `maxHeight` 600 unless set.
- In an action handler, call `WorkQueue.advanceToNext(s)` after completing the
  current item to remove it locally and select the next row;
  `WorkQueue.showAlert(s, message, color?)` (`success` default, `danger`,
  `warning`) writes to the queue's status bar.

## Record Actions And Menus

Use the generated CRUD dialogs and their button/icon/menu-item triggers
([Auto dialogs](./auto_dialogs.md), `DeleteRecord*`), and
[ActionButton](./action_button.md) for commands such as approve or archive.
Group row actions in a `Menu`:

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

These resolve the current table/record context; pass `table`, `recordId`, or
parent fields explicitly outside it.

## Operational Forms

`TableRecordSelect` and `QueryCombobox` are the default foreign-key and lookup
controls; `EnumSelect` renders enum labels and colors from `system.enum_`.
Inside `Form.Field`, `FieldFormControl`, `LabelOnTopFormField`, and
`LabelOnLeftFormField` let field metadata drive labels, errors, and the input
type. Use `InlineRecordDisplay` / `InlineFieldDisplay` for compact summaries.

## Loading And Progressive Disclosure

- `Data` shows a `CircularProgress` (size `sm`) while loading by default. For
  dense dashboards and cards, pass a sized `Skeleton` from
  `components/skeleton` as `pendingFallback` so the layout does not jump.
  `Skeleton` takes `variant` (`rectangular` default, `circular`, `text`),
  `animation` (`pulse` default, `wave`), and `level` to match a typography
  line height. `pendingFallback={null}` renders nothing.
- `CollapseControl` hides optional detail sections without route state.
- Prefer `DataTable` for record lists and `Table` for fully custom markup.

```tsx
<Data
  procedure={(s) => s.defScalar("open_count", sql`(select count(*) from db.tasks)`)}
  pendingFallback={<Skeleton className="h-24 w-full rounded-md" />}
>
  {/* card content */}
</Data>
```

## Navigation Shells

Use [Sidebar](./sidebar.md) for multi-section operational apps and
[Navbar](./navbar.md) for simpler ones. Keep route registration in
`AppRoutes`, and put app permissions in the auth wrapper rather than inside
individual page components.
