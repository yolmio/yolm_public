---
title: AI Code Review Guidelines
description: Core code review rubric for Yolm code — maintainability weighting,
  schema change cost, cleanliness, correctness, consistency, query performance,
  severity levels, and fix mode.
tags:
  - ai
  - review
  - quality
  - maintainability
  - schema
related:
  - ai/system_review.md
  - coding/index.md
  - coding/solution_principles.md
  - database/best_practices.md
  - sql/query_planning.md
---

# AI Code Review

This is the core rubric for reviewing Yolm code. Target-specific guides layer
on top of it:

- Deployed systems: `docs/ai/system_review.md`

## Review Mandate

A review's job is to find problems, not to be polite about them. During a
review, the usual "leave pre-existing code alone" rule is lifted for
**reporting**: dead code, unused fields, and unnecessary complexity inside the
reviewed scope must be flagged even if the change under review did not
introduce them.

The reviewed scope is every file the diff touches (whole files, not just the
changed lines) or, for a whole-artifact review, the named artifact/system.

Reviews are **report-only by default**. Apply fixes only when explicitly asked
(fix mode, below).

## Severity and Maintainability Weighting

Rank findings by cost-to-change-later, not by how visible they are:

1. **Database schema** — highest. Deployed schema choices consume durable
   physical IDs; removing tables or fields retains orphaned physical data;
   automatic backfills rewrite data; and incompatible changes require a
   transform or database swap. A questionable table or field is a **major**
   finding even when it works.
2. **Procedures, APIs, reactors** — medium. Callers and stored behavior
   depend on them.
3. **UI** — lowest. UI changes deploy freely with no data migration.

Severity levels: **blocker** (incorrect behavior, data loss, broken check),
**major** (schema debt, wrong primitive, real performance problem),
**minor** (dead code, duplication, convention violation), **nit** (style).

## Cleanliness and Simplicity

- No dead code: unused imports, exports, scalars, UI state, props, enums,
  fields, or commented-out code. Flag it wherever it appears in scope.
- No speculative configurability. Props, options, and abstractions must have a
  real caller today ("build for the case in front of you").
- No duplicated logic or queries when an existing block, component, or helper
  already covers it.
- No leftover debug output or temporary scaffolding.

## Correctness

- Verify all imports are present and correct:
  - Every component, type, and function used must have a corresponding import.
  - No wildcard imports (e.g. `pages/*`); they are not supported.
  - Use `import type` for type-only imports.
  - Each import must come from the correct package, e.g.
    `import { Data } from "std/data";`.
- Generation time vs runtime: no JS-only constructs in runtime logic; runtime
  data lives in scalars, records, and tables accessed through SQL.
- State scopes: persistent data in `db.*`, transient UI state in `ui.*`,
  procedure-local state in procedure scope. Cross-scope access must be
  intentional.
- SQL only via tagged templates (`sql`, `sql.lit`, `sql.ref`); never string
  concatenation.
- Multi-step writes wrapped in transactions where partial progress on error
  would corrupt state.
- Every component receives its required props.

## Consistency

- Follow `docs/coding/index.md` conventions and `docs/coding/imports.md`.
- Prefer documented primitives (`Data`, `Form`, blocks, existing components)
  over ad-hoc reimplementations; see `docs/coding/solution_principles.md`.
- Verify blocks:
  - Import table blocks from `'table_blocks/NAME'` and blocks from
    `"blocks/NAME"`.
  - Single import per block; use block UI only through the block namespace,
    e.g. `<SchedulingBlock.AppointmentsPage />`.
  - Only import a dependent block when it is accessed directly.

## Database and Schema Review

Schema findings carry the highest maintainability cost — review them hardest.

- Every table and field must earn its place. Ask what reads it and what writes
  it; if either answer is "nothing", flag it as major.
- Do not add generic audit fields speculatively. Fields such as `created_by`,
  `created_on`, `modified_by`, or `modified_on` are appropriate when the
  product or block actually reads and writes that provenance; review their
  concrete owner and lifecycle instead of banning them categorically.
- Add `recordDisplayName()` to a table when it is used in a dropdown, link, or
  foreign key reference — unless the table is managed by a block (CrmB2bBlock,
  AuthBlock, ...) or already has a `name`, `first_name`+`last_name`, or
  `title` field. Never include `id` in `recordDisplayName`.
- String fields define `maxLength`; field types and foreign keys follow
  `docs/database/best_practices.md` and its sibling docs.

## Query Performance

For any query touching a large table, read `docs/sql/query_planning.md` and
verify the engine tier, direct base-column pruning predicates, and full caller
cardinality. Review for set-based work, narrow projections, early filters, and
shared computation. For hot or bulk paths, use the real query shape and
plan/metrics evidence at realistic cardinality.

## Reactors and Background Integrations

When the reviewed scope includes a reactor, scheduled procedure, webhook
worker, reconciliation flow, or background external integration, inspect
request cardinality, memory and CPU bounds, durable progress, retry behavior,
and the available Forge execution evidence as correctness requirements.

## UI Checks

- When using `DataTablePage`, pass toolbar content directly via the `toolbar`
  prop (no wrapper component) and use `deletable` for bulk delete.
- Pages should be mostly composition; keep UI state minimal and derived where
  possible.

## Review Output

Report findings ranked by severity. Each finding: severity, `file:line`,
category (schema, correctness, cleanliness, consistency, performance, ui,
tests), a one-sentence statement of the problem, why it matters, and the
suggested fix.

Keep the signal high: report what a maintainer should act on, don't pad with
nits, and say plainly when nothing survives scrutiny.

## Fix Mode

When fixes are explicitly requested:

- Report all findings first, then apply fixes in severity order.
- Before applying a deployed schema fix, report its actual compatibility class
  and consequences (`Compatible`, `CompatibleByOrphaning`,
  `AutomaticBackfill`, `Transform`, or `DatabaseSwap`) and get confirmation.
  If it requires a transform, describe the historical-data mapping.
- Re-run verification for the affected scope with Forge validation, relevant
  automated tests, and the preview workflow.
