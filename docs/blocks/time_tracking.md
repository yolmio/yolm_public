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

`TimeTrackingBlock` creates an extensible clock-entry table and ships two UI
components — a compact clock in/out widget and a full time-tracking page with
recent entries and a weekly summary. You supply the queries, work
"dimensions" (what a user clocks into), and the write actions; the block owns
the schema and the UI. Use it instead of hand-rolling clock-in/out screens when
you need per-user time entries backed by your own records.

```ts
import {
  TimeClockWidget,
  TimeTrackingBlock,
  TimeTrackingPage,
  type TimeTrackingConfig,
} from "blocks/time_tracking";
```

## Minimal Setup

Register the block in `core.tsx`:

```ts
import { TimeTrackingBlock } from "blocks/time_tracking";

system.addBlock(new TimeTrackingBlock());
```

Then wire a `TimeTrackingConfig` and render the components inside an app. The
config below uses the block's built-in generic dimension fields
(`dimension_*`), so it is self-contained:

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
      icon: "Work",
      // Must select `label` and `detail`; include any columns `clockIn` reads.
      query: sql`select id, name as label, code as detail
                 from db.projects order by name`,
      emptyMessage: "No projects available",
      clockIn: (s, choice, ctx) => {
        s.modify(sql`insert into db.time_clock_entries
          (sys_user_id, dimension_key, dimension_record_id,
           dimension_label, dimension_detail, clock_in)
          values (${ctx.userIdExpr}, 'project', ${choice}.id,
            ${choice}.label, ${choice}.detail, current_timestamp())`);
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

// In a sidebar footer, route, or app body:
<TimeClockWidget {...timeTrackingConfig} />;
<TimeTrackingPage {...timeTrackingConfig} title="Time Tracking" />;
```

`TimeClockWidget` and `TimeTrackingPage` are plain components, not self-routing
pages. They do not wrap themselves in a `<Route>`, so mount them where you want
them: `TimeClockWidget` in a sidebar footer, and `TimeTrackingPage` inside your
own `<Route>` or layout to give it a path.

## Configuration

Constructor: `new TimeTrackingBlock(opts?: TimeTrackingBlockOptions)`.

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `tableName` | `string` | No | Name of the entry table to create. Default `"time_clock_entries"`. |
| `includeGenericDimensionFields` | `boolean` | No | Adds the `dimension_key` / `dimension_record_id` / `dimension_label` / `dimension_detail` columns. Default `true`. Set `false` if you model dimensions entirely through `extendEntryTable`. |
| `extendEntryTable` | `(table: TableBuilder) => void` | No | Callback to add your own columns, foreign keys, and checks to the entry table. |
| `longRunningNotifications` | `TimeTrackingLongRunningNotifications` | No | Background email and/or SMS reminders for open clock entries exceeding a configured threshold. |

## Tables Created

One table, named by `tableName` (default `time_clock_entries`):

| Column | Type | Notes |
| --- | --- | --- |
| `sys_user_id` | fk → `sys_users` | Not null. The user the entry belongs to. |
| `dimension_key` | string(80) | Only when `includeGenericDimensionFields` is on. |
| `dimension_record_id` | bigint | Only when `includeGenericDimensionFields` is on. |
| `dimension_label` | string(200) | Only when `includeGenericDimensionFields` is on. |
| `dimension_detail` | string(300) | Only when `includeGenericDimensionFields` is on. |
| `clock_in` | timestampUtc | Not null. |
| `clock_out` | timestampUtc | Null while an entry is active. |
| `notes` | string(500) | Optional free-form notes. |

Anything added via `extendEntryTable` is appended to this table. The block
defines no enums, reactors, APIs, or permissions of its own. Without
`longRunningNotifications`, it defines no scheduled jobs. It requires the
standard `sys_users` table to exist.

### Extending the table

```ts
new TimeTrackingBlock({
  extendEntryTable: (table) => {
    table.fk("workforce_person_id", "workforce_people").notNull();
    // `time_tracking_job_area` must be an enum your system defines; the block
    // does not provide it.
    table.enum("job_area", "time_tracking_job_area");
  },
});
```

## Long-running email and text notifications

Configure background reminders on the block constructor, independently of the
optional UI `longRunningWarning`. Omit either channel to disable it; omit the
whole option to keep background reminders disabled.

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

The example assumes an `employees` table with an email address and an E.164
text-capable phone number, linked by `sys_users.employee_id`. Each `to(entry)`
callback receives a SQL row reference to the configured entry table and should
return one recipient, or null to skip delivery. Each channel also accepts the
standard `mockProcedure` option for local/test service mocks.

The `${tableName}_long_running_notifications` job runs every minute and checks
up to 100 reachable pending entries per channel. The threshold must be a positive
integer of minutes. Delivery starts strictly after the threshold; closed entries
and dated-duration entries are excluded. The UI warning can still appear at the
threshold itself. A missing or blank contact skips that channel and remains
eligible if contact details are added later.

Enabling email adds nullable `long_running_email_sent_at`; enabling SMS adds
nullable `long_running_sms_sent_at` to the entry table. These are compatible
schema additions. Existing open entries already exceeding the threshold become
eligible on the next run. Successful sends are recorded separately, preventing
repeat sends on later runs; a failed channel retries independently. Each enabled
channel also adds nullable `long_running_${channel}_failure_count`,
`long_running_${channel}_retry_after`, and `long_running_${channel}_last_error`
fields, also compatible additions. Null failure counts mean zero failures.

A channel retries after 5 minutes following its first failure and after 10 minutes
following its second. After three failed attempts, automatic retries stop:
`failure_count = 3` with a null `sent_at` is the terminal failure outcome, and
`last_error` retains the reason. Entries waiting for a retry and entries that
exhausted their retries do not occupy the next 100-entry batch. A missing result
is treated as a failure. Missing contact details do not consume an attempt.
Successful delivery clears `retry_after` and `last_error`, preserving the failure
count for inspection. To recover an exhausted channel after correcting the
cause, an administrator can reset its failure count to zero and clear its retry
time and last error in a transaction; the entry must still be open and overdue.

Editing an entry does not reset its delivery or retry markers. A stable
per-entry/channel idempotency key is supplied to the delivery service, but
delivery across a crash between sending and recording success still depends on
the provider's idempotency support.

## Config Types

All of these are exported and shared by both components.

### `TimeTrackingConfig`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `userIdExpr` | `Sql` | Yes | SQL expression for the current user id (e.g. `sql\`current_user\``). Passed into every action via `ctx`. |
| `dimensions` | `TimeTrackingDimension[]` | Yes | The things a user can clock into. Rendered as the clock-in picker. |
| `queries` | `TimeTrackingQueries` | Yes | Read queries that feed the UI. See the query contract below. |
| `actions` | `TimeTrackingActions` | Yes | Write callbacks for clock-out, delete, and optional editing. |

