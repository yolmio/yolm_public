---
title: Locations Block
description: Hierarchical sites, areas, storage, service locations, and equipment positions with a LocationsPage.
tags:
  - blocks
  - locations
  - equipment
  - operations
related:
  - blocks/events.md
  - concepts/blocks.md
  - ui/routing.md
---

# Locations Block

`LocationsBlock` defines hierarchical physical places and optional equipment
positions. It owns the `locations` table and the `location_kind` enum, and
provides `LocationsPage`.

It requires an `EventsBlock` instance so locations can register their aggregate
and event types:

```ts
import { EventsBlock } from "blocks/events";
import { LocationsBlock, LocationsPage } from "blocks/locations";

const events = new EventsBlock();
const locations = new LocationsBlock({ events });
system.addBlock(events);
system.addBlock(locations);
```

Route `LocationsPage` inside the app's `AppRoutes`. The page reads the location
hierarchy; add application-specific write flows with `Form` or a stored
procedure that preserves the parent and code constraints.

Use `LocationsBlock` before `EquipmentBlock` or `MaintenanceBlock`, which use
its location records as part of their operational model.
