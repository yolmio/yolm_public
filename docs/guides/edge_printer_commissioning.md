---
title: Edge printer commissioning
description: Diagnose Windows label printing using the Edge service identity, effective paper geometry, actual PDF jobs, device readbacks, and physical acceptance.
tags: [edges, printers, commissioning]
related:
  - ai/forge_edge.md
  - ai/forge_transfers.md
  - concepts/edges.md
---

# Edge printer commissioning

The acceptance path is the application's saved PDF through its configured Edge
instance to the physical printer. A desktop test or native RAW label can isolate
a fault but cannot prove that this PDF path preserves the working device settings.

## Prepare and inspect without printing

1. Record machine, instance, logical destination, driver slot, exact queue, port,
   driver/firmware version, label dimensions, and an approved test PDF's hash.
   Review queued work so testing does not replay production jobs.
2. Run `edgeValidateInstance` and `edgeDriverCheck`. The Windows document check
   reports the printing account/SID and effective GDI dimensions, DPI and offsets
   without submitting a job. Standard shell uses LocalService; an admin shell
   uses the Edge service account. Desktop preferences may be a third profile.
3. Compare the PDF page with the effective paper dimensions. At 203 DPI, 3×1″ is
   609×203 dots and 4×3″ is 812×609 dots. Edge centers pages in the printable area
   and shrinks oversized pages; a 3×1″ PDF on a 3×2″ profile moves down 0.5″.
   Fix the paper profile rather than compensating in the artwork. GDI physical
   offsets and device label-top/left adjustments are separate measurements.
4. Read the printer's actual darkness, speed, relative darkness and override
   policy. Record unavailable values as unknown. Correct only observed differences
   with supported driver/device controls; do not patch undocumented DEVMODE bytes
   or automate desktop dialogs from a service session.

## Submit one approved PDF

Prefer the application queue for full documents. For a small diagnostic, this
complete native Forge `exec` example reads the binary from Drive without putting
Base64 into a tool response. Replace the path and IDs with the approved fixture
and configured instance. It requires an active admin grant and consumes paper.

```js
const file = await readBinaryFile("drive/approved-printer-test.pdf");
const bytes = await yolm.bytes.get(file.bytesId);
if (bytes.length === 0 || bytes.length > 48000) {
  throw new Error("Use the application queue for this document size");
}
if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
  throw new Error("Expected PDF bytes");
}
// Portable standard Base64; no Node, browser globals or large argument spread.
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
let pdfBase64 = "";
for (let i = 0; i < bytes.length; i += 3) {
  const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
  pdfBase64 += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63]
    + (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : "=")
    + (i + 2 < bytes.length ? alphabet[n & 63] : "=");
}
text(await edgeDriverActionTest({
  machineId: "1",
  instanceId: "1",
  driver: "printer",
  action: "print",
  params: {
    content: { "$bytesBase64": pdfBase64 },
    job_name: "TEST ONLY - PDF commissioning",
    copies: 1
  },
  waitMs: 30000
}));
```

`readBinaryFile` resolves the current file at that Drive path: verify the version
and hash beforehand. Use `downloadDriveFile({versionId})` when transferring an
exact version to the host. A host pathname is not `params.content`. Do not use
`parameters`, put `content` at the top level, or use `name` for `job_name`.
If still pending, wait on the returned operation ID; do not submit it again.

## Read back and accept

Immediately after the actual Edge PDF, reread device settings. A driver can
overwrite saved settings during the job. If darkness/speed revert, inspect driver
output/defaults and the vendor's supported command-override controls before
changing document format. If settings remain correct but output is faint, inspect
ribbon/media compatibility, loading, printhead and raster output with a controlled
comparison. Do not infer a single cause from a photo or one pre-print reading.

Record four independent outcomes:

| Evidence | What it proves |
| --- | --- |
| Validation/check | Configuration, queue access and current effective geometry |
| Submitted operation | Spooler accepted the job, not physical success |
| Operator inspection | Alignment, solid black, unclipped text/logo and exact QR scan |
| Restart acceptance | Same checks after Windows restart and printer power cycle, with no desktop login |

Arrange the restart test at an idle time. Reread settings and print one approved
PDF per queue afterward. Preserve intentional queue names, ports and calibrated
feed length; feed length may include the media gap. Record any preprinted areas
and keep them out of the generated artwork.

Keep one dated commissioning record beside the application, including remaining
unknowns, operation IDs, PDF hashes, device policy and physical results. Recheck it
after changing the service account, driver, printer, media or firmware.
