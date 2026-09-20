---
title: Duration Types
description: Custom duration field types in Yolm for tracking time periods like minutes, hours, and days with built-in parsing and formatting.
tags:
  - database
  - duration
  - time
  - field-types
---

# Duration Types

Yolm provides specialized duration field types for storing and working with time periods. These types come with built-in parsing and formatting functions, making it easy to work with durations throughout your application.

## minutesDuration

Stores a duration as integer minutes, but provides user-friendly parsing and display.

### Definition

```typescript
db.table("deliveries", (table) => {
  table.minutesDuration("minutes", "BigInt").notNull();
  table.minutesDuration("admin_minutes", "BigInt").notNull();
  table.minutesDuration("own_time", "BigInt");
});
```

The first parameter is the field name, the second is the underlying integer type
(`"TinyUint"`, `"TinyInt"`, `"SmallUint"`, `"SmallInt"`, `"Uint"`, `"Int"`,
`"BigUint"`, or `"BigInt"`).

### Storage

Minutes are stored as raw integers in the database:

- `60` = 1 hour
- `90` = 1.5 hours
- `120` = 2 hours
- `1440` = 1 day (24 hours)

### Parsing User Input

Use `fn.parse_minutes_duration()` to convert colon-formatted strings to
minutes:

```sql
select fn.parse_minutes_duration('2:30');  -- 150
select fn.parse_minutes_duration('1:05');  -- 65
select fn.parse_minutes_duration('45');    -- 45
select fn.parse_minutes_duration('0:45');  -- 45
```

Supported formats:

- `"2:30"` - Hours and minutes
- `"0:45"` - Minutes with a zero hour component
- `"45"` - Plain minute count

### Formatting for Display

Use `fn.display_minutes_duration()` to format minutes for users:

```sql
select fn.display_minutes_duration(90);   -- "1:30"
select fn.display_minutes_duration(60);   -- "1:00"
select fn.display_minutes_duration(45);   -- "0:45"
select fn.display_minutes_duration(150);  -- "2:30"
select fn.display_minutes_duration(1440); -- "24:00"
```

### In Forms

When using Form components, duration fields automatically get parsing:

```tsx
<Form.Insert table="deliveries">
  <Form.Field field="minutes">
    <LabelOnTopFormField />
  </Form.Field>
</Form.Insert>
```

Users can type values like `"2:30"` or `"150"` and the generated duration
control will normalize the display value.

### In Queries

```sql
-- Sum total time across deliveries
select
  pc,
  fn.display_minutes_duration(sum(minutes + admin_minutes)) as total_time
from db.deliveries
group by pc;

-- Find sessions longer than 2 hours
select * from db.deliveries
where minutes > 120;

-- Calculate average session length
select fn.display_minutes_duration(cast(avg(minutes) as bigint)) as avg_session
from db.deliveries;
```

### Calculations

Since durations are stored as integers, arithmetic is straightforward:

```sql
-- Add durations
select minutes + admin_minutes as total_minutes
from db.deliveries;

-- Convert to hours
select (minutes + admin_minutes) / 60 as hours
from db.deliveries;

-- Convert to days
select (minutes + admin_minutes) / 1440 as days
from db.deliveries;

-- Average with rounding
select fn.display_minutes_duration(
  cast(round(cast(minutes as double) / 10) as bigint) * 10
) as rounded_minutes
from db.deliveries;
```

## Combined Duration Example

Use duration fields for multiple time measurements on the same table:

```typescript
db.table("deliveries", (table) => {
  table.fk("pc", "contacts").notNull().onDelete("Restrict");
  table.fk("auditors").notNull().onDelete("Restrict");
  table.enum("type", "delivery_type").notNull();
  table.date("date").notNull();
  table.minutesDuration("minutes", "BigInt").notNull();
  table.minutesDuration("admin_minutes", "BigInt").notNull();
  table.minutesDuration("own_time", "BigInt");
  table.bool("free").notNull();
  table.bool("manually_deducted").notNull();
});

db.table("calculation_starts", (table) => {
  table.date("date").notNull();
  table.minutesDuration("auditing_minutes", "BigInt").notNull();
  table.money("invoice_cost", "BigInt").notNull();
  table.minutesDuration("paid_handbook_minutes", "BigInt").notNull();
  table.minutesDuration("free_handbook_minutes", "BigInt").notNull();
  table.minutesDuration("grade_chart_minutes", "BigInt");
});
```

### Form with Auto-calculated Admin Time

