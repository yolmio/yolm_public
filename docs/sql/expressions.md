---
title: SQL Expressions
description: SQL expression syntax in Yolm, including CASE, EXISTS, IN, BETWEEN, LIKE, NULL checks, boolean logic, casts, and subqueries.
tags:
  - sql
  - expressions
---

# SQL Expressions

## Comparison Operators

### Standard Comparisons

```sql
select * from products where price = 100;
select * from products where price != 100;   -- or <>
select * from products where price < 100;
select * from products where price <= 100;
select * from products where price > 100;
select * from products where price >= 100;
```

### IS DISTINCT FROM

Null-safe inequality (treats NULL as a comparable value).

```sql
-- Regular comparison: NULL = NULL is NULL (not true)
select null = null;  -- null

-- IS DISTINCT FROM: NULL is not distinct from NULL
select null is distinct from null;      -- false
select null is distinct from 1;         -- true
select 1 is distinct from 2;            -- true
select 1 is not distinct from 1;        -- true
```

## Boolean Logic

### AND, OR, NOT

```sql
select * from users
where is_active and role = 'admin';

select * from products
where category = 'electronics' or category = 'computers';

select * from orders
where not is_cancelled;
```

### Boolean Values

```sql
select true, false;
select is_active = true from users;
select not is_deleted from records;
```

## CASE WHEN

Conditional logic similar to if-else statements.

### Searched CASE

```sql
select
  title,
  case
    when price < 10 then 'cheap'
    when price between 10 and 50 then 'moderate'
    when price > 50 then 'expensive'
    else 'unknown'
  end as price_category
from products;
```

### Simple CASE

```sql
select
  status,
  case status
    when 'pending' then 'Awaiting'
    when 'approved' then 'Accepted'
    when 'rejected' then 'Declined'
    else 'Unknown'
  end as status_label
from applications;
```

### CASE with Aggregates

```sql
select
  count(case when status = 'active' then 1 end) as active_count,
  count(case when status = 'inactive' then 1 end) as inactive_count
from users;
```

## EXISTS

Checks whether a subquery returns any rows. More efficient than `IN` for existence checks.

```sql
-- Authors with at least one bestseller
select name
from author
where exists (
  select 1
  from book
  where book.author_id = author.id
    and book.is_bestseller = true
);

-- Authors with no books
select name
from author
where not exists (
  select 1
  from book
  where book.author_id = author.id
);
```

## IN

Checks membership in a list or subquery result.

### IN with List

```sql
select * from products
where category in ('electronics', 'computers', 'phones');

select * from orders
where status not in ('cancelled', 'refunded');
```

### IN with Subquery

```sql
select * from books
where author_id in (
  select id from authors where nationality = 'British'
);

select * from products
where id not in (
  select product_id from discontinued_products
);
```

## BETWEEN

Selects values within a range (inclusive on both ends).

```sql
select * from products
where price between 10 and 50;

select * from events
where event_date between date '2023-01-01' and date '2023-12-31';

select * from products
where price not between 100 and 200;
```

Equivalent to:
```sql
select * from products
where price >= 10 and price <= 50;
```

## NULL Checks

### IS NULL / IS NOT NULL

```sql
select * from users where phone is null;
select * from users where phone is not null;

-- Common pattern: coalesce with null check
select coalesce(nickname, name) as display_name
from users;
```

### Boolean IS Checks

For three-valued logic (true, false, null):

```sql
select
  title,
  is_featured,
  is_featured is true as definitely_featured,
  is_featured is false as definitely_not_featured,
  is_featured is not true as possibly_not_featured,
  is_featured is not false as possibly_featured,
  is_featured is null as unknown
from products;
```

Available checks:
- `IS TRUE` - exactly true
- `IS FALSE` - exactly false
- `IS NOT TRUE` - false or null
- `IS NOT FALSE` - true or null
- `IS NULL` - null
- `IS NOT NULL` - true or false

## LIKE / ILIKE

Pattern matching with wildcards.

- `%` matches any sequence of characters
- `_` matches any single character

