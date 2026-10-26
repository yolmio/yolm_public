---
title: Yolm SQL Overview
description: Overview of the Yolm SQL dialect, including accepted statement types, PostgreSQL-style compatibility, types, functions, and usage contexts.
tags:
  - sql
  - overview
related:
  - sql/ai_decisions.md
---

# Yolm SQL Overview

Yolm SQL is Yolm's SQL dialect. It intentionally accepts much of PostgreSQL's
query syntax and function surface so PostgreSQL users can read and write most
Yolm queries naturally, but compatibility is at the SQL-language level. Schema,
extensions, indexes, and administrative commands are Yolm-specific and are not
PostgreSQL features.

Yolm SQL is used almost everywhere in Yolm:

- In the UI (procedures, state, expressions)
- In table and scalar functions
- In scripts
- In API procedures

## Accepted SQL Surface

Yolm SQL accepts these top-level statement families:

- Queries: `select`, `values`, set operations, subqueries, CTEs, recursive CTEs
- Mutations: `insert`, `update`, `delete`, `restore`, `merge`
- Read clauses: `where`, `group by`, `having`, `order by`, `limit`, `offset`, `top`
- Joins: `inner`, `left`, `right`, `full outer`, `cross`, `lateral`, `natural`, `using`, and Yolm `auto join`
- Aggregates: aggregate `filter`, aggregate `order by`, `count(distinct ...)`
- Grouping: ordinary `group by`, `rollup`, `cube`, and `grouping sets`
- Windows: `over (...)` with `partition by`, `order by`, and `rows` / `range` frames
- Expressions: arithmetic, comparison, boolean logic, casts, `case`, `exists`, `in`, `between`, `like`, `ilike`, JSON operators, and collations

Important unsupported SQL:

- DDL statements such as `create table`, `alter table`, and `drop table`.
  Define schema in TypeScript at generation time.
- SQL array types and `unnest`. Use JSON arrays and `json.array_each(...)`
  when you need array-shaped data.
- XML as a scalar SQL type. Store XML as strings or convert to/from JSON with
  `xml.to_json(...)` and `json.to_xml(...)`.
- `group by all`, `order by all`, `qualify`, `select into`, `for update`,
  `fetch first`, and trailing semicolons inside `sql\`...\`` snippets.
- Window `groups` frames, named windows, and expression frame bounds such as
  `3 preceding`.

## SQL Tagged Templates

Always use tagged templates for SQL:

```typescript
sql`expression`;     // SQL expressions: sql`price * 1.1`
sql`query`;          // SQL queries: sql`select * from db.users`
sql`modification`;   // Modifications: sql`insert into db.todos (title) values ('task')`
sql.lit`literal`;    // String literals: sql.lit`static string`
```

## Important Notes on SQL Generation

- Use Yolm SQL syntax documented in this section, not arbitrary PostgreSQL or
  vendor-specific SQL.
- Do not include a trailing semicolon inside `sql\`...\`` snippets.
- Qualify column names when a query reads from multiple relations with the same
  field names.
- Both PostgreSQL-style syntax, such as `date_trunc('month', created_at)`, and
  Yolm namespaced syntax, such as `date.trunc(month, created_at)`, are accepted.

## Yolm-Specific Extensions

While Yolm SQL supports much of PostgreSQL's SQL surface, it includes some additional features:

### Namespaced Functions

Many functions are available in namespaced form under `date`, `string`, `json`, `crypto`, `regex`, etc.:

```sql
-- Both work:
select date_trunc('month', date_time) from events;  -- PostgreSQL syntax
select date.trunc(month, date_time) from events;    -- Yolm namespaced syntax
```

### AI Decisions

Use `ai_probability`, `ai_choice`, `ai_score`, and `ai_decide` for server-side
probability filters, classification, numeric scoring, and grouped judgments.
They are external model calls, not deterministic rules or client-side SQL.
See [AI Decisions](./ai_decisions.md) for profiles, result fields, procedure
bindings, blob images, and failure handling.

### Auto Join

Yolm provides an `AUTO JOIN` that automatically joins tables based on foreign key relationships:

```sql
-- Auto join - no condition needed, uses foreign key
select book.title, author.name from book auto join author;
```

### Additional Types

Beyond standard PostgreSQL types, Yolm SQL includes:

| Type | Description |
|------|-------------|
| `ordering` | Sortable list positioning values |
| `phone_number` | Parsed phone number with formatting functions |
| `timestamp_naive` | Timestamp without timezone (distinct from `timestamp` which has timezone) |

### Ordering Type

A special `ordering` type for maintaining sortable lists:

```sql
select ordering.new();                    -- Create initial ordering value
select ordering.n_after(1, existing_order);  -- Get value after existing
select ordering.n_before(1, existing_order); -- Get value before existing
```

### Server-Only Functions

Some functions are only available in server-side procedures (scripts, APIs, scheduled jobs), not in client-side UI:

- **Crypto:** `crypto.encrypt`, `crypto.decrypt`
- **OTP:** `digit_otp`, `totp.*`, `hotp.*`
- **QR codes:** `qr.png`, `qr.svg`, `qr.data_url`
- **JWT:** `jwt.sign`, `jwt.verify`, `jwt.decode`, `jwt.get_claims`
- **Network:** `ip_in_cidr`
- **Encoding:** `base32.encode`, `base32.decode`

### Time-Series Functions

For time-series data analysis:

```sql
-- Group timestamps into buckets
select time_bucket(interval '1 hour', created_at) as hour,
       count(*) as events
from events
group by hour;

-- Fill gaps in time series
select time_bucket_gapfill(interval '1 day', ts, start, stop) as day,
       coalesce(count(*), 0) as count
from events
group by day;
```
