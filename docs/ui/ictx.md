---
title: ICtx — In-Tree Component Context
description: Yolm's component-context system for passing values down a render tree without prop-drilling.
tags:
  - ui
  - context
  - components
---

# ICtx — In-Tree Component Context

ICtx ("inline context") is Yolm's equivalent of React context. A
component publishes a value with `addCtx(...)`; descendant components
read it back with `useICtx(key)` (required) or
`useOptionalICtx(key)` (returns `undefined` if not provided).

Use ICtx for:

- Layout state that descendants need to react to (`Sidebar`'s
  presence, `ButtonGroup`'s default variant/size).
- Form-style integrations where descendant controls write to a shared
  model (`Form` -> `Form.Field` -> `Input`).
- Cross-cutting style tokens (harmonize colors, default sizes).

## Defining a key

```typescript
import { createICtxKey } from "std/ui";
import type { ContextInstance, ICtxKey } from "std/ui";

interface MyCtx {
  density: "compact" | "comfortable";
}

export const MyICtxKey: ICtxKey<MyCtx> = createICtxKey<MyCtx>("MyICtx");

// A class is the idiomatic provider — it carries the data and
// declares which ICtxKey it implements.
export class MyCtxProvider implements ContextInstance, MyCtx {
  implementICtxs = [MyICtxKey];
  constructor(public density: "compact" | "comfortable") {}
}
```

## Providing and consuming

```typescript
import { addCtx, useICtx, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";

// Producer — call addCtx inside the component before returning the
// subtree that should see it.
function Density(
  { density, children }: { density: "compact" | "comfortable"; children: Node },
) {
  addCtx(new MyCtxProvider(density));
  return <>{children}</>;
}

// Consumer (required — throws if no provider in scope)
function ConsumerA() {
  const ctx = useICtx(MyICtxKey);
  return /* ... use ctx.density ... */;
}

// Consumer (optional — returns undefined if no provider in scope)
function ConsumerB() {
  const maybe = useOptionalICtx(MyICtxKey);
  return /* ... maybe?.density ... */;
}
```

## Gather phase

Some parents need to know what their descendants will request before they
render. `Form`, menus, `WorkQueue`, and toolbars call
`gatherChildrenContextInfo(children)` (from `std/ui`), which runs the child
component functions once in a `"gather"` pass that produces no output, so
children can register context (form fields, toolbar state, menu nodes) with
the parent. The parent then renders normally in the `"render"` phase.

Consequences for component authors:

- A component function may run more than once at generation time. Keep it free
  of side effects other than `addCtx`/ICtx registration.
- `usePhase()` returns `"gather"` or `"render"`; check it only when a component
  must register something during gather (as `useToolbarState` does) or must
  skip work that only makes sense while rendering.

## Built-in ICtx keys

`std/ictx` exports the keys produced by Yolm's standard components.
Two you may need to consume directly:

### `FormICtxKey`

Provided by `Form`. Exposes the surrounding form's submission state,
touched/error helpers, undo/redo handles, and the per-table
(`form.table(name)`) and per-record (`form.record(name)`) accessors.
Consumed by every custom form control that integrates with
`Form.Field`.

```typescript
import { FormICtxKey } from "std/ictx";
import { useICtx } from "std/ui";

function CustomBulkResetButton() {
  const form = useICtx(FormICtxKey);
  return (
    <Button
      variant="plain"
      onClick={(s) => {
        form.resetErrorState(s);
        form.setTouchedNone(s);
      }}
    >
      Reset
    </Button>
  );
}
```

### `SidebarPresenceICtxKey`

Provided by `Sidebar`. Lets descendants detect that they are
rendering inside a sidebar (used by some components to adjust spacing
or auto-trigger behaviour).

```typescript
import { SidebarPresenceICtxKey } from "std/ictx";
import { useOptionalICtx } from "std/ui";

const sidebar = useOptionalICtx(SidebarPresenceICtxKey);
if (sidebar?.presence) {
  // we're inside a sidebar
}
```

Use `useOptionalICtx` here — components that depend on a sidebar
should still render outside one.

### Other built-in keys and helpers

Advanced components sometimes consume these keys directly:

| Export | Use |
|--------|-----|
| `DynamicDatagridICtxKey` | Context for the active dynamic datagrid: selected-row query/state, columns, and toolbar change triggers. Only consume inside `Datagrid`/`DatagridPage`. |
| `LogoutICtxKey` | Auth providers expose `logout(s)` here so navbars and app shells can trigger sign-out without knowing the auth implementation. |
| `useToolbarState(fn)` | Registers state on the enclosing toolbar during the [gather phase](#gather-phase). Use from toolbar items that need backing state mounted at toolbar level. |

`components/menu` also exports backward-compatible dropdown aliases:
`useDropdownNode` is an alias for `useMenuNode`, and `useDropdownState` is an
alias for `useMenuState`. Prefer the menu names in new code unless maintaining
older dropdown modules.

## Low-Level `std/ui` Hooks

Most solution code uses components directly. These hooks are for reusable page
or component primitives:

| Hook | Description |
|------|-------------|
| `useRoute(pathOrOptions)` | Wraps the current component in a `Route`. Accepts a string path or `{ path, exact? }`. |
| `useQueryParams(params)` | Wraps the current component in the low-level `QueryParams` node; `params` is an array of `{ name, type, default }` declarations. Solution code should use `Data` `queryParams` instead, which is a record map such as `{ search: { type: "String", default: sql.lit\`\` } }` and can infer types (see [Routing](./routing.md)). |
| `useUniqueId()` | Returns a stable unique SQL id expression for the current component, with `Each` and datagrid row context included when present. |
| `usePhase()` | Returns `"gather"` or `"render"`; see [Gather phase](#gather-phase). |

## See also

- [Form](./form.md) — primary consumer of `FormICtxKey`.
- [Sidebar](./sidebar.md) — produces `SidebarPresenceICtxKey`.
- [Differences from React](../concepts/differences_from_react.md) — how
  ICtx differs from React context.
