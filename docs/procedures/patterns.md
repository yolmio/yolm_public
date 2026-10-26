---
title: Procedure Patterns
description: Common patterns for writing Yolm procedures including fast low-conflict OCC transactions, reusable functions, and error handling.
tags:
  - procedures
  - patterns
  - best-practices
  - transactions
  - performance
related:
  - procedures/overview.md
  - procedures/server_statements.md
  - procedures/occ.md
  - sql/query_planning.md
---

# Procedure Patterns

## Standard Procedure Pattern

```typescript
function handleCreateUser(s: UiServerStatements, name: StringExpr) {
  s.startTransaction();
  s.modify(sql`insert into db.users (name) values (${name})`);
  s.commitTransaction();
}
```

## Fast, Low-Conflict Transactions

Read [OCC and transaction patterns](occ.md) for the runtime's read dependencies,
replay boundaries, generated-ID rules, and validation requirements.

Yolm uses optimistic concurrency control (OCC). Database reads performed after
`startTransaction()` become dependencies that are checked at commit. If a
concurrent commit changed data the transaction depended on, Yolm retries the
transaction from its start. This preserves atomic database state, but repeated
or unnecessarily broad work increases latency and CPU use.

Structure write procedures so the transaction contains only the work that must
be atomic:

1. Validate request shape and perform pure computation before the transaction.
2. If candidate discovery is expensive and does not need to be snapshot-exact,
   materialize a bounded set of primary keys before the transaction.
3. Start the transaction, then revalidate every fact whose change would make
   the write incorrect. Use direct primary-key predicates and expected prior
   state where possible.
4. Perform the bounded writes and commit once.
5. Build wide responses or run reporting queries after the commit.

For example, candidate discovery can happen before the transaction while the
write still checks the current state atomically:

```typescript
s.defTable("candidate_tasks", sql`
  select id
  from db.tasks
  where status = 'pending'
  order by id
  limit 100
`);

s.startTransaction();
s.modify(sql`
  update db.tasks
  set status = 'processing'
  where status = 'pending'
    and id in (select id from candidate_tasks)
`);
s.commitTransaction();
```

The pre-transaction result is only a candidate set. The `status = 'pending'`
condition inside the transaction prevents a stale candidate from being
claimed. Apply the same rule to permissions, ownership, workflow state, and
other correctness conditions.

Prefer one set-based mutation when it preserves precise predicates and
behavior. For a small bounded set, exact primary-key mutations can be a better
shape than one broad predicate; measure the real plan and invocation count.
Do not narrow a read merely to avoid conflicts when correctness depends on the
whole predicate, such as proving that no matching row exists or removing every
matching row as of commit.

Keep requests, waits, parsing, and other slow work outside the transaction.
When a caller can redeliver the same operation (partner retries, webhooks), use
a stable idempotency key backed by a unique constraint; OCC protects transaction
atomicity, but it does not make two separate requests the same operation. A
natural business key, or a reactor keyed on missing output, often suffices.

## Error Handling Pattern

```typescript
s.try({
  body: s => {
    s.startTransaction();
    s.modify(sql`insert into db.users (name) values ('John')`);
    s.commitTransaction();
  },
  errorName: "db_error",
  catch: s => {
    s.debugExpr(sql`db_error.message`);
    s.setScalar("ui.error", sql.lit`Failed to create user`);
  }
});
```

## Reusable Function Pattern (Macro-like)

Functions in procedures act like macros - they run at **generation time** to produce code, NOT at runtime.

```typescript
// This function generates procedure code, not runtime logic
function checkRate<T extends IServerBaseStatements>(
  s: T,
  opts: { condition: BooleanExpr; defaultSlidingScaleToFalse: boolean }
) {
  s.defRecord("rate", sql`select * from db.rates where ${opts.condition}`);

  // This if runs at RUNTIME
  s.if(sql`rate.id is not null`, (s) => {
    // This if runs at GENERATION TIME - changes generated code
    if (opts.defaultSlidingScaleToFalse) {
      s.setScalar("sliding_scale", sql`coalesce(rate.sliding_scale, false)`);
    } else {
      s.setScalar("sliding_scale", sql`coalesce(rate.sliding_scale, true)`);
    }
    s.setScalar("found_rate", sql`rate.rate`);
    s.exitBlock("rate_checks");
  });
}

// Usage
function findOrderRates<T extends IServerBaseStatements>(
  s: T,
  opts: { researcherId: NumericExpr; countyId: NumericExpr; searchType: StringExpr }
) {
  s.defScalar("found_rate", {
    type: { type: "Decimal", precision: 10, scale: 2, signed: false },
  });
  s.defScalar("sliding_scale", {
    type: "Bool",
  });
  s.block("rate_checks", (s) => {
    checkRate(s, {
      condition: sql`researcher = ${opts.researcherId} and county = ${opts.countyId}`,
      defaultSlidingScaleToFalse: false
    });
    // More checks...
  });
}
```

