---
title: Forge versions skill
description: Version DAG inspection, diffs, branching, and merge planning.
tags: [ai, forge, versions]
---

# Forge versions skill

`versionId` is the numeric tool ID, while a displayed session version such as
`v3` is its session position. Resolve IDs before acting. Use “Version 3” in
commentary and final responses. Keep `versionId` in tool arguments and share it
when the user requests the internal ID.

Ordinary work has one canonical working version. The first successful patch
creates it automatically, and every later patch in the run updates it.

```ts
declare function getCurrentVersion(): Promise<{ versionId: number | null; displayName: string | null; parentVersionIds: number[]; isLive: boolean; liveVersionId: number | null }>;
declare function getVersionInfo(options?: { versionId?: number }): Promise<{ versionId: number; displayName: string; parentVersionIds: number[]; childVersionIds: number[]; isLive: boolean; conflictFileCount: number }>;
declare function searchVersions(options?: { query?: string; limit?: number }): Promise<unknown[]>;
declare function listVersionGraph(options?: { rootVersionId?: number; direction?: "parents" | "children" | "both"; depth?: number; includeFilesChanged?: boolean }): Promise<unknown>;
declare function diffVersions(options: { from: number; to: number; files?: string[]; mode?: "summary" | "files" | "hunks" | "full"; contextLines?: number; maxCharsPerFile?: number }): Promise<unknown>;
declare function findCommonAncestor(options: { versions: [number, number] }): Promise<unknown>;
declare function mergeVersions(options: { parents: [number, number]; dryRun?: boolean }): Promise<{ created: boolean; versionId: number | null; versionLabel?: string; hasChangedBothFiles: boolean; changedBothFiles: Array<{ path: string; reason: string; isBinary: boolean }>; conflictFiles?: Array<{ path: string; reason: string; isBinary: boolean }> }>;
declare function startFresh(options: { fromVersionId: number }): Promise<{ versionId: number }>;
```

Let Forge manage version creation and naming through the patch workflow. Use
`startFresh` to branch from an exact version ID and make that branch current.
Historical `versionId` arguments on inspection tools preserve the working
version.

Offer merges while the user controls live promotion. Start with a merge dry-run
and resolve every changed-both file, conflict marker, and binary conflict. A
completed merge becomes the current working version. Use the returned
`versionLabel` in user-facing responses.
