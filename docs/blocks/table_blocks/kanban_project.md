---
title: Kanban Project Table Block
description: Table block adding Kanban project management (projects, tasks, statuses, optional time tracking and assignees) to any parent table.
tags:
  - blocks
  - table-blocks
  - kanban
  - projects
  - time-tracking
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
  - blocks/kanban_projects.md
---

# Kanban Project Table Block

`KanbanProjectTableBlock` gives each record of a parent table (e.g. `clients`)
its own projects, each with a Kanban board of tasks grouped by status, plus
attachments and notes. Optional time tracking and assignees. For an app-wide
board with its own tables, use the system-level
[Kanban Projects Block](../kanban_projects.md).

## Minimal Setup

Pass the class (not an instance) and optional options to `table.addBlock`:

```tsx
import { KanbanProjectTableBlock } from "table_blocks/kanban_project";

system.db.table("clients", (table) => {
  table.string("name", 200).notNull();
  table.addBlock(KanbanProjectTableBlock, {
    timeTracking: { billable: true },
    statusType: "consulting_basic",
  });
});

// in the app's route tree (self-routing, no props, not inside <Route>):
<KanbanProjectTableBlock.Pages />
```

The block also adds a **Projects** detail tab to the parent table's record page
(via `getDetailTab`).

## Configuration

All options are optional; see `KanbanProjectTableBlockOpts` in
`packages/table_blocks/kanban_project/index.tsx`.

| Option | Meaning |
| --- | --- |
| `statusType` | `"basic"` (default), `"consulting_basic"`, or `"consulting_advanced"`. Ignored when `statuses` is set. |
| `statuses` | Custom `HelperEnumValue[]`; overrides `statusType`. The first entry is the task default status. |
| `timeTracking` | `{ billable?: boolean }`. Adds `estimated_hours` to tasks and creates `<prefix>_time_entries`; `billable: true` adds a `billable` flag (default `true`) to entries. |
| `assignable` | Adds a required `assignee` FK to `sys_users` on tasks. |

Status presets:

- `basic`: `todo`, `in_progress`, `done`.
- `consulting_basic`: `planning`, `in_progress`, `review` (Client Review), `done`.
- `consulting_advanced`: `planning`, `discovery`, `in_progress`,
  `internal_review`, `client_review`, `revisions`, `done`.

## Tables Created

`prefix = singularize(parentTable)` (`clients` -> `client`).

| Name | Purpose |
| --- | --- |
| `<prefix>_projects` | Projects owned by a parent record; embeds the [Attachments](attachments.md) and [Notes List](notes_list.md) table blocks. |
| `<prefix>_project_tasks` | Tasks (cards) with `status`, `order`, `due_date`. |
| `<prefix>_time_entries` | Time logged per task and `sys_users`; only with `timeTracking`. |
| `<prefix>_project_task_status` (enum) | Resolved status list. |

Read resolved names at generation time:

```tsx
const block = system.db.tables["clients"].block(KanbanProjectTableBlock);
block.projectsTableName;    // "client_projects"
block.tasksTableName;       // "client_project_tasks"
block.taskStatusEnumName;   // "client_project_task_status"
block.timeEntriesTableName; // "client_time_entries" (even without timeTracking)
```

## Pages and Components

Static members: `KanbanProjectTableBlock.Pages`, `.Card`, `.Reports`. Direct
imports (not re-exported from the package index):
`table_blocks/kanban_project/kanban_project_card` and
`table_blocks/kanban_project/reports`.

- `Pages`: for every table with the block, a parent `RecordPage` with the
  project list plus a `KanbanProjectPage`.
- `KanbanProjectPage` (`table`: parent table name): self-routing `RecordPage`
  for the projects table rendering one board with notes and attachments.
- `KanbanProjectListCard` (`.Card`): the parent record's projects with
  per-status counts and an add button. Must render inside a parent-record
  context (reads `CurrentTableICtxKey`); throws otherwise. Optional props:
  `renderCardContents`, `abilityToRedorder` (sic), `initializeValues` (defaults
  for new tasks), `sx`.
- `KanbanProjectContent`: lower-level board used by `KanbanProjectPage`; must
  render inside a `RecordPage` for the projects table. Required props:
  `projectId` (`NumericExpr`, e.g. `` sql`ui.record_id` ``), `cardsTableName`,
  `boardsTableName`, `parentTable`; plus the list-card props except `sx`.

The board is rendered with `AutoKanban` (`components/kanban/kanban`) keyed on
the task `status` enum.

## Reports

`ProjectsOverviewReport` (`.Reports.ProjectsOverview`) shows project/task
counts, tasks by status, and latest projects. `TimeTrackingOverviewReport`
(`.Reports.TimeTrackingOverview`) shows billable/non-billable hours over a date
range and recent entries. Both take `{ name?: string; table: string }`.

## Gotchas

- Both reports hard-code `client_*` table and column names in their charts and
  tables (only the `ProjectsOverviewReport` stat row uses the accessors), so
  they work only for a parent table named `clients`. Otherwise build a custom
  report from the accessors.
- `TimeTrackingOverviewReport` queries the `billable` column, so it needs
  `timeTracking: { billable: true }`.
