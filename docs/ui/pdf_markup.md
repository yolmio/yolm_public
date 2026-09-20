---
title: PdfMarkup
description: In-browser PDF viewer and annotation editor with pen, highlight, and text tools, page navigation, and SQL-bound save handlers.
tags:
  - ui
  - components
  - pdf
  - annotations
related:
  - ui/overview.md
  - ui/data.md
  - ui/js_modules.md
  - ui/button.md
---

# PdfMarkup

`components/pdf_markup` renders a PDF inside the app. Use `PdfMarkupViewer` for
read-only display with page navigation and zoom, and `PdfMarkupEditor` to add
pen, highlight, and text-note annotations and persist them through a server
handler. Use `PdfWorkspaceViewer` and `PdfWorkspaceEditor` when users need to
move through an ordered set of PDFs without leaving the viewer.

```tsx
import {
  changePdfWorkspaceDocument,
  downloadFlattenedPdf,
  PdfMarkupEditor,
  type PdfMarkupRotationEvent,
  type PdfMarkupSaveEvent,
  PdfMarkupViewer,
  PdfWorkspaceEditor,
  PdfWorkspaceViewer,
} from "components/pdf_markup";
```

Both components register their own JS module (`useJsModule("pdf_markup")`) and
wrap themselves in a `local` `Data` scope that holds toolbar/UI state. You do
not register the module or add a surrounding `Data`/`Form` yourself. Any outer
`Data` only exists to fetch the `fileUrl` / `annotations` values you pass in.

## Usage

Editor that loads a PDF, shows existing annotations, and saves edits on the
server. `onSave` runs as a server statement; `event.annotations` is the JSON to
persist. Wrap the writes in a transaction inside the handler.

```tsx
<PdfMarkupEditor
  handle={sql.lit`project-file-markup-editor`}
  fileUrl={sql`'/api/project-files/' || cast(markup_file.id as string)`}
  annotations={sql`markup_file.annotation_json`}
  fileName={sql`markup_file.file_name`}
  height="calc(100vh - 96px)"
  onSave={(s, event) => {
    s.startTransaction();
    s.modify(sql`
      update db.project_file_annotations
      set annotation_json = coalesce(${event.annotations}, '[]'::json)
      where project_file_id = ui.markup_file_id
    `);
    s.commitTransaction();
  }}
/>;
```

Read-only viewer:

```tsx
<PdfMarkupViewer
  fileUrl={sql`'/api/project-files/' || cast(file.id as string)`}
  annotations={sql`file.annotation_json`}
  fileName={sql`file.file_name`}
/>;
```

## Ordered PDF Workspaces

Workspace components accept one runtime JSON array instead of individual file
props. Each document has a stable `key`, PDF URL, and name. For a workspace that
can grow, use `dataUrl` to lazy-load that document's annotations, optimistic
`revision`, and optional per-page quarter-turn rotations only when the document
opens:

```tsx
<PdfWorkspaceEditor
  documents={sql`
    coalesce((
      select json_array_agg(json_build_object(
        'key', cast(file.id as string),
        'fileUrl', '/api/project-files/' || cast(file.id as string),
        'fileName', file.file_name,
        'revision', coalesce(annotation.version_number, 0),
        'dataUrl',
          '/api/project-files/' || cast(file.id as string) || '/markup-data',
        'href', '/project-files/' || cast(file.id as string) || '/markup'
      ) order by file.created_at desc)
      from db.project_files file
      left join db.project_file_annotations annotation
        on annotation.project_file_id = file.id
    ), json_build_array())
  `}
  initialDocumentKey={sql`cast(ui.selected_file_id as string)`}
  onSave={(s, event) => {
    // Persist event.annotations for event.documentKey, comparing event.revision.
  }}
  onRotationChange={(s, event) => {
    // Persist event.quarterTurns for event.documentKey and event.page.
  }}
/>;
```

The `dataUrl` endpoint returns an object with `annotations`, `revision`, and
`rotations`; the latter is an array of `{ page, quarterTurns }`. Small
workspaces can put those same fields directly on each descriptor instead.
Descriptors may include `href`; after a document opens, the workspace replaces
the browser URL with it and keeps matching external file-rail links synchronized
so refresh and copied links target the active file.

