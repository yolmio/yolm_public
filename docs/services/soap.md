---
title: SOAP Service Helpers
description: SQL helpers for building and parsing SOAP 1.1 / 1.2 envelopes inside Yolm APIs and outbound requests.
tags:
  - services
  - soap
  - xml
  - integration
---

# SOAP Service Helpers

`services/soap` is a small collection of SQL-side helpers for building
and parsing SOAP envelopes. Use it when integrating with legacy XML web
services (background-screening providers, payroll/HR systems, government
endpoints) where you need to construct request bodies, set the right
headers, and pull individual parameters out of the response.

The helpers are pure SQL — they generate fragments to compose into your
own queries. There is no client class, no token storage, no retry
logic; SOAP requests are issued through the standard `s.request(...)`
server statement.

## Building outbound envelopes

### Headers

`soap11Headers` / `soap12Headers` return a SQL JSON-array expression
(`[{name, value}, …]`), not a TypeScript `RequestHeader[]`. Stash the
result in a scalar with `s.defScalar(...)` and feed it to a
project-specific integration helper that knows how to consume the JSON
shape. For a direct `s.request({headers: [...]})` call, build the TS
array of `{name, value}` objects yourself — it's only a couple of
lines.

```typescript
import { soap11Headers, soap12Headers } from "services/soap";
import { sql } from "std/sql_utils";

s.defScalar("soap_headers_json", soap12Headers(sql`request_action`));
// → 'soap_headers_json' is a Sql evaluating to
//   [{ "name": "Content-Type", "value": "application/soap+xml; charset=utf-8; action=\"…\"" }]

// SOAP 1.1 carries the action in a separate `SOAPAction` header.
s.defScalar("soap_headers_json", soap11Headers(sql.lit`SubmitOrder`));
```

### Document/Literal envelopes

```typescript
import {
  soap11DocumentLiteralResponse,
  soap12DocumentEnvelope,
} from "services/soap";

// Outbound: SOAP 1.2 envelope wrapping the operation + parameter object,
// fed into the request body via `s.request({ ..., text: body })`.
const body = soap12DocumentEnvelope(
  sql.lit`SubmitOrder`,
  sql`json_build_object('orderId', ${orderId}, 'customerId', ${customerId})`,
);

// Inbound handler: wrap the result in a SOAP 1.1 document/literal
// response and return it as the endpoint body.
api.post("/SubmitOrder", {
  procedure: (s) => {
    s.setHeader(sql.lit`Content-Type`, sql.lit`text/xml`);
    s.return(
      soap11DocumentLiteralResponse(
        sql.lit`SubmitOrder`,
        sql.lit`http://example.com/orders`,
        sql`result_json`,
      ),
    );
  },
});
```

## Parsing inbound XML

`xmlTagText`, `xmlDecodeText`, `xmlEscape`, `xmlCdata`, `soapOperation`,
`soapParam`, `soapXmlParam`, and the legacy XML fragment helpers all return
SQL fragments — compose them into your handler query. Bind the request body to
a scalar via the endpoint's `textBodyScalar` first, then feed that scalar in.

```typescript
import {
  soapOperation,
  soapParam,
  soapXmlParam,
} from "services/soap";

api.post("/soap", {
  textBodyScalar: "request_body",
  procedure: (s) => {
    // Dispatch on the requested operation
    s.defScalar(
      "op_name",
      soapOperation(sql`request_body`, [
        "GetCustomer",
        "SubmitOrder",
        "Cancel",
      ]),
    );

    // Read individual parameters
    s.defScalar(
      "customer_id",
      soapParam(sql`request_body`, sql.lit`CustomerId`),
    );
    s.defScalar(
      "note",
      soapXmlParam(sql`request_body`, sql.lit`Note`),
    );
    // … dispatch on op_name and respond …
  },
});
```

| Helper | Purpose |
| --- | --- |
| `xmlTagText(xml, tag)` | First `<tag>…</tag>` inner text (with or without ns prefix). Newlines are stripped before matching. Returns `NULL` when the tag is missing. |
| `xmlDecodeText(value)` | Decodes the five named XML entities. |
| `xmlEscape(value)` | Escapes the five XML metacharacters. |
| `xmlCdata(value)` | Wraps in `<![CDATA[…]]>`, splitting embedded `]]>` safely. |
| `xmlTextBodyPayload(body)` | Normalizes legacy XML text bodies that may arrive as a quoted string. |
| `xmlElementTextFromFragment(fragment, tag)` | Exact, non-namespaced `<tag>…</tag>` text extraction for predictable legacy fragments. |
| `xmlElementBoolFromFragment(fragment, tag)` | Reads exact element text and compares it to `true`. |
| `soapOperation(body, names)` | Returns the operation name found in the body, or `''`. |
| `soapParam(body, tag)` | Plain-text parameter value (alias for `xmlTagText`). |
| `soapXmlParam(body, tag)` | XML-decoded parameter value. |

For older XML APIs that send arrays as repeated element fragments:

```typescript
import {
  xmlElementBoolFromFragment,
  xmlElementTextFromFragment,
  xmlTextBodyPayload,
} from "services/soap";
import { sql } from "std/sql_utils";

