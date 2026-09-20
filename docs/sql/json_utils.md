---
title: JSON Utilities
description: SQL helper for normalizing JSON values into arrays.
tags:
  - sql
  - json
  - utilities
---

# JSON Utilities

`std/json_utils` ships one SQL fragment helper, `jsonNodeArray`, for
normalizing JSON shapes. SQL on its own already covers most JSON
cases (`json_build_array`, `json.array_each`, `json.object_each`, `->`, `->>`); this helper
exists to smooth over the "single object or array" mismatch upstream
APIs often produce.

## `jsonNodeArray(node)`

Coerces a JSON-typed expression into a JSON array.

| Input | Output |
| --- | --- |
| Already an array | unchanged |
| Single non-null value | `[value]` |
| `null` | `[]` |

Useful when an upstream API returns either a single object or a list
("RFC8259 array-or-singleton") and the consuming SQL wants to iterate
uniformly.

```typescript
import { jsonNodeArray } from "std/json_utils";
import { sql } from "std/sql_utils";

// Some webhook payloads wrap "items" as a single object when there's
// only one — normalize before iterating.
sql`select value
    from json.array_each(${jsonNodeArray(sql`payload->'items'`)})`;
```

## See also

- [JSON Functions](./json_functions.md) — `json_build_*`, `json.array_each`,
  `json_typeof`, `->`, `->>`.
- [SQL Tagged Templates](./sql_tagged_templates.md) — composing
  fragments safely.
