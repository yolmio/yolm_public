---
title: Control Flow Components
description: Decision guide for Yolm UI control primitives including Data, Each, Show, Switch, Match, Route, Routes, AppRoutes, and EventHandlers.
tags:
  - ui
  - components
  - state
  - control-flow
  - routing
related:
  - ui/data.md
  - ui/event_handlers.md
  - ui/routing.md
  - concepts/differences_from_react.md
---

# Control Flow Components

Use this page to choose the primitive. For detailed signatures and options,
read the linked docs or exported TypeScript types.

```tsx
import {
  Authorize, Each, Effect, EventHandlers, Match, QueryParams, Route,
  Routes, Show, State, Switch,
} from "std/ui";
import { Data } from "std/data";
```

## Choose The Primitive

| Need | Use | Read |
| --- | --- | --- |
| Query server data or define UI state | `Data` | [Data Component](./data.md) |
| Iterate rows from a UI table | `Each` | this page / exported types |
| Conditionally render one branch | `Show` | this page / exported types |
| Choose among multiple branches | `Switch` + `Match` | this page / exported types |
| URL-based UI | `Routes`, `Route`, `AppRoutes` | [Routing](./routing.md) |
| Global keyboard/mouse handlers | `EventHandlers` | [Event Handlers](./event_handlers.md) |
| Local UI state | `State` or `Data local` | [Data](./data.md) |
| React-like subscriptions | `Listen` or `Effect` | exported `std/ui` types |
| Cross-page node/state | `useGlobalNode` / `useGlobalState` | [Global nodes & states](./global_nodes_states.md) |
| Permission-gated rendering | `Authorize` | exported `std/ui` types |
| URL query state | `QueryParams` / `useQueryParams` | [Routing](./routing.md) |
| Dynamic or recursive trees | `DynamicNode`, `Recursive`, `Recurse`, `Mode` | exported `std/ui` types |

## Data

`Data` creates in-memory UI state and/or fetches server data. Use `local` for
client-only state; omit it when the procedure queries `db.*`.

```tsx
<Data
  watch={[sql`search_text`]}
  debounce={{ wait: sql`300` }}
  procedure={(s) => {
    s.defScalar("search_text", sql.lit``);
    s.defTable("items", sql`
      select * from db.items
      where name like '%' || search_text || '%'
    `);
  }}
>
  <Each table="items" recordName="item">
    <div>{sql`item.name`}</div>
  </Each>
</Data>
```

Use `statusScalar`, `hasDataScalar`, and `errorRecord` when the UI needs
loading or error states.

## Each

`Each` renders once per row in a UI table.

```tsx
<Each table="orders" recordName="order">
  <div>{sql`order.order_number`}</div>
</Each>
```

Use `orderBy`, `where`, or a pre-filtered `Data` query rather than filtering in
TypeScript.

## Show

`Show` conditionally renders children from a SQL boolean expression.

```tsx
<Show when={sql`status = 'failed'`}>
  <Alert color="danger">{sql`state_error.message`}</Alert>
</Show>
```

## Switch And Match

Use `Switch`/`Match` when one of several SQL conditions should render.

```tsx
<Switch>
  <Match when={sql`status = 'requested'`}><Skeleton /></Match>
  <Match when={sql`status = 'failed'`}><Alert>Error</Alert></Match>
  <Match when={sql.true}><Results /></Match>
</Switch>
```

## Routes

Use routes for URL state, not `Show` flags.

```tsx
<Routes>
  <Route path="/">
    <Dashboard />
  </Route>
  <Route path="/orders/{order_id:id}">
    <OrderPage />
  </Route>
</Routes>
```

See [Routing](./routing.md) for route params, wrappers, and nested layouts.

## EventHandlers

Use `EventHandlers` for app-level keyboard or pointer handlers. Inside event
procedures, read event values through SQL expressions such as `event.key`,
`target_value`, and `target_checked`.

```tsx
<EventHandlers
  document={{
    keydown: (s) => {
      s.if(sql`event.key = 'Escape'`, (s) => {
        s.setScalar("dialog_open", sql.false);
      });
    },
  }}
/>
```

## State, Listen, and Effects

Yolm provides `State`, `Listen`, and `Effect` primitives, but they are not
React hooks. `State` defines page-local UI state, `Listen` reacts to a state
change, and `Effect` runs a generated effect in the supported Yolm statement
scope. Use `Data` for query-backed state and `Data local` for ordinary local
state; use these lower-level primitives when a reusable component needs their
specific lifecycle behavior.

`Authorize` gates a subtree using the current permission context. `QueryParams`
declares URL parameters in the page tree. `DynamicNode` chooses a node from a
runtime node value, while `Recursive`, `Recurse`, and `Mode` support recursive
or mode-dependent generated trees.

## Common Mistakes

- Using React state/effect hooks or React `key` props; use the Yolm primitives
  above when their state or effect behavior is required.
- Filtering UI rows with TypeScript instead of SQL.
- Putting persistent business state in `Data local`.
- Re-querying manually when `watch` or `s.refetch()` is the intended path.
- Using routes for modal/local state or local state for URL-addressable pages.
