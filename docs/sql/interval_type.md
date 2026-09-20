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

Use interval literals or `make_interval(...)` to create intervals. The compiler
does not support casts to `interval`; use one of these constructors instead.

### PostgreSQL Format

```sql
select interval '1 day';
select interval '2 hours 30 minutes';
select interval '1 year 2 months 3 days';
select interval '1 week';
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

### Additional Interval Literals

```sql
select interval '2 hours';
select interval 'P1DT2H';
select interval '7 weeks';
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
```

### extract / date_part

Extract components from an interval:

```sql
select extract(hour from interval '2 days 3 hours 45 minutes');
-- 3

select extract(day from interval '5 days 12 hours');
-- 5

select date_part('month', interval '1 year 3 months');
-- 3
```

Available fields: `year`, `month`, `day`, `hour`, `minute`, `second`

## Common Patterns

### Date Ranges

```sql
-- Records from the last 30 days
select * from orders
where created_at > current_timestamp - interval '30 days';

-- Records from the last 3 months
select * from reports
where report_date > current_date - interval '3 months';
```

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

### Age Calculations

```sql
-- User ages in years
select name, extract(year from age(current_timestamp, birth_date)) as age
from users;

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

## Constructing and Extracting

```sql
-- Create intervals with literals or make_interval
select interval '2 hours 30 minutes';
select interval 'P1D';
select make_interval(days => 2);

-- Extract components from interval
select extract(hour from interval '1 hour 30 minutes');
-- 1
select extract(minute from interval '1 hour 30 minutes');
-- 30
```

## Comparison

Intervals can be compared:

```sql
select interval '2 days' > interval '1 day';
-- true
```

Avoid comparing calendar-month intervals to day/hour intervals as if
they were simple total-hour values; month lengths depend on context.

Note: Comparisons involving months may have unexpected results since months have variable lengths. For precise comparisons, use intervals with only day/time components.
