---
title: Testing Overview
description: Comprehensive guide to Yolm's built-in testing framework for database-first testing with SQL assertions.
tags:
  - testing
  - test-framework
  - assertions
  - api-testing
---

# Testing Overview

Yolm provides a built-in testing framework with complete SQL control over
database state. TypeScript registers tests at generation time. Forge validates
the generated definitions and runs the registered tests against an isolated
test environment.

## Key Concepts

### Generation-Time Registration

Unlike traditional test frameworks, Yolm test definitions are generated with
the system and executed through the compiler's explicit test mode:

- TypeScript registers tests at generation time.
- Forge runs the registered test procedures and reports pass/fail results.
- Full database control with SQL expressions
- Type-safe test definitions in TypeScript
- Tests included in build output

### Automatic Isolation

Each test runs against its own fresh in-memory system:

- The test's data set runs first, then the test procedure
- Nothing is rolled back; the whole system is discarded after the test
- No manual cleanup needed
- Tests can't affect each other

Writes inside a test procedure still need explicit transactions; see
[Transactions and isolation](./test_statements.md#transactions-and-isolation).

### Deterministic Testing

Tests support frozen time and seeding:

- Specify exact timestamps for reproducible results
- Optional random seeds for consistent behavior
- No flaky tests from time-dependent logic

## Quick Start

Test production behavior that nothing else covers: call the real procedure or
API and assert the business outcome or rejection. Do not assert fixture
contents or that an insert you just made exists. See the
[test policy](../ai/review.md#tests).

```typescript
import { system } from "std/system";
import { sql } from "std/sql_utils";

// Define test data set: limited stock and two orders against it
system.test.testDataProc("orders", new Date("2025-01-15T10:00:00-05:00"), (s) => {
  s.modify(sql`insert into db.products (sku, on_hand) values ('WIDGET', 5)`);
  s.modify(sql`
    insert into db.orders (reference, status)
    values ('ORD-001', 'open'), ('ORD-002', 'open')
  `);
  s.modify(sql`
    insert into db.order_lines (order_id, product_id, quantity)
    select o.id, p.id, case o.reference when 'ORD-001' then 3 else 10 end
    from db.orders o, db.products p
  `);
});

// Register a test
system.test({
  name: "ship_order decrements stock and refuses to oversell",
  data: "orders",  // Reference to data set
  time: new Date("2025-01-15T10:00:00-05:00"),
  procedure: (s) => {
    // Call the production procedure
    s.startTransaction();
    s.callStoredProcedure("ship_order", {
      inputScalars: { p_reference: sql.lit`ORD-001` },
    });
    s.commitTransaction();
    s.assertEqual(sql`(select on_hand from db.products where sku = 'WIDGET')`, sql`2`);

    // Shipping 10 with 2 on hand is rejected and changes nothing. ship_order
    // rejects with s.throwError(sql.lit`insufficient_stock`), a stable code.
    s.defScalar("rejection", sql`cast(null as string)`);
    s.try({
      body: (s) => {
        s.startTransaction();
        s.callStoredProcedure("ship_order", {
          inputScalars: { p_reference: sql.lit`ORD-002` },
        });
        s.commitTransaction();
      },
      errorName: "ship_error",
      catch: (s) => {
        s.rollbackIfInTransaction();
        s.setScalar("rejection", sql`ship_error.message`);
      },
    });
    s.assertEqual(sql`rejection`, sql`'insufficient_stock'`);
    s.assertEqual(sql`(select on_hand from db.products where sku = 'WIDGET')`, sql`2`);
  },
});
```

## Test Registration API

`system.test` is callable. Register tests with one of three forms:

```typescript
// Name and procedure; uses system.test.defaultTime and defaultData
system.test("ship_order refuses to oversell", (s) => { /* ... */ });

// Name, options, and procedure
system.test("ship_order refuses to oversell", { data: "orders" }, (s) => { /* ... */ });

// Full configuration object
system.test({ name: "ship_order refuses to oversell", data: "orders", procedure: (s) => { /* ... */ } });
```

`system.test.test(...)` is an alias with the same overloads; prefer calling
`system.test(...)` directly. Every test needs a time and a data set, either
passed explicitly or supplied by `system.test.defaultTime` and
`system.test.defaultData`.

### system.test.testDataProc

Define a named test data set that can be referenced by multiple tests:

```typescript
system.test.testDataProc(
  name: string,           // Data set name
  time: Date | string,    // Frozen time for data setup
  procedure: BasicStatementsOrFn
)
```

The data procedure runs inside one implicit transaction that is committed when
it finishes, so it does not call `startTransaction()`.

### system.test

Register an individual test with the full configuration object:

```typescript
system.test({
  name: string,           // Test name (required)
  time?: Date | string,   // Optional frozen time; falls back to defaultTime
  data?: string,          // Optional test data set; falls back to defaultData
  seed?: number,          // Optional random seed
  skip?: boolean,         // Skip this test
  only?: boolean,         // Run only this test
  procedure: TestStatementsOrFn,  // Test procedure
})
```

## Running Tests

Use native Forge `validate({ include: ["tests"] })` to check test definitions
without executing them (bare `validate()` skips them), and native
`runTests({ filters })` to run a focused selection. Omit the filter
for the broader suite. When using external Forge MCP `exec`, pass a persisted
non-nil `requestId` to the asynchronous `runTests` call and poll its returned
run ID with `getTestRun`. A filter that selects no tests is unfinished
validation, not a passing run. Inspect diagnostics and debug output for
failures.

For browser-facing tests, use a disposable Forge preview and exercise the
workflow with `previewScript`; see [Forge testing](../ai/forge_testing.md).
Forge supplies the documentation index used by `readFile("docs/...")`.

## Testing with Reactors

Reactors do not run on their own during a test. After committing a change that
should trigger reactor work, call `s.flushReactors()` before asserting on the
result. See [flushReactors](./test_statements.md#flushreactors) for the
details.

## Related Documentation

- [Test Statements](./test_statements.md) - TestStatements API reference
- [Assertions](./assertions.md) - Assertion utilities and patterns
- [Test Utilities](./test_utilities.md) - Helper functions and data management
- [API Testing](./api_testing.md) - Testing HTTP APIs and endpoints
