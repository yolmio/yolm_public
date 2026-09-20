---
title: Regular Expression Functions
description: Regular expression SQL functions for matching, replacing, splitting, extracting matches, and URI pattern checks.
tags:
  - sql
  - functions
  - regex
---

# Regular Expression Functions

Yolm uses the Rust regex crate for regular expressions. See https://docs.rs/regex/latest/regex/ for syntax details.

## regex.is_match

Checks if a string matches a regular expression pattern.

Aliases and operators: `regexp_match(value, pattern)`,
`regexp_matches(value, pattern)`, `value ~ pattern`, and `value ~* pattern`.
The `~*` form is case-insensitive. Negated forms `!~` and `!~*` are also
accepted.

```sql
select regex.is_match('hello123', '\d+');       -- true
select regex.is_match('hello', '^[a-z]+$');     -- true
select regex.is_match('Hello', '^[a-z]+$');     -- false
```

> **Note:** `regexp_match` and `regexp_matches` are accepted as aliases but return a boolean (unlike PostgreSQL where they return matched substrings).

## regex.replace

Replaces the first occurrence of a pattern.

```sql
select regex.replace('hello, world!', 'o', '0');
-- hell0, world!

select regex.replace('date: 2023-09-18', '\d{4}-\d{2}-\d{2}', 'REDACTED');
-- date: REDACTED
```

## regex.replace_all

Replaces all occurrences of a pattern.

Alias: `regexp_replace()`

```sql
select regex.replace_all('hello, world!', 'o', '0');
-- hell0, w0rld!

select regex.replace_all('a1b2c3', '\d', 'X');
-- aXbXcX
```

## regex.capture / regex.first_match

Extracts a captured match as text.

```sql
select regex.capture('abc-123', '([a-z]+)-([0-9]+)', 1);
-- abc

select regex.capture('abc-123', '([a-z]+)-([0-9]+)', 2);
-- 123

select regex.first_match('order #123', '[0-9]+');
-- 123
```

## uri.is_match

Checks if a string matches a URI pattern template.

```sql
select uri.is_match('/users/123/posts', '/users/{id}/posts');
-- true

select uri.is_match('/api/v2/data', '/api/{version}/{resource}');
-- true
```

## regex.split (Table Function)

Splits a string into rows based on a regular expression.

```sql
select value, ordinal from regex.split('apple:banana;cherry', ':|;');
-- apple, 0
-- banana, 1
-- cherry, 2

select value from regex.split('data1  data2   data3', '\s+');
-- Splits with variable whitespace
```

## regex.matches (Table Function)

Returns all substrings matching a regular expression.

```sql
select value, ordinal from regex.matches('a1 b2 c3', '[a-z]');
-- a, 0
-- b, 1
-- c, 2

select value from regex.matches('Contact: john@example.com', '\S+@\S+\.\S+');
-- john@example.com
```
