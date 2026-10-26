---
title: Forge deployment planning
description: "Use before deploying or running production pipelines, snapshots, or background actions: plans that a person confirms in Forge."
tags: [ai, forge, skill, deployment, pipelines]
related:
  - ai/forge_versions.md
  - ai/forge_databases.md
  - ai/forge_investigate.md
---

# Forge deployment planning

Forge agents can inspect and prepare production actions, but they cannot deploy
or write production data through MCP. The planning tools run the expensive
generation work and return a review link. A person opens that link and performs
the production action in Forge.

The planning tools require writable `exec` with a `sessionId` (the Develop
tier, like `validate` and `runTests`); `planDeploy` and
`planProductionPipeline` generate the system. They also require the
`can_deploy` permission; without it they return `ready: false` with a blocker
before generating anything. No planning tool changes production: each prepares
the action and a person confirms it on a single confirmation in Production.

The rule is general: agents can do almost anything in Forge, but anything that
influences production is planned by the agent and confirmed by a person through
the returned link. Read-only checks, such as operational reads and
`edgeCheckConnectivity`, run directly without confirmation. Background work is
planned with `planBackgroundAction` (below); Edge machine access is planned with
`planEdgeAccess` (see [Forge Edge commissioning](forge_edge.md)).

## Deploy a version

Run the normal validation and tests first, then call `planDeploy` with the
session and exact version selected on the request:

```js
text(await planDeploy());
```

```ts
planDeploy(options?: {
  versionId?: number;
  method?: "standard" | "transform" | "database_swap" | "force_database_swap";
  transformName?: string;
  databaseId?: string;
  allowLineageOverride?: boolean;
}): {
  ready: boolean;
  reviewUrl: string | null;
  sessionId: number;
  versionId: number; // refer to it as v{versionId}
  liveVersionId: number | null;
  lineage: "safe" | "redeploy" | "rollback" | "diverged" | "unrelated";
  commonAncestorVersionId: number | null;
  lineageOverride: boolean;
  changedFiles: { count: number; files: { path: string; status: string }[] }; // vs live, first 100
  candidateSourceHash: string;
  liveSourceHash: string;
  compatibility: {
    deployType:
      | "initial"
      | "code_only"
      | "compatible"
      | "compatible_by_orphaning"
      | "automatic_backfill"
      | "requires_transform";
    reasons: string[];
    newTables: string[];
    newColumns: Record<string, string[]>;
    orphanedTables: string[];
    orphanedFields: Record<string, string[]>;
    automaticBackfillFields: { table: string; field: string; kind: string }[];
  };
  schemaChanges: SchemaChange[];
  method: string;
  methodSummary: string; // e.g. "code only", "automatic backfill of customers.name"
  dataImpact: string; // e.g. "No data changes.", "Fills customers.name for existing rows."
  transformName: string | null;
  transformRegistered: boolean | null;
  rehearsal: TransformRehearsal | null; // transform deploys only
  warnings: string[]; // non-blocking
  databaseId: string | null;
  unsavedFileCount: number;
  conflictFileCount: number;
  blockers: string[];
};
```

When the version does not generate or compile, `planDeploy` cannot compare it
with production. It returns `ready: false`, the version and lineage fields,
`generationError` (the Studio error text), and a blocker that asks you to run
`validate()` on the version and fix the errors, instead of failing the call.

```ts
type SchemaChange = {
  kind:
    | "table_added" | "table_orphaned" | "table_renamed"
    | "field_added" | "field_orphaned" | "field_renamed"
    | "field_type_changed" | "nullability_changed" | "default_changed"
    | "enum_added" | "enum_orphaned"
    | "enum_value_added" | "enum_value_removed" | "enum_value_renamed";
  table: string | null;
  field: string | null;
  enum: string | null;
  value: string | null;
  renamed_from: string | null;
  from: FieldType | null; // {type, not_null, enum?, table? (FK target), precision?, scale?, max_length?, min_length?, ...}
  to: FieldType | null;
  effect: "compatible" | "orphaned" | "backfill" | "requires_transform";
  reason: string | null;
};
```

`schemaChanges` is the platform's structured comparison with production, the
same list the deploy page shows under Schema changes. Report changes from it
rather than inferring them from files.

Share the link only when `ready` is true. The link opens Production > Deploy
(`/production/deploy?version_id=…`) at the final confirmation, so the deploy
does not wait for a browser preflight. The page computes the schema changes
from the version against current production (the link does not carry them).
Below the confirmation it shows the code diff from live and, for a diverged version, live's changes since the common ancestor.
A version's Deploy tab in its session links to the same page.

The confirmation is titled with the method, for example "Deploy v4 — automatic
backfill of customers.name". One sentence below the title says what happens
to production data. `methodSummary` and `dataImpact` use the same wording.
Your message with the link must state both, quoting them rather than
paraphrasing, so the user knows what they are confirming. A dev DB swap
replaces all production data, so say that plainly. The page asks the user to
acknowledge it before the deploy starts.

