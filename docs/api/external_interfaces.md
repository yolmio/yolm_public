---
title: External Interfaces
description: Patterns for Yolm APIs that exchange JSON, XML, and text payloads, make outbound HTTP requests, retry through outboxes, and audit via transaction history.
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
  - concepts/outbox.md
  - sql/transaction_queries.md
  - concepts/operational_systems.md
---

# External Interfaces

Use this guide for endpoints and reactors that integrate with outside systems:
JSON APIs, XML APIs, webhooks, batch pushes, retry queues, and response logs.
When partners, webhooks, or network clients can redeliver the same request,
make the interface idempotent; a natural business key often suffices.

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
      insert into db.orders (external_id, customer_name)
      values (external_id, body->>'customerName')
      on conflict (external_id) do nothing
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
Use partner-provided ids or generated request ids for idempotency only when an
external caller may redeliver the same operation; a unique business key such as
the partner's order id usually serves.

## Transaction Cleanup In Error Handlers

A caught error does **not** roll back an active transaction. If the protected
body starts a transaction, or calls work within one, its catch handler can run
before the commit. Starting another transaction to log the error then raises
`TransactionAlreadyStarted`, masking the original failure and losing the error
record.

At an endpoint-owned transaction boundary, call `s.rollbackIfInTransaction()`
first in the catch handler, before invoking a logging helper or starting its
transaction:

```ts
s.try({
  body: (s) => {
    s.startTransaction();
    // Validate and write the business changes, including stored-procedure calls.
    s.modify(sql`insert into db.orders (external_id, customer_name)
      values (external_id, body->>'customerName')`);
    s.commitTransaction();
  },
  errorName: "inbound_error",
  catch: (s) => {
    s.rollbackIfInTransaction();
    s.startTransaction();
    // Use the integration's existing failure-recording table/helper.
    s.modify(sql`insert into db.interface_errors (message)
      values (inbound_error.message)`);
    s.commitTransaction();
    s.setHttpStatus(sql`500`);
    s.return(sql`json_build_object('error', 'Request failed')`);
  },
});
```

Adapt table names and response shape to the integration contract; do not expose
internal error details to untrusted clients. Conditional rollback also handles
failures before a transaction starts. Never commit partial business changes just
to make error logging work. A `transaction: "caller"` stored procedure must not
take over transaction cleanup: propagate its error to the owning caller.

Review shared catch/logging helpers as well as the endpoint body. Verify a
failure **after a business write but before commit**: the expected response,
no partial business effects, and exactly one durable error record preserving
the original failure. This record is legitimate rather than a duplicate log:
rolled-back requests never reach transaction history. Commit a test for this
only when fixing a real bug or covering behavior nothing else covers (see
[Tests](../ai/review.md#tests)).
See [API Testing](../testing/api_testing.md).

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

## Outbox Delivery And Retries

For outbound pushes, insert a row into an outbox table in the same transaction
as the business write, and let the outbox reactor deliver it. The outbox adds
status, idempotency key, retry count, retry backoff, and last error columns;
declare only the fields the delivery needs:

```ts
system.outboxTable({
  name: "interface_push",
  fields: (table) => {
    table.string("interface_type", 50).notNull();
    table.json("payload").notNull();
  },
});
```

Deliver rows with `system.outboxReactor(...)`. See
[Outbox tables & reactors](../concepts/outbox.md) for enqueuing, the reactor
callbacks, and retry options. Send the outbox `idempotency_key` or a unique
external id to the partner so retried deliveries are safe.

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

Write inbound data straight into the target tables; transaction history shows
what each request changed. Keep raw inbound payloads only when the contract
requires asynchronous processing or replay, using the
[inbox pattern](../concepts/common_patterns.md#inbound-payloads). Outbox rows
for deferred outbound work already record attempts, timestamps, and the last
error.

Do not add bespoke audit or history tables for who changed what and when.
Query transaction history instead (`db.enableTransactionQueries`, on by
default); see
[Transaction Queries](../sql/transaction_queries.md).

Do not let endpoint parsing, workflow transition, and outbound push logic become
one large procedure: split stages into stored procedures, and separate them with
inbox or outbox rows only when the contract requires asynchronous work or replay.
