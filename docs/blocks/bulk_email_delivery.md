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
submission, first-event recipient summaries, and system-wide bulk-email
suppression. It does not own templates, campaign drafts, sender credentials,
application-specific marketing preferences, or authoring UI.

Each higher-level workflow registers a source before the block is added:

```typescript
import { BulkEmailDeliveryBlock } from "blocks/bulk_email_delivery";

const delivery = new BulkEmailDeliveryBlock();
const alerts = delivery.registerSource({
  key: "client_alert",
});

system.addBlock(delivery);
```

Source hooks and enqueue options: see `BulkEmailDeliverySourceConfig` and
`EnqueueBulkEmailDeliveryOptions` in `packages/blocks/bulk_email_delivery/index.tsx`.

## Options

| Option | Meaning |
| --- | --- |
| `engagementTracking: false` | Omits open/click fields and report columns; validates and acknowledges those events with HTTP 200 without storing them or invoking source callbacks. |
| `attachments: false` | Omits `bulk_email_delivery_attachments`; an `attachmentsQuery` then fails at generation time. Do not disable in a deployed system while deliveries still need attachments (the old table is orphaned). |

## Owned tables

- `bulk_email_deliveries`: one immutable delivery, frozen audience and content.
- `bulk_email_delivery_attachments`: blob attachments shared by one delivery.
- `bulk_email_delivery_recipients`: per-recipient status and first-event
  timestamps, not a full provider-event history.
- `bulk_email_suppressions`: normalized addresses suppressed system-wide.

## Enqueue and held deliveries

Call `alerts.enqueue(...)` inside the source record's transaction. The
`sourceRecordKey` is the enqueue identity, so retrying the same source record
returns the existing delivery. The platform submission key is derived
from the delivery ID; it is a stable correlation value, not a promise of
provider idempotency.

Scheduled workflows can freeze recipients before shared content is ready with
`createHeld(...)`. The submission worker ignores held deliveries. The owning
workflow later calls `releaseHeld(...)` with the final subject and HTML/text,
or `discardHeld(...)` if cancelled. Scheduling time stays with that workflow;
the delivery table has no `not_before` field.

## Submission contract

The block always sends the platform `marketing` intent (Postmark routes it
through the Broadcast stream so unsubscribe handling applies).
One delivery maps to an `email.send_bulk` request with a frozen request hash.
Before dispatch, the worker excludes recipients whose email is not
one plain, unquoted mailbox with a valid dot-separated domain. Display names,
address lists, malformed punctuation (including `?` in the mailbox, which
Postmark rejects), and overlong addresses are excluded.
Their rows remain in delivery results as `excluded` with an invalid-format
explanation; valid recipients in the same batch continue. Empty, whitespace-only,
and null addresses are stored as null and excluded during enqueue; multiple
missing addresses retain separate source-recipient rows. If every recipient is
excluded, no provider request is made.

Previously queued deliveries are checked too. A frozen retry confirmed
`not_sent` first has to match its original request hash, including current
consent checks. Only then may the worker exclude malformed recipients and
atomically freeze the filtered request under a new hash. It logs both hashes
and the exclusion count. Content/consent changes still fail the original guard;
submission evidence blocks refreezing, and terminal or uncertain deliveries
are never automatically replayed. The delivery ID, source identity, recipient
IDs, attempt limit, and callback remain unchanged.
It retries only when the platform reports both a retryable error and
`dispatch_state: "not_sent"`, up to three attempts. Ambiguous responses and
expired submission leases become terminal `send_unknown` recipient outcomes
instead of being replayed.

Limits per delivery: 500 recipients (the provider's single-request
boundary; no implicit splitting), 10 KB of variables per recipient, 10
attachments, and 10 MB of request JSON. Attachments stay blob references; the
platform resolves them and enforces provider payload limits.
The 10 MB serialized request limit is checked after malformed recipients are
excluded, so their payloads cannot cause an otherwise valid request to fail.

The `bulk_email_delivery_ready` reactor wakes on queued work and processes one
delivery at a time. The 15-minute `bulk_email_delivery_send` sweep handles due
retries and abandoned leases, so a retry eligible after one minute can wait for
the next sweep. Business-hours policy belongs to the source workflow. See
[Operations and recovery](./bulk_email_delivery_operations.md) for worker
bounds, diagnostics, and reconciliation.

## Events, suppression, and unsubscribe

The block registers `POST /platform-email-events` through `system.globalApi`;
the platform calls `/global-api/platform-email-events` with a provider-neutral
canonical event. The endpoint validates delivery and recipient aliases, then
transactionally applies monotonic recipient-summary updates. With engagement
tracking disabled, valid open/click events instead return
`{ "ok": true, "ignored": true, "reason": "engagement_tracking_disabled" }`
without writes or error logs. Malformed payloads, unknown event types, and
recipient/delivery mismatches still return HTTP 400. An `event_key`
identifies one immutable canonical event, so identical retries cannot satisfy
the strict earlier-occurrence predicate and cannot repeat suppression or
source-callback side effects. Source callbacks run only when the summary
changes. Provider credentials and webhooks are platform-owned; systems do not
register provider webhooks.

Unsubscribe, complaint, and terminal-bounce events add the normalized address
to `bulk_email_suppressions`, which is checked before every dispatch, including
safe retries. It does not affect transactional email. A source callback can
maintain application-specific preference data, such as a contact's marketing
consent. If current consent changes a frozen request, the delivery fails before
dispatch instead of sending the old audience; prepare a new delivery only for
eligible recipients proven not sent.

Each recipient gets a unique opaque unsubscribe token. The block adds a
visible unsubscribe footer to HTML (before the final `</body>`, else `</html>`,
else appended) and text bodies, plus `List-Unsubscribe` and RFC 8058
`List-Unsubscribe-Post` headers. GET shows a non-mutating confirmation page;
both POSTs are idempotent and never reveal whether a token exists. The public
routes include `info.system_id()` so the global API reaches the owning system.

## Delivery reporting

`BulkEmailDeliveryReport` is a route-free, read-only report of metrics and
paginated delivery history. Place it inside the system's own route and
permission boundary:

```tsx
import { BulkEmailDeliveryReport } from "blocks/bulk_email_delivery";

<BulkEmailDeliveryReport />;
```

**View recipients** shows per-recipient status, errors or reconciliation
evidence, and event timestamps; filters also apply to the CSV download. Failed
means not sent; submitted, excluded, and unknown recipients must never be
included in an automatic retry.