A `standard` plan deploys `code_only`, `compatible`,
`compatible_by_orphaning`, and `automatic_backfill` results directly. For a
`requires_transform` result, select and rehearse a transform before planning:

```js
text(await planDeploy({ transformName: "migrate_orders" }));
```

`transformName` must be registered in the generated model for that version; a
file under `transforms/` is not enough. Forge checks this when planning and
again when the user confirms the deploy.

For a transform deploy, `rehearsal` is the latest development `runTransform`
of that transform on this version, or `null`:

```ts
type TransformRehearsal = {
  runId: number;
  status: string; // execution run status; "completed" when it succeeded
  sourceDatabase: { databaseId: string; name: string; origin: string; createdAt: string } | null;
  sourceSnapshot: { databaseId: string; name: string; createdAt: string } | null;
  outputDatabaseId: string | null;
  completedAt: string | null;
  error: string | null;
};
```

`sourceSnapshot` is the production snapshot the rehearsal read: the source
itself, or the snapshot it was copied from. `warnings` names a missing,
failed, or unfinished rehearsal, and a rehearsal whose data (the snapshot's
creation, otherwise the source's) is older than the latest completed
production deploy. Warnings do not block the link, but tell the user about
each one. When you share a transform deploy link, also state snapshot
freshness: which snapshot the rehearsal used and when it was taken, for
example "rehearsed on Production Snapshot 2026-09-30 (taken 3 hours ago)".

### Rehearse a transform on fresh production data

Rehearse against a fresh copy of production rather than an old snapshot:

1. `planProductionSnapshot({ name, reason })` and share its link. A person
   confirms the snapshot in Production; check `listDatabases()` until it
   shows it (origin `production_snapshot`), with `await sleep(ms)` between
   checks, never a busy loop.
2. `copyDatabase({ databaseId: snapshotId, name })` so the snapshot stays
   untouched.
3. `runTransform({ name: transformName, sourceDatabaseId: copyId })`, wait
   with `versionRun({ runId, waitSecs: 25 })` until it is terminal, and inspect
   the output database.
4. `planDeploy({ method: "transform", transformName })`, check `rehearsal`
   and `warnings`, then share the link.

See [development databases](forge_databases.md) for the database tools.

A database swap replaces production data with a development database. Planning
uses it only for an initial deploy, where it is the default, or when you pass
`method: "database_swap"` explicitly for a recovery the user requested:

```js
text(await planDeploy({ databaseId }));                            // initial
text(await planDeploy({ method: "database_swap", databaseId }));   // recovery
```

`databaseId` is the UUID returned by `listDatabases` and must be an available
development database. A force database swap is a recovery mechanism and
requires `unsafe_actions`; it is not a general form of rollback.

Lineage is separate from schema compatibility. A safe descendant or redeploy
can produce a link directly. For a diverged version, prefer creating a new
version on live with your changes (`createVersion({ parentVersionId: "live" })`,
see [Forge versions](forge_versions.md)) and planning that. A rollback, diverged
deploy, or unrelated deploy returns a blocker unless the user has explicitly
approved replacing current live changes. After that approval, re-plan with:

```js
text(await planDeploy({ allowLineageOverride: true }));
```

### What is checked where

- Planning checks permissions, unsaved and conflicted files, lineage,
  compatibility against current production, transform registration, and
  database availability. A transform or database-swap plan is also blocked
  while any production run is `requires_review`; the blocker names the run and
  links to its page.
- The review link pins the live version observed during planning and two
  source hashes: `candidateSourceHash` for the reviewed version and
  `liveSourceHash` for the live version (`none` when nothing is live). A source
  hash is the version's `treeHash`: BLAKE3 over its files ordered by path, each
  entry the path, its kind, and its content hash. When the user confirms, Forge rechecks
  permissions, files, the pinned live version, lineage and its override, and
  transform registration before it requests admission with the pinned values.
- Deploy admission (`/api/deploy-runs/start`) rejects a request while another
  deploy is active. In the same transaction as the insert, it compares
  `expectedLiveVersionId` with current live (409 `live_version_changed`) and
  recomputes both source hashes, rejecting any mismatch with 409
  `source_changed`. The UI then says the version or production changed since
  the review; plan the deploy again.
- Schema compatibility is decided again by deploy execution against the actual
  production model. A breaking change without a transform or database fails
  there.

Never report a deployment as completed from a plan result; inspect the deploy
run after the user starts it.

## Run a deployed pipeline on production

Production runs use the pipeline registered in the current deployed source,
not an undeployed editor version. Rehearse it against a development database,
inspect its effects, then prepare the manual production action:

```js
text(await planProductionPipeline({ name: "refresh_contacts" }));
```

```ts
planProductionPipeline(options: {
  name: string;
  versionId?: number;
  sources?: Record<string, string>; // source alias -> development database UUID
  invocationId?: string; // reuse an earlier plan's invocation; omit for a fresh one
}): {
  ready: boolean;
  reviewUrl: string | null;
  name: string;
  deployedVersionId: number;
  sourceSnapshotHash: string;
  stages: unknown[];
  sources: Record<string, string>;
  invocationId: string | null;
  blockers: string[];
};
```

The tool generates the authoritative deployed catalog and rejects an
unregistered name. Each table-source alias (`<alias>.<table>`) the pipeline
reads resolves to the development database of that name unless `sources`
overrides it. Query-backed stages do not expose their aliases in the catalog,
so pass `sources` for every database they read. Each required alias must map
to a registered development database that is not being deleted; otherwise the
plan returns a blocker. Mapping entries the pipeline does not read are never
checked.

`sources` in the result is the pinned mapping, containing only the required
aliases. The link carries that mapping and a fixed `invocationId`, so reopening
it resumes the same durable invocation instead of creating a second one. Each
plan mints a fresh `invocationId`; pass `invocationId` only to re-issue the
link of an earlier plan whose run has not started.

`versionId` only links the confirmation back to Forge. Without one, a session
with no version of its own uses the system's live version.

The plan returns `ready: false` with a blocker, and no link, while production
cannot accept the run:

- any production run is `requires_review` and unresolved; the blocker names
  the run and links to its page. Resolve it first (see
  [Forge operations](forge_operations.md)).
- another production pipeline run or a production deploy is active.
- the reused `invocationId` already finished (any terminal outcome) or is
  still running.

The link opens Production > Pipelines (`/production/pipelines`) at one explicit
production confirmation, using the pinned mapping as-is. Pipeline admission pins and checks the
deployed source again, prepares the durable invocation, and rejects the action
if production changed.

Opening a link does not start work; the production action begins only when the
user clicks its confirmation button. After the user confirms, wait for the run
with `productionPipelineRuns({ invocationId, waitSecs: 25 })`, which returns
once the invocation is no longer `active` or adds `pollAfterSecs` while it is
(see [waiting for a run](forge_operations.md#waiting-for-a-run)).

## Take a production snapshot

A production snapshot copies current production data into a new development
database (origin `production_snapshot`). It runs on the system service and may
briefly slow production writes, so a person confirms it. `planProductionSnapshot`
only reads; it does not generate the system:

```js
text(await planProductionSnapshot({ name: "Before orders migration", reason: "Rehearse migrate_orders" }));
```

```ts
planProductionSnapshot(options?: {
  name?: string;   // at most 200 characters
  reason?: string; // at most 1,000 characters
}): {
  ready: boolean;
  reviewUrl: string | null; // <origin>/production/snapshot?name=…&reason=…
  latestSnapshot: {
    databaseId: string;
    name: string;
    createdAt: string;
    ageHours: number;
  } | null;
  blockers: string[];
  note: string;
};
```

`reviewUrl` opens Production > Snapshot with the name and reason filled in;
omitted options are left out of the link. `latestSnapshot` is the newest
production snapshot not being deleted. If it is recent enough for the task,
use it instead of asking for another. A snapshot that is already running
returns a blocker. Share the link with `note`, which explains why a person
confirms the snapshot.

## Pause, resume or run background work

Pausing or resuming a reactor or scheduled procedure, or running a scheduled
procedure now, changes what production does, so a person with
`manage_system_actions` confirms it on the Background page.
`planBackgroundAction` has the same tier and `can_deploy` requirement as the
other planning tools. It only reads: it checks the live system's background
status and captured executions, and does not generate the system:

```js
text(await planBackgroundAction({ kind: "reactor", name: "order_created", action: "pause", reason: "Duplicate emails" }));
text(await planBackgroundAction({ action: "pause_all", reason: "Incident 42" }));
```

```ts
planBackgroundAction(options:
  | {
    kind: "reactor" | "scheduled";
    name: string;    // exact name, at most 255 characters
    action: "pause" | "resume" | "run_now";
    reason?: string; // at most 1,000 characters
  }
  | { action: "pause_all" | "resume_all"; reason?: string }
): {
  ready: boolean;
  // <origin>/production/background/{kind}/{name}?action=…&reason=…
  // <origin>/production/background?action=pause_all|resume_all&reason=…
  reviewUrl: string | null;
  kind: "reactor" | "scheduled" | null;
  name: string | null;
  action: string;
  current:
    | {
      state: "paused" | "running" | "backoff" | "active";
      lastRunAt: string | null;
      errors24h: number;
      nextRunAt: string | null; // enabled scheduled procedures only
    }
    | { reactors: { total: number; paused: number }; scheduled: { total: number; paused: number } }
    | null;
  blockers: string[];
  note: string;
};
```

The name is URL-encoded in the link and an empty reason is left out. Blockers
cover an unknown name, `run_now` on a reactor, pausing something already paused
or resuming something that is not, running a scheduled procedure that is
already in flight, `pause_all`/`resume_all` with nothing to change, a production
deploy in progress, and unavailable production status. `lastRunAt` and
`errors24h` come from captured executions on the live model, as on the
Background page, so they are not total run counts. Share the link with `note`.
