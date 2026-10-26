---
title: Yolm SQL Query Authoring Notes
description: Slow query diagnosis for Yolm's columnar engine, engine tiers,
  non-equi join CorrelatedJoin pitfall, time_bucket_gapfill period series,
  plan metrics.
tags:
  - sql
  - performance
  - query-planning
  - slow-query
  - htap
---

# Yolm SQL Query Authoring Notes

This page is guidance for SQL authors. Yolm uses columnar storage with zone
maps, bloom filters, and runtime pruning rather than B-tree indexes. It
describes query shapes that are easy to understand and maintain; it is not a
description of Yolm internals.

## Performance Model: What "Slow" Means in Yolm

Yolm is an HTAP engine with vectorized columnar scans. Calibrate expectations
to that, not to a row-store:

- A single narrow full-table scan can be fast on the streaming engine. Multiply
  its cost by per-field, per-record, and bulk invocation counts.
- Yolm has no user-declared sort keys, clustering keys, or secondary indexes.
  Inspect the engine tier, table-side pruning predicates, and invocation count.
- Full pages typically render in 15-50 ms; a page or query over ~100 ms is a
  finding to explain. Exceptions are heavy analytics, such as aggregating
  100M+ rows or joining tens of millions of rows with complex aggregates,
  judged case by case. See [Performance](../ai/review.md#performance).

> **Rule:** Do not add summary or pre-aggregated tables, stored totals or
> statuses, or indexes to make a query faster. Fix the query shape instead:
> pruning predicates, join shape, projection, and invocation count. Derive
> totals, statuses, and rollups with queries, virtual fields, or views. Storing
> a derived value for performance requires measured `yolm query --explain`
> evidence that query-shape fixes are insufficient, and the user's approval
> as a schema change.
- `blocks_considered` far above `blocks_used` is normal when data is not
  physically correlated with the filter column. `blocks_used` remaining high
  because the filter hides a base column behind a function is different and
  can become critical when the query repeats.

Multi-second CPU can come from an execution-mode fallback, low pruning, or
repeated scans.

## Diagnosing Slow Queries: Tier, Pruning, and Multiplicity

Plan output reports which engine tier and execution strategy the query runs
on. Start there, then evaluate pruning and multiplicity for streaming plans:

- **Fast path**: `MorselStreaming` / `MorselStreamingSerialTail` with
  strategies like `MorselSharedBuildJoin` and in-scan `GroupedAggregate`.
  Streaming avoids eager materialization of the whole query, but hash builds
  can still be large. Check build rows and scratch memory before calling it fast.
- **Fallback**: `VectorizedEager` (or `ScalarEager`) with `EagerResident`
  strategy. The engine materializes all intermediate rows in memory before
  later operators run. On a large scan this is the classic cause of
  multi-second CPU times — e.g. materializing millions of rows and a gigabyte
  of columns to produce a few hundred aggregate rows.

Diagnosis method:

1. Get the plan and metrics for the real query (real parameters, real route
   state — not simplified literals).
2. Note the engine tier, execution strategy, and the work metrics
   (`work rows`, `cpu`, `bytes`, `blocks`).
3. For each large-table scan, identify the direct base-column predicates and
   compare `blocks_considered`, `blocks_used`, and storage reads.
4. Record the total query invocation count for the user action.
5. If the tier is eager, **try variants**: rewrite one suspicious construct at
   a time (join shape, subquery form, predicate placement) and diff the plans.
   The variant that flips the plan to `MorselStreaming` identifies the
   offending construct.
6. For streaming plans, improve pruning or consolidate repeated work and verify
   the result at realistic invocation counts.

## Preserve Pruning with Direct Base-Column Predicates

Direct predicates such as `t.value = candidate.value` expose base-column values
to zone maps, bloom filters, and runtime pruning. Keep the large-table side
direct and normalize the scalar or small side when semantics allow. For required
table-side expressions such as `lower(coalesce(t.value, ''))`, use additional
direct selective keys and verify `blocks_used` and storage reads.

## Keep Interactive Work Bounded

- Resolve conditional or subquery-derived lookup keys into explicitly typed
  procedure scalars before large-table PK lookups. An `id = ...` expression
  alone does not guarantee a point lookup; inspect the plan.
- A selective outer `where` does not guarantee a small hash build. Verify that
  joins bound large-side work to the selected IDs; add equivalent restrictions
  when needed. Recheck after broadening eligibility with `OR`, preserving
  outer-join NULLs, duplicates, and ordering.
- Reads inside `Each` or repeated `Data` nodes multiply query setup and execution
  by the target count. Batch shared work or keep each lookup scoped to its key.
- Do not rely on SQL `and`/`or` to skip expensive subquery setup. Use a procedure
  `s.if` to skip expensive checks when a cheap prerequisite is false or a
  materialized candidate set is empty. Keep all required checks on other paths.
- Consolidate repeated reads only while their values remain current. Refresh
  records after procedures or writes that can change the fields being reused.

## Pitfall: Non-Equi Conditions in Outer Join ON Clauses

The planner handles non-equi `on` conditions differently by join kind:

- Inner joins, and the semi/anti joins planned from `exists` / `not exists`,
  run as hash joins on the equality key and evaluate extra conditions such as
  `!=`, `<`, or `>` as residual checks.
- `left`, `right`, and `full outer` joins (and mark joins) need a pure
  equality `on` clause to run as a hash join. A non-equi condition there makes
  the planner fall back to a correlated join (or a primary-key lookup when
  one applies), which shows up in the plan as `CorrelatedJoin`.
- An `on` clause with no equality key gets the same fallback.

A `CorrelatedJoin` re-executes its inner side per outer row and blocks the
shared-build streaming region, so the pipeline runs on a single worker and
often lands on the eager tier, even when the non-equi condition excludes
almost no rows.

```sql
-- Risky: outer join with a non-equi condition in on.
left join db.workforce_people researcher
  on researcher.id = o.researcher_id
  and researcher.kind != 'duplicate_sink'

-- Better: prefilter the joined side and keep on as the pure key.
left join (
  select id, name
  from db.workforce_people
  where kind != 'duplicate_sink'
) researcher on researcher.id = o.researcher_id
```

Other streaming-friendly rewrites are `exists` / `not exists` with equi-only
correlation. After any such rewrite, confirm in the plan that the
`CorrelatedJoin` is gone and the engine tier switched to `MorselStreaming`;
that plan change, not the SQL shape itself, is the fix.

## Pitfall: Period Series Joined by Date Range

A generated period list (`values`, a weeks CTE, `series.daily`) left-joined to
data on a date range is a `CorrelatedJoin`:

```sql
-- Risky: re-scans orders once per week.
select w.week_start, count(o.id) as orders
from weeks w
left join db.orders o
  on o.created_at >= w.week_start
  and o.created_at < date.add(day, 7, w.week_start)
group by w.week_start
```

The inner side, including CTEs and `in (...)` filters, re-runs per period and
can exceed the work limit. Scan once with `time_bucket_gapfill`
([Per-Period Series](date_functions.md#per-period-series)).

## Review Discipline

- Correlated SQL is neither bad in itself nor automatically fast; read the
  plan. Do not rewrite it just because it is correlated at the SQL surface.
  Prefer the clearest SQL that preserves the requested behavior.
  Rewrite when measured plans show excessive work, including large hash builds
  or repeated setup in streaming plans; verify the work and CPU decrease.
- Look first for direct base-column filters, focused table reads, narrow
  projections, early filters, and shared computation. Include total invocation
  count in the workload.
- Do not copy performance assumptions from other database engines; use Yolm SQL
  authoring patterns and the diagnostics available in your environment.

## Engine Facts For Query Authors

Yolm stores table data in columnar blocks. Query performance usually comes from
reading fewer columns and letting block pruning skip irrelevant blocks before
payload data is loaded.

- Zone maps track per-block value ranges and help skip blocks for selective
  range and equality predicates.
- Bloom filters can skip blocks for exact membership checks on supported
  columns.
- Runtime pruning can use values produced earlier in a plan, such as join keys
  or correlated predicates, to avoid reading blocks from a later table scan.
- Do not assume Yolm has B-tree indexes or row-store lookup behavior. A rewrite
  that would help a B-tree database can make a Yolm query harder to optimize.
- In Studio, use the available query diagnostics and plan output to confirm
  whether filters, joins, and projections are pruning work as expected.

## Authoring Best Practices

- Project only the columns needed by the result.
- Put selective predicates as close as possible to the table they filter.
- Keep the scanned table side of selective filters, joins, and correlated probes
  as a direct base column. Move normalization to the scalar/small side when
  semantics allow; treat functions, casts, and collation changes around the
  table column as a review and measurement trigger.
- Be skeptical of full-table reads on large tables when a narrower predicate
  matches the requested result.
- Prefer query shapes that reduce rows before wide joins, aggregations, or
  formatting work.
- Prefer pure equi-join keys in `on` clauses. For outer and mark joins, a
  non-equi `on` predicate forces a correlated join. When semantics allow,
  prefilter one side first and keep `on` as the join key equality.
- Build per-period series with `time_bucket_gapfill`, not a date-range join.
- Prefer `exists` / `not exists` for existence tests when that matches the
  semantics. Use `in` / `not in` only when you actually want membership and
  NULL semantics.
- When several metrics or predicates hit the same large inner table with the
  same correlation key, keep the key tuple and shared predicates structurally
  aligned. Only hand-rewrite into a grouped relation if explain still shows
  duplicated work.
- Shape selective star/snowflake queries as `small filtered dimension -> bridge
  -> large fact` on direct equi-join keys.
- Prefer non-null scalar join keys for large selective joins when possible.
- For top-N pages, prefer `order by direct_column limit n` when semantics allow.
  Sorting on a derived expression after a wide join is usually harder to
  optimize.
- Keep string collations explicit and consistent. `Binary` and `NoCase`
  comparisons do not behave the same for equality and ordering.
- Use PK ranges and shapes like `id = ...`, `id between ...`, or `order by id
  desc limit ...` when they match the product semantics.
