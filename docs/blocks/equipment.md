---
title: Equipment Block
description: Equipment definitions, serialized assets, identifiers, custody, restrictions, location, and operational status pages.
tags:
  - blocks
  - equipment
  - operations
  - assets
related:
  - blocks/events.md
  - blocks/locations.md
  - concepts/blocks.md
  - ui/routing.md
---

# Equipment Block

`EquipmentBlock` models durable equipment independently from its current
location: definitions, serialized units, identifiers, components,
restrictions, and status. It exports `EquipmentListPage`,
`EquipmentDetailPage`, `EquipmentStatusChip`, and `equipmentStatusLabel`.

It requires the same `EventsBlock` and `LocationsBlock` instances used by the
system:

```ts
import { EquipmentBlock } from "blocks/equipment";

const equipment = new EquipmentBlock({ events, locations });
system.addBlock(equipment);
```

Route the list and detail pages explicitly. `EquipmentDetailPage` reads the
`equipment_id` query parameter. The block records lifecycle, operability,
location, custody, restrictions, and activity; use its event helpers and
procedures to preserve that history instead of writing status fields in
parallel application tables.

A unit's manufacturer serial is `equipment.serial_number`. It is unique within
the unit's equipment definition, so two models may share a serial but two units
of one model may not. `equipment_identifiers` holds the other identifiers: tags,
QR values, customer and external references. With `shopFloor: true`, neither
exists.

The block's `EquipmentStatusChip` accepts SQL expressions for `operability`,
`lifecycle`, and optional `hasRestriction`, so it can render a row or detail
record without copying values into JavaScript state.
