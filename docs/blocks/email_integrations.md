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
managed OAuth, syncs messages into the database via provider push
notifications, and ships the inbox/compose UI. It defines the
`EmailIntegration` interface and two implementations:

- `GmailIntegration` — Google Gmail.
- `OutlookEmailIntegration` — Microsoft 365 / Outlook (Graph API).

Use it together with the [CRM block](./crm.md): register one or both
integrations, list them in `CrmBlock`'s `emailIntegrations` option, then mount
`EmailIntegrationsPage` (account connect/disconnect) and `AllEmailsList`
(combined inbox). Reach for this block instead of building custom mailbox
schema, OAuth endpoints, and sync reactors yourself.

```ts
import { GmailIntegration } from "blocks/email_integrations/gmail";
import { OutlookEmailIntegration } from "blocks/email_integrations/outlook_email";
import { EmailIntegrationsPage } from "blocks/email_integrations/email_integration_page";
import type { EmailIntegrationConfig } from "blocks/email_integrations/email_integration_page";
import {
  AllEmailsList,
  EmailBodyFieldNode,
  EmailItem,
} from "blocks/email_integrations/common";
import type {
  EmailIntegration,
  SendEmailOpts,
} from "blocks/email_integrations";
```

## Minimal Setup

Register the integration block(s) in `core.tsx`, then list them in the CRM
block's `emailIntegrations`. With the CRM block present, messages are stored in
the shared `user_all_emails` / `user_email_recipients` / `user_email_attachments`
tables (created by `CrmBlock`).

```ts
import { CrmBlock } from "blocks/crm";
import { GmailIntegration } from "blocks/email_integrations/gmail";
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
  new CrmBlock({
    // ...other CRM options
    emailIntegrations: [{ integration: GmailIntegration }],
  }),
);
```

Outlook is registered the same way and auto-detects the CRM block at
generation time (`system.hasBlock(CrmBlock)`); it has no `hasCrmBlock` flag:

```ts
import { OutlookEmailIntegration } from "blocks/email_integrations/outlook_email";

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
```

Inside the app, mount the settings page and the combined inbox:

```tsx
<EmailIntegrationsPage
  integrations={[{ integration: GmailIntegration }]}
/>
<Route path="/inbox">
  <AllEmailsList where={sql`true`} />
</Route>
```

`EmailIntegrationsPage` is self-routing and calls each integration's
`addOauthRedirect`, which registers that provider's OAuth callback, global
redirect, attachment download endpoint, and (Gmail only) the push-notification
endpoint.

## Configuration

### `GmailIntegration` options

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `provider` | `string` | yes | Managed-OAuth provider key (e.g. `"google_gmail"`). |
| `scopes` | `Sql` | yes | OAuth scopes requested (space-separated literal). |
| `devNotificationUrl` | `string` | yes | Full URL Gmail pushes notifications to (used as the Pub/Sub `watch` address). |
| `hasCrmBlock` | `boolean` | no | When `true`, store emails in the shared `user_all_emails` tables instead of Gmail-specific tables. Set this manually when pairing with `CrmBlock` — Gmail does not auto-detect it. |
| `extensions` | `GmailIntegrationExtensions` | no | Hook bag; see below. |

`GmailIntegrationExtensions` (exported from `blocks/email_integrations/gmail`):

| Field | Type | Meaning |
| --- | --- | --- |
| `onNotificationReceived` | `(s, { body }) => void` | Runs when a Gmail push webhook is received, with the raw body. |

### `OutlookEmailIntegration` options

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `provider` | `string` | yes | Managed-OAuth provider key (e.g. `"outlook_email"`). |
| `scopes` | `Sql` | yes | OAuth scopes — a space-separated literal or a `json_build_array(...)` of scope URLs. |
| `notificationDomain` | `string \| string[]` | yes | Domain(s) where the Graph change-notification endpoint (`POST /api/azure-email-notifications`) is registered; the first builds the subscription URL when `devNotificationUrl` is unset. |
| `participantSync` | `OutlookParticipantSyncConfig` | no | Enables background synchronization of Outlook recipients into a consumer-provided participant table. Requires the configured participant query; see below. |
| `devNotificationUrl` | `string` | no | Overrides the Graph subscription notification URL (e.g. for local dev / tunneling). |
| `emails` | `{ define?, recipients?: { define? }, attachments?: { define? } }` | no | Extra column definitions for the Outlook-specific tables (only applied when no CRM block is present). Each `define` receives a `TableBuilder`. |

