---
title: UserNotificationsBlock
description: Durable personal Inbox notifications with optional email and managed per-device Web Push delivery.
tags:
  - blocks
  - notifications
  - web-push
related:
  - blocks/solution_blocks.md
  - concepts/scheduled_jobs.md
  - concepts/reactors.md
---

# UserNotificationsBlock

`UserNotificationsBlock` stores one durable notification occurrence per
recipient and projects it to optional email and fully managed Web Push (no
service worker, VAPID keys, or device sends in solution code).

## Configure the block

Define the identity adapter and every source in `core.tsx`:

```tsx
import { RecordNotificationDestination, UserNotificationsBlock } from "blocks/user_notifications";
import { sql } from "std/sql_utils";
import { system } from "std/system";

const approvalDestination = new RecordNotificationDestination({
  key: "purchasing.approval",
  table: "approvals",
  path: "/approvals/{id}",
  domain: "purchasing.example.com",
});

system.addBlock(
  new UserNotificationsBlock({
    identity: {
      isActive: (userId) =>
        sql`exists (
          select 1 from sys_users
          where id = ${userId} and not disabled
        )`,
      email: (userId) =>
        sql`(select email from sys_users where id = ${userId})`,
    },
    sources: [{
      key: "purchasing.approval",
      displayName: "Approvals",
      destination: approvalDestination.destination(),
      email: { delivery: "preference" },
      canUserAccess: ({ userId, recordKey }) =>
        sql`exists (
          select 1 from approvals
          where id = try_cast(${recordKey} as bigint)
            and approver_user_id = ${userId}
        )`,
    }],
    push: true,
    email: {
      domain: "purchasing.example.com",
      from: "Purchasing <notifications@example.com>",
      applicationName: "Purchasing",
    },
  }),
);
```

Full option types are `UserNotificationsBlockOpts`,
`UserNotificationSourceConfig`, and `UserNotificationEmailConfig` in
`packages/blocks/user_notifications/user_notifications_block.ts`. Non-obvious
options:

| Option | Contract |
|---|---|
| `sources[].key` | System-wide namespaced key, unique, at most 100 characters. At least one source is required. |
| `sources[].canUserAccess` | Checked at publish, in the Inbox, and again before opening or delivering. |
| `sources[].destination` | Omit for informational, non-clickable notifications. |
| `sources[].email.delivery` | `preference` (default) follows the recipient's digest/immediate/off setting; `immediate` sends each occurrence separately but honors off; `disabled` keeps the source Inbox-only. |
| `email` | Requires `identity.email`. `domain` is the app hosting the authenticated handoff. |
| `email.publicOrigin` | SQL expression returning an absolute origin for email links; whitespace and trailing slashes are removed, and null or blank falls back to the mapped `email.domain`. |
| `push` | Adds subscriptions, a push outbox, a bounded fanout job, a delivery reactor, and per-device settings. |

Enabling `email` or `push` on a deployed system adds new tables, enums, and
nullable `email_eligible_at` / `push_eligible_at` columns on
`user_notifications`, which is normally a compatible deploy; confirm with the
deploy plan's schema changes. Existing rows keep null eligibility, so
historical Inbox activity is not fanned out.

## Owned tables

- `user_notifications`: one row per occurrence per recipient.
- `user_notification_preferences` (with `email`): per-user email mode.
- `user_notification_email_outbox` (with `email`): shared email outbox.
- `user_notification_push_subscriptions` (with `push`): one row per browser
  installation and user.
- `user_notification_push_outbox` (with `push`): one delivery per notification
  and subscription.

## Publish

Procedures publish to logical recipients, never browsers:

```ts
const notifications = system.block(UserNotificationsBlock);
const approvals = notifications.source("purchasing.approval");

approvals.publish(s, {
  recordKey: sql`approval.id`,
  recipientsQuery: sql`
    select approver_user_id as recipient_user_id
    from approvals
    where id = approval.id
  `,
  title: sql.lit`Approval required`,
  body: sql`approval.description`,
  target: approvalDestination.at(sql`approval.id`),
});
```

`recipientsQuery` returns one `recipient_user_id` per recipient; inactive or
unauthorized recipients are skipped. Multiple devices do not multiply Inbox rows
or unread counts. `target` owns `href` and `payload`; supplying either alongside it
is a generation-time error.

