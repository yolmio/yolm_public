---
title: Daily Log Block
description: Per-user daily log with one row per user per day, accomplishments, and ready-made user entry plus admin review pages.
tags:
  - blocks
  - daily-log
  - notes
  - users
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# Daily Log Block

`DailyLogBlock` adds a per-user daily work log: each user gets at most one
`daily_log_entries` row per day with a free-form note plus an optional list of
accomplishment rows. It ships a self-routing user page (fill in today's entry,
auto-save on blur, browse past entries by date range) and a self-routing admin
page (review every user's entries with date-range and per-employee filtering).
Use it instead of hand-rolling the schema and forms for a journaling / daily
check-in feature.

The block relies on the system's `sys_users` table (provided by the auth /
system framework) for the per-user relation and display name.

```ts
import { DailyLogBlock } from "blocks/daily_log";
```

## Minimal Setup

Register the block in `core.tsx` so its tables are created:

```ts
import { DailyLogBlock } from "blocks/daily_log";

system.addBlock(new DailyLogBlock());
```

Then mount the pages inside your app `.tsx` files. The user-facing entry page in
an app's routes:

```tsx
import { DailyLogBlock } from "blocks/daily_log";
import { system } from "std/system";
import { AppRoutes } from "std/ui";

system.app({
  ui: (
    <AppRoutes>
      <DailyLogBlock.UserPage path="/daily-log" />
    </AppRoutes>
  ),
});
```

The admin review page, e.g. mounted in an admin app:

```tsx
import { adminApp } from "apps/admin";
import { DailyLogBlock } from "blocks/daily_log";

adminApp({
  domain: "admin.example.com",
  links: ["/daily-log"],
  routes: <DailyLogBlock.AdminPage path="/daily-log" />,
});
```

## Configuration

`DailyLogBlock` takes no constructor options — construct it with
`new DailyLogBlock()`. Its `blockName` is `"DailyLogBlock"`.

## Tables Created

| Table | Purpose | Key columns |
| --- | --- | --- |
| `daily_log_entries` | One row per `(user, date)` pair holding the day's note. | `sys_user_id` (fk to `sys_users`, not null), `date` (date, not null), `content` (string up to 5000, multiline). Unique on `(sys_user_id, date)`. |
| `daily_log_accomplishments` | Optional accomplishment rows attached to an entry. | `daily_log_entry_id` (fk to `daily_log_entries`), `content` (string up to 1000, multiline). |

The unique `(sys_user_id, date)` constraint enforces the
one-entry-per-user-per-day rule; the user page uses `Form.Merge` so re-saving
the same day updates the existing row.

## Pages

Both page components are **self-routing** — they wrap themselves in `<Route>`.
Do NOT wrap them in another `<Route>`.

### User page

Import either of the equivalent forms:

```tsx
import { DailyLogUserPage } from "blocks/daily_log";
// or use the static accessor: DailyLogBlock.UserPage
```

Lets the current user fill in today's log entry and its accomplishments
(auto-saving on blur) and browse their own past entries filtered by date range.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | No | Route path to mount on. Defaults to `/daily_log`. |

### Admin page

```tsx
import { DailyLogAdminPage } from "blocks/daily_log";
// or use the static accessor: DailyLogBlock.AdminPage
```

Reviews every user's daily log entries with a date-range filter and an optional
per-employee filter (selecting from `sys_users`). Read-only.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | No | Route path to mount on. Defaults to `/daily_log`. |

The static accessors `DailyLogBlock.UserPage` and `DailyLogBlock.AdminPage`
forward `path` to the standalone `DailyLogUserPage` / `DailyLogAdminPage`
components, so they are interchangeable.

## Common Mistakes

- Wrapping `DailyLogBlock.UserPage` / `DailyLogBlock.AdminPage` (or the
  standalone `DailyLogUserPage` / `DailyLogAdminPage`) in a `<Route>` — they
  are already self-routing.
- Mounting the user page and the admin page at the same default `/daily_log`
  path in one app. Both default to `/daily_log`; give them distinct explicit
  `path` props (e.g. `/daily-log`) or put them in separate apps.
- Passing options to the constructor — `DailyLogBlock` accepts none.
- Expecting the block to define users. It depends on the existing `sys_users`
  table for the per-user relation and `display_name_virtual`; register auth /
  system users before relying on these pages.
