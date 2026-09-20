import { ListItemDecorator } from "components/list";
import { MaterialIcon } from "components/material_icon";
import { RecordPage } from "pages/record_page";
import { singularize } from "std/inflectors";
import { sql } from "../../std/sql_utils";
import { system, TableBlock } from "std/system";
import type { HelperEnumValue, TableBuilder } from "std/system";
import { AttachmentsTableBlock } from "table_blocks/attachments";
import { NotesListTableBlock } from "table_blocks/notes_list";
import {
  KanbanProjectListCard,
  KanbanProjectPage,
} from "./kanban_project_card";
import { ProjectsOverviewReport } from "./reports";
import { TimeTrackingOverviewReport } from "./reports";
import * as YolmGenApi from "std/yolm_gen_api";

/**
  This table block Adds Kanban board functionality to a table by creating related tables for boards and cards.
  When you need simple Kanban project management, use this block.

  Creates:
  - ${table}_boards: Stores Kanban boards associated with the main table
  - ${table}_board_cards: Stores cards for each board

  Main component: KanbanProjectList

To use it:
- import the block

```tsx
import { KanbanProjectTableBlock } from "table_blocks/kanban_project";
```

- Add the block to your table:

```tsx
// add it to the table that you want to use it on, sql.g. clients/companies, etc.
table.addBlock(new KanbanProjectTableBlock());
```

Add the pages to your app:

```tsx
<KanbanProjectTableBlock.Pages table="clients" />
  ```

 */
export class KanbanProjectTableBlock
  extends TableBlock<KanbanProjectTableBlockOpts> {
  #projectsTableName?: string;
  #tasksTableName?: string;
  #taskStatusEnumName?: string;
  #timeEntriesTableName?: string;

  constructor(tableName: string, opts: KanbanProjectTableBlockOpts = {}) {
    super(tableName, opts);
  }

  #getStatuses(): HelperEnumValue[] {
    if (this.opts.statuses) {
      return this.opts.statuses;
    }

    switch (this.opts.statusType) {
      case "consulting_advanced":
        return [
          { name: "planning", displayName: "Planning", color: "#9c27b0" },
          { name: "discovery", displayName: "Discovery", color: "#3f51b5" },
          { name: "in_progress", displayName: "In Progress", color: "#0288d1" },
          {
            name: "internal_review",
            displayName: "Internal Review",
            color: "#fdd835",
          },
          {
            name: "client_review",
            displayName: "Client Review",
            color: "#f57c00",
          },
          { name: "revisions", displayName: "Revisions", color: "#ef5350" },
          { name: "done", displayName: "Done", color: "#388e3c" },
        ];
      case "consulting_basic":
        return [
          { name: "planning", displayName: "Planning", color: "#A855F7" },
          { name: "in_progress", displayName: "In Progress", color: "#3B82F6" },
          { name: "review", displayName: "Client Review", color: "#F97316" },
          { name: "done", displayName: "Done", color: "#22C55E" },
        ];
      default:
        return [
          { name: "todo", displayName: "To Do", color: "#f57c00" },
          { name: "in_progress", displayName: "In Progress", color: "#0288d1" },
          { name: "done", displayName: "Done", color: "#388e3c" },
        ];
    }
  }

  initialize(mainTable: TableBuilder) {
    this.parentTableName = mainTable.name;
    const prefix = singularize(mainTable.name);
    this.#projectsTableName = `${prefix}_projects`;
    this.#tasksTableName = `${prefix}_project_tasks`;
    this.#taskStatusEnumName = `${prefix}_project_task_status`;
    this.#timeEntriesTableName = `${prefix}_time_entries`;

    const statuses = this.#getStatuses();

    system.db.table(this.#projectsTableName, (table) => {
      table.fk(mainTable.name).notNull();
      table
        .string("name", 100)
        .notNull()
        .sampleData({
          generator: (_ctx) => {
            return sql.lit(YolmGenApi.fakerCommerceProductName());
          },
        });
      table.string("notes", 1000);
      table.addBlock(AttachmentsTableBlock);
      table.addBlock(NotesListTableBlock);
    });

    system.enum_({
      name: this.#taskStatusEnumName,
      values: statuses,
    });

    system.db.table(this.#tasksTableName!, (table) => {
      table.sampleData({
        baseCount: 200,
      });
      table
        .fk(this.#projectsTableName!)
        .notNull()
        .sampleData({
          foreignKeyStrategy: {
            type: "existing",
          },
        });
      table.string("title", 100).notNull();
      table.string("description", 500);
      table
        .enum("status", this.#taskStatusEnumName)
        .notNull()
        .default(sql.lit(statuses[0].name));
      table
        .ordering("order")
        .notNull()
        .sampleData({
          generator: () =>
            sql`coalesce(
            ordering.new((select max("order") from ${
              sql.ref(this.#tasksTableName!)
            })),
            ordering.new()
          )`,
        });
      table.date("due_date");
      if (this.opts.assignable) {
        table.fk("assignee", "sys_users").notNull();
      }
      if (this.opts.timeTracking) {
        table.decimal("estimated_hours", { precision: 10, scale: 2 });
      }
    });

    if (this.opts.timeTracking) {
      const opts = this.opts.timeTracking;
      system.db.table(`${prefix}_time_entries`, (table) => {
        table.sampleData({
          baseCount: 500,
        });
        table
          .fk(this.#tasksTableName!)
          .notNull()
          .sampleData({
            foreignKeyStrategy: {
              type: "existing",
            },
          });
        table
          .fk("sys_users")
          .notNull()
          .sampleData({
            foreignKeyStrategy: {
              type: "existing",
            },
          });
        table.date("date").notNull();
        table.minutesDuration("minutes", "SmallUint").notNull();
        table.string("description", 1000).notNull();
        if (opts.billable) {
          table.bool("billable").notNull().default(sql`true`);
        }
      });
    }
  }

  get projectsTableName() {
    return this.#projectsTableName!;
  }

  get tasksTableName() {
    return this.#tasksTableName!;
  }

  get taskStatusEnumName() {
    return this.#taskStatusEnumName!;
  }

  get timeEntriesTableName() {
    return this.#timeEntriesTableName!;
  }

  static Card = KanbanProjectListCard;

  static Pages = () => {
    const tablesWithBlock = system.db.getTablesWithBlock(
      KanbanProjectTableBlock,
    );
    return (
      <>
        {tablesWithBlock.map((table) => (
          <>
            <RecordPage table={table.name}>
              <div className="grid grid-cols-12 w-full mx-auto p-2 sm:px-4 md:gap-4 lg:px-10 xl:px-12 xl:max-w-7xl py-4 gap-3">
                <KanbanProjectListCard />
              </div>
            </RecordPage>
            <KanbanProjectPage table={table.name} />
          </>
        ))}
      </>
    );
  };

  static Reports = {
    ProjectsOverview: ProjectsOverviewReport,
    TimeTrackingOverview: TimeTrackingOverviewReport,
  };

  override getDetailTab() {
    return {
      value: "projects",
      header: (
        <>
          <ListItemDecorator>
            <MaterialIcon icon="ViewKanban" />
          </ListItemDecorator>
          Projects
        </>
      ),
      content: <KanbanProjectListCard />,
    };
  }
}

interface KanbanProjectTableBlockOpts {
  timeTracking?: {
    billable?: boolean;
  };
  statuses?: HelperEnumValue[];
  statusType?: "basic" | "consulting_basic" | "consulting_advanced";
  assignable?: boolean;
}
