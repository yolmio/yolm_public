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

`SelectTimeZone` is a dropdown specialized for picking an IANA timezone. It
groups a curated set of zones by region, supports type-to-search, shows the
current local time per zone, and optionally toggles between 12-hour and
24-hour display. Use it instead of a generic [Select](./select.md) whenever a
field stores a `sys_timezone` enum value.

```tsx
import { SelectTimeZone } from "components/select_timezone";
```

## Usage

`SelectTimeZone` manages its own internal `Data` state, so you only need to
place it. The `value` prop must be a SQL expression that resolves in the
surrounding scope (a scalar or a record field) and is castable to the
`sys_timezone` enum.

```tsx
import { SelectTimeZone } from "components/select_timezone";
import { Data } from "std/data";
import { sql } from "std/sql_utils";

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
    onChange={(s, newValue) => {
      s.setScalar("user_timezone", sql`${newValue}::enums.sys_timezone`);
    }}
  />
</Data>;
```

The selected value is exposed as `target_value` inside handlers; the second
handler argument (`newValue`) is `sql\`target_value\``. Cast it to the enum
when persisting.

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `Sql \| NumericExpr` | No | SQL expression for the current timezone. Watched for changes; cast to `sys_timezone` internally. |
| `onChange` | `(s, newValue: AnyExpr) => void` | No | Fires when an option is picked. `newValue` is `sql\`target_value\``. |
| `onInput` | `(s, newValue: AnyExpr) => void` | No | Same signature as `onChange`; also fires on selection. |
| `onUnfilteredTimezoneChange` | `(s, value: Sql) => void` | No | Fires when the resolved zone is not in the chosen region/curated list. Receives `sql\`target_value\``. |
| `region` | `TimezoneRegion` | No | Restricts options to one region's curated list (see below). Omit to show all regions. |
| `nullableLabel` | `string` | No | Adds a clearable "none" entry with this label and allows a null value instead of falling back to the system timezone. |
| `placeholder` | `string` | No | Empty-state text. Default `"Select timezone"`. |
| `label` | `Sql` | No | Renders a `title-sm` label above the control. |
| `compact` | `boolean` | No | Compact label + time layout. Default `false`. |
| `show24HourToggle` | `boolean` | No | Shows an am/pm vs 24h toggle in the popover. Default `false`. |
| `popoverPlacement` | `"top" \| "bottom"` | No | Whether the popover opens above or below the trigger. Default `"top"`. |
| `error` | `BooleanExpr` | No | SQL boolean expression that applies error styling. |
| `endDecorator` | `Node` | No | Custom node rendered at the trailing edge. |
| `fullWidth` | `boolean` | No | Stretch to container width. Default `false`. |
| `variant` | `"solid" \| "soft" \| "outlined" \| "plain"` | No | Generation-time style. Default `"outlined"`. |
| `color` | `Color` | No | Generation-time theme color. Default `"neutral"`. |
| `size` | `"xs" \| "sm" \| "md" \| "lg"` | No | Generation-time size. Default `"md"`. |

`variant`, `color`, and `size` are generation-time strings, not SQL
expressions. Pass styling via `sx` / `className`.

### Value resolution

The component normalizes `value` into its internal `target_value` scalar:

- With a `region` set: if `value` is in that region's curated list it is kept;
  otherwise it falls back to the system timezone (`system.timezone`). With
  `nullableLabel` set, a null `value` stays null (the "none" entry) instead of
  falling back.
- Without `region`: any non-null `value` is kept. If it is not already in the
  curated list, the component appends it under an inferred region (`Asia`,
  `America`, `Europe`, `Africa`, `Pacific`, `Atlantic`, `Australia`, `UTC`, or
  `Other`) so it still displays. A null `value` falls back to the system
  timezone unless `nullableLabel` is set.

## Regions

`region` accepts a `TimezoneRegion`:

```ts
import type { TimezoneRegion } from "components/select_timezone";
// "US/Canada" | "America" | "Africa" | "Asia" | "Atlantic"
// | "Australia" | "UTC" | "Europe" | "Pacific" | "Other"
```

## Helper exports

These SQL helpers ship from the same module for displaying or normalizing
stored timezone values.

| Export | Signature | Use |
|--------|-----------|-----|
| `timezoneLongNameExpr` | `(timezoneExpr: Sql) => AnyExpr` | SQL `case` expression resolving a timezone value to its long name (e.g. `Eastern Standard Time`). Self-contained; falls back to the raw value. |
| `addTimezoneLongNameLookup` | `<T>(s: T) => void` | Adds a procedure-local `tz_long_names` table. Use in a `Data` procedure when `timezoneLongNameExpr` exceeds expression nesting limits. |
| `compactTimeZoneDisplaySql` | `(timeZone: AnyExpr, unknownLabel = "Unknown") => Sql` | SQL producing a compact `"Label, 1:23pm"` display string with the zone's current local time. |
| `clampToRegion` | `(timezone: Sql, region: TimezoneRegion) => Sql` | Returns the timezone if it belongs to `region`, otherwise that region's default zone (cast to `sys_timezone`). |

```tsx
import {
  addTimezoneLongNameLookup,
  timezoneLongNameExpr,
} from "components/select_timezone";

// Inline expression:
const longName = timezoneLongNameExpr(sql`appointment.timezone`);

// Or, when nesting limits are hit, build a lookup table first:
addTimezoneLongNameLookup(s);
const longName2 = sql`coalesce(
  (select long_name from tz_long_names where tz_name = cast(appointment.timezone as string)),
  cast(appointment.timezone as string)
)`;
```

## Common Mistakes

- Treating `variant` / `color` / `size` as SQL — they are generation-time
  strings. Use `Show` / `Switch` for runtime-conditional styling.
- Forgetting to cast on persist. `onChange` / `onInput` give you
  `target_value`; cast with `::enums.sys_timezone` when writing it back.
- Expecting a null value without `nullableLabel`. Without it, a null `value`
  (or a value outside the chosen `region`) falls back to the system timezone
  instead of clearing.
- Wrapping the component in your own `Data` solely for its state — it already
  manages internal `Data`. You still must ensure `value` resolves in the
  parent scope.
