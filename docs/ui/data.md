---
title: Data Component
description: How to use Data for query-backed UI, queryParams, local state, watch/debounce, status, errors, and s.refetch after Form mutations.
tags:
  - ui
  - data
  - state
  - fetching
related:
  - ui/form.md
  - ui/action_button.md
---

# Data Component

The `Data` component is the primary way to fetch and display data in Yolm.
Use `Form.Update` for edits inside a query-backed flow, then call
`s.refetch()` so the visible `Data` result refreshes. Import `Data` from
`std/data`.

```tsx
import { Data } from "std/data";
```

## Query-Backed UI With Form Refresh

For a query-backed UI, put filters and URL state in `Data` `queryParams`, render
the result table/records from the `Data` procedure, and refresh the visible
query through the mutation primitive:

- Use [`Form`](./form.md) for inserts, updates, upserts, bulk edits, validation,
  and any flow where the user edits row fields. Choose `Form.Insert`,
  `Form.Update`, or `Form.Merge` for the corresponding row mutation.
- Use [`ActionButton`](./action_button.md) / `ActionMenuItem` for command-style
  server mutations such as delete, approve, sync, send, archive, or recalculate.
  They refetch enclosing `Data` by default.
- Use raw event handlers for local UI state. If an event handler performs a
  server mutation directly, call `s.refetch()` when the visible query must
  refresh.

Do not hand-roll `Button` + `s.tryServer` + loading/error scalars for ordinary
forms or command buttons when `Form` or `ActionButton` fits.

## Basic Usage

```tsx
<Data procedure={(s) => {
  s.defTable("users", sql`select * from db.users`);
}}>
  <Each table="users" recordName="user">
    <p>{sql`user.name`}</p>
  </Each>
</Data>
```

Data automatically:
- Executes the procedure on the server (single roundtrip)
- Shows a loading spinner while fetching
- Shows an error alert if the fetch fails
- Re-fetches when `s.refetch()` is called from any event handler

## Common Props

Use the exported TypeScript props for the full `Data` contract. The props
agents usually need are:

- `procedure` to define fetched scalars, records, and tables.
- `local` for client-only UI state with no server call.
- `queryParams` for URL-synced filters and route state.
- `watch` / `autoWatch` / `debounce` for refetch behavior.
- `noRefetch` when parent UI state must survive global `s.refetch()`.
- `pendingFallback`, `errorFallback`, `statusScalar`, `hasDataScalar`, and
  `errorRecord` when custom loading/error UI is needed.

## Server Data Fetching

By default, Data forces all database access to run on the server via a single roundtrip. You don't need to do anything special — just write your queries:

```tsx
<Data procedure={(s) => {
  s.defRecord("user", sql`select * from db.users where id = ${userId}`);
  s.defTable("orders", sql`select * from db.orders where user_id = ${userId}`);
  s.defScalar("total", sql`(select sum(amount) from db.orders where user_id = ${userId})`);
}}>
  <h2>{sql`user.name`}</h2>
  <p>Total: {sql`total`}</p>
  <Each table="orders" recordName="order">
    <p>{sql`order.description`} — {sql`order.amount`}</p>
  </Each>
</Data>
```

## Automatic Refetch

When any event handler calls `s.refetch()`, all non-local Data components re-fetch their data:

```tsx
<Data procedure={(s) => {
  s.defTable("todos", sql`select * from db.todos`);
}}>
  <Each table="todos" recordName="todo">
    <p>{sql`todo.title`}</p>
  </Each>
  <Button onClick={(s) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`insert into db.todos (title) values ('New todo')`);
        s.commitTransaction();
        s.refetch();
      },
    });
  }}>Add Todo</Button>
</Data>
```

The `s.refetch()` call increments a global refetch key that all Data components watch. This means adding a todo in one part of the page will refresh data everywhere.

Prefer `Form` for the add/edit flow above in production UI. Prefer
`ActionButton` when the button is a command rather than a field-editing form.

Set `noRefetch` to opt out of global refetch for a specific Data component.

## Query Parameters

Use `queryParams` to bind URL query parameters to scalars:

