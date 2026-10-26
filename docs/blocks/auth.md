---
title: AuthBlock
description: AuthBlock adds a sys_users table, roles, permissions, sessions, impersonation, OTP/password/SSO login gates, and user-management pages.
tags:
  - blocks
  - authentication
  - authorization
  - security
related:
  - concepts/auth_multi_user.md
  - api/authentication.md
  - blocks/solution_blocks.md
  - concepts/blocks.md
---

# AuthBlock

`AuthBlock` adds users, roles, permissions, sessions, 2FA, impersonation,
login gates, and user/role management UI. Use it instead of hand-rolling auth
schema.

## Minimal Setup

Define user-type tables first, then register the block in `core.tsx`.
`AuthBlock` creates `sys_users` itself; the constructor throws if it already
exists.

```tsx
import { AuthBlock } from "blocks/auth";
import { system } from "std/system";

const { db } = system;

db.table("employees", (table) => {
  table.string("name", 100).notNull();
  table.email("email");
});

system.addBlock(
  new AuthBlock({
    permissions: ["admin", "users_manage", "orders_read"],
    accessPolicy: { sysadminPermission: "admin" },
    appAuthTypes: ["otp", "email_password"],
    userTypes: ["employees"],
  }),
);
```

Wrap the app UI in a login gate (around `<AppRoutes>`, not inside a
`<Route>`):

```tsx
<AuthBlock.EmailPasswordAuth
  identifier="email"
  email={{ fromEmail: "auth@example.com" }}
  requiredPermission="orders_read"
  applicationName="Operations"
>
  <AppRoutes>{/* ... */}</AppRoutes>
</AuthBlock.EmailPasswordAuth>;
```

In generation code, fetch the configured block with `system.block(AuthBlock)`
or `useBlock(AuthBlock)`.

## Configuration

Non-obvious `new AuthBlock(opts)` options (see `AuthOpts` in
`packages/blocks/auth/index.tsx`):

