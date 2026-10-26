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
user-owned Gmail or Outlook accounts. Provider integrations keep OAuth, account
selection, and provider calls; this block owns the queued delivery snapshot,
recipient variables, rate limiting, retries, result state, and the
selected-rows send dialog. Platform-managed marketing campaigns use
[`MarketingEmailCampaignBlock`](./marketing_email_campaign.md) instead.

## Configure integrations and sources

Each integration implements `ConnectedAccountEmailIntegration` from
`blocks/email_integrations`. Its sender query returns `account_id`,
`from_address`, and an opaque `mailbox_identity`; that identity must be shared
by every connection or alias that consumes the same provider mailbox quota.

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

Register every source before the block is added. Duplicate source or
integration keys are rejected, at least one integration is required, and
`maxRecipientsPerDelivery` must be between 1 and 10,000. The worker still sends
one recipient per provider request and applies the configured mailbox quotas.

## Selected-row workflow

When a source supplies `selectedRows`, place the block-owned dialog in a
datagrid action; it owns sender/template selection, validation, enqueueing, and
limit messaging for every configured integration:

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

`templatesQuery` must return `id`, `name`, `subject_template`, and
`html_template`; `recipientsQuery(selectedIds)` must return
`source_recipient_key`, `email`, and `variables`. `authorize` enforces
system-specific access. Set `manualContent` to also allow a manual subject and
rich-text body; omit it for a template-only workflow.

Sources can define `isRecipientEligible(recipient)` to recheck the original
contact and its parent/client consent. The argument is an outbox row with
`source_recipient_key`, `recipient_email`, and `delivery_id`. Return false for a
missing or ineligible source record. This check runs when queued, when claiming
work after rate limiting, and at the provider request boundary; it supplements
shared unsubscribe suppression rather than relying on enqueue-time selection.

For advanced templates, `selectedRows.renderTemplateBody(s, {templateId,
htmlScalar})` can call `generateAdvancedTemplateBody` and assign the rendered
HTML to `htmlScalar`. The template query should include advanced templates and
return null HTML for those rows. Call `queueSelectedRows` outside a transaction,
as the block's selected-row dialog does. Its standalone procedure prepares and
renders the content, then authorizes again and enqueues the snapshot inside a
write transaction. Custom callers can use `prepareSelectedRows` followed by
authorization and `enqueue` with the same ordering. The `enqueueSelectedRows`
convenience method is for workflows
whose preparation has no external rendering step. The saved snapshot receives
the same recipient personalization and unsubscribe footer as basic templates.

## Enqueue a delivery

### Send a test first

The selected-row dialog includes **Send test**, comma-separated test addresses (up to 10), and a sample
contact picker. Tests use the selected connected mailbox and the same basic,
advanced, or manual content and personalization as the full send. Only the
test addresses receive the message; the subject starts with `[TEST]`, unsubscribe
links are inactive, and no delivery, recipient outbox, or suppression rows are
created. The dialog and audience selection remain available afterward.

Use plain email addresses without display names, comments, or quotation marks.
Addresses are trimmed and deduplicated without regard to case. Invalid or empty
entries reject the whole list before dispatch. All test destinations share the
same personalized message and are visible in its To field.

Custom callers can use `source.sendTest(s, { senderKey, templateId, selectedIds,
to, sampleRecipientKey, contentSource?, manualSubject?, manualBody? })` outside
a transaction. It revalidates source authorization, the selected sample, and
access to the sending mailbox. Provider errors are surfaced; an uncertain send
asks the user to check Sent Items before trying again. No automatic retry occurs.

Platform campaigns have their own test action using the platform sender;
connected tests always use the selected integration's normal sending adapter.

### Queue the audience

Call `crmMail.enqueue(s, options)` inside the source record's transaction. The
block adds `email` as a reserved template variable, rejects duplicate keys or
addresses, and creates one immutable delivery per `(source,
source_record_key)`; re-enqueuing returns the existing delivery ID.

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

Each recipient's `variables` object is limited to 10,000 bytes, may not
contain `email`, and each row must contain exactly one valid address. Rate
limits are aggregated by integration and mailbox identity and move pending
recipients to `rate_limited`. The scheduled capacity wake-up returns only the
oldest waiting recipients that fit the mailbox's remaining minute and daily
quotas to `pending`, subtracting recipients already pending across its deliveries.
Repeated wake-ups therefore keep the excess parked until capacity is available.
Quota windows also match history by normalized sender address and by
resolving historical account IDs (via `mailboxIdentityQuery`) to the current
identity, so rows sent before an identity existed or changed still count.

## Marketing unsubscribe and shared suppression

For marketing mail merges, set `bulkEmailDelivery` to the system's configured
`BulkEmailDeliveryBlock` and add both blocks to the system. This enables the
same `bulk_email_suppressions` list used by platform campaigns. Direct individual
emails sent through the integration do not use this outbox and are unaffected.

Every marketing mail merge appends the shared visible unsubscribe footer and
provides a reserved `unsubscribe_url` variable. Recipient-supplied `email`,
`unsubscribe_url`, and `one_click_unsubscribe_url` variables are rejected.
The connected-account path provides a visible confirmation link; it does not
add provider-native one-click unsubscribe headers.

The block owns `/connected-account-email/unsubscribe` on the global API.
GET displays confirmation without changing consent, so link scanners cannot
unsubscribe recipients. POST records an idempotent, normalized-email suppression
shared across connected accounts and platform bulk delivery. Invalid POST tokens
return the same generic confirmation without changing data. Links use opaque
256-bit random tokens and require no login.

Suppression and source eligibility are checked when enqueueing, when claiming queued work, and before
provider dispatch (including the integration's `beforeEmailSent` boundary).
Suppressed or source-ineligible recipients are recorded as `excluded` and never submitted. An
entirely excluded delivery finishes as `excluded`; mixed deliveries retain
individual sent/excluded results. Rate-limited work rechecks suppression when
capacity becomes available. An opt-out cannot recall an email already submitted
to the provider.

### Schema additions

When configured, `connected_account_email_recipient_outbox` adds two compatible
nullable fields: `unsubscribe_token` (written at enqueue/legacy claim and read by
the renderer and public confirmation endpoint) and `unsubscribed_at` (written by
confirmation POST and read by recipient reports). Older queued rows acquire a
token when claimed; previously sent messages cannot gain a footer retroactively.
Both connected delivery and recipient status enums add `excluded`, written by
suppression checks/terminal completion and read by reports. No new table or
historical data rewrite is required.

## Outcomes and reporting

Owned tables: `connected_account_email_deliveries` (one immutable delivery
snapshot) and `connected_account_email_recipient_outbox` (per-recipient
variables and status).

Delivery status is `queued`, `sending`, `sent`, `failed`, `send_unknown`, or `excluded`;
recipient status replaces `queued` with `pending` and `rate_limited`. A sending lease that
expires after ten minutes becomes `send_unknown` rather than being retried.
Use the source's `summaryQuery(deliveryId)` and
`recipientResultsQuery(deliveryId)` for source-owned UI.

`ConnectedAccountEmailDeliveryReport` is a route-free report of delivery
history and counts; place it inside the system's own route and permission
boundary:

```tsx
import { ConnectedAccountEmailDeliveryReport } from
  "blocks/connected_account_email_delivery";

<ConnectedAccountEmailDeliveryReport />;
```

**View recipients** shows each address, status, error, timing, and (for marketing)
unsubscribe time; filters
also apply to the CSV download. Failed means unsent; unknown outcomes need
provider confirmation. Inspecting or exporting results never sends mail.
