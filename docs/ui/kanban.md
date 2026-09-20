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

The Kanban components render interactive board views with columns and draggable cards. There are three main components at different abstraction levels:

- **AutoKanban** - Automatically generates columns from an enum or foreign key field
- **SimplifiedKanban** - Developer-defined static columns with full control
- **SuperKanban** - Full board management with board creation, dynamic columns, and card ordering

```tsx
import {
  AutoKanban,
  SimplifiedKanban,
  SuperKanban,
  KanbanCardModal,
} from "components/kanban/kanban";
```

## AutoKanban

The simplest way to add a Kanban board. It inspects a table field (enum or foreign key) and automatically creates one column per value.

### Basic Usage with Enum Field

Given a table with an enum field:

```tsx
// In core.tsx
system.enum_({
  name: "ticket_status",
  values: [
    { name: "new", displayName: "New" },
    { name: "in_progress", displayName: "In Progress" },
    { name: "done", displayName: "Done" },
  ],
});

db.table("tickets", (table) => {
  table.string("title", 100).notNull();
  table.string("description", 500);
  table.enum("ticket_status").notNull();
  table.ordering("order").notNull();
});
```

```tsx
// In app
<AutoKanban
  table="tickets"
  field="ticket_status"
  header={<Typography level="h2">Tickets</Typography>}
  abilityToRedorder
  orderColumn="order"
/>
```

This creates one column per enum value ("New", "In Progress", "Done"). Dragging a card between columns updates the `ticket_status` field. If the enum values have colors defined, columns display colored top borders.

### Basic Usage with Foreign Key Field

When the field is a foreign key, columns are created from each record in
the referenced table. The referenced table must have a `name` field;
that field is used as the column label.

```tsx
// In core.tsx
db.table("statuses", (table) => {
  table.string("name", 100).notNull();
});

db.table("tickets", (table) => {
  table.string("title", 100).notNull();
  table.string("description", 500);
  table.fk("statuses").notNull();
  table.ordering("order").notNull();
});
```

```tsx
<AutoKanban
  table="tickets"
  field="status_id"
  header={<Typography level="h2">Board Name</Typography>}
  orderColumn="order"
  abilityToRedorder
/>
```

### Filtering with `where`

Use `where` to show only a subset of cards, for example on a record detail page:

```tsx
<AutoKanban
  table="tickets"
  field="ticket_status"
  where={sql`contact_id = ui.record_id`}
  header={<Typography level="h2">Tickets</Typography>}
  initializeValues={{
    contact_id: sql`ui.record_id`,
    employee_id: 0,
    board_id: 0,
  }}
  abilityToRedorder
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `table` | `string` | required | Name of the database table containing cards |
| `field` | `string` | required | Name of the enum or foreign key field used to group cards into columns |
| `header` | `Node` | - | Optional header rendered above the board |
| `where` | `BooleanExpr` | - | SQL filter applied to cards |
| `initializeValues` | `Record<string, AnyExpr>` | - | Default field values when adding new cards (in addition to the column field) |
| `abilityToRedorder` | `boolean` | `false` | Enable drag-and-drop reordering of cards within a column |
| `orderColumn` | `string` | `"order"` | Name of the ordering column in the table |
| `renderCardContents` | `Node` | `card_display_name` | Custom content to render inside each card |
| `sx` | `Style` | - | Style overrides for the outer container |

## SimplifiedKanban

For cases where you need full control over column definitions but do not need dynamic board/column management.

### Basic Usage

```tsx
<SimplifiedKanban
  cardsTableName="cards"
  header={<Typography level="h2">Board Name</Typography>}
  columns={[
    {
      name: "First State",
      where: sql`state = 'first_state'`,
      orderBy: sql`order asc`,
      afterMoveToThisColumn: (s, cardId) => {
        s.modify(
          sql`update cards set state = 'first_state' where id = ${cardId}`,
        );
      },
      initializeValues: { state: sql.lit`first_state` },
    },
    {
      name: "Second State",
      where: sql`state = 'second_state'`,
      orderBy: sql`order asc`,
      afterMoveToThisColumn: (s, cardId) => {
        s.modify(
          sql`update cards set state = 'second_state' where id = ${cardId}`,
        );
      },
      cardModal: <KanbanCardModal columnName={sql.lit`Second State`} />,
      initializeValues: { state: sql.lit`second_state` },
    },
  ]}
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `cardsTableName` | `string` | required | Name of the table containing cards |
| `header` | `Node` | required | Header rendered above the board |
| `columns` | `Column[]` | required | Array of column definitions (see below) |
| `orderColumn` | `string` | `"order"` | Name of the ordering column |
| `abilityToRedorder` | `boolean` | `false` | Enable drag-and-drop reordering within columns |

