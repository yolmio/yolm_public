---
title: Stored procedures
description: Define reusable server-side procedures with typed input and output parameters.
tags:
  - concepts
  - stored-procedures
  - procedures
---

# Stored procedures

A stored procedure is a server-side procedure declared with
`system.storedProcedure(...)` that can be called from other procedures,
endpoints, scheduled jobs, and reactors. Use them to package focused runtime
logic with typed inputs and outputs.

Stored procedures are the default home for server logic. Each one compiles
separately and in parallel, so compiling it is faster than re-expanding the same
body inline at every call site; it can be tested directly; and reuse is
explicit. Use one whenever logic is or may be reused, and for substantial
behavior even with one caller. Keep only a true one-off small glue step inline.
TypeScript procedure helpers expand inline at every call site: use them to build
statements at generation time, not to share runtime logic.

## Keep procedures modular

Use modular stored procedures proactively during system development, not only
for code shared by multiple callers. Keep each procedure responsible for one
cohesive stage, with explicit inputs and outputs, and let a thin caller coordinate
the stages. This applies to inline bodies in UI actions, APIs, and jobs as well as
stored procedures: neither should grow into one massive unit.

Generation-time helpers can organize source code while still expanding into a
large procedure. To establish runtime procedure boundaries, extract the work into
stored procedures and call them. Moving an entire oversized body into a single
stored procedure is not sufficient modularization.

If compilation fails because a procedure is too big, takes too long to compile,
or reaches a compilation timeout, the standard remedy is **more modular stored
procedures**. Split large stages, branches, and repeated substantial work into
focused procedures, then validate compilation and results again. Do this before
raising compilation limits or timeouts.

Preserve transaction ownership, operation ordering, and error behavior when
splitting work. Keep bulk operations set-based within each procedure; modularity
does not mean replacing one bulk operation with a call per record.

## Basic Structure

```typescript
system.storedProcedure({
  name: "archive_inactive_users",
  transaction: "standalone", // "caller" | "standalone"
  inputScalars: [
    { name: "inactive_days", type: "Int", notNull: true },
  ],
  outputScalars: [
    { name: "archived_count", type: "Int" },
  ],
  procedure: (s) => {
    s.modify(sql`
      update db.users
      set archived = true
      where last_seen_at < now() - input.inactive_days * interval '1 day'
    `);
    s.setScalar("archived_count", sql`row_count`);
  },
});
```

If `name` is omitted, the caller's filename stem is used.

## Inputs and outputs

Inputs and outputs come in three shapes:

- `inputScalars` / `outputScalars` — typed scalar parameters
- `inputRecords` / `outputRecords` — typed record parameters (struct of
  fields)
- `inputTables` / `outputTables` — typed table parameters (multi-row
  set of records)

Scalar params accept `{ name, type, notNull? }` entries. Record and table
params accept `{ name, fields }` entries, where `fields` is a list of
`{ name, type, notNull? }` declarations. `type` accepts either a full
`yom.FieldType` or one of the shorthand names (`"String"`, `"BigInt"`, etc.).

## Transaction modes

The `transaction` field controls how the procedure participates in
transactions:

- `"caller"` (default) — runs in the caller's transaction.
- `"standalone"` — runs as its own stored procedure transaction.

Use `"standalone"` for procedures that should not fold into a caller's
transaction, and `"caller"` for helpers that should participate in the caller's
transaction.

## Calling a stored procedure

Call a stored procedure with `s.callStoredProcedure(...)` from any procedure
context, binding inputs and outputs by name:

```typescript
s.defScalar("archived_count", { type: "Int" });
s.callStoredProcedure("archive_inactive_users", {
  inputScalars: { inactive_days: 30 },
  outputScalars: { archived_count: "archived_count" },
});
```

Type reusable call options with `CallStoredProcedureOpts`:

```typescript
import type { CallStoredProcedureOpts } from "std/statements";

const callArchive = {
  inputScalars: { inactive_days: sql`30` },
  outputScalars: { archived_count: "archived_count" },
} satisfies CallStoredProcedureOpts;
```

## Related

- [Procedures overview](../procedures/overview.md)
- [Server statements](../procedures/server_statements.md)
- [Scheduled jobs](./scheduled_jobs.md)
