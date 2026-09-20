---
title: Autocomplete & Select Components
description: Components for selecting values from lists — searchable comboboxes, database-backed selects, and static option selects.
tags:
  - ui
  - components
  - autocomplete
  - combobox
  - select
---

# Autocomplete & Select Components

Yolm provides several components for selecting values from lists. They range from a low-level searchable combobox to high-level table-aware selects.

| Component | Import | Use Case |
|-----------|--------|----------|
| `QueryCombobox` | `components/query_combobox` | Searchable text input with database-backed results |
| `TableRecordSelect` | `components/table_record_select` | Select a record from a database table (auto-configured) |
| `EachSelect` | `components/each_select` | Dropdown select over a table visible in the surrounding query/state scope |
| `Select` | `components/select` | Static option dropdown (like an HTML `<select>`) |

## QueryCombobox

A searchable combobox that fetches results from a query. The user types into a text input, and matching results appear in a dropdown list. This is the core autocomplete component.

```tsx
import { QueryCombobox } from "components/query_combobox";
```

### Basic Usage

```tsx
<QueryCombobox
  placeholder="Search users..."
  populateResultTable={(s, query, resultTable) => {
    s.modify(
      sql`insert into ${resultTable}
        select name as label, rank() over () - 1 as index, id
        from db.users
        where fuzzy_match(${query}, name)
        order by fuzzy_rank_key(${query}, name)
        limit 20`,
    );
  }}
  onSelect={(s, result) => {
    s.setScalar("selected_user_id", sql`${result}.id`);
  }}
  onClear={(s) => {
    s.setScalar("selected_user_id", sql.null);
  }}
  onBlur={() => {}}
/>
```

### How Options Are Loaded

The `populateResultTable` callback is called whenever the dropdown is shown. It receives:

