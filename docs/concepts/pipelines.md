---
title: Pipelines
description: How to use Yolm streaming pipelines for bulk data loading, transforms, and staged workflows over Yolm databases.
tags:
  - concepts
  - pipelines
  - data-import
  - csv
  - data-processing
---

# Pipelines

Pipelines are designed for **bulk data loading and transformation** in a
streaming fashion. Stages run in dependency order; set `parallelize: true` on
a stage when its row work is safe to run in parallel. A pipeline operates over
rows from Yolm database tables; it does not read CSV or Parquet files directly.

They are the primary mechanism for:

- Moving data from one Yolm database table into another
- Processing data in stages with dependencies between stages
- Running setup/finalize procedures around the loading process
- Handling per-row processing, sequentially by default or in parallel when
  explicitly enabled

If your source data is a CSV or Parquet file, import it into a Yolm database
first with Studio's database import tools. The pipeline then reads from the
table created in that source database. See [Forge transfers](../ai/forge_transfers.md)
for the supported import and export workflow.

## Basic Structure

A pipeline consists of:

1. **Setup** - Optional pre-processing statements (runs once before import)
2. **Stages** - Optional processing stages that handle rows from source tables
3. **Finalize** - Optional post-processing statements (runs once after stages)

```typescript
system.addPipeline({
  name: "import_users",
  setup: (s) => {
    // Optional: Run before import starts
    s.startTransaction();
    s.modify(sql`insert into db.import_log (message) values ('Starting import')`);
    s.commitTransaction();
  },
  stages: [
    {
      name: "users",
      source: "imports.users",  // Yolm database table: <database>.<table>
      dependencies: [],          // Other stages this depends on
      process: (s) => {
        // Process each row - 'record' contains the source table row
        s.modify(sql`
          insert into db.users (name, email, age)
          values (record.name, record.email, record.age)
        `);
      },
    },
  ],
  finalize: (s) => {
    // Optional: Run after import completes
    s.startTransaction();
    s.modify(sql`insert into db.import_log (message) values ('Import complete')`);
    s.commitTransaction();
  },
});
```

## Setup/Finalize-Only Pipelines

Pipelines do not need stages. `setup` and `finalize` are server procedures that
each run once, so a pipeline can also be a named one-time action instead of a
streaming import.

This is useful for:

- Initializing a development database
- Seeding static demo or reference data
- Running a backfill or repair
- Performing a controlled maintenance step from Studio or Forge

Use `finalize` for the main body when there is no row source to stream:

```typescript
system.addPipeline({
  name: "init-dev-db",
  finalize: (s) => {
    s.startTransaction();
    s.modify(sql`
      insert into db.sys_users (email)
      values ('test@yolm.ai')
    `);
    s.commitTransaction();
  },
});
```

Stages are only needed when the pipeline should process rows from source tables.

## Source Tables

Pipeline stages read from Yolm database tables. Use the `source` field to name the source database and table:

```typescript
{
  source: "imports.users",  // Format: "<database_name>.<table_name>"
  process: (s) => {
    // 'record' contains fields from the source table
    s.modify(sql`
      insert into db.users (name, email)
      values (record.name, record.email)
    `);
  },
}
```

The source database must already exist and contain the table before the pipeline
runs. For file-based data, use Studio's database import tools to import CSV or
Parquet into a Yolm database, then point the pipeline at that database table.

### Source schema helpers

Use `std/schema_utils` to inspect source schemas during generation:

```typescript
import { devDb, getSourceTables, sourceTableExists } from "std/schema_utils";

const source = devDb("imports");

if (sourceTableExists(source, "users")) {
  const tableNames = getSourceTables(source).map((table) => table.name);
}
```

| Helper | Description |
|--------|-------------|
| `devDb(name)` | Returns a source descriptor for a dev/import database. |
| `currentSystem()` | Returns a source descriptor for the current system schema. |
| `getSourceTables(source)` | Returns all table schemas for the source. |
| `getSourceTable(source, tableName)` | Returns one table schema, or `undefined`. |
| `getSourceColumnNames(source, tableName)` | Returns non-orphan column names for a source table. |
| `getSourceColumn(source, tableName, columnName)` | Returns one source column, or `undefined`. |
| `sourceTableExists(source, tableName)` | Returns whether the source table exists. |

These inspect registered schemas, not runtime rows. Use them for optional
import tables and generated mappings.

## Stage Dependencies

Stages can depend on other stages to ensure proper execution order:

```typescript
system.addPipeline({
  name: "import_orders",
  stages: [
    {
      name: "customers",
      source: "imports.customers",
      dependencies: [],
      process: (s) => {
        s.modify(sql`
          insert into db.customers (id, name)
          values (record.id, record.name)
        `);
      },
    },
    {
      name: "orders",
      source: "imports.orders",
      dependencies: ["customers"],  // Wait for customers first
      process: (s) => {
        s.modify(sql`
          insert into db.orders (id, customer_id, total)
          values (record.id, record.customer_id, record.total)
        `);
      },
    },
  ],
});
```

## Data Transformation

Pipelines can transform data while loading it:

```typescript
{
  source: "imports.products",
  process: (s) => {
    // Transform and validate during load
    s.modify(sql`
      insert into db.products (
        sku,
        name,
        price,
        category,
        created_at
      )
      values (
        upper(trim(record.sku)),
        trim(record.name),
        cast(record.price as decimal(10,2)),
        coalesce(record.category, 'uncategorized'),
        current_timestamp
      )
    `);
  },
}
```

