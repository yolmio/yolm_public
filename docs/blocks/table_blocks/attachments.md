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

`AttachmentsTableBlock` attaches a related `*_attachments` file table to any
table, registers a blob-download API endpoint per app, and ships an
`AttachmentsCard` UI for uploading, renaming, downloading, and deleting files.
Use it whenever a record (contact, matter, project, etc.) needs file uploads,
instead of hand-rolling a blob table, upload handler, and download endpoint.

```tsx
import { AttachmentsTableBlock } from "table_blocks/attachments";
import { AttachmentsCard } from "table_blocks/attachments/attachments_card";
```

`AttachmentsCard` is not re-exported from the block index; import it from
`table_blocks/attachments/attachments_card`, or reach it as the static
`AttachmentsTableBlock.AttachmentsCard`.

## Minimal Setup

Attach the block inside a `db.table(...)` definition. Pass the class (not an
instance) to `table.addBlock` — `addBlock` constructs it for you and passes the
parent table name.

```tsx
// core.tsx
import { AttachmentsTableBlock } from "table_blocks/attachments";
import { system } from "std/system";

const { db } = system;

db.table("contacts", (table) => {
  table.string("first_name", 50).notNull();
  table.string("last_name", 50).notNull();
  table.addBlock(AttachmentsTableBlock); // creates the `contact_attachments` table
});
```

Render the card inside a record page (which supplies the current table/record
context the card needs). It is a card, not a page — place it directly in the
page body, never inside a `<Route>`.

```tsx
// apps/<domain>.tsx
import { AttachmentsCard } from "table_blocks/attachments/attachments_card";
import { RecordPage } from "pages/record_page";

<RecordPage table="contacts">
  {/* ...other cards... */}
  <AttachmentsCard className="col-span-12 lg:col-span-6" />
</RecordPage>;
```

## Configuration

The block has no configuration options. `table.addBlock(AttachmentsTableBlock)`
constructs it with the parent table name and an empty options object — there is
nothing to pass.

Only one instance may be attached to a table (`allowMultipleInstances` is
`false`); adding it twice throws at generation time.

## Tables Created

For a main table named `contacts`, the block creates `contact_attachments` (the
main table name is singularized and suffixed with `_attachments`). Sample data
is skipped for this table.

| Column         | Type             | Notes                                                                                                       |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `<singular>_id` | FK to the main table | `notNull`. Named `<singular>_id` (e.g. `contact_id`) via `table.fk(mainTable.name)`. The card auto-detects it by referenced table. |
| `name`         | `string(100)`    | `notNull`. Original file name; editable inline.                                                              |
| `blob`         | blob ref (max 64) | `notNull`. Reference (hash) to the uploaded blob.                                                            |
| `content_type` | `string(100)`    | Nullable. MIME type returned on download.                                                                    |
| `size`         | `bigUint`        | `notNull`. Byte count.                                                                                       |

## API Endpoint

For every app that renders the card, the block registers a download endpoint
(prefix `/api`):

```
GET /api/<attachments-table-base-url>/{blob_hash}
```

For `contact_attachments` the base URL is `contact-attachments`, so the path is
`/api/contact-attachments/{blob_hash}` (`blob_hash` is the hexadecimal form of
the stored blob hash, not a UUID). The
endpoint streams the file bytes with its stored `Content-Type` and
`Cache-Control: max-age=31536000, immutable`, and returns `404` if no row has
that `blob`. If the app exposes an auth context, the endpoint authenticates the
request first.

The endpoint is only added for apps that called `registerAppUsage()`.
`AttachmentsCard` does this automatically; call it manually only if you render
attachment links (via `getAttachmentUrl`) without the card.

## Components

### `AttachmentsCard`

Import from `table_blocks/attachments/attachments_card` (or use
`AttachmentsTableBlock.AttachmentsCard`). Renders an outlined card with an
upload button, a list of attachments (each with inline rename, download, and
delete), and an empty state. It must be rendered where the current table and
current record are in context — i.e. inside a `RecordPage` (or equivalent) whose
table had `AttachmentsTableBlock` added. It resolves the attachments table via
`currentTable.block(AttachmentsTableBlock)` and throws if the attachments table
has no foreign key field referencing the current table.

| Prop        | Type     | Required | Meaning                                                                                                          |
| ----------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `header`    | `Node`   | No       | Card title. Defaults to the literal `Attachments`.                                                               |
| `sx`        | `Style`  | No       | Style overrides applied to the `Card`.                                                                           |
| `className` | `string` | No       | CSS class on the `Card`.                                                                                         |
| `table`     | `string` | No       | Declared on the props interface but unused; the card resolves its table and record from the record-page context. |
| `editPermission` | `string` | No | Permission required to upload, rename, or delete attachments. The card hides edit controls and repeats the permission check in every server mutation; viewing and downloading remain available. |

The card's props interface is exported as `Props` from the same module, but
consumers rarely need to import it.

## Block API

Within a component, get the block instance via
`currentTable.block(AttachmentsTableBlock)` (this is what the card does
internally). At generation time, the built `Table` model exposes the same
lookup, e.g. `system.db.tables["contacts"].block(AttachmentsTableBlock)`.

| Member                                | Returns     | Meaning                                                                                                |
| ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `block.table`                         | `Table`     | The generated `*_attachments` table (resolved lazily from `system.db.tables`).                          |
| `block.getAttachmentUrl(blobId)`      | `Sql`       | SQL expression for a row's download URL (`/api/<base-url>/<blobId>`). Pass the row's `blob` value.      |
| `block.registerAppUsage()`            | `void`      | Records the current app (and its optional auth context) so its download endpoint is added. Called automatically by `AttachmentsCard`. |
| `AttachmentsTableBlock.AttachmentsCard` | component | Static reference to the card component.                                                                |

## Detail Tab

`AttachmentsTableBlock` overrides `getDetailTab`, contributing a record-page
detail tab (`value: "attachments"`, header "Attachments" with an attachment
icon, content `<AttachmentsCard />`). The CRM block's record detail page renders
each attached block's `getDetailTab`, so a table managed by the
[CRM block](../crm.md) that has `AttachmentsTableBlock` attached gets an
Attachments tab automatically — you do not render `AttachmentsCard` yourself
there. On a plain `RecordPage` (which does not consume block detail tabs),
render `AttachmentsCard` explicitly, as in Minimal Setup.

## Common Mistakes

- Rendering `AttachmentsCard` outside a record page/context. It reads
  `CurrentTableICtxKey` and `CurrentRecordICtxKey`, and throws if no FK field
  links the attachments table to the current table.
- Forgetting `table.addBlock(AttachmentsTableBlock)` on the table before
  rendering the card — `currentTable.block(AttachmentsTableBlock)` then throws.
- Passing `new AttachmentsTableBlock(...)` to `table.addBlock`; pass the class
  and let `addBlock` construct it.
- Wrapping `AttachmentsCard` in `<Route>`. It is a card component, not a
  self-routing page.
- Expecting download links to work in an app that never renders the card — the
  endpoint is only registered for apps that called `registerAppUsage()`.
- Setting the `table` prop expecting it to switch tables — it is unused.
- Adding the block twice to one table — only one instance is allowed per table.
