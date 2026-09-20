---
title: Test Utilities And Data
description: Patterns for compact Yolm test data setup with testDataProc, reusable helpers, deterministic time, scenario datasets, and focused assertions.
tags:
  - testing
  - test-data
  - utilities
  - patterns
related:
  - testing/overview.md
  - testing/test_statements.md
  - testing/assertions.md
  - testing/api_testing.md
---

# Test Utilities And Data

Use test utilities to make setup short and consistent. Keep helpers close to the
domain behavior under test; avoid large generic helper layers that hide the
important data shape.

## Data Sets

Define reusable datasets with `system.test.testDataProc`.

```ts
system.test.testDataProc(
  "minimal",
  new Date("2025-01-15T10:00:00-05:00"),
  (s) => {
    s.modify(sql`
      insert into db.customers (name, email)
      values ('Acme', 'ops@example.com')
    `);
  },
);
```

Use several named datasets instead of one huge fixture:

| Dataset | Use |
| --- | --- |
| `minimal` | fast unit/workflow tests |
| `users_and_roles` | auth/permission tests |
| `integration_config` | API/webhook/provider tests |
| `workflow_ready` | reactor and lifecycle tests |

## Helper Shape

Good helpers insert a small domain object and expose stable identifiers for
assertions.

```ts
import type { TestStatements } from "std/statements";
import { sql } from "std/sql_utils";

export function createOrder(
  s: TestStatements,
  opts: { reference: string; status?: string },
) {
  s.modify(sql`
    insert into db.orders (reference, status)
    values (${sql.lit(opts.reference)}, ${sql.lit(opts.status ?? "pending")})
  `);
  s.defScalar("order_id", sql`
    select id from db.orders where reference = ${sql.lit(opts.reference)}
  `);
}
```

Keep helpers deterministic: pass references, ids, dates, and statuses
explicitly instead of using `Date.now()` or random values.

## Scenario Test Pattern

```ts
system.test.test({
  name: "orders: confirm moves pending order to confirmed",
  data: "minimal",
  time: new Date("2025-01-15T10:00:00-05:00"),
  procedure: (s) => {
    createOrder(s, { reference: "ORD-001" });

    s.request({
      uri: sql.lit`/api/orders/confirm`,
      method: "POST",
      headers: [{ name: sql.lit`Host`, value: sql.lit`myapp.example.com` }],
      json: { reference: sql.lit`ORD-001` },
      defReceiveJson: "response_body",
      defResponseRecord: "response",
    });

    s.assertEqual(sql`response.status`, sql`200`);
    s.assertEqual(
      sql`(select status from db.orders where reference = 'ORD-001')`,
      sql`'confirmed'`,
    );
  },
});
```

Use `s.flushReactors()` before assertions when the action should trigger
reactor work.

## Utility Rules

- Prefer a few focused insert helpers over broad fixture builders.
- Use multi-row SQL inserts for static data.
- Freeze time with the test `time` field.
- Assert durable database state after calling helpers or APIs.
- Keep helper names domain-specific: `createPendingOrder`, `grantAdminRole`,
  `insertIntegrationConfig`.
- Avoid test utilities that reimplement production logic; call the production
  procedure/API when that is the behavior under test.
