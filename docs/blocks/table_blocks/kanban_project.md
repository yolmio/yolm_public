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

`KanbanProjectTableBlock` attaches lightweight Kanban project management to an
existing parent table (e.g. `clients`, `companies`). Each parent record can own
multiple projects; each project has a Kanban board of tasks grouped by status,
plus attachments and notes. Optional time tracking and task assignees are
available.

Use this block when a domain record needs a simple Trello-style board scoped to
it. For a standalone, app-wide Kanban system (its own boards/columns/cards
tables), use the system-level `KanbanProjectsBlock` instead — see
[Kanban Projects Block](../kanban_projects.md).

```tsx
import { KanbanProjectTableBlock } from "table_blocks/kanban_project";
```

The card, page, and report components are reached through static members of the
class (`KanbanProjectTableBlock.Pages`, `.Card`, `.Reports`), or imported
directly from the submodules (they are not re-exported from the package index):

```tsx
import {
  KanbanProjectListCard,
  KanbanProjectContent,
  KanbanProjectPage,
} from "table_blocks/kanban_project/kanban_project_card";
import {
  ProjectsOverviewReport,
  TimeTrackingOverviewReport,
} from "table_blocks/kanban_project/reports";
```

## Minimal Setup

Add the block to a parent table in `core.tsx`. The block is registered by
passing the class (not an instance) plus an optional options object to
`table.addBlock`:

```tsx
import { KanbanProjectTableBlock } from "table_blocks/kanban_project";

system.db.table("clients", (table) => {
  table.string("name", 200).notNull();
  // ...other fields...
  table.addBlock(KanbanProjectTableBlock);
});
```

Then mount the generated pages in your app `.tsx`. `Pages` is self-routing and
discovers every table that has the block — do **not** wrap it in `<Route>` and
pass it no props:

```tsx
import { KanbanProjectTableBlock } from "table_blocks/kanban_project";

// inside the app's route tree:
<KanbanProjectTableBlock.Pages />
```

The block also contributes a **Projects** detail tab to the parent table's
record page automatically (via `getDetailTab`), so the project list appears on
the parent record without extra wiring.

## Realistic Setup

With time tracking (billable) and a consulting status preset:

```tsx
system.db.table("clients", (table) => {
  table.string("name", 200).notNull();
  table.addBlock(KanbanProjectTableBlock, {
    timeTracking: { billable: true },
    statusType: "consulting_basic",
  });
});
```

## Configuration

`table.addBlock(KanbanProjectTableBlock, opts)` — all options are optional.

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `statusType` | `"basic" \| "consulting_basic" \| "consulting_advanced"` | No | Selects a built-in set of task statuses. Defaults to `basic` (To Do / In Progress / Done). Ignored when `statuses` is set. |
| `statuses` | `HelperEnumValue[]` | No | Custom status list (overrides `statusType`). Each value is `{ name, displayName?, color? }`. The first entry becomes the task default status. |
| `timeTracking` | `{ billable?: boolean }` | No | When present, adds `estimated_hours` to the tasks table and creates a `<prefix>_time_entries` table. Set `billable: true` to add a `billable` flag to time entries. |
| `assignable` | `boolean` | No | When `true`, adds a required `assignee` foreign key to `sys_users` on the tasks table. |

### Status presets

- `basic` (default): `todo` (To Do), `in_progress` (In Progress), `done` (Done).
- `consulting_basic`: `planning`, `in_progress`, `review` (Client Review), `done`.
- `consulting_advanced`: `planning`, `discovery`, `in_progress`,
  `internal_review`, `client_review`, `revisions`, `done`.

## Tables Created

Names are derived from the parent table via its singular form
(`prefix = singularize(parentTable)`). For a parent table `clients` the prefix
is `client`; examples below use that prefix. Foreign-key columns follow Yolm's
`singularize(<table>)_id` naming.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `<prefix>_projects` | Projects (boards) owned by a parent record. | FK to parent (`<prefix>_id`, e.g. `client_id`, not null), `name` (string 100, not null), `notes` (string 1000). Also embeds the Attachments and Notes List table blocks. |
| `<prefix>_project_tasks` | Tasks (cards) within a project. | FK to projects (`<prefix>_project_id`, not null), `title` (string 100, not null), `description` (string 500), `status` (enum, not null, defaults to first status), `order` (ordering, not null), `due_date` (date). Adds `assignee` (FK `sys_users`, not null) when `assignable`; adds `estimated_hours` (decimal 10,2) when `timeTracking` is set. |
| `<prefix>_time_entries` | Time logged against tasks. Only created when `timeTracking` is set. | FK to tasks (`<prefix>_project_task_id`, not null), FK to `sys_users` (`sys_user_id`, not null), `date` (not null), `minutes` (minutes duration, not null), `description` (string 1000, not null). Adds `billable` (bool, not null, default `true`) when `timeTracking.billable` is set. |

An enum `<prefix>_project_task_status` is also created from the resolved status
list (e.g. `client_project_task_status`).

### Generation-time table-name accessors

Fetch the block off a table at generation time to read the resolved names:

