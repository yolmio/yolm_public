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

Yolm does not include pre-built Avatar or Badge components. This guide shows how to build these common UI patterns using HTML elements, Tailwind CSS, and Yolm's styling system.

## Avatar

An Avatar displays a user's profile image, initials, or icon in a circular or rounded format.

### Basic Avatar Patterns

**Image Avatar:**

```tsx
<div className="w-10 h-10 rounded-full overflow-hidden bg-level1">
  <img
    src={sql`user.avatar_url`}
    alt={sql`user.name`}
    className="w-full h-full object-cover"
  />
</div>
```

**Initials Avatar:**

```tsx
<div className="w-10 h-10 rounded-full bg-primary-soft text-primary-soft flex items-center justify-center text-sm font-medium">
  {sql`substring(user.first_name, 1, 1) || substring(user.last_name, 1, 1)`}
</div>
```

**Icon Avatar:**

```tsx
import { MaterialIcon } from "components/material_icon";

<div className="w-10 h-10 rounded-full bg-primary-soft flex items-center justify-center">
  <MaterialIcon icon="Person" />
</div>
```

### Avatar Sizes

Use Tailwind size classes to create different avatar sizes:

```tsx
// Small (32px)
<div className="w-8 h-8 rounded-full bg-primary-soft">...</div>

// Medium (40px)
<div className="w-10 h-10 rounded-full bg-primary-soft">...</div>

// Large (48px)
<div className="w-12 h-12 rounded-full bg-primary-soft">...</div>

// Extra Large (64px)
<div className="w-16 h-16 rounded-full bg-primary-soft">...</div>
```

### Avatar with Status Badge

Add a small status indicator to the corner of an avatar:

```tsx
<div className="relative w-10 h-10 inline-block">
  <img
    src={sql`user.avatar_url`}
    alt={sql`user.name`}
    className="w-full h-full rounded-full object-cover"
  />
  <div
    className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-surface"
    dynamicClasses={[
      {
        condition: sql`user.is_online`,
        classes: "bg-success-500",
      },
      {
        condition: sql`not user.is_online`,
        classes: "bg-neutral-400",
      },
    ]}
  />
</div>
```

### Avatar Group

Display multiple avatars overlapping:

```tsx
<div className="flex items-center">
  <State
    procedure={(s) => {
      s.defTable("users", sql`select * from db.users limit 5`);
    }}
  >
    <Each table="users" recordName="user">
      <div
        className="relative w-10 h-10 -ml-3 first:ml-0 rounded-full overflow-hidden border-2 border-surface bg-level1"
      >
        <img
          src={sql`user.avatar_url`}
          alt={sql`user.name`}
          className="w-full h-full object-cover"
        />
      </div>
    </Each>
  </State>
  <div className="ml-2 text-sm text-secondary">+5 more</div>
</div>
```

## Badge

A Badge is a small status indicator or label, typically overlaid on another element or used inline.

### Basic Badge Patterns

**Simple Badge:**

```tsx
<span className="bg-primary-soft text-primary-soft px-2 py-1 rounded text-xs font-medium">
  New
</span>
```

**Solid Badge:**

```tsx
<span className="bg-primary-solid text-primary-solid px-2 py-1 rounded text-xs font-medium">
  Active
</span>
```

**Outlined Badge:**

```tsx
<span className="border border-primary-outlined text-primary-outlined px-2 py-1 rounded text-xs font-medium">
  Pending
</span>
```

### Badge Colors

Use the semantic color system for status badges:

```tsx
// Success badge
<span className="bg-success-soft text-success-soft px-2 py-1 rounded text-xs font-medium">
  Completed
</span>

// Danger badge
<span className="bg-danger-soft text-danger-soft px-2 py-1 rounded text-xs font-medium">
  Failed
</span>

// Warning badge
<span className="bg-warning-soft text-warning-soft px-2 py-1 rounded text-xs font-medium">
  In Progress
</span>

// Neutral badge
<span className="bg-neutral-soft text-neutral-soft px-2 py-1 rounded text-xs font-medium">
  Draft
</span>
```

### Numeric Badge

Display a count or number in a circular badge (common for notifications):

```tsx
<div className="relative inline-block">
  <button>Notifications</button>
  <span className="absolute top-0 right-0 bg-danger-solid text-danger-solid w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold translate-x-1/2 -translate-y-1/2">
    {sql`notification_count`}
  </span>
</div>
```

### Badge with Icon

Combine badge with an icon for better visual communication:

```tsx
import { MaterialIcon } from "components/material_icon";

<span className="bg-success-soft text-success-soft px-2 py-1 rounded text-xs font-medium flex items-center gap-1">
  <MaterialIcon icon="Check" className="text-sm" />
  Verified
</span>
```

### Dynamic Status Badge

Use SQL expressions and conditional classes to display dynamic status:

```tsx
<span
  className="px-2 py-1 rounded text-xs font-medium"
  dynamicClasses={[
    {
      condition: sql`status = 'active'`,
      classes: "bg-success-soft text-success-soft",
    },
    {
      condition: sql`status = 'pending'`,
      classes: "bg-warning-soft text-warning-soft",
    },
    {
      condition: sql`status = 'inactive'`,
      classes: "bg-neutral-soft text-neutral-soft",
    },
    {
      condition: sql`status = 'error'`,
      classes: "bg-danger-soft text-danger-soft",
    },
  ]}
>
  {sql`status`}
</span>
```

### Badge as Overlay

Position a badge over another element:

