---
title: Bulk email operations and recovery
description: Diagnose queued deliveries, failed attempts, uncertain outcomes, and provider events without replaying sent messages.
tags: [blocks, email, operations]
---

# Bulk email operations and recovery

Operational reference for [Bulk Email Delivery](./bulk_email_delivery.md) and
[Marketing Email Campaign](./marketing_email_campaign.md). Request limits and
the retry contract are defined in the delivery doc.

## Workers and timing

| Worker | Kind | Work per invocation |
| --- | --- | --- |
| `bulk_email_delivery_ready` | Reactor, `maxConcurrent: 1` | One queued delivery. |
| `bulk_email_delivery_send` / `_impl` | 15-minute sweep | Due retries, abandoned leases, queued work, and one due terminal callback. |
| `bulk_email_delivery_terminal` | Reactor, at most two IDs, concurrency two | Source completion after submission commits. |
| `marketing_email_campaign_ready` | Reactor, `maxConcurrent: 1` | Releases one due campaign when capacity allows. |
| `marketing_email_campaign_due` / `_impl` | 15-minute sweep | Scheduled campaigns that became due without a data change. |

The terminal reactor and the sweep both call
`bulk_email_delivery_complete_callback` for atomic source bookkeeping. Future
campaigns and safe retries can wait until the next sweep plus time behind
active work; there is no exact-time scheduling SLA. The delivery report warns about prepared deliveries older than
15 minutes. Campaign forms parse the minute-precision date/time in the system
timezone, using the offset applicable on that future date.

## Resource bounds and failure behavior

- The transactional send claim refuses a second active `submitting`
  delivery, including one from the sweep.
- The scheduled campaign caller and reactor can overlap during rendering;
  `maxConcurrent` applies only to the reactor. A generation check fences the
  resulting writes.
- Expiring a submission lease does not cancel a slow provider call; late calls
  can overlap later work. Provider-call timeout and cancellation belong to the
  platform and must be verified there.
- Lease recovery updates at most one expired delivery per invocation, so a
  backlog takes several sweeps.
- Send invocations can overlap the terminal reactor; transaction guards prevent
  duplicate committed source bookkeeping. A failed callback leaves the ready
  set for 15 minutes, and its source writes and completion marker roll back
  together. Diagnose and repair the callback rather than marking it complete or
  resending mail.
- Attachment bytes are fetched by the platform and are not covered by the
  request-size check.
- Waiting retries do not reserve campaign admission capacity; runnable prepared
  deliveries and active submissions do. Ambiguous outcomes leave the send
  queue. No worker contains an unbounded queue-draining loop.

These bounds are not a process-memory ceiling. Observe peak RSS and queue
growth in a controlled rollout with representative message sizes. If resources
rise unexpectedly, disable the ready reactors and scheduled send/render jobs
together and retain delivery state for diagnosis.

## Diagnose a delivery

Capture the source record ID and bulk delivery ID before changing anything;
`source` and `source_record_key` identify the owning workflow.

The platform submission key is `bulk-email-delivery:<delivery_id>`. Canonical
webhook delivery and recipient IDs are database IDs plus one; do not confuse
those aliases with IDs shown in database queries.

| State | Meaning and action |
| --- | --- |
| `prepared`, no attempts | Queued. Check the ready reactor and any active submission. |
| `prepared`, attempts > 0 | Explicitly not-sent failure awaiting a safe retry. `error` retains the latest reason. An unchanged frozen request may have newly invalid addresses excluded by the worker before retrying. |
| `submitting`, lease valid | In flight. Do not prepare a replacement because it seems slow. |
| `submitting`, lease expired | Outcome may be unknown. The next sweep classifies it; inspect response evidence. |
| Terminal, callback incomplete | A future `next_attempt_at` is callback backoff, not another send. Repair the callback; the reactor/sweep retries bookkeeping. |
| Failed before dispatch after a consent change | Not replayed. Prepare a new eligible audience from confirmed not-sent recipients. |
| Recipient `send_unknown` | Reconcile provider evidence. Missing events prove neither sending nor non-sending. |

