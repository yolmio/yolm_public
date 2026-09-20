---
title: API Overview
description: How to expose REST APIs in Yolm systems with system.api, get/post/put/patch/delete endpoints, query parameters, JSON/text/bytes bodies, and EndpointStatements.
tags:
  - api
  - rest
  - endpoints
related:
  - api/external_interfaces.md
  - api/files_blobs_exports.md
  - api/authentication.md
---

# API Overview

Define APIs in `apis/*.ts` files with `system.api(...)`.

```typescript
import { sql } from "std/sql_utils";
import { system } from "std/system";

const api = system.api({
  prefix: "/api",
  domain: "api.example.com",
  domainAliases: ["api.example.org"],
});
```

`prefix` is prepended to endpoint paths. `domain` is optional when Yolm can
derive it from the API filename. `domainAliases` mounts the same API on
additional domains.

For endpoints that are shared across app domains, use the system-wide
`globalApi`:

```typescript
system.globalApi.get("/health", { procedure: (s) => {
  s.return(sql`json_build_object('ok', true)`);
} });
```

Calls with the same domain and prefix extend the same API. Different prefixes
create separate mounts, so a root API can serve discovery endpoints alongside
an existing `/api` mount. The runtime selects the most specific matching prefix;
register `/api/...` endpoints in that mount rather than in the root API.

## Endpoints

```typescript
api.get("/todos", { procedure: (s) => {} });
api.post("/todos", { jsonBodyScalar: "body", procedure: (s) => {} });
api.put("/todos/{todo_id:id}", { jsonBodyScalar: "body", procedure: (s) => {} });
api.patch("/todos/{todo_id:id}", { jsonBodyScalar: "body", procedure: (s) => {} });
api.delete("/todos/{todo_id:id}", { procedure: (s) => {} });
```

Path params use route syntax such as `{todo_id:id}` or `{file_path:string}`.
The parameter becomes a typed scalar named `todo_id` or `file_path` in the
endpoint procedure.

## Query Parameters

Use `query` to declare typed query string parameters. Each query parameter
becomes a scalar in the endpoint procedure.

```typescript
api.get("/todos", {
  query: [
    { name: "limit", type: { type: "Int" }, default: "20" },
    { name: "offset", type: { type: "Int" }, default: "0" },
  ],
  procedure: (s) => {
    s.return(sql`(
      select json_array_agg(json_build_object('id', id, 'title', title))
      from (
        select id, title
        from db.todos
        order by id
        limit limit offset offset
      ) as rows
    )`);
  },
});
```

## Request Bodies

For non-GET endpoints, declare the request body scalar explicitly:

| Option | Use when | Procedure scalar |
| --- | --- | --- |
| `jsonBodyScalar` | Request body is JSON | JSON scalar, commonly `body` |
| `textBodyScalar` | Request body is text | string scalar |
| `bytesBodyScalar` | Request body is bytes | bytes scalar |
| `blobBody` | Large authenticated upload stored as a blob before the procedure runs | blob hash scalar, with optional source-hash and size scalars |

