---
title: Kanban Projects Block
description: Drop-in kanban board with projects, columns, and draggable cards; optional per-card assignees and comments.
tags:
  - blocks
  - kanban
  - projects
  - tasks
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
  - database/virtual_fields.md
---

# Kanban Projects Block

`KanbanProjectsBlock` is a solution block that adds a Trello-style kanban
system: boards (projects), ordered columns, and draggable cards, plus
ready-made pages. Use it when an app needs a familiar board UI with minimal
wiring. For richer or non-kanban workflows, build custom schema instead.

```tsx
import { KanbanProjectsBlock } from "blocks/kanban_projects";
```

## Minimal Setup

Register the block in `core.tsx`:

```tsx
import { KanbanProjectsBlock } from "blocks/kanban_projects";

system.addBlock(new KanbanProjectsBlock());
```

Mount the bundled pages inside an app's `<AppRoutes>`:

```tsx
import { KanbanProjectsBlock } from "blocks/kanban_projects";
import { AppRoutes } from "std/ui";

system.app({
  ui: (
    <AppRoutes>
      <KanbanProjectsBlock.Pages />
    </AppRoutes>
  ),
});
```

Enable per-card assignees and comments via constructor options:

```tsx
system.addBlock(new KanbanProjectsBlock({ assignable: true }));
```

## Configuration

| Option       | Type      | Required | Meaning                                                                   |
| ------------ | --------- | -------- | ------------------------------------------------------------------------- |
| `assignable` | `boolean` | No       | When `true`, adds the `kanban_card_assignees` table for assigning `sys_users` to cards. Default `false`. |
| `comments`   | `boolean` | No       | When `true`, adds the `kanban_card_comments` table for a comment thread per card. Default `false`. |

## Tables Created

The block calls `db.table(...)` for these during `initialize()`:

| Table                   | Created when      | Key columns                                                                          |
| ----------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `kanban_boards`         | always            | `name` (string 100, not null); `description` (json)                                  |
| `kanban_columns`        | always            | fk `kanban_boards` (not null); `name` (string 100, not null); `order` (ordering, not null) |
| `kanban_cards`          | always            | fk `kanban_columns` (not null); `title` (string 100, not null); `description` (json, lexical rich text); `order` (ordering, not null) |
| `kanban_card_assignees` | `assignable: true` | fk `kanban_cards` (not null); fk `sys_users` (not null); unique `(kanban_card_id, sys_user_id)` |
| `kanban_card_comments`  | `comments: true`  | fk `kanban_cards` (not null); fk `sys_users` (not null); `comment` (json, lexical rich text) |

The `order` columns use the `ordering` field type for stable drag-and-drop
reordering (see the [ordering / virtual fields](../database/virtual_fields.md)
docs). The card `description` and comment `comment` are JSON columns storing
lexical rich text, edited and displayed through the lexical editor components.

## Components

### `KanbanProjectsBlock.Pages`

Static, self-routing component. Renders the full board UI. Do **not** wrap it in
`<Route>` — place it directly inside `<AppRoutes>`. It registers a table link
from `kanban_boards` to `/projects/{id}` and provides two routes:

- `/projects` — project list (grid of board cards with per-column task counts and an "Add Project" button).
- `/projects/{record_id:id}` — board detail with draggable columns and cards, inline add-column / add-card, column reordering, and a card detail modal.

It takes no props.

```tsx
<AppRoutes>
  <KanbanProjectsBlock.Pages />
</AppRoutes>
```

### `KanbanProjectsBlock.YourTasksQueryTable`

Static component listing the cards assigned to the current user across all
boards. Requires `assignable: true` (its query references
`kanban_card_assignees`).

| Prop | Type    | Required | Meaning                       |
| ---- | ------- | -------- | ----------------------------- |
| `sx` | `Style` | No       | Style overrides for the wrapper. |

```tsx
<KanbanProjectsBlock.YourTasksQueryTable sx={{ gridColumnSpan: 12 }} />
```

### `KanbanCardModal`

```tsx
import { KanbanCardModal } from "blocks/kanban_projects/modal";
```

The card detail dialog (title editing, description editor, members, and
comments). `KanbanProjectsBlock.Pages` wires it automatically as the board's
card modal. It reads the current table, record, and refetch from interaction
context, and its visibility is bound to the `show_modal` scalar. You normally do
not render it directly; import it only when composing a custom board. It takes
no props.

## Block Helpers

Fetch the registered instance with `system.block(KanbanProjectsBlock)` to read
its configuration and stable identifiers from custom UI or procedures:

| Member             | Type      | Meaning                                   |
| ------------------ | --------- | ----------------------------------------- |
| `assignable`       | `boolean` | Whether the assignees table was created.  |
| `comments`         | `boolean` | Whether the comments table was created.   |
| `cardTableName`    | `string`  | `"kanban_cards"`.                         |
| `cardTableIdent`   | sql ident | `sql.ref("kanban_cards")`.                |
| `columnTableName`  | `string`  | `"kanban_columns"`.                       |
| `columnTableIdent` | sql ident | `sql.ref("kanban_columns")`.              |

## Relationships

- Assignees and comments reference the built-in `sys_users` table; they only
  exist when the corresponding option is enabled.
- The card `description` and comment `comment` fields store lexical rich text
  and integrate with the lexical editor components and helpers such as
  `lexical_simple_paragraph(...)`.

## Common Mistakes

- Wrapping `KanbanProjectsBlock.Pages` in a `<Route>`. It is self-routing;
  place it directly inside `<AppRoutes>`.
- Using `KanbanProjectsBlock.YourTasksQueryTable` without `assignable: true`.
  The query references `kanban_card_assignees`, which only exists when
  assignees are enabled.
- Expecting an `assignee_id` column on `kanban_cards`. Assignees live in the
  separate join table `kanban_card_assignees`, not on the card row. (The class
  JSDoc that mentions an `assignee_id` foreign key is misleading.)
- Writing plain strings to the card `description` or comment `comment`. They are
  JSON lexical rich-text columns — populate them via the lexical helpers/editors.
- Referencing `KanbanProjectsBlock.Pages` before the block is registered.
  Call `system.addBlock(new KanbanProjectsBlock(...))` in `core.tsx` first.
