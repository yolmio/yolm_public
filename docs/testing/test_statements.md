---
title: Test Statements API
description: Reference for TestStatements methods used in Yolm tests, including SQL setup, assertions, requests, and reactor control.
tags:
  - testing
  - test-statements
---

# Test Statements API

```ts
import type { JsonBuildValue, Sql } from "std/sql_utils";
```

The `TestStatements` class extends `ServerStatementsBase` with test-specific methods for assertions, HTTP testing, and reactor management.

## Core Methods

### Database Operations

```typescript
// Execute SQL modification (insert, update, delete)
s.modify(sql`insert into db.users (name) values ('Test')`);

// Define a scalar value
s.defScalar("count", sql`(select count(*) from db.users)`);

// Define a record (single row)
s.defRecord("user_record", sql`select * from db.users where id = 1`);

// Define a table (multiple rows)
s.defTable("users", sql`select * from db.users where active = true`);
```

### Transactions and isolation

Each test runs against a fresh in-memory system. The runner executes the test's
data set, flushes reactors, and then runs the test procedure. Nothing is rolled
back between tests; the system is discarded when the test ends.

- `system.test.testDataProc` procedures run inside one implicit transaction that
  is committed when the procedure finishes, so they call `s.modify` directly.
- Test procedures start outside a transaction. Wrap every `s.modify` in
  `s.startTransaction()` / `s.commitTransaction()`; a write outside a
  transaction fails.

```typescript
s.startTransaction();
s.modify(sql`insert into db.orders (customer_id) values (1)`);
s.modify(sql`insert into db.order_items (order_id, product_id) values (1, 100)`);
s.commitTransaction();
```

Queries inside an open transaction see its uncommitted writes, so assertions can
run before the commit. Commit before `s.request(...)` or `s.flushReactors()`:
endpoints and reactors only observe committed data.

### setCurrentUser

Test procedures do not have an authenticated request user by default, so
`current_user` is null. Bind an explicit user when the code under test relies on
that value:

```typescript
s.setCurrentUser(sql`42`);

// approve_order only lets the order's assigned approver (user 42) approve it
s.startTransaction();
s.callStoredProcedure("approve_order", {
  inputScalars: { p_reference: sql.lit`ORD-001` },
});
s.commitTransaction();
s.assertEqual(
  sql`(select status from db.orders where reference = 'ORD-001')`,
  sql`'approved'`,
);
```

Call `setCurrentUser` before `startTransaction` when transaction operations
should record that user as `tx_creator`; changing the current user after a
transaction has started does not retroactively change its creator. Passing SQL
`null` clears the binding:

```typescript
s.setCurrentUser(sql`null`);
s.assert(sql`current_user is null`);
```

`s.request(...)` does not implicitly authenticate as this user. Configure the
request's authentication independently when testing an authenticated endpoint.

## Assertion Methods

### assertEqual

Assert two expressions are equal:

```typescript
s.assertEqual(
  sql`(select status from db.orders where id = 1)`,
  sql`'completed'`,
  sql.lit`Order should be completed`  // Optional message
);

// Works with scalars
s.defScalar("order_status", sql`(select status from db.orders where id = 1)`);
s.assertEqual(sql`order_status`, sql`'completed'`);
```

### assertNotEqual

Assert two expressions are not equal:

```typescript
s.assertNotEqual(
  sql`(select status from db.orders where id = 1)`,
  sql`'cancelled'`,
  sql.lit`Order should not be cancelled`
);
```

### assert

Assert a boolean condition:

```typescript
s.assert(
  sql`not exists (select 1 from db.order_lines where quantity <= 0)`,
  sql.lit`Order lines must have positive quantities`
);

s.assert(
  sql`not exists (select 1 from db.products where on_hand < 0)`,
  sql.lit`Shipping should never drive stock negative`
);
```

## HTTP Testing

### request

Make HTTP requests to test API endpoints:

```typescript
s.request({
  uri: sql.lit`/api/orders`,
  method: "POST",
  json: { customer_id: sql`1`, product_id: sql`100` },
  headers: [
    { name: sql.lit`Host`, value: sql.lit`myapp.example.com` },
    { name: sql.lit`Content-Type`, value: sql.lit`application/json` },
  ],
  defReceiveJson: "response_body",
  defResponseRecord: "response",
});

// Verify response
s.assertEqual(sql`response.status`, sql`201`);
s.assertEqual(
  sql`response_body->>'status'`,
  sql`'created'`
);
```

### Request Options

```typescript
interface RequestOpts {                 // Scalar response destinations
  uri: Sql;
  method?: Sql | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: { name: Sql; value: Sql }[];
  json?: Partial<Record<string, JsonBuildValue>> | JsonBuildValue[] | Sql;
                                      // Send a JSON object, array, or scalar
  text?: Sql;                          // Send text body
  bytes?: Sql;                         // Send bytes body
  defReceiveJson?: string;             // Define response JSON scalar
  defReceiveText?: string;             // Define response text scalar
  defReceiveBytes?: string;            // Define response bytes scalar
  defResponseRecord?: string;          // Define record with status field
  defResponseHeadersTable?: string;    // Define table with name/value columns
}

interface RequestWithReceiveBodyOpts { // Tagged response destination
  uri: Sql;
  method?: Sql | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  receiveBody:
    | {
      type: "Blob";
      scalar: string;
      setScalar?: never;
      maxBytes: number;
      acceptedStatuses: [number, ...number[]];
    }
    | {
      type: "Blob";
      scalar?: never;
      setScalar: string;
      maxBytes: number;
      acceptedStatuses: [number, ...number[]];
    };
  defResponseRecord?: string;          // Define record with status field
  defResponseHeadersTable?: string;    // Define table with name/value columns
}

// request() accepts RequestOpts | RequestWithReceiveBodyOpts.
```

