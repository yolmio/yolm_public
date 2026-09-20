---
title: SQL Joins
description: Join syntax in Yolm SQL, including inner, outer, cross, lateral, and auto joins based on foreign key relationships.
tags:
  - sql
  - joins
  - relationships
---

# SQL Joins

Joins combine rows from two or more tables based on related columns. Yolm SQL supports the standard join types familiar from PostgreSQL.

## INNER JOIN

Returns only rows with matching values in both tables. This is the default join type.

```sql
select book.title, author.name
from book
inner join author on book.author_id = author.id;

-- 'inner' keyword is optional
select book.title, author.name
from book
join author on book.author_id = author.id;
```

## LEFT JOIN (LEFT OUTER JOIN)

Returns all rows from the left table, with matching rows from the right table. Unmatched rows have NULL for right table columns.

```sql
select author.name, book.title
from author
left join book on author.id = book.author_id;

-- Authors without books will have NULL for book.title
```

```sql
-- Find authors with no books
select author.name
from author
left join book on author.id = book.author_id
where book.id is null;
```

## RIGHT JOIN (RIGHT OUTER JOIN)

Returns all rows from the right table, with matching rows from the left table.
Unmatched rows have NULL for left table columns.

```sql
select author.name, book.title
from author
right join book on author.id = book.author_id;
```

## FULL OUTER JOIN

Returns all rows from both tables. Unmatched rows have NULL for the other table's columns.

```sql
select author.name, book.title
from author
full outer join book on author.id = book.author_id;

-- Includes:
-- - Authors with matching books
-- - Authors without books (book columns are NULL)
-- - Books without authors (author columns are NULL)
```

```sql
-- Find unmatched rows from either side
select
  coalesce(a.name, 'No Author') as author,
  coalesce(b.title, 'No Book') as book
from author a
full outer join book b on a.id = b.author_id
where a.id is null or b.id is null;
```

## CROSS JOIN

Returns the Cartesian product of two tables (every combination of rows).

```sql
select author.name, category.name
from author
cross join category;

-- If author has 3 rows and category has 4, result has 12 rows

-- Alternative syntax
select author.name, category.name
from author, category;
```

Use cases:
- Generating combinations
- Creating test data
- Pivot table construction

```sql
-- Generate all date/product combinations for a report
-- (series.daily exposes its date as a column named `value`)
select d.value as date, p.product_name
from series.daily(date '2023-01-01', 30) d
cross join products p;
```

## Multiple Joins

Chain multiple joins in a single query.

```sql
select
  book.title,
  author.name as author,
  publisher.name as publisher,
  category.name as category
from book
join author on book.author_id = author.id
join publisher on book.publisher_id = publisher.id
left join category on book.category_id = category.id;
```

## Join Conditions

### ON clause

Standard condition-based join.

```sql
select *
from orders o
join customers c on o.customer_id = c.id;
```

### Multiple conditions

```sql
select *
from orders o
join order_items oi on o.id = oi.order_id and oi.quantity > 0;

-- Or with WHERE
select *
from orders o
join order_items oi on o.id = oi.order_id
where oi.quantity > 0;
```

### USING clause

Shorthand when join columns have the same name.

```sql
select *
from orders
join customers using (customer_id);

-- Equivalent to:
select *
from orders o
join customers c on o.customer_id = c.customer_id;
```

### NATURAL JOIN

`natural join` is accepted and joins on columns with the same names. Prefer
explicit `on` or `using` clauses in application SQL because schema changes can
change a natural join's keys.

```sql
select *
from orders
natural join customers;
```

## LATERAL JOIN

LATERAL allows subqueries in FROM to reference columns from preceding tables.

```sql
-- Get each author's most recent book
select author.name, recent.title, recent.publication_year
from author
left join lateral (
    select title, publication_year
    from book
    where book.author_id = author.id
    order by publication_year desc
    limit 1
) as recent on true;
```

```sql
-- Top 3 orders per customer
select c.name, top_orders.*
from customers c
left join lateral (
    select order_id, total, order_date
    from orders
    where customer_id = c.id
    order by total desc
    limit 3
) as top_orders on true;
```

LATERAL is powerful for:
- "Top N per group" queries
- Dependent subqueries
- Calling table-valued functions with row data

Table functions in `from` can also reference relations to their left:

```sql
select file.name, row.field_0, row.field_1
from uploaded_file file
join csv.rows(file.contents) as row on true;
```

## Auto Join (Yolm-specific)

Auto Join automatically joins tables based on foreign key relationships defined in your schema. This provides cleaner, more maintainable queries.

```sql
-- Auto join uses foreign keys automatically
select book.title, author.name
from book
auto join author;

-- Equivalent to (if book.author_id references author.id):
select book.title, author.name
from book
join author on book.author_id = author.id;
```

**Important**: You cannot specify an ON condition with AUTO JOIN - it uses the defined foreign key.

```sql
-- This will FAIL:
select book.title, author.name
from book
auto join author on book.author_id = author.id;  -- ERROR
```

### Auto Join Variants

```sql
-- Left auto join (the AUTO keyword comes before LEFT)
select author.name, book.title
from author
auto left join book;

-- Right auto join
select author.name, book.title
from author
auto right join book;
```

## Self Join

Join a table to itself using different aliases.

```sql
-- Find employees and their managers
select
  e.name as employee,
  m.name as manager
from employees e
left join employees m on e.manager_id = m.id;

-- Find duplicate entries
select a.*
from records a
join records b on a.email = b.email and a.id < b.id;
```

## Join Order Semantics

- Inner joins with equivalent conditions produce the same result regardless of
  written order.
- Outer joins are order-sensitive; changing the written order can change which
  side is preserved.

```sql
-- These are equivalent
select * from a join b on a.id = b.a_id join c on b.id = c.b_id;
select * from c join b on c.b_id = b.id join a on b.a_id = a.id;

-- These are NOT equivalent (outer join order matters)
select * from a left join b on a.id = b.a_id left join c on b.id = c.b_id;
select * from a left join c on ... left join b on ...;  -- Different result
```

## Common Patterns

### Exclusive Join (Records in A but not B)

```sql
select a.*
from table_a a
left join table_b b on a.id = b.a_id
where b.id is null;
```

### Inclusive Join (Records in A or B)

```sql
select coalesce(a.id, b.id) as id, a.value as a_value, b.value as b_value
from table_a a
full outer join table_b b on a.id = b.id;
```

### Latest Record Join

```sql
select o.*, latest_status.*
from orders o
left join lateral (
    select status, updated_at
    from order_status_history
    where order_id = o.id
    order by updated_at desc
    limit 1
) latest_status on true;
```
