---
title: Enums
description: How to define and use enums in Yolm for type-safe status values, categories, and other fixed sets of values.
tags:
  - concepts
  - enums
  - types
  - database
---

# Enums

Enums define a fixed set of values that can be used in database fields and throughout your application.

## Defining Enums

Enums can be defined using `system.enum_()` with either simple arrays or detailed object configurations:

### Simple Array Syntax

```typescript
system.enum_({
  name: "order_status",
  values: ["pending", "processing", "shipped", "delivered", "cancelled"],
});

system.enum_({
  name: "priority",
  values: ["low", "medium", "high", "urgent"],
});
```

### Object Syntax with Properties

Add metadata like colors, descriptions, and display names:

```typescript
system.enum_({
  name: "order_status",
  values: [
    { name: "pending", color: "#FFA500" },
    { name: "processing", color: "#0000FF" },
    { name: "shipped", color: "#00FF00" },
    { name: "delivered", color: "#008000" },
    { name: "cancelled", color: "#FF0000" },
  ],
});

system.enum_({
  name: "priority",
  values: [
    { name: "low", displayName: "Low Priority" },
    { name: "medium", displayName: "Medium Priority" },
    { name: "high", displayName: "High Priority" },
    { name: "urgent", displayName: "Urgent - Immediate Action Required" },
  ],
});
```

### Renaming Enum Values

When you need to rename an enum value in production, use `renameFrom` to migrate existing data:

```typescript
system.enum_({
  name: "scheduling_appointment_email_status",
  values: [
    "pending",
    { name: "failed_confirmation", renameFrom: "failed" },
    "failed_reminder",
    "sent",
  ],
});
```

This pattern:
1. Creates a new enum value `failed_confirmation`
2. Automatically migrates all existing `failed` values to `failed_confirmation`
3. Prevents breaking changes in deployed systems
4. Works seamlessly with database migrations

**Important**: The `renameFrom` value must be the old enum value name. All records with the old value will be automatically updated.

### Enum with Colors for UI

Colors can be used directly in UI components:

```typescript
system.enum_({
  name: "order_status",
  values: [
    { name: "completed", color: colors.green[500] },
    { name: "cancelled", color: colors.red[500] },
    { name: "pending", color: colors.yellow[500] },
    { name: "processing", color: colors.blue[500] },
  ],
});
```

## Using in Tables

```typescript
db.table("orders", (table) => {
  table.fk("customer_id", "customers").notNull();
  table.enum("status", "order_status").notNull();
  table.enum("priority", "priority");
});
```

## Enum Values in SQL

Use the `::enums.enum_name` cast syntax to specify enum values:

### Static Values (Hardcoded Strings)

When the enum value is known at generation time, use a string literal with cast:

```typescript
sql`'pending'::enums.order_status`
sql`'high'::enums.priority`
```

### Dynamic Values (TypeScript Variables)

When the value comes from a TypeScript variable, use `sql.lit()`:

```typescript
const status = "pending";
sql`${sql.lit(status)}::enums.order_status`

// Or with template literal
sql`${sql.lit`pending`}::enums.order_status`
```

### In Queries

```typescript
// Static value
sql`select * from db.orders where status = 'pending'::enums.order_status`

// Dynamic value from TypeScript
const newStatus = "shipped";
sql`
  update db.orders
  set status = ${sql.lit(newStatus)}::enums.order_status
  where id = ${orderId}
`
```

### Comparing Values

```typescript
sql`status = 'pending'::enums.order_status`
sql`priority in ('high'::enums.priority, 'urgent'::enums.priority)`
```

## UI Components

### EnumSelect

Display a dropdown for enum selection:

```tsx
import { EnumSelect } from "components/enum_select";

<EnumSelect
  enum="order_status"
  value={sql`order.status`}
  onChange={(s, newValue) => {
    s.setScalar("selected_status", newValue);
  }}
/>
```

### Displaying Enum Values

```tsx
<Data procedure={(s) => {
  s.defRecord("order", sql`select * from db.orders where id = ${orderId}`);
}}>
  {/* Raw value */}
  {sql`order.status`}

  {/* Display name (using the enum's display function) */}
  {sql`fn.display_order_status(order.status)`}
</Data>
```