`participantSync` accepts `participants`, a query returning an `address`
column and optionally a `client_id` column, plus `defaultSince` for the first
sync window. The integration creates the participant-sync tables and enqueues
work after Outlook messages are saved; later notification and account-sync
runs continue to enqueue participant synchronization.

## Tables Created

### Gmail

| Table | When | Purpose / key columns |
| --- | --- | --- |
| `user_gmail_accounts` | always | Connected accounts: `sys_user_id`, `email`, `credential_id`, `status` (`gmail_connection_status`), `sync_status`, `chosen_sync_date`, `chosen_emails`, `notification_history_id`, `notification_expiration`. |
| `user_gmail_aliases` | always | Send-as aliases for an account. |
| `user_gmail_sync_logs` | always | Per-account sync log: `message`, `status`. |
| `user_gmail_emails` | only when not CRM | Messages: `message_id`, `subject`, `snippet`, `from`, `from_email`, `reply_to`, `thread_id`, `date`, `body_text`, `is_read`, `message_reply_id`. |
| `user_gmail_recipients` | only when not CRM | `email`, `recipient_address`, `recipient_type`. |
| `user_gmail_email_attachments` | only when not CRM | `filename`, `content_type`, `data` (blob ref), `ccid`, `external_url`. |

When `hasCrmBlock` is set, Gmail writes into the CRM's shared
`user_all_emails`, `user_email_recipients`, `user_email_attachments` tables.
Recipient sync replaces the rows for each successfully fetched full message in
one transaction, deduplicating by message, parsed address, and recipient type.
This repairs existing duplicate/stale recipients on resync; messages outside the
fetched set and other accounts are untouched. Failed or incomplete message
responses are rejected before reconciliation.

### Outlook

| Table | When | Purpose / key columns |
| --- | --- | --- |
| `user_outlook_emails_accounts` | always | Connected accounts: `sys_user_id`, `email`, `credential_id`, `provider_subject`, `status`, and Graph subscription state. |
| `user_outlook_email_integration_logs` | always | Operation/error log (TTL ~1 week). |
| `outlook_email_notification_inbox` | always | Authenticated, deduplicated Graph notification work (TTL ~2 days). |
| `outlook_contact_email_sync_jobs` | with `participantSync` | Bounded participant synchronization work. |
| `user_email_identities` | only when no CRM block | Provider-independent logical message identities. |
| `user_outlook_emails` | only when no CRM block | Message metadata, body/hydration state, provider deletion state, and identity/thread keys. |
| `user_outlook_recipients` | only when no CRM block | Normalized `email` and `recipient_type`. |
| `user_outlook_email_attachments` | only when no CRM block | Attachment identity/kind, metadata, blob hash, size, and provider deletion state. |

When `CrmBlock` is present, Outlook writes into the shared `user_all_emails`
tables instead of its own message tables.

### Application-owned drafts

Set `CrmBlockOpts.emailDrafts.enabled` to create provider-independent draft
storage for a CRM with an email integration:

| Table | Purpose |
| --- | --- |
| `user_email_drafts` | One user-owned message draft, including its selected integration/account/from address, subject, Lexical body, timestamps, and send state. |
| `user_email_draft_recipients` | Normalized To, Cc, and Bcc addresses for a draft. |
| `user_email_draft_attachments` | Blob-backed attachments for a draft. |

