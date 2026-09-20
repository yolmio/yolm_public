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

The Tabs system provides components for organizing content into tabbed panels: `Tabs`, `Tabs.List`, `Tabs.Tab`, and `Tabs.Panel`.

```tsx
import { Tabs } from "components/tabs";
```

There is also a higher-level `TabsDashboard` wrapper for quick dashboard layouts:

```tsx
import { TabsDashboard } from "components/tabs_dashboard";
```

## Basic Usage

```tsx
<Tabs selectedTabScalar="selected_tab">
  <Tabs.List>
    <Tabs.Tab value={0}>First</Tabs.Tab>
    <Tabs.Tab value={1}>Second</Tabs.Tab>
    <Tabs.Tab value={2}>Third</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel value={0} className="p-4">
    First panel content
  </Tabs.Panel>
  <Tabs.Panel value={1} className="p-4">
    Second panel content
  </Tabs.Panel>
  <Tabs.Panel value={2} className="p-4">
    Third panel content
  </Tabs.Panel>
</Tabs>
```

## How Tab Selection Works

Tab selection is driven by a UI scalar. In uncontrolled mode, `Tabs`
creates a local scalar named by `selectedTabScalar` and clicking a `Tab`
sets that scalar to the tab's `value`. Each `TabPanel` is shown only
when the scalar matches its `value`.

If you omit `selectedTabScalar`, the local scalar is named
`selected_tab` and initializes to an empty string unless you pass
`defaultValue`. If you need to control the scalar yourself, use
`value` and `onValueChange`:

```tsx
<Data procedure={(s) => s.defScalar("selected_tab", { expr: sql.lit`details` })}>
  <Tabs
    value={sql`selected_tab`}
    onValueChange={(s, value) => s.setScalar("selected_tab", value)}
  >
    <Tabs.List>
      <Tabs.Tab value="details">Details</Tabs.Tab>
      <Tabs.Tab value="comments">Comments</Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="details" className="p-4">
      <DetailsContent />
    </Tabs.Panel>
    <Tabs.Panel value="comments" className="p-4">
      <CommentsContent />
    </Tabs.Panel>
  </Tabs>
</Data>
```

Tab values are typically numeric (`0`, `1`, `2`, ...) but can also be SQL expressions such as string literals:

```tsx
<Tabs.Tab value={sql.lit`script`}>Script Embed</Tabs.Tab>
<Tabs.Tab value={sql.lit`iframe`}>iFrame Embed</Tabs.Tab>

<Tabs.Panel value={sql.lit`script`} className="p-4">...</Tabs.Panel>
<Tabs.Panel value={sql.lit`iframe`} className="p-4">...</Tabs.Panel>
```

## Props

### Tabs

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `selectedTabScalar` | `string` | `"selected_tab"` | Name of the UI scalar that tracks the selected tab |
| `defaultValue` | `string \| number` | - | Initial selected tab value (uncontrolled mode) |
| `value` | `Sql` | - | Controlled selected-tab expression; when set, `Tabs` creates no internal state |
| `onValueChange` | `ChangeEventHandlerFn` | - | Called with the clicked tab's value expression (controlled mode) |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Layout direction |
| `size` | `Size` | `"md"` | Size: "xs", "sm", "md", "lg" |
| `color` | `Color` | `"neutral"` | Theme color: "primary", "neutral", "danger", "success", "warning" |
| `variant` | `Variant` | `"plain"` | Style variant: "plain", "outlined", "soft", "solid" |
| `idBase` | `string` | auto | Base string for generating accessible IDs |
| `component` | `ElementType` | `"div"` | Override the root HTML element |
| `className` | `string` | - | Tailwind classes |

**Important**: `color` and `variant` are generation-time strings only, not SQL expressions.

### Tabs.List

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `disableUnderline` | `boolean` | `false` | Remove the underline divider |
| `underlinePlacement` | `"left" \| "right" \| "bottom" \| "top"` | horizontal: `"bottom"`; vertical: `"right"` | Position of the underline |
| `tabFlex` | `string \| number` | - | Set flex value on all child tabs (e.g., `1` for equal width) |
| `component` | `ElementType` | `List` | Override the root element |
| `className` | `string` | - | Tailwind classes |

