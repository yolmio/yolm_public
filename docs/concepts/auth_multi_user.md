---
title: Authentication & Authorization
description: AuthBlock concept guide for multi-user Yolm apps with permissions, userTypes, current_user, shared cookies, and protected APIs.
tags:
  - concepts
  - authentication
  - authorization
  - users
related:
  - blocks/auth.md
  - api/authentication.md
  - concepts/apps.md
---

# Authentication & Authorization

Use `AuthBlock` for normal solution authentication. It provides `sys_users`,
roles, permissions, login UI, sessions, and impersonation. Build custom auth
only when the block cannot fit.

## Core Model

- `sys_users.id` is the Yolm user id.
- `current_user` is available in SQL after auth sets the current user.
- `s.setCurrentUser(userId)` sets the user for transactions created inside an
  authorization scope.
- User-type tables such as `employees`, `customers`, or `vendors` are linked
  from `sys_users` through `AuthBlock` `userTypes`.

## Multi-User Setup

Define user-type tables first, then add `AuthBlock`.

```tsx
db.table("employees", (table) => {
  table.email("email").notNull().unique();
  table.string("name", 100).notNull();
});

db.table("customers", (table) => {
  table.email("email").notNull().unique();
  table.string("name", 100).notNull();
});

system.addBlock(
  new AuthBlock({
    permissions: ["admin_access", "crm_access", "customer_portal_access"],
    appAuthTypes: ["otp", "email_password"],
    userTypes: ["employees", "customers"],
    userTable: (table) => {
      table.enum("timezone", "sys_timezone").notNull().default(sql.lit(system.timezone));
    },
  }),
);
```

For detailed component choices such as `EmailPasswordAuth`,
`DefaultEmailOtpAuth`, and `StandardUserManagement`, see
[AuthBlock](../blocks/auth.md).

## App Protection

Wrap each app with the auth component and permission that matches the app.

```tsx
system.app({
  domain: "admin.example.com",
  ui: (
    <AuthBlock.DefaultEmailOtpAuth requiredPermission="admin_access">
      <AdminApp />
    </AuthBlock.DefaultEmailOtpAuth>
  ),
});
```

Use a shared cookie domain only when multiple subdomain apps should share a
login:

```tsx
<AuthBlock.DefaultEmailOtpAuth
  cookieDomain={sql`case
    when location.host = 'example.com'
      or ends_with(location.host, '.example.com') then 'example.com'
    else location.host
  end`}
  requiredPermission="crm_access"
>
  <CrmApp />
</AuthBlock.DefaultEmailOtpAuth>
```

## Current User Data

Fetch user and user-type details with `Data`:

```tsx
<Data procedure={(s) => {
  s.defRecord("current_user", sql`select * from db.sys_users where id = current_user`);
  s.defRecord("employee", sql`
    select e.*
    from db.employees e
    join db.sys_users u on u.employee_id = e.id
    where u.id = current_user
  `);
}}>
  <span>{sql`employee.name`}</span>
</Data>
```

Check for nullable user-type links when the same app can be used by more than
one user type.

## Permission Checks

Use permission checks in both UI and server/API write paths.

```tsx
<AuthBlock.PermissionCheck permission="admin_access">
  <AdminTools />
</AuthBlock.PermissionCheck>
```

```ts
import { currentUserHasPermission } from "blocks/auth";

s.if(sql`not ${currentUserHasPermission(sql.lit`admin_access`)}`, (s) => {
  s.setHttpStatus(403);
  s.return(sql`json_build_object('error', 'forbidden')`);
});
```

Prefer block-provided helpers or exported TypeScript types when available. Do
not rely only on hiding UI controls for security.

### Permission checks on hot paths

Permission resolution can include direct grants, direct overrides, sourced
grants, and a recursive role hierarchy. Treat that resolution as database work
when it runs in a high-frequency UI state or row loop. A boolean `or` does not
guarantee that the engine avoids preparing an expensive recursive fallback.

If measurement shows that a single permission check is doing disproportionate
work, keep the same precedence but express mutually exclusive stages with a
short-circuiting `case`:

1. return `true` for an explicit direct allow;
2. return `false` when any direct override exists;
3. return `true` for an allowed sourced grant;
4. only then resolve inherited role permissions.

Do not weaken authorization or assume that every user receives permissions the
same way. Test direct allow, direct deny, sourced allow, inherited allow, and no
grant, and compare both the boolean result and execution metrics.

## API Authorization

For APIs, validate identity and permissions at the start of the endpoint and
return `401` for unauthenticated users or `403` for authenticated users without
permission. See [API Authentication](../api/authentication.md) for JWT, signed
request, and session-token patterns.

## User Management

Use block-provided user/role pages or `StandardUserManagement` for admin UI.
Customize user-type `writeFields`, `nameNode`, `detailInfoNode`, and hooks when
admin create/update flows need domain fields.

## Checklist

- Define user-type tables before `AuthBlock`.
- Include every login method in `appAuthTypes`.
- Use descriptive permission names and assign least privilege.
- Wrap every protected app with an auth component.
- Repeat permission checks in API/server mutations.
- Use shared cookie domains only for related subdomain apps.
- Test unauthorized, wrong-permission, and valid-permission paths.