### Column Definition

Each entry in the `columns` array accepts:

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Display name of the column |
| `where` | `BooleanExpr` | SQL condition to filter cards into this column |
| `orderBy` | `Sql` | Optional ordering expression |
| `afterMoveToThisColumn` | `(s, cardId) => void` | Server procedure run when a card is dropped into this column |
| `renderCardContents` | `Node` | Custom card content for this column |
| `cardModal` | `Node` | Modal shown when clicking a card in this column |
| `initializeValues` | `Record<string, AnyExpr>` | Default values when adding a new card to this column |

## SuperKanban

A full-featured Kanban with board creation, dynamic columns, and card management. It renders a board list page and individual board views with URL routing.

This is the most complex variant and is typically used via the `KanbanProjectsBlock` rather than directly. It requires explicit table definitions for boards, columns, and cards, along with callback functions for adding columns, adding cards, and moving cards.

## KanbanCardModal

A built-in modal dialog for viewing and editing card details (title, description, column assignment). Used automatically by `AutoKanban` and can be passed to `SimplifiedKanban` columns.

### Requirements

The card table must have:
- `title` (String) - card title
- `description` (String) - card description

```tsx
// Pass to SimplifiedKanban column
{
  cardModal: <KanbanCardModal columnName={sql.lit`Done`} />,
}
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `columnName` | `Sql` | - | SQL expression for the column name to display |
| `columnField` | `string` | `"column_id"` | Name of the foreign key field referencing the column table |

## How Drag-and-Drop Works

All Kanban components use the HTML Drag and Drop API:

1. **Dragging a card** sets a `dragging_card` scalar with the card's ID
2. **Hovering over a card** calculates if the cursor is above or below the midpoint, showing a visual indicator (top or bottom border highlight)
3. **Dropping on a column** triggers a server procedure that:
   - Updates the card's column field (enum value or foreign key)
   - Recalculates ordering using `ordering.new()` to place the card at the correct position when `abilityToRedorder` is enabled
   - Wraps everything in a transaction
   - Triggers a UI refresh

When `abilityToRedorder` is enabled, cards can be reordered within the same column. Without it, cards can only be moved between columns.

## Real-World Examples

### Ticket board filtered by contact

```tsx
<RecordPage table="contacts">
  <AutoKanban
    table="tickets"
    field="ticket_status"
    where={sql`contact_id = ui.record_id`}
    header={<Typography level="h2">Tickets</Typography>}
    initializeValues={{
      contact_id: sql`ui.record_id`,
      employee_id: 0,
      board_id: 0,
    }}
    abilityToRedorder
  />
</RecordPage>
```

### Foreign key columns with reordering

```tsx
<AutoKanban
  table="tickets"
  field="status_id"
  header={<Typography level="h2">Board Name</Typography>}
  orderColumn="order"
  abilityToRedorder
/>
```

### Static columns with custom card modals

```tsx
<SimplifiedKanban
  cardsTableName="cards"
  header={<Typography level="h2">Workflow</Typography>}
  columns={[
    {
      name: "To Do",
      where: sql`state = 'todo'`,
      orderBy: sql`order asc`,
      afterMoveToThisColumn: (s, cardId) => {
        s.modify(sql`update cards set state = 'todo' where id = ${cardId}`);
      },
      initializeValues: { state: sql.lit`todo` },
    },
    {
      name: "In Progress",
      where: sql`state = 'in_progress'`,
      orderBy: sql`order asc`,
      afterMoveToThisColumn: (s, cardId) => {
        s.modify(sql`update cards set state = 'in_progress' where id = ${cardId}`);
      },
      cardModal: <KanbanCardModal columnName={sql.lit`In Progress`} />,
      initializeValues: { state: sql.lit`in_progress` },
    },
    {
      name: "Done",
      where: sql`state = 'done'`,
      afterMoveToThisColumn: (s, cardId) => {
        s.modify(sql`update cards set state = 'done' where id = ${cardId}`);
      },
      cardModal: <KanbanCardModal columnName={sql.lit`Done`} />,
      renderCardContents: <Typography>{sql`card_record.name`}</Typography>,
      initializeValues: { state: sql.lit`done` },
    },
  ]}
/>
```