### `TimeTrackingDimension`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `key` | `string` | Yes | Unique per dimension. Names the in-memory choice table the picker builds (`time_tracking_<key>_choices`). |
| `label` | `string` | Yes | Group heading shown in the picker. |
| `icon` | `IconName` | No | Material icon for the group. Default `"Work"`. |
| `query` | `Sql` | Yes | Selects the choices. Must select both `label` and `detail` columns (the picker reads both; `detail` may be `null` to hide the subtitle). Also include any columns your `clockIn` reads (e.g. `id`). |
| `emptyMessage` | `string` | No | Shown when the choice query returns no rows. Default `"No options available"`. |
| `clockIn` | `(s, choice, ctx) => void` | Yes | Inserts a new active entry. `choice` is an `Sql` ref to the selected choice row; `ctx.userIdExpr` is the user. |

### `TimeTrackingActions`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `closeActiveEntries` | `(s, ctx) => void` | Yes | Clocks out any currently-open entries before a new clock-in. |
| `clockOut` | `(s, entry, ctx) => void` | Yes | Clocks out the given entry. `entry` is an `Sql` ref to the entry row. |
| `deleteEntry` | `(s, entry, ctx) => void` | Yes | Deletes the given entry. |
| `saveEntry` | `(s, entry, clockIn, clockOut, notes, ctx) => void` | No | Full edit. `clockIn`, `clockOut`, and `notes` are `Sql` refs to the editor's UI scalars. Providing this enables the entry editor and the lock-column behavior (see below). |
| `saveNotes` | `(s, entry, notes, ctx) => void` | No | Notes-only edit. `notes` is an `Sql` ref to the editor scalar. Enables the editor without time editing. |

