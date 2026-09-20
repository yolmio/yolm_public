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

`CrmBlock` is a system block that defines a full CRM: a people/contacts table,
an organizations/accounts table (B2B), pre-built detail pages, and overview
reports. Sales/CS pipelines, project tracking, customer-success plans, a
knowledge hub, partner attachment, and email-integration surfaces are optional
features that are only created when configured.

Use this block instead of hand-rolling contact/organization/pipeline schema.
Do **not** define your client/organization/company or contact/person tables
outside the block; declare them through the block's `people` and
`organizations` options so the matching pages, reports, search config, and
sample data come for free.

```tsx
import { CrmBlock } from "blocks/crm";
```

## Minimal Setup

`people` is required (with a `tableName`). In B2B the organizations table is
created automatically (default name `organizations`) even if you omit the
`organizations` option.

```tsx
system.addBlock(
  new CrmBlock({
    type: "b2b",
    organizations: { tableName: "organizations" },
    people: { tableName: "contacts" },
  }),
);
```

Read the configured block back anywhere with `system.block(CrmBlock)`. Most CRM
apps also register `AuthBlock` for employee login and permissions.

For the supported B2C shape, set `type: "b2c"`; the block creates only the
people table by default and adds birth date, gender, personal-address, and
contact-preference fields. See `examples/crm_b2c` for the canonical app and
behavior test.

### Adding standard fields

`organizations.define` and `people.define` receive a `TableBuilder` plus an
`OrganizationConfig` / `PeopleConfig` helper with pre-built field sets:

```tsx
new CrmBlock({
  type: "b2b",
  organizations: {
    tableName: "organizations",
    define: (table, config) => {
      config.standardStatus();   // lifecycle status enum
      config.tableIndustry();    // crm_industries lookup + FK
      config.sizeFields();       // org_size / employee_count / annual_revenue
      table.string("legal_name", 200); // mix in your own fields freely
    },
  },
  people: {
    tableName: "contacts",
    define: (_table, config) => {
      config.personaType();
      config.department();
    },
  },
});
```

## Configuration

