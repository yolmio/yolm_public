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

`RecordPage` is a self-routing detail page for one record: it registers the
route, loads the record, handles loading and not-found states, and exposes the
row to its children.

```tsx
import { RecordPage, RecordPageContent } from "pages/record_page";
```

## Example

```tsx
<RecordPage table="customers">
  <div className="grid grid-cols-12 gap-4 p-4">
    <PageHeader>
      <Typography level="h4">{sql`record.name`}</Typography>
      <PageHeader.Grow />
      <ActionButton
        variant="outlined"
        successMessage="Customer activated"
        action={(s) => {
          s.startTransaction();
          s.modify(sql`update db.customers set status = 'active' where id = ui.record_id`);
          s.commitTransaction();
        }}
      >
        Activate
      </ActionButton>
      <PageHeader.DefaultActions />
    </PageHeader>

    <StaticTableCard
      className="col-span-12 lg:col-span-6"
      rows={["name", "email", "phone", "company_id"]}
    />

    <Data
      procedure={(s) => {
        s.defTable("recent_orders", sql`
          select id, order_number, format.currency(total, 'USD') as total_label, created_at
          from db.orders
          where customer_id = ui.record_id
          order by created_at desc
          limit 10
        `);
      }}
    >
      <Table hoverRow className="col-span-12 lg:col-span-6">
        <tbody>
          <Each table="recent_orders" recordName="order">
            <tr>
              <td>{sql`order.order_number`}</td>
              <td>{sql`order.total_label`}</td>
              <td>{sql`format.date(order.created_at, '%b %d, %Y')`}</td>
            </tr>
          </Each>
        </tbody>
      </Table>
    </Data>
  </div>
</RecordPage>
```

## Contract

- **Route**: `/{table_base_url}/{record_id:id}` (e.g. `/contacts/123`). Do not
  wrap it in a `Route`; pass `path` (containing `{record_id:id}`) only when the
  default is wrong, for example `path="/people/{record_id:id}"`.
- **`ui.record_id`**: the current id. Use it in child `Data` queries, server
  bodies, and props such as `where={sql\`contact_id = ui.record_id\`}`. Do not
  use `current_record_id()` here.
- **`record`**: the row from `select * from db.<table>` (plus `display_name`
  when the table has a record display name), readable as `sql\`record.field\``.
  It contains only the table's own columns; fetch related-table values
  (customer name for `customer_id`, related lists) with a subquery or a child
  `Data` query keyed on `ui.record_id`.
- **States**: loading uses `Data`'s default `CircularProgress` (override with
  `pendingFallback`, or `null` to disable); fetch errors use `errorFallback`; a
  missing record shows an "Unable to get <Table>" alert. Children render only
  when the record exists. `statusScalar` exposes the fetch status.
- **Title**: the document title is the record display name when configured,
  otherwise `title` if given.
- **Refresh**: `ActionButton` and `Form` refetch the enclosing `Data` on
  success, which reloads `record`. In raw handlers call `s.refetch()`.
- **Back to list**: a link from a record page to its list should set
  `backLink` (see [Routing](./routing.md#returning-to-a-list)) so the list's
  filters and scroll are restored.
- **Table context**: children such as `StaticTableCard`, `Form.InlineEdit`,
  `PageHeader.DefaultActions`, and `NotesCard` read the current table and
  record id from the page.

Other props: `recordWhere` adds a SQL condition to the record fetch (a record
outside it shows as not found), `routeState` adds statements to the page's
state procedure, `queryParams` declares URL params, `sx` wraps children, and
`wrapper` wraps the route content (e.g. a layout with sidebar). See
`RecordPageProps` in `pages/record_page`.

`RecordPageContent` is the route-less form used by `DatagridPage`
[`recordPage`](./datagrid.md#integrated-record-pages). It requires an enclosing
route that defines `ui.record_id`; application code should use `RecordPage` or
the datagrid API instead of assembling that route.

## Tabbed Detail Pages

`RecordWithTabsAndDetailPage` composes a header, detail card, and tabs:

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
  details={<StaticTableCard rows={["name", "email", "phone", "company_id"]} />}
  tabs={[
    { header: "Tickets", content: (
      <AutoKanban
        table="tickets"
        field="ticket_status"
        where={sql`contact_id = ui.record_id`}
        initializeValues={{ contact_id: sql`ui.record_id` }}
      />
    ) },
    { header: "Notes", content: <NotesCard /> },
  ]}
/>
```

See also [Timeline Pattern](./timeline_pattern.md) and
[Choosing page primitives](./record_grid.md).
