---
title: RecordPage
description: Self-routing page component for displaying and editing individual database records with automatic loading, error handling, and Data integration.
tags:
  - ui
  - pages
  - record
  - detail
  - routing
---

# RecordPage

RecordPage is a self-routing page component that handles displaying a single database record. It provides automatic routing, record fetching, loading states, error handling, and a built-in data context for child components.

## Import

```tsx
import { RecordPage, RecordPageContent } from "pages/record_page";
import { Data } from "std/data";
```

## Basic Usage

```tsx
<RecordPage table="contacts">
  <div className="p-4">
    <Typography level="h3">{sql`record.name`}</Typography>
    <div>
      <Typography level="body-sm">Email</Typography>
      <Typography>{sql`record.email`}</Typography>
    </div>
    <div>
      <Typography level="body-sm">Phone</Typography>
      <Typography>{sql`record.phone`}</Typography>
    </div>
    <Typography>{sql`format.date(record.created_at, '%b %d, %Y')`}</Typography>
  </div>
</RecordPage>
```

RecordPage is **self-routing** -- it generates its own route automatically. Do NOT wrap it in a `<Route>` component.

**Default path:** `/{table}/{record_id:id}` (e.g., `/contacts/123`)

`RecordPageContent` is the route-less form used by higher-level pages such as
`DatagridPage recordPage`. It supplies the same record query and contexts but
requires an enclosing route that defines `ui.record_id`. Application code
should normally choose `RecordPage` or the integrated datagrid API instead of
assembling that route manually.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `table` | `string` | (required) | Database table name |
| `path` | `string` | `/{table}/{record_id:id}` | Custom route path |
| `routeState` | `StateStatementsOrFn` | - | Additional state initialization |
| `children` | `Node` | (required) | Page content |
| `sx` | `Style` | - | Styling |
| `queryParams` | `QueryParam[]` | - | URL query parameters |
| `pendingFallback` | `Node \| null` | - | Custom loading fallback |
| `errorFallback` | `Node \| null` | - | Custom error fallback |
| `statusScalar` | `string` | - | Scalar name for the underlying data status |
| `wrapper` | `(children: Node) => Node` | - | Wraps the routed page content |
| `recordWhere` | `Sql` | - | Additional condition applied when loading the record |

## Key Concepts

### Built-in Data Context

RecordPage wraps children in a data context scoped to the current record. The record fields are accessible via SQL expressions. Use Data components and standard UI elements to display record data.

```tsx
<RecordPage table="contacts">
  <div className="p-4">
    <Typography level="h3">{sql`record.name`}</Typography>
    <div>
      <Typography level="body-sm">Email</Typography>
      <Typography>{sql`record.email`}</Typography>
    </div>
    <div>
      <Typography level="body-sm">Phone</Typography>
      <Typography>{sql`record.phone`}</Typography>
    </div>

    {/* FK dot notation -- auto-joins related tables */}
    <div>
      <Typography level="body-sm">Company</Typography>
      <Typography>{sql`record.company.name`}</Typography>
    </div>

    {/* Formatted fields */}
    <Typography>{sql`format.date(record.created_at, '%b %d, %Y')`}</Typography>
    <Typography>{sql`'$' || cast(record.lifetime_value as string)`}</Typography>

    {/* Conditional display */}
    <Show when={sql`record.is_vip`}>
      <Chip color="primary">VIP</Chip>
    </Show>
  </div>
</RecordPage>
```

### record_id Scalar

RecordPage exposes `record_id` (accessible as `ui.record_id`) for the current record's ID. This is useful in Data queries and server procedures:

```tsx
<RecordPage table="customers">
  {/* Use Data to fetch related records */}
  <Data procedure={(s) => {
    s.defTable("orders", sql`select * from db.orders where customer_id = ui.record_id order by created_at desc limit 5`);
  }}>
    <Each table="orders" recordName="order">
      {sql`order.order_number`}
      {sql`'$' || cast(order.total as string)`}
    </Each>
  </Data>

  {/* Use ui.record_id for server procedures */}
  <Button onClick={(s) => {
    s.tryServer({
      body: (s) => {
        s.modify(sql`update db.customers set status = 'active' where id = ui.record_id`);
      },
    });
  }}>
    Activate
  </Button>
</RecordPage>
```

### Automatic Error Handling

RecordPage handles three states automatically:
- **Loading**: Shows a spinner while fetching
- **Not Found**: Shows an error if the record doesn't exist
- **Error**: Shows an alert if the fetch fails

You only need to provide the success-state UI as children.

## Common Patterns

### Detail Page with Related Data

Use Data components and standard UI elements for record display and related data:

```tsx
<RecordPage table="clients">
  <div className="grid grid-cols-12 w-full mx-auto p-2 sm:px-4 md:gap-4 lg:px-10 xl:max-w-7xl py-4 gap-3">
    <PageHeader>
      <Typography level="h4">{sql`record.name`}</Typography>
      <PageHeader.Grow />
      <PageHeader.DefaultActions />
    </PageHeader>

    {/* Client details */}
    <Card variant="outlined" className="col-span-12 lg:col-span-6">
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Typography level="body-sm">Name</Typography>
            <Typography>{sql`record.name`}</Typography>
          </div>
          <div>
            <Typography level="body-sm">Email</Typography>
            <Typography>{sql`record.email`}</Typography>
          </div>
          <div>
            <Typography level="body-sm">Phone</Typography>
            <Typography>{sql`record.phone`}</Typography>
          </div>
          <div>
            <Typography level="body-sm">Industry</Typography>
            <Typography>{sql`record.industry`}</Typography>
          </div>
          <div>
            <Typography level="body-sm">Website</Typography>
            <Typography>{sql`record.website`}</Typography>
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Related orders as a data table */}
    <div className="col-span-12">
      <Data procedure={(s) => {
        s.defTable("client_orders", sql`select * from db.orders where client_id = ui.record_id order by created_at desc`);
      }}>
        <Table stickyHeader hoverRow>
          <thead>
            <tr>
              <th>Order #</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            <Each table="client_orders" recordName="order">
              <tr>
                <td>{sql`order.order_number`}</td>
                <td>{sql`format.currency(order.total, 'USD')`}</td>
                <td>{sql`order.status`}</td>
                <td>{sql`format.date(order.created_at, '%b %d, %Y')`}</td>
              </tr>
            </Each>
          </tbody>
        </Table>
      </Data>
    </div>
  </div>
</RecordPage>
```

