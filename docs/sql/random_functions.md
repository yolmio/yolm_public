---
title: Random Functions
description: Random value generation functions in Yolm SQL including random numbers, booleans, UUIDs, secure random bytes, sampling, and test data generation.
tags:
  - sql
  - functions
  - random
---

# Random Functions

Yolm SQL provides functions for generating random values, useful for testing, sampling, and unique identifiers.

Functions are available in the `random.*` namespace or as `rand_*`
non-namespaced aliases.

`random.real`, `random.double`, `random.int`, `random.bigint`, `random.bool`,
and `random.uuid` draw from the runtime's random source, which is seeded and
deterministic in simulation and tests. Do not use them for secrets. Use
`random.bytes` / `crypto.random_bytes`, which always read the cryptographically
secure system generator.

## Signatures

| Function | Aliases | Result |
| --- | --- | --- |
| `random.real()` | `rand_real()`, `random()` | `double` in `[0, 1)`, generated at 32-bit precision |
| `random.double()` | `rand_double()` | `double` in `[0, 1)` |
| `random.int()` | `rand_int()` | random `int` |
| `random.bigint()` | `rand_bigint()` | random `bigint` |
| `random.bool()` | `rand_bool()` | random boolean |
| `random.uuid()` | `rand_uuid()`, `uuid()`, `gen_random_uuid()` | UUID v4 |
| `random.bytes(length)` | `crypto.random_bytes(length)`, `random_bytes(length)`, `gen_random_bytes(length)` | cryptographically secure random `bytes` (server only) |

`random.int` and `random.bigint` also accept optional bound arguments, but the
current engine does not apply them consistently: the compiled query path
ignores them, and the interpreter ignores a single bound and treats two bounds
as an inclusive `[min, max]` range. For a bounded value, scale
`random.double()` instead; see [Bounded Integers](#bounded-integers).

## Random Numbers

### random.real()

Generates a random number in [0, 1). The result is typed `double`, but the
value is produced by a 32-bit float generator. Prefer
[`random.double()`](#randomdouble), especially for a bare value or in
`order by`, where the 32-bit runtime value can mismatch the `double` type.

Aliases: `rand_real()`, `random()`

```sql
-- Random percentage
select random.real() * 100 as random_pct;
-- 72.34567891234567
```

### random.double()

Generates a random double precision number in [0, 1).

Alias: `rand_double()`

```sql
select random.double();
-- 0.7234567891234567890123456789
```

### random.int()

Generates a random 32-bit signed integer across the full range.

Alias: `rand_int()`

```sql
select random.int();
-- Random integer from -2147483648 to 2147483647
```

### random.bigint()

Generates a random 64-bit signed integer across the full range.

Alias: `rand_bigint()`

```sql
select random.bigint();
-- Random large integer
```

### Bounded Integers

Scale `random.double()` and cast; casting a `double` to `int` truncates toward
zero.

```sql
-- Random integer in [0, 100)
select cast(random.double() * 100 as int);

-- Random integer in [1, 6]
select 1 + cast(random.double() * 6 as int);
```

## Random Boolean

### random.bool()

Generates a random boolean (true/false with 50% probability each).

Alias: `rand_bool()`

```sql
select random.bool();
-- true or false

-- Random decision
select case when random.bool() then 'heads' else 'tails' end;
```

## Random UUID

### random.uuid()

Generates a random UUID version 4.

Aliases: `rand_uuid()`, `uuid()`, `gen_random_uuid()`

```sql
select random.uuid();
-- 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

select gen_random_uuid(); -- PostgreSQL-style alias

-- Use as primary key
insert into items (id, name) values (random.uuid(), 'New Item');
```

## Secure Random Bytes

### random.bytes(length) / crypto.random_bytes(length)

Generates cryptographically secure random bytes from the system generator.
`random.bytes`, `crypto.random_bytes`, `random_bytes`, and `gen_random_bytes`
are the same function. Server only.

```sql
select crypto.random_bytes(16);
-- 16 random bytes

select crypto.random_bytes(32);
-- 32 random bytes (suitable for encryption keys)

-- Convert to hex string
select bytes.to_hex(crypto.random_bytes(16));
-- 'a1b2c3d4e5f6789012345678901234ab'
```

Use `random.bytes` / `crypto.random_bytes` when security matters (tokens,
keys, salts).

## Common Patterns

### Random Sampling

```sql
-- Random 10% sample
select * from large_table
where random.double() < 0.1;

-- Random N rows (approximate)
select * from products
where random.double() < 100.0 / (select count(*) from products)
limit 100;
```

### Shuffle / Random Order

```sql
select * from items
order by random.double();
```

### Random Selection

```sql
-- Pick one random row
select * from quotes
order by random.double()
limit 1;

-- Pick N random rows
select * from products
order by random.double()
limit 5;
```

### Generate Test Data

```sql
-- Random prices
select
  id,
  name,
  round(random.double() * 100, 2) as price
from products;

-- Random dates in 2023 (% keeps the dividend's sign, so derive the
-- offset from random.double() rather than random.int() % 365)
select
  date '2023-01-01' + cast(random.double() * 365 as int) as random_date
from series.int(1, 100);

-- Random status
select
  id,
  case cast(random.double() * 3 as int)
    when 0 then 'pending'
    when 1 then 'active'
    when 2 then 'completed'
  end as status
from tasks;
```

### Unique Tokens

```sql
-- Generate API key
select bytes.to_hex(crypto.random_bytes(32)) as api_key;

-- Generate short code
select left(bytes.to_hex(crypto.random_bytes(8)), 8) as short_code;
-- 'a1b2c3d4'

-- Generate URL-safe token
select encode.base64_url_safe(crypto.random_bytes(24)) as token;
```

### Weighted Random Selection

```sql
-- Weighted random (items with higher weight more likely)
with weighted as (
  select *,
         sum(weight) over (order by id) as cumulative_weight,
         sum(weight) over () as total_weight
  from items
)
select *
from weighted
where cumulative_weight >= random.double() * total_weight
order by cumulative_weight
limit 1;
```

### A/B Testing Assignment

```sql
-- Assign users to test groups
select
  user_id,
  case
    when random.double() < 0.5 then 'control'
    else 'treatment'
  end as test_group
from users;
```

## Notes

- Random functions generate new values for each row/evaluation
- Results are not reproducible across queries in production (no seed support)
- For cryptographic purposes, always use `random.bytes` /
  `crypto.random_bytes`
- The other `random.*` functions use the runtime's random source, which is
  deterministic in simulation and tests, so they are not suitable for secrets