These are application drafts, not Gmail or Outlook provider drafts. A user can
save an incomplete message, return later, and choose any active connected
sender they own. Sending revalidates that exact account and address on the
server, atomically claims the draft to prevent double sends, performs provider
I/O outside the database transaction, and records `failed` or `send_unknown`
when the operation cannot be confirmed. A send claim older than ten minutes is
fenced into `send_unknown`; it is never automatically retried. After checking
the connected mailbox, the user must deliberately confirm it was sent or
discard the unresolved local draft. An ambiguous attempt cannot return to an
editable state because a late provider acceptance could make a later resend a
duplicate. Confirmed sends and discarded drafts are deleted with their
recipients and attachment references rather than retained as hidden history.
Draft sends accept at most 20 attachments, each smaller than 3 MB and no more
than 10 MB in total; larger Outlook attachments require a separate Graph upload
session flow and are rejected before blob loading or provider dispatch.

## Enums

- Gmail: `gmail_connection_status` (`active`, `reauth_required`),
  `gmail_chosen_emails_enum` (`allEmails`, `allExceptSpam`,
  `allExceptSocialSpamPromotions`).
- Outlook: `outlook_email_connection_status` (`active`, `reauth_required`),
  `outlook_email_attachment_kind` (`file`, `item`, `reference`), and
  `outlook_email_notification_event`.
- Shared: `recipient_type_enum` (`to`, `cc`, `bcc`). Gmail also defines
  `sync_status_enum`.
- Application drafts, when enabled: `user_email_draft_status` (`draft`,
  `sending`, `failed`, `send_unknown`).

## Reactors, Scheduled Jobs & Endpoints

You do not call these directly; they run automatically once the block is
registered.

- Gmail reactors: `gmail_sync_pending`, `gmail_watch_inbox`,
  `gmail_renew_subscriptions`.
- Application drafts, when enabled:
  `user_email_draft_stale_send_fence` changes one expired `sending` claim to
  `send_unknown` per invocation and never retries provider delivery.
- Outlook reactors: `outlook_renew_subscriptions`,
  `outlook_resubscribe_missing_email_subscription`,
  `outlook_email_notification_inbox`, and `outlook_email_hydration`. With
  participant sync configured, the block also registers
  `outlook_contact_email_sync_job`.
- With participant sync configured, Outlook schedules
  `outlook_contact_email_sync_seed` every five minutes.
- Endpoints registered per app (via `addOauthRedirect`) or, for Outlook
  notifications, in `populate`: OAuth callback + global redirect, attachment
  download (`GET /api/<attachmentsTable>/{blob_id}`), and push-notification
  endpoints (Gmail `POST /api/can-write/google-email-notifications`, Outlook
  `POST /api/azure-email-notifications`).

Outlook subscribes to created and deleted non-draft messages. The webhook
coalesces delivery retries by account and provider message ID, ignores already
archived creations and unknown deletions, and queues only work that can change
the archive. Message reads and provider-deletion handling remain durable
reactor work.

## Pages

### Email draft routes

When `CrmBlockOpts.emailDrafts.enabled` is true,
`CrmBlock.StandardRoutes` mounts a provider-independent draft list at
`/email-drafts`, a new-draft editor at `/email-drafts/new`, and an edit route at
`/email-drafts/{record_id}`. Override `emailDraftsPath` and
`emailDraftDetailPath` through `CrmBlockOpts.routes`, or suppress/replace the
standard routes with the `emailDrafts` standard-route override.

The editor supports multiple To/Cc/Bcc recipients, a rich-text body, sender
selection across active connected accounts, and blob-backed attachments after
the first save. The draft list exposes explicit send, discard, and ambiguous
send-resolution actions without creating provider-side drafts. An
`AllEmailsList` consumer must explicitly set `enableDraftSaving` to expose Save
draft from its composer; standard CRM inbox routes do this only when draft
routes are enabled.

### `EmailIntegrationsPage`

Import: `blocks/email_integrations/email_integration_page`.
Self-routing — mount it directly, do **not** wrap it in `<Route>`.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `integrations` | `EmailIntegrationConfig[]` | yes | Integration classes to surface; each is `{ integration: <Class> }`. |
| `skipSidebarItem` | `boolean` | no | When `true`, does not add the "Email Integrations" sidebar item. |
| `path` | `string` | no | Route path. Defaults to `"/email-integrations"`. |

`EmailIntegrationConfig` (exported from the same module):
`{ integration: EmailIntegrationConstructor }`.

The page wires each integration's OAuth redirect, lists connected accounts with
sync status, and lets users add/remove accounts.