```typescript
api.post("/todos", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      insert into db.todos (title, completed)
      values (body->>'title', coalesce((body->>'completed')::bool, false))
      returning id into new_todo_id
    `);
    s.commitTransaction();

    s.return(sql`json_build_object('id', new_todo_id)`);
  },
});
```

## Responses

Return from an endpoint with `s.return(sql\`...\`)`. Build JSON explicitly with
SQL JSON functions, or set headers when returning text, bytes, blobs, or custom
content.

```typescript
api.get("/todos/{todo_id:id}", {
  procedure: (s) => {
    s.defRecord("todo", sql`select * from db.todos where id = todo_id`);
    s.if(sql`todo.id is null`, (s) => {
      s.setHttpStatus(404);
      s.return(sql`json_build_object('error', 'not_found')`);
    });

    s.return(sql`json_build_object(
      'id', todo.id,
      'title', todo.title,
      'completed', todo.completed
    )`);
  },
});
```

## Endpoint Statements

Endpoint procedures use `EndpointStatements`, which extend server statements
with HTTP helpers:

```typescript
api.get("/files/{file_id:id}", {
  procedure: (s) => {
    s.getHeader(sql.lit`Authorization`, { defScalar: "authorization_header" });
    s.getCookie(sql.lit`session_id`, { defRecord: "session_cookie" });
    s.noCaching();

    s.defRecord("file", sql`select * from db.files where id = file_id`);
    s.if(sql`file.id is null`, (s) => {
      s.setHttpStatus(404);
      s.return();
    });

    s.setHeader(sql.lit`Content-Type`, sql`file.content_type`);
    s.returnBlob(sql`file.blob_hash`);
  },
});
```

Common helpers:

- `s.setHttpStatus(status)`
- `s.getHeader(name, { defScalar })`
- `s.setHeader(name, value)`
- `s.getCookie(name, { defRecord })`
- `s.setCookie(name, value, options)`
- `s.removeCookie(name)`
- `s.noCaching()`
- `s.returnBlob(hash)`

## Endpoint Helper Types

Type reusable endpoint helpers from `std/api`:

```typescript
import type { EndpointHelper, GetEndpointHelper } from "std/api";
import { sql } from "std/sql_utils";

const listUsers = {
  query: [{ name: "limit", type: { type: "Int" }, default: "50" }],
  procedure: (s) => {
    s.return(sql`(
      select json_array_agg(email)
      from (
        select email
        from db.users
        limit limit
      ) as users
    )`);
  },
} satisfies GetEndpointHelper;

const createUser = {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`insert into db.users (email) values (body->>'email')`);
    s.commitTransaction();
    s.return(sql`json_build_object('success', true)`);
  },
} satisfies EndpointHelper;
```

`GetEndpointHelper` accepts `query` and `procedure`. `EndpointHelper` is for
`post`, `put`, `patch`, and `delete`; it accepts `query`, `procedure`, and at
most one body binding:

| Body option | Bound scalar type |
|-------------|-------------------|
| `jsonBodyScalar` | JSON request body |
| `textBodyScalar` | Text request body |
| `bytesBodyScalar` | Bytes request body |

`Api` is returned by `system.api({ prefix, domain })`. It exposes
`get`, `post`, `put`, `patch`, `delete`, `auto`, `addDomainAlias`,
`endpointCount`, and `hasEndpoint`. Do not construct `Api` directly.

`api.auto({ tables })` generates CRUD endpoints for eligible tables. Set
`skip`, `noGetList`, `noGetRecord`, `noPost`, `noPut`, or `noDelete` per table;
use `relations` to embed related rows and optionally select their fields. Treat
generated CRUD as a starting point and add authentication, authorization, and
validation appropriate to the system.

## Complete Example

```typescript
import { sql } from "std/sql_utils";
import { system } from "std/system";

const api = system.api({ prefix: "/api", domain: "api.todos.app" });

api.get("/todos", {
  query: [
    { name: "limit", type: { type: "Int" }, default: "20" },
    { name: "offset", type: { type: "Int" }, default: "0" },
  ],
  procedure: (s) => {
    s.return(sql`(
      select json_array_agg(json_build_object(
        'id', id,
        'title', title,
        'completed', completed
      ))
      from (
        select id, title, completed
        from db.todos
        order by id desc
        limit limit offset offset
      ) as todos
    )`);
  },
});

api.post("/todos", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      insert into db.todos (title, completed)
      values (body->>'title', coalesce((body->>'completed')::bool, false))
      returning id into todo_id
    `);
    s.commitTransaction();
    s.return(sql`json_build_object('id', todo_id)`);
  },
});

api.put("/todos/{todo_id:id}", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      update db.todos
      set
        title = coalesce(body->>'title', title),
        completed = coalesce((body->>'completed')::bool, completed)
      where id = todo_id
    `);
    s.commitTransaction();
    s.return(sql`json_build_object('success', true)`);
  },
});

api.delete("/todos/{todo_id:id}", {
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`delete from db.todos where id = todo_id`);
    s.commitTransaction();
    s.return(sql`json_build_object('success', true)`);
  },
});
```
