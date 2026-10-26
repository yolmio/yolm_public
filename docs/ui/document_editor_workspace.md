---
title: Document Editor Workspace
description: Compose a document editor with a live PDF preview and configurable information tabs.
tags:
  - ui
  - components
  - documents
related:
  - ui/field_form_control.md
  - ui/pdf_markup.md
  - ui/tabs.md
  - ui/form.md
---

# Document Editor Workspace

`DocumentEditorWorkspace` (`components/document_editor_workspace`) puts an
editor or document view (children) beside a sticky sidebar holding a live PDF
`preview` and extra `tabs`. The panes stack below the `xl` breakpoint.
Switching tabs keeps the editor mounted. Tab panels mount only while
selected unless `keepMounted: true` (which also preserves their internal
drafts); otherwise keep that state in a surrounding `Data` or `Form`.

```tsx
import { DocumentEditorWorkspace } from "components/document_editor_workspace";
import { RichTextSimpleEditor } from "components/lexical/components/lexical_editor";
import { Data } from "std/data";
import { sql } from "std/sql_utils";

<Data
  local
  noRefetch
  procedure={(s) => {
    s.defScalar(
      "document_body",
      sql`lexical_simple_paragraph('Start writing.')`,
    );
  }}
>
  <DocumentEditorWorkspace
    sidePanelWidth="360px"
    preview={{
      value: sql`document_body`,
      fileName: "Document.pdf",
      render: (s, value) => {
        s.renderTypst({
          template: sql.lit`document_workspace`,
          data: sql`cast(json_build_object('body', ${value}) as string)`,
          outputFormat: "pdf",
          defPdfOutputScalar: "document_pdf",
        });
        return sql`'data:application/pdf;base64,' || bytes.to_base64(document_pdf)`;
      },
    }}
    tabs={[{
      value: "details",
      label: "Details",
      content: <p>Document information goes here.</p>,
    }]}
  >
    <RichTextSimpleEditor
      value={sql`document_body`}
      onChange={(s, value) => s.setScalar("document_body", value)}
      onChangeDebounceMs={0}
      documentFormatting
      stickyToolbar
    />
  </DocumentEditorWorkspace>
</Data>;
```

Runnable example: `examples/lexical/components/document_workspace.tsx`
(route `/document-workspace`, template
`examples/lexical/templates/document_workspace.typ`, with
`system.useTypstLib("lexical_document")`). A returned `data:` URL must be
allowed in the app's CSP because the PDF viewer fetches it:

```tsx
system.app({
  securityHeaders: {
    contentSecurityPolicy: {
      additionalSources: { "connect-src": ["data:"] },
    },
  },
  // ...app configuration
});
```

## Workspace props

| Prop             | Purpose                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `children`       | Editor, read-only document, or comparison view.                                                                                                         |
| `preview`        | Required live PDF configuration, below.                                                                                                                 |
| `tabs`           | Additional `{ value, label, content, when?, keepMounted? }` panels. Keys must be unique; `preview` is reserved. `when` is a runtime Boolean expression. |
| `defaultTab`     | Initial selection, default `preview`. Must name a configured tab.                                                                                       |
| `sidePanelWidth` | Desktop width as a CSS length, default `320px`.                                                                                                         |
| `sidePanelLabel` | Accessible sidebar label, default `Document side panel`.                                                                                                |
| `className`      | Additional classes on the layout container.                                                                                                             |

If the selected tab becomes unavailable, the first available tab shows; the
requested tab is restored when it becomes available again unless the user has
picked another. With no available tabs the sidebar is hidden.

## Preview configuration

| Prop               | Purpose                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `value`            | SQL expression for the current unsaved document.                                                |
| `render(s, value)` | Emits a server procedure and returns a SQL expression for its PDF URL. Data URLs are supported. |
| `when`             | Whether preview is available for this document; defaults to true.                               |
| `ready`            | Wait for the form/document to load; defaults to true.                                           |
| `blocked`          | Pause rendering while images or other dependencies are pending.                                 |
| `watch`            | Additional SQL expressions that invalidate the PDF, such as a template or record ID.            |
| `debounceMs`       | Delay after a change before rendering, default 800 ms.                                          |
| `label`, `title`   | Tab label and preview heading; default `PDF preview` and `PDF layout`.                          |
| `fileName`         | Viewer filename, default `Document.pdf`.                                                        |
| `errorMessage`     | Content shown when rendering or PDF loading fails. A retry button is included.                  |
| `height`           | Viewer CSS height, default `min(640px, calc(100vh - 10rem))`.                                   |

Rendering behavior:

- Renders only while the preview tab is selected, `ready`, and not `blocked`.
- Captures `value` before the debounce and ignores superseded results.
- A null or empty URL counts as a failure. Every accepted render reloads the
  viewer, even for the same URL, and keeps the last viewed page where it still
  exists.
- `render` is a `UiServerStatements` procedure: enforce permissions and
  resolve media there, read content only from the captured `value` (bundle
  other snapshot-sensitive inputs into it), and do not save or mutate the
  document.

The caller owns saving, validation, approval rules, and media uploads. With a
`Form`, pass the field helper's `.value` as `preview.value`, use the form's
load flag for `ready`, and keep `LexicalJsonFieldFormControl` with normal form
submission. No particular schema or editor is required; each instance has its
own UI state and PDF viewer handle.
