---
title: String Functions
description: String SQL functions for length, case conversion, padding, trimming, substring, concatenation, encoding, validation, and splitting.
tags:
  - sql
  - functions
  - strings
---

# String Functions

Yolm SQL provides comprehensive string manipulation functions compatible with much of PostgreSQL's SQL function surface.

## Function Reference

| Function | Aliases | Notes |
| --- | --- | --- |
| `concat(value, ...)` | | 1 or more arguments |
| `concat_ws(separator, value, ...)` | | 2 or more arguments |
| `char_length(value)` | `character_length(value)` | Counts characters |
| `octet_length(value)` | `length(value)`, `len(value)`, `byte_length(value)` | Counts UTF-8 bytes |
| `upper(value)` | `ucase(value)` | |
| `lower(value)` | `lcase(value)` | |
| `titleize(value)` | `initcap(value)`, `string.titleize(value)` | |
| `capitalize(value)` | `string.capitalize(value)` | |
| `contains(value, search)` | | Boolean |
| `starts_with(value, prefix)` | | Boolean |
| `ends_with(value, suffix)` | | Boolean |
| `position(search in value)` | `position(search, value)`, `strpos(value, search)` | 1-indexed, `0` if absent |
| `replace(value, from, to)` | | Replaces all occurrences |
| `left(value, count)` | | |
| `right(value, count)` | | |
| `substring(value from start for count)` | `substring(value, start, count)`, `substr(value, start, count)` | 1-indexed |
| `overlay(value placing replacement from start [for count])` | `overlay(value, replacement, start[, count])` | |
| `trim(...)` | `btrim(value)` | See trimming section |
| `ltrim(value)` | | Whitespace only |
| `rtrim(value)` | | Whitespace only |
| `reverse(value)` | | |
| `repeat(value, count)` | | |
| `lpad(value, length[, fill])` | | Fill defaults to spaces |
| `rpad(value, length[, fill])` | | Fill defaults to spaces |
| `split_part(value, delimiter, field)` | `string.split_part(...)` | Field is 1-indexed |
| `chr(code)` | | Unicode scalar value |
| `ascii(value)` | | Code point of first character |
| `translate(value, from, to)` | | Character mapping |
| `levenshtein(a, b)` | `levenshtein(a, b, insert_cost, delete_cost, substitute_cost)` | |
| `levenshtein_less_equal(a, b, max_distance)` | `levenshtein_less_equal(a, b, insert_cost, delete_cost, substitute_cost, max_distance)` | |
| `damerau_levenshtein(a, b)` | | |
| `string.diff3_merge(original, left, right, left_label, right_label)` | | Text merge helper |
| `string.diff3_analyze(original, left, right)` | | Returns JSON analysis |
| `patch.apply(source, diff)` | | Applies an OpenAI native update patch and returns JSON |
| `patch.create(diff)` | | Applies an OpenAI native create patch and returns JSON |

## String Concatenation

### sql.concat

Concatenate SQL expressions and literals:

```tsx
// In TypeScript
sql.concat("Hello, ", sql`user_name`, "!")
// Produces: concat('Hello, ', user_name, '!')

sql.concat("Total: $", sql`price`)
// Produces: concat('Total: $', price)
```

Use in component attributes:

```tsx
<a href={sql.concat("/users/", sql`user_id`)}>View User</a>
// Generates href="/users/123"
```

### sql.concatTemplate

Template string concatenation for building larger text blocks:

```tsx
const emailBody = sql.concatTemplate`
Hello ${sql`user.first_name`}!

Your order #${sql`order.id`} has been shipped.

Track it here: ${sql.concat("https://example.com/track/", sql`order.tracking_number`)}

Thank you,
The Team
`;

// Use in email procedures
s.defScalar("email_content", emailBody);
```

Real-world example from scheduled jobs:

```tsx
const reminderEmailHtml = (fullName: Sql) =>
  sql.concatTemplate`
Hi ${fullName}!<br><br>

To enter your stats for the week, please <a href="https://example.com">click here</a><br><br>

The stats are due by 9pm on Wednesday night.<br><br>

ML, Stats Officer`;

// Used in procedure
s.forEachTableWithOpts({
  table: "db.members",
  where: sql`status = 'active'`,
  cursorName: "member",
  body: (s) => {
    sendEmail(s, {
      to: sql`member.email`,
      htmlBody: reminderEmailHtml(sql`member.first_name || ' ' || member.last_name`),
    });
  },
});
```

### PostgreSQL concat Function

Standard SQL concatenation (also available):

```sql
select concat('Hello', ' ', 'World');  -- Hello World
select concat('Value: ', 42);          -- Value: 42
select concat_ws(', ', 'a', 'b', 'c'); -- a, b, c (with separator)
```

## Length Functions

### char_length / character_length

Returns the number of characters (not bytes).

```sql
select char_length('Hello, world!');   -- 13
select character_length('こんにちは'); -- 5
```

### octet_length / length / len / byte_length

Returns the number of bytes.

```sql
select octet_length('Hello, world!');  -- 13
select octet_length('こんにちは');      -- 15 (UTF-8 bytes)
select length('こんにちは');            -- 15
```

