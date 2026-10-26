---
title: Icons (MaterialIcon)
description: Material Design icons for use in buttons, typography, lists, and standalone display.
tags:
  - ui
  - components
  - icons
---

# Icons

`MaterialIcon` renders a Material Design icon as an inline SVG. The icon's SVG
is loaded at generation time from `packages/components/material-icons/<name>.json`.

```tsx
import { MaterialIcon } from "components/material_icon";

<MaterialIcon icon="CheckCircle" color="success" />
<MaterialIcon icon="Search" className="text-4xl" />
```

## Icon Names

The `icon` prop is typed as `IconName`, a union of every Material Symbol that
ships with Yolm; autocomplete lists them and unknown names fail at generation
time. Use the type for your own icon props:

```tsx
import type { IconName } from "components/material_icon_names";

interface MyButtonProps {
  icon: IconName;
}
```

Names are PascalCase. The unsuffixed name is the filled default; `Outlined`,
`Rounded`, `Sharp`, and `TwoTone` variants are separate values
(`Delete`, `DeleteOutlined`, `DeleteRounded`, ...).

Common names: `Add`, `Edit`, `Delete`, `Save`, `Search`, `Close`, `Menu`,
`MoreVert`, `ArrowBack`, `ArrowForward`, `ExpandMore`, `FilterList`,
`Download`, `Upload`, `Check`, `CheckCircle`, `Error`, `Warning`, `Info`,
`Person`, `Settings`, `Notifications`, `CalendarToday`, `Schedule`,
`Dashboard`, `Visibility`, `VisibilityOff`.

## Props

- `icon` is a static string. To switch icons at runtime, render each static
  icon inside `Show` / `Switch` / `Match`:

  ```tsx
  <Show
    when={sql`task.is_completed`}
    fallback={<MaterialIcon icon="RadioButtonUnchecked" color="neutral" />}
  >
    <MaterialIcon icon="CheckCircle" color="success" />
  </Show>
  ```

- `color` (default `"inherit"`, i.e. `currentColor`): a palette color
  (uses its plain-variant text color), `"harmonize"`, or `"inherit"`.
- `fontSize` (default `"inherit"`): a theme font-size token such as `"lg"`.
  Tailwind text-size classes in `className` also work.
- `title` (`Sql`): when set, the icon is exposed as `role="img"` with an SVG
  `<title>`; otherwise it is `aria-hidden`.

See `SvgIconBaseProps` in `components/svg_icon` for the shared SVG icon
contract.

## Icons In Other Components

Many components (`Button`, `Typography`, `Alert`, `Chip`, `Snackbar`, ...)
take `startIcon` / `endIcon` icon names directly. Use `startDecorator` /
`endDecorator` with a `MaterialIcon` when the icon needs its own `color` or
other props. `Button`, `Alert`, and `Chip` throw if an icon and a decorator are
given for the same side; `Typography` and `Snackbar` use the icon and ignore
the decorator. `IconButton` takes `icon` directly; see
[IconButton](./tooltip.md#iconbutton).

Brand logos (GitHub, Google, Gmail, OpenAI, Zoom, ...) are separate components
in `components/icons/`, e.g. `GithubIcon` from `components/icons/github`.