### request + assertions

Compose `request()` with explicit assertions:

```typescript
s.request({
  uri: sql.lit`/api/orders`,
  method: "POST",
  headers: [
    { name: sql.lit`Host`, value: sql.lit`myapp.example.com` },
    { name: sql.lit`Authorization`, value: sql.lit`Bearer token123` },
  ],
  json: { customer_id: 1 },
  defReceiveJson: "response_body",
  defResponseRecord: "response",
});

s.assertEqual(sql`response.status`, sql`201`);
s.assertEqual(
  sql`response_body`,
  sql.jsonBuildObject({ status: "created" }),
);
```

## Reactor Management

### flushReactors

Reactors do not run on their own during a test; the runner only flushes them
after the data set and after the test procedure finishes. Without a flush, an
assertion that follows a triggering commit runs before any reactor has reacted
and fails.

`s.flushReactors()` runs pending reactor work to completion, including reactors
triggered by other reactors' commits, before the next statement. Commit first:
reactors only see committed transactions.

```typescript
s.startTransaction();
s.modify(sql`insert into db.new_orders (reference) values ('ORD-001')`);
s.commitTransaction();

// Process any reactors triggered by the insert
s.flushReactors();

// Now verify the results of reactor processing
s.assertEqual(
  sql`(select status from db.orders where reference = 'ORD-001')`,
  sql`'processed'`
);
```

Call it after any committed change that triggers reactors (import processing,
automation, notifications) and before asserting on the reactor's effects.

### runScheduledProc

Run a specific scheduled procedure:

```typescript
// Run a specific scheduled procedure. The name is a SQL string expression,
// so it must be quoted inside the JS string.
s.runScheduledProc("'nightly_billing'");

// Run all scheduled procedures
s.runScheduledProc();
```

### disableReactor / enableReactor

Control reactor execution during tests:

```typescript
// Disable a reactor. Like runScheduledProc, the name is a SQL string
// expression and uses the reactor's `group/name` path.
s.disableReactor("'notifications/send_emails'");

// ... perform test actions ...

// Re-enable it
s.enableReactor("'notifications/send_emails'");
```

## Query Testing

### assert query outcomes with SQL

Assert query results with ordinary SQL expressions:

```typescript
s.assertEqual(
  sql`(select count(*) from db.orders where status = 'completed')`,
  sql`1`
);
```

## Control Flow

### if / else

Conditional test logic:

```typescript
s.if(sql`(select count(*) from db.orders) > 0`, (s) => {
  // Test order-specific behavior
  s.assertEqual(sql`...`, sql`...`);
});

s.if(sql`feature_enabled`,
  (s) => {
    // Feature is enabled
  },
  (s) => {
    // Feature is disabled (else branch)
  }
);
```

### forEach

Iterate over table rows:

```typescript
s.defTable("pending_orders", sql`select * from db.orders where status = 'pending'`);

s.forEachTable("pending_orders", "order", (s) => {
  s.assertEqual(sql`order.verified`, sql`false`);
});
```

## Debug Methods

### debugExpr

Log expression values during test execution:

```typescript
s.debugExpr(sql`'Order count: ' || (select count(*) from db.orders)`);
```

### debugQuery

Log query results:

```typescript
s.debugQuery(sql`select * from db.orders where status = 'failed'`);
```

## Complete Example

```typescript
system.test({
  name: "order lifecycle: creation to completion",
  data: "orders",
  time: new Date("2025-01-15T10:00:00-05:00"),
  procedure: (s) => {
    // Create test order
    s.startTransaction();
    s.modify(sql`
      insert into db.orders (customer_id, status)
      values (1, 'pending')
    `);
    s.commitTransaction();

    s.defScalar("order_id", sql`(select id from db.orders order by id desc limit 1)`);

    // Process order via API
    s.request({
      uri: sql`'/api/orders/' || order_id || '/process'`,
      method: "POST",
      headers: [{ name: sql.lit`Host`, value: sql.lit`myapp.example.com` }],
      json: { action: sql.lit`approve` },
      defReceiveJson: "response_body",
      defResponseRecord: "response",
    });

    s.assertEqual(sql`response.status`, sql`200`);

    // Flush any async processing
    s.flushReactors();

    // Verify final state
    s.assertEqual(
      sql`(select status from db.orders where id = order_id)`,
      sql`'completed'`
    );
  },
});
```

## See Also

- [Testing Overview](./overview.md) - Introduction to Yolm testing
- [Assertions](./assertions.md) - Custom assertion utilities
- [API Testing](./api_testing.md) - Testing HTTP endpoints