The workspace loads only its active PDF and active markup data. Switching
documents destroys the previous PDF.js loading task and page resources. If the
active document has unsaved markups, the editor runs `onSave` successfully
before it switches. Page navigation crosses document boundaries at the first and
last page. Set `showDocumentNavigation={false}` when a surrounding file rail is
the workspace's document navigator; call `changePdfWorkspaceDocument` from that
rail so the same save guard still applies. When `revision` is used for
optimistic locking, `onSave` must increment it by one; after a successful save
the workspace advances its in-memory revision by the same amount.

All four components virtualize page surfaces. They keep lightweight
dimension-aware placeholders for every page, but retain at most five rendered
PDF/markup canvas pairs under a 128 MiB canvas budget. Flattened downloads fetch
the active PDF bytes only when requested and build the export in the browser;
source and output buffers therefore exist only for the duration of an export.

`PdfWorkspaceViewer` shares the workspace props and can enable transient page
rotation with `allowRotation`. `PdfWorkspaceEditor` shows rotation controls only
when `onRotationChange` is supplied, because edited rotations must be persisted.

## Shared Props

`PdfMarkupViewer` and `PdfMarkupEditor` share these props. Runtime values such
as `fileUrl`, `annotations`, `fileName`, `initialPage`, and `handle` are `Sql`
expressions (several also accept a plain string literal); `showToolbar`,
`allowDownloadFlattened`, `height`, and `className` are generation-time config.

| Prop                     | Type                    | Required | Description                                                                                                                     |
| ------------------------ | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `fileUrl`                | `Sql \| string`         | Yes      | URL of the PDF to load.                                                                                                         |
| `handle`                 | `Sql \| string`         | No       | Stable id for this viewer instance. Auto-generated if omitted; pass an explicit value to target it from `downloadFlattenedPdf`. |
| `annotations`            | `Sql`                   | No       | JSON array of existing annotations to render. Defaults to `[]`.                                                                 |
| `fileName`               | `Sql \| string`         | No       | File name used for the flattened download. Defaults to `marked-up.pdf`.                                                         |
| `initialPage`            | `Sql`                   | No       | 1-based page to open on. Defaults to `1`.                                                                                       |
| `height`                 | `string`                | No       | CSS height of the PDF mount. Defaults to `calc(100vh - 150px)` (min `520px`).                                                   |
| `className`              | `string`                | No       | Class applied to the outer frame.                                                                                               |
| `showToolbar`            | `boolean`               | No       | Show the built-in toolbar. Default `true`.                                                                                      |
| `allowDownloadFlattened` | `boolean`               | No       | Add a "Download Marked-Up PDF" button to the toolbar. Default off.                                                              |
| `pdfJsUrl`               | `Sql \| string`         | No       | Override the bundled pdf.js module URL.                                                                                         |
| `pdfJsWorkerUrl`         | `Sql \| string`         | No       | Override the bundled pdf.js worker URL.                                                                                         |
| `onReady`                | `PdfMarkupEventHandler` | No       | Runs when the viewer finishes loading.                                                                                          |
| `onPageChange`           | `PdfMarkupEventHandler` | No       | Runs when the current page changes.                                                                                             |
| `onError`                | `PdfMarkupEventHandler` | No       | Runs when loading or rendering fails.                                                                                           |

## PdfMarkupEditor Props

In addition to the shared props, the editor adds:

| Prop          | Type                    | Required | Description                                                            |
| ------------- | ----------------------- | -------- | ---------------------------------------------------------------------- |
| `onSave`      | `PdfMarkupSaveHandler`  | Yes      | Server handler that persists annotations. See below.                   |
| `tools`       | `PdfMarkupTool[]`       | No       | Which tools to show. Default `["select", "pen", "highlight", "text"]`. |
| `initialTool` | `PdfMarkupTool`         | No       | Tool selected on open. Default `"select"`.                             |
| `disabled`    | `BooleanExpr`           | No       | SQL boolean that disables all editing controls.                        |
| `saveLabel`   | `string`                | No       | Label of the save button. Default `"Save Markups"`.                    |
| `onChange`    | `PdfMarkupEventHandler` | No       | Runs client-side whenever annotations change.                          |

`PdfMarkupViewer` takes the shared props only.

`PdfMarkupTool` is `"hand" | "select" | "pen" | "highlight" | "text"`.

Workspace components additionally accept `showDocumentNavigation`; it defaults
to `true`. Turn it off when an external file rail owns document selection.

## Save Handler and Events

