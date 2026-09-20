---
title: Solution Blocks
description: Solution-facing reference for reusable Yolm blocks, integration blocks, providers, and table blocks used to assemble complete systems.
tags:
  - blocks
  - solution-patterns
  - integrations
  - solution-development
related:
  - blocks/auth.md
  - blocks/crm.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# Solution Blocks

Reusable blocks package schema, procedures, APIs, and UI for common solution
concerns. Prefer them before adding parallel system-specific schema, APIs, or
UI.

For concepts, see [Blocks](../concepts/blocks.md). For details, use
[AuthBlock](./auth.md) or [CrmBlock](./crm.md).

## Core Blocks

| Block | Import | Use when |
| --- | --- | --- |
| `AuthBlock` | `blocks/auth` or `blocks/auth/index` | Login, user tables, permissions, roles, OTP, password auth, Google auth, SSO, authorization wrappers. |
| `CrmBlock` | `blocks/crm` or `blocks/crm/index` | Contacts, organizations, CRM records, dashboards, reports, and optional pipeline/project/customer-success features. |
| `CommentsBlock` | `blocks/comments` | Record-attached discussion threads with replies, edit history, visible retractions, close/reopen state, and subscriptions. |
| `StaticSecretsBlock` | `blocks/static_secrets` | Long-lived API tokens, OAuth secrets, webhook secrets, or encryption material in `sys_static_secrets`. |
| `AvailabilityBlock` | `blocks/availability` or `blocks/availability/index` | Weekly availability, date-specific hours, time off, availability range calculations. |
| `SchedulingBlock` | `blocks/scheduling` or `blocks/scheduling/index` | Dev-defined appointment scheduling plus reusable booking, availability, notification, and calendar/meeting machinery. Runtime-defined scheduling remains system-owned. |
| `EmailTemplatesBlock` | `blocks/email_templates` or `blocks/email_templates/index` | Editable email templates, rich text bodies, MJML-style advanced templates, reusable email rendering. |
| `OutgoingWebhooksBlock` | `blocks/outgoing_webhooks` | Durable outgoing webhooks with retry tracking and per-type request construction. |
| `BulkEmailDeliveryBlock` | `blocks/bulk_email_delivery` | Immutable single-request platform bulk-email delivery with retries, compact recipient outcomes, and provider-event aggregates. |
| `UserNotificationsBlock` | `blocks/user_notifications` | Durable grouped personal Inbox with optional email and managed per-device Web Push delivery. |
| `MarketingEmailCampaignBlock` | `blocks/marketing_email_campaign` | Scheduled template-based marketing campaigns sent through `BulkEmailDeliveryBlock`. |
| `ConnectedAccountEmailDeliveryBlock` | `blocks/connected_account_email_delivery` | Small, bounded mail merges sent individually through a user's connected Outlook or Gmail account. |
| `KanbanProjectsBlock` | `blocks/kanban_projects` or `blocks/kanban_projects/index` | Reusable kanban project boards, columns, cards, assignees, and task views. |
| `DailyLogBlock` | `blocks/daily_log` | Daily log entry pages and admin log review. |
| `GlossaryBlock` | `blocks/glossary` | Searchable terms, definitions, categories, examples, and glossary UI. |
| `DevLogBlock` | `blocks/dev_log` | Structured diagnostic logs by category, not user-facing audit history. |
| `OAuthCredentialsBlock` | `blocks/oauth_credentials` | Managed OAuth credential storage; not general app auth. |
| `AccountingBlock` | `blocks/accounting` | Invoicing, billing/AP, expense and fee tracking, rate and commission management, and P&L / financial reporting. |
| `AiProvidersBlock` | `blocks/ai_providers` | Configurable LLM providers and models with server-side text generation and file uploads. |
| `ApiKeyBlock` | `blocks/api_keys` | Issue, store, and validate API keys for authenticating inbound API requests. |
| `DashboardBlock` | `blocks/dashboard` | Personal/shared dashboards with fixed widgets and Spark capability-scoped queries. See [Dashboards](dashboard.md). |
| `ManualMeasurementsBlock` | `blocks/manual_measurements` | Independent manual definitions and dated observations. |
| `ManualStatsBlock` | `blocks/manual_stats` | Legacy fixed manual metrics; new systems should use ManualMeasurementsBlock and DashboardBlock. |
| `TimeTrackingBlock` | `blocks/time_tracking` | Clock-in/out time tracking across configurable dimensions with a sidebar widget. |
| `SparkBlock` | `blocks/spark` | In-app conversational AI agent with per-role skills, human-approved write actions, and chat UI. |
| `DriveBlock` | `blocks/drive` | Governed file spaces, uploads, versioned files, lifecycle extensions, and authenticated file endpoints. |
| `WorkforceBlock` | `blocks/workforce` | People, organizations, locations, memberships, and configurable authorization roles. |
| `PrintersBlock` | `blocks/printers` | Queue PDF documents and printer-ready labels or receipts. |
| `EventsBlock` | `blocks/events` | Typed append-only domain events, record bindings, idempotency, corrections, and physical trace data. See [Events Block](./events.md). |
| `LocationsBlock` | `blocks/locations` | Hierarchical sites, areas, storage, service locations, and equipment positions. See [Locations Block](./locations.md). |
| `EquipmentBlock` | `blocks/equipment` | Equipment definitions, serialized assets, identifiers, custody, restrictions, and status pages. See [Equipment Block](./equipment.md). |
| `MaintenanceBlock` | `blocks/maintenance` | Maintenance issues, work execution, parts, inspections, and preventive-maintenance programs. See [Maintenance Block](./maintenance.md). |

