---
title: Datagrid Virtual Columns
description: How to add computed columns, cross-table queries, and custom cells to datagrids using virtual columns.
tags:
  - ui
  - datagrid
  - virtual-columns
  - computed-fields
---

# Datagrid Virtual Columns

Virtual columns display computed data in datagrids without adding physical fields to your database tables. They support filtering, sorting, and custom rendering.

For general Datagrid usage, see the [Datagrid documentation](./datagrid.md).


## Basic Virtual Column

```tsx
<DatagridPage
  table="contacts"
  columns={(b) => {
    b.autoFields();

    // Virtual column showing related data
    b.virtualColumn({
      storageName: "company_state",
      expr: sql`(select state from db.companies where id = record.company_id)`,
      filter: { type: "enum", enum: "us_state", notNull: false },
    });
  }}
/>
```

## Virtual Column Types

### Cross-Table Queries

Query related tables to display related data:

```tsx
b.virtualColumn({
  storageName: "company_industry",
  expr: sql`(select industry_id from db.companies where id = record.company_id)`,
  filter: { type: "table", table: "industries", notNull: true },
});
```

### Computed Boolean Columns

Display computed yes/no values with custom rendering:

```tsx
function ScheduledAppointment() {
  const cell = useCellHelper();
  return (
    <Checkbox
      sx={{ mx: "auto" }}
      checked={sql`${cell.value} = 'true'`}
      variant="outlined"
      color="neutral"
      readOnly
      tabIndex={-1}
      onCheckboxChange={(s) => {
        s.event.preventDefault();
      }}
    />
  );
}

b.virtualColumn({
  storageName: "scheduled_appointment",
  expr: sql`exists (select 1 from db.calendly_appointments where contact_id = record.id)`,
  cell: <ScheduledAppointment />,
  filter: { type: "bool", notNull: true },
  sort: { type: "numeric" },
});
```

### String Expressions

Combine fields or format data:

```tsx
b.virtualColumn({
  storageName: "event_type_name",
  expr: sql`(select name from db.scheduling_event_types where id = record.event_type_id)`,
  filter: { type: "string", notNull: true },
  sort: { type: "string" },
});
```

## Virtual Column Properties

`storageName` (unique id) and `expr` (the SQL expression) are required; everything
else is optional. The commonly-needed optional properties are `displayName`,
`cell`, `filter`, `sort`, `initialWidth`, and `initiallyDisplaying`. Use the
exported TypeScript types for the full property list.

## Filter Configuration

Different filter types for different data:

```tsx
// Enum filter
filter: { type: "enum", enum: "us_state", notNull: false }

// Foreign key filter
filter: { type: "table", table: "companies", notNull: true }

// Boolean filter
filter: { type: "bool", notNull: true }

// String filter (text search)
filter: { type: "string", notNull: false }

// Number filter
filter: { type: "number", notNull: true }

// Date filter
filter: { type: "date", notNull: false }
```

### Related String Values

When a virtual column displays an aggregate of related strings, define a
relation filter so comparisons run against each related value instead of the
aggregate display expression:

```tsx
b.virtualColumn({
  storageName: "notes",
  expr: sql`coalesce((
    select string_agg(n.note, ' | ')
    from db.notes n
    where n.contact_id = record.id
  ), '')`,
  filter: {
    type: "string",
    notNull: false,
    relation: {
      from: sql`db.notes n`,
      value: sql`n.note`,
      where: sql`n.contact_id = record.id`,
    },
  },
});
```

Positive comparisons use `exists` over matching related rows. Negative
comparisons use `not exists`, so “does not contain X” means no related value
contains X. Empty and not-empty test whether any non-null, non-empty related
value exists. The outer datagrid query is not joined directly, so related rows
do not duplicate records or change pagination.

## Sort Configuration

```tsx
// String sorting
sort: { type: "string" }

// Numeric sorting
sort: { type: "numeric" }

// Checkbox-style boolean sorting
sort: { type: "checkbox" }
```

## Custom Cell Components

Create interactive cells with state and events:

