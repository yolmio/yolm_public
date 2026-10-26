import { ListItemDecorator } from "components/list";
import { MaterialIcon } from "components/material_icon";
import { singularize } from "std/inflectors";
import { system, TableBlock } from "std/system";
import type { Table, TableBuilder } from "std/system";
import { NotesListCard } from "./notes_list_card";

/** Options for {@link NotesListTableBlock}. */
export type NotesListTableBlockOpts = {
  /** Hook to add extra fields/indexes to the generated notes table during setup. */
  populate?: (table: TableBuilder) => void;
};

/**
 Add a related notes table to the given main table.

 The notes table will be named `${mainTable}_note`, and will have a foreign key to the main table.

 The notes table will have the following fields:
 content: string
 date: date

 Use the NotesListCard component to display the notes.
 */
export class NotesListTableBlock extends TableBlock<NotesListTableBlockOpts> {
  #tableName?: string;
  #table?: Table;

  constructor(tableName: string, opts: NotesListTableBlockOpts = {}) {
    super(tableName, opts);
  }

  initialize(mainTable: TableBuilder) {
    this.#tableName = `${singularize(mainTable.name)}_notes`;
    system.db.table(this.#tableName, (table) => {
      table.fk(mainTable.name).notNull();
      table.string("content", 64_000).notNull();
      table.date("date").notNull();
      this.opts.populate?.(table);
    });
  }

  /** The generated notes table model (`${singularize(mainTable)}_notes`), resolved lazily. */
  get table() {
    if (!this.#table) {
      this.#table = system.db.tables[this.#tableName!];
    }
    return this.#table!;
  }

  override getDetailTab(_table: Table) {
    return {
      value: "notes",
      header: (
        <>
          <ListItemDecorator>
            <MaterialIcon icon="Notes" />
          </ListItemDecorator>
          Notes
        </>
      ),
      content: <NotesListCard />,
    };
  }
}
