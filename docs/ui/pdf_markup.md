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

`components/pdf_markup` renders PDFs in the app. `PdfMarkupViewer` is
read-only with page navigation and zoom; `PdfMarkupEditor` adds pen,
highlight, and text-note annotations saved by a server handler.
`PdfWorkspaceViewer` / `PdfWorkspaceEditor` do the same for an ordered set of
PDFs.

```tsx
import {
  changePdfWorkspaceDocument,
  downloadFlattenedPdf,
  PdfMarkupEditor,
  PdfMarkupViewer,
  PdfWorkspaceEditor,
  PdfWorkspaceViewer,
  setPdfWorkspaceDocuments,
} from "components/pdf_markup";
```

Each component loads the `pdf_markup` JS module and wraps itself in a `local`
`Data` for toolbar state. Do not call `useJsModule("pdf_markup")` or add a
`Data`/`Form` for its state; an outer `Data` only fetches the values you pass
in.

## Single file

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
/>
```

`PdfMarkupViewer` takes the same props without `onSave`, `onChange`, `tools`,
`initialTool`, `disabled`, and `saveLabel`.

Non-obvious props:

- SQL-valued (runtime): `fileUrl`, `annotations` (JSON array, default `[]`),
  `fileName` (download name, default `marked-up.pdf`), `initialPage`
  (1-based), `initialFocus` (a rendered-pixel crop to frame on open),
  `handle`, and the editor's `disabled`.
- Generation-time: `height` (default `calc(100vh - 150px)`, min `520px`),
  `className`, `showToolbar` (default `true`), `allowDownloadFlattened` (adds
  a "Download Marked-Up PDF" toolbar button), `tools`, `initialTool`, and
  `saveLabel` (default `"Save Markups"`).
- `handle` is auto-generated when omitted. Pass a stable value to target the
  component from `downloadFlattenedPdf` or the workspace helpers.
- `tools` defaults to `["hand", "select", "pen", "highlight", "text"]`;
  `initialTool` defaults to `"select"`. `PdfMarkupTool` is
  `"hand" | "select" | "pen" | "highlight" | "text"`.
- `pdfJsUrl`, `pdfJsWorkerUrl`, and `pdfJsWasmUrl` override the bundled pdf.js
  assets.

See `PdfMarkupViewerProps`, `PdfMarkupEditorProps`, and the workspace
`PdfWorkspace*Props` in `components/pdf_markup` for the full contract.

## Save handler and events

`onSave` is a `PdfMarkupSaveHandler`, `(s: UiServerStatements, event:
PdfMarkupSaveEvent) => void`, and runs on the server when the user saves.
The component does **not** open a transaction; wrap the writes yourself. On
success the dirty state clears and a "Saved" alert shows. A thrown error
shows in a `danger` alert above the PDF.

`PdfMarkupSaveEvent` fields are SQL expressions:

| Field | Meaning |
|---|---|
| `annotations` | JSON array to persist. Write this, not `payload`. |
| `changeSequence` | Client mutation sequence captured with `annotations`. It keeps a finished save from clearing newer edits. |
| `revision` | Optimistic revision of the active document (workspaces). |
| `documentKey`, `documentIndex`, `documentCount`, `fileName` | Active document identity. Single-file components use key `"document"`. |
| `fileItemId`, `contextKey`, `canEdit` | Pass-through values from the workspace descriptor. |
| `page`, `pageCount`, `dirty`, `handle`, `payload` | Viewer state and raw result JSON. |

`onReady`, `onPageChange`, `onChange`, `onError`, and workspace
`onDocumentChange` are client-side `PdfMarkupEventHandler`s
(`(s: DomStatements, event: PdfMarkupEvent)`). `PdfMarkupEvent` has the
same fields without `annotations` or `changeSequence`. Only `onSave` and
`onRotationChange` run on the server.

## Workspaces

Workspace components take one runtime JSON array, `documents`, in place of the
file props. Each descriptor has a stable `key`, `fileUrl`, and `fileName`. It
may also carry `annotations`, `revision`, `rotations`, `page`, `href`,
`fileItemId`, `contextKey`, and `canEdit` (`false` makes that document
read-only). For large sets, use `dataUrl` instead of inline markup: the
workspace fetches it when the document opens. The endpoint returns
`{ annotations, revision, rotations }`, where `rotations` is an array of
`{ page, quarterTurns }`.

```tsx
<PdfWorkspaceEditor
  handle={sql.lit`project-file-markup-editor`}
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
    // Persist event.annotations for event.documentKey; check event.revision.
  }}
  onRotationChange={(s, event) => {
    // Persist event.quarterTurns for event.documentKey and event.page.
  }}
/>
```

Workspace behavior:

- Only the active PDF and its markup data are loaded. Switching documents
  releases the previous PDF.js resources. If there are unsaved markups,
  `onSave` must succeed before the switch.
- Page navigation continues across document boundaries.
- When a descriptor has `href`, the workspace replaces the browser URL with it
  after the document opens and keeps matching external file-rail links in sync.
- With `revision` locking, `onSave` must increment the stored revision by
  exactly one. The workspace advances its in-memory revision by one after a
  successful save.
- `showDocumentNavigation={false}` hides the built-in document navigation for
  pages where a file rail selects documents. From the rail, call
  `changePdfWorkspaceDocument(s, handle, documentKey, targetPage?)`, where
  `targetPage` is a number, SQL, or `"last"`, so the save guard still applies.
- `setPdfWorkspaceDocuments(s, handle, documents, initialDocumentKey?,
  resultJsonScalar?)` replaces the document set in place and keeps the
  viewer, tool, and zoom. It discards unsaved edits, so flush them first.
- Rotation: `PdfWorkspaceViewer` supports transient rotation with
  `allowRotation`. `PdfWorkspaceEditor` shows rotation controls only when
  `onRotationChange` is supplied. The page turns at once, the server handler
  runs, and a failure restores the previous orientation.
  `PdfMarkupRotationEvent` adds `quarterTurns`, `previousQuarterTurns`, and
  an opaque `requestId`.

All four components virtualize pages: every page gets a placeholder, but at
most five PDF and markup canvas pairs stay rendered, under a 128 MiB canvas
budget.

## Flattened download

`allowDownloadFlattened` adds a toolbar button. From your own control, call
`downloadFlattenedPdf(s, handle, fileName)` with the component's explicit
`handle`. `fileName` is positional and required; pass `undefined` to use the
default. The export fetches the PDF bytes on demand and is built in the
browser.

```tsx
<Button
  variant="outlined"
  startIcon="Download"
  onClick={(s) =>
    downloadFlattenedPdf(
      s,
      sql.lit`project-file-markup-editor`,
      sql`markup_file.file_name`,
    )}
>
  Download Marked-Up PDF
</Button>
```

## Common mistakes

- Omitting `onSave` on an editor (it is required); use a viewer for read-only
  display.
- Persisting `event.payload` instead of `event.annotations`.
- Forgetting the transaction in `onSave`.
- Calling `downloadFlattenedPdf` without an explicit `handle` on the component,
  or with only two arguments.
- Passing SQL to generation-time props such as `tools`, `saveLabel`, or
  `height`.
