---
title: CrmBlock
description: CrmBlock provides B2B/B2C contacts, organizations, sales pipelines, projects, success plans, knowledge hub, and email integration pages.
tags:
  - blocks
  - crm
  - sales
  - pipeline
  - customer-success
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - blocks/auth.md
  - blocks/email_integrations.md
  - ui/blocks_reference.md
---

# CrmBlock

`CrmBlock` defines a CRM: a people table, an organizations table (B2B), detail
pages, and overview reports. Pipelines, projects, success plans, a knowledge
hub, partners, and email integration are optional features created only when
configured. Declare client/organization and contact tables through `people` and
`organizations` rather than defining them outside the block.

```tsx
import { CrmBlock } from "blocks/crm";
```

## Minimal Setup

`people` (with `tableName`) is required. In B2B the organizations table is
created even if `organizations` is omitted (default name `organizations`).

```tsx
system.addBlock(
  new CrmBlock({
    type: "b2b",
    organizations: {
      tableName: "organizations",
      define: (table, config) => {
        config.standardStatus();   // lifecycle status enum
        config.tableIndustry();    // crm_industries lookup + FK
        table.string("legal_name", 200);
      },
    },
    people: {
      tableName: "contacts",
      define: (_table, config) => config.personaType(),
    },
  }),
);
```

Read the configured block with `system.block(CrmBlock)`. Most CRM apps also
register `AuthBlock`. For B2C set `type: "b2c"`: only the people table is
created by default, with birth date, gender, personal-address, and
contact-preference fields (`examples/crm_b2c` is the canonical app).

## Configuration

Full option types: `CrmBlockOpts`, `CrmRouteConfig`, `CrmAutomationConfig`, and
`CrmDebugHooks` in `packages/blocks/crm/index.tsx`; `PipelineConfig` in
`packages/blocks/crm/pipeline/types.ts`. Non-obvious options:

| Option | Meaning |
| --- | --- |
| `type` | `"b2b"` (default) or `"b2c"`. B2C drops the org table and the person-org relationship. |
| `organizations.createTable` | B2B creates by default (set `false` to opt out); B2C creates only when `true`. Organization-based post-sale features in B2C require `true`. |
| `organizations.deletion.mode` | `emptyOnly` (default) blocks deletes while children exist (`Restrict`); `direct` cascades. |
| `people.defaultFieldsRequired` | Whether `first_name` is `notNull`; defaults to true. |
| `people.disableDefaultFields` | Skip built-in `first_name`/`last_name`/`email`/`phone`. |
| `*.fieldGroups` | Grouped custom fields rendered as a details section (default) or tab; `define` receives a `FieldGroupBuilder`. `fieldGroupPrefix` prefixes their column names. |
| `*.commentSection` | Render the shared `CommentsBlock` on each record (see Comments). |
| `organizationRelationshipState` | Adds a disposition enum + optional snooze fields to the org table (see Relationship State). |
| `emailIntegrations` | `[{ integration: GmailIntegration }]` etc.; creates the email tables, and `StandardRoutes` mounts an inbox plus account-management page. See [Email Integrations](email_integrations.md). |
| `pipelines` | `{ pipelines: PipelineConfig[]; tablePrefix? }`; prefix defaults to `"crm_pipeline"`. |
| `partners` | `program: { coSellReadinessThreshold }` and/or `accountPlans: true` (see Partners). |
| `projects` / `successPlans` / `knowledgeHub` | Post-sale features; see below. |
| `automations` | `{ partners?, renewalTasks? }` reactor toggles (see Reactors). |

### Comments

`commentSection` uses the shared `CommentsBlock`; CRM creates no comments table.
Contribute the CRM foreign keys to the generic thread:

```tsx
const crm = new CrmBlock({
  type: "b2b",
  organizations: { tableName: "clients", commentSection: true },
  people: { tableName: "client_contacts", commentSection: true },
});
system.addBlock(crm);

system.addBlock(new CommentsBlock({
  defineThread: (table) => crm.defineCommentThreadFields(table),
}));
```

`CrmBlock` validates that one `CommentsBlock` exists and that all enabled CRM
comment foreign keys were contributed. Other products can add their own foreign
keys in the same callback.

