---
title: Studio help documents
description: Use to create or update end-user help documents for a system from agent-written sections and recorded media.
tags: [ai, skill, help, documentation, artifacts]
related:
  - ai/forge_artifacts.md
  - ai/recording_demos.md
---

# Studio help documents

Help documents are durable product knowledge for the system being developed in
Studio. Each document requires at least one Lexical rich-text section; sections
are its only content source. Images
and recorded demos use Drive file versions or Studio artifacts, attached in a stable order
at the end of the section they explain.

```ts
declare function listHelpDocuments(): Promise<Array<{
  documentId: number;
  title: string;
  mediaCount: number;
}>>;

declare function readHelpDocument(options: {
  documentId: number;
}): Promise<{
  documentId: number;
  title: string;
  sections: Array<{
    sectionId: number;
    title: string;
    markdown: string;
    media: Array<{
      mediaId: number;
      url: string;
      artifactId: string | null;
      sessionId: number | null;
      fileVersionId: number | null;
      mimeType: string;
      kind: "video" | "image" | "file";
      description: string | null;
      // Recorded demos only; Drive videos have none.
      chapters: Array<{
        timeMs: number;
        title: string;
        description: string | null;
      }>;
    }>;
  }>;
}>;

declare function createHelpDocument(options: {
  title: string;
  sections: Array<{
    title: string;
    markdown?: string;
    mediaArtifactIds?: string[];
    mediaFileVersionIds?: number[];
  }>;
}): Promise<{ documentId: number; title: string }>;

declare function updateHelpDocument(options: {
  documentId: number;
  title?: string;
  sections?: Array<{
    title: string;
    markdown?: string;
    mediaArtifactIds?: string[];
    mediaFileVersionIds?: number[];
    mediaIds?: number[];
  }>;
}): Promise<{ documentId: number; updated: true }>;

declare function deleteHelpDocument(options: {
  documentId: number;
}): Promise<{ documentId: number; deleted: true }>;
```

Use sections for the document's major topics. The tool converts each section's
Markdown body to Lexical. A section's media artifact ids must identify image or
video artifacts in the current Studio session and should show the workflow or
result described by that section.

Omit `sections` from an update to preserve all current sections and their media.
Supplying `sections` replaces the document's complete ordered section list and
the media attached to those sections. Pass existing attachments in `mediaIds`
to preserve them, including media made in another agent session. These IDs
must belong to the document being updated. Unchanged attachments retain their
IDs and Spark URLs even when sections move or their text changes. Do not reuse
another session's `artifactId`: artifact names are session-local.

For example, after `const doc = await readHelpDocument({documentId})`, preserve
each section's attachments with `mediaIds: section.media.map(m => m.mediaId)`.
New images/videos can still use `mediaArtifactIds` or `mediaFileVersionIds`.
An attachment may occur only once per document, across all three input lists.

Help writes require `edit_code`, including native agent tools and UI actions.
View-only users can read documents and open their media.

Read the existing help document before updating it. Replace only the document
whose content the user asked to change.

## Forge MCP

Help sections accept `mediaFileVersionIds` alongside `mediaArtifactIds`.
Use `listDriveFiles` to obtain the current version ID, or upload through
`prepareDriveUpload` and use its upload response's `versionId`. Attach that
exact version; later edits or replacements in Drive do not change the guide.
The section media picker offers Drive images/videos and existing agent artifacts.
Both kinds are delivered to Spark through the same help service.
Drive media attachments are limited to 128 MiB to fit that transport; larger
files can remain in Drive but must be shortened or compressed before attaching.

Drive tools available to Forge and MCP:

- `listDriveFiles({parentId?, query?, afterId?})` (up to 200 matching items in ID order; pass `nextAfterId` as `afterId` with the same filters until it is null)
- `readDriveFile({itemId, versionId?})` (bounded Markdown text, metadata, viewer URL)
- `writeDriveDocument({name?, parentId?, itemId?, markdown})` (new file or version)
- `createDriveFolder({name, parentId?})`
- `moveDriveItem({itemId, parentId?})`
- `renameDriveItem({itemId, name})`
- `trashDriveItem({itemId})` and `restoreDriveItem({itemId})`
- `prepareDriveUpload({spaceId, parentId?, filename, mimeType?, itemId?})`
- `downloadDriveFile({versionId})`

