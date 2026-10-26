---
title: Forge Spark skill
description: Use before adding or changing Spark capabilities, the data a business agent may read, or the actions it may take.
tags: [ai, forge, skill, spark, capabilities]
related:
  - blocks/spark.md
  - blocks/spark_management_tools.md
  - ai/forge_schema.md
---

# Forge Spark skill

A Spark capability gives a business agent read access and callable tools. Good
capabilities are broad and generic; correctness comes from the schema and from
state checks, not from narrow bespoke tools.

## Reads

Choose the first surface that fits:

1. `tables`: whole tables. The agent sees exact schema and can join freely.
2. `fieldWhitelist`: tables restricted to listed columns.
3. `fieldBlacklist`: tables minus sensitive columns.
4. `views`: only when rows must be scoped (a table grant exposes every row,
   for example per-`current_user` access) or the shape cannot be expressed
   with the tables.
5. `functions`: only for computations a query cannot express.

Put field meaning in schema descriptions; capability `doc` holds business rules
and recipes.

## Writes

- Prefer generally capable, set-based actions (create, update, or delete many
  rows of one kind) over one action per field or workflow step.
- A generic write is appropriate when the agent cannot create an invalid state
  through it: constraints enforce invariants and the action checks that the
  target is editable before writing.
- Use `mode: "reversible"`: the action runs immediately and the user can undo
  it. Use approval mode for external effects (email, payments, third-party
  APIs), released or critical state, or anything transaction undo cannot
  restore. `blockToolset` follows the same rule.
- Reject unknown input fields and validate with
  `throwSparkActionValidationError` so the agent can correct its call.

## Design state for safe edits

Model the domain so agent edits are safe before writing actions. Where mistakes
are costly, split a working copy from released or immutable records: the agent
edits working rows freely and a person releases them. Where mistakes are cheap
(an estimate in progress), let reversible actions edit directly. Either way the
action's first step is an editable-state guard, for example "the revision
exists, is a detailed estimate, and is not verified".

## References

- Capability, action, and function contracts: `docs/blocks/spark.md`
- Block-provided Spark tools: `docs/blocks/spark_management_tools.md`
- Schema rules: `docs/ai/forge_schema.md`
