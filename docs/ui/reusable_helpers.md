---
title: Reusable UI Helpers
description: Usage details for small display helpers without their own page - BooleanIcon, FieldRow, StatusChip, and XmlPayloadModal.
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

Usage details for small display helpers used on custom operational pages.
Every helper is listed in the [component catalog](./solution_components.md);
`PageTitleHeader` is documented in [PageHeader](./page_header.md#pagetitleheader).

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

`FieldRow` renders `value` / `children`, or a legacy `field` prop that
resolves to `record.<field>` (`field` wins when set). `BooleanIcon` accepts
`trueIcon` / `falseIcon` and `trueClassName` / `falseClassName`; `BoolIcon` is
a backward-compatible alias. `BoolDisplay` shows a label plus icon for an
arbitrary `expr` or `field`.

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

Keep cases mutually exclusive. The matching case's `variant` / `color` are
applied to the underlying `Chip` as conditional variants; a case without
`label`, `variant`, or `color` uses the parent `fallbackLabel`, `variant`, or
`color` (defaults `soft` / `neutral`, `size` `sm`), which also render when no
case matches.

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

The modal escapes XML for inline display and, unless `openInBrowser={false}`,
can open the raw XML in a browser tab through the shared `xml_viewer` JS
module. Set `scalarPrefix` when several viewers share one scope.