```tsx
const block = system.db.tables["clients"].block(KanbanProjectTableBlock);
block.projectsTableName;    // "client_projects"
block.tasksTableName;       // "client_project_tasks"
block.taskStatusEnumName;   // "client_project_task_status"
block.timeEntriesTableName; // "client_time_entries"
```

`timeEntriesTableName` returns a name even when `timeTracking` is not enabled;
the table itself only exists when `timeTracking` is set.

## Pages

### `KanbanProjectTableBlock.Pages`

Self-routing. Takes **no props**. For every table that has the block it renders:
a record page for the parent table showing its project list, and a
`KanbanProjectPage` (the Kanban board for a single project). Place it directly
in the app route tree; do not wrap it in `<Route>`.

### `KanbanProjectPage`

Import: `table_blocks/kanban_project/kanban_project_card`. Self-routing
(`RecordPage` for the projects table). Renders one project's board with header,
notes, attachments, and the Kanban columns. Usually you mount `.Pages` instead
of this directly.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `table` | `string` | Yes | Name of the parent table that has the `KanbanProjectTableBlock`. |

## Components

### `KanbanProjectListCard`

Import: `table_blocks/kanban_project/kanban_project_card`
(or `KanbanProjectTableBlock.Card`). Shows the parent record's projects as
clickable cards with per-status task counts, plus an "add project" button. Must
render inside a context that provides the parent table's current record (e.g.
inside a `RecordPage` for the parent table, or a detail tab). The block already
contributes this card as a **Projects** detail tab automatically.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `renderCardContents` | `Node` | No | Custom renderer for Kanban card contents (passed through to the board). |
| `abilityToRedorder` | `boolean` | No | Enable drag-and-drop reordering within columns. |
| `initializeValues` | `Record<string, any>` | No | Default field values applied when creating new tasks. |
| `sx` | `Style` | No | CSS styles for the outer card. |

### `KanbanProjectContent`

Import: `table_blocks/kanban_project/kanban_project_card`. Lower-level building
block used internally by `KanbanProjectPage`. Renders a single project's header,
notes card, attachments card, and the `AutoKanban` board. Must render inside a
`RecordPage` for the projects table. Reach for this only when composing a custom
project page; otherwise use `KanbanProjectPage`.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `projectId` | `NumericExpr` | Yes | SQL expression for the current project id (e.g. `sql\`ui.record_id\``). |
| `cardsTableName` | `string` | Yes | Tasks table name (`block.tasksTableName`). |
| `boardsTableName` | `string` | Yes | Projects table name (`block.projectsTableName`). |
| `parentTable` | `string` | Yes | Name of the parent table that owns projects. |
| `renderCardContents` | `Node` | No | Custom renderer for Kanban card contents. |
| `abilityToRedorder` | `boolean` | No | Enable drag-and-drop reordering within columns. |
| `initializeValues` | `Record<string, any>` | No | Default field values for new tasks. |

## Reports

Both are exposed via `KanbanProjectTableBlock.Reports.ProjectsOverview` and
`KanbanProjectTableBlock.Reports.TimeTrackingOverview`, or imported from
`table_blocks/kanban_project/reports`. Each accepts `{ name?: string; table: string }`
(`table` is the parent table name; `name` overrides the report title).

| Report | Purpose |
| --- | --- |
| `ProjectsOverviewReport` | Project/task counts, a "tasks by status" bar chart, and a latest-projects table. |
| `TimeTrackingOverviewReport` | Date-range time stats (billable / non-billable hours), a daily line chart, and recent time entries. Pair with `timeTracking`. |

> Note: these report components currently hard-code `client_projects`,
> `client_project_tasks`, and `client_time_entries` (and columns such as
> `client_id`, `client_project_task_id`, `sys_user_id`) in their charts and
> data tables, so they render correctly only for a parent table named `clients`.
> In `ProjectsOverviewReport` the stat row is dynamic (via the block accessors)
> but the chart and table are not; `TimeTrackingOverviewReport` is fully
> hard-coded. For other parent tables, build a custom report using the
> table-name accessors above.

## Relationships to Other Blocks

- Embeds the Attachments and Notes List table blocks on each project, so
  projects get file attachments and threaded notes for free.
- Tasks/time entries reference the built-in `sys_users` table for assignees and
  time-entry authors.
- The board UI is rendered with the `AutoKanban` component
  (`components/kanban/kanban`) keyed on the task `status` enum.

## Common Mistakes

- Wrapping `<KanbanProjectTableBlock.Pages />` in a `<Route>`, or passing it a
  `table` prop. It is self-routing and takes no props.
- Rendering `KanbanProjectListCard` outside a parent-record context. It reads
  the current record via the `CurrentTableICtxKey` context and the parent
  foreign key; without that context it throws.
- Registering with `new KanbanProjectTableBlock(...)`. Pass the class and an
  options object: `table.addBlock(KanbanProjectTableBlock, { ... })`.
- Setting both `statuses` and `statusType`. `statuses` wins; `statusType` is
  ignored when a custom list is provided.
- Using `TimeTrackingOverviewReport` without enabling `timeTracking` (the
  `<prefix>_time_entries` table will not exist), or using either report on a
  non-`clients` parent table (hard-coded table names; see the Reports note).
