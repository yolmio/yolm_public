---
title: Scalar Functions
description: How to define custom scalar functions in Yolm for reusable SQL logic that returns a single value.
tags:
  - database
  - functions
  - sql
  - reusability
---

# Scalar Functions

Scalar functions are user-defined SQL functions that return a single value. They're useful for encapsulating reusable logic that can be called from SQL queries.

Use `system.db.scalarFunction(...)` when the function reads database tables.
Use `system.scalarFunction(...)` for pure functions that do not access the
database.

## Basic Definition

```typescript
system.db.scalarFunction({
  name: "calculate_discount",
  returnType: { type: "Decimal", precision: 10, scale: 2, signed: true },
  parameters: [
    {
      name: "price",
      type: { type: "Decimal", precision: 10, scale: 2, signed: true },
    },
    { name: "discount_pct", type: "Int" },
  ],
  procedure: (s) => {
    s.return(sql`input.price * (100 - input.discount_pct) / 100`);
  },
});
```

Usage in SQL:

```typescript
sql`select fn.calculate_discount(product.price, 10) as discounted_price from db.products product`
```

## Parameter Types

Scalar-function parameters support Yolm field types, including `String`,
numeric types, dates/times, enums, JSON, bytes, and foreign keys:

```typescript
system.db.scalarFunction({
  name: "format_phone",
  returnType: "String",
  parameters: [
    { name: "phone", type: "String" },
    { name: "country_code", type: "String" },
  ],
  procedure: (s) => {
    s.return(sql`'+' || input.country_code || ' ' || input.phone`);
  },
});
```

## Accessing Parameters

Function parameters are available via the `input` record:

```typescript
system.db.scalarFunction({
  name: "create_scheduling_url",
  returnType: "String",
  parameters: [
    { name: "external_event_type_id", type: "BigInt" },
    { name: "campaign_id", type: "BigInt" },
  ],
  procedure: (s) => {
    // Access parameters via input.parameter_name
    s.defRecord(
      "event_type",
      sql`select * from db.external_event_types where id = input.external_event_type_id`
    );
    s.defRecord(
      "campaign",
      sql`select * from db.email_campaigns where id = input.campaign_id`
    );

    s.return(
      sql.concat(
        sql`event_type.scheduling_url`,
        sql`'?campaign_id=' || input.campaign_id`
      )
    );
  },
});
```

## Complex Business Logic

Scalar functions can contain complex logic with conditionals and queries:

```typescript
system.db.scalarFunction({
  name: "get_user_status",
  returnType: "String",
  parameters: [{ name: "user_id", type: "BigInt" }],
  procedure: (s) => {
    s.defRecord("user", sql`select * from db.users where id = input.user_id`);

    s.if(sql`user.id is null`, (s) => {
      s.return(sql.lit`unknown`);
    });

    s.defScalar(
      "order_count",
      sql`(select count(*) from db.orders where user_id = input.user_id)`
    );

    s.if(sql`order_count > 10`, (s) => {
      s.return(sql.lit`premium`);
    });

    s.if(sql`order_count > 0`, (s) => {
      s.return(sql.lit`active`);
    });

    s.return(sql.lit`new`);
  },
});
```

## URL Generation Example

A scalar function can build a URL from database records and query parameters:

```typescript
import { queryParamsString } from "std/services";

system.db.scalarFunction({
  name: "create_scheduling_url",
  returnType: "String",
  parameters: [
    { name: "external_event_type_id", type: "BigInt" },
    { name: "campaign_id", type: "BigInt" },
  ],
  procedure: (s) => {
    s.defRecord(
      "event_type",
      sql`select * from db.external_event_types where id = input.external_event_type_id`
    );
    s.defRecord(
      "campaign",
      sql`select * from db.email_campaigns where id = input.campaign_id`
    );

    // Build URL with query parameters
    s.return(
      sql.concat(
        sql`event_type.scheduling_url`,
        sql`case
          when event_type.scheduling_url like '%?' then ''
          when contains(event_type.scheduling_url, '?') then '&'
          else '?'
        end`,
        queryParamsString({
          utm_source: sql`
            case
              when contains(event_type.scheduling_url, 'utm_source') then null
              else coalesce(
                event_type.utm_source,
                'yolm_' || input.campaign_id
              )
            end`,
          utm_content: sql`
            case
              when contains(event_type.scheduling_url, 'utm_content') then null
              else event_type.utm_content
            end`,
          utm_campaign: sql.concat("y_", sql`input.campaign_id`),
        })
      )
    );
  },
});
```

Usage in email campaign variables:

```typescript
{
  scheduling_link: {
    description: "Scheduling link",
    expr: (_, campaignVars, campaignRecord) =>
      sql`fn.create_scheduling_url(${campaignVars}.external_event_type_id, ${campaignRecord}.campaign_id)`,
  }
}
```

