---
title: Base Statements
description: Common base statements available in all Yolm procedure types including data modification, flow control, variable declarations, and loops.
tags:
  - procedures
  - statements
  - variables
  - control-flow
---

# Base Statements

These statements are available in all procedure types.

## Data Modification

```typescript
s.modify(sql`insert into db.users (name) values ('John')`);
```

## Flow Control

### Break and Continue

```typescript
s.break();
s.breakIf(condition);
s.breakUnless(condition);

s.continue();
s.continueIf(condition);
s.continueUnless(condition);
```

### Throwing Errors

```typescript
s.throwError(sql.lit`Invalid input`, sql.lit`Optional description`);
s.throwErrorIf(condition, sql.lit`Error message`, sql.lit`Description`);
s.throwErrorUnless(condition, sql.lit`Error message`, sql.lit`Description`);
```

### Return

```typescript
s.return(sql`42`);
s.returnIf(condition, sql`value`);
s.returnUnless(condition, sql`value`);
```

## Variable Declarations

### Tables

```typescript
s.defTable('temp_users', sql`select * from db.users where active = true`);

s.defTable('temp_users', {
  fields: [
    { name: 'id', type: { type: 'Int' } },
    { name: 'name', type: 'String' }
  ]
});
```

### Records

```typescript
s.defRecord('user_info', sql`select name, email from db.users where id = 1`);

s.defRecord('user', {
  fields: [
    { name: 'id', type: { type: 'Int' } },
    { name: 'name', type: 'String' }
  ]
});
```

### Scalars

```typescript
// defScalar(name, expr) - requires an expression
s.defScalar('total_count', sql`(select count(*) from db.users)`);
s.defScalar('name', sql.lit`John`);

// defScalar(name, opts) - declare type explicitly, expression optional
s.defScalar('user_id', {
  type: 'BigInt',
  expr: sql`some_value`
});

// Null-initialized scalar (omit expr to start as null)
s.defScalar('result', {
  type: 'String'
  // no expr = starts as null
});
```

## Scalar Operations

```typescript
s.setScalar('counter', sql`counter + 1`);
s.increment('counter', 1);
s.decrement('counter', 1);
s.toggle('is_active');
```

## Control Structures

### Conditional

```typescript
s.if(sql`user_count > 0`, (s) => s.debug('Users found'));

// With else
s.if(sql`user_count > 0`,
   (s) => s.debug('Users found'),
   (s) => s.debug('No users found')
);

// Else if chain
s.if(sql`user_count > 10`, (s) => s.debug('Many users'));
s.elseIf(sql`user_count > 0`, (s) => s.debug('Some users'));
s.else((s) => s.debug('No users'));

// Unless (negative condition)
s.unless(sql`is_empty`, (s) => s.debug('Has content'));
```

### Switch-like

```typescript
s.cases({
  cases: [
    { condition: sql`status = 'pending'`, body: (s) => s.debug('Pending') },
    { condition: sql`status = 'approved'`, body: (s) => s.debug('Approved') }
  ],
  default: (s) => s.debug('Other status')
});
```

## Loops

```typescript
// While loop
s.while(sql`counter < 10`, (s) => s.increment('counter'));

// For each table row
s.forEachTable('temp_users', 'user', (s) => s.debug('Processing user'));

// For each query result
s.forEachQuery(sql`select * from db.users`, 'user', (s) => s.debug('Processing'));

// Infinite loop with break
s.loop((s) => {
  s.debug('Looping');
  s.breakIf(sql`should_exit`);
});

// Loop N times
s.loopN(sql`5`, (s) => s.debug('Iteration'));
```

## Exception Handling

Catching an error does not roll back an active transaction. At the transaction's
owning boundary, use `s.rollbackIfInTransaction()` before starting another
transaction in the catch (including a failure-logging helper). Caller-owned
stored procedures propagate failures to their owning caller. See
[transaction cleanup in error handlers](../api/external_interfaces.md#transaction-cleanup-in-error-handlers)
for a safe example and required failure-path tests.

```typescript
s.try({
  body: (s) => s.debug('Risky operation'),
  catch: (s) => s.debug('Error occurred'),
  finally: (s) => s.debug('Cleanup')
});
```

## Blocks

```typescript
// Anonymous block
s.block((s) => s.debug('Inside block'));

// Named block (for early exit)
s.block('my_block', (s) => {
  s.debug('Inside named block');
  s.exitBlockIf(sql`condition`, 'my_block');
});
```

## Debug

```typescript
s.debug('Processing user data');
s.debugExpr(sql`user_record.name`);
s.debugQuery(sql`select * from db.users`);
```

## Cursor Operations

For iterating over large datasets efficiently:

```typescript
// Create query cursor
s.createQueryCursor('user_cursor', sql`select * from db.users`);

// Move cursor to next row
s.advanceCursor('user_cursor');

// Iterate over cursor
s.forEachCursor('user_cursor', (s) => s.debug('Processing user'));
```
