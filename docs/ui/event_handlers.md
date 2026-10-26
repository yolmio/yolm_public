---
title: Event Handlers
description: Handle DOM, window, and document events in Yolm UI with DomStatements, typed event objects, and SQL scope variables.
tags:
  - ui
  - events
  - handlers
  - dom
---

# Event Handlers

Event handler props (`onClick`, `onInput`, `onKeyDown`, …) take a function
`(s, e) => void` that builds `DomStatements` at generation time. The handler
runs in the browser; event data is read through SQL scope variables, never as
JavaScript values. For saves and commands, use `Form` or `ActionButton`
instead of raw handlers; see
[Data vs Form](./data_vs_form.md#when-to-use-actionbutton).

```tsx
<Input
  value={sql`query`}
  onInput={(s, newValue) => s.setScalar("query", newValue)}
  onKeyDown={(s, e) => {
    s.if(sql`${e.key} = 'Enter' and not ${e.shiftKey}`, (s) => {
      s.event.preventDefault();
      s.navigate(sql`'/search?q=' || query`);
    });
  }}
/>
```

For plain two-way binding prefer `bindScalar` / `bindRecordField` on input
components; they wire `onInput` for you.

## Scope variables and event objects

The second handler argument is a typed object whose fields are SQL
expressions (types in `std/event_utils`). You may also write the SQL names
directly.

| Handler | Second argument | SQL in scope |
|---|---|---|
| Mouse and drag (`onClick`, `onDoubleClick`, `onMouse*`, `onDrag*`, `onDrop`, `onClickAway`, `onDialogBackdropClick`) | `MouseEventObject` | `event.client_x/y`, `page_x/y`, `screen_x/y`, `offset_x/y`, `movement_x/y`, `button`, `buttons`, `ctrl_key`, `shift_key`, `alt_key`, `meta_key` |
| `onKeyDown`, `onKeyUp` | `KeyboardEventObject` | `event.key`, `event.code`, `event.repeat`, modifier keys |
| `onInput`, `onChange` | `newValue` (= `target_value`) | `target_value` |
| `onCheckboxChange` | `newValue` (= `target_checked`) | `target_checked` |
| `onPaste` | `ClipboardEventObject` (`pastedText`) | `pasted_text` |
| `onFileChange` | `FileEventObject` (`files`) | `file` table (`uuid`, `type`, `name`, `last_modified`, `size`) |
| `onFocus`, `onBlur`, `onFocusIn`, `onFocusOut`, `onFocusAway`, `onSubmit` | object whose modifier fields are `false` | none |
| `onMount`, `onScroll`, `onClose`, `onCancel`, `onToggleShow/Hide`, `onVisibilityChange` | none | none |

Checkbox state comes from `onCheckboxChange` and `target_checked`, not from
`onChange`.

`s.event` controls the triggering event: `preventDefault()`,
`stopPropagation()`, and `getTarget(scalar)` / `getCurrentTarget(scalar)`.
Element, window, and document reads write into scalars:
`s.element(id).focus()`, `s.window.getInnerWidth("w")`,
`s.window.getScrollY("y")`, `s.document.getHidden("hidden")`.

Handlers may modify ancestor UI state; see
[UI state scope](./overview.md#ui-state-scope) and
[name resolution](./overview.md#name-resolution).

## Handler options

Pass an object instead of a function to set options:

```tsx
<Button
  onClick={{
    procedure: (s) => s.startTask((s) => { /* ... */ }),
    detachedFromNode: true, // keep running after the node is removed
    disableAutoUiCommit: false,
  }}
>
  Start
</Button>
```

By default a handler is aborted when its node is removed;
`detachedFromNode: true` opts out.

## Window and document events

`EventHandlers` (from `std/ui`) registers `window` / `document` listeners and
an optional `mount` handler for the enclosing component. Keys are
`EventHandlerName` values: `resize`, `scroll`, `beforeUnload`,
`visibilityChange`, `keydown`, `keyup`, `click`, `paste`, and the other
element event names. `useEventHandlers({...})` inside a component function is
equivalent to rendering `<EventHandlers>` around it.

```tsx
import { EventHandlers } from "std/ui";

<Data
  procedure={(s) => {
    s.defScalar("search_open", sql.false);
    s.defScalar("search_query", sql.lit``);
  }}
>
  <EventHandlers
    document={{
      keydown: (s) => {
        s.if(sql`event.key = 'k' and (event.ctrl_key or event.meta_key)`, (s) => {
          s.event.preventDefault();
          s.setScalar("search_open", sql.true);
          s.element("search-input").focus();
        });
        s.if(sql`event.key = 'Escape' and search_open`, (s) => {
          s.setScalar("search_open", sql.false);
        });
      },
    }}
  />
  <Show when={sql`search_open`}>
    <Input id="search-input" bindScalar="search_query" />
  </Show>
</Data>
```

Read window geometry with `s.window` helpers, not event fields. For standard
page shortcuts (`f` search, `a` add, `e` edit) use `PageKeyboardShortcuts`
from `components/keyboard_shortcuts`, which also ignores keys typed into text
inputs.

## Common mistakes

- Reading `event.key` in a mouse handler, or `event.client_x` in a keyboard
  handler: each handler type only puts its own fields in scope.
- Reading `target_checked` in `onChange`; use `onCheckboxChange`.
- Forgetting `s.event.preventDefault()` in `onDragOver` (required to allow a
  drop) or when overriding browser shortcuts.
