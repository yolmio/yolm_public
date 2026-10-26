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

`DailyLogBlock` adds a per-user daily work log (one note per user per day plus
optional accomplishment rows) with a user entry page and an admin review page.
It relates entries to the existing `sys_users` table; it does not define users.

## Minimal Setup

Register the block in `core.tsx`. It takes no constructor options.

```ts
import { DailyLogBlock } from "blocks/daily_log";

system.addBlock(new DailyLogBlock());
```

Then mount the pages in your app `.tsx` files:

```tsx
import { adminApp } from "apps/admin";
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

adminApp({
  domain: "admin.example.com",
  links: ["/daily-log"],
  routes: <DailyLogBlock.AdminPage path="/daily-log" />,
});
```

## Owned Tables

| Table                       | Purpose                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `daily_log_entries`         | The day's note; unique on `(sys_user_id, date)` (one entry per user per day). |
| `daily_log_accomplishments` | Optional accomplishment rows attached to an entry.                        |

The user page saves with `Form.Merge`, so re-saving the same day updates the
existing row.

## Pages

Both pages are **self-routing** (they wrap themselves in `<Route>`; do not wrap
them again) and take one optional `path` prop that defaults to `/daily_log`.
The static accessors and standalone exports are interchangeable.

| Component                                       | Purpose                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DailyLogBlock.UserPage` / `DailyLogUserPage`   | Current user fills in today's entry and accomplishments (auto-saves on blur) and browses past entries by date range. |
| `DailyLogBlock.AdminPage` / `DailyLogAdminPage` | Read-only review of all users' entries with date-range and per-employee filters.             |

Both standalone components are exported from `blocks/daily_log`.

## Gotchas

- Both pages default to `/daily_log`. When mounting both in one app, pass
  distinct `path` props.
