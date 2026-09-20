---
title: Yolm Overview
description: Agent-oriented overview of Yolm systems, execution phases, state scopes, file layout, and which docs to read first.
tags:
  - concepts
  - overview
  - solution-development
related:
  - concepts/execution_phases.md
  - database/overview.md
  - ui/data.md
  - ui/form.md
  - coding/index.md
---

# Yolm Overview

Yolm systems are full-stack business solutions defined in TypeScript/TSX and
SQL. A system can include database schema, apps, APIs, scheduled jobs, reactors,
pipelines, transforms, tests, blocks, and service integrations.

Yolm includes its own database engine. It does not compile systems or SQL to
PostgreSQL. The SQL dialect intentionally overlaps with PostgreSQL syntax, but
Yolm SQL has its own supported syntax, functions, and behavior. Use the Yolm
SQL docs as the contract instead of assuming arbitrary PostgreSQL compatibility.

For agents, the core rule is: **TypeScript defines the system at generation
time; runtime behavior is SQL plus Yolm procedure statements.** Do not design
runtime logic around JavaScript state, closures, promises, or React lifecycle
semantics.

## Build Sequence For Agents

1. Read the project's actual `core.tsx` or `system.tsx` before changing schema,
   enums, blocks, functions, or shared system state.
2. Choose existing blocks/components before adding new schema or UI.
3. Define persistent state in `db.*`, transient screen state in `ui.*`, and
   short-lived values in procedure scope.
4. Use `Data` for query-backed UI state and `Form` for insert/update/merge
   flows.
5. Write runtime expressions with `sql`, `sql.lit`, and `sql.ref`; never build
   SQL by string concatenation.
6. Run Forge validation after system changes, then run the focused automated
   tests and preview workflow that cover the changed behavior.

## Common System Layout

Projects can arrange these files differently. Inspect the actual project tree
before assuming a path:

```text
core.tsx or system.tsx     # tables, enums, blocks, functions, shared config
apps/<domain>.tsx         # system.app(...) definitions
apis/<domain>.ts          # system.api(...) definitions
components/*.tsx          # solution-specific reusable UI
shared/*.ts[x]            # solution-specific reusable helpers
reactors/*.ts             # system.addReactor(...)
scheduled/*.ts            # scheduled procedures
pipelines/*.ts            # import/export pipelines
transforms/*.ts           # schema/data transforms
tests/*.ts                # Yolm tests
assets/*                  # static app assets
```

## Generation Capabilities

Some systems read optional generation-time values from `devCapabilities.json`
with `getCapabilities()`:

```typescript
import { getCapabilities } from "std/yolm_gen_api";

const capabilities = getCapabilities() as {
  customLogoPath?: string;
  enableExperimentalImporter?: boolean;
};
```

`getCapabilities()` returns an untyped key/value object. The shape is owned by
the current system, so narrow it locally with `as` or explicit runtime checks
before using a key. Use it for generation-time feature flags, local asset paths,
or tenant-specific optional configuration, not for request-time state.

Keep `system.app(...)` calls, API definitions, and system-wide schema/configuration
where the project convention places them; follow the actual project tree.

## Execution Model

TypeScript/TSX defines the system at generation time; compilation validates the
generated model; runtime executes SQL and Yolm procedures. Runtime code sees
records, tables, scalars, SQL expressions, and statement builders, not arbitrary
TypeScript. See [Execution Phases](./execution_phases.md) for the details.

## State Scopes

| Scope | Lifetime | Use for |
| --- | --- | --- |
| `db.*` | persistent | business data, users, workflow state, audit logs |
| `ui.*` | in-memory UI state | filters, forms, selected rows, temporary screen state |
| procedure scope | one execution | local scalars, records, temporary tables |

Copy across scopes intentionally. Example: read from `db.orders` into a UI
table with `Data`, then persist changes through `Form` or an event handler.

## Which Doc To Open Next

| Task | Read |
| --- | --- |
| Add tables, fields, search, foreign keys | [Database Overview](../database/overview.md) |
| Write SQL expressions or queries | [SQL Overview](../sql/overview.md) |
| Build query-backed UI state | [Data Component](../ui/data.md) |
| Build mutations/forms | [Form Component](../ui/form.md) |
| Build app routes/layouts | [Apps](./apps.md), [Routing](../ui/routing.md) |
| Add APIs | [API Overview](../api/overview.md) |
| Add background automation | [Reactors](./reactors.md), [Scheduled Jobs](./scheduled_jobs.md) |
| Import/export bulk data | [Pipelines](./pipelines.md) |
| Reuse auth/CRM/integration features | [Solution Blocks](../blocks/solution_blocks.md) |
| Choose UI helpers | [Solution UI Helper Components](../ui/solution_components.md) |
| Validate behavior | [Testing Overview](../testing/overview.md) |

## Common Mistakes

- Treating TSX components like React runtime components.
- Storing filters or edit buffers in `db.*` instead of `ui.*`.
- Using TypeScript conditionals inside SQL expressions instead of SQL `case`.
- Recreating existing blocks/components.
- Guessing table shape instead of reading the actual `core.tsx` or `system.tsx`.
- Changing package internals when the task only needs solution code.
