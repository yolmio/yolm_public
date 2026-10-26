---
title: Avatar and Badge
description: Patterns for building Avatar and Badge components for displaying profile images, user initials, and status indicators.
tags:
  - ui
  - components
  - avatar
  - badge
---

# Avatar and Badge

Yolm has no built-in Avatar or Badge component. Build them from HTML elements,
static Tailwind classes, and `dynamicClassNames`. For a chip-style status label,
prefer [Chip](./chip.md) with `conditionalVariants` or `StatusChip`.

## Tailwind Tokens

The Tailwind compiler recognizes these Yolm color classes (among others):

- Variant classes per color (`primary`, `neutral`, `danger`, `success`,
  `warning`): `bg-<color>-soft` + `text-<color>-soft`, `bg-<color>-solid` +
  `text-<color>-solid`, `border-<color>-outlined` + `text-<color>-outlined`.
- Palette scales: `bg-success-500`, `bg-neutral-400`, etc. (50-950).
- Backgrounds: `bg-body`, `bg-surface`, `bg-level1`; text: `text-secondary`.

There is no `border-surface` class; use an arbitrary value such as
`border-[var(--palette-background-surface)]`.

## Avatar

Compute initials and other display values in the query, not in TypeScript;
see [derived and display values](./overview.md#derived-and-display-values).

```tsx
<Data
  procedure={(s) => {
    s.defTable("members", sql`
      select id, name, avatar_url, is_online,
        substring(first_name, 1, 1) || substring(last_name, 1, 1) as initials
      from db.users
      where team_id = ${teamId}
    `);
  }}
>
  <Each table="members" recordName="member">
    <div className="relative w-10 h-10 shrink-0">
      <Show
        when={sql`member.avatar_url is not null`}
        fallback={
          <div className="w-full h-full rounded-full bg-primary-soft text-primary-soft flex items-center justify-center text-sm font-medium">
            {sql`member.initials`}
          </div>
        }
      >
        <img
          src={sql`member.avatar_url`}
          alt={sql`member.name`}
          className="w-full h-full rounded-full object-cover"
        />
      </Show>
      <div
        className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--palette-background-surface)] bg-neutral-400"
        dynamicClassNames={[
          { condition: sql`member.is_online`, classNames: "bg-success-500" },
        ]}
      />
    </div>
  </Each>
</Data>
```

- Size with Tailwind (`w-8 h-8`, `w-10 h-10`, `w-12 h-12`, `w-16 h-16`). For a
  reusable `UserAvatar` with a static `size` prop, pick the class string from a
  TypeScript lookup at generation time; pass the record fields in as SQL
  expressions rather than issuing one query per avatar.
- For an icon avatar, put `<MaterialIcon icon="Person" />` inside the circle.
- Overlapping group: add `-ml-3 first:ml-0` and a surface-colored border to
  each avatar; compute any "+N more" count in the query.

## Badge

A badge is a small `<span>` with variant classes. Choose classes at runtime with
`dynamicClassNames` (Tailwind, compiled to generated CSS), not `dynamicClasses`
(raw CSS class names) - see [dynamic classes](./styling.md#dynamic-classes).
Matching entries are scoped to `&.var-<n>`, so they override the base
`className` colors.

```tsx
<span
  className="px-2 py-1 rounded text-xs font-medium bg-neutral-soft text-neutral-soft"
  dynamicClassNames={[
    { condition: sql`item.status = 'active'`, classNames: "bg-success-soft text-success-soft" },
    { condition: sql`item.status = 'pending'`, classNames: "bg-warning-soft text-warning-soft" },
    { condition: sql`item.status = 'error'`, classNames: "bg-danger-soft text-danger-soft" },
  ]}
>
  {sql`item.status`}
</span>
```

Numeric badge overlaid on an icon button:

```tsx
<div className="relative inline-block">
  <IconButton icon="Notifications" variant="plain" color="neutral" aria-label="Notifications" />
  <Show when={sql`unread_count > 0`}>
    <span className="absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-danger-solid text-danger-solid flex items-center justify-center text-xs font-bold">
      {sql`unread_count`}
    </span>
  </Show>
</div>
```

## Common Mistakes

- Putting Tailwind utilities in `dynamicClasses`; they are not compiled there.
  Use `dynamicClassNames` with `classNames`.
- Building per-status class strings in a TypeScript map keyed by runtime
  status; the status is only known at runtime, so list one
  `dynamicClassNames` entry per value.
