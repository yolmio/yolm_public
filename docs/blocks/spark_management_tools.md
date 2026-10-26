---
title: Block Spark Management Tools
description: Opt-in Spark and MCP capabilities for locations, CRM, scheduling, availability, templates, email delivery, workforce, training, dashboards and Drive.
tags:
  - blocks
  - spark
  - mcp
related:
  - blocks/solution_blocks.md
  - blocks/workforce.md
  - blocks/spark.md
---

# Block Spark Management Tools

These factories add domain operations to `SparkBlock.capabilities`. Import each
factory from its block's `spark` module and call it after adding the source block
to the system. Keep the returned capability and reuse it rather than
registering the factory multiple times. Registration adds procedures, not
persistent tables or fields.

The factories in the first table are built with `blockToolset` and require an
explicit administrator `permission` defined by `AuthBlock`; an empty permission
fails at generation time.

| Module | Factory | Operations |
| --- | --- | --- |
| `blocks/locations/spark` | `locationsSparkCapability(locations, { permission })` | List hierarchy paths, create and update locations, deactivate without deleting history |
| `blocks/email_templates/spark` | `emailTemplatesSparkCapability(templates, { permission })` | List variables and templates, render previews, author basic templates as plain text |
| `blocks/marketing_email_campaign/spark` | `marketingEmailCampaignSparkCapability(campaigns, { permission })` | Draft campaigns, preview audiences, approve scheduling/cancellation, inspect delivery outcomes |
| `blocks/connected_account_email_delivery/spark` | `connectedAccountEmailSparkCapability(source, { permission })` | Inspect own senders, preview selected recipients, approve sends, inspect delivery outcomes |
| `blocks/crm/spark` | `crmSparkCapability(crm, { permission })` | Find and patch standard fields, add configured discussion notes, move pipeline items, manage tasks |
| `blocks/scheduling/spark` | `schedulingSparkCapability(scheduling, { permission })` | Find slots, inspect appointments, approve booking/rescheduling/cancellation |
| `blocks/availability/spark` | `availabilitySparkCapability({ permission })` | Inspect, create, replace and remove host time off |

These factories derive their gate from the source block instead:

| Module | Factory | Permission | Operations |
| --- | --- | --- | --- |
| `blocks/workforce/spark` | `workforceSparkCapability(workforce, { permission? })` | AuthBlock's access-policy administrator permission, else the block's `managementPermission`, else the passed `permission`; one is required | Configure reference data, organization structure and access rules. See [Workforce](workforce.md#spark-and-mcp). |
| `blocks/training/spark` | `trainingSparkCapability(training, { name?, label? })` | Any Training management permission; each tool rechecks its own | Author, publish and assign courses and assessments. See [Training](training.md#spark-tools). |
| `blocks/dashboard` | `dashboards.sparkCapability` | None at capability level; tools check the dashboard block's create, edit and admin permissions | Create, test and arrange dashboards. See [Dashboard](dashboard.md). |
| `blocks/spark/drive` | `sparkDriveCapability({ name, files, spaceTypes, permission?, permissions? })` | Optional; Drive space access always applies | Browse and organize Drive spaces. See [SparkBlock](spark.md#drive-tools). |

```tsx
import { locationsSparkCapability } from "blocks/locations/spark";

// locations is an already registered LocationsBlock instance.
const locationTools = locationsSparkCapability(locations, {
  permission: "manage_workforce",
});
// Include locationTools in the consuming SparkBlock's capabilities array.
```

The same capabilities are available to native Spark and connected MCP clients.
MCP read-only execution rejects actions. Every procedure checks the current
user's permission and disabled status when it executes, including after human
approval. The consuming MCP connection must also grant the capability. CRUD
changes use Spark's reversible action receipts. Undo validates restored location
hierarchies and rejects template restoration while a campaign using that template
is scheduled or submitting; rejection rolls back the entire undo transaction. Operations that can send mail,
notify subscribers, or change external calendars require approval and do not
promise undo. Enabling the capability does not enable external services.

## Domain contracts

These are organization-wide management tools, except connected email, which also
checks the current user's mailbox access and source authorization. They are not
a substitute for record-level user interfaces. Do not grant the management
permission to users who should see only a subset of CRM or calendar records.

Location writes reuse hierarchy validation and the block's `afterCreate` hook.
Optional code and description fields follow the block configuration. Tools
change names, parents and active state; they do not administer CMMS metadata.

CRM tools patch only standard string fields present in the configured schema.
Custom fields remain with their owning workflows, whose validation the generic
patch could not enforce. A set-based or generic write tool is appropriate only
when schema constraints and state guards make every input it accepts valid; see
[Actions](spark.md#actions). Discussion actions exist only when `commentSection` is configured and
retain the CommentsBlock access checks. Pipeline transitions retain exit
criteria and automatic tasks. Task completion is an explicit desired state,
not a toggle. Setting time off does not cancel existing appointments.

Scheduling tools support developer-defined event types. Booking details are
strings converted to the configured field types. A booking action is omitted
when required custom fields cannot be supplied through these tools. Page-specific
form hooks and runtime-defined event types are outside this capability; enable
it only when the block-level booking workflow is sufficient. Provider identifiers,
public access tokens and lifecycle fields are never accepted as booking details.
Slot previews do not reserve capacity; execution rechecks availability.

Template editing replaces all authored text in a basic template. Advanced
layouts can be previewed but must be edited through the template editor.
Templates used by scheduled or submitting campaigns cannot be edited through
these tools or either template editor. HTML previews may be truncated, as
indicated in their result.

Campaign draft edits can only be undone while the campaign is in draft. All undo
routes reject restoration in scheduled, submitting, submitted, or failed states.
Campaign scheduling requires the fingerprint from a fresh preview. It includes
template source, campaign variables, sender configuration and recipient data;
changes before approval require another preview. Scheduling retains the existing
campaign lifecycle: the audience is frozen when scheduled, and template content
is rendered when the campaign is submitted. Rendering-dependent data can change
between those times. Results distinguish submitted mail from confirmed delivery.

Connected-email capabilities require a `selectedRows` source adapter returning
exactly one eligible recipient per selected ID, with that ID as
`source_recipient_key`. Source authorization and mailbox access are checked again
when sending. Preview returns a fingerprint and a unique `request_key`; pass both
to `send`. Reuse the request key for retries. A new preview supplies a new key
for a separately approved send. Reusing a key with changed content is rejected.
Do not retry an uncertain delivery using a new key: inspect its results first.
OAuth tokens and provider credentials are not returned by tools.

## Local validation

`examples/block_spark_tools` composes all capabilities with fixture users and a
mock connected-email sender. Its README describes local startup. Run
`yolm tests -d examples/block_spark_tools` for runtime and MCP action-contract
coverage. These tests do not require an AI provider or a production snapshot.
