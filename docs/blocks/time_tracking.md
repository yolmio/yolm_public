---
title: Time Tracking Block
description: Reusable time-tracking UI plus an extensible clock-entry table with injectable work dimensions, a clock in/out widget, and a weekly summary page.
tags:
  - blocks
  - time-tracking
  - ui
  - schema
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
  - blocks/workforce.md
---

# Time Tracking Block

`TimeTrackingBlock` owns an extensible per-user time-entry table and ships a
clock in/out widget and a time-tracking page with recent entries and a weekly
summary. You supply the work "dimensions" users clock into, the read queries,
and the write actions.

## Minimal Setup

Register the block in `core.tsx`, then render the components with a
`TimeTrackingConfig`. This config uses the built-in `dimension_*` fields:

```tsx
import { TimeTrackingBlock } from "blocks/time_tracking";

system.addBlock(new TimeTrackingBlock());
```

```tsx
import {
  TimeClockWidget,
  TimeTrackingPage,
  type TimeTrackingConfig,
} from "blocks/time_tracking";
import { sql } from "std/sql_utils";

const userId = sql`current_user`;

const timeTrackingConfig: TimeTrackingConfig = {
  userIdExpr: userId,
  dimensions: [
    {
      key: "project",
      label: "Project",
      // Must select `id`, `label`, and `detail` (`detail` may be null).
      query: sql`select id, name as label, code as detail
                 from db.projects order by name`,
      clockIn: (s, choice, _activity, ctx) => {
        s.modify(sql`insert into db.time_clock_entries
          (sys_user_id, dimension_key, dimension_record_id,
           dimension_label, dimension_detail, clock_in)
          values (${ctx.userIdExpr}, 'project', ${choice.id},
            ${choice.label}, ${choice.detail}, current_timestamp())`);
      },
    },
  ],
  queries: {
    activeEntry: sql`
      select id, dimension_label as title, dimension_detail as subtitle,
        clock_in,
        date.diff(minute, clock_in, current_timestamp()) as elapsed_minutes
      from db.time_clock_entries
      where sys_user_id = ${userId} and clock_out is null
      order by clock_in desc limit 1`,
    todayEntries: sql`
      select id, clock_in, clock_out, notes,
        dimension_label as title, dimension_detail as subtitle,
        date.diff(minute, clock_in,
          coalesce(clock_out, current_timestamp())) as minutes
      from db.time_clock_entries
      where sys_user_id = ${userId} and cast(clock_in as date) = current_date()
      order by clock_in desc`,
    weekEntries: (weekStart) => sql`
      select cast(clock_in as date) as entry_date,
        dimension_label as area_name,
        sum(date.diff(minute, clock_in,
          coalesce(clock_out, current_timestamp()))) as total_minutes
      from db.time_clock_entries
      where sys_user_id = ${userId}
        and cast(clock_in as date) >= ${weekStart}
        and cast(clock_in as date) < date.add(day, 7, ${weekStart})
      group by entry_date, area_name
      order by entry_date`,
  },
  actions: {
    closeActiveEntries: (s, ctx) =>
      s.modify(sql`update db.time_clock_entries
        set clock_out = current_timestamp()
        where sys_user_id = ${ctx.userIdExpr} and clock_out is null`),
    clockOut: (s, entry, ctx) =>
      s.modify(sql`update db.time_clock_entries
        set clock_out = current_timestamp()
        where id = ${entry}.id and sys_user_id = ${ctx.userIdExpr}`),
    deleteEntry: (s, entry, ctx) =>
      s.modify(sql`delete from db.time_clock_entries
        where id = ${entry}.id and sys_user_id = ${ctx.userIdExpr}`),
  },
};

// Neither component is self-routing; mount the page inside your own route.
<TimeClockWidget {...timeTrackingConfig} />;
<TimeTrackingPage {...timeTrackingConfig} title="Time Tracking" />;
```

## Configuration

`new TimeTrackingBlock(opts?: TimeTrackingBlockOptions)`:

| Option | Default | Meaning |
| --- | --- | --- |
| `tableName` | `"time_clock_entries"` | Entry table name. |
| `includeGenericDimensionFields` | `true` | Adds `dimension_key`, `dimension_record_id`, `dimension_label`, and `dimension_detail`. Set `false` to model dimensions only through `extendEntryTable`. |
| `extendEntryTable` | — | `(table: TableBuilder) => void` adding system columns, foreign keys, and checks. |
| `longRunningNotifications` | — | Background email/SMS reminders for long-open entries. See below. |

## Tables

One table, `time_clock_entries` (or `tableName`): per-user time entries keyed
by `sys_user_id` (requires `sys_users`). A check constraint requires each row
to be **either** a clock interval (`clock_in` set, `clock_out` null while
active or `>= clock_in`) **or** a dated duration (`duration_date` plus positive
`duration_minutes`, no clock times). The block defines no enums, APIs, or
permissions, and no scheduled job unless `longRunningNotifications` is set.