`ctx` is a `TimeTrackingActionContext` — `{ userIdExpr: Sql }`. The block wraps
each action invocation in its own transaction; do not open your own transaction
inside a callback.

### `TimeTrackingQueries` and the query contract

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `activeEntry` | `Sql` | Yes | The single open entry (loaded as a record). |
| `todayEntries` | `Sql` | Yes | The recent-entries list. |
| `weekEntries` | `(weekStart: Sql) => Sql` | Yes | Weekly rollup for the week starting `weekStart`. |

Each query must expose specific column aliases, because the components read them
by name:

| Query | Required aliases | Conditional aliases |
| --- | --- | --- |
| `activeEntry` | `id`, `title`, `subtitle`, `clock_in`, `elapsed_minutes` | `locked_by_pay_review` (only when `saveEntry` is provided) |
| `todayEntries` | `id`, `title`, `subtitle`, `clock_in`, `clock_out`, `minutes`, `notes` | `can_edit`, `lock_reason` (only when `saveEntry` is provided) |
| `weekEntries` | `entry_date`, `area_name`, `total_minutes` | — |

`elapsed_minutes`, `minutes`, and `total_minutes` are rendered as `Xh Ym`, so
return integer minute counts.

## Components

Both components take a `TimeTrackingConfig` (spread as props) plus a few extra
props. Both are imported from `blocks/time_tracking`. Neither is self-routing.

### `TimeClockWidget`

A compact widget (intended for a sidebar footer). Shows a clock-in button, the
active entry with a live-updating elapsed timer, and a dimension picker.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `...TimeTrackingConfig` | — | Yes | All `TimeTrackingConfig` fields. |
| `compactLabel` | `string` | No | Label for the clock-in button. Default `"Clock In"`. |

### `TimeTrackingPage`

A full page: active-clock card, recent entries (with delete and optional
edit), and a sticky weekly summary with week navigation.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `...TimeTrackingConfig` | — | Yes | All `TimeTrackingConfig` fields. |
| `title` | `string` | No | Page heading. Default `"Time"`. |
| `showSidebarTrigger` | `boolean` | No | Show a `Sidebar.Trigger` when a sidebar context is present. Default `true`. |

## Editing and lock columns

The editor UI is gated on which optional actions you provide:

- Neither `saveEntry` nor `saveNotes`: entries can only be deleted; no edit
  button is shown.
- `saveNotes` only: an inline notes editor appears.
- `saveEntry`: full inline editor (clock-in, clock-out, notes). This also
  switches the UI into "lock-aware" mode, where it reads `locked_by_pay_review`
  from `activeEntry` and `can_edit` / `lock_reason` from `todayEntries` to
  disable and explain locked rows. If you provide `saveEntry`, you must return
  those columns.

## Common Mistakes

- Omitting a required query alias. The components read `title`, `subtitle`,
  `minutes`, etc. by name; a missing alias breaks generation.
- Omitting `detail` from a dimension `query`. The picker reads `choice.detail`
  unconditionally, so every dimension query must select it (it may be `null`).
- Providing `saveEntry` without returning `locked_by_pay_review`, `can_edit`,
  and `lock_reason`. Full editing turns on lock-aware rendering that needs them.
- Opening a transaction inside an action callback. The block already wraps
  `closeActiveEntries` + `clockIn`, `clockOut`, `deleteEntry`, and the save
  actions in a transaction.
- Forgetting to scope writes by `ctx.userIdExpr`. Each user should only mutate
  their own entries.
- Assuming `TimeTrackingPage` self-routes. It does not wrap itself in a
  `<Route>`; mount it inside your own route or layout to give it a path.
- Reusing the same `dimension.key` for two dimensions; each key names the
  dimension's choice table and must be unique.
- Setting `includeGenericDimensionFields: false` but still inserting into the
  `dimension_*` columns from `clockIn` — those columns won't exist.
