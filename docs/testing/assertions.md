---
title: Assertions & Test Utilities
description: Custom assertion utilities and helper functions for domain-specific testing.
tags:
  - testing
  - assertions
  - utilities
---

# Assertions & Test Utilities

Beyond the built-in assertion methods, you can create domain-specific assertion utilities for cleaner, more maintainable tests.

## Built-in Assertions

### Basic Assertions

```typescript
// Equality
s.assertEqual(actual, expected, message?);
s.assertNotEqual(actual, expected, message?);

// Boolean condition
s.assert(condition, message?);
```

## Creating Custom Assertions

Keep helpers small and domain-specific, next to the procedure or API they
check. Do not build a generic layer of record-exists or row-count wrappers; a
plain `s.assert`/`s.assertEqual` is clearer (see
[Test Utilities](./test_utilities.md)). Assert outcomes of a real procedure or
API call, not that rows you just inserted or updated exist; see the
[test policy](../ai/review.md#tests).

### Pattern: Domain-Specific Assertions

Create assertions for your specific domain:

```typescript
// tests/utils/order_assertions.ts
import type { TestStatements } from "std/statements";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

// Order status assertions
export function assertOrderStatus(
  s: TestStatements,
  orderRef: string,
  expectedStatus: "pending" | "processing" | "completed" | "cancelled"
) {
  s.assertEqual(
    sql`(select status from db.orders where reference = ${sql.lit(orderRef)})`,
    sql.lit(expectedStatus),
    sql.lit`Order ${orderRef} should have status '${expectedStatus}'`
  );
}

// Order field assertions
export function assertOrderField(
  s: TestStatements,
  orderRef: string,
  field: string,
  expected: Sql
) {
  s.assertEqual(
    sql`(select ${sql.ref(field)} from db.orders where reference = ${sql.lit(orderRef)})`,
    expected
  );
}

export function assertOrderFieldNull(
  s: TestStatements,
  orderRef: string,
  field: string
) {
  s.assert(
    sql`(select ${sql.ref(field)} from db.orders where reference = ${sql.lit(orderRef)}) is null`,
    sql.lit`Order ${orderRef} field '${field}' should be null`
  );
}
```

## Using Custom Assertions

Import and use in your tests around the production call:

```typescript
import {
  assertOrderField,
  assertOrderStatus,
} from "./utils/order_assertions";

system.test({
  name: "orders: shipping a paid order records its tracking number",
  data: "paid_orders",
  time: new Date("2025-01-15T10:00:00-05:00"),
  procedure: (s) => {
    // TEST-001 is a paid, unshipped order in the "paid_orders" data set
    s.request({
      uri: sql.lit`/api/orders/ship`,
      method: "POST",
      headers: [{ name: sql.lit`Host`, value: sql.lit`myapp.example.com` }],
      json: { reference: sql.lit`TEST-001`, tracking_number: sql.lit`TRK-001` },
      defReceiveJson: "response_body",
      defResponseRecord: "response",
    });

    s.assertEqual(sql`response.status`, sql`200`);
    assertOrderStatus(s, "TEST-001", "completed");
    assertOrderField(s, "TEST-001", "tracking_number", sql.lit`TRK-001`);
  },
});
```

## Validation Assertions

Assert that invalid input is rejected and leaves no durable change. Check the
real tables rather than a separate validation-error table:

```typescript
// tests/utils/validation_assertions.ts
import type { TestStatements } from "std/statements";
import { sql } from "std/sql_utils";

export function assertOrderRejected(
  s: TestStatements,
  reference: string,
  expectedStatus = 400
) {
  s.assertEqual(
    sql`response.status`,
    sql`${expectedStatus}`,
    sql.lit`Invalid order ${reference} should be rejected`
  );
  s.assert(
    sql`not exists (select 1 from db.orders where reference = ${sql.lit(reference)})`,
    sql.lit`Rejected order ${reference} should not be stored`
  );
}
```

## API Response Assertions

```typescript
// tests/utils/api_assertions.ts

export function assertApiSuccess(s: TestStatements) {
  s.assert(
    sql`response.status >= 200 and response.status < 300`,
    sql`'API should return success status (got ' || response.status || ')'`
  );
}

export function assertApiError(s: TestStatements, expectedStatus: number) {
  s.assertEqual(
    sql`response.status`,
    sql`${expectedStatus}`,
    sql.lit`API should return ${expectedStatus}`
  );
}

export function assertApiResponseContains(
  s: TestStatements,
  path: string,
  expected: Sql
) {
  s.assertEqual(
    sql`response_body->>${sql.lit(path)}`,
    expected
  );
}
```

## Comparison Assertions

```typescript
// tests/utils/comparison_assertions.ts

export function assertGreaterThan(
  s: TestStatements,
  actual: Sql,
  threshold: Sql,
  message?: string
) {
  s.assert(
    sql`${actual} > ${threshold}`,
    sql.lit(message ?? "Value should be greater than threshold")
  );
}

export function assertBetween(
  s: TestStatements,
  actual: Sql,
  min: Sql,
  max: Sql,
  message?: string
) {
  s.assert(
    sql`${actual} between ${min} and ${max}`,
    sql.lit(message ?? "Value should be within range")
  );
}

export function assertDateWithin(
  s: TestStatements,
  actual: Sql,
  expected: Sql,
  toleranceMinutes: number
) {
  s.assert(
    sql`abs(extract(epoch from (${actual} - ${expected}))) < ${toleranceMinutes * 60}`,
    sql.lit`Date should be within ${toleranceMinutes} minutes`
  );
}
```

## Best Practices

### 1. Use Descriptive Messages

```typescript
// Good
s.assert(
  sql`order.total > 0`,
  sql`'Order total should be positive, got: ' || order.total`
);

// Bad
s.assert(sql`order.total > 0`);
```

### 2. Assert One Thing at a Time

```typescript
// Good - separate assertions
assertOrderStatus(s, ref, "completed");
assertOrderField(s, ref, "tracking_number", sql.lit`TRK-001`);

// Bad - combined assertion that's hard to debug
s.assert(sql`status = 'completed' and tracking_number = 'TRK-001'`);
```

### 3. Use Helper Functions for Complex Queries

```typescript
// Good - derive the total from line items once
function getOrderTotal(ref: string): Sql {
  return sql`(
    select sum(oi.quantity * oi.unit_price)
    from db.order_items oi
    join db.orders o on oi.order_id = o.id
    where o.reference = ${sql.lit(ref)}
  )`;
}
s.assertEqual(getOrderTotal("ORD-001"), sql`100.00`);

// Bad - the same derivation repeated inline in every test
s.assertEqual(
  sql`(
    select sum(oi.quantity * oi.unit_price)
    from db.order_items oi
    join db.orders o on oi.order_id = o.id
    where o.reference = 'ORD-001'
  )`,
  sql`100.00`,
);
```

## See Also

- [Testing Overview](./overview.md) - Introduction to Yolm testing
- [Test Statements](./test_statements.md) - TestStatements API reference
- [Test Utilities](./test_utilities.md) - Test data and helper patterns