## Destinations

`RecordNotificationDestination` (from `blocks/user_notifications`) is declared
once and used three ways: `.destination()` on the source, `.at(id)` when
publishing, and optionally `<dest.RecordPage recordWhere={...}>` for a standard
record page on the configured table and path. Custom pages need no
notification-specific code; record-level access remains the destination page's
responsibility.

- `path` is relative with exactly one `{id}`. Choose `domain` (resolves local
  dev ports) or `resolveHref(path)` (runtime app choice), not both. Neither is
  persisted: the target stores its key and ID and resolves the route when opened.
- For multiple record kinds per source, use
  `recordNotificationDestinations([approvals, orders])`. Keys must be unique
  system-wide record identities, not recipient or event IDs.
- Record destinations accept only explicit target payloads. Bare URLs are not
  parsed; unknown or malformed targets show unavailable and are not
  acknowledged.

Specialized destinations (such as comments and training) implement the
lower-level contract:

```tsx
destination: {
  href: (notification) => sql`'/approvals/' || ${notification}.record_key`,
}
```

`href` receives the complete notification record, including payload. Use
`notificationAppHref(domain, path)` for cross-app links; it respects local
domain mappings. Optional `destination.routes()` ships destination pages through
`<notifications.Routes />`. A stored `href` without a source `destination` never
enables navigation. Destinations must be app-local paths or absolute HTTP(S)
URLs without fragments; a source owned by another app origin must return an
absolute URL.

## Pages and the notification-host app

Mount pages in one notification-host app. Browser push is enabled there once per
browser profile and delivers notifications from every source:

```tsx
<AuthBlock.DefaultEmailOtpAuth>
  <UserNotificationsBlock.PushProvider>
    <AppRoutes>
      <Route path="/notifications/open/{route_user_notification_id:id}">
        <UserNotificationsBlock.NotificationOpenPage />
      </Route>
      <Route path="/notifications/settings">
        <UserNotificationsBlock.NotificationSettingsPage />
      </Route>
      <Route path="/notifications">
        <UserNotificationsBlock.NotificationsPage />
      </Route>
    </AppRoutes>
  </UserNotificationsBlock.PushProvider>
</AuthBlock.DefaultEmailOtpAuth>
```

- `PushProvider` goes inside the authentication provider. It inspects an
  existing registration without prompting, refreshes it only for the current
  user, and removes it on logout or account mismatch. Permission prompts happen
  only from the settings page's "Enable on this device" button. Mounting it on
  several app origins produces duplicate notifications (browsers expose no
  cross-origin device identifier).
- `NotificationOpenPage` is the handoff used by the Inbox, email, and push
  clicks. It reads the row, verifies recipient and source access, resolves the
  destination, marks only that occurrence read and clears its snooze, then
  performs a full navigation with `Redirect` (replacing its history entry). On a
  server failure it offers **Try again** and **Back to notifications**.
- `notifications.SidebarItem` (from `system.block(UserNotificationsBlock)`)
  shows an unread badge that refreshes after opening and polls for new activity.
- Inbox filters, search, and pagination are query parameters, so Back restores
  them.

Email never resolves a destination in the background: links go through the
handoff on `email.domain` (or `publicOrigin`), and access is evaluated after the
recipient authenticates. Custom source email bodies are fragments inside the
shared layout, which keeps its Open link.

## Read and delivery semantics

- Only opening an authorized occurrence through the handoff marks it read.
  Displaying or dismissing an OS notification, direct record or comment
  permalinks, and destination pages do not. Invalid or unauthorized
  notifications stay unread; a destination that later fails to load stays read.
  There is no record-wide automatic acknowledgment API.
- A changed push endpoint replaces the installation's credentials; a platform
  VAPID rotation is reconciled without another prompt.
- HTTP 404/410 deletes the subscription; 429, provider 5xx, and network errors
  retry with bounded backoff; other 4xx responses are terminal.
- Read, snoozed, deleted, inaccessible, and disabled-user notifications are
  skipped when the reactor rechecks state.

## Gotchas

- Before release, exercise cross-app navigation in a Forge preview: the
  destination opens in the expected app, unsupported targets stay unavailable,
  and acknowledgment happens only after the authenticated handoff.
