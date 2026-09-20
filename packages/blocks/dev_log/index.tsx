import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";

interface DevLogBlockOpts {
  categories: string[];
}

/**
 This block is used to log messages in the database for development purposes.

 This basically just adds a table to the database that can be used to log messages and will be standardized.

 Eventually this will be replaced behind the scenes with a more efficient implementation, but for now
 it is just like any other table in the database, meaning it is kept in memory. That means you should
 USE THIS SPARINGLY, but it is useful for logging messages.

 @category Block
 */
export class DevLogBlock implements Block {
  blockName = "DevLogBlock";

  constructor(public opts: DevLogBlockOpts) {}

  initialize() {
    system.enum_({
      name: "dev_log_category",
      values: this.opts.categories,
    });
    system.enum_({
      name: "dev_log_level",
      values: ["debug", "info", "warn", "error"],
    });
    system.db.table("dev_log_entries", (table) => {
      table.string("message", 255).notNull();
      table.string("description", 24_000);
      table.enum("category", "dev_log_category");
      table.enum("level", "dev_log_level");
    });
  }

  /**
   * Registers an additional log category at generation time, extending
   * the `dev_log_category` enum. No-op if the category already exists, so
   * it is safe to call from multiple blocks that share the dev log.
   */
  addCategory(category: string) {
    if (this.opts.categories.includes(category)) {
      return;
    }
    this.opts.categories.push(category);
    system.addVariantToEnum("dev_log_category", {
      name: category,
      renameFrom: category,
    });
  }

  /**
   * Emits a runtime log row into `dev_log_entries`. Call from within a
   * procedure with the statement builder. String options are treated as
   * SQL literals; pass a {@link Sql} expression to log a computed value.
   *
   * @param opts.category Log category; must be one of the configured
   *   `categories` (see {@link DevLogBlock.addCategory}).
   * @param opts.level Severity: `debug`, `info`, `warn`, or `error`.
   * @param opts.message Short summary message.
   * @param opts.description Optional longer detail body.
   */
  log<S extends IServerBaseStatements>(
    s: S,
    opts: {
      category: string | Sql;
      level: "debug" | "info" | "warn" | "error" | Sql;
      message: string | Sql;
      description?: string | Sql;
    },
  ) {
    const category = typeof opts.category === "string"
      ? sql.lit(opts.category)
      : opts.category;
    const level = typeof opts.level === "string"
      ? sql.lit(opts.level)
      : opts.level;
    const message = typeof opts.message === "string"
      ? sql.lit(opts.message)
      : opts.message;
    const description = typeof opts.description === "string"
      ? sql.lit(opts.description)
      : opts.description;
    s.modify(
      sql.insertValues(
        "dev_log_entries",
        ["category", "level", "message", "description"],
        [
          category,
          sql`${level}::enums.dev_log_level`,
          message,
          description ?? sql.null,
        ],
      ),
    );
  }
}