api.post("/legacy/skipped-orders", {
  textBodyScalar: "xml_body",
  procedure: (s) => {
    s.defScalar("xml_payload", xmlTextBodyPayload(sql`xml_body`));
    s.defTable(
      "items",
      sql`
        select
          try_cast(${xmlElementTextFromFragment(sql`value`, sql.lit`OrderID`)} as int) as order_id,
          ${xmlElementBoolFromFragment(sql`value`, sql.lit`Handled`)} as handled
        from string.split(xml_payload, '<SkippedOrder>')
        where position('</SkippedOrder>' in value) > 0
      `,
    );
  },
});
```

## SOAP 1.1 vs 1.2

Use the `*11*` helpers for legacy `text/xml` services that send a separate
`SOAPAction` header. Use the `*12*` helpers for newer `application/soap+xml`
services where the action is encoded into the Content-Type. The `xml*` and
`soapParam`/`soapXmlParam` helpers are version-agnostic.

Compatibility endpoints that accept both versions can use:

| Helper | Purpose |
| --- | --- |
| `soapIs12(body)` | Runtime SQL boolean for SOAP 1.2 namespace detection. |
| `soapContentType(isSoap12)` | Response content type for the detected version. |
| `soap11RpcEncodedEnvelope(operation, operationNamespace, parameters)` | SOAP 1.1 RPC/encoded request envelope for legacy services. |
| `soap12DocumentLiteralResponse(operation, operationNamespace, value)` | SOAP 1.2 document/literal response envelope. |
| `soap12FaultResponse(message)` | SOAP 1.2 fault envelope with the supplied message. |
| `soapVersionedDocumentLiteralResponse(isSoap12, operation, namespace, value)` | SOAP 1.1 or 1.2 document/literal response. |
| `soapVersionedFaultResponse(isSoap12, message)` | SOAP 1.1 or 1.2 fault response. |

```typescript
import {
  soapContentType,
  soapIs12,
  soap12FaultResponse,
  soapVersionedDocumentLiteralResponse,
} from "services/soap";
import { sql } from "std/sql_utils";

s.defScalar("is_soap12", soapIs12(sql`soap_body`));
s.setHeader(sql.lit`Content-Type`, soapContentType(sql`is_soap12`));
s.return(
  soapVersionedDocumentLiteralResponse(
    sql`is_soap12`,
    sql.lit`GetResult`,
    sql.lit`http://example.com/service`,
    sql`result_xml`,
  ),
);
```

## Endpoint Dispatch Helpers

For endpoint handlers with several SOAP operations, use
`defineSoapDispatch(...)` to define the operation scalar and response content
type, `defineSoapParams(...)` to define request parameter scalars, and
`returnSoapEndpointResponse(...)` to set `Content-Type` and return the body.

```typescript
import {
  defineSoapDispatch,
  defineSoapParams,
  returnSoapEndpointResponse,
  soap11DocumentLiteralResponse,
} from "services/soap";
import { sql } from "std/sql_utils";

api.post("/Service.asmx", {
  textBodyScalar: "soap_body",
  procedure: (s) => {
    const dispatch = defineSoapDispatch(s, {
      body: sql`soap_body`,
      operations: ["SubmitOrder"],
      operationScalar: "soap_operation",
    });

    s.if(sql`${dispatch.operation} = 'SubmitOrder'`, (s) => {
      defineSoapParams(s, sql`soap_body`, [
        { scalarName: "sXML", kind: "xml" },
      ]);
      s.defScalar("submit_result", sql.lit`OK`);
      returnSoapEndpointResponse(
        s,
        dispatch.contentType,
        soap11DocumentLiteralResponse(
          sql.lit`SubmitOrder`,
          sql.lit`http://example.com/service`,
          sql`submit_result`,
        ),
      );
    });
  },
});
```

## See also

- [HTTP Helpers](./http.md) — `formUrlDecode`, `forwardedClientIp`.
- [QuickBooks IIF Helpers](./quickbooks_iif.md) — tab-delimited IIF export helpers.
- [Server Statements](../procedures/server_statements.md) — `s.request(...)`
  for issuing the actual outbound call.
- [Service Integrations](../concepts/service_integrations.md) — overview.