```ts
new TimeTrackingBlock({
  extendEntryTable: (table) => {
    table.fk("workforce_person_id", "workforce_people").notNull();
    // The system must define this enum; the block does not.
    table.enum("job_area", "time_tracking_job_area");
  },
});
```

## Long-Running Notifications

Independent of the UI's `longRunningWarning`. Omit a channel to disable it.

```ts
new TimeTrackingBlock({
  longRunningNotifications: {
    thresholdMinutes: 8 * 60,
    message: "You have been clocked in for over 8 hours. Review your time entry.",
    email: {
      from: "notifications@example.com",
      subject: "Review your time entry",
      to: (entry) => sql`(select email from db.employees
        where id = (select employee_id from db.sys_users
          where id = ${entry}.sys_user_id))`,
    },
    sms: {
      from: "+15555550100",
      to: (entry) => sql`(select phone from db.employees
        where id = (select employee_id from db.sys_users
          where id = ${entry}.sys_user_id))`,
    },
  },
});
```

- `to(entry)` receives a row reference to the entry table and returns one
  recipient (SMS: E.164), or null to skip. Each channel accepts
  `mockProcedure`. `thresholdMinutes` must be a positive integer.
- The `${tableName}_long_running_notifications` job runs every minute and
  takes up to 100 pending entries per channel. Only open clock entries strictly
  past the threshold qualify; existing overdue entries qualify on the next run.
  A blank contact skips the entry without consuming an attempt.
- Each enabled channel adds nullable `long_running_<channel>_sent_at`,
  `_failure_count`, `_retry_after`, and `_last_error` columns (compatible
  additions; null count means zero). A set `sent_at` prevents resends.
- Failed or missing delivery results retry after 5 and then 10 minutes. After
  three failures, `failure_count = 3` with null `sent_at` is terminal and
  `last_error` keeps the reason; waiting or exhausted entries do not occupy the
  batch. Success clears `retry_after` and `last_error` but keeps the count. To
  retry an exhausted open entry, reset the count to zero and clear
  `retry_after` and `last_error` in a transaction.
- Editing an entry does not reset markers. A stable per-entry/channel
  idempotency key is sent, but crash-safety between send and record depends on
  the provider.

## Config Types

Types are exported from `blocks/time_tracking`; see `TimeTrackingConfig`,
`TimeTrackingDimension`, `TimeTrackingActions`, and `TimeTrackingQueries` in
`packages/blocks/time_tracking/index.tsx`.

- `TimeTrackingConfig`: `userIdExpr`, `dimensions`, `queries`, `actions`, and
  optional `longRunningWarning: { thresholdMinutes, message }`, which shows an
  in-UI warning once the active entry reaches the threshold.
- `TimeTrackingDimension.key` must be unique; it names the picker's choice
  table `time_tracking_<key>_choices`. `query` must select `id`, `label`, and
  `detail`. `searchable` adds label/detail search. With `activityOptions`, the
  user picks an activity after the choice and `clockIn(s, choice, activity,
  ctx)` receives it; otherwise `activity` is `undefined`.
- Every action callback runs inside a block-opened transaction
  (`closeActiveEntries` then `clockIn` share one); do not start your own.
  `entry` is an `Sql` ref to the entry row. Scope writes by `ctx.userIdExpr`.
- `saveNotes(s, entry, notes, ctx)` enables a notes-only editor.
  `saveEntry(s, entry, clockIn, clockOut, notes, ctx)` enables full editing;
  the block passes the edited times already converted to timestamps in the
  server timezone (the exported `editedClockTimestampExpr(raw)` does this for
  custom editors). With neither, entries can only be deleted.

Each query must expose these aliases; minute values must be integers (rendered
as `Xh Ym`).

| Query | Required aliases | Required only with `saveEntry` |
| --- | --- | --- |
| `activeEntry` | `id`, `title`, `subtitle`, `clock_in`, `elapsed_minutes` | `locked_by_pay_review` |
| `todayEntries` | `id`, `title`, `subtitle`, `clock_in`, `clock_out`, `minutes`, `notes` | `can_edit`, `lock_reason` |
| `weekEntries(weekStart)` | `entry_date`, `area_name`, `total_minutes` | — |

## Components

| Export | Extra props | Purpose |
| --- | --- | --- |
| `TimeClockWidget` | `compactLabel` (default `"Clock In"`) | Compact clock-in button, live elapsed timer, and dimension picker, e.g. for a sidebar footer. |
| `TimeTrackingPage` | `title` (default `"Time"`), `showSidebarTrigger` (default `true`) | Active-clock card, recent entries with delete/edit, and weekly summary with week navigation. |

Both take a spread `TimeTrackingConfig` and are not self-routing.

## Gotchas

- Setting `includeGenericDimensionFields: false` removes the `dimension_*`
  columns; `clockIn` and queries must not reference them.