`CrmBlockOpts`:

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"b2b" \| "b2c"` | No | CRM shape; defaults to `"b2b"`. B2C drops the org and the person↔org relationship. |
| `people` | object | Yes | People/contacts table (see below). |
| `organizations` | object | No | Organizations table (see below). Auto-created in B2B; opt-in for B2C via `createTable: true`. |
| `phoneCountry` | `string` | No | Default country for phone-number fields the block creates. |
| `organizationRelationshipState` | `CrmOrganizationRelationshipStateConfig` | No | Adds a disposition enum + optional snooze fields to the org table (see Relationship State). |
| `emailIntegrations` | `EmailIntegrationConfig[]` | No | Gmail/Outlook integrations; enabling any creates the email tables. |
| `pipelines` | `{ pipelines: PipelineConfig[]; tablePrefix?: string }` | No | Kanban pipelines and their backing tables. `tablePrefix` defaults to `"crm_pipeline"`. |
| `projects` | object | No | Project tracking; activated by `enabled: true` plus `phases` (see below). |
| `successPlans` | object | No | Customer-success plans; activated by `enabled: true` (see below). |
| `knowledgeHub` | object | No | Per-org knowledge base; activated by `enabled: true` plus `itemTypes` (see below). |
| `routes` | `CrmRouteConfig` | No | Per-route path / datagrid-name overrides. |
| `automations` | `CrmAutomationConfig` | No | Toggles for background reactors (see Reactors and Automations). |
| `debugHooks` | `CrmDebugHooks` | No | After-mutation callbacks for tests/instrumentation. |

### `people` options

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `tableName` | `string` | Yes | Table name (e.g. `"contacts"`, `"customers"`). |
| `define` | `(table, config: PeopleConfig) => void` | No | Add custom fields. |
| `disableDefaultFields` | `boolean` | No | Skip built-in `first_name`/`last_name`/`email`/`phone`. |
| `defaultFieldsRequired` | `boolean` | No | Whether `first_name` is `notNull`; defaults to true. |
| `addDefaultB2CFields` | `boolean` | No | B2C only: add birth date, gender, address, contact preference. Defaults to true. |
| `fieldGroups` | array | No | Grouped custom fields rendered in a tab or details section (see Field Groups). |
| `fieldGroupPrefix` | `string` | No | Prefix applied to field-group column names. |
| `commentSection` | `boolean` | No | Show the shared `CommentsBlock` panel on each record. Configure its thread FK with `defineCommentThreadFields`. |

### `organizations` options

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `tableName` | `string` | Yes (when option present) | Table name (e.g. `"organizations"`, `"clients"`). |
| `define` | `(table, config: OrganizationConfig) => void` | No | Add custom fields. |
| `createTable` | `boolean` | No | Force-create. B2B creates by default (set `false` to opt out); B2C only creates when `true`. |
| `deletion` | `{ mode?: "emptyOnly" \| "direct" }` | No | `emptyOnly` (default) blocks deletes while children exist (`Restrict`); `direct` cascades. |
| `fieldGroups` | array | No | Grouped custom fields (see Field Groups). |
| `fieldGroupPrefix` | `string` | No | Prefix applied to field-group column names. |
| `commentSection` | `boolean` | No | Show the shared `CommentsBlock` panel on each record. Configure its thread FK with `defineCommentThreadFields`. |

### Comments

When either `commentSection` option is enabled, CRM always renders the shared
`CommentsBlock`; it does not create a CRM-specific comments table. Let CRM add
its configured organization and people foreign keys to the generic thread:

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
comment foreign keys were contributed. Other products can add their own
foreign keys in the same `defineThread` callback.

### `projects` / `successPlans` / `knowledgeHub`

| Block area | Fields |
| --- | --- |
| `projects` | `enabled?: boolean` (activates the feature), `phases: { name; displayName?; color? }[]`, `enableRaci: boolean`, `enableAdoptionTracking: boolean`. Optional `tableName` (default `crm_projects`). First phase is the default; an enum is generated. |
| `successPlans` | `enabled?: boolean`, `healthScoreThresholds: { good; warning }` (0-100), `renewalUpcomingDays: number`. Optional `tableName` (default `crm_success_plans`). |
| `knowledgeHub` | `enabled?: boolean`, `itemTypes: { name; displayName?; color?; icon? }[]`. Optional `tableName` (default `crm_knowledge_hub`). Knowledge items use `AttachmentsTableBlock` for blob-backed uploads and downloads; create, edit, delete, and attachment mutations require `edit_knowledge_hub`. |

`enableRaci` and `enableAdoptionTracking` are required keys of `projects`;
`healthScoreThresholds` and `renewalUpcomingDays` are required keys of
`successPlans`; `itemTypes` is required for `knowledgeHub`. Each feature's
tables and pages are only created when `enabled: true`. These are generation-time
options, not runtime switches: disabling an existing feature can remove schema
and must be reviewed as a deployment schema change. Projects, success plans,
and knowledge items can run without pipelines. RACI references pipeline tasks,
so `enableRaci: true` requires a task-enabled pipeline; its UI requires linking
the project to an item in that pipeline. RACI displays and selects users through
AuthBlock’s user display fields; it does not require an `employees` table.
Organization-based post-sale features in a B2C system require
`organizations.createTable: true`.

Adoption tracking exposes usage, training, engagement, and support inputs on
project forms. Adoption and health scores have explicit manual assessment forms
(0–100, or blank to clear), restricted to `edit_projects` and
`edit_success_plans` respectively. Saving an assessment updates its timestamp;
clearing it clears the timestamp. No customer-specific scoring formula is
implied. Dashboards show unassessed scores as unknown and use the configured
health thresholds. Custom scoring procedures should validate the same range
and update the score and its assessment timestamp together.

### Partner capabilities

`enablePartnerAttachment` creates only basic partner records and item links.
Opt into the additional features on the block when the client uses them:

```tsx
partners: {
  program: { coSellReadinessThreshold: 80 },
  accountPlans: true,
},
automations: { partners: true },
```

`program` adds partner type, validation, readiness, incentive, and performance
fields; `accountPlans` adds joint account plans and can be enabled separately.
These records can be managed through the standard generated data grids.
Notification storage is created only when partner automation is registered.
Basic attachment supports deal-attached notifications; co-sell and validation
notifications also require `program`.

## Pipelines

`pipelines.pipelines` is an array of `PipelineConfig`:

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | `string` | Pipeline key (also an enum value). |
| `displayName` | `string?` | Human label. |
| `icon` | `IconName?` | Sidebar/header icon. |
| `description` | `string?` | Optional description. |
| `stages` | `PipelineStageConfig[]` | Ordered stages. |
| `entityTypes` | `("organization" \| "person")[]` | Which entities can enter this pipeline. |
| `enableTasks` | `boolean?` | Tasks table/UI; on by default (`!== false`). |
| `enableActivityLog` | `boolean?` | Activity log; on by default (`!== false`). |
| `opportunityFields` | `{ qualification?: boolean }?` | Opt into basic value/probability/risk fields. `qualification: true` also adds use case, success metrics, business-case score, and competitive landscape. |
| `enablePartnerAttachment` | `boolean?` | Adds partner FK and basic partner records. Program fields and joint plans require separate block options. |

`PipelineStageConfig`: `name`, `displayName?`, `icon?`, `color?`,
`description?`, `fields?` (`PipelineStageFieldConfig[]`), `exitCriteria?`
(`ExitCriterion[]`), `exitCriteriaMode?` (`"all" | "any"`), `autoTasksOnEntry?`
(`PipelineStageAutoTask[]`).

`PipelineStageAutoTask`: `title`, `description?`, `dueDaysFromNow?`, `priority?`
(`"low" | "medium" | "high"`).

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

Stage-data exit criteria can be built with the helpers in
`blocks/crm/pipeline/exit_criteria_helpers` (see below). Use the imperative
helpers (`addToPipeline`, `removeFromPipeline`, `createAutoTasksForStage`)
rather than mutating pipeline tables directly.

## Field Groups

Field groups add domain-specific fields that the block renders together, either
as a details section or its own tab.

```tsx
people: {
  tableName: "contacts",
  fieldGroups: [
    {
      name: "engagement",
      displayName: "Engagement",
      displayLocation: "tab", // or "details" (default)
      icon: "Timeline",
      define: (fg) => {
        fg.enum("persona", "crm_contact_persona");
        fg.int("engagement_score");
      },
    },
  ],
}
```

`displayLocation` defaults to `"details"`. `define` receives a
`FieldGroupBuilder`.

## Tables Created

Names below assume default `tableName`s and the default `crm_pipeline` prefix.

| Table | When created | Purpose |
| --- | --- | --- |
| people table (e.g. `contacts`, `customers`) | always | Contact records; `full_name` virtual column; `first_name`/`last_name`/`email`/`phone` by default. |
| organizations table (e.g. `organizations`) | B2B, or B2C with `createTable: true` | Account records; `name`/`website`/`phone`/`description`. |
| `comment_threads`, `comments`, `comment_revisions`, `comment_thread_subscriptions` | any `commentSection` through `CommentsBlock` | Shared CRM discussions, replies, history, and subscriptions. |
| `crm_pipeline_items` | pipelines configured | Pipeline/deal records (stage, entity FK, optional opportunity fields). |
| `crm_pipeline_stage_data` | pipelines configured | Per-stage dynamic field values (one row per field). |
| `crm_pipeline_tasks` | any pipeline with tasks | Pipeline tasks. |
| `crm_pipeline_activity_log` | any pipeline with activity log | Audit/activity history. |
| `crm_projects` | `projects.enabled` | Project tracking. |
| `crm_project_raci` | `projects.enableRaci` | RACI assignments. |
| `crm_success_plans`, `crm_success_plan_kpis` | `successPlans.enabled` | Success plans + KPIs. |
| `crm_knowledge_hub`, `crm_knowledge_hub_attachments` | `knowledgeHub.enabled` | Typed knowledge items plus blob-backed attachments. |
| `crm_partners` | any pipeline with `enablePartnerAttachment` | Basic partner records; optional program fields. |
| `crm_partner_account_plans` | `partners.accountPlans` | Joint account plans. |
| `crm_partner_notifications` | partner automation registered | Co-sell / validation / deal-attached notifications. |
| `crm_industries` | `OrganizationConfig.tableIndustry()` | User-editable industries lookup. |
| `user_all_emails`, `user_email_recipients`, `user_email_attachments` | `emailIntegrations` set | Synced email storage. |

Several enums are generated alongside (e.g. `crm_contact_persona`,
`crm_department`, `crm_project_phase`, `crm_knowledge_item_type`,
`pipeline_task_priority`, `crm_partner_type`). The module also always defines
`crm_contact_type`, `gender_enum`, and `contact_preference_enum` on import.

## Define-Callback Helpers

`OrganizationConfig` (passed to `organizations.define`):

| Method | Adds |
| --- | --- |
| `standardStatus()` | `status` enum (lead/prospect/customer/churned/inactive). |
| `standardEnumIndustry()` | `industry` enum column. |
| `tableIndustry()` | `crm_industries` lookup table + FK. |
| `regionEnum()` | `region` enum. |
| `sizeFields()` | `org_size` enum, `employee_count`, `annual_revenue`. |
| `currentStateSummary()` | multiline `current_state_summary`. |
| `strategicFields()` | current state, initiatives, tech stack, budget cycle, decision criteria. |
| `assignedTeam()` | `assigned_to` FK to `sys_users`. |
| `assignedPartner()` | `assigned_partner` FK to `crm_partners`. |
| `yolmAccountFields()` | all of the above at once. |

`PeopleConfig` (passed to `people.define`):

| Method | Adds |
| --- | --- |
| `personaType()` | `persona` enum (decision_maker/influencer/blocker/champion/user). |
| `department()` | `department` enum. |
| `relationshipStrength()` | `relationship_strength` (1-5). |
| `engagementScore()` | `engagement_score`. |
| `buyingRole()` | `buying_role` enum. |
| `contactType()` | `contact_type` enum (`crm_contact_type`). |
| `partnerId()` | FK to `crm_partners`. |
| `yolmContactFields()` | all of the above at once. |

## Static Pages and Components

Access via the `CrmBlock` class (e.g. `CrmBlock.OrganizationDetailPage`). Page
components are **self-routing** (they accept a `path` prop and render their own
`<Route>`) — do **not** wrap them in `<Route>`.

### Core

| Component | Self-routing | Key props |
| --- | --- | --- |
| `CrmBlock.OrganizationDetailPage` | Yes | `path?`, `details?`, `detailFieldOverrides?`, `excludeFields?`, `appendTabs?`, `prependTabs?`, `leftSideHeader?`, `rightSideHeader?`, `emailsTab?`, `hideComments?`, `hideDefaultEmails?`. B2B only (renders `null` in B2C). |
| `CrmBlock.OrganizationDetailContent` | No | Route-less form of `OrganizationDetailPage` for use inside an existing record route, such as `DatagridPage.recordPage`. Accepts the same props except `path`. |
| `CrmBlock.PersonDetailPage` | Yes | `path?`, `details?`, `excludeFields?`, `appendTabs?`, `prependTabs?`, `leftSideHeader?`, `rightSideHeader?`, `emailsTab?`, `hideComments?`, `hideDefaultEmails?`. |
| `CrmBlock.PersonDetailContent` | No | Route-less form of `PersonDetailPage` for use inside an existing record route, such as `DatagridPage.recordPage`. Accepts the same props except `path`. |
| `CrmBlock.StandardRoutes` | Yes (mounts many) | `overrides?: CrmStandardRouteOverrides` — mounts every default CRM route enabled by opts; pass a `Node` to replace or `false` to suppress a route. |
| `CrmBlock.DetailField` | No | `{ field: string; icon?: IconName; label?: Node }` — inline-editable row for the current record; use inside a detail page's `details` prop. |
| `CrmBlock.DetailDisplayField` | No | `{ label: Node; children: Node; startIcon?: IconName; startDecorator?: Node }` — display-only row wrapping custom content. |

### Reports (`CrmBlock.Reports.*`)

Each accepts `{ name?: string }` and renders a `SimpleReportsPage.Report`; drop
them inside a `SimpleReportsPage`.

| Component | Notes |
| --- | --- |
| `OrganizationsOverview` | B2B only (renders `null` in B2C). |
| `PeopleOverview` | |
| `EmailCampaignsOverview` | |
| `ProjectsOverview` | Requires `KanbanProjectTableBlock` on the organizations table. |
| `WelcomeBack` | `{ name?, notDefault? }`. Requires `KanbanProjectTableBlock` on the organizations table. |

### Pipeline (`CrmBlock.Pipeline.*`)

| Member | Self-routing | Key props / signature |
| --- | --- | --- |
| `Board` | No | `{ pipelineName, header?, renderCardContents?, onItemClick?, entityFilter?, where?, showAddButton?, onAddClick? }`. |
| `ItemDetailPage` | Yes | `{ pipelineName?, path?, appendTabs?, renderEntityDetails? }`. |
| `Pages` | Yes (mounts board/detail/reports) | `{ basePath?, boardHeader?, renderCardContents? }`. |
| `StageFieldsForm` | No | `{ block, pipeline, itemId, stageName, onSave?, readOnly? }`. |
| `ExitCriteriaChecklist` | No | `{ block, pipeline, itemId, stageName, refreshKey? }`. |
| `TaskList` | No | `{ block, itemId, onTaskChange?, showOnlyPending?, limit? }`. |
| `OverdueTasksAlert` | No | `{ block?, pipelineName?, limit? }`. |
| `EntityStatusTab` | No | `{ pipelineName, entityType, editPermission?, itemDetailHref? }` — for an org/person detail tab. |
| `ExtendedItemFieldsForm` | No | `{ hasPartnerAttachment?, hasQualification?, includeNotes?, hideBusinessCaseScore?, labels?, initialValues? }`; use inside a `Form`. |
| `ExtendedItemDetailsCard` | No | `{ pipeline, itemId, labels?, cardTitle?, onSave? }`. |
| `getExtendedItemFieldsFromWriteState` | n/a | `(tableName: string)` → object of SQL exprs for write hooks. |
| `addToPipeline` | n/a | `(s, { pipelineName, entityType, entityId, stageName?, extendedFields?, onSuccess? })`. |
| `removeFromPipeline` | n/a | `(s, { block, itemId })`. |
| `createAutoTasksForStage` | n/a | `(s, { block, pipeline, stageName, itemId, activityLogTable })`. |

Pipeline report/dashboard components under `CrmBlock.Pipeline.Reports`:

| Member | Props |
| --- | --- |
| `Overview` | `{ pipelineName, title? }` |
| `Tasks` | `{ pipelineName }` |
| `SalesDashboard` | `{ pipelineName, title?, showSummary?, showStageBreakdown?, showVelocity?, showTasks?, showPartners?, showActivity?, showEmails? }` |
| `QualificationScoreDistribution` | `{ pipelineName, title? }` |
| `AdoptionValue` | `{ pipelineName, valueStage, kpiAchievement: { stageName, fieldName }, projectPhase?, title? }` |
| `OperatingRhythm` | `{ pipelineName, title? }` |
| `PartnerMetrics` | `{ pipelineName, title? }` |
| `RYGScorecards` | `{ items: { label: string; score: NumericExpr; thresholds?: { red: number; yellow: number } }[] }` |

`AdoptionValue` requires an existing value stage and a boolean stage field for
KPI achievement. Its optional project phase must be configured in `projects`.
Project and success-plan metrics include only records linked to the requested
pipeline; renewal counts use `successPlans.renewalUpcomingDays`. Pipeline item
detail routes select the item's own pipeline, including with multiple pipelines.

Pipeline overview and operating-rhythm reports omit task, activity, and partner
metrics when the corresponding capability is disabled for that pipeline, even
when another pipeline enables it.

### Projects (`CrmBlock.Projects.*`), requires `projects.enabled`

| Member | Self-routing | Props |
| --- | --- | --- |
| `ListPage` | Yes | `{ path?, onRowClick?, toolbarRight? }` |
| `DetailPage` | Yes | `{ path? }` |
| `NewPage` | Yes | `{ path? }` |
| `OrganizationTab` | No | `{ editPermission?, newProjectHref? }` |

### Success Plans (`CrmBlock.SuccessPlans.*`), requires `successPlans.enabled`

| Member | Self-routing | Props |
| --- | --- | --- |
| `ListPage` | Yes | `{ path?, onRowClick?, toolbarRight? }` |
| `DetailPage` | Yes | `{ path? }` |
| `NewPage` | Yes | `{ path? }` |

### Knowledge Hub (`CrmBlock.KnowledgeHub.*`), requires `knowledgeHub.enabled`

| Member | Self-routing | Props |
| --- | --- | --- |
| `Page` | Yes | `{ path?, organizationId?, pipelineItemId?, toolbarRight? }` |
| `DetailPage` | Yes | `{ path? }` |
| `NewPage` | Yes | `{ path? }` |
| `OrganizationTab` | No | `{ editPermission?, newItemHref? }` |

## Block-Instance Helpers

From `const block = system.block(CrmBlock)`:

- Table-name getters: `organizationsTableName`, `peopleTableName`,
  `pipelineItemsTableName`, `pipelineStageDataTableName`, `pipelineTasksTableName`,
  `pipelineActivityLogTableName`, `projectsTableName`,
  `successPlansTableName`, `knowledgeHubTableName`, `partnerNotificationsTableName`.
- Navigation hrefs (return SQL): `organizationHref(id)`, `personHref(id)`,
  `pipelineItemHref(id)`, `projectHref(id)`, `successPlanHref(id)`,
  `knowledgeHubItemHref(id)`, and the generic `recordHref(path, id)`.
- Pipeline lookups: `getPipeline(name)`, `getPipelineStage(p, s)`,
  `getPipelineStageFields(p, s)`, `getNextPipelineStage(p, s)`,
  `getPreviousPipelineStage(p, s)`, `getPipelineStageEnumName(name)`.
- Feature checks: `hasProjectsEnabled()`, `hasSuccessPlansEnabled()`,
  `hasKnowledgeHubEnabled()`, `hasPipelineTasksEnabled(name)`,
  `hasPipelineActivityLogEnabled(name)`.

## Relationship State

Set `organizationRelationshipState` (`CrmOrganizationRelationshipStateConfig`)
to add a disposition enum + optional snooze fields to the organizations table:

```tsx
organizationRelationshipState: {
  disposition: {
    enumName: "crm_relationship_disposition", // default
    fieldName: "relationship_disposition",     // default
    displayName: "Disposition",                // default
    values: [
      { name: "engaged", displayName: "Engaged", color: "#22C55E", emoji: "🟢" },
      { name: "at_risk", displayName: "At Risk", color: "#EF4444" },
    ],
  },
  snooze: {
    untilFieldName: "relationship_snoozed_until", // default
    reasonFieldName: "relationship_snooze_reason", // default; `false` to skip
    reasonMaxLength: 500,                          // default
  },
}
```

`disposition.values` are enum values (`name`, `displayName?`, `color?`) plus
optional `emoji` and `chipClassNames` used by the chip below. When configured,
these direct exports render the disposition:

```tsx
import {
  CrmRelationshipDispositionChip,
  CrmRelationshipDispositionGridCell,
  clearCrmOrganizationRelationshipSnooze,
} from "blocks/crm";
```

- `CrmRelationshipDispositionChip` — `{ disposition: Sql; className?: string }`.
- `CrmRelationshipDispositionGridCell` — `{ editable?: boolean }`; render inside
  a datagrid cell.
- `clearCrmOrganizationRelationshipSnooze(s, organizationId, extraWhere?)` —
  clears the snooze fields for an organization.

## Command Palette

```tsx
import {
  CrmCommandPalette,
  type CrmCommandPaletteCommand,
} from "blocks/crm/command_palette";
```

`CrmCommandPalette` renders a Spotlight-style modal bound to Cmd/Ctrl+K (and
`/` when focus is not in an input). Props:

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `openScalar` | `string` | Yes | Name of the boolean UI scalar that controls visibility. |
| `commands` | `CrmCommandPaletteCommand[]` | Yes | Static actions (`id`, `label`, `href`, `icon` required; `subtitle?`/`keywords?` optional). |
| `placeholder` | `string` | No | Search-box placeholder. |
| `commandsProcedure` | `(s, query: Sql) => void` | No | Seed extra command-style results. |
| `searchProcedure` | `(s, query: Sql) => void` | No | Insert record results into `palette_result_raw`. |

```tsx
<CrmCommandPalette
  openScalar="command_palette_open"
  commands={[
    { id: "new_contact", label: "New Contact", href: "/contacts/new", icon: "Add" },
  ]}
  searchProcedure={mySearchProcedure}
