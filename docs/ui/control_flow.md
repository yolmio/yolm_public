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
| Local UI state | `Data local` | [Data](./data.md#local-state) |
| React-like subscriptions | `Listen` or `Effect` | exported `std/ui` types |
| Cross-page node/state | `useGlobalNode` / `useGlobalState` | [Global nodes & states](./global_nodes_states.md) |
| Permission-gated rendering | `Authorize` | exported `std/ui` types |
| URL query state | `Data` `queryParams` | [Routing](./routing.md#query-parameters) |
| Return to a list with its filters | `backLink` on `Link`/`Button` | [Routing](./routing.md#returning-to-a-list) |
| Dynamic or recursive trees | `DynamicNode`, `Recursive`, `Recurse`, `Mode` | exported `std/ui` types |

## Data

`Data` declares UI state and/or fetches server data for its descendants. Use
`local` for client-only state; omit it when the procedure queries `db.*`. State
is visible only inside the declaring `Data`; see
[UI state scope](./overview.md#ui-state-scope).

```tsx
<Data procedure={(s) => {
  s.defTable("items", sql`select id, name from db.items order by name`);
}}>
  <Each table="items" recordName="item">
    <div>{sql`item.name`}</div>
  </Each>
</Data>
```

Use `watch`/`debounce` to re-run on ancestor state changes, and `statusScalar`,
`hasDataScalar`, and `errorRecord` for loading or error UI. See
[Data](./data.md).

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

These are lower-level primitives, not React hooks:

- `State` is the node `Data` is built on. Solution code declares local state
  with `Data local`; use `State` directly only in reusable primitives that need
  its exact props.
- `Listen` runs an event handler when a query's result changes.
- `Effect` runs a generated effect in the supported Yolm statement scope.

`Authorize` gates a subtree using the current permission context.
`QueryParams` is the low-level URL-parameter node behind `Data` `queryParams`.
`DynamicNode` chooses a node from a runtime node value, while `Recursive`,
`Recurse`, and `Mode` support recursive or mode-dependent generated trees.

## Common Mistakes

- Filtering UI rows with TypeScript instead of SQL.
- Putting persistent business state in `Data local`.
- Re-querying manually when `watch` or `s.refetch()` is the intended path.
- Reading state declared in a sibling subtree; declare it on a common ancestor.
- Using routes for modal/local state or local state for URL-addressable pages.
