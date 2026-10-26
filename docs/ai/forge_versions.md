---
title: Forge versions skill
description: Version references, hash-based diffs and manifests, file history, building on live, and merging.
tags: [ai, forge, versions]
---

# Forge versions skill

A version's name is `v` plus its global `versionId`: refer to version 1025 as
`v1025` in commentary and responses, the same name the UI shows. Every tool
option that names a version accepts `1025` or `"v1025"` (any case) and rejects
other text; the version tools below also accept the references listed. The
exec request's own `versionId` is a number. Version links open
`/versions/{versionId}`.

Every version is a full snapshot of paths to content hashes. A file's hash is
the BLAKE3 of its bytes (binary assets stored before source hashes were
recorded use their storage hash instead). A version's `treeHash` is the
lowercase hex BLAKE3 over its entries ordered by path bytes, each entry
`<UTF-8 byte length of path>:<path>:<text|binary>:<hex hash>` with no
separator, so equal hashes mean equal content.
Compare versions through these tools instead of downloading and comparing
folders.

## Version references

Wherever these tools take a version, pass a version ID (`1025` or `"v1025"`)
or a reference:

- `"current"`: the version the call works on (the exec request's version, else
  the agent's current version, else the session's latest version, else live).
- `"live"`: the version deployed to production.
- `"parent"`: the current version's first parent.
- `"base"`: the merge base of the current version and live, where they last
  shared history.

## Read-only versions

A version is read-only once it was deployed (live now, or admitted to a deploy
that did not fail), is tagged, or has a child version. Edits go to a new child
version from `createVersion`; native Forge also forks one automatically when
it edits a read-only version.

## Tools

```ts
type VersionRef = number | `v${number}` | "current" | "live" | "parent" | "base";

declare function getVersionInfo(options?: { versionId?: VersionRef }): Promise<{
  versionId: number; sessionId: number; sessionName: string;
  isLive: boolean; isDeployed: boolean; readOnly: boolean;
  treeHash: string; parentVersionIds: number[]; childVersionIds: number[];
  tags: string[]; fileCount: number; conflictFileCount: number;
}>;
// Searches this session's versions plus live and tagged versions. "v1025" or
// "1025" matches that version ID exactly; any query also matches session names
// and tags by substring.
declare function searchVersions(options?: { query?: string; limit?: number }): Promise<unknown[]>;
declare function listVersionGraph(options?: { rootVersionId?: VersionRef; direction?: "parents" | "children" | "both"; depth?: number; includeFilesChanged?: boolean }): Promise<unknown>;
declare function findCommonAncestor(options: { versions: [VersionRef, VersionRef] }): Promise<{ commonAncestorVersionId: number | null; leftDepth: number | null; rightDepth: number | null }>;
declare function diffVersions(options?: {
  from?: VersionRef; // default "live"
  to?: VersionRef;   // default "current"
  mode?: "summary" | "files" | "hunks" | "full"; // default "summary"
  files?: string[];  // exact paths (old or new path of a rename)
  path?: string;     // path prefix
  contextLines?: number; // default 3, max 50
  maxCharsPerFile?: number; // bytes; default 30,000, max 1,000,000
}): Promise<{
  from: number | null; to: number; mode: string; filesChanged: number;
  added: number | null; removed: number | null; // line totals; null in summary mode
  files: Array<{
    path: string; oldPath: string | null;
    status: "added" | "deleted" | "modified" | "renamed";
    isBinary: boolean; fromHash: string | null; toHash: string | null;
    fromSize: number | null; toSize: number | null;
    added: number | null; removed: number | null; truncated: boolean;
    hunks?: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>;
    fromContent?: string | null; toContent?: string | null; // full mode
  }>;
}>;
declare function versionManifest(options?: { versionId?: VersionRef; path?: string }): Promise<{
  versionId: number; treeHash: string; readOnly: boolean;
  files: Array<{ path: string; kind: "text" | "binary"; hash: string; size: number }>;
}>;
declare function fileHistory(options: { path: string; versionId?: VersionRef; limit?: number }): Promise<{
  path: string; versionId: number;
  changes: Array<{ versionId: number; sessionId: number; createdAt: string; distance: number; change: "added" | "modified" | "deleted"; hash: string | null; size: number | null; parentVersionIds: number[] }>;
}>;
declare function mergeVersions(options: { parents: [VersionRef, VersionRef]; dryRun?: boolean }): Promise<{ created: boolean; versionId: number | null; commonAncestorVersionId?: number | null; hasChangedBothFiles: boolean; changedBothFiles: Array<{ path: string; reason: "conflict" | "both_added_different" | "v1_deleted_v2_modified" | "v1_modified_v2_deleted"; isBinary: boolean }> }>;
declare function listVersions(): Promise<{ sessionId: number; liveVersionId: number | null; versions: Array<{ versionId: number; isLive: boolean; readOnly: boolean; parents: number[]; url: string }> }>;
// Without parentVersionId: the current version. In native Forge the new
// version becomes the agent's current version.
declare function createVersion(options?: { parentVersionId?: VersionRef }): Promise<{ sessionId: number; versionId: number; parentVersionId: number | null; parentIsLive: boolean; url: string }>;
// Native Forge only:
declare function getCurrentVersion(): Promise<{ versionId: number | null; parentVersionIds: number[]; isLive: boolean; liveVersionId: number | null }>;
```

- `diffVersions` compares content hashes, so `summary` reads no file text.
  `files` adds line counts, `hunks` adds unified-diff hunks, and `full` adds both
  contents. A deleted and an added path with identical content are one
  `renamed` file with no hunks. Line diffs cover the first 300 changed text
  files by path; later files, files over `maxCharsPerFile`, and binaries keep
  status and hashes but report `truncated` without text.
- `fileHistory` walks parent edges from the version and lists the versions
  that changed the file, nearest first. A merge that kept one parent's file is
  not a change.
- `mergeVersions` defaults to `dryRun: true`. In native Forge a completed
  merge becomes the agent's current version; external MCP selects the returned
  `versionId`. Changed-both text files contain conflict markers to resolve,
  and binary changed-both files block the merge.

## Common tasks

Start work on top of live, then edit the returned version (external MCP
selects it with `versionId` on later requests):

```js
const v = await createVersion({ parentVersionId: "live" });
```

What am I changing relative to live:

```js
text(await diffVersions({ from: "live", mode: "files" }));
```

When live moved on, create a new version on live and carry your changes over
instead of reconciling the old one; versions are cheap. `diffVersions({ from:
"base", mode: "hunks" })` lists your changes since the version shared history
with live.

Sync a local copy: compare `versionManifest()` hashes with local BLAKE3
hashes, read only the differing files, and upload changes through the
directory-sync protocol in [Forge transfers](forge_transfers.md).

Offer merges while the user controls live promotion. Start with a dry run and
resolve every changed-both file, conflict marker, and binary conflict. Refer to
the merged version as `v{versionId}`.
