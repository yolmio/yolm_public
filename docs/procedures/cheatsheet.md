---
title: Procedure Statements Cheatsheet
description: One-page index of common Yolm procedure statements, control flow, transactions, server calls, and debugging helpers.
tags:
  - procedures
  - cheatsheet
related:
  - procedures/base_statements.md
  - procedures/server_statements.md
  - procedures/dom_statements.md
  - procedures/patterns.md
---

# Procedure Statements Cheatsheet

One-line reminders only. Details and options live in
[base statements](./base_statements.md),
[server statements](./server_statements.md),
[DOM statements](./dom_statements.md), and [patterns](./patterns.md).

## Declarations And Scalars ([base](./base_statements.md#variable-declarations))

```typescript
s.defScalar("count", sql`0`);                              // typed from expr
s.defScalar("result", { type: "String" });                 // starts null
s.defRecord("user_record", sql`select * from db.users where id = ${userId}`);
s.defTable("orders", sql`select * from db.orders where user_id = ${userId}`);
s.setScalar("count", sql`count + 1`);
s.increment("count"); s.decrement("count", 5); s.toggle("is_active");
```

## Control Flow ([base](./base_statements.md#control-structures))

```typescript
s.if(cond, then, else?); s.elseIf(cond, then); s.else(then); s.unless(cond, then);
s.cases({ cases: [{ condition, body }], default });
s.while(cond, body); s.loop(body); s.loopN(sql`5`, body);
s.forEachTable("orders", "order", body); s.forEachQuery(query, "row", body);
s.forEachTableWithOpts({ table, where, orderBy, cursorName, body });
s.break(); s.breakIf(cond); s.continue(); s.continueIf(cond);
s.return(expr?); s.returnIf(cond, expr?);
s.block("name", body); s.exitBlockIf(cond, "name");
```

## Errors ([base](./base_statements.md#exception-handling))

```typescript
s.throwError(sql.lit`Invalid input`); s.throwErrorIf(cond, sql.lit`No records`);
s.try({ body, errorName: "err", catch, finally });   // err.message, err.type
```

## Server ([server](./server_statements.md))

```typescript
s.modify(sql`update db.todos set done = true where id = ${id}`);
s.startTransaction(); s.commitTransaction(); s.rollbackTransaction();
s.request({ uri, method, json, defReceiveJson: "data" });   // keep outside transactions
```

## UI / DOM ([dom](./dom_statements.md))

Mutations from the UI: use `Form` for edited record fields and `ActionButton`
for commands; both own loading, errors, and refetch. See
[mutation loading and error states](./patterns.md#mutation-loading-and-error-states).

```typescript
s.server(body); s.tryServer({ body, errorName, catch, finally });  // escape hatch
s.refetch();                    // re-run Data queries after a raw server write
s.commitUiTreeChanges();        // flush pending UI state before slow work
s.navigate(sql.lit`/dashboard`); s.setQueryParam("page", sql`2`);
```

## Debugging ([base](./base_statements.md#debug))

```typescript
s.debug("message"); s.debugExpr(sql`user_record.name`); s.debugQuery(sql`select * from db.users`);
```

## Where Statements Are Available

| Statement | Context |
|-----------|---------|
| declarations, control flow, `modify`, `try`, `debug*` | All |
| `startTransaction` / `commitTransaction` / `request` | Server |
| `server` / `tryServer` / `commitUiTreeChanges` | DOM |
| `refetch`, `navigate` | DOM and UI server |

See [statement builder type reference](./statements_reference.md) for the
full type hierarchy.
