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
  - ui/data_vs_form.md
  - ui/control_flow.md
---

# Data Component

`Data` declares UI state and loads query results for its children. Its
procedure runs on the server in the page's single roundtrip (or on the client
with `local`). Edits go through `Form` (for example `Form.Update`), commands
through `ActionButton`, and both refresh visible `Data` through `s.refetch()`.

```tsx
import { Data } from "std/data";
```

## Basic Usage

```tsx
<Data procedure={(s) => {
  s.defRecord("user_record", sql`select * from db.users where id = ${userId}`);
  s.defTable("orders", sql`
    select o.id, o.description, o.amount, c.name as carrier_name
    from db.orders o left join db.carriers c on c.id = o.carrier
    where o.user_id = ${userId}
    order by o.created_at desc
  `);
  s.defScalar("total", sql`(select sum(amount) from orders)`);
}}>
  <h2>{sql`user_record.name`}</h2>
  <p>Total: {sql`total`}</p>
  <Each table="orders" recordName="order">
    <p>{sql`order.description`} ({sql`order.carrier_name`})</p>
  </Each>
</Data>
```

Everything a `Data` procedure declares is `ui.*` state visible to that `Data`
and its descendants only; see [UI state scope](./overview.md#ui-state-scope).
Select display columns (joins, labels, totals) in the procedure rather than
nesting a `Data` per row; see
[Derived and display values](./overview.md#derived-and-display-values).

By default `Data`:

- runs its procedure on the server, batched into one roundtrip with the rest of
  the page;
- shows a `CircularProgress` while pending and an `Alert` ("Unable to load
  data") on failure;
- re-runs when any event handler calls `s.refetch()`.

## Props That Matter

Use `DataProps` in `std/data` for the full contract. The props you usually
need:

- `procedure`: declares scalars, records, and tables (`s.defScalar`,
  `s.defRecord`, `s.defTable`).
- `local`: client-only state; no server call, no refetch, no fallbacks.
- `queryParams`: URL-synced scalars.
- `watch`, `autoWatch`, `debounce`: re-run triggers.
- `noRefetch`: ignore global `s.refetch()`, for example to keep parent UI state.
- `pendingFallback`, `errorFallback`: custom or `null` fallbacks.
- `statusScalar`, `hasDataScalar`, `errorRecord`: expose fetch status to
  children.

## Refresh After Mutations

`s.refetch()` increments the global `global_refetch_key` scalar, which every
non-local `Data` without `noRefetch` watches. There is no other refresh key to
manage.

- Field edits: [`Form`](./form.md) with `Form.Insert`, `Form.Update`, or
  `Form.Merge`, which refetch on success by default (`refetchOnSuccess`).
- Commands: [`ActionButton`](./action_button.md) / `ActionMenuItem`, which
  refetch on success by default.
- A raw event handler that performs server work must call `s.refetch()` itself.

```tsx
<Data procedure={(s) => {
  s.defRecord("user_record", sql`select * from db.users where id = ${userId}`);
}}>
  <h1>{sql`user_record.name`}</h1>
  <Form>
    <Form.Update table="users" where={sql`id = ${userId}`}>
      <Form.Field field="name" />
      <Form.SubmitButton>Save</Form.SubmitButton>
    </Form.Update>
  </Form>
</Data>
```

See [Data, Form, and ActionButton](./data_vs_form.md) for the decision table.

## Query Parameters

`queryParams` declares scalars synced with the URL, so filtered views can be
bookmarked and shared. Each entry is a default `Sql` expression (type
inferred) or `{ default, type, history }`. Use `default`, not `expr`; `expr` is
for procedure-scope scalar definitions.

Every write to a query-param scalar (`s.setScalar`, `bindScalar`,
`s.setQueryParam`) updates the URL. `history` is `"replace"` (default, updates
the current entry; right for filters, search, sort, and paging) or `"push"`
(adds an entry so Back steps through changes; for navigation-like state such
as page-like tabs). Keep list filters here rather than in local state so a
[`backLink`](./routing.md#returning-to-a-list) from a detail page can restore
them.

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
      order by name
      limit 20 offset (page - 1) * 20
    `);
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

`setScalar` on a query param updates the URL, so the example above needs no
`setQueryParam`.

Use `DataQueryParamConfig` from `std/data` to type a reusable entry. The
low-level `QueryParams` node and `useQueryParams` hook take an array form and
are for package primitives; see [ICtx](./ictx.md#low-level-stdui-hooks).

## Local State

`local` declares client-only UI state: no server roundtrip, no `s.refetch()`
response, and no pending/error fallbacks. Use it for toggles, selected tabs,
and editing flags; omit `local` when the procedure queries `db.*`.

```tsx
<Data local procedure={(s) => {
  s.defScalar("editing", sql`false`);
}}>
  <Button onClick={(s) => s.setScalar("editing", sql`not editing`)}>
    Toggle Edit
  </Button>
</Data>
```

`Data local` is the preferred way to declare local state in solution code. The
lower-level `State` node from `std/ui` (which `Data` wraps) and
`useGlobalState` (for cross-page state, see
[Global nodes & states](./global_nodes_states.md)) follow the same scoping rules.

## Watch and Debounce

`watch` re-runs the procedure when any listed expression changes, in addition
to the global refetch. Watched scalars must come from an ancestor. Add
`debounce` for search-as-you-type:

```tsx
<Data local procedure={(s) => s.defScalar("search_input", sql.lit``)}>
  <Input
    value={sql`search_input`}
    onInput={(s) => s.setScalar("search_input", sql`target_value`)}
    placeholder="Search"
  />
  <Data
    watch={[sql`search_input`]}
    debounce={{ wait: sql`300` }}
    procedure={(s) => {
      s.defTable("results", sql`
        select * from db.items where name like '%' || search_input || '%'
      `);
    }}
  >
    <Each table="results" recordName="item">
      <p>{sql`item.name`}</p>
    </Each>
  </Data>
</Data>
```

## Nesting and State Modification

Nested `Data` procedures can read ancestor state but cannot modify it. Event
handlers, including `onMount`, can modify state declared by any ancestor.

```tsx
<Data procedure={(s) => {
  s.defScalar("selected_id", sql`null`);
  s.defTable("items", sql`select id, name from db.items order by name`);
}}>
  <div onMount={(s) => {
    s.if(sql`selected_id is null`, (s) => {
      s.setScalar("selected_id", sql`(select id from items limit 1)`);
    });
  }} />
  <Each table="items" recordName="item">
    <Button onClick={(s) => s.setScalar("selected_id", sql`item.id`)}>
      {sql`item.name`}
    </Button>
  </Each>
  <Data
    watch={[sql`selected_id`]}
    procedure={(s) => {
      // Reads the parent's selected_id; calling s.setScalar("selected_id", ...) here fails.
      s.defRecord("detail", sql`select * from db.items where id = selected_id`);
    }}
  >
    <Show when={sql`detail.id is not null`}>
      <h3>{sql`detail.name`}</h3>
    </Show>
  </Data>
</Data>
```

## Loading and Errors

Customize or disable the fallbacks. For dense dashboards and cards, prefer a
`Skeleton` (from `components/skeleton`) shaped like the content over the
default spinner:

```tsx
<Data
  pendingFallback={<Skeleton variant="rectangular" className="h-24" />}
  errorFallback={<Alert color="danger">Could not load orders</Alert>}
  procedure={(s) => { /* ... */ }}
>
  {/* content */}
</Data>
```

Pass `null` to disable a fallback. To keep stale content visible while
refreshing, use `statusScalar` / `hasDataScalar`:

```tsx
<Data statusScalar="fetch_status" hasDataScalar="has_data" procedure={(s) => { /* ... */ }}>
  <Show when={sql`fetch_status = 'requested'`}>
    <p>Refreshing...</p>
  </Show>
</Data>
```

Status values (`enums.sys_state_status`): `received`, `requested`, `delayed`
(waiting on debounce), `fallback_triggered`, `failed`, and `disallowed`. `errorRecord` names a record with `type`,
`message`, and `description` for custom error UI.

For dashboards composed from `Data`, see [Dashboards](./dashboards.md) and
[Reporting](./reporting.md).
