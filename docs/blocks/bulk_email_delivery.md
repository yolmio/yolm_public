---
title: Bulk Email Delivery Block
description: Immutable platform-managed bulk email delivery and compact results.
tags:
  - blocks
  - email
  - bulk
---

# Bulk Email Delivery Block

`BulkEmailDeliveryBlock` is the low-level platform delivery layer. It owns one
shared content snapshot per delivery, compact recipient rows, single-request
submission, compact first-event recipient summaries, and system-wide
bulk-email suppression. It does not own templates, campaign
drafts, sender credentials, application-specific marketing preferences, or
authoring UI.

Each higher-level workflow registers a source before the block is added:

```typescript
import { BulkEmailDeliveryBlock } from "blocks/bulk_email_delivery";

const delivery = new BulkEmailDeliveryBlock();
const alerts = delivery.registerSource({
  key: "client_alert",
});

system.addBlock(delivery);
```

Delivery-only workflows that do not use open or click analytics can omit that
schema and reject those platform event types:

```typescript
const delivery = new BulkEmailDeliveryBlock({
  engagementTracking: false,
});
```

The block always sends the platform `marketing` intent. This is separate from
provider terminology: Postmark routes it through the configured Broadcast
message stream so unsubscribe handling applies.

Consumers without file attachments can set `attachments: false`. This omits
`bulk_email_delivery_attachments` and its worker queries and cleanup; providing
an `attachmentsQuery` then fails at generation time. Attachment support defaults
to enabled for compatibility with existing consumers. Disabling it in a deployed
system orphans the old attachment table; do not disable it while existing
deliveries still need their attachments.

Call `alerts.enqueue(...)` inside the source record's transaction. The source's
`sourceRecordKey` is the enqueue identity, so retrying the same source record
returns the existing immutable delivery. The platform submission key is
derived from that delivery's ID and is a stable correlation value, not a
promise of provider idempotency.

Scheduled workflows can freeze recipients before shared content is ready by
calling `createHeld(...)`. Held deliveries are ignored by the submission
worker. The owning workflow later calls `releaseHeld(...)` with the final
subject and HTML/text, or `discardHeld(...)` if the scheduled operation is
cancelled. Scheduling time remains owned by that workflow; the delivery table
does not contain a `not_before` field.

One delivery maps to one `email.send_bulk` request. The block freezes the exact
request hash. It retries only when the platform explicitly reports both a
retryable error and `dispatch_state: "not_sent"`, with a three-attempt limit.
Ambiguous responses and expired submission leases become terminal
`send_unknown` recipient outcomes instead of being replayed.

The application boundary permits up to 500 recipients, matching the current
platform provider's single-request boundary. It also rejects recipient
variables above 10 KB per recipient, more than 10 shared attachments, or more
than 10 MB of request JSON. The block does not split one delivery into implicit
subrequests; provider-specific chunking remains a future platform concern.

The block registers `POST /platform-email-events` through `system.globalApi`.
The platform calls the internal `/global-api/platform-email-events` route with
its provider-neutral canonical event. The endpoint validates the delivery and
recipient aliases, then transactionally applies monotonic recipient-summary
updates. The platform contract requires an `event_key` to identify one
immutable canonical event, so a retry carries the same type, recipient,
timestamp, and payload. Identical retries cannot satisfy the summary update's
strict earlier-occurrence predicate and therefore cannot repeat suppression or
source-callback side effects. Distinct later events are accepted; source
callbacks run only when the compact summary changes.

Recipient rows retain the first delivery, open, click, bounce, complaint, and
unsubscribe timestamps rather than a complete provider-event history.
When `engagementTracking` is false, the open/click fields and event handling are
not generated; delivery and suppression events remain available. The report
also omits open/click queries and columns for this configuration.
Unsubscribe, complaint, and terminal-bounce events add the normalized address
to `bulk_email_suppressions`. That suppression is checked before every dispatch, including safe retries.
If current consent changes a previously frozen request, the delivery fails before
dispatch instead of sending the old audience or changing its replay identity.
Prepare a new delivery only for the eligible recipients proven not sent. It does not affect
transactional email. A source callback can also maintain application-specific
preference data, such as a contact's marketing consent.

Each recipient receives a unique 256-bit opaque unsubscribe token. The block
adds a visible unsubscribe footer to HTML and text bodies, inserting the HTML
footer before the final closing `body` element, or before the final closing
`html` element when the body close is omitted. It appends only when neither tag
exists. The text URL uses raw Mustachio interpolation so query separators are
not HTML-encoded. Each recipient request also supplies `List-Unsubscribe` and RFC 8058
`List-Unsubscribe-Post` headers. A non-mutating GET displays the confirmation
page; the visible-link POST and one-click POST are idempotent and return generic
responses that do not reveal whether a token exists. These public routes use
`info.system_id()` so the global API routes the request to the system that
created the recipient.

Attachments remain blob references in the frozen request. The platform resolves
and encodes them, enforces provider payload limits, and owns any provider-specific
subdivision rather than exposing that work in application schema.
The `bulk_email_delivery_ready` reactor wakes on queued work and processes one
delivery at a time. Transactional claims also serialize it against the scheduled
fallback. The existing 15-minute `bulk_email_delivery_send` sweep handles due
retries and abandoned leases; it is not a one-minute poll. A retry becomes
eligible after one minute but can wait until the next sweep when no data change
wakes the reactor. Business-hours policy belongs to the source workflow.

See [Operations and recovery](./bulk_email_delivery_operations.md) for diagnostics,
reconciliation, queue timing, and incident handling.

## Delivery reporting

`BulkEmailDeliveryReport` is a route-free, read-only component that shows
overall delivery metrics and searchable, paginated delivery history, including
submission, delivery, engagement, bounce, and complaint counts. Place it
inside the system's own route, page layout, permission boundary, and
navigation:

```tsx
import { BulkEmailDeliveryReport } from "blocks/bulk_email_delivery";

<BulkEmailDeliveryReport />;
```

Each delivery's **View recipients** action opens its recipient results, including
status, wrapped errors or reconciliation evidence, and event timestamps. Search and
status filters apply to the CSV download across all pages. A Failed recipient
is recorded as not sent; review current eligibility before preparing a new
campaign for that subset. Submitted, excluded, and unknown recipients must not
be included in an automatic retry.

The block registers its submission worker and canonical event endpoint during
initialization. Provider credentials and webhooks remain platform-owned;
systems do not register provider webhooks themselves.
