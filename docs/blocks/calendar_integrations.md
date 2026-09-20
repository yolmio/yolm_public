---
title: Calendar Integrations
description: Per-user Google and Outlook calendar integration blocks that sync events with the scheduling block over Yolm managed OAuth.
tags:
  - blocks
  - calendar
  - google
  - outlook
  - scheduling
related:
  - blocks/scheduling.md
  - blocks/meeting_integrations.md
  - blocks/solution_blocks.md
  - concepts/blocks.md
---

# Calendar Integrations

`blocks/calendar_integrations` defines the `CalendarIntegration` interface (a
`Block`) and ships two system-block implementations that connect a user's real
calendar to the scheduling system:

- `GoogleCalendarIntegration` — Google Calendar via the Google Calendar API.
- `OutlookCalendarIntegration` — Outlook via the Microsoft Graph API.

Each block manages per-user OAuth accounts, mirrors remote events into local
tables (for conflict checking), keeps push-notification/watch subscriptions
alive, and writes scheduling appointments back to the provider. Register the
integrations alongside `SchedulingBlock`; the scheduling block discovers them
through its `calendarIntegrations` option and drives the per-user connection
UI and booking sync. Use these blocks instead of building custom OAuth +
calendar-sync schema by hand.

OAuth uses Yolm's managed OAuth service (`managed_oauth` service requests), so
you do **not** need to wire up your own credential store.

## Imports

```ts
import { GoogleCalendarIntegration } from "blocks/calendar_integrations/google";
import { OutlookCalendarIntegration } from "blocks/calendar_integrations/outlook";
// Types / interface (rarely needed directly — the scheduling block consumes these):
import type {
  CalendarIntegration,
  CalendarIntegrationConstructor,
} from "blocks/calendar_integrations";
```

## Setup

Register the integration block(s) in `core.tsx` **before** `SchedulingBlock`,
then reference the integration constructors from the scheduling block's
`calendarIntegrations` list:

```ts
system.addBlock(
  new GoogleCalendarIntegration({
    notificationDomain: "scheduling-agent.example.com",
    provider: "google_calendar",
    scopes: sql`json_build_array(
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events'
    )`,
  }),
);

system.addBlock(
  new OutlookCalendarIntegration({
    notificationDomain: "scheduling-agent.example.com",
    provider: "outlook_calendar",
    scopes: sql`json_build_array(
      'offline_access',
      'https://graph.microsoft.com/Calendars.ReadWrite',
      'https://graph.microsoft.com/User.Read'
    )`,
  }),
);

system.addBlock(
  new SchedulingBlock({
    calendarIntegrations: [
      {
        integration: GoogleCalendarIntegration,
        addToCalendar: true,
        checkForConflicts: true,
        eventIdField: "google_event_id",
      },
      {
        integration: OutlookCalendarIntegration,
        addToCalendar: true,
        checkForConflicts: true,
        eventIdField: "outlook_event_id",
      },
    ],
    // ...other scheduling options
  }),
);
```

The scheduling block's integrations page calls `addOauthRedirect(app)` for each
registered integration and renders the per-user connection UI using the block's
`icon`, `accountDisplay`, `isActiveAccount`, `navigateToOauth`, and
`deleteAccount`; its agent-management page additionally renders `adminStatus`.

### Managed-OAuth convenience factories

Both classes provide a static `globalYolmOauth` helper that returns a
preconfigured instance using the hosted managed-OAuth provider (`google_calendar`
/ `outlook_calendar`) with default calendar scopes. It takes only
`{ notificationDomain }`:

```ts
system.addBlock(
  GoogleCalendarIntegration.globalYolmOauth({
    notificationDomain: "scheduling-agent.example.com",
  }),
);

system.addBlock(
  OutlookCalendarIntegration.globalYolmOauth({
    notificationDomain: "scheduling-agent.example.com",
  }),
);
```

## Configuration

