---
title: PageHeader
description: Page header component for record and listing pages with title, actions, chips, and responsive layout.
tags:
  - ui
  - components
  - page-header
  - layout
---

# PageHeader

The PageHeader component provides a responsive header layout for pages, typically used on record detail pages. It arranges a title, metadata chips, a flexible spacer, and action buttons in a row (column on mobile).

```tsx
import { PageHeader } from "components/page_header";
```

## Sub-Components

PageHeader is a compound component with several attached sub-components:

| Sub-Component | Description |
|---------------|-------------|
| `PageHeader.Grow` | Flexible spacer that pushes actions to the right on desktop |
| `PageHeader.Actions` | Container for action buttons (flex row with gap) |
| `PageHeader.DefaultActions` | Pre-built Edit and Delete buttons using current record context |
| `PageHeader.Chips` | Container for status chips/badges (flex row with gap) |
| `PageHeader.Column` | Vertical stack for grouping title + subtitle + chips |

## Basic Usage

### Basic Example

```tsx
<PageHeader>
  <Typography level="h4">
    {sql`record.name`}
  </Typography>
  <PageHeader.Grow />
  <PageHeader.DefaultActions />
</PageHeader>
```

### With Column, Subtitle, and Chips

```tsx
<PageHeader>
  <PageHeader.Column>
    <Typography level="h4">
      {sql`record.name`}
    </Typography>
    <Typography level="body-md" className="text-secondary">
      {sql`fn.display_contact_type(record.type)`}
    </Typography>
    <PageHeader.Chips>
      <Show when={sql`record.deceased`}>
        <Chip size="md" color="danger" variant="soft">Deceased</Chip>
      </Show>
      <Show when={sql`record.vip`}>
        <Chip size="md" color="primary" variant="soft">VIP</Chip>
      </Show>
    </PageHeader.Chips>
  </PageHeader.Column>
  <PageHeader.Grow />
  <PageHeader.DefaultActions />
</PageHeader>
```

### With Custom Actions

```tsx
<PageHeader>
  <Typography level="h4">
    {sql`record.organization_id.name`}
  </Typography>
  <PageHeader.Grow />
  <PageHeader.Actions>
    <Button
      variant="soft"
      color="neutral"
      startIcon="Edit"
      size="sm"
      href={sql`'/systems/' || cast(record_id as string) || '/edit'`}
    >
      Edit
    </Button>
    <DeleteRecordButton size="sm" afterTransactionCommit={(s) => s.navigate(sql.lit`/systems`)}>
      Delete
    </DeleteRecordButton>
  </PageHeader.Actions>
</PageHeader>
```

### Listing Page Header (Non-Record)

PageHeader also works for listing pages without a record context:

```tsx
<PageHeader>
  <div>
    <Typography level="h2">Authentication Failures</Typography>
    <Typography level="body-lg" sx={{ maxWidth: 600 }}>
      Monitor and analyze authentication failures to identify security issues and improve user experience.
    </Typography>
  </div>
</PageHeader>
```

## Common Props

Use the exported TypeScript props for exact `PageHeader` types. `PageHeader`
takes header content plus optional `sx` / `className`. Use
`PageHeader.DefaultActions` inside a record context, and set `disableEdit` or
`disableDelete` when a default action should be hidden.

## PageTitleHeader

`PageTitleHeader` is a convenience wrapper around `PageHeader` for app-specific
pages that are not using a higher-level page template. It renders a Typography
title, a `PageHeader.Grow` spacer, and optional trailing actions.

```tsx
import { PageTitleHeader } from "components/page_header";
```

```tsx
<PageTitleHeader
  title="Authentication Failures"
  actions={<Button size="sm">Refresh</Button>}
/>
```

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `title` | `Node` | Yes | Title content, rendered in a `Typography`. |
| `actions` | `Node` | No | Trailing actions, wrapped in `PageHeader.Actions`. |
| `level` | `"h1" \| "h2" \| "h3" \| "h4" \| "title-lg" \| "title-md" \| "title-sm"` | No | Typography level for the title. Defaults to `"h3"`. |
| `className` | `string` | No | Class for the underlying `PageHeader`. Defaults to `"mb-6"`. |

## Layout Behavior

- On **mobile**: items stack vertically and center-align
- On **desktop (md+)**: items align horizontally with `PageHeader.Grow` pushing actions to the right

## Common Patterns

### Record Detail Page

```tsx
<RecordPage table="contacts">
  <div className="grid grid-cols-12 w-full mx-auto p-2 sm:px-4 md:gap-4 lg:px-10 xl:px-12 xl:max-w-7xl py-4 gap-3">
    <PageHeader>
      <Typography level="h4">{sql`record.name`}</Typography>
      <PageHeader.Grow />
      <PageHeader.DefaultActions />
    </PageHeader>
    <TwoColumnDisplayCard
      sx={{ gridColumnSpan: 12 }}
      cells={[
        { label: "Email", field: "email" },
        { label: "Phone", field: "phone" },
      ]}
    />
  </div>
</RecordPage>
```

### Read-Only Page (No Actions)

```tsx
<PageHeader>
  <Typography level="h4">
    {sql`record.name`}
  </Typography>
</PageHeader>
```

### Delete-Only Page (No Edit)

```tsx
<PageHeader>
  <Typography level="h4">
    {sql`record.name`}
  </Typography>
  <PageHeader.Grow />
  <PageHeader.DefaultActions disableEdit />
</PageHeader>
```