### Provider listing pages

Each integration exposes a self-routing listing page and an embeddable list,
both as instance props and static members:

- Instance: `block.emailsPage({ where, path })`, `block.emailsList({ where })`.
- Static: `GmailIntegration.EmailsPage`, `GmailIntegration.EmailsList`,
  `OutlookEmailIntegration.EmailsPage`, `OutlookEmailIntegration.EmailsList`.

`EmailsPage` takes `{ where: Sql; path: string }` (self-routing); `EmailsList`
takes `{ where: Sql }`.

## Components

### `AllEmailsList`

Import: `blocks/email_integrations/common`. Searchable, paginated,
thread-grouped inbox spanning every configured integration, backed by
`user_all_emails`. Requires `CrmBlock` with at least one integration in
`emailIntegrations`. It is a component, not a page — render it inside a
`<Route>`.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `where` | `Sql` | yes | Predicate over `user_all_emails` scoping which emails show. |
| `enableCompose` | `boolean` | no | Show the floating Compose button + Reply/Reply All/Forward. Defaults to `true`. |
| `composeTo` | `Sql` | no | Address inserted into the To field when a new message opens. |
| `hideHeader` | `boolean` | no | Suppress the "All Emails" heading. |
| `extraActions` | `Node` | no | Extra per-row action buttons inside each expanded email. |
| `extraStatements` | `(s: StateStatements) => void` | no | Runs in the list's `Data` procedure (define scalars/tables for `extraActions` / `extraDialogs`). |
| `extraDialogs` | `Node` | no | Page-level sibling of the compose dialog; sees `extraStatements` scalars. |

### `EmailItem`

Import: `blocks/email_integrations/common`. A single message row that expands
inline to show recipients, body, attachments and Reply/Forward actions. Must
run inside an `Each` over emails with record name `email` and a UI scalar
`expanded_email_id`.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `integrationTable` | `string` | yes | Email table to read the expanded row's full record from. |
| `recipientsTable` | `string` | yes | Table holding to/cc/bcc recipients. |
| `attachmentsTable` | `string` | yes | Table holding attachments. |
| `recieved` | `boolean` | yes | `true` for inbox (received) messages; enables mark-as-read on expand. (Note the misspelling: `recieved`.) |
| `bodyFieldNode` | `Node` | yes | Node that renders the email body (provider-specific). |
| `markAsRead` | `(s, { messageId }) => void` | no | Marks the message read in the provider when an unread row is expanded. |
| `enableCompose` | `boolean` | no | Show Reply / Reply All / Forward. Defaults to `true`. |
| `extraActions` | `Node` | no | Extra action buttons in the expanded action bar. |
| `forceExpanded` | `boolean` | no | Render the row already expanded. Defaults to `false`. |
| `hideHeader` | `BooleanExpr` | no | Condition for hiding the collapsed summary header row. Defaults to `false`. |

### `EmailBodyFieldNode`

Import: `blocks/email_integrations/common`. Renders an email body in an iframe,
converting AMP HTML and inlining `cid:` attachments from `user_email_attachments`.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `integrationTable` | `string` | yes | Email table the body record belongs to; its singular name forms the `<singular>_id` foreign key used to find attachments. |
| `recordName` | `string` | no | Record holding the body. Defaults to `"email_record"`. |

## Helpers via `system.block(...)`

Both integration classes implement the `EmailIntegration` interface. Fetch an
instance with `system.block(GmailIntegration)` /
`system.block(OutlookEmailIntegration)` and use:

- `sendEmail(s, opts: SendEmailOpts)` — send/reply/forward from a DOM event.
- `markAsRead(s, { emailId, accountId })` — mark a message read in the provider.
- `getAttachmentUrl(blobId): Sql` — attachment download URL for the block's
  attachment endpoint.
- `deleteAccount(s, { accountId })`, `navigateToOauth(s)` — connect/
  disconnect flows (normally driven by `EmailIntegrationsPage`).
- `integrationName`, `icon({ sx })`, `accountTable`, `emailTable`,
  `isActiveAccount`, `adminStatus`, `bodyFieldNode` — display/metadata.

