---
title: Brevo Service
description: Brevo contacts, lists, folders, templates, campaigns, senders, and marketing webhook helpers.
tags:
  - services
  - brevo
  - email
  - marketing
related:
  - blocks/static_secrets.md
  - services/solution_services.md
---

# Brevo Service

`services/brevo` exports `Brevo` and a default `brevo` instance. The default
instance reads the `BREVO_API_KEY` static secret and uses `"brevo"` as its
static-webhook key prefix.

```ts
import { brevo } from "services/brevo";

brevo.contacts.lists.listAll({ resultTable: "brevo_lists" })(s);
```

## Client

`new Brevo(opts?)` accepts:

| Option | Type | Meaning |
| --- | --- | --- |
| `apiKey` | `Sql` | API key expression. Defaults to `getStaticSecret('BREVO_API_KEY')`. |
| `webhookBaseName` | `string` | Prefix for static webhook keys. Default `"brevo"`. |

All request helpers accept `optIn?: BooleanExpr` when external-service calls
are gated in the current environment.

## Contacts

| Helper | Purpose |
| --- | --- |
| `brevo.contacts.campaignStats(opts)` | Defines hard-bounce, soft-bounce, open, and unsubscribe tables for one contact email. |
| `brevo.contacts.folders.list(opts)` | Lists contact folders into `resultTable` and count scalar. |
| `brevo.contacts.lists.create(opts)` | Creates a contact list and sets `listIdScalar` (`"list_id"` by default). |
| `brevo.contacts.lists.import(opts)` | Imports CSV contacts into a list and waits for the Brevo process to complete. |
| `brevo.contacts.lists.list(opts)` | Lists contact lists into `resultTable` and count scalar. |
| `brevo.contacts.lists.listAll(opts)` | Pages through all contact lists. |
| `brevo.contacts.lists.delete(listId, opts?)` | Deletes a list; `404` is treated as already deleted. |

```ts
brevo.contacts.lists.create({
  listName: sql`'Newsletter'`,
  folderId: sql`folder_id`,
  listIdScalar: "brevo_list_id",
})(s);
```

## Templates, Campaigns, And Senders

| Helper | Purpose |
| --- | --- |
| `brevo.emailTemplates.list(opts)` | Lists email templates into `resultTable` and count scalar. |
| `brevo.emailTemplates.listAll(opts)` | Pages through all email templates. |
| `brevo.emailCampaigns.create(opts)` | Creates an email campaign and sets `campaignIdScalar` (`"campaign_id"` by default). |
| `brevo.emailCampaigns.updateStatus(opts)` | Updates a campaign status. |
| `brevo.senders.list(opts)` | Lists senders into `resultTable`. |

## Webhooks

For static webhooks with manual registration controls, call
`brevo.webhook.addDbTable()` once during schema setup, then register event
handlers:

```ts
brevo.webhook.addDbTable();
brevo.webhook.hardBounce((s) => {
  s.modify(sql`insert into db.email_events (email, campaign_id)
    values (event.email, event.camp_id)`);
});
```

Handlers exist for `spam`, `opened`, `click`, `hardBounce`,
`softBounce`, `unsubscribed`, `listAddition`, and `delivered`.

For dynamic webhook registration, import `webhooks` from `services/brevo` and
use `webhooks.<event>.register(apiKey, url)`,
`webhooks.<event>.deregister(apiKey, brevoId)`, or
`webhooks.<event>.handler(handler)`.