## Handling Duplicates

Use MERGE or conditional logic to handle duplicates:

```typescript
{
  source: "imports.products",
  process: (s) => {
    // Upsert pattern
    s.modify(sql`
      merge into db.products
      using (select record.sku as sku, record.name as name, record.price as price) as src
      on db.products.sku = src.sku
      when matched then
        update set name = src.name, price = src.price, updated_at = current_timestamp
      when not matched then
        insert (sku, name, price, created_at)
        values (src.sku, src.name, src.price, current_timestamp)
    `);
  },
}
```

## Multiple Stages Example

Load a complete dataset with related tables:

```typescript
system.addPipeline({
  name: "import_ecommerce_data",
  setup: (s) => {
    s.startTransaction();
    s.modify(sql`delete from db.import_errors`);
    s.commitTransaction();
  },
  stages: [
    // Stage 1: Import categories (no dependencies)
    {
      name: "categories",
      source: "imports.categories",
      dependencies: [],
      process: (s) => {
        s.modify(sql`
          insert into db.categories (id, name, parent_id)
          values (record.id, record.name, try_cast(record.parent_id as bigint))
        `);
      },
    },
    // Stage 2: Import products (depends on categories)
    {
      name: "products",
      source: "imports.products",
      dependencies: ["categories"],
      process: (s) => {
        s.if(sql`exists (select 1 from db.categories where id = record.category_id)`, (s) => {
          s.modify(sql`
            insert into db.products (id, name, category_id, price)
            values (record.id, record.name, record.category_id, record.price)
          `);
        });
        s.else((s) => {
          s.modify(sql`
            insert into db.import_errors (source, record_id, error)
            values ('products', record.id, 'Invalid category_id')
          `);
        });
      },
    },
    // Stage 3: Import inventory (depends on products)
    {
      name: "inventory",
      source: "imports.inventory",
      dependencies: ["products"],
      process: (s) => {
        s.modify(sql`
          update db.products
          set stock_quantity = record.quantity
          where id = record.product_id
        `);
      },
    },
  ],
  finalize: (s) => {
    s.startTransaction();
    s.modify(sql`
      insert into db.import_log (completed_at, error_count)
      select current_timestamp, count(*) from db.import_errors
    `);
    s.commitTransaction();
  },
});
```

## Running Pipelines

### Preparing Source Data

- Pipeline sources are Yolm database tables named as `<database_name>.<table_name>`.
- CSV and Parquet files can be imported into a Yolm database with Studio's
  database import tools before running the pipeline. See [Forge transfers](../ai/forge_transfers.md).
- Source table columns become fields accessible via `record.<field_name>` in the stage procedure.

## Error Handling

Handle errors within the process procedure:

```typescript
{
  source: "imports.users",
  process: (s) => {
    // Validate before inserting
    s.if(sql`record.email is null or record.email = ''`, (s) => {
      s.modify(sql`
        insert into db.import_errors (source, record_id, error)
        values ('users', record.id, 'Missing email')
      `);
    });
    s.else((s) => {
      s.try({
        body: (s) => {
          s.modify(sql`
            insert into db.users (name, email)
            values (record.name, record.email)
          `);
        },
        catch: (s) => {
          s.modify(sql`
            insert into db.import_errors (source, record_id, error)
            values ('users', record.id, 'Insert failed')
          `);
        },
      });
    });
  },
}
```

## Performance Considerations

- Pipelines process data in a streaming fashion, minimizing memory usage
- Stages without dependencies can run in parallel
- Use batch inserts where possible for better performance. For static seed or
  demo data, prefer one `insert ... values (...), (...)` statement per table
  shape, or `with rows(...) as (values ...) insert ... select ...` when rows
  need foreign-key lookups.
- Avoid hundreds of independent one-row `s.modify(sql`insert ...`)` statements
  in one `setup` or `finalize`. If seed sections are independent, move them
  into separate pipeline stages. For a synthetic one-row stage, use a real
  table source and refer to source fields as `record.id` in `where`.
- For performance-sensitive import stages, keep independent work split into
  separate stages so each stage remains easy to reason about and tune.

## Common Patterns

### Incremental Import

```typescript
{
  source: "imports.updates",
  process: (s) => {
    s.if(sql`exists (select 1 from db.records where id = record.id)`, (s) => {
      s.modify(sql`
        update db.records
        set value = record.value, updated_at = current_timestamp
        where id = record.id
      `);
    });
    s.else((s) => {
      s.modify(sql`
        insert into db.records (id, value, created_at)
        values (record.id, record.value, current_timestamp)
      `);
    });
  },
}
```

### Data Validation

```typescript
{
  source: "imports.orders",
  process: (s) => {
    s.defScalar("is_valid", sql`
      record.amount > 0
      and record.customer_id is not null
      and is_valid_email(record.email)
    `);

    s.if(sql`is_valid`, (s) => {
      s.modify(sql`insert into db.orders ...`);
    });
    s.else((s) => {
      s.modify(sql`insert into db.rejected_orders ...`);
    });
  },
}
```

### Lookup and Enrich

```typescript
{
  source: "imports.transactions",
  process: (s) => {
    // Look up related data
    s.defRecord("customer", sql`
      select * from db.customers where external_id = record.customer_ref
    `);

    s.if(sql`customer.id is not null`, (s) => {
      s.modify(sql`
        insert into db.transactions (customer_id, amount, date)
        values (customer.id, record.amount, record.date)
      `);
    });
  },
}
```
