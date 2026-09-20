---
title: SendGrid Service
description: Yolm service client for the SendGrid v3 marketing-contacts API.
tags:
  - services
  - sendgrid
  - email
  - marketing
---

# SendGrid Service

`services/sendgrid` exports `SendGrid` (the API client class) and a default
`sendGrid` singleton wired to the `sendgrid_api_key` static secret.

The current surface focuses on **marketing contacts**: pulling contacts
out of SendGrid into a procedure-scope table, adding new ones, and
deleting them.

## Importing

```ts
import { sendGrid } from "services/sendgrid";
```

To customize the API key:

```ts
import { SendGrid } from "services/sendgrid";

const altSendGrid = new SendGrid({
  apiKey: sql.lit`other_sendgrid_api_key`,
});
```

## Contacts

The `.contacts` accessor exposes three helpers, each returning a
`(s) => …` server-procedure builder so they compose with the rest of
the procedure surface:

```ts
// Pull every marketing contact into the in-procedure table `sendgridEmail`
sendGrid.contacts.export()(s);

// Add the rows in `staged_emails` (a procedure-scope table) as marketing contacts
sendGrid.contacts.addContacts({ emailTableName: "staged_emails" })(s);

// Delete the rows in `staged_contact_ids`
sendGrid.contacts.deleteContacts({ contactIdTableName: "staged_contact_ids" })(s);
```

Reusable table definitions for the staging tables ship as `addedContactsTable`
and `deletedContactsTable` (pass to `s.defTable(...)`).

## Prerequisites

- `StaticSecretsBlock` registered in core so the `sendgrid_api_key` static
  secret can be read.

## Related

- [Static secrets block](../blocks/static_secrets.md)
- [Outbox patterns](../concepts/outbox.md) — for transactional email delivery