```sql
select * from users where name like 'John%';        -- starts with John
select * from users where email like '%@gmail.com'; -- ends with @gmail.com
select * from users where name like '%Smith%';      -- contains Smith
select * from users where code like 'A__';          -- A followed by 2 chars

-- Case-insensitive
select * from users where name ilike '%john%';
```

### ESCAPE clause

```sql
-- Match literal % character
select * from products where discount like '50\%' escape '\';
```

## Arithmetic Expressions

```sql
select
  price,
  quantity,
  price * quantity as total,
  price * 1.08 as price_with_tax,
  (price - cost) / price * 100 as margin_pct
from order_items;
```

## Bitwise Operators

Bitwise operators work on integer values.

```sql
select flags & 4;   -- bitwise and
select flags | 2;   -- bitwise or
select flags # 2;   -- bitwise xor
select flags << 1;  -- shift left
select flags >> 1;  -- shift right
```

Use `power(base, exponent)` for exponentiation; `^` is not the exponent
operator in Yolm SQL.

## String Concatenation

```sql
select first_name || ' ' || last_name as full_name from users;
select 'Order #' || order_id as order_label from orders;
```

When both operands are JSON, `||` performs JSON concatenation instead; see
[JSON Functions](./json_functions.md).

## Type Casting

### :: Operator (PostgreSQL syntax)

```sql
select '123'::int;
select 123::text;
select '2023-01-15'::date;
select price::decimal(10,2);
```

### CAST Function

```sql
select cast('123' as int);
select cast(price as text);
select cast('2023-01-15' as date);
```

### TRY_CAST (Safe casting)

Returns NULL instead of error on invalid conversion.

```sql
select try_cast('not a number' as int);  -- null
select try_cast('123' as int);           -- 123
select try_cast('invalid' as date);      -- null
select safe_cast('123' as int);          -- 123
```

## Collation

Use `collate nocase` for case-insensitive comparison or ordering.

```sql
select *
from users
where name collate nocase = 'alice';

select name
from users
order by name collate nocase;
```

Unknown collation names are rejected.

## Regex Operators

Regex match operators are accepted in expressions:

```sql
select email ~ '@example\.com$';
select name ~* '^alice$';   -- case-insensitive
select code !~ '^[0-9]+$';
select code !~* '^test';
```

See [Regular Expression Functions](./regex_functions.md) for scalar and table
regex functions.

## JSON Operators

JSON operators include `->`, `->>`, `#>`, `#>>`, `@>`, `<@`, `?`, `?|`, `?&`,
`||`, `-`, and `#-`. See [JSON Functions](./json_functions.md) for behavior and
examples.

## Subquery Expressions

### Scalar Subquery

Returns a single value.

```sql
select
  name,
  (select count(*) from orders where orders.user_id = users.id) as order_count
from users;
```

### Table Subquery in FROM

```sql
select avg(total) as avg_order_total
from (
  select sum(price * quantity) as total
  from order_items
  group by order_id
) order_totals;
```

## Conditional Expressions

### COALESCE

Returns first non-null value.

```sql
select coalesce(nickname, first_name, 'Anonymous') as display_name
from users;
```

### NULLIF

Returns null if arguments are equal.

```sql
select value / nullif(divisor, 0) as safe_division;  -- avoids /0 error
select nullif(status, 'unknown') as clean_status;     -- null if 'unknown'
```

### GREATEST / LEAST

```sql
select greatest(a, b, c) as max_value;
select least(a, b, c) as min_value;

-- Clamp to range
select greatest(0, least(100, value)) as clamped;
```

## Operator Precedence

From highest to lowest:

1. `::` (type cast)
2. `.` (field selection)
3. `-` (unary minus)
4. `* / %` (multiplication, division, modulo)
5. `+ -` (addition, subtraction)
6. `||` (string concatenation)
7. `BETWEEN IN LIKE ILIKE`
8. `< > = <= >= <>`
9. `IS NULL`, `IS NOT NULL`
10. `NOT`
11. `AND`
12. `OR`

Use parentheses to clarify complex expressions:
```sql
select (a + b) * c;
select a or (b and c);
```
