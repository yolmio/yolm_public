---
title: Postmark Campaign Provider
description: Reusable Postmark provider for a system-owned campaign workflow.
tags:
  - blocks
  - email
  - postmark
---

# Postmark Campaign Provider

`PostmarkProvider` and `PostmarkIntegrationCard` are account-provider adapters
that implement `EmailCampaignProvider` for system-owned campaign workflows.
They are separate from platform-managed `BulkEmailDeliveryBlock`.

```typescript
import type { EmailCampaignProvider } from "blocks/email_campaign_provider";
import { PostmarkIntegrationCard, PostmarkProvider } from "blocks/postmark_campaign";

const postmarkProvider = new PostmarkProvider();
const providers: EmailCampaignProvider[] = [postmarkProvider];
const providerIntegrationComponents = [
  <PostmarkIntegrationCard provider={postmarkProvider} />,
];
// Pass both constants to the system-owned campaign implementation.
```

The system-owned campaign owns the account, campaign, recipient, and response
tables. The provider implements individual sends plus the legacy bounce checks.
New platform bulk sends do not configure Postmark accounts or webhooks in a
system; the platform owns those concerns globally.
