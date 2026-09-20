---
title: Dev Log Block
description: Adds a standardized dev_log_entries table plus category and level enums for logging runtime messages from Yolm procedures.
tags:
  - blocks
  - logging
  - diagnostics
  - system-block
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
  - blocks/calendar_integrations.md
  - blocks/email_integrations.md
---

# Dev Log Block

`DevLogBlock` adds a single standardized table, `dev_log_entries`, for writing
runtime log rows from procedures, reactors, and scheduled jobs. Use it for
development and operational diagnostics (reconciliation runs, integration
errors) instead of hand-rolling a one-off log table. Rows are written with the
block's `log` helper so the shape stays consistent across the system.

> The table is kept in memory like any other Yolm table, so use it sparingly.
> It is intended for low-volume diagnostic logging, not high-frequency tracing.

```ts
import { DevLogBlock } from "blocks/dev_log";
```

## Minimal Setup

Register the block in `core.tsx` with the set of log categories your system
uses. `categories` seeds the `dev_log_category` enum.

```ts
import { DevLogBlock } from "blocks/dev_log";
import { system } from "std/system";

system.addBlock(
  new DevLogBlock({
    categories: [
      "outlook_calendar_reconciliation",
      "google_calendar_reconciliation",
    ],
  }),
);
```

## Configuration

| Option       | Type       | Required | Meaning                                                              |
| ------------ | ---------- | -------- | ------------------------------------------------------------------- |
| `categories` | `string[]` | Yes      | Initial values for the `dev_log_category` enum. May be empty (`[]`). |

There is no default; `categories` must be passed. Additional categories can be
added later at generation time with [`addCategory`](#addcategory) — useful when
other blocks contribute their own categories to a shared dev log.

## Tables Created

| Table             | Purpose                                                  |
| ----------------- | ------------------------------------------------------- |
| `dev_log_entries` | One row per logged message, written via `log`.          |

`dev_log_entries` columns:

| Column        | Type                              | Notes                                          |
| ------------- | --------------------------------- | ---------------------------------------------- |
| `message`     | `string(255)`, not null           | Short summary message.                         |
| `description` | `string(24000)`, nullable         | Optional longer detail body.                   |
| `category`    | enum `dev_log_category`, nullable | One of the configured categories; set by `log`. |
| `level`       | enum `dev_log_level`, nullable    | `debug`, `info`, `warn`, or `error`; set by `log`. |

## Enums Created

| Enum               | Values                                          |
| ------------------ | ----------------------------------------------- |
| `dev_log_category` | The `categories` passed to the constructor (plus any added via `addCategory`). |
| `dev_log_level`    | `debug`, `info`, `warn`, `error` (fixed).       |

## Methods

Retrieve the registered block instance with `system.block(DevLogBlock)`. When
your code lives in a block or module that may run in a system where the dev log
is not registered, guard the call with `system.blockOptional(DevLogBlock)`
(`system.block` throws if the block is not registered).

### `log`

```ts
log<S extends IServerBaseStatements>(
  s: S,
  opts: {
    category: string | Sql;
    level: "debug" | "info" | "warn" | "error" | Sql;
    message: string | Sql;
    description?: string | Sql;
  },
): void
```

Inserts one row into `dev_log_entries`. Call it from within a procedure with the
statement builder `s`. String values are treated as SQL **literals**; pass a
`Sql` expression (e.g. `` sql`...` ``, `sql.concat(...)`) to log a computed
value.

| Param               | Type                                       | Required | Meaning                                                  |
| ------------------- | ------------------------------------------ | -------- | ------------------------------------------------------- |
| `s`                 | `IServerBaseStatements`                    | Yes      | The statement builder for the current procedure.        |
| `opts.category`     | `string \| Sql`                            | Yes      | Log category; must be a configured `dev_log_category`.  |
| `opts.level`        | `"debug" \| "info" \| "warn" \| "error" \| Sql` | Yes | Severity level.                                          |
| `opts.message`      | `string \| Sql`                            | Yes      | Short summary message.                                  |
| `opts.description`  | `string \| Sql`                            | No       | Optional longer detail body.                            |

```ts
import { DevLogBlock } from "blocks/dev_log";
import { sql } from "std/sql_utils";
import { system } from "std/system";

// inside a procedure / reactor body that receives `s`
if (system.blockOptional(DevLogBlock)) {
  s.startTransaction();
  system.block(DevLogBlock).log(s, {
    category: "outlook_calendar_reconciliation",
    level: "info",
    message: sql.concat(
      "Reconciled outlook calendar ",
      sql`calendar_record.id::string`,
    ),
    description: "created=0 updated=0 deleted=0",
  });
  s.commitTransaction();
}
```

### `addCategory`

```ts
addCategory(category: string): void
```

Registers an additional log category at generation time, extending the
`dev_log_category` enum. No-op if the category already exists, so it is safe to
call from multiple blocks that share the dev log. Call it during another block's
`initialize`, before any `log` call uses the new category.

```ts
import { DevLogBlock } from "blocks/dev_log";
import { system } from "std/system";

if (system.blockOptional(DevLogBlock)) {
  system.block(DevLogBlock).addCategory("outlook_calendar_reconciliation");
}
```

## Relationships to Other Blocks

The [calendar integrations](calendar_integrations.md) and
[email integrations](email_integrations.md) blocks consume `DevLogBlock`
optionally: they call `addCategory` in their `initialize` and `log`
reconciliation results, each guarded by `system.blockOptional(DevLogBlock)`.
This is the recommended pattern for any block that wants to log without hard
depending on the dev log being present.

## Common Mistakes

- **Logging high-frequency events.** The table lives in memory; reserve it for
  low-volume diagnostics, not per-request tracing.
- **Logging an unregistered category.** Categories must exist in
  `dev_log_category`. Add them via the constructor `categories` or
  `addCategory` before the first `log` call uses them.
- **Forgetting that strings are literals.** A plain `string` for `message` /
  `description` / `category` becomes a SQL literal. To log a computed column or
  expression, pass a `Sql` value (`` sql`...` ``, `sql.concat(...)`), not a
  template-interpolated string.
- **Calling `system.block(DevLogBlock)` unconditionally in shared code.** In
  systems where the block is not registered this throws; guard with
  `system.blockOptional(DevLogBlock)` when the dependency is optional.
- **Wrapping in `<Route>` or looking for UI components.** This block ships no
  components or pages — it only adds the table and enums. Build any viewer UI
  with the standard datagrid/record page components over `dev_log_entries`.
