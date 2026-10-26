---
title: Kanban
description: Kanban board components for visualizing and managing cards across columns with drag-and-drop support.
tags:
  - ui
  - components
  - kanban
  - drag-and-drop
---

# Kanban

Kanban boards with draggable cards, at three levels:

- `AutoKanban`: one column per value of an enum or foreign key field.
- `SimplifiedKanban`: developer-defined static columns.
- `SuperKanban`: board, column, and card management with its own routes;
  normally used through [`KanbanProjectsBlock`](../blocks/kanban_projects.md).

```tsx
import {
  AutoKanban,
  SimplifiedKanban,
  KanbanCardModal,
} from "components/kanban/kanban";
```

## Card Table Requirements

```tsx
// core.tsx
system.enum_({
  name: "ticket_status",
  values: [
    { name: "new", displayName: "New" },
    { name: "in_progress", displayName: "In Progress" },
    { name: "done", displayName: "Done" },
  ],
});

system.db.table("tickets", (t) => {
  t.string("title", 100).notNull();
  t.string("description", 500);
  t.enum("ticket_status").notNull();
  t.fk("contact_id", "contacts").notNull();
  t.ordering("order").notNull(); // only needed with abilityToRedorder
  t.recordDisplayName(["title"], (title) => title);
});
```

- **`title`**: the add-card input inserts only `title`, plus the column value
  and `initializeValues`. Every other `notNull` field must be supplied through
  `initializeValues`.
- **`description`**: `KanbanCardModal` (always attached by `AutoKanban`)
  requires `title` and `description` and fails generation without them.
- **Ordering column** (`orderColumn`, default `"order"`): used only when
  `abilityToRedorder` is set. Then cards are sorted by it, new cards are placed
  after the last card in their column, and a drop recomputes it with
  `ordering.new()` between the neighboring cards. Without
  `abilityToRedorder` the board never reads or writes it, so omit it; a
  `notNull` ordering column without `abilityToRedorder` makes card inserts
  fail.
- **Card label**: cards render `renderCardContents`, or else the table's
  record display name, else `email`, else the id.

## AutoKanban

```tsx
<RecordPage table="contacts">
  <AutoKanban
    table="tickets"
    field="ticket_status"
    header={<Typography level="h2">Tickets</Typography>}
    where={sql`contact_id = ui.record_id`}
    initializeValues={{ contact_id: sql`ui.record_id` }}
    abilityToRedorder
  />
</RecordPage>
```

- **Enum field**: one column per enum value in declaration order, titled
  with `displayName`; enum value colors draw a colored top border.
- **Foreign key field** (e.g. `field="status_id"` referencing `statuses`): one
  column per referenced row, titled `string.capitalize(name)`, so the
  referenced table must have a `name` field.
- Dropping a card on another column runs, in one transaction, the column
  update (`set <field> = <column value>`) and, with `abilityToRedorder`, the
  reorder. The board then refetches.
- `where` filters cards; `initializeValues` adds insert values (the column
  field is set automatically).
- `renderCardContents` is a node rendered per card; read the card row with
  `sql\`card_record.<field>\``. Compute badges and labels in SQL there rather
  than nesting per-card `Data`.

## SimplifiedKanban

Each column defines its own `where`, optional `orderBy`, and the server
statements that move a card into it:

```tsx
<SimplifiedKanban
  cardsTableName="tickets"
  header={<Typography level="h2">Workflow</Typography>}
  abilityToRedorder
  columns={[
    {
      name: "To Do",
      where: sql`ticket_status = 'new'`,
      orderBy: sql`order asc`,
      afterMoveToThisColumn: (s, cardId) => {
        s.modify(sql`update db.tickets set ticket_status = 'new' where id = ${cardId}`);
      },
      initializeValues: { ticket_status: sql.lit`new`, contact_id: sql`ui.record_id` },
    },
    {
      name: "Done",
      where: sql`ticket_status = 'done'`,
      orderBy: sql`order asc`,
      afterMoveToThisColumn: (s, cardId) => {
        s.modify(sql`update db.tickets set ticket_status = 'done' where id = ${cardId}`);
      },
      cardModal: <KanbanCardModal columnName={sql.lit`Done`} />,
      renderCardContents: <Typography>{sql`card_record.title`}</Typography>,
      initializeValues: { ticket_status: sql.lit`done`, contact_id: sql`ui.record_id` },
    },
  ]}
/>
```

Unlike `AutoKanban`, `SimplifiedKanban` does not derive the column value or the
sort: `afterMoveToThisColumn` must set the column state, `initializeValues`
must set it for new cards, and `orderBy` must be passed for reordering to be
visible. No card modal is attached unless a column passes `cardModal`.

## KanbanCardModal

The card detail dialog (title, editable description, column name). Requires
`title` and `description` fields on the card table. Pass `columnName` (SQL) to
show a fixed column label; otherwise it reads the FK named by `columnField`
(default `"column_id"`), whose target table needs a record display name.
