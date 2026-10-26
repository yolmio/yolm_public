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
a stage when its row or batch work is safe to run in parallel. A pipeline
operates over tables in Yolm databases; it does not read files directly.

They are the primary mechanism for:

- Moving data from one Yolm database table into another
- Processing data in stages with dependencies between stages
- Running setup/finalize procedures around the loading process
- Handling per-row processing, sequentially by default or in parallel when
  explicitly enabled

If your source data is in CSV, TSV, JSON Lines, JSON, or Parquet files, import
it into a Yolm source database first with Studio, Forge, or
`yolm pipeline import`. The pipeline can then read the imported tables
directly; it does not require derived files or precomputed batch payloads. See
[Source imports](source_imports.md) for formats, type rules, and
`yolm-import.json`, and [Forge transfers](../ai/forge_transfers.md) for uploads.

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
  },
  stages: [
    {
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

Table-backed stages are keyed by their `<database>.<table>` source and cannot
specify `name`; dependencies refer to that source key. `name` is only for
query-backed and source-less stages.

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

### Query sources and set-based batches

Use a read-only query as the source when a stage needs a join, projection,
aggregate, union, or rows from multiple pinned source databases. Query-backed
stages require an explicit `name` and `processBatch`. Each invocation receives
a read-only procedure table called `batch` with the query's output columns.
The procedure can use set-based SQL and write multiple database tables; one
invocation is one atomic transaction.

```typescript
{
  name: "import_order_fees",
  source: {
    query: sql`
      select orders.external_id, orders.fee, existing.id as order_id
      from imports.orders orders
      left join db.orders existing on existing.external_id = orders.external_id
      where orders.fee <> 0
    `,
  },
  processBatch: (s) => {
    s.modify(sql`
      insert into db.order_expenses (order_id, amount)
      select order_id, fee from batch where order_id is not null
    `);
  },
}
```

The query runs once against a stable stage-start snapshot. Earlier stage writes
are visible; writes made by this stage do not enter its remaining source rows.
Batch size adapts to runtime pressure, and row order and batch composition are
not guaranteed. Set `parallelize: true` only when independent batches can
commit in any order. A table source can also use `processBatch`; `process`
retains the original per-row `record` behavior. Specify exactly one of the two
processing modes.

Set `keepTogetherBy` to query-output column names when every row with an equal
key tuple must reach the same `processBatch` invocation:

```typescript
{
  name: "import_invoice_items",
  source: {
    query: sql`
      select order_id, case_id, researcher_code, amount
      from imports.invoice_items
    `,
  },
  keepTogetherBy: ["order_id", "case_id", "researcher_code"],
  processBatch: (s) => {
    // All rows for one key tuple are present together in the read-only batch.
  },
}
```

Grouping orders the complete source by those keys, so use it only when
batch-boundary correctness requires it. A group may grow beyond the adaptive
row target, but the stage fails rather than splitting a group that exceeds the
hard memory limit. Grouping does not otherwise make batch order or parallel
completion order observable.

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
      source: "imports.orders",
      dependencies: ["imports.customers"],  // Wait for customers first
      process: (s) => {
        s.modify(sql`
          insert into db.orders (id, customer_id, order_date)
          values (record.id, record.customer_id, record.order_date)
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
        category
      )
      values (
        upper(trim(record.sku)),
        trim(record.name),
        cast(record.price as decimal(10,2)),
        coalesce(record.category, 'uncategorized')
      )
    `);
  },
}
```

## Handling Duplicates

Use `merge` or conditional logic to handle duplicates:

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
        update set name = src.name, price = src.price
      when not matched then
        insert (sku, name, price)
        values (src.sku, src.name, src.price)
    `);
  },
}
```

## Multiple Stages Example

Load a complete dataset with related tables:

```typescript
system.addPipeline({
  name: "import_ecommerce_data",
  stages: [
    // Stage 1: Import categories (no dependencies)
    {
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
      source: "imports.products",
      dependencies: ["imports.categories"],
      // Skip products whose category was not imported
      where: sql`exists (select 1 from db.categories where id = record.category_id)`,
      process: (s) => {
        s.modify(sql`
          insert into db.products (id, name, category_id, price)
          values (record.id, record.name, record.category_id, record.price)
        `);
      },
    },
    // Stage 3: Import inventory (depends on products)
    {
      source: "imports.inventory",
      dependencies: ["imports.products"],
      process: (s) => {
        s.modify(sql`
          update db.products
          set stock_quantity = record.quantity
          where id = record.product_id
        `);
      },
    },
  ],
});
```

Do not add import log or import error tables. The source database still holds
every row, so list skipped rows with a query against it, for example
`select * from imports.products where category_id not in (select id from imports.categories)`.
Transaction history records when each imported row was written; see
[Transaction queries](../sql/transaction_queries.md).

## Running Pipelines

### Preparing Source Data

- Pipeline sources are Yolm database tables named as `<database_name>.<table_name>`.
- CSV, TSV, JSON Lines, JSON, and Parquet files are imported into a source
  database before running the pipeline. See [Source imports](source_imports.md)
  and [Forge transfers](../ai/forge_transfers.md).
- Inspect a source database locally with
  `yolm query --source <database> -q "..."`.
- Source table columns become fields accessible via `record.<field_name>` in the stage procedure.

## Error Handling

Validate within the process procedure. Fail the stage with a clear message
when a row cannot be imported correctly, rather than silently dropping it or
writing it to an error table:

```typescript
{
  source: "imports.users",
  process: (s) => {
    s.if(sql`record.email is null or record.email = ''`, (s) => {
      s.throwError(sql`
        'Missing email for imported user ' || cast(record.id as string)
      `);
    });
    s.modify(sql`
      insert into db.users (name, email)
      values (record.name, record.email)
    `);
  },
}
```

To find every invalid row before running the pipeline, query the source
database directly, for example
`select id from imports.users where email is null or email = ''`.

## Performance Considerations

- Pipelines process data in a streaming fashion, minimizing memory usage
- Stages run in dependency order. Rows or batches within a stage run
  sequentially unless the stage sets `parallelize: true`
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
        set value = record.value
        where id = record.id
      `);
    });
    s.else((s) => {
      s.modify(sql`
        insert into db.records (id, value)
        values (record.id, record.value)
      `);
    });
  },
}
```

### Data Validation

Filter rows with the stage's `where` option. Rejected rows stay in the source
database, so query them there instead of copying them to a rejection table:

```typescript
{
  source: "imports.orders",
  where: sql`
    record.amount > 0
    and record.customer_id is not null
  `,
  process: (s) => {
    s.modify(sql`
      insert into db.orders (customer_id, amount)
      values (record.customer_id, record.amount)
    `);
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
