---
title: Breadcrumbs and Link
description: Navigation components for breadcrumb trails and hyperlinks with consistent styling.
tags:
  - ui
  - components
  - navigation
  - breadcrumbs
  - links
---

# Breadcrumbs and Link

Navigation components for creating breadcrumb trails and styled hyperlinks.

## Link

The Link component wraps the standard `<a>` tag with theme-integrated styling.

```tsx
import { Link } from "components/link";
```

### Basic Usage

```tsx
<Link href="/products">View Products</Link>
<Link href="mailto:support@example.com">Contact Support</Link>
<Link href="https://external-site.com" target="_blank">External Link</Link>
```

### Styling

Link uses primary theme color by default with underline on hover.

```tsx
// With Tailwind classes
<Link href="/docs" className="text-sm font-semibold">
  Documentation
</Link>

// With custom inline styles
<Link href="/profile" sx={{ color: "neutral-500" }}>
  Profile
</Link>
```

### Using with SQL Expressions

Links commonly use SQL expressions for dynamic URLs:

```tsx
// Dynamic URL based on record ID
<Link href={sql.concat("/users/", sql`user.id`)}>
  {sql`user.name`}
</Link>

// Email links
<Link href={sql.concat("mailto:", sql`email_field`)}>
  {sql`email_field`}
</Link>

// Conditional href
<Link href={sql`case when published then '/posts/' || id else '#' end`}>
  {sql`title`}
</Link>
```

### Props

All standard HTML anchor (`<a>`) attributes are supported:

| Prop | Type | Description |
|------|------|-------------|
| `href` | `string \| Sql` | URL or SQL expression for the link destination |
| `target` | `string` | Target behavior: "_blank", "_self", etc. |
| `className` | `string` | Tailwind CSS classes |
| `sx` | `Style` | Inline style object |
| `children` | `Node` | Link content |

### Real-World Examples

```tsx
// In a table row
<Each table="users" recordName="user">
  <tr>
    <td>
      <Link href={sql`'/users/' || user.id`}>
        {sql`user.name`}
      </Link>
    </td>
  </tr>
</Each>

// Within Typography component
<Typography level="body-md">
  Learn more in the <Link href="/docs">documentation</Link>.
</Typography>

// Email link with custom styling
<Link
  href={sql.concat("mailto:", sql`contact_email`)}
  className="text-primary-600 hover:text-primary-700"
>
  {sql`contact_email`}
</Link>
```

## Breadcrumbs

Breadcrumbs show the user's current location in a hierarchical navigation path. Since there is no built-in Breadcrumbs component, you build them using Link components within a Data component.

### Basic Pattern

```tsx
import { Link } from "components/link";
import { Data } from "std/data";
import { Each } from "std/ui";

function Breadcrumbs({ folderId }: { folderId: Sql }) {
  return (
    <Data
      procedure={(s) => {
        // Fetch breadcrumb trail using recursive SQL
        s.defTable(
          "breadcrumbs",
          sql`
            with recursive folder_path as (
              select id, name, parent_folder_id, 1 as depth
              from db.folders
              where id = ${folderId}
              union all
              select rf.id, rf.name, rf.parent_folder_id, fp.depth + 1
              from folder_path fp
              join db.folders rf on rf.id = fp.parent_folder_id
            )
            select id, name, depth from folder_path order by depth desc
          `,
        );
      }}
      watch={[folderId]}
    >
      {/* Root link */}
      <Link href="/" className="text-secondary hover:text-primary">
        Home
      </Link>

      {/* Breadcrumb items */}
      <Each table="breadcrumbs" recordName="crumb">
        <span className="text-icon mx-1">/</span>
        <Link
          href={sql`'/folders/' || crumb.id`}
          className="text-secondary hover:text-primary hover:underline"
        >
          {sql`crumb.name`}
        </Link>
      </Each>
    </Data>
  );
}
```

### Display Options

#### With Separators

Use text separators between breadcrumb items:

```tsx
<div className="flex items-center gap-2">
  <Link href="/">Home</Link>
  <span className="text-tertiary">/</span>
  <Link href="/products">Products</Link>
  <span className="text-tertiary">/</span>
  <span className="text-secondary">{sql`current_page`}</span>
</div>
```

#### Chevron Separators

