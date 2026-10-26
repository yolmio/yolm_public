---
title: Forge preview skill
description: Use to run a version on a development database, inspect it in a browser, diagnose slow requests, or record demos.
tags: [ai, forge, skill, preview, debugging]
---

# Forge preview skill

Use the preview as a disposable, production-shaped environment for browser
inspection, interaction rehearsal, and data verification. Validate the system
first and discover its app domains through system inspection.

## Choose the preview, user, and scenario

1. Call `startPreview()` and use the returned canonical domains. On first setup,
   its default database is the latest production snapshot available to the
   project; a no-argument call reuses the database of an already running
   preview. Pass `databaseId` to select another stored database.
2. Query `sys_users` and the app's roles and permissions for the intended
   preview identity. For deterministic business-workflow testing, pass that
   numeric `sys_users.id` as `authUserId`. Use the visible account selector when
   authentication or the selector itself is under test.
3. Use `queryPreview` to inspect the scenario records required by the flow.
   Follow the app schema from the selected account to memberships, ownership,
   assignments, and target records when additional context contributes to the
   scenario.
4. Choose stable existing records for read-only flows. For write flows, create
   compact disposable fixtures with `modifyPreview`, or use an existing record
   and restore its starting values after rehearsal.

`authUserId` is a request-scoped Forge preview identity. Forge signs the
numeric user ID, the browser service attaches the verified identity to preview
requests, and the runtime supplies it as `current_user`. The app still verifies
that the user exists and satisfies its user filter; roles and permissions come
from preview data. The visible selector creates the ordinary cookie-backed
preview session instead.

```ts
declare function startPreview(options?: { versionId?: number; databaseId?: string }): Promise<unknown>;
declare function stopPreview(options?: { versionId?: number }): Promise<unknown>;
declare function showPreview(options: { versionId?: number; domain: string; path?: string; message?: string; databaseId?: string }): Promise<{ versionId: number; domain: string; path: string; url: string | null }>;
declare function queryPreview(options: { query: string; versionId?: number }): Promise<unknown>;
declare function modifyPreview(options: { statement: string; versionId?: number }): Promise<unknown>;
declare function restartPreview(options?: { versionId?: number }): Promise<unknown>;
declare function previewScript(options: { domain: string; versionId?: number; authUserId?: number; timeoutMs?: number; args?: unknown }, fn: (fixtures: { page: Page; expect: unknown; openPage: (domain: string, options?: { context?: string }) => Promise<Page>; screenshot(label?: string): Promise<unknown>; demo: unknown; args: unknown; console: { log(...values: unknown[]): void }; yolm: { goto(path: string): Promise<unknown>; waitForRuntime(): Promise<unknown> } }) => Promise<unknown>): Promise<unknown>;
declare function listDatabases(): Promise<Array<{ databaseId: string; name: string; origin: string; createdAt: string }>>;
declare function devDatabaseInfo(input: { databaseId: string; tableName?: string; limit?: number }): Promise<unknown>;
declare function queryDatabase(input: { databaseId: string; query: string; explain?: boolean; explainOnly?: boolean; metrics?: boolean }): Promise<unknown>;
```

## Rehearse the interaction

Use one `previewScript` call to exercise the complete requested interaction at
browser speed. Start from a direct route when the user asks about a specific
record or screen. Use role, label, and visible text locators that identify one
control. Treat visible application state as the readiness and completion
signal.

```js
const result = await previewScript(
  {
    domain: "office.example.com",
    authUserId,
    args: { orderId },
    timeoutMs: 300_000,
  },
  async ({ page, args, yolm }) => {
    await yolm.goto(`/orders/${args.orderId}`);
    await yolm.waitForRuntime();
    const heading = page.getByRole("heading", { name: "Order review" });
    await heading.waitFor({ state: "visible" });

    const approve = page.getByRole("button", { name: "Approve" });
    await approve.click();
    const approved = page.getByText("Approved", { exact: true });
    await approved.waitFor({ state: "visible" });

    return {
      heading: await heading.textContent(),
      status: await approved.textContent(),
      url: page.url(),
    };
  },
);
text(result);
```

Inspect `core.tsx`, then query the app tables that connect the
selected account to roles, permissions, memberships, ownership, and scenario
records. After navigation, assert a destination-specific control that the user
is permitted to see. If the selector remains visible, return that as an
authentication failure instead of continuing with the workflow.
Pass external values through `options.args`, because the browser function is
serialized into its execution sandbox.

Useful interaction patterns:

- Use `yolm.goto()` for Yolm routes so cold compilation receives the remaining
  whole-script time budget. A five-minute `timeoutMs` supports first-time JIT
  compilation while ordinary locator mistakes still fail quickly.
