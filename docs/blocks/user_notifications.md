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
recipient, shows individual occurrences by default, and can project the
same server state to email and Web Push. Web Push is fully managed: solution
code does not import the browser module, register a service worker, manage VAPID
keys, or send to devices directly.

## Configure the block

Define the identity adapter and every source in `core.tsx`, then set `push: true`:

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

`push: true` adds subscription and push-outbox tables, a bounded fanout job, a
delivery reactor, and the per-device settings UI. The platform supplies the
public VAPID key and keeps private keys outside the tenant system. Notifications
published before push is enabled remain Inbox-only, avoiding a historical
fanout when an existing system first adopts the feature.

Block-level `email` adds preferences and a shared email outbox. Each source can
set its email delivery policy:

- `preference` (or no source override) follows the recipient's digest,
  immediate, or off preference.
- `immediate` prepares a separate email for each occurrence while still
  honoring an explicit off preference.
- `disabled` keeps that source Inbox-only even when other sources use email.

Enabling block-level email in a deployed system adds schema and requires a
transform. Existing notification rows should retain a null
`email_eligible_at`, so historical Inbox activity is not fanned out.

## Publish

Application procedures publish a logical recipient notification. They never
address browsers:

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

The block validates active recipients and source access before insert. The
database later creates one delivery row for every active subscription belonging
to that recipient. Multiple devices do not multiply Inbox rows or unread
counts.

## Choose the notification-host app

In a multi-app system, choose one app as the notification host. Browser push is
enabled from that app once per browser profile; it can deliver notifications
published by every source in the system. Mount one push provider inside the
app's authentication provider, then mount the Inbox, settings, and click
handoff pages in that app:

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

The settings page offers “Enable on this device” and “Disable on this device.”
Permission and service-worker registration occur only from the enable-button
interaction. The provider inspects an existing registration without prompting,
refreshes it only when it already belongs to the current user, and removes it on
logout or account mismatch. Do not mount the provider independently on every app
origin unless duplicate notifications from those origins are desired.

Push clicks first open the same-origin handoff page with the notification ID.
That page reads the authoritative row, verifies the current recipient and source
access, resolves the source-owned destination, and then performs a full browser
navigation. This allows a notification hosted by one app to open another Yolm
app without teaching the service worker about domains or application routes.
The handoff marks only that authorized occurrence read before redirecting.

For a source owned by another app origin, its destination must return an
absolute HTTP(S) URL. Same-origin destinations may return relative routes.
Email requires `email.domain`, the app hosting the authenticated handoff.
Open links and preferences links are absolute and honor local domain mappings.
For an app whose public origin is stored at runtime, supply `email.publicOrigin`
as a SQL expression returning an absolute origin. Both links use that origin,
with whitespace and trailing slashes removed; null or blank values fall back to
the mapped `email.domain`.
Email never resolves a destination as a background worker: app choice and
access are evaluated after the recipient authenticates. Custom source email
bodies are content fragments inside the shared layout, retaining its Open link.

## Read semantics

For record notifications, declare a destination once. The package owns target
encoding, cross-app links, and marking opened occurrences read:

```tsx
import { RecordNotificationDestination } from "blocks/user_notifications";

const approvals = new RecordNotificationDestination({
  key: "purchasing.approval",
  table: "approvals",
  path: "/approvals/{id}",
  domain: "purchasing.example.com",
});

// On the source configuration:
destination: approvals.destination()

// In its publishing procedure:
source.publish(s, {
  recordKey: approvalId,
  recipientsQuery,
  title: sql.lit`Approval required`,
  target: approvals.at(approvalId),
});

// Inside the authenticated app routes:
<approvals.RecordPage recordWhere={approvalAccessCondition}>
  <ApprovalDetails />
</approvals.RecordPage>
```

`RecordPage` is an optional convenience for the configured table and path.
Custom pages need no notification-specific code. Record-level access remains
the destination page's responsibility.

For a source with multiple record kinds, use
`recordNotificationDestinations([approvals, orders])`. Keys must be system-wide
record identities, not recipient or event IDs. `domain` resolves local dev
ports automatically; `resolveHref(path)` is available instead when app choice
depends on runtime business permissions. Neither is persisted in the target:
the package stores its key and ID and resolves its current route when opening.

Record destinations accept only explicit target payloads. Historical bare URLs
are not parsed or migrated. Unknown/malformed targets show unavailable and do
not acknowledge an occurrence. `target` owns `href` and `payload`; supplying
either alongside it is a generation-time error.

Packages with specialized destinations, such as comments and training, can
implement the lower-level source-owned contract:

```tsx
destination: {
  href: (notification) => sql`'/approvals/' || ${notification}.record_key`,
}
```

The callbacks receive the **complete notification record** (including payload).
Use `notificationAppHref(domain, path)` for cross-app links; it respects local
development domain mappings. Optional `destination.routes()` lets a package
ship its destination pages with `<notifications.Routes />`. The same instance
also provides `<notifications.SidebarItem />` with an unread badge that refreshes
after opening a notification and polls for new activity.

Opening a valid, authorized notification marks only that occurrence read and
clears its snooze before redirecting. The destination URL has no notification
receipt parameter, and the handoff replaces its own history entry. Destination
pages do not report arrival or update notification state. Direct record and
comment permalinks do not mark notifications read. If the destination subsequently
fails to load, the opened notification remains read. Invalid or unauthorized
notifications stay unread.

If the opener's server request fails, it offers **Try again** and **Back to
notifications** instead of staying on the opening message.

Inbox filters, search, and pagination use query parameters so Back restores
them. Occurrence actions and unread counts use the same unit; there is no
grouped-inbox compatibility mode.

There is one navigation contract: a clickable source supplies `destination`.
Without one, an occurrence is informational and has no Inbox link; a stored
`href` alone never enables navigation or read-on-click. The handoff uses the
built-in `Redirect` component, with no browser-module dependency. Destinations
must be app-local paths or absolute HTTP(S) URLs without fragments; unsupported
targets show unavailable without acknowledging the occurrence.

Displaying or dismissing an OS notification does not mark it read. Opening its
authenticated handoff does, just like opening it from the Inbox or email.
Explicit Inbox read actions remain available. There is no record-wide automatic
acknowledgment API.

Before release, exercise the cross-app navigation regression in a Forge preview
with the supported browser workflow. Confirm that the destination opens in the
expected app, that unsupported targets remain unavailable, and that the
occurrence is acknowledged only after the authenticated handoff.

## Delivery lifecycle

- A subscription belongs to one browser installation and current user.
- A multi-app system normally registers subscriptions from one notification-host
  app; browser security does not provide a reliable cross-origin physical-device
  identifier.
- A changed endpoint replaces the installation's stored delivery credentials.
- A platform VAPID rotation is reconciled into a replacement subscription
  without another permission prompt.
- HTTP 404/410 deletes the subscription.
- HTTP 429, provider 5xx, and network errors retry with bounded backoff.
- Other provider 4xx responses are terminal for that delivery.
- Read, snoozed, deleted, inaccessible, and disabled-user
  notifications are skipped when the reactor rechecks authoritative state.

Email remains independently optional through the existing `email` config.
