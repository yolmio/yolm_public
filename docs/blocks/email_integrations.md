---
title: Email Integrations
description: Per-user Gmail and Outlook email integrations for the CRM block — OAuth connect, inbox sync, and send/reply UI.
tags:
  - blocks
  - email
  - gmail
  - outlook
  - integrations
related:
  - blocks/crm.md
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# Email Integrations

`blocks/email_integrations` lets each user connect their own mailbox over
managed OAuth, syncs messages through provider push notifications, and ships
inbox/compose UI. It defines the `EmailIntegration` interface (in
`blocks/email_integrations`) with two implementations: `GmailIntegration`
(`blocks/email_integrations/gmail`) and `OutlookEmailIntegration`
(`blocks/email_integrations/outlook_email`, Microsoft Graph). Use it with the
[CRM block](./crm.md) instead of building mailbox schema, OAuth endpoints, and
sync reactors yourself.

## Minimal Setup

Register the integration block(s) in `core.tsx`, then list them in
`CrmBlock`'s `emailIntegrations`. With the CRM block present, messages are
stored in the CRM-created `user_all_emails` / `user_email_recipients` /
`user_email_attachments` tables.

```ts
import { CrmBlock } from "blocks/crm";
import { GmailIntegration } from "blocks/email_integrations/gmail";
import { OutlookEmailIntegration } from "blocks/email_integrations/outlook_email";
import { sql } from "std/sql_utils";
import { system } from "std/system";

system.addBlock(
  new GmailIntegration({
    hasCrmBlock: true,
    provider: "google_gmail",
    scopes: sql.lit`https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://mail.google.com/`,
    devNotificationUrl:
      "https://myapp.example.com/api/can-write/google-email-notifications",
  }),
);

system.addBlock(
  new OutlookEmailIntegration({
    provider: "outlook_email",
    scopes: sql`json_build_array(
      'offline_access',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/Mail.ReadWrite'
    )`,
    notificationDomain: "myapp.example.com",
  }),
);

system.addBlock(
  new CrmBlock({
    // ...other CRM options
    emailIntegrations: [
      { integration: GmailIntegration },
      { integration: OutlookEmailIntegration },
    ],
  }),
);
```

`CrmBlock.StandardRoutes` mounts the inbox and account pages. To mount them
yourself:

```tsx
<EmailIntegrationsPage integrations={[{ integration: GmailIntegration }]} />
<Route path="/inbox">
  <AllEmailsList where={sql`true`} />
