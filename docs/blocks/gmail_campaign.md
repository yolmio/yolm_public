---
title: Gmail Campaign Provider
description: Reusable Gmail connected-account provider for a system-owned campaign workflow.
tags:
  - blocks
  - email
  - gmail
---

# Gmail Campaign Provider

`GmailProvider` and `GmailIntegrationCard` implement the
`EmailCampaignProvider` boundary (`blocks/email_campaign_provider`) for
system-owned campaign workflows, which own the campaign schema, procedures, and
pages. The provider sends individual queued messages and supports the legacy
response and bounce checks. It is unrelated to
[`BulkEmailDeliveryBlock`](./bulk_email_delivery.md), whose provider and
webhooks are platform-managed. New CRM mailbox sending uses `GmailIntegration`
with [`ConnectedAccountEmailDeliveryBlock`](./connected_account_email_delivery.md).

Register `OAuthCredentialsBlock` before the campaign block; the account
connection flow stores managed OAuth credentials there.

```typescript
import type { EmailCampaignProvider } from "blocks/email_campaign_provider";
import { GmailIntegrationCard, GmailProvider } from "blocks/gmail_campaign";
import { OAuthCredentialsBlock } from "blocks/oauth_credentials";

const gmailProvider = new GmailProvider();
const providers: EmailCampaignProvider[] = [gmailProvider];
const providerIntegrationComponents = [
  <GmailIntegrationCard provider={gmailProvider} />,
];
system.addBlock(new OAuthCredentialsBlock());
// Pass both constants to the system-owned campaign implementation.
```

Mount the campaign's integration page so users can complete OAuth.