Use `drive/` paths to browse and read system files, including root `context.md`.
Use Drive tools for edits. Binary files use the authorized download
tool; existing video files can be uploaded into Drive and attached to help.
`downloadDriveFile` also exports Markdown documents as text, pinned to
the requested version. The media picker searches both Drive and agent
artifacts and paginates results in groups of 50.

Drive list/read tools return `viewerUrl` links that open that exact file
version in Studio's Drive viewer.

All five help tools are available through Forge MCP. Use `execRead` to list and read
documents. Creating, updating, or deleting requires writable `exec` with a
selected `sessionId`. Documents belong to the system, not a source version.

To add a recorded walkthrough, use `recordDemo` in that session, inspect the
result, and pass its `recording.artifactId` in the intended section's
`mediaArtifactIds`. Playwright screenshot artifacts work the same way. Read
`docs/ai/recording_demos.md` for the recording contract.

`createArtifact({type: "image", content: base64Png})` can upload a PNG into
the selected session. `prepareDriveUpload` uploads existing image/video files;
`recordDemo` produces video artifacts directly. Keep the same session selected
when attaching media. Read a document before replacing its sections, preserving
the sections and media that should remain.

## Spark and system service requests

Spark and Spark MCP expose `tools.searchHelp({query, limit?})` and
`tools.readHelpDocument({documentId})` without per-system configuration. Help is
system-wide product knowledge, available independently of data capabilities.
Search is a case-insensitive grep for the query as written. Each section reads
as lines: a "Document › Section" title line, its Markdown lines, and the
chapters of its recorded demo. Matching lines come back in document order as
`{documentId, title, sectionId, sectionTitle, kind, line, mediaId, timeMs}`,
where `kind` is `title`, `text`, or `chapter` and chapter lines carry the video's
`mediaId` and `timeMs`. The default limit is 10 and the maximum 20. An empty
query lists the sections. A missing Studio returns an explicit error rather
than an empty result.

Native Spark also has `tools.showHelpMedia({documentId, mediaId, startMs?})`.
It re-reads the document, requires the media to be one of its videos or
images, and records it on the current exec step, which the conversation shows as a
card, opening a video at `startMs` with its chapters as jump targets. The `System/Help` reference tells
the model to answer with the section's steps and show its video at the chapter
for the user's step. Over Spark MCP, `exec` in a session records the same card
in that session, and every call returns `link`, an absolute URL that opens the
video at `startMs` in a browser; clients share the session URL or the link.

The underlying procedure interface is `s.serviceRequest`:

```ts
s.serviceRequest({
  serviceType: sql.lit`help`,
  operation: sql.lit`search`,
  requestJson: sql`json_build_object('query', 'estimate calculation', 'limit', 10)`,
  defResultJsonScalar: "help_results",
  defErrorJsonScalar: "help_error",
});
```

Operations are `search` (`{query, limit?}`), `read` (`{documentId}`), and
`media` (`{mediaId}`). Media returns `{mimeType, blobHash}`: Studio and its
system share blob storage, so the consuming app serves the blob itself. Only
images/videos attached to help sections are retrievable. No arbitrary Studio
artifacts are exposed.

Production calls its own Studio's `/api/service/help` over UDS using internal
routing, with no credentials or additional authentication. Local Studio previews
use the existing in-process bridge to the same endpoint. Reads are Hot-only,
with a 30-second timeout and a 128-MiB response limit.

Media URLs in document responses are relative to the consuming application:
`/api/spark/help-media/{mediaId}`. Spark's existing per-app API registration adds
this route alongside attachment routes. It uses the application's existing
Spark access and cookie, fetches media from Studio, and returns it to the
browser; users do not need a Studio account or session. Custom-cookie apps use
the existing `registerSparkAttachmentUploadApi` registration. Removing the
attachment invalidates its URL. The route serves the blob Studio names with
`returnBlob`, which answers the range requests video seeking needs, and falls
back to returned bytes for older Studio versions. Responses are
`private, max-age=31536000, immutable`, because a media ID always names the
same file. Nothing is copied.
