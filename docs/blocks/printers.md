---
title: Printers
description: A shared queue for PDF documents and print-ready binary labels or receipts.
tags: [blocks, edge, printing]
---

# PrintersBlock

`PrintersBlock` (from `blocks/printers`) queues PDF documents and print-ready
raw labels or receipts. Register logical destinations:

```ts
system.addBlock(new PrintersBlock({ destinations: [
  { name: "documents", contentType: "pdf" },
  { name: "labels", contentType: "raw" },
] }));
```

Each destination defines edge `printer_<name>` with one `printer` driver:
`document_printer` for PDF, `raw_printer` otherwise. Forge owns physical
machine and printer configuration.

Render first, store bytes with `s.createBlob`, then enqueue inside a transaction:

```ts
system.block(PrintersBlock).enqueueDocument(s, {
  destination: "documents", blob: sql`pdf_hash`, name: sql.lit`Bill of Lading`,
  copies: sql`1`,
});
// enqueueRaw(s, { destination: "labels", blob: ..., name: ... })
```

Raw data must already be printer-ready (ZPL, ESC/POS); rendering is not the
queue's job.

## Owned Tables

| Table | Purpose |
| --- | --- |
| `print_jobs` | Queue and history; `content_type` must match the destination. |

PDF `copies` is 1–100; raw jobs must use 1 and encode their own copies.
`status` is `queued`, `submitting`, `submitted`, `failed`, or `cancelled`;
`attempt` increments on each claim and fences delayed events on retry.

## Delivery and Retry

`submitted` means transport/spooler acceptance, not physical delivery. The
block never automatically retries uncertain delivery; explicit retries use
`id:attempt` as the durable command identity. Check the printer first.

`<PrintersBlock.JobsPage canManage={permissionSql} />` (self-routing, default
`/printers`) offers refresh, retry, cancellation, and confirming
already-printed output without resubmitting. Render it inside the app's
authentication boundary; the caller owns read access and the `canManage`
mutation permission. Enable one instance per destination/target. The
application owns history retention; keep pending and uncertain jobs.
