---
title: Global nodes & states
description: Register UI nodes and state that live outside the page tree and are available from any page.
tags:
  - ui
  - global-nodes
  - global-states
  - cross-page
---

# Global nodes & states

Most UI in Yolm is scoped to the page being viewed. Sometimes you need
state or a piece of UI that lives **above** the page tree so it can be
shown from any page — a cross-page snackbar, a global confirmation
dialog, or a state that survives navigation.

`useGlobalNode(...)` and `useGlobalState(...)` register these once per
app and return the statements needed to interact with them.

## Global states

`useGlobalState` is the cross-page equivalent of a local [`Data` / `State`](./data.md) block:

```typescript
useGlobalState({
  key: "user_session",
  procedure: (s) => {
    s.defScalar("session_started_at", sql`now()`);
  },
});
```

Calls are idempotent on `key`. The state is mounted once at the root of
the app and is available to every page.

## Global nodes

`useGlobalNode` registers UI that can be **opened** from any page. The
node renderer receives a `close` helper that produces statements to hide
the node again:

```typescript
const snackbar = useGlobalNode({
  key: "saved_snackbar",
  autoHideDuration: 3000,
  node: ({ close }) => (
    <Snackbar
      endDecorator={<button onClick={(s) => close(s)}>Dismiss</button>}
    >
      Saved successfully
    </Snackbar>
  ),
});

// In a page-level event handler:
button({
  on: { click: (s) => s.statements(snackbar.open) },
  children: "Save",
});
```

The returned helpers are:

- `open` — statements that show the node and (when `autoHideDuration` is
  set) start the auto-hide timer.
- `openWithoutDelayedClose` — show the node without scheduling a hide.
- `close` — statements that hide the node immediately.
- `delayedClose` — the hide statements actually scheduled by `open` when
  `autoHideDuration` is set.

Each unique `key` produces an independent global node.

## When to use which

- Use **global state** for values that survive page navigation but never
  need to render visible UI.
- Use **global nodes** when the UI itself must live across pages
  (toasts, system-wide modals).

For per-page transient state, prefer `ui.*` scalars and `State` blocks.

## Related

- [Snackbar](./snackbar.md)
- [Data vs Form](./data_vs_form.md)
