---
title: Sample data configuration
description: Configure how sample data is generated for tables and individual fields.
tags:
  - database
  - sample-data
  - testing
---

# Sample data configuration

Yolm's sample-data generator produces realistic test fixtures from the
database schema. Most fields generate sensible defaults automatically;
when they don't, you can override them per-field or per-table.

## Field-level overrides

`FieldBuilder.sampleData(...)` accepts a `FieldSampleDataConfig`:

```typescript
import { fakerPersonFullName } from "std/yolm_gen_api";

db.table("contacts", (t) => {
  t.string("name", 200).notNull().sampleData({
    generator: () => sql.lit(fakerPersonFullName()),
  });
  t.string("external_ref", 50).sampleData({
    nullProbability: 0.3,
    constraints: {
      pattern: /^[A-Z0-9]/,
    },
  });
});
```

Fields:

- `generator` — custom expression producing the value (overrides the
  default).
- `nullProbability` — probability that nullable fields receive `null`
  (0..1).
- `foreignKeyStrategy` — for FK fields, controls whether to pick an
  existing row, create a new related row, or mix.
- `constraints` — additional constraints (unique, regex pattern, custom
  predicate).

## Table-level overrides

`TableBuilder.sampleData(...)` accepts a `TableSampleDataConfig`:

```typescript
db.table("invoices", (t) => {
  // ...
  t.sampleData({
    baseCount: 250,
    generationPriority: 10,
    generateRecord: (s, ctx) => {
      // Custom whole-record generation, including related rows.
    },
  });
});
```

Fields:

- `baseCount` — how many root rows to generate.
- `generationPriority` — when multiple tables could be the generation
  root, the higher-priority one wins.
- `skipSampleData` — skip generating sample data for this table.
- `generateRecord` — completely take over generation for this table
  (rare; use only when the default flow can't express the requirement).

## Generation context

The `ctx` argument is a `SampleDataScriptContext` for tracking generated
record counts and the current foreign-key context. Faker-style values
come from generation-time helpers such as `std/yolm_gen_api`; see
`packages/std/sample_data.ts` for the context shape.

## Related

- [Testing overview](../testing/overview.md)
- [Field types](./field_types.md)
