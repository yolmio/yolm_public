---
title: Scheduling Block
description: "Adds a complete scheduling system: event types, public booking pages, appointments, notifications, and calendar/meeting integrations."
tags:
  - blocks
  - scheduling
  - calendar
  - appointments
related:
  - blocks/availability.md
  - blocks/calendar_integrations.md
  - blocks/meeting_integrations.md
  - blocks/solution_blocks.md
  - concepts/blocks.md
---

# Scheduling Block

`SchedulingBlock` is the reusable scheduling engine and the public block for
dev-defined event types. It adds appointment tables, public booking pages,
transactional email notifications, availability, and background syncing to
external calendar and meeting providers.

Runtime-defined event types are solution behavior rather than a reusable
package product. Their implementation lives in the owning system's shared
blocks; this package remains the dev-defined implementation and source of
model-neutral scheduling components.

Use it when an app needs hosts, public invitees, time-zone conversion, and
calendar/meeting integrations. Reach for plain `db.table` schema only when you
need a single bespoke booking table without availability, notifications, or
provider sync.

The block **auto-registers `AvailabilityBlock`** (the host availability model)
on `initialize()`. Do **not** add `AvailabilityBlock` yourself — it throws if a
second instance is present. You still use `AvailabilityBlock`'s static
components (e.g. `AvailabilityBlock.AvailabilityPage`) in your app files.

```ts
import { SchedulingBlock } from "blocks/scheduling";
import type {
  AppointmentFieldType,
  DevDefinedEventType,
} from "blocks/scheduling";
```

## Minimal Setup

Register any calendar integration blocks, then the scheduling block. The
example below configures one dev-defined appointment type. Calendar/meeting
integration blocks have their own options and credential dependencies — see
[Calendar integrations](./calendar_integrations.md) and
[Meeting integrations](./meeting_integrations.md).

```ts
import { SchedulingBlock } from "blocks/scheduling";
import { sql } from "std/sql_utils";
import { system } from "std/system";

system.addBlock(
  new SchedulingBlock({
    calendarIntegrations: [],
    devDefinedEventTypes: [
      {
        displayName: "Consultation",
        tableName: "booking_consultations",
        duration: 30,
        bufferBefore: 0,
        bufferAfter: 0,
        minNotice: 60,
        maxNotice: 60 * 24 * 30,
        timeSlotsInterval: 30,
        meetingLocation: "phone",
        schedulingDomain: "book.acme.com",
        schedulingPath: "/consultation",
        defineFields: (table) => {
          table.string("invitee_name", 100).notNull();
          table.email("invitee_email").notNull();
        },
        getUserEmail: (appointmentRecord) =>
          sql`${appointmentRecord}.invitee_email`,
      },
    ],
  }),
);
```

## Configuration

`new SchedulingBlock(opts)` is the reusable, dev-defined entry point.

Shared fields:

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `calendarIntegrations` | `CalendarIntegrationConfig[]` | yes | Calendar providers to sync (see below). May be `[]`. |
| `meetingIntegrations` | `MeetingIntegrationConfig[]` | no | Meeting providers (e.g. Zoom) to create meetings on. |
| `devDefinedEventTypes` | `DevDefinedEventType[]` | no | Statically-coded event types, each with its own appointment table. See below. |
| `timezoneRegion` | `TimezoneRegion` | no | Clamps booking-page time zones to a region. |
| `appointmentFieldTypes` | `AppointmentFieldType[]` | no | Extra invitee fields captured at booking and exposed as notification variables. |
| `extensions` | `SchedulingBlockExtensions` | no | Hooks into background-task and notification pipelines (see below). |

`CalendarIntegrationConfig` entry:

| Field | Type | Meaning |
| --- | --- | --- |
| `integration` | `CalendarIntegrationConstructor` | The integration class, e.g. `GoogleCalendarIntegration`, `OutlookCalendarIntegration`. |
| `addToCalendar` | `boolean` | Push appointments to the host's calendar. |
| `checkForConflicts` | `boolean` | Block slots that conflict with existing calendar events. |
| `eventIdField` | `string` | Column on appointment tables that stores the external event id. |

`MeetingIntegrationConfig` entry:

| Field | Type | Meaning |
| --- | --- | --- |
| `integration` | `MeetingIntegrationConstructor` | The meeting class, e.g. `ZoomIntegration`. |
| `addToMeeting` | `boolean` | Create a meeting when an appointment is booked. |
| `meetingIdField` | `string` | Column storing the external meeting id. A `<field>_join_url` column is added automatically. |

`addToMeeting` controls creation only. If an appointment already stores a
provider meeting id, Scheduling continues to update, delete, and render that
meeting so disabling future creation does not orphan an existing resource.


`SchedulingBlockExtensions` hooks (all optional): `beforeBackgroundTask`,
`onBackgroundTaskError`, `onNotificationError`, `beforeNotification`.


## Tables Created

Always created:

| Table | Purpose |
| --- | --- |
| `scheduling_background_tasks` | Queue of calendar/meeting/notification work processed by the background reactor. |
| `scheduling_integration_errors` | Calendar/meeting integration failures (TTL ~1 week). |
| `scheduling_google_integration_logs` | Google API call log (TTL ~1 week). |
| `scheduling_outlook_integration_logs` | Outlook API call log (TTL ~1 week). |
| `scheduling_notification_logs` | Email send log (TTL ~1 day). |
| `integration_failed_refresh_log` | OAuth token refresh failures (created whenever `calendarIntegrations` is supplied). |

