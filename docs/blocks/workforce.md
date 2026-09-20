---
title: Workforce Block
description: Normalized HRIS people, organizations, worker relationships, jobs, and assignments exposed to person-aware blocks through a provider contract.
tags:
  - blocks
  - workforce
  - people
  - hris
related:
  - blocks/solution_blocks.md
  - blocks/auth.md
  - blocks/training.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# Workforce Block

`WorkforceBlock` is the "who" layer of a system: people, the organizations
they belong to, their effective-dated **worker relationships** to an employer,
and the effective-dated **assignments** (job profile, position, org unit,
location) that describe the work they do. It is a normalized HRIS spine that
person-aware blocks (training, scheduling) attach to without owning workforce
tables themselves.

Use it instead of a flat people table when transfers, re-hires, promotions, or
contractor-to-employee conversions must be ordinary inserts that close one
interval and open another while preserving history. It implements the
`WorkforceProvider` contract, so consumers like `TrainingBlock` depend on
stable current-fact accessors rather than on concrete tables.

By default it does **not** own login state — that is `AuthBlock`'s job
(`sys_users`, credentials, sessions). Workforce and Auth are bridged by the
person↔`sys_users` link and the optional auth-role mappings. Systems can also
opt into one-way login revocation with `disableLoginWhenAccessIneligible`;
ineligible workforce facts then disable the linked login and revoke sessions,
but restored eligibility never re-enables an administrator-disabled account.

```ts
import {
  WorkforceAuthRoleRules,
  WorkforceAuthRoleRulesPage,
  WorkforceBlock,
  WorkforcePeoplePage,
  WorkforcePersonCreateAction,
  WorkforcePersonDetailPage,
  WorkforcePersonManagement,
} from "blocks/workforce";
import type {
  WorkforceBlockOpts,
  WorkforceProvider,
} from "blocks/workforce";
```

## Minimal Setup

Add `AuthBlock` **before** `WorkforceBlock` so the `sys_users` table exists when
the people table is defined. With the default `sysUserLink: "person_field"`, the
block throws a descriptive error during `initialize()` if `sys_users` is
missing.

```ts
import { AuthBlock } from "blocks/auth";
import { WorkforceBlock } from "blocks/workforce";
import { system } from "std/system";

system.addBlock(new AuthBlock({ appAuthTypes: ["email_password"] }));

export const workforce = new WorkforceBlock({});
system.addBlock(workforce);
```

