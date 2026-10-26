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

`Timeline` renders a chronological activity feed merged from several tables.
Each entry in `sources` contributes a query and the content for that event
type; the component builds the `union all`, orders it, loads it with infinite
scroll, and routes each row to its source's content. `Timeline.Item` renders
one row (date, icon, connecting line, content).

```tsx
import { Timeline } from "components/timeline";
```

## Event Rows Carry Only `id` and the Date

`Timeline` wraps each source as
`select id, '<type>' as type, <orderField> from (<query>)`, so the `event`
record has only `id`, `type`, and the order field (`date` by default). Extra
columns selected in a source query are dropped. Do not select `type`
yourself, and alias the order column (`close_date as date`).

Because of this, a feed that shows per-event details has two options.

### Display columns in one query (preferred)

Compute display values in the feed query and render rows with `Each`,
`Switch`, and `Timeline.Item`. `Timeline.Item` also works outside `Timeline`,
reading the `event` record and the `timeline` table by default:

```tsx
<Data
  procedure={(s) => {
    s.defTable("timeline", sql`
      select id, 'closed_matter' as type, close_date as date,
        name as title, cast(null as string) as detail
      from db.matters
      where contact_id = ui.record_id and close_date is not null
      union all
      select id, 'payment' as type, date,
        'Payment' as title, format.currency(cost, 'USD') as detail
      from db.payments
      where contact_id = ui.record_id
      order by date desc
      limit 100
    `);
  }}
>
  <Each table="timeline" recordName="event">
    <Switch>
      <Match when={sql`event.type = 'closed_matter'`}>
        <Timeline.Item icon="Done" iconColor="success-500">
          <Typography level="body-lg">Closed {sql`event.title`}</Typography>
        </Timeline.Item>
      </Match>
      <Match when={sql`event.type = 'payment'`}>
        <Timeline.Item icon="Receipt" iconColor="success-300">
          <Typography level="body-lg">
            {sql`event.title || ': ' || event.detail`}
          </Typography>
        </Timeline.Item>
      </Match>
    </Switch>
  </Each>
</Data>
```

This is one query regardless of row count, but it has a fixed `limit` instead
of infinite scroll.

### `Timeline` with infinite scroll

`Timeline` adds document-scroll paging (`rowCount` rows per page, default
50). Any field beyond `id` and the date must be looked up per event, which
runs one query per loaded row:

```tsx
<Timeline
  sources={[
    {
      type: "payment",
      query: sql`select id, date from db.payments where contact_id = ui.record_id`,
      children: (
        <Data
          procedure={(s) => {
            s.defRecord("payment", sql`
              select format.currency(cost, 'USD') as amount
              from db.payments where id = event.id
            `);
          }}
        >
          <Timeline.Item icon="Receipt" iconColor="success-300">
            <Typography level="body-lg">Payment: {sql`payment.amount`}</Typography>
          </Timeline.Item>
        </Data>
      ),
    },
  ]}
/>
```

Use it when paging matters more than per-row lookups, or when items need only
the date.

## Props

`Timeline`: `sources` (at least one; throws at generation if empty),
`orderDirection` (default `"desc"`), `rowCount` (default `50`), `orderField`
(default `"date"`), `name` (state table, default `"timeline"`), `recordName`
(default `"event"`), plus `sx`/`className` on the root flex column.
`Timeline.Item` reads `name`, `recordName`, and `orderField` from its parent
`Timeline`, so renaming them is safe.

`Timeline.Item`:

- `icon`: Material `IconName` or any node, in a colored circle.
- `iconColor`: a static palette token such as `"primary-500"` or
  `"danger-500"` for the circle background.
- `dateExpr`: date shown on the left (`%-d %b` over `%Y`); default is the
  record's order field.
- `action`: node rendered right of the content (e.g. a menu).

The connecting line is hidden on the last row. See `TimelineProps`,
`TimelineSource`, and `TimelineItemProps` in `components/timeline`.