### `projects` / `successPlans` / `knowledgeHub`

| Option | Required keys (plus `enabled: true`) | Notes |
| --- | --- | --- |
| `projects` | `phases`, `enableRaci`, `enableAdoptionTracking` | First phase is the default; an enum is generated. Default table `crm_projects`. |
| `successPlans` | `healthScoreThresholds: { good; warning }` (0-100), `renewalUpcomingDays` | Default table `crm_success_plans`. |
| `knowledgeHub` | `itemTypes` | Default table `crm_knowledge_hub`. Items use `AttachmentsTableBlock`; create, edit, delete, and attachment mutations require `edit_knowledge_hub`. |

These are generation-time options: disabling an existing feature can remove
schema and must be reviewed as a deployment schema change. The features run
without pipelines, except that `enableRaci: true` requires a task-enabled
pipeline (RACI references pipeline tasks, and its UI requires linking the
project to an item in that pipeline). RACI selects users through AuthBlock's
user display fields; no `employees` table is needed.

Adoption and health scores have manual assessment forms (0-100, or blank to
clear), restricted to `edit_projects` and `edit_success_plans`. Saving sets the
assessment timestamp; clearing clears it. No scoring formula is implied;
dashboards show unassessed scores as unknown. Custom scoring procedures must
validate the same range and update the score and its timestamp together.

### Partners

`enablePartnerAttachment` on a pipeline creates only basic partner records and
item links. Opt into more on the block:

```tsx
partners: {
  program: { coSellReadinessThreshold: 80 }, // type, validation, readiness, incentive, performance fields
  accountPlans: true,                        // joint account plans; independent of program
},
automations: { partners: true },
```

Notification storage is created only when partner automation is registered.
Basic attachment supports deal-attached notifications; co-sell and validation
notifications also require `program`.

## Pipelines

`PipelineConfig` keys: `name` (also an enum value), `displayName?`, `icon?`,
`description?`, `stages`, `entityTypes` (`"organization" | "person"`),
`enableTasks?` and `enableActivityLog?` (both on unless `false`),
`opportunityFields?`, `enablePartnerAttachment?`. `opportunityFields: {}` adds
basic value/probability/risk fields; `{ qualification: true }` also adds use
case, success metrics, business-case score, and competitive landscape.

Stages take `fields?`, `exitCriteria?`, `exitCriteriaMode?` (`"all" | "any"`),
and `autoTasksOnEntry?` (`{ title, description?, dueDaysFromNow?, priority? }`).

```tsx
pipelines: {
  pipelines: [
    {
      name: "sales",
      displayName: "Sales",
      entityTypes: ["organization"],
      opportunityFields: {},
      stages: [
        { name: "lead", displayName: "Lead" },
        { name: "qualified", displayName: "Qualified" },
        {
          name: "closed",
          displayName: "Closed Won",
          autoTasksOnEntry: [
            { title: "Kickoff call", dueDaysFromNow: 3, priority: "high" },
          ],
        },
      ],
    },
  ],
}
```

Mutate pipelines through `CrmBlock.Pipeline.addToPipeline`,
`removeFromPipeline`, and `createAutoTasksForStage`, not by writing
`crm_pipeline_*` tables directly.

### Exit-criteria helpers

Import from `blocks/crm/pipeline/exit_criteria_helpers` (the source JSDoc's
`blocks/crm/pipeline/types` path is stale). Each returns a SQL condition over
`crm_pipeline_stage_data`, correlated to the `item` row, for
`exitCriteria[].condition`:

- `stageDataBool(stage, field)` — boolean field is true.
- `stageDataNotEmpty(stage, field)` — text field is non-empty.
- `stageDataNotNull(stage, field, valueColumn?)` — value present
  (`string_value`/`bool_value`/`date_value`/`numeric_value`).
- `stageDataNumeric(stage, field, operator, threshold)` — `>=`/`>`/`=`/`<`/`<=`.

```tsx
exitCriteria: [
  { name: "value", displayName: "Value set",
    condition: stageDataNumeric("qualified", "deal_value", ">=", 1000) },
]
```

