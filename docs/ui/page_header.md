---
title: PageHeader
description: PageHeader and PageTitleHeader for record and listing pages - title, chips, default Edit/Delete actions, sidebar trigger, and responsive layout.
tags:
  - ui
  - components
  - page-header
  - layout
related:
  - ui/record_page.md
  - ui/sidebar.md
  - ui/solution_components.md
---

# PageHeader

`PageHeader` is a responsive `<header>` row: title, chips, a spacer, and
actions. Items stack and center on mobile and align in a row from `md` up.

```tsx
import { PageHeader, PageTitleHeader } from "components/page_header";
```

```tsx
<PageHeader>
  <PageHeader.Column>
    <Typography level="h4">{sql`record.name`}</Typography>
    <Typography level="body-md" className="text-secondary">
      {sql`fn.display_contact_type(record.type)`}
    </Typography>
    <PageHeader.Chips>
      <Show when={sql`record.vip`}>
        <Chip size="md" color="primary" variant="soft">VIP</Chip>
      </Show>
    </PageHeader.Chips>
  </PageHeader.Column>
  <PageHeader.Grow />
  <PageHeader.DefaultActions />
</PageHeader>
```

`PageHeader` takes `children` plus optional `sx` / `className`. It spans the
full grid row (`gridColumnSpan: "full"`), and when the surrounding
[Sidebar](./sidebar.md) provider enables `autoTrigger` it prepends a
`Sidebar.Trigger` automatically.

| Sub-component | Behavior |
| --- | --- |
| `PageHeader.Grow` | Spacer that pushes later content right; hidden below `md`. |
| `PageHeader.Actions` | Gapped row for action buttons. |
| `PageHeader.Chips` | Gapped row for status chips. |
| `PageHeader.Column` | Vertical stack (title over status chips or key fields). |
| `PageHeader.DefaultActions` | Edit + Delete for the current record. |

## DefaultActions

`PageHeader.DefaultActions` reads the current table and record from context,
so it must render inside a record context such as
[RecordPage](./record_page.md). Edit links to the record's `/edit` page;
Delete uses `DeleteRecordButton` with an undo snackbar and navigates to the
table's base URL after commit. Hide either with `disableEdit` /
`disableDelete`.

For custom actions, use `PageHeader.Actions`:

```tsx
<PageHeader>
  <Typography level="h4">{sql`record.organization_id.name`}</Typography>
  <PageHeader.Grow />
  <PageHeader.Actions>
    <Button size="sm" variant="soft" color="neutral" startIcon="Edit"
      href={sql`'/systems/' || cast(record_id as string) || '/edit'`}>
      Edit
    </Button>
    <DeleteRecordButton size="sm"
      afterTransactionCommit={(s) => s.navigate(sql.lit`/systems`)}>
      Delete
    </DeleteRecordButton>
  </PageHeader.Actions>
</PageHeader>
```

`PageHeader` also works without a record context, e.g. a listing page title
and its actions. Secondary content is record data (status chips, key fields),
not description copy.

## PageTitleHeader

`PageTitleHeader` is the standard title/action header for custom pages that do
not use a [page template](./page_templates.md). It renders a `PageHeader` with
a `Typography` title, `PageHeader.Grow`, and, when given, `actions` wrapped in
`PageHeader.Actions`. It inherits the sidebar-trigger behavior.

```tsx
<PageTitleHeader
  title="Invoice Review"
  actions={<Button size="sm" startIcon="Add">New Invoice</Button>}
/>
```

| Prop | Default | Notes |
| --- | --- | --- |
| `title` | required | `Node`. |
| `actions` | none | `Node`, trailing actions. |
| `level` | `"h3"` | `"h1"`-`"h4"` or `"title-lg"` / `"title-md"` / `"title-sm"`; use a `title-*` level for panels. |
| `className` | `"mb-6"` | Replaces the default bottom margin. |
