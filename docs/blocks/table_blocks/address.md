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

`AddressTableBlock` adds a cohesive group of address fields (street, city,
state, country, zip, and optionally name and a second street line) to a table,
and ships display components that render and inline-edit that group. Use it
instead of hand-adding individual address columns, so the companion
`AddressCard`, `AddressText`, and `AddressesCard` components can find the
fields.

```ts
import { AddressTableBlock } from "table_blocks/address";
```

The display components live in submodules and are imported separately:

```ts
import { AddressCard } from "table_blocks/address/address_card";
import { AddressText } from "table_blocks/address/address_text";
import { AddressesCard } from "table_blocks/address/addresses_card";
```

## Minimal Setup

Add the block inside a `db.table` definition. With no options it creates an
address field group named `"address"`:

```ts
import { AddressTableBlock } from "table_blocks/address";

db.table("contacts", (table) => {
  table.string("contact_name", 100).notNull();
  table.addBlock(AddressTableBlock);
});
```

`table.addBlock(blockConstructor, opts)` constructs the block instance for you
and passes the table name automatically; supply options as the second argument.
Do not call `new AddressTableBlock(...)` yourself in a table definition.

### Multiple address groups on one table

`allowMultipleInstances` is `true`, so a table can carry several address groups
(e.g. billing + shipping). Give each instance a distinct `name` and `prefix` to
avoid column collisions:

```ts
db.table("clients", (table) => {
  table.addBlock(AddressTableBlock, {
    name: "billing_address",
    prefix: "billing_",
  });
  table.addBlock(AddressTableBlock, {
    name: "shipping_address",
    prefix: "shipping_",
  });
});
```

## Configuration

