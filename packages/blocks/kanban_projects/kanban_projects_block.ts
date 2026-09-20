import { sql } from "../../std/sql_utils";
import { db } from "std/system";
import type { Block } from "std/system";

/**
 * Solution block that adds kanban projects (boards, columns, cards) and
 * the associated pages. Configure with `assignable` to wire cards to
 * users and `comments` to enable a comment thread per card.
 *
 * Register in `core.tsx` via
 * `system.addBlock(new KanbanProjectsBlock({ assignable: true }))`.
 */
export class KanbanProjectsBlock implements Block {
  blockName = "KanbanProjectsBlock";
  componentDependencies: string[] = [];
  description: string | undefined;

  /** If `true`, cards have an `assignee_id` foreign key to `users`. */
  assignable: boolean;
  /** If `true`, cards have a related comments table. */
  comments: boolean;

  /** Card table name (kept stable so external code can reference it). */
  cardTableName = "kanban_cards";
  cardTableIdent = sql.ref("kanban_cards");
  /** Column table name. */
  columnTableName = "kanban_columns";
  columnTableIdent = sql.ref("kanban_columns");

  /** UI pages exported by the block (lazily attached by `index.tsx`). */
  static Pages: any;
  /** Helper for queries listing "your tasks" across projects. */
  static YourTasksQueryTable: any;

  constructor(
    opts: {
      /** Set to `true` to enable per-card assignee. */
      assignable?: boolean;
      /** Set to `true` to enable per-card comments. */
      comments?: boolean;
    } = {},
  ) {
    this.assignable = opts.assignable ?? false;
    this.comments = opts.comments ?? false;
  }

  initialize() {
    db.table("kanban_boards", (table) => {
      table.string("name", 100).notNull();
      table.json("description");
    });
    db.table("kanban_columns", (table) => {
      table.fk("kanban_boards").notNull();
      table.string("name", 100).notNull();
      table.ordering("order").notNull();
    });
    db.table("kanban_cards", (table) => {
      table.fk("kanban_columns").notNull();
      table.string("title", 100).notNull();
      table.json("description");
      table.ordering("order").notNull();
    });
    if (this.assignable) {
      db.table("kanban_card_assignees", (table) => {
        table.fk("kanban_cards").notNull();
        table.fk("sys_users").notNull();
        table.unique(["kanban_card_id", "sys_user_id"]);
      });
    }

    if (this.comments) {
      db.table("kanban_card_comments", (table) => {
        table.fk("kanban_cards").notNull();
        table.fk("sys_users").notNull();
        table.json("comment");
      });
    }
    this.componentDependencies = ["KanbanProjectsPage"];
    this.description =
      "Provides a way to manage projects and tasks using a kanban board.";
  }
}
