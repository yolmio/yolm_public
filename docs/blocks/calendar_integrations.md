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

`blocks/calendar_integrations` connects each user's calendar to
`SchedulingBlock` over Yolm managed OAuth: per-user accounts, mirrored remote
events for conflict checking, push subscriptions, and write-back of
appointments. Implementations: `GoogleCalendarIntegration`
(`blocks/calendar_integrations/google`) and `OutlookCalendarIntegration`
(`blocks/calendar_integrations/outlook`, Microsoft Graph). The package root
`blocks/calendar_integrations` exports only the `CalendarIntegration` interface,
`CalendarIntegrationConstructor`, and option/param types.

## Setup

Register the integration block(s) in `core.tsx` before `SchedulingBlock`, then
pass the classes (constructors, not instances) in its `calendarIntegrations`:

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
// OutlookCalendarIntegration takes the same options, e.g. provider
// "outlook_calendar" with offline_access, Calendars.ReadWrite, User.Read scopes.

system.addBlock(
  new SchedulingBlock({
    calendarIntegrations: [
      {
        integration: GoogleCalendarIntegration,
        addToCalendar: true,
        checkForConflicts: true,
        eventIdField: "google_event_id",
      },
    ],
    // ...other scheduling options
  }),
);
```

`GoogleCalendarIntegration.globalYolmOauth({ notificationDomain })` and
`OutlookCalendarIntegration.globalYolmOauth({ notificationDomain })` return an
instance preconfigured with the hosted managed-OAuth provider
(`google_calendar` / `outlook_calendar`) and default calendar scopes.

The blocks expose no page components. The scheduling integrations page calls
`addOauthRedirect(app)` for each integration and renders the connection UI from
`icon`, `accountDisplay`, `isActiveAccount`, `navigateToOauth`, and
`deleteAccount`; its agent-management page also renders `adminStatus`.

## Configuration

The option interfaces are not exported; both classes take:

| Option | Required | Meaning |
| --- | --- | --- |
| `provider` | Yes | Managed-OAuth provider key passed to `managed_oauth` service requests. Do not wire your own credential store. |
| `scopes` | Yes | SQL JSON array expression (`sql\`json_build_array(...)\``). |
| `notificationDomain` | Yes | `string \| string[]` hosting the push endpoint (and debug endpoint). The first entry is the watch/subscription callback address; there is no separate dev-notification override. |
| `adminDebugToken` | No | Registers a raw-event debug endpoint gated on an `X-Admin-Token` header equal to this value. |
| `extensions` | No | `GoogleCalendarIntegrationExtensions` / `OutlookCalendarIntegrationExtensions` (see Extensions). |
| `conflictSync` | No | Outlook only: `{ schedule, windowMinutes, forUsers }` enables periodic conflict mirroring. `schedule` is a cron expression, `windowMinutes` is a positive finite SQL horizon, and `forUsers` is a SQL query returning user IDs. |

OAuth redirect addresses are derived internally from the request origin.

With `conflictSync`, the block registers `outlook_conflict_calendar_resync`.
It processes active, conflict-checked calendars serially, fetching the complete
window before committing changes. Event IDs are case-sensitive; unchanged
mirrors cause no database writes. Failed calendars are logged independently and
retried on the next run. Failed notification batches return HTTP 503 so the
provider can retry them; other events in the batch still run. A failed event
also queues deduplicated recovery for its active, conflict-checked calendar.
The existing reconciliation worker runs a bounded mirror sync before any
outbound repairs, including for calendars used only for conflict checking.

Choose a horizon that covers the longest supported booking window, with a
buffer. The system owns that policy; the block does not infer it from a specific
scheduling schema. The block rejects null or nonpositive horizons. Enabling
this option replaces six-month mirroring with the bounded window. Nightly
jobs retain outbound repair and also run that bounded sync through the shared
recovery queue; nightly enqueueing removes expired mirrors. Without the option,
nightly reconciliation continues to mirror events too. Remove any
system-owned job with the same name when enabling the block's job.

`syncCalendarWindow(s, { calendarId, start, end, counts })` exposes the same
bounded mirror operation for custom procedures. Call it outside a transaction;
`counts` names three local scalars (`created`, `updated`, `deleted`). Nightly
logs distinguish `outbound_*` repairs from `mirrored_*` changes.

To author a custom provider, implement the exported `CalendarIntegration`
interface and preserve the OAuth, notification, and capability contracts
described here.

## Tables Created

Inspect the schema for columns. Error logs have a TTL of ~1 week and
reconciliation queues ~2 days.

| Google | Outlook | Purpose |
| --- | --- | --- |
| `user_google_accounts` | `user_outlook_accounts` | Per-user OAuth account; `status` uses `google_connection_status` / `outlook_connection_status` (`active`, `reauth_required`). |
| `user_google_calendars` | `user_outlook_calendars` | Per-account calendars with `check_for_conflicts` / `add_to_calendar` flags and subscription state. |
| `user_google_calendar_events` | `user_outlook_calendar_events` | Mirrored events for conflict checking. |
| `deleted_yolm_google_events` | `deleted_yolm_outlook_events` | Remote-deletion bookkeeping; the Outlook table is retained only for physical schema compatibility and receives no new rows. |
| `user_google_calendar_error_logs` | `user_outlook_calendar_error_logs` | Operation error log. |
| `google_calendar_reconciliation_jobs` | `outlook_calendar_reconciliation_jobs` | Reconciliation work queue. |