/>
```

## Exit-Criteria Helpers

```tsx
import {
  stageDataBool,
  stageDataNotEmpty,
  stageDataNotNull,
  stageDataNumeric,
} from "blocks/crm/pipeline/exit_criteria_helpers";
```

Each returns a SQL condition (against `crm_pipeline_stage_data`, correlated to
the `item` row) for a stage's `exitCriteria[].condition`:

- `stageDataBool(stage, field)` — boolean field is true.
- `stageDataNotEmpty(stage, field)` — text field is non-empty.
- `stageDataNotNull(stage, field, valueColumn?)` — value present (`valueColumn`
  is one of `string_value`/`bool_value`/`date_value`/`numeric_value`).
- `stageDataNumeric(stage, field, operator, threshold)` — numeric comparison
  (`operator` is one of `>=`/`>`/`=`/`<`/`<=`).

```tsx
exitCriteria: [
  { name: "signed", displayName: "Contract Signed",
    condition: stageDataBool("closed", "contract_signed") },
  { name: "value", displayName: "Value set",
    condition: stageDataNumeric("qualified", "deal_value", ">=", 1000) },
]
```

## Reactors and Automations

Background reactors are enabled either through the `automations` config or by
importing the register functions directly and passing the configured block.
Each is a no-op unless its prerequisite feature is enabled.

```tsx
automations: {
  partners: true,                   // partner notification / co-sell reactors
  renewalTasks: true,               // "Renewal Prep" tasks on pipeline-linked plans
}
```

Direct imports (equivalent to the flags above):

```tsx
import { registerPartnerAutomationReactors } from "blocks/crm/reactors/partner_automation";
import { registerRenewalTaskReactor } from "blocks/crm/reactors/renewal_tasks";
```

`registerPartnerAutomationReactors` requires a pipeline with
`enablePartnerAttachment`. `registerRenewalTaskReactor` requires
`successPlans.enabled` plus a pipeline with tasks, and only creates tasks for
plans linked to a task-enabled pipeline. Registration is idempotent.

### Migrating previous configuration

Replace `enableOpportunityFields: true` with
`opportunityFields: { qualification: true }` to retain its existing schema, or
use `{}` for basic opportunities in a new system. Existing partner-program
consumers must explicitly configure `partners.program` and
`partners.accountPlans` to retain those tables and fields. Existing notification
consumers must register partner automation. Preserve deployed schema unless a
separate schema migration is intended.

Supply `AdoptionValue` with the client's actual stage, boolean KPI field, and
optional project phase. The old `standaloneRenewalReminders` option and
`registerStandaloneRenewalReminderReactor` were removed: they did not deliver
reminders and incorrectly changed the health assessment timestamp. Standalone
plans remain supported; configure a client-owned delivery workflow if needed.

## Email Integrations

```tsx
import { GmailIntegration } from "blocks/email_integrations/gmail";
import { OutlookEmailIntegration } from "blocks/email_integrations/outlook_email";

