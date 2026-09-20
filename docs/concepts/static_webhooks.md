---
title: Static webhooks
description: Define code-defined webhook endpoints with manual provider registration controls.
tags:
  - concepts
  - webhooks
  - integrations
---

# Static webhooks

A **static webhook** is an HTTP endpoint defined in code (not configured by an
admin). Its provider registration is managed manually from the Static Webhook
Management page.

Compared to ordinary API endpoints, static webhooks bundle three things:

1. The HTTP handler the external service calls.
2. A `register` procedure that tells the service the webhook exists.
3. A `deregister` procedure that removes the registration.

The management page shows `webhookRegistered` and invokes the registration
callbacks when an administrator selects Register or De-register. Deploying or
removing a declaration never changes the provider subscription.

## Configuring the domain

Static webhooks are served on a single domain — set it on the system
singleton:

```typescript
system.staticWebhookDomain = "hooks.example.com";
```

The public URL is then
`https://hooks.example.com/api/static_webhook/<key>`. The framework
passes that URL to the `register` callback.

## Declaring a webhook

```typescript
import { system } from "std/system";

system.staticWebhook({
  key: "stripe_payment",
  jsonBodyScalar: "body",
  handler: (s) => {
    // Called when Stripe POSTs to /api/static_webhook/stripe_payment
    s.modify(sql`
      insert into db.stripe_events (raw)
      values (body)
    `);
  },
  register: (url) => (s) => {
    // Call the external service to create the subscription, then record it.
    s.try({
      body: (s) => {
        registerStripeWebhook(url)(s); // your service helper that POSTs to Stripe
        s.startTransaction();
        s.modify(sql`
          insert into db.stripe_settings (webhook_key, webhook_url)
          values ('stripe_payment', ${url})
        `);
        s.commitTransaction();
      },
      errorName: "err",
      catch: (s) => s.debugExpr(sql`err.message`),
    });
  },
  deregister: (s) => {
    s.defScalar(
      "webhook_url",
      sql`(select webhook_url from db.stripe_settings where webhook_key = 'stripe_payment')`,
    );
    s.unless(sql`webhook_url is null`, (s) => {
      deregisterStripeWebhook(sql`webhook_url`)(s); // your service helper
      s.startTransaction();
      s.modify(sql`delete from db.stripe_settings where webhook_key = 'stripe_payment'`);
      s.commitTransaction();
    });
  },
  webhookRegistered: sql`(select exists (select 1 from db.stripe_settings where webhook_key = 'stripe_payment'))`,
});
```

## Manual registration

The standard admin app exposes a **Static Webhooks** page whenever the system
declares one or more static webhooks. The page uses `webhookRegistered` to show
the current status and passes the public URL to `register` when Register is
selected. De-register invokes `deregister`.

Both callbacks must be idempotent and tolerate a missing provider
subscription.

## Related

- [APIs overview](../api/overview.md) — non-managed webhook endpoints
