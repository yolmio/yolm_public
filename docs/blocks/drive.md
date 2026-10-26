---
title: Drive Block
description: Versioned file spaces, folders, explicit access, immutable versions, and composable file capabilities.
tags:
  - blocks
  - files
  - documents
  - permissions
  - pdf
related:
  - blocks/auth.md
  - blocks/training.md
  - concepts/blocks.md
---

# Drive Block

`DriveBlock` is the file-system foundation for standalone workspaces and
record-owned file collections. It owns file identity, folders, ordering,
immutable technical versions, tags, trash, access, uploads, and authorized byte
delivery. Format-specific viewers and governed workflows are opt-in extensions,
so systems that do not use them get no PDF, CAD, or approval tables.

## Extensions

| Extension | Import | Adds |
| --- | --- | --- |
| `PdfMarkupExtension` | `blocks/drive/pdf_markup` | Version-anchored annotations and page rotations. |
| `ImageViewerExtension`, `VideoViewerExtension`, `OutlookMessageViewerExtension`, `TiffViewerExtension`, `SpreadsheetViewerExtension`, `ArchiveViewerExtension`, `DocxViewerExtension`, `P7mViewerExtension` | `blocks/drive` | Client-side previews; no tables. |
| `CadViewerExtension` | `blocks/drive` | CAD viewer over derived artifacts. |
| `NativeDocumentExtension` | `blocks/drive/native_document` | Rich text stored as immutable file versions. |
| `MarkdownDocumentExtension` | `blocks/drive` | Raw Markdown versions with source editor and preview. |
| `ExternalLinkExtension` | `blocks/drive/external_link` | Validated HTTPS targets as blobless versions. |
| `DriveDerivations` | `blocks/drive` | Background, recipe-versioned derived blobs. |
| `NativeDocumentReviewExtension` | `blocks/drive/native_document_review` | Exact-version review threads for controlled native documents. |
| `ControlledFileLifecycle` | `blocks/drive/controlled_lifecycle` | Revision, review, approval, and publication (Document Control). |
| `TrainingDriveExtension` | `blocks/training` | Seam for `TrainingBlock` settings and assignments on governed files. |

## Invariants

- A space is the authorization and search boundary, with one immutable,
  code-defined type that owns ordering, extensions, and access predicates.
- A space is either standalone or bound to exactly one owning domain record.
- Every item has one canonical parent; null means the space root.
- File item IDs are stable while content changes. Technical content is
  append-only in `file_versions`. The first version fixes the file's normalized
  content type; later versions cannot change representation unless an installed
  extension explicitly permits compatible formats for that space.
- `current_file_version_id` is the editable working head. Workflow and markup
  records reference exact `file_version` IDs.
- Blob hashes live only in `blobRef` columns. Drive never calls `removeBlob`;
  platform reference tracking owns physical blob collection.
- Extension viewers, hooks, UI, and mutations are active only on types that
  install the extension.
- `organization` means authenticated organization members, not an
  unauthenticated public link.

## Owned tables

| Table | Purpose |
| --- | --- |
| `file_spaces` | Authorization/search roots with immutable type and optional owner. |
| Type binding table | Declared by a record-bound type (`tableName`); Drive adds a unique `file_space_id`. |
| `file_items` | Stable folder/file identity, parent, order, working head, trash state. |
| `file_versions` | Immutable content metadata and technical version sequence. |
| `file_version_blobs` | Optional `blobRef` payload for one version. |
| `file_tags`, `file_tag_assignments` | Space-local taxonomy on stable items. |
| `file_space_user_grants` | Direct user grants; emitted only if a type sets `grants.users`. |
| `file_space_permission_grants` | Auth permission mapped to an access level; emitted only if a type sets `grants.permissions`. |

