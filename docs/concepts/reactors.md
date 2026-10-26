---
title: Reactors
description: How to use Yolm reactors for background automation, PerRecord and Batch mode processing, maxConcurrent worker limits, idempotent queues, notifications, and external sync.
tags:
  - concepts
  - reactors
  - events
  - automation
  - triggers
---

# Reactors

Reactors are **event-driven procedures** that automatically execute when specific data conditions are met. They monitor the database for rows matching a query and run procedures in response.

Use `system.addReactor` for background automation that should run after data
changes: PerRecord mode for one procedure execution per row, Batch mode for one
procedure over the whole result table, and `maxConcurrent` when a per-record
queue can safely process several rows at once. Reactor procedures should be
idempotent so retries or repeated scans do not duplicate side effects.

Use reactors for:

- Automated workflows triggered by data changes
- Sending notifications when conditions are met
- Syncing records to external services
- Background processing queues

Do not use reactors to maintain derived data such as totals, counts, rollups,
or copied fields. Compute those with queries,
[virtual fields](../database/virtual_fields.md), or views so they are never
stale.

## Basic Structure

A reactor consists of:

1. **Query** - SQL query that finds rows to process
2. **Procedure** - Statements to execute for matching rows
3. **Record Name** - (Optional) Name for the matching row in per-record mode
4. **Result Table** - (Optional) Name for the result table in batch mode. Defaults to `reactor`
5. **Mode** - Derived from the options: `recordName` uses per-record mode; otherwise the reactor runs in batch mode
6. **Max Concurrency** - (Optional) Limit on parallel executions for per-record mode. Defaults to 1

```typescript
system.addReactor({
  name: "process_new_orders",
  query: sql`
    select id, customer_id, total
    from db.orders
    where status = 'pending' and processed_at is null
  `,
  recordName: "order",  // Set to use per-record mode
  maxConcurrent: 5,
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      update db.orders
      set status = 'processing', processed_at = current_timestamp
      where id = order.id
    `);
    s.commitTransaction();
  },
});
```

### API

```typescript
system.addReactor({
  name: "my_reactor",
  query: sql`...`,
  procedure: (s) => { ... },
});
```

## Reactor Modes

### PerRecord Mode

Set `recordName` to execute the procedure once for each matching row:

```typescript
system.addReactor({
  name: "send_welcome_email",
  query: sql`
    select id, email, name
    from db.users
    where welcome_sent = false
  `,
  recordName: "reactor",
  procedure: (s) => {
    // 'reactor' contains a single row.
    // Send outside the transaction; requests do not belong inside one.
    s.sendEmail({
      to: sql`reactor.email`,
      subject: sql.lit`Welcome!`,
      htmlBody: sql`'<p>Welcome, ' || reactor.name || '!</p>'`,
    });

    s.startTransaction();
    s.modify(sql`
      update db.users
      set welcome_sent = true
      where id = reactor.id
    `);
    s.commitTransaction();
  },
  maxConcurrent: 10,  // Process up to 10 emails concurrently
});
```

For delivery with retries and enqueueing in the same transaction as the
business write, use the [outbox](outbox.md) instead.

### Batch Mode

Without `recordName`, the procedure executes once with all matching rows
available in the `reactor` table:

```typescript
system.addReactor({
  name: "notify_shipped_orders",
  query: sql`
    select o.id, c.email
    from db.orders o
    join db.customers c on c.id = o.customer_id
    where o.status = 'shipped' and o.shipped_notified = false
  `,
  procedure: (s) => {
    // 'reactor' is a table with all matching rows
    s.startTransaction();
    s.modify(sql`
      insert into db.order_email_outbox (recipient_email, order_id)
      select email, id from reactor
    `);
    s.modify(sql`
      update db.orders
      set shipped_notified = true
      where id in (select id from reactor)
    `);
    s.commitTransaction();
  },
});
```

## Accessing Reactor Data

### In PerRecord Mode

Access fields directly from the `reactor` record:

```typescript
procedure: (s) => {
  s.defScalar("user_id", sql`reactor.id`);
  s.defScalar("user_email", sql`reactor.email`);

  s.modify(sql`
    update db.users set welcome_sent = true where id = reactor.id
  `);
}
```

### In Batch Mode

Query the `reactor` table:

```typescript
procedure: (s) => {
  s.modify(sql`
    update db.orders set shipped_notified = true
    where id in (select id from reactor)
  `);

  s.defScalar("count", sql`select count(*) from reactor`);
}
```

## Common Patterns

### External Synchronization

Push changed records to an external service:

```typescript
system.addReactor({
  name: "sync_customers_to_crm",
  query: sql`
    select id, name, email
    from db.customers
    where crm_synced = false
  `,
  recordName: "reactor",
  procedure: (s) => {
    s.request({
      uri: sql.lit`https://crm.example.com/api/contacts`,
      method: "POST",
      headers: [
        { name: sql.lit`Content-Type`, value: sql.lit`application/json` },
      ],
      json: {
        external_id: sql`reactor.id`,
        name: sql`reactor.name`,
        email: sql`reactor.email`,
      },
      defResponseRecord: "response",
    });
    s.startTransaction();
    s.modify(sql`
      update db.customers
      set crm_synced = true
      where id = reactor.id
    `);
    s.commitTransaction();
  },
  maxConcurrent: 5,
});
```

Whatever path changes a customer's synced fields also sets `crm_synced` back
to `false`.

### Queue Processing

Process items from a queue:

```typescript
system.addReactor({
  name: "process_job_queue",
  query: sql`
    select id, job_type, payload
    from db.job_queue
    where status = 'pending'
    order by priority desc, created_at
    limit 100
  `,
  recordName: "reactor",
  procedure: (s) => {
    s.startTransaction();

    // Mark as processing
    s.modify(sql`
      update db.job_queue
      set status = 'processing', started_at = current_timestamp
      where id = reactor.id
    `);

    s.commitTransaction();

    // Process the job (outside transaction for long-running operations)
    s.try({
      body: (s) => {
        // Job processing logic based on job_type
        s.if(sql`reactor.job_type = 'email'`, (s) => {
          // Send email
        });
        s.if(sql`reactor.job_type = 'report'`, (s) => {
          // Generate report
        });

        s.startTransaction();
        s.modify(sql`
          update db.job_queue
          set status = 'completed', completed_at = current_timestamp
          where id = reactor.id
        `);
        s.commitTransaction();
      },
      errorName: "err",
      catch: (s) => {
        s.startTransaction();
        s.modify(sql`
          update db.job_queue
          set status = 'failed', error = err.message
          where id = reactor.id
        `);
        s.commitTransaction();
      },
    });
  },
  maxConcurrent: 5,
});
```

### Notifications

Send notifications when conditions are met:

```typescript
system.addReactor({
  name: "low_stock_alert",
  query: sql`
    select p.id, p.name, p.stock_quantity, p.reorder_threshold
    from db.products p
    left join db.stock_alerts a on p.id = a.product_id and a.resolved = false
    where p.stock_quantity <= p.reorder_threshold
      and a.id is null
  `,
  recordName: "reactor",
  procedure: (s) => {
    // Record the open alert so the product stops matching
    s.startTransaction();
    s.modify(sql`
      insert into db.stock_alerts (product_id, resolved)
      values (reactor.id, false)
    `);
    s.commitTransaction();

    // Send after commit, outside the transaction
    s.sendEmail({
      to: sql.lit`inventory@example.com`,
      subject: sql`'Low stock alert: ' || reactor.name`,
      htmlBody: sql`'<p>Product ' || reactor.name || ' has ' || reactor.stock_quantity || ' units remaining.</p>'`,
    });
  },
  maxConcurrent: 10,
});
```

## Testing Reactors

Reactors can only be flushed, disabled, or enabled from test bodies; these are
test statements (`s.flushReactors`, `s.disableReactor`, `s.enableReactor`), not
procedure statements. In a test, commit the triggering data and flush:

```typescript
s.startTransaction();
s.modify(sql`insert into db.orders (customer_id, status) values (1, 'pending')`);
s.commitTransaction();