## Case Conversion

### upper / lower

```sql
select upper('Hello, World!'); -- HELLO, WORLD!
select lower('HELLO, WORLD!'); -- hello, world!
```

### initcap (PostgreSQL) / string.titleize (Yolm)

Converts to title case (first letter of each word capitalized).

```sql
select initcap('hello world');        -- Hello World
select string.titleize('hello world'); -- Hello World
```

### string.capitalize

Capitalizes first letter only, lowercases rest.

```sql
select string.capitalize('hello WORLD'); -- Hello world
```

## String Manipulation

### substring

Extracts a substring. 1-indexed.

```sql
-- PostgreSQL syntax
select substring('Hello, world!' from 8 for 5);  -- world
select substring('Hello' from 2);                -- ello (to end)

-- Function syntax
select substring('Hello, world!', 8, 5);         -- world
select substr('Hello, world!', 8, 5);            -- world
```

### left / right

Returns leftmost/rightmost N characters.

```sql
select left('Hello, world!', 5);   -- Hello
select right('Hello, world!', 6);  -- world!
```

### overlay

Replaces a substring.

```sql
select overlay('Hello world' placing 'beautiful ' from 7 for 0);
-- Hello beautiful world

select overlay('Txxxxas' placing 'ex' from 2 for 4);
-- Texas
```

### replace

Replaces all occurrences of a substring.

```sql
select replace('Hello, world!', 'world', 'universe');
-- Hello, universe!

select replace('aaa', 'a', 'b');  -- bbb
```

### translate

Maps characters one-to-one.

```sql
select translate('Hello', 'elo', '310');  -- H3110
select translate('12345', '12345', 'abcde'); -- abcde
```

### reverse

```sql
select reverse('Hello, world!'); -- !dlrow ,olleH
```

### repeat

Repeats a string N times.

```sql
select repeat('abc', 3);  -- abcabcabc
select repeat('x', 5);    -- xxxxx
```

## Padding Functions

### lpad / rpad

Pads a string to specified length.

```sql
select lpad('123', 5, '0');    -- 00123
select rpad('123', 5, '0');    -- 12300
select lpad('123', 5);         -- '  123' (spaces by default)
select lpad('12345678', 5);    -- 12345 (truncates if longer)
```

## Trimming Functions

### trim

Removes leading/trailing whitespace or specified characters.

```sql
select trim('   Hello   ');                      -- 'Hello'
select trim(both ' ' from '   Hello   ');        -- 'Hello'
select trim(leading 'x' from 'xxxHelloxxx');     -- 'Helloxxx'
select trim(trailing 'x' from 'xxxHelloxxx');    -- 'xxxHello'
select trim(both 'xy' from 'xyxHelloxyxy');      -- 'Hello'
```

### ltrim / rtrim

```sql
select ltrim('   Hello   ');      -- 'Hello   '
select rtrim('   Hello   ');      -- '   Hello'

-- ltrim/rtrim take no second argument; to strip specific characters
-- from one side, use trim(leading ...) / trim(trailing ...):
select trim(leading 'x' from 'xxxHello');    -- 'Hello'
select trim(trailing 'y' from 'Helloyyy');   -- 'Hello'
```

## Position and Search

### position

Finds position of substring (1-indexed). Returns 0 if not found.

```sql
select position('world' in 'Hello, world!');  -- 8
select position('xyz' in 'Hello, world!');    -- 0
```

### contains

Checks if string contains another string.

```sql
select contains('Hello, world!', 'world');    -- true
select contains('Hello, world!', 'universe'); -- false
```

### starts_with

Checks if string starts with a prefix.

```sql
select starts_with('Hello, world!', 'Hello');  -- true
select starts_with('Hello, world!', 'world');  -- false
```

### ends_with

Checks if string ends with a suffix.

```sql
select ends_with('Hello, world!', 'world!');  -- true
select ends_with('Hello, world!', 'Hello');   -- false
```

### split_part

Splits string and returns Nth part (1-indexed).

```sql
select split_part('a,b,c', ',', 2);        -- b
select split_part('a.b.c.d', '.', 3);      -- c
select split_part('hello', ',', 1);        -- hello (no delimiter)
```

## Concatenation

### || operator

```sql
select 'Hello' || ' ' || 'world!';  -- Hello world!
select 'Value: ' || 42;             -- Value: 42
```

### concat

Concatenates arguments. `NULL` arguments make the result `NULL`; use
`coalesce(...)` or `concat_ws(...)` when nullable values should be skipped.

```sql
select concat('Hello', ', ', 'world!');  -- Hello, world!
select concat('a', null, 'b');           -- NULL
```

### concat_ws

Concatenates with separator, ignoring NULLs.

```sql
select concat_ws(', ', 'apple', 'banana', 'cherry');
-- apple, banana, cherry

select concat_ws('-', 'a', null, 'b', 'c');
-- a-b-c
```

## Pattern Matching

### LIKE / ILIKE

Pattern matching with wildcards (`%` = any characters, `_` = single character).