Representation extensions key their own table one-to-one to `file_versions`
instead of storing a blob: `native_document_file_versions`,
`markdown_file_versions` (raw text bounded to 1 MiB, so it can be assembled in
SQL), and `external_link_file_versions`. Editing any of them appends a version
without changing the stable item. Hierarchy operations use recursive queries
over `parent_file_item_id`; there is no ancestor table.

## Minimal setup

~~~tsx
import { AuthBlock } from "blocks/auth";
import { DriveBlock, driveSpaceOwner, type DriveSpaceType } from "blocks/drive";
import { PdfMarkupExtension } from "blocks/drive/pdf_markup";
import { sql } from "std/sql_utils";
import { system } from "std/system";

system.addBlock(new AuthBlock({
  permissions: DriveBlock.permissions,
  appAuthTypes: ["email_password"],
}));

export const pdfMarkup = new PdfMarkupExtension();
export const drawingSet: DriveSpaceType = {
  name: "drawing_set",
  displayName: "Drawing set",
  itemOrdering: "custom",
  extensions: [pdfMarkup],
  owner: true,
  canCreate: (userId) => sql`${userId} is not null`,
  access: {
    read: (space, _binding, userId) => driveSpaceOwner(space, userId),
    write: (space, _binding, userId) => driveSpaceOwner(space, userId),
  },
};
export const drive = new DriveBlock({ spaceTypes: [drawingSet] });
system.addBlock(drive);
~~~

Each app that uploads or serves bytes must render the endpoints:

~~~tsx
<DriveBlock.Endpoints files={drive} cookieName={sql.lit`y-t`} />
~~~

They use the current app's domain and install authenticated direct, chunked,
replacement-version, and exact-version read endpoints. Files above 16 MiB are
sliced from the browser `File` into 8 MiB requests with bounded concurrency
and retry; the workspace shows progress and supports cancel.

| Option | Default | Meaning |
| --- | --- | --- |
| `maxUploadBytes` | 2 GiB | Upload ceiling for the registered endpoints. |
| `enforceSiblingNameConstraint` | `true` | Rejects same-named siblings. Disable only when the runtime cannot enforce it. |

See `DriveBlockOpts` and `DriveSpaceType` in `packages/blocks/drive/types.ts`.

## Space types

A space type defines binding, ordering, extensions, lifecycle, and access.
Record-bound types declare their binding table and domain FK:

~~~tsx
const projectSpace: DriveSpaceType = {
  name: "project",
  tableName: "project_file_space_bindings",
  define: (table) => {
    table.fk("project_id", "projects").notNull().unique().onDelete("Cascade");
  },
  itemOrdering: "custom",
  extensions: [pdfMarkup, cad],
  access: {
    read: (_space, binding, userId) => projectAccess.canView(binding, userId),
    write: (_space, binding, userId) => projectAccess.canManage(binding, userId),
  },
};
~~~

- `validate()` requires the domain FK set to be unique, so one record cannot
  acquire multiple spaces. Call `drive.ensureBoundSpace(s, { type, values,
  name })` from the owning record's page or creation flow; it returns the same
  space on later calls.
- Standalone types omit `tableName` and `define` and are created with
  `drive.createSpace(s, { type, name, sysUserId, into })`, which evaluates the
  type's `canCreate` (omitted means code-created only). Each method rejects the
  other kind of type.
- Access is never a stored mode. `read` is required; missing `write` denies
  writes; missing `manage` falls back to `write`. A standalone type receives the
  space record as both the first and second callback arguments.
- Drive grants `can_manage_drive` no implicit access; include
  ``AuthBlock.userHasPermission(sql.lit`can_manage_drive`, userId)`` only where
  it is product policy.
- `blobUploads: false` (default `true`) removes upload controls and rejects
  new-file and replacement blob endpoints, for representation-only spaces.
- `itemOrdering: "custom"` stores a fractional order per folder with
  drag-and-drop and earlier/later controls; the PDF workspace traverses that
  order. `"name"` ordering ignores `sort_order`, so renaming moves the item.

