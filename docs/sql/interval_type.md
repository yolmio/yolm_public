---
title: Interval Type
description: How to use the Yolm SQL interval type for durations, interval literals, date arithmetic, comparisons, and justification functions.
tags:
  - sql
  - types
  - date-time
---

# Interval Type

The `interval` type represents a duration of time. Yolm implements PostgreSQL-style interval syntax with full arithmetic operations.

## Interval Literals

Create intervals with interval literals, [`make_interval(...)`](#makeinterval),
or a cast from text. Casts (`cast(value as interval)`, `value::interval`,
`try_cast`) accept the same text forms as interval literals, including
non-literal text such as `cast(('2' || ' days') as interval)`.

### PostgreSQL Format

```sql
select interval '1 day';
select interval '2 hours 30 minutes';
select interval '1 year 2 months 3 days';
select interval '1 week';
select interval '7 weeks';
select interval '-5 days';
select interval '1 day 2 hours 30 minutes';  -- 1 day, 2 hours, 30 minutes
```

### ISO 8601 Format

```sql
select interval 'P1Y2M3D';           -- 1 year, 2 months, 3 days
select interval 'P1Y2M3DT4H5M6S';    -- includes time component
select interval 'PT1H30M';            -- 1 hour, 30 minutes
```

### Time Format

```sql
select interval '3:30:00';            -- 3 hours, 30 minutes
select interval '1:30:45.123456';     -- with microseconds
```

### Casts From Text

```sql
select cast('2 hours' as interval);  -- 02:00:00
select cast('P1DT2H' as interval);   -- 1 day 02:00:00
select try_cast('not an interval' as interval);  -- null
```

## Interval Components

Intervals consist of three internal components:

- **Months** (for years and months)
- **Days** (for weeks and days)
- **Microseconds** (for hours, minutes, seconds)

This three-part representation correctly handles calendar arithmetic where months and days have variable lengths.

## Interval Arithmetic

### Adding Intervals to Dates/Timestamps

```sql
select date '2023-01-15' + interval '1 month';
-- 2023-02-15

select timestamp '2023-01-31 12:00:00' + interval '1 month';
-- 2023-02-28 12:00:00 (handles month-end correctly)

select current_timestamp + interval '2 hours 30 minutes';
-- adds 2.5 hours to current time
```

### Subtracting Intervals

```sql
select date '2023-03-15' - interval '1 month';
-- 2023-02-15

select current_date - interval '1 week';
-- 7 days ago
```

### Multiplying Intervals

```sql
select interval '1 hour' * 3;
-- 3 hours

select interval '1 day 2 hours' * 2;
-- 2 days 4 hours
```

### Subtracting Dates/Timestamps (Returns Interval)

```sql
select date '2023-12-25' - date '2023-01-01';
-- interval representing the difference

select timestamp '2023-12-25 18:00:00' - timestamp '2023-12-25 09:00:00';
-- 9 hours
```

## Interval Functions

### age(timestamp, timestamp)

Calculates the interval between two timestamps, returning a "symbolic" interval with years, months, and days.

```sql
select age(timestamp '2023-12-25', timestamp '2020-06-15');
-- 3 years 6 months 10 days

select age(current_timestamp, birth_date) from users;
-- age of each user
```

### justify_days(interval)

Adjusts interval so days don't exceed 30 (converts excess to months).

```sql
select justify_days(interval '35 days');
-- 1 month 5 days
```

### justify_hours(interval)

Adjusts interval so hours don't exceed 24 (converts excess to days).

```sql
select justify_hours(interval '27 hours');
-- 1 day 3 hours
```

### justify_interval(interval)

Applies both justify_days and justify_hours.

```sql
select justify_interval(interval '1 month 35 days 27 hours');
-- 2 months 6 days 3 hours

select justify_interval(interval '1 day 25 hours');
-- 2 days 1 hour
```

### make_interval

Builds an interval from positional or named numeric arguments.

```sql
select make_interval(days => 2);
select make_interval(1, 2, 0, 3, 4, 5, 6);
```

Named arguments accepted by `make_interval` are `years`, `months`, `weeks`,
`days`, `hours`, `minutes`, and `seconds` plus singular/abbreviated forms such
as `year`, `mon`, `day`, `hour`, `min`, and `sec`. Positional arguments are, in
order: years, months, weeks, days, hours, minutes, seconds.

### extract / date_part

Extract components from an interval:

```sql
select extract(hour from interval '2 days 3 hours 45 minutes');
-- 3

select extract(day from interval '5 days 12 hours');
-- 5

select date_part('month', interval '1 year 3 months');
-- 3

select extract(minute from interval '1 hour 30 minutes');
-- 30
```

Available fields: `year`, `month`, `day`, `hour`, `minute`, `second`. Each
field reads one component (`month` is the months component modulo 12, `hour`
is whole hours of the time component); they are not totals.

## Common Patterns

For date-range filters and age calculations, see
[Date and Time Functions](./date_functions.md#common-patterns).

### Scheduling

```sql
-- Next occurrence
select scheduled_time + interval '1 week' as next_occurrence
from recurring_events;

-- Time until deadline
select deadline - current_timestamp as time_remaining
from tasks
where deadline > current_timestamp;
```

### Older Than a Duration

```sql
-- Items older than 1 year
select * from inventory
where age(current_timestamp, received_date) > interval '1 year';
```

### Business Hours

```sql
-- Add business hours (simple example)
select
  event_time,
  event_time + interval '8 hours' as expected_completion
from support_tickets;
```

## Comparison

Intervals can be compared:

```sql
select interval '2 days' > interval '1 day';
-- true
```

Avoid comparing calendar-month intervals to day/hour intervals as if they were
simple total-hour values; month lengths depend on context. For precise
comparisons, use intervals with only day/time components.
