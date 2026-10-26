---
title: StaticTableCard
description: Display record fields in a styled table card format, perfect for detail pages within RecordPage.
tags:
  - ui
  - components
  - display
  - record
  - table
---

# StaticTableCard

`StaticTableCard` renders an outlined card holding a two-column label/value
table for the current record.

```tsx
import { StaticTableCard } from "components/static_table_card";
```

## Example

```tsx
<RecordPage table="customers">
  <div className="grid grid-cols-12 gap-4 p-4">
    <StaticTableCard
      className="col-span-12 lg:col-span-8"
      rows={[
        "name",
        "email",
        "phone",
        {
          label: "Industry",
          expr: sql`(select name from db.industries where id = record.industry_id)`,
        },
        {
          label: "Lifetime Value",
          expr: sql`format.currency(record.lifetime_value, 'USD')`,
          display: (value) => <span className="font-semibold">{value}</span>,
        },
      ]}
    />
    <AddressCard className="col-span-12 lg:col-span-4" />
  </div>
</RecordPage>
```

## Behavior

- It must be rendered inside a record context that provides the current table
  and `record` row: [`RecordPage`](./record_page.md) or a `DatagridPage`
  [`recordPage`](./datagrid.md#integrated-record-pages). Outside one, it
  fails at generation time.
- A string row is a field name on that table. The label is the field's
  display name and the value renders with `InlineFieldDisplay`, so dates,
  enums, numbers, and FKs get field-aware formatting. An unknown field name
  fails generation; check `core.tsx` for real field names.
- An object row is `{ label, expr, display? }`. `label` is any node, `expr`
  is a SQL expression that can read `record.*`, and `display(value)` wraps the
  computed value. Expression rows are evaluated in one nested `Data` for the
  card, so prefer string rows when no computation is needed.
- `className` and `sx` style the card.
