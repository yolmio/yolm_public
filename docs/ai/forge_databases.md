---
title: Forge development databases
description: MCP scratch database ownership, imports, copies, asynchronous pipelines and transforms, cancellation, retention, and cleanup.
tags: [ai, forge, databases, mcp]
related:
  - ai/forge_operations.md
  - ai/forge_transfers.md
  - ai/forge_preview.md
---

# Forge development databases

Select a Forge session for mutable MCP `exec` calls. These tools operate on
**development databases only**. Read access permits discovery, queries, and run
polling. Develop access and `edit_code` are required for mutations.

## Ownership and lifecycle

`listDatabases()` returns up to 50 recently created databases, with `databaseId`
(a UUID), `name`, `origin`, `createdAt`, `ownedByYou`, and `sourceDatabaseId`.
Ownership means the authenticated user created the database through MCP in the
current Forge session. A database created in the Studio UI, in another session,
or by another user is not owned by you. Connections are recorded for
attribution; reconnecting within the same session does not transfer ownership to
another user.

```js
text(await createDatabase({ name: "scratch" }));
text(await copyDatabase({ databaseId, name: "scratch copy" }));
text(await renameDatabase({ databaseId, name: "pipeline rehearsal" }));
text(await setDatabaseRetention({ databaseId, retention: "keep" }));
text(await deleteDatabase({ databaseId }));
```

Create accepts optional `ddl`, a supported external-database DDL statement. It
registers the database before applying DDL: inspect and clean it up if DDL
fails. A full copy shares immutable storage blocks and returns `{databaseId}`.
Copying and reading another user's development database are allowed. Rename,
retention, delete, and in-place pipeline runs require ownership. There is no
session quota. Retention is `default_30_day` or `keep`.

Copy remains synchronous and has a bounded 330-second tool wait allowance.
`validate()` has a 930-second allowance. These allowances apply while waiting
for the tool; active JavaScript retains its 30-second budget. If a copy times
out, inspect existing databases before retrying because storage work may have
completed. Copy does not accept `requestId`.

Uploads prepared with `prepareDatabaseUpload` carry signed
user/session/connection attribution through import completion. Do not modify the
signed URL. Poll `databaseUploadStatus` until completion before using the
database. See [transfers](./forge_transfers.md). A recovered import without MCP
attribution is not agent-owned.

Deletion refuses databases with active operations, imports, deployments, or
persistent or custom-domain previews; stop a running preview first. While a
deletion is in progress, operations that read or write that database fail with
`Database deletion is in progress`; operations on other databases are
unaffected. If cleanup fails, retry the deletion; the janitor also retries
pending cleanup.

## Runs and cancellation

```js
text(
  await runPipeline({
    name: "import_orders",
    databaseId,
    sources: { staging: sourceId },
  }),
);
text(await runPipeline({ name: "import_orders", databaseId, clone: true }));
text(
  await runTransform({
    name: "normalize_orders",
    sourceDatabaseId: databaseId,
  }),
);
text(await versionRun({ runId, waitSecs: 25 }));
text(await cancelRun({ runId }));
```