```tsx
<Data
  queryParams={{
    search: { default: sql.lit``, type: "String" },
    page: { default: sql`1`, type: "BigInt" },
  }}
  procedure={(s) => {
    s.defTable("results", sql`
      select * from db.items
      where name like '%' || search || '%'
      limit 20 offset (page - 1) * 20
    `);
    s.defScalar("total", sql`(select count(*) from db.items where name like '%' || search || '%')`);
  }}
>
  <Input
    value={sql`search`}
    onInput={(s) => s.setScalar("search", sql`target_value`)}
    placeholder="Search..."
  />
  <Each table="results" recordName="item">
    <p>{sql`item.name`}</p>
  </Each>
</Data>
```

Each parameter uses `default` for its initial value. Do not use `expr` here;
`expr` is for procedure-scope scalar definitions. To specify the type
explicitly:

```tsx
import type { DataQueryParamConfig } from "std/data";

const recordParam = {
  default: sql`0`,
  type: "BigInt",
} satisfies DataQueryParamConfig;

queryParams={{
  id: recordParam,
  search: { default: sql.lit``, type: "String" },
}}
```

Query parameters are synced with the browser URL, so users can bookmark or share filtered views.

## Local State

Use `local: true` for client-only state that doesn't need server data:

```tsx
<Data local procedure={(s) => {
  s.defScalar("editing", sql`false`);
  s.defScalar("tab", sql.lit`details`);
}}>
  <Button onClick={(s) => s.setScalar("editing", sql`not editing`)}>
    Toggle Edit
  </Button>
</Data>
```

Local Data:
- Runs entirely on the client (no server roundtrip)
- Does not respond to `s.refetch()`
- Does not show pending/error fallbacks
- Useful for UI toggles, editing state, tab selection, etc.

## Fallback UIs

By default, Data shows:
- A `CircularProgress` spinner while loading
- An `Alert` with "Unable to load data" on error

Customize or disable them:

```tsx
// Custom fallbacks
<Data
  pendingFallback={<p>Loading...</p>}
  errorFallback={<p>Something went wrong</p>}
  procedure={(s) => { /* ... */ }}
>
  {/* content */}
</Data>

// Disable fallbacks entirely
<Data
  pendingFallback={null}
  errorFallback={null}
  procedure={(s) => { /* ... */ }}
>
  {/* content */}
</Data>
```

## Status Tracking

Use `statusScalar` to track the fetch lifecycle:

```tsx
<Data
  statusScalar="fetch_status"
  hasDataScalar="has_data"
  procedure={(s) => { /* ... */ }}
>
  <Show when={sql`fetch_status = 'requested'`}>
    <p>Refreshing...</p>
  </Show>
  {/* content */}
</Data>
```

Status values:
- `'received'` — Data loaded successfully
- `'requested'` — Fetch in progress
- `'delayed'` — Fetch taking longer than expected
- `'fallback_triggered'` — Fallback UI is showing
- `'failed'` — Fetch failed
- `'disallowed'` — The `allow` condition denied the fetch

## Watch

The `watch` prop triggers a re-fetch when the watched expression changes:

```tsx
<Data
  watch={[sql`selected_category`]}
  procedure={(s) => {
    s.defTable("items", sql`select * from db.items where category = selected_category`);
  }}
>
  <Each table="items" recordName="item">
    <p>{sql`item.name`}</p>
  </Each>
</Data>
```

This is combined with the global refetch watch — both will trigger a re-fetch.

## Debounce

Use `debounce` for search-as-you-type patterns to avoid fetching on every keystroke:

```tsx
<Data
  watch={[sql`search_input`]}
  debounce={{
    wait: sql`300`,
  }}
  procedure={(s) => {
    s.defScalar("search_input", sql.lit``);
    s.defTable("results", sql`
      select * from db.items
      where name like '%' || search_input || '%'
    `);
  }}
>
  <Input
    value={sql`search_input`}
    onInput={(s) => s.setScalar("search_input", sql`target_value`)}
    placeholder="Search"
  />
  {/* results content */}
</Data>
```

## Nesting

Data components can be nested. Child Data procedures can read parent state:

```tsx
<Data procedure={(s) => {
  s.defScalar("selected_id", sql`null`);
  s.defTable("items", sql`select * from db.items`);
}}>
  <Each table="items" recordName="item">
    <Button onClick={(s) => s.setScalar("selected_id", sql`item.id`)}>
      {sql`item.name`}
    </Button>
  </Each>

  <Data
    watch={[sql`selected_id`]}
    procedure={(s) => {
      s.defRecord("detail", sql`select * from db.items where id = selected_id`);
    }}
  >
    <Show when={sql`detail.id is not null`}>
      <h3>{sql`detail.name`}</h3>
      <p>{sql`detail.description`}</p>
    </Show>
  </Data>
</Data>
```

