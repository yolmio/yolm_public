---
title: Table Functions
description: Table-valued SQL functions for series generation, string and regex splitting, CSV and XLSX parsing, and JSON expansion.
tags:
  - sql
  - functions
  - table-functions
---

# Table Functions

Table functions return a table and can be used in the FROM clause of a query.

All table functions accept positional arguments unless a named argument is
explicitly documented below. Table functions may be aliased, including column
aliases:

```sql
select part, ord
from string.split('a,b,c', ',') as s(part, ord);
```

## Series Generators

### series.int / series.bigint

Generates a series of integers.

Signatures:

```sql
series.int(start int, stop int[, step int])
series.bigint(start bigint, stop bigint[, step bigint])
generate_series(start int_or_bigint, stop int_or_bigint[, step int_or_bigint])
generate_series(start timestamp, stop timestamp, step interval)
```

The result has one column: `value`. The series includes both `start` and `stop`
when the step lands on `stop`. Timestamp `generate_series` supports positive
or negative interval steps; a step that points away from `stop` returns no rows.

```sql
select value from series.int(1, 5);
-- 1, 2, 3, 4, 5

select value from series.int(1, 10, 2);  -- with step
-- 1, 3, 5, 7, 9

select value from series.bigint(1000000000000, 1000000000005);
```

### series.daily

Generates a series of dates.

Signature:

```sql
series.daily(start date_or_timestamp, count int[, step_days int])
```

The result has one column: `value`. `count` is the number of steps after the
start, so the function returns `count + 1` rows.

```sql
-- Basic: start date, count
select value from series.daily(date '2023-09-20', 4);
-- 2023-09-20, 2023-09-21, 2023-09-22, 2023-09-23, 2023-09-24

-- With step: start date, count, step (in days)
select value from series.daily(date '2023-09-20', 4, 7);
-- 2023-09-20, 2023-09-27, 2023-10-04, 2023-10-11, 2023-10-18

-- Negative step for going backwards
select value from series.daily(date '2023-09-20', 4, -1);
-- 2023-09-20, 2023-09-19, 2023-09-18, 2023-09-17, 2023-09-16
```

#### Real-World Example: Weekly Report Series

```sql
-- Generate 13 weekly buckets, going backwards by 7 days each
select
  format.date(date.add(day, 6, daily.value), '%-m/%-d') as week_ending,
  coalesce(count(distinct pc), 0) as bodies_in_shop
from series.daily(
  date.last_weekday(current_date(), date.thursday()),  -- Last Thursday
  12,
  -7  -- Go back 7 days each iteration
) as daily
  left join db.deliveries
    on date between daily.value and date.add(day, 6, daily.value)
    and fn.is_bis(type)
    and not free
group by daily.value
order by daily.value;
```

Because `series.daily` includes the start date plus `count` additional dates,
this generates 13 weekly buckets starting from the most recent Thursday.

### series.monthly / series.yearly

Signatures:

```sql
series.monthly(start date_or_timestamp, count int[, step_months int])
series.yearly(start date_or_timestamp, count int[, step_years int])
```

The result has one column: `value`. These functions return exactly `count`
rows.

```sql
select value from series.monthly(date '2023-01-01', 4);
-- 2023-01-01, 2023-02-01, 2023-03-01, 2023-04-01

select value from series.yearly(date '2023-01-01', 4);
-- 2023-01-01, 2024-01-01, 2025-01-01, 2026-01-01
```

> **Note:** `series.daily` produces `count + 1` rows (start date plus count additional dates), while `series.monthly` and `series.yearly` produce exactly `count` rows.

### series.ordering

Generates ordering values for sortable lists.

Signature:

```sql
series.ordering(start ordering, count int)
```

```sql
select value from series.ordering(ordering.new(), 3);
-- 1/1, 2/1, 3/1

insert into todo_items (task, ordering)
select 'Task ' || value, value
from series.ordering(ordering.new(), 5);
```

## String Functions

### string.split

Splits a string into rows based on a delimiter.

Signature:

```sql
string.split(input string, delimiter string)
```

Returns `value string, ordinal int`.

```sql
select value, ordinal from string.split('apple,banana,cherry', ',');
-- apple, 0
-- banana, 1
-- cherry, 2
```

## Regex Table Functions

### regex.split

Splits a string into rows using a regex pattern.

