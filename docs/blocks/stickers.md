---
title: Stickers Block
description: Printed QR sticker codes for equipment, locations and other records, with late binding of blank stickers, supersede or void semantics, and a printable sheet.
tags:
  - blocks
  - equipment
  - locations
  - printing
related:
  - blocks/equipment.md
  - blocks/locations.md
  - blocks/printers.md
---

# Stickers Block

`StickersBlock` owns the `stickers` table: one row per printed QR code. A code
identifies at most one record; a blank sticker identifies none until someone
scans and attaches it.

```ts
import { StickersBlock } from "blocks/stickers";

export const stickers = new StickersBlock({
  targets: [
    {
      field: "equipment_id",
      table: "equipment",
      types: [{ name: "equipment", displayName: "Equipment" }],
      stickers: "many",
    },
  ],
  canIssue: (user) => AuthBlock.userHasPermission(sql.lit("can_print"), user),
  canAttach: (user) => AuthBlock.userHasPermission(sql.lit("can_attach"), user),
  qrValue: (code) => sql`'https://app.example.com/s/' || ${code}`,
});
system.addBlock(stickers);
```

## Targets

Each target adds a foreign key column and sticker types. Its `stickers`
setting decides what a new sticker means:

- `single`: issuing a new sticker supersedes the active one and increments
  `qr_version` (unique per record). Use it when stale stickers must be rejected.
- `many`: stickers are independent and voided individually; only `many`
  targets accept blank stickers. Use it for equipment and places.

Other options (`defineStickers`, `typeEnum`, `creator`) are in
`StickersBlockOptions` in `packages/blocks/stickers/index.tsx`.

## Owned Tables

| Table | Purpose |
| --- | --- |
| `stickers` | One row per printed code. At most one target column is set (none for a blank); `sticker_type` must match the target. |

`label_code` is unique, lowercase, and trimmed. New codes are `xxxxx-xxxxx`
hex, but treat codes as opaque: codes from other schemes keep resolving.
`status` is `active`, `superseded`, or `void`.

## Procedures

Each takes the acting user and checks the configured permission.

| Procedure | Purpose |
|---|---|
| `stickers_issue(p_target, p_target_id, p_type, p_actor)` | New sticker for a record; supersedes for `single` targets |
| `stickers_issue_blank(p_count, p_actor)` | 1–200 blank stickers in one batch; returns `p_batch_id` |
| `stickers_attach(p_code, p_target, p_target_id, p_actor)` | Attach an active blank sticker to a `many` target |
| `stickers_void(p_sticker_id, p_actor)` | Remove one sticker from use |

`StickersBlock.normalizeCode(value)` turns a typed code or scanned URL into the
lookup code.

## UI (from `blocks/stickers`)

- `StickerSheet({ block, where, caption })`: printable QR cells, one sticker
  per printed page.
- `StickersCard({ block, target, targetId, printHref })`: a record's active
  stickers with print, new or reprint, and void actions.
- `StickerStatusAlert({ status })`: message for superseded, void, or unknown
  codes.

The application routes scanned codes: resolve by `label_code`, open the target
for active stickers, offer attach for blank ones, and otherwise show
`StickerStatusAlert`. For queued physical printing, render ZPL and enqueue it
with [PrintersBlock](printers.md).