## State Modification Rules

Understanding when and where you can modify state is critical:

- **Child Data procedures CANNOT modify parent Data state** — A nested Data procedure runs in isolation
- **Event handlers CAN modify any ancestor Data state** — onClick, onInput, onMount, etc. can modify state defined in any parent Data component

```tsx
// Event handlers CAN modify parent state
<Data procedure={(s) => {
  s.defScalar("selected_id", sql`null`);
}}>
  <Button onClick={(s) => s.setScalar("selected_id", sql`item.id`)}>
    Select
  </Button>

  {/* Child Data CAN READ parent state */}
  <Data
    watch={[sql`selected_id`]}
    procedure={(s) => {
      s.defTable("details", sql`select * from db.items where id = selected_id`);
    }}
  >
    {/* ... */}
  </Data>
</Data>

// Child Data procedure CANNOT modify parent state
<Data procedure={(s) => { s.defScalar("x", sql`null`); }}>
  <Data procedure={(s) => {
    // This will NOT work
    s.setScalar("x", sql`1`);
  }}>
    {/* ... */}
  </Data>
</Data>
```

### The Solution Pattern

If you need to set parent state based on child data, use an event handler:

```tsx
<Data procedure={(s) => {
  s.defScalar("selected_id", sql`null`);
}}>
  <div onMount={(s) => {
    s.if(sql`selected_id is null`, (s) => {
      s.setScalar("selected_id", sql`(select id from db.items limit 1)`);
    });
  }}>
    {/* content */}
  </div>
</Data>
```

## Common Patterns

### Dashboard Pattern

Use `Data` with grid layout for dashboards that combine stats, charts, and tables:

```tsx
import { Data } from "std/data";
import { StatRow } from "components/stat_row";
import { DataTable } from "components/data_table";
import { BarChart } from "vis/bar_charts";

function Dashboard() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4">
      <StatRow
        className="col-span-12"
        header="Key Metrics"
        stats={[
          { title: sql.lit`Orders`, value: sql`(select count(*) from db.orders)` },
          { title: sql.lit`Revenue`, value: sql`(select sum(total) from db.orders)` },
        ]}
      />
      <BarChart
        className="col-span-12 md:col-span-6"
        query={sql`select name, sum(total) as revenue from db.orders group by name`}
        width={600} height={300}
      >
        <BarChart.XAxisLabels columnName="name" />
        <BarChart.YAxisLabels />
        <BarChart.Bar columnName="revenue" fill="#3b82f6" />
      </BarChart>
      <DataTable
        className="col-span-12"
        query={sql`select * from db.orders order by created_at desc limit 10`}
        primaryTable="orders"
        columns={(b) => { b.field("customer_id"); b.field("order_date"); }}
      />
    </div>
  );
}
```

See [Dashboards](./dashboards.md) and [Reporting](./reporting.md) for more dashboard and reporting patterns.

## Complete Examples

### Search Page

```tsx
function SearchPage() {
  return (
    <Data
      queryParams={{ q: { default: sql.lit``, type: "String" } }}
      debounce={{ wait: sql`300` }}
      procedure={(s) => {
        s.defTable("results", sql`
          select * from db.products
          where name like '%' || q || '%'
          order by name
          limit 50
        `);
        s.defScalar("result_count", sql`(select count(*) from results)`);
      }}
    >
      <Input
        value={sql`q`}
        onInput={(s) => s.setScalar("q", sql`target_value`)}
        placeholder="Search products..."
      />
      <p>{sql`result_count`} results</p>
      <Each table="results" recordName="product">
        <Card>
          <h3>{sql`product.name`}</h3>
          <p>{sql`product.description`}</p>
        </Card>
      </Each>
    </Data>
  );
}
```

### Detail Page

```tsx
function UserDetailPage({ userId }: { userId: NumericExpr }) {
  return (
    <Data procedure={(s) => {
      s.defRecord("user", sql`select * from db.users where id = ${userId}`);
      s.defTable("orders", sql`select * from db.orders where user_id = ${userId} order by created_at desc`);
    }}>
      <h1>{sql`user.name`}</h1>
      <p>{sql`user.email`}</p>
      <h2>Orders</h2>
      <Each table="orders" recordName="order">
        <p>{sql`order.description`} — {sql`order.total`}</p>
      </Each>
    </Data>
  );
}
```
