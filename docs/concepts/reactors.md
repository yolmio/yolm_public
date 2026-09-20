---
title: Reactors
description: How to use Yolm reactors for background automation, PerRecord and Batch mode processing, maxConcurrent worker limits, idempotent queues, derived data, and notifications.
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
- Syncing data between tables
- Sending notifications when conditions are met
- Maintaining derived/computed data
- Background processing queues

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
    // 'reactor' contains a single row
    s.startTransaction();

    // Send email
    s.sendEmail({
      to: sql`reactor.email`,
      subject: sql.lit`Welcome!`,
      htmlBody: sql`'<p>Welcome, ' || reactor.name || '!</p>'`,
    });

    // Mark as sent
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

### Batch Mode

Without `recordName`, the procedure executes once with all matching rows
available in the `reactor` table:

```typescript
system.addReactor({
  name: "update_statistics",
  query: sql`
    select category_id, count(*) as product_count, avg(price) as avg_price
    from db.products
    where updated_at > (select last_run from db.stat_runs order by last_run desc limit 1)
    group by category_id
  `,
  procedure: (s) => {
    // 'reactor' is a table with all matching rows
    s.startTransaction();

    s.modify(sql`
      merge into db.category_stats
      using reactor on db.category_stats.category_id = reactor.category_id
      when matched then
        update set product_count = reactor.product_count, avg_price = reactor.avg_price
      when not matched then
        insert (category_id, product_count, avg_price)
        values (reactor.category_id, reactor.product_count, reactor.avg_price)
    `);

    s.modify(sql`insert into db.stat_runs (last_run) values (current_timestamp)`);

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
    insert into db.audit_log (user_id, action)
    values (reactor.id, 'processed')
  `);
}
```

### In Batch Mode

Query the `reactor` table:

```typescript
procedure: (s) => {
  s.modify(sql`
    insert into db.processed_items (item_id, processed_at)
    select id, current_timestamp from reactor
  `);

  s.defScalar("count", sql`select count(*) from reactor`);
}
```

## Common Patterns

### Data Synchronization

Keep tables in sync automatically:

```typescript
system.addReactor({
  name: "sync_user_profiles",
  query: sql`
    select u.id, u.name, u.email
    from db.users u
    left join db.user_profiles p on u.id = p.user_id
    where p.user_id is null or u.updated_at > p.synced_at
  `,
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      merge into db.user_profiles
      using reactor on db.user_profiles.user_id = reactor.id
      when matched then
        update set name = reactor.name, email = reactor.email, synced_at = current_timestamp
      when not matched then
        insert (user_id, name, email, synced_at)
        values (reactor.id, reactor.name, reactor.email, current_timestamp)
    `);
    s.commitTransaction();
  },
});
```

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
    s.startTransaction();

    // Create alert record
    s.modify(sql`
      insert into db.stock_alerts (product_id, quantity, threshold, created_at)
      values (reactor.id, reactor.stock_quantity, reactor.reorder_threshold, current_timestamp)
    `);

    // Send notification email
    s.sendEmail({
      to: sql.lit`inventory@example.com`,
      subject: sql`'Low stock alert: ' || reactor.name`,
      htmlBody: sql`'<p>Product ' || reactor.name || ' has ' || reactor.stock_quantity || ' units remaining.</p>'`,
    });

    s.commitTransaction();
  },
  maxConcurrent: 10,
});
```

### Computed Fields

Maintain computed/derived data:

```typescript
system.addReactor({
  name: "update_order_totals",
  query: sql`
    select
      o.id,
      sum(oi.quantity * oi.unit_price) as computed_total
    from db.orders o
    join db.order_items oi on o.id = oi.order_id
    where o.total != sum(oi.quantity * oi.unit_price)
    group by o.id
  `,
  recordName: "reactor",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      update db.orders
      set total = reactor.computed_total
      where id = reactor.id
    `);
    s.commitTransaction();
  },
});
```

## Runtime Control

### Disabling Reactors

Temporarily stop a reactor from processing:

```typescript
// In a procedure
s.disableReactor("process_new_orders");
```

### Enabling Reactors

Re-enable a disabled reactor:

```typescript
s.enableReactor("process_new_orders");
```

### Flushing Reactors

Force all pending reactor work to execute immediately:

```typescript
s.flushReactors();
```

## Testing Reactors

In tests, use `flushReactors` to ensure reactors have processed:

```typescript
// Insert data that triggers the reactor
s.modify(sql`insert into db.orders (customer_id, status) values (1, 'pending')`);

// Force reactors to run
s.flushReactors();

// Verify reactor processed the data
s.assert(sql`exists (select 1 from db.orders where status = 'processing')`);
```

## Best Practices

1. **Idempotency**: Design reactor procedures to be safe to run multiple times
2. **Query efficiency**: Keep reactor queries focused and filter as early as possible
3. **Concurrency limits**: Set appropriate `maxConcurrent` for resource-intensive operations
4. **Error handling**: Use try/catch to handle failures gracefully
5. **State tracking**: Include processed/synced timestamps to avoid reprocessing
6. **Transactions**: Wrap database modifications in transactions
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
