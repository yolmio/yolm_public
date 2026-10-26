---
title: Address Table Block
description: Adds reusable address fields to a table and renders them with an editable address card and text components.
tags:
  - blocks
  - table-block
  - address
  - ui
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
  - ui/data_vs_form.md
---

# Address Table Block

`AddressTableBlock` adds an address field group (street, city, state, country,
zip; optionally name and a second street line) to a table, plus components that
render and inline-edit it. Use it instead of hand-adding address columns: the
components resolve fields through the registered field group, not loose columns.

## Minimal Setup

Pass the class and options to `table.addBlock`; do not call
`new AddressTableBlock(...)` yourself. With no options it creates a group named
`"address"`:

```ts
import { AddressTableBlock } from "table_blocks/address";

db.table("contacts", (table) => {
  table.string("contact_name", 100).notNull();
  table.addBlock(AddressTableBlock);
});
```

A table may carry several groups (`allowMultipleInstances`); give each a
distinct `name` and `prefix` to avoid column collisions:

```ts
db.table("clients", (table) => {
  table.addBlock(AddressTableBlock, { name: "billing_address", prefix: "billing_" });
  table.addBlock(AddressTableBlock, { name: "shipping_address", prefix: "shipping_" });
});
```

## Configuration

Options are `AddressFieldGroupOpts` in `packages/field_groups/address.ts`.

| Option | Meaning |
| --- | --- |
| `name` | Field group name (default `"address"`); the value passed to the components' `group` prop. |
| `prefix` | Prefix for every default field name (`billing_` -> `billing_street`). |
| `legacyCountry` | `country` becomes a plain string instead of the `country` enum (from `enums/country`). Only for legacy imports that cannot be cleaned. |
| `createFields` | Per-field `boolean \| string`: toggle creation, or a string for a literal column name that **bypasses `prefix`**. |
| `fieldOverrides` | Per-field `(table: TableBuilder) => void` that runs **instead of** the default column creation. |

Field slots (`createFields` / `fieldOverrides` keys), with default column names:
`name` -> `name` (off by default), `street` -> `street`, `streetTwo` ->
`street_two` (off by default), `city`, `state`, `country`, `zip`. The group
treats `street` as the primary line and `state` as the displayed region.

A `fieldOverrides` callback must create the column itself, under the name the
slot resolves to (via `createFields` and `prefix`), and should call
`.group(<group name>)` like the default does, so the components can resolve it.

## Components

Not pages; import each from its submodule (the package index exports only
`AddressTableBlock`). Each needs a current-record context (table, record id,
refetch), such as a [`RecordPage`](../../ui/record_page.md), and throws at
generation time if the named group is not an address field group on the
current table.

| Component | Import | Purpose |
| --- | --- | --- |
| `AddressCard` | `table_blocks/address/address_card` | Outlined card (default header `"Address"`) wrapping `AddressText`. Props: `group`, `header`, `sx`, `className`. |
| `AddressText` | `table_blocks/address/address_text` | Address lines, or "No address"; click opens a popover [`Form`](../../ui/form.md) that edits the group and refetches on save. Props (`AddressTextProps`): `group`, `size` (`sm`/`md`/`lg`), `placement` (popover, default `"left-start"`). |
| `AddressesCard` | `table_blocks/address/addresses_card` | Several groups in one card. Required `groups: { name; header }[]`; optional `header` (default `"Addresses"`), `sx`, `className`. |

```tsx
<AddressesCard
  className="col-span-12 lg:col-span-6"
  groups={[
    { name: "local_address", header: sql.lit`Local` },
    { name: "permanent_address", header: sql.lit`Permanent` },
  ]}
/>;
```

The block instance also exposes `displayName` (label derived from `name`,
default `"Address"`) and `table` (the parent table).
