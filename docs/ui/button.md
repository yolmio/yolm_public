---
title: Button
description: Button, ButtonGroup, and IconButton components for clicks, links, icons, and loading states, plus when to use ActionButton or Form instead.
tags:
  - ui
  - components
  - button
  - interaction
related:
  - ui/action_button.md
  - ui/form.md
  - ui/data_vs_form.md
  - ui/icons.md
  - ui/styling.md
---

# Button

`Button` renders a styled button (or link) with optional icons, decorators, and
a loading indicator.

```tsx
import { Button } from "components/button";

<Button
  startIcon="FilterList"
  onClick={(s) => s.setScalar("show_filters", sql`not show_filters`)}
>
  Filters
</Button>
```

Use a plain `Button` for UI-only handlers: opening a modal, switching tabs,
setting filters or selection. For server work use the dedicated primitives:

- Commands (delete, approve, sync, archive) -> [`ActionButton`](./action_button.md).
- Creating or editing row fields -> [`Form`](./form.md) with `Form.SubmitButton`.

See [Data vs Form](./data_vs_form.md#when-to-use-actionbutton) for the decision
table.

## Yolm-Specific Behavior

- `variant`, `color`, and `size` follow the shared
  [styling props](./styling.md#color-variant-and-size): static
  generation-time strings (`Color` includes `harmonize`). Defaults are
  `solid` / `primary` / `md`; inside a harmonize context the default color is
  `harmonize`, and inside a `ButtonGroup` the group's values are the defaults.
- `disabled` and `loading` are SQL boolean expressions.
- `loading` shows a `CircularProgress` and hides the label, but does **not**
  disable the button or block clicks. Guard the handler or also set `disabled`;
  `ActionButton` does this for you.
- `loadingPosition` (`start` | `center` | `end`) is inferred when omitted:
  `start` if only a start decorator exists, `end` if only an end decorator,
  otherwise `center`.
- `href` (string or SQL) renders an `<a>` instead of a `<button>`.
- `backLink` (requires `href`) makes a link to a parent or list page return to
  that page's earlier history entry with its filters and scroll; see
  [Routing](./routing.md#returning-to-a-list). Also on `IconButton`.
- `startIcon` / `endIcon` take a Material icon name; `startDecorator` /
  `endDecorator` take any node. Using both on the same side throws.
- `onClick` receives DOM statements `s`; see
  [event handlers](./event_handlers.md).

See `ButtonProps` in `components/button` for the full contract.

```tsx
<Button variant="soft" href="/reports/coverage" startIcon="Map">
  Coverage Report
</Button>

<Button href="/issues" backLink startIcon="ArrowBack" variant="plain">
  Issues
</Button>

<Button variant="outlined" color="neutral" onClick={onClose}>Cancel</Button>
```

## Refreshing After Server Work

Prefer `ActionButton`, which refetches on success by default:

```tsx
<ActionButton
  color="danger"
  startIcon="Delete"
  confirm={{ description: "Delete this todo?" }}
  action={(s) => {
    s.startTransaction();
    s.modify(sql`delete from db.todos where id = todo.id`);
    s.commitTransaction();
  }}
>
  Delete
</ActionButton>
```

When a raw handler is genuinely needed, call `s.refetch()` inside the server
body. It increments `global_refetch_key`, which every non-`local` `Data`
without `noRefetch` watches. There is no `refresh_key` scalar. See
[raw event handlers](./data_vs_form.md#raw-event-handlers).

---

# ButtonGroup

`ButtonGroup` shares a default `variant`, `color`, and `size` with its child
buttons (children may override) and renders them with consistent
dividers/spacing.

```tsx
import { ButtonGroup } from "components/button_group";

<ButtonGroup variant="outlined" color="primary" size="sm">
  <Button>Day</Button>
  <Button>Week</Button>
  <Button>Month</Button>
</ButtonGroup>
```

Other props: `orientation` (`"horizontal"` | `"vertical"`), `spacing` (gap
between buttons), `buttonFlex` (equal-width children), and `disabled` (SQL).
Use it for toolbars, segmented filters, and view-mode switchers.

---

# IconButton

`IconButton` renders a compact button containing a single icon.

```tsx
import { IconButton } from "components/icon_button";

<IconButton icon="Home" href="/" variant="plain" color="neutral" />
<IconButton
  icon="ContentCopy"
  variant="plain"
  color="neutral"
  tooltip="Copy to clipboard"
  tooltipProps={{ placement: "top" }}
/>
```

- Pass either `icon` (a Material icon name) or custom `children`, not both.
- `tooltip` renders a hover tooltip; add `aria-label` for icon-only controls.
- For a server command use `ActionIconButton` from `std/action_button`.

See `IconButtonProps` in `components/icon_button` for the full contract. For
standalone icons and `MaterialIcon` props see [Icons](./icons.md).

## Common Mistakes

- Relying on `loading` to prevent double submits. It only changes the visuals.
- Passing both `startIcon` and `startDecorator` (or `endIcon` and
  `endDecorator`), or both `icon` and children on `IconButton`. These throw.
- Hand-rolling `Button` + `s.tryServer` + loading/error scalars for commands or
  forms. Use `ActionButton` or `Form`; see
  [overview.md#common-mistakes](./overview.md#common-mistakes).