- `s` — a `StateStatements` object for building the query procedure
- `query` — a SQL expression containing the current search text (empty string `''` when the user hasn't changed the input from the last valid selection)
- `resultTable` — a SQL reference to the result table to insert rows into

The result table must have at least these columns:

| Column | Type | Description |
|--------|------|-------------|
| `label` | String | Display text for the option |
| `index` | BigInt | Zero-based row index (`rank() over () - 1`) |
| `id` | BigInt | Unique identifier for the option |

You can add extra columns by using `resultTableInferQuery` to let the component infer the schema from a query.

### QueryCombobox Options

Use the exported TypeScript props for the full contract. The important
solution contracts are:

- `populateResultTable`, `onSelect`, `onClear`, and `onBlur` define behavior.
- Result rows must include `label`, `index`, and `id` unless
  `resultTableInferQuery` defines a richer result shape.
- Use `initialInputText` when editing an existing foreign-key value.
- Use `displayItem` for custom rows and `addItem` for create-new flows.

### Keyboard Navigation

QueryCombobox supports full keyboard navigation:

- **ArrowDown / ArrowUp** — Navigate through options
- **Enter / Tab** — Select the highlighted option
- **Typing** — Filters the result list via the `populateResultTable` callback

### Custom Display Items

```tsx
<QueryCombobox
  // ...
  displayItem={({ record }) => (
    <div className="flex items-center gap-2">
      <span className="font-medium">{sql`${record}.label`}</span>
      <span className="text-secondary text-sm">{sql`${record}.code`}</span>
    </div>
  )}
/>
```

### Add Item Dialog

The `addItem` prop lets users create new records directly from the combobox:

```tsx
<QueryCombobox
  // ...
  addItem={{
    component: (props) => (
      <>
        <ListItemDecorator>
          <MaterialIcon icon="Add" />
        </ListItemDecorator>
        Add "{props.query}"
      </>
    ),
    onClick: (s, { openScalar }) => {
      s.setScalar(openScalar, sql.true);
    },
    dialog: (props) => (
      <MyInsertDialog
        open={sql`${props.openScalar}`}
        onConfirm={(s, id, label) => {
          props.onConfirm(s, { id, label });
        }}
      />
    ),
  }}
/>
```

## TableRecordSelect

A high-level component that automatically configures a `QueryCombobox` or `EachSelect` based on a table's schema. It uses the table's `recordDisplayName` and `searchConfig` to build the search query.

```tsx
import { TableRecordSelect } from "components/table_record_select";
```

### Basic Usage

```tsx
<TableRecordSelect
  tableName="clients"
  size="xs"
  onSelectValue={(s, id) => {
    s.setScalar("selected_client_id", id);
  }}
  value={sql`selected_client_id`}
/>
```

### How It Works

`TableRecordSelect` reads the table's `control` configuration (defined in `system.tsx`) to decide which component to render:

- **`"Combobox"` (default)** — Renders a `QueryCombobox` with fuzzy search using the table's `searchConfig`
- **`"Select"`** — Renders an `EachSelect` dropdown with all records
- **`"Custom"`** — Renders a custom component

### TableRecordSelect Options

Use the exported TypeScript props for the full contract. Most uses pass
`tableName`, `value`, and `onSelectValue`. Add `where` to filter available
records, `placeholder` for display text, and `disableDialogInsert` when users
must not create records from the selector.

## EachSelect

A dropdown select that iterates over a table visible in the surrounding
query/state scope. It is commonly used with a local `Data` table populated from
database rows. It does not auto-discover database-table search metadata like
`TableRecordSelect`.

```tsx
import { EachSelect } from "components/each_select";
```

### Basic Usage

```tsx
// Assuming a "record" table exists in the surrounding Data/query scope
<EachSelect
  table="record"
  optionLabel="label"
  optionValue="id"
  value={sql`selected_id`}
  onChange={(s, id) => {
    s.setScalar("selected_id", id);
  }}
/>
```

### EachSelect Options

Use the exported TypeScript props for the full contract. Most uses pass
`table`, `optionLabel`, `optionValue`, `value`, and `onChange`. Add `where`,
`orderBy`, or `limit` only when the scoped table needs filtering.

## Select

A static dropdown for predefined options, similar to an HTML `<select>`. Options are defined at generation time.

```tsx
import { Select } from "components/select";
```

### Basic Usage

```tsx
<Select
  value={sql`selected_status`}
  onInput={(s, value) => {
    s.setScalar("selected_status", value);
  }}
>
  <Select.Option value="active">Active</Select.Option>
  <Select.Option value="inactive">Inactive</Select.Option>
  <Select.Option value="pending">Pending</Select.Option>
</Select>
```

### With Enums

```tsx
<Select
  enumName="status"
  value={sql`selected_status`}
  onInput={(s, value) => {
    s.setScalar("selected_status", value);
  }}
>
  <Select.Option value="active">Active</Select.Option>
  <Select.Option value="inactive">Inactive</Select.Option>
</Select>
```

### Select Options

Use the exported TypeScript props for the full contract. Most uses pass
`value`, `onInput` or `onChange`, and `Select.Option` children. Use `enumName` when
binding options to a Yolm enum.

## Choosing the Right Component

| Scenario | Component |
|----------|-----------|
| Static list of options known at generation time | `Select` |
| Select from an already-loaded UI state table (< 100 records) | `EachSelect` |
| Select from a large database table with search | `QueryCombobox` |
| Select a record from a table with auto-configuration | `TableRecordSelect` |

## Real-World Examples

### QueryCombobox with Fuzzy Search

```tsx
<QueryCombobox
  placeholder="Search client..."
  className="w-48"
  size="sm"
  initialInputText={sql`initial_text`}
  populateResultTable={(s, query, resultTable) => {
    s.conditional({
      condition: sql`trim(${query}) = ''`,
      then: (s) => {
        s.modify(
          sql`insert into ${resultTable}
            select name as label, rank() over () - 1 as index, id
            from db.clients order by id desc limit 50`,
        );
      },
      else: (s) => {
        s.modify(
          sql`insert into ${resultTable}
            select name as label, rank() over () - 1 as index, id
            from db.clients
            where fuzzy_match(${query}, name)
            order by fuzzy_rank_key(${query}, name)
            limit 50`,
        );
      },
    });
  }}
  onSelect={(s, result) => {
    s.setScalar("client_id", sql`${result}.id`);
  }}
  onClear={(s) => {
    s.setScalar("client_id", sql.null);
  }}
  onBlur={() => {}}
/>
```

### TableRecordSelect in a Form

```tsx
<FormControl>
  <FormLabel>Client</FormLabel>
  <TableRecordSelect
    tableName="clients"
    value={sql`client_id`}
    onSelectValue={(s, id) => {
      s.setScalar("client_id", id);
    }}
    size="sm"
    placeholder="Search clients..."
  />
</FormControl>
```

### EachSelect with Pre-loaded Data

```tsx
<Data procedure={(s) => {
  s.defTable("statuses", sql`select id, label from db.statuses order by label`);
}}>

<EachSelect
  table="statuses"
  optionLabel="label"
  optionValue="id"
  value={sql`selected_status_id`}
  onChange={(s, id) => {
    s.setScalar("selected_status_id", id);
  }}
/>

</Data>
```

## Common Mistakes

```tsx
// ❌ WRONG - color and variant cannot be SQL expressions
<QueryCombobox color={sql`'primary'`} variant={sql`'soft'`} />

// ✅ CORRECT - use static strings
<QueryCombobox color="primary" variant="soft" />

// ❌ WRONG - forgetting to provide onClear and onBlur for QueryCombobox
<QueryCombobox
  populateResultTable={...}
  onSelect={...}
/>

// ✅ CORRECT - populateResultTable, onSelect, onClear, and onBlur are all required
<QueryCombobox
  populateResultTable={...}
  onSelect={...}
  onClear={(s) => { s.setScalar("value", sql.null); }}
  onBlur={() => {}}
/>

// ❌ WRONG - using QueryCombobox when TableRecordSelect would auto-configure
<QueryCombobox
  populateResultTable={(s, query, resultTable) => {
    // manually building what TableRecordSelect does automatically
  }}
/>

// ✅ CORRECT - use TableRecordSelect for standard table lookups
<TableRecordSelect tableName="clients" value={sql`client_id`} />
```
