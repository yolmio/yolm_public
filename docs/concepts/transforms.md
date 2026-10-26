---
title: Transforms
description: Choose compact, sameSchema, or newSchema transforms for storage cleanup, data changes, and schema migrations.
tags:
  - concepts
  - transforms
  - migrations
  - schema
  - upgrade
---

# Transforms

Transforms create a separate database output for **storage cleanup, custom data
changes, or schema migrations**. Use `compact` to reclaim space without changing
live data. Use `sameSchema` or `newSchema` when you need custom logic to replay
transaction history.

Not every deployed schema change needs an explicit transform. New tables,
nullable fields, enum values, and identity-preserving `renameFrom` changes use a
compatible deploy. Removing a table or field uses a compatible deploy that
retains its physical slot and data as an orphan. Adding a required field or
tightening nullability with a default uses automatic backfill.

Use a transform when deploy compatibility requires one or when you need custom
historical-data behavior, such as:

- Adding or tightening a required field without a default
- Making an incompatible field-type, key, or constraint change
- Removing, merging, or semantically remapping enum values
- Merging or splitting tables
- Cleaning up or enriching historical data as part of the deploy

## Basic Structure

A replay transform (`sameSchema` or `newSchema`) consists of:

1. **Setup** - Optional statements run once before processing
2. **Tables** - Table-specific transformation logic
3. **Finalize** - Optional statements run once after processing

```typescript
system.addTransform({
  name: "upgrade_v2",
  kind: { type: "newSchema", sourceDatabase: "old_db" },  // or { type: "sameSchema" } for maintenance
  setup: (s) => {
    // Optional: Initialize before processing
  },
  tables: [
    {
      table: "users",
      process: (s) => {
        // Handle each operation (insert/update/delete)
        // 'op' contains the operation details
      },
    },
  ],
  finalize: (s) => {
    // Optional: Cleanup after processing
  },
});
```

## Transform Kinds

| Kind | Use it for |
|------|------------|
| `compact` | Removing obsolete history and deleted data from selected tables, without changing live data or schema |
| `sameSchema` | Custom data changes while keeping the schema |
| `newSchema` | Custom migration from a named source database into the target schema |

### NewSchema

Used when migrating to a different schema structure:

```typescript
system.addTransform({
  name: "upgrade_v2",
  kind: { type: "newSchema", sourceDatabase: "old_db" },
  // ...
});
```

### SameSchema

Used for data maintenance on the same schema:

```typescript
system.addTransform({
  name: "cleanup",
  kind: { type: "sameSchema" },
  // ...
});
```

### Compact

Use `compact` when you only want to reclaim space. For example, System 6's
email-history compaction selects four tables:

```typescript
import { system } from "std/system";

system.addTransform({
  name: "compact_email_history",
  kind: {
    type: "compact",
    tables: [
      "user_email_identities",
      "user_all_emails",
      "user_email_recipients",
      "user_email_attachments",
    ],
  },
  tables: [],
});
```

The two `tables` properties serve different purposes:

- `kind.tables` selects the tables to compact. List at least one existing table,
  with no duplicates.
- The outer `tables` holds replay handlers. Leave it empty for `compact`; the
  platform does the work. Do not add setup, finalize, or `disableAutomaticReplay`.

Compaction preserves live values, record IDs, transaction IDs, the source schema,
and other tables' history. To compact just one table, the same definition can use
`kind: { type: "compact", tables: ["import_invoice_expense_totals"] }`, as in
the System 5 import-history example.

