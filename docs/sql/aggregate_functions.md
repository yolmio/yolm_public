---
title: Aggregate Functions
description: Aggregate functions in Yolm SQL, including count, sum, avg, min, max, string_agg, JSON aggregates, FILTER, DISTINCT, and count_if.
tags:
  - sql
  - functions
  - aggregates
---

# Aggregate Functions

Aggregate functions compute a single result from a set of input rows.

## Function Reference

| Aggregate | Aliases | Arguments |
| --- | --- | --- |
| `count(*)` | | all rows |
| `count(expr)` | | non-null values |
| `count(distinct expr)` | | distinct non-null values |
| `sum(expr)` | | numeric |
| `avg(expr)` | | numeric |
| `min(expr)` | | comparable |
| `max(expr)` | | comparable |
| `bool_and(expr)` | `every(expr)`, `logical_and(expr)` | boolean |
| `bool_or(expr)` | `logical_or(expr)` | boolean |
| `count_if(condition)` | | boolean condition |
| `string_agg(value, delimiter)` | | ordered aggregate supported |
| `json_array_agg(expr)` | `json_agg(expr)` | ordered aggregate supported |
| `json_object_agg(key, value)` | | ordered aggregate supported |
| `value_for_min(value, sort_expr)` | `arg_min`, `min_by` | value from minimum row |
| `value_for_max(value, sort_expr)` | `arg_max`, `max_by` | value from maximum row |
| `first(expr)` | `first_value(expr)` | aggregate first value |
| `last(expr)` | `last_value(expr)` | aggregate last value |
| `hash_agg(expr, ...)` | | hash of one or more expressions |

## Standard Aggregates

### count

Counts rows or non-null values.

```sql
select count(*) from users;                    -- all rows: 100
select count(email) from users;                -- non-null values: 98
select count(distinct category) from products; -- unique values: 5
```

### sum

Sums numeric values. Returns `bigint` for integer inputs, preserves type for decimals/floats.

```sql
select sum(price) from products;        -- 1234.56
select sum(quantity) from order_items;  -- returns bigint
```

### avg

Calculates average. Returns `decimal` for integer inputs (matching PostgreSQL behavior), `double` for floats.

```sql
select avg(price) from products;    -- 45.67 (decimal)
select avg(rating) from reviews;    -- 4.2 (decimal if rating is int)
```

### min / max

Returns minimum/maximum value. Works with numbers, strings, dates, etc.

```sql
select min(price), max(price) from products;
select min(created_at), max(created_at) from orders;
select min(name), max(name) from users;  -- alphabetically
```

## Boolean Aggregates

### bool_and

Returns `true` if all input values are true.

Aliases: `every`, `logical_and`

```sql
select bool_and(is_active) from users;
-- false if any user is inactive

select every(is_paid) from invoices where customer_id = 123;
-- true only if all invoices are paid
```

### bool_or

Returns `true` if any input value is true.

Alias: `logical_or`

```sql
select bool_or(is_admin) from users;
-- true if any user is admin

select customer_id, bool_or(is_overdue) as has_overdue
from invoices
group by customer_id;
```

## Conditional Aggregates

### count_if

Counts rows satisfying a condition. Shorthand for `count(*) filter (where ...)`.

```sql
select count_if(age >= 18) from users;              -- 85
select count_if(status = 'completed') from orders;  -- 150
select count_if(is_active and role = 'admin') from users;
```

Equivalent to:
```sql
select count(*) filter (where age >= 18) from users;
```

## Value Selection Aggregates

### value_for_min / value_for_max

Returns the value of one expression for the row where another expression is minimum/maximum.

Aliases: `arg_min`, `min_by`, `arg_max`, `max_by`

```sql
-- Title of the cheapest book
select value_for_min(title, price) from books;
-- 'The Great Gatsby'

-- Name of user with most recent login
select value_for_max(name, last_login_date) from users;
-- 'Alice Smith'

-- Email of highest-spending customer
select value_for_max(email, total_spent) from customers;
```

## First, Last, and Hash Aggregates

### first / last

Returns the first or last value encountered by the aggregate input. When order
matters, use aggregate `order by`.

```sql
select first(status order by created_at) from events;
select last(status order by created_at) from events;
```

