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

`KanbanProjectsBlock` is a system block that adds an app-wide Trello-style
kanban system (boards, ordered columns, draggable cards) plus ready-made pages.
For a board scoped to records of an existing table, use the
[Kanban Project Table Block](table_blocks/kanban_project.md) instead.

## Minimal Setup

```tsx
import { KanbanProjectsBlock } from "blocks/kanban_projects";
import { AppRoutes } from "std/ui";

// core.tsx
system.addBlock(new KanbanProjectsBlock({ assignable: true }));

// app .tsx
system.app({
  ui: (
    <AppRoutes>
      <KanbanProjectsBlock.Pages />
    </AppRoutes>
  ),
});
```

## Configuration

| Option       | Default | Meaning                                                    |
| ------------ | ------- | ---------------------------------------------------------- |
| `assignable` | `false` | Creates `kanban_card_assignees` (cards to `sys_users`).    |
| `comments`   | `false` | Creates `kanban_card_comments` (a comment thread per card). |

## Tables Created

| Table                   | Created when       | Purpose                                                  |
| ----------------------- | ------------------ | -------------------------------------------------------- |
| `kanban_boards`         | always             | Projects (boards).                                       |
| `kanban_columns`        | always             | Ordered columns of a board.                              |
| `kanban_cards`          | always             | Ordered cards within a column.                           |
| `kanban_card_assignees` | `assignable: true` | Card-to-user join table, unique per `(kanban_card_id, sys_user_id)`. |
| `kanban_card_comments`  | `comments: true`   | Per-card comments by `sys_users`.                        |

Column and card `order` use the `ordering` field type (see
[virtual fields](../database/virtual_fields.md)). Card `description` and comment
`comment` are JSON columns holding lexical rich text; write them through the
lexical editors or helpers such as `lexical_simple_paragraph(...)`, not as plain
strings.

## Components

- `KanbanProjectsBlock.Pages` (no props): self-routing; place directly inside
  `<AppRoutes>`, not in a `<Route>`. Registers a table link from `kanban_boards`
  to `/projects/{id}` and provides `/projects` (board grid with per-column
  counts) and `/projects/{record_id:id}` (board with draggable columns/cards and
  a card modal).
- `KanbanProjectsBlock.YourTasksQueryTable` (`sx?: Style`): cards assigned to
  the current user across boards. Requires `assignable: true`.
- `KanbanCardModal` from `blocks/kanban_projects/modal` (no props): the card
  detail dialog that `Pages` already wires. It reads table, record, and refetch
  from interaction context and binds visibility to the `show_modal` scalar;
  import it only when composing a custom board.

## Block Helpers

`system.block(KanbanProjectsBlock)` exposes `assignable`, `comments`, and the
stable names `cardTableName` / `cardTableIdent` (`kanban_cards`) and
`columnTableName` / `columnTableIdent` (`kanban_columns`).

## Gotchas

- There is no `assignee_id` column on `kanban_cards`; assignees live in
  `kanban_card_assignees`. The class JSDoc that mentions an `assignee_id`
  foreign key is misleading.
