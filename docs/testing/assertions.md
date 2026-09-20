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

### Pattern: Assertion Utilities Module

Create a dedicated assertions file:

```typescript
// tests/utils/assertions.ts
import type { TestStatements } from "std/statements";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

// Record existence assertions
export function assertRecordExists(
  s: TestStatements,
  table: string,
  condition: Sql,
  message?: string
) {
  s.assert(
    sql`EXISTS (SELECT 1 FROM db.${sql.ref(table)} WHERE ${condition})`,
    sql.lit(message ?? `Expected record in ${table}`)
  );
}

export function assertRecordNotExists(
  s: TestStatements,
  table: string,
  condition: Sql,
  message?: string
) {
  s.assert(
    sql`NOT EXISTS (SELECT 1 FROM db.${sql.ref(table)} WHERE ${condition})`,
    sql.lit(message ?? `Expected no record in ${table}`)
  );
}

// Count assertions
export function assertCount(
  s: TestStatements,
  table: string,
  condition: Sql,
  expected: number,
  message?: string
) {
  s.assertEqual(
    sql`(SELECT COUNT(*) FROM db.${sql.ref(table)} WHERE ${condition})`,
    sql`${expected}`,
    sql.lit(message ?? `Expected ${expected} records`)
  );
}
```

### Pattern: Domain-Specific Assertions

Create assertions for your specific domain:

```typescript
// tests/utils/order_assertions.ts
import type { TestStatements } from "std/statements";
import { sql } from "std/sql_utils";

// Order status assertions
export function assertOrderStatus(
  s: TestStatements,
  orderRef: string,
  expectedStatus: "pending" | "processing" | "completed" | "cancelled"
) {
  s.assertEqual(
    sql`(SELECT status FROM db.orders WHERE reference = ${sql.lit(orderRef)})`,
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
    sql`(SELECT ${sql.ref(field)} FROM db.orders WHERE reference = ${sql.lit(orderRef)})`,
    expected
  );
}

export function assertOrderFieldNull(
  s: TestStatements,
  orderRef: string,
  field: string
) {
  s.assert(
    sql`(SELECT ${sql.ref(field)} FROM db.orders WHERE reference = ${sql.lit(orderRef)}) IS NULL`,
    sql.lit`Order ${orderRef} field '${field}' should be null`
  );
}

// Order existence
export function assertOrderCreated(s: TestStatements, reference: string) {
  s.assert(
    sql`EXISTS (SELECT 1 FROM db.orders WHERE reference = ${sql.lit(reference)})`,
    sql.lit`Order ${reference} should exist`
  );
}

export function assertOrderNotCreated(s: TestStatements, reference: string) {
  s.assert(
    sql`NOT EXISTS (SELECT 1 FROM db.orders WHERE reference = ${sql.lit(reference)})`,
    sql.lit`Order ${reference} should not exist`
  );
}

// Related records
export function assertOrderHasItems(
  s: TestStatements,
  orderRef: string,
  expectedCount: number
) {
  s.assertEqual(
    sql`(SELECT COUNT(*) FROM db.order_items oi
         JOIN db.orders o ON oi.order_id = o.id
         WHERE o.reference = ${sql.lit(orderRef)})`,
    sql`${expectedCount}`,
    sql.lit`Order ${orderRef} should have ${expectedCount} items`
  );
}
```

### Pattern: Status Transition Assertions

```typescript
// tests/utils/status_assertions.ts

export function assertStatusTransition(
  s: TestStatements,
  table: string,
  recordId: Sql,
  fromStatus: string,
  toStatus: string
) {
  // Verify initial status
  s.assertEqual(
    sql`(SELECT status FROM db.${sql.ref(table)} WHERE id = ${recordId})`,
    sql.lit(fromStatus),
    sql.lit`Should start in '${fromStatus}' status`
  );

  // ... trigger transition ...

  // Verify final status
  s.assertEqual(
    sql`(SELECT status FROM db.${sql.ref(table)} WHERE id = ${recordId})`,
    sql.lit(toStatus),
    sql.lit`Should end in '${toStatus}' status`
  );
}
```

### Pattern: Audit Log Assertions

