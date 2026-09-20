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

`MaintenanceBlock` models reported issues, corrective work, parts, work steps,
inspections, and revisioned preventive-maintenance programs. It provides
`MaintenanceDashboardPage`, `MaintenanceWorkDetailPage`, and
`MaintenancePriorityChip`.

It composes the event, location, and equipment blocks:

```ts
import { MaintenanceBlock } from "blocks/maintenance";

const maintenance = new MaintenanceBlock({ events, equipment, locations });
system.addBlock(maintenance);
```

The dashboard is an operations queue that prioritizes open work by urgency,
equipment state, due date, and criticality. `MaintenanceWorkDetailPage` reads
the `maintenance_work_id` query parameter. Route both pages explicitly and use
the block's procedures for lifecycle transitions so issue reporting, work
execution, parts, and event history stay consistent.

The block owns its maintenance tables and enums. Do not recreate them in
application schema; add only system-owned fields or relations that a concrete
workflow needs.
