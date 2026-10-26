---
title: JSON Functions
description: JSON SQL functions for building, extracting, aggregating, expanding, and converting JSON/XML payloads for external interfaces.
tags:
  - sql
  - functions
  - json
  - xml
  - external-interfaces
related:
  - api/external_interfaces.md
---

# JSON Functions

Yolm SQL provides comprehensive JSON support compatible with much of PostgreSQL's SQL function surface.

## Function Reference

| Function | Aliases | Result |
| --- | --- | --- |
| `json_build_object(key, value, ...)` | `json.build_object(...)` | `json` object |
| `json_build_array(value, ...)` | `json.build_array(...)` | `json` array |
| `json.get_field(json, key_or_index)` | `json_extract(json, key_or_index)`, `->` operator | `json` |
| `json.path_query_array(json, path)` | `json_path_query_array(json, path)` | `json` array |
| `json.path_query_first(json, path)` | `json_path_query_first(json, path)` | `json` |
| `json.from_string(text)` | `json_parse(text)`, `text::json` | `json` |
| `json_typeof(json)` | | `string` |
| `json_array_length(json)` | | `int` |
| `json_object_length(json)` | | `int` |
| `xml.to_json(text)` | `xml_to_json(text)` | `json` |
| `json.to_xml(json)` | `json_to_xml(json)` | `string` |

These operations are available only as operators; there is no callable
function name for them:

| Operator | Result |
| --- | --- |
| `->>` (field or index as text) | `string` |
| `#>` / `#>>` (path as JSON / text) | `json` / `string` |
| `@>` / `<@` (contains / contained by) | `bool` |
| `?` / `?\|` / `?&` (key exists / any / all) | `bool` |
| `\|\|` (concatenate) | `json` |
| `-` (delete key or array index) | `json` |
| `#-` (delete path) | `json` |

## External JSON/XML Interfaces

External interfaces often need SQL-level JSON and XML payload handling. Use
these functions with API endpoints, webhooks, and outbound integration jobs to
extract fields from JSON request bodies, build JSON responses, convert XML
payloads with `xml.to_json(...)`, and generate XML with `json.to_xml(...)`.
For endpoint shape and retry patterns, see [External Interfaces](../api/external_interfaces.md).

## JSON Operators

### -> (Get JSON field)

Extracts a JSON object field or array element as JSON.

```sql
select '{"a": 1, "b": 2}'::json -> 'a';
-- 1 (as JSON)

select '{"nested": {"key": "value"}}'::json -> 'nested' -> 'key';
-- "value" (as JSON)

-- Array access (0-indexed)
select '[1, 2, 3]'::json -> 1;
-- 2 (as JSON)
```

### ->> (Get JSON field as text)

Extracts a JSON object field or array element as text.

```sql
select '{"a": 1, "b": "hello"}'::json ->> 'a';
-- 1 (as text)

select '{"name": "John"}'::json ->> 'name';
-- John (no quotes)

-- Array access
select '["a", "b", "c"]'::json ->> 0;
-- a
```

### #> (Get JSON by path)

Extracts JSON at a specified path.

```sql
select '{"a": {"b": {"c": 1}}}'::json #> '{a,b,c}';
-- 1 (as JSON)

select '{"data": [1, 2, 3]}'::json #> '{data,1}';
-- 2 (as JSON)
```

### #>> (Get JSON by path as text)

Extracts JSON at a specified path as text.

```sql
select '{"a": {"b": {"c": "value"}}}'::json #>> '{a,b,c}';
-- value (as text)
```

### @> (Contains)

Tests if left JSON contains right JSON.

```sql
select '{"a": 1, "b": 2}'::json @> '{"a": 1}'::json;
-- true

select '[1, 2, 3]'::json @> '[2]'::json;
-- true
```

### <@ (Contained by)

Tests if left JSON is contained by right JSON.

```sql
select '{"a": 1}'::json <@ '{"a": 1, "b": 2}'::json;
-- true
```