Options come from `AddressFieldGroupOpts` (the block's second argument).

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | No | Field group name. Defaults to `"address"`. This is the value you pass to the components' `group` prop. |
| `prefix` | `string` | No | Prefix applied to every default field name (e.g. `billing_` → `billing_street`). Use when adding multiple groups to one table. |
| `legacyCountry` | `boolean` | No | When `true`, the country field is a plain `string` instead of the `country` enum. Use only when importing legacy data that cannot be cleaned to enum values. Defaults to `false`. |
| `createFields` | object | No | Per-field toggle/rename — see below. |
| `fieldOverrides` | object | No | Per-field full override — see below. |

### `createFields`

Each key is `boolean | string`. `true`/`false` toggles creation; a `string`
sets a literal column name (and **bypasses `prefix`**).

| Field key | Default field name | Created by default | Column type |
| --- | --- | --- | --- |
| `name` | `name` | No | `string(100)` |
| `street` | `street` | Yes | `string(80)` (primary line) |
| `streetTwo` | `street_two` | No | `string(80)` |
| `city` | `city` | Yes | `string(85)` |
| `state` | `state` | Yes | `string(50)` |
| `country` | `country` | Yes | `enum("country")`, or `string(60)` when `legacyCountry` |
| `zip` | `zip` | Yes | `string(20)` |

Example — also create the optional second street line:

```ts
table.addBlock(AddressTableBlock, {
  name: "permanent_address",
  prefix: "permanent_",
  createFields: { streetTwo: true },
});
```

### `fieldOverrides`

Each key (`name`, `street`, `streetTwo`, `city`, `state`, `country`, `zip`) is a
`(table: TableBuilder) => void` callback. When provided, the callback runs
**instead of** the default field creation for that slot, so you can set your own
type, length, or constraints. The callback must add the column itself; the
group still maps the slot to its resolved column name (the name `createFields`
and `prefix` would produce), so create the field under that same name (and call
`.group(<group name>)` to match the default behaviour) for the components to
resolve it.

## Fields Created

For the default group (no `prefix`), the columns added are `street`, `city`,
`state`, `country` (enum `country`), and `zip`; plus `name` and `street_two`
only when enabled via `createFields`. The group's internal mapping treats
`street` as the primary line and `state` as the displayed region.

## Components

All three are UI components (not pages — do not wrap in `<Route>`). Each reads
the current-record context (current table, record id, and refetch trigger),
which a [`RecordPage`](../../ui/record_page.md) provides; the example apps
render them inside `<RecordPage table="...">`. They throw at generation time if
the named group is not an address field group on the current table.

### `AddressCard`

Import: `table_blocks/address/address_card`

Renders an outlined card titled "Address" with an `AddressText` body.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `sx` | `Style` | No | Card styles. |
| `className` | `string` | No | Card class names. |
| `header` | `Node` | No | Card header content. Defaults to the literal `"Address"`. |
| `group` | `string` | No | Address field-group name on the current table. Defaults to `"address"`. |

```tsx
<AddressCard className="col-span-12 lg:col-span-4" />
```

### `AddressText`

Import: `table_blocks/address/address_text`

Conditionally renders the address lines. If every address field is null it shows
"No address". Clicking the address opens an inline popover with a
[`Form`](../../ui/form.md) that edits the group's fields and triggers the
surrounding refetch on save. Usually used inside `AddressCard`.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `group` | `string` | No | Address field-group name. Defaults to `"address"`. |
| `size` | `"sm" \| "md" \| "lg"` | No | Typography scale for the lines. Defaults to `"md"`. |
| `placement` | floating placement | No | Edit-popover placement: `"top"`, `"top-start"`, `"top-end"`, `"right"`, `"right-start"`, `"right-end"`, `"bottom"`, `"bottom-start"`, `"bottom-end"`, `"left"`, `"left-start"`, `"left-end"`. Defaults to `"left-start"`. |

```tsx
<AddressText group="shipping_address" size="sm" />
```

### `AddressesCard`

Import: `table_blocks/address/addresses_card`

Renders several address groups in one outlined card, each under its own
sub-heading. Each group is shown via `AddressText`.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `groups` | `{ name: string; header: Node }[]` | Yes | Groups to render, in order. Each `name` must match an address field group on the current table; `header` is the sub-heading above it. |
| `header` | `Node` | No | Card title. Defaults to the literal `"Addresses"`. |
| `sx` | `Style` | No | Card styles. |
| `className` | `string` | No | Card class names. |

```tsx
import { sql } from "std/sql_utils";

<AddressesCard
  className="col-span-12 lg:col-span-6"
  groups={[
    { name: "local_address", header: sql.lit`Local` },
    { name: "permanent_address", header: sql.lit`Permanent` },
  ]}
/>;
```

## Exported Types

- `AddressTableBlock` — the block class (from `table_blocks/address`).
- `Props` — props for `AddressCard` (from `table_blocks/address/address_card`).
- `AddressTextProps` — props for `AddressText`
  (from `table_blocks/address/address_text`).
- `Props` — props for `AddressesCard`
  (from `table_blocks/address/addresses_card`).

The block also exposes two read-only getters on its instance: `displayName`
(human label derived from `name` — underscores to spaces, first letter
upper-cased — defaulting to `"Address"`) and `table` (the parent table). These
are rarely needed by consumers.

## Relationships

- Wraps the `address` field group from `field_groups/address`; the components
  detect groups of type `AddressFieldGroup`.
- The country field uses the `country` enum from `enums/country` unless
  `legacyCountry` is set.

## Common Mistakes

- Adding street/city/etc. columns manually instead of via the block — the
  components rely on the registered field group and will not find loose fields.
- Placing `AddressCard`/`AddressText`/`AddressesCard` outside a record context
  (e.g. in a datagrid). They require a current record to read and edit.
- Passing a `group` (or `groups[].name`) that does not match the block's `name`.
  The default name is `"address"`; a mismatch throws at generation time.
- Adding multiple address groups without distinct `name` and `prefix`, causing
  duplicate column names.
- Importing the components from `table_blocks/address` (the index only exports
  `AddressTableBlock`). Import each component from its submodule path.
- Expecting `prefix` to apply to a `createFields` entry given as a string — a
  string value is used verbatim as the column name.
