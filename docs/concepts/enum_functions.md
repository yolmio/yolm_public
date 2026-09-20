---
title: Enum Functions
description: Advanced enum rule functions in Yolm - withRulesFn for value transformations and withBoolRulesFn for boolean classifications.
tags:
  - concepts
  - enums
  - functions
---

# Enum Functions

Yolm provides powerful rule functions that automatically generate SQL functions for enum logic, eliminating repetitive CASE statements and centralizing business rules.

## withBoolRulesFn - Boolean Classification

Create boolean functions that check if an enum value belongs to a category. This is ideal for categorizing enum values into logical groups.

### Basic Usage

```typescript
system.enum_({
  name: "delivery_type",
  values: [
    "intro",
    "grade_chart",
    "handbook",
    "specialist_handbook",
    "book_one",
    { name: "d_of_p", displayName: "D of P" },
    { name: "fes", displayName: "FES" },
    {
      name: "fes_grade_chart",
      displayName: "FES Grade Chart",
    },
    "purif",
    "apprentice_hatting",
    "extension_course",
  ],
  withBoolRulesFn: [
    {
      name: "should_deduct_from_intro",
      trues: ["intro", "fes", "book_one"],
    },
    {
      name: "should_deduct_from_grade_chart",
      trues: ["grade_chart", "fes_grade_chart"],
    },
    {
      name: "is_fes",
      trues: ["fes", "fes_grade_chart"],
    },
    {
      name: "is_bis",
      trues: [
        "intro",
        "grade_chart",
        "handbook",
        "specialist_handbook",
        "book_one",
        "d_of_p",
        "apprentice_hatting",
        "purif",
        "extension_course",
      ],
    },
    {
      name: "should_count_for_total",
      trues: [
        "intro",
        "grade_chart",
        "handbook",
        "specialist_handbook",
        "book_one",
        "fes",
        "fes_grade_chart",
        "apprentice_hatting",
      ],
    },
  ],
});
```

### Usage in SQL

```sql
-- Simple filtering
select * from db.deliveries where fn.is_fes(type);

-- Complex conditions
select * from db.deliveries
where fn.should_count_for_total(type) and not free;

-- In calculations
select
  sum(
    case when fn.is_fes(type)
      then (minutes + admin_minutes) / 2
    else minutes + admin_minutes
    end
  ) as total_minutes
from db.deliveries
where fn.should_count_for_total(type);

-- Combining multiple rules
select
  pc,
  count(*) filter (where fn.is_bis(type)) as bis_count,
  sum(minutes) filter (where fn.should_count_for_total(type)) as total_minutes
from db.deliveries
group by pc;
```

### Real-World Use Case

Instead of writing:

```sql
-- ❌ Repetitive and error-prone
select * from db.deliveries
where type in ('intro', 'grade_chart', 'handbook', 'specialist_handbook',
               'book_one', 'd_of_p', 'apprentice_hatting', 'purif',
               'extension_course');
```

Write:

```sql
-- ✅ Clear and maintainable
select * from db.deliveries where fn.is_bis(type);
```

Benefits:
- **Centralized logic** - Change the definition once, applies everywhere
- **Readable queries** - Business logic is self-documenting
- **Type-safe** - Typos caught at compile time
- **Consistency** - Uses the same generated rules everywhere

## withRulesFn - Value Transformation

Transform enum values into other values (integers, strings, or even other enums).

### Simple Value Mapping

```typescript
system.enum_({
  name: "server_region",
  values: ["us-miami", "us-los-angeles", "us-new-york", "us-tampa"],
  withRulesFn: [
    {
      name: "get_region_id",
      outputType: "Int",
      fields: [
        ["us-miami", 0],
        ["us-los-angeles", 1],
        ["us-new-york", 2],
        ["us-tampa", 3],
      ],
    },
  ],
});

// Usage
sql`select fn.get_region_id(region) from db.servers`;
// Returns integer IDs for each region
```

### Enum-to-Enum Transformation

Perfect for bidirectional relationships:

```typescript
system.enum_({
  name: "relation",
  values: [
    "parent",
    "child",
    "sibling",
    "spouse",
    "divorced",
    "grandparent",
    "grandchild",
    "step_parent",
    "step_child",
    "cousin",
    "other",
  ],
  withRulesFn: [
    {
      name: "invert_relation",
      outputType: { type: "Enum", enum: "relation" },
      fields: [
        ["parent", sql.lit`child`],
        ["child", sql.lit`parent`],
        ["sibling", sql.lit`sibling`],
        ["spouse", sql.lit`spouse`],
        ["divorced", sql.lit`divorced`],
        ["grandparent", sql.lit`grandchild`],
        ["grandchild", sql.lit`grandparent`],
        ["step_parent", sql.lit`step_child`],
        ["step_child", sql.lit`step_parent`],
        ["cousin", sql.lit`cousin`],
        ["other", sql.lit`other`],
      ],
    },
  ],
});
```

### Usage in Bidirectional Relationships

```sql
-- When creating a relationship from A to B, automatically create B to A
-- with the inverted relation
select fn.invert_relation('parent'::enums.relation);  -- Returns 'child'

-- In a trigger or procedure
insert into db.contact_relations (from_id, to_id, relation)
values
  (${fromId}, ${toId}, ${relation}),
  (${toId}, ${fromId}, fn.invert_relation(${relation}));
```