That gives the canonical five tables: `workforce_people`,
`workforce_organizations`, `workforce_worker_relationships`,
`workforce_job_profiles`, and `workforce_assignments`, plus the four workforce
enums. Org units, locations, positions, reporting, and auth-role mappings are
opt-in (see [Configuration](#configuration)).

A fuller real-world setup enabling optional facets and extra fields:

```ts
export const workforce = new WorkforceBlock({
  sysUserLink: "sys_user_field",
  enableOrgUnits: true,
  enableLocations: true,
  enableAuthRoleMappings: true,
  definePeople: (table) => {
    table.string("first_name", 100);
    table.string("last_name", 100);
  },
  routes: {
    peopleListPath: "/workforce/people",
    personDetailPath: "/workforce/people/{record_id:id}",
    authRoleRulesPath: "/workforce/role-rules",
  },
});
system.addBlock(workforce);
```

`WorkforceBlock` implements `WorkforceProvider`, so pass the instance straight
to consumers, e.g. `new TrainingBlock({ workforce, ... })`.

## Configuration

`new WorkforceBlock(opts?: WorkforceBlockOpts)` — all options are optional.

### Facet opt-ins

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enableOrgUnits` | `boolean` | `false` | Adds the recursive org-unit table and assignment/audience fk. |
| `enableLocations` | `boolean` | `false` | Adds the locations table and assignment/audience fk. |
| `enablePositions` | `boolean` | `false` | Adds the positions (concrete seats) table and assignment fk. |
| `enableReporting` | `boolean` | `false` | Adds the effective-dated reporting-relationship table and a Reporting detail tab. |
| `enableAuthRoleMappings` | `boolean` | `false` | Adds the auth-role mapping tables and the reconciliation reactor. |

### Behavior flags

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enableRelationshipAndAssignmentCreation` | `boolean` | `false` | Shows the guided New relationship and New assignment actions on person detail tabs. |
| `enableReferenceDataCreation` | `boolean` | `false` | Shows Add actions for organizations, job profiles, and enabled optional facets on the reference-data page. Edit remains available when false. |
| `allowMultipleActiveRelationships` | `boolean` | `false` | When false, a filtered unique constraint blocks more than one open worker relationship per person. |
| `allowMultipleActivePrimaryAssignments` | `boolean` | `false` | When false, a filtered unique constraint blocks more than one open primary assignment per relationship. |
| `managementPermission` | `string` | — | Legacy management gate. When AuthBlock has `accessPolicy`, the shared delegated policy takes precedence. |
| `assignableJobProfiles` | `string[]` | — | Optional allowlist of job profile codes for staff managers. Omitted allows ordinary profiles; `[]` allows none. Protected role/permission mappings always require sysadmin. |
| `disableLoginWhenAccessIneligible` | `boolean` | `false` | Disables the linked `sys_users` row and revokes its sessions when the person lacks an active relationship and active primary assignment. This is one-way: restoring eligibility does not override an administrator's disabled-account decision. |

### Active statuses

`activePersonStatus`, `activeRelationshipStatus`, and `activeAssignmentStatus`
default to `"active"`. Each must name a value in its corresponding status list;
invalid configuration is rejected during generation. These keys determine access
eligibility, current workforce facts, and defaults for new/imported records.
List order does not determine which status is active.
Do not reorder existing deployed enums to configure eligibility.

### Identity link

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sysUserLink` | `"person_field" \| "sys_user_field"` | `"person_field"` | `person_field` stores `workforce_people.sys_user_id` (required, unique). `sys_user_field` stores `sys_users.workforce_person_id` instead — intended for systems that expose workforce people through AuthBlock `userTypes: ["workforce_people"]`. |

### Enums

Each accepts an array of `string` or `WorkforceEnumValue` (`{ name, displayName }`).
String values get a display name with the first letter capitalized
(e.g. `vendor_worker` → `Vendor_worker`).

| Option | Type | Default values |
| --- | --- | --- |
| `workerTypes` | `Array<string \| WorkforceEnumValue>` | `employee, contractor, vendor_worker, temp, intern` |
| `personStatuses` | `Array<string \| WorkforceEnumValue>` | `active, inactive` |
| `relationshipStatuses` | `Array<string \| WorkforceEnumValue>` | `active, inactive, terminated, on_leave` |
| `assignmentStatuses` | `Array<string \| WorkforceEnumValue>` | `active, ended, suspended` |

Only `workerTypes` uses its first value as the column default. The three status
columns use `activePersonStatus`, `activeRelationshipStatus`, and
`activeAssignmentStatus`, respectively; each defaults to `"active"`.

### Table name overrides

Each defaults to the matching `workforce_*` name listed under
[Tables Created](#tables-created): `peopleTable`, `organizationsTable`,
`workerRelationshipsTable`, `jobProfilesTable`, `assignmentsTable`,
`orgUnitsTable`, `locationsTable`, `positionsTable`,
`reportingRelationshipsTable`, `authRoleMappingsTable`,
`authRoleMappingRolesTable`, `authRoleMappingPermissionsTable`.

With AuthBlock's [delegated access policy](auth.md#delegated-access-management),
staff managers can edit relationships and assignments for other, unprotected
accounts. The block checks the person attached to the actual edited record
before and after changes, inside the transaction. It checks all assignments and
potential profile mappings, including inactive and historical rules. An
unapproved historical profile therefore requires sysadmin to change.

Role and permission definitions, identity edits, imports, creation of people or
logins, and reporting edits require the configured sysadmin permission. UI writes
also verify the original authenticated session. Custom UI integrations should
call `assertManagementSession` for these operations or
`assertStaffPersonAccess` before and after delegated person-specific writes;
these include both session and business-policy checks. The corresponding
`assertManagementPermission` and `assertStaffPersonPermission` methods expose
only business-policy checks for server procedures that authenticate separately.

### `define` hooks

Each is `(table: TableBuilder) => void`, called inside the matching table so you
can add fields/constraints: `definePeople`, `defineOrganizations`,
`defineOrgUnits`, `defineLocations`, `defineWorkerRelationships`,
`defineJobProfiles`, `definePositions`, `defineAssignments`,
`defineReportingRelationships`, `defineAuthRoleMappings`,
`defineAuthRoleMappingRoles`, `defineAuthRoleMappingPermissions`.

### Routes

`routes?: WorkforceRouteConfig` configures default paths used by the page
components:

| Field | Type | Default |
| --- | --- | --- |
| `peopleListPath` | `string` | `/people` |
| `personDetailPath` | `string` | `<peopleListPath>/{record_id:id}` |
| `referenceDataPath` | `string` | `/workforce/reference-data` |
| `authRoleRulesPath` | `string` | `/workforce/role-rules` |
| `peopleDatagridName` | `string` | (none) |

## Tables Created

The first five tables are always created. The rest appear only when the matching
`enable*` flag is set. Column names below are stable regardless of table-name
overrides.

| Table (default name) | Created when | Key columns |
| --- | --- | --- |
| `workforce_people` | always | `sys_user_id` (fk `sys_users`, notNull+unique, only in `person_field` mode), `display_name`, `preferred_name`, `email`, `phone`, `preferred_language` (default `en`), `status` (enum `workforce_person_status`), `created_at` |
| `workforce_organizations` | always | `name` (notNull+unique), `code`, `organization_type`, `is_active` |
| `workforce_worker_relationships` | always | `person_id`, `workforce_organization_id`, `worker_type` (enum), `status` (enum `workforce_relationship_status`), `effective_from`, `effective_to`, `external_worker_id` |
| `workforce_job_profiles` | always | `name` (notNull+unique), `code` (notNull+unique), `is_active` |
| `workforce_assignments` | always | `worker_relationship_id`, `host_workforce_organization_id`, `workforce_job_profile_id`, `is_primary`, `status` (enum `workforce_assignment_status`), `effective_from`, `effective_to`, plus `workforce_position_id` / `workforce_org_unit_id` / `workforce_location_id` when those facets are enabled |
| `workforce_org_units` | `enableOrgUnits` | `workforce_organization_id`, `parent_org_unit_id` (self-recursive), `name`, `code`, `org_unit_type`, `is_active` |
| `workforce_locations` | `enableLocations` | `name`, `code`, `workforce_organization_id`, `is_active`, unique(`workforce_organization_id`, `code`) |
| `workforce_positions` | `enablePositions` | `name`, `code`, `workforce_organization_id`, `workforce_job_profile_id`, `is_active` (plus org-unit/location fks when enabled) |
| `workforce_reporting_relationships` | `enableReporting` | `worker_relationship_id`, `manager_worker_relationship_id`, `relationship_type`, `effective_from`, `effective_to`, `is_active` |
| `workforce_auth_role_mappings` | `enableAuthRoleMappings` | match cols `worker_type`, `employer_workforce_organization_id`, `host_workforce_organization_id`, `workforce_job_profile_id` (+ org-unit/location when enabled); legacy single `auth_role_id`; `effective_from`, `effective_to`, `is_active` |
| `workforce_auth_role_mapping_roles` | `enableAuthRoleMappings` | `workforce_auth_role_mapping_id`, `auth_role_id`, unique pair |
| `workforce_auth_role_mapping_permissions` | `enableAuthRoleMappings` | `workforce_auth_role_mapping_id`, `permission` (enum `auth_permission`), unique pair |

Integrity is enforced in-schema: end dates must be after start dates,
assignments must reference a job profile or position, and reporting
relationships cannot point to themselves.

## Enums Created

`initialize()` registers four enums from the configured values:
`workforce_worker_type`, `workforce_person_status`,
`workforce_relationship_status`, `workforce_assignment_status`.

## Reactor

When `enableAuthRoleMappings` is set, the block registers the
`workforce_auth_rule_reconciliation` reactor. It keeps source-tracked grants in
AuthBlock's `auth_user_role_sources` / `auth_user_permission_sources`
(source `workforce_auth_role_mapping`) reconciled with the current matching
state: it adds grants when a person starts matching an active rule and removes
only its own grants when the person stops matching or the rule changes,
deactivates, expires, or is deleted. Manual AuthBlock grants are untouched.

The rule editor calls `workforce_save_auth_rule` with typed matching criteria
and tables of selected roles and permissions. It saves the rule and its grants,
then calls the existing `workforce_reconcile_auth_rules` procedure in the same
transaction. The caller retains management-session authorization and UI state.
These server bodies are registered once per system, so mounting workforce in
multiple apps does not expand the save and reconciliation logic in every app.

## Components and Pages

All page components below are **self-routing** (they wrap themselves in
`DatagridPage` / `RecordWithTabsAndDetailPage` / `Route`). Do **not** wrap them
in `<Route>`. They resolve the `WorkforceBlock` via `system.block(WorkforceBlock)`,
so the block must be registered.

### `WorkforceBlock.StandardRoutes`

Renders the people list, person detail, and auth-role rules pages in one place.
Pass `referenceDataPath` to also mount reference-data management; it is omitted
by default so an existing `StandardRoutes` consumer does not gain a new
editable route. This is the usual way to mount the block's admin UI. Static
getter for the component; props are `WorkforceStandardRoutesProps`.

```tsx
<WorkforceBlock.StandardRoutes
  peopleListPath="/workforce/people"
  personDetailPath="/workforce/people/{record_id:id}"
  referenceDataPath="/workforce/setup"
  authRoleRulesPath="/workforce/role-rules"
  peopleCreateActionProps={{
    allowPortalLogin: true,
    defaultCreateLogin: true,
    defaultWorkerType: "contractor",
    languageOptions: [
      { code: "en", name: "English" },
      { code: "es", name: "Spanish" },
    ],
  }}
/>
```

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `peopleListPath` | `string` | no | Overrides `routes.peopleListPath`. |
| `personDetailPath` | `string` | no | Overrides `routes.personDetailPath`. |
| `referenceDataPath` | `string` | no | Overrides `routes.referenceDataPath`. |
| `authRoleRulesPath` | `string` | no | Overrides `routes.authRoleRulesPath`. |
| `peopleDatagridName` | `string` | no | Datagrid name for the people list. |
| `peopleCreateActionProps` | `Omit<WorkforcePersonCreateActionProps, "workforce">` | no | Props forwarded to the people list's create action. |
| `personDetail` | `Omit<WorkforcePersonDetailPageProps, "path">` | no | Props forwarded to the detail page. |
| `overrides` | `{ peopleList?; personDetail?; referenceData?; authRoleRules? }` | no | Each is a `Node` to replace the default route, or `false` to omit it. |

Route wrappers make only a rendering decision. Administrative consumers must
pass `wrapper` (for example, an `AuthBlock.PermissionCheck` requiring
`can_manage_users`) and configure `managementPermission` so mutations enforce
the same boundary on the server.

### `WorkforcePeoplePage` (also `WorkforceBlock.PeoplePage`)

Datagrid of people with quick search and an "Add person" toolbar action.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | no | Route path; defaults to `routes.peopleListPath`. |
| `datagridName` | `string` | no | Defaults to `routes.peopleDatagridName`. |
| `detailPath` | `string` | no | View-button target; defaults to `routes.personDetailPath`. |
| `createAction` | `Node` | no | Replaces the default `WorkforcePersonCreateAction` in the toolbar. |
| `createActionProps` | `Omit<WorkforcePersonCreateActionProps, "workforce">` | no | Props for the default create action. |

### `WorkforcePersonDetailPage` (also `WorkforceBlock.PersonDetailPage`)

Record page for one person with editable header/details and one cohesive
Workforce tab. The tab contains Relationships, Assignments, and (when reporting
is enabled) Reporting sections. Each section lists the person's effective-dated
records and provides an Edit action. The default header links the person's
login to AuthBlock's dedicated Login & Access page; pass `rightSideHeader` to
replace that action.
When `enableRelationshipAndAssignmentCreation` is `true`, the Relationships
and Assignments tabs also provide guided creation actions:

- **New relationship** inserts a relationship and its initial primary
  assignment atomically. For a new open-ended relationship, the flow ends the
  person's currently open relationships and their open assignments at the new
  start date. When the block allows multiple active relationships, the
  operator can leave them open instead.
- **New assignment** selects one of the person's relationships and validates
  that the assignment interval fits inside it. For a new open-ended primary
  assignment, the flow ends the relationship's currently open primary
  assignment at the new start date. When the block allows multiple active
  primary assignments, the operator can leave it open instead.

The generated dialogs include custom fields and only the optional facets
enabled on the block. Parent linkage fields remain protected on Edit so an
existing record cannot be reassigned to a different person or relationship.
Editing corrects a record in place; the creation actions preserve history by
closing superseded intervals and inserting replacement records in one
transaction. Workforce-derived auth roles and permissions are reconciled in
that transaction.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | no | Route path; defaults to `routes.personDetailPath`. |
| `prependTabs` | `WorkforceDetailTabConfig[]` | no | Tabs inserted before the built-in tabs. |
| `appendTabs` | `WorkforceDetailTabConfig[]` | no | Tabs appended after the built-in tabs. |
| `leftSideHeader` | `Node` | no | Replaces the default editable name header. |
| `rightSideHeader` | `Node` | no | Header actions area content. |
| `details` | `Node` | no | Replaces the default details panel. |
| `excludeFields` | `string[]` | no | Person fields to hide from the default details panel. |

`WorkforceDetailTabConfig` is `{ value?: string; header: { icon?: IconName; label: Node }; content: Node }`.

### `WorkforcePersonManagement` (also `WorkforceBlock.PersonManagement`)

Embeddable version of the standard Workforce tab for systems that own a custom
person detail page. It keeps relationship, assignment, and reporting editing on
the block's validated forms instead of requiring system-specific CRUD. It is
not self-routing and expects the surrounding record page to expose
`record_id` for a workforce person. When reference-data creation is enabled,
the header also links to the configured Workforce setup route through a
`Configure workforce` action.

### `WorkforceReferenceDataPage` (also `WorkforceBlock.ReferenceDataPage`)

Self-routing workforce setup page with tabs for Organizations and Job profiles,
plus Org units, Locations, and Positions only when those facets are enabled on
the block. Each tab supports Edit. Set `enableReferenceDataCreation: true` to
also show its schema-generated Add action. Props are `path?: string` (defaults
to `routes.referenceDataPath`) and `wrapper?: (children: Node) => Node`. The
page wrapper does not enforce mutations; configure `managementPermission` and
also mount it behind the same workforce-management permission for clear UI.

When `enableAuthRoleMappings` is enabled, the built-in reference-data Add and
Edit forms synchronously call the block-owned
`workforce_reconcile_auth_rules` procedure in the caller's transaction before
commit. The forms retain their management-permission checks and transaction
boundaries; the procedure executes the same reconciliation SQL and does not
cache results.

With lazy compilation, the page can become available while the runtime
prewarms the shared procedure in the background. An immediate first save may
wait for that compilation; later calls reuse the compiled code but still
execute the reconciliation SQL in the caller's transaction. This deliberately
favors earlier page availability over guaranteeing that the first save has no
compilation wait.

`reconcileWorkforceAuthRules` remains inline for generic or custom-provider
callers.

### `WorkforceAuthRoleRulesPage` (also `WorkforceBlock.AuthRoleRulesPage`)

Self-routing page wrapping `WorkforceAuthRoleRules`. Prop: `path?: string`
(defaults to `routes.authRoleRulesPath`). Requires `enableAuthRoleMappings`;
otherwise the inner component renders a warning alert.

### `WorkforceAuthRoleRules`

The role-rules management card (add/edit rules that grant auth roles and extra
permissions from workforce facts). **Not** self-routing — place it inside your
own page/route. Prop: `{ workforce: WorkforceBlock }`.

Role selection uses `AuthBlock.RoleSelector`, shared with login editing; selected
roles are excluded until removed from the draft.

Additional permissions use AuthBlock's searchable permission picker. Permissions
supplied by selected roles, including inherited roles, appear as read-only
grants with their source role names. The list counts include inherited grants;
permissions already supplied by roles are unavailable in the extra-grant picker.
Removing an extra permission does not remove a role grant.

### `WorkforcePersonCreateAction`

An "Add person" button + modal that, in one transaction, creates the `sys_users`
identity, the person, one active worker relationship, and the primary
assignment, then applies any matching auth-role mappings. **Not** self-routing.

```tsx
<WorkforcePersonCreateAction workforce={workforce} allowPortalLogin />
```

| Prop | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `workforce` | `WorkforceBlock` | yes | — | The block instance. |
| `defaultLanguage` | `Sql \| string` | no | `en` | Initial preferred language. |
| `languageOptions` | `Array<{ code: string; name: string }>` | no | `[{ code: "en", name: "English" }]` | Language dropdown options. |
| `allowPortalLogin` | `boolean` | no | `false` | Allows creating AuthBlock password credentials for the person. |
| `defaultCreateLogin` | `boolean` | no | `true` | Initial state of the "create portal login" checkbox (when `allowPortalLogin`). |
| `defaultWorkerType` | `string` | no | `workerTypes[0]` | Pre-selected worker type. |
| `extraPersonColumns` / `extraPersonValues` | `Sql` | no | — | Extra insert columns/values for `definePeople` fields (supply both). |
| `extraWorkerRelationshipColumns` / `extraWorkerRelationshipValues` | `Sql` | no | — | Extra insert fragments for `defineWorkerRelationships` fields. |
| `extraAssignmentColumns` / `extraAssignmentValues` | `Sql` | no | — | Extra insert fragments for `defineAssignments` fields. |

When `allowPortalLogin` is enabled and the operator opts in, credentials are
created through AuthBlock's `insertUserWithPassword`; roles/permissions still
come from matching workforce rules, not a role picker in the form. The modal
renders only the fields for enabled facets.

### `WorkforceBlock.DetailField`

Static getter for an inline-editable person field row. Props:
`{ field: string; icon?: IconName; label?: Node }`. Use inside a person record
context (e.g. a custom `details` panel).

## Helpers and the Provider Contract

`WorkforceBlock` exposes instance helpers and the full `WorkforceProvider`:

- `personHref(id)` — `Sql` href to a person's detail page (`personDetailPath`).
- `recordHref(path, id)` — `Sql` href for `path`, substituting the
  `{record_id:id}` placeholder with `id` (or appending `id` when the placeholder
  is absent).
- `routes` — the resolved route config (`peopleListPath`, `personDetailPath`,
  `authRoleRulesPath`, `peopleDatagridName`).

`WorkforceProvider` is what person-aware blocks depend on. It advertises table
names and current-fact accessors derived from the active worker relationship and
active primary assignment (as of `current_date()`). Facets that are always
present on a `WorkforceBlock` instance: `personTable`, `organizationsTable`,
`workerRelationshipsTable`, `jobProfilesTable`, `assignmentsTable`, plus
accessors `currentPersonId()`, `personSysUserId`, `personDisplayName`,
`personSysUserJoin`,
`personEmail`, `personPhone`, `personLanguage`, `personStatus`,
`personCurrentWorkerRelationshipId`, `personWorkerType`,
`personRelationshipStatus`, `personEmployerOrganizationId`,
`personHostOrganizationId`, `personPrimaryJobProfileId`,
`personPrimaryAssignmentStatus`, `personPrimaryJobProfileDisplay`,
`personAccessEligible`, and `audienceMatchSql`. Optional facets —
`orgUnitsTable`, `locationsTable`,
`positionsTable`, `reportingRelationshipsTable`, `authRoleMappingsTable`,
`authRoleMappingRolesTable`, `authRoleMappingPermissionsTable`, and the
`personPrimary{OrgUnit,Location,Position}Id` /
`personPrimary{OrgUnit,Location}Display` accessors — exist only when the
matching `enable*` flag is set; consumers must gate audience foreign keys and UI
on their presence (position has an `Id` accessor but no `Display` accessor).

`Id` accessors return stable record IDs for foreign-key audience matching;
`Display` accessors return codes/names for labels only. In practice you
configure `WorkforceBlock` rather than re-implementing `WorkforceProvider`.

## Relationships to Other Blocks

- **AuthBlock (required):** provides `sys_users`, `auth_roles`,
  `auth_permission`, and the source-grant tables. Add it before
  `WorkforceBlock`. In `sysUserLink: "sys_user_field"` mode, expose people
  through AuthBlock with `userTypes: ["workforce_people"]` so
  `sys_users.workforce_person_id` is created. The `permission` column on
  `workforce_auth_role_mapping_permissions` uses the `auth_permission` enum.
- **TrainingBlock (consumer):** pass the workforce instance as the provider:
  `new TrainingBlock({ workforce, ... })`. Training audiences match workforce
  facts through `audienceMatchSql`; Training never queries workforce tables
  directly.

## Common Mistakes

- Registering `WorkforceBlock` before `AuthBlock` — in the default
  `person_field` mode this throws because `sys_users` is missing.
- Wrapping `WorkforcePeoplePage`, `WorkforcePersonDetailPage`,
  `WorkforceAuthRoleRulesPage`, or `WorkforceBlock.StandardRoutes` in a
  `<Route>` — they are self-routing.
- Using `WorkforceAuthRoleRules` (no `Page`) as a route — it is a plain card;
  use `WorkforceAuthRoleRulesPage` for routing, or place the card inside your
  own route.
- Putting worker type, organization, job, status, or location columns on
  `workforce_people` — those belong on worker relationships and assignments so
  transfers and history work; people carry only identity/contact facts.
- Expecting org-unit/location/position provider accessors, audience columns, or
  the role-rules UI without enabling the matching `enable*` flag.
- Supplying only one of an `extra*Columns` / `extra*Values` pair on
  `WorkforcePersonCreateAction` — both fragments are required for the field to
  be inserted; a required `define*` field with no default otherwise breaks the
  canonical insert.
- Treating auth roles as jobs/departments/crews — use job profiles, org units,
  and locations for workforce structure and `workforce_auth_role_mappings` to
  derive role grants from facts.
