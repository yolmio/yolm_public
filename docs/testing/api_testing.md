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
webhooks, and integration boundaries. Always assert both the HTTP response and
the durable database side effects.

## Basic Request

```ts
s.request({
  uri: sql.lit`/api/orders`,
  method: "POST",
  headers: [
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

| Endpoint behavior | Assert |
| --- | --- |
| Success path | 2xx status, response body, created/updated database rows |
| Validation error | 400 status and stable error shape |
| Missing auth | 401 status |
| Wrong permission | 403 status |
| Not found | 404 status |
| Duplicate/idempotent request | same durable result and expected status |
| Webhook/signature failure | rejected status and no domain mutation |
| Reactor side effects | call `s.flushReactors()` before final assertions |

## Reusable Helpers

Keep helpers small and domain-specific.

```ts
import type { TestStatements } from "std/statements";
import { sql } from "std/sql_utils";

export function assertStatus(s: TestStatements, status: number) {
  s.assertEqual(sql`response.status`, sql`${status}`);
}

export function postJson(
  s: TestStatements,
  uri: string,
  body: Record<string, Sql>,
) {
  s.request({
    uri: sql.lit(uri),
    method: "POST",
    headers: [{ name: sql.lit`Content-Type`, value: sql.lit`application/json` }],
    json: body,
    defReceiveJson: "response_body",
    defResponseRecord: "response",
  });
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
const body = {
  external_id: sql.lit`EXT-123`,
  idempotency_key: sql.lit`KEY-001`,
};

postJson(s, "/api/orders", body);
assertStatus(s, 201);
s.defScalar("first_id", sql`response_body->>'id'`);

postJson(s, "/api/orders", body);
assertStatus(s, 200);
s.assertEqual(sql`response_body->>'id'`, sql`first_id`);
```

## Rules

- Use the current `s.request` shape: `uri`, `json`/`text`/`bytes`,
  `defReceiveJson`/`defReceiveText`/`defReceiveBytes` or a bounded Blob
  `receiveBody`, and
  `defResponseRecord`. The bare `receiveJson`/`receiveText`/`responseRecord`
  names seen in older tests are deprecated aliases of these.
- Do not build JSON with string concatenation; use SQL JSON helpers or the
  `json` object form.
- Assert persistent state, not only status codes.
- Keep auth tests explicit: unauthenticated, authenticated without permission,
  and authorized.
- Use realistic payloads for integration tests, but keep each test focused on
  one behavior.
