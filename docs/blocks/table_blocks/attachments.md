---
title: Attachments Table Block
description: Table block that adds a related attachments file table, a blob-download API endpoint, and an upload/download card UI to any table.
tags:
  - blocks
  - table-block
  - attachments
  - files
related:
  - concepts/blocks.md
  - blocks/solution_blocks.md
  - ui/blocks_reference.md
  - blocks/crm.md
---

# Attachments Table Block

`AttachmentsTableBlock` adds a related `*_attachments` file table to any table,
a blob-download API endpoint per app, and an `AttachmentsCard` for uploading,
renaming, downloading, and deleting files.

## Minimal Setup

Pass the class (not an instance) to `table.addBlock`. The block has no options
and allows one instance per table (adding it twice throws).

```tsx
// core.tsx
import { AttachmentsTableBlock } from "table_blocks/attachments";

db.table("contacts", (table) => {
  table.string("first_name", 50).notNull();
  table.addBlock(AttachmentsTableBlock); // creates `contact_attachments`
});
```

```tsx
// apps/<domain>.tsx
import { AttachmentsCard } from "table_blocks/attachments/attachments_card";
import { RecordPage } from "pages/record_page";

<RecordPage table="contacts">
  <AttachmentsCard className="col-span-12 lg:col-span-6" />
</RecordPage>;
```

## Tables Created

| Table | Purpose |
| --- | --- |
| `<singular>_attachments` | One row per file: FK `<singular>_id` to the main table, file `name`, `blob` ref, `content_type`, byte `size`. Sample data is skipped. |

`<singular>` is `singularize(mainTable)` (`contacts` -> `contact_attachments`).

## API Endpoint

For every app that called `registerAppUsage()` (`AttachmentsCard` does this
automatically), the block registers:

```
GET /api/<attachments-table-base-url>/{blob_id:uuid}
```

For `contact_attachments` this is `/api/contact-attachments/{blob_id}`, matched
against the row's `blob`. It returns the bytes with the stored `Content-Type`
and `Cache-Control: max-age=31536000, immutable`, or `404` if no row matches.
If the app exposes an auth context, the endpoint authenticates first. Rendering
download links without the card requires calling `registerAppUsage()` yourself.

## Components

`AttachmentsCard`, from `table_blocks/attachments/attachments_card` (not
re-exported from the index) or as `AttachmentsTableBlock.AttachmentsCard`. A
card, not a page. It must render where the current table and record are in
context (e.g. a `RecordPage` for a table with the block) and throws if the
block is missing or no attachments FK references the current table.

| Prop | Meaning |
| --- | --- |
| `header` | Card title; defaults to `Attachments`. |
| `editPermission` | Permission required to upload, rename, or delete. Edit controls are hidden and every server mutation repeats the check; viewing and downloading stay available. |
| `table` | Declared but unused; the card always uses the record-page context. |

Also `sx` and `className`; see `Props` in the same module.

## Block API

Get the instance with `currentTable.block(AttachmentsTableBlock)` in a component,
or `system.db.tables["contacts"].block(AttachmentsTableBlock)` at generation
time.

| Member | Meaning |
| --- | --- |
| `table` | The generated `*_attachments` table. |
| `getAttachmentUrl(blobId)` | `Sql` download URL (`/api/<base-url>/<blobId>`); pass the row's `blob`. |
| `registerAppUsage()` | Records the current app (and auth context) so its endpoint is added. |

## Detail Tab

`getDetailTab` contributes an "Attachments" tab (`value: "attachments"`)
rendering `<AttachmentsCard />`. The [CRM block](../crm.md) record page renders
block detail tabs, so CRM tables get the tab automatically; a plain
`RecordPage` does not, so render `AttachmentsCard` explicitly there.
