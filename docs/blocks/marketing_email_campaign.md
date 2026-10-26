---
title: Marketing Email Campaign Block
description: Configure scheduled template-based marketing campaigns over platform bulk delivery, with frozen audiences, sender identities, and campaign variables.
tags:
  - blocks
  - email
  - marketing
  - scheduling
related:
  - blocks/bulk_email_delivery.md
  - blocks/email_templates.md
  - concepts/scheduled_jobs.md
  - blocks/solution_blocks.md
---

# Marketing Email Campaign Block

`MarketingEmailCampaignBlock` provides scheduled,
template-based sends over a `BulkEmailDeliveryBlock`. It is for
platform-managed marketing mail; bounded CRM mail merges through user-owned
Gmail or Outlook accounts use
[`ConnectedAccountEmailDeliveryBlock`](./connected_account_email_delivery.md).

## Configure the block

The block requires a bulk-delivery block, at least one sender, and an audience
adapter. The audience query must return `source_recipient_key` and `email`;
`isRecipientEligible` is rechecked at submission, so a frozen audience does not
bypass current suppression or consent rules.

```tsx
import {
  MarketingEmailCampaignBlock,
} from "blocks/marketing_email_campaign";
import { BulkEmailDeliveryBlock } from "blocks/bulk_email_delivery";

const delivery = new BulkEmailDeliveryBlock();
const campaigns = new MarketingEmailCampaignBlock({
  delivery,
  senders: {
    marketing: {
      fromAddress: "marketing@example.com",
      replyTo: "support@example.com",
    },
  },
  audience: {
    recipientTableName: "contacts",
    recipientsQuery: (campaign) => sql`
      select cast(id as string) as source_recipient_key, email
      from contacts
      where marketing_opt_in = true
    `,
    isRecipientEligible: (recipient) => sql`${recipient}.marketing_opt_in`,
  },
});

system.addBlock(delivery);
system.addBlock(campaigns);
```

Other audience options (`defineCampaignFields`, `campaignVariables`,
`recipientVariables`) are typed by `MarketingEmailCampaignAudience` in
`packages/blocks/marketing_email_campaign/index.tsx`. Variable names are
lowercase identifiers, may not collide across scopes, and may not use the
reserved `email` (the normalized recipient address).

A sender may instead supply `resolve(recipient, campaign)`, a SQL expression
returning a JSON object with `from_address`, nullable `reply_to`, and an object
of `variables`. Declare those variable names and descriptions in the sender's
`variables` option so they appear in the template builder. `resolve` and static
`fromAddress`/`replyTo` configuration are mutually exclusive.

The resolver receives the source recipient row and campaign row aliases. The
system adapter owns the owner lookup, allowed sender domains, and fallback
policy; the block owns validation, freezing, batching, rendering, and delivery.
Return SQL null or an object with an `error` string when an identity cannot be used: scheduling rejects the entire
audience before creating deliveries, and test sending rejects that sample.
Resolved addresses must be nonempty, at most 500 characters, and contain no
line breaks. The adapter must restrict addresses to identities its provider
allows. Include an empty JSON object when no sender variables are needed.

The optional resolver field `is_fallback` marks fallback recipients in sender
previews. Set audience `recipientLabel` and `recipientHref` to identify contacts
and link to their correction page. Scheduling errors include the affected count
and up to five contact-specific reasons; the selected-row preview paginates all
problems. Supply `SelectedRowsDialog.previewAudience(selectedIds)` using
`buildAudienceQuery` with the same selection and eligibility as scheduling.
It shows recipient counts by From/Reply-To and fallback counts after deduplication
and suppression. The test dialog shows the sample's resolved From/Reply-To.
Campaign list sender labels use frozen delivery identities once scheduled;
`senderLabel` in the page configuration describes configurations without frozen deliveries.

For example, an adapter with a validated owner relation can return:

```ts
sql`(select json_build_object(
  'from_address', owner.email,
  'reply_to', owner.email,
  'variables', json_build_object('sender_name', owner.name)
) from owners owner where owner.id = ${recipient}.owner_id)`
```

Sender variables share the same namespace as campaign and recipient variables.
Their declared names cannot overlap those scopes or reserved delivery variables.
Sender identity and variable values freeze when scheduling; changing ownership
later does not change a queued message. Cancel and create a new campaign to resolve
the identities again. This feature uses the platform provider and does not send
through connected mailboxes.

When replacing campaign-wide sender variables with a resolver, configure
`legacyVariables` on that sender with the previous values. Before releasing a
held campaign, the block adds these defaults only to missing recipient variable
keys across its batches. Existing values (including empty strings and JSON null)
and frozen From/Reply-To addresses are preserved; released requests are never
rewritten. Each legacy key must be declared in the sender's `variables` map.

Templates come from [`EmailTemplatesBlock`](./email_templates.md) (or another
owner of `email_templates`). A campaign requires an active template with a
non-empty subject and authored body (`isMarketingEmailTemplateReady`); for
basic templates only non-whitespace text or an image with a source counts. This
is checked at scheduling and again at render, so clearing a scheduled
template's body fails the campaign before dispatch.

## Owned schema

- `marketing_email_campaigns`: one campaign and its schedule/delivery state. Its
  existing `delivery_id` remains the first delivery and the scheduling fence.
- `marketing_email_campaign_delivery_batches`: additional provider deliveries,
  linked by required `first_delivery_id` and unique required `delivery_id` foreign
  keys to `bulk_email_deliveries`. Scheduling writes these links; eligibility,
  rendering, terminal callbacks, and reports read them. Render failure deletes held links and deliveries together. Cancellation preserves them as history. This is an additive
  table; existing single-delivery campaigns need no backfill.
