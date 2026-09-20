---
title: Custom Form Controls
description: How to customize the default record picker for a table when other forms reference it through foreign keys.
tags:
  - database
  - fields
  - form
  - ui
---

# Custom Form Controls

By default, Yolm chooses a record picker when a form edits a foreign key to a
table. Use `setFormControl()` on the referenced table to customize that picker
for all foreign keys that use the table's default control.

## Basic Custom Control

```typescript
db.table("external_event_types", (table) => {
  table.string("name", 100).notNull();
  table.string("owner", 200);
  table.string("scheduling_url", 200).notNull();

  table.setFormControl({
    type: "Combobox",
    displayItem: ({ record }) => {
      return (
        <Data procedure={(s) => {
          s.defRecord(
            "event_type",
            sql`select * from db.external_event_types where id = ${record}.id`
          );
        }}>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-baseline">
              {sql`event_type.name`}
              <Typography level="body-sm">{sql`event_type.owner`}</Typography>
            </div>
            <Typography level="body-xs">
              {sql`event_type.scheduling_url`}
            </Typography>
          </div>
        </Data>
      );
    },
  });
});
```

This creates a custom combobox for selecting `external_event_types` records.
Foreign key fields that reference this table can show rich formatted items
instead of just the record name.

## Use Cases

### Multi-Line Display in Dropdowns

When you need to show multiple fields in a dropdown selection:

```typescript
db.table("products", (table) => {
  table.string("sku", 50).notNull();
  table.string("name", 200).notNull();
  table.decimal("price", { precision: 10, scale: 2 });

  table.setFormControl({
    type: "Combobox",
    displayItem: ({ record }) => {
      return (
        <Data procedure={(s) => {
          s.defRecord("product", sql`select * from db.products where id = ${record}.id`);
        }}>
          <div className="flex justify-between items-center w-full">
            <div className="flex flex-col">
              <Typography level="body-lg">{sql`product.name`}</Typography>
              <Typography level="body-sm" color="neutral">
                SKU: {sql`product.sku`}
              </Typography>
            </div>
            <Typography level="body-md" fontWeight="bold">
              ${sql`product.price`}
            </Typography>
          </div>
        </Data>
      );
    },
  });
});
```

### Contextual Information Display

Show additional context to help users make selections:

```typescript
db.table("customers", (table) => {
  table.string("name", 200).notNull();
  table.email("email").notNull();
  table.string("company", 200);
  table.string("status", 50);

  table.setFormControl({
    type: "Combobox",
    displayItem: ({ record }) => {
      return (
        <Data procedure={(s) => {
          s.defRecord("customer", sql`select * from db.customers where id = ${record}.id`);
        }}>
          <div className="flex flex-col gap-1">
            <div className="flex gap-2 items-center">
              <Typography level="body-lg">{sql`customer.name`}</Typography>
              <Chip
                size="sm"
                color={sql`case when customer.status = 'active' then 'success' else 'neutral' end`}
              >
                {sql`customer.status`}
              </Chip>
            </div>
            <Typography level="body-sm">{sql`customer.email`}</Typography>
            <Show when={sql`customer.company is not null`}>
              <Typography level="body-xs" color="neutral">
                {sql`customer.company`}
              </Typography>
            </Show>
          </div>
        </Data>
      );
    },
  });
});
```

## Control Types

### Select (Simple Dropdown)

For tables with few records that should be displayed as a simple dropdown:

```typescript
db.table("categories", (table) => {
  table.string("name", 15).notNull();
  table.string("description", 2000);
  table.setFormControl("Select");  // Simple dropdown instead of combobox
});

db.table("shippers", (table) => {
  table.string("name", 40).notNull();
  table.string("phone", 24);
  table.setFormControl("Select");
});
```

Use `Select` when:
- The table has a small number of records (< 20)
- Users benefit from seeing all options at once
- No search/filtering is needed

### Combobox

The most common custom control, used for foreign key selections with search capability:

```typescript
table.setFormControl({
  type: "Combobox",
  displayItem: ({ record }) => <CustomDisplay />,
});
```

### Custom Renderer

You can also pass a custom render function when `Select` or `Combobox` are not
enough. The custom renderer is still a table-level record picker; use field
definitions and form-field components for scalar controls such as text inputs,
numbers, dates, and checkboxes.

## Best Practices

1. **Keep it Fast** - Display items should be lightweight as they render for every option
2. **Use Typography** - Use Yolm's Typography component for consistent styling
3. **Show Relevant Info** - Include just enough info to distinguish options
4. **Consider Mobile** - Multi-line displays should work on small screens
5. **Handle Nulls** - Use `Show` components for optional fields

## Integration with Form Components

The table-level control is used when a form renders a foreign key to that table:

```tsx
<Form>
  <Form.Insert table="orders">
    <Form.Field field="product_id">
      {/* Automatically uses the custom Combobox control defined on products table */}
    </Form.Field>
  </Form.Insert>
</Form>
```

## Combined Example

Combobox display for an event-type lookup table:

```typescript
db.table("external_event_types", (table) => {
  table.string("name", 100).notNull();
  table.string("owner", 200);
  table.string("scheduling_url", 200).notNull();
  table.string("calendly_uri", 200);
  table.string("utm_source", 75);
  table.string("utm_content", 75);
  table.bool("active").notNull();

  table.setFormControl({
    type: "Combobox",
    displayItem: ({ record }) => {
      return (
        <Data procedure={(s) => {
          s.defRecord(
            "event_type",
            sql`select * from db.external_event_types where id = ${record}.id`
          );
        }}>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-baseline">
              {sql`event_type.name`}
              <Typography level="body-sm">{sql`event_type.owner`}</Typography>
            </div>
            <Typography level="body-xs">
              {sql`event_type.scheduling_url`}
            </Typography>
          </div>
        </Data>
      );
    },
  });

  table.searchConfig({
    fields: [
      { field: "name", priority: 1 },
      { field: "owner", priority: 2 },
      { field: "scheduling_url", priority: 2 },
    ],
  });
});
```

When users select an event type in a form, they see:
- **Main line**: Event name + owner (small text)
- **Second line**: Full scheduling URL (smaller text)

This helps users quickly identify the right event type among many similar options.
