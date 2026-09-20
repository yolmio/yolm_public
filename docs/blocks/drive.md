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

`DriveBlock` is the common file-system foundation for standalone company
workspaces and record-owned file collections. It owns file identity, folders,
ordering, immutable technical versions, tags, trash, access, uploads, and
authorized byte delivery.

Format-specific representations and governed workflows are extensions. The
package currently includes:

- `PdfMarkupExtension`: version-anchored annotations and page rotations.
- `ImageViewerExtension`: client-side zoom, pan, fit, and rotation for common
  raster image formats.
- `OutlookMessageViewerExtension`: client-side Outlook `.msg` parsing with
  message headers, body, and downloadable attachments.
- `TiffViewerExtension`: bounded, page-at-a-time TIFF decoding with page,
  zoom, pan, and rotation controls.
- `SpreadsheetViewerExtension`: read-only XLSX, XLSM, and XLS sheet browsing;
  cached values are shown without running formulas, macros, or external links.
- `ArchiveViewerExtension`: ZIP directory and size inspection without
  extracting entries.
- `DocxViewerExtension`: a sanitized, sandboxed HTML preview derived in the
  browser; complex Word pagination can differ from the original.
- `P7mViewerExtension`: CMS signature-integrity and embedded-payload inspection.
  It deliberately reports certificate trust as unevaluated because browser
  parsing has no system-specific trust or revocation policy.
- `NativeDocumentExtension`: rich-text content stored as immutable file
  versions.
- `MarkdownDocumentExtension`: exact raw Markdown stored against immutable
  versions, with a source editor and rendered preview.
- `ExternalLinkExtension`: validated HTTPS targets stored as immutable,
  blobless file versions.
- `DriveDerivations`: background, versioned transformations of immutable file
  versions into one retained blob per derivation row.
- `NativeDocumentReviewExtension`: exact-version anchored review threads for
  controlled native documents.
- `ControlledFileLifecycle`: structured revision, review, approval, and
  publication over an ordinary file.
- `TrainingDriveExtension`: the seam through which `TrainingBlock` attaches
  settings and assignments to governed Drive files.

This separation is intentional. Installing Drive does not add PDF, CAD,
manufacturing, OCR, or document-approval tables to systems that do not use
those capabilities.

## Invariants

- A space is the authorization and search boundary.
- Every space has one immutable, code-defined type.
- A space type owns ordering, extensions, and its access predicates.
- A space is either standalone or bound to exactly one owning domain record.
- Every item has one canonical parent. A null parent means the space root.
- File item IDs remain stable while content changes.
- Technical content is append-only in `file_versions`.
- The first technical version establishes a file's normalized content type;
  later versions cannot change representation.
- A file's `current_file_version_id` is the editable working head.
- Workflow and markup records reference exact `file_version` IDs.
- Blob hashes live only in `blobRef` columns. Drive never calls
  `removeBlob`; platform reference tracking owns physical blob collection.
- Extension viewers, hooks, UI, and mutations are active only on types that
  install the extension.
- `organization` means authenticated organization members, not an
  unauthenticated public link.

## Schema

| Table | Responsibility |
| --- | --- |
| `file_spaces` | Named authorization/search roots, immutable type, and optional standalone ownership. |
| Type binding table | Direct space FK plus domain FK, such as project or matter, contributed by a record-bound type. |
| `file_items` | Stable folder/file identity, parent, name, order, working head, and trash state. |
| `file_versions` | Immutable content metadata and technical version sequence. |
| `file_version_blobs` | Optional, exact `blobRef` payload for one version. |
| `external_link_file_versions` | Optional, exact HTTPS target for one external-link version. |
| `file_tags` | Space-local taxonomy. |
| `file_tag_assignments` | Tags attached to stable file/folder identity. |
| `file_space_user_grants` | Direct grants for standalone or opted-in spaces. |
| `file_space_permission_grants` | AuthBlock permission mapped to a Drive access level. |
| `file_derivations` | Optional extension table with one typed, recipe-versioned derived blob per row. |

