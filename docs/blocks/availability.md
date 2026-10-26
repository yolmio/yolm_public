---
title: Availability Block
description: User availability model — recurring weekly hours, date-specific overrides, and time-off periods used by the scheduling block.
tags:
  - blocks
  - scheduling
  - availability
  - time-off
related:
  - blocks/scheduling.md
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# Availability Block

`AvailabilityBlock` adds per-user recurring weekly hours, date-specific
overrides, and time-off periods, an editor page, and server helpers that flatten
them into concrete available time ranges. It is the data layer behind
[`SchedulingBlock`](./scheduling.md).

## Minimal Setup

`SchedulingBlock` already creates and registers `AvailabilityBlock`, and throws
if a second instance is registered. Add it yourself only for standalone use:

```ts
import { AvailabilityBlock } from "blocks/availability";

system.addBlock(new AvailabilityBlock());
```

The constructor takes no options. Records foreign-key to `sys_users`, and range
helpers read `sys_users.timezone`, so an auth/users setup must already exist.

## Tables Created

All tables skip sample-data generation; `afterGenerateSampleData` instead calls
`addDefaultAvailability` for every `sys_users` row.

| Table | Purpose |
| --- | --- |
| `availability_days` | One row per weekday per user; `enabled` toggles the day. |
| `availability_slots` | Recurring time windows within an available day. |
| `availability_date_specific_slots` | One-off hours for a calendar date; `date` must be in the future. |
| `availability_time_off_periods` | Vacation / blocked date ranges; `start_date` must be in the future. |

The block also defines the `day_of_week` enum (`sun` … `sat`) and the rule
function `fn.day_of_week_as_int(<day_of_week expr>)`, mapping `sun` → 0 …
`sat` → 6 to match `date.part(dow, ...)`.

## Pages and Components

`AvailabilityBlock.AvailabilityPage` (also the named export `AvailabilityPage`
from `blocks/availability`) lets the current user edit time zone, weekly hours,
date-specific overrides, and time off. It is self-routing (default `path`
`/availability`; do not wrap it in a `<Route>`), registers an "Availability"
navigation entry, and throws at generation time if `AvailabilityBlock` is not
registered. Its "Preview your availability" button links to
`/availability-preview/<userId>`, which only `SchedulingBlock.PreviewAvailabilityPage`
serves.

```tsx
<AvailabilityBlock.AvailabilityPage />;
```

The page's sections are importable to build a custom layout. Each takes the
block table name(s) as string props and edits `current_user`'s rows:

| Component | Import | Props |
| --- | --- | --- |
| `AvailabilitySection` | `blocks/availability/availability_section` | `availabilityTable`, `availabilitySlotsTable` |
| `DateSpecificHoursSection` | `blocks/availability/date_specific_hours_section` | `dateSpecificSlotsTable` |
| `TimeOffSection` | `blocks/availability/time_off_section` | `timeOffPeriodsTable` |

## Server Helpers

Call these on `system.block(AvailabilityBlock)` inside a statement builder `s`.

`addDefaultAvailability(s, userId)` seeds Mon–Fri 09:00–17:00 with Sat/Sun
disabled. Call it when users are created (user-insert hook or dev-DB pipeline);
without it a new user has no recurring availability.

```ts
system.block(AvailabilityBlock).addDefaultAvailability(s, sql`0`);
```

`getAvailabilityRangesForDateRange(s, { query, targetTable, userTimezone,
filterUserId })` defines temp table `targetTable` with available ranges:

- `query` must expose a `date` column listing the dates to compute.
- `filterUserId` maps a user-id expression to a boolean predicate, e.g.
  `(id) => sql\`${id} = current_user\``.
- A date with any date-specific slot uses only those slots, replacing recurring
  hours. Time-off periods drop recurring hours but do **not** filter
  date-specific slots.
- Times are converted from each user's `sys_users.timezone` into
  `userTimezone`.
- Result columns: `sys_user_id`, `date`, `start_datetime`, `end_datetime`,
  `start_hour`, `start_minute`, `end_hour`, `end_minute`. Only positive-duration
  ranges are kept, ordered by `date`, `start_datetime`.

`getAvailabilityRangesForMonth(s, { month, ... })` (any date in the month) and
`getAvailabilityRangesForDay(s, { date, ... })` wrap the date-range helper with
the same other options, padding one day on each side for time-zone spill.
`SchedulingBlock` uses these two to drive booking availability.
