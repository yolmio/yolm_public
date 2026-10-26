---
title: API Authentication
description: Authentication and authorization patterns for Yolm APIs including JWT verification, signed requests, and token-based access.
tags:
  - api
  - authentication
  - security
  - jwt
---

# API Authentication

Yolm provides several patterns for securing API endpoints.

## JWT Token Verification

Verify JWT tokens using public/private key pairs:

```typescript
const api = system.api({ prefix: "/api", domain: "api.example.com" });

api.post("/refresh_token", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.defScalar("token", sql`body->>'token'`);
    s.defScalar("decoded", { type: "Json" });

    // Verify and decode the JWT. Invalid verification returns NULL.
    s.setScalar(
      "decoded",
      sql`jwt.get_claims(token, ${getStaticSecret(sql.lit`JWT_PUBLIC_KEY`)}, 'RS256')`
    );
    s.if(sql`decoded is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql`json_build_object('error', 'invalid_token')`);
    });

    // The subject claim carries the session token; see requireSession below.
    requireSession(s, sql`try_cast(decoded->>'sub' as uuid)`);

    // Return success with new token
    s.return(sql`json_build_object('token', 'new_token_value')`);
  },
});
```

### JWT Functions

- `jwt.get_claims(token, public_key, algorithm)` - Verify and decode a JWT token
- Supported algorithms: `'HS256'`, `'HS384'`, `'HS512'`, `'RS256'`,
  `'RS384'`, `'RS512'`, `'ES256'`, and `'ES384'`
- Returns JSON object with claims
- Returns `NULL` if verification fails; check the result before reading claims.

## Signed JSON Requests

Make authenticated requests to external APIs using signed payloads:

```typescript
import { signedJsonRequest, getStaticSecret } from "std/services";

api.post("/export_config", {
  procedure: (s) => {
    // Build the JSON payload
    s.defScalar(
      "config_json",
      sql`(
        select json_array_agg(
          json_build_object(
            'id', systems.id,
            'name', systems.name
          )
        )
        from db.systems
      )`
    );

    // Send signed request to external API
    signedJsonRequest(s, {
      secretName: sql.lit`CLOUDFLARE_SECRET_KEY`,
      payload: sql`config_json`,
      url: sql`${getStaticSecret(sql.lit`CLOUDFLARE_CICD_URL`)} || '/publish_systems_meta'`,
    });
  },
});
```

### signedJsonRequest Parameters

- `secretName` - Name of the secret key used for signing
- `payload` - JSON data to send (must be a JSON expression)
- `url` - Target URL expression
- Automatically adds authentication headers
- Throws error if request fails

## Session Token Validation

For cookie-backed app APIs, prefer `AuthBlock.validateApi`. Pass the same
expression as the auth component's `cookieExpiration`; without it, the helper
falls back to a one-year session lifetime. Check permissions with
`userHasPermission` against `auth_user_id`, which resolves direct grants,
overrides, and inherited roles. `currentUserHasPermission` is the same check
bound to `current_user` for app UI and server statements.

```typescript
import { AuthBlock, userHasPermission } from "blocks/auth";

// Must match the auth component's cookieExpiration.
const sessionExpiration = sql`date.add(hour, 24, now())`;

api.post("/studio/get_data", {
  procedure: (s) => {
    AuthBlock.validateApi(s, sql.lit`y-t`, sessionExpiration);
    s.if(sql`auth_user_id is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql`json_build_object('error', 'invalid_token')`);
    });
    s.if(
      sql`not ${userHasPermission(sql.lit`can_access_api`, sql`auth_user_id`)}`,
      (s) => {
        s.setHttpStatus(403);
        s.return(sql`json_build_object('error', 'unauthorized')`);
      },
    );

    // User is authenticated and authorized.
  },
});
```

When the session token arrives in a request body or header instead of the
cookie, apply the same lifetime check. The examples below share this helper,
which sets `auth_user_id` like `validateApi` and returns `401` when the token
is missing, unknown, or expired:

```typescript
import type { EndpointStatements } from "std/statements";
import type { Sql } from "std/sql_utils";

function requireSession(s: EndpointStatements, tokenId: Sql) {
  s.defScalar(
    "auth_user_id",
    sql`(
      select sys_user_id
      from db.auth_session_tokens
      where public_id = ${tokenId}
        and now() < date.add(
          second,
          cast(greatest(0, date.diff(second, now(), ${sessionExpiration})) as int),
          issued
        )
    )`,
  );
  s.if(sql`auth_user_id is null`, (s) => {
    s.setHttpStatus(401);
    s.return(sql`json_build_object('error', 'invalid_token')`);
  });
}
```

## Permission Checks in APIs

Check specific permissions before allowing operations:

```typescript
api.post("/deploy", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.defScalar("system_id", sql`(body->>'system_id')::bigint`);
    requireSession(s, sql`try_cast(body->>'token_id' as uuid)`);

    // Check specific permission for this system
    s.if(
      sql`not exists (
        select 1 from db.system_studio_users
        where system_id = ${sql`system_id`}
          and sys_user_id = auth_user_id
          and can_publish
      )`,
      (s) => {
        s.setHttpStatus(403);
        s.return(sql`json_build_object('error', 'insufficient_permissions')`);
      }
    );

    // User has permission to deploy this specific system
    s.startTransaction();
    // ... perform deployment
    s.commitTransaction();

    s.return(sql`json_build_object('success', true)`);
  },
});
```

## GET Endpoint with Header Auth

Send session tokens in a request header, not the query string; URLs are
recorded in browser history, proxy logs, and referrer headers.

```typescript
api.get("/check_permission", {
  query: [
    { name: "system_id", type: { type: "String", maxLength: 1000 } },
  ],
  procedure: (s) => {
    s.getHeader(sql.lit`x-session-token`, { defScalar: "session_token" });
    requireSession(s, sql`try_cast(session_token as uuid)`);

    s.defScalar(
      "can_access",
      sql`exists (
        select 1 from db.system_studio_users
        where system_id = ${sql`system_id`}
          and sys_user_id = auth_user_id
      )`
    );

    s.return(sql`json_build_object('can_access', can_access)`);
  },
});
```

## Secrets Management

Access secrets using `getStaticSecret`:

```typescript
import { getStaticSecret } from "std/services";

s.request({
  uri: sql.lit`https://api.external.com/endpoint`,
  headers: [
    {
      name: sql.lit`Authorization`,
      value: sql.concat("Bearer ", getStaticSecret(sql.lit`API_KEY`))
    }
  ],
  defReceiveJson: "response"
});
```

Secrets are:
- Stored in `db.sys_static_secrets` when `StaticSecretsBlock` is registered
- Accessed at runtime via the SQL expression returned by `getStaticSecret`
- Never exposed to client-side code

## Best Practices

1. **Always validate tokens** - Never trust client-provided data
2. **Use typed scalars** - Cast JSON values to appropriate types
3. **Return consistent errors** - Use standard error format
4. **Check permissions early** - Fail fast if unauthorized
5. **Use transactions** - Wrap modifications in transactions
6. **Audit with transaction history** - Use [transaction queries](../sql/transaction_queries.md)
   to see who changed what; do not add bespoke authentication log tables
7. **Implement rate limiting** - Prevent brute force attacks
8. **Use HTTPS only** - Never send tokens over unencrypted connections
