---
title: AddToCalendar
description: Menu button to add an event to Google, Apple, or Outlook calendars, with a formatAsICal helper that builds .ics content as a SQL expression.
tags:
  - ui
  - components
  - calendar
  - menu
related:
  - ui/overview.md
  - ui/button.md
  - ui/data.md
  - ui/styling.md
---

# AddToCalendar

`AddToCalendarButton` is an "Add to Calendar" menu button for one event, with
**Google Calendar** and **Outlook** (open the web compose page in a new
window) and **Apple Calendar** / **Other (iCal)** (download `<title>.ics`).
`formatAsICal` builds the `.ics` body as a SQL expression for endpoints and
email attachments.

```tsx
import { AddToCalendarButton, formatAsICal } from "components/add_to_calendar";

<AddToCalendarButton
  variant="soft"
  color="success"
  title={sql`event_type.name || ' with ' || agent.name`}
  startTime={sql`appointment.start_time`}
  endTime={sql`date.add(minute, event_type.duration, appointment.start_time)`}
/>
```

## AddToCalendarButton

- `title`, `startTime`, `endTime` (required), `description`, and `location`
  are SQL expressions resolved in the surrounding scope. `title` is also the
  download file name.
- The button wraps itself in a local `Data` that generates a random event
  `UID` per render. It is not self-routing. Its label and icon are fixed.
- `organizerName` / `organizerEmail` are accepted but **not forwarded** to
  the event. Use `formatAsICal` directly when you need an `ORGANIZER` line.
- `downloading` (static boolean) sets the iCal method to `PUBLISH` when true
  and `REQUEST` otherwise.
- `variant`, `color`, `size`, and `sx` pass through to `Menu.Button` and
  follow the shared
  [styling props](./styling.md#color-variant-and-size).

## formatAsICal

Generation-time helper that returns the `.ics` document as `Sql`. It is
usually returned from an API endpoint:

```ts
s.setHeader(sql.lit`Content-Type`, sql.lit`text/calendar`);
s.setHeader(sql.lit`Content-Disposition`, sql.lit`attachment; filename="event.ics"`);
s.return(
  formatAsICal({
    title: sql`event_type_record.name`,
    startTime: sql`appointment_record.start_time`,
    endTime: sql`date.add(minute, appointment_record.duration, appointment_record.start_time)`,
    uniqueId: sql`appointment_record.public_id`,
    location: sql`event_type_record.location_type::string`,
    organizerName: sql`agent_record.name`,
    organizerEmail: sql`agent_record.email`,
    downloading: true,
  }),
);
```

- `title`, `startTime`, `endTime`, and `uniqueId` (the `UID`) are required.
  `description` and `location` are optional.
- `ORGANIZER` is emitted only when both `organizerName` and `organizerEmail`
  are set.
- `ATTENDEE` is emitted only when both `inviteeName` and `inviteeEmail` are
  set and `downloading` is not true.
- `downloading: true` uses method `PUBLISH`; otherwise the method is
  `REQUEST`.
- The helper escapes text, folds long lines, converts start and end times to
  UTC, and adds a 15-minute display reminder (`VALARM`).
