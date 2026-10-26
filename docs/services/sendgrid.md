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

To use a different API key, pass the **name** of another static secret.
Unlike HubSpot and Calendly, whose options take the secret value, SendGrid's
`apiKey` option is a secret name; the client reads it with `getStaticSecret`
when it builds the `Authorization` header:

```ts
import { SendGrid } from "services/sendgrid";
import { sql } from "std/sql_utils";

const altSendGrid = new SendGrid({
  apiKey: sql.lit`other_sendgrid_api_key`, // static secret name, not the key
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

Each helper also accepts `optIn`; see
[External-Service Opt-In](./solution_services.md#external-service-opt-in).

Reusable table definitions for the staging tables ship as `addedContactsTable`
and `deletedContactsTable` (pass to `s.defTable(...)`).

## Prerequisites

- `StaticSecretsBlock` registered in core so the `sendgrid_api_key` static
  secret can be read.

## Related

- Store API keys as server-side static secrets.
- [Outbox patterns](../concepts/outbox.md) — for transactional email delivery
