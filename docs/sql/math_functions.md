---
title: Mathematical Functions
description: Mathematical SQL functions for arithmetic, rounding, absolute values, powers, logarithms, trigonometry, modulo, and constants.
tags:
  - sql
  - functions
  - math
---

# Mathematical Functions

Yolm SQL provides comprehensive mathematical functions compatible with much of PostgreSQL's SQL function surface.

## Function Reference

| Function | Aliases | Arguments |
| --- | --- | --- |
| `abs(value)` | | numeric |
| `ceil(value)` | `ceiling(value)` | numeric |
| `floor(value)` | | numeric |
| `round(value)` | | numeric |
| `round(value, scale)` | | numeric, integer scale |
| `trunc(value)` | `truncate(value)` | numeric |
| `sign(value)` | | numeric |
| `sqrt(value)` | | numeric |
| `cbrt(value)` | | numeric |
| `exp(value)` | | numeric |
| `ln(value)` | | numeric |
| `log(base, value)` | | numeric |
| `log10(value)` | | numeric |
| `power(base, exponent)` | `pow(base, exponent)` | numeric |
| `mod(left, right)` | `%` operator | numeric |
| `factorial(value)` | | integer |
| `pi()` | | no arguments |
| `degrees(radians)` | | numeric |
| `radians(degrees)` | | numeric |
| `sin(value)` | | radians |
| `cos(value)` | | radians |
| `tan(value)` | | radians |
| `asin(value)` | | numeric |
| `acos(value)` | | numeric |
| `atan(value)` | | numeric |
| `atan2(y, x)` | | numeric |

## Arithmetic Operators

```sql
select 10 + 3;   -- 13 (addition)
select 10 - 3;   -- 7 (subtraction)
select 10 * 3;   -- 30 (multiplication)
select 10 / 3;   -- 3 (integer division)
select 10.0 / 3; -- 3.333... (decimal division)
select 10 % 3;   -- 1 (modulo/remainder)
select -5;       -- -5 (negation)
-- For exponentiation use power(base, exp); the ^ operator is not supported.
```

## Rounding Functions

### round

Rounds to nearest integer or specified decimal places. Ties round half away
from zero (`42.5` becomes `43`, `-42.5` becomes `-43`).

```sql
select round(42.4);       -- 42
select round(42.5);       -- 43
select round(42.4382, 2); -- 42.44
select round(-42.5);      -- -43
```

### ceil / ceiling

Rounds up to nearest integer.

```sql
select ceil(42.1);   -- 43
select ceil(-42.1);  -- -42
select ceiling(42.1); -- 43
```

### floor

Rounds down to nearest integer.

```sql
select floor(42.9);  -- 42
select floor(-42.1); -- -43
```

### trunc / truncate

Truncates toward zero.

```sql
select trunc(42.9);      -- 42
select trunc(-42.9);     -- -42
```

## Sign and Absolute Value

### abs

Returns absolute value.

```sql
select abs(-42);    -- 42
select abs(42);     -- 42
select abs(-3.14);  -- 3.14
```

### sign

Returns -1, 0, or 1 indicating sign.

```sql
select sign(-42);  -- -1
select sign(0);    -- 0
select sign(42);   -- 1
```

## Power and Root Functions

### power / pow

Raises to a power.

```sql
select power(2, 10);     -- 1024
select pow(2, 0.5);      -- 1.414... (square root)
select power(10, -2);    -- 0.01
```

### sqrt

Square root.

```sql
select sqrt(16);   -- 4
select sqrt(2);    -- 1.414...
```

### cbrt

Cube root.

```sql
select cbrt(27);   -- 3
select cbrt(-8);   -- -2
```

## Exponential and Logarithmic

### exp

e raised to a power.

```sql
select exp(1);   -- 2.718... (e)
select exp(0);   -- 1
select exp(2);   -- 7.389...
```

### ln

Natural logarithm (base e).

```sql
select ln(1);            -- 0
select ln(10);           -- 2.302...
-- Cast decimal literals to float for accurate ln/log/exp:
select ln(cast(2.718281828 as double precision));  -- ~1
```

### log10

Logarithm base 10. (There is no single-argument `log`; use `log10` for base 10,
or `log(base, value)` below.)

```sql
select log10(100);  -- 2
select log10(1000); -- 3
```

### log(base, value)

Logarithm with custom base.

```sql
select log(2, 8);   -- 3
select log(10, 100); -- 2
```

## Trigonometric Functions

All trigonometric functions use radians.

### Basic Trigonometry

```sql
select sin(0);           -- 0
select cos(0);           -- 1
select tan(0);           -- 0
select sin(pi() / 2);    -- 1
select cos(pi());        -- -1
```

### Inverse Trigonometry

```sql
select asin(1);          -- 1.5707... (π/2)
select acos(0);          -- 1.5707... (π/2)
select atan(1);          -- 0.7853... (π/4)
select atan2(1, 1);      -- 0.7853... (π/4)
```

### Angle Conversion

```sql
select degrees(pi());    -- 180
select radians(180);     -- 3.14159...
```

### Pi Constant

```sql
select pi();  -- 3.14159265358979...
```

## Greatest and Least

`greatest` and `least` (including clamping a value to a range) are documented
in [Global SQL Functions](./global_functions.md#least-greatest).

## Random Numbers

See [Random Functions](./random_functions.md).

## Type Conversion

### Casting Numeric Types

```sql
select 42::decimal;
select cast(42 as decimal);
select 42.5::int;          -- 42 (truncates)
select cast('123' as int); -- 123
```

### Numeric Precision

```sql
select cast(1.0/3 as decimal(10, 4));  -- 0.3333
```

## Common Patterns

### Percentage Calculation

```sql
select value::decimal / total * 100 as percentage
from metrics;
```

### Rounding Currency

```sql
select round(price * 1.08, 2) as price_with_tax
from products;
```

### Distance Calculation (2D)

```sql
select sqrt(power(x2 - x1, 2) + power(y2 - y1, 2)) as distance
from points;
```

### Safe Division

Division by zero returns null (see
[Numeric Type Behavior](#numeric-type-behavior)). Use `case` when you need a
different fallback value:

```sql
select case
  when denominator = 0 then 0
  else numerator::decimal / denominator
end as safe_ratio
from values;
```

### Integer Division with Remainder

```sql
select
  value / 10 as quotient,
  value % 10 as remainder
from numbers;
```

## Numeric Type Behavior

- Integer division returns integer: `10 / 3 = 3`
- At least one decimal operand returns decimal: `10.0 / 3 = 3.333...`
- Integer overflow wraps around (two's complement); it does not raise an error
- Division or modulo by zero returns null (not an error)
- `%` and `mod` return a remainder with the sign of the dividend:
  `-7 % 3 = -1`

## Null Handling

Most math functions return null if any input is null:

```sql
select 5 + null;      -- null
select abs(null);     -- null
select round(null);   -- null
```