Each Core Block above has a dedicated reference page in this folder (for
example [AuthBlock](./auth.md), [SparkBlock](./spark.md),
[AccountingBlock](./accounting.md)).

## Integration Blocks

Integration blocks usually pair with `SchedulingBlock`,
`ConnectedAccountEmailDeliveryBlock`, or CRM flows.

| Integration | Import | Typical use |
| --- | --- | --- |
| `GmailIntegration` | `blocks/email_integrations/gmail` | Send/read Gmail and connect Gmail accounts. |
| `OutlookEmailIntegration` | `blocks/email_integrations/outlook_email` | Send/read Outlook email and connect Outlook accounts. |
| `EmailIntegrationsPage` | `blocks/email_integrations/email_integration_page` | Page for connecting and managing email accounts. |
| `AllEmailsList` | `blocks/email_integrations/common` | Emails from configured integrations. |
| `EmailCampaignProvider` | `blocks/email_campaign_provider` | Provider contract for a system-owned connected-account campaign workflow. |
| `GmailProvider` / `GmailIntegrationCard` | `blocks/gmail_campaign` or `blocks/gmail_campaign/index` | Gmail sender provider and account card for bulk email campaigns. |
| `PostmarkProvider` / `PostmarkIntegrationCard` | `blocks/postmark_campaign` | Postmark sender provider and account card for bulk email campaigns. |
| `GoogleCalendarIntegration` | `blocks/calendar_integrations/google` | Google Calendar sync for scheduling and availability. |
| `OutlookCalendarIntegration` | `blocks/calendar_integrations/outlook` | Outlook Calendar sync for scheduling and availability. |
| `ZoomIntegration` | `blocks/meeting_integrations/zoom` | Create, update, or delete Zoom meetings. |

## Table Blocks

Use table blocks inside `db.table(...)` for reusable relations or field sets.

| Table block | Import | Adds | Reference |
| --- | --- | --- | --- |
| `AddressTableBlock` | `table_blocks/address` | Standard address fields with optional prefix/configuration. | [address](./table_blocks/address.md) |
| `NotesListTableBlock` | `table_blocks/notes_list` | Related notes tables and note-list UI. | [notes_list](./table_blocks/notes_list.md) |
| `AttachmentsTableBlock` | `table_blocks/attachments` | Related file attachments for a table. | [attachments](./table_blocks/attachments.md) |
| `KanbanProjectTableBlock` | `table_blocks/kanban_project` | Embeddable kanban project board, columns, cards, and reports for a record. | [kanban_project](./table_blocks/kanban_project.md) |
| `TranslationsTableBlock` | `table_blocks/translations` | Translation fields/relations for multilingual content. | [translations](./table_blocks/translations.md) |
| `SynonymsTableBlock` | `table_blocks/synonyms` | Synonym relationships for searchable terms. | [synonyms](./table_blocks/synonyms.md) |

Some table blocks ship companion display components, imported from their own
module under the block:

- `AddressTableBlock` — `AddressCard` (`table_blocks/address/address_card`),
  `AddressText` (`table_blocks/address/address_text`),
  `AddressesCard` (`table_blocks/address/addresses_card`).
- `NotesListTableBlock` — `NotesListCard`
  (`table_blocks/notes_list/notes_list_card`).
- `AttachmentsTableBlock` — `AttachmentsCard`
  (`table_blocks/attachments/attachments_card`).
- `KanbanProjectTableBlock` — `KanbanProjectListCard`
  (`table_blocks/kanban_project/kanban_project_card`).

## Selection Rules

- Add system blocks in `core.tsx` with `system.addBlock(...)`.
- Define user tables before `AuthBlock` when auth references those tables.
- Use block-provided pages and components through the block import.
- Use `system.block(BlockClass)` when procedure code needs the configured
  block, for example webhooks or availability helpers.
- Do not re-create block tables manually in a system. If a block almost fits,
  configure or extend it before adding parallel schema.

## Dev Log

- 2026-05-30: Documented table-block companion components (address and
  notes-list cards) and noted that admin CRUD/detail pages live in
  [page templates](../ui/page_templates.md), not in the block listing.
- 2026-06-26: Added dedicated reference pages for every remaining block —
  `accounting`, `ai_providers`, `api_keys`, `dev_log`, `edge`, `printers`,
  `manual_stats`, `postmark_campaign`, `spark`, `time_tracking` — and a
  `table_blocks/` subfolder documenting all six table blocks. Audited and
  corrected the 18 pre-existing block docs against current source. Every doc
  was authored from a full source read and adversarially verified claim-by-claim.
