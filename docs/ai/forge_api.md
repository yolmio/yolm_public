---
title: Forge API skill
description: "Use before adding HTTP endpoints, webhooks, or external interfaces: typed inputs, authentication, authorization, and responses."
tags: [ai, forge, skill, api, authentication]
related:
  - api/overview.md
  - api/authentication.md
  - api/external_interfaces.md
  - api/files_blobs_exports.md
---

# Forge API skill

Inspect existing APIs, authentication blocks, permissions, and shared stored
procedures before adding an endpoint. Use the exact `system.api` and endpoint
types from documentation or exported metadata.

Declare typed path/query parameters and request bodies. Validate untrusted
values, bound sizes and result counts, enforce authentication and
resource-specific authorization on the server, and return deliberate HTTP
statuses and stable response shapes for success, validation, not-found,
conflict, and authorization failures.

Put state-changing behavior in a stored procedure by default; keep only
one-off glue in the endpoint. Keep multi-step writes transactional. For
external interfaces, model retries, idempotency, replay, secrets, and failure
recording from the delivery contract.

When an endpoint-owned transaction fails, catching the error does not roll it
back. Begin its catch handler with `s.rollbackIfInTransaction()` before any
helper that starts a transaction to record the failure. Review helper expansion,
not just visible endpoint statements. Verify a failure after a write and before
commit: the original error survives, business changes roll back, and exactly one
error record persists. See [transaction cleanup in error handlers](../api/external_interfaces.md#transaction-cleanup-in-error-handlers).

Read `docs/api/overview.md` and `docs/api/authentication.md` for ordinary
endpoints; load `docs/api/external_interfaces.md` or
`docs/api/files_blobs_exports.md` when those surfaces apply.

### Signed transfer requests

`http.sign_request(method, url, parameters, expires_at)` returns a signed URL,
valid for at most 30 minutes. `parameters` is a JSON object of scalar values.
Use an absolute HTTPS URL. Relative URLs are rejected; local HTTP is supported
only for loopback hosts. Invalid inputs return NULL. Signing does not require
an HTTP request and can run in server procedures, reactors, and scheduled work.

`http.verify_signed_request(method, absolute_signed_url)` verifies the supplied
method and URL, plus expiry, system, and service. It returns the signed parameters
as JSON, or NULL for an invalid/expired signature. Reject NULL before doing
work. In an endpoint, pass the actual request values from `http.request_info()`:

```sql
http.verify_signed_request(
  http.request_info()->>'method',
  http.request_info()->>'url'
)
```

`http.request_info()` returns `{method, url, origin}` or NULL outside an HTTP
request. It reads trusted routing metadata; never verify a caller-supplied URL
in place of the actual request URL. The signing and verification functions
read no HTTP request metadata themselves.

Do not append or replace query parameters after signing. Request bodies
are not signed: validate them and enforce any signed constraints yourself. A
link can be reused until expiry; signing does not make an operation retry-safe.

Signing is available to application-authored procedures, not dynamic SQL
queries. Treat the returned URL as a temporary bearer credential. Recheck
application permissions when a transfer acts as a user. These links need no
authorization rows.

A signed URL does not pin a blob or extend its storage lifetime. Revoking an
MCP connection does not individually revoke already-issued signed URLs; their
expiry and the endpoint's current user-permission checks remain authoritative.
