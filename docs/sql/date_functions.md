---
title: Date and Time Functions
description: Date and time SQL functions for extraction, truncation, intervals, construction, parsing, formatting, time zones, and time buckets.
tags:
  - sql
  - functions
  - date-time
---

# Date and Time Functions

Yolm SQL provides comprehensive date/time support compatible with much of PostgreSQL's SQL function surface. Date formatting and parsing use the Rust chrono crate syntax. See https://docs.rs/chrono/latest/chrono/format/strftime/index.html

## Date Parts

Valid parts for extraction and truncation functions:

| Part | Description |
|------|-------------|
| `year` | Year |
| `quarter` | Quarter (1-4) |
| `month` | Month (1-12) |
| `week` | ISO week number |
| `day` | Day of month (1-31) |
| `doy` | Day of year (1-366) |
| `dow` | Day of week (0=Sunday, 6=Saturday) |
| `hour` | Hour (0-23) |
| `minute` | Minute (0-59) |
| `second` | Second (0-59) |
| `timezone` | Timezone name |
| `isoyear` | ISO 8601 week-numbering year |

## Extraction Functions

### extract / date_part

Extract a component from a date, time, or timestamp.

```sql
-- PostgreSQL syntax (recommended)
select extract(year from date '2023-09-17');          -- 2023
select extract(month from timestamp '2023-09-17 14:30:00'); -- 9
select extract(dow from date '2023-09-17');           -- 0 (Sunday)
select extract(quarter from date '2023-09-17');       -- 3

-- date_part function
select date_part('year', date '2023-09-17');          -- 2023
select date_part('hour', time '14:30:00');            -- 14
```

### date.part (Yolm syntax)

```sql
select date.part(year, date '2023-09-17');  -- 2023
select date.part(month, timestamp '2023-09-17 14:30:00'); -- 9
```

**Note**: With Yolm syntax, use parts without quotes (e.g., `month` not `'month'`).

## Truncation Functions

### date_trunc

Truncate a date or timestamp to specified precision.

```sql
-- PostgreSQL syntax (recommended)
select date_trunc('month', date '2023-09-17');        -- 2023-09-01
select date_trunc('year', timestamp '2023-09-17 14:30:00'); -- 2023-01-01 00:00:00
select date_trunc('hour', timestamp '2023-09-17 14:30:45'); -- 2023-09-17 14:00:00
select date_trunc('week', date '2023-09-17');         -- 2023-09-11 (Monday)
```

### date.trunc (Yolm syntax)

```sql
select date.trunc(month, date '2023-09-17');
select date.trunc(year, timestamp '2023-09-17 14:30:00');
```

## Interval Arithmetic

See [Interval Type](./interval_type.md) for comprehensive interval documentation.

### Adding/Subtracting Intervals

```sql
-- Using interval literals
select date '2023-01-15' + interval '1 month';        -- 2023-02-15
select timestamp '2023-09-17 12:00:00' + interval '2 hours 30 minutes';
select current_date - interval '7 days';              -- 1 week ago
select current_date - 7;                              -- 1 week ago
select 7 + current_date;                              -- 1 week from today

-- End-of-month handling
select date '2023-01-31' + interval '1 month';        -- 2023-02-28
```

### date.add / date.subtract (Yolm syntax)

```sql
select date.add(day, 5, date '2023-01-01');    -- 2023-01-06
select date.add(month, -1, date '2023-09-17'); -- 2023-08-17
select date.add(year, 2, date '2023-09-17');   -- 2025-09-17

select date.subtract(day, 5, date '2023-01-06');  -- 2023-01-01
select date.subtract(month, 1, date '2023-09-17'); -- 2023-08-17

-- Two-argument interval form
select date_add(date '2023-01-06', interval '-5 days'); -- 2023-01-01
select date_sub(date '2023-09-17', interval '1 month'); -- 2023-08-17
```

Aliases: `dateadd()` / `date_add()` for `date.add`, `datesub()` / `date_sub()` for `date.subtract`.

## Difference Functions

### date.diff

Counts boundary crossings between two dates/timestamps.