## Tables Created

Names assume default `tableName`s and the `crm_pipeline` prefix. Inspect the
schema for columns; read table names from the block instance getters rather
than hard-coding them.

| Table | When created | Purpose |
| --- | --- | --- |
| people table (e.g. `contacts`) | always | Contact records. |
| organizations table (e.g. `organizations`) | B2B, or B2C with `createTable: true` | Account records. |
| `crm_pipeline_items` | pipelines configured | Pipeline/deal records. |
| `crm_pipeline_stage_data` | pipelines configured | Per-stage dynamic field values, one row per field. |
| `crm_pipeline_tasks` | any pipeline with tasks | Pipeline tasks. |
| `crm_pipeline_activity_log` | any pipeline with activity log | Activity history. |
| `crm_projects`, `crm_project_raci` | `projects.enabled` / `enableRaci` | Projects and RACI assignments. |
| `crm_success_plans`, `crm_success_plan_kpis` | `successPlans.enabled` | Success plans and KPIs. |
| `crm_knowledge_hub`, `crm_knowledge_hub_attachments` | `knowledgeHub.enabled` | Knowledge items and attachments. |
| `crm_partners` | any pipeline with `enablePartnerAttachment` | Partner records. |
| `crm_partner_account_plans` | `partners.accountPlans` | Joint account plans. |
| `crm_partner_notifications` | partner automation registered | Partner notifications. |
| `crm_industries` | `OrganizationConfig.tableIndustry()` | Industries lookup. |
| `user_all_emails`, `user_email_recipients`, `user_email_attachments` | `emailIntegrations` set | Synced email storage. |

Comment tables belong to `CommentsBlock`. The module always defines
`crm_contact_type`, `gender_enum`, and `contact_preference_enum` on import.

## Define-Callback Helpers

`OrganizationConfig`: `standardStatus()` (lead/prospect/customer/churned/inactive),
`standardEnumIndustry()` (enum column) or `tableIndustry()` (`crm_industries`
lookup + FK), `regionEnum()`, `sizeFields()` (`org_size`, `employee_count`,
`annual_revenue`), `currentStateSummary()`, `strategicFields()`,
`assignedTeam()` (FK to `sys_users`), `assignedPartner()` (FK to
`crm_partners`), and `yolmAccountFields()` (all of them).

`PeopleConfig`: `personaType()` (decision_maker/influencer/blocker/champion/user),
`department()`, `relationshipStrength()` (1-5), `engagementScore()`,
`buyingRole()`, `contactType()` (`crm_contact_type`), `partnerId()` (FK to
`crm_partners`), and `yolmContactFields()` (all of them).

## Pages and Components

Static members of `CrmBlock`. Pages marked self-routing accept `path` and render
their own `<Route>`; do not wrap them in `<Route>`. Feature pages render `null`
unless their feature is enabled.

| Member | Self-routing | Notes |
| --- | --- | --- |
| `OrganizationDetailPage` / `PersonDetailPage` | Yes | Record pages; take `details`, tab, header, and email props. Organization page is B2B only. |
| `OrganizationDetailContent` / `PersonDetailContent` | No | Route-less forms for an existing record route such as `DatagridPage.recordPage`. |
| `StandardRoutes` | Yes (many) | Mounts every enabled default route; `overrides` takes a `Node` to replace or `false` to suppress a route. |
| `DetailField` / `DetailDisplayField` | No | Inline-editable / display-only rows for a detail page's `details` prop. |
| `Reports.OrganizationsOverview` / `PeopleOverview` | No | Inside a `SimpleReportsPage`. Organizations is B2B only. |
| `Reports.ProjectsOverview` / `WelcomeBack` | No | Require `KanbanProjectTableBlock` on the organizations table. |
| `Pipeline.Board`, `Pipeline.ItemDetailPage`, `Pipeline.Pages` | No / Yes / Yes | Board, item detail, and board+detail+reports mount. |
| `Pipeline.StageFieldsForm`, `ExitCriteriaChecklist`, `TaskList`, `OverdueTasksAlert`, `EntityStatusTab`, `ExtendedItemFieldsForm`, `ExtendedItemDetailsCard` | No | Pipeline building blocks; `getExtendedItemFieldsFromWriteState(tableName)` feeds write hooks. |
| `Pipeline.Reports.*` | No | `Overview`, `Tasks`, `SalesDashboard`, `QualificationScoreDistribution`, `AdoptionValue`, `OperatingRhythm`, `PartnerMetrics`, `RYGScorecards`. |
| `Projects.*`, `SuccessPlans.*`, `KnowledgeHub.*` | Pages: Yes | `ListPage`/`Page`, `DetailPage`, `NewPage`; `OrganizationTab` (projects, knowledge hub) is not self-routing. |

