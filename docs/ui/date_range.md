---
title: Date Range
description: "Date range pickers: DateRangeFilter renders paired date inputs, DateRangeCalendars renders side-by-side month calendars, both bound to SQL scalars."
tags:
  - ui
  - components
  - date
  - filter
  - calendar
related:
  - ui/overview.md
  - ui/data.md
  - ui/input.md
  - ui/form_control.md
  - ui/styling.md
---

# Date Range

`components/date_range` exports two start/end date pickers:

- **`DateRangeFilter`**: two `type="date"` inputs with fixed "Start Date" /
  "End Date" labels (each in a `FormControl`), for filter bars.
- **`DateRangeCalendars`**: two side-by-side month calendars with
  click-to-select, in-range highlighting, and hover preview.

```tsx
import { DateRangeFilter, DateRangeCalendars } from "components/date_range";
```

```tsx
<Data
  local
  procedure={(s) => {
    s.defScalar("start_date", sql`date.add(day, -30, current_date())`);
    s.defScalar("end_date", sql`current_date()`);
  }}
>
  <DateRangeFilter
    size="sm"
    startDate={sql`start_date`}
    endDate={sql`end_date`}
    onStartDateChange={(s, v) => s.setScalar("start_date", v)}
    onEndDateChange={(s, v) => s.setScalar("end_date", v)}
  />
</Data>
```

`DateRangeCalendars` takes the same four props (plus `sx` / `className`; it has
no `size`).

## Value binding

- Neither component declares state. Define nullable `Date` scalars in an
  enclosing `Data` (or other state) and write them from the callbacks.
- Callbacks receive `(s, newValue)`, where `newValue` is already a SQL `Date`
  expression; do not read `target_value`.
  - `DateRangeFilter` fires on every input event with
    `try_cast(<text> as date)`, which is `null` for empty or invalid input.
  - `DateRangeCalendars` passes the clicked `day.date`, or `null` when it clears
    the end date.

## Calendar selection

The calendars own month navigation and hover state. On a day click:

1. If both endpoints are set, the end is cleared (`null`) and the start becomes
   the clicked day.
2. Otherwise, if `startDate` is null or the clicked day is on or before it, the
   clicked day becomes the start.
3. Otherwise it becomes the end.

The left calendar shows the month of `startDate` (or today) with a "Previous
Month" control; the right shows the following month with "Next Month".

For `Params` filter forms, use `Params.DateRange` (`components/params`), which
wraps `DateRangeCalendars` in a labelled `FormControl` and declares the
`startName` / `endName` `Date` params for you.