## Calling Functions

### In SQL Queries

```typescript
// Simple call
sql`select fn.calculate_discount(100, 15)`  // Returns 85

// In WHERE clause
sql`select * from db.products where fn.calculate_discount(price, 10) < 50`

// In expressions
sql`'Discounted: $' || fn.calculate_discount(price, discount_pct)`
```

### In Data Procedures

```typescript
<Data procedure={(s) => {
  s.defScalar("discounted_price", sql`fn.calculate_discount(product_price, 20)`);
}}>
  {/* children can use sql`discounted_price` */}
</Data>
```

### In Variable Definitions

```typescript
const campaignVariables = {
  scheduling_link: {
    description: "Scheduling link with tracking",
    expr: (recipientRecord, campaignVars, campaignRecord) =>
      sql`fn.create_scheduling_url(
        ${campaignVars}.event_type_id,
        ${campaignRecord}.campaign_id
      )`,
  },
};
```

## Return Types

Scalar functions return scalar types. Use the shorthand string form for simple
types, or an object for decimals and enums:

```typescript
// String
returnType: "String"

// Decimal with precision
returnType: { type: "Decimal", precision: 10, scale: 2, signed: true }

// BigInt
returnType: "BigInt"

// Bool
returnType: "Bool"

// Date
returnType: "Date"

// Timestamp
returnType: "Timestamp"

// Enum
returnType: { type: "Enum", enum: "order_status" }
```

## State Changes

Scalar functions must declare a `returnType` and return a single value. Do not
use them for side effects such as inserting audit rows or updating records.

Put state-changing logic in a stored procedure, API endpoint, scheduled job, or
reactor instead:

```typescript
system.storedProcedure({
  name: "log_event",
  inputScalars: [
    { name: "event_type", type: "String" },
    { name: "user_id", type: "BigInt" },
  ],
  procedure: (s) => {
    s.modify(sql`
      insert into db.event_log (type, user_id, occurred_at)
      values (input.event_type, input.user_id, now())
    `);
  },
});
```

## Best Practices

1. **Keep functions focused** - Each function should do one thing well
2. **Use descriptive names** - Prefix with verb (get, calculate, format, create)
3. **Validate inputs** - Check for null values and invalid data
4. **Document parameters** - Use clear parameter names
5. **Consider performance** - Functions are called for every row in queries
6. **Test thoroughly** - Test edge cases and null handling

## Common Use Cases

### URL Building

```typescript
system.db.scalarFunction({
  name: "build_api_url",
  returnType: "String",
  parameters: [
    { name: "endpoint", type: "String" },
    { name: "api_key", type: "String" },
  ],
  procedure: (s) => {
    s.return(
      sql.concat(
        "https://api.example.com/",
        sql`input.endpoint`,
        "?key=",
        sql`input.api_key`
      )
    );
  },
});
```

### Data Formatting

```typescript
system.db.scalarFunction({
  name: "format_currency",
  returnType: "String",
  parameters: [
    {
      name: "amount",
      type: { type: "Decimal", precision: 10, scale: 2, signed: true },
    },
    { name: "currency", type: "String" },
  ],
  procedure: (s) => {
    s.return(
      sql.concat(
        sql`input.currency`,
        " ",
        sql`format.decimal(round(input.amount, 2))`
      )
    );
  },
});
```

### Business Rules

```typescript
system.db.scalarFunction({
  name: "can_edit_order",
  returnType: "Bool",
  parameters: [
    { name: "order_id", type: "BigInt" },
    { name: "user_id", type: "BigInt" },
  ],
  procedure: (s) => {
    s.defRecord("order", sql`select * from db.orders where id = input.order_id`);

    // Can't edit completed orders
    s.if(sql`order.status = 'completed'`, (s) => {
      s.return(sql.false);
    });

    // Owner can always edit
    s.if(sql`order.user_id = input.user_id`, (s) => {
      s.return(sql.true);
    });

    // Admins can edit
    s.defScalar(
      "is_admin",
      sql`exists(select 1 from db.user_roles where user_id = input.user_id and role = 'admin')`
    );

    s.return(sql`is_admin`);
  },
});
```

## Limitations

1. **No side effects** - Use procedures, endpoints, jobs, or reactors for writes
2. **Bound recursion** - Recursive functions are supported, but unbounded recursion
   can exhaust execution resources
3. **Single return value** - Can't return multiple values or tables from a scalar function
4. **No overloading** - Each function name must be unique

There is not currently a Studio-facing `db.tableFunction(...)` builder. For
table-shaped reusable logic, use SQL views, stored procedures that define or
return tables, or ordinary SQL CTEs depending on the use case.
