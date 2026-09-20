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

`OutgoingWebhooksBlock` gives an app a managed outgoing-webhook system. You
define the available webhook **types** (events). Admins configure endpoint URLs
in the management page, your code calls `trigger(...)` after a write to enqueue
an invocation, and a built-in reactor dispatches the HTTP requests with retries
and records every attempt.

Use this block (instead of code-defined static webhooks) when the endpoints are
configured by end users at runtime rather than by the platform.

```tsx
import {
  OutgoingWebhooksBlock,
  WebhookManagementPage,
} from "blocks/outgoing_webhooks";
import type { OutgoingWebhookType } from "blocks/outgoing_webhooks";
```

`WebhookManagementPage` is also exposed as the static
`OutgoingWebhooksBlock.WebhookManagementPage`.

## Minimal Setup

Register the block in `core.tsx`. Each type supplies a `makeRequest` callback
that builds and sends the HTTP request via `s.request(...)`. The callback **must**
declare the response record `response` (`defResponseRecord: "response"`), because
the reactor inspects `response.status` after the callback runs to decide
success/retry.

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

You can also register with no types and add them later
(`system.addBlock(new OutgoingWebhooksBlock({ types: [] }))`, then `addType`).

### Mount the management page

`WebhookManagementPage` is **self-routing** — render it directly in an app, do
NOT wrap it in a `<Route>`.

```tsx
<WebhookManagementPage path="/integrations/webhooks" />
```

### Enqueue invocations

From a procedure or event handler after a write, fetch the block instance and
call `trigger`. It inserts a `pending` invocation for every configured webhook
whose `type` matches; the reactor delivers them.

```tsx
import { system } from "std/system";
import { OutgoingWebhooksBlock } from "blocks/outgoing_webhooks";

system.block(OutgoingWebhooksBlock).trigger(s, {
  type: "contact_created",
  recordId: sql`new_contact_id`,
  extraData: sql`json_build_object('email', new_email)`,
});
```

## Configuration

Constructor: `new OutgoingWebhooksBlock(opts?)`.

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `types` | `OutgoingWebhookType[]` | No (default `[]`) | Event types users can subscribe to. Each `name` becomes a variant of the `outgoing_webhook_type` enum. |

### `OutgoingWebhookType`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Type identifier; added as a variant of the `outgoing_webhook_type` enum. |
| `renameFrom` | `string` | No | Previous name, used when renaming an existing enum variant. |
| `makeRequest` | `(s, opts) => void` | Yes | Builds and sends the request (call `s.request(...)`). Must declare `defResponseRecord: "response"`; the reactor then reads `response.status` (`200`/`201`/`204` count as success). |
| `sendTestRequest` | `(s, { url: Sql }) => void` | No | Powers the "Send Test" button on the management page. Must also produce a `response` record (the page reads `response.status`). Only types that define it show the button. |

The `opts` passed to `makeRequest` has these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `txId` | `NumericExpr` | Transaction id that created the invocation (`created_by_tx`). |
| `recordId` | `NumericExpr` | The triggering record id (from `trigger`). |
| `url` | `Sql` | The configured endpoint URL for the webhook. |
| `extraData` | `Sql` | JSON payload supplied at trigger time, or `null`. |

## Methods

Fetch the instance with `system.block(OutgoingWebhooksBlock)`.

| Method | Signature | Purpose |
| --- | --- | --- |
| `trigger` | `trigger(s, { type: string, recordId: NumericExpr, extraData?: Sql })` | Inserts a `pending` invocation for every webhook whose `type` equals `type`. Call this after the relevant write. |
| `addType` | `addType(type: OutgoingWebhookType)` | Adds a type after construction and registers its enum variant (honoring `renameFrom`). |
| `addTypeIfNotExists` | `addTypeIfNotExists(type: OutgoingWebhookType)` | Same as `addType`, but a no-op if a type with that `name` already exists. Useful when several blocks contribute the same type. |

## Tables Created

| Table | Purpose / key columns |
| --- | --- |
| `outgoing_webhooks` | One row per configured subscription. `name` (string 200, not null), `description` (string 1000), `url` (string 2000, not null), `type` (`outgoing_webhook_type` enum, not null). |
| `outgoing_webhook_invocations` | Queued/in-flight/completed deliveries. `outgoing_webhook_id` (fk -> `outgoing_webhooks`, not null), `record_id` (bigUint, not null), `extra_data` (json), `status` (`outgoing_webhook_status` enum, not null). Virtual columns: `attempt_count`, `last_attempt_timestamp`, `next_retry_at`. |
| `outgoing_webhook_attempts` | One row per delivery attempt. `outgoing_webhook_invocation_id` (fk -> `outgoing_webhook_invocations`, not null), `status_code` (smallUint), `failure_reason` (string 1000), `attempted_at` (timestamp UTC, not null, default `now()`). |

## Enums

| Enum | Values |
| --- | --- |
| `outgoing_webhook_type` | One variant per configured type `name`. |
| `outgoing_webhook_status` | `pending`, `in_progress`, `succeeded`, `failed`. |

## Reactor

`populate()` registers a reactor named `outgoing_webhook_integration`
(`maxConcurrent: 128`). It selects invocations that are `pending` or
`in_progress` and due, then runs the matching type's `makeRequest`. Behavior:

- Every run records a row in `outgoing_webhook_attempts` (the HTTP
  `response.status` on a completed request, or a `failure_reason` if
  `makeRequest` throws).
- `response.status` in `200`/`201`/`204` marks the invocation `succeeded`.
- Otherwise the invocation stays `in_progress` and is retried with exponential
  backoff (initial 60s, factor 2.0, capped at 3 days, jittered) via the
  `next_retry_at` schedule.
- After 5 attempts without success the invocation is marked `failed`.

You do not register or call the reactor yourself; just configure types and call
`trigger`.

## External Service Option

The block declares one external-service option:

| optionKey | optionLabel |
| --- | --- |
| `send_webhooks` | Send outgoing webhook requests |

This is descriptive metadata surfaced to integrators (it advertises that the
block makes outbound requests). The block does not itself bind this option to
the request `optIn` flag. Because outbound requests are gated by `optIn` in
preview/local-dev runs, set `optIn` in your `makeRequest` callback when the call
should fire outside production.

## Pages

### `WebhookManagementPage`

Import: `blocks/outgoing_webhooks`.

A searchable grid of configured webhooks with add/edit/delete, an invocation
count per webhook, and a "Send Test" button for types that define
`sendTestRequest`. Built on `SearchCardPage`.

| Prop | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `path` | `string` | No | `/webhook-management` | Route path for the page. |

**Self-routing** — render directly, do NOT wrap in `<Route>`.

## Common Mistakes

- Omitting `defResponseRecord: "response"` in `makeRequest` (or in
  `sendTestRequest`). The reactor and the test button read `response.status`
  after your callback; without that record, the generated procedure has no
  `response` in scope.
- Checking `response.status` and branching inside `makeRequest`. Just send the
  request; the reactor reads `response.status` and handles
  success/retry/failure.
- Wrapping `WebhookManagementPage` in a `<Route>`. It already routes itself.
- Expecting requests to fire without calling `trigger`. Creating a webhook row
  only configures an endpoint; invocations are enqueued by `trigger(s, ...)`.
- Passing a `type` to `trigger` that is not a configured type `name`. Only
  webhooks whose `type` equals the given value receive an invocation.
- Forgetting `sendTestRequest`: types without it simply have no "Send Test"
  button; it is optional, not required.
