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

`MarketingEmailCampaignBlock` provides campaign drafts and scheduled,
template-based sends over a configured `BulkEmailDeliveryBlock`. It is for
platform-managed marketing mail. It does not send through user-owned Gmail or
Outlook accounts; use `ConnectedAccountEmailDeliveryBlock` for bounded CRM
mail merges through connected accounts.

## Configure the block

The block requires a bulk-delivery block, at least one configured platform
sender, and an audience adapter. The audience query must return
`source_recipient_key` and `email`; `isRecipientEligible` is rechecked when a
delivery is submitted.

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

Register `EmailTemplatesBlock` (or an equivalent owner of `email_templates`)
when the system needs the template authoring UI and schema. The campaign block
requires an active template with a non-empty subject and authored body; it does
not provide template editing itself.

Basic templates must contain non-whitespace text or an image with a non-empty
source. Empty Lexical paragraphs and HTML wrappers do not count as content.
This is checked at scheduling and again when rendering the due campaign, so
clearing a scheduled template's body fails the campaign before dispatch.

## Draft and schedule lifecycle

Initialization creates `marketing_email_campaigns` and the
`marketing_email_campaign_due` scheduled procedure. A campaign starts as a
`draft`, is changed to `scheduled` by `schedule(...)`, becomes `submitting`
when the due procedure claims it, and ends as `submitted` or `failed`.

Call `schedule(s, { campaignId, scheduledAt?, recipientsQuery? })` inside the
same server transaction as related draft changes. The template must be active
and complete, the campaign must still be a draft, and its `sender_key` must
name a configured sender. The audience is frozen into the held bulk delivery
at schedule time. `recipientsQuery` can provide a selected subset, but it must
keep the required audience columns.

For creation, call
`createAndSchedule(s, { name, templateId, senderKey, scheduledAt?, recipientsQuery?, campaignIdScalar })`.
It validates and creates the draft through a shared stored procedure, then
schedules it in the caller's transaction. `campaignIdScalar` names the output
scalar declared by the method.

To copy a completed or failed campaign, call
`copyToDraft(s, { campaignId, campaignIdScalar })` in the caller's transaction.
It copies the name, template, and sender into a new draft, without the old
delivery. Failed campaigns with uncertain or already-submitted recipients are
rejected. Both methods leave system-specific authorization to their callers;
custom campaign fields must provide defaults if these standard creation paths
are used.

To return a held campaign to a draft, call `unschedule(s, campaignId)` in the
same transaction. This discards the held delivery atomically. The ready reactor
releases one due campaign when no delivery is ready for submission or being
submitted. A delivery waiting in retry backoff does not block unrelated campaigns.
Completion wakes the next due campaign. A 15-minute fallback sweep
covers time-based eligibility when there are no intervening data changes: future
campaigns can start up to 15 minutes late before any queue or provider delay.

Rendered content and render failures are fenced to the captured delivery ID and
schedule time. Unscheduling/rescheduling while rendering cannot release, fail,
or discard the replacement generation. Remaining campaigns stay scheduled and
can still be unscheduled.

## Template variables and limits

The reserved `email` variable is the normalized recipient address. Add
campaign-scoped variables with `campaignVariables` and recipient-scoped
variables with `recipientVariables`; names are lowercase identifiers and may
not collide across scopes. Values are rendered into the subject and HTML/text
template. Recipient eligibility is checked again at submission, so a frozen
audience does not bypass current suppression or consent rules.

The bulk-delivery block owns its own recipient, payload, suppression, and
retry limits. Keep those transport rules in
[Bulk Email Delivery](./bulk_email_delivery.md); this block owns campaign
state and scheduling.
