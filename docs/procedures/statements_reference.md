---
title: Statement Builder Type Reference
description: The DomStatements / *ServerStatements / TestStatements type tree exposed by std/statements.
tags:
  - procedures
  - types
  - reference
---

# Statement Builder Type Reference

```ts
import type { Sql } from "std/sql_utils";
```

Every Yolm procedure is built by mutating a "statements" object. The
specific type of that object depends on where the procedure runs (the
browser, a UI-bound server proc, a scheduled job, a test, etc.). This
page is the type-level map of what's exported from `std/statements`.

For the actual statement APIs (`s.modify`, `s.defScalar`, `s.request`, …)
see [DOM Statements](./dom_statements.md), [Server
Statements](./server_statements.md), and [Base
Statements](./base_statements.md).

## The hierarchy

```
IStatementsBase
├── DomStatements                  browser-side (event handlers, Form callbacks)
├── AuthorizeStatements            authorize hooks (UI/API authorization)
└── IServerBaseStatements          shared server surface
    ├── GeneralServerStatements    scheduled jobs, pipelines, reactors
    ├── UiServerStatements         server work invoked from the UI
    ├── EndpointStatements         API endpoint handlers
    ├── StateStatements            Data state procedures
    └── TestStatements             test bodies
```

## Concrete builders

| Type | When you receive it |
| --- | --- |
| `DomStatements` | DOM event handlers (`onClick`, `onSubmit`, `onChange`, `onKeyDown`, …), `Form`'s client-side hooks (`beforeSubmitClient`, `afterSubmitClientSuccess`, `onSubmitError`), `Listen.onChange`, `EventHandlers.{window,document,mount,…}`. |
| `UiServerStatements` | Body of `s.server(...)` from `DomStatements`, plus `Form`'s server hooks (`beforeTransactionStart`, `afterTransactionStart`, `beforeTransactionCommit`, `afterTransactionCommit`, `onSubmitServerError`). |
| `GeneralServerStatements` | `system.scheduledProc`, `system.addPipeline` setup/finalize/stage bodies, `system.addReactor`. |
| `EndpointStatements` | API endpoint handlers (`api.get(...).procedure`, `api.post(...).procedure`, …). |
| `StateStatements` | `Data` `procedure` and the body of `useState`/`State`. |
| `AuthorizeStatements` | The `procedure` of the `Authorize` UI block (gates a subtree on a server check). |
| `TestStatements` | `system.test(...)` bodies. Adds test-only fixtures on top of the shared assertion methods. |

## "OrFn" aliases

Yolm APIs accept either a pre-built statements instance or a builder
function. The `*OrFn` aliases capture both:

```typescript
export type DomStatementsOrFn = StatementsOrFn<DomStatements>;
```

You'll see them anywhere a component takes an event handler.
Pass either form interchangeably:

```typescript
// Builder function (most common)
<Button onClick={(s) => s.navigate(sql.lit`/dashboard`)}>Go</Button>

// Pre-built — useful when sharing a fragment across handlers
const handleNav = new DomStatements().navigate(sql.lit`/dashboard`);
<Button onClick={handleNav}>Go</Button>
```

## Shared surface — `IServerBaseStatements`

Use this as the parameter type when writing helpers that should work
from any server context (UI service procs, scheduled jobs, tests):

```typescript
import type { IServerBaseStatements } from "std/statements";
import { sql } from "std/sql_utils";

function archiveTask(s: IServerBaseStatements, taskId: Sql) {
  s.startTransaction();
  s.modify(sql`update db.tasks set status = 'archived' where id = ${taskId}`);
  s.commitTransaction();
}
```

`IServerBaseStatements` covers transactions, table operations, scalar
helpers, and `s.request(...)` / `s.serviceRequest(...)`. It does
**not** include UI-bound writes (those live on `UiServerStatements`)
or scheduling-only primitives (those live on
`GeneralServerStatements`).

## Request option types

`s.request(...)` accepts scalar destinations through `RequestOpts` and tagged
destinations through `RequestWithReceiveBodyOpts`. Highlights:

- `uri`, `method`, `headers` — standard HTTP plumbing. Type reusable header
  arrays as `RequestHeaders` (`{ name: Sql; value: Sql }[]`).
- Body: `json`, `text` (use for SOAP/XML), `bytes`, or `multipart`.
- `optIn` — gate the call in preview/local-dev runs. Required when
  the runtime has external services in opt-in mode.
- Response capture: `defReceiveText` / `defReceiveJson` /
  `defReceiveBytes` for scalar bodies, or `receiveBody` with a bounded `Blob`
  destination for large binary responses. `defResponseRecord` captures status
  and `defResponseHeadersTable` captures headers.
- `serviceCredentials` / `oauth` for managed auth.
- `mockEndpoint` for preview/local-dev stubs.

## Stored Procedure Types

Type `s.callStoredProcedure(name, opts)` options with
`CallStoredProcedureOpts`:

```typescript
import type { CallStoredProcedureOpts } from "std/statements";

const opts = {
  inputScalars: { source_id: sql`record.id` },
  outputScalars: { created_id: "created_id" },
} satisfies CallStoredProcedureOpts;

s.callStoredProcedure("copy_record", opts);
```

`input*` maps bind caller values into the stored procedure. `output*` maps name
caller-side variables that receive results.

Use `HelperProcField` for procedure tables/records and stored procedure
parameters:

```typescript
import type { HelperProcField } from "std/statements";

const fields = [
  { name: "id", type: "BigInt", notNull: true, indexed: true },
  { name: "email", type: { type: "String", maxLength: 320 } },
] satisfies HelperProcField[];
```

Each `HelperProcField` has `name`, `type`, optional `notNull`, and optional
`indexed` for in-memory procedure tables.

## See also

- [DOM Statements](./dom_statements.md) — `DomStatements` reference.
- [Server Statements](./server_statements.md) — `UiServerStatements`
  and `GeneralServerStatements` reference.
- [Base Statements](./base_statements.md) — `IStatementsBase` shared
  primitives.
- [Test Utilities](../testing/test_utilities.md) — `TestStatements`.
