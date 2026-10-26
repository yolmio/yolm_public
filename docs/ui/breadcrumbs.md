---
title: Breadcrumbs and Link
description: Link for themed hyperlinks with SQL hrefs, plus the pattern for building breadcrumb trails from recursive SQL, since Yolm has no Breadcrumbs component.
tags:
  - ui
  - components
  - navigation
  - breadcrumbs
  - links
related:
  - ui/data.md
  - ui/control_flow.md
  - ui/page_header.md
---

# Breadcrumbs and Link

## Link

`Link` renders an `<a>` with theme styling (`primary-500` text, underline on
hover). It accepts all `<a>` attributes; `href` may be static or a SQL
expression, and `sx` merges with the default style.

```tsx
import { Link, externalUrlHref } from "components/link";

<Link href="/products">View Products</Link>
<Link href={sql`'/users/' || user_record.id`}>{sql`user_record.name`}</Link>
<Link href={sql.concat("mailto:", sql`contact_email`)}>{sql`contact_email`}</Link>
<Link href={externalUrlHref(sql`record.website`)} target="_blank">
  {sql`record.website`}
</Link>
```

Set `backLink` on a `Link` that returns to a parent or list page. It goes back
to the most recent earlier history entry for `href`'s path, restoring that
page's filters and scroll, and is a plain link otherwise; see
[Routing](./routing.md#returning-to-a-list). Breadcrumbs are a fixed
hierarchy, not history, so do not use `backLink` on trail items.

`externalUrlHref(value)` turns a stored URL into an href, prefixing
`https://` when the value has no `http://` or `https://` scheme (null or blank
values pass through).

## Breadcrumbs

There is no built-in Breadcrumbs component. Load the trail in a `Data`
procedure, usually with a recursive query, and render it with `Each` over the
resulting UI table:

```tsx
import { Link } from "components/link";
import { MaterialIcon } from "components/material_icon";
import { Data } from "std/data";
import { Each, Show } from "std/ui";

function FolderBreadcrumbs(props: { folderId: Sql }) {
  return (
    <Data
      watch={[props.folderId]}
      procedure={(s) => {
        s.defTable(
          "breadcrumbs",
          sql`
            with recursive folder_path as (
              select id, name, parent_folder_id, 1 as depth
              from db.folders
              where id = ${props.folderId}
              union all
              select f.id, f.name, f.parent_folder_id, fp.depth + 1
              from folder_path fp
              join db.folders f on f.id = fp.parent_folder_id
            )
            select id, name, depth from folder_path order by depth desc
          `,
        );
      }}
    >
      <nav className="flex items-center gap-1 text-sm">
        <Link href="/files" className="text-secondary hover:text-primary">
          Files
        </Link>
        <Each table="breadcrumbs" recordName="crumb">
          <MaterialIcon icon="ChevronRight" fontSize="sm" color="neutral" />
          <Show when={sql`crumb.depth > 1`}>
            <Link
              href={sql`'/folders/' || crumb.id`}
              className="text-secondary hover:text-primary"
            >
              {sql`crumb.name`}
            </Link>
          </Show>
          <Show when={sql`crumb.depth = 1`}>
            <span className="font-semibold">{sql`crumb.name`}</span>
          </Show>
        </Each>
      </nav>
    </Data>
  );
}
```

- `watch` the current location input so the trail reloads when it changes.
- Render the last (current) item as plain text, not a link.
- For a sibling switcher at one level, put a `Menu` next to that crumb with
  `Menu.Item href={...}` entries.
- `Each` iterates UI tables declared with `defTable`, not `db` tables.

## Common Mistakes

- Passing `className` or `sx` to `MaterialIcon`; it accepts only `icon`,
  `color`, `fontSize`, and `title`.
- Building step indicators with SQL in `className`; toggle classes with
  `dynamicClassNames` instead
  ([dynamic classes](./styling.md#dynamic-classes)).
