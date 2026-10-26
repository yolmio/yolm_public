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

`SchedulingBlock` is the reusable scheduling engine for dev-defined event types:
appointment tables, public booking pages, transactional email, host
availability, and background sync to calendar and meeting providers.
Runtime-defined event types are not a package product; they live in the owning
system's shared blocks.

The block **auto-registers [`AvailabilityBlock`](./availability.md)** on
`initialize()` and throws if a second instance is present. Do not add it
yourself; still use its components (e.g. `AvailabilityBlock.AvailabilityPage`)
in app files.

## Minimal Setup

Register any calendar/meeting integration blocks first (see
[Calendar integrations](./calendar_integrations.md) and
[Meeting integrations](./meeting_integrations.md)), then the scheduling block:

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

Options are `DevDefinedSchedulingBlockOpts`, `DevDefinedEventType`,
`AppointmentFieldType`, and `SchedulingBlockExtensions` in
`packages/blocks/scheduling/index.tsx` (durations and notice values are
minutes). Non-obvious options:

| Option | Contract |
| --- | --- |
| `calendarIntegrations` | Required (may be `[]`). Each entry is `{ integration, addToCalendar, checkForConflicts, eventIdField }`; `eventIdField` is added to every appointment table to store the external event id. |
| `meetingIntegrations` | Entries `{ integration, addToMeeting, meetingIdField }`. A `<meetingIdField>_join_url` column is added automatically. `addToMeeting` controls creation only: an appointment that already stores a meeting id is still updated, deleted, and rendered. |
| `appointmentFieldTypes` | Extra invitee fields captured at booking and exposed as notification variables. |
| `extensions` | Hooks `beforeBackgroundTask`, `onBackgroundTaskError`, `onNotificationError`, `beforeNotification`. |
| `devDefinedEventTypes[].meetingLocation` | `zoom` creates meetings only with a matching `meetingIntegrations` entry with `addToMeeting`; `google_meet` only with Google in `calendarIntegrations` with `addToCalendar`. Otherwise no meeting is created. |
| `devDefinedEventTypes[].notifications` | Invitee/host email configs; `emailReminders` (each with `minutesBefore`) enables the reminder job. |

`CalendarIntegrationConfig` and `MeetingIntegrationConfig` are not exported;
pass object literals.

## Tables Created

| Table | Purpose |
| --- | --- |
| `scheduling_background_tasks` | Queue of calendar/meeting/notification work for the background reactor. |
| `scheduling_integration_errors` | Integration failures (TTL ~1 week). |
| `scheduling_google_integration_logs` | Google API call log (TTL ~1 week). |
| `scheduling_outlook_integration_logs` | Outlook API call log (TTL ~1 week). |
| `scheduling_notification_logs` | Email send log (TTL ~1 day). |
| `integration_failed_refresh_log` | OAuth token refresh failures (created whenever `calendarIntegrations` is supplied). |
| `<tableName>` | One appointment table per dev-defined event type. |
| `<tableName>_notifications_status` | Per-appointment notification status for that event type. |

Retry metadata on `scheduling_background_tasks` is nullable for older databases;
null is read as an unattempted task, so no transform or backfill is needed.
The block also defines `scheduling_*` and per-event-type enums.

## Pages and Components

Static members of `SchedulingBlock` (also exported from their submodules, e.g.
`blocks/scheduling/appointments_page`). All pages are self-routing: render them
directly, not inside `<Route>`.

| Member | Meaning |
| --- | --- |
| `AppointmentsPage` | Host bookings (Upcoming / Past / Date Range) with cancel, no-show, reassign, reschedule, and notification status; registers a nav item. Requires `path` and `appointmentTable`. |
| `IntegrationsPage` | Connect calendar/meeting providers for the signed-in host (default `/integrations`); registers a nav item. |
| `ErrorIntegrationsPage` | Fixed route `/oauth-error` for failed OAuth redirects. |
| `TimeOffPage` | Manage host time-off periods (default `/time-off`). |
| `PreviewAvailabilityPage` | Serves `/availability-preview/{sys_user_id:id}`, linked from `AvailabilityPage`. |
| `DevDefinedSchedulingPages` | Public booking, reschedule, and cancel pages for one dev-defined event type. Requires `type`, `basePath`, `form`. |

```tsx
<AppRoutes>
  <SchedulingBlock.DevDefinedSchedulingPages
    type="consultations"
    basePath="/consultation"
    form={<ConsultationForm />}
  />
</AppRoutes>
```

`SchedulingBlock.inviteeEmailFooter({ icsUrl?, rescheduleUrl, cancelUrl })` and
`SchedulingBlock.inviteeEmailWithFooter({ title, body, ... })` return MJML `Sql`
for invitee emails. `inviteeEmailWithFooter` derives reschedule/cancel URLs from
`schedulingDomain` + `schedulingPath` + `appointmentRecord` when explicit URLs
are omitted, and throws if neither is supplied.

`NotificationsDialog` (from `blocks/scheduling/appointments_page`, props
`{ bindScalar, onClose, appointmentId }`) shows per-appointment notification
status.

## Scheduled Jobs and Reactor

- `process_scheduling_background_tasks`: reactor on
  `scheduling_background_tasks` doing calendar/meeting/email work.
- `scheduling_background_task_retry_wakeup` (every minute): wakes tasks whose
  bounded retry delay has elapsed.
- `scheduling_dev_email_reminder_proc` (every minute): created only when an
  event type defines `emailReminders`.