```sql
select 'apple' like 'a%';      -- true
select 'apple' like '%pp%';    -- true
select 'apple' like '_pple';   -- true
-- Case sensitivity follows the system's default collation, which is
-- NoCase (case-insensitive) unless configured otherwise:
select 'apple' like 'A%';                  -- true  (NoCase default)
select 'apple' like 'A%' collate binary;   -- false (case-sensitive)
select 'apple' ilike 'A%';                 -- true  (always case-insensitive)
```

### ESCAPE clause

```sql
select 'a%b' like 'a\%b' escape '\';  -- true (matches literal %)
```

## Collation

Specifies comparison rules.

```sql
select 'a' = 'A';                    -- depends on default collation (NoCase by default -> true)
select 'a' = 'A' collate binary;     -- false (case-sensitive)
select 'a' = 'A' collate nocase;     -- true

-- Available collations: binary, nocase
select * from users order by name collate nocase;
```

## Character Functions

### ascii

Returns ASCII code of first character.

```sql
select ascii('A');   -- 65
select ascii('abc'); -- 97
```

### chr

Returns character for ASCII code.

```sql
select chr(65);   -- A
select chr(97);   -- a
```

## Encoding/Decoding

### URL Encoding

```sql
select uri.encode_component('hello world!');
-- hello%20world%21
```

### HTML Encoding

```sql
select string.html_escape('<script>alert("XSS")</script>');
-- &lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;

select string.html_unescape('&lt;div&gt;');
-- <div>
```

### XML Encoding

```sql
select string.xml_escape('<tag attr="value">');
-- &lt;tag attr=&quot;value&quot;&gt;
```

### UTF-8 Encoding

```sql
-- String to bytes
select string.to_utf8('Hello');
-- bytes representation

-- Bytes to string
select string.from_utf8(bytes.from_hex('48656c6c6f'));
-- Hello
```

### Hex Encoding

```sql
-- Yolm syntax (bytes.* namespace)
select bytes.to_hex(string.to_utf8('Hello'));
-- 48656c6c6f
select string.from_utf8(bytes.from_hex('48656c6c6f'));
-- Hello

-- Also available as encode/decode namespace:
select encode.hex(string.to_utf8('Hello'));
select decode.hex('48656c6c6f');
```

### Base64 Encoding

```sql
-- Yolm syntax (bytes.* namespace)
select bytes.to_base64(string.to_utf8('Hello'));
-- SGVsbG8=
select string.from_utf8(bytes.from_base64('SGVsbG8='));
-- Hello

-- Also available as encode/decode namespace:
select encode.base64(string.to_utf8('Hello'));
select decode.base64('SGVsbG8=');

-- URL-safe base64
select bytes.to_base64_url_safe(string.to_utf8('Hello'));
select bytes.from_base64_url_safe('SGVsbG8');
-- Also available as:
select encode.base64_url_safe(string.to_utf8('Hello'));
select decode.base64_url_safe('SGVsbG8');
```

## Validation Functions

### is_valid_email

```sql
select is_valid_email('user@example.com');  -- true
select is_valid_email('invalid-email');     -- false
```

## Advanced Functions

### string.diff3_merge

Three-way merge for conflict resolution. Takes a base text and two modified versions, plus labels for each version used in conflict markers.

```sql
select string.diff3_merge(base, version1, version2, 'v1_label', 'v2_label');
```

### string.diff3_analyze

Analyzes differences between a base text and two modified versions. Returns a JSON description of the differences.

```sql
select string.diff3_analyze(base, version1, version2);
```

### patch.apply

Applies one OpenAI native `apply_patch` update diff to a source string.
Matching is bounded and deterministic: exact context first, then
trailing-whitespace-insensitive context, then fully trimmed context. The
function is atomic and returns a tagged JSON result instead of throwing for an
invalid or non-matching patch.

```sql
select patch.apply(
  'export const value = 1;',
  '@@' || chr(10) ||
  '-export const value = 1;' || chr(10) ||
  '+export const value = 2;'
);
```

Success includes `status: "applied"`, the resulting `content`, `match`, `fuzz`,
and `hunksApplied`. Failure includes `status: "failed"`, a stable `code`, a
human-readable `message`, and, when applicable, `hunkIndex`. SQL null inputs
return null.

### patch.create

Applies the OpenAI native `create_file` form. Every non-empty diff line must
start with `+`. Create and update are separate functions so an addition-only
update cannot replace an existing source file.

```sql
select patch.create('+first line' || chr(10) || '+second line');
```

## Common Patterns

### Safe Truncation

```sql
select case
  when length(title) > 50
  then left(title, 47) || '...'
  else title
end as truncated_title
from articles;
```

### Full Name Construction

```sql
select concat_ws(' ', first_name, middle_name, last_name) as full_name
from users;
```

### Search with Case Insensitivity

```sql
select * from products
where lower(name) like lower('%search term%');

-- Or using ILIKE
select * from products
where name ilike '%search term%';
```

### Extracting Domain from Email

```sql
select split_part(email, '@', 2) as domain
from users;
```

### Cleaning User Input

```sql
select trim(lower(email)) as normalized_email
from user_input;
```
