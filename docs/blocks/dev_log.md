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

`DevLogBlock` adds one standardized table, `dev_log_entries`, for low-volume
diagnostic rows written from procedures, reactors, and scheduled jobs
(reconciliation runs, integration errors). The table is kept in memory like any
other Yolm table, so do not use it for high-frequency or per-request tracing.

## Minimal Setup

`categories` (required, may be `[]`) seeds the `dev_log_category` enum:

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

## Tables and Enums

- `dev_log_entries`: one row per logged message (`message`, optional
  `description`, `category`, `level`).
- `dev_log_category`: the configured categories plus any added with
  `addCategory`.
- `dev_log_level`: `debug`, `info`, `warn`, `error`.

The block ships no pages or components; build any viewer with standard
datagrid/record page components over `dev_log_entries`.

## Methods

`system.block(DevLogBlock)` throws when the block is not registered. Shared code
whose systems may omit the dev log should guard with
`system.blockOptional(DevLogBlock)`, as the
[calendar integrations](calendar_integrations.md) and
[email integrations](email_integrations.md) blocks do.

### `log(s, { category, level, message, description? })`

Inserts one row into `dev_log_entries` inside the caller's transaction. Plain
strings become SQL **literals**; pass a `Sql` expression (`` sql`...` ``,
`sql.concat(...)`) to log a computed value. `category` must already be a
configured category.

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

### `addCategory(category)`

Extends `dev_log_category` at generation time; a no-op if the category exists,
so several blocks can share it. Call it during another block's `initialize`,
before any `log` uses the category:

```ts
if (system.blockOptional(DevLogBlock)) {
  system.block(DevLogBlock).addCategory("outlook_calendar_reconciliation");
}
```
