---
title: Maintenance Block
description: Maintenance issues, work orders, parts, inspections, preventive programs, and operations-first maintenance pages.
tags:
  - blocks
  - maintenance
  - equipment
  - workflows
related:
  - blocks/events.md
  - blocks/locations.md
  - blocks/equipment.md
  - concepts/blocks.md
---

# Maintenance Block

`MaintenanceBlock` is one work-item model for reported problems and preventive
maintenance, with equipment or location targets, assignees, activity history,
revisioned preventive programs, and an optional mobile reporting companion.

```ts
import { MaintenanceBlock } from "blocks/maintenance";

const maintenance = new MaintenanceBlock({
  reportPermission: "perform_maintenance",
  managePermission: "manage_maintenance",
});
system.addBlock(maintenance);
```

It requires the equipment and locations blocks. Discussion uses
[`CommentsBlock`](./comments.md): define `comment_threads.maintenance_item_id`
(unique, `onDelete("Cascade")`) in `defineThread`, and use
`maintenance.canAccess(user)` for the discussion's `canRead`/`canWrite`. The
item pages count comments and attachments through that column.

Use the block's stored procedures for lifecycle changes so status, assignees,
targets, and activity history stay consistent. Do not recreate its tables in
application schema; add only system-owned fields or relations a workflow needs.

## Options

See `MaintenanceBlockOptions` in `packages/blocks/maintenance/index.tsx`.

| Option | Contract |
| --- | --- |
| `reportPermission` / `managePermission` | Required. Reporters may report and work; managers assign, reopen, manage programs, and review. |
| `locationPrograms` | Programs may target a location instead of an equipment type; adds `maintenance_save_location_program` and `LocationMaintenancePrograms`. |
| `fieldCloseOut` | People doing the work close it with per-worker hours (see below). |
| `closeOutReview` | With `fieldCloseOut`, closed work waits in `awaiting_review` for a manager. |
| `programlessHistory` | Preventive items may exist without a program, for migrated history. |

Enabling an option on a deployed system adds schema or enum values; classify
the change before deploying.

`maintenance.notificationSource(itemHref)` returns a
[`UserNotificationsBlock`](./user_notifications.md) source
(`maintenance.assignment`, Inbox-only) for assignment notifications.

## Owned tables

| Table | Purpose |
| --- | --- |
| `maintenance_items` | Reported problems and preventive work; `status` is `open`, `awaiting_review` (with review), or `completed`. |
| `maintenance_item_targets` | One equipment item or one location per row, with condition and due date. |
| `maintenance_item_assignees` | Assigned users. |
| `maintenance_item_activities` | Activity history (created, assignee, status, condition, target, `returned`). |
| `maintenance_item_time_entries` | Per-worker minutes (with `fieldCloseOut`). |
| `maintenance_programs` | Preventive programs with steps and an interval in days or months. |
| `equipment_maintenance_schedules` | Per-unit (or per-location) next due date for a program. |

## Pages and components

| Export | Import | Purpose |
| --- | --- | --- |
| `MaintenanceItemsPage` | `blocks/maintenance/item_ui` | Work queue with open/review filters. |
| `MaintenanceItemDetailPage` | `blocks/maintenance/item_ui` | One item (`itemId`); optional `closeOut` and `review` nodes replace the built-in close-out and review actions so a system can ask its own questions in the same screen. |
| `MaintenancePrograms` | `blocks/maintenance/program_ui` | A type's programs (`definitionId`) with an add/edit dialog, per-unit due dates, and pause/resume. |
| `LocationMaintenancePrograms` | `blocks/maintenance/program_ui` | Programs on a location; throws unless `locationPrograms` is set. |

Pass `unitLabel` to `MaintenancePrograms` for a shorter unit name, such as an
asset tag:

```tsx
<MaintenancePrograms
  definitionId={sql`definition_id`}
  unitLabel={(unit) =>
    sql`coalesce((select value from db.equipment_identifiers
      where equipment_id = ${unit}.id and kind = 'asset_tag' and valid_to is null
      limit 1) || ' · ' || ${unit}.display_name, ${unit}.display_name)`}
/>
```

## Field close-out and manager review

Without `fieldCloseOut`, only the manage permission completes or reopens an item
through `maintenance_set_item_status`; reporters report problems and comment.
Completion advances every preventive target's schedule, so callers
must show all targets and make that scope clear before completing the item.

With `fieldCloseOut`, managers assign work (`maintenance_set_item_assignees`;
`maintenance_take_item` is for managers taking work themselves). Assignees or a
manager close it with `maintenance_close_item`, passing each worker's time as
`[{ "userId": …, "minutes": … }]`. The reporter may close a problem while nobody
is assigned (fixed on the spot); set `fixedOnTheSpot` in the reporting options
to offer "I already fixed it" on new reports. Reopening stays with managers.

With `closeOutReview`, `maintenance_review_item` approves (optionally correcting
hours) or sends work back to open; the caller posts the reason as a comment.
Preventive schedules advance when work is closed, not when it is approved.

## Preventive programs

A program belongs to an equipment type (or a location) and has a name, steps
(one per line in `instructions`), and an interval. Each covered unit has its own
schedule row, so units fall due on different dates. The hourly
`maintenance_generate_due_items` job opens one preventive item per due program.

Programs save through `maintenance_save_program(p_program_id, p_definition_id,
p_name, p_instructions, p_interval_value, p_interval_unit, p_units,
p_actor_user_id)`. `p_program_id` is null for a new program, and `p_units` is
`[{ equipment_id, next_due_on }]` for every covered unit. Removing a unit
deletes only its schedule; past items stay. `maintenance_set_program_active`
pauses or resumes a program. Both require the manage permission.

## Reporting companion

`registerReportMessages()` (`blocks/maintenance/reporting_schema`),
`registerReportMessageProcedure(options)` (`reporting_procedure`), and the
`ReportComposer` / `ReportDrafts` UI (`reporting_ui`, which registers the
`/api/problem-messages` endpoints through `useReportMessageApi`) provide durable
browser drafts with photo/video uploads. Register the schema and procedures once
per system. `MaintenanceReportingOptions` (`reporting_options`) adds
`reportHref`, `fixedOnTheSpot`, and `onReportCreated`.

- The API authenticates reporters and checks draft ownership. A received report
  is immutable through the upload API; retry and discard return its receipt
  instead of deleting evidence.
- Follow-up drafts are keyed by user and report/work, independent of equipment
  or location; older drafts migrate individually, with exact recovery links
  when several exist. Initial reports keep their entry point while the selected
  context can change before sending.
- Unsubmitted uploads expire after seven days without server activity; start,
  retry, and successful uploads renew it. An hourly sweep removes at most 100
  expired drafts and their media references in one transaction, without loading
  file bytes. Browser-local attachments remain available for re-upload.
  Explicit discard removes pending server uploads before resetting the browser
  draft, and keeps the draft if that fails. Submitted evidence is not removed;
  blob reclamation follows platform storage retention.
- Report authors use `onDelete("Restrict")`: disable accounts to revoke access
  while keeping authored messages and media.
