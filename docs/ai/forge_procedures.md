---
title: Forge procedures skill
description: Yolm runtime business logic using stored procedures, generation-time helpers, transactions, state scopes, and set-based SQL.
tags: [ai, forge, procedures, stored-procedures, transactions]
related:
  - procedures/overview.md
  - procedures/patterns.md
  - procedures/statements_reference.md
  - concepts/stored_procedures.md
  - database/scalar_functions.md
---

# Forge procedures skill

TypeScript helpers run at generation time and emit Yolm statements. Runtime
executes those statements with state in procedure scalars, records, and tables;
persistent and transient state belong in `db.*` and `ui.*`.

Choose reuse by execution model:

- Put state-changing behavior shared by UI, APIs, scheduled jobs, or reactors in
  a stored procedure.
- Use a TypeScript helper for repeated generation-time statement construction.
- Use a view, scalar function, or shared query helper for reusable read logic,
  according to its result shape.
- Keep small single-caller behavior local, but proactively split substantial
  behavior into focused stored procedures even when it has only one caller.

Keep both inline and stored procedure bodies small and cohesive. Use a thin
caller to coordinate focused stored procedures with explicit inputs and outputs;
do not move a massive inline body into one equally massive stored procedure.
Splitting generation-time TypeScript helpers does not create runtime procedure
boundaries: call stored procedures instead of repeatedly expanding large bodies.

When compilation reports that a procedure is too large, takes too long, or times
out, the standard remedy is **more modular stored procedures**. Extract cohesive
stages and repeated substantial work, then revalidate compilation and behavior.
Preserve transaction boundaries, operation ordering, and failure behavior; keep
bulk work set-based within each module. Do not start by increasing compilation
limits or timeouts. See [Stored procedures](../concepts/stored_procedures.md).

Prefer set-based SQL over record loops. Wrap writes in a transaction whenever
partial progress would be invalid, and keep requests or waits outside the
transaction. Define explicit inputs and outputs and make failure behavior useful
to every caller. A TypeScript loop around statement-builder methods emits one
runtime unit per iteration; account for the cardinality of every bulk caller.
For nontrivial reads, also load `docs/ai/forge_queries.md`. Read
`docs/procedures/overview.md`,
`docs/procedures/statements_reference.md`, and the relevant patterns before
implementing.
