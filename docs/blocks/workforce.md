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

`WorkforceBlock` is the "who" layer: people, employer organizations,
effective-dated **worker relationships**, and effective-dated **assignments**
(job profile, position, org unit, location). Transfers, re-hires, and
promotions are ordinary inserts that close one interval and open another.
It implements `WorkforceProvider`, so person-aware blocks such as
`TrainingBlock` depend on current-fact accessors rather than its tables.

Login state belongs to `AuthBlock`; the two are bridged by the
person↔`sys_users` link and optional auth-role mappings.

## Minimal Setup

Add `AuthBlock` **before** `WorkforceBlock`. With the default
`sysUserLink: "person_field"`, `initialize()` throws if `sys_users` is missing.

```ts
import { AuthBlock } from "blocks/auth";
import { WorkforceBlock } from "blocks/workforce";
import { system } from "std/system";

system.addBlock(new AuthBlock({ appAuthTypes: ["email_password"] }));

export const workforce = new WorkforceBlock({});
system.addBlock(workforce);
```

Pass the instance straight to consumers, e.g.
`new TrainingBlock({ workforce, ... })`. Org units, locations, positions,
reporting, and auth-role mappings are opt-in.

## Configuration

`new WorkforceBlock(opts?: WorkforceBlockOpts)`; all options are optional. See
`WorkforceBlockOpts` in `packages/blocks/workforce/index.tsx` for the full list,
including table-name overrides (`peopleTable`, `assignmentsTable`, ...),
`define*` hooks (`(table: TableBuilder) => void` for each table), enum value
lists, and `routes` (`WorkforceRouteConfig`; defaults `/people`,
`<peopleListPath>/{record_id:id}`, `/workforce/reference-data`,
`/workforce/role-rules`).