**Keep the original backup.** Removed history and deleted data cannot be
recovered from the compacted output. In Forge, validate the transform against
the selected source database, then use Studio's Run Transform action with the
transform `name` and `sourceDatabaseId`. `validate()` and Run Transform generate
transforms with every named dev database bound by name; see
[Running Transforms in Forge](#running-transforms-in-forge). The action creates
and returns a separate output database; it does not mutate the source. Query the
returned database with `queryDatabase` and inspect the transform run record
before using the output. Compare row counts and hashes for compaction or identity-preserving
transforms. For replay transforms that intentionally map values, verify the
expected mappings, invariants, and representative output rows instead.

### Custom Replay Example

Use a replay transform when you need to change values or map fields. Assuming
`old_system` is a configured source database with a `contacts` table and the
target has matching fields:

```typescript
import { system } from "std/system";
import { sql } from "std/sql_utils";
import { transformTableProcess } from "std/transform_helpers";

system.addTransform({
  name: "normalize_contacts",
  kind: { type: "newSchema", sourceDatabase: "old_system" },
  tables: [{
    table: "contacts",
    process: transformTableProcess({
      sourceDb: "old_system",
      table: "contacts",
      mappings: {
        email: (value) => sql`lower(${value})`,
      },
    }),
  }],
});
```

This lowercases email values during replay. The helper handles inserts, updates,
deletes, restores, and SKIPs (which preserve IDs for omitted records). For custom
changes within the existing schema, use `sameSchema` with the appropriate table
handlers. For space cleanup alone, prefer `compact` instead of writing handlers.

`transformTableProcess` and `transformTableWithIdMapping` read the source
table's column types from the dev database. A field without a custom mapping
has its source enum value converted to the target column's enum by name, as
automatic replay does. A custom mapping function (in `mappings` or
`defaultTransform`) receives the raw `op.<table>__<field>` value with its
source type, so it can map a value the target enum no longer has, and must
return a value of the target column's type:

```typescript
mappings: {
  // Source enum: NEW, done. Target enum order_status: pending, done.
  status: (value) =>
    sql`case cast(${value} as string) when 'NEW' then 'pending'
      else cast(${value} as string) end::enums.order_status`,
},
```

Use `opFieldValue(table, field, ty, targetEnum)` from `std/transform_helpers`
for the automatic conversion in a hand-written handler.

## Automatic Replay

A `sameSchema` or `newSchema` transform covers every target table, not only the
tables listed in `tables`:

- A listed table, by source table name, runs only its `process` handler.
- An unlisted table is copied without replay when its source and target
  layouts are passthrough-compatible: the same primary key field and the same
  fields, by name or `renameFrom`.
- Other unlisted tables are replayed automatically. Inserts, updates, deletes,
  restores, and skips are applied in order, and record IDs are preserved. Each
  target field is copied from its source field, matched by name or
  `renameFrom`, when both have the same type. Enum values are converted to the
  target enum by name. Target fields without a same-typed source field get
  their defaults.
- A table is not replayed automatically when a required target field without a
  default has no same-typed source field, or when the target table has a
  `Decimal` field. Give such a table an explicit handler.

Set `disableAutomaticReplay: true` to replay only the listed tables. Unlisted
schema-incompatible tables are then not replayed. Do not set it on `compact`.

A replay transform must end up processing at least one table. A `sameSchema`
transform with `tables: []` would be a no-op, because source and target share
one schema and every table passes through unchanged, so it fails to compile.
Use [`compact`](#compact) to reclaim space, or list the tables whose values
should change. A `newSchema` transform with `tables: []` compiles only when at
least one table is replayed automatically.

## The Operation Record

Within a table's `process` procedure, the `op` record contains:

| Field | Description |
|-------|-------------|
| `op.kind` | Operation type: `'insert'`, `'update'`, `'delete'`, `'skip'`, or `'restore'` |
| `op.record_id` | ID of the record being modified |
| `op.skip_count` | Number of skipped operations represented by a `skip` op |
| `op.<table>__<field>` | Field value from the old schema, with the source column's type. In `newSchema`, enum fields use the source database's copy of the enum; cast through `string` to the target enum (see `opFieldValue`) |
| `op.<table>__<field>__set` | Boolean: was this field updated? (for updates) |
| `op.tx_id` | Transaction ID |
| `op.tx_timestamp` | Transaction timestamp |
| `op.tx_creator` | User who created the transaction |

## Before Writing a Schema Transform

Treat the deploy compatibility message as a starting point, not as the complete
mapping. Before writing SQL:

1. Read the current table definitions in `core.tsx` and the block/component that
   owns the table. Do not infer field names from table names. For example,
   `table.fk("organizations")` creates `organization_id`, not
   `organizations_id`.
2. Confirm the source database name used by the transform exists in Studio's
   dev databases registry. The `sourceDatabase` value controls which old schema
   validates `op.<table>__<field>` references.
3. Compare old and new field names from schema, not memory. If the deploy error
   only reports a type change or constraint change, assume field names stayed
   the same unless the schema proves otherwise.
4. Preserve record identity by letting transform replay assign the operation's
   `op.record_id`. Do not insert into the primary key field directly; normal
   transform inserts list non-primary-key fields, then updates/deletes target
   `where id = op.record_id`.
5. Convert values to the target field's semantic format, not just its scalar
   type. A string changed to `Json` may need a rich-text document object,
   settings object, or array shape. `to_json(old_string)` only produces a JSON
   string; it is not a valid replacement for structured JSON such as Lexical
   rich text.
6. If a new unique constraint was added, decide how duplicates in historical WAL
   should be handled. A plain insert can still fail during transform. Use
   `on conflict`, `merge`, filtering, or a validation step when duplicate source
   rows are possible. Double check with the user.
7. Handle `skip` and `restore` when replaying normal table history, especially
   for production databases that may have compacted transaction logs.

## Source Schema Helpers

Use `std/schema_utils` to inspect source and target schemas during generation:

```typescript
import {
  currentSystem,
  devDb,
  getSourceTable,
  getSourceTables,
  sourceTableExists,
} from "std/schema_utils";

const oldDb = devDb("production_before_v42");

if (sourceTableExists(oldDb, "email_templates")) {
  const sourceTable = getSourceTable(oldDb, "email_templates");
}

const targetTables = getSourceTables(currentSystem());
```

| Helper | Description |
|--------|-------------|
| `devDb(name)` | Source descriptor for a dev database used by the transform. |
| `currentSystem()` | Source descriptor for the target system schema. |
| `getSourceTables(source)` | All table schemas in a source. |
| `getSourceTable(source, tableName)` | One table schema, or `undefined`. |
| `getSourceColumnNames(source, tableName)` | Non-orphan column names for a table. |
| `getSourceColumn(source, tableName, columnName)` | One column schema, or `undefined`. |
| `sourceTableExists(source, tableName)` | Whether a source table exists. |

Use these to avoid stale field lists and handle optional source tables.
Transform procedures still read source values through `op` and explicit SQL.
A `devDb(name)` that is not bound during generation has no tables; see
[Running Transforms in Forge](#running-transforms-in-forge).

## Adding a New Field

A new nullable field is compatible, and a required field with a declared
default uses automatic backfill. Use an explicit transform when the historical
value needs custom computation, as in this example:

```typescript
// Old schema
const oldTable: Table = {
  name: "products",
  fields: [
    { name: "name", type: { type: "String", maxLength: 100 }, notNull: true },
    { name: "price", type: { type: "Decimal", precision: 10, scale: 2 }, notNull: true },
  ],
};

// New schema adds 'currency' field
const newTable: Table = {
  name: "products",
  fields: [
    { name: "name", type: { type: "String", maxLength: 100 }, notNull: true },
    { name: "price", type: { type: "Decimal", precision: 10, scale: 2 }, notNull: true },
    { name: "currency", type: { type: "String", maxLength: 3 }, notNull: true },  // NEW
  ],
};

// Transform
system.addTransform({
  name: "add_currency",
  kind: { type: "newSchema", sourceDatabase: "old_db" },
  tables: [
    {
      table: "products",
      process: (s) => {
        s.if(sql`op.kind = 'insert'`, (s) => {
          s.modify(sql`
            insert into db.products (name, price, currency)
            values (op.products__name, op.products__price, 'USD')
          `);
        });

        s.if(sql`op.kind = 'update'`, (s) => {
          s.modify(sql`
            update db.products
            set
              name = case when op.products__name__set then op.products__name else name end,
              price = case when op.products__price__set then op.products__price else price end
            where id = op.record_id
          `);
        });

        s.if(sql`op.kind = 'delete'`, (s) => {
          s.modify(sql`delete from db.products where id = op.record_id`);
        });
      },
    },
  ],
});
```

## Renaming a Field

Use `renameFrom` to preserve physical identity and existing data across a
field rename. This is a compatible deploy:

```typescript
db.table("users", (table) => {
  table.string("username", 100).notNull().renameFrom("user_name");
});
```

Use a transform only when the rename is combined with an incompatible type
change or needs a custom historical-data mapping.

## Changing Field Types

Convert field types during migration:

```typescript
// Old: 'quantity' as String -> New: 'quantity' as Int
{
  table: "inventory",
  process: (s) => {
    s.if(sql`op.kind = 'insert'`, (s) => {
      s.modify(sql`
        insert into db.inventory (product_id, quantity)
        values (
          op.inventory__product_id,
          coalesce(try_cast(op.inventory__quantity as int), 0)
        )
      `);
    });
    // ... handle update and delete
  },
}
```

## Changing to Structured JSON

When a field changes to `Json`, migrate to the JSON shape expected by the code
that reads it. The target scalar type alone is not enough.

For plain JSON strings, `to_json(old_value)` may be correct. For rich text,
settings, editor state, or API payload snapshots, use the constructor or helper
that produces the expected object shape.

Example: converting plain-text comments to Lexical rich text:

```typescript
{
  table: "contacts_comments",
  process: (s) => {
    s.if(sql`op.kind = 'insert'`, (s) => {
      s.modify(sql`
        insert into db.contacts_comments
          (contact_id, sys_user_id, created_at, comments)
        values (
          op.contacts_comments__contact_id,
          op.contacts_comments__sys_user_id,
          op.contacts_comments__created_at,
          fn.lexical_simple_paragraph(op.contacts_comments__comments)
        )
      `);
    });

    s.if(sql`op.kind = 'update'`, (s) => {
      s.modify(sql`
        update db.contacts_comments
        set comments = case
          when op.contacts_comments__comments__set
            then fn.lexical_simple_paragraph(op.contacts_comments__comments)
          else comments
        end
        where id = op.record_id
      `);
    });
  },
}
```

## Migrating Enum Values

Adding an enum value or renaming one with `renameFrom` is compatible. Use a
transform when values are removed, merged, or require a custom semantic mapping:

```typescript
// Old enum: pending, processing, completed, cancelled
// New enum: created, in_progress, done, cancelled, archived

{
  table: "orders",
  process: (s) => {
    // Create a mapping expression
    // In newSchema, op.orders__status uses the source enum; compare as string
    s.defScalar("new_status", sql`
      case cast(op.orders__status as string)
        when 'pending' then 'created'
        when 'processing' then 'in_progress'
        when 'completed' then 'done'
        when 'cancelled' then 'archived'
        else 'created'
      end
    `);

    s.if(sql`op.kind = 'insert'`, (s) => {
      s.modify(sql`
        insert into db.orders (customer_id, status)
        values (op.orders__customer_id, new_status::enums.order_status)
      `);
    });

    s.if(sql`op.kind = 'update'`, (s) => {
      s.modify(sql`
        update db.orders
        set status = case
          when op.orders__status__set then new_status::enums.order_status
          else status
        end
        where id = op.record_id
      `);
    });

    s.if(sql`op.kind = 'delete'`, (s) => {
      s.modify(sql`delete from db.orders where id = op.record_id`);
    });
  },
}
```

## Adding Unique Constraints

Adding a unique constraint can make historical replay fail even when the target
schema compiles. Check whether the source data can contain duplicates under the
new key and make the conflict behavior explicit.

Use `on conflict` when later source rows should overwrite earlier rows:

```typescript
{
  table: "user_google_calendar_events",
  process: (s) => {
    s.if(sql`op.kind = 'insert'`, (s) => {
      s.modify(sql`
        insert into db.user_google_calendar_events
          (
            user_google_calendar_id,
            google_event_id,
            summary,
            start_time,
            end_time
          )
        values (
          op.user_google_calendar_events__user_google_calendar_id,
          op.user_google_calendar_events__google_event_id,
          op.user_google_calendar_events__summary,
          op.user_google_calendar_events__start_time,
          op.user_google_calendar_events__end_time
        )
        on conflict (user_google_calendar_id, google_event_id) do update set
          summary = excluded.summary,
          start_time = excluded.start_time,
          end_time = excluded.end_time
      `);
    });
  },
}
```

If duplicate rows must be investigated instead of collapsed, add validation in
`setup` or run the transform against a copied production database first and
inspect the duplicate key groups.

## Splitting a Table

Split one table into multiple:

```typescript
// Old: users table with address fields
// New: separate users and addresses tables

{
  table: "users",
  process: (s) => {
    s.if(sql`op.kind = 'insert'`, (s) => {
      // Insert into users
      s.modify(sql`
        insert into db.users (name, email)
        values (op.users__name, op.users__email)
      `);

      // Insert into addresses
      s.if(sql`op.users__street is not null`, (s) => {
        s.modify(sql`
          insert into db.addresses (user_id, street, city, zip)
          values (
            op.record_id,
            op.users__street,
            op.users__city,
            op.users__zip
          )
        `);
      });
    });

    s.if(sql`op.kind = 'update'`, (s) => {
      // Update users table
      s.modify(sql`
        update db.users
        set
          name = case when op.users__name__set then op.users__name else name end,
          email = case when op.users__email__set then op.users__email else email end
        where id = op.record_id
      `);

      // Update or insert address
      s.if(sql`
        op.users__street__set or op.users__city__set or op.users__zip__set
      `, (s) => {
        s.modify(sql`
          merge into db.addresses
          using (select op.record_id as user_id) as src
          on db.addresses.user_id = src.user_id
          when matched then
            update set
              street = case when op.users__street__set then op.users__street else street end,
              city = case when op.users__city__set then op.users__city else city end,
              zip = case when op.users__zip__set then op.users__zip else zip end
          when not matched then
            insert (user_id, street, city, zip)
            values (op.record_id, op.users__street, op.users__city, op.users__zip)
        `);
      });
    });

    s.if(sql`op.kind = 'delete'`, (s) => {
      s.modify(sql`delete from db.addresses where user_id = op.record_id`);
      s.modify(sql`delete from db.users where id = op.record_id`);
    });
  },
}
```

## Merging Tables

Merge multiple tables into one:

```typescript
// Old: separate personal_info and contact_info tables
// New: single users table

// Handle personal_info
{
  table: "personal_info",
  process: (s) => {
    s.if(sql`op.kind = 'insert'`, (s) => {
      s.modify(sql`
        insert into db.users (first_name, last_name)
        values (op.personal_info__first_name, op.personal_info__last_name)
      `);
    });
    // ... handle update and delete
  },
},

// Handle contact_info (updates the same users table)
{
  table: "contact_info",
  process: (s) => {
    s.if(sql`op.kind = 'insert'`, (s) => {
      s.modify(sql`
        update db.users
        set email = op.contact_info__email, phone = op.contact_info__phone
        where id = op.contact_info__user_id
      `);
    });
    // ... handle update and delete
  },
}
```

## Data Cleanup

Clean up data during migration:

```typescript
{
  table: "products",
  process: (s) => {
    s.if(sql`op.kind = 'insert'`, (s) => {
      // Skip invalid records
      s.if(sql`op.products__price > 0 and op.products__name is not null`, (s) => {
        s.modify(sql`
          insert into db.products (name, price, description)
          values (
            trim(op.products__name),
            op.products__price,
            coalesce(trim(op.products__description), '')
          )
        `);
      });
    });
    // ... handle update and delete
  },
}
```

## Compacting Latest State

For space cleanup without custom mappings, prefer [Compact](#compact). The
pattern below is for replay transforms that also need custom field mappings or
row filtering.

For high-churn tables where transaction history is not needed in the target
database, a transform can compact WAL history into the latest source row state.
This keeps transform semantics, source record IDs, and referential integrity
without replaying every update and delete.

Use `latestStateProcess` from `std/transform_helpers` for this pattern:

```typescript
import {
  latestStateProcess,
  transformTableProcess,
} from "std/transform_helpers";

{
  table: "email_templates",
  process: latestStateProcess({
    targetTable: "email_templates",
    sourceTable: sql.ref("old_db", "email_templates"),
    fields: Object.values(system.db.tables.email_templates.fields),
    fieldExpr: (field, alias) => sql.ref(alias, field.name),
  }),
}
```

For full-table schema mappings where a source table mostly maps one-to-one to
the target table, `transformTableProcess({ sourceDb, table, ... })` generates
the insert/update/delete process from source schema metadata. It accepts the
field-mapping options from `std/transform_helpers` (for example `exclude` and
`mappings`) and returns a transform `process` function:

```typescript
process: transformTableProcess({
  sourceDb: "old_system",
  table: "contacts",
  exclude: ["legacy_blob"],
  mappings: {
    email: normalizers.lowerString,
  },
})
```

Key points:

- Use a transform, not a pipeline, when you need WAL-aware behavior such as
  preserving `op.record_id`, source transaction ordering, or skip/restore
  semantics. Pipelines are simpler for bulk row imports but do not replay WAL
  history.
- Compact only tables where losing update/delete history is acceptable. The
  latest-state process handles source insert operations, inserts the current
  source row if it still exists, emits `encodeSkipOp({ count: 1 })` for rows
  that were deleted or filtered out, and ignores update/delete operations.
- Keep source-database reads explicit. When source and target field formats
  differ, provide `fieldExpr` or `overrides` for conversions such as enum casts,
  foreign key ID normalization, encryption changes, or rich text conversion.
- Validate with more than row counts: check missing/extra IDs, important field
  diffs, foreign-key orphans, decryptability of migrated secrets, and rendering
  of migrated rich text.

## Running Transforms in Forge

Generation resolves `devDb(name)` and `sourceDatabase` through a name-to-UUID
binding of dev databases. Studio's Run Transform action and `validate()` bind
every named dev database by name. The Forge MCP `runTransform` tool binds only
the selected source under its registered name; optional MCP `sources` entries
add or override bindings; see
[Forge development databases](../ai/forge_databases.md#database-bindings).

An unbound name has no schema. `getSourceTables(devDb(name))` returns `[]` and
logs a generation warning, so a transform that adds tables only when source
metadata exists generates nothing for them. Check version logs for the warning.

`validate()` checks transforms and pipelines together with the serving system,
but it does not run a transform. Run it against a dev database and inspect the
output before deploying.

## How Transforms Work

1. **Setup Phase**: Executes setup statements once
2. **Block Processing**: For each WAL (transaction log) block:
   - Reads operations from the old database
   - Executes table process procedures for each operation
   - Operations are processed in the order they occurred
3. **Finalize Phase**: Executes finalize statements once
4. **Snapshot**: Creates a new database snapshot

## Best Practices

1. **Test thoroughly**: Run transforms on a copy of production data first
2. **Handle all operation types**: Always handle insert, update, and delete,
   plus `skip` and `restore` when replaying table history
3. **Preserve record identity**: Let transform replay assign `op.record_id`;
   do not list primary key fields in normal inserts
4. **Handle NULLs**: Use `coalesce` for fields that might be null
5. **Use semantic conversions**: Convert values to the object or enum shape the
   new runtime code expects, not merely to the new scalar type
6. **Handle new constraints intentionally**: Unique constraints, not-null
   constraints, and foreign keys may require conflict handling or cleanup
7. **Use transactions in setup/finalize**: Wrap setup and finalize operations in transactions
8. **Validate data**: Add validation logic to catch data issues during migration

## Complete Example

```typescript
system.addTransform({
  name: "v1_to_v2",
  kind: { type: "newSchema", sourceDatabase: "v1_db" },
  tables: [
    {
      table: "users",
      process: (s) => {
        s.if(sql`op.kind = 'insert'`, (s) => {
          s.modify(sql`
            insert into db.users (username, email)
            values (
              lower(trim(op.users__name)),
              lower(trim(op.users__email))
            )
          `);
        });

        s.if(sql`op.kind = 'update'`, (s) => {
          s.modify(sql`
            update db.users
            set
              username = case when op.users__name__set then lower(trim(op.users__name)) else username end,
              email = case when op.users__email__set then lower(trim(op.users__email)) else email end
            where id = op.record_id
          `);
        });

        s.if(sql`op.kind = 'delete'`, (s) => {
          s.modify(sql`delete from db.users where id = op.record_id`);
        });

        s.if(sql`op.kind = 'skip'`, (s) => {
          s.encodeSkipOp({ table: "users", count: sql`op.skip_count` });
        });

        s.if(sql`op.kind = 'restore'`, (s) => {
          s.restore("users", sql`select op.record_id`);
        });
      },
    },
  ],
});
```

Do not add `created_at`, `updated_at`, or a migrations log table to record
when rows changed or when a transform ran. Read creation and modification
times with [transaction queries](../sql/transaction_queries.md), and use the
transform run record for when the transform ran.
