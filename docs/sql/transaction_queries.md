---
title: Transaction Queries
description: Querying the transaction log in Yolm SQL for auditing, change history, point-in-time data access, and tracking who changed what and when.
tags:
  - sql
  - transactions
  - audit
---

# Transaction Queries

Yolm maintains a transaction log, allowing you to query historical data and audit changes.
Tables configured with `autoCompact: true` have their transaction-log record operations
compacted during monthly maintenance: old updates are folded into the insert operation for
the record's latest values, and deleted records may be represented by skip operations.
This is irreversible for operations already compacted; pre-compaction update payloads and
deleted-record operation history cannot be recovered from the transaction log.

## The `tx_op` Table

The `tx_op` table logs all operations (insert, update, delete, restore) on records.

`tx_op` is a whole-database history source, not a constant-time transaction
counter. In procedure code, capture the transaction ID directly with
`s.commitTransaction("committed_tx_id")`. Do not run an unbounded
`select max(tx_id) from tx_op` after a commit; it can load every table's WAL and
does not safely associate the result with that specific commit.

> **Note:** In ordinary history queries, list explicit columns for `tx_op` and
> `{table}__versions`; the per-field `{table}__{field}` columns are not part of
> `*`. Upgrade and transform procedures have separate schema-introspection
> requirements and are not covered by this restriction.

| Column | Type | Description |
|--------|------|-------------|
| `tx_id` | bigint | Transaction ID |
| `tx_timestamp` | timestamp | Transaction timestamp |
| `tx_creator` | bigint (FK) | User who performed the transaction |
| `kind` | sys_op_kind | Operation type (insert, update, delete, skip, restore) |
| `table` | sys_db_table | Target table |
| `sequence_id` | bigint | Sequential operation ID |
| `record_id` | bigint | Affected record ID |
| `tx_log_position` | bigint | Position in transaction log |
| `skip_count` | bigint | For skip operations (compaction) |

### Accessing Field Values

For insert/update operations, access field values using `{table}__{field}`:

```sql
-- Find the updated first name of contact with id = 0
select contact__first_name
from tx_op
where table = 'contact'
  and kind = 'update'
  and contact__first_name__set
  and record_id = 0
order by tx_id
limit 1;
```

For update operations, `{table}__{field}__set` (boolean) indicates if the field was modified.

### Examples

```sql
-- All changes to a specific record
select tx_id, kind, tx_timestamp
from tx_op
where table = 'order'
  and record_id = 123
order by tx_id;

-- Recent deletes
select record_id, tx_timestamp, tx_creator
from tx_op
where table = 'customer'
  and kind = 'delete'
order by tx_timestamp desc
limit 10;

-- Changes by a specific user today
select table, kind, record_id, tx_timestamp
from tx_op
where tx_creator = 42
  and tx_timestamp >= current_date
order by tx_timestamp desc;
```

## Per-Table Version View: `{table}__versions`

Each table has a companion view `{table}__versions` that returns one row per
operation on that table, with the field values at that operation. This is the
table-scoped equivalent of `tx_op` and is the easiest way to build per-record
history UIs.

### Schema

| Column | Description |
|--------|-------------|
| `tx_id`, `tx_timestamp`, `tx_creator` | Transaction metadata |
| `sequence_id` | Sequential operation ID |
| `op_kind` | `insert` \| `update` \| `delete` \| `restore` \| `skip` |
| `is_visible` | Whether this op is the current visible state |
| `record_id` | Affected record ID |
| `record_op` | Per-record op counter |
| `{table}__{field}` | Field value at this op (NULL if unchanged on update) |
| `{table}__{field}__set` | Boolean — true if the field was written by this op |

### Examples

```sql
-- Full per-record history with field-level granularity
select tx_id, op_kind, contact__first_name, contact__first_name__set
from contact__versions
where record_id = 0
order by tx_id;

-- The latest value of a field at-or-before a given tx_id
select contact__first_name
from contact__versions
where record_id = 0
  and contact__first_name__set
  and tx_id <= 100
order by tx_id desc
limit 1;
```

## sys_op_kind Enum

The operation types in tx_op:

| Value | Description |
|-------|-------------|
| `insert` | New record created |
| `update` | Existing record modified |
| `delete` | Record deleted |
| `skip` | Compaction marker |
| `restore` | Deleted record restored |

## sys_db_table Enum

This enum lists all tables in the system database. Use it to filter tx_op by table:

```sql
select distinct table from tx_op;
-- Returns all tables that have had operations
```

## Common Patterns

### Audit Trail

```sql
-- Complete history of a record
select
  tx_id,
  kind,
  tx_timestamp,
  tx_creator
from tx_op
where table = 'order'
  and record_id = 123
order by tx_id;
```

### Find Who Changed What

```sql
-- Who deleted this record?
select tx_creator, tx_timestamp
from tx_op
where table = 'customer'
  and record_id = 456
  and kind = 'delete';
```

### Data as of a Point in Time

```sql
-- Reconstruct each field at-or-before a target tx_id by reading the most
-- recent op that wrote to that field
select
  (select order__customer_id from order__versions
   where record_id = 123 and order__customer_id__set and tx_id <= 1000
   order by tx_id desc limit 1) as customer_id,
  (select order__total from order__versions
   where record_id = 123 and order__total__set and tx_id <= 1000
   order by tx_id desc limit 1) as total;
```
