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
location. It owns equipment definitions, serialized equipment, identifiers,
components, restrictions, and related status data. It provides
`EquipmentListPage`, `EquipmentDetailPage`, `EquipmentStatusChip`, and
`equipmentStatusLabel`.

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

The block's `EquipmentStatusChip` accepts SQL expressions for `operability`,
`lifecycle`, and optional `hasRestriction`, so it can render a row or detail
record without copying values into JavaScript state.
