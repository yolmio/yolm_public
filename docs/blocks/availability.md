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

`AvailabilityBlock` adds a per-user availability model: recurring weekly hours,
one-off date-specific overrides, and time-off periods. It also ships an editor
page so users can manage their own schedule, plus server helpers that flatten
all of the above into concrete available time ranges for a date, month, or
arbitrary date range.

Use it instead of hand-rolling availability tables when you need a "when is
this user available?" calendar — most often as the data layer behind
[`SchedulingBlock`](./scheduling.md).

```ts
import { AvailabilityBlock } from "blocks/availability";
```

## Minimal Setup

`SchedulingBlock` already creates and registers `AvailabilityBlock` for you, and
throws if it finds a second instance. Add `AvailabilityBlock` yourself only for
standalone use (no scheduling block in the system):

```ts
import { AvailabilityBlock } from "blocks/availability";

system.addBlock(new AvailabilityBlock());
```

The constructor takes **no options**.

The block foreign-keys its availability records to `sys_users` and reads
`sys_users.timezone` when computing ranges, so an auth/users setup must already
exist.

## Configuration

`AvailabilityBlock` has no constructor options. All behavior is driven by the
tables it creates and the helper methods you call.

## Tables Created

All tables are prefixed `availability_` and skip sample-data generation (the
block seeds defaults itself in `afterGenerateSampleData`, calling
`addDefaultAvailability` for every `sys_users` row).

| Table | Purpose | Key columns |
| --- | --- | --- |
| `availability_days` | One row per weekday per user; toggles whether that day is available. | `day` (`day_of_week` enum), `sys_user_id` (fk `sys_users`), `enabled` (bool) |
| `availability_slots` | Recurring time windows within an available day. | `availability_day_id` (fk `availability_days`), `start_time` (time), `end_time` (time) |
| `availability_date_specific_slots` | One-off overrides for a specific calendar date. | `date`, `start_time`, `end_time`, `sys_user_id` (fk). Checks: `start_time <= end_time`; `date >= now()`. |
| `availability_time_off_periods` | Vacation / blocked ranges. | `title` (≤100), `start_date`, `end_date`, `notes` (≤255), `sys_user_id` (fk). Checks: `start_date <= end_date`; `start_date >= now()`. |

## Enum

`day_of_week` — values `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`.

It also defines the rule function `day_of_week_as_int`, mapping `sun` → 0 …
`sat` → 6. Call it in SQL as `fn.day_of_week_as_int(<day_of_week expr>)` (this
is how the range helpers join days to calendar dates via `date.part(dow, ...)`).

## Pages

### `AvailabilityBlock.AvailabilityPage`

Self-routing page where the current user edits their own schedule: time zone,
recurring weekly hours, date-specific overrides, and time-off periods. It also
registers an "Availability" entry in the navigation shared context, and renders
a "Preview your availability" button linking to `/availability-preview/<userId>`
(that route is provided by `SchedulingBlock.PreviewAvailabilityPage`).

Import and mount it inside an app's routes — do **not** wrap it in a `<Route>`
(it routes itself):

```tsx
import { AvailabilityBlock } from "blocks/availability";

<AvailabilityBlock.AvailabilityPage />;
```

The same component is also available as the named export `AvailabilityPage`.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | No | Route path and nav URL. Defaults to `/availability`. |

The page throws at generation time if `AvailabilityBlock` is not registered in
the system.

## Components

These section components are what `AvailabilityPage` composes. They are
importable individually via submodule paths if you want to lay out the editor
yourself. Each takes the relevant block table name(s) as string props and reads
the current user (`current_user`) internally.

```tsx
import { AvailabilitySection } from "blocks/availability/availability_section";
import { DateSpecificHoursSection } from "blocks/availability/date_specific_hours_section";
import { TimeOffSection } from "blocks/availability/time_off_section";
```

`AvailabilitySection` — recurring weekly hours editor (a `Form` over the days
table with add/remove time slots and overlap validation).

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `availabilityTable` | `string` | Yes | Days table, e.g. `"availability_days"`. |
| `availabilitySlotsTable` | `string` | Yes | Slots table, e.g. `"availability_slots"`. |

`DateSpecificHoursSection` — lists and adds one-off date overrides.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `dateSpecificSlotsTable` | `string` | Yes | Date-specific slots table, e.g. `"availability_date_specific_slots"`. |

