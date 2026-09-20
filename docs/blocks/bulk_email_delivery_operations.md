---
title: Bulk email operations and recovery
description: Diagnose queued deliveries, failed attempts, uncertain outcomes, and provider events without replaying sent messages.
tags: [blocks, email, operations]
---

# Bulk email operations and recovery

## Timing and worker names

Ready work is event-driven. `bulk_email_delivery_ready` processes one delivery
at a time; `marketing_email_campaign_ready` releases one due campaign as capacity
becomes available. Each invocation is bounded and existing ownership checks
prevent competing workers from submitting the same delivery.

Both scheduled fallbacks use 15-minute intervals. The delivery sweep keeps its
existing interval; the campaign sweep changes from one minute to 15 minutes:

- `bulk_email_delivery_send` / `bulk_email_delivery_send_impl`: due retries,
  abandoned submission leases, queued work, and one due terminal callback retry.
- `marketing_email_campaign_due` / `marketing_email_campaign_due_impl`: scheduled
  campaigns whose time became due without a data change waking the reactor.

The `bulk_email_delivery_terminal` reactor handles source completion after
submission commits. It and the delivery sweep use
`bulk_email_delivery_complete_callback` for atomic source bookkeeping.

There is no one-minute polling job. Immediate sends start when their queued data
is observed. Future campaigns and safe retries can wait until the next sweep,
plus time spent behind active work. This is not an exact-time scheduling SLA.
The delivery report warns about prepared deliveries older than 15 minutes.
Campaign forms parse the minute-precision date/time explicitly in the system
timezone, including the offset applicable on that future date.

## Resource bounds and failure behavior

- The ready queries return one ID, not message bodies or recipient lists.
  Each ready reactor has `maxConcurrent: 1`.
- Each send invocation attempts at most one delivery and one due terminal
  callback. The transactional send claim refuses another active `submitting`
  delivery, including a claim from the sweep.
- Each campaign invocation renders at most one campaign. The scheduled caller
  and reactor can still overlap during rendering; `maxConcurrent` applies to the
  reactor, not all callers. The generation check fences the resulting writes.
  Expiring a submission lease does not cancel a slow provider call; late calls
  can overlap later work. Provider-call timeout and cancellation belong to the
  platform and must be verified there.
- Lease recovery updates at most one expired delivery per invocation. A legacy
  backlog takes multiple sweeps to clear. The completion reactor selects at most
  two IDs with concurrency two. Send invocations can overlap that reactor; the
  transaction guards prevent duplicate committed source bookkeeping. Failed callbacks leave the ready set for 15 minutes,
  allowing later callbacks to proceed. Their source writes and completion marker
  roll back together. The existing send sweep also attempts one due callback,
  even when no data change wakes the reactor. Diagnose and repair the source
  callback rather than marking it complete or resending mail.
- A request has at most 500 pending recipients, 10 KB variables per recipient,
  10 attachments, and 10 MB of serialized request metadata. Obviously oversized
  bodies are rejected before building the request JSON. Attachment bytes are
  fetched by the platform and are not covered by that metadata size check.
- A safe provider retry moves the delivery out of the ready set for at least a
  minute, with at most three attempts. Waiting retries do not reserve campaign
  admission capacity; runnable prepared deliveries and active submissions do.
  Ambiguous outcomes leave the send queue.
  No worker contains an unbounded queue-draining loop.

These bounds do not establish a process-memory ceiling. Query scans/sorts,
rendering, JSON copies, JIT compilation, platform attachment handling, and the
platform's scheduling/retry implementation can allocate additional memory.
Observe peak RSS and queue growth in a controlled rollout with representative
message sizes. If resources rise unexpectedly, disable the ready reactors and
scheduled send/render jobs together; retain delivery state for diagnosis.

## Diagnose a delivery

Capture the source record ID and bulk delivery ID before changing anything.
`source` and `source_record_key` identify its owning workflow. Inspect:

- `status`, `created_at`, `completed_at`, `error`, and `next_attempt_at`;
- `submission_attempt_id`, `submission_attempt_count`, `submission_deadline_at`;
- `request_hash`, `provider`, `provider_bulk_id`;
- `terminal_callback_completed_at` and recipient status/event counts.

The platform submission key is `bulk-email-delivery:<delivery_id>`. Canonical
webhook delivery and recipient IDs are database IDs plus one. Do not confuse
those aliases with IDs shown in database queries.

| State | Meaning and action |
| --- | --- |
| `prepared`, no attempts | Queued. Check the ready reactor and any active submission. |
| `prepared`, attempts > 0 | Explicitly not-sent failure awaiting a safe retry. `error` retains the latest reason. |
| `submitting`, lease valid | In flight. Do not prepare a replacement because it seems slow. |
| `submitting`, lease expired | Outcome may be unknown. The next sweep classifies it; inspect response evidence. |
| Terminal delivery, callback incomplete | Inspect `bulk_email_delivery_terminal` logs. A future `next_attempt_at` means callback backoff; it does not schedule another send. Repair the callback and let the reactor/sweep retry bookkeeping. |
| Failed before dispatch after a consent change | The frozen request was not replayed. Prepare a new eligible audience using confirmed not-sent recipients. |
| Recipient `send_unknown` | Reconcile provider evidence. Missing events prove neither sending nor non-sending. |

## Diagnostic evidence

