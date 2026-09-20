---
title: Reusable UI Helpers
description: Small reusable components for page headers, boolean display, status chips, and XML payload inspection.
tags:
  - ui
  - components
  - helpers
  - operational
related:
  - ui/solution_components.md
  - ui/modal.md
  - services/soap.md
---

# Reusable UI Helpers

These helpers live in `packages/components` and are intended for custom
operational pages that are too specific for a page template but still need
consistent display patterns.

## PageTitleHeader

`PageTitleHeader` wraps `PageHeader` with a typography title and optional
actions. It inherits sidebar-trigger behavior from `PageHeader`.

```tsx
import { PageTitleHeader } from "components/page_header";
import { Button } from "components/button";

<PageTitleHeader
  title="Invoice Review"
  actions={<Button startIcon="Add">New Invoice</Button>}
/>;
```

Use `level` when a panel needs a smaller title such as `"title-lg"`.

## Boolean And Field Display

Use `BooleanIcon` for compact true/false display and `FieldRow` /
`BoolFieldRow` for custom record detail layouts.

```tsx
import { BooleanIcon, FieldRow, BoolFieldRow } from "components/field_display";
import { sql } from "std/sql_utils";

<BooleanIcon expr={sql`record.active`} />;

<FieldRow label="Reference" value={sql`record.reference`} />;
<BoolFieldRow label="Verified" field="verified" />;
```

`FieldRow` can render explicit `value` / `children`, or a legacy-style
`field` prop that resolves to `record.<field>`.

## StatusChip

`StatusChip` centralizes conditional chip labels and styles while leaving the
status vocabulary in the app.

```tsx
import { StatusChip } from "components/status_chip";
import { sql } from "std/sql_utils";

<StatusChip
  fallbackLabel={sql`status`}
  cases={[
    {
      when: sql`status = 'draft'`,
      label: "Draft",
      variant: "soft",
      color: "neutral",
    },
    {
      when: sql`status = 'paid'`,
      label: "Paid",
      variant: "solid",
      color: "success",
    },
  ]}
/>;
```

Keep cases mutually exclusive. The component applies the matching
`conditionalVariants` to the underlying `Chip`. If a case omits `label`, it
uses `fallbackLabel`.

## XmlPayloadModal

`XmlPayloadModal` displays XML from any SQL expression. It must be rendered in
a `Data` scope that owns the modal open scalar and any selection scalar used by
the payload query.

```tsx
import { XmlPayloadModal } from "components/xml_payload_viewer";
import { Data } from "std/data";
import { sql } from "std/sql_utils";

<Data
  local
  procedure={(s) => {
    s.defScalar("show_xml_modal", sql.false);
    s.defScalar("selected_message_id", sql`null::bigint`);
  }}
>
  <XmlPayloadModal
    bindScalar="show_xml_modal"
    watch={[sql`selected_message_id`]}
    payload={sql`
      select payload
      from db.integration_messages
      where id = selected_message_id
    `}
  />
</Data>;
```

The modal escapes XML for inline display and can open the raw XML in a browser
tab through the shared `xml_viewer` JS module.
