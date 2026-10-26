---
title: Select Timezone
description: Specialized timezone picker with searchable region groups, a 12/24-hour toggle, and SQL-bound value for choosing IANA timezones.
tags:
  - ui
  - components
  - select
  - timezone
  - form
related:
  - ui/overview.md
  - ui/select.md
  - ui/data.md
  - ui/form.md
  - ui/styling.md
---

# Select Timezone

`SelectTimeZone` picks a `sys_timezone` enum value from curated zones grouped by
region, with search and each zone's current local time. Inside a `Form`, a
`sys_timezone` field renders it automatically via
[`FieldFormControl`](./field_form_control.md).

```tsx
import { SelectTimeZone } from "components/select_timezone";
```

```tsx
<Data
  local
  procedure={(s) => {
    s.defScalar("user_timezone", sql`date.part(timezone, now())`);
  }}
>
  <SelectTimeZone
    show24HourToggle
    size="sm"
    value={sql`user_timezone`}
    onChange={(s, newValue) => s.setScalar("user_timezone", newValue)}
  />
</Data>
```

## Value binding

- The component keeps its own internal `Data`; `value` is any SQL expression
  in scope that is castable to `sys_timezone`, and it is watched.
- `onChange` and `onInput` both fire on selection with `newValue` =
  `sql\`target_value\``, already typed as `enums.sys_timezone`.
- Normalization of `value` into `target_value`:
  - With `region`: kept if it is in that region's curated list, else replaced by
    the system timezone (`system.timezone`).
  - Without `region`: any non-null value is kept; one outside the curated list
    is appended under an inferred region (`Asia`, `America`, `Europe`,
    `Africa`, `Pacific`, `Atlantic`, `Australia`, `UTC`, or `Other`).
  - A null value becomes the system timezone unless `nullableLabel` is set,
    which also adds a "none" entry with that label.
- `onUnfilteredTimezoneChange(s, value)` fires when the resolved zone is not in
  the chosen region/curated list, e.g. to persist the clamped value.

## Non-obvious props

- `region: TimezoneRegion` restricts options to one region: `"US/Canada"`,
  `"America"`, `"Africa"`, `"Asia"`, `"Atlantic"`, `"Australia"`, `"UTC"`,
  `"Europe"`, `"Pacific"`, `"Other"`.
- `popoverPlacement` defaults to `"top"`.
- `label` (SQL) renders a `title-sm` label above the control; `compact` uses a
  compact label + time layout.
- `placeholder` defaults to `"Select timezone"`.

`variant` (default `outlined`), `color` (default `neutral`), and `size` (default
`md`) follow the shared
[styling props](./styling.md#color-variant-and-size). See
`SelectTimezonePropsNew` in `components/select_timezone` for the full contract.

## Helper exports

| Export | Use |
|--------|-----|
| `timezoneLongNameExpr(tz)` | Self-contained SQL `case` resolving a zone to its long name (e.g. `Eastern Standard Time`), falling back to the raw value. |
| `addTimezoneLongNameLookup(s)` | Declares a procedure-local `tz_long_names (tz_name, long_name)` table; use in a `Data` procedure when `timezoneLongNameExpr` exceeds expression nesting limits. |
| `compactTimeZoneDisplaySql(tz, unknownLabel = "Unknown")` | Compact `"Label, 1:23pm"` string with the zone's current local time. |
| `clampToRegion(tz, region)` | The zone if it belongs to `region`, else that region's default (as `sys_timezone`). |

```tsx
addTimezoneLongNameLookup(s);
const longName = sql`coalesce(
  (select long_name from tz_long_names where tz_name = cast(appointment.timezone as string)),
  cast(appointment.timezone as string)
)`;
```
