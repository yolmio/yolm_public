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

    // Extract claims from the decoded token
    s.defScalar("token_session_id", sql`(decoded->>'sub')::uuid`);
    s.defRecord(
      "existing_session",
      sql`select *
          from db.auth_session_tokens
          where public_id = token_session_id
            and now() < date.add(year, 1, issued)`
    );

    s.if(sql`existing_session.sys_user_id is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql`json_build_object('error', 'invalid_token')`);
    });

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

For cookie-backed app APIs, prefer `AuthBlock.validateApi`; it applies the
standard session-token lifetime check.

```typescript
api.post("/studio/get_data", {
  procedure: (s) => {
    AuthBlock.validateApi(s, sql.lit`y-t`);
    s.if(sql`auth_user_id is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql`json_build_object('error', 'invalid_token')`);
    });

    // User is authenticated.
  },
});
```

When validating a session token from a request body, apply the same session
expiration expression configured on the auth component. The example below
uses a 24-hour lifetime; replace `session_expiration` with the exact expression
used by the app's `cookieExpiration` setting.

```typescript
api.post("/studio/get_data", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.defScalar("token_id", sql`(body->>'token_id')::uuid`);
    s.defScalar("session_expiration", sql`date.add(hour, 24, now())`);
    s.defScalar(
      "session_seconds",
      sql`cast(greatest(0, date.diff(second, now(), session_expiration)) as int)`,
    );

    // Verify token exists and is valid
    s.defRecord(
      "existing_session",
      sql`select *
          from db.auth_session_tokens
          where public_id = token_id
            and now() < date.add(second, session_seconds, issued)`
    );

    s.if(sql`existing_session.sys_user_id is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql`json_build_object('error', 'invalid_token')`);
    });

    s.defScalar("sys_user_id", sql`existing_session.sys_user_id`);

    // Check user permissions
    s.if(
      sql`not exists (
        select 1 from db.auth_user_permissions
        where sys_user_id = ${sql`sys_user_id`}
        and permission = 'can_access_api'
        and is_allowed = true
      )`,
      (s) => {
        s.setHttpStatus(403);
        s.return(sql`json_build_object('error', 'unauthorized')`);
      }
    );

    // User is authenticated and authorized
    // ... proceed with business logic
  },
});
```

## Permission Checks in APIs

Check specific permissions before allowing operations:

```typescript
api.post("/deploy", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.defScalar("system_id", sql`(body->>'system_id')::bigint`);
    s.defScalar("token_id", sql`(body->>'token_id')::uuid`);

    // Verify session
    s.defRecord(
      "session",
      sql`select *
          from db.auth_session_tokens
          where public_id = token_id
            and now() < date.add(year, 1, issued)`
    );

    s.if(sql`session.sys_user_id is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql`json_build_object('error', 'invalid_token')`);
    });

    // Check specific permission for this system
    s.if(
      sql`not exists (
        select 1 from db.system_studio_users
        where system_id = ${sql`system_id`}
        and sys_user_id = session.sys_user_id
        and can_publish = true
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

## GET Endpoint with Query-Based Auth

Authenticate via query parameters:

```typescript
api.get("/check_permission", {
  query: [
    { name: "system_id", type: { type: "String", maxLength: 1000 } },
    { name: "token", type: { type: "String", maxLength: 1000 } },
  ],
  procedure: (s) => {
    s.defScalar("token_id", sql`token::uuid`);

    s.defRecord(
      "session",
      sql`select *
          from db.auth_session_tokens
          where public_id = token_id
            and now() < date.add(year, 1, issued)`
    );

    s.if(sql`session.sys_user_id is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql`json_build_object('error', 'invalid_token')`);
    });

    s.defScalar(
      "can_access",
      sql`exists (
        select 1 from db.system_studio_users
        where system_id = ${sql`system_id`}
        and sys_user_id = session.sys_user_id
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

## Common Authentication Patterns

### 1. Session + Permission Check

```typescript
function verifySessionAndPermission(s, requiredPermission: string) {
  s.defScalar("token_id", sql`(body->>'token_id')::uuid`);
  s.defRecord("session", sql`
    select *
    from db.auth_session_tokens
    where public_id = token_id
      and now() < date.add(year, 1, issued)
  `);

  s.if(sql`session.sys_user_id is null`, (s) => {
    s.setHttpStatus(401);
    s.return(sql`json_build_object('error', 'invalid_token')`);
  });

  s.if(
    sql`not exists (
      select 1 from db.auth_user_permissions
      where sys_user_id = session.sys_user_id
      and permission = ${sql.lit(requiredPermission)}
      and is_allowed = true
    )`,
    (s) => {
      s.setHttpStatus(403);
      s.return(sql`json_build_object('error', 'unauthorized')`);
    }
  );
}

// Usage
api.post("/admin_action", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    verifySessionAndPermission(s, "admin_access");
    // ... continue with authorized logic
  },
});
```

### 2. Resource-Specific Authorization

```typescript
api.post("/update_system", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.defScalar("system_id", sql`(body->>'system_id')::bigint`);
    s.defScalar("token_id", sql`(body->>'token_id')::uuid`);

    // Check if user can edit THIS specific system
    s.defScalar(
      "can_edit",
      sql`exists (
        select 1
        from db.auth_session_tokens ast
        join db.system_studio_users ssu on ssu.sys_user_id = ast.sys_user_id
        where ast.public_id = token_id
        and now() < date.add(year, 1, ast.issued)
        and ssu.system_id = ${sql`system_id`}
        and ssu.can_edit = true
      )`
    );

    s.if(sql`not can_edit`, (s) => {
      s.setHttpStatus(403);
      s.return(sql`json_build_object('error', 'unauthorized')`);
    });

    // User can edit this system
    s.startTransaction();
    // ... perform update
    s.commitTransaction();
  },
});
```

## Best Practices

1. **Always validate tokens** - Never trust client-provided data
2. **Use typed scalars** - Cast JSON values to appropriate types
3. **Return consistent errors** - Use standard error format
4. **Check permissions early** - Fail fast if unauthorized
5. **Use transactions** - Wrap modifications in transactions
6. **Log authentication attempts** - Track failed attempts for security
7. **Implement rate limiting** - Prevent brute force attacks
8. **Use HTTPS only** - Never send tokens over unencrypted connections
