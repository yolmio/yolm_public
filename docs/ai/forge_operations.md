---
title: Forge Operational Reads
description: Inspect production, preview runtimes, captured executions, metrics, services, jobs, and Edge machines through Forge execRead.
tags: [ai, forge, investigation, metrics]
---

# Operational reads

Use MCP `execRead({code, sessionId?, versionId?})`. The functions below are globals
inside its JavaScript isolate: await them and print selected results with `text`.
They are also available in Forge's native executor. No new MCP endpoint is needed.
To discover this guide, use `readFile({path: "docs/ai/forge_operations.md"})` in
`execRead`. A session is not required for inspection or documentation reads.

```js
const target = { environment: "production" };
text(await runtimeStatus({ target }));
text(await liveRequests({ target, filters: { success: false }, limit: 10 }));
```

For a preview use `{environment: "preview", versionId: 123}` with an existing
version ID. The connected system determines ownership. Never substitute production
when a preview is unavailable. Explicit enclosing session/version scope must agree
with the selected version; omit that scope for cross-version investigation.

## Choose the evidence

| Evidence | Production | Preview |
| --- | --- | --- |
| `liveRequests` / `liveRequest` | Actual production-service ring | Resident runtime rings |
| `capturedExecutions` / `capturedExecution` | Selected historical captures | `UNSUPPORTED` |
| `metricsSummary` / `metricsWindows` | Persisted aggregate windows | `UNSUPPORTED` |
| `runtimeStatus` / `backgroundStatus` | Runtime/service inspection | Resident preview inspection |
| `serviceUsage` | System accounting | Accounting attributed to preview source ID |
| `versionLogs`, `versionRuns`, `versionRun` | Version-owned records, independent of residency | Same |
| Edge reads | System-owned machines and their instances | Same machines; instances identify environment |

Live observations are completed executions, not all in-flight requests. They are
transient: restart, eviction, stop, replacement and database changes can discard
them. Preview collectors retain at most 1,000 entries per runtime. `runtimeId`
identifies a resident preview lifetime; a version ID does not. Production currently
returns up to 1,000 entries and no runtime-lifetime ID. Filters and ID lookups only
cover fetched buffers. There is no live cursor or automatic historical fallback.

Captures are selected for errors, slowness, sampling or debug output; their counts
are **not total traffic**. Captures expire seven days after ingestion; aggregate
windows expire seven days after window start. Preview rings do not create either
historical source. Inspection never loads, starts, stops or drains a preview.

## Common contract

New operational reads return `{ok, target, source, fetchedAt, url, data}` on success.
`target` identifies the environment and applicable version/session; `fetchedAt` and
record timestamps are Unix seconds. Timing measurements end in `Ms`, sizes in
`Bytes`. `null` means unavailable, not zero. `url` opens authenticated Studio evidence;
it neither grants access nor freezes observations. Return descriptive Markdown
links to users with a brief finding, not a transcript of tool output.

Errors return `{ok:false, error:{code,message}}`, optionally `target`. Codes include
`INVALID_ARGUMENT`, `PERMISSION_DENIED`, `UNSUPPORTED`, `UNAVAILABLE`, `NOT_RESIDENT`,
`NOT_FOUND`, and `OUTPUT_LIMIT`. A missing live ID may have expired or lie outside
the fetched boundary. Older platform builds without runtime inspection report
`UNAVAILABLE`; stored-record reads still work. `runtimeStatus` is the discovery
entry point and includes supported capabilities and preview configuration separately
from residency. Production status can contain unavailable sections.

Lists default to 50 rows, accept `limit:1..200`, and may return fewer to fit the
32,000-character response budget. Narrow filters or lower the limit after
`OUTPUT_LIMIT`. Options are bounded to 12,000 characters. Debug/error text is bounded;
truncation flags accompany payloads. Use detail reads before requesting debug output.