When `SchedulingBlock` is present, failures are also written to its
`scheduling_google_integration_logs`, `scheduling_outlook_integration_logs`,
and `scheduling_integration_errors`. If `DevLogBlock` is registered,
reconciliation adds `google_calendar_reconciliation` /
`outlook_calendar_reconciliation` log categories.

### Outlook subscription lifecycle

- Renewal uses `PATCH /subscriptions/{id}`, including the configured
  notification URL so domain changes reach existing watches. Only HTTP 404
  creates a replacement for authenticated subscriptions. Legacy subscriptions
  without a client secret are deleted and replaced by the renewal reactor,
  which queues reconciliation when retiring the legacy watch to repair missed
  changes even if replacement creation fails.
- Each calendar stores a cryptographically random `notification_client_state`.
  Notifications with missing or nonmatching secrets are ignored before calendar
  mutations or event fetches. Existing subscriptions fail closed until replaced.
  The nullable secret field is a compatible addition. Watch reserves it before
  provider creation, so a lost response can be recovered using the same secret.
  Publication rechecks that reservation; unsubscribe clears both ID and secret,
  including pending creations without an ID. Error logs
  omit raw notification bodies because they contain the secret.
- Publication rechecks the calendar's subscription ID, account, remote
  calendar, and conflict-checking setting inside the commit transaction. A
  concurrent winner is preserved; a losing new subscription is deleted
  immediately. The new ID is retained across catchable validation, hook, and
  publication failures so those paths also attempt cleanup.
- Cleanup checks database references and revokes any matching unpublished secret
  transactionally before DELETE. A recovery already in flight cannot publish
  using that revoked reservation. HTTP 204 and 404
  finish cleanup; other failures are logged (calendar and subscription IDs) in
  `user_outlook_calendar_error_logs` and execution errors, are not retried, and
  the remote subscription expires naturally. Execution errors are emitted before
  database logging; a missing calendar logs a null reference with the IDs in
  the text; a failed log insert does not interrupt cleanup.
- Unsubscribe detaches the ID transactionally before remote deletion, so a
  concurrent renewal cannot republish it; re-enabling creates a fresh
  subscription. Reactor-driven unsubscribe rechecks that conflict checking is
  disabled before detaching and again before deleting mirrored events.
- Watch hooks also run for renewals. Debug output distinguishes
  `subscription_renewed`, `subscription_published`, and
  `subscription_superseded`.
- If creation commits at Graph but its response is lost, a retry can return
  409. Watch then follows Graph's subscription-list pagination to find the same
  calendar, notification URL, and change types, and retrieves that subscription
  individually (the list omits `clientState`). It validates the ID, resource,
  URL, expiration, and exact match to the reserved 64-character hex secret before
  publication. Re-enable gets a fresh secret and cannot adopt the subscription
  an earlier unsubscribe is deleting. A verified retired subscription is deleted
  only after rechecking the current reservation and absence of any published
  reference, allowing the next retry to create a fresh watch. This also handles
  unsubscribe after a lost creation response, when no provider ID was stored.
  Missing or invalid recovery data fails closed; unrelated subscriptions are
  preserved. Normal renewals still use PATCH.

## Reactors and Capabilities

`externalServiceOptions` declares `read_events`, `modify_events`, and
`watch_changes` (Outlook also `oauth`). The subscribe/renew/unsubscribe reactors
are registered only when `watch_changes` is not disabled; the others always run.

| Google | Outlook | Gated on `watch_changes` |
| --- | --- | --- |
| `subscribe_google_calendar` | `subscribe_outlook_calendar` | Yes; backoff-aware, conflict-checked calendars. |
| `renew_expiring_google_subscription` | `renew_expired_outlook_subscription` (within six hours of expiry) | Yes |
| `unsubscribe_google_calendar` | `unsubscribe_outlook_calendar` | Yes; also clears mirrored events. |
| `google_calendar_reconcile_job` | `outlook_calendar_reconcile_job` | No |
| | `refresh_stale_outlook_calendars` | No; re-watches stale calendars. |

## Endpoints

- `addOauthRedirect(app)`: `GET /api/can-write/{google,outlook}-calendar-oauth-callback`
  on the app domain and each `domainAliases` entry, plus a global
  `GET /can-write/{google,outlook}-calendar-oauth-redirect` that resolves the
  original host and forwards to the per-app callback.
- `populate()`, per `notificationDomain`: Google
  `POST /api/google-calendar-notifications`; Outlook
  `POST /api/azure-notifications` (echoes `validationToken`).
- With `adminDebugToken`: `POST /api/admin/agent-google-events` /
  `POST /api/admin/agent-outlook-events`. The Google endpoint returns
  account/calendar status even for inactive accounts; with user-defined
  Scheduling event types it also correlates appointments, pending background
  tasks, integration errors, and Google operation logs for the window. Raw
  Google events are included only when the account and write calendar are
  active.

## Extensions

Server-statement hooks `(s, ctx)` around the watch/notification lifecycle:

| Hook | Context |
| --- | --- |
| `beforeWatch` | `{ calendarId, calendarRecord, accountRecord }` |
| `afterWatch` | `{ calendarId, responseRecord }` |
| `onWatchError` | `{ calendarId, errorRecord }` |
| `onNotificationError` | `{ errorRecord }` |
| `onNotificationReceived` | Google `{ channelId, resourceState }`; Outlook `{ body }` (raw Graph payload) |
