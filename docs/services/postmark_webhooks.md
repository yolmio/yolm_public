---
title: Postmark Webhooks
description: Static webhook helper for Postmark bounce and spam complaint events.
tags:
  - services
  - postmark
  - webhooks
  - email
related:
  - services/postmark.md
  - blocks/postmark_campaign.md
  - services/solution_services.md
---

# Postmark Webhooks

`services/postmark_webhooks` exports `PostmarkWebhooks` and a default
`postmarkWebhooks` instance. Use it to declare a static webhook endpoint and
manual registration callbacks for Postmark bounce/spam-complaint processing
and, optionally, to create local webhook tables for bounce/campaign reporting.

```ts
import { postmarkWebhooks } from "services/postmark_webhooks";

postmarkWebhooks.addDbTables();
postmarkWebhooks.bounceWebhook((s) => {
  s.modify(sql`insert into db.email_event_log (payload) values (body)`);
});
```

## Configuration

`new PostmarkWebhooks(opts?)` accepts:

| Option | Type | Meaning |
| --- | --- | --- |
| `webhookBaseName` | `string` | Static webhook key prefix. Default `"postmark"`. |
| `webhookToken` | `Sql` | Expected `X-Postmark-Token`. Defaults to static secret `postmark`. |
| `extensions.onWebhookReceived` | `(s, { body }) => void` | Optional hook that runs before token validation. |

## Tables

`addDbTables()` declares:

| Table | Purpose |
| --- | --- |
| `postmark_webhook` | Tracks registered Postmark webhook ids and URLs. |
| `postmark_bounce_events` | Bounce payload fields. |
| `postmark_spam_complaints` | Spam complaint payload fields. |
| `postmark_webhook_log` | Raw webhook payload audit log. |

## Handler

| Method | Purpose |
| --- | --- |
| `bounceWebhook(handler?)` | Handles `Bounce` and `SpamComplaint` records, writes local bounce/spam tables, and runs the optional handler. |

The handler receives an endpoint statement scope with `body`, `event_type`,
`message_id`, and `received_at` scalars already defined.