Use Material Design icons as separators:

```tsx
import { MaterialIcon } from "components/material_icon";

<div className="flex items-center gap-1">
  <Link href="/">Home</Link>
  <MaterialIcon icon="ChevronRight" className="text-icon" />
  <Link href="/docs">Documentation</Link>
  <MaterialIcon icon="ChevronRight" className="text-icon" />
  <span className="text-secondary">{sql`page_title`}</span>
</div>
```

#### Breadcrumb with Dropdown

For multi-level navigation:

```tsx
<div className="flex items-center gap-2">
  <Link href="/">Home</Link>
  <span className="text-tertiary">/</span>

  {/* Current level with dropdown option */}
  <div className="flex items-center gap-1">
    <Link href={sql`'/parent/' || parent_id`}>
      {sql`parent_name`}
    </Link>
    <Menu>
      <Menu.Button variant="plain" size="sm">
        <MaterialIcon icon="ExpandMore" />
      </Menu.Button>
      <Menu.Content>
        <Menu.Item component="a" href={sql`'/sibling1/' || sibling1_id`}>
          {sql`sibling1_name`}
        </Menu.Item>
        <Menu.Item component="a" href={sql`'/sibling2/' || sibling2_id`}>
          {sql`sibling2_name`}
        </Menu.Item>
      </Menu.Content>
    </Menu>
  </div>

  <span className="text-tertiary">/</span>
  <span className="text-secondary">{sql`current_name`}</span>
</div>
```

### Styling Breadcrumbs

Apply consistent styling with Tailwind classes:

```tsx
<div className="flex items-center gap-1 text-sm">
  <Link href="/" className="text-secondary hover:text-primary">
    Home
  </Link>

  <Each table="breadcrumbs" recordName="crumb">
    <span className="text-tertiary">/</span>
    <Show when={sql`crumb.id != current_id`}>
      <Link
        href={sql`'/path/' || crumb.id`}
        className="text-secondary hover:text-primary hover:underline"
      >
        {sql`crumb.name`}
      </Link>
    </Show>
    <Show when={sql`crumb.id = current_id`}>
      <span className="text-primary font-semibold">{sql`crumb.name`}</span>
    </Show>
  </Each>
</div>
```

### Common Patterns

#### Breadcrumbs in Page Header

```tsx
<div className="border-b border-divider px-6 py-4">
  <div className="flex items-center gap-2 mb-2">
    <MaterialIcon icon="Folder" className="text-lg text-tertiary" />
    <Link href="/files">Files</Link>
    {folderId && <Breadcrumbs folderId={folderId} />}
  </div>
  <Typography level="h2">{sql`page_title`}</Typography>
</div>
```

#### Multi-Step Process Breadcrumbs

```tsx
<div className="flex items-center gap-4">
  <Show when={sql`step >= 1`}>
    <div className="flex items-center gap-2">
      <span className={sql`case when step = 1 then 'bg-primary text-white' else 'bg-level1 text-secondary' end`}>
        1
      </span>
      <span className="text-secondary">Personal Info</span>
    </div>
    <span className="text-tertiary">→</span>
  </Show>

  <Show when={sql`step >= 2`}>
    <div className="flex items-center gap-2">
      <span className={sql`case when step = 2 then 'bg-primary text-white' else 'bg-level1 text-secondary' end`}>
        2
      </span>
      <span className="text-secondary">Address</span>
    </div>
    <span className="text-tertiary">→</span>
  </Show>

  <Show when={sql`step >= 3`}>
    <div className="flex items-center gap-2">
      <span className={sql`case when step = 3 then 'bg-primary text-white' else 'bg-level1 text-secondary' end`}>
        3
      </span>
      <span className="text-secondary">Confirm</span>
    </div>
  </Show>
</div>
```

### Tips

- **Use recursive SQL** for hierarchical breadcrumbs to fetch the full path efficiently
- **Last item is current**: The final breadcrumb typically represents the current page and should not be clickable (render as plain text, not a link)
- **Accessibility**: Use semantic HTML with proper link attributes (`href`, `title`)
- **Watch dependencies**: Use `watch` prop on Data to update breadcrumbs when the current location changes
- **Styling**: Apply consistent text colors using the Tailwind color system (secondary for clickable items, primary for hover states)