| Option | Default | Meaning |
| --- | --- | --- |
| `enableOrgUnits`, `enablePositions`, `enableReporting`, `enableAuthRoleMappings` | `false` | Add the matching optional tables, foreign keys, provider accessors, and UI. |
| `locations` | — | A `LocationsBlock` instance registered **before** workforce; adds location foreign keys. Workforce owns no location table. |
| `singleOrganization` | — | Implicit employer name: no organizations table, organization foreign keys, setup UI, or seed step. See [One organization](#one-organization). |
| `sysUserLink` | `"person_field"` | `person_field` stores `workforce_people.sys_user_id` (required, unique). `sys_user_field` stores `sys_users.workforce_person_id`, for systems exposing people through AuthBlock `userTypes: ["workforce_people"]`. |
| `enableRelationshipAndAssignmentCreation` | `false` | Shows guided New relationship / Change assignment / End relationship actions on person detail. |
| `enableReferenceDataCreation` | `false` | Shows Add actions on the reference-data page and Spark tools. Edit is always available. |
| `allowMultipleActiveRelationships`, `allowMultipleActivePrimaryAssignments` | `false` | When false, filtered unique constraints allow one open relationship per person and one open primary assignment per relationship. |
| `activePersonStatus`, `activeRelationshipStatus`, `activeAssignmentStatus` | `"active"` | Status that counts as active for eligibility, current facts, and new/imported defaults. Must name a configured status (checked at generation). List order is irrelevant; do not reorder deployed enums to change eligibility. |
| `managementPermission` | — | Legacy management gate. AuthBlock `accessPolicy`, when configured, takes precedence. |
| `assignableJobProfiles` | — | `(jobProfile: Sql) => Sql` predicate limiting profiles staff managers may assign. Only `true` allows. Prefer IDs or system-owned fields over editable names. Protected role/permission mappings always require sysadmin. |
| `disableLoginWhenAccessIneligible` | `false` | Disables the linked `sys_users` row and revokes sessions when the person lacks an active relationship and active primary assignment. One-way: restored eligibility never re-enables the account. |
| `validatePersonAssignments` | — | `(s, personId) => void` run inside shared employment/assignment form transactions; call a system-owned validation procedure for `defineAssignments` fields. Direct SQL imports must run equivalent validation. |

Enum options (`workerTypes`, `personStatuses`, `relationshipStatuses`,
`assignmentStatuses`) accept `string` or `{ name, displayName }`; plain strings
display with only the first letter capitalized (`vendor_worker` →
`Vendor_worker`). Only `workerTypes` uses its first value as the column default.

Organizations, org units, positions, and job profiles have names but no
built-in codes or type labels, and people have no creation timestamp. Add such
fields through the matching `define*` hook when an integration needs them.

### One organization

`singleOrganization: "Acme"` is a code-defined constant; renaming it changes
display only. People, relationships, locations, org units, positions, and
access rules work without organization IDs. CSV employer/host values, if
present, must match the name. `organizationsTable` is absent on the provider,
organization ID accessors return SQL null, and `organizationDisplayName(id)`
returns the constant (it looks up the record in multiple mode).

Switching an existing system to single mode is **CompatibleByOrphaning**, but
the local CLI currently fails to reopen a database with the orphaned
organization table (`column_id 2 out of range ... field_types_len=0`), and the
transform fallback fails during snapshot creation. Existing-database rollout is
blocked until a fix or migration passes restored-data checks. Never enable it
on data that needs distinct employers or hosts. Moving to multiple
organizations requires provisioning organizations and backfilling the new
required foreign keys.

## Tables

People, worker relationships, job profiles, and assignments are always created.
Column names are stable across table-name overrides.

| Table (default name) | Created when | Purpose |
| --- | --- | --- |
| `workforce_people` | always | Identity and contact facts only. |
| `workforce_organizations` | `singleOrganization` omitted | Employer and host organizations. |
| `workforce_worker_relationships` | always | Effective-dated employment/contract relationship with worker type and status. |
| `workforce_job_profiles` | always | Global job catalog. |
| `workforce_assignments` | always | Effective-dated work under a relationship; `is_primary` marks the assignment used for current facts. |
| `workforce_org_units` | `enableOrgUnits` | Recursive org-unit hierarchy within an organization. |
| `workforce_positions` | `enablePositions` | Concrete seats. |
| `workforce_reporting_relationships` | `enableReporting` | Effective-dated manager links between relationships. |
| `workforce_auth_role_mappings` | `enableAuthRoleMappings` | Access rules matching workforce facts. |
| `workforce_auth_role_mapping_roles`, `workforce_auth_role_mapping_permissions` | `enableAuthRoleMappings` | Roles and direct permissions granted by a rule. |

The block registers four enums: `workforce_worker_type`,
`workforce_person_status`, `workforce_relationship_status`, and
`workforce_assignment_status`. The schema enforces end dates after start dates,
assignments referencing a job profile or position, and no self-reporting.
Intervals are half-open, so one can start on the other's end date. Location
references use `onDelete("Restrict")`: deactivate a referenced location instead
of deleting it.

Upgrading from a workforce-owned location table requires mapping existing
location IDs to shared location IDs with a **Transform** before retargeting
assignment, position, rule, and training-audience references; removing the old
table alone only orphans data. Removing the legacy rule-level `auth_role_id`
requires first copying it into `workforce_auth_role_mapping_roles` for rules
with no child-role rows (including inactive and future rules), under the old
schema; deploying the removal directly revokes legacy-only grants.

## Validation, Access, and Imports

- Shared creation, edit, and import paths validate overlapping active
  relationships and primary assignments, respecting the `allowMultiple*`
  options. Custom SQL writers must call `validatePersonIntervals(s, personId)`
  in their transaction; direct org-unit writers must call the
  `workforce_validate_org_units` procedure (parents must not form cycles and
  must belong to the same organization). Access synchronization does not
  validate history, so bad history never blocks suspending a person or
  revoking access.
- With AuthBlock's [delegated access policy](auth.md#delegated-access-management),
  staff managers can edit relationships and assignments of other, unprotected
  accounts. The person on the edited record is checked before and after the
  change, against all assignments and potential profile mappings (including
  inactive and historical rules), so an unapproved historical profile requires
  sysadmin. Identity edits, imports, person/login creation, reporting edits,
  and role/permission definitions require sysadmin.
- Custom UI writes should call `assertManagementSession(s)` or, before and after
  delegated person writes, `assertStaffPersonAccess(s, personId)`; both check
  the original session and business policy. Server procedures that authenticate
  separately use `assertManagementPermission` / `assertStaffPersonPermission`
  (policy only).
- Route `wrapper`s only decide rendering. Administrative consumers must also
  configure `managementPermission` (or AuthBlock's access policy) so mutations
  enforce the same boundary on the server.
- CSV imports (`WorkforcePeopleImportAction`) require an explicit portal-access
  choice in the preview, applied to every newly created login identity. No
  invitation emails are sent; existing login choices are kept unless
  eligibility requires disabling access. Organizations, job profiles, org
  units, and positions match by name, ignoring case and surrounding whitespace;
  locations match an unambiguous name or full path (including configured
  codes). Ambiguous matches and legacy `Job code` / org-unit or position code
  headers are rejected. Imports without job values use a default job profile
  selected in the dialog (by ID; there is no name-based option).
- Runtime workflows should use organization and job-profile IDs, never
  hardcoded display names. Assignments, rules, and audiences keep IDs through
  renames.

## Auth-Role Reconciliation

With `enableAuthRoleMappings`, the `workforce_auth_rule_reconciliation` reactor
keeps AuthBlock's `auth_user_role_sources` / `auth_user_permission_sources`
(source `workforce_auth_role_mapping`) in sync: it adds grants when a person
starts matching an active rule and removes only its own grants when the person
stops matching or the rule changes, deactivates, expires, or is deleted. Manual
grants and overlapping rules are independent.

A rule may grant roles, direct permissions, or both, but not neither.
Permissions already supplied by the rule's roles (including inherited roles)
are shown read-only and cannot be added as extra grants; removing an extra
permission never removes a role grant. The rule
editor calls `workforce_save_auth_rule`; reference-data forms call
`workforce_reconcile_auth_rules` in the caller's transaction. These procedures
are registered once per system. With lazy compilation, the first save may wait
for background compilation. `reconcileWorkforceAuthRules` remains an inline
helper for custom providers. Location criteria match exact IDs; a parent
location does not include descendants.

## Components and Pages

Import from `blocks/workforce`. Self-routing pages resolve the block through
`system.block(WorkforceBlock)`; do not wrap them in `<Route>`. Props types are
exported as `<Component>Props`.

| Export | Self-routing | Purpose |
| --- | --- | --- |
| `WorkforceBlock.StandardRoutes` | yes | People list, person detail, and role-rules pages. Reference data mounts only when `referenceDataPath` (or `overrides.referenceData`) is passed. `overrides.*` replaces a route with a `Node` or omits it with `false`. |
| `WorkforcePeoplePage` / `.PeoplePage` | yes | People datagrid with Add person and import actions. |
| `WorkforcePersonDetailPage` / `.PersonDetailPage` | yes | Person record with one Workforce tab: an access status with its three checks, current employment and assignment cards, reporting lines, and a collapsible history timeline. The header links to AuthBlock's Login & Access page unless `rightSideHeader` is passed. |
| `WorkforcePersonManagement` / `.PersonManagement` | no | The standard Workforce tab for custom person pages; expects `record_id` of a workforce person in scope. |
| `WorkforceReferenceDataPage` / `.ReferenceDataPage` | yes | Organizations, job profiles, and enabled facets; org units and locations are searchable trees. |
| `WorkforceAuthRoleRulesPage` / `.AuthRoleRulesPage` | yes | Page wrapping `WorkforceAuthRoleRules`; warns if mappings are disabled. |
| `WorkforceAuthRoleRules` | no | Role-rules card (`{ workforce }`), with a match preview and review confirmation. |
| `WorkforcePersonCreateAction` | no | Add person modal. |
| `WorkforcePeopleImportAction` / `.PeopleImportAction` | no | CSV import dialog. |
| `WorkforceBlock.DetailField` | no | Inline-editable person field row (`{ field, icon?, label? }`) for a custom `details` panel. |

```tsx
<WorkforceBlock.StandardRoutes
  peopleListPath="/workforce/people"
  personDetailPath="/workforce/people/{record_id:id}"
  referenceDataPath="/workforce/setup"
  peopleCreateActionProps={{ allowPortalLogin: true }}
/>
```

`WorkforcePersonCreateAction` creates the `sys_users` identity, person, one
active relationship, and primary assignment in one transaction, then applies
matching auth-role mappings. Values for required `define*` fields without
defaults must be supplied through `extraPersonValues`,
`extraWorkerRelationshipValues`, or `extraAssignmentValues`
(`Record<string, Sql>`); otherwise the record cannot be created. With
`allowPortalLogin`, an opted-in person can use email password setup where
`allowSelfSetup` is enabled; no email is sent. An optional temporary password
forces a change at first login. Without a login, the linked identity (including
password setup) is disabled. `compact` is a deprecated no-op.

With `enableRelationshipAndAssignmentCreation`, **New relationship** inserts a
relationship and its initial primary assignment; for an open-ended one it ends
the person's relationships covering the new start date and their assignments,
including periods with scheduled end dates.
**Change assignment** defaults to a primary assignment and must fit inside its
relationship. It ends the previous primary period at the new start, including
when that period already had an end date. Active scheduled conflicts must
be reviewed first; inactive dated assignments are preserved. Only one primary
assignment may be open-ended when that constraint is configured. With the matching `allowMultiple*` option, the operator may
leave prior records open.

**End relationship** is an action on each unended relationship card. It takes an inclusive last working day and closes the
relationship, its assignments, and connected reporting periods together. It
preserves recorded statuses and rejects scheduled children beyond that day.
Person status is unchanged; login and auth grants are reconciled using the
remaining eligible work. Ending today takes effect tomorrow; ending yesterday
takes effect immediately.

Period labels are derived from dates and status. Cards show current and
scheduled periods; every relationship, assignment, and reporting period also
appears in the History timeline, newest first. **Correct history**, in each
timeline entry's menu, edits that record in place and keeps
parent links read-only; use it for corrections, not routine lifecycle changes.
Auth grants are reconciled in the same transaction.

## Spark and MCP

```tsx
import { workforceSparkCapability } from "blocks/workforce/spark";

// Pass to new SparkBlock({ workspace, capabilities }) after registering
// WorkforceBlock and AuthBlock.
const capabilities = [workforceSparkCapability(workforce)];
```

The capability uses AuthBlock's access-policy administrator permission or
`managementPermission`; otherwise pass `{ permission: "..." }`. Every call
rechecks the user, permission, and workforce policy on the server.

| Tool | Behavior |
| --- | --- |
| `list_configuration` | Pages through enabled reference data, location paths, roles, permissions, and access rules, including inactive records (limit 1-100, default 50). |
| `save_job_profile`, `save_organization`, `save_org_unit`, `save_position` | Create (if `enableReferenceDataCreation`), rename, re-parent, or deactivate. Only for enabled facets; omitted fields are preserved. |
| `get_access_rule` | Returns a rule in the save tool's shape. |
| `preview_access_rule` | Validates and counts eligible matches, returning up to ten names. |
| `save_access_rule` | Creates or replaces a rule and reconciles grants in the same transaction. |

Access-rule tools exist only with auth-role mappings. `role_ids` and
`permissions` must both be arrays, not both empty. Omitted criteria mean Any,
omitted dates mean unbounded, omitted `is_active` means true. Malformed IDs,
unknown fields, and invalid permissions or dates are rejected. Deletion and
login provisioning are not exposed.

## Provider Contract

`WorkforceProvider` (in `packages/blocks/workforce/index.tsx`) advertises table
names and current-fact accessors derived from the active relationship and
active primary assignment as of `current_date()`. Always present on
`WorkforceBlock`: `personTable`, `workerRelationshipsTable`,
`jobProfilesTable`, `assignmentsTable`, `currentPersonId()`,
`personSysUserId`, `personSysUserJoin`, `personDisplayName`,
`personAccessEligible`, `audienceMatchSql`, and the contact, status, worker
type, organization, and primary job-profile accessors.

Optional table names and `personPrimary{OrgUnit,Location,Position}Id` /
`personPrimary{OrgUnit,Location}Display` exist only when the matching facet is
enabled; consumers must gate foreign keys and UI on their presence. `Id`
accessors return stable IDs for audience matching; `Display` accessors return
labels only. `locationOptions({ includeInactive? })` returns `id` and a
hierarchy label as `name`, omitting inactive locations by default.

Block helpers: `personHref(id)`, `recordHref(path, id)` (substitutes
`{record_id:id}` or appends the ID), and `routes`.

## Gotchas

- Worker type, organization, job, status, and location belong on relationships
  and assignments, not `workforce_people`; otherwise transfers lose history.
- Auth roles are not jobs, departments, or crews. Model structure with job
  profiles, org units, and locations, and derive grants with auth-role mappings.
- Deactivating a location removes it from `locationOptions()` but does not
  change assignment history or revoke existing rule-derived grants.
