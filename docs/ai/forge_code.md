---
title: Forge code skill
description: File inspection, Yolm documentation, API lookup, editing, and validation.
tags: [ai, forge, code]
---

# Forge code skill

Use documentation for supported Yolm behavior and current project files for
local shape. Read the project's relevant `core.tsx` or `system.tsx` at its
actual path before designing and load any additional focused guide that
directly governs the task.

Available inside `exec`:

```ts
declare function readFile(input: string | { path: string; versionId?: number; startLine?: number; endLine?: number; maxChars?: number }): Promise<string>;
declare function treeFiles(input?: { path?: string; depth?: number; versionId?: number }): Promise<string>;
declare function findFiles(input: { pattern: string; path?: string; versionId?: number }): Promise<{ matches: Array<{ path: string; size: number; isDir: boolean }> }>;
declare function grepFiles(input: { pattern: string; path?: string; versionId?: number; limit?: number }): Promise<{ summary: string; matches: unknown[] }>;
declare function inspectSystem(input: { versionId?: number; parts: Array<"db" | "enums" | "apps" | "apis" | "procedures" | "scheduled" | "reactors" | "pipelines" | "transforms">; detail?: "names" | "summary" | "diagnostic"; filters?: Record<string, string[]> }): Promise<{ success: boolean; summaryText: string; summaryData: Record<string, unknown>; warnings: string[]; error?: string }>;
declare function searchDocs(input: { query: string; tags?: string[]; limit?: number }): Promise<unknown[]>;
declare function searchDocSections(input: { query: string; tags?: string[]; limit?: number }): Promise<unknown[]>;
declare function searchApi(input: { query?: string; importPath?: string; symbol?: string; kind?: string; limit?: number }): Promise<unknown[]>;
declare function readDts(input: { importPath?: string; symbol?: string; path?: string }): Promise<string>;
declare function searchExamples(input: { query?: string; docPath?: string; limit?: number }): Promise<unknown[]>;
declare function validate(): Promise<{ success: boolean; summary: string; diagnostics: string[]; error?: string | null; logs?: string | null }>;
declare function runTests(options?: { filters?: string }): Promise<{ success: boolean; summary: string; versionId: number; filters: string | null; outcome: string; selected: number; passed: number; failed: number; results: unknown[]; debugOutputs: unknown[] }>;
declare function getTestRun(input: { runId: number; versionId?: number }): Promise<{ runId: number; versionId: number; status: string; resultState: "pending" | "available" | "not_retained" | "unavailable"; result?: unknown; error?: string | null }>;
```

The declaration above is the native Forge-agent surface. In external Forge MCP
`exec`, `runTests` is asynchronous so an HTTP request does not remain open
while tests compile and execute. Supply a caller-generated, non-nil UUID and
retain it outside the script: use a fresh key only for a new run, and reuse the
same key if the start response is lost. An occupied test lane returns
`{outcome:"rejected",retryAfterSecs}` and has no run ID.

```ts
// The caller creates and persists this UUID, not the Forge script runtime.
const requestId = "6a799c88-7a1e-4b46-9b9c-a83e7b913fb9";
const started = await runTests({ requestId, filters: "shipment_reverse" });
if (started.outcome === "accepted") {
  text(started);
  // In a later execRead, call getTestRun({ runId: started.runId }).
  // Its resultState is pending | available | not_retained | unavailable.
}
```

Every `readFile` path needs an explicit namespace: `src/` for editable project
files, `docs/` for documentation, `references/` for project references, and
`examples/` or `packages/` for platform source. Line numbers are 1-based and
inclusive. Large reads are truncated with a continuation hint; request a
narrower range with `startLine`, `endLine`, or `maxChars` when needed.

Start with `treeFiles`, `grepFiles`, or `inspectSystem`. Read narrow line ranges
from selected files and emit summaries or selected excerpts.

`grepFiles` searches `src/`, `references/`, `examples/`, and `packages/`.
`searchDocs` and `searchDocSections` discover documentation; `readFile` loads
an exact `docs/...` path.

Use native `apply_patch` after reading the exact target. After any edit, call
`validate()` in a later `exec` turn and pass `summary` plus diagnostics to
`text()`. For implemented behavior, continue with
`docs/ai/forge_testing.md`; validation checks the system model but does not
execute its tests.

Documentation paths include the `docs/` namespace, for example
`readFile("docs/ai/forge_ui.md")`. Use the focused design guide for the task
to choose relevant framework documents. Use `searchApi` or `readDts` for exact
exported signatures.