### `GoogleCalendarIntegration` constructor options

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `notificationDomain` | `string \| string[]` | Yes | Domain(s) that host the `POST /api/google-calendar-notifications` push endpoint and (if `adminDebugToken` is set) the debug endpoint. The first entry is used as the watch callback address. |
| `provider` | `string` | Yes | Managed-OAuth provider key (e.g. `"google_calendar"`). Passed to `managed_oauth` service requests. |
| `scopes` | `Sql` | Yes | OAuth scopes as a SQL JSON array expression (`sql\`json_build_array(...)\``). |
| `adminDebugToken` | `string` | No | If set, registers `POST /api/admin/agent-google-events` for raw-event debugging, gated on an `X-Admin-Token` header equal to this value. |
| `extensions` | `GoogleCalendarIntegrationExtensions` | No | Lifecycle hooks (see [Extensions](#extensions)). |

### `OutlookCalendarIntegration` constructor options

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `provider` | `string` | Yes | Managed-OAuth provider key (e.g. `"outlook_calendar"`). |
| `scopes` | `Sql` | Yes | OAuth scopes as a SQL JSON array expression. |
| `notificationDomain` | `string \| string[]` | Yes | Domain(s) that host the `POST /api/azure-notifications` Graph subscription endpoint and (if `adminDebugToken` is set) the debug endpoint. The first entry is used as the subscription callback URL. |
| `adminDebugToken` | `string` | No | If set, registers `POST /api/admin/agent-outlook-events`, gated on an `X-Admin-Token` header. |
| `extensions` | `OutlookCalendarIntegrationExtensions` | No | Lifecycle hooks (see [Extensions](#extensions)). |

OAuth redirect addresses are derived internally from the request origin.
Calendar notification callbacks use `notificationDomain`; there is no separate
dev-notification override.

## Provider authoring

Most solution developers only configure the bundled Google and Outlook
integrations above; `SchedulingBlock` owns provider calls and the connection
UI. If a system needs a custom provider, inspect the exported
`CalendarIntegration` types in Forge and preserve the OAuth, notification, and
capability contracts described above.

## Tables Created

### Google (`GoogleCalendarIntegration`)

| Table | Purpose / key columns |
| --- | --- |
| `user_google_accounts` | Per-user Google OAuth account. `sys_user_id` (fk), `credential_id` (unique), `email`, `provider_subject`, `granted_scopes`, `status` (`google_connection_status`), `created_at`. |
| `user_google_calendars` | Per-account calendars. `google_calendar_id`, `summary`, `supports_notifications`, `sync_token`, `timezone`, `check_for_conflicts`, `add_to_calendar`, plus `notification_channel_id` / `notification_resource_id` / `notification_expiration`. |
| `user_google_calendar_events` | Mirrored events for conflict checking. `summary`, `start_time`, `end_time`, `google_event_id`; unique on `(user_google_calendar_id, google_event_id)`. |
| `deleted_yolm_google_events` | Tombstones for Yolm-created events removed remotely. `google_event_id`, `deleted_at`. |
| `user_google_calendar_error_logs` | Operation error log (`operation`, `error_type`, `error_message`, `error_description`, `raw_error`); TTL ~1 week. |
| `google_calendar_reconciliation_jobs` | Reconciliation work queue; TTL ~2 days. |

### Outlook (`OutlookCalendarIntegration`)

| Table | Purpose / key columns |
| --- | --- |
| `user_outlook_accounts` | Per-user Microsoft OAuth account. `sys_user_id` (fk), `credential_id` (unique), `email`, `provider_subject`, `granted_scopes`, `status` (`outlook_connection_status`), `created_at`. |
| `user_outlook_calendars` | Per-account calendars. `azure_calendar_id`, `summary`, `check_for_conflicts`, `add_to_calendar`, `expiration_date_time`, `notification_resource_id`, `last_event_sync_at`. |
| `user_outlook_calendar_events` | Mirrored events. `summary`, `start_time`, `end_time`, `outlook_event_id`, `series_master_id`. |
| `deleted_yolm_outlook_events` | Tombstones for Yolm-created events removed remotely. `outlook_event_id`, `deleted_at`. |
| `user_outlook_calendar_error_logs` | Operation error log (`operation`, `error_type`, `error_message`, `error_description`); TTL ~1 week. |
| `outlook_calendar_reconciliation_jobs` | Reconciliation work queue; TTL ~2 days. |

### Outlook subscription replacement

Existing Graph subscriptions are renewed with `PATCH /subscriptions/{id}`,
including the configured notification URL so domain changes reach existing watches.
Only a missing subscription (HTTP 404) triggers creation of a replacement.
Publication rechecks the calendar's subscription ID, account, remote calendar,
and conflict-checking setting inside the commit transaction. A concurrent
winner is preserved; a losing new subscription is deleted immediately.
The newly created ID is retained across catchable validation, hook, and
publication failures so those paths also attempt protected cleanup.
Cleanup never deletes an ID currently referenced by a calendar. HTTP 204 and
404 finish cleanup; other failures log the calendar and subscription IDs in
`user_outlook_calendar_error_logs` and execution errors. Failed deletions are
not retried; the remote subscription expires naturally. Execution errors are
emitted before database logging; missing calendars use a null log reference with
the original calendar and subscription IDs retained in diagnostic text. A failed
database-log insert does not interrupt cleanup.

Unsubscribe detaches its subscription ID transactionally before remote deletion,
preventing a concurrent renewal from publishing that ID again. Re-enabling then
creates a fresh subscription. Reactor-driven unsubscribe rechecks that conflict
checking is disabled before detaching and again before deleting mirrored events.
Failed remote deletion leaves the old ID detached and logged until remote expiry.
The existing watch hooks also run for renewals. Block debug output distinguishes
`subscription_renewed`, `subscription_published`, and `subscription_superseded`.

No schema changes or historical event rewrites are required. Untracked
subscriptions left by older releases expire at Graph. Provider creation and the
database commit cannot be one atomic transaction, so a process failure between
them can still leave a remote subscription until expiry.

## Enums

| Enum | Values | Created by |
| --- | --- | --- |
| `google_connection_status` | `active`, `reauth_required` | `GoogleCalendarIntegration` |
| `outlook_connection_status` | `active`, `reauth_required` | `OutlookCalendarIntegration` |

## Reactors

Registered automatically. The `subscribe` / `renew` / `unsubscribe` reactors are
only added when the block's `watch_changes` capability is not disabled; the
reconciliation reactors always run. Outlook's `refresh_stale_outlook_calendars`
is also always registered (it is not gated on `watch_changes`).

### Google

- `subscribe_google_calendar` — opens a watch channel for conflict-checked calendars (backoff-aware). Gated on `watch_changes`.
- `renew_expiring_google_subscription` — renews channels nearing expiration. Gated on `watch_changes`.
- `unsubscribe_google_calendar` — stops watches and clears mirrored events when a calendar stops conflict-checking. Gated on `watch_changes`.
- `google_calendar_reconcile_job` — drains `google_calendar_reconciliation_jobs`. Always registered.

### Outlook

- `subscribe_outlook_calendar` — creates Graph subscriptions (backoff-aware). Gated on `watch_changes`.
- `renew_expired_outlook_subscription` — extends subscriptions within six hours of expiry. Gated on `watch_changes`.
- `unsubscribe_outlook_calendar` — stops subscriptions and clears mirrored events. Gated on `watch_changes`.
- `refresh_stale_outlook_calendars` — re-watches calendars whose sync is stale. Always registered.
- `outlook_calendar_reconcile_job` — drains `outlook_calendar_reconciliation_jobs`. Always registered.

## APIs / Endpoints

`addOauthRedirect(app)` (called by the scheduling integrations page) registers:

- `GET /api/can-write/google-calendar-oauth-callback` / `GET /api/can-write/outlook-calendar-oauth-callback` on the app domain and each `domainAliases` entry.
- A global `GET /can-write/google-calendar-oauth-redirect` / `GET /can-write/outlook-calendar-oauth-redirect` that resolves the original host and forwards to the per-app callback.

The block's `populate()` additionally registers, per `notificationDomain`:

- Google: `POST /api/google-calendar-notifications` (push webhook).
- Outlook: `POST /api/azure-notifications` (Graph change webhook; echoes `validationToken` for subscription validation).
- Debug (only when `adminDebugToken` is set):
  `POST /api/admin/agent-google-events` /
  `POST /api/admin/agent-outlook-events`, gated on the `X-Admin-Token` header.
  The Google endpoint returns account/calendar status even when the account is
  inactive; when Scheduling is configured with user-defined event types, it
  also correlates appointments, pending background tasks, integration errors,
  and Google operation logs for the requested window. Raw Google events are
  included only when the account and write calendar are active.

## Extensions

Pass optional server-statement hooks via the `extensions` constructor option to
run extra logic around the watch/notification lifecycle without forking the
block. Each hook receives the statement builder `s` and a context object.

`GoogleCalendarIntegrationExtensions`:

| Hook | Context |
| --- | --- |
| `beforeWatch` | `{ calendarId, calendarRecord, accountRecord }` |
| `afterWatch` | `{ calendarId, responseRecord }` |
| `onWatchError` | `{ calendarId, errorRecord }` |
| `onNotificationError` | `{ errorRecord }` |
| `onNotificationReceived` | `{ channelId, resourceState }` |

`OutlookCalendarIntegrationExtensions` is the same except its
`onNotificationReceived` context is `{ body }` (the raw Graph notification
payload) instead of `{ channelId, resourceState }`.

## Capabilities

Each block exposes `externalServiceOptions` (capability opt-ins surfaced via
Yolm's capability system): Google declares `read_events`, `modify_events`, and
`watch_changes`; Outlook declares `oauth`, `read_events`, `modify_events`, and
`watch_changes`. When `watch_changes` is turned off, the subscribe/renew/
unsubscribe reactors are not registered (Outlook's
`refresh_stale_outlook_calendars` and both reconcile reactors still run).

## Relationships to other blocks

- **`SchedulingBlock`** (`blocks/scheduling`): the primary consumer. List the
  integration constructors in `SchedulingBlock`'s `calendarIntegrations`
  option; the scheduling block calls the interface methods to check conflicts
  and write appointments back to the calendar.
- **`DevLogBlock`** (`blocks/dev_log`): optional. If registered, the
  reconciliation reactors add `google_calendar_reconciliation` /
  `outlook_calendar_reconciliation` log categories and record results.
- **Scheduling log tables**: when `SchedulingBlock` is present, operation
  failures are also written to `scheduling_google_integration_logs`,
  `scheduling_outlook_integration_logs`, and `scheduling_integration_errors`
  (tables owned by the scheduling block).

## Common Mistakes

- **Registering the integration after `SchedulingBlock`.** Add the calendar
  integration block(s) first so the scheduling block can resolve them with
  `system.block(...)`.
- **Importing from the package root for the classes.** The classes live in
  submodules: import `GoogleCalendarIntegration` from
  `blocks/calendar_integrations/google` and `OutlookCalendarIntegration` from
  `blocks/calendar_integrations/outlook`. The root
  `blocks/calendar_integrations` only exports the `CalendarIntegration`
  interface and option/param types.
- **Expecting standalone page components.** This block exposes no page
  components. UI (the connection card, OAuth redirect routes) is rendered by
  the scheduling block via the integration's `icon`, `accountDisplay`,
  `adminStatus`, and `addOauthRedirect`.
- **Wiring your own OAuth credential store.** These blocks use Yolm managed
  OAuth (`managed_oauth` service requests); set `provider` and `scopes` instead. Redirect addresses are derived internally.
- **Passing an integration instance where a constructor is expected.**
  `SchedulingBlock`'s `calendarIntegrations[].integration` field is a
  `CalendarIntegrationConstructor` — pass the class (`GoogleCalendarIntegration`),
  not `new GoogleCalendarIntegration(...)`.
