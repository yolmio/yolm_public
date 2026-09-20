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

Each test runs in its own isolated environment:

- Transaction-based isolation
- Automatic rollback after each test
- No manual cleanup needed
- Tests can't affect each other

### Deterministic Testing

Tests support frozen time and seeding:

- Specify exact timestamps for reproducible results
- Optional random seeds for consistent behavior
- No flaky tests from time-dependent logic

## Quick Start

```typescript
import { system } from "std/system";
import { sql } from "std/sql_utils";

// Define test data set
system.test.testDataProc("basic", new Date("2025-01-15T10:00:00-05:00"), (s) => {
  s.modify(sql`
    INSERT INTO db.users (name, email, created_at)
    VALUES ('Test User', 'test@example.com', NOW())
  `);
});

// Register a test
system.test.test({
  name: "user creation works",
  data: "basic",  // Reference to data set
  time: new Date("2025-01-15T10:00:00-05:00"),
  procedure: (s) => {
    // Verify data exists
    s.assertEqual(
      sql`(SELECT COUNT(*) FROM db.users WHERE email = 'test@example.com')`,
      sql`1`,
    );
  },
});
```

## Test Registration API

`system.test` is callable. The common form in real tests is the direct call
`system.test("name", (s) => { ... })`; the object form
`system.test.test({ name, data, time, procedure })` is equivalent and reads
better when you set many options.

```typescript
// Direct call (most common)
system.test("user creation works", (s) => { /* ... */ });

// Direct call with options
system.test("user creation works", { data: "basic" }, (s) => { /* ... */ });
```

### system.test.testDataProc

Define a named test data set that can be referenced by multiple tests:

```typescript
system.test.testDataProc(
  name: string,           // Data set name
  time: Date,             // Frozen time for data setup
  procedure: BasicStatementsOrFn
)
```

### system.test.test

Register an individual test:

```typescript
system.test.test({
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

Use native Forge `validate()` to check test definitions without executing them
and native `runTests({ filters })` to run a focused selection. Omit the filter
for the broader suite. When using external Forge MCP `exec`, pass a persisted
non-nil `requestId` to the asynchronous `runTests` call and poll its returned
run ID with `getTestRun`. A filter that selects no tests is unfinished
validation, not a passing run. Inspect diagnostics and debug output for
failures.

For browser-facing tests, use a disposable Forge preview and exercise the
workflow with `previewScript`; see [Forge testing](../ai/forge_testing.md).
Forge supplies the documentation index used by `readFile("docs/...")`.

## Testing with Reactors

When tests involve reactors, use `flushReactors()` to ensure reactor processing completes before assertions:

```typescript
system.test.test({
  name: "E2E: API submission through import to dispatch",
  time: new Date("2025-01-15T10:00:00-05:00"),
  data: "master",
  procedure: (s) => {
    s.startTransaction();

    // Insert order that triggers import reactor
    s.modify(sql`
      INSERT INTO db.new_orders (
        internal_id, client_id, reference, first_name, last_name,
        search_type, jurisdiction_id, status
      ) VALUES (
        random.uuid(),
        (SELECT id FROM db.clients WHERE acronym = 'CHEC'),
        'E2E-TEST-001',
        'John',
        'Smith',
        'felony_misdemeanor',
        (SELECT id FROM db.jurisdictions WHERE code = 'LA'),
        'new'
      )
    `);

    s.commitTransaction();

    // CRITICAL: Flush reactors to process the import
    s.flushReactors();

    // Now verify reactor processed the order
    s.assertEqual(
      sql`(SELECT COUNT(*) FROM db.orders WHERE reference = 'E2E-TEST-001')`,
      sql`1`,
    );

    // Verify order was normalized properly
    s.assertEqual(
      sql`(SELECT first_name FROM db.orders WHERE reference = 'E2E-TEST-001')`,
      sql.lit`JOHN`,
    );

    // Verify order status changed (by reactor)
    s.assertEqual(
      sql`(SELECT status FROM db.orders WHERE reference = 'E2E-TEST-001')`,
      sql`'dispatched'::enums.order_status`,
    );
  },
});
```

### Why flushReactors is Needed

Reactors are asynchronous. Without `flushReactors()`:

1. Your insert/update completes
2. Test continues to assertions
3. Reactors haven't run yet
4. Assertions fail because expected changes haven't happened

With `flushReactors()`:

1. Your insert/update completes
2. `flushReactors()` forces all pending reactor work to complete
3. Test continues to assertions
4. Assertions pass because reactor changes are applied

## Related Documentation

- [Test Statements](./test_statements.md) - TestStatements API reference
- [Assertions](./assertions.md) - Assertion utilities and patterns
- [Test Utilities](./test_utilities.md) - Helper functions and data management
- [API Testing](./api_testing.md) - Testing HTTP APIs and endpoints
