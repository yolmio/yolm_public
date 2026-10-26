---
title: Global SQL Functions
description: Global Yolm SQL functions for current time, null handling, type conversion, current user and transaction values, search, and dynamic queries.
tags:
  - sql
  - functions
---

# Global SQL Functions

These functions are available globally without namespace prefixes.

## Date and Time

`current_date`, `today()`, `current_timestamp`, `now()`, `tomorrow()`, and
`yesterday()` are documented in
[Date and Time Functions](./date_functions.md#current-datetime-functions).
Interval literals are documented in [Interval Type](./interval_type.md).

### Date Literals

```sql
select date '2023-09-17';
select time '14:30:00';
select timestamp '2023-09-17 14:30:00';
select timestamptz '2023-09-17 14:30:00+00:00';
```

## Null Handling

### coalesce

Returns the first non-null value in a list.

```sql
select coalesce(null, 1, 2);          -- 1
select coalesce(null, null, 'Default'); -- 'Default'
select coalesce(nickname, name, 'Anonymous') from users;
```

### nullif

Returns null if the two arguments are equal, otherwise returns the first argument.

```sql
select nullif(10, 10);       -- null
select nullif(10, 20);       -- 10
select nullif(status, 'unknown') as clean_status from tasks;
```

Division or modulo by zero already returns null rather than raising an error
(see [Numeric Type Behavior](./math_functions.md#numeric-type-behavior)), so
`value / nullif(divisor, 0)` is not required to avoid an error; use it only to
make the intent explicit.

### least / greatest

Returns the smallest/largest value. Any null argument returns null.

```sql
select least(1, 5, 3);       -- 1
select greatest(1, 5, 3);    -- 5
select least(1, null, 3);    -- null
select greatest(1, null, 3); -- null

-- Clamp value to range
select greatest(0, least(100, value)) as clamped;
```

## Type Conversion

### cast

Converts a value from one data type to another.

```sql
select cast('123' as int);           -- 123
select cast(123 as text);            -- '123'
select cast('2023-09-17' as date);   -- 2023-09-17
select cast(1234.56 as int);         -- 1234
```

PostgreSQL-style casting:
```sql
select '123'::int;
select 123::text;
select '2023-09-17'::date;
select price::decimal(10,2);
```

### try_cast / safe_cast

Attempts to convert, returning null if conversion fails (instead of an error).
`safe_cast` is an alias.

```sql
select try_cast('not a number' as int);  -- null
select try_cast('123' as int);           -- 123
select try_cast('2023-09-17' as date);   -- 2023-09-17
select try_cast('invalid date' as date); -- null
select safe_cast('123' as int);          -- 123
```

### Supported Types

- `int`, `integer`, `bigint`, `smallint`, `tinyint`
- `uint`, `biguint`, `smalluint`, `tinyuint` (accepted aliases; SQL casts map
  them to signed integer result types)
- `float`, `double`, `real`
- `decimal`, `numeric`
- `varchar`, `text`, `string`
- `boolean`, `bool`
- `date`, `time`, `timestamp`, `timestamp_naive`, `timestamptz`
- `uuid`
- `bytes`
- `json`
- `interval`

String-to-interval casts accept the same interval text forms as interval
literals, including PostgreSQL-style text and ISO 8601 duration text. See
[Interval Type](./interval_type.md#interval-literals).

## Conditional Functions

### case

See [Expressions](./expressions.md) for full CASE WHEN documentation.

```sql
select case when x > 0 then 'positive' else 'non-positive' end;
```

## System Functions

### current_user

Returns the current authenticated user ID, or NULL when there is no current
user. The keyword form, function form, and `info.` namespace are accepted.

```sql
select current_user;
select current_user();
select info.current_user();
-- 7
```

### current_tx()

Returns the current transaction ID.

```sql
select current_tx();
-- 42
```

### current_task()

Returns the current task ID (in DOM or server procedures).

```sql
select current_task();
-- 7
```

### info.system_id() / system_id()

Returns the current system ID.

```sql
select system_id();
select info.system_id();
```

### current_context()

Returns the current procedure/UI context as JSON.

```sql
select current_context();
select info.current_context();
```

### Static secrets

There is no `secret()` SQL function. Read a static secret with the
`getStaticSecret(name)` helper from `std/services`, which expands to a
`crypto.decrypt(...)` query against `db.sys_static_secrets`:

```ts
import { getStaticSecret } from "std/services";
s.defScalar("api_key", getStaticSecret(sql.lit`postmark`));
```

## Record ID Functions

For tables in the main database.

### next_record_id(table)

Returns the next available record ID for a table.

```sql
select next_record_id(users);  -- e.g., 101
```

### last_record_id(table)

Returns the last used record ID for a table.

```sql
select last_record_id(db.users);  -- e.g., 100
```

## Full-Text Search

### match()

Performs full-text search on a table. Only works in WHERE clauses where the source is the table with a search config.

```sql
select title from book
where match(book, query => 'prid', record_id => id);
-- Pride and Prejudice

select * from product
where match(product, query => 'electronic', record_id => id);
```

The search uses the match config defined on the table. See
[Search Configuration](../database/search_config.md) for setup.

## Dynamic Field Access

### dynamic_field(record, index)

Reads the column at a runtime index from a record whose columns are named
`field_0`, `field_1`, and so on. Such records come from the result table of a
`dynamicQuery` statement (see
[Server Statements](../procedures/server_statements.md#dynamic-sql)) and from
row-import table functions such as `csv.rows` (see
[Table Functions](./table_functions.md#csvrows)).

- `record` must be a bare record or cursor name, not an arbitrary expression.
- `index` is a numeric expression and is 0-based (`0` reads `field_0`).
- The result is nullable `text`; cast it when you need another type.

```sql
-- csv.rows treats the first line as a header row
select dynamic_field(row, 1 + 1), ordinal
from csv.rows('cat,dog,chicken
a,b,c
d,e,f') as row;
-- c, 0
-- f, 1
```

There is no `dynamic_ordinal` function. Row-import table functions return an
ordinary `ordinal` column, as above, and a `dynamicQuery` column meta table
provides each column's `name`, `index`, and `type`, which pairs with
`dynamic_field(record, column.index)`.

## Global UI Tables

### location

A record available in UI code with browser location info:

| Field | Description |
|-------|-------------|
| `host` | Browser's `window.location.host` (e.g., `myapp.yolm.app`) |
| `pathname` | Current URL path |
| `query` | Query string (search params) |

```sql
select pathname, query from location;
-- '/dashboard', '?page=2'
```

Do not update directly—use `navigate` or `setQueryParam` statements instead.
