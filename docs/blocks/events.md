---
title: Events Block
description: Append-only domain events, record bindings, idempotency, corrections, and physical trace data with EventsBlock.
tags:
  - blocks
  - events
  - audit
  - workflows
related:
  - concepts/blocks.md
  - blocks/auth.md
  - concepts/reactors.md
---

# Events Block

`EventsBlock` provides typed append-only events, generic record bindings, and a
`physical_trace` read model. It is useful when workflows need durable history,
correlation, idempotency, corrections, or a common physical movement trace.

Initialize `AuthBlock` first because event actors reference `sys_users`. Register
at least one aggregate type and one event type:

```ts
import { AuthBlock } from "blocks/auth";
import { EventsBlock } from "blocks/events";

system.addBlock(new AuthBlock({
  permissions: [],
  appAuthTypes: ["otp"],
}));
const events = new EventsBlock({
  aggregateTypes: [{ name: "order", displayName: "Order" }],
  eventTypes: [{ name: "order.created", displayName: "Order Created" }],
});
system.addBlock(events);
```

Call `events.emit(s, options)` from a server procedure. It writes `db.events`,
automatically binds the aggregate in `db.event_bindings`, and can add more
bindings. Supply the event's `summary`, `aggregateId`, `aggregateType`,
`eventType`, and output scalar name; use `idempotencyKey`, `causationEventId`,
or `correctionOfEventId` when the workflow needs those relationships.

Use `events.appendPhysicalTrace(s, options)` only for normalized physical
movement records. The domain event remains the source of truth.

The block owns `events`, `event_bindings`, and `physical_trace`, plus the
`event_aggregate_type` and `event_type` enums. Do not redefine those tables.