### Tabs.Tab

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string \| number \| Sql` | **required** | The value that identifies this tab |
| `disableIndicator` | `boolean` | `false` | Hide the active tab indicator |
| `indicatorInset` | `boolean` | `false` | Inset the indicator within padding |
| `indicatorPlacement` | `"left" \| "right" \| "bottom" \| "top"` | horizontal: `"bottom"`; vertical: `"right"` | Position of the active indicator |
| `selectedVariant` | `Variant` | - | Variant to apply when selected |
| `selectedColor` | `Color` | - | Color to apply when selected |
| `variant` | `Variant` | inherited | Style variant (inherits from Tabs) |
| `color` | `Color` | inherited | Theme color (inherits from Tabs) |
| `component` | `ElementType` | `ListItemButton` | Override the root element |
| `className` | `string` | - | Tailwind classes |

Tabs.Tab also accepts all `ListItemButtonProps` (such as `href`, `variant`, `color`, etc.).

### Tabs.Panel

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string \| number \| Sql` | **required** | The value that identifies which tab shows this panel |
| `component` | `ElementType` | `"div"` | Override the root element |
| `className` | `string` | - | Tailwind classes |

Tabs.Panel uses a `Show` component internally, so its children are only rendered when the panel is active.

## Common Patterns

### Detail Page with Tabs

A typical record detail view with multiple tabbed sections:

```tsx
<Tabs selectedTabScalar="selected_tab" defaultValue="details" className="h-full">
  <div className="flex items-center">
    <Tabs.List className="flex-1">
      <Tabs.Tab value="details">Customer Details</Tabs.Tab>
      <Tabs.Tab value="comments">Comments</Tabs.Tab>
      <Tabs.Tab value="history">History</Tabs.Tab>
    </Tabs.List>
  </div>

  <Tabs.Panel value="details" className="p-4 h-full overflow-auto">
    <CustomerDetails />
  </Tabs.Panel>
  <Tabs.Panel value="comments" className="p-4 h-full overflow-auto">
    <CommentsSection />
  </Tabs.Panel>
  <Tabs.Panel value="history" className="p-4 h-full overflow-auto">
    <HistorySection />
  </Tabs.Panel>
</Tabs>
```

### Vertical Tabs

Use `orientation="vertical"` for side navigation style tabs:

```tsx
<Tabs selectedTabScalar="selected_tab" orientation="vertical">
  <Tabs.List>
    <Tabs.Tab value={0}>General</Tabs.Tab>
    <Tabs.Tab value={1}>Notifications</Tabs.Tab>
    <Tabs.Tab value={2}>Security</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel value={0} className="p-4">
    <GeneralSettings />
  </Tabs.Panel>
  <Tabs.Panel value={1} className="p-4">
    <NotificationSettings />
  </Tabs.Panel>
  <Tabs.Panel value={2} className="p-4">
    <SecuritySettings />
  </Tabs.Panel>
</Tabs>
```

### Styled Tabs with Selected Color

Customize the active tab appearance with `selectedColor`:

```tsx
<Tabs selectedTabScalar="selected_tab">
  <Tabs.List sx={{ "--tab-indicator-thickness": "3px" }}>
    <Tabs.Tab value={0} className="py-2 flex-initial" selectedColor="primary">
      Details
    </Tabs.Tab>
    <Tabs.Tab value={1} className="py-2 flex-initial" selectedColor="primary">
      Notifications
    </Tabs.Tab>
    <Tabs.Tab value={2} className="py-2 flex-initial" selectedColor="primary">
      Agents
    </Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel value={0} className="p-4">...</Tabs.Panel>
  <Tabs.Panel value={1} className="p-4">...</Tabs.Panel>
  <Tabs.Panel value={2} className="p-4">...</Tabs.Panel>
</Tabs>
```

### TabsDashboard (High-Level Wrapper)

For dashboard-style layouts with minimal boilerplate:

```tsx
import { TabsDashboard } from "components/tabs_dashboard";

<TabsDashboard
  selectedTabScalar="dashboard_tab"
  color="primary"
  tabs={[
    { label: "Overview", value: 0, content: <OverviewContent /> },
    { label: "Analytics", value: 1, content: <AnalyticsContent /> },
    { label: "Reports", value: 2, content: <ReportsContent />, color: "success" },
  ]}
/>
```

`TabsDashboard` accepts:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tabs` | `DashboardTabConfig[]` | **required** | Array of tab configurations |
| `selectedTabScalar` | `string` | **required** | UI scalar name for selection |
| `variant` | `Variant` | `"plain"` | Style variant |
| `color` | `Color` | `"primary"` | Default color for tabs |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Layout direction |
| `sx` | `Style` | - | Additional styles |
| `idBase` | `string` | auto | Base string for accessible IDs |

Each `DashboardTabConfig` has: `label` (Node), `value` (string | number), `content` (Node), and optional `color` (Color).

## Accessibility

The Tabs components set ARIA roles automatically:

- `Tabs.List` gets `role="tablist"`
- Each `Tabs.Tab` gets `role="tab"` plus `aria-selected`
- Each `Tabs.Panel` gets `role="tabpanel"`
