---
title: Printers
description: A shared queue for PDF documents and print-ready binary labels or receipts.
tags: [blocks, edge, printing]
---

# PrintersBlock

Import `PrintersBlock` from `blocks/printers`. Register logical destinations:

```ts
system.addBlock(new PrintersBlock({ destinations: [
  { name: "documents", contentType: "pdf" },
  { name: "labels", contentType: "raw" },
  { name: "receipts", contentType: "raw" },
] }));
```

Each defines `printer_<name>` with one `printer` driver: `document_printer` for
PDF, `raw_printer` otherwise. Forge owns physical machine/instance configuration;
there are no application machine or printer-configuration tables.

Render first, store bytes with `s.createBlob`, then enqueue inside a transaction:

```ts
system.block(PrintersBlock).enqueueDocument(s, {
  destination: "documents", blob: sql`pdf_hash`, name: sql.lit`Bill of Lading`,
  copies: sql`1`,
});
// enqueueRaw(s, { destination: "labels", blob: ..., name: ... })
```

Raw data must already be printer-ready. Typst, raster conversion, ZPL and ESC/POS
generation are rendering concerns, not transport actions.

## One table: print_jobs

| Field | Purpose |
|---|---|
| id | Database job identity |
| destination | Definition-owned logical destination |
| content_type | PDF or raw; constrained to destination (raw accepts any printer language) |
| content_blob | Blob reference to print-ready bytes (up to 64 MiB) |
| name | Spooler/display job name |
| copies | PDF copies, 1–100; raw jobs must use 1 |
| status | queued, submitting, submitted, failed, cancelled |
| attempt | Increments when claimed; fences delayed events on retry |
| created_at | Queue/history age |
| started_at | Submission start and uncertain-job recovery window |
| finished_at | Completion/cancellation time |
| error | Bounded failure message |

No physical-delivery guarantee: submitted means transport/spooler acceptance.
The block never automatically retries uncertain delivery. Explicit retries use
`id:attempt` as the durable command identity. Check the printer first.

Render `<PrintersBlock.JobsPage canManage={permissionSql} />` inside the app's
authentication boundary. It supports refresh, explicit retry, cancellation, and
operator confirmation of already-printed output without resubmitting.
The caller owns read access and the runtime permission expression for mutations.
Enable only one instance per destination/target. History retention is owned by
the application; preserve pending/uncertain jobs during cleanup.

See [the deployable printer example](../../examples/printers/README.md) for setup,
driver configs, testing, limitations and the system 6 BOL integration path.