```typescript
// tests/utils/audit_assertions.ts

export function assertActivityLogExists(
  s: TestStatements,
  entityType: string,
  entityId: Sql,
  action: string,
  contentPattern?: string
) {
  if (contentPattern) {
    s.assert(
      sql`EXISTS (
        SELECT 1 FROM db.activity_log
        WHERE entity_type = ${sql.lit(entityType)}
          AND entity_id = ${entityId}
          AND action = ${sql.lit(action)}
          AND content LIKE ${sql.lit(`%${contentPattern}%`)}
      )`,
      sql.lit`Activity log should contain '${action}' with '${contentPattern}'`
    );
  } else {
    s.assert(
      sql`EXISTS (
        SELECT 1 FROM db.activity_log
        WHERE entity_type = ${sql.lit(entityType)}
          AND entity_id = ${entityId}
          AND action = ${sql.lit(action)}
      )`,
      sql.lit`Activity log should contain '${action}'`
    );
  }
}

export function assertActivityLogCount(
  s: TestStatements,
  entityType: string,
  entityId: Sql,
  expectedCount: number
) {
  s.assertEqual(
    sql`(SELECT COUNT(*) FROM db.activity_log
         WHERE entity_type = ${sql.lit(entityType)}
           AND entity_id = ${entityId})`,
    sql`${expectedCount}`
  );
}
```

## Using Custom Assertions

Import and use in your tests:

```typescript
import * as assert from "./utils/assertions";
import * as orderAssert from "./utils/order_assertions";

system.test.test({
  name: "order workflow: complete order creates audit trail",
  data: "orders",
  time: new Date("2025-01-15T10:00:00-05:00"),
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`INSERT INTO db.orders (reference, status) VALUES ('TEST-001', 'pending')`);
    s.commitTransaction();

    // Use domain assertions
    orderAssert.assertOrderCreated(s, "TEST-001");
    orderAssert.assertOrderStatus(s, "TEST-001", "pending");

    // Process order
    s.modify(sql`UPDATE db.orders SET status = 'completed' WHERE reference = 'TEST-001'`);

    // Verify result
    orderAssert.assertOrderStatus(s, "TEST-001", "completed");

    // Check audit
    s.defScalar("order_id", sql`(SELECT id FROM db.orders WHERE reference = 'TEST-001')`);
    assert.assertActivityLogExists(s, "order", sql`order_id`, "status_changed");
  },
});
```

## Validation Assertions

For testing input validation:

```typescript
// tests/utils/validation_assertions.ts

export function assertValidationError(
  s: TestStatements,
  recordId: Sql,
  field: string,
  expectedError: string
) {
  s.assert(
    sql`EXISTS (
      SELECT 1 FROM db.validation_errors
      WHERE record_id = ${recordId}
        AND field = ${sql.lit(field)}
        AND message LIKE ${sql.lit(`%${expectedError}%`)}
    )`,
    sql.lit`Should have validation error on '${field}': ${expectedError}`
  );
}

export function assertNoValidationErrors(s: TestStatements, recordId: Sql) {
  s.assertEqual(
    sql`(SELECT COUNT(*) FROM db.validation_errors WHERE record_id = ${recordId})`,
    sql`0`,
    sql.lit`Should have no validation errors`
  );
}
```

## API Response Assertions

```typescript
// tests/utils/api_assertions.ts

export function assertApiSuccess(s: TestStatements) {
  s.assert(
    sql`response.status >= 200 AND response.status < 300`,
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
    sql`${actual} BETWEEN ${min} AND ${max}`,
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
    sql`ABS(EXTRACT(EPOCH FROM (${actual} - ${expected}))) < ${toleranceMinutes * 60}`,
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
orderAssert.assertOrderStatus(s, ref, "completed");
orderAssert.assertOrderField(s, ref, "completed_at", sql`NOW()`);

// Bad - combined assertion that's hard to debug
s.assert(sql`status = 'completed' AND completed_at IS NOT NULL`);
```

### 3. Use Helper Functions for Complex Queries

```typescript
// Good
function getOrderTotal(ref: string): Sql {
  return sql`(SELECT total FROM db.orders WHERE reference = ${sql.lit(ref)})`;
}
s.assertEqual(getOrderTotal("ORD-001"), sql`100.00`);

// Bad - repeated complex SQL
s.assertEqual(sql`(SELECT total FROM db.orders WHERE reference = 'ORD-001')`, sql`100.00`);
```

## See Also

- [Testing Overview](./overview.md) - Introduction to Yolm testing
- [Test Statements](./test_statements.md) - TestStatements API reference
- [Test Utilities](./test_utilities.md) - Test data and helper patterns
