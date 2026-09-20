---
title: Calendly Service
description: Yolm service client for the Calendly v2 REST API with event-type helpers and manual webhook controls.
tags:
  - services
  - calendly
  - integrations
  - webhooks
---

# Calendly Service

`services/calendly` exports the `Calendly` client class plus a default
`calendly` singleton wired to the `CALENDLY_API_KEY` static secret.

Use it to read event types, sync invitees, and manage Calendly webhooks
without hand-rolling auth.

## Importing

```ts
import { calendly } from "services/calendly";
```

The singleton uses the default configuration. For a custom API key /
webhook base name, construct your own:

```ts
import { Calendly } from "services/calendly";

const altCalendly = new Calendly({
  apiKey: getStaticSecret(sql.lit`OTHER_CALENDLY_KEY`),
  webhookBaseName: "calendly_alt",
});
```

## Event types

```ts
s.statements(calendly.eventTypes.list({ /* paging opts */ }));
s.statements(calendly.eventTypes.listAll({ /* paging opts */ }));
```

The `.eventTypes` helper exposes paged cursors. Use `listAll` when you want
to walk every page into one procedure-scope table.

`list` writes event types to `event_type` by default and exposes a
`pagination` record. Override those names with `resultTable` and
`paginationRecord`. `listAll` writes all rows to `event_type` (or its
`resultTable` override) and keeps its internal pagination state private. Event
rows contain `active`, `uri`, `scheduling_url`, `name`, `profile_type`,
`profile_name`, and `profile_owner`; the pagination record from `list`
contains `count` and `next_page_token`.

```ts
s.statements(calendly.eventTypes.listAll({
  organization: sql.lit`https://api.calendly.com/organizations/...`,
  resultTable: "calendly_event_type",
  optIn: sql.true,
}));
```

`organization` scopes the request, `count` controls page size for `list`,
`pageToken` advances a single page, and `optIn` is required when the local
runtime gates external services.

## Webhooks

`calendly.webhook` declares a `system.staticWebhook` endpoint and its manual
registration callbacks. The handler is prefixed with shared signature
verification and payload parsing; use the Static Webhook Management page to
register or de-register the provider subscription.

Call `addDbTable()` once at system-definition time to create the
registration-tracking table, then register one or more invitee events:

```ts
calendly.webhook.addDbTable();
calendly.webhook.inviteeCreated(sql.lit(organizationUri), (s) => {
  // handler runs after payload is parsed into `payload`,
  // `scheduled_event`, `scheduled_event_membership`, `tracking`
});
```

The available event helpers are `inviteeCreated`, `inviteeCanceled`, and
`inviteeNoShowCreated`. For runtime-supplied organization, API key, or callback
URLs, use the `calendlyWebhooks` singleton instead.

Both static and dynamic webhooks read the tenant's encrypted
`CALENDLY_WEBHOOK_SIGNING_KEY` static secret at runtime. This is distinct from
`CALENDLY_API_KEY`: registration sends the signing key to Calendly, and the
handler uses the same secret to verify incoming signatures. It is shared by
Calendly subscriptions within that tenant, not by all Yolm tenants.

Provision a nonempty signing secret before registering or enabling webhooks.
Registration fails before contacting Calendly if it is missing or empty;
incoming requests return HTTP 503 without running the handler. Invalid
signatures return HTTP 400. Ordinary REST operations do not require this secret.

For existing subscriptions, first provision the exact key those subscriptions
already use, then deploy the updated system. Changing only the stored key does
not update Calendly's subscriptions and will reject their deliveries. Rotate
the provider subscriptions and stored secret through a coordinated cutover.
Never put provider credentials in source code, examples, or generated models.

## Prerequisites

- `StaticSecretsBlock` registered in core so the `CALENDLY_API_KEY` static
  secret can be read.
- `CALENDLY_WEBHOOK_SIGNING_KEY` provisioned in that block when using webhooks,
  including the lower-level `calendlyWebhooks` helpers.

## Related

- [Static secrets block](../blocks/static_secrets.md)
- [Static webhooks](../concepts/static_webhooks.md)