```sql
select date.diff(year, date '2022-12-31', date '2023-01-01'); -- 1
select date.diff(day, date '2023-09-01', date '2023-09-17');  -- 16
select date.diff(month, date '2023-01-15', date '2023-03-10'); -- 2
```

### date.duration

Calculates actual complete periods between dates (differs from diff).

```sql
select date.duration(year, date '2022-12-31', date '2023-01-01'); -- 0
select date.duration(month, date '2023-01-31', date '2023-03-01'); -- 1
```

### Subtracting dates (returns interval)

```sql
select date '2023-12-25' - date '2023-01-01';
-- Returns interval

select timestamp '2023-12-25 18:00:00' - timestamp '2023-12-25 09:00:00';
-- 9 hours
```

### age()

Calculate interval between timestamps as years, months, days.

```sql
select age(timestamp '2023-12-25', timestamp '2020-06-15');
-- 3 years 6 months 10 days
```

## Date Construction

### PostgreSQL syntax

```sql
select make_date(2023, 12, 31);                  -- 2023-12-31
select make_time(23, 59, 59);                    -- 23:59:59
select make_timestamp(2023, 12, 31, 23, 59, 59); -- 2023-12-31 23:59:59
```

### Yolm syntax

```sql
select date.new_date(2023, 12, 31);              -- 2023-12-31
select date.new_time(23, 59, 59);                -- 23:59:59
select date.new_timestamp(2023, 12, 31, 23, 59, 59);

-- Also available with type-based namespaces:
select date.new(2023, 12, 31);                   -- 2023-12-31
select time.new(23, 59, 59);                     -- 23:59:59
select timestamp.new(2023, 12, 31, 23, 59, 59);
```

### From epoch

```sql
select date.from_epoch(1631906400);  -- 2021-09-17T19:20:00+00:00
select to_timestamp(1631906400);     -- PostgreSQL syntax
```

## Parsing Functions

### PostgreSQL syntax

```sql
select to_date('2023-09-17', 'YYYY-MM-DD');
select to_timestamp('1983 Apr 13 12:09:14 +0000', 'YYYY Mon DD HH24:MI:SS TZH');
```

### Yolm syntax

```sql
select date.parse_date('11-12-18', '%m-%d-%y');     -- 2018-11-12
select date.parse_date('2023 Sep 17', '%Y %b %d');  -- 2023-09-17

select date.parse_timestamp('1983 Apr 13 12:09:14 +0000', '%Y %b %d %H:%M:%S %z');
-- 1983-04-13T12:09:14+00:00

-- Parse to naive timestamp (without timezone)
select date.parse_timestamp_naive('2023-09-17 14:30:00', '%Y-%m-%d %H:%M:%S');

select date.parse_time('23:56:04', '%H:%M:%S');  -- 23:56:04
select date.parse_time('2:30 PM', '%I:%M %p');   -- 14:30:00

-- Also available with type-based namespaces:
select date.parse('2023-09-17', '%Y-%m-%d');             -- same as date.parse_date
select time.parse('23:56:04', '%H:%M:%S');               -- same as date.parse_time
select timestamp.parse('...', '%Y %b %d %H:%M:%S %z');  -- same as date.parse_timestamp
select timestamp.parse_naive('...', '%Y-%m-%d %H:%M:%S');
```

## Formatting

### to_char (PostgreSQL syntax)

```sql
select to_char(date '2023-09-17', 'Month DD, YYYY');  -- September 17, 2023
select to_char(timestamp '2023-09-17 14:30:00', 'HH12:MI AM'); -- 02:30 PM
```

### format.date (Yolm syntax)

```sql
select format.date(date '2023-09-17', '%B %d, %Y');   -- September 17, 2023
select format.date(current_timestamp, '%Y-%m-%d %H:%M:%S');
select strftime('%Y-%m-%d', current_date);
```

### date.to_rfc3339

