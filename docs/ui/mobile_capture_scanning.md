---
title: Mobile Capture And Scanning
description: How to build Yolm mobile workflows with QrScanner, camera photo uploads, bytes endpoints, image galleries, PWA setup, and scan confirmation state.
tags:
  - ui
  - mobile
  - scanner
  - camera
  - pwa
related:
  - ui/progressive_web_apps.md
  - api/files_blobs_exports.md
  - api/overview.md
  - ui/operational_ui.md
---

# Mobile Capture And Scanning

Build mobile workflows that scan QR codes, confirm physical work, capture
photos, and show image evidence.

## App Setup

Mobile scanner apps need:

- a PWA manifest and mobile icons,
- `logoGeneration: { type: "Custom" }` when assets are provided,
- app-level auth,
- full-screen layouts with fixed headers and large touch targets,
- URL routes for scan, detail, review, and success states.

See [Progressive Web Apps](./progressive_web_apps.md) for manifest details.

## QrScanner

Import `QrScanner` from `components/qr_scanner`. Use `mode="explicit"` when a
scan must be resolved and confirmed before changing workflow state. Typical
state is local `Data`:

```tsx
<Data local procedure={(s) => {
  s.defScalar("scanner_open", sql.false);
  s.defScalar("scan_phase", sql.lit`scanning`);
  s.defScalar("scan_candidate_value", sql.lit``);
  s.defScalar("scan_error", sql.lit``);
}}>
  <Show when={sql`scanner_open`}>
    <QrScanner
      mode="explicit"
      scanPhase={sql`scan_phase`}
      candidateValue={sql`scan_candidate_value`}
      errorMessage={sql`scan_error`}
      onClose={(s) => s.setScalar("scanner_open", sql.false)}
      onDetect={(s, scannedValue) => {
        s.setScalar("scan_candidate_value", scannedValue);
        s.setScalar("scan_phase", sql.lit`candidate`);
      }}
      onConfirm={(s) => {
        s.setScalar("scan_phase", sql.lit`confirmed`);
      }}
      onScan={(s, scannedValue) => {
        s.tryServer({ body: (s) => {/* update workflow */} });
      }}
    />
  </Show>
</Data>
```

Use `mode="automatic"` when a recognized code can call `onScan` immediately.
Set `enableAudio={false}` or `enableVibration={false}` for quiet environments.

Key `QrScanner` props:

| Prop | Required | Description |
|------|----------|-------------|
| `mode` | Yes | `"explicit"` for confirm-first flows, `"automatic"` for immediate scan handling. |
| `onScan` | Yes | DOM handler called with `(s, scannedValue)`. Do validation and server updates here, or after explicit confirmation. |
| `onClose` | Yes | DOM handler for closing the full-screen scanner. |
| `onDetect` | Explicit mode | DOM handler called with `(s, scannedValue, isCameraScan)` before confirmation; resolve display info here. |
| `scanPhase` | No | SQL scalar for scanner phase such as scanning/candidate/confirmed. |
| `candidateValue` | No | SQL scalar holding the current candidate code. |
| `detectMessage` / `confirmMessage` | No | SQL message shown in explicit/automatic confirmation UI. |
| `scanning` | No | SQL boolean for in-progress state. |
| `errorMessage` / `onClearError` | No | Error text and clear handler. |
| `onManualEntry` | No | Camera-error fallback called with a trimmed manually entered scan value. |
| `manualEntryLabel` / `manualEntryPlaceholder` | No | Text for the optional manual-entry fallback. |
| `captureEndpoint` | No | SQL URL for uploading a captured image as bytes after confirmation. |
| `onUploadComplete` / `onUploadFailed` | No | DOM handlers for photo upload result. |
| `itemCount` | No | SQL count displayed in the scanner UI. |
| `enableAudio` / `enableVibration` | No | Static booleans; both default to enabled. |

## Scan-To-Photo Confirmation

For photo proof, pass `captureEndpoint`; the scanner uploads image bytes there
and calls the upload callbacks.

```tsx
<QrScanner
  mode="explicit"
  scanPhase={sql`scan_phase`}
  candidateValue={sql`scan_candidate_value`}
  captureEndpoint={sql`'/api/confirm-scan?item_id=' || scan_candidate_value`}
  onUploadComplete={(s) => {
    s.setScalar("scanner_open", sql.false);
    s.refetch();
  }}
  onUploadFailed={(s) => {
    s.setScalar("scan_error", sql.lit`Upload failed`);
  }}
  onScan={(s, scannedValue) => {
    s.setScalar("scan_candidate_value", scannedValue);
  }}
  onClose={(s) => s.setScalar("scanner_open", sql.false)}
/>
```

The endpoint should use `bytesBodyScalar`, `s.createBlob`, store the blob hash
and content type, then return success/error. Review pages can show images with
`ImageGallery`; serve URLs through an endpoint that calls `s.returnBlob(...)`.

## Photo Capture Dialogs

For camera capture outside QR scanning, use the same module pattern: mount a
full-screen modal, initialize the camera, upload to an endpoint, and handle
events in local `Data`. Keep camera state local; persist only blob hash and
content type.

## Image Display

- `ExpandableImage` from `components/expandable_image` turns one thumbnail into
  a modal full-size image.
- `ImageGallery` from `components/image_gallery` wraps a custom thumbnail grid
  and provides modal next/previous navigation.

```tsx
<ImageGallery
  count={sql`(select count(*) from db.photos)`}
  getImageSource={(index) => sql`'/api/photos/' || (
    select id from db.photos order by captured_at limit 1 offset ${index}
  )`}
>
  <Each table="photos" recordName="photo" orderBy={sql`captured_at`}>
    <img
      src={sql`'/api/photos/' || photo.id`}
      onClick={(s) => ImageGallery.open(s, sql`photo.iteration_index`)}
    />
  </Each>
</ImageGallery>
```

Serve image URLs through an API endpoint that sets `Content-Type`,
`Cache-Control`, and calls `s.returnBlob(...)`.

## QR Workflow Rules

- Store QR version or validity state when stickers can be reprinted or revoked.
- Treat every scan as a workflow event: validate current state, write an
  activity/tracking row, and update lifecycle status in one transaction.
- Return `409` for stale, duplicate, or invalid state transitions.
- Keep user-facing scan messages in `ui.*` or local `Data` state.
- Add tests for duplicate scans, stale codes, missing records, and successful
  state transitions.