| Option | Meaning |
| --- | --- |
| `permissions` | Required. Strings or `{ name, displayName?, description?, group? }`; becomes the `auth_permission` enum. |
| `appAuthTypes` | Required. Subset of `otp`, `username_password`, `email_password`, `google`, `single_sign_on`; adds password columns, `session_token_type` values, and OTP tables as needed. |
| `userTypes` | Domain tables linked to `sys_users` (see [User Types](#user-types)). |
| `userTable` | Adds extra columns to the generated `sys_users`. |
| `legacyPasswords` | Adds legacy-password columns for migration; throws unless `email_password` is enabled. |
| `nullableMustChangePassword` | Makes `sys_users.must_change_password` nullable (NULL means false; new rows still default false). Use when adding password auth to a system that cannot backfill. Does not enable password auth. |
| `disableDisabled` | Omits the `disabled` column on `sys_users`. |
| `accessPolicy` | `{ sysadminPermission, assignableRoles? }`; enables delegated access management. `sysadminPermission` must be a declared permission. |
| `secondFactor` | Provisions 2FA (see [Second Factor](#second-factor-2fa)). |
| `sessionActivity` | Provisions `auth_session_activity`; required by `idleTimeout` (see [Idle Timeout](#idle-timeout)). |

## Delegated access management

AuthBlock always adds `can_impersonate_users` and `can_manage_staff_access` to
`auth_permission`; do not repeat them in `permissions`. They grant nothing by
themselves. Enable the policy with `accessPolicy`, as in Minimal Setup.

| Authority | What it allows |
| --- | --- |
| Impersonate users | Impersonate only targets whose every effective permission the actor also holds (role inheritance, rule grants, and direct denials included). |
| Manage staff access | Assign or remove ordinary manual roles on other accounts without holding the business permissions being assigned. |
| Configured sysadmin permission | Edit roles, inherited permissions, overrides, credentials, and protected accounts; bypass the impersonation ceiling. Does not bypass business-app permission checks. |

- Roles containing either management permission or the sysadmin permission
  (including inherited) are protected. Staff managers cannot modify their own
  access. `assignableRoles` restricts further: omitted means all unprotected
  roles, `[]` means none. Only sysadmins define or change roles.
- Staff-role actions in `StandardUserManagement` call the
  `auth_change_staff_role` stored procedure, which rechecks target and role
  eligibility in the caller's transaction. Removing a manual assignment leaves
  rule-managed access intact; an explicit remove stays a remove if someone
  already removed it.
- `adminApp` admits staff-access and impersonation operators to user pages
  while guarding database and configuration routes with sysadmin
  authorization. Custom login gates must still admit the intended operators.
- SQL policy helpers are in `blocks/auth/access_policy`; `AccessCheck`
  (`blocks/auth/access_check`) gives server-evaluated UI visibility only.
  Custom identity editors and mutation APIs must enforce equivalent checks.
- Access-management writes require the original authenticated session, so
  nobody can administer access while impersonating.
- WorkforceBlock reuses this policy; `assignableJobProfiles` is a SQL predicate
  over the job-profile record. Mappings with protected roles or extra
  permissions (including inherited, inactive, future, and historical ones)
  require sysadmin. Definitions, imports, new login creation, identity fields,
  and reporting edits stay sysadmin-only; existing manual and unrelated source
  grants are preserved.
- The change is additive (enum values only). Systems without `accessPolicy`
  keep their previous management gates.

## Login Components

Each gate renders a login screen without a valid session and its `children`
once authenticated. All are reachable as `AuthBlock.<Name>`.

| Component | Import | Use |
| --- | --- | --- |
| `OTPAuth` | `blocks/auth/otp_auth` | Email and/or SMS one-time code. |
| `defaultEmailOtpAuth` | `blocks/auth/otp_auth` (`AuthBlock.DefaultEmailOtpAuth`) | Email-only OTP keyed on `email`. |
| `OTPLogin` | `blocks/auth/otp_auth` | Bare OTP screen without the gate. |
| `EmailPasswordAuth` | `blocks/auth/email_password_auth` | Email + password with self-setup and reset. |
| `UsernamePasswordAuth` | `blocks/auth/username_password_auth` | Username + password. |
| `SingleSignOn` | `blocks/auth/single_sign_on` | SAML SSO. |
| `MultiAuthProvider` | `blocks/auth/multi_auth` | Combined OTP and email/password. |
| `MagicLinkAuth` | `blocks/auth/magic_link_auth` | Token-link login (rarely recommended). |

Gates share `DefaultAuthComponentProps` (`applicationName`, `logo`,
`requiredPermission`, `validateUser`, cookie options, `afterLoginServer`,
`secondFactor`, `idleTimeout`, and layout props). Exported prop types:
`OTPAuthProps`, `EmailPasswordAuthProps`, and `MultiAuthProviderConfig` in
their modules.

- `cookieExpiration` (`cookieExpires` on `SingleSignOn`) sets server-side
  session validity; the browser cookie is always issued for one year. Use a
  relative expression such as ``sql`date.add(hour, 24, now())` ``.
- `identifier="email"`/`"phone"` derives the lookup from `userTypes`; the
  object form supplies `getUserFromIdentifier`.

### OTPAuth

```tsx
<AuthBlock.OTPAuth
  requiredPermission="admin_app"
  identifier={{
    field: "email",
    getUserFromIdentifier: (email) =>
      sql`(select sys_users.id from members auto join sys_users where members.email = ${email})`,
  }}
  channels={{
    email: {
      getEmailFromUserId: (userId) =>
        sql`(select email from sys_users auto join members where sys_users.id = ${userId})`,
    },
  }}
>
  <AppRoutes>{/* ... */}</AppRoutes>
</AuthBlock.OTPAuth>;
```

- `rateLimit` defaults to 3 attempts per 10 minutes.
- SMS requires `channels.sms.sendSms` or `fromPhone` unless `requestCode` owns
  delivery. `sendSms` has the shape `(s, { to, code, from, errorJsonScalar })`;
  call `s.sendSms(...)` or another supported path and write provider errors to
  `errorJsonScalar`.
- `requestCode(s, { identifier, selectedChannel, userIdOutput, errorOutput })`
  delegates resolution, auditing, throttling, delivery, and registration (for
  example to a stored procedure). It must write either the user ID or a
  user-facing error to the supplied output scalar.

### EmailPasswordAuth

Defaults: `minPasswordLength` 8, `allowForgotPassword` true, `allowSelfSetup`
true (a user without a password sets one via an emailed code).
`email.getEmailFromUserId` is derived from `userTypes` if omitted. `rateLimit`
throttles setup/recovery code requests only; opt-in `passwordRateLimit`, for
example ``{ maxAttempts: sql`10`, timeWindow: sql`15` }`` (minutes), limits
failed password attempts per account using `auth_login_failures`. Its count and
write are transactional, and successful login does not clear recent failures.

### SingleSignOn

Requires `redirectUrl` (IdP URL), `samlAssertionUrl` (API path receiving the
SAML POST), `fieldMapping` (SAML attribute names to extract), and
`createUser(s, { userDetails })`. Optional `getUser({ userDetails })` resolves
an existing user; `createUser` runs when it returns null. Also `logoutUrl`.

### MultiAuthProvider

```tsx
import { MultiAuthProvider } from "blocks/auth/multi_auth";

<MultiAuthProvider
  applicationName="Example"
  requiredPermission="view_app"
  authTypes={{
    otp: { identifier: "email", channels: { email: {}, sms: {} } },
    emailPassword: { identifier: "email", email: {} },
  }}
>
  <App />
</MultiAuthProvider>;
```

- Enable `otp` and `email_password` in `appAuthTypes`. `defaultMethod` is
  `"otp"` when enabled, else `"email_password"`, and must be enabled.
- Shared policy, cookie, session, and second-factor options sit at the top
  level; identifier, delivery, throttling, and password options sit under each
  method. Optional `unauthorized` replaces the login UI while keeping the gate.
- Switching methods keeps an email identifier but clears password/code state
  and phone or custom identifiers; it does not reset the account's
  `passwordRateLimit`. Development auto-login uses the default method.
- Google OAuth, signup, and static route sub-components are not supported. See
  `examples/multi_auth`.

## Permissions and Roles

Permission helpers from `blocks/auth` return `Sql`; `userHasPermission`,
`roleHasPermission`, and `countRolePermissions` are also on `AuthBlock`.

| Helper | Returns |
| --- | --- |
| `userHasPermission(permission, user)` | Boolean: direct or role-hierarchy grant; direct user denials override role grants. |
| `currentUserHasPermission(permission)` | `userHasPermission` for `current_user`. |
| `roleHasPermission(permission, role)` | Boolean including `extends` inheritance. |
| `countRolePermissions(role)` | Count of distinct allowed permissions, inherited included. |
| `getUserPermissions(user)` / `getRolePermissions(role)` | Query selecting every allowed `permission`. Prefer it to test many permissions at once. |

`AuthBlock.PermissionCheck` (`permission`), `PermissionCheckAny`, and
`PermissionCheckAll` (`permissions`) render `children` or `fallback`. They
control rendering only; enforce writes and APIs on the server (see
[API Authentication](../api/authentication.md)).

## Pages and Components

| Export | Import | Notes |
| --- | --- | --- |
| `StandardUserManagement` | `blocks/auth/standard_user_management` | Self-routing user directory, login/access pages, and role pages. Usual entry point. |
| `RolePages` | `AuthBlock.RolePages` | Self-routing role pages. A custom `rolePagePath` also redirects `/roles` to it. |
| `UserDetailPage` | `blocks/auth/users` | Self-routing `/users/{record_id:id}` for roles, permissions, password, sessions, impersonation. |
| `UserAccountManagementButton` | `blocks/auth/users` | `{ userId }`: links to the login/access page, or shows `No login` for null. Use from person pages instead of duplicating controls. |
| `UsersList`, `UserForm` | `blocks/auth/users` | User table and form body for custom screens; place `UsersList` in your own `<Route>`. |
| `UserProfileCards` | `blocks/auth/standard_user_management` | Linked-profile editor used in `UserForm`. |
| `PermissionPicker`, `PermissionEntry`, `RoleSelector` | `AuthBlock.*` | Selection widgets; the caller owns selection state and persistence. |
| `PermissionListCard` | `blocks/auth/permissions` | Shared grouped, searchable, paged permission list. |

```tsx
<AppRoutes>
  <AuthBlock.StandardUserManagement requiredPermission="users_manage" />
</AppRoutes>;
```

See `StandardUserManagementProps`. Notes:

- `requiredPermission` keeps routes registered but renders an access alert.
- Linked profiles show on Login & Access detail/edit by default; set
  `showProfilesOnDetail={false}` and `showProfilesOnUpdate={false}` when
  another page owns those fields.
- `onInsert`/`onUpdate` take `{ beforeTransactionCommit?,
  afterTransactionCommit? }` hooks `(s, recordId) => void`.
- `impersonationApps` adds `{ name, domain, icon?, visible? }` shortcuts; use
  `AuthBlock.userHasPermission(permission, userId)` in `visible` to reflect the
  target's access. A pasted URL or bare domain is normalized to its hostname.
- Detail pages label each grant source (`Direct`, `Role · <name>`,
  `Rule · <source>`). A role may have both a manual and a rule-managed
  assignment, so removing the rule keeps deliberate access.

`UserDetailPage` `passwordManagement: { requiredPermission, allowSetPassword? }`
restricts password set/reset/forced-change controls and server writes to
enabled users with that permission; `allowSetPassword: true` (default off)
allows direct administrator assignment. Access-policy and
`beforeUserMutation` checks still apply; sessions and impersonation are
unaffected.

`RoleSelector` takes `selected(role)` and `onSelect(s, role, name)`.
`PermissionPicker` takes `selected(permission)`,
`onSelect(s, permission, allowed)`, and optional `overrides`; only individual
login overrides offer Deny. Both exclude already-selected entries.

## User Types

`userTypes` entries are a table name or a `UserTypeTable` object. `fieldName`
defaults to `${singularize(table)}_id` and becomes an FK on `sys_users`.
`nameNode` and `detailInfoNode` render against the `user_type_detail` record.

```tsx
userTypes: [
  "employees",
  {
    table: "customers",
    fieldName: "customer_id",
    nameNode: sql`user_type_detail.name`,
    detailInfoNode: sql`user_type_detail.email`,
  },
];
```

`StandardUserManagement`'s `userProfiles` (`UserProfileManagementConfig`)
selects per-table behavior: insert `"link" | "create" | "link_or_create"`,
update `"link" | "edit" | "link_or_edit"`.

## Second Factor (2FA)

Enable methods on the block, then opt each gate into one method.

```tsx
new AuthBlock({
  permissions: ["admin"],
  appAuthTypes: ["email_password"],
  userTypes: ["employees"],
  secondFactor: {
    methods: {
      totp: { issuerName: "Acme" },
      email: {
        getEmailFromUserId: (id) =>
          sql`(select email from sys_users where id = ${id})`,
      },
      sms: {
        getPhoneFromUserId: (id) =>
          sql`(select phone from sys_users where id = ${id})`,
        fromPhone: "+15555550100",
      },
    },
  },
});
```

Only `SecondFactorConfig.methods` is wired up; `required`, `userPrompts`, and
`recovery` are reserved. On a gate pass
`secondFactor={{ method: "totp" | "sms" | "email", required?, rateLimit? }}`
(`AppSecondFactorConfig`).

When TOTP is configured, `UserDetailPage` (including `StandardUserManagement`)
offers **Reset authenticator** alongside the session controls. After confirmation,
it removes the user's saved TOTP secret and all session tokens in one transaction.
The next TOTP sign-in starts enrollment again. Second-factor settings and each
app's required/optional policy are preserved. The action uses the existing
access-administrator and `beforeUserMutation` checks. Without an access policy,
the action is only offered when the caller supplies `beforeUserMutation` to
authorize it on the server (as `StandardUserManagement` does).

## Impersonation

Admins start impersonation from the user detail page with a reason, a 1-60
minute duration, and a domain (the initiating app is excluded; with
`impersonationApps`, only eligible suggested domains). The target app still
enforces its own login permission; OTP and email/password API authentication
applies the app's permission and custom eligibility checks to the effective
user after resolving impersonation. The target app shows End impersonation.

OTP and email/password sessions recheck eligibility on every request; ending,
expiry, disabling either account, or a permission change stops it. Starting a
new impersonation ends the actor's previous ones. The original session must
stay valid and its owner enabled, but with the sysadmin override the owner
need not hold the target app's permission. Explicit development auth bypass
needs no cookie.

## Sessions and Cookies

Gates issue a cookie (default `y-t`) and an `auth_session_tokens` row. Validity
is checked per request from `issued` plus the current app's
`cookieExpiration` (one year when unset), so apps can share a cookie with
different session durations. Set `cookieName` and `cookieDomain` consistently
to share login across subdomains. Logout deletes the row; admins can clear a
user's tokens from the user detail page.

`afterLoginServer(s, { user, session })` runs on the server after login;
`session` is the token's `public_id` UUID stored in the cookie. Use it for
per-login work such as audit rows.

`AuthBlock.validateApi(s, cookieName, sessionExpiration?)` sets the
`auth_user_id` scalar (null when unauthenticated or expired) and does not
return 401; the caller decides. See [API Authentication](../api/authentication.md).

### Idle Timeout

`idleTimeout={{ idleMinutes, warningSeconds }}` on a gate warns and then logs
out after inactivity. It requires `sessionActivity: true` on the AuthBlock.
Tabs report input to the session about once a minute while in use; enforcing
tabs also count their own page load. Expiry uses the latest reported activity
across tabs and apps. Input not reported before a tab closes can be lost (up
to one reporting interval). A tab that slept through its deadline
still logs out on waking, even if activity elsewhere resumed the session
within the last two minutes.

Apps that share the session cookie (same `cookieName` and `cookieDomain`)
without enforcing the timeout pass `idleTimeout={{ reportOnly: true }}`, so
working in them keeps the session alive. For timeouts under four minutes,
also give them the enforcing app's `idleMinutes` so they report often enough.
Development auto-login has no session, so tabs there time out on their own.
If expiry checks repeatedly fail or never respond, only that tab locks and
offers **Reconnect**; it does not revoke the shared session.

## Tables and Enums

| Table | Purpose |
| --- | --- |
| `sys_users` | One row per login; FKs to user-type tables. |
| `auth_roles`, `auth_role_permissions` | Roles with optional `extends` inheritance and per-role grants/denials. |
| `auth_user_roles` | Manual role assignments. |
| `auth_user_role_sources` | Rule-managed role grants (`source`, `source_record_id`). |
| `auth_user_permissions` | Direct per-user grants/denials (override roles). |
| `auth_user_permission_sources` | Rule-managed direct permission grants. |
| `auth_impersonations`, `auth_impersonation_domains` | Impersonation records and the domains each applies to. |
| `auth_session_tokens` | Login sessions only; not a generic business-token table. |
| `auth_session_activity` | With `sessionActivity`: latest input per session for idle timeouts. |
| `auth_login_failures` | Failed logins for monitoring and rate limiting. |
| `auth_otp_registrations` | With `otp` or `email_password`: OTP hashes for login, setup, and reset. |
| `auth_second_factor_settings`, `auth_second_factor_totp`, `auth_second_factor_otp_registrations` | With `secondFactor` and the matching methods. |

Enums: `auth_permission` (your permissions plus the two management
permissions), `session_token_type` (per `appAuthTypes`), and conditionally
`auth_otp_registration_type`, `recent_multi_auth_login_type` (`google`),
`auth_second_factor_method`, `auth_second_factor_otp_type`. Do not recreate
any of these manually or build parallel user/role/session tables.

## Gotchas

- Self-routing pages (`StandardUserManagement`, `UserDetailPage`,
  `RolePages`) must not be wrapped in `<Route>`.
- `IdleTimeoutConfig` is
  `{ idleMinutes?: number; warningSeconds?: number; reportOnly?: boolean }`.
- `Logo` is exported from `blocks/auth/otp_auth`; `EmailPasswordAuthProps`
  from `blocks/auth/email_password_auth`.
