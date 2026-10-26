---
title: Window Functions
description: Window functions in Yolm SQL for ranking, lead/lag access, first and last values, running totals, partitions, and frames.
tags:
  - sql
  - window-functions
  - analytics
---

# Window Functions

Window functions perform calculations across a set of rows related to the current row. Unlike aggregate functions, they don't collapse rows into a single result.

## Window Specification

The `OVER` clause defines the window:

```sql
function() over (
  [partition by expr, ...]
  [order by expr [asc|desc] [nulls first|last], ...]
  [frame_clause]
)
```

- **PARTITION BY**: Divides rows into groups (like GROUP BY, but doesn't collapse them)
- **ORDER BY**: Orders rows within each partition
- **Frame clause**: Defines which rows relative to current row are included

## Ranking Functions

Supported window-only functions are:

| Function | Arguments | Result |
| --- | --- | --- |
| `row_number()` | none | `bigint` |
| `rank()` | none | `bigint` |
| `dense_rank()` | none | `bigint` |
| `lag(expr)` | value | value type, nullable |
| `lag(expr, offset)` | integer offset | value type, nullable |
| `lag(expr, offset, default)` | literal default | value type |
| `lead(expr)` | value | value type, nullable |
| `lead(expr, offset)` | integer offset | value type, nullable |
| `lead(expr, offset, default)` | literal default | value type |

Aggregate functions can also be used as window functions with `over (...)`.
`FILTER` is only supported for aggregate window functions, not for `rank`,
`row_number`, `dense_rank`, `lag`, or `lead`.

Without `order by`, `rank()` and `dense_rank()` number rows sequentially
within their partition, exactly like `row_number()`; rows only tie on an
explicit ordering. `rank() over () - 1` is therefore a zero-based row index in
row order (the pattern `QueryCombobox` result tables use).

### row_number()

Assigns a unique sequential number to each row within its partition.

```sql
-- Simple numbering
select title, row_number() over (order by publication_year)
from book;

-- Numbering within groups
select
  department,
  name,
  row_number() over (partition by department order by salary desc) as rank
from employees;
```

### rank()

Assigns a rank with gaps for tied values.

```sql
select
  name,
  score,
  rank() over (order by score desc) as rank
from contestants;
-- Scores: 100, 95, 95, 90 → Ranks: 1, 2, 2, 4 (no rank 3)
```

### dense_rank()

Assigns a rank without gaps for tied values.

```sql
select
  name,
  score,
  dense_rank() over (order by score desc) as rank
from contestants;
-- Scores: 100, 95, 95, 90 → Ranks: 1, 2, 2, 3
```

## Value Access Functions

### first_value() / last_value()

Returns the first/last value in the window frame.

```sql
-- First book by each author
select
  author,
  title,
  first_value(title) over (
    partition by author
    order by publication_year
  ) as first_book
from book;

-- Last value (note: default frame is range between unbounded preceding and current row)
select
  title,
  last_value(title) over (
    order by publication_year
    rows between unbounded preceding and unbounded following
  ) as last_book
from book;
```

### lead() / lag()

Access values from subsequent/preceding rows.

```sql
-- Next and previous prices
select
  date,
  price,
  lag(price) over (order by date) as prev_price,
  lead(price) over (order by date) as next_price
from stock_prices;

-- With offset and default value
select
  date,
  price,
  lag(price, 7, 0) over (order by date) as price_7_days_ago,
  coalesce(lead(price) over (order by date), price) as next_or_current
from stock_prices;
```

Parameters:
- `lag(expr)` / `lead(expr)` - previous/next row
- `lag(expr, offset)` - N rows back/ahead
- `lag(expr, offset, default)` / `lead(expr, offset, default)` - with a
  literal default value when no row exists. Use `coalesce(lead(...), expr)`
  when the fallback should be another expression.

## Aggregates as Window Functions

Standard aggregates can be used with OVER:

```sql
select
  date,
  amount,
  sum(amount) over (order by date) as running_total,
  avg(amount) over (order by date) as running_avg,
  count(*) over () as total_rows
from transactions;

-- Per-partition aggregates
select
  department,
  name,
  salary,
  sum(salary) over (partition by department) as dept_total,
  avg(salary) over (partition by department) as dept_avg,
  salary::decimal / sum(salary) over (partition by department) as pct_of_dept
from employees;
```

### count with DISTINCT

```sql
select
  date,
  customer_id,
  count(distinct customer_id) over (order by date) as cumulative_unique_customers
from orders;
```

For other aggregate functions, write a subquery that deduplicates the input
first; only `count(distinct ...)` has distinct aggregate semantics.

## Frame Specifications

The frame defines which rows relative to the current row are included in the window.

### Frame Syntax

```sql
{ rows | range } between frame_start and frame_end
```

Frame bounds:
- `UNBOUNDED PRECEDING` - start of partition
- `CURRENT ROW` - the current row
- `UNBOUNDED FOLLOWING` - end of partition

> **Note:** Expression bounds (e.g., `3 PRECEDING`, `INTERVAL '1 day' PRECEDING`) are not supported. Only `UNBOUNDED PRECEDING`, `CURRENT ROW`, and `UNBOUNDED FOLLOWING` are available.

### ROWS vs RANGE

- **ROWS**: Physical rows before/after current row
- **RANGE**: Logical range based on ORDER BY values

```sql
-- Running total (includes all rows up to current)
select
  date,
  amount,
  sum(amount) over (
    order by date
    rows between unbounded preceding and current row
  ) as running_total
from transactions;

-- range: all rows with same order value included
select
  date,
  amount,
  sum(amount) over (
    order by date
    range between unbounded preceding and current row
  ) as sum_to_date
from transactions;
```

### Common Frame Patterns

```sql
-- Running total (default with order by)
sum(amount) over (order by date)
-- Equivalent to: range between unbounded preceding and current row

-- Full partition total
sum(amount) over (partition by category)
-- Equivalent to: range between unbounded preceding and unbounded following

-- All rows in partition
first_value(name) over (
  partition by department
  order by hire_date
  rows between unbounded preceding and unbounded following
)
```

### Default Frame

- **With ORDER BY**: `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`
- **Without ORDER BY**: `RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` (entire partition)

This is why `last_value()` often needs an explicit frame to include following rows.

## NULLS FIRST / LAST

Control NULL positioning in ORDER BY:

```sql
select
  name,
  score,
  row_number() over (order by score desc nulls last) as rank
from contestants;

select
  name,
  row_number() over (order by hire_date nulls first) as seniority
from employees;
```

## Practical Examples

### Running Totals

```sql
select
  date,
  category,
  amount,
  sum(amount) over (partition by category order by date) as category_running_total,
  sum(amount) over (order by date) as overall_running_total
from sales;
```

### Percentages of Total

```sql
select
  product,
  revenue,
  revenue::decimal / sum(revenue) over () * 100 as pct_of_total,
  revenue::decimal / sum(revenue) over (partition by category) * 100 as pct_of_category
from products;
```

### Comparing to Previous Period

```sql
select
  month,
  revenue,
  lag(revenue) over (order by month) as prev_month,
  revenue - lag(revenue) over (order by month) as change,
  case
    when lag(revenue) over (order by month) > 0
    then (revenue - lag(revenue) over (order by month))::decimal
         / lag(revenue) over (order by month) * 100
  end as pct_change
from monthly_sales;
```

### Top N per Group

```sql
select * from (
  select
    department,
    name,
    salary,
    row_number() over (partition by department order by salary desc) as rn
  from employees
) ranked
where rn <= 3;
```

### Cumulative Averages

```sql
select
  date,
  close_price,
  avg(close_price) over (order by date) as cumulative_avg
from stock_prices;
```

### Cumulative Distribution

```sql
select
  name,
  score,
  count(*) over (order by score) as cumulative_count,
  count(*) over () as total,
  count(*) over (order by score)::decimal / count(*) over () as percentile
from test_scores;
```

## Limitations

Currently not supported:
- Expression frame bounds (e.g., `3 PRECEDING`, `INTERVAL '1 day' PRECEDING`) - only `UNBOUNDED PRECEDING`, `CURRENT ROW`, and `UNBOUNDED FOLLOWING` are supported
- `GROUPS` frame unit
- Named windows (`WINDOW w AS (...)`)
- `ntile()`, `cume_dist()`, `percent_rank()` functions
