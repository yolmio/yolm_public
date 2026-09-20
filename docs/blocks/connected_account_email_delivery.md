---
title: Connected Account Email Delivery Block
description: Queue bounded mail merges through user-owned Gmail or Outlook accounts with provider limits, recipient snapshots, and explicit uncertain outcomes.
tags:
  - blocks
  - email
  - integrations
  - queues
  - crm
related:
  - blocks/email_integrations.md
  - blocks/bulk_email_delivery.md
  - blocks/solution_blocks.md
---

# Connected Account Email Delivery Block

`ConnectedAccountEmailDeliveryBlock` is a bounded mail-merge outbox for
user-owned Gmail or Outlook accounts. Provider integrations retain ownership
of OAuth, account selection, and provider calls; this block owns the queued
delivery snapshot, recipient variables, rate limiting, retries, and result
state. Its selected-rows dialog owns sender and template selection, validation,
enqueueing, success feedback, and limit messaging. Use it for small CRM sends
from a connected mailbox, not for platform-managed marketing campaigns.

## Configure integrations and sources

Each integration implements the narrow `ConnectedAccountEmailIntegration`
interface from `blocks/email_integrations`: it supplies an `integrationKey`,
display name, rolling-minute and rolling-24-hour limits,
`availableSendersQuery(userId)`, and `sendEmailFromServer(...)`.
The sender query returns `account_id`, `from_address`, and an opaque
`mailbox_identity`. That stable identity must be shared by every connection or
alias that consumes the same provider mailbox quota.

```tsx
import {
  ConnectedAccountEmailDeliveryBlock,
} from "blocks/connected_account_email_delivery";
import type { ConnectedAccountEmailIntegration } from
  "blocks/email_integrations";

// Configure GmailIntegration or OutlookEmailIntegration elsewhere, including
// its normal OAuth options, then adapt the configured instance here.
declare const gmail: ConnectedAccountEmailIntegration;
const delivery = new ConnectedAccountEmailDeliveryBlock({
  integrations: [{
    integrationKey: "gmail",
    integrationName: "Gmail",
    deliveryLimits: {
      maxMessagesPerMinute: 60,
      maxRecipientsPer24Hours: 500,
    },
    availableSendersQuery: (userId) => gmail.availableSendersQuery(userId),
    mailboxIdentityQuery: (accountId) => gmail.mailboxIdentityQuery(accountId),
    sendEmailFromServer: (s, opts) => gmail.sendEmailFromServer(s, opts),
  }],
  maxRecipientsPerDelivery: 500,
});

const crmMail = delivery.registerSource({
  key: "crm_mail_merge",
  selectedRows: {
    templatesQuery: sql`select id, name, subject as subject_template,
        lexical_rich_text_to_html_email(body) as html_template
      from email_templates where is_active and type = 'basic'`,
    recipientsQuery: (selectedIds) => sql`select id::string as source_recipient_key,
        email, json_build_object('first_name', first_name) as variables
      from contacts where id in (select id from ${selectedIds})`,
    authorize: (s) => {
      // Enforce the system's permission for this workflow.
    },
  },
  onTerminal: (s, context) => {
    // Update the source record after the delivery reaches a terminal state.
  },
});

system.addBlock(delivery);
```

The example shows the adapter shape; use the actual constructor options of the
provider integration in the system. Register every source before
initialization; only the delivery block is added here.
The block rejects duplicate source keys and requires at least one integration.

## Selected-row workflow

When a source supplies `selectedRows`, place the block-owned dialog directly in
a datagrid action. The system does not implement sender/template controls or
repeat the enqueue procedure:

```tsx
import {
  ConnectedAccountEmailSelectedRowsDialog,
} from "blocks/connected_account_email_delivery";

dialog: ({ openScalar }) => (
  <ConnectedAccountEmailSelectedRowsDialog
    openScalar={openScalar}
    source={crmMail}
  />
)
```

`templatesQuery` is the system adapter and must return `id`, `name`,
`subject_template`, and `html_template`. `recipientsQuery(selectedIds)` is the
domain adapter and must return `source_recipient_key`, `email`, and `variables`.
The optional `authorize` hook enforces system-specific access. The block owns
the rest of the end-user workflow and supports every configured integration.
Set `manualContent` to expose manual subject and rich-text composition in
addition to saved templates; omit it for a template-only workflow.

## Enqueue a delivery

Call `crmMail.enqueue(s, options)` inside the source record's transaction.
`recipientsQuery` must return `source_recipient_key`, `email`, and an object
`variables` column. The block adds the recipient's `email` as a reserved
template variable, rejects duplicate keys or addresses, and creates one
immutable delivery per `(source, source_record_key)`. Re-enqueuing that source
record returns the existing delivery ID.

```tsx
crmMail.enqueue(s, {
  sourceRecordKey: sql`contact_batch.id`,
  integrationKey: sql`contact_batch.integration_key`,
  accountId: sql`contact_batch.account_id`,
  from: sql`contact_batch.from_email`,
  subjectTemplate: sql`contact_batch.subject_template`,
  htmlTemplate: sql`contact_batch.html_template`,
  recipientsQuery: sql`
    select cast(id as string) as source_recipient_key,
           email,
           json_build_object('first_name', first_name) as variables
    from contacts
    where batch_id = contact_batch.id
  `,
  deliveryIdScalar: "delivery_id",
});
```

The configured `maxRecipientsPerDelivery` must be between 1 and 500. Each
recipient's variables object is limited to 10,000 bytes and may not contain
the reserved `email` key. Every recipient row must contain exactly one valid
email address. Provider rate limits are aggregated by integration and stable
mailbox identity; they move pending recipients to `rate_limited`. A scheduled
capacity wake-up returns eligible rows to `pending`. Normalized sender-address
matching keeps pre-identity delivery history in the same quota window after a
connection gains or changes its opaque mailbox identity. The integration also
resolves historical delivery account IDs to their current canonical mailbox
identity, so legacy rows remain in both quota windows when the sender changes
between aliases. Candidate deliveries are resolved the same way before
admission, including legacy queued rows whose stored identity is null.

## Outcomes and reporting

Delivery status is `queued`, `sending`, `sent`, `failed`, or `send_unknown`.
Recipient status additionally includes `pending`, `rate_limited`, and
`sending`. A sending lease that expires after ten minutes becomes
`send_unknown` rather than being retried, because the provider outcome cannot
be proven. Use `summaryQuery(deliveryId)` and
`recipientResultsQuery(deliveryId)` for source-owned UI or reporting.

`ConnectedAccountEmailDeliveryReport` is a route-free report with searchable,
paginated delivery history and aggregate counts. Place it inside the system's own route,
navigation, and permission boundary:

```tsx
import { ConnectedAccountEmailDeliveryReport } from
  "blocks/connected_account_email_delivery";

<ConnectedAccountEmailDeliveryReport />;
```

Use **View recipients** on a delivery to inspect each address, status, wrapped error or reconciliation evidence,
and attempt/completion time. Search and status filters also apply to the CSV
download across all pages. Failed recipients are recorded as unsent; unknown
outcomes need provider confirmation, and pending/rate-limited/sending rows
remain in progress. Inspecting or exporting results never sends mail.
