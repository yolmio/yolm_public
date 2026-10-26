---
title: Solution Service Integrations
description: Solution-facing reference for service modules and integration blocks, including Calendly, HubSpot, SendGrid, Postmark, Google, Microsoft, Gmail, GmailProvider, Outlook, and Zoom.
tags:
  - services
  - integrations
  - solution-patterns
  - solution-development
related:
  - concepts/service_integrations.md
  - services/postmark.md
  - api/overview.md
  - blocks/solution_blocks.md
  - sql/ai_decisions.md
---

# Solution Service Integrations

Use low-level `services/*` modules for direct calls. Prefer integration blocks
for account UI, background sync, or durable local tables.

For general service concepts, see [Service Integrations](../concepts/service_integrations.md).

## Direct Service Modules

| Service | Import | Use when |
| --- | --- | --- |
| Calendly | `services/calendly` | Webhooks, event types, appointment sync. |
| HubSpot | `services/hubspot` | HubSpot contacts sync. |
| SendGrid | `services/sendgrid` or `services/sendgrid/index` | Marketing contact export/add/delete. |
| Postmark | `services/postmark` | Send transactional email through Postmark. See [Postmark](./postmark.md). |
| Postmark webhooks | `services/postmark_webhooks` | Bounce and spam complaint processing. See [Postmark Webhooks](./postmark_webhooks.md). |
| Brevo | `services/brevo` | Brevo marketing contacts, lists, folders, templates, campaigns, senders, and webhooks. See [Brevo](./brevo.md). |
| Twilio | `services/twilio` | SMS delivery through Twilio. See [Twilio](./twilio.md). |
| Google APIs | `services/google/*` | Custom Google auth, calendar, Gmail, or user-info calls not covered by a block. |
| Microsoft APIs | `services/microsoft/*` | Custom Microsoft auth, Azure AD, Outlook email, or user-info calls not covered by a block. |
| Zoom APIs | `services/zoom/*` | Custom Zoom auth or meeting calls not covered by `ZoomIntegration`. See [Zoom](./zoom.md). |
| SOAP/XML helpers | `services/soap` | Legacy XML/SOAP request and response construction. See [SOAP Helpers](./soap.md). |
| QuickBooks IIF | `services/quickbooks_iif` | Tab-delimited QuickBooks IIF header and row construction. See [QuickBooks IIF Helpers](./quickbooks_iif.md). |
| AI providers | `services/open_ai`, `services/anthropic`, `services/gemini`, `services/groq`, `services/ai` | Direct model calls from server procedures; prefer an abstraction when users configure providers. See [AI Services](./ai.md). |

For fixed-outcome classification, routing, and numeric scoring, use
[AI decision SQL](../sql/ai_decisions.md) rather than a generation helper.
These expressions do not require a TypeScript service import.

## Integration Blocks

| Integration block | Import | Use when |
| --- | --- | --- |
| `GmailIntegration` | `blocks/email_integrations/gmail` | Gmail account connection plus send/read. |
| `GmailProvider` / `GmailIntegrationCard` | `blocks/gmail_campaign` or `blocks/gmail_campaign/index` | Gmail provider and account UI for a system-owned campaign implementing `EmailCampaignProvider`. |
| `OutlookEmailIntegration` | `blocks/email_integrations/outlook_email` | Outlook account connection plus send/read. |
| `GoogleCalendarIntegration` | `blocks/calendar_integrations/google` | Google Calendar sync for scheduling or availability. |
| `OutlookCalendarIntegration` | `blocks/calendar_integrations/outlook` | Outlook Calendar sync for scheduling or availability. |
| `ZoomIntegration` | `blocks/meeting_integrations/zoom` | Zoom meeting create/update/delete. |
| `OAuthCredentialsBlock` | `blocks/oauth_credentials` | Managed OAuth credentials must be stored for platform-owned OAuth flows. |

## Runtime Rules

- Put external calls in server procedures, scheduled procedures, reactors,
  APIs, pipelines, or transforms.
- Use SQL expressions and Yolm statements for request payloads and result
  handling.
- Store long-lived tokens and secrets through documented secret/OAuth storage,
  not as plain fields on business tables.
- Make sync jobs idempotent. Scheduled jobs that call external systems should
  be safe to retry.
- For user-visible email/calendar/meeting integrations, prefer the block.
- Make outbound calls outside database transactions; wrap the state updates
  before and after the call in short transactions.

## External-Service Opt-In

Every service helper that makes an outbound call accepts `optIn?: BooleanExpr`
and passes it to the underlying `s.request(...)`. In preview and local-dev
runs, the runtime can put external services in opt-in mode, which gates
requests that do not set `optIn`. Set `optIn: sql.true` (or a condition) on
calls that must really fire outside production. See the `optIn` entry in the
[Statements Reference](../procedures/statements_reference.md#request-option-types).

AI decision SQL is an exception: expressions have no statement `optIn` flag.