Native files can have no blob. For example,
`NativeDocumentExtension` stores its representation in
`native_document_file_versions`, keyed one-to-one to `file_versions`.
`MarkdownDocumentExtension` uses the same pattern with
`markdown_file_versions(file_version_id, content)`. It is intentionally text
storage, not a blob upload: prompt-like Markdown is bounded to 1 MiB and can be
assembled directly in SQL, while ordinary large files continue through
Drive's chunked blob upload.
`ExternalLinkExtension` uses the same pattern: its URL is stored in
`external_link_file_versions`, and editing the target appends a new technical
version without changing the stable file item.
Hierarchy operations traverse the canonical `parent_file_item_id` with
recursive queries. Drive intentionally does not materialize an ancestor table
until observed scale demonstrates that one is necessary.

## Derived files

`DriveDerivations` installs one `file_derivations` table. A definition matches
an immutable current source version, and one generic seed reactor creates every
declared flat artifact row. One processing call may atomically publish several
named outputs—for example `<format>_duckdb`, viewer manifest, viewer scene or
GLB, and artifact manifest. Each result keeps its own blob hash and optional
content type; optional representations become `unavailable`, while a failed
required output fails the entire artifact set. The same seed path covers
existing files, new versions, and recipe bumps; it does not depend on an upload
hook or scheduled scan.

Recipe versions are part of row identity. Increasing a recipe creates new rows
without changing older results or the meaning of evidence linked to them.
For a fixed immutable source and recipe version, returned CAD object keys are
stable evidence identifiers: cache rebuilds must reproduce the same keys and
meaning. A parser or model change that cannot preserve them requires a new
recipe version rather than replacing the cache behind existing evidence.
Derived blob routes reuse Drive's exact-version authorization. Processing
failures are terminal until a user with write access calls the authenticated
`files_retry_derivation` procedure; retry resets the definition's complete
artifact set to `pending` so it is republished atomically.

## Minimal setup

~~~tsx
import { AuthBlock } from "blocks/auth";
import {
  DriveBlock,
  driveSpaceOwner,
  type DriveSpaceType,
} from "blocks/drive";
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

Install the endpoints in each app that must upload or serve file bytes:

~~~tsx
import { DriveBlock } from "blocks/drive";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import { drive } from "../core";

system.app({
  ui: (
    <>
      <DriveBlock.Endpoints files={drive} cookieName={sql.lit`y-t`} />
      {/* app UI */}
    </>
  ),
});
~~~

`DriveBlock.Endpoints` uses the current app's domain and installs authenticated
endpoints for direct and chunked uploads,
replacement versions, and exact-version reads. The default upload ceiling is
2 GiB. Files above 16 MiB are sliced directly from the browser `File` into
8 MiB requests with bounded concurrency and retry; the browser does not read
or copy the complete file into application memory. The workspace reports
progress and lets the user cancel an active upload.

`DriveBlock` options also include:

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `maxUploadBytes` | `number` | 2 GiB | Maximum accepted upload size for the registered Drive endpoints. |
| `enforceSiblingNameConstraint` | `boolean` | `true` | Rejects sibling files/folders with the same name. Disable only when the runtime cannot enforce the constraint. |

## Space types

A space type is the complete definition of one kind of Drive. It specifies its
binding, ordering, enabled extensions, and access strategy. Use a record-bound
type when access belongs to a project, matter, customer, docket, or other
domain record:

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
    read: (_space, binding, userId) =>
      projectAccess.canView(binding, userId),
    write: (_space, binding, userId) =>
      projectAccess.canManage(binding, userId),
  },
};

export const drive = new DriveBlock({
  spaceTypes: [projectSpace],
});
~~~

The type owns the domain FK and authorization expressions. Drive adds a unique
`file_space_id` directly to its binding table. `validate()` requires the
type-defined domain FK set to be unique so one domain record cannot acquire
multiple spaces. Call `ensureBoundSpace` with the type object from the owning
record's page or creation flow; it returns the same space on later calls.