```sql
-- Signature: date.to_rfc3339(timestamp, precision, use_z)
-- precision: 'seconds' | 'milliseconds'
-- use_z: render a zero (UTC) offset as 'Z' (true) instead of '+00:00' (false)
select date.to_rfc3339(timestamp '2023-09-17 14:30:00', 'seconds', false);
-- 2023-09-17T14:30:00+00:00
select date.to_rfc3339(timestamp '2023-09-17 14:30:00', 'seconds', true);
-- 2023-09-17T14:30:00Z
```

## Period Boundaries

```sql
select date.start_of_week(date '2023-05-10');   -- 2023-05-08 (Monday)
select date.end_of_week(date '2023-05-10');     -- 2023-05-14 (Sunday)
select date.start_of_month(date '2023-05-10');  -- 2023-05-01
select date.end_of_month(date '2023-05-10');    -- 2023-05-31
select date.start_of_year(date '2023-05-10');   -- 2023-01-01
select date.end_of_year(date '2023-05-10');     -- 2023-12-31
```

### Additional Functions

```sql
select date.days_in_month(date '2023-02-15');   -- 28

-- Most recent given weekday strictly before the date (may cross into the prior month)
select date.last_weekday(date '2023-09-17', date.thursday());
-- 2023-09-14 (the Thursday before 2023-09-17)
```

## Current Date/Time Functions

```sql
-- Current date
select current_date;      -- 2023-09-17
select current_date();    -- 2023-09-17
select today();           -- 2023-09-17

-- Current timestamp
select current_timestamp; -- 2023-09-17 14:30:00+00:00
select current_timestamp();
select now();
select date.now();        -- Yolm alias

-- Relative dates
select tomorrow();        -- 2023-09-18
select yesterday();       -- 2023-09-16
```

## Timezone Handling

### AT TIME ZONE

Convert timestamps between timezones.

```sql
-- Convert timestamp with timezone to another timezone
select timestamptz '2023-09-17 14:30:00+00:00' at time zone 'America/New_York';
-- 2023-09-17 10:30:00-04:00

select timestamp '2023-09-17 14:30:00' at time zone 'EST';
-- 2023-09-17 14:30:00-05:00
```

### Function syntax

```sql
-- Convert to naive (remove timezone)
select at_time_zone_to_naive(timestamptz '2023-09-17 14:30:00+00:00', 'America/New_York');

-- Convert to specific timezone
select at_time_zone_to_tz(timestamp '2023-09-17 14:30:00', 'America/New_York');
```

## Time Bucket Functions

### time_bucket

Groups timestamps into fixed-size intervals (buckets). Useful for time-series aggregation.

```sql
-- 15-minute buckets
select time_bucket(interval '15 minutes', created_at) as bucket,
       count(*) as events
from events
group by bucket
order by bucket;

-- Hourly buckets
select time_bucket(interval '1 hour', timestamp_col) as hour,
       avg(value) as avg_value
from measurements
group by hour;
```

### date_bin

`date_bin(width, source, origin)` is accepted as a PostgreSQL-style bucketing
form. It returns the bucket for `source` using `origin` as the alignment point.

The origin's time of day is preserved, including for day-sized intervals and
timestamps before the origin. A null origin returns null.

```sql
select date_bin(
  interval '15 minutes',
  timestamp '2023-09-17 14:37:00',
  timestamp '2023-09-17 00:00:00'
);
```

### time_bucket_gapfill

Like `time_bucket`, but also fills in missing buckets with no data.

```sql
select time_bucket_gapfill(
  interval '1 day',
  created_at,
  date '2023-01-01',  -- start
  date '2023-01-31'   -- stop
) as day,
  coalesce(count(*), 0) as event_count
from events
group by day
order by day;
```

Signature:

```sql
time_bucket_gapfill(width interval, source date_or_timestamp)
time_bucket_gapfill(width interval, source date_or_timestamp, start, stop)
time_bucket_gap_fill(width interval, source date_or_timestamp, start, stop)
```

The 2-argument form requires query-constant bounds in `where`; otherwise pass
explicit `start` and `stop`. Timescale-style `locf(...)` and `interpolate(...)`
are not supported.