The snapshot and retry fields on `scheduling_background_tasks` are nullable for
compatibility with databases created before those fields existed. Retry reads
treat null metadata as an unattempted task, so adding these fields does not
require a transform or historical backfill.


Each entry in `devDefinedEventTypes` creates its own `<tableName>` appointment
table plus a `<tableName>_notifications_status` table (and matching enums). The
block also defines many enums (e.g. `scheduling_appointment_status`,
`scheduling_background_task_type`).

`AvailabilityBlock` (auto-registered) creates the `availability_*` tables it
owns — see [Availability block](./availability.md).

## Pages and Components

Mount the page components via the static members of `SchedulingBlock` (they are
also exported from their submodules, e.g.
`blocks/scheduling/appointments_page`). All **page** components are
self-routing — render them directly, do **not** wrap them in `<Route>`.

| Member | Props | Self-routing | Meaning |
| --- | --- | --- | --- |
| `SchedulingBlock.AppointmentsPage` | `path` (req), `appointmentTable` (req), `eventTypeTable?`, `forAllUsers?`, `isDevDefined?`, `onCancel?`, `onNoShow?`, `extraLabel?`, `extraDetailContent?` | yes | Host bookings in Upcoming / Past / Date Range tabs with cancel, no-show, reassign, reschedule, notification status. Also registers a nav item. |
| `SchedulingBlock.IntegrationsPage` | `path?` (default `/integrations`) | yes | Connect calendar/meeting providers for the signed-in host. Also registers a nav item. |
| `SchedulingBlock.ErrorIntegrationsPage` | none | yes | Fixed route `/oauth-error` for failed OAuth redirects. |
| `SchedulingBlock.TimeOffPage` | `path?` (default `/time-off`) | yes | Manage host time-off periods. |
| `SchedulingBlock.DevDefinedSchedulingPages` | `type` (req), `basePath` (req), `form` (req), `description?`, `poweredByYolm?`, `scheduling?`, `backgroundColorOverride?` | yes | Renders the public booking, reschedule, and cancel pages for one dev-defined event type. |

`SchedulingBlock.inviteeEmailFooter({ icsUrl?, rescheduleUrl, cancelUrl })` and
`SchedulingBlock.inviteeEmailWithFooter({ title, body, icsUrl?, rescheduleUrl?, cancelUrl?, schedulingDomain?, schedulingPath?, appointmentRecord? })`
return MJML `Sql` for invitee emails. `inviteeEmailWithFooter` derives the
reschedule/cancel URLs from `schedulingDomain` + `schedulingPath` +
`appointmentRecord` when the explicit URLs are omitted (and throws if neither
the URLs nor the domain/path/record are supplied).

Example app routes:

```tsx
<AppRoutes>
  <SchedulingBlock.DevDefinedSchedulingPages
    type="consultations"
    basePath="/consultation"
    form={<ConsultationForm />}
  />
</AppRoutes>
```

## Exported Types and Helpers

- Exported interfaces: `DevDefinedEventType`, `AppointmentFieldType`,
  `SchedulingBlockExtensions`, and the `DevDefinedSchedulingPages` props
  interface.
- `NotificationsDialog` (from `blocks/scheduling/appointments_page`) —
  `{ bindScalar: string, onClose: (s) => void, appointmentId: NumericExpr }`; a
  dialog showing per-appointment notification status.

`CalendarIntegrationConfig` and `MeetingIntegrationConfig` are constructor
parameter shapes; pass them as object literals.

## Scheduled Jobs and Reactor

The block registers these automatically:

- `process_scheduling_background_tasks` (reactor on
  `scheduling_background_tasks`) — performs calendar/meeting/email work
  asynchronously.
- `scheduling_background_task_retry_wakeup` (every minute) — wakes durable
  host-transfer cleanup tasks whose bounded retry delay has elapsed.
- `scheduling_dev_email_reminder_proc` (every minute) — reminders for
  `devDefinedEventTypes` that define `emailReminders`.

## Relationships to Other Blocks

- [Availability block](./availability.md) — auto-registered; supplies the host
  availability model and `AvailabilityBlock.AvailabilityPage`. Do not register
  it separately.
- [Calendar integrations](./calendar_integrations.md) — register the provider
  blocks you reference in `calendarIntegrations` (Google, Outlook).
- [Meeting integrations](./meeting_integrations.md) — register the provider
  blocks you reference in `meetingIntegrations` (Zoom).
- Calendar/meeting providers depend on their own OAuth/secret stores; see those
  blocks' docs.

## Common Mistakes

- Adding `AvailabilityBlock` yourself. `SchedulingBlock` registers it; a second
  instance throws at generation time.
- Wrapping the self-routing page components in `<Route>`. Mount them directly.
- Omitting `appointmentTable` on `AppointmentsPage`.
- Referencing a Google Meet / Zoom `meetingLocation` without the matching
  integration in `calendarIntegrations` / `meetingIntegrations` — the value is
  only added to the location enum when its provider is registered.