s.flushReactors();

s.assert(sql`exists (select 1 from db.orders where status = 'processing')`);
```

See [Test Statements](../testing/test_statements.md) for `disableReactor` and
`enableReactor`.

## Best Practices

1. **Idempotency**: Design reactor procedures to be safe to run multiple times
2. **Query efficiency**: Keep reactor queries focused and filter as early as possible
3. **Concurrency limits**: Set appropriate `maxConcurrent` for resource-intensive operations
4. **Error handling**: Use try/catch to handle failures gracefully
5. **State tracking**: Include processed/synced timestamps to avoid reprocessing
6. **Transactions**: Wrap database modifications in transactions; send emails and requests outside them
7. **Avoid infinite loops**: Ensure reactor operations don't trigger the same reactor again

## Preventing Infinite Loops

Be careful that reactor operations don't re-match the query:

```typescript
// BAD: This could loop forever
system.addReactor({
  name: "process_orders",
  query: sql`select * from db.orders where total > 100`,
  recordName: "reactor",
  procedure: (s) => {
    // Doesn't change the condition, row will match again!
    s.modify(sql`update db.orders set note = 'processed' where id = reactor.id`);
  },
});

// GOOD: Update excludes row from future matches
system.addReactor({
  name: "process_orders",
  query: sql`select * from db.orders where total > 100 and processed = false`,
  recordName: "reactor",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      update db.orders
      set processed = true, processed_at = current_timestamp
      where id = reactor.id
    `);
    s.commitTransaction();
  },
});
```

## Complete Example

```typescript
// Reactor for processing new signups
system.addReactor({
  name: "new_user_onboarding",
  query: sql`
    select id, email, name, created_at
    from db.users
    where onboarding_status = 'pending'
      and created_at > current_timestamp - interval '24 hours'
  `,
  recordName: "reactor",
  procedure: (s) => {
    s.startTransaction();

    // Update status to prevent reprocessing
    s.modify(sql`
      update db.users
      set onboarding_status = 'in_progress'
      where id = reactor.id
    `);

    s.commitTransaction();

    // Create default user preferences
    s.startTransaction();
    s.modify(sql`
      insert into db.user_preferences (user_id, theme, notifications_enabled)
      values (reactor.id, 'light', true)
    `);
    s.commitTransaction();

    // Send welcome email
    s.try({
      body: (s) => {
        s.sendEmail({
          to: sql`reactor.email`,
          subject: sql.lit`Welcome aboard!`,
          htmlBody: sql`'<p>Welcome, ' || reactor.name || '!</p>'`,
        });

        s.startTransaction();
        s.modify(sql`
          update db.users
          set onboarding_status = 'completed', welcome_email_sent_at = current_timestamp
          where id = reactor.id
        `);
        s.commitTransaction();
      },
      catch: (s) => {
        s.startTransaction();
        s.modify(sql`
          update db.users
          set onboarding_status = 'email_failed'
          where id = reactor.id
        `);
        s.commitTransaction();
      },
    });
  },
  maxConcurrent: 10,
});
```
