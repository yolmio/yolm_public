---
title: Timeline
description: Render a chronological activity feed from multiple tables. Timeline builds the union query, ordering, and infinite scroll from per-source configs.
tags:
  - ui
  - components
  - timeline
  - data
related:
  - ui/data.md
  - ui/overview.md
  - ui/styling.md
---

# Timeline

`Timeline` renders a chronological activity feed merged from several tables. You
declare a `sources` array — each source contributes a query and the content to
render for that event type. The component builds the `union all` query, orders
it, paginates it with infinite scroll, and routes each row to the matching
source's content. You do **not** write the union, `Each`, or `Switch` yourself.

```tsx
import { Timeline } from "components/timeline";
```

`Timeline.Item` is a static property of `Timeline` (no separate import).
`TimelineSource` and `TimelineProps` types are also exported.

## Usage

Each source's `query` selects `id` and the order field (`date` by default). The
`type` discriminator is added automatically — do not select it yourself. Inside
a source's `children`, the current row is the `event` record, exposing
`event.id` and `event.date`; fetch any other display fields with a nested `Data`
keyed on `event.id`.

```tsx
import { Timeline } from "components/timeline";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";

<Timeline
  sources={[
    {
      type: "closed_matter",
      query:
        sql`select id, close_date as date from db.matters where contact_id = record_id and close_date is not null`,
      children: (
        <Data
          procedure={(s) => {
            s.defRecord(
              "matter",
              sql`select name from db.matters where id = event.id`,
            );
          }}
        >
          <Timeline.Item icon="Done" iconColor="success-500">
            <Typography level="body-lg">Closed {sql`matter.name`}</Typography>
          </Timeline.Item>
        </Data>
      ),
    },
    {
      type: "payment",
      query: sql`select id, date from db.payments where contact_id = record_id`,
      children: (
        <Data
          procedure={(s) => {
            s.defRecord(
              "payment",
              sql`select cost from db.payments where id = event.id`,
            );
          }}
        >
          <Timeline.Item icon="Receipt" iconColor="success-300">
            <Typography level="body-lg">
              Payment: {sql`format.currency(payment.cost, 'USD')`}
            </Typography>
          </Timeline.Item>
        </Data>
      ),
    },
  ]}
/>;
```

Source queries are plain SQL and can reference the surrounding scope (e.g.
`record_id` inside a `RecordPage`).

## Props

### `Timeline`

| Prop             | Type                | Required | Description                                                                        |
| ---------------- | ------------------- | -------- | ---------------------------------------------------------------------------------- |
| `sources`        | `TimelineSource[]`  | Yes      | Union sources. Must contain at least one entry (throws at generation if empty).     |
| `name`           | `string`            | No       | Name of the timeline table in state. Default `"timeline"`.                          |
| `recordName`     | `string`            | No       | Record variable name during iteration. Default `"event"`.                          |
| `orderField`     | `string`            | No       | Order/date field each source query must select. Default `"date"`.                  |
| `orderDirection` | `"asc" \| "desc"`   | No       | Sort direction. Default `"desc"`.                                                   |
| `rowCount`       | `number`            | No       | Rows loaded per infinite-scroll page. Default `50`.                                 |
| `sx`             | `Style`             | No       | Style overrides merged onto the root flex column.                                   |
| `className`      | `string`            | No       | Class applied to the root element.                                                  |

### `TimelineSource`

| Prop       | Type     | Required | Description                                                                                          |
| ---------- | -------- | -------- | --------------------------------------------------------------------------------------------------- |
| `type`     | `string` | Yes      | Unique discriminator value for this source. Added as the `type` column automatically.               |
| `query`    | `Sql`    | Yes      | Query selecting `id` and the order field (e.g. `date`). Do **not** select a `type` column.           |
| `children` | `Node`   | Yes      | Content rendered for events of this type. Typically a nested `Data` wrapping a `Timeline.Item`.      |

### `Timeline.Item`

| Prop        | Type                    | Required | Description                                                                        |
| ----------- | ----------------------- | -------- | --------------------------------------------------------------------------------- |
| `icon`      | `IconName \| Node`      | Yes      | Material icon name or a custom node, shown in a colored circle.                    |
| `iconColor` | `SimplifiedPaletteVars` | Yes      | Background color of the icon circle (e.g. `"primary-500"`, `"danger-500"`).        |
| `dateExpr`  | `Sql`                   | No       | Date expression for the left date column. Default `event.date`.                    |
| `action`    | `Node`                  | No       | Node rendered to the right of the content (e.g. a dropdown menu).                  |
| `children`  | `Node`                  | Yes      | Item body content.                                                                 |

## How it works

1. **Union construction** — `Timeline` wraps each source query as
   `select id, '<type>' as type, <orderField> as <orderField> from (<query>)`
   and joins them with `union all`, ordering by `orderField`/`orderDirection`.
2. **Pagination** — the query is loaded `rowCount` rows at a time; a document
   scroll handler increments the limit as the user nears the bottom.
3. **Routing** — each row is iterated as the `event` record and matched against
   the source whose `type` equals `event.type`, rendering that source's
   `children`.
4. **Detail fetch** — `event` only carries `id` and the order field. Use a
   nested `Data` whose `s.defRecord` query filters on `event.id` to load the
   rest of the columns a `Timeline.Item` needs.

## `Timeline.Item` behavior

Each item renders, left to right: a formatted date column (`%-d %b` over `%Y`),
the icon inside a colored circle with a connecting line to the next item, the
`children` content, and the optional `action` node. The connecting line is
hidden on the last row.

`Timeline.Item` references the `event` record and `timeline` table directly: the
date defaults to `event.date` (override with `dateExpr`) and the connecting-line
check uses `event.iteration_index` against `select count(*) from timeline`. If
you change `Timeline`'s `name` or `recordName`, those hard-coded references no
longer resolve — keep the defaults unless you only need a custom `dateExpr`.

## Styling

- `icon` accepts a Material `IconName` string or any `Node`; `iconColor` sets the
  circle background from the theme palette.
- Color-code by event type (e.g. payments `success-300`, deletions
  `danger-500`) so rows are scannable.
- `sx` / `className` style the root flex column wrapping all items.

## Common Mistakes

- Hand-writing the union query, `Each`, `Show`, or `Switch`. `Timeline` builds
  all of that from `sources`; you only provide source configs and item content.
- Selecting a `type` column in a source `query`. The discriminator comes from
  the source's `type` prop.
- Forgetting to alias the order column to the `orderField` name (`date` by
  default), e.g. `select id, close_date as date ...`.
- Referencing `event.<field>` for columns not in the union query — only `id` and
  the order field are on `event`; load the rest via a nested `Data`.
- Changing `name` / `recordName` and expecting `Timeline.Item` to follow; its
  date and connecting-line logic target the default `timeline`/`event` names.