The editor's Save button (and a save requested from within the PDF surface)
collects the current annotations, then runs `onSave` on the server. On success
the "dirty" state clears and a `success` "Saved" alert shows; a thrown error is
caught and surfaced in a `danger` alert above the PDF. `onSave` is responsible
for its own transaction (wrap writes in `s.startTransaction()` /
`s.commitTransaction()` as in the example above).

`onSave` has the signature:

```ts
type PdfMarkupSaveHandler = (
  s: UiServerStatements,
  event: PdfMarkupSaveEvent,
) => void;
```

`PdfMarkupSaveEvent` fields (all `Sql` expressions):

| Field            | Description                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `annotations`    | JSON array of annotations to persist. This is what you write to the database.                                                   |
| `changeSequence` | Client mutation sequence captured with `annotations`; the component uses it to avoid clearing newer edits when a save finishes. |
| `page`           | Current page number.                                                                                                            |
| `pageCount`      | Total page count.                                                                                                               |
| `dirty`          | Whether unsaved changes exist.                                                                                                  |
| `handle`         | The viewer handle.                                                                                                              |
| `payload`        | Raw save result JSON.                                                                                                           |
| `documentKey`    | Stable key of the active workspace document. Single-file components use `"document"`.                                           |
| `documentIndex`  | Zero-based position in the workspace.                                                                                           |
| `documentCount`  | Number of documents in the workspace.                                                                                           |
| `fileName`       | Active document name.                                                                                                           |
| `revision`       | Optimistic revision supplied by the active document.                                                                            |

The other handlers (`onReady`, `onPageChange`, `onChange`, `onError`) use:

```ts
type PdfMarkupEventHandler = (
  s: DomStatements,
  event: PdfMarkupEvent,
) => void;
```

`PdfMarkupEvent` carries the same document identity fields plus `handle`,
`payload`, `page`, `pageCount`, and `dirty` (no `annotations`). Workspace
`onDocumentChange` receives this event after a new PDF is ready. These handlers
run client-side; only `onSave` and workspace `onRotationChange` run on the
server.

Persistent rotation is optimistic: the page turns immediately, the editor runs
`onRotationChange`, and a failed server handler restores the prior orientation.
The rotation event includes `quarterTurns`, `previousQuarterTurns`, and an
opaque `requestId`.

An external file rail can request a guarded document change with:

```ts
changePdfWorkspaceDocument(
  s,
  sql.lit`project-file-markup-editor`,
  sql`cast(file.id as string)`,
);
```

## Downloading a Flattened PDF

Set `allowDownloadFlattened` to add a download button to the toolbar, or call
the exported helper from your own control. `fileName` is a positional argument:
pass a value or `undefined` (it is not an optional/omittable parameter).

```ts
downloadFlattenedPdf(
  s: DomStatements,
  handle: Sql | string,
  fileName: Sql | string | undefined,
): void
```

To call it from outside the component you must pass the same `handle` you gave
the editor/viewer:

```tsx
<Button
  variant="outlined"
  color="neutral"
  startIcon="Download"
  onClick={(s) =>
    downloadFlattenedPdf(
      s,
      sql.lit`project-file-markup-editor`,
      sql`markup_file.file_name`,
    )}
>
  Download Marked-Up PDF
</Button>;
```

## Common Mistakes

- Omitting `onSave` on `PdfMarkupEditor` — it is required. Use `PdfMarkupViewer`
  if you only need read-only display.
- Writing `event.payload` to the database in `onSave`. Persist
  `event.annotations` (the annotation JSON array), not the raw payload.
- Forgetting that `onSave` must open its own transaction; the component runs it
  on the server but does not wrap it in one.
- Calling `downloadFlattenedPdf` (or the toolbar download) without giving the
  component a stable `handle`. Without an explicit `handle` the generated id is
  not addressable from an external button.
- Calling `downloadFlattenedPdf` with only two arguments. The `fileName`
  parameter is required; pass an `Sql`/string value or `undefined`.
- Treating `showToolbar`, `allowDownloadFlattened`, `tools`, `initialTool`,
  `saveLabel`, or `height` as SQL — they are generation-time config. Use `Sql`
  for `fileUrl`, `annotations`, `fileName`, `initialPage`, `handle`, and
  `disabled`.
- Manually calling `useJsModule("pdf_markup")` or wrapping the component in an
  extra `Data` for its state — both are handled internally.
