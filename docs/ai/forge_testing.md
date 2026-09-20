---
title: Forge testing skill
description: Validation, automated tests, browser preview verification, request performance checks, and recording completion gates.
tags: [ai, forge, testing, preview, playwright]
---

# Forge testing skill

For production/preview execution evidence, metrics, background state, services,
Edge machines and direct review URLs, read [Operational reads](forge_operations.md).
Live buffers and historical captures have separate contracts.

Forge supports system validation, automated Yolm tests, disposable preview
databases, full browser interaction through Playwright, and recorded browser
demonstrations. Use every layer that applies to the implemented behavior.

## Required workflow

1. Read `docs/ai/forge_code.md` plus the focused product guides governing the
   change. Read `docs/ai/forge_preview.md` for app-visible behavior and
   `docs/ai/recording_demos.md` when a recording is requested.
2. Inspect the affected schema, procedure, permission path, route, and existing
   tests. Define the starting state, actor, action, visible result, and database
   invariants before testing.
3. Run `validate()` after the implementation is complete. Resolve every
   diagnostic before continuing. Validation compiles and checks the system; it
   does not execute automated tests.
4. Run the relevant automated tests with `runTests()`. Use a filter during
   iteration, then broaden the run in proportion to the change. Inspect each
   failed result and its diagnostic or debug output.
5. For app-visible behavior, start a disposable preview and exercise the full
   workflow with `previewScript`. Browser preview testing is a supported Forge
   capability, including clicks, typing, dialogs, drag and drop, uploads,
   accessibility snapshots, element geometry, and visible-state assertions.
6. Check performance for the affected requests in `serverActivity.executions`,
   including successful calls. Investigate interactive requests taking 500 ms
   or more and repeatable regressions against the original version, even below
   that threshold. Follow the performance check in `docs/ai/forge_preview.md`;
   a passing browser assertion or `success: true` does not establish acceptable
   performance.
7. Verify writes independently with `queryPreview`, including related records
   and audit rows. Restore fixtures with `modifyPreview`, or use
   `restartPreview` to reset the preview.
8. For a requested video or proof, rehearse first, restore the opening state,
   then use `recordDemo` and complete the recording gates.

## Automated tests

```ts
declare function runTests(options?: {
  filters?: string;
}): Promise<{
  success: boolean;
  summary: string;
  versionId: number;
  filters: string | null;
  outcome: "completed" | "compilation_failed" | "rejected";
  selected: number;
  passed: number;
  failed: number;
  results: Array<{
    testName: string;
    passed: boolean;
    error: string | null;
    expected: string | null;
    actual: string | null;
    diagnostic: unknown;
    debugOutput: string | null;
  }>;
  debugOutputs: Array<{ kind: string; label: string | null; value: string }>;
}>;
```

Filters are comma-separated alternatives. A plain pattern is a substring
match; prefix a fully qualified test name with `=` for an exact match.

```js
const focused = await runTests({ filters: "shipment_reverse" });
text(focused);
```

External Forge MCP `exec` starts a durable asynchronous run instead. Pass a
caller-generated non-nil UUID, retain it outside the script for retries, retain
the returned run ID, and poll with `getTestRun`. The run is scoped to the
selected session/version. Poll from subsequent `execRead` calls; do not keep
one `exec` request open in a polling loop. Reuse the same request ID after a
rejected admission or a lost start response; use a fresh ID only for a new
run. `resultState:"not_retained"` means the durable completed status remains
available but its bounded result payload has expired or been evicted; it is not
a passing result. `unavailable` is an infrastructure-failed or interrupted run
without a result.
The status is `pending`, `compiling`, or `running_tests` while active, then
`completed`, `failed`, or `interrupted`; only `completed` can have a retained
test result.

```js
// Persist this caller-generated key; reuse it when retrying a lost start response.
const requestId = "6a799c88-7a1e-4b46-9b9c-a83e7b913fb9";
const started = await runTests({
  requestId,
  filters: "shipment_reverse",
});
if (started.outcome === "rejected") {
  throw new Error(`Test lane is busy; retry after ${started.retryAfterSecs}s`);
}
text(started);
// In a later execRead, poll with the returned run ID:
// text(await getTestRun({ runId: started.runId }));
```

A supplied filter that selects zero tests returns `success: false`. Treat
`compilation_failed`, `rejected`, any failed result, and a zero-match result as
unfinished testing.

Each retained payload is at most 1 MiB. Only the newest 20 payloads are kept,
and payloads expire after seven days; the execution record remains for status
and idempotent start lookup. If full details exceed the byte limit, the result
keeps outcome, success, and counts but returns empty `results` and
`debugOutputs` with `detailsOmitted:true`, `omittedResultCount`, and
`omittedDebugOutputCount`.

## Preview scenario contract

Before the browser run, resolve this compact scenario from code and preview
data:

- canonical app domain and starting route
- numeric `sys_users.id` and required roles or permissions
- stable existing record or disposable fixture plus reset method
- controls expected to be visible and actions to perform
- final visible state
- database invariants and related audit records
- recording chapters when a demonstration is requested

Use `authUserId` for deterministic business-workflow testing. Use the visible
account selector when authentication or the selector itself is under test.
Confirm authentication with the destination URL and a permission-specific
control before mutating data.

Rehearse the entire workflow in one `previewScript` call. Use `yolm.goto()` and
`yolm.waitForRuntime()` after navigation, semantic locators, and visible
readiness and completion states. Return concise browser evidence and inspect
`success`, `pageConsole`, and `serverActivity`.

## Failure diagnosis

Diagnose a browser failure from the request and execution evidence. A console
status code alone does not identify the failing action. Capture the failed
response URL and method with Playwright response events or
`page.waitForResponse`, then correlate it with `liveRequest({target: {environment: "preview", versionId}, executionId})` and
`serverActivity.executions`. A successful UI procedure proves the mutation
reached the server; visible state and `queryPreview` establish whether the full
workflow completed.

## Completion evidence

An implementation report names only gates actually completed:

- validation succeeded with no diagnostics
- relevant automated tests selected at least one test and passed
- the full preview workflow reached its expected visible state
- affected request timings were inspected, cold and repeated timings were
  distinguished, and any slow calls or regressions were investigated; report
  measured before/after timings and any unresolved performance limitation
- preview database invariants passed and the fixture was restored
- when requested, the recording script completed, a video artifact exists,
  the `demo-final` screenshot shows the outcome, relevant server executions
  succeeded, and `queryPreview` confirms persisted changes

If a capability is unavailable, report its exact error and the evidence already
completed. A different check does not substitute for the missing gate.
