---
title: HTTP Service Helpers
description: SQL utilities for handling HTTP requests inside Yolm APIs and webhooks.
tags:
  - services
  - http
  - api
---

# HTTP Service Helpers

`services/http` ships small helpers for things API handlers commonly need:
extracting the originating client IP from proxy headers, URL-decoding
percent-encoded text, and supporting legacy header-key APIs.

## `forwardedClientIp(xForwardedFor, connectingIp, fallback?)`

Returns the left-most non-empty entry from `X-Forwarded-For` (the
original client when the request came through a load balancer or CDN),
or the connecting-IP header value, or the supplied fallback.

API endpoints don't expose the headers as fixed SQL identifiers — you
read them into scalars first with `s.getHeader(...)`, then pass those
scalars in:

```typescript
import { forwardedClientIp } from "services/http";
import { sql } from "std/sql_utils";

api.post("/event", {
  procedure: (s) => {
    s.getHeader(sql.lit`X-Forwarded-For`, { defScalar: "x_forwarded_for" });
    s.getHeader(sql.lit`CF-Connecting-IP`, { defScalar: "cf_connecting_ip" });

    const clientIp = forwardedClientIp(
      sql`x_forwarded_for`,
      sql`cf_connecting_ip`,
    );

    s.modify(sql`
      insert into db.audit_log (event, ip, ts)
      values ('login', ${clientIp}, now())
    `);
  },
});
```

Provide an explicit `fallback` when you want a default beyond the
empty string (e.g. `sql.lit\`unknown\``).

## `formUrlDecode(value)`

Wraps the built-in `uri.form_url_decode(...)` SQL function — URL-decodes
a percent-encoded string (e.g. `Hello%20World` → `Hello World`,
`%26` → `&`).

Use on individual `application/x-www-form-urlencoded` parameter values
that you've already split out of the body, or on any other
percent-encoded text that needs to be inspected as-is.

```typescript
import { formUrlDecode } from "services/http";
import { sql } from "std/sql_utils";

api.post("/legacy-webhook", {
  textBodyScalar: "request_body",
  procedure: (s) => {
    // Strip the leading `&xml=` and decode just that parameter
    s.defScalar(
      "encoded_xml",
      sql`substring(request_body from position('&xml=' in request_body) + 5)`,
    );
    s.defScalar("xml", formUrlDecode(sql`encoded_xml`));
    // …
  },
});
```

For JSON request bodies, declare `jsonBodyScalar` on the endpoint and
read the parsed result directly. For binary bodies, declare
`bytesBodyScalar`.

## Legacy API helpers

`legacyRouteVariants(controller, action)` returns compatibility paths for
older controller/action APIs: `/api` and root prefixes, plus original and
lowercase controller/action names.

```typescript
import { legacyRouteVariants } from "services/http";

for (const route of legacyRouteVariants("SearchOrder", "GetSearchOrders")) {
  api.post(route, config);
}
```

`requireHeaderApiKey(s, opts)` reads an API key header, rejects missing keys,
and checks the value against a SQL query that returns allowed keys as a single
`value` column. If the query returns no rows, all non-empty keys are rejected.

```typescript
import { requireHeaderApiKey } from "services/http";
import { sql } from "std/sql_utils";

api.post("/legacy", {
  procedure: (s) => {
    requireHeaderApiKey(s, {
      scalarName: "legacy_api_key",
      allowedKeys: sql`
        select split.value
        from db.app_configs
        left join string.split(config_value, '|') as split
        where config_key = 'ApiKeys'
          and split.value != ''
      `,
      missingMessage: sql.lit`API Key is missing.`,
      unauthorizedMessage: sql.lit`Unauthorized client.`,
    });

    // protected handler body...
  },
});
```

## See also

- [SOAP Helpers](./soap.md) — XML/SOAP equivalents.
- [Server Statements](../procedures/server_statements.md) — `s.request(...)`,
  `s.getHeader(...)`, request body bindings.
