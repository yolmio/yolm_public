---
title: Benchmarks
description: Define microbenchmark procedures for systems that use benchmark tooling.
tags:
  - concepts
  - benchmarks
  - performance
---

# Benchmarks

`system.addBenchmark(...)` defines a microbenchmark: a `setup` procedure
plus one or more named procedures. Systems with benchmark tooling can execute
those definitions to compare behavior.

Benchmarks are useful when you want to compare alternative
implementations of the same query or procedure under realistic data.

## Basic Structure

```typescript
system.addBenchmark({
  name: "user_search_strategies",
  setup: (s) => {
    s.modify(sql`insert into db.users (name) select 'user_' || i from generate_series(1, 100000) as i`);
  },
  procedures: [
    {
      name: "scan",
      iterations: 1000,
      warmup: 50,
      body: (s) => {
        s.defTable("u", sql`select * from db.users where name like 'user_500%'`);
      },
    },
    {
      name: "exact",
      iterations: 1000,
      warmup: 50,
      body: (s) => {
        s.defTable("u", sql`select * from db.users where name = 'user_500'`);
      },
    },
  ],
});
```

The `setup` block runs once before any of the procedures. Each
procedure runs `warmup` un-timed passes followed by `iterations` timed
passes.

## Running Benchmarks

`system.addBenchmark(...)` registers benchmark definitions in the
generated system output. Run them through the benchmark tooling available in
your development environment.

## Related

- [Query authoring](../sql/query_planning.md) — write focused SQL queries
- [Procedures patterns](../procedures/patterns.md) — alternative implementations to benchmark