</Route>
```

## Configuration

The option interfaces are not exported; all options are listed here.

### `GmailIntegration`

| Option | Required | Meaning |
| --- | --- | --- |
| `provider` | yes | Managed-OAuth provider key (e.g. `"google_gmail"`). |
| `scopes` | yes | `Sql` space-separated scope literal. |
| `devNotificationUrl` | yes | Full URL Gmail pushes notifications to (the Pub/Sub `watch` address). |
| `hasCrmBlock` | no | Store emails in the shared `user_all_emails` tables. Gmail does not auto-detect `CrmBlock`; without this flag it writes its own `user_gmail_*` message tables. |
| `extensions` | no | `GmailIntegrationExtensions`: `onNotificationReceived(s, { body })` runs on each push webhook. |

### `OutlookEmailIntegration`

Outlook auto-detects `CrmBlock` (`system.hasBlock(CrmBlock)`) and has no
`hasCrmBlock` flag.

| Option | Required | Meaning |
| --- | --- | --- |
| `provider` | yes | Managed-OAuth provider key (e.g. `"outlook_email"`). |
| `scopes` | yes | Space-separated literal or `json_build_array(...)` of scope URLs. |
| `notificationDomain` | yes | `string \| string[]` hosting `POST /api/azure-email-notifications`; the first builds the subscription URL unless `devNotificationUrl` is set. |
| `devNotificationUrl` | no | Overrides the Graph subscription notification URL (local dev / tunneling). |
| `participantSync` | no | `OutlookParticipantSyncConfig`: `participants` (query returning `address`, optionally `client_id`) and `defaultSince` (first sync window). Creates participant-sync tables and enqueues work after messages are saved and on later notification/account-sync runs. |
| `emails` | no | `{ define?, recipients?: { define? }, attachments?: { define? } }` extra columns for the Outlook message tables; applied only without a CRM block. |

OAuth redirect addresses are derived internally; neither constructor accepts
`redirectUri`.

## Tables Created

Inspect the schema for columns.

| Table | When | Purpose |
| --- | --- | --- |
| `user_gmail_accounts`, `user_gmail_aliases`, `user_gmail_sync_logs` | Gmail | Connected accounts, send-as aliases, sync log. |
| `user_gmail_emails`, `user_gmail_recipients`, `user_gmail_email_attachments` | Gmail without `hasCrmBlock` | Messages, recipients, attachments. |
| `user_outlook_emails_accounts` | Outlook | Connected accounts and Graph subscription state. |
| `user_outlook_email_integration_logs` | Outlook | Operation/error log (TTL ~1 week). |
| `outlook_email_notification_inbox` | Outlook | Authenticated, deduplicated Graph notification work (TTL ~2 days). |
| `outlook_contact_email_sync_jobs` | Outlook with `participantSync` | Bounded participant synchronization work. |
| `user_email_identities`, `user_outlook_emails`, `user_outlook_recipients`, `user_outlook_email_attachments` | Outlook without `CrmBlock` | Logical message identities, messages, recipients, attachments. |
| `user_email_drafts`, `user_email_draft_recipients`, `user_email_draft_attachments` | `CrmBlockOpts.emailDrafts.enabled` | Application-owned drafts (see below). |

In CRM mode, Gmail recipient sync replaces the rows for each successfully
fetched full message in one transaction, deduplicating by message, parsed
address, and recipient type; this repairs duplicate or stale recipients on
resync. Other messages and accounts are untouched, and failed or incomplete
message responses are rejected before reconciliation.

Participant sync spaces provider-page claims two seconds apart across mailbox
jobs (single active runtime). A job's `started_at` keeps the last page-claim
time after completion or requeue so pacing survives restarts; deleting the most
recently claimed job can release the pace early. This is a load-shedding guard,
not a strict distributed rate limiter.

Enums: `gmail_connection_status` and `outlook_email_connection_status`
(`active`, `reauth_required`), `gmail_chosen_emails_enum`, `sync_status_enum`
(Gmail), `outlook_email_attachment_kind` (`file`, `item`, `reference`),
`outlook_email_notification_event`, `recipient_type_enum` (`to`, `cc`, `bcc`),
and, with drafts, `user_email_draft_status` (`draft`, `sending`, `failed`,
`send_unknown`).

### Application-owned drafts

`CrmBlockOpts.emailDrafts.enabled` creates provider-independent drafts (not
Gmail or Outlook provider drafts). A user can save an incomplete message and
later send it from any active connected sender they own. Sending revalidates
that account and address on the server, atomically claims the draft to prevent
double sends, performs provider I/O outside the database transaction, and
records `failed` or `send_unknown` when the outcome cannot be confirmed. A send
claim older than ten minutes is fenced into `send_unknown` and never retried
automatically; the user must check the mailbox and confirm it was sent or
discard it. An ambiguous attempt cannot return to editable, because a late
provider acceptance would make a resend a duplicate. Confirmed sends and
discarded drafts are deleted with their recipients and attachment references.
Draft sends accept at most 20 attachments, each under 3 MB and at most 10 MB
total; larger Outlook attachments (which need a Graph upload session) are
rejected before blob loading or provider dispatch.

With drafts enabled, `CrmBlock.StandardRoutes` mounts `/email-drafts`,
`/email-drafts/new`, and `/email-drafts/{record_id}` (override with
`emailDraftsPath` / `emailDraftDetailPath` in `CrmBlockOpts.routes`, or the
`emailDrafts` standard-route override). The editor supports To/Cc/Bcc, rich
text, sender selection, and attachments after the first save. `AllEmailsList`
shows Save draft only when `enableDraftSaving` is set; standard CRM inbox
routes set it only when draft routes are enabled.

## Reactors and Endpoints

These run automatically once the block is registered.

- Gmail reactors: `gmail_sync_pending`, `gmail_watch_inbox`,
  `gmail_renew_subscriptions`.
- Outlook reactors: `outlook_renew_subscriptions`,
  `outlook_resubscribe_missing_email_subscription`,
  `outlook_email_notification_inbox`, `outlook_email_hydration`; with
  participant sync, `outlook_contact_email_sync_job` plus the
  `outlook_contact_email_sync_seed` job every five minutes.
- Drafts: `user_email_draft_stale_send_fence` moves one expired `sending`
  claim to `send_unknown` per invocation.
- Endpoints, registered by `addOauthRedirect` (called by
  `EmailIntegrationsPage`) or, for Outlook notifications, in `populate`: OAuth
  callback + global redirect, attachment download
  (`GET /api/<attachmentsTable>/{blob_id}`), Gmail
  `POST /api/can-write/google-email-notifications`, and Outlook
  `POST /api/azure-email-notifications`.

Outlook subscribes to created and deleted non-draft messages. The webhook
coalesces retries by account and provider message ID, ignores already archived
creations and unknown deletions, and queues only work that can change the
archive; message reads and deletion handling remain durable reactor work.

## Pages and Components

| Export | Import | Notes |
| --- | --- | --- |
| `EmailIntegrationsPage` | `blocks/email_integrations/email_integration_page` | Self-routing account connect/disconnect page. Props: `integrations: EmailIntegrationConfig[]` (`{ integration: <Class> }`), `path?` (default `/email-integrations`), `skipSidebarItem?`. |
| `AllEmailsList` | `blocks/email_integrations/common` | Searchable, thread-grouped inbox over `user_all_emails`. Not a page: render inside a `<Route>`. Requires `CrmBlock` with at least one `emailIntegrations` entry. `where` is required; `extraStatements` runs in the list's `Data` procedure for `extraActions` / `extraDialogs`. |
| `EmailItem` | `blocks/email_integrations/common` | One expandable message row. Must run inside an `Each` with record name `email` and a UI scalar `expanded_email_id`. The received flag is spelled `recieved`. |
| `EmailBodyFieldNode` | `blocks/email_integrations/common` | Renders a body in an iframe, converting AMP HTML and inlining `cid:` attachments. `integrationTable`'s singular name forms the `<singular>_id` attachment FK; `recordName` defaults to `"email_record"`. |
| `EmailsPage` / `EmailsList` | static on each integration class, or `block.emailsPage(...)` / `block.emailsList(...)` | Provider listing: `EmailsPage` (`{ where, path }`) is self-routing; `EmailsList` takes `{ where }`. |

`convertAmpHtmlToHtml(s, sourceExpr, resultScalar)` (from
`blocks/email_integrations/gmail`) rewrites AMP4EMAIL into HTML;
`EmailBodyFieldNode` already calls it.

## Sending and Integration Helpers

From `system.block(GmailIntegration)` / `system.block(OutlookEmailIntegration)`:
`sendEmail(s, SendEmailOpts)` (DOM event), `sendEmailFromServer(s,
SendEmailFromServerOpts)` (server procedure, also accepts `attachmentsQuery`
for bounded blob-backed attachments), `markAsRead`, `getAttachmentUrl(blobId)`,
`deleteAccount`, `navigateToOauth(s)`, and display metadata (`integrationName`,
`icon`, `accountTable`, `emailTable`, `isActiveAccount`, `adminStatus`,
`bodyFieldNode`).

`to` and `from` are required; `to`, `cc`, and `bcc` are SQL expressions of
comma-separated addresses, not provider JSON or table references. Reply fields
are `threadId`, `isReply`, `replyAll`, and `inReplyTo`; Gmail also accepts
`references` (falls back to `inReplyTo` when absent or empty), while Outlook
uses its native reply endpoint and ignores it. Hooks `beforeEmailSent` /
`afterEmailSent` / `onEmailSendError` see the same `to`/`cc`/`bcc` values.

```typescript
import type { SendEmailFromServerOpts } from "blocks/email_integrations";