```tsx
function NotificationStatus() {
  const helpers = useCellHelper();

  return (
    <Data procedure={(s) => {
      s.defScalar(
        "has_errors",
        sql`(exists(select 1 from db.scheduling_appointment_notifications_status
             where scheduling_appointment_id = ${helpers.recordId}
             and status = 'failed'))`
      );
      s.defScalar("openDialog", sql`false`);
    }}>
      <Show
        when={sql`has_errors`}
        fallback={
          <Button
            variant="soft"
            color="primary"
            onClick={(s) => s.setScalar("openDialog", sql`true`)}
          >
            Notifications sent
          </Button>
        }
      >
        <Button
          variant="soft"
          color="danger"
          onClick={(s) => s.setScalar("openDialog", sql`true`)}
        >
          Notifications failed
        </Button>
      </Show>
      <NotificationsDialog
        bindScalar="openDialog"
        appointmentId={helpers.recordId}
        onClose={(s) => s.setScalar("openDialog", sql`false`)}
      />
    </Data>
  );
}

b.cellOnlyColumn({
  storageName: "notification_status",
  displayName: "Notifications Status",
  initialWidth: 200,
  initiallyDisplaying: true,
  cell: <NotificationStatus />,
});
```

## Cell-Only Columns

For columns that don't need an expression (purely UI):

```tsx
b.cellOnlyColumn({
  storageName: "actions",
  displayName: "Actions",
  cell: <ActionsCell />,
});
```

## useCellHelper Hook

Access cell context in custom components:

```tsx
function CustomCell() {
  const cell = useCellHelper();

  // Available properties:
  // - cell.value: The column value
  // - cell.recordId: The record ID
  // - cell.record: Full record access (sql`${cell.record}.field_name`)

  return <div>{cell.value}</div>;
}
```

## Count Virtual Columns

Special helper for counting related records:

```tsx
b.countVirtual("companies");  // Counts records in companies table
b.countVirtual({
  storageName: "additional_emails",
  table: "client_additional_emails",
});
```

## Complete Example

```tsx
<DatagridPage
  table="contacts"
  selectable
  columns={(b) => {
    // Regular fields
    b.autoFields();

    // Related data from another table
    b.virtualColumn({
      storageName: "company_state",
      expr: sql`(select state from db.companies where id = record.company_id)`,
      filter: { type: "enum", enum: "us_state", notNull: false },
      displayName: "Company State",
    });

    // Foreign key lookup
    b.virtualColumn({
      storageName: "company_industry",
      expr: sql`(select industry_id from db.companies where id = record.company_id)`,
      filter: { type: "table", table: "industries", notNull: true },
      displayName: "Industry",
    });

    // Boolean with custom cell
    function ScheduledAppointment() {
      const cell = useCellHelper();
      return (
        <Checkbox
          sx={{ mx: "auto" }}
          checked={sql`${cell.value} = 'true'`}
          variant="outlined"
          color="neutral"
          readOnly
          tabIndex={-1}
          onCheckboxChange={(s) => s.event.preventDefault()}
        />
      );
    }

    b.virtualColumn({
      storageName: "scheduled_appointment",
      expr: sql`exists (select 1 from db.calendly_appointments where contact_id = record.id)`,
      cell: <ScheduledAppointment />,
      filter: { type: "bool", notNull: true },
      sort: { type: "numeric" },
      displayName: "Has Appointment",
    });

    // Count related records
    b.countVirtual("calendly_appointments");
  }}
/>
```

## Query Considerations

Datagrid virtual columns run in list-page queries, so a small expression can
become expensive when it is evaluated for every visible row. For broader query
authoring guidance, see [Yolm SQL Query Authoring Notes](../sql/query_planning.md).

1. **Keep expressions focused** - Complex expressions can slow down large datasets.
2. **Use EXISTS for booleans** - Prefer `exists()` over counting when you only need yes/no.
3. **Filter intentionally** - Add filters only where users need them.
4. **Avoid per-row top-1 scans** - In list pages, be careful with correlated
   expressions like `select ... where child.parent_id = record.id order by ...
   limit 1`. If many rows need the same latest child value, prefer ranking the
   child table once with `row_number() over (partition by parent_id order by
   ...)` and then filtering to `rn = 1`.
5. **Reuse shared match sets** - If several metrics or tables use the same
   expensive match predicate, compute the matched IDs once in a CTE or local SQL
   helper and reuse that relation. This keeps count, list, and "latest in group"
   queries aligned and avoids repeated work.
6. **Prove equivalence before landing rewrites** - For performance rewrites,
   compare old/new SQL on representative rows, including null and duplicate
   cases, then verify the page still behaves correctly on representative data.

## Best Practices

1. **Name clearly** - Use descriptive `storageName` values
2. **Add filters** - Make virtual columns filterable when useful
3. **Enable sorting** - Allow sorting on computed values
4. **Set display names** - Provide user-friendly column headers
5. **Use custom cells sparingly** - Only when default rendering isn't sufficient
6. **Verify on realistic data** - Check performance on representative tables
