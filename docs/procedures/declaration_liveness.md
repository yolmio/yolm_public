---
title: Declaration Liveness Validation
description: How declaration liveness validation works and how to fix never-written or never-read procedure declarations.
tags:
  - procedures
  - validation
  - debugging
related:
  - procedures/lexical_scoping.md
  - procedures/overview.md
---

# Declaration Liveness Validation

Declaration liveness validation checks that procedure-scope declarations are actually useful.

It applies to temporary scalars, records, and tables created inside Yolm procedures, including declarations created by `Data` procedures, event handlers, APIs, scheduled jobs, scripts, and other procedure bodies.

It catches two common mistakes:

- A declaration is created but never populated.
- A declaration is populated but never consumed.

This is about procedure-scope state, not persistent `db.*` tables.

## Validation Scope

Declaration liveness validation runs in Forge validation, previews, and tests.
After changing declarations, validate the system again and restart the preview
when it is already running so it loads the new generated model.

## Error: Never Written

You will see an error like:

```text
E2066: scalar 'total' is never written
```

This means the declaration exists, but no statement gives it a value.

### Scalar Fix

```tsx
// Bad: typed declaration, but no value is ever assigned
s.defScalar("total", { type: "BigInt" });
```

Initialize it when you declare it:

```tsx
s.defScalar("total", {
  type: "BigInt",
  expr: sql`0`,
});
```

Or assign it later:

```tsx
s.defScalar("total", { type: "BigInt" });
s.setScalar("total", sql`(select count(*) from db.orders)`);
```

If the declaration is no longer needed, remove it.

### Table Fix

```tsx
// Bad: schema exists, but no rows are ever inserted or selected into it
s.defTable("selected_orders", {
  fields: [
    { name: "order_id", type: "BigInt", notNull: true },
  ],
});
```

Populate it with a query:

```tsx
s.defTable(
  "selected_orders",
  sql`select id as order_id from db.orders where status = 'open'`,
);
```

Or keep the table definition and insert into it later:

```tsx
s.defTable("selected_orders", {
  fields: [
    { name: "order_id", type: "BigInt", notNull: true },
  ],
});

s.modify(sql`
  insert into selected_orders (order_id)
  select id from db.orders where status = 'open'
`);
```

### Record Fix

```tsx
// Bad: record shape exists, but it is never populated
s.defRecord("current_user", {
  fields: [
    { name: "email", type: { type: "String", maxLength: 254 } },
  ],
});
```

Populate it with a query:

```tsx
s.defRecord(
  "current_user",
  sql`select email from db.users where id = ${userId}`,
);
```

## Error: Never Read

You will see an error like:

```text
E2067: table 'orders' is never read
```

This means the declaration is populated, but nothing later uses it.

The usual fixes are:

- Remove the declaration if it is dead.
- Read it from SQL, UI, a return value, or another statement.
- Remove an output binding if the statement result is not needed.

### Data Component Example

```tsx
// Bad: users is fetched but never rendered or otherwise used
<Data procedure={(s) => {
  s.defTable("users", sql`select id, name from db.users`);
}}>
  <p>No users shown here</p>
</Data>
```

Read the table from the children:

```tsx
<Data procedure={(s) => {
  s.defTable("users", sql`select id, name from db.users`);
}}>
  <Each table="users" recordName="user">
    <p>{sql`user.name`}</p>
  </Each>
</Data>
```

### Scalar Example

```tsx
// Bad: total is computed but never used
s.defScalar("total", sql`(select count(*) from db.orders)`);
```

Use it in a later expression or statement:

```tsx
s.defScalar("total", sql`(select count(*) from db.orders)`);
s.debugExpr(sql`total`);
```

In UI, render it:

```tsx
<Data procedure={(s) => {
  s.defScalar("total", sql`(select count(*) from db.orders)`);
}}>
  <p>Total orders: {sql`total`}</p>
</Data>
```

### Output Binding Example

Some statements create output scalars, records, or tables. If you request an output binding, liveness validation expects you to use it.

```tsx
// Bad: csv_result is written but never consumed
s.queryToCsv(sql`select id, name from db.users`, "csv_result");
```

Use the output:

```tsx
s.queryToCsv(sql`select id, name from db.users`, "csv_result");
s.debugExpr(sql`csv_result`);
```

If the output is not needed, remove the output binding or use a statement shape that does not create one.

## Shadowing Errors

Sometimes the error points at a declaration and also notes that a same-named nested declaration is written elsewhere.

That follows Yolm's [lexical procedure scoping](lexical_scoping.md) rules: the nested declaration has the same name, but it is a different variable.

```tsx
// Bad: outer result is never written
s.defScalar("result", { type: "String" });

s.if(sql`should_use_default`, (s) => {
  s.defScalar("result", sql.lit`default`);
});
```

The inner `s.defScalar("result", ...)` declares a new `result` scoped to the `if` body. It does not assign the outer `result`.

Assign the outer scalar instead:

```tsx
s.defScalar("result", { type: "String" });

s.if(sql`should_use_default`, (s) => {
  s.setScalar("result", sql.lit`default`);
});
```

Or give the inner value a different name and copy it intentionally.

## What Counts As A Read

These all count as reads:

- Referencing a scalar in an `sql` template, for example `total + 1`.
- Selecting from a procedure table, for example `select * from users`.
- Reading a record field, for example `current_user.email`.
- Rendering a scalar or record field in UI.
- Iterating a table with `<Each table="...">`.
- Passing a table, record, or scalar to another statement that consumes it.

## What Counts As A Write

These all count as writes:

- `s.defScalar("name", expr)`.
- `s.defScalar(name, { type, expr })`.
- `s.setScalar("name", expr)`.
- `s.defTable("name", query)`.
- `s.defRecord("name", query)`.
- `insert into proc_table ...`.
- Statements that produce output bindings, such as CSV, request, file, template, or dynamic query outputs.

## Fixing Checklist

1. Read the first liveness error and find the declaration name.
2. Decide whether the declaration is still needed.
3. If it is not needed, remove it.
4. If it is needed and says "never written", initialize it or write to it.
5. If it is needed and says "never read", consume it from SQL, UI, or a later statement.
6. If there is a same-name nested declaration, replace the nested declaration with `s.setScalar(...)` or rename it.
7. Re-run Forge validation.