## Diagnostic evidence

`bulk_email_delivery_attempt` error logs carry delivery/source identity,
attempt, request hash, submission key, and timing. They record freeze failures
and **every provider response**, including successful acceptance, before completion
checks ownership, so the provider bulk ID survives a lease expiring between
response and completion (a stale worker still cannot change state). Because
successes share the error-log tag, classify incidents by phase, response
fields, and delivery state, not by the tag alone.

`bulk_email_delivery_terminal` logs carry the callback error and retry delay;
the original submission error remains intact. To retry a repaired callback manually, call
`bulk_email_delivery_complete_callback` with `p_delivery_id` after
`next_attempt_at`; it respects backoff and does nothing if already completed.

`bulk_email_delivery_event` logs capture correlated bounce/complaint events.
Bounce explanations remain on recipients through submission completion and
lease expiry.

`marketing_email_campaign_due` logs identify the campaign generation and
rendering error. A stale renderer's failure cannot fail the new generation.

The `recipient_validation_refreeze` phase records a validator upgrade applied
to a confirmed not-sent retry: the original and filtered request hashes and the
number excluded. The original hash must match before filtering; content or
consent changes and evidence of submission prevent this recovery. The worker
keeps the same delivery identity and attempt limit, and never clears a hash or
requeues a terminal delivery.

Query focused `bulk_email_deliveries__versions` and
`bulk_email_delivery_recipients__versions` history for committed local
changes, including retry reasons later cleared by success and operator
reconciliation. See [transaction history](../sql/transaction_queries.md).
Provider event time, local receipt time, and commit time have different
meanings.

**Retention:** application code cannot set platform log retention; captures
are not a permanent audit trail. During an incident, export the relevant logs,
IDs, provider evidence, and focused history into the incident record before
capture expiry. Never export email bodies, credentials, or tokens.

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

Pass a returned execution ID to `capturedExecution` and match the delivery and
attempt IDs in its log. Do not filter only for
`success: false`: a handled rejection or safe retry finishes the worker
successfully while recording a delivery failure.

Documented capture retention is seven days and captures are sampled. If reads
report unavailable, give the platform operator
the worker name, delivery/attempt IDs, log tag, and UTC incident window.

## Reconcile without resending

`BulkEmailReconciliation` (from `blocks/bulk_email_delivery`, also composed by `MarketingEmailCampaignBlock.DeliveryResultsPage`) exposes
**Uncertain recipient**, **Provider evidence**, **Confirm sent**, and
**Confirm not sent**. Its `authorize` callback enforces the owning
application's management boundary on the server.

Record a provider message ID or support reference for each recipient
separately. Confirm sent only when that recipient was sent the message; confirm
not sent only when the provider explicitly establishes non-dispatch. Silence,
a missing webhook, or an expired lease is insufficient. The action never sends
and never changes peers; stale confirmations and not-sent claims contradicted
by local sending evidence are rejected.

A correlated delivery, bounce, complaint, open, or click event (open/click only
with engagement tracking) automatically changes a recipient from unknown to
submitted; an unsubscribe event alone does not. Evidence arriving before an
ambiguous response or lease expiry is preserved. The original failed attempt
and its completed terminal callback remain intact; reconciliation is not a
second source-completion callback.

Whole-audience recovery copies are blocked while a failed campaign contains
unknown or already-submitted recipients. If only some recipients are proven not
sent, prepare a new campaign using **only that subset**, respecting current
consent. Do not clear request hashes, reset failed deliveries to prepared,
delete suppressions to force a send, or copy the original audience as a
recovery step.

## Release evidence still required

Application tests use a mock service boundary. Before rollout, verify the real
platform's non-dispatch guarantee, authenticated webhook forwarding, event
correlation/replay, provider-job access, and diagnostic retention, and run a
controlled canary covering delivery, unsubscribe, bounce, and a safe failure.