### ? (Key exists)

Tests if a key exists in a JSON object.

```sql
select '{"a": 1, "b": 2}'::json ? 'a';
-- true
```

### ?| (Any key exists)

Tests if any of the given keys exist.

```sql
select '{"a": 1, "b": 2}'::json ?| '{a,c}';
-- true (a exists)

select '{"a": 1, "b": 2}'::json ?| '{c,d}';
-- false (neither exists)
```

### ?& (All keys exist)

Tests if all of the given keys exist.

```sql
select '{"a": 1, "b": 2}'::json ?& '{a,b}';
-- true (both exist)

select '{"a": 1, "b": 2}'::json ?& '{a,c}';
-- false (c doesn't exist)
```

### || (JSON concatenation)

Concatenates two JSON values.

```sql
select '{"a": 1}'::json || '{"b": 2}'::json;
-- {"a": 1, "b": 2}

select '[1, 2]'::json || '[3, 4]'::json;
-- [1, 2, 3, 4]
```

### - (Delete key/index)

Deletes a key from a JSON object or an element by index from a JSON array.

```sql
-- Delete key from object
select '{"a": 1, "b": 2}'::json - 'a';
-- {"b": 2}

-- Delete by index from array
select '[1, 2, 3]'::json - 1;
-- [1, 3]
```

### #- (Delete by path)

Deletes a value at a specified path.

```sql
select '{"a": {"b": 1, "c": 2}}'::json #- '{a,b}';
-- {"a": {"c": 2}}
```

## Building JSON

### json_build_object

Constructs a JSON object from key-value pairs.

```sql
select json_build_object('name', 'John', 'age', 30);
-- {"name":"John","age":30}

select json_build_object(
  'id', user_id,
  'name', user_name,
  'active', true
) from users;

-- With nested objects
select json_build_object(
  'user', json_build_object('id', 1, 'name', 'John'),
  'timestamp', current_timestamp
);
```

### json_build_array

Constructs a JSON array from values.

```sql
select json_build_array('apple', 'banana', 'cherry');
-- ["apple","banana","cherry"]

select json_build_array(1, 'text', true, null);
-- [1,"text",true,null]

-- Nested structures
select json_build_array(
  json_build_object('id', 1),
  json_build_object('id', 2)
);
-- [{"id":1},{"id":2}]
```

## JSON Aggregation

Use JSON aggregates when a query needs to return nested JSON arrays or objects:

```sql
select json_array_agg(
  json_build_object('id', id, 'name', name)
) from db.users;

select json_object_agg(code, name order by code)
from db.countries;
```

For aggregate-specific behavior such as `FILTER`, `DISTINCT`, and aggregate
ordering, see [Aggregate Functions](./aggregate_functions.md).

## JSON Path Queries

### json.path_query_array

Returns all matches as a JSON array.

```sql
select json.path_query_array(
  '{"items": [{"name": "a"}, {"name": "b"}]}'::json,
  '$.items[*].name'
);
-- ["a", "b"]
```

### json.path_query_first

Returns the first match.

```sql
select json.path_query_first(
  '{"items": [1, 2, 3]}'::json,
  '$.items[0]'
);
-- 1
```

## Type Information

### json_typeof

Returns the type of a JSON value.

```sql
select json_typeof('{"a": 1}'::json);    -- object
select json_typeof('[1, 2, 3]'::json);   -- array
select json_typeof('"hello"'::json);      -- string
select json_typeof('123'::json);          -- number
select json_typeof('true'::json);         -- boolean
select json_typeof('null'::json);         -- null
```

### json_array_length

Returns the number of elements in a JSON array.

```sql
select json_array_length('[1, 2, 3]'::json);
-- 3

select json_array_length('[]'::json);
-- 0
```

### json_object_length

Returns the number of keys in a JSON object.

```sql
select json_object_length('{"a": 1, "b": 2}'::json);
-- 2
```

