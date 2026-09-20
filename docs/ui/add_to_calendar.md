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

`AddToCalendarButton` renders a menu button labeled "Add to Calendar" that lets a user add a single event to Google Calendar, Apple Calendar, or Outlook, or download a `.ics` file. The module also exports `formatAsICal`, a helper that builds an iCalendar (`.ics`) document body as a SQL expression for serving from an endpoint or attaching to an email.

Use `AddToCalendarButton` in any UI where you have an event's title and start/end times available as SQL. Use `formatAsICal` when you only need the raw `.ics` content (e.g. an API response or email attachment), not the button UI.

```tsx
import { AddToCalendarButton, formatAsICal } from "components/add_to_calendar";
```

## Usage

Minimal usage only requires `title`, `startTime`, and `endTime`. Each value is a SQL expression evaluated in the surrounding scope.

```tsx
<AddToCalendarButton
  title={sql`'Test Event'`}
  startTime={sql`current_timestamp()`}
  endTime={sql`date.add(hour, 1, current_timestamp())`}
/>
```

Styled, placed inside a record/`Data` scope so its SQL can reference record fields:

```tsx
<AddToCalendarButton
  sx={{ alignSelf: "flex-end" }}
  size="md"
  variant="soft"
  color="success"
  title={sql`success_event_type.name || ' with ' || success_agent.name`}
  startTime={sql`success_appointment_record.start_time`}
  endTime={sql`date.add(minute, success_event_type.duration, success_appointment_record.start_time)`}
/>
```

`AddToCalendarButton` is not self-routing and does not need to be wrapped in a `Route`. It manages its own `Data` context internally (to generate a per-render event UID), so place it anywhere the SQL expressions you pass can resolve. The button label ("Add to Calendar") and its leading icon are fixed and not configurable.

## AddToCalendarButton Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `title` | `Sql` | Yes | Event title. Also used as the downloaded file name (`<title>.ics`). |
| `startTime` | `Sql` | Yes | Event start, as a timestamp expression. |
| `endTime` | `Sql` | Yes | Event end, as a timestamp expression. |
| `description` | `Sql` | No | Event description / details. |
| `location` | `Sql` | No | Event location. |
| `organizerName` | `Sql` | No | Accepted but currently NOT forwarded to the generated event — has no effect here. Use `formatAsICal` directly for an `ORGANIZER` line. |
| `organizerEmail` | `Sql` | No | Accepted but currently NOT forwarded to the generated event — has no effect here. Use `formatAsICal` directly for an `ORGANIZER` line. |
| `downloading` | `boolean` | No | Generation-time flag forwarded to the `.ics` content. When `true`, the calendar method is `PUBLISH`; otherwise `REQUEST`. |
| `size` | `Size` | No | Button size: `"xs"`, `"sm"`, `"md"`, or `"lg"`. |
| `variant` | `Variant` | No | Button variant: `"soft"`, `"solid"`, `"outlined"`, or `"plain"`. |
| `color` | `Color` | No | Button color: a palette name (`"primary"`, `"neutral"`, `"success"`, `"warning"`, `"danger"`) or `"harmonize"`. |
| `sx` | `Style` | No | Style object applied to the menu button. |

`size`, `variant`, and `color` are generation-time strings (not SQL expressions) and are passed through to the underlying menu button; when omitted they inherit the menu button defaults.

The menu offers four actions: **Google Calendar** and **Outlook** open the respective web calendar compose URL in a new tab; **Apple Calendar** and **Other (iCal)** download a `.ics` file named after `title`.

## formatAsICal

Builds an iCalendar document body and returns it as a `Sql` expression. It is generation-time code, but the value it returns is a SQL expression you serve or store at runtime — typically returned from an API endpoint procedure:

```ts
// Inside an API GET endpoint procedure (s):
s.setHeader(sql.lit`Content-Type`, sql.lit`text/calendar`);
s.setHeader(
  sql.lit`Content-Disposition`,
  sql.lit`attachment; filename="event.ics"`,
);
s.return(
  formatAsICal({
    title: sql`event_type_record.name`,
    description: sql`description`,
    startTime: sql`appointment_record.start_time`,
    endTime: sql`date.add(minute, appointment_record.duration, appointment_record.start_time)`,
    location: sql`event_type_record.location_type::string`,
    uniqueId: sql`appointment_record.public_id`,
    organizerName: sql`agent_record.name`,
    organizerEmail: sql`agent_record.email`,
    downloading: true,
  }),
);
```

### formatAsICal Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `title` | `Sql` | Yes | Event summary (`SUMMARY`). |
| `startTime` | `Sql` | Yes | Event start; converted to UTC for `DTSTART`. |
| `endTime` | `Sql` | Yes | Event end; converted to UTC for `DTEND`. |
| `uniqueId` | `Sql` | Yes | Value used as the event `UID`. |
| `description` | `Sql` | No | Event description (`DESCRIPTION`). |
| `location` | `Sql` | No | Event location (`LOCATION`). |
| `organizerName` | `Sql` | No | Organizer name; emitted only when `organizerEmail` is also set. |
| `organizerEmail` | `Sql` | No | Organizer email; emitted only when `organizerName` is also set. |
| `inviteeName` | `Sql` | No | Attendee name; emitted only with `inviteeEmail` and when `downloading` is not set. |
| `inviteeEmail` | `Sql` | No | Attendee email; emitted only with `inviteeName` and when `downloading` is not set. |
| `downloading` | `boolean` | No | When `true`, method is `PUBLISH` and no attendee line is added; otherwise method is `REQUEST`. |

The helper escapes text fields, folds long lines per the iCalendar spec, converts start/end times to UTC, and adds a 15-minute display reminder (`VALARM`).

## Common Mistakes

- Passing `size`, `variant`, or `color` as SQL expressions. They are generation-time strings only.
- Expecting `organizerName` / `organizerEmail` on `AddToCalendarButton` to appear in the generated event. The button does not forward them to the `.ics` content; use `formatAsICal` directly (with both `organizerName` and `organizerEmail`) if you need an `ORGANIZER` line.
- Omitting one of an organizer or invitee pair in `formatAsICal`. The `ORGANIZER` line requires both `organizerName` and `organizerEmail`; the `ATTENDEE` line requires both `inviteeName` and `inviteeEmail` and is skipped when `downloading` is `true`.
- Forgetting that `title`, `startTime`, and `endTime` are SQL expressions resolved in the surrounding scope. Place the button where the columns or scalars it references are in scope.
