---
title: UI Overview
description: Introduction to Yolm UI - TSX-like components that generate UI at generation time with automatic single-roundtrip data access.
tags:
  - ui
  - overview
  - components
---

# UI Overview

In Yolm, UIs are defined in apps using a TSX-like syntax. Components run at
generation time and produce a node tree that becomes the runtime UI. Runtime
behavior is expressed with SQL expressions and Yolm statements, not JavaScript.

```typescript
system.app({
  domain: "test.yolm.app",
  ui: "Hello World"
})
```

## Generation Time vs Runtime

- Component functions run at generation time to build the node tree. They do
  not re-run when data changes, so TypeScript values (strings, arrays, objects,
  closures) are fixed once the app is generated. Some parents also walk their
  children in an extra generation-time [gather pass](./ictx.md#gather-phase),
  so keep component functions free of side effects.
- Anything that changes at runtime is a SQL expression (`sql\`...\``) over
  state: `db.*` tables, `ui.*` state, or procedure-local scalars and tables.
- Use `<Each>` to iterate runtime tables. Mapping a TypeScript array is fine
  for fixed generation-time lists. Neither needs a `key` prop.
- Pages render on the server first, then subsequent navigation renders in the
  browser. Components are isomorphic; you do not choose server vs client
  rendering.
- Data access in one render is batched into a single roundtrip automatically.

## State Scopes

| Scope | Lifetime | Declared by |
| --- | --- | --- |
| `db.*` | Persistent database | `core.tsx` schema |
| `ui.*` | In-memory UI state for the mounted tree | `Data` / `State` procedures, `queryParams`, `useGlobalState` |
| procedure-local | One execution of an event handler or procedure | `s.defScalar` / `s.defTable` inside that handler |

### UI State Scope

`ui.*` state declared by a `Data` (or `State`) node is visible only to that
node and its descendants, including nested `Route` nodes. Sibling subtrees
cannot read it; declare shared state on a common ancestor, or use
[`useGlobalState`](./global_nodes_states.md) for app-wide state.

- Child `Data` procedures can read ancestor state but cannot modify it.
- Event handlers (including `onMount`) can modify any ancestor state.
- `Data local` declares client-only state; non-local `Data` runs its procedure
  on the server and can read `db.*`. See [Data](./data.md#local-state).

### Name Resolution

Unqualified names resolve in this order:

- In UI expressions (`Data` procedures, props, children): `ui`, then `db`.
- In event handlers and `server`/`tryServer` bodies: procedure-local, then
  `ui`, then `db`.

Write bare names (`sql\`search\``, `s.setScalar("search", ...)`) for UI state in
normal code. Write `ui.name` when a procedure-local declaration has the same
name, or when you want a server body to make the UI source explicit. Always
write `db.` for database tables so a UI table of the same name cannot capture
the reference.

```tsx
<Button
  onClick={(s) => {
    s.defScalar("count", sql`(select count(*) from selected_rows)`);
    s.setScalar("ui.count", sql`count`); // ui.count is the UI scalar, count is local
  }}
/>
```

## Static vs SQL Props

- `className`, `color`, `variant`, `size`, and most configuration props are
  static generation-time values. Choose among static variants at runtime with
  `Show` or `Switch`/`Match`.
- Content children, `value`, `when`, `style` values, and props typed as `Sql`
  or `...Expr` accept SQL expressions. `sx` is compiled to a static CSS class
  and does not accept SQL.
- Runtime-conditional classes use `dynamicClassNames` (Tailwind) or
  `dynamicClass`/`dynamicClasses` (raw class names). See
  [Styling](./styling.md#dynamic-classes).

## Derived and Display Values

Compute display values in the query that loads the data: formatted labels,
totals, status colors, joined names, and flags belong in `Data` procedures,
SQL expressions, or [datagrid virtual columns](./datagrid_virtual_columns.md).
UI work never requires adding `db` fields for derived or display values; add a
column only when the value is real persistent business data.

## Mutations and Refresh

- Field editing (insert, update, upsert): [`Form`](./form.md).
- Commands (delete, approve, sync, archive): [`ActionButton`](./action_button.md).
- After a mutation, `s.refetch()` re-runs every non-local `Data` that has not
  set `noRefetch`. `Form` and `ActionButton` handle this for you. There is no
  `refresh_key` scalar to increment.

See [Data, Form, and ActionButton](./data_vs_form.md) for the decision table.

## Styling

Use `className` with Tailwind classes for static styling, `sx` for static style
objects, theme tokens, and selectors, and `style` for runtime SQL values. See
[Styling](./styling.md) and [Theming](./theming.md).

## URL and Query Parameters

Route parameters use `{name:type}` segments and are available as scalars:

```tsx
<Route path="/users/{user_id:id}">
  {/* user_id is available as a scalar */}
</Route>
```

URL query parameters are declared with `Data` `queryParams` (use `default`,
not `expr`):

```tsx
import { Data } from "std/data";

<Data
  queryParams={{
    q: { default: sql.lit``, type: "String" },
    page: { default: sql`1`, type: "BigInt" },
  }}
  procedure={(s) => {
    s.defTable("results", sql`select * from db.items where name like '%' || q || '%'`);
  }}
>
  {/* children can use q, page, and results */}
</Data>
```

Every write to a query param updates the URL (replace by default; declare
`history: "push"` for navigation-like state). Links back to a list should set
`backLink` so filters and scroll are restored. See
[Routing](./routing.md#returning-to-a-list).

## Common Mistakes

These apply to every component; component pages list only their own pitfalls.

- Adding React `key` props, hooks, or component-level JavaScript state. Use
  `Data`, `Each`, `Show`, and Yolm statements.
- Passing SQL to `color`, `variant`, `size`, or other static props.
- Building `className` from SQL or template strings; use `dynamicClassNames`.
- Filtering, sorting, or formatting rows in TypeScript instead of SQL.
- Reading `ui.*` state from a sibling subtree that did not declare it.
- Hand-rolling `Button` + `s.tryServer` + loading/error scalars for ordinary
  forms or commands instead of `Form` or `ActionButton`.
- Incrementing a made-up `refresh_key` instead of calling `s.refetch()`.
- Adding `db` columns to hold display or derived values.
- Using props or components that are not in the docs or exported types.
