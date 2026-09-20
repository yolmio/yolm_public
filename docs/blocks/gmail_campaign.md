---
title: Gmail Campaign Provider
description: Reusable Gmail connected-account provider for a system-owned campaign workflow.
tags:
  - blocks
  - email
  - gmail
---

# Gmail Campaign Provider

`GmailProvider` and `GmailIntegrationCard` implement the reusable
`EmailCampaignProvider` boundary for system-owned campaign workflows. The
provider remains package-owned even when a customer owns the campaign schema,
procedures, and pages. New CRM mailbox sending uses `GmailIntegration` with
`ConnectedAccountEmailDeliveryBlock` instead.

Register `OAuthCredentialsBlock` before the system-owned campaign block. The
provider's account connection flow stores managed OAuth credentials there.

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

Mount the campaign's integration page so users can complete OAuth. The
provider sends individual queued messages and supports the legacy response and
bounce checks. It is not used by `BulkEmailDeliveryBlock`, whose provider and
webhook configuration are platform-managed.
