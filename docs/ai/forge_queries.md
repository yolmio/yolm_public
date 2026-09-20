---
title: Forge query skill
description: Authoring, explaining, measuring, and testing SQL for Yolm's HTAP vectorized columnar query engine.
tags: [ai, forge, sql, performance, htap]
related:
  - sql/query_planning.md
  - sql/sql_tagged_templates.md
  - testing/overview.md
---

# Forge query skill

Yolm uses a vectorized columnar HTAP engine with fixed physical storage and
fast scans. Evaluate both execution tier and pruning.

Write SQL with tagged templates. Project needed columns, bound interactive
results, filter early, and reduce rows before wide joins or formatting. Keep
filtered or joined large-table columns direct so zone maps, bloom filters, and
runtime pruning can use them; normalize the scalar or small side when semantics
allow. Consolidate repeated probes into one query or shared materialization.

Changes to joins, `OR` eligibility predicates, per-row reads, or workflow checks
require performance validation, even when the task is a feature or correctness
fix. Follow the bounded-work rules in `docs/sql/query_planning.md`.

Capture plans and metrics before and after with the same data, statistics, and
binary. For production interactions, use real route/UI state and parameters on
a disposable full-backup clone; demo data and literal-ID queries are diagnostic
only. Measure the whole action, including repeated calls: CPU separately from
wall time/waits, query setup, scratch memory, hash-build rows, and blocks/reads.
Check the requested budget and retain a regression gate for the hot interaction.
Load `docs/ai/forge_preview.md` for `queryDatabase` diagnostics.

Assert unchanged results and effects: NULLs, duplicates, ordering, eligibility,
ownership, and required writes, including repeated submissions. Faster code
that skips required checks or writes is not a valid optimization. Report what
was measured and any production behavior that remains unverified.

Read `docs/sql/query_planning.md` before authoring or reviewing nontrivial SQL and
`docs/sql/sql_tagged_templates.md` before constructing dynamic SQL.
