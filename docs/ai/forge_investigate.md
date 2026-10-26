---
title: Forge investigation skill
description: "Use to inspect production data, behavior, or history: queries, captured executions, live requests, metrics, service usage, and jobs."
tags: [ai, forge, skill, investigation, production]
related:
  - sql/transaction_queries.md
  - sql/query_planning.md
---

# Forge investigation skill

For production/preview execution evidence, metrics, background state, services,
Edge machines and direct review URLs, read [Operational reads](forge_operations.md).
Live buffers and historical captures have separate contracts.

Use production data as evidence through bounded inspection queries and time
ranges. Separate confirmed evidence from inference.

```ts
declare function serviceUsage(input: { fromTimestamp: number; toTimestamp: number; sourceType?: "system" | "studio" | "preview"; sourceId?: string; serviceName?: string; contextKey?: string; contextValue?: string; limit?: number; offset?: number }): Promise<unknown>;
declare function queryProduction(input: { query: string; rowCap?: number; metrics?: boolean; explain?: boolean; explainOnly?: boolean }): Promise<unknown>;
```

Production query results omit detailed execution metrics by default. Pass
`metrics: true` when investigating query performance. Rows, errors, truncation,
and requested explain output are preserved.

## Usage and spending

Use `serviceUsage` for external-service spending questions. It reads this project's persisted usage, including
production (`system`), Forge (`studio`), and `preview`; it does not query another
customer's usage or make provider calls. Supply Unix seconds for the requested
period, inclusive start and exclusive end, at most 93 days. Translate “this
month” using the user's timezone and state that range in the answer.

`serviceTotals` aggregates the entire period by source and service, regardless of
breakdown pagination. Costs are integer USD nanodollars: divide by 1,000,000,000.
`serviceQuantities` likewise totals all contexts and exposes recorded units such
as tokens, recipients, SMS segments, and processing GB-seconds without assuming
a fixed set of service types.
Distinguish estimated provider COGS from rated customer charges; neither is an
invoice, and allowances/discounts are not deducted. Report legacy window counts
and unpriced request counts; missing data is not zero usage. Metrics are
best-effort and recent in-flight requests may not have arrived yet.

`breakdown` groups by source, service, and recorded dimensions (context, provider,
model, operation, pricing version), highest rated charge first. Follow `hasMore`
with `offset` when an exhaustive breakdown is needed. Optional
`contextKey: "sessionId", contextValue: "42"` (or any other recorded context key)
filters **only the breakdown**, not `serviceTotals`. Never present those broader
totals as the selected session's spending. An `_other` dimension means the
per-window attribution cap was exceeded; its costs cannot be assigned to a
specific session. Uninstrumented callers may have an empty context.

Forge records only `sessionId` in new agent and session-title usage contexts to
keep attribution compact. Its session/agent-info popover shows the recorded
customer-rated USD amount across that session's lifetime (Forge source only); click it to
refresh. It reads both breakdown formats, flags unpriced usage, and shows a dash
when no attributed records exist. This is an estimate before credits/discounts,
not an invoice or a guarantee that historical or overflow usage was captured.

Use recorded context IDs to inspect the relevant session or application code and,
where context identifies a business record, `queryProduction`. Do not claim an
exact originating request from minute aggregates: request/provider IDs are not
stored individually. Do not add `serviceTotals` to `breakdown` amounts; they are
two views of the same usage. No query here changes billing or enforces limits.

## Current production records

When the user asks to find, check, name, or verify a current production record,
inspect the relevant schema and application query, then call `queryProduction`
in the same turn. Return concrete identifiers, relevant state, and the reason
each result matches the request.

For requests about records appearing on a screen, read the screen's query and
filters first. Translate those predicates into a bounded production query so
the candidates satisfy the application's actual behavior. Set `rowCap` to the
number of useful candidates and include an SQL `limit` with the same bound.

Use query errors as schema evidence, refine the SQL from the inspected project
files, and run the corrected query. Use the returned production data to answer
directly with the matching records and exact application steps. Production
changes proceed through the application's supported interaction or an
explicitly authorized production mutation capability.

## Behavior and history

Start from the reported entity, actor, execution, and time range. Inspect current
state, then correlate executions and metrics with transaction history:

- Use `{table}__versions` for focused per-record history and field-level
  changes.
- Use `tx_op` to trace a transaction across tables, including `tx_id`,
  `tx_timestamp`, `tx_creator`, `kind`, `table`, and `record_id`.
- List the explicit history columns needed for the conclusion.
- On updates, `{table}__{field}__set` distinguishes a written field from an
  unchanged null payload.

WAL history follows each table's retention boundary. For tables with
`autoCompact: true`, base conclusions on retained payloads and state the
available history window. Read
`docs/sql/transaction_queries.md` before reconstructing history and load
`docs/ai/forge_queries.md` for nontrivial query analysis.