Historical list ranges default to the last 24 hours and accept `fromTimestamp`
inclusive / `toTimestamp` exclusive, at most seven days apart. Live lists apply time
filters only when supplied. Version runs list all retained runs unless filtered by
status/type. ID detail lookup is independent of the default time range.

## Request and capture reads

```js
text(await liveRequests({ target, filters: { domain: "app.example.com", path: "/orders", method: "POST", success: false }, limit: 10 }));
text(await liveRequest({ target, executionId: "00000000-0000-0000-0000-000000000001" }));
text(await capturedExecutions({ target, filters: { executionType: "reactor", reactorName: "order_created", success: false }, limit: 10 }));
text(await capturedExecution({ target, executionId: "00000000-0000-0000-0000-000000000001" }));
```

Replace example domain, names, IDs and timestamps with actual values from prior
reads. Lists and details both return `data.items`; a detail contains one item.
Shared `filters`: `domain`, `path`, `method`, `executionType`, `success` (boolean),
`statusCode` (100..599), `reactorName`, `procName`, `fromTimestamp`, `toTimestamp`.
Matches are exact and case-sensitive. Capture-only filters: `modelHash`,
`captureReason`, `searchText` (case-insensitive substring of error/path).
Execution types: `api_endpoint`, `ui_state`, `ui_ssr`, `ui_proc`, `browser_error`,
`reactor`, `scheduled_proc`, `stored_proc`. Capture reasons: `error`, `slow`,
`sampled`, `requested`, `debug`. Invalid filters fail rather than broadening the search.

Live results disclose fetched/returned counts, fetch boundary, available observation
range and preview buffer capacity/residency. Captures include execution and ingestion
times, model hash, capture reason, timings, error detail and bounded debug text.

Capture, metric-window, version-log and version-run lists return `hasMore` and
`nextCursor`. Keep all filters unchanged; pass that cursor to continue. The cursor
pins initial time bounds and maximum ingested record ID. Retention can still remove
records. Cursors are opaque; do not edit or reuse across queries.

```js
const options = { target: { environment: "production" }, filters: { success: false }, limit: 10 };
const first = await capturedExecutions(options);
text(first);
if (first.ok && first.data.hasMore) {
  text(await capturedExecutions({ ...options, cursor: first.data.nextCursor }));
}
```

## Metrics and background work

```js
const toTimestamp = Math.floor(Date.now() / 1000);
const range = { target: { environment: "production" }, fromTimestamp: toTimestamp - 3600, toTimestamp };
text(await metricsSummary({ ...range, resolution: 60 }));
text(await metricsWindows({ ...range, limit: 10 }));
text(await backgroundStatus({ target: { environment: "preview", versionId: 123 }, kind: "reactor", name: "order_created", limit: 10 }));
```

`resolution` is seconds per bucket; default chooses at most 50 buckets to fit the
response budget and returns the chosen resolution. Explicit resolutions may select
up to 200 buckets; if the result exceeds the budget, increase `resolution` or narrow
the time range. Totals cover all selected windows regardless of resolution. Counts sum
whole windows selected by start time; boundary windows are not prorated. Error rate
is summed errors / requests. `worstWindowP99Ms` is the maximum observed window p99,
**not a percentile for the period**. Missing windows are not zero traffic. Inspect
window counts, dropped events/batches, and coverage before drawing conclusions.
Raw windows include model/catalog identity, latency summaries, resource counters
and bounded breakdown text (4,000 characters each; check `breakdownsTruncated`).

Background `kind` accepts `reactor` or `scheduled_proc`; `name` is exact. Items carry
underlying runtime `status` and preview lifetime identity. That status preserves the
platform's field names and exposes scheduling/backoff/circuit/concurrency state;
it is a snapshot, not a historical execution count. Preview status reports existing
slots, loaded model identity, active requests and residency independently of the
version's configured preview database.

## Version records

```js
text(await versionLogs({ versionId: 123, origin: "preview", type: "log_error", limit: 10 }));
text(await versionLogs({ versionId: 123, logId: 456 }));
text(await versionRuns({ versionId: 123, type: "pipeline", limit: 10 }));
text(await versionRun({ runId: 789 }));
```