### In Form Components

```tsx
import { Form } from "std/form";

<Form.Insert table="orders">
  <Form.Field field="status">
    <EnumSelect enum="order_status" />
  </Form.Field>
</Form.Insert>
```

## Enum with Additional Properties

```typescript
system.enum_({
  name: "ticket_priority",
  values: [
    { name: "low", displayName: "Low", color: "neutral" },
    { name: "medium", displayName: "Medium", color: "primary" },
    { name: "high", displayName: "High", color: "warning" },
    { name: "critical", displayName: "Critical", color: "danger" },
  ],
});

// Access in TypeScript (generation time)
const priorities = system.enums["ticket_priority"];
Object.entries(priorities.values).forEach(([key, info]) => {
  console.log(`${key}: ${info.displayName}, ${info.color}`);
});
```

## Dynamic Enum Rendering

```tsx
function PriorityBadge(props: { priority: Sql }) {
  return (
    <Switch>
      <Match when={sql`${props.priority} = 'low'::enums.priority`}>
        <Chip color="neutral">Low</Chip>
      </Match>
      <Match when={sql`${props.priority} = 'medium'::enums.priority`}>
        <Chip color="primary">Medium</Chip>
      </Match>
      <Match when={sql`${props.priority} = 'high'::enums.priority`}>
        <Chip color="warning">High</Chip>
      </Match>
      <Match when={sql`${props.priority} = 'urgent'::enums.priority`}>
        <Chip color="danger">Urgent</Chip>
      </Match>
    </Switch>
  );
}
```

## System Enums

Yolm provides built-in system enums:

```typescript
// sys_state_status - Status of State components
// Values: received, requested, delayed, fallback_triggered, failed, disallowed

// sys_timezone - All IANA time zones
// Values: 'America/New_York', 'Europe/London', etc.

// sys_error_type - Error types
// Values: various error type identifiers
```

## Iterating Enum Values

At generation time (TypeScript):

```tsx
function StatusFilter() {
  const statusEnum = system.enums["order_status"];

  return (
    <div className="flex gap-2">
      {Object.entries(statusEnum.values).map(([value, info]) => (
        <ChipButton
          label={info.displayName}
          bindScalar={`filter_${value}`}
        />
      ))}
    </div>
  );
}
```

## Best Practices

1. **Use descriptive names** - `order_status` not `status`
2. **Include displayName** - For user-friendly UI rendering
3. **Use snake_case for values** - `in_progress` not `inProgress`
4. **Add metadata** when useful - Colors, sort orders, etc.
5. **Keep enums immutable** - Once deployed, don't remove values (add new ones instead)

## Enum Rules Functions

Enums can include generated SQL helper functions for enum logic:

```typescript
system.enum_({
  name: "order_priority",
  values: ["low", "medium", "high", "urgent"],
  withBoolRulesFn: [
    {
      name: "needs_attention",
      trues: ["high", "urgent"],
    },
  ],
});

sql`
  select *
  from db.orders
  where fn.needs_attention(priority)
`
```

Use `withRulesFn` for value mappings and `withBoolRulesFn` for boolean
classifications. See [Enum Functions](./enum_functions.md) for detailed
examples.

## Example: Complete Status Workflow

```typescript
// Define the enum
system.enum_({
  name: "task_status",
  values: [
    { name: "backlog", displayName: "Backlog" },
    { name: "todo", displayName: "To Do" },
    { name: "in_progress", displayName: "In Progress" },
    { name: "review", displayName: "In Review" },
    { name: "done", displayName: "Done" },
  ],
});

// Use in table
db.table("tasks", (table) => {
  table.string("title", 200).notNull();
  table.enum("status", "task_status").notNull();
});

// Update status in procedure
s.modify(sql`
  update db.tasks
  set status = 'in_progress'::enums.task_status
  where id = ${taskId}
`);

// Query by status
sql`
  select * from db.tasks
  where status = 'todo'::enums.task_status
  order by title
`
```