- Call `yolm.waitForRuntime()` after each navigation, then wait for a
  destination-specific heading or primary control.
- Wait for the saved, recalculated, validation, or completed state after an
  action.
- Use `pressSequentially` for fields whose application logic responds to
  keystrokes.
- Commit edited fields through the app's expected blur, Enter, or Save action.
- Select portal-rendered options with `getByRole("option", { name })`.
- Use `dragTo` for semantic drag and drop.
- Use `ariaSnapshot()` for bounded accessibility inspection and
  `boundingBox()` when exact viewport geometry is required. Use `blur()` when
  the application commits a field on focus loss.
- Use `page.evaluate(() => localStorage.getItem(...))` and the corresponding
  `setItem`, `removeItem`, or `clear` calls when browser storage is part of the
  workflow. Keep values bounded and return only the state needed as evidence.
- Playwright's documented `timeout: 0` is supported for page, frame, and
  locator operations. The outer `previewScript.timeoutMs` still bounds and can
  terminate the complete browser run.
- Pass in-memory file payloads to `setInputFiles` for upload flows.
- Return concise evidence from the script and pass the tool result to `text()`.

## Check request performance

After each rehearsal, inspect `serverActivity.executions` for the affected
routes and actions, including successful SSR, UI state, and UI procedure calls.
Each entry includes `executionId`, `type`, `path`, `success`, and `totalTimeMs`.
Successful requests can still be slow; `previewScript` success does not enforce
a latency budget.

Treat a page or query over ~100 ms as an investigation trigger (see
[Performance](review.md#performance)); most should be far under it. Also
investigate repeatable regressions below that. For changes to queries or
server-side work, compare the original and changed versions using the same
database snapshot, user, route, filters, sort, and page size. Report when a
comparable baseline is unavailable instead of claiming there is no regression.

Repeat a slow navigation or action at least twice in the same resident preview
to separate cold compilation/loading from recurring execution cost. Restore
fixtures before repeating writes and preserve the preview's external-action
restrictions. Keep the initial timing separate from subsequent timings; do not
attribute slowness to compilation without execution evidence.

Use `liveRequest({target: {environment: "preview", versionId}, executionId})`
for details and `liveRequests` for additional observations; see
[Operational reads](forge_operations.md). Inspect available CPU, compilation,
queue, asset-loading, external HTTP, and block-use measurements. Missing metrics
are unknown, not zero. Preview observations are transient, so inspect them
before restarting; historical captures and aggregate metrics are unavailable
for previews.

For recurring query cost, follow [Query guidance](forge_queries.md). Verify the
live scenario with `queryPreview`: it reads the running preview, including
fixtures created with `modifyPreview` and browser writes. `queryDatabase`
reads the stored base database; those in-memory preview changes are absent.
Before using `queryDatabase` with `metrics: true` and `explain: true` for
comparable standalone measurements, establish equivalent persisted fixtures
and relevant data in the selected stored database. Verify equivalence
against `queryPreview`; using the same base snapshot alone is insufficient
after preview mutations. If equivalence cannot be established, label standalone
measurements as noncomparable and do not use an empty or faster result to
explain the live workflow's cost.

Reproduce the actual query shape and parameters, including generated columns,
nested queries, and per-row work. Check whether expensive work runs
before the page limit and whether it scales with all matching records rather
than the displayed rows. Preserve filtering, sorting, pagination, and export
semantics in any correction, then repeat the browser workflow, verify live
state with `queryPreview`, and compare actual request timings. Report
unresolved slowness explicitly before declaring testing complete.

## Verify and reset

Read `serverActivity.executions`, `pageConsole`, and the returned browser
evidence after each rehearsal. When diagnosing a network failure, capture the
response URL, method, and status with `page.on("response", ...)` or
`page.waitForResponse(...)`, then correlate it with `liveRequest({target: {environment: "preview", versionId}, executionId})`. A console
status code without request-level evidence does not identify the failing
action.
Use `queryPreview` to confirm persisted state for write flows. Restore edited
records with `modifyPreview`, or call `restartPreview` to return the preview to
its base database state.

Use `showPreview` when the user should see and explore the running app. Use
screenshots when visual inspection contributes evidence to the task. A
`databaseId` is the UUID string returned by `listDatabases()`.

For a video, reproduction, walkthrough, or proof of a fix, continue with
`docs/ai/recording_demos.md` after the rehearsal succeeds.

Through MCP, await showPreview to publish a card and receive an absolute URL to
the actual preview app/page. Native calls return null for url. To retrieve an
existing preview URL without publishing, use getLinks({domain, path}) in execRead
with the sessionId and versionId.