const message: SendEmailFromServerOpts = {
  accountId: sql`selected_account_id`,
  from: sql`selected_from_address`,
  to: sql.lit`recipient@example.com`,
  cc: sql.lit`copy@example.com`,
  subject: sql.lit`Project update`,
  body: sql.lit`<p>The project update is ready.</p>`,
};
// Inside a server procedure with the account owner's current-user context:
system.block(OutlookEmailIntegration).sendEmailFromServer(s, message);
```

### Connected-account delivery limits

For small mail merges, pass these integrations to
`ConnectedAccountEmailDeliveryBlock`. Its shared outbox applies each provider's
`deliveryLimits` across every queued delivery with the same provider mailbox
identity, including separate connections and sender aliases:

| Provider | Messages per rolling minute | Recipients per rolling 24 hours |
| --- | ---: | ---: |
| Gmail | 60 | 500 |
| Outlook | 30 | 10,000 |

The outbox sends one recipient per request, so both counts match. Gmail uses
the personal-account ceiling because personal and Workspace accounts can both
connect. Work over a limit stays queued as `rate_limited` until the window has
capacity. The counters cover only connected-account outbox sends, not direct
compose sends or mail sent outside Yolm. Historical deliveries without a
mailbox identity still count, through normalized sender-address matching and
by resolving historical account IDs to the current mailbox identity; candidate
deliveries use the same resolution, so quota survives sender-alias changes.

`ConnectedAccountEmailDeliveryReport` (from
`blocks/connected_account_email_delivery`) is a route-free, read-only outbox
summary: sent, rate-limited, failed, and uncertain counts plus the 100 most
recent deliveries. Systems supply the route, layout, permission boundary, and
navigation.
