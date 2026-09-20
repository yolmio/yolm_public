---
title: Edges
description: How to define Yolm edges — code that runs at the edge of the system to bridge between the server and external integrations.
tags:
  - concepts
  - edges
  - drivers
  - integrations
---

# Edges

Edges are units of code that run **at the edge of the system** — typically
close to clients or external services (hardware, payment gateways, modems,
print servers, etc.). An edge binds one or more **drivers** (typed external
service handles) and reacts to **events**: boot, timer, reactor, and
driver events.

Compared to ordinary server procedures, edge handlers can interleave
`server(...)` blocks (which run on the database) with `driverSend(...)`
calls (which dispatch typed commands to a driver).

Edges live under `edges/` in a system folder and are declared with
`system.edge(...)`.

## Basic Structure

```typescript
const edge = system.edge({
  name: "store",
  drivers: {
    printer: {
      type: "document_printer",
    },
  },
});

edge.validateConfig((s, config) => {
  s.assert(
    sql`(${config}->>'store_id') is not null`,
    "store_id is required",
  );
});

edge.onBoot({
  procedure: (s) => {
    s.server((s) => {
      s.modify(sql`update db.devices set online_at = now() where edge = 'store'`);
    });
  },
});
```

Calling `system.edge(...)` returns its [`EdgeBuilder`](../../packages/std/system.tsx).
Each edge name has exactly one definition.

## Drivers

Drivers are declared on the edge and looked up inside handlers via
`edge.driver(name)`. The returned binding carries its declared type, so its
events, actions, and action parameters are checked at compile time:

```typescript
const printer = edge.driver("printer");

edge.onTimer({
  name: "print_queue",
  everyMs: 5_000,
  procedure: (s) => {
    s.server((s) => {
      s.defScalar("job_count", sql`(select count(*) from db.print_jobs)`);
      s.defRecord("job", sql`select id, body from db.print_jobs limit 1`);
    });
    s.if(sql`job_count > 0`, (s) => {
      s.driverSend(
        printer.send({
          action: "print",
          params: { content: sql`job.body` },
          durability: "durable",
          commandId: sql`job.id`,
        }),
      );
    });
  },
});
```

A `driverSend` with `durability: "durable"` requires a `commandId` so the
edge can replay it after a restart.

For `external:*`, the executable belongs to the deployed
driver binding. Per-machine instance config can supply addresses, credentials,
timeouts, and other installation data, but cannot replace executable identity.

Printer backends are built into yolm-edge: `document_printer` accepts PDF bytes;
`raw_printer` sends printer-ready bytes unchanged. For an application queue with
attempt tracking and explicit retry, use [PrintersBlock](../blocks/printers.md)
rather than this illustrative timer.

## Handler Types

The `EdgeBuilder` exposes one method per event source:

- `onBoot(opts)` — runs once when the edge boots.
- `onTimer({ name, everyMs, runOnStart?, procedure })` — runs on a fixed
  interval. `runOnStart: true` fires the handler immediately on boot.
- `onReactor({ name, query, procedure })` — re-evaluates `query` on every
  change and runs `procedure` when the result changes (edge-side reactor).
- `onDriver({ name, driver, event, batch?, procedure })` — runs when a bound
  driver emits the named event. `batch` processes a bounded microbatch once
  any of `maxItems`, `maxWaitMs`, or `maxBytes` is reached.

Pass the binding returned by `edge.driver(...)` as `driver`; this prevents a
handler from naming an undeclared driver or event. Define the one-time local
setup with `edge.setup(...)`.

A batched driver handler reads ordered rows from `event_batch`, batch identity
and timing from `event_batch_meta`, and binary values from
`event_batch_blobs`. Use `batch_index` whenever order matters. These raw
relations stay local to the Edge and cannot be referenced inside
`s.server(...)`; derive a scalar, record, or table locally and use that derived
value in the server block. Durable batches retain stable membership and
`batch_id` across retries, so server writes should use `batch_id` as their
idempotency key.

## Statement Ordering Rules

Inside handlers, every reachable path must keep `server(...)` blocks
**before** any `driverSend(...)`. The compiler validates this. Practically: do
all database reads/writes first, decide
what to dispatch, then dispatch.

## Config Validation

`validateConfig` runs against the edge's config value (the JSON blob
admins fill in when provisioning an edge). The validator receives a
statement builder and the config expression. Use `s.assert(...)` or
similar to fail the deploy on misconfiguration.

## Examples

See `examples/*/edges/` for working edge definitions.

## Related

- [Reactors](./reactors.md) — server-side equivalents
- [Pipelines](./pipelines.md) — bulk data movement
- [Service integrations](./service_integrations.md) — managed external services