### Detail Page with Related Records

```tsx
<RecordPage table="customers">
  <Card variant="outlined">
    <CardHeader>
      <Typography level="h3">{sql`record.name`}</Typography>
    </CardHeader>
    <CardContent>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Typography level="body-sm">Email</Typography>
          <Typography>{sql`record.email`}</Typography>
        </div>
        <div>
          <Typography level="body-sm">Phone</Typography>
          <Typography>{sql`record.phone`}</Typography>
        </div>
        <div>
          <Typography level="body-sm">Company</Typography>
          <Typography>{sql`record.company.name`}</Typography>
        </div>
      </div>

      <Typography level="title-md" className="mt-4">Recent Orders</Typography>
      <Data procedure={(s) => {
        s.defTable("recent_orders", sql`select * from db.orders where customer_id = ui.record_id order by created_at desc limit 10`);
      }}>
        <Each table="recent_orders" recordName="order">
          <div className="flex justify-between py-2 border-b border-divider">
            {sql`order.order_number`}
            {sql`'$' || cast(order.total as string)`}
            {sql`format.date(order.created_at, '%b %d, %Y')`}
          </div>
        </Each>
      </Data>
    </CardContent>
  </Card>
</RecordPage>
```

### Detail Page with Tabs

```tsx
import { RecordWithTabsAndDetailPage } from "pages/record_with_tabs_and_detail";

<RecordWithTabsAndDetailPage
  table="contacts"
  header={
    <PageHeader>
      <Typography level="h4">{sql`record.name`}</Typography>
      <PageHeader.Grow />
      <PageHeader.DefaultActions />
    </PageHeader>
  }
  details={
    <StaticTableCard rows={["name", "email", "phone", "company"]} />
  }
  tabs={[
    {
      header: "Orders",
      content: (
        <Data procedure={(s) => {
          s.defTable("orders", sql`select * from db.orders where contact_id = ui.record_id order by created_at desc`);
        }}>
          <Each table="orders" recordName="order">
            <div className="flex justify-between py-2">
              {sql`order.order_number`}
              {sql`'$' || cast(order.total as string)`}
            </div>
          </Each>
        </Data>
      ),
    },
    {
      header: "Notes",
      content: <NotesCard recordId={sql`ui.record_id`} />,
    },
  ]}
/>
```

### Custom Path

```tsx
{/* Override default path */}
<RecordPage table="users" path="/people/{record_id:id}">
  <UserDetail />
</RecordPage>

{/* Custom path with pipeline items */}
<RecordPage table="pipeline_items" path="/pipeline-items/{record_id:id}">
  <PipelineItemDetail />
</RecordPage>
```

### Inline Editing

RecordPage works with Form inline editing components:

```tsx
<RecordPage table="customers">
  <div className="grid grid-cols-2 gap-4 p-4">
    <div>
      <Typography level="body-sm" className="text-secondary">Name</Typography>
      <Form.InlineEdit field="name" />
    </div>
    <div>
      <Typography level="body-sm" className="text-secondary">Email</Typography>
      <Form.InlineEdit field="email" />
    </div>
  </div>
</RecordPage>
```

### With Kanban or Custom Components

```tsx
<RecordPage table="contacts">
  <div className="grid grid-cols-12 gap-3 p-4">
    <PageHeader>
      <Typography level="h4">{sql`record.name`}</Typography>
      <PageHeader.Grow />
      <PageHeader.DefaultActions />
    </PageHeader>

    <div className="col-span-12">
      <AutoKanban
        table="tickets"
        field="ticket_status"
        where={sql`contact_id = ui.record_id`}
        initializeValues={{
          contact_id: sql`ui.record_id`,
        }}
      />
    </div>
  </div>
</RecordPage>
```

## Refreshing Data

Use `s.refetch()` after a mutation when the page should reload its record data:

```tsx
<RecordPage table="customers">
  <Button onClick={(s) => {
    s.tryServer({
      body: (s) => {
        s.modify(sql`update db.customers set status = 'active' where id = ui.record_id`);
      },
      finally: (s) => {
        s.refetch();
      },
    });
  }}>
    Activate
  </Button>
</RecordPage>
```

## Best Practices

1. **Use Data components and SQL expressions for display.** RecordPage provides a data context -- use SQL expressions like `sql\`record.field\`` to display fields. Use `Data` for fetching related records and `Each` for iteration.

2. **Use Data + Table for tabular related data.** When showing related records in a table, use a `Data` component to fetch records and a `Table` with `Each` for rendering.

3. **Use FK dot notation.** `sql\`record.customer.name\`` auto-joins -- no manual queries needed.

4. **Use Data for related records.** For related data, use `Data` with a query referencing `ui.record_id`. Only use `ui.record_id` directly in custom components like Kanban.

## See Also

- [Data Component](./data.md) - Declarative data fetching
- [Routing](./routing.md) - Self-routing page components
- [Timeline Pattern](./timeline_pattern.md) - Activity timelines in RecordPage
