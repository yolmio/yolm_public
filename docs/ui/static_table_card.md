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

StaticTableCard renders a card containing a two-column table of record fields and values. It's designed to work within a [RecordPage](./record_page.md) context to display fields in a clean, organized layout.

```tsx
import { StaticTableCard } from "components/static_table_card";
```

## Basic Usage

```tsx
<RecordPage table="customers">
  <StaticTableCard
    rows={["name", "email", "phone", "company"]}
  />
</RecordPage>
```

This displays four fields from the customer record:
- **name** → Customer name (left column) | Field value (right column)
- **email** → Email (left column) | Field value (right column)
- **phone** → Phone (left column) | Field value (right column)
- **company** → Company (left column) | Field value (right column)

## How It Works

StaticTableCard requires a [RecordPage](./record_page.md) context. Inside RecordPage:

1. StaticTableCard reads the current `record.*` values from the RecordPage data context
2. Field names in the `rows` array are matched against the table schema
3. Values are displayed with proper type formatting (dates, numbers, etc.)
4. Each row is a label-value pair in a table

**Important:** StaticTableCard cannot be used outside RecordPage. It relies on the `record_id` and current table context provided by RecordPage.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `rows` | `Row[]` | (required) | Array of rows to display (see below) |
| `className` | `string` | - | Tailwind classes for styling |
| `sx` | `Style` | - | Yolm style object for the card |

### Row Type

Each row can be either:

#### 1. String (field name)

```tsx
rows={["name", "email", "phone"]}
```

The component automatically loads the field from the table schema and displays it with proper formatting.

#### 2. Object (custom expression)

```tsx
rows={[
  {
    label: "Full Name",
    expr: sql`record.first_name || ' ' || record.last_name`,
    display: (value) => <span className="font-bold">{value}</span>
  },
  {
    label: "Email Domain",
    expr: sql`substring(record.email from position('@' in record.email) + 1)`,
  }
]}
```

**Object properties:**
- `label` (required): Display label for the row
- `expr` (required): SQL expression to fetch/compute the value
- `display` (optional): Function to customize how the value is rendered

## Common Patterns

### Basic Detail Page

```tsx
<RecordPage table="customers">
  <div className="grid grid-cols-12 gap-4 p-4">
    <PageHeader>
      <Typography level="h4">{sql`record.name`}</Typography>
      <PageHeader.Grow />
      <PageHeader.DefaultActions />
    </PageHeader>

    <StaticTableCard
      className="col-span-12 lg:col-span-8"
      rows={["name", "email", "phone", "website"]}
    />

    <AddressCard className="col-span-12 lg:col-span-4" />
  </div>
</RecordPage>
```

### With Custom Formatted Fields

```tsx
<StaticTableCard
  rows={[
    "name",
    "email",
    {
      label: "Created",
      expr: sql`format.date(record.created_at, '%b %d, %Y')`,
    },
    {
      label: "Lifetime Value",
      expr: sql`record.lifetime_value`,
      display: (value) => <span>${value}</span>
    }
  ]}
/>
```

### Mixed String and Custom Rows

```tsx
<StaticTableCard
  rows={[
    "company_name",
    "contact_email",
    {
      label: "Industry",
      expr: sql`(select industry from db.industries where id = record.industry_id)`,
    },
    "support_rep"
  ]}
/>
```

### Responsive Grid Layout

```tsx
<RecordPage table="contacts">
  <div className="grid grid-cols-12 gap-3 p-4">
    <PageHeader>
      <Typography level="h4">{sql`record.name`}</Typography>
      <PageHeader.Grow />
      <PageHeader.DefaultActions />
    </PageHeader>

    <StaticTableCard
      className="col-span-12 lg:col-span-8"
      rows={["name", "title", "email", "phone"]}
    />
  </div>
</RecordPage>
```

## Styling

### With Tailwind Classes

```tsx
<StaticTableCard
  className="col-span-12 md:col-span-6 lg:col-span-4"
  rows={["name", "email", "phone"]}
/>
```

### With Yolm Styles

```tsx
<StaticTableCard
  sx={{
    boxShadow: "md",
    borderRadius: "lg",
  }}
  rows={["name", "email"]}
/>
```

## Best Practices

1. **Use for simple field display** — StaticTableCard works best for showing a set of record fields in a structured format.

2. **Keep row count reasonable** — For many fields, consider splitting into multiple cards or using tabs.

3. **Use string rows when possible** — Simpler and benefits from automatic type formatting. Use object rows only for custom expressions or display logic.

4. **Always within RecordPage** — StaticTableCard depends on RecordPage's data context. Never use it standalone.

5. **Combine with other components** — Pair with `AddressCard`, `NotesCard`, `Data`, etc. for complete detail pages.

6. **Responsive layouts** — Use Tailwind grid classes (`col-span-12 lg:col-span-8`) to adapt to different screen sizes.

## Common Mistakes

```tsx
// ❌ WRONG - Cannot use outside RecordPage
<StaticTableCard rows={["name", "email"]} />

// ✅ CORRECT - Inside RecordPage
<RecordPage table="customers">
  <StaticTableCard rows={["name", "email"]} />
</RecordPage>

// ❌ WRONG - Invalid field name
<StaticTableCard rows={["invalid_field_name"]} />

// ✅ CORRECT - Use actual table columns
<StaticTableCard rows={["name", "email", "phone"]} />
```

## See Also

- [RecordPage](./record_page.md) — Self-routing detail page component
- [Data Component](./data.md) — Declarative data fetching
- [Card Component](./card.md) — Base card styling