- `marketing_email_campaign_status` enum: `scheduled` (created atomically with the audience) -> `submitting` (claimed when due) -> `submitted` or `failed`. A still-held scheduled campaign may instead become `cancelled`.

## Lifecycle methods

Call these inside the caller's server transaction; authorization is left to the
caller. Custom campaign fields must have defaults if the standard creation
paths are used.

| Method | Contract |
| --- | --- |
| `schedule(s, { campaignId, scheduledAt?, recipientsQuery? })` | Newly inserted campaign must be scheduled with no delivery yet, with a ready template and a configured `sender_key`. Freezes and deduplicates the audience into held batches of at most 500 recipients; `recipientsQuery` may select a subset with the same columns. |
| `createAndSchedule(s, { name, templateId, senderKey, scheduledAt?, recipientsQuery?, campaignIdScalar })` | Creates a scheduled campaign and freezes its audience in the same transaction. `campaignIdScalar` names the output scalar the method declares. |
| `cancel(s, campaignId)` | Changes a scheduled campaign to cancelled only while every batch is held; retains its schedule, sender identities and audience. |

Suppressed addresses are removed before sender validation, the audience limit,
and batching. Suppression is still rechecked immediately before each submission.
Campaigns accept up to 10,000 distinct addresses, normalized before deduplication
and batching. The lowest source-recipient key supplies variables for duplicate
addresses, including the sender identity. Recipients are grouped by resolved
From and Reply-To before splitting each group into batches of at most 500.
Provider requests still respect the 500-recipient limit. Each batch
retains its own immutable request and retry state, and consent is rechecked for
every batch. A campaign reaches a terminal state only after all batches finish;
any failed batch makes the campaign failed. `summaryQuery(campaignId?)`, the campaign totals
UI, and Spark results aggregate recipients across all batches.

Rendering is fenced to the captured first delivery ID, schedule time, and campaign status, so
cancelling mid-render cannot release the delivery. Due campaigns are released one at
a time when no delivery is ready or submitting; a 15-minute fallback sweep means
future campaigns can start up to 15 minutes late. See
[operations](./bulk_email_delivery_operations.md) for worker details.

## Reusable campaign UI

These statics add no persistent schema; prop types are exported from
`blocks/marketing_email_campaign`.

- `MarketingEmailCampaignBlock.SelectedRowsDialog`: in a contacts datagrid,
  choose a ready template and a schedule time. `authorize`
  enforces management on the server; `onSchedule` receives the selected-ID
  table and form-value expressions and runs inside the dialog transaction (it
  may call a stored procedure but must not start a second transaction).
  Template IDs are text and need validation/casting; parse
  `scheduleTime` with `marketingCampaignScheduleTime`.
- `MarketingEmailCampaignBlock.CampaignsPage`: history, cancellation, and test sends for scheduled campaigns. Register `marketing_email_campaigns` with
  `system.addDataGridTablesAndEnums` in core before mounting. Pass the sender
  label, `paths`, and an `access` object (`canView`, `canManage`,
  server-side `authorize`, optional `denied`). Defines its own routes.
- `MarketingEmailCampaignBlock.DeliveryResultsPage`: platform delivery results
  and reconciliation under the same `access` contract; children can add
  companion reports such as connected-account results.

Transport limits, suppression, and retries belong to
[Bulk Email Delivery](./bulk_email_delivery.md).

## Test emails

The selected-contact scheduling dialog offers **Send test** before creating a campaign. The campaign list also offers it for scheduled campaigns. Enter up to 10 plain destination addresses separated by commas (without display names, comments, or quotation marks)
and select a sample contact for recipient variables. Before scheduling, the picker
is restricted to the selected contacts and resolves their current sender. Scheduled
tests instead use the frozen recipient email, From/Reply-To, and merge values from
the campaign's delivery batches; contacts outside that snapshot are rejected.
Save template edits first. Tests use the same basic or
advanced template renderer, with a `[TEST]` subject prefix. Unsubscribe links
are inactive (`#`) so a test cannot unsubscribe the sample contact.

`sendTest(s, { templateId, senderKey, to, sampleRecipientKey, recipientsQuery })` (or `campaignId` for an existing scheduled campaign) authorizes through the
caller, like the other block commands. Call it outside a transaction after
checking campaign-management access. Addresses are trimmed and deduplicated without regard to case; the entire list
is validated before sending. The destinations share the same personalized test
and are visible in its To field. It sends one platform email without
creating campaign or bulk-delivery records. For selected-contact tests, pass the
same authorized `recipientsQuery` used for scheduling. Invalid
addresses, unavailable sample contacts, incomplete templates, and service
errors are reported to the caller; the operation does not automatically retry.

Preview sending requires the block's `send_test_emails` external-service
capability. Isolated examples can supply `testEmailMockProcedure` to exercise
success and failure without sending mail.

## Removing campaign drafts

Preparation is saved in templates and contact views. A campaign is created only
when its audience and schedule are committed. Cancelled campaigns cannot be
rescheduled or copied; create a new campaign from the desired contacts instead.
The status enum renames the former `draft` value to `cancelled` using `renameFrom`,
retaining existing records and template references as retired, unsent history.
No tables or columns are added. New rows default to scheduled with the current
time; custom callers must insert and freeze the audience in one transaction.

Spark previews take `{name, template_id, sender_key}` without saving a record
or returning a campaign ID.
Scheduling accepts the same configuration, a future `scheduled_at`, and the
preview fingerprint. Approval remains required; cancellation is terminal.