For windowed first/last values, use `first_value(...) over (...)` and
`last_value(...) over (...)`; see [Window Functions](./window_functions.md).

### hash_agg

Computes a deterministic aggregate hash over one or more expressions.

```sql
select hash_agg(id, updated_at, status) from orders;
```

## String Aggregation

### string_agg

Concatenates strings with a delimiter. Supports ORDER BY within the aggregate.

```sql
-- Basic usage
select string_agg(name, ', ') from users;
-- 'John, Alice, Bob, Carol'

-- With ordering
select string_agg(name, ', ' order by name) from users;
-- 'Alice, Bob, Carol, John'

-- With descending order
select string_agg(title, '; ' order by publication_year desc)
from books
where author_id = 1;

-- Per group
select department, string_agg(employee_name, ', ' order by hire_date)
from employees
group by department;
```

## JSON Aggregates

### json_array_agg

Aggregates values into a JSON array.

Alias: `json_agg`

```sql
-- Basic usage
select json_array_agg(name) from users;
-- ["John", "Alice", "Bob"]

-- With ordering
select json_array_agg(name order by created_at desc) from users;
-- ["Bob", "Alice", "John"] (most recent first)

-- Complex values
select json_array_agg(json_build_object('id', id, 'name', name))
from users;
-- [{"id": 1, "name": "John"}, {"id": 2, "name": "Alice"}]

-- Per group
select category,
       json_array_agg(product_name order by price desc) as products
from products
group by category;
```

### json_object_agg

Builds a JSON object from key-value pairs.

```sql
-- Basic usage
select json_object_agg(key, value)
from (values ('name', 'John'), ('age', '30')) as t(key, value);
-- {"name": "John", "age": "30"}

-- With ordering (controls key order in result)
select json_object_agg(setting_name, setting_value order by setting_name)
from user_settings
where user_id = 1;

-- Create lookup object
select json_object_agg(code, name) from countries;
-- {"US": "United States", "CA": "Canada", ...}
```

## FILTER Clause

The `FILTER` clause restricts which rows are included in an aggregate. Available on all aggregate functions.

```sql
-- Count with filter
select
  count(*) as total,
  count(*) filter (where status = 'active') as active,
  count(*) filter (where status = 'inactive') as inactive
from users;

-- Sum with filter
select
  sum(amount) as total_revenue,
  sum(amount) filter (where product_type = 'subscription') as subscription_revenue,
  sum(amount) filter (where product_type = 'one_time') as one_time_revenue
from sales;

-- Average with filter
select
  avg(rating) as overall_avg,
  avg(rating) filter (where verified_purchase) as verified_avg
from reviews;

-- Multiple aggregates with different filters
select
  department,
  count(*) as total_employees,
  count(*) filter (where salary > 100000) as high_earners,
  avg(salary) filter (where years_employed > 5) as senior_avg_salary
from employees
group by department;
```

## DISTINCT in Aggregates

`count(distinct ...)` aggregates only unique values:

```sql
select count(distinct category) from products;  -- number of distinct categories
```

**Important:** other aggregates currently **ignore** `DISTINCT` — `sum`, `avg`,
`string_agg`, `json_array_agg`, and `json_object_agg` aggregate every row even
when `distinct` is written. To aggregate unique values with these, deduplicate
the input in a subquery first:

```sql
select sum(price) from (select distinct price from products) p;
```

## Combining Features

Aggregates can combine FILTER, ORDER BY (for ordered aggregates), and use in window functions:

```sql
-- String aggregation with filter and order
select
  department,
  string_agg(name, ', ' order by hire_date)
    filter (where is_active) as active_employees
from employees
group by department;

-- JSON aggregation with filter
select
  category,
  json_array_agg(name order by price desc)
    filter (where in_stock) as available_products
from products
group by category;
```

## Aggregate as Window Functions

Most aggregates can also be used as window functions:

```sql
select
  name,
  salary,
  sum(salary) over (partition by department) as dept_total,
  avg(salary) over (partition by department) as dept_avg
from employees;

-- Running totals
select
  date,
  amount,
  sum(amount) over (order by date) as running_total
from transactions;
```

See [Window Functions](./window_functions.md) for more details.
