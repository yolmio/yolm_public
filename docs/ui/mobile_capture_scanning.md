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

Mobile workflows that scan QR codes, confirm physical work, capture photos,
and show image evidence.

## App Setup

Mobile scanner apps need:

- a PWA manifest and mobile icons,
- `logoGeneration: { type: "Custom" }` when assets are provided,
- app-level auth,
- full-screen layouts with fixed headers and large touch targets,
- URL routes for scan, detail, review, and success states.

See [Progressive Web Apps](./progressive_web_apps.md) for manifest details.

## Signature capture

Use `SignaturePad` from `components/signature_pad` for shipping signoff,
acknowledgements, or training evidence. It loads the signature browser module,
owns its canvas and cleanup, and passes an image data URL to `onSigned`.
The caller owns persistence, authorization, and any attestation requirement.

```tsx
<SignaturePad
  label="Sign here"
  submitLabel="Confirm signature"
  hideGuideInOutput
  onSigned={(s, image) => s.setScalar("signature_image", image)}
  onClear={(s) => s.setScalar("signature_image", sql.lit``)}
/>
```

`submitDisabled` adds an application-specific condition to the empty-signature
guard. `hideGuideInOutput` removes the signing guide from the exported image;
the default retains it. Each component generates its own unique handle.

## QrScanner

`QrScanner` (`components/qr_scanner`) renders a full-screen camera overlay and
loads the `qr_scanner` JS module itself. Keep scanner state in local `Data`:

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
      onDetect={(s, scannedValue) => {
        s.setScalar("scan_candidate_value", scannedValue);
        s.setScalar("scan_phase", sql.lit`candidate`);
      }}
      onScan={(s, scannedValue) => {
        s.server((s) => {/* validate and update workflow */});
        s.refetch();
      }}
      captureEndpoint={sql`'/api/confirm-scan?item_id=' || scan_candidate_value`}
      onUploadComplete={(s) => {
        s.setScalar("scanner_open", sql.false);
        s.refetch();
      }}
      onUploadFailed={(s) => s.setScalar("scan_error", sql.lit`Upload failed`)}
      onClose={(s) => s.setScalar("scanner_open", sql.false)}
    />
  </Show>
</Data>
```

Non-obvious props (see `QrScannerProps` in `components/qr_scanner`):

| Prop | Notes |
|------|-------|
| `mode` | `"explicit"`: each detection goes to `onDetect` and waits for confirmation. `"automatic"`: a recognized code goes straight to `onScan`. |
| `onScan(s, scannedValue)` / `onClose` | Required DOM handlers. Validate and update the workflow in `onScan` (or after explicit confirmation). This is a raw handler; see [raw event handlers](./data_vs_form.md#raw-event-handlers). |
| `onDetect(s, scannedValue, isCameraScan)` | Explicit mode only. Resolve display info for the candidate here. |
| `scanPhase`, `candidateValue` | SQL scalars for the confirm flow (for example scanning, candidate, confirmed). `onConfirm` / `onReject` react to the user's choice. |
| `detectMessage` / `confirmMessage` | SQL message on the confirmation panel. `detectMessage` applies to explicit mode only; `confirmMessage` to automatic mode only. |
| `scanning`, `errorMessage` / `onClearError`, `itemCount` | SQL in-progress flag, error text and clear handler, and a count shown in the header. |
| `onManualEntry(s, enteredValue)` | Camera-error fallback that receives a trimmed, manually entered value. Label it with `manualEntryLabel` / `manualEntryPlaceholder`. |
| `captureEndpoint` | SQL URL. When set, confirming a scan opens a photo step and uploads the image bytes there. `onUploadComplete` and `onUploadFailed` report the result. |
| `enableAudio` / `enableVibration` | Static booleans, both enabled by default. Disable them for quiet environments. |

The capture endpoint reads the upload with `bytesBodyScalar`, stores it with
`s.createBlob`, persists the blob hash and content type with the scan event,
and returns success or an error. Review pages can show the stored photos with
`ImageGallery` (below), served by an endpoint that calls `s.returnBlob(...)`.
See [Files, blobs, and exports](../api/files_blobs_exports.md) for both
endpoint shapes.

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

Serve image URLs through an API endpoint that sets `Content-Type` and
`Cache-Control` and calls `s.returnBlob(...)`.

## QR Workflow Rules

- Store QR version or validity state when stickers can be reprinted or revoked.
- Treat every scan as a workflow event: validate current state and update
  lifecycle status in one transaction. Write a scan record only when the UI or
  logic reads scan history; transaction queries cover forensics.
- Return `409` for stale, duplicate, or invalid state transitions.
- Keep scan messages and phases in the scanner's local `Data` state, which only
  that subtree can see; see [UI state scope](./overview.md#ui-state-scope).
- Verify duplicate scans, stale codes, missing records, and successful state
  transitions; commit tests for the business rules nothing else covers.