Private spaces with explicit sharing compose owner and grant predicates:

~~~tsx
import { driveGrantAccess, driveSpaceOwner } from "blocks/drive";

const personal: DriveSpaceType = {
  name: "personal",
  itemOrdering: "name",
  extensions: [nativeDocuments],
  owner: true,
  grants: { users: true, permissions: true },
  access: {
    read: (space, _binding, userId) =>
      sql`${driveSpaceOwner(space, userId)}
        or ${driveGrantAccess(space, userId, "viewer")}`,
    write: (space, _binding, userId) =>
      sql`${driveSpaceOwner(space, userId)}
        or ${driveGrantAccess(space, userId, "editor")}`,
  },
  canCreate: (userId) => sql`${userId} is not null`,
};
~~~

Set `owner: true` only when the type uses `owner_user_id`. Set `grants.users`
or `grants.permissions` only when the predicates compose `driveUserGrantAccess`
or `drivePermissionGrantAccess`; use `driveGrantAccess` only when both are
enabled. `FileSpacePermissionsPanel` takes the type and shows only its
configured grant kinds. Permission grants resolve through normal Auth
direct, sourced, and role-based permissions.

## Components

All from `blocks/drive` unless noted.

| Export | Purpose |
| --- | --- |
| `DriveWorkspace` | Folder navigation, search, uploads, versions, tags, trash, rename/move. |
| `DriveFileUploadButton` | Single-purpose upload into a known space/folder. |
| `FileViewer` | Renders a file through the type's enabled viewers. |
| `DriveViewerWorkspace`, `DriveViewerNavigation` | Full-height viewer-first surface; navigation renders into the app's `Sidebar.Root`. |
| `FileSpacePermissionsPanel` | Direct-grant management for a space. |
| `ControlledFileLibrary`, `PublishedControlledFile` | Employee-facing published library and reader. |
| `ControlledFileWorkspace`, `ControlledFilePanel` | Controlled revision authoring and workflow. |
| `CreateMarkdownDocumentButton`, `MarkdownDocumentEditor` | Markdown creation control and source/preview editor. |
| `ExternalLinkViewer` (`blocks/drive/external_link`) | Opens the target; writable files save edits as new versions. |

`DriveWorkspace` (see `DriveWorkspaceProps` in `workspace.tsx`):

- Download appears only when the displayed version has bytes. Version history
  uses `fileVersionHref` when provided; otherwise only blob versions link.
- `bulkActions(selectedTable)` renders product actions in the selection
  toolbar; each action must validate its own permissions.
- Pass `initialFolderId` from a page-declared BigInt query parameter together
  with `folderQueryParam`; use distinct names for multiple workspaces. The
  workspace offers Copy folder link, Copy link, and Copy version link while
  preserving the route and other parameters. Native versions without a blob
  need an application `fileVersionHref`. Links grant no permissions and are
  distinct from expiring signed transfer URLs; an upload POST URL is not a
  browser upload page.
- `published={{ control, preferredLanguage }}` shows only each file's preferred
  published revision (default-language fallback) and defaults to read-only;
  rows, totals, and details use that revision's immutable version. Set
  `readOnly={false}` to keep permission-controlled management. Switching
  between published and working views (for example with `Show`, gating the
  working view with server-side permissions and passing the current folder via
  `initialFolderId`) remounts the workspace, clearing selection, details,
  search, and trash; trash exists only in the working view.

`DriveFileUploadButton` can target a product-owned authenticated
`uploadEndpoint` that returns the usual `itemId`/`versionId` response, with
`multiple` for batches and `onUploaded` to close a dialog before navigation.

`FileViewer` resolves the working head unless `fileVersionId` is pinned. It
asks enabled viewers in declared extension order and falls back to the
authorized bytes. With `readOnly={true}`, `presentation="governed"`, and an
explicit version, it keeps access even if the working item is trashed (version
permissions still apply), and a governed PDF workspace stays on that document.

