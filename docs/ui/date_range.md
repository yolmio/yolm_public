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

`components/date_range` exports two ways to pick a start/end date range:

- **`DateRangeFilter`** — a compact pair of `type="date"` inputs labelled "Start
  Date" / "End Date". Use it for filter bars and toolbars.
- **`DateRangeCalendars`** — two side-by-side month calendars with
  click-to-select range, in-range highlighting, and hover preview. Use it when
  you want a visual calendar picker.

Both bind their values to existing SQL `Date` scalars and report changes through
callbacks. Neither defines its own start/end scalars and neither is
self-routing — place them inside a context (typically a `Data` procedure) that
defines the bound scalars.

```tsx
import { DateRangeFilter, DateRangeCalendars } from "components/date_range";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
```

## How value binding works

Unlike a raw input, the change handlers do **not** receive `target_value`. Each
handler is called as `(s, newValue)` where `newValue` is a SQL `Date` expression
the component has already produced for you:

- `DateRangeFilter` parses the raw input with `try_cast(... as date)`, so
  `newValue` is a date or `null` (empty / invalid input).
- `DateRangeCalendars` passes the clicked `day.date`, or `sql\`null\`` when it
  clears the end date to start a new range.

Bind the scalars you pass to `startDate` / `endDate` and set them from the
callbacks (the second argument is the value to store). Because the callbacks can
hand back `null`, bind nullable `Date` scalars — the default `Date` scalar type
is nullable, as the examples below show.

## DateRangeFilter

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
    onStartDateChange={(s, newStartDate) => {
      s.setScalar("start_date", newStartDate);
    }}
    onEndDateChange={(s, newEndDate) => {
      s.setScalar("end_date", newEndDate);
    }}
  />
</Data>
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `startDate` | `Sql` | Yes | SQL expression for the current start date (usually a scalar ref). |
| `endDate` | `Sql` | Yes | SQL expression for the current end date. |
| `onStartDateChange` | `(s, newStartDate: Sql) => void` | Yes | Called when the start input changes. `newStartDate` is `try_cast(... as date)`, possibly `null`. |
| `onEndDateChange` | `(s, newEndDate: Sql) => void` | Yes | Called when the end input changes. `newEndDate` is `try_cast(... as date)`, possibly `null`. |
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | No | Size passed to the underlying date inputs. |

The handler `s` is a `DomStatements` builder. The "Start Date" / "End Date"
labels are fixed and not configurable. Each input is wrapped in a
`FormControl` / `FormLabel` and the two are laid out in a row.

## DateRangeCalendars

```tsx
<Data
  local
  procedure={(s) => {
    s.defScalar("start_date", sql`current_date()`);
    s.defScalar("end_date", sql`date.add(day, 14, current_date())`);
  }}
>
  <DateRangeCalendars
    startDate={sql`start_date`}
    endDate={sql`end_date`}
    onStartDateChange={(s, newStartDate) => {
      s.setScalar("start_date", newStartDate);
    }}
    onEndDateChange={(s, newEndDate) => {
      s.setScalar("end_date", newEndDate);
    }}
  />
</Data>
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `startDate` | `Sql` | Yes | SQL expression for the current start date. |
| `endDate` | `Sql` | Yes | SQL expression for the current end date. |
| `onStartDateChange` | `(s, newStartDate: Sql) => void` | Yes | Called to set the start date (with a `day.date` value or `null`). |
| `onEndDateChange` | `(s, newEndDate: Sql) => void` | Yes | Called to set the end date (with a `day.date` value or `null`). |
| `sx` | `Style` | No | Style overrides for the outer container. |
| `className` | `string` | No | Class name for the outer container. |

### Selection behavior

The component owns its month navigation and hover state internally — you only
supply the two endpoints. Clicking a day applies this logic:

- If both `startDate` and `endDate` are set, the click starts a new range: the
  end is cleared (`null`) and the start is set to the clicked day.
- Otherwise, if `startDate` is null, the click sets the start.
- Otherwise, if the clicked day is on or before `startDate`, it becomes the new
  start.
- Otherwise the clicked day becomes the end.

The left calendar shows the month derived from `startDate` (falling back to the
current date) and exposes a "Previous Month" control; the right calendar shows
the following month and exposes a "Next Month" control. Days strictly between
the endpoints render with in-range styling, and an in-progress range previews on
hover.

### Inside a Params form

`components/params` wraps `DateRangeCalendars` in a labelled `FormControl` via
`Params.DateRange`, binding to named scalar params (`startName` / `endName`)
instead of raw SQL. Reach for that helper when you are building a `Params`
filter form rather than wiring the scalars yourself.

## Common Mistakes

- Forgetting to define the `startDate` / `endDate` scalars in a surrounding
  `Data` (or other) context. Both components only read and write them — they do
  not create them.
- Reading `target_value` in the handlers. The change handlers receive the new
  date as their second argument (`(s, newValue) => ...`); use that, not
  `target_value`.
- Binding scalars that cannot hold `null`. The callbacks can pass `null`
  (cleared / invalid input), so bind nullable `Date` scalars.
- Expecting `size` on `DateRangeCalendars`. Only `DateRangeFilter` takes `size`;
  the calendars accept `sx` / `className` for styling instead.
- Wrapping these in a `<Route>` — they are plain components, not page
  templates, and are not self-routing.