Log origins: `check`, `preview`, `pipeline`, `transform`, `test`.
Log types: `debug_expr`, `debug_proc_and_ui_db`, `debug_query`, `log_error`,
`console_log`, `console_error`. Log lists accept time ranges, origin/type, cursor and
limit; `logId` selects an exact record in that version. These records have no exact
request/run/generation ID: time overlap alone is not proof of correlation.
Runs accept `type: "pipeline" | "transform"`, `status` (`pending`, `compiling`, `loading_catalog`, `running_setup`,
`running_stage`, `running_finalize`, `checkpoint`, `copy_passthrough`,
`processing_blocks`, `constraint_checks`, `snapshotting`, `completed`, `failed`, `interrupted`), cursor and
limit. Detail includes progress and pipeline stages/transform phases. These are
pipeline/transform runs, distinct from runtime request executions. Asynchronous
test runs are retrieved only through `getTestRun`.

## Service accounting and Edge

```js
text(await serviceUsage({ target: { environment: "preview", versionId: 123 }, fromTimestamp: 1788998400, toTimestamp: 1789084800, serviceName: "openai", limit: 10 }));
text(await edgeListMachines({}));
text(await edgeGetMachine({ machineId: "1" }));
text(await edgeGetOperation({ operationId: 2 }));
```

`serviceUsage`
returns `success`, totals, quantities and paginated breakdowns. It accepts up to
93 days, `limit` (max200), `offset`, and optional `contextKey`/`contextValue`.
Use either `target` or `sourceType`/`sourceId`, never both. Source selectors also
support Forge (`studio`) accounting. Production resolves
to `system`; previews resolve to `preview` and the version's decimal preview ID,
matching loaded-runtime attribution. Historical records without that attribution
cannot be reconstructed. Costs are best-effort USD nanos, not invoices; divide by
1e9. Totals cover all contexts; context filters affect only breakdowns. Missing or
unpriced accounting is not free usage and this is not a connectivity health check.

Edge list returns an array; machine and operation reads return objects with review
URLs. Lists accept `limit` (default50, max200), `offset` (default0), and optional
`target`. A target selects machines with matching instances. Machine detail accepts
`target` and `instanceId` to narrow its instances. Use the same explicit production /
preview target shape as other reads. Advance offset by the returned length; stop
on a shorter page. Edge/usage responses over 32,000 characters fail with a narrowing
message instead of returning incomplete JSON. Machines expose instances with production/preview identity, enabled/configured
state and loaded hashes. Edge requires `manage_edge` in addition to MCP access;
explicit session scope restricts agent-owned operations. Listing and reading never
queue probes. Connectivity checks, driver diagnostics, shell commands and controls
remain in mutable `exec` with their existing grants.

## Links without inspection

```js
text(await getLinks({ target: { environment: "preview", versionId: 123 }, view: "live" }));
text(await getLinks({ target: { environment: "production" }, view: "captured", executionId: "00000000-0000-0000-0000-000000000001" }));
text(await getLinks({ versionId: 123, view: "versionLogs", logId: 456 }));
text(await getLinks({ view: "versionRun", runId: 789 }));
text(await getLinks({ view: "edge", machineId: 1, operationId: 2 }));
```

Operational views: `status`, `live`, `captured`, `background`, `metrics`, `services`,
`versionLogs`, `versionRun`, `edge`. Pass the corresponding read options alongside
`view`; `live`/`captured` select detail when `executionId` is present. Links open the
selected inspection in its production monitoring page or session/version panel,
with filters, refresh and pagination preserved. Preview reads open that version’s
Preview tab; version logs and runs open its code panels. Edge links stay in the
machine-management area even when filtered to preview instances. Evidence may expire before
review. Existing session/version/artifact and actual preview-app links retain their
contracts; see [Session history and review links](forge_session_history.md).

For database/history SQL use [Investigation](forge_investigate.md).