Preview viewers are transient and client-side: nothing parsed is persisted,
each enforces format limits, and download always returns the original source.
Outlook HTML bodies run in a sandboxed iframe with remote resources disabled.
The spreadsheet viewer shows cached values without running formulas, macros, or
external links. DOCX pagination can differ from Word. P7M reports signature
integrity but certificate trust as unevaluated. Each viewer loads its own
browser module; pass `assetUrl` to override the registered CDN build or local
system asset. Shared toolbar and styling come from `components/file_preview`
and `components/file_preview_styles`.

## Extension hooks

A `DriveExtension` (see `packages/blocks/drive/types.ts`) can provide
`onVersionCreated`, `canReadVersion` (narrows exact-version access), narrow
`canCreateFile`/`canCreateVersion`/`canUpdateItemMetadata` grants,
`registerApi`, and a viewer contribution. Hooks run only for types that
install the extension, inside the caller's transaction; throwing rolls back
the upload or save.

`writeVersionContent` persists representation data before `onVersionCreated`
callbacks. `canChangeVersionContentType` can allow compatible replacements for
explicitly configured spaces; upload preflight and the version writer both
apply this policy. `versionUploadMetadataError` returns a workspace-specific
validation error (or null) at both boundaries, before any version is inserted.

## Derived files

`DriveDerivations` adds `file_derivations`: one typed, recipe-versioned
derived blob per row. One seed reactor creates rows for every matching current
source version, covering existing files, new versions, and recipe bumps without
upload hooks or scans. One processing call may publish several named outputs
atomically; optional outputs become `unavailable`, while a failed required
output fails the whole set.

- Recipe version is part of row identity; bumping it adds rows without
  changing older results or linked evidence.
- For a fixed source and recipe, returned CAD object keys are stable evidence
  identifiers. A change that cannot preserve them needs a new recipe version.
- Derived blob routes reuse exact-version authorization.
- Failures are terminal until a writer calls `files_retry_derivation`, which
  resets the definition's whole artifact set to `pending`.

## PDF markup

| Table | Purpose |
| --- | --- |
| `pdf_markup_sets` | Markup context for one exact file version. |
| `pdf_markup_revisions` | Immutable optimistic-lock annotation revisions. |
| `pdf_page_rotations` | Quarter-turn rotation per exact version/page. |

Markup never follows the working head; a replacement PDF starts clean. Editing
follows Drive write access, but `canEditVersion` can grant an assigned reviewer
markup and rotation on only the exact in-review version, with no other Drive
mutation. The workspace virtualizes pages under a bounded canvas budget and
loads annotations only when a PDF is reached. When product sidebar navigation
leaves a PDF, use `savePdfWorkspaceMarkupsThen` as the
`DriveViewerNavigation.onNavigate` hook so dirty markups are flushed.

Spark can read the saved annotated presentation through
`sparkDriveFileSource` from `blocks/spark/drive`:

~~~tsx
const projectFileSource = sparkDriveFileSource({
  name: "project_files",
  files: drive,
  spaceTypes: [drawingSet],
  pdfMarkup,
});
~~~

Add it to a capability's `fileSources` and list the Drive version table as
readable. `readFileImage` defaults to the annotated presentation
(`renderMode: "original"` bypasses it), and sources with `pdfMarkup` expose
`readFileMarkup({ source, id, page? })`. Both enforce version-read policy.

## Document Control

`NativeDocumentExtension` appends a version on every save; embedded images use
chunked blob upload. `ExternalLinkExtension` accepts only absolute HTTPS URLs
with a valid authority via `externalLinks.createLink(...)`.

Native documents accept an optional `renderPage` callback receiving
`{ children, fileVersionId, controlledRevisionId?, pageId, pdfHref? }`. It wraps the editable body and is also used
by read-only viewers and native review comments. Keep letterheads, publication
metadata, and footers outside `children`. Resolve lifecycle metadata against
`controlledRevisionId` together with `fileVersionId`: distinct controlled revisions
can share a technical version. Uncontrolled viewers omit the revision context.
Use `NativeDocumentSheet` for the default layout.

