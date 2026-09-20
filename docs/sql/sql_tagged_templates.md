---
title: SQL Tagged Templates
description: How to build safe Yolm SQL with tagged templates, including sql, sql.lit, sql.ref, and sql.concat.
tags:
  - sql
  - tagged-templates
  - safety
---

# SQL Tagged Templates

All SQL in Yolm must be written using tagged template literals. This ensures type safety and proper escaping.

## Basic Usage

### sql`` - Expressions and Queries

```typescript
// Simple expressions
sql`price * 1.1`
sql`user.name`
sql`count(*)`

// Queries
sql`select * from db.users where active = true`

// With interpolation
const userId = sql`user_id`;
sql`select * from db.users where id = ${userId}`
```

### sql.lit`` - String Literals

Use for literal string values:

```typescript
// String values
sql.lit`pending`
sql.lit`Hello World`

// In conditions
sql`status = ${sql.lit`active`}`

// Results in: status = 'active'
```

### sql.ref() - Identifiers

Reference table/column names dynamically:

```typescript
sql.ref("user_name")           // user_name
sql.ref("users", "name")       // users.name
sql.ref("db.users")            // db.users
```

## Combining Expressions

### Concatenation

```typescript
sql`${firstName} || ' ' || ${lastName}`
```

### Interpolating Expressions

```typescript
const condition = sql`status = 'active'`;
const orderBy = sql`created_at desc`;

sql`select * from db.users where ${condition} order by ${orderBy}`
```

## Common Helpers

### sql.and() / sql.or()

```typescript
sql.and(
  sql`status = 'active'`,
  sql`role = 'admin'`,
  sql`created_at > ${startDate}`
)
// (status = 'active') AND (role = 'admin') AND (created_at > ...)

sql.or(
  sql`type = 'standard'`,
  sql`type = 'premium'`
)
// (type = 'standard') OR (type = 'premium')
```

### sql.not()

```typescript
sql.not(sql`is_deleted`)
// NOT (is_deleted)
```

### sql.isNull() / sql.isNotNull()

```typescript
sql.isNull(sql`deleted_at`)
sql.isNotNull(sql`email`)
```

### sql.true / sql.false / sql.null

```typescript
s.defScalar("is_active", sql.true);
s.defScalar("is_deleted", sql.false);
s.defScalar("result", { type: "String", expr: sql.null });
```

### sql.concat()

```typescript
sql.concat(sql`first_name`, sql.lit` `, sql`last_name`)
```

## Insert Helpers

### sql.insertValues()

```typescript
sql.insertValues(
  sql.ref("db.users"),
  ["name", "email", "status"],
  [sql`input_name`, sql`input_email`, sql.lit`active`]
)
// INSERT INTO db.users (name, email, status) VALUES (input_name, input_email, 'active')
```

### sql.insertQuery()

```typescript
sql.insertQuery(
  "db.archived_users",
  sql`select * from db.users where status = 'inactive'`
)
```

## Update Helpers

### updateAssignment()

```typescript
import { updateAssignment } from "std/sql_utils";

sql`update db.users set ${updateAssignment(sql.ref("name"), sql`new_name`)}`
// UPDATE db.users SET name = new_name
```

## Select Helpers

### selectColumn()

```typescript
import { selectColumn } from "std/sql_utils";

const columns = [
  selectColumn(sql`id`),
  selectColumn(sql`first_name || ' ' || last_name`, "full_name"),
  selectColumn(sql`created_at`)
];

sql`select ${columns} from db.users`
```

## TypeScript Type Aliases

`std/sql_utils` exports three TypeScript types you'll see in API
signatures throughout Yolm:

| Type | Definition | Use |
| --- | --- | --- |
| `Sql` | The class returned by the `sql\`...\`` template. | Annotate a parameter that must be a SQL fragment (no plain strings/numbers). |
| `BooleanExpr` | `Sql \| boolean` | "Either a static yes/no, or a SQL predicate." Used for things like `disabled`, `error`, `when`. |
| `NumericExpr` | `Sql \| number` | "Either a literal number or a SQL expression." Used for limits, weights, sort positions, money columns. |

```typescript
import { sql, type BooleanExpr, type NumericExpr, type Sql } from "std/sql_utils";

interface PaginationOpts {
  pageSize: NumericExpr;
  hasNext: BooleanExpr;
  baseQuery: Sql;
}
```

When implementing a function that takes a `BooleanExpr` /
`NumericExpr` and you need it as SQL, use `sql.normalizeExpr(...)` to
coerce the literal form into a `Sql` value.

## Type Expressions

### Type Casting

```typescript
sql`${value}::string`           // Cast to string
sql`${value}::int`              // Cast to int
sql`cast(${value} as decimal)`  // Explicit cast
```

### Enum Values

```typescript
sql`${sql.lit`pending`}::enums.order_status`
sql`cast('pending' as enums.order_status)`
```

## Dynamic SQL

### Building Conditions

```typescript
function buildWhereClause(filters: { status?: string; category?: string }) {
  const conditions: Sql[] = [sql.true];

  if (filters.status) {
    conditions.push(sql`status = ${sql.lit(filters.status)}`);
  }

  if (filters.category) {
    conditions.push(sql`category = ${sql.lit(filters.category)}`);
  }

  return sql.and(...conditions);
}

const where = buildWhereClause({ status: "active" });
sql`select * from db.products where ${where}`
```

### Dynamic Order By

```typescript
function getOrderBy(sortField: string, sortDir: "asc" | "desc") {
  return sql`${sql.ref(sortField)} ${sql(sortDir)}`;
}
```

## Converting to String

### sql.exprToString()

Get the raw SQL string (useful for debugging):

```typescript
const expr = sql`user.name = ${sql.lit`John`}`;
console.log(sql.exprToString(expr));
// user.name = 'John'
```

### sql.normalizeExpr()

Normalize an expression for comparison:

```typescript
sql.normalizeExpr(sql`users.id`).toSQL()
```

## Best Practices

1. **Always use tagged templates** - Never concatenate strings for SQL
2. **Use sql.lit for values** - Prevents SQL injection and ensures proper quoting
3. **Use sql.ref for identifiers** - When referencing dynamic column/table names
4. **Compose with sql.and/sql.or** - For readable complex conditions
5. **Keep SQL readable** - Break long queries into multiple lines

```typescript
// Good
sql`
  select
    u.id,
    u.name,
    count(o.id) as order_count
  from db.users u
  left join db.orders o on o.user_id = u.id
  where u.active = true
  group by u.id, u.name
`

// Avoid
sql`select u.id, u.name, count(o.id) as order_count from db.users u left join db.orders o on o.user_id = u.id where u.active = true group by u.id, u.name`
```