Standalone types omit `tableName` and `define`. Access is never selected by a
stored mode. The type supplies `read`, optional `write`, and optional `manage`
predicates. Missing `write` denies writes; missing `manage` falls back to
`write`. This makes project authorization, organization membership, and
private ownership ordinary system SQL instead of hidden Drive strategies.

For an organization-visible policy library:

~~~tsx
const policies: DriveSpaceType = {
  name: "policies",
  itemOrdering: "name",
  lifecycle: documentControl,
  extensions: [nativeDocuments, nativeDocumentReview],
  access: {
    read: (_space, _binding, userId) =>
      organizationAccess.isActiveMember(userId),
    write: (_space, _binding, userId) =>
      AuthBlock.userHasPermission(sql.lit`can_manage_drive`, userId),
  },
  canCreate: (userId) =>
    AuthBlock.userHasPermission(sql.lit`can_manage_drive`, userId),
};
~~~

`blobUploads` defaults to `true`. Set it to `false` for representation-only
spaces (for example Spark's raw-Markdown workspace); Drive then removes upload
controls and rejects both new-file and replacement-version blob endpoints for
that type.

For a private personal area with explicit sharing:

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

Set `owner: true` only when that type uses `owner_user_id`. Set `grants.users`
or `grants.permissions` only when the type's access predicates compose
`driveUserGrantAccess` or `drivePermissionGrantAccess`. Use the combined
`driveGrantAccess` only when both grant kinds are enabled. Drive emits each
grant table independently and emits neither when no type opts in.
`FileSpacePermissionsPanel` accepts the space-type object and shows only the
configured grant kinds. Permission grants name an Auth permission, so normal
direct, sourced, and role-based Auth resolution still applies.

~~~tsx
drive.createSpace(s, {
  type: policies,
  name: sql.lit`Policies and training`,
  sysUserId: sql`current_user`,
  into: "policy_space_id",
});
~~~

`createSpace` always receives the declared type object and evaluates its
`canCreate` callback. Bound types use `ensureBoundSpace` instead. Drive does
not grant `can_manage_drive` any implicit access: include that Auth predicate
only in types where it is part of the product policy.

## Workspace and viewer

`DriveWorkspace` supplies:

- folder navigation and space-wide search;
- file-type icons, last-modified date and actor, and subtree file counts on
  folders in the item list;
- case-insensitive filename ordering by default;
- optional persistent custom ordering;
- multi-file select, drag/drop, paste, progress, and chunked upload;
- optional extension-owned creation controls, such as New Markdown document;
- replacement-version upload;
- editable item descriptions;
- rename and cycle-safe moves;
- space-local tags;
- subtree trash and conflict-safe restore;
- immutable version history and exact-version downloads.

Use `DriveFileUploadButton` when a product needs a focused, single-file intake
instead of folder navigation. It uploads directly into a known space and
optional parent folder, then resolves the created file item through the
product-provided href.

`FileViewer` resolves the current immutable version by default, or an explicit
`fileVersionId` when a governed publication or training assignment must remain
pinned. It asks only viewers enabled for the space's type, in declared
extension order. If no enabled extension recognizes the MIME type, it presents
the authorized file bytes.

With `readOnly={true}`, `presentation="governed"`, and an explicit version,
the viewer retains authorized access even if the working item is trashed.
Version permissions still apply. Governed PDF workspaces stay on that pinned
document rather than including neighboring working-folder files.

`DriveWorkspace` accepts `bulkActions(selectedTable)` to render product actions
alongside its selection toolbar. The callback receives the existing selection
table name; each action must validate its own permissions before changing data.

`DriveViewerWorkspace` turns that registry into a full-height, viewer-first
surface. `DriveViewerNavigation` supplies a complete folder tree and the
selected folder's files for an application's existing `Sidebar.Root`; it does
not render a second page-local sidebar. Product routes own the back target and
file hrefs, while viewer contributions own only the selected file's display.

`ImageViewerExtension` recognizes AVIF, BMP, GIF, JPEG, PNG, and WebP.
`OutlookMessageViewerExtension` recognizes the Outlook MIME types and `.msg`
filenames. Messages are fetched and parsed only in the browser; parsed fields
are not persisted. HTML message bodies run in a sandboxed iframe with remote
resources disabled, which prevents ordinary email tracking images and scripts
from loading through the preview.

The TIFF, spreadsheet, ZIP, DOCX, and P7M viewers follow the same transient,
client-side extension pattern. Each enforces format-specific preview limits
and reuses Drive's authorized exact-version byte URL. The DOCX viewer makes a
sanitized HTML derivative in memory; the P7M viewer separates cryptographic
signature integrity from certificate-chain trust and never claims the latter.
Their download control always returns the original source file.

`components/file_preview` owns the shared filename toolbar and preview notices.
It reuses package buttons, the sheet selector, and the ZIP search input; browser
modules expose actions and emit state changes instead of creating controls.
TIFF navigation, zoom, and rotation share the download bar. P7M exposes a
separate signed-file download there when the original document is included.
The companion `components/file_preview_styles` owns all presentation for these
five preview bodies, using theme tokens and scoped part selectors. Decoder
modules label rendered parts and update only runtime geometry (canvas transforms,
virtualized rows, and folder depth). Spreadsheet dimensions come from the
component's CSS variables. The component also supplies DOCX page styles to its
sandboxed frame; the decoder resolves theme variables without removing isolation.

Each preview extension has its own browser module, so applications load only
the implementation they use. Pass `assetUrl` for an explicit module location;
otherwise Drive uses the registered CDN build when one exists and the matching
system asset while a module is still local.

Extensions can receive:

- `onVersionCreated`, after a technical version becomes the working head;
- `onItemMoved`, after the item's canonical parent changes;
- `canReadVersion`, to narrow exact-version access for governed content;
- `registerApi`, for authenticated representation-specific endpoints;
- a viewer contribution with a MIME predicate and UI renderer.

Drive invokes hooks only for types that install their extension. Hooks execute
in the caller's transaction. Throwing rolls back the upload, save, or move,
which lets workflow extensions enforce location policy.

### Ordering

Ordering belongs to the space type:

~~~tsx
const drawingSet: DriveSpaceType = {
  name: "drawing_set",
  itemOrdering: "custom",
  extensions: [pdfMarkup],
  owner: true,
  access: {
    read: (space, _binding, userId) => driveSpaceOwner(space, userId),
    write: (space, _binding, userId) => driveSpaceOwner(space, userId),
  },
};
~~~

Custom ordering exposes drag-and-drop plus keyboard-friendly earlier/later
controls only in spaces of that type. Drive stores a fractional order within
each folder, and the PDF workspace traverses that same persisted order.
Name-ordered types ignore `sort_order`; renaming changes visible position. One
Drive installation can therefore host curated drawing sets and ordinary policy
or personal spaces without compromising either experience.

## PDF markup

`PdfMarkupExtension` stores:

| Table | Responsibility |
| --- | --- |
| `pdf_markup_sets` | One markup context for one exact file version. |
| `pdf_markup_revisions` | Immutable optimistic-lock annotation revisions. |
| `pdf_page_rotations` | Persisted quarter-turn rotation per exact version/page. |

Markup never follows the file item's working head. A replacement PDF starts
with clean markup because its page geometry may differ. The PDF workspace uses
the selected file's ordered folder siblings, shared virtualized renderer, and
bounded canvas budget, so neither page count nor folder size implies one live
canvas per page. Folder manifests carry lightweight markup URLs; annotation
JSON and rotations load only when the user reaches that PDF.

Normal markup editing follows Drive write access. A controlled space can
provide `canEditVersion` to grant an assigned reviewer markup and rotation
access to only the exact in-review version. That capability does not grant
uploads, rename, move, or any other Drive mutation.

`PdfMarkupDriveWorkspace` is the folder-scoped embedding used by the generic
`FileViewer` contribution. In workspace mode it loads the selected PDF's
ordered folder siblings so toolbar and scroll-boundary document changes keep
the mounted renderer, zoom, and active tool. Product sidebar navigation must
flush dirty markups before leaving the active PDF; use
`savePdfWorkspaceMarkupsThen` as the `DriveViewerNavigation.onNavigate` hook.

Spark capabilities can expose the same saved visual presentation without
reimplementing Drive lookup, authorization, context resolution, or rendering:

~~~tsx
import { sparkDriveFileSource } from "blocks/spark/drive";

const projectFileSource = sparkDriveFileSource({
  name: "project_files",
  files: drive,
  spaceTypes: [drawingSet],
  pdfMarkup,
});
~~~

Add `projectFileSource` to a Spark capability's `fileSources` and list the
Drive version table in that capability's readable tables. `readFileImage`
then defaults to the saved annotated presentation, while
`renderMode: "original"` bypasses composition. Sources with `pdfMarkup` also
expose `readFileMarkup({ source, id, page? })` for structured annotation and
rotation data. Both tools enforce Drive's version-read policy.

## External links

Install `ExternalLinkExtension` only on space types that should contain URL
backed files:

~~~tsx
import { ExternalLinkExtension } from "blocks/drive/external_link";

const externalLinks = new ExternalLinkExtension();
const policies: DriveSpaceType = {
  name: "policies",
  itemOrdering: "name",
  extensions: [nativeDocuments, externalLinks],
  access: { /* ... */ },
};
~~~

Create links through `externalLinks.createLink(...)`. Only absolute HTTPS
URLs with a valid authority are accepted. `ExternalLinkViewer` opens the
stored target and, for writable files, saves target edits as immutable new
versions.

## Native documents and Document Control

`NativeDocumentExtension` makes rich text one possible file representation.
Every save appends a technical version and preserves the stable file item,
folder, tags, and references. Its authoring surface uses the shared Word-style
ribbon, page canvas, formatting controls, tables, links, images, undo/redo,
word count, and character count. Embedded images use Drive's bounded chunked
blob upload rather than loading the complete image into UI memory.

`NativeDocumentReviewExtension` is an optional companion for controlled
spaces. It adds only two tables: exact-version anchored threads and append-only
replies. Assigned reviewers and validators can create, reply to, resolve, and
reopen threads while the revision is in review. Each thread records both its
controlled revision and exact file version, so a later approval cycle that
starts from unchanged content cannot inherit the earlier review's discussion.
The same evidence remains read-only after review. Systems that install native
documents without review do not receive these tables.

`ControlledFileLifecycle` is workflow over a file, not another file store. It
adds:

- controlled identity and language variants;
- an immutable controlled-revision history;
- exact file-version checkpoints within a draft;
- ordered reviewers and decisions;
- approval and publication evidence;
- a published revision pointer independent of the working head.

Document Control is a lifecycle selected by a space type. Every file in that
type follows the lifecycle; ordinary Drive space types remain ordinary file
systems without workflow tables or controls. Creating a file in a controlled
space automatically creates its default-language draft. While a draft is open,
each native save or
replacement upload advances that draft to the new exact version and records a
checkpoint. The draft owner submits a proposal without choosing approvers. A
document-control validator then selects the ordered approval route and starts
review. Proposed, in-review, and approved content is locked. A validator may
add or remove pending reviewers during review, but completed review steps stay
immutable and an in-review revision must retain a pending reviewer. After
publication, a viewer can start a new controlled revision and edit only the
draft they initiated. Before any reviewer decides, a validator can undo review,
return it to the proposed state, and clear its reviewer route so the route can
be rebuilt. A validator can also disregard a proposed, in-review, or approved
proposal; this closes it as rejected while retaining reviewer decisions and
other audit evidence. Disregarding requires a reason and records the responsible
actor and UTC timestamp so history distinguishes an administrative disregard
from a reviewer's rejection.

`proposalCoordinator` is an opt-in lifecycle configuration for products with a
named intake authority. It supplies that authority's display name and a SQL
authorization predicate for assigning reviewers and starting review. Products
can also supply `canReceiveProposal` to require that at least one authorized
coordinator is active and can access the proposal before the draft is handed
off. When it is omitted, `can_manage_controlled_files` and the standard
document-control validator terminology remain unchanged. Publication continues
to require `can_manage_controlled_files` unless the lifecycle supplies a
`canPublish` predicate, allowing a product to keep final publication with the
same named authority or a different capability.

Products can register a `ControlledFileWorkflowConsumer` for proposal
submission, review start, reviewer removal, route advancement, and review
decisions. Reviewer-removal events identify the removed actor and whether they
were current so products can resolve stale tasks. These hooks run inside the
lifecycle transaction and are intended for product-owned side effects such as
durable Inbox notifications. Publication notifications can use the existing
publication-consumer hook.

Document Control permissions are capabilities:

| Permission | Capability |
| --- | --- |
| `can_manage_controlled_files` | Validate proposals, assign reviewers, start review, and publish. |
| `can_review_controlled_files` | Decide a currently assigned review step. |

They do not bypass the Drive space boundary. A user must first pass the
space's read predicate. Any reader can propose in a controlled space. That
narrow capability permits creating a file and
new versions of the viewer's own draft; it does not permit folder creation,
rename, move, trash, tagging, or other Drive edits. Ordinary viewers can read
only the current effective publication plus drafts they initiated. Assigned
reviewers and validators can read the exact working revision needed by their
workflow. Published access follows the Drive space type. For example, an
organization policy space can give active organization members viewer access,
while a project space can inherit access from the project. Document Control
does not add a second document-level ACL.

`ControlledFileLibrary` is the employee-facing publication surface. It
searches Drive names, descriptions, and tags, resolves the preferred published
language with a default-language fallback, and links to
`PublishedControlledFile`. The reader renders the revision's exact
technical version rather than the file's working head.

Use `ControlledFileWorkspace` for authoring. It composes the exact working
revision with `ControlledFilePanel`, permits only one open language revision
for a controlled file, and lets a draft fork a new immutable technical version
from that language's last publication. This keeps English and translated
working content independent even though they share one stable Drive file
identity. Review, approval, publication, history, and training readers stay
read-only.

## Training composition

`TrainingDriveExtension` connects `TrainingBlock` to a space type that already
has `ControlledFileLifecycle` and `NativeDocumentExtension`. Training keeps its
own course, audience, assignment, assessment, acknowledgment, notification,
and compliance tables. File identity, folders, languages, revisions, content,
review, and publication stay in Drive.

Publication consumers run in the same transaction as controlled publication.
Training resolves the participant's preferred published language, falls back
to the configured default language, and pins assignments and course resources
to exact controlled revisions. A later publication can therefore create or
advance an open obligation without rewriting historical completion evidence.
See [Training Block](training.md) for the complete composition.

## Reference implementation

`examples/drive` is a runnable standalone workspace with native documents,
PDF markup, direct sharing, tags, Document Control, and multilingual
publication. `examples/document_training` adds the complete TrainingBlock
composition. A production system can compose the same generic components into
several space types, for example:

- the company knowledge library uses name ordering, organization-wide reading,
  native/PDF viewers, bilingual control, policy search, and training;
- the company file space uses name ordering and ordinary native/PDF files
  without controlled workflow;
- project workspaces use custom ordering, folder traversal, PDF markup, and
  inherited project access.

When migrating a legacy file model, a transform may preserve each legacy file
ID as the initial immutable `file_versions.id`, allowing existing foreign keys
to continue naming exact bytes without an identity-link table. Preserve blob
hashes and metadata deliberately; legacy drawings/specifications can become
ordinary folders when folder roles are not part of the target model.