For small mail merges, pass these integrations to
`ConnectedAccountEmailDeliveryBlock`. Each provider declares mailbox-level
`deliveryLimits`, and the shared outbox applies them across every queued
delivery with the same stable provider mailbox identity, including separate
connections and sender aliases:

| Provider | Messages per rolling minute | Recipients per rolling 24 hours |
| --- | ---: | ---: |
| Gmail | 60 | 500 |
| Outlook | 30 | 10,000 |

The outbox sends one recipient per provider request, so its message and
recipient counts are the same. Gmail uses the personal-account daily ceiling
because both personal and Workspace accounts can be connected. Work over a
mailbox limit remains queued as `rate_limited` and is released when the rolling
window has capacity. These counters cover sends made through the
connected-account outbox, not compose sends that call an integration directly
or mail sent outside Yolm. Historical deliveries without a mailbox identity
remain in the quota through normalized sender-address matching and by resolving
their historical account IDs to the account's current canonical mailbox
identity. Candidate deliveries use the same resolution before admission. This
preserves quota usage across sender-alias transitions in either direction.

`ConnectedAccountEmailDeliveryReport` is a route-free, read-only component for
the outbox. It shows overall sent, rate-limited, failed, and uncertain recipient
counts together with the 100 most recent deliveries. Systems supply their own
route, page layout, permission boundary, and navigation:

```tsx
import { ConnectedAccountEmailDeliveryReport } from "blocks/connected_account_email_delivery";

<ConnectedAccountEmailDeliveryReport />;
```

### Sending email

Both providers accept the same recipient format: `to` is required, `cc` and
`bcc` are optional, and each is a SQL expression containing comma-separated
email addresses. Pass address strings, not provider JSON or table references;
the integration constructs the provider payload. `from` is required.

`sendEmail(s, opts: SendEmailOpts)` runs from a DOM event and supports reply
fields (`threadId`, `isReply`, `replyAll`, `inReplyTo`) and
`beforeEmailSent` / `afterEmailSent` / `onEmailSendError` hooks. Gmail replies
also accept `references` for the complete References header; when omitted, null,
or empty, Gmail falls back to `inReplyTo`. Outlook uses its native reply endpoint
and does not consume `references`.
`sendEmailFromServer(s, opts: SendEmailFromServerOpts)` runs in a server
procedure and additionally accepts `attachmentsQuery` for bounded blob-backed
attachments. Both expose the same `to`/`cc`/`bcc` values in hook contexts.

```typescript
import { OutlookEmailIntegration } from "blocks/email_integrations/outlook_email";
import type { SendEmailFromServerOpts } from "blocks/email_integrations";
import { sql } from "std/sql_utils";
import { system } from "std/system";

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

`navigateToOauth(s)` starts authorization without sync-selection options.
OAuth redirect addresses are derived internally; constructors do not accept
`redirectUri`. The account connection page does not offer unsupported sync
category/date controls.

## Helper functions

- `convertAmpHtmlToHtml(s, sourceExpr, resultScalar)` — exported from
  `blocks/email_integrations/gmail`; rewrites AMP4EMAIL markup into standard
  HTML, writing the result into the named scalar. `EmailBodyFieldNode` already
  calls this for you.

## Common Mistakes

- Wrapping `EmailIntegrationsPage` (or a provider `EmailsPage`) in `<Route>` —
  they are self-routing.
- Rendering `AllEmailsList` without `CrmBlock` and at least one entry in its
  `emailIntegrations`; it renders "No email integrations configured" otherwise.
- Forgetting `hasCrmBlock: true` on `GmailIntegration` when using the CRM
  block — Gmail cannot auto-detect the CRM block, so without the flag it
  creates and writes its own `user_gmail_emails` tables instead of
  `user_all_emails`. (Outlook auto-detects.)
- Using `EmailItem` outside an `Each` that exposes an `email` record and an
  `expanded_email_id` UI scalar.
- Misspelling-sensitive prop: `EmailItem`'s received flag is `recieved`.
- Passing provider-specific JSON to block send methods. Both use comma-separated
  address strings; low-level provider services own provider-specific payloads.