```tsx
<div className="relative inline-block">
  <div className="w-20 h-20 rounded bg-level1">
    Image or content
  </div>
  <span className="absolute top-1 right-1 bg-danger-solid text-danger-solid px-2 py-0.5 rounded text-xs font-medium">
    Sale
  </span>
</div>
```

## Reusable Avatar Component

Create a reusable function component for avatars:

```tsx
function UserAvatar(props: { userId: Sql; size?: "sm" | "md" | "lg" | "xl" }) {
  const { userId, size = "md" } = props;

  return (
    <State
      procedure={(s) => {
        s.defRecord("user", sql`select * from db.users where id = ${userId}`);
      }}
    >
      <div
        className={`rounded-full overflow-hidden bg-primary-soft flex items-center justify-center font-medium ${
          size === "sm" ? "w-8 h-8 text-xs" :
          size === "md" ? "w-10 h-10 text-sm" :
          size === "lg" ? "w-12 h-12 text-base" :
          "w-16 h-16 text-lg"
        }`}
      >
        <Show when={sql`user.avatar_url is not null`}>
          <img
            src={sql`user.avatar_url`}
            alt={sql`user.name`}
            className="w-full h-full object-cover"
          />
        </Show>
        <Show when={sql`user.avatar_url is null`}>
          {sql`substring(user.first_name, 1, 1) || substring(user.last_name, 1, 1)`}
        </Show>
      </div>
    </State>
  );
}

// Usage
<UserAvatar userId={sql`user.id`} size="md" />
```

## Reusable Status Badge Component

Create a reusable function component for status badges:

```tsx
interface StatusBadgeProps {
  status: ReturnType<typeof sql>;
  variant?: "soft" | "solid" | "outlined";
}

function StatusBadge({ status, variant = "soft" }: StatusBadgeProps) {
  const getColorClass = (v: "soft" | "solid" | "outlined") => {
    const colorMap = {
      soft: {
        active: "bg-success-soft text-success-soft",
        pending: "bg-warning-soft text-warning-soft",
        inactive: "bg-neutral-soft text-neutral-soft",
        error: "bg-danger-soft text-danger-soft",
      },
      solid: {
        active: "bg-success-solid text-success-solid",
        pending: "bg-warning-solid text-warning-solid",
        inactive: "bg-neutral-solid text-neutral-solid",
        error: "bg-danger-solid text-danger-solid",
      },
      outlined: {
        active: "border border-success-outlined text-success-outlined",
        pending: "border border-warning-outlined text-warning-outlined",
        inactive: "border border-neutral-outlined text-neutral-outlined",
        error: "border border-danger-outlined text-danger-outlined",
      },
    };
    return colorMap[v];
  };

  const colorClass = getColorClass(variant);

  return (
    <span
      className="px-2 py-1 rounded text-xs font-medium"
      dynamicClasses={[
        {
          condition: sql`${status} = 'active'`,
          classes: colorClass.active,
        },
        {
          condition: sql`${status} = 'pending'`,
          classes: colorClass.pending,
        },
        {
          condition: sql`${status} = 'inactive'`,
          classes: colorClass.inactive,
        },
        {
          condition: sql`${status} = 'error'`,
          classes: colorClass.error,
        },
      ]}
    >
      {status}
    </span>
  );
}

// Usage
<StatusBadge status={sql`order.status`} variant="soft" />
```

## Best Practices

1. **Use circular avatars** for user profiles (border-radius: 50%)
2. **Use Tailwind size classes** for consistent sizing (w-8, w-10, w-12, w-16)
3. **Fallback to initials** when avatar images are unavailable
4. **Use semantic colors** for status badges (success, danger, warning, neutral)
5. **Add borders** to overlapping avatars in groups
6. **Use soft variant** for passive badges, **solid** for active/important statuses
7. **Keep badges small** - use text-xs or text-sm
8. **Combine with icons** for better visual communication

## Common Patterns

### User Card with Avatar and Status

```tsx
<div className="flex items-center gap-3 p-4">
  <div className="relative">
    <img
      src={sql`user.avatar_url`}
      alt={sql`user.name`}
      className="w-10 h-10 rounded-full object-cover"
    />
    <div
      className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-surface"
      dynamicClasses={[
        {
          condition: sql`user.is_online`,
          classes: "bg-success-500",
        },
      ]}
    />
  </div>
  <div className="flex-1">
    <p className="font-medium">{sql`user.name`}</p>
    <span className="bg-neutral-soft text-neutral-soft px-1 py-0.5 rounded text-xs">
      {sql`user.role`}
    </span>
  </div>
</div>
```

### Item List with Status Badges

```tsx
<div className="space-y-2">
  <Each table="items" recordName="item">
    <div className="flex items-center justify-between p-3 bg-surface rounded">
      <span>{sql`item.name`}</span>
      <span
        className="px-2 py-1 rounded text-xs font-medium"
        dynamicClasses={[
          {
            condition: sql`item.status = 'active'`,
            classes: "bg-success-soft text-success-soft",
          },
          {
            condition: sql`item.status = 'pending'`,
            classes: "bg-warning-soft text-warning-soft",
          },
          {
            condition: sql`item.status = 'inactive'`,
            classes: "bg-neutral-soft text-neutral-soft",
          },
        ]}
      >
        {sql`item.status`}
      </span>
    </div>
  </Each>
</div>
```

### Notification Badge on Icon Button

```tsx
<div className="relative">
  <button className="p-2">
    <MaterialIcon icon="Notifications" />
  </button>
  <span className="absolute top-1 right-1 bg-danger-solid text-danger-solid w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold">
    {sql`unread_count`}
  </span>
</div>
```
