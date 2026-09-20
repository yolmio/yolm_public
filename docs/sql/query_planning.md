---
title: Yolm SQL Query Authoring Notes
description: Slow query diagnosis for Yolm's HTAP vectorized columnar engine,
  engine tiers (MorselStreaming vs EagerResident), non-equi join
  CorrelatedJoin pitfall, plan metrics.
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
  Do not recommend "sort/cluster the table", "add an index", or "build a
  pre-aggregated summary table" as the first response to a slow query. Those
  are row-store remedies. Inspect the engine tier, table-side pruning
  predicates, and invocation count.
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
- A selective outer `WHERE` does not guarantee a small hash build. Verify that
  joins bound large-side work to the selected IDs; add equivalent restrictions
  when needed. Recheck after broadening eligibility with `OR`, preserving
  outer-join NULLs, duplicates, and ordering.
- Reads inside `Each` or repeated `Data` nodes multiply query setup and execution
  by the target count. Batch shared work or keep each lookup scoped to its key.
- Do not rely on SQL `AND`/`OR` to skip expensive subquery setup. Use a procedure
  `s.if` to skip expensive checks when a cheap prerequisite is false or a
  materialized candidate set is empty. Keep all required checks on other paths.
- Consolidate repeated reads only while their values remain current. Refresh
  records after procedures or writes that can change the fields being reused.

## Pitfall: Non-Equi Join Predicates Force Eager Materialization

A join whose `ON` clause mixes an equality key with a non-equi condition
(`!=`, `<`, `>`, inequality on a second column) cannot run as a hash join. The
planner falls back to a `CorrelatedJoin`, and that forces the **entire query**
into eager materialization — even when the non-equi condition excludes almost
no rows.

```sql
-- BAD: equi key + non-equi condition in ON.
-- Plans as CorrelatedJoin (Semi) -> VectorizedEager/EagerResident.
join db.workforce_people researcher
  on researcher.id = o.researcher_id
  and researcher.kind != 'duplicate_sink'

-- GOOD: pure equi correlation via NOT EXISTS.
-- Plans as a hash anti-join and keeps MorselStreaming.
where o.researcher_id is not null
  and not exists (
    select 1 from db.workforce_people wp
    where wp.id = o.researcher_id
      and wp.kind = 'duplicate_sink'
  )
```

Equivalent streaming-friendly rewrites: `EXISTS`/`NOT EXISTS` with equi-only
correlation, or prefiltering the dimension side and joining on the pure key.
After any such rewrite, confirm in the plan that the engine tier actually
switched to `MorselStreaming` — that plan change, not the SQL shape itself, is
the fix.

## Review Discipline

- Do not rewrite correlated SQL just because it is correlated at the SQL
  surface. Prefer the clearest SQL that preserves the requested behavior.
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
- Prefer pure equi-join keys in `ON` clauses. For outer/semi/anti/mark joins,
  non-equi `ON` predicates are harder to reason about. When semantics allow,
  prefilter one side first and keep `ON` as the join key equality.
- Prefer `EXISTS` / `NOT EXISTS` for existence tests when that matches the
  semantics. Use `IN` / `NOT IN` only when you actually want membership and
  NULL semantics.
- When several metrics or predicates hit the same large inner table with the
  same correlation key, keep the key tuple and shared predicates structurally
  aligned. Only hand-rewrite into a grouped relation if explain still shows
  duplicated work.
- Shape selective star/snowflake queries as `small filtered dimension -> bridge
  -> large fact` on direct equi-join keys.
- Prefer non-null scalar join keys for large selective joins when possible.
- For top-N pages, prefer `ORDER BY direct_column LIMIT n` when semantics allow.
  Sorting on a derived expression after a wide join is usually harder to
  optimize.
- Keep string collations explicit and consistent. `Binary` and `NoCase`
  comparisons do not behave the same for equality and ordering.
- Prefer shorter surrogate/search keys for hot string filters when the schema
  gives you that option.
- Use PK ranges and shapes like `id = ...`, `id between ...`, or `order by id
  desc limit ...` when they match the product semantics.