`standardFormatting: true` uses shared Noto Sans document typography and semantic
headings, emphasis, lists, and tables. It removes custom inline fonts, sizes,
colors, backgrounds, and spacing from creation, saves, paste, and display; the
editor hides those controls. Normalize export content with the same extension's
`normalizeContent` method (or `fn.lexical_standard_document`).

For published video resources, configure
`new ExternalLinkExtension({ videoSpaceTypes: ["company"] })` and install that
instance on the named space. Those spaces accept YouTube and Vimeo video links
using `application/vnd.yolm.video-link`; they permit versions to switch between
supported uploaded video formats and video links. Other file formats and spaces
retain their existing content-type restrictions. URL content uses the existing
`external_link_file_versions` table and is written before lifecycle callbacks.
`createLink` and `saveLink` accept an optional `language` for published variants.
`PublishedFilesWorkspace` and `PublishedFilePage` expose link creation, preview,
and replacement when the space enables this option.
Apps rendering these videos must also allow the player origins in their
[Content-Security-Policy](../ui/video_player.md#embedded-video-links).

Video URLs are validated on the server and embedded using a derived provider
URL. Vimeo unlisted hashes are preserved. Arbitrary HTML, unsupported hosts,
and playlists are rejected. Saved links preserve the reference; availability
and the content served at that reference remain controlled by the provider.

`ControlledFileLifecycle` is selected with a space type's `lifecycle`; every
file in that type follows it. It adds language variants, immutable controlled
revisions, exact-version draft checkpoints, ordered reviewers and decisions,
approval/publication evidence, and a published pointer independent of the
working head.

Workflow:

1. Creating a file starts its default-language draft; each save or replacement
   advances the draft to the new version and records a checkpoint.
2. The draft owner submits a proposal without choosing approvers. A validator
   selects the ordered route and starts review. Proposed, in-review, and
   approved content is locked.
3. A validator may add or remove pending reviewers; completed steps stay
   immutable and an in-review revision must keep a pending reviewer. Before
   any decision, a validator can undo review back to proposed and clear the
   route.
4. A validator can disregard a proposed, in-review, or approved proposal. It
   closes as rejected, keeps decisions, and requires a reason; actor and UTC
   time distinguish it from a reviewer rejection.
5. After publication, a viewer can start a new revision and edit only the
   draft they initiated. Only one language revision per file may be open.

| Permission | Capability |
| --- | --- |
| `can_manage_controlled_files` | Validate proposals, assign reviewers, start review, publish. |
| `can_review_controlled_files` | Decide a currently assigned review step. |

These never bypass the space read predicate. Any reader can propose: create a
file and new versions of their own draft, but not folders, rename, move,
trash, or tags. Ordinary viewers see only the current publication and their
own drafts; reviewers and validators see the exact working revision they need.
Document Control adds no document-level ACL.

`ControlledFileLifecycleOpts` (in `controlled_lifecycle.tsx`) also accepts
`proposalCoordinator` (a named intake authority with `canConfigureReview` and
optional `canReceiveProposal`) and `canPublish` (otherwise
`can_manage_controlled_files`). A `ControlledFileWorkflowConsumer` receives
submission, review start, reviewer removal (with removed actor and whether
current), route advancement, and decisions inside the lifecycle transaction;
publication uses the publication-consumer hook.

`ControlledFileLifecycle.registerReviewerTarget(field, table)` lets Training
reuse the ordered reviewer records for its translation review requests. It adds
a nullable target FK, keeps the existing policy FK and identities, and enforces
exactly one owner plus unique reviewer/order within each target. Consumers use
the configured actor provider rather than assuming actor IDs are user IDs.
`controlled_file_record_review_decision` shares ordered-decision validation and
writes; each workflow checks its own permissions and state in the caller's
transaction and owns its publication and notifications. Drive-only systems keep
the original required policy reference and do not acquire training schema.

`NativeDocumentReviewExtension` adds exact-version anchored threads and
append-only replies. Each thread records its controlled revision and file
version, so a later cycle on unchanged content does not inherit it.

`ControlledFileLibrary` searches names, descriptions, and tags, resolves the
preferred language with default fallback, and renders the revision's exact
version; optional `parentItemId` restricts to one folder (SQL NULL is root).
Folder placement belongs to the stable item and survives approval.
`ControlledFileWorkspace` lets a draft fork a new version from that language's
last publication, keeping translations independent within one file identity.

### Files published on upload

For a manager-maintained resource library without approvals, configure
`ControlledFileLifecycleOpts.publishOnUpload(spaceId)` for that space and render
`PublishedFilesWorkspace` / `PublishedFilePage` from `blocks/drive/published_files`.
Space write permission authorizes publishing these uploads; review and approval
records are not created. Other spaces using the lifecycle keep their approval
workflow. Restrict the workspace and Drive read permission to its managers.

The workspace uploads PDFs and videos (MP4, WebM, Ogg, and MOV) in the default
language and adds translations to the same file identity. Add
`VideoViewerExtension` to the space to preview videos with the shared player.
Uploads use Drive's chunked HTTP transport; replacing a language version creates
and publishes its controlled revision atomically. JPEG, PNG, GIF, and WebP images use only the default language
and are shared across training languages. Replacements retain immutable versions
and trigger the usual publication consumers. Existing Drive content-type rules
apply: replacing a file cannot change its MIME type.

New uploads and replacements enforce the workspace's allowed MIME types before
accepting bytes. Replacement endpoints validate filenames, MIME compatibility, and supported
languages before accepting upload bytes, including during chunk initialization.
The version writer repeats the authoritative checks inside the transaction.
For programmatic published replacements, pass `language` to `createFileVersion`;
the lifecycle creates and publishes the revision within that writer invocation.

### Importing approved revisions

Call `ControlledFileLifecycle.importPublishedRevision` in the transaction that
creates the item and its first version, with revision label, effective date,
language, and optional approval reference. The actor needs publication
authority and read/write space access. Only a new initial draft with one
version and no reviewers qualifies. The approval reference goes into
`change_summary`; internal approval fields stay empty; publication consumers
(including Training) run.

For a translation: on the same item, `createRevision` for the language, append
the uploaded version, then `importPublishedRevision` with `sourceRevisionId`
(an exact published, possibly superseded, default-language revision) in one
transaction. Only the language's first revision with no review history
qualifies.

## Training composition

`TrainingDriveExtension` requires a space type with `ControlledFileLifecycle`
and `NativeDocumentExtension`. Training keeps its own course, assignment, and
compliance tables; publication consumers run in the publication transaction
and pin assignments to exact revisions in the participant's preferred
language. See [Training Block](training.md).

Training uses the native document's `renderPage` and formatting contract for
assigned readings, supporting documents, and course previews. It passes the
selected controlled revision, even when revisions share a file version, and
keeps image requests on Training's authorized routes. An optional
`renderAuthorizedPdf` hook renders that exact revision after Training verifies
task or translation-review access. The hook receives `fileVersionId`,
`controlledRevisionId`, and `intoBytes`; perform rendering outside a transaction.
Layouts receive `pdfHref` for the caller-authorized export route. Do not replace
Training authorization with broader Drive access checks.

## Gotchas

- When migrating a legacy file model, a transform may reuse each legacy file
  ID as the initial `file_versions.id` so existing foreign keys keep naming
  exact bytes. Preserve blob hashes and metadata deliberately.
- Reference: `examples/drive` (standalone workspace, native documents, PDF
  markup, sharing, Document Control) and `examples/document_training`.
