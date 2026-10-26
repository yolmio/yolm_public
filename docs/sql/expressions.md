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
-- Regular comparison: null = null is null (not true)
select null = null;  -- null

-- is distinct from: null is not distinct from null
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

Checks whether a subquery returns any rows. More efficient than `in` for existence checks.

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
- `is true` - exactly true
- `is false` - exactly false
- `is not true` - false or null
- `is not false` - true or null
- `is null` - null
- `is not null` - true or false

## LIKE / ILIKE

Pattern matching with wildcards.

- `%` matches any sequence of characters
- `_` matches any single character

```sql
select * from users where name like 'John%';        -- starts with John
select * from users where email like '%@gmail.com'; -- ends with @gmail.com
select * from users where name like '%Smith%';      -- contains Smith
select * from users where code like 'A__';          -- A followed by 2 chars
select * from users where name ilike '%john%';      -- always case-insensitive
```

`like` follows the collation of the left operand. The default collation is
`NoCase`, so `like` on a field or literal without a `Binary` collation is
already case-insensitive; `ilike` is case-insensitive regardless
of collation. See [Pattern Matching](./string_functions.md#pattern-matching)
for the `escape` clause and collation examples.

## Arithmetic Expressions

See [Mathematical Functions](./math_functions.md) for operator semantics,
including integer division and division by zero (which returns null).

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

`^` is not an exponent operator; see
[power](./math_functions.md#power-pow).

## String Concatenation

```sql
select first_name || ' ' || last_name as full_name from users;
```

See [String Functions](./string_functions.md#concatenation) for `||`,
`concat`, and `concat_ws`. When both operands are JSON, `||` performs JSON concatenation instead; see
[JSON Functions](./json_functions.md).

## Type Casting

`cast(value as type)`, the PostgreSQL-style `value::type` operator, and
`try_cast` / `safe_cast` (null instead of an error on invalid conversion) are
supported. See [Type Conversion](./global_functions.md#type-conversion) for
examples and the supported target types.

```sql
select '123'::int;
select try_cast('not a number' as int);  -- null
```

## Collation

String comparison and ordering use an explicit `collate` clause if present,
otherwise the field's collation (default `db.collation`), otherwise the system
default (`system.collation`). Both defaults are `NoCase` (case-insensitive)
unless configured as `"Binary"`.
Use `collate binary` for a case-sensitive comparison and `collate nocase` to
force a case-insensitive one. Unknown collation names are rejected. See
[Collation](./string_functions.md#collation) for examples.

```sql
select name
from users
order by name collate binary;
```

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

`coalesce`, `nullif`, `greatest`, and `least` are documented in
[Global SQL Functions](./global_functions.md#null-handling).

## Operator Precedence

From highest to lowest:

1. `::` (type cast)
2. `.` (field selection)
3. `-` (unary minus)
4. `* / %` (multiplication, division, modulo)
5. `+ -` (addition, subtraction)
6. `||` (string concatenation)
7. `between in like ilike`
8. `< > = <= >= <>`
9. `is null`, `is not null`
10. `not`
11. `and`
12. `or`

Use parentheses to clarify complex expressions:
```sql
select (a + b) * c;
select a or (b and c);
```
