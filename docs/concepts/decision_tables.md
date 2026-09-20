---
title: Decision tables
description: Define rules-based scalar functions and decision tables shared across the system.
tags:
  - concepts
  - decision-tables
  - rules
  - functions
---

# Decision tables

Yolm supports two related primitives for expressing rule-driven logic
declaratively:

1. **Rules functions** (`system.rulesFunction`) — scalar functions whose
   body is a decision table. The runtime evaluates rows top-to-bottom and
   returns the output for the first matching row.
2. **Decision tables** (`system.addDecisionTable`) — externally-edited
   decision tables stored under `decision_tables/`. They are surfaced to
   tooling so non-developers can edit them.

## Rules functions

A rules function is a scalar function with a tabular body:

```typescript
system.rulesFunction({
  name: "shipping_cost",
  parameters: [
    { name: "weight_kg", type: "Real" },
    { name: "region", type: { type: "Enum", enum: "shipping_region" } },
  ],
  returnType: "Double",
  rules: [
    [sql`input.weight_kg`, sql`input.region`, sql`output`],
    [sql`weight_kg <= 1`, sql`'us'`, sql.lit(4.99)],
    [sql`weight_kg <= 5`, sql`'us'`, sql.lit(9.99)],
    [sql.anyColumnValue, sql.anyColumnValue, sql.lit(19.99)],
  ],
});
```

The first row is the **header**: each cell either references an input
parameter or names the output column. Subsequent rows pair conditions
with an output expression. `sql.anyColumnValue` matches any value (use it
for default rows).

Rules functions compose with `system.scalarFunction` and can be called
from any SQL context.

## Boolean rules on enums

For per-enum-value boolean classifications (e.g. "is this status
final?"), use the `withBoolRulesFn` shorthand on an enum:

```typescript
system.enum_({
  name: "order_status",
  values: ["pending", "paid", "shipped", "delivered", "cancelled"],
  withBoolRulesFn: [
    { name: "is_final", trues: ["delivered", "cancelled"] },
  ],
});
```

This generates a scalar function `is_final(value)` that returns true for
`delivered` and `cancelled`, false otherwise.

`withRulesFn` is the non-boolean equivalent — it maps each enum value to
an output value of any type. See [Enum functions](./enum_functions.md).

## External decision tables

`system.addDecisionTable({ name, path })` registers a decision table
stored at `path`. The Yolm tooling exposes these to non-developer
editors. The registered `path` is relative to the system's
`decision_tables/` directory.

## Related

- [Scalar functions](../database/scalar_functions.md)
- [Enums](./enums.md)
- [Enum functions](./enum_functions.md)