## JSON Parsing and XML Interface Conversion

### json.from_string / ::json

Parse a JSON string.

```sql
select json.from_string('{"key": "value"}');
select '{"key": "value"}'::json;
```

### Conversion to/from XML

```sql
select xml.to_json('<root><item>1</item></root>');
select json.to_xml('{"item": "value"}'::json);
```

`xml_to_json(...)` and `json_to_xml(...)` are accepted aliases. XML attributes
become JSON keys prefixed with `@`, text content becomes `#text`, and repeated
elements become arrays. Prefer `json.to_xml(...)` over string concatenation when
generating XML responses or outbound payloads.

## Table Functions

### json.array_each

Expands a JSON array to rows. Returns `value json, index int`.

Aliases: `json.array_elements`, `json_array_elements`

```sql
select value, index
from json.array_each('[1, "text", {"key": "value"}]'::json);
-- value: 1,              index: 0
-- value: "text",         index: 1
-- value: {"key":"value"}, index: 2

-- Practical usage
select value ->> 'name' as name
from json.array_each('[{"name": "Alice"}, {"name": "Bob"}]'::json);
-- Alice
-- Bob
```

### json.object_each

Expands a JSON object to key-value rows. Returns `key string, value json`.

Aliases: `json.each`, `json_each`

```sql
select key, value
from json.object_each('{"name": "John", "age": 30}'::json);
-- key: name,  value: "John"
-- key: age,   value: 30
```

## Common Patterns

### Extract Nested Values

```sql
select
  data -> 'user' ->> 'name' as user_name,
  data -> 'user' ->> 'email' as user_email
from events
where data -> 'type' = '"login"';
```

### Build API Response

```sql
select json_build_object(
  'success', true,
  'data', json_build_object(
    'users', (select json_array_agg(
      json_build_object('id', id, 'name', name)
    ) from users),
    'total', (select count(*) from users)
  )
);
```

### Conditional JSON Building

```sql
select json_build_object(
  'id', id,
  'name', name,
  'details', case
    when include_details then json_build_object(
      'created_at', created_at,
      'updated_at', updated_at
    )
    else null
  end
) from items;
```

### Filter JSON Array

```sql
-- Using json.array_each
select json_array_agg(value)
from json.array_each(items::json)
where value ->> 'active' = 'true';
```

### Update JSON Field

```sql
-- Build new object with updated field
update users
set preferences = json_build_object(
  'theme', 'dark',
  'notifications', preferences -> 'notifications'
)
where id = 1;
```

### Check if Key Exists

Use the `?` operator to test for a top-level key:

```sql
select *
from events
where data ? 'user_id';
```

`data -> 'user_id' is not null` is also true when the key holds JSON `null`,
because `->` returns the JSON value `null`, not SQL `null`. To require a key
with a non-null value, use `data ->> 'user_id' is not null`.

### Safely Extract with Default

```sql
select coalesce(
  data ->> 'optional_field',
  'default_value'
) as field_value
from records;
```

### Working with JSON Arrays

```sql
-- Count items in array
select json_array_length(items) as item_count
from orders;

-- Get first/last item
select items -> 0 as first_item,
       items -> (json_array_length(items) - 1) as last_item
from orders;

-- Check if array contains value
select *
from orders
where items @> '[{"sku": "ABC123"}]'::json;
```

## Null Handling

```sql
-- JSON null vs SQL NULL
select json_typeof('null'::json);  -- null (JSON null)
select 'null'::json is null;       -- false (it's a JSON value)

-- Extracting missing keys returns SQL NULL
select '{"a": 1}'::json -> 'missing';  -- null (SQL NULL)
select '{"a": 1}'::json ->> 'missing'; -- null (SQL NULL)
```

## Performance Tips

Use `->>` when you need text, and use `->` when chaining or when the result
should stay JSON. Use `@>` containment when you want JSON containment semantics.