```tsx
function AddDeliveriesForm() {
  function updateAdmin(s: DomStatements) {
    const cursor = useCursorHelper();
    const adminMinutes = cursor.field("admin_minutes");
    const minutes = cursor.field("minutes").value;
    const ownTime = cursor.field("own_time").value;

    // Calculate admin time as 10% of total (rounded)
    const minutesCombined =
      sql`coalesce(fn.parse_minutes_duration(${minutes}), 0) +
          coalesce(fn.parse_minutes_duration(${ownTime}) / 2, 0)`;

    s.if(
      sql`not ${adminMinutes.touched} or trim(${adminMinutes.value}) = ''`,
      (s) => {
        adminMinutes.setValue(
          s,
          sql`fn.display_minutes_duration(
            cast(round(cast(${minutesCombined} as double) / 10) as bigint)
          )`
        );
      }
    );
  }

  return (
    <Form.InsertMany table="deliveries">
      <FormCards>
        <FormCards.Card>
          <Form.Field field="pc" />
          <Form.Field field="type" />
          <Form.Field field="minutes">
            <LabelOnLeftFormField onChange={updateAdmin} />
          </Form.Field>
          <Form.Field field="own_time">
            <LabelOnLeftFormField onChange={updateAdmin} />
          </Form.Field>
          <Form.Field field="admin_minutes">
            <LabelOnLeftFormField />
          </Form.Field>
        </FormCards.Card>
      </FormCards>
    </Form.InsertMany>
  );
}
```

### Complex Aggregation Query

```sql
-- Weekly hours with complex business logic
select
  format.date(date.add(day, 6, daily.value), '%-m/%-d') as week_ending,
  coalesce(
    sum(
      case when fn.is_fes(type)
        then (minutes + admin_minutes) / 2  -- FES types are 50%
      else minutes + admin_minutes
      end
    ) + coalesce(sum(own_time), 0),
    0
  ) / 60 as hours
from series.daily(start_date, 12, -7) as daily
  left join db.deliveries
    on date between daily.value and date.add(day, 6, daily.value)
    and fn.should_count_for_total(type)
group by daily.value
order by daily.value;
```

### Report with Multiple Duration Calculations

```sql
select
  name,
  fn.display_minutes_duration(handbook) as handbook,
  fn.display_minutes_duration(intro) as intro,
  fn.display_minutes_duration(grade_chart) as grade_chart,
  fn.display_minutes_duration(own_time) as own_time,
  fn.display_minutes_duration(
    handbook + intro + own_time + grade_chart + fes / 2 + fes_grade_chart / 2
  ) as total
from (
  select
    auditor_id,
    sum(case when type = 'handbook' then minutes + admin_minutes else 0 end) as handbook,
    sum(case when type = 'intro' then minutes + admin_minutes else 0 end) as intro,
    sum(case when type = 'grade_chart' then minutes + admin_minutes else 0 end) as grade_chart,
    sum(case when type = 'fes' then minutes + admin_minutes else 0 end) as fes,
    sum(case when type = 'fes_grade_chart' then minutes + admin_minutes else 0 end) as fes_grade_chart,
    coalesce(sum(own_time), 0) as own_time
  from db.deliveries
  where date between start_date and end_date
  group by auditor_id
) join db.auditors on auditor_id = auditors.id
order by total desc;
```

## Other Duration Types

Yolm also has integer-backed `secondsDuration` and `hoursDuration` field
helpers:

### Seconds Duration

```typescript
db.table("jobs", (table) => {
  table.secondsDuration("runtime", "BigInt").notNull();
});
```

### Hours Duration

```typescript
db.table("leave_requests", (table) => {
  table.hoursDuration("duration", "Int").notNull();
});
```

The built-in parsing and display functions are currently specific to
`minutesDuration`. For seconds or hours, store and calculate using the raw
integer value, then format explicitly where you display it.

## Tips

1. **Store as smallest unit** - Minutes give you fine granularity
2. **Display for humans** - Always use `display_minutes_duration()` in UI
3. **Parse on input** - Use `parse_minutes_duration()` for form validation
4. **Arithmetic is easy** - Stored as integers, so math works naturally
5. **Use in calculations** - Sum, average, compare directly
6. **Convert units** - Divide by 60 for hours, 1440 for days

## Querying

Duration fields are stored as integers, so comparisons, sorting, and aggregate
calculations work directly on the stored value. Use the parsing and formatting
functions at the application boundary instead of repeatedly formatting values
inside aggregate calculations.