`bulk_email_delivery_attempt` error logs include delivery/source identity,
attempt ID/count, request hash, submission key, observation time, elapsed seconds,
and bounded diagnostic fields. They record freeze failures and **every provider
response**, including successful acceptance, before completion checks ownership.
Acceptance logs retain the provider bulk ID even if the lease expires between
response receipt and completion; a stale worker still cannot change authoritative
state. Successful responses use the same error-log transport/tag for capture,
so classify incidents by phase, response fields, and delivery state rather than
by the presence of that log tag alone.

`bulk_email_delivery_terminal` logs include the delivery ID, observation time,
bounded callback error type/message/description, and retry delay. Failed callbacks
remain incomplete; on terminal rows, `next_attempt_at` is the bookkeeping retry
time. The original submission error remains intact. To retry a repaired callback
manually, call `bulk_email_delivery_complete_callback` with `p_delivery_id` after
that time; it respects backoff and does nothing if already completed.

`bulk_email_delivery_event` logs capture correlated bounce/complaint event keys,
provider message IDs, occurrence and receipt times, bounce classification, and
bounded detail. Soft and terminal bounce explanations remain on recipients;
submission completion and lease expiry preserve those explanations.

`marketing_email_campaign_due` logs identify the specific campaign generation
and rendering error. A stale renderer's failure cannot fail the new generation.

Query focused `bulk_email_deliveries__versions` and
`bulk_email_delivery_recipients__versions` history for committed local changes,
including retry reasons later cleared by success and operator reconciliation.
See [transaction history](../sql/transaction_queries.md). Provider event time,
local receipt time, and transaction commit time have different meanings.

**Retention:** application code cannot set the platform's log retention. Live
buffers and selected execution captures are not a permanent audit trail. During
an incident, export the relevant logs, IDs, provider evidence, and focused WAL
history into the incident record before capture expiry; retain that record for
the agreed operational retention period. Confirm platform log access and retention with the operator
before production rollout. Never export email bodies, credentials, or tokens
just to diagnose an attempt.

## Locate platform evidence

Use the connected system's [operational reads](../ai/forge_operations.md) in
Forge/`execRead`, when supported by the deployed platform:

```js
const target = { environment: "production" };
text(await runtimeStatus({ target }));
text(await backgroundStatus({ target, kind: "reactor", name: "bulk_email_delivery_ready", limit: 10 }));
text(await capturedExecutions({ target, filters: {
  executionType: "reactor", reactorName: "bulk_email_delivery_ready"
}, limit: 10 }));
text(await capturedExecutions({ target, filters: {
  executionType: "scheduled_proc", procName: "bulk_email_delivery_send"
}, limit: 10 }));
```

Use an execution ID returned by the list with `capturedExecution` to inspect its
bounded debug/error text. Match the delivery and attempt IDs inside the log.
Repeat with the campaign-ready reactor or due procedure when rendering is stuck.
Do not filter only for `success: false`: a handled provider rejection or safe
retry can finish the worker successfully while recording a delivery failure.

The documented capture retention is seven days; capture selection is not a
complete audit of traffic. Confirm the deployed platform's capabilities and
retention. If reads report unavailable, give the platform operator the worker
name, delivery/attempt IDs, log tag, and UTC incident window. Keep the local
committed history and provider evidence as independent sources.

## Reconcile without resending

The delivery results pages in Systems 4 and 6, and the communication detail in
System 5, expose **Uncertain recipient**, **Provider evidence**, **Confirm sent**,
and **Confirm not sent**. Server-side permissions match the owning application's
campaign/backoffice management boundary.

1. Locate the provider job/message or obtain an explicit provider support result.
2. Select the exact unresolved recipient and record a message ID or support
   reference and the confirmed outcome.
3. Confirm sent only when that recipient was sent the message. Confirm not sent
   only when the provider explicitly establishes non-dispatch. Silence, absence
   of a webhook, or an expired lease is insufficient.
4. Reconcile each recipient separately. The action changes no unresolved peers
   and never invokes the send operation. Stale confirmations and not-sent claims
   contradicted by local sending evidence are rejected.

A correlated delivery, bounce, complaint, open, or click event automatically
changes a recipient from unknown to submitted. Open/click evidence applies only
when engagement tracking is enabled. An unsubscribe event alone does not prove
submission. Evidence arriving before an ambiguous response or lease expiry is
also preserved. The original delivery/source failed attempt and its completed
terminal callback remain intact; recipient summaries show what was later proven.
Reconciliation is not a second source-completion callback.

Whole-audience recovery copies are blocked while a failed campaign contains
unknown or already-submitted recipients. If only some recipients are proven not
sent, prepare a new campaign using **only that subset**, respecting current
consent. Successfully completed campaigns can still be intentionally reused.
Do not clear request hashes, reset failed deliveries to prepared, delete
suppressions to force a send, or copy the original audience as a recovery step.

## Release evidence still required

Application tests use a mock service boundary. Before rollout, verify the real
platform's non-dispatch guarantee, authenticated webhook forwarding, event
correlation/replay, provider-job access, and diagnostic retention. Run a
controlled canary covering actual delivery, unsubscribe, bounce, and a safe
failure. Neither provider acceptance nor a passing mock test establishes those
platform guarantees.

These hardening changes add procedures, reactors, UI, and diagnostics; they add
no production tables, fields, enum values, or data transforms.