Pipeline runs are **in place by default**, on an owned database. `clone:true`
admits cloning and execution as one operation and allows any development source
database. Busy rejection creates no copy.
`databaseId` defaults to the selected version's preview database when omitted;
otherwise supply it explicitly. `startAtStage` is optional. Transforms always
create an owned output database. Runs return immediately with `runId` and
`databaseId`; the output may not yet be registered. Output metadata is reserved
before data work, so failed or cancelled outputs remain owned and can be deleted
after the run becomes terminal. Wait with `versionRun({ runId, waitSecs: 25 })`
in a subsequent `execRead`: it returns once the run is terminal or after
`waitSecs` (0–25), adding `pollAfterSecs` while the run is still active, so call
it again until terminal. Never busy-loop between reads (see
[waiting for a run](forge_operations.md#waiting-for-a-run)). Its
`data.items[0]` includes status, target/output UUIDs, progress, and error text. Pipeline failures include stage context when available. Inspect
a terminal `failed` or `interrupted` result before retrying: in-place work can
have partial effects.

### Database bindings

Generation resolves `devDb(name)` and a transform's `sourceDatabase` by name.
`runPipeline` binds every named development database, as the Studio UI does.
Binding a database that is being deleted is harmless unless the run reads it;
`databaseId` (`runPipeline`) and `sourceDatabaseId` (`runTransform`) are
refused immediately when being deleted. `runTransform` binds only the database
supplied as `sourceDatabaseId`, under its own registered name: transform
compilation requires a schema for every bound database, so one without storage
would fail the run. Bind any other database a transform reads with `sources`.
Optional `sources: { name: databaseId }` entries are applied last and override
any binding, for example to bind the selected source under a different declared
name:

```js
text(
  await runTransform({
    name: "upgrade_v2",
    sourceDatabaseId: databaseId,
    sources: { old_system: databaseId },
  }),
);
```

For a `newSchema` transform, set its declared `sourceDatabase` to the registered
name of the database supplied as `sourceDatabaseId`, or bind that name with
`sources`. An unbound name has no schema: `getSourceTables(devDb(name))` returns
`[]` and logs a generation warning, so a transform that registers tables only
when metadata exists can silently omit them. Check the run's version logs for
that warning.

Bindings are part of the operation's identity. The run's own output and
checkpoint databases are left out, so their registration does not change a
retry with the same `requestId`. For `runPipeline`, creating, renaming, or
deleting another named database between attempts does. Such a retry is rejected
because the request ID was used with different arguments. Inspect the original
run with `versionRun` before starting a new request.

### Busy admission

One long Studio operation runs at a time per system, shared by all users,
sessions, MCP connections, and the Studio UI. Pipelines, transforms, database
creation, copies, DDL, deletion, imports, snapshots, and deployments share this
slot. A busy `runPipeline` or `runTransform` returns
`{error:{code:"BUSY",retryable:true,retryAfterSecs,message,activeOperation}}`.
`activeOperation` describes the running operation when the platform reports it,
as `{operationId, kind, name, requestId, executionRunId, startedAt}` (`name`,
`requestId`, and `executionRunId` may be `null`), and is `null` otherwise. Wait
at least `retryAfterSecs` before retrying.

### Retries

An optional `requestId` UUID identifies an asynchronous
admission; repeating the same admitted operation recovers its existing run,
including from another connection for the same user/session. Pipeline
checkpoints inherit the run's ownership and can be retained or deleted like
other scratch databases. The same `requestId` also makes `clone:true` retryable:
an admitted retry
returns the original run and clone instead of creating another database. Do not
automatically retry an entire script that already created other databases.

Cancel is limited to the user/session that started the resident run. It requests
interruption, not rollback. A nonresident/terminal request returns
`{cancelled:false}`. The operation slot stays occupied until the worker and
retained external work drain; synchronous compilation may delay cancellation.
Wait with `versionRun({ runId, waitSecs })` until the run becomes terminal. Restart recovery never automatically
replays an interrupted data operation.

## Import files already in Drive

Give the user a normal authenticated folder link from `createDriveFolder` or
`getLinks({view:"drive",folderId})`. They upload files in that workspace.
`listDriveFiles` returns immutable version IDs and navigation links.

```js
const job = await importDriveFiles({
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  name: "Customer export",
  files: [{ itemId: 12, versionId: 23 }],
});
text(job);
text(await databaseUploadStatus({ jobId: job.jobId }));
```

The tool uses the internal Studio request channel. The server checks access to
each exact version and streams its blob into the existing importer. File bytes
never pass through the agent. Supply 1–256
blob-backed versions, at most 2 GiB each and 32 GiB total, with distinct
filenames. A single ZIP is supported; do not mix ZIPs and direct files. Native
Drive documents without a blob and checkpointed WAL files are not supported by
this route; use Databases upload for WAL.

Optional `spec` contains a `yolm-import.json` object and overrides the manifest
in the staged files, without modifying Drive. Change the spec and use a new
request ID to retry a rejected import. The resulting database belongs to the
calling user and Forge session, with pinned Drive provenance in its origin.

The request ID is required. Repeating an identical request in the same user/session
returns the existing job; changing its name, versions, or specification is
rejected. Idempotency lasts for the import job's seven-day retention. Busy
admission creates no job. Tabular imports interrupted by a restart are marked
failed by the existing recovery process; they are not silently replayed.
