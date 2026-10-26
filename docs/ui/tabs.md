---
title: Tabs
description: Tabs components for organizing content into selectable panels with support for horizontal and vertical orientations.
tags:
  - ui
  - components
  - tabs
  - navigation
---

# Tabs

`Tabs`, `Tabs.List`, `Tabs.Tab`, and `Tabs.Panel` organize content into
selectable panels. `TabsDashboard` is a higher-level wrapper for dashboards.

```tsx
import { Tabs } from "components/tabs";
```

## Example

```tsx
<Tabs selectedTabScalar="customer_tab" defaultValue="details" className="h-full">
  <Tabs.List>
    <Tabs.Tab value="details">Customer Details</Tabs.Tab>
    <Tabs.Tab value="comments">Comments</Tabs.Tab>
    <Tabs.Tab value="history">History</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel value="details" className="h-full overflow-auto p-4">
    <CustomerDetails />
  </Tabs.Panel>
  <Tabs.Panel value="comments" className="h-full overflow-auto p-4">
    <CommentsSection />
  </Tabs.Panel>
  <Tabs.Panel value="history" className="h-full overflow-auto p-4">
    <HistorySection />
  </Tabs.Panel>
</Tabs>
```

## Selection State

Selection is a UI scalar. In uncontrolled mode `Tabs` declares a local scalar
named `selectedTabScalar` (default `"selected_tab"`); clicking a `Tab` sets it
to the tab's `value`, and each `Tabs.Panel` shows when the scalar matches its
`value`. Descendants can read the scalar by name.

- The scalar is initialized from `defaultValue` as a string literal, or to
  `''` when `defaultValue` is omitted, in which case no tab is selected and no
  panel renders until the user clicks a tab. Always pass `defaultValue`.
- `defaultValue={0}` is falsy and also initializes to `''`; prefer string tab
  values (`"details"`) over numeric ones.
- Static `value` strings and numbers become SQL literals; a `value` may also
  be any SQL expression (`sql.lit\`script\``).

For external control, pass `value` (a SQL expression) and `onValueChange`,
which receives the clicked tab's value expression. No internal state is
created.

```tsx
<Data procedure={(s) => s.defScalar("selected_tab", { expr: sql.lit`details` })}>
  <Tabs
    value={sql`selected_tab`}
    onValueChange={(s, value) => s.setScalar("selected_tab", value)}
  >
    ...
  </Tabs>
</Data>
```

`Tabs.Panel` mounts its children only while active (it renders through
`Show`). Set `keepMounted` to mount immediately and hide inactive panels
without discarding their internal state.

## Non-Obvious Props

`variant` (default `"plain"`), `color` (default `"neutral"`), and `size`
(default `"md"`) follow the shared
[styling props](./styling.md#color-variant-and-size).

- `Tabs`: `orientation="vertical"` for side navigation; `idBase` seeds the
  generated ARIA ids.
- `Tabs.List`: `tabFlex` sets flex on every tab (`1` for equal widths);
  `disableUnderline`; `underlinePlacement` (default `bottom`, or `right` when
  vertical). The indicator thickness is the `--tab-indicator-thickness` CSS
  variable (for example `sx={{ "--tab-indicator-thickness": "3px" }}`).
- `Tabs.Tab`: extends `ListItemButtonProps` (including `href`);
  `selectedColor` and `selectedVariant` style the active tab;
  `disableIndicator`, `indicatorInset`, `indicatorPlacement`.

ARIA roles (`tablist`, `tab` with `aria-selected`, `tabpanel`) are set
automatically. See `components/tabs` for the full prop types.

## TabsDashboard

```tsx
import { TabsDashboard } from "components/tabs_dashboard";

<TabsDashboard
  selectedTabScalar="dashboard_tab"
  color="primary"
  tabs={[
    { label: "Overview", value: "overview", content: <OverviewContent /> },
    { label: "Reports", value: "reports", content: <ReportsContent />, color: "success" },
  ]}
/>
```

Each tab is `{ label, value, content, color? }`; `color` (default
`"primary"`) becomes each tab's `selectedColor`. Also accepts `variant`,
`orientation`, `sx`, and `idBase`. `TabsDashboard` does not accept
`defaultValue`, so no tab is selected until the user clicks one.
