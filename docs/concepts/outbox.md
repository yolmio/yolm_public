---
title: Outbox tables & reactors
description: How to use Yolm's transactional outbox pattern for reliable email, SMS, and webhook delivery.
tags:
  - concepts
  - outbox
  - reactors
  - email
  - sms
---

# Outbox tables & reactors

Yolm ships with a transactional **outbox pattern** for reliable delivery
of side-effects (emails, SMS, webhook calls) that should be linked to a
database transaction. Producers `insert` into the outbox table inside the
same transaction as their business write; a per-outbox reactor delivers
the rows asynchronously, retries failures, and records the outcome.

## Defining an outbox table

Declare outbox tables in `core.tsx` (they are part of the database schema
and must exist before any reactor runs).

```typescript
// Plain outbox
system.outboxTable({ name: "background_job" });

// Email outbox (auto-adds provider_message_id)
system.emailOutboxTable({
  name: "user_email",
  fields: (table) => {
    table.string("recipient_email", 254).notNull();
    table.fk("user", "users").notNull();
  },
});

// SMS outbox
system.smsOutboxTable({
  name: "alert_sms",
  fields: (table) => {
    table.string("recipient_phone", 50).notNull();
  },
});
```

These helpers create a `{name}_outbox` table with standard outbox columns:

- `id`, `status` (`outbox_status` enum: `pending`/`sending`/`sent`/`failed`)
- `idempotency_key` (uuid)
- `retry_count`, `retry_after`, `attempted_at`, `completed_at`
- `error` (last error message)

The `emailOutboxTable` / `smsOutboxTable` variants additionally include a
`provider_message_id` column populated by the matching reactor.

## Enqueuing work

Inside a normal procedure (typically inside a transaction), insert a row:

```typescript
s.modify(sql`
  insert into db.user_email_outbox (recipient_email, user)
  values ('alex@example.com', new.id)
`);
```

If the surrounding transaction rolls back, the outbox row goes with it —
no orphaned side effects.

## Email outbox reactor

`system.emailOutboxReactor(...)` defines the executor in a reactor file.
It claims rows, calls `sendEmail`, and records success/failure with
configurable retries and backoff.

```typescript
// reactors/user_email.tsx
system.emailOutboxReactor({
  name: "user_email",
  from: "no-reply@example.com",
  subject: sql`'Welcome, ' || (select name from db.users where id = outbox.user)`,
  htmlBody: sql`'<p>Hi!</p>'`,
  setup: (s) => {
    // Fetch related data, declare scalars, etc.
  },
  onSuccess: (s) => {
    // Optional: update related rows after a successful send
  },
});
```

`to` defaults to `outbox.recipient_email`; override it via the option if
your outbox table stores the recipient elsewhere.

## SMS outbox reactor

`system.smsOutboxReactor(...)` is the SMS equivalent: it claims rows,
calls `sendSms`, and records success/failure.

```typescript
system.smsOutboxReactor({
  name: "alert_sms",
  from: sql.lit("+15551234567"),
  body: sql`'Alert: ' || outbox.message`,
});
```

## Custom outbox reactor

For non-email/SMS deliveries, use `system.outboxReactor(...)` and call
`onSuccess` / `onError` yourself:

```typescript
system.outboxReactor({
  name: "background_job",
  procedure: (s, onError, onSuccess) => {
    s.try({
      body: (s) => {
        // do work...
        onSuccess(s);
      },
      errorName: "err",
      catch: (s) => {
        onError(s, sql`err.message`);
      },
    });
  },
});
```

## Reliability options

All outbox reactors share these knobs (sensible defaults are applied):

- `maxConcurrent` — parallel deliveries (default 5)
- `maxRetries` — attempts before a row moves to `failed` (default 3)
- `crashTimeout` — when a `sending` row is older than this, it's retried
  (default 10 minutes)
- `retryBackoff` — fixed interval string or a function of `retry_count`

## Related

- [Reactors](./reactors.md) — underlying primitive
- [Postmark service](../services/postmark.md) — email delivery
