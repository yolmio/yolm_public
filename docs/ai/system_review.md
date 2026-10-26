---
title: Deployed System Review Guide
description: Review workflow for deployed Yolm systems — schema and migration
  cost, block reuse, app code, query plans, browser coverage, and Forge evidence.
tags:
  - ai
  - review
  - systems
  - schema
  - maintainability
related:
  - ai/review.md
  - database/best_practices.md
  - sql/query_planning.md
  - procedures/occ.md
  - coding/solution_principles.md
---

# Deployed System Review

This guide layers system-specific rules on the core rubric in
`docs/ai/review.md`. Read that first; this page adds only the delta for
reviewing a deployed system through Forge.

## Before Reviewing

Read, in order:

1. `docs/ai/review.md` — the core rubric and severity weighting.
2. The system summary and relevant source files — business context and the
   actual schema, routes, and integrations.
3. The system's `core.tsx` — schema and block wiring; the shape
   of everything else.

## Schema Review Comes First

These systems are deployed with live data. Schema changes have different deploy
classes, but every unnecessary table or field remains durable debt: additions
consume physical IDs, removals leave orphaned data until a transform, automatic
backfills rewrite data, and incompatible changes require a transform or
database swap. Review schema before touching app code:

- For each new or changed table/field in the system definition, find its
  readers and writers across the app, procedures, APIs, and jobs. Unused or
  write-only fields are major findings.
- Prefer block-provided schema over custom tables. If a table duplicates what
  AuthBlock, CRM, scheduling, or another wired block already manages, flag it.
- Tables managed by blocks are exempt from `recordDisplayName` and similar
  table-level rules — the block owns them.
- Check enum members the same way as fields: unused members are debt.

## Reuse Over Custom Code

- Existing blocks, components, and reusable pages come first; flag custom
  reimplementations of documented primitives
  (`docs/coding/solution_principles.md`).
- System-specific code belongs in the system. If a helper or section is generic,
  flag the duplication and point to the closest documented reusable component
  or block.

## App Code

- App files are large by design; pages should still be mostly composition of
  blocks/components with content. Flag page-local mini-frameworks.
- Data fetching via `Data`; record edits via `Form`; commands via
  `ActionButton` or `ActionMenuItem`. These refetch on success, so flag manual
  `s.refetch()` calls that repeat it.
- Event handlers use SQL event values and the statement builder; no
  React-runtime idioms — Yolm TSX is not React.

## Query Performance

- Any query against a large table: check the engine tier, direct base-column
  pruning predicates, and full caller cardinality per
  `docs/sql/query_planning.md`.
- In Forge, inspect the query plan and request metrics for the affected preview
  workflow; use [Forge query guidance](forge_queries.md) for the measurement
  workflow.
- For PK/`record_id` lookups, review the real route-state shape, not a
  simplified literal — constant predicates can plan differently.
- For bulk actions, include generated statements and per-record procedure calls
  in the measured workload.

## Tests

For concurrent write paths, follow the core review's transaction checklist and
[OCC patterns](../procedures/occ.md). Include competing UI, API, reactor, and
scheduled writers in the workload; a reactor's own concurrency limit does not
serialize those other writers. Report the observed conflict kind and retry
cost separately from suspected source-level causes. Preserve durable job
ownership and all-or-nothing batch semantics when recommending smaller work.

- Behavior changes need verification evidence sized to the change (see [Change
  Size](review.md#change-size-verification-and-review)): a preview look for
  minor app-visible changes, a `previewScript` click-through for larger ones.
  Flag changed flows with no evidence. New tests follow
  [Tests](review.md#tests).

## Verification

A review that recommends or applies changes must name the checks for the
affected scope. Use `validate()` and `runTests()` for system and test
validation, then use `previewScript` and `queryPreview` for app-visible flows
and persisted invariants. Inspect request metrics when the change affects
server-side work.
