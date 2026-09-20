---
title: Subqueries and CTEs
description: Using subqueries and Common Table Expressions (CTEs / WITH clauses) in Yolm SQL, including correlated subqueries, scalar subqueries, and recursive CTEs for hierarchical data.
tags:
  - sql
  - subqueries
  - ctes
---

# Subqueries and CTEs

## Subqueries

Subqueries are queries nested within another query, allowing complex data retrieval.

### In WHERE clause

```sql
select title
from book
where author in (
    select id
    from author
    where nationality = 'British'
);
```

### In FROM clause

```sql
select title
from (select title from book where author = 0) as book;
```

## Common Table Expressions (CTEs)

CTEs provide auxiliary statements for use in a larger query, improving readability.

```sql
with bestsellers as (
    select *
    from book
    where is_bestseller
)
select author.name, count(*) as bestseller_count
from author
join bestsellers on author.id = bestsellers.author
group by author.name;
```

## Recursive CTEs

Recursive CTEs are powerful for hierarchical or graph-like data structures. They consist of an anchor member and a recursive part.

### Example: Fibonacci Sequence

```sql
with recursive fibonacci(n, fib_n, next_fib) as (
    -- Anchor member
    select 0, 0::bigint, 1::bigint
    union all
    -- Recursive member
    select n + 1, next_fib, fib_n + next_fib
    from fibonacci
    where n < 10
)
select n, fib_n from fibonacci;
```

### Use Cases

Recursive CTEs are particularly useful for:

- Traversing tree or graph structures (organization hierarchies, bill of materials)
- Generating series or sequences
- Performing calculations that depend on previous results
