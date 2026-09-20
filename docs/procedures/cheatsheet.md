---
title: Procedure Statements Cheatsheet
description: Compact reference for common Yolm procedure statements, control flow, transactions, requests, and debugging helpers.
tags:
  - procedures
  - cheatsheet
---

# Procedure Statements Cheatsheet

Quick reference for commonly used procedure statements. See [base-statements](./base_statements.md), [dom-statements](./dom_statements.md), [server-statements](./server_statements.md), and [patterns](./patterns.md) for full details.

## Variable Declarations

### scalar - Single value

```typescript
s.defScalar("count", sql`0`);
s.defScalar("name", sql.lit`John`);
s.defScalar("total", sql`(select count(*) from db.users)`);
```

### defScalar - Explicit type (nullable)

```typescript
s.defScalar("result", { type: "String" });                    // starts as null
s.defScalar("user_id", { type: "BigInt", expr: sql`some_id` });
s.defScalar("amount", { type: { type: "Decimal", precision: 10, scale: 2, signed: false } });
```

### record - Single row

```typescript
s.defRecord("user", sql`select * from db.users where id = ${userId}`);
// Access: sql`user.name`, sql`user.email`
// Null check: sql`user.id is not null`
```

### table - Multiple rows

```typescript
s.defTable("orders", sql`select * from db.orders where user_id = ${userId}`);
// Use with <Each table="orders" recordName="order">
```

## Scalar Operations

```typescript
s.setScalar("counter", sql`counter + 1`);
s.increment("counter");            // +1
s.increment("counter", 5);         // +5
s.decrement("counter");            // -1
s.toggle("is_active");             // flips boolean
```

## Control Flow

### if / elseIf / else

```typescript
s.if(sql`count > 0`, (s) => { /* ... */ });
s.if(sql`count > 0`, (s) => { /* then */ }, (s) => { /* else */ });

s.if(sql`count > 10`, (s) => { /* ... */ });
s.elseIf(sql`count > 0`, (s) => { /* ... */ });
s.else((s) => { /* ... */ });
```

### unless

```typescript
s.unless(sql`is_empty`, (s) => { /* runs when NOT is_empty */ });
```

### cases (switch-like)

```typescript
s.cases({
  cases: [
    { condition: sql`status = 'pending'`, body: (s) => { /* ... */ } },
    { condition: sql`status = 'approved'`, body: (s) => { /* ... */ } },
  ],
  default: (s) => { /* ... */ },
});
```

## Loops

### while

```typescript
s.while(sql`counter < 10`, (s) => s.increment("counter"));
```

### forEachTable / forEachQuery

```typescript
s.forEachTable("users", "user", (s) => {
  s.debugExpr(sql`user.name`);
});

s.forEachTableWithOpts({
  table: "db.orders",
  where: sql`status = 'pending'`,
  orderBy: sql`created_at desc`,
  cursorName: "order",
  body: (s) => { /* ... */ },
});

s.forEachQuery(sql`select * from db.users where active`, "user", (s) => {
  s.debugExpr(sql`user.name`);
});
```

### loop / loopN

```typescript
s.loop((s) => { s.breakIf(sql`done`); });
s.loopN(sql`5`, (s) => { /* runs 5 times */ });
```

### break / continue

```typescript
s.break();
s.breakIf(sql`condition`);
s.continue();
s.continueIf(sql`condition`);
```

## Data Modification

```typescript
s.modify(sql`insert into db.todos (title) values (${title})`);
s.modify(sql`update db.todos set done = true where id = ${id}`);
s.modify(sql`delete from db.todos where id = ${id}`);
```

## Transactions

```typescript
s.startTransaction();
s.modify(sql`insert into db.todos (title) values ('Buy milk')`);
s.commitTransaction();
// or
s.rollbackTransaction();
```

## tryServer Pattern

From event handlers (DomStatements), call server-side code with error handling:

```typescript
s.setScalar("loading", sql.true);
s.commitUiTreeChanges();  // flush UI changes immediately

s.tryServer({
  body: (s) => {
    s.startTransaction();
    s.modify(sql`insert into db.todos (title) values (ui.input_text)`);
    s.commitTransaction();
    s.increment("ui.refresh_key");
  },
  errorName: "server_error",
  catch: (s) => {
    s.debugExpr(sql`server_error.message`);
    s.setScalar("error_msg", sql.lit`Something went wrong`);
  },
  finally: (s) => {
    s.setScalar("loading", sql.false);
  },
});
```

### Simple server call (no error handling)

```typescript
s.server((s) => {
  s.modify(sql`insert into db.todos (title) values ('task')`);
});
```

## Error Handling

### throwError

```typescript
s.throwError(sql.lit`Invalid input`);
s.throwError(sql.lit`Not found`, sql.lit`User does not exist`);
s.throwErrorIf(sql`count = 0`, sql.lit`No records`);
s.throwErrorUnless(sql`is_valid`, sql.lit`Validation failed`);
```

### try / catch / finally

```typescript
s.try({
  body: (s) => { /* risky operation */ },
  errorName: "err",
  catch: (s) => s.debugExpr(sql`err.message`),
  finally: (s) => { /* cleanup */ },
});
```

## UI Operations

### commitUiTreeChanges

Flushes pending UI state changes to the DOM before continuing (e.g. show a spinner before a server call):

```typescript
s.setScalar("loading", sql.true);
s.commitUiTreeChanges();
// UI now shows loading state
```

### navigate

```typescript
s.navigate(sql.lit`/dashboard`);
s.navigate(sql.lit`/dashboard`, sql`true`);  // replace history entry
s.setQueryParam("page", sql`2`);
```

## Debugging

```typescript
s.debug("Processing user data");       // static message
s.debugExpr(sql`user.name`);           // log expression value
s.debugQuery(sql`select * from db.users`);  // log query results
```

## Blocks

```typescript
s.block((s) => { /* scoped block */ });

s.block("my_block", (s) => {
  s.exitBlockIf(sql`condition`, "my_block");  // early exit
});
```

## Quick Reference Table

| Statement | Context | Purpose |
|-----------|---------|---------|
| `defScalar` | All | Declare single value |
| `defRecord` | All | Declare single row |
| `defTable` | All | Declare result set |
| `setScalar` | All | Update scalar value |
| `increment` / `decrement` | All | Adjust numeric scalar |
| `toggle` | All | Flip boolean scalar |
| `modify` | All | INSERT/UPDATE/DELETE |
| `if` / `elseIf` / `else` | All | Conditional branching |
| `while` / `loop` / `loopN` | All | Loops |
| `forEachTable` / `forEachQuery` | All | Row iteration |
| `throwError` | All | Raise error |
| `try` | All | Error handling |
| `debug` / `debugExpr` | All | Logging |
| `startTransaction` | Server | Begin transaction |
| `commitTransaction` | Server | Commit transaction |
| `rollbackTransaction` | Server | Rollback transaction |
| `server` / `tryServer` | DOM | Call server from UI |
| `commitUiTreeChanges` | DOM | Flush UI changes |
| `navigate` | DOM / Server | Page navigation |