### Multiple Functions

Define multiple transformation functions for the same enum:

```typescript
system.enum_({
  name: "order_priority",
  values: ["low", "medium", "high", "urgent"],
  withRulesFn: [
    {
      name: "priority_score",
      outputType: "Int",
      fields: [
        ["low", 1],
        ["medium", 2],
        ["high", 3],
        ["urgent", 4],
      ],
    },
    {
      name: "priority_sla_hours",
      outputType: "Int",
      fields: [
        ["low", 72],
        ["medium", 24],
        ["high", 8],
        ["urgent", 2],
      ],
    },
    {
      name: "priority_color",
      outputType: "String",
      fields: [
        ["low", sql.lit`neutral`],
        ["medium", sql.lit`primary`],
        ["high", sql.lit`warning`],
        ["urgent", sql.lit`danger`],
      ],
    },
  ],
});
```

### Usage

```sql
-- Sorting by priority score
select * from db.orders
order by fn.priority_score(priority) desc;

-- Filtering by SLA
select * from db.orders
where created_at + interval '1 hour' * fn.priority_sla_hours(priority) < now();

-- Getting metadata for UI
select
  id,
  title,
  priority,
  fn.priority_color(priority) as color,
  fn.priority_sla_hours(priority) as sla_hours
from db.orders;
```

## Complex Real-World Example

Here's how a delivery tracking system uses enum functions to calculate hours with complex business logic:

```typescript
system.enum_({
  name: "delivery_type",
  values: [
    "intro",
    "grade_chart",
    "handbook",
    "specialist_handbook",
    "book_one",
    { name: "fes", displayName: "FES" },
    { name: "fes_grade_chart", displayName: "FES Grade Chart" },
    "purif",
    "apprentice_hatting",
  ],
  withBoolRulesFn: [
    {
      name: "should_deduct_from_intro",
      trues: ["intro", "fes", "book_one"],
    },
    {
      name: "should_deduct_from_grade_chart",
      trues: ["grade_chart", "fes_grade_chart"],
    },
    {
      name: "is_fes",
      trues: ["fes", "fes_grade_chart"],
    },
  ],
});
```

### Scalar Function Using Enum Rules

```typescript
db.scalarFunction({
  name: "remaining_intro_minutes",
  parameters: [
    {
      name: "contact",
      type: "BigInt",
      notNull: true,
    },
  ],
  returnType: "Int",
  procedure: (s) => {
    s.defScalar(
      "total_purchased",
      sql`
        (select sum(amount) from db.auditing_invoices
         where pc = input.contact and type = 'intro') * 750
      `
    );

    // Uses enum function to determine which deliveries count
    s.defScalar(
      "delivery_minutes",
      sql`
        (select sum(
          case
            when fn.is_fes(type)  -- Enum function!
              then (minutes + admin_minutes) / 2
            else minutes + admin_minutes
          end
        ) from db.deliveries
        where pc = input.contact and
          not manually_deducted and
          not free and
          fn.should_deduct_from_intro(type))  -- Enum function!
      `
    );

    s.return(sql`total_purchased - coalesce(delivery_minutes, 0)`);
  },
});
```

### Weekly Report Query

```sql
select
  format.date(date.add(day, 6, daily.value), '%-m/%-d') as week_ending,
  coalesce(
    sum(
      case when fn.is_fes(type)  -- 50% for FES types
        then (minutes + admin_minutes) / 2
      else minutes + admin_minutes
      end
    ),
    0
  ) / 60 as hours
from series.daily(start_date, 12, -7) as daily
  left join db.deliveries
    on date between daily.value and date.add(day, 6, daily.value)
    and fn.should_count_for_total(type)  -- Enum function!
group by daily.value
order by daily.value;
```

## Best Practices

1. **Use withBoolRulesFn for categories** - When you need to check if a value belongs to a group
2. **Use withRulesFn for mappings** - When you need to transform values
3. **Name functions descriptively** - `is_paid_type` not `check_type`
4. **Define rules once** - Centralize all business logic in enum definitions
5. **Document complex rules** - Add comments explaining the business rationale

## Unmapped Values and Defaults

`withRulesFn` `fields` need not cover every enum value. For any value not
listed, the function returns `NULL` unless you set `default`:

```typescript
withRulesFn: [
  {
    name: "priority_score",
    outputType: "Int",
    fields: [["high", 3], ["urgent", 4]],
    default: sql`0`, // returned for low/medium and any other value
  },
],
```

Wrap a `0` default in a `sql` expression (as above) so it is truthy: a bare
JavaScript `0` is falsy and is silently dropped, so the function falls back to
`NULL`. `withBoolRulesFn` does not need a
default — values outside `trues` default to `false` (and outside `falses` to
`true`) automatically.

## Performance

Enum functions centralize decision tables and compile into generated
SQL/procedure logic. Treat them like the equivalent hand-written expression:
they are usually straightforward, but hot query paths should still be checked
on representative data.

```sql
-- This enum function:
fn.is_fes(type)

-- Behaves like:
(type = 'fes' OR type = 'fes_grade_chart')
```
