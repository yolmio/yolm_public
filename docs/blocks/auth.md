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

`AuthBlock` is the system block that adds users, roles, permissions, sessions,
2FA, impersonation, login gates, and user/role management UI. Use it instead of
hand-rolling auth schema. Most systems use this block.

```tsx
import { AuthBlock } from "blocks/auth";
```

## Minimal Setup

Define user-type tables first, then register the block in `core.tsx`.
`AuthBlock` creates the `sys_users` table itself — do **not** define `sys_users`
yourself (the constructor throws if it already exists).

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

Wrap the app UI in a login gate (typically around `<AppRoutes>`, not inside a
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

Inside generation code, fetch the configured block with
`system.block(AuthBlock)` or `useBlock(AuthBlock)`.

## Configuration

`new AuthBlock(opts)` options:

| Option            | Type                                                                                   | Required | Meaning                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `permissions`     | `(string \| { name; displayName?; description?; group? })[]`                           | Yes      | Permission values; becomes the `auth_permission` enum. Object form adds display metadata used by role/user UI.                                         |
| `appAuthTypes`    | `("otp" \| "username_password" \| "email_password" \| "google" \| "single_sign_on")[]` | Yes      | Login mechanisms to provision. Adds password columns, `session_token_type` enum values, and the OTP table as needed.                                   |
| `userTypes`       | `(string \| UserTypeTable)[]`                                                          | No       | Domain tables (e.g. `employees`, `members`) linked to `sys_users`. Drives display names, search, and admin forms.                                      |
| `userTable`       | `(table: TableBuilder) => void`                                                        | No       | Add extra columns to the generated `sys_users` table.                                                                                                  |
| `legacyPasswords` | `boolean`                                                                              | No       | Add legacy-password columns for migration. Requires `email_password` in `appAuthTypes`.                                                                |
| `disableDisabled` | `boolean`                                                                              | No       | Omit the `disabled` flag column on `sys_users` (default keeps it).                                                                                     |
| `accessPolicy`    | `{ sysadminPermission; assignableRoles? }`                                             | No       | Enable delegated access management using an existing sysadmin permission. Optional role names restrict which ordinary roles staff managers can assign. |
| `secondFactor`    | `SecondFactorConfig`                                                                   | No       | Provision 2FA tables and enable second-factor methods. See [Second Factor](#second-factor-2fa).                                                        |

`UserTypeTable` shape:
`{ table: string; fieldName?: string; onInsert?; icon?:
Node; tableCellNode?: Node; detailInfoNode?: Node; nameNode?: Node; writeFields?:
Node }`.
`fieldName` defaults to `` `${singularize(table)}_id` `` and is added to
`sys_users` as an FK to the user-type table.

`nullableMustChangePassword: true` makes the password-auth field
`sys_users.must_change_password` nullable, with NULL treated as false. New rows
still default to false. Use this when adding password authentication to an
existing system that cannot run an automatic backfill, such as Studio. The
default remains NOT NULL, and this option does not enable password authentication
or add the field to an OTP-only system.

## Delegated access management

AuthBlock automatically adds `can_impersonate_users` (Impersonate users) and
`can_manage_staff_access` (Manage staff access) to `auth_permission`. Do not
repeat them in each system's permission list. These definitions do not grant
access to anyone automatically.

Enable the shared policy in each system:

```tsx
new AuthBlock({
  permissions: ["can_access_sysadmin_app", "read_orders"],
  appAuthTypes: ["otp"],
  accessPolicy: { sysadminPermission: "can_access_sysadmin_app" },
});
```

| Authority                      | What it allows                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Impersonate users              | Start impersonation only when every effective permission the target has is also held by the actor. Role inheritance, rule-generated grants, and direct denials participate in this comparison.                                               |
| Manage staff access            | Assign or remove ordinary manual roles on other people's accounts. The manager does not need the business permissions being assigned; HR can assign Accounting without opening Accounting.                                                   |
| Configured sysadmin permission | Edit roles, inherited permissions, direct overrides, credentials, and protected accounts; bypass the impersonation permission ceiling, including newly added permissions. This does not automatically bypass business-app permission checks. |

Roles containing either management permission or the configured sysadmin
permission, including inherited grants, are protected. Ordinary staff managers
cannot modify their own access or accounts with these authorities. Optional
`assignableRoles` restricts assignments further; omitted means all roles without
protected grants, and `[]` means none. Only sysadmins can define or change
roles.

Use `StandardUserManagement` within an authenticated app. The user detail page
shows each role once, with its manual and rule-managed assignment sources.
Permitted staff-role actions appear in that same list; sysadmins use **Edit
access** for changes. Removing a manual assignment leaves rule-managed access
intact.
With `accessPolicy` enabled, these actions call the shared
`auth_change_staff_role` stored procedure. The UI verifies the original session
and runs its mutation hook before passing the server's `current_user`; the
procedure rechecks target and role eligibility inside the caller's transaction.
An explicit remove remains a remove if another operator already removed it.

`adminApp` admits staff-access and
impersonation operators to user pages while guarding database and configuration
routes with sysadmin authorization. Custom app login gates still need to admit
the intended operators. SQL policy helpers are exported from
`blocks/auth/access_policy`; `AccessCheck` provides server-evaluated UI
visibility. Visibility does not replace server authorization on custom
mutations.

OTP and email/password sessions recheck impersonation eligibility on each
request. Ending, expiry, disabling either account, or a permission change can
stop impersonation. Starting another impersonation ends the actor's previous
active impersonations. A reason, 1–60 minute duration, and domain are required;
the initiating app is excluded. If app suggestions are supplied, only their
eligible domains may be selected. Otherwise a normalized domain can be entered;
the target app still enforces its own login permissions. OTP and email/password
API authentication applies the app's permission and custom eligibility checks
to the effective user after resolving impersonation. The original session must
remain valid and its owner enabled, but that owner need not hold the target
app's permission when using the sysadmin override. The target app shows an
End impersonation action. Access-management writes require the original
authenticated session, preventing nested impersonation or administering access
as the target. Explicit development auth bypass does not require a cookie.

WorkforceBlock uses the same policy for relationship and assignment edits.
`assignableJobProfiles` optionally restricts job profile codes. Mappings with
protected roles or extra permissions require sysadmin, including inherited,
inactive, and future rules. Historical assignments are considered too; changes
to a person with an unapproved historical profile require sysadmin. Definitions,
imports, new login creation, identity fields, and reporting edits remain
sysadmin operations. Existing manual and unrelated source grants are preserved.

This is an additive enum change: no tables or columns are added for delegation,
and existing role/user/source and impersonation records are reused. Existing
systems without `accessPolicy` retain their previous management gates. Configure
the sysadmin permission first, then grant the two new authorities deliberately.
Custom identity editors and mutation APIs must enforce equivalent checks; these
components do not add database-wide row authorization.

## Login Components

Each login component is an authorization gate: it renders a login screen when no
valid session exists and its `children` once authenticated. Place it around the
app UI, not inside a `<Route>`. All are reachable as `AuthBlock.<Name>` and most
also via a submodule import.

| Component              | Import                                                                  | Required props                                                              | Use                                               |
| ---------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| `OTPAuth`              | `blocks/auth/otp_auth` / `AuthBlock.OTPAuth`                            | `identifier`, `channels`, `children`                                        | Email and/or SMS one-time-code login.             |
| `defaultEmailOtpAuth`  | `blocks/auth/otp_auth` / `AuthBlock.DefaultEmailOtpAuth`                | `children`                                                                  | Email-only OTP keyed on the user's `email`.       |
| `EmailPasswordAuth`    | `blocks/auth/email_password_auth` / `AuthBlock.EmailPasswordAuth`       | `identifier`, `email`, `children`                                           | Email + password with self-setup and reset flows. |
| `UsernamePasswordAuth` | `blocks/auth/username_password_auth` / `AuthBlock.UsernamePasswordAuth` | `children`                                                                  | Username + password.                              |
| `SingleSignOn`         | `blocks/auth/single_sign_on` / `AuthBlock.SingleSignOn`                 | `redirectUrl`, `samlAssertionUrl`, `fieldMapping`, `createUser`, `children` | SAML SSO.                                         |
| `MultiAuthProvider`    | `blocks/auth/multi_auth`                                                | `authTypes`, `children`                                                     | Combined email/SMS OTP and email/password.        |
| `MagicLinkAuth`        | `blocks/auth/magic_link_auth`                                           | `getUserFromToken`, `children`                                              | Token-link login (rarely recommended).            |

`OTPLogin` (`blocks/auth/otp_auth` / `AuthBlock.OTPLogin`) is the bare OTP login
screen without the gate, for custom layouts.

The password/OTP gates (`OTPAuth`, `defaultEmailOtpAuth`, `EmailPasswordAuth`,
`UsernamePasswordAuth`) share these optional props: `applicationName`,
`loginText`, `logo`, `requiredPermission`, `validateUser`, `cookieName`,
`cookieDomain`, `cookieExpiration`, `belowLoginNode`, `afterLoginServer`,
`secondFactor`, `idleTimeout`, `sx`, `className`. `cookieExpiration` controls
server-side session validity; the browser cookie itself is always issued for one
year. Use a relative expression such as `sql\`date.add(hour, 24, now())\`` so
the block can derive the intended session duration.

### OTPAuth

| Prop             | Type                                                                                                   | Required | Meaning                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `identifier`     | `"email" \| "phone" \| { field: "email" \| "phone"; getUserFromIdentifier: (identifier: Sql) => Sql }` | Yes      | How to resolve a user from the entered value. String form derives the lookup from `userTypes`.                                                                                                                                                               |
| `channels`       | `{ email?: { fromEmail?; getEmailFromUserId? }; sms?: { getPhoneFromUserId?; sendSms?; fromPhone? } }` | Yes      | Delivery channels; supply at least one. SMS requires `sendSms` or `fromPhone` unless `requestCode` owns delivery.                                                                                                                                            |
| `defaultChannel` | `"email" \| "sms"`                                                                                     | No       | Pre-selected channel when both are enabled.                                                                                                                                                                                                                  |
| `rateLimit`      | `{ maxAttempts: Sql; timeWindow: Sql }`                                                                | No       | OTP throttling. Defaults: 3 attempts / 10 minutes.                                                                                                                                                                                                           |
| `requestCode`    | `(s, { identifier, selectedChannel, userIdOutput, errorOutput }) => void`                              | No       | Advanced override for delegating user resolution, auditing, throttling, delivery, and OTP registration to reusable server code such as a stored procedure. It must write either the successful user ID or a user-facing error to the supplied output scalar. |
| `children`       | `Node`                                                                                                 | Yes      | Protected app UI.                                                                                                                                                                                                                                            |

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

When supplying `channels.sms.sendSms`, use the server callback shape
`(s, { to, code, from, errorJsonScalar }) => void`. `to` and `code` are SQL
expressions; `from` is an optional SQL expression or string; and
`errorJsonScalar` names the optional scalar where a provider error JSON value is
written. The callback should call `s.sendSms(...)` or another supported SMS
delivery path and preserve the supplied error scalar when reporting failures.

### EmailPasswordAuth

| Prop                  | Type                                                                                                                         | Required | Meaning                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `identifier`          | `"email" \| { field: "email"; getUserFromIdentifier; label?; placeholder?; inputType?; requiredMessage?; notFoundMessage? }` | Yes      | User lookup by email. String form derives the lookup from `userTypes`.          |
| `email`               | `{ fromEmail?: Sql \| string; getEmailFromUserId?: (userId: Sql) => Sql }`                                                   | Yes      | Code-email config. `getEmailFromUserId` is derived from `userTypes` if omitted. |
| `minPasswordLength`   | `number`                                                                                                                     | No       | Default 8.                                                                      |
| `allowForgotPassword` | `boolean`                                                                                                                    | No       | Default true.                                                                   |
| `allowSelfSetup`      | `boolean`                                                                                                                    | No       | Default true; lets a user without a password set one via an emailed code.       |
| `children`            | `Node`                                                                                                                       | Yes      | Protected app UI.                                                               |

`EmailPasswordAuthProps` is exported from `blocks/auth/email_password_auth`.

### SingleSignOn

| Prop                                                  | Type                                                    | Required | Meaning                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `redirectUrl`                                         | `string`                                                | Yes      | Identity-provider URL to send the browser to.                                                                          |
| `samlAssertionUrl`                                    | `string`                                                | Yes      | API endpoint path that receives the SAML assertion (POST).                                                             |
| `fieldMapping`                                        | `string[]`                                              | Yes      | SAML attribute names to extract into the user-details record.                                                          |
| `createUser`                                          | `(s: EndpointStatements, { userDetails: Sql }) => void` | Yes      | Create a `sys_users` row (and profile) from SAML attributes.                                                           |
| `getUser`                                             | `({ userDetails: Sql }) => Sql`                         | No       | Resolve an existing user id; `createUser` runs when it returns null.                                                   |
| `cookieName`                                          | `string`                                                | No       | Default `y-t`.                                                                                                         |
| `cookieExpires`                                       | `Sql`                                                   | No       | Server-side session validity expression, typically relative to `now()`. The browser cookie is still issued for 1 year. |
| `logoutUrl`                                           | `string`                                                | No       | IdP logout URL.                                                                                                        |
| `validateUser` / `requiredPermission` / `idleTimeout` | —                                                       | No       | Standard gate options.                                                                                                 |
| `children`                                            | `Node`                                                  | Yes      | Protected app UI.                                                                                                      |

### MultiAuthProvider

Wrap protected UI directly; the provider renders the login screen when needed:

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

Enable `otp` and `email_password` in the underlying `AuthBlock.appAuthTypes`. At
least one method is required. `defaultMethod` is `"otp"` (when enabled) or
`"email_password"`. With both enabled, the default method is shown first, with
“Use a password instead” or “Use a code instead” beneath the form. OTP offers
email/text delivery through a secondary action below its send-code button. Configure its phone
lookup or SMS sender just as for `OTPAuth`.

Shared permission, user validation, cookie, session timeout and second-factor
settings apply to both methods. Password setup and recovery reuse the existing
email verification flow. Switching methods retains an email identifier and
discards the previous form's password/code state; phone and custom text/username
identifiers are cleared when switching.

Development auto-login and user selection use the default method's provider,
including its custom identifier lookup. Optional `unauthorized` replaces the
login UI while retaining the session gate. All standalone provider settings
remain available: shared policy/layout/session options at the top level, and
identifier, delivery, throttling and password options under each method. As in
`EmailPasswordAuth`, `authTypes.emailPassword.rateLimit` throttles
setup/recovery code requests; it does not limit password guesses.
Use `authTypes.emailPassword.passwordRateLimit` (or the same prop on
`EmailPasswordAuth`) to limit failed password attempts per account, with
``{ maxAttempts: sql`10`, timeWindow: sql`15` }`` for ten failures in fifteen
minutes. It is opt-in and uses the existing login-failure table. The count and
failure write are transactional; switching methods or identifiers does not
reset the resolved account's limit. Successful login does not clear recent
failures. OTP delivery limits remain independent.

This replaces the old Google/email provider API. Google OAuth, signup and the
static route sub-components are no longer part of `MultiAuthProvider`.
`MultiAuthConfig` and `MultiAuthProviderConfig` remain exported. See
`examples/multi_auth` for a seeded standalone example.

## Permissions and Roles

Permissions can be plain strings or objects with display metadata:

```tsx
new AuthBlock({
  permissions: [
    "orders_read",
    "orders_write",
    { name: "users_manage", displayName: "Manage Users", group: "Admin" },
  ],
  appAuthTypes: ["email_password"],
  userTypes: ["employees"],
});
```

### Permission helpers

All return `Sql` and are importable from `blocks/auth`. Use them inside
`sql\`...\``or`s.defScalar`.`userHasPermission`,`roleHasPermission`, and`countRolePermissions`are also available as`AuthBlock.*`.

| Helper                     | Signature                              | Returns                                                                                                                         |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `userHasPermission`        | `(permission: Sql, user: NumericExpr)` | Boolean expr: user holds the permission directly or via the role-`extends` hierarchy. Direct user denials override role grants. |
| `currentUserHasPermission` | `(permission: Sql)`                    | `userHasPermission` bound to `current_user`.                                                                                    |
| `roleHasPermission`        | `(permission: Sql, role: NumericExpr)` | Boolean expr including permissions inherited via `extends`.                                                                     |
| `countRolePermissions`     | `(role: NumericExpr)`                  | Scalar subquery: count of distinct allowed permissions (incl. inherited).                                                       |
| `getUserPermissions`       | `(user: NumericExpr)`                  | Query selecting every `permission` a user has.                                                                                  |
| `getRolePermissions`       | `(role: NumericExpr)`                  | Query selecting every `permission` a role allows.                                                                               |

### Permission check components

| Component                      | Props                                                        | Behavior                                                        |
| ------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `AuthBlock.PermissionCheck`    | `{ permission: string; children: Node; fallback?: Node }`    | Renders `children` only if the current user holds `permission`. |
| `AuthBlock.PermissionCheckAny` | `{ permissions: string[]; children: Node; fallback?: Node }` | Renders if the user holds any listed permission.                |
| `AuthBlock.PermissionCheckAll` | `{ permissions: string[]; children: Node; fallback?: Node }` | Renders if the user holds all listed permissions.               |

```tsx
<AuthBlock.PermissionCheck permission="users_manage">
  <AdminTools />
</AuthBlock.PermissionCheck>;
```

Permission checks in UI control rendering only. Enforce authorization for data
writes and APIs on the server too — see
[API Authentication](../api/authentication.md).

## Pages and Components

| Export                        | Import                                                                      | Self-routing | Notes                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `StandardUserManagement`      | `blocks/auth/standard_user_management` / `AuthBlock.StandardUserManagement` | Yes          | Registers the user directory, dedicated login/access detail and edit routes, and the role pages. Place inside `<AppRoutes>`. |
| `RolePages`                   | `AuthBlock.RolePages`                                                       | Yes          | Role list/detail/add/edit pages.                                                                                             |
| `UserDetailPage`              | `blocks/auth/users` / `AuthBlock.UserDetailPage`                            | Yes          | Dedicated account page at `/users/{record_id:id}` for roles, effective permissions, password, sessions, and impersonation.   |
| `UserAccountManagementButton` | `blocks/auth/users` / `AuthBlock.UserAccountManagementButton`               | No           | Links a known `sys_users` id to the dedicated login/access page, or shows `No login` when the id is null.                    |
| `UsersList`                   | `blocks/auth/users` / `AuthBlock.UsersList`                                 | No           | User table; place inside your own `<Route>`.                                                                                 |
| `UserForm`                    | `blocks/auth/users` / `AuthBlock.UserForm`                                  | No           | Create/edit user form body.                                                                                                  |
| `UserProfileCards`            | `blocks/auth/standard_user_management` / `AuthBlock.UserProfileCards`       | No           | Linked-profile editor used inside `UserForm`.                                                                                |

`StandardUserManagement` is the usual entry point; the rest let you assemble
custom screens. Self-routing pages must **not** be wrapped in `<Route>`.

```tsx
<AppRoutes>
  <AuthBlock.StandardUserManagement requiredPermission="users_manage" />
</AppRoutes>;
```

`StandardUserManagementProps`: `backHomeButton?`, `disableAddButton?`,
`showProfilesOnDetail?`, `showProfilesOnUpdate?`, `requiredPermission?`,
`userProfiles?: UserProfileManagementConfig`,
`impersonationApps?: ImpersonationAppOption[]`, `onInsert?`, `onUpdate?`. Linked
domain profiles are included in Login & Access detail and editing by default for
backward compatibility. Set `showProfilesOnDetail={false}` and
`showProfilesOnUpdate={false}` when those fields have a dedicated owning detail
page, such as Workforce People. `requiredPermission` keeps routes registered but
renders an access alert without the permission. `onInsert`/`onUpdate` each
accept `{ beforeTransactionCommit?, afterTransactionCommit? }` hooks
`(s: UiServerStatements, recordId: NumericExpr) => void`.

`impersonationApps` adds application shortcuts to the impersonation dialog. Each
option accepts `name`, canonical `domain`, optional `icon`, and optional
`visible` SQL. Use `AuthBlock.userHasPermission(permission, userId)` for
`visible` when suggestions should reflect the impersonated user's access. The
dialog also accepts a pasted HTTP(S) URL or bare domain and stores its
normalized hostname.

The Login & Access detail page lists only effective permissions and labels every
grant source: `Direct`, `Role · <name>`, or `Rule · <source>`. Multiple sources
remain visible when they grant the same permission. The edit page keeps manual
roles and permission overrides separate from read-only rule-managed entries. The
same role may have both a manual and a rule-managed assignment so removing the
rule does not unexpectedly remove deliberate access. Rule-managed permission
entries reflect unsaved manual overrides immediately. Administrators add an
explicit Allow or Deny override through the searchable permission picker instead
of editing a checkbox for every system permission.

Role grants and Workforce role-rule extras use the same
`AuthBlock.PermissionPicker` and `AuthBlock.PermissionEntry` components. Search
matches the permission name, display name, description, and group without case
sensitivity. Selected permissions are excluded from the picker. Only individual
login overrides offer Deny; roles and workforce rules add grants and display
inherited access separately.

User and role details share permission grouping, search, and empty states through
`PermissionListCard` in `blocks/auth/permissions`. User details additionally show
the sources of each grant.

Login forms and workforce rule editors use `AuthBlock.RoleSelector`. It takes
`selected(role)` and `onSelect(s, role, name)`, excludes roles already selected in
the current draft, and lets the caller own selection state and persistence.

`PermissionPicker` takes `selected(permission)`,
`onSelect(s, permission, allowed)`, and optional `overrides`. The caller owns
temporary selection state and persistence. `PermissionEntry` takes
`permission`, optional `label`, and `children` for source labels or actions.

`UserAccountManagementButton` takes `{ userId: NumericExpr }`. Use it from a
person or customer page instead of duplicating login, role, password, or session
controls there.

`UserDetailPage` props: `name: Node` (required), `userInfo?: Node`,
`backButtonRef?: string`, `wrapper?: (children: Node) => Node`.
`passwordManagement?: { requiredPermission: string; allowSetPassword?: boolean }`
restricts password set/reset/forced-change controls and their server writes to
an enabled user with the specified permission. Existing access-policy and
`beforeUserMutation` checks still apply. `allowSetPassword: true` also exposes
direct administrator assignment for email/password accounts; it defaults off.
This policy does not change session or impersonation management.

`RolePages` props: `backHomeButton?`, `backButtonRef?`, `rolePagePath?`,
`wrapper?`.
When `rolePagePath` customizes the list URL, `/roles` redirects to that list so
existing back and cancel links remain valid.

`UsersList` props: `columns?: (b: ColumnsBuilder) => void`,
`additionalColumns?:
Sql`, `additionalFrom?: Sql`, `disableAddButton?`,
`backHomeButton?`.

## User Types

`userTypes` links `sys_users` to domain tables (employees, customers, members,
etc.) through an FK. Each entry may be a table name or a `UserTypeTable` object
for custom display, write fields, or an `onInsert` hook. `nameNode` and
`detailInfoNode` render against the `user_type_detail` record selected by the
admin pages.

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

Use `UserProfileManagementConfig` (the `userProfiles` prop on
`StandardUserManagement`) to choose link/create/edit behavior per table:
`UserProfileInsertBehavior` = `"link" | "create" | "link_or_create"`,
`UserProfileUpdateBehavior` = `"link" | "edit" | "link_or_edit"`.

## Second Factor (2FA)

Enable methods system-wide on the block, then opt a login gate into one method
per app.

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

`SecondFactorConfig.methods` is the only wired-up field today; `required`,
`userPrompts`, and `recovery` are reserved for future use. On a login gate, pass
`secondFactor={{ method: "totp" | "sms" | "email", required?, rateLimit? }}`
(type `AppSecondFactorConfig`). Method config types: `TOTPConfig`, `SMSConfig`,
`EmailConfig`.

## Impersonation

Impersonation is built into the gates. Admins start it from the user detail
page; it applies only on the domains listed for that impersonation and only for
its duration. Backed by `auth_impersonations` and `auth_impersonation_domains`.

## Sessions and Cookies

Gates issue a session cookie (default name `y-t`) and write a row to
`auth_session_tokens`. The browser cookie is always issued for one year. Actual
session validity is checked at request time from `auth_session_tokens.issued`
plus the current app's `cookieExpiration` / `cookieExpires` setting (one year
when unset), so apps can share a cookie while still enforcing different session
durations.

Set `cookieName` and `cookieDomain` consistently across apps to share login
across subdomains. Logout deletes the session row and clears the cookie. Admins
can also clear a user's session tokens from the standard user detail page, which
revokes any device still holding that cookie. Do not use `auth_session_tokens`
as a generic business-token table.

Each gate accepts
`afterLoginServer(s: UiServerStatements, props:
AfterLoginServerProps)`, run on
the server right after a successful login. `AfterLoginServerProps` (exported):
`user` — the authenticated user's `sys_users` id; `session` — the new session
token's `public_id` UUID (the value stored in the cookie). Use it for per-login
work such as audit rows.

## API Authentication

`AuthBlock.validateApi(s: EndpointStatements, cookieName: Sql, sessionExpiration?: Sql)`
reads the session cookie and sets the `auth_user_id` scalar (null when not
authenticated or expired). It does **not** return 401 — the caller decides. See
[API Authentication](../api/authentication.md).

## Tables Created

Always created:

| Table                          | Purpose                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `sys_users`                    | One row per login. FKs to user-type tables; password columns when password auth is enabled.       |
| `auth_roles`                   | Named roles with optional `extends` inheritance.                                                  |
| `auth_role_permissions`        | Per-role grants/denials (`permission`, `is_allowed`).                                             |
| `auth_user_roles`              | Manual role assignments.                                                                          |
| `auth_user_role_sources`       | Non-manual role grants (`source`, `source_record_id`).                                            |
| `auth_user_permissions`        | Direct per-user grants/denials (override roles).                                                  |
| `auth_user_permission_sources` | Non-manual direct permission grants.                                                              |
| `auth_impersonations`          | Impersonation records (`impersonator`, `impersonatee`, `issued`, `duration`, `reason`, `active`). |
| `auth_impersonation_domains`   | Domains an impersonation applies to.                                                              |
| `auth_session_tokens`          | Session tokens issued at login (`public_id` UUID stored in cookie, `issued`, `type`).             |
| `auth_login_failures`          | Failed login attempts for monitoring/rate limiting.                                               |

Created conditionally:

| Table                                  | Created when                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `auth_otp_registrations`               | `appAuthTypes` includes `otp` or `email_password`. Holds OTP code hashes for login/setup/reset. |
| `auth_second_factor_settings`          | `secondFactor` set.                                                                             |
| `auth_second_factor_totp`              | `secondFactor.methods.totp` set.                                                                |
| `auth_second_factor_otp_registrations` | `secondFactor.methods.sms` or `.email` set.                                                     |

Do not recreate these tables manually.

## Enums Created

| Enum                           | Created when                        | Values                                                          |
| ------------------------------ | ----------------------------------- | --------------------------------------------------------------- |
| `auth_permission`              | Always                              | Your `permissions`.                                             |
| `session_token_type`           | Always                              | Depends on `appAuthTypes` (e.g. `otp_email`, `email_password`). |
| `auth_otp_registration_type`   | `otp` or `email_password`           | `email`, `sms`.                                                 |
| `recent_multi_auth_login_type` | `google`                            | `google`, `email`.                                              |
| `auth_second_factor_method`    | `secondFactor` set                  | `totp`, `sms`, `email`.                                         |
| `auth_second_factor_otp_type`  | `secondFactor.methods.sms`/`.email` | `email`, `sms`.                                                 |

## Exported Types

From `blocks/auth`: `AfterLoginServerProps`, `DefaultAuthComponentProps`,
`AppSecondFactorConfig`, `AppSecondFactorMethod`, `SecondFactorConfig`,
`TOTPConfig`, `SMSConfig`, `EmailConfig`, `IdleTimeoutConfig`,
`StandardUserManagementProps`, `UserProfileManagementConfig`,
`UserProfileManagementOptions`, `UserProfileInsertBehavior`,
`UserProfileUpdateBehavior`, `UserAccountManagementButtonProps`.
`EmailPasswordAuthProps` and `Logo` come from `blocks/auth/email_password_auth`
and `blocks/auth/otp_auth` respectively. `IdleTimeoutConfig` is
`{ idleMinutes?: number; warningSeconds?: number }`.

## Common Mistakes

- Defining `sys_users` yourself — `AuthBlock` creates it; the constructor throws
  if it already exists.
- Registering `AuthBlock` before defining the referenced user-type tables.
- Creating custom user/role/session tables parallel to the block's tables.
- Wrapping a self-routing page (`StandardUserManagement`, `UserDetailPage`,
  `RolePages`) in a `<Route>`.
- Enabling `legacyPasswords` without `email_password` in `appAuthTypes`.
- Checking permissions only in UI when server/API writes also need protection.
- Treating `auth_session_tokens` as a place for password setup/reset codes —
  those live in `auth_otp_registrations`.
