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

`LocationsBlock` owns the physical location hierarchy shared by workforce,
equipment, maintenance, and scheduling; it also works standalone.

```ts
import { AuthBlock } from "blocks/auth";
import { LocationsBlock } from "blocks/locations";
import { WorkforceBlock } from "blocks/workforce";
import { system } from "std/system";

const locations = new LocationsBlock();
system.addBlock(locations);
system.addBlock(new AuthBlock({ appAuthTypes: ["email_password"] }));
const workforce = new WorkforceBlock({ locations });
system.addBlock(workforce);
```

Add it before consumers and pass the same instance to each; never create a
second location directory.

## Owned Tables

| Table       | Purpose                                                                         |
| ----------- | ------------------------------------------------------------------------------- |
| `locations` | Self-referencing hierarchy via nullable `parent_location_id`; `active` defaults to true. |

By default there is no kind enum, code, or operational metadata.

## Configuration

See `LocationsBlockOptions` in `packages/blocks/locations/index.tsx`.

| Option | Meaning |
| --- | --- |
| `kinds` | Explicit nonempty kind list; the first kind is the creation default. |
| `additionalKinds` | Extends the standard kinds (or `kinds`); on its own it enables the `location_kind` enum. |
| `operationalMetadata` | Equipment/maintenance schema: default kinds, codes, description, creation timestamp, operational fields. Defaults to false. |
| `shopFloor` | With operational metadata, omits CMMS role description, criticality, and external references. |
| `afterCreate` | `(s, locationId)` hook inside the shared create transaction (e.g. create a sticker). |

`codes` and `description` override the operational defaults. Existing
operational consumers must set `operationalMetadata: true` explicitly; changing
it on a deployed database requires a classified, rehearsed schema migration.
Preserve deployed enum ordering.

## Components

- `LocationsBlock.Management`: searchable directory with click-to-edit,
  deactivation, and optional Add / Add sublocation. Props: `locations`,
  `allowCreate`, Form write hooks, `createAction`, `rowActions`. The caller
  must enforce authorization in `afterTransactionStart`.
- `LocationsBlock.Hierarchy` (also `LocationHierarchy` from
  `blocks/locations/hierarchy`): navigable tree with URL-preserved expansion.
  Equipment counts are queried only when `equipmentHref` is supplied;
  `rootLocationId` scopes to a subtree.
- `LocationsPage`: the hierarchy with `/locations/{id}` links.

`defineLocations` fields appear in the generated forms; fields hidden from the
form need defaults or transaction hooks.

`locationPaths()` from `blocks/locations/queries` returns each path and
delimited ancestor IDs (null code/kind/description when absent). Match ancestry
by ID, not display-name prefixes.

## Validation and Imports

The block registers `validate_location_structure`. Call it inside every custom
create or move transaction; custom SQL writers must also perform any writes
`afterCreate` would. It rejects blank names, duplicate nonempty codes within a
parent (when codes exist), and cyclic or disconnected hierarchies.

Names may repeat. Workforce CSV imports accept an unambiguous name or a full
path such as `Main plant / Assembly / Bay 1`; ambiguous values are rejected.
Employer and host scoping stays on workforce relationships, not locations.
