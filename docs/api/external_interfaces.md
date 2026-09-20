---
title: External Interfaces
description: Patterns for Yolm APIs that exchange JSON, XML, text payloads, outbound HTTP requests, queue tables, retries, and audit logs.
tags:
  - api
  - integrations
  - xml
  - json
  - queues
related:
  - api/overview.md
  - api/files_blobs_exports.md
  - api/authentication.md
  - sql/json_functions.md
  - concepts/reactors.md
  - concepts/operational_systems.md
---

# External Interfaces

Use this guide for endpoints and reactors that integrate with outside systems:
JSON APIs, XML APIs, webhooks, batch pushes, retry queues, and response logs.
Design external interfaces for idempotency because partners, webhooks, and
network clients often retry the same request.

## Inbound Endpoint Shape

Define one API file per domain or integration surface. Use `prefix: ""` when
the external contract expects root-level paths, or `prefix: "/api"` for normal
application APIs.

```ts
import { sql } from "std/sql_utils";
import { system } from "std/system";

const api = system.api({ prefix: "" });

api.post("/orders", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.defScalar("external_id", sql`body->>'externalId'`);
    s.startTransaction();
    s.modify(sql`
      insert into db.inbound_orders (external_id, raw_payload, status)
      values (external_id, body, 'received')
    `);
    s.commitTransaction();
    s.return(sql`json_build_object('ok', true)`);
  },
});
```

Use `system.globalApi` for a system-wide endpoint that is not mounted on one
application domain. Its endpoint methods use the same typed request and
procedure helpers.

Use exactly one of `jsonBodyScalar`, `textBodyScalar`, `bytesBodyScalar`, or
`blobBody` per endpoint. Use `blobBody` for authenticated large uploads that
the platform should store before the procedure runs; the procedure receives a
blob hash rather than the raw bytes. Return JSON, text, bytes, or blobs
explicitly with endpoint helpers.
Use partner-provided ids or generated request ids for idempotency whenever an
external caller may retry the same operation.

## XML Payloads

Use text bodies for XML and convert to JSON for extraction:

```ts
api.post("/xml-order", {
  textBodyScalar: "xml_body",
  procedure: (s) => {
    s.defScalar("parsed", sql`xml_to_json(xml_body)`);
    s.defScalar("order_id", sql`parsed->'Order'->>'Id'`);
    s.return(sql`json.to_xml(json_build_object('Response', json_build_object(
      'Status', 'OK',
      'OrderId', order_id
    )))`);
  },
});
```

`xml.to_json(...)` and `xml_to_json(...)` are both accepted. `json.to_xml(...)`
and `json_to_xml(...)` are both accepted. Prefer `json.to_xml` for generated
XML so escaping is handled by SQL instead of string concatenation.

XML conversion maps attributes to keys prefixed with `@` and text content to
`#text`. Repeated elements become JSON arrays.

## Queue And Retry Tables

For outbound pushes or long-running inbound processing, write durable queue
rows first and let reactors process them:

```ts
db.table("interface_push_queue", (table) => {
  table.enum("status", "queue_status").notNull().default(sql.lit`pending`);
  table.string("interface_type", 50).notNull();
  table.json("payload").notNull();
  table.int("attempt_count").notNull().default(0);
  table.timestampUtc("next_attempt_at");
  table.text("last_error");
});
```

The reactor query should select only ready rows, update attempt state, and make
success or permanent failure visible in tables the UI can inspect.
Use unique external ids or queue keys to make processing idempotent.

## Outbound Requests

Use `s.request` in server procedures or reactors. Store response status/body
when the integration needs auditability or retries.

```ts
s.request({
  uri: sql`endpoint_url`,
  method: "POST",
  headers: [{ name: sql.lit`Content-Type`, value: sql.lit`application/xml` }],
  text: sql`request_xml`,
  defReceiveText: "response_text",
  defResponseRecord: "response",
});
```

Use only one scalar response destination, or use `receiveBody` with a bounded
`Blob` destination for a potentially large binary response. A blob destination
requires `maxBytes`, a non-empty `acceptedStatuses` list, and exactly one of
`scalar` or `setScalar`. Put network calls outside long database transactions
when possible; wrap database state updates before and after the request in
short transactions.

In preview/local-dev runs external services are gated; set `optIn` (a boolean
or `BooleanExpr`) on the request when the call should actually fire outside
production. See [Statements Reference](../procedures/statements_reference.md).

## Service Helper Expressions

`std/services` exports helpers for common HTTP integration shapes:

```ts
import {
  FORM_URL_ENCODED_HEADER,
  formUrlEncodedParams,
  localhostAwareScheme,
  queryParamsString,
} from "std/services";
```

- `queryParamsString({ key: value })` builds a percent-encoded query string
  without the leading `?`. Array values repeat the same key; `undefined` values
  are skipped.
- `formUrlEncodedParams({ key: value })` builds an
  `application/x-www-form-urlencoded` body.
- `FORM_URL_ENCODED_HEADER` is the matching `Content-Type` request header.
- `localhostAwareScheme(lowerHostExpr)` returns `http://` for localhost hosts
  and `https://` elsewhere; use it when building callback URLs that need to
  work in both local preview and deployed environments.

```ts
s.request({
  method: "POST",
  uri: sql`token_url`,
  headers: [FORM_URL_ENCODED_HEADER],
  text: formUrlEncodedParams({
    grant_type: sql.lit`authorization_code`,
    code: sql`oauth_code`,
    redirect_uri: sql`redirect_uri`,
  }),
  defReceiveJson: "token_response",
  defResponseRecord: "response",
});
```

## Audit And Replay

When an interface affects workflow state, store enough data to debug and replay:

- raw inbound payload and parsed identifiers,
- generated outbound payload,
- response body and status,
- linked internal record ids,
- attempt count, timestamps, and last error,
- activity log entries for user-visible lifecycle changes.

Do not let endpoint parsing, workflow transition, and outbound push logic become
one large procedure if they can be separated by durable staging or queue tables.
