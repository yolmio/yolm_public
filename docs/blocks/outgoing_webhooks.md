---
title: Outgoing Webhooks Block
description: Add a configurable outgoing-webhooks system with retries, history, per-type request builders, and a user-facing management page.
tags:
  - blocks
  - webhooks
  - integrations
  - reactors
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
  - concepts/reactors.md
  - concepts/static_webhooks.md
---

# Outgoing Webhooks Block

`OutgoingWebhooksBlock` gives an app runtime-configured outgoing webhooks. You
define webhook **types** (events); admins configure endpoint URLs in the
management page; your code calls `trigger(...)` after a write; a built-in reactor
sends the requests with retries and records every attempt. Use code-defined
static webhooks instead when the platform, not end users, owns the endpoints.

```tsx
import {
  OutgoingWebhooksBlock,
  WebhookManagementPage,
} from "blocks/outgoing_webhooks";
import type { OutgoingWebhookType } from "blocks/outgoing_webhooks";
```

## Minimal Setup

Register the block in `core.tsx`. Each type's `makeRequest` sends the request
with `s.request(...)` and **must** declare `defResponseRecord: "response"`: the
reactor reads `response.status` after the callback to decide success or retry,
so do not branch on the status yourself.

```tsx
import { system } from "std/system";
import { OutgoingWebhooksBlock } from "blocks/outgoing_webhooks";

system.addBlock(
  new OutgoingWebhooksBlock({
    types: [
      {
        name: "contact_created",
        makeRequest: (s, opts) => {
          s.request({
            uri: opts.url,
            method: "POST",
            // optIn controls whether the request actually fires in
            // preview/local-dev runs; production is unaffected.
            optIn: true,
            json: {
              event: "contact_created",
              record_id: opts.recordId,
              data: opts.extraData,
            },
            defResponseRecord: "response",
          });
        },
      },
    ],
  }),
);
```

Mount the self-routing management page directly (not inside `<Route>`; default
path `/webhook-management`):

```tsx
<WebhookManagementPage path="/integrations/webhooks" />
```

It is also `OutgoingWebhooksBlock.WebhookManagementPage`: a searchable grid of
webhooks with add/edit/delete, invocation counts, and a "Send Test" button for
types that define `sendTestRequest`.

Enqueue invocations after the relevant write. Creating a webhook row only
configures an endpoint; nothing is sent until `trigger` runs:

```tsx
system.block(OutgoingWebhooksBlock).trigger(s, {
  type: "contact_created",
  recordId: sql`new_contact_id`,
  extraData: sql`json_build_object('email', new_email)`,
});
```

## Configuration

`new OutgoingWebhooksBlock({ types? })`; see `OutgoingWebhookType` in
`packages/blocks/outgoing_webhooks/outgoing_webhooks_block.ts`.

| Field | Contract |
| --- | --- |
| `name` | Becomes a variant of the `outgoing_webhook_type` enum. |
| `renameFrom` | Previous variant name when renaming a type. |
| `makeRequest(s, { txId, recordId, url, extraData })` | `txId` is the invocation's `created_by_tx`; `extraData` is the trigger JSON or `null`. `200`/`201`/`204` count as success. |
| `sendTestRequest(s, { url })` | Optional; powers "Send Test". Must also produce a `response` record. |

Methods on `system.block(OutgoingWebhooksBlock)`:

- `trigger(s, { type, recordId, extraData? })` inserts a `pending` invocation
  for every webhook whose `type` equals `type`; an unknown type matches nothing.
- `addType(type)` adds a type after construction and registers its enum variant
  (honoring `renameFrom`).
- `addTypeIfNotExists(type)` is a no-op if the `name` already exists, for types
  contributed by several blocks.

## Tables Created

| Table | Purpose |
| --- | --- |
| `outgoing_webhooks` | One row per configured endpoint subscription. |
| `outgoing_webhook_invocations` | Queued/in-flight/completed deliveries; `status` is `pending`, `in_progress`, `succeeded`, or `failed`. |
| `outgoing_webhook_attempts` | One row per delivery attempt with status code or failure reason. |

## Reactor

The block registers reactor `outgoing_webhook_integration` (`maxConcurrent:
128`) over due `pending`/`in_progress` invocations:

- Each run records an attempt (`response.status`, or a `failure_reason` if
  `makeRequest` throws).
- `200`/`201`/`204` marks the invocation `succeeded`; otherwise it stays
  `in_progress` and retries with jittered exponential backoff (initial 60s,
  factor 2.0, capped at 3 days).
- After 5 attempts without success it is marked `failed`.

The block declares external-service option `send_webhooks` ("Send outgoing
webhook requests") as metadata only; it is not bound to the request `optIn`
flag, so set `optIn` in `makeRequest` when calls should fire outside production.