`TimeOffSection` — lists and adds time-off periods.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `timeOffPeriodsTable` | `string` | Yes | Time-off table, e.g. `"availability_time_off_periods"`. |

## Server Helpers

Fetch the block instance with `system.block(AvailabilityBlock)` and call these
inside a statement builder `s`.

### `addDefaultAvailability(s, userId)`

Seeds default availability for a user: Mon–Fri enabled with 09:00–17:00 slots,
Sat/Sun disabled. Call it from a user-insert hook or a dev-DB pipeline.

```ts
import { AvailabilityBlock } from "blocks/availability";

system.block(AvailabilityBlock).addDefaultAvailability(s, sql`0`);
```

| Param | Type | Meaning |
| --- | --- | --- |
| `s` | statement builder | Statements scope. |
| `userId` | `NumericExpr` | `sys_users.id` to seed. |

### `getAvailabilityRangesForDateRange(s, opts)`

Computes concrete available ranges and writes them into a temp table named by
`opts.targetTable`. It merges recurring day slots with date-specific overrides:
for any date that has a date-specific override, the override replaces the
recurring hours. Recurring-day availability is dropped for any date that falls
inside a time-off period; date-specific overrides are **not** filtered by
time-off periods. Times are converted from each user's `sys_users.timezone` into
`userTimezone`.

| Option | Type | Meaning |
| --- | --- | --- |
| `query` | `Sql` | A query exposing a `date` column; the dates to compute ranges for. |
| `targetTable` | `string` | Name of the result temp table to define. |
| `userTimezone` | `Sql` | Target time zone the ranges are returned in. |
| `filterUserId` | `(userId: Sql) => Sql` | Given a user-id expression, return a boolean predicate scoping which users, e.g. `(id) => sql\`${id} = current_user\``. |

Result table columns: `sys_user_id`, `date`, `start_datetime`, `end_datetime`,
`start_hour`, `start_minute`, `end_hour`, `end_minute`. Only ranges with a
positive duration are kept; rows are ordered by `date`, then `start_datetime`.

### `getAvailabilityRangesForMonth(s, opts)`

Convenience wrapper over the date-range helper for a whole month (padded one day
on each side to cover time-zone spill).

| Option | Type | Meaning |
| --- | --- | --- |
| `month` | `Sql` | Any date within the target month. |
| `targetTable` | `string` | Result temp table name. |
| `userTimezone` | `Sql` | Target time zone. |
| `filterUserId` | `(userId: Sql) => Sql` | User-scope predicate. |

### `getAvailabilityRangesForDay(s, opts)`

Convenience wrapper for a single day (plus the adjacent days, for time-zone
spill).

| Option | Type | Meaning |
| --- | --- | --- |
| `date` | `Sql` | The target day. |
| `targetTable` | `string` | Result temp table name. |
| `userTimezone` | `Sql` | Target time zone. |
| `filterUserId` | `(userId: Sql) => Sql` | User-scope predicate. |

## Relationship to SchedulingBlock

`SchedulingBlock` constructs and registers `AvailabilityBlock` automatically,
sets its `definedByBlock`, and uses `getAvailabilityRangesForDay` /
`getAvailabilityRangesForMonth` to drive booking availability. The scheduling
block's `PreviewAvailabilityPage` serves the
`/availability-preview/{sys_user_id:id}` route that `AvailabilityPage` links to.

## Common Mistakes

- Registering `AvailabilityBlock` yourself **and** using `SchedulingBlock` —
  scheduling already registers it and throws on a duplicate. Add it manually
  only for standalone systems.
- Wrapping `AvailabilityBlock.AvailabilityPage` in a `<Route>`. It is
  self-routing; place it directly in the app's routes.
- Mounting `AvailabilityPage` without `AvailabilityBlock` registered — the page
  throws at generation time.
- Expecting the "Preview your availability" button to work without
  `SchedulingBlock` — that route comes from `SchedulingBlock.PreviewAvailabilityPage`.
- Passing a `query` to `getAvailabilityRangesForDateRange` that does not expose a
  `date` column — the helper joins on `date` and `date.part(dow, ...)`.
- Forgetting `addDefaultAvailability` for newly created users — without seeded
  days/slots a user has no recurring availability.