For scalar bucketing of a `timestamptz` source, a `date` or timezone-free
`timestamp` origin is interpreted in the source's local time zone. Calendar
day/week boundaries therefore remain local boundaries across daylight-saving
changes. An explicit `timestamptz` origin aligns absolute instants instead.
These origin rules also apply to `date_bin`; `time_bucket` without an explicit
origin remains aligned to the Unix epoch.

Grouped gap filling requires `source`, `start`, and `stop` to have the same
type. For daily date buckets, use a date source such as `created_at::date`
with date boundaries.

## make_interval

Builds an interval from positional or named numeric arguments.

```sql
select make_interval(days => 2);
select make_interval(1, 2, 0, 3, 4, 5, 6);
```

Named arguments accepted by `make_interval` are `years`, `months`, `weeks`,
`days`, `hours`, `minutes`, and `seconds` plus singular/abbreviated forms such
as `year`, `mon`, `day`, `hour`, `min`, and `sec`. Positional arguments are, in
order: years, months, weeks, days, hours, minutes, seconds.

## Cron Functions

Cron functions are server-only.

```sql
select cron.is_valid('0 0 8 * * MON-FRI');
select cron.next('0 0 8 * * MON-FRI', current_timestamp);
select cron.next_tz('0 0 8 * * MON-FRI', current_timestamp, 'America/New_York');
```

Aliases: `cron_is_valid`, `cron_next`, and `cron_next_tz`. Invalid schedules or
time zones return `null` for `cron.next*` functions.

## Interval Justification

### justify_days / justify_hours / justify_interval

Adjusts interval representation so that 30-day periods are represented as months, 24-hour periods as days, etc.

```sql
select justify_days(interval '35 days');
-- 1 month 5 days

select justify_hours(interval '27 hours');
-- 1 day 3 hours

select justify_interval(interval '1 day 25 hours');
-- 2 days 1 hour
```

## Weekday Constants

Named weekday constants for use with `date.last_weekday` and other date functions:

```sql
select date.monday();    -- 1
select date.tuesday();   -- 2
select date.wednesday(); -- 3
select date.thursday();  -- 4
select date.friday();    -- 5
select date.saturday();  -- 6
select date.sunday();    -- 7

-- Example: the most recent Thursday before today
select date.last_weekday(current_date(), date.thursday());
```

## Common Patterns

### Date Ranges

```sql
-- Last 30 days
select * from orders
where created_at > current_timestamp - interval '30 days';

-- This month
select * from sales
where sale_date >= date_trunc('month', current_date)
  and sale_date < date_trunc('month', current_date) + interval '1 month';

-- Last complete week
select * from events
where event_date >= date_trunc('week', current_date) - interval '1 week'
  and event_date < date_trunc('week', current_date);
```

### Age Calculations

```sql
select name,
       extract(year from age(current_timestamp, birth_date)) as age
from users;
```

### Business Day Calculations

```sql
-- Is weekday
select *
from appointments
where extract(dow from appointment_date) between 1 and 5;
```

### Grouping by Time Periods

```sql
-- By month
select date_trunc('month', order_date) as month,
       count(*) as orders,
       sum(total) as revenue
from orders
group by date_trunc('month', order_date)
order by month;

-- By week
select date_trunc('week', created_at) as week,
       count(*) as signups
from users
group by date_trunc('week', created_at);
```

## Format Specifiers

Common format specifiers for parsing and formatting:

| Specifier | Description | Example |
|-----------|-------------|---------|
| `%Y` | 4-digit year | 2023 |
| `%y` | 2-digit year | 23 |
| `%m` | Month (01-12) | 09 |
| `%B` | Full month name | September |
| `%b` | Abbreviated month | Sep |
| `%d` | Day (01-31) | 17 |
| `%H` | Hour 24h (00-23) | 14 |
| `%I` | Hour 12h (01-12) | 02 |
| `%M` | Minute (00-59) | 30 |
| `%S` | Second (00-59) | 45 |
| `%p` | AM/PM | PM |
| `%z` | Timezone offset | +0000 |
| `%Z` | Timezone name | UTC |
| `%A` | Full weekday | Sunday |
| `%a` | Abbreviated weekday | Sun |

See https://docs.rs/chrono/latest/chrono/format/strftime/index.html for complete list.
