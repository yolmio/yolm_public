---
title: Postmark Campaign Provider
description: Reusable Postmark provider for a system-owned campaign workflow.
tags:
  - blocks
  - email
  - postmark
---

# Postmark Campaign Provider

`PostmarkProvider` and `PostmarkIntegrationCard` implement
`EmailCampaignProvider` for system-owned campaign workflows, with individual
sends plus the legacy bounce checks. See the
[Gmail campaign provider](./gmail_campaign.md) for how this boundary relates to
platform bulk delivery.

```typescript
import type { EmailCampaignProvider } from "blocks/email_campaign_provider";
import { PostmarkIntegrationCard, PostmarkProvider } from "blocks/postmark_campaign";

const providers: EmailCampaignProvider[] = [new PostmarkProvider()];
const providerIntegrationComponents = [<PostmarkIntegrationCard />];
// Pass both constants to the system-owned campaign implementation.
```

The system-owned campaign owns the account, campaign, recipient, and response
tables.
