---
title: Forge procedures skill
description: Use before writing business logic, mutations, workflows, reactors, or scheduled jobs with procedures, transactions, and set-based SQL.
tags: [ai, forge, skill, procedures, transactions]
related:
  - procedures/overview.md
  - procedures/patterns.md
  - procedures/occ.md
  - procedures/statements_reference.md
  - concepts/stored_procedures.md
  - database/scalar_functions.md
  - sql/ai_decisions.md
---

# Forge procedures skill

For probabilistic routing, scoring, or classification, use
[AI decision expressions](../sql/ai_decisions.md) in ordinary server procedure
bindings. Bind the result once and keep provider calls outside write transactions.

TypeScript helpers run at generation time and emit Yolm statements. Runtime
executes those statements with state in procedure scalars, records, and tables;
persistent and transient state belong in `db.*` and `ui.*`.

Put server logic in stored procedures by default. They compile separately and
in parallel instead of re-expanding inline at every use, they can be tested
directly, and reuse is explicit. Anything reused, or likely to be, belongs in
one; only a one-off step of small glue stays inline.

Choose reuse by execution model:

- Put state-changing behavior shared by UI, APIs, scheduled jobs, or reactors in
  a stored procedure.
- Use a TypeScript helper for generation-time statement construction, not as a
  substitute for sharing substantial runtime bodies: each invocation emits its
  statements again.
- Use a view, scalar function, or shared query helper for reusable read logic,
  according to its result shape.
- Keep only one-off small glue local; split substantial behavior into focused
  stored procedures even when it has only one caller.

Keep both inline and stored procedure bodies small and cohesive. Use a thin
caller to coordinate focused stored procedures with explicit inputs and outputs;
do not move a massive inline body into one equally massive stored procedure.
Splitting generation-time TypeScript helpers does not create runtime procedure
boundaries: call stored procedures instead of repeatedly expanding large bodies.

## Own The Generated-Code Cost

Before adding or modifying server logic in a reusable
component, form hook, enum/menu option, or generated handler, trace how many
times its body is emitted, including nested helper expansion and reuse across
routes. One TypeScript function or component can produce many separately
compiled server procedures. Distinguish generation-time copies from repeated
runtime execution; a runtime row loop does not necessarily create a compiled
copy per row.

Your change must not add substantial duplicated generated logic. Put cohesive
database-only work in shared stored procedures with explicit inputs and
outputs; a TypeScript helper extraction does not share compiled code. Keep
small glue local and do not extract trivial statements. Report pre-existing
duplication for an explicit cleanup task rather than refactoring it inside
other work.

Keep UI state handling and route-specific callbacks in the caller. Preserve
transaction ownership (use `transaction: "caller"` for work within the existing
caller transaction), statement and callback order, validation, rollback, results,
and side effects. Sharing compiled code must not change which checks run or
turn set-based work into per-row procedure calls.

For example, an enum control reused across routes can emit the same form-submit
hook into many option handlers. Adding one TypeScript validation helper then
copies all of its queries and writes into those handlers. Keep the handlers thin
and call one shared save-hook procedure; do not remove the validation.

Before declaring completion:

- Explain what is emitted repeatedly, what is now shared, and any remaining
  substantial duplication or blocker. Inspect generated output or compile
  profiles when source-level multiplicity is unclear; do not invent copy counts.
- When compile limits are at risk, run the applicable compilation-budget gate
  on the exact source/compiler pair, with its prescribed worker count and cache
  settings and without competing CPU load. Successful untimed compilation is
  not a budget pass. If the gate is unavailable, report that gap.
- Verify behavior across the stored-procedure boundary, including rejected
  validation and caller rollback, and click through affected UI flows. New
  tests follow [Tests](review.md#tests).

## Compilation Failures And Runtime Work

When compilation reports that a procedure is too large, takes too long, or times
out, the standard remedy is **more modular stored procedures**. Extract cohesive
stages and repeated substantial work, then revalidate compilation and behavior.
Preserve transaction boundaries, operation ordering, and failure behavior; keep
bulk work set-based within each module. Do not start by increasing compilation
limits or timeouts. See [Stored procedures](../concepts/stored_procedures.md).

Prefer set-based SQL over record loops. Wrap writes in a transaction whenever
partial progress would be invalid, and keep requests or waits outside the
transaction. Define explicit inputs and outputs and make failure behavior useful
to every caller. Follow [OCC and transaction patterns](../procedures/occ.md) for
replay boundaries, atomic revalidation, bounded work, and generated-ID handling.
A TypeScript loop around statement-builder methods emits one
runtime unit per iteration; account for the cardinality of every bulk caller.
For nontrivial reads, also load `docs/ai/forge_queries.md`. Read
`docs/procedures/overview.md`,
`docs/procedures/statements_reference.md`, and the relevant patterns before
implementing.
