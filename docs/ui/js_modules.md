---
title: JS Modules
description: Loading additional JavaScript bundles in the browser via useJsModule.
tags:
  - ui
  - javascript
  - performance
---

# JS Modules

Most Yolm UIs ship as serialized YOM, with no per-app JavaScript. Components
such as rich text editors, listbox navigation, uploads, and scanners use
browser JavaScript. `useJsModule` declares those dependencies during render, so
the surrounding app ships a module only when something opted in.

## `useJsModule(id, opts?)`

```typescript
import { useJsModule } from "std/js_modules";

function RichTextField() {
  useJsModule("lexical_editor");
  return /* ... */;
}
```

- It is idempotent, so every dependent component can call it. The first
  registration of an `id` wins, including its `assetUrl`.
- It must run during app rendering (while `system.renderingApp` is set);
  otherwise it throws.
- `{ assetUrl }` loads the module from a non-default URL, such as a CDN or a
  per-tenant override.

## App-Level Modules

For globally needed modules, or custom components that do not call
`useJsModule`, declare `system.app({ jsModules })`:

```tsx
import { getAssetUrl } from "std/yolm_gen_api";

system.app({
  domain: "app.example.com",
  jsModules: [
    { id: "http_file_upload", assetUrl: getAssetUrl("http_file_upload.js") },
    { id: "qr_scanner", assetUrl: getAssetUrl("qr_scanner.js") },
    { id: "signature_pad" },
  ],
  ui: <App />,
});
```

`id` must be a `JsModuleId`. `assetUrl` overrides where the browser loads the
bundle from; omit it to use the framework default for built-in modules.

## Available IDs

`JsModuleId` is the shipped-module union. Available modules include:

- `lexical_editor` — Lexical rich-text editor.
- `listbox_nav` — keyboard navigation for `Menu`, `Select`, `Tabs`.
- `monaco_editor` — Monaco code editor.
- `csv_upload` / `parquet_upload` / `database_upload` /
  `reference_upload` / `export_upload` — bulk import/export pipelines.
- `http_file_upload` — file uploads through HTTP-backed flows.
- `pdf_markup` — PDF markup and annotation UI.
- `file_reader` / `file_system` — DOM-side file IO.
- `qr_scanner` / `hardware_scanner` — barcode/peripheral support.
- `signature_pad`, `web_push`, and file viewers such as `docx_viewer`,
  `spreadsheet_viewer`, `tiff_viewer`, and `image_viewer`.
- `video_player` — Video.js playback for
  [`VideoPlayer`](./video_player.md).

Use `JsModuleId`/autocomplete for the exact current list.

Components usually declare their own modules, so you rarely call
`useJsModule` directly. Call it from a custom component that wraps a
browser library, so the component's users don't have to. A component that
uses a module may become interactive only after a short delay while the
module loads.

## See also

- [Differences from React](../concepts/differences_from_react.md) —
  why generation-time and runtime are separate.
- [YOM](../concepts/yom.md) — the static model that's served to clients.
