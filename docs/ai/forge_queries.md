---
title: Forge query skill
description: Use before writing nontrivial queries or reports, or diagnosing query performance on Yolm's HTAP columnar engine.
tags: [ai, forge, skill, sql, performance]
related:
  - sql/query_planning.md
  - sql/date_functions.md
  - sql/sql_tagged_templates.md
  - testing/overview.md
  - sql/ai_decisions.md
---

# Forge query skill

For model-based classification, probability predicates, or rubric scoring, read
[AI Decisions](../sql/ai_decisions.md). These SQL expressions make external
calls: bound eligible rows and reuse a computed result rather than repeating
inference in projections and filters. Use deterministic SQL for known rules.

Yolm uses a vectorized columnar HTAP engine with fixed physical storage and
fast scans. Evaluate both execution tier and pruning.

Write SQL with tagged templates. Project needed columns, bound interactive
results, filter early, and reduce rows before wide joins or formatting. Keep
filtered or joined large-table columns direct so zone maps, bloom filters, and
runtime pruning can use them; normalize the scalar or small side when semantics
allow. Consolidate repeated probes into one query or shared materialization.

Build per-period series (weekly charts) with `time_bucket_gapfill`, not a
date-range join to a period list: see `docs/sql/date_functions.md#per-period-series`.

The performance bar, when a query change needs a plan and timing, and how to
measure are in [Performance](review.md#performance). Follow the bounded-work
rules in `docs/sql/query_planning.md`.

Capture plans and metrics before and after with the same data, statistics, and
binary. For production interactions, use real route/UI state and parameters on
a production snapshot; demo data and literal-ID queries are diagnostic only.
Measure the whole action, including repeated calls: CPU separately from wall
time/waits, query setup, scratch memory, hash-build rows, and blocks/reads.
Load `docs/ai/forge_preview.md` for `queryDatabase` diagnostics.

Assert unchanged results and effects: NULLs, duplicates, ordering, eligibility,
ownership, and required writes, including repeated submissions. Faster code
that skips required checks or writes is not a valid optimization. Report what
was measured and any production behavior that remains unverified.

Read `docs/sql/query_planning.md` before authoring or reviewing nontrivial SQL and
`docs/sql/sql_tagged_templates.md` before constructing dynamic SQL.