`AdoptionValue` requires an existing value stage and a boolean stage field for
KPI achievement; its optional project phase must exist in `projects`. Project
and success-plan metrics include only records linked to the requested pipeline;
renewal counts use `successPlans.renewalUpcomingDays`. Pipeline item detail
routes select the item's own pipeline when several are configured.
Pipeline overview and operating-rhythm reports omit task, activity, and partner
metrics when that capability is disabled for the requested pipeline, even if
another pipeline enables it.

Block instance helpers: table-name getters (`peopleTableName`,
`pipelineItemsTableName`, ...), SQL href builders (`organizationHref(id)`,
`personHref(id)`, `pipelineItemHref(id)`, `recordHref(path, id)`, ...),
pipeline lookups (`getPipeline`, `getPipelineStage`, `getNextPipelineStage`,
...), and feature checks (`hasProjectsEnabled()`,
`hasPipelineTasksEnabled(name)`, ...).

## Relationship State

```tsx
organizationRelationshipState: {
  disposition: {
    enumName: "crm_relationship_disposition", // default
    fieldName: "relationship_disposition",     // default
    values: [
      { name: "engaged", displayName: "Engaged", color: "#22C55E", emoji: "🟢" },
      { name: "at_risk", displayName: "At Risk", color: "#EF4444" },
    ],
  },
  snooze: {
    untilFieldName: "relationship_snoozed_until", // default
    reasonFieldName: "relationship_snooze_reason", // default; `false` to skip
  },
}
```

Values may set `emoji` and `chipClassNames` for the chip. Direct exports from
`blocks/crm`: `CrmRelationshipDispositionChip` (`{ disposition: Sql }`),
`CrmRelationshipDispositionGridCell` (`{ editable? }`, inside a datagrid cell),
and `clearCrmOrganizationRelationshipSnooze(s, organizationId, extraWhere?)`.

## Command Palette

`CrmCommandPalette` (from `blocks/crm/command_palette`) is a Spotlight-style
modal bound to Cmd/Ctrl+K and `/` outside inputs. `openScalar` names the
boolean UI scalar controlling visibility; `commands` are static actions
(`id`, `label`, `href`, `icon`); `searchProcedure(s, query)` inserts record
results into `palette_result_raw`; `commandsProcedure` seeds extra commands.

```tsx
<CrmCommandPalette
  openScalar="command_palette_open"
  commands={[
    { id: "new_contact", label: "New Contact", href: "/contacts/new", icon: "Add" },
  ]}
  searchProcedure={mySearchProcedure}
/>
```

## Reactors and Automations

Enable with `automations: { partners: true, renewalTasks: true }` or call
`registerPartnerAutomationReactors(block)` (`blocks/crm/reactors/partner_automation`)
/ `registerRenewalTaskReactor(block)` (`blocks/crm/reactors/renewal_tasks`)
directly. Registration is idempotent and each is a no-op without its
prerequisite: partners needs a pipeline with `enablePartnerAttachment`; renewal
tasks need `successPlans.enabled` plus a task-enabled pipeline, and create
"Renewal Prep" tasks only for plans linked to such a pipeline.

## Gotchas

- Upgrading old configuration: `enableOpportunityFields: true` becomes
  `opportunityFields: { qualification: true }` to retain its schema. Existing
  partner-program consumers must set `partners.program` and
  `partners.accountPlans` to keep those tables, and notification consumers must
  register partner automation. The removed `standaloneRenewalReminders` option
  has no replacement; standalone plans need a client-owned delivery workflow.