Signatures:

```sql
regex.split(input string, pattern string)
regexp_split_to_table(input string, pattern string)
```

Returns `value string, ordinal int`.

```sql
select value, ordinal from regex.split('one1two2three', '[0-9]');
-- one, 0
-- two, 1
-- three, 2
```

### regex.matches

Finds all regex matches in a string, returning each as a row.

Signatures:

```sql
regex.matches(input string, pattern string)
regex.matches(input string, pattern string, 'g')
regexp_matches(input string, pattern string)
regexp_matches(input string, pattern string, 'g')
```

Returns `value string, ordinal int`. The optional third argument exists for
PostgreSQL-style calls; only the literal flag `'g'` is accepted.

```sql
select value, ordinal from regex.matches('abc123def456', '[0-9]+');
-- 123, 0
-- 456, 1
```

## CSV Functions

### csv.headers

Returns the headers of a CSV string.

Signature:

```sql
csv.headers(csv_text string)
```

Returns `value string, ordinal int`.

```sql
select value, ordinal from csv.headers('name,age,city');
-- name, 0
-- age, 1
-- city, 2
```

### csv.rows

Parses CSV data into rows. By default, rows expose `field_0` through `field_19`
plus `ordinal`.

Signatures:

```sql
csv.rows(csv_text string)
csv.rows(csv_text string, col_count int)
csv.rows(csv_text string, col_count => int)
```

`col_count` must be a static integer expression and may be up to 150.

```sql
select field_0, field_1, field_2, ordinal
from csv.rows('John,30,New York
Alice,25,London');
-- John, 30, New York, 0
-- Alice, 25, London, 1

-- Skipping header row:
select field_0 as name, cast(field_1 as int) as age
from csv.rows('Name,Age,City
John,30,New York')
where ordinal > 0;

-- Wide CSVs can opt in to a static field count up to 150:
select dynamic_field(row, 74)
from csv.rows(csv_text, col_count => 75) as row;
```

## Excel Functions

### xlsx.sheets

Returns the list of sheet names in an Excel file.

Signature:

```sql
xlsx.sheets(file_bytes bytes)
```

Returns `value string, ordinal int`.

```sql
select value, ordinal from xlsx.sheets(file_bytes);
-- Sheet1, 0
-- Sheet2, 1
```

### xlsx.headers

Returns column headers from an Excel sheet.

Signatures:

```sql
xlsx.headers(file_bytes bytes, sheet string)
xlsx.headers(file_bytes bytes, sheet string, row int)
xlsx.headers(file_bytes bytes, sheet string, row int, col_count int)
xlsx.headers(file_bytes bytes, sheet string, row => int, col_count => int)
```

Returns `value string, ordinal int`. `col_count` must be a static integer
expression.

```sql
-- Basic usage (reads first row of first sheet)
select value, ordinal from xlsx.headers(file_bytes, 'Sheet1');
-- Name, 0
-- Age, 1

-- With optional row offset and column count
select value, ordinal from xlsx.headers(file_bytes, 'Sheet1', 2, 5);
```

### xlsx.rows

Returns data rows from an Excel sheet.

Signatures:

```sql
xlsx.rows(file_bytes bytes, sheet string)
xlsx.rows(file_bytes bytes, sheet string, skip_rows int)
xlsx.rows(file_bytes bytes, sheet string, skip_rows int, col_count int)
xlsx.rows(file_bytes bytes, sheet string, skip_rows => int, col_count => int)
```

Rows expose `field_0` through `field_n` plus `ordinal`. `col_count` must be a
static integer expression and may be up to 150.

```sql
select field_0, field_1, ordinal from xlsx.rows(file_bytes, 'Sheet1');
-- John, 30, 0
-- Alice, 25, 1

-- With optional skip_rows and col_count
select field_0, field_1 from xlsx.rows(file_bytes, 'Sheet1', 1, 3);
```

## JSON Functions

### json.array_each

Expands a JSON array to rows.

Aliases: `json.array_elements`, `json_array_elements`

```sql
select value, index from json.array_each('[1, "text", true]'::json);
```

Returns `value json, index int`.

### json.object_each

Expands a JSON object to rows.

Aliases: `json.each`, `json_each`

```sql
select key, value from json.object_each('{"a": 1, "b": 2}'::json);
```

Returns `key string, value json`.
