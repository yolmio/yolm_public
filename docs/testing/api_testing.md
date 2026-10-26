---
title: API Testing
description: How to test Yolm HTTP APIs with s.request, JSON/text/bytes bodies, headers, response capture, auth errors, webhooks, and idempotency.
tags:
  - testing
  - api
  - http
  - integration
related:
  - testing/overview.md
  - testing/test_statements.md
  - api/overview.md
  - api/external_interfaces.md
---

# API Testing

```ts
import type { Sql } from "std/sql_utils";
```

Use `s.request(...)` in Yolm tests to exercise HTTP endpoints, auth behavior,
webhooks, and integration boundaries. Assert what the endpoint owns: its
response and the durable business changes it makes. Follow the
[test policy](../ai/review.md#tests).

## Basic Request

```ts
s.request({
  uri: sql.lit`/api/orders`,
  method: "POST",
  headers: [
    { name: sql.lit`Host`, value: sql.lit`myapp.example.com` },
    { name: sql.lit`Content-Type`, value: sql.lit`application/json` },
    { name: sql.lit`Authorization`, value: sql.lit`Bearer test-token` },
  ],
  json: {
    customer_id: sql`1`,
    notes: sql.lit`Rush order`,
  },
  defReceiveJson: "response_body",
  defResponseRecord: "response",
});

s.assertEqual(sql`response.status`, sql`201`);
s.assertEqual(sql`response_body->>'status'`, sql`'created'`);
```

Use `defReceiveText` or `defReceiveBytes` instead of `defReceiveJson` when the
endpoint returns scalar text or bytes. Use a bounded
`receiveBody: { type: "Blob", ... }` destination when exercising a large binary
response that should bypass procedure memory. Use `defResponseHeadersTable`
when header assertions matter.

Requests are routed by the `Host` header, not by the `uri` authority — use a
relative `uri` (`/api/...`) and set a `Host` header matching the app or API's
primary domain so the request reaches the right endpoint:

```ts
headers: [{ name: sql.lit`Host`, value: sql.lit`myapp.example.com` }],
```

## What To Test

Cover these behaviors only when this endpoint owns them and no existing test
already does. Shared mechanics, such as AuthBlock token and session
validation or unknown-route 404s, are tested once in their package or the
platform. The endpoint's own rejection branch, such as returning 401 when
`auth_user_id` is null, belongs to the endpoint.

| Endpoint behavior | Assert |
| --- | --- |
| Business rule on the success path | 2xx status and the business state the endpoint changes |
| Validation the endpoint implements | 400 status and no business change |
| Failure after a business write, before commit | expected error response, no partial business changes, exactly one durable failure record with the original error |
| Authentication check the endpoint implements | 401 status and no business change |
| Permission rule the endpoint implements | 403 status and no business change |
| Endpoint-specific not found (e.g. unknown reference in the body) | the endpoint's documented status |
| Duplicate/idempotent request | same durable result and expected status |
| Webhook/signature failure | rejected status and no domain mutation |
| Reactor side effects | call [`s.flushReactors()`](./test_statements.md#flushreactors) before final assertions |

## Reusable Helpers

When a transactional endpoint's failure handling needs a test, a
malformed-input case alone is insufficient: it may fail before a transaction
starts. Exercise an error inside the transaction, including a failing called
procedure when applicable, and extend the endpoint's existing test rather than
adding a file per case. Catching an error does not roll back; see
[transaction cleanup](../api/external_interfaces.md#transaction-cleanup-in-error-handlers).

Keep helpers small and domain-specific.

```ts
import type { TestStatements } from "std/statements";
import { sql } from "std/sql_utils";

// `name` prefixes the outputs so repeated calls in one block do not redeclare
// the same bindings.
export function postJson(
  s: TestStatements,
  name: string,
  uri: string,
  body: Record<string, Sql>,
) {
  s.request({
    uri: sql.lit(uri),
    method: "POST",
    headers: [
      { name: sql.lit`Host`, value: sql.lit`myapp.example.com` },
      { name: sql.lit`Content-Type`, value: sql.lit`application/json` },
    ],
    json: body,
    defReceiveJson: `${name}_body`,
    defResponseRecord: name,
  });
}

export function assertStatus(s: TestStatements, name: string, status: number) {
  s.assertEqual(sql`${sql.ref(name)}.status`, sql`${status}`);
}
```

Avoid helpers that hide important assertions. A test should still make the
expected status and database effect obvious.

## Webhook Pattern

```ts
s.request({
  uri: sql.lit`/api/webhooks/provider`,
  method: "POST",
  headers: [
    { name: sql.lit`Host`, value: sql.lit`myapp.example.com` },
    { name: sql.lit`Content-Type`, value: sql.lit`application/json` },
    { name: sql.lit`X-Webhook-Signature`, value: sql`valid_signature` },
  ],
  json: {
    external_id: sql.lit`EXT-123`,
    status: sql.lit`complete`,
  },
  defReceiveJson: "webhook_response",
  defResponseRecord: "webhook_http",
});

s.assertEqual(sql`webhook_http.status`, sql`200`);
s.flushReactors();
s.assertEqual(
  sql`(select status from db.orders where external_id = 'EXT-123')`,
  sql`'completed'`,
);
```

For signed requests, create the signature with the same SQL crypto function the
endpoint expects, then include it as a header.

## Idempotency Test

```ts
// The endpoint deduplicates on the partner's external_id.
const body = { external_id: sql.lit`EXT-123` };

postJson(s, "first", "/api/orders", body);
assertStatus(s, "first", 201);

postJson(s, "retry", "/api/orders", body);
assertStatus(s, "retry", 200);
s.assertEqual(sql`retry_body->>'id'`, sql`first_body->>'id'`);
```

## Rules

- Use the current `s.request` shape: `uri`, `json`/`text`/`bytes`,
  `defReceiveJson`/`defReceiveText`/`defReceiveBytes` or a bounded Blob
  `receiveBody`, and
  `defResponseRecord`. The bare `receiveJson`/`receiveText`/`responseRecord`
  names seen in older tests are deprecated aliases of these.
- Do not build JSON with string concatenation; use SQL JSON helpers or the
  `json` object form.
- Assert the persistent business state the endpoint changes, not only status
  codes.
- For authentication and permission checks the endpoint implements, cover a
  missing or invalid credential, a caller without permission, and an
  authorized caller.
- Use realistic payloads for integration tests, but keep each test focused on
  one behavior.