## Iterating Over Tables

### Basic forEachTable

```typescript
s.forEachTable("users", "user", (s) => {
  s.debugExpr(sql`user_record.name`);
});
```

### forEachTableWithOpts

More flexible iteration with filtering and ordering:

```typescript
s.defTable("members", sql`select * from db.members`);
s.forEachTableWithOpts({
  table: "members",
  where: sql`member_status = 'active' and not do_not_send_email`,
  cursorName: "member",
  body: (s) => {
    s.debugExpr(sql`coalesce(member.notification_email, member.email)`);
  },
});
```

Prefer one set-based `insert ... select` or `update` over per-row writes in a
loop. To email each matching row, insert the rows into an
[outbox table](../concepts/outbox.md) in one transaction instead of calling a
provider or a bespoke queue table from the loop.

### With Ordering

```typescript
s.defTable("orders", sql`select * from db.orders`);
s.forEachTableWithOpts({
  table: "orders",
  where: sql`status = 'pending'`,
  orderBy: sql`id desc`,
  cursorName: "order",
  body: (s) => {
    // Process orders, highest id first
  },
});
```

### forEachQuery

Iterate over query results instead of a table:

```typescript
s.forEachQuery(
  sql`
    select u.id, u.name, count(o.id) as order_count
    from db.users u
    left join db.orders o on o.user_id = u.id
    group by u.id, u.name
    having count(o.id) > 5
  `,
  "user_stats",
  (s) => {
    s.debugExpr(sql`user_stats.name || ' has ' || user_stats.order_count || ' orders'`);
  }
);
```

## String Splitting Without Arrays

Yolm does not have arrays. Use tables instead:

```typescript
s.defTable('parts', sql`select value, ordinal from string.split('a,b,c', ',')`);
s.forEachTable('parts', 'part', (s) => {
  s.debugExpr(sql`part.value`);
  s.debugExpr(sql`part.ordinal`);
});
```

## Mutation Loading And Error States

Use `Form` for user-edited record mutations and `ActionButton` for command
mutations. Those primitives own their loading, error, duplicate-submission, and
refetch behavior. Do not hand-roll a plain `Button`, `s.tryServer`, and UI
loading/error scalars for ordinary form submissions or commands.

```tsx
<Form>
  <Form.Insert table="todos">
    <Form.Field field="title" />
    <Form.ErrorAlert />
    <Form.SubmitButton>Add Todo</Form.SubmitButton>
  </Form.Insert>
</Form>

<ActionButton
  action={(s) => {
    s.startTransaction();
    s.modify(sql`update db.todos set done = true where id = todo.id`);
    s.commitTransaction();
  }}
>
  Mark Done
</ActionButton>
```

See [Form](../ui/form.md) and [ActionButton](../ui/action_button.md) for
options.

Use a raw event handler only when the flow is not represented by those
primitives. If it performs server work, make pending state visible with
`s.commitUiTreeChanges()`, handle the error and recovery path, and call
`s.refetch()` when affected reads must refresh. For example, a keyboard
shortcut has no button for `ActionButton` to own, so it uses `s.tryServer`
with UI scalars declared in an enclosing `Data local`:

```tsx
<EventHandlers
  document={{
    keydown: (s) => {
      s.if(
        sql`event.key = 'Enter' and (event.ctrl_key or event.meta_key) and not marking_done`,
        (s) => {
          s.event.preventDefault();
          s.setScalar("marking_done", sql.true);
          s.setScalar("mark_error", sql.null);
          s.commitUiTreeChanges();
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              s.modify(sql`update db.todos set done = true where id = ${todoId}`);
              s.commitTransaction();
              s.refetch();
            },
            errorName: "server_error",
            catch: (s) => {
              s.setScalar("mark_error", sql`server_error.message`);
            },
            finally: (s) => {
              s.setScalar("marking_done", sql.false);
            },
          });
        },
      );
    },
  }}
/>
```

If the client-side continuation after `tryServer` needs a value computed on the
server, declare a proc-local result scalar before `tryServer` and set it in the
server body. Server writes to `ui.*` are valid, but they are for UI state; the
immediate continuation should use explicit result scalars/tables for values
such as newly-created IDs.