new CrmBlock({
  type: "b2b",
  people: { tableName: "contacts" },
  emailIntegrations: [{ integration: GmailIntegration }],
});
```

Enabling `emailIntegrations` creates the email storage tables and (when you use
`CrmBlock.StandardRoutes`) mounts an inbox route plus an account-management
page. See [Email Integrations](email_integrations.md).

## Common Mistakes

- Recreating contacts, organizations, pipeline, project, or email-sync schema
  the block already provides. Declare your tables through `people`/`organizations`.
- Passing `people` without `tableName`, or omitting `people` entirely — it is
  required.
- Wrapping self-routing pages (`CrmBlock.OrganizationDetailPage`,
  `CrmBlock.Pipeline.ItemDetailPage`, the `Projects`/`SuccessPlans`/`KnowledgeHub`
  `ListPage`/`DetailPage`/`NewPage` members) in a `<Route>`. Pass `path`.
- Using `Projects`/`SuccessPlans`/`KnowledgeHub` pages without the matching
  `enabled: true` feature config (they render `null`).
- Calling `CrmBlock.Reports.ProjectsOverview` / `WelcomeBack` without adding
  `KanbanProjectTableBlock` to the organizations table — they read its
  project/task tables.
- Mutating `crm_pipeline_*` tables directly instead of `addToPipeline` /
  `removeFromPipeline` / `createAutoTasksForStage`.
- Assuming table names — read the configured `tableName` (or the table-name
  getters on the block instance) rather than hard-coding `organizations`/`contacts`.
- Importing the exit-criteria helpers from `blocks/crm/pipeline/types` (a stale
  path in the source JSDoc); the real module is
  `blocks/crm/pipeline/exit_criteria_helpers`.
