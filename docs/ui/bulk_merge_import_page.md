---
title: BulkMergeImportPage
description: Self-routing CSV/Excel import wizard that merges uploaded rows into a table, inserting new records and updating existing ones matched on a merge field.
tags:
  - ui
  - pages
  - import
  - csv
  - merge
related:
  - ui/page_templates.md
  - ui/datagrid.md
  - ui/form.md
---

# BulkMergeImportPage

BulkMergeImportPage is a self-routing page component that renders a four-step
wizard for importing a CSV or Excel file into a table. It maps spreadsheet
columns to table fields, validates every row, shows a preview with statistics
and errors, and then **merges** the rows: records whose merge-field value
already exists are updated, and rows with new values are inserted.

## Setup

The page relies on a set of enums and a rules function. Register them once from
`core.tsx`, before any app that uses the page is defined:

```tsx
import { addBulkMergeImportEnums } from "pages/bulk_merge_import";

// Register enums/functions required by BulkMergeImportPage.
addBulkMergeImportEnums();
```

`addBulkMergeImportEnums()` is idempotent -- it returns early if the enums are
already registered, so calling it once is enough even if several apps use the
page.

## Import

```tsx
import { BulkMergeImportPage } from "pages/bulk_merge_import";
```

## Basic Usage

```tsx
<BulkMergeImportPage
  path="/import"
  table="customers"
  mergeField="email"
  ignoreFields={["support_rep"]}
  fieldOverrides={{
    name: { constant: true },
    email: { csvImport: true, constant: true },
    phone: { csvImport: true },
  }}
/>
```

BulkMergeImportPage is **self-routing** -- it wraps itself in a `<Route>`. Do
NOT wrap it in another `<Route>` component.

**Default path:** `/{table}/import`, derived from the table's base URL (e.g.
`/customers/import`). Override it with the `path` prop.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `table` | `string` | (required) | Name of the table that rows are merged into. |
| `mergeField` | `string` | (required) | Field used to match CSV rows against existing records. A row whose merge value already exists updates that record; a new value inserts a record. Typically a unique identifier such as `email` or `name`. |
| `path` | `string` | `/{table}/import` | Custom route path for the wizard. |
| `fieldOverrides` | `Record<string, Omit<ImportField, "field">>` | `-` | Per-field configuration, keyed by field name. See [Field configuration](#field-configuration). |
| `ignoreFields` | `string[]` | `-` | Field names to exclude from the wizard entirely. |
| `authorize` | `(s: StateStatements \| UiServerStatements) => void` | `-` | Optional server-side authorization hook run before the page loads, before preview matching, and before import. Throw from this hook to deny access. |
| `afterMerge` | `(s: UiServerStatements) => void` | `-` | Statements run inside the import transaction, after rows are merged. See [The afterMerge hook](#the-aftermerge-hook). |

## Which fields appear

The wizard always includes the `mergeField` first, then every other field on
the table, except:

- fields listed in `ignoreFields`,
- `Bytes` and `Json` fields (always skipped).

Each included field gets an import configuration, which you can adjust per field
with `fieldOverrides`.

## Field configuration

`fieldOverrides` maps a field name to a configuration object. Each object accepts
the following options (this is `ImportField` without its internal `field`):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `csvImport` | `boolean \| CsvImportConfig` | auto (see below) | Whether the field can be populated from a spreadsheet column. `true` enables it with defaults; a `CsvImportConfig` object enables it with custom column matching; `false` disables file import for the field. |
| `constant` | `boolean` | `true` for every field except `mergeField` | Whether the field offers a "Constant" source -- a single value the user types once and applies to every imported row. |
| `neverUpdate` | `boolean` | `false` | When `true`, the field is written only when inserting new records; existing records are never updated for this field. The `mergeField` is never updated regardless of this setting. |

`CsvImportConfig` controls how a spreadsheet column is auto-matched to the field:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headerVariations` | `string[]` | derived from the field name | Extra column-header names (matched case-insensitively, trimmed) that auto-map to this field. The field's own name is always matched. |
| `initialTransform` | `AnyExpr` | `none` | A SQL expression, evaluated against the `header` table, that selects the initial transform applied to the column's values. Valid results are `'none'`, `'extract_first_name'`, and `'extract_last_name'`. |

### Default `csvImport` behavior

When `csvImport` is not specified, file import is enabled for the field unless it
is:

- a `ForeignKey` to a table that cannot be auto-created (see [Foreign
  keys](#foreign-keys)),
- an `Ordering` field, or
- a `Tx` field.

For fields that get auto-mapping, the page also derives sensible
`headerVariations` from the field name (e.g. `first_name` also matches
`first name` and `firstname`) and adds special handling for common columns such
as `phone`, `phone_number`, `email`, `first_name`, and `last_name`. The
`first_name`/`last_name` fields additionally default to an `extract_first_name` /
`extract_last_name` transform when the source column appears to be a combined
full-name column.

### Field source options

At runtime, each field shows a source selector whose options depend on its
configuration:

- `csvImport` enabled adds **From file** (map a spreadsheet column).
- `constant` enabled adds **Constant** (type one value for all rows).
- **None** is always available (leave the field unset / unchanged).

So a field with both `csvImport` and `constant` lets the user choose From file,
Constant, or None; the `mergeField` defaults to `constant: false` because the
merge key must come from the file.

## How the import works

The wizard advances through four steps (shown in a stepper at the top):

1. **Select File** -- the user uploads a `.csv`, `.xlsx`, or `.xls` file. For
   Excel workbooks, they pick a sheet and toggle whether the first row contains
   headers.
2. **Select fields** -- for each table field, choose its source (From file /
   Constant / None), the spreadsheet column, and an optional transform.
3. **Preview** -- choose the [import type](#import-types), review statistics
   (new, existing, ignored, accepted, and error counts), and resolve validation
   errors. Rows with errors can be individually ignored.
4. **Import** -- the merge runs in a single transaction and a success summary
   shows how many records were added and updated.

### Import types

The preview step offers three modes:

| Import type | Behavior |
|-------------|----------|
| `merge` (default) | Create new records and update existing ones. |
| `insert` | Create new records only; rows matching existing records are ignored. |
| `update` | Update existing records only; rows with no match are ignored. |

### Validation

Before the preview, every row is validated. Each problem is recorded as a
validation error of one of these types:

- `missing_merge_field` -- the merge column is empty.
- `duplicate_row` -- the merge value appears more than once in the file.
- `missing_required_field` -- a `notNull` field has no value and no default.
- `invalid_enum` -- the value does not match any enum member.
- `invalid_reference` -- a foreign-key value matches no existing record (and
  cannot be auto-created).
- `invalid_type` -- the value cannot be cast to the field's type.
- `too_long` -- a string value exceeds the field's maximum length.

The import button is blocked while any non-ignored row still has an error.
Rows can be ignored individually, or all rows with validation errors can be
ignored at once with the **Ignore all errors** checkbox.

### Foreign keys

Foreign-key columns are matched to the referenced table by its `name` field. If
the referenced table can be auto-created -- it has a unique `name` constraint
and every other required field has a database default -- missing referenced
rows are inserted automatically during the import. Otherwise, an unknown
reference produces an `invalid_reference` error.

## The afterMerge hook

`afterMerge` runs inside the same transaction as the merge, after the rows have
been inserted/updated and before the result counts are computed. Use it for
derived writes that must be atomic with the import:

```tsx
<BulkMergeImportPage
  table="contacts"
  mergeField="email"
  afterMerge={(s) => {
    // Runs in the import transaction, after rows are merged.
    s.modify(sql`update db.contacts set imported_at = now() where imported_at is null`);
  }}
/>
```

## Common Patterns

### Minimal import

With no overrides, every importable field is auto-mapped and the merge field is
file-only:

```tsx
<BulkMergeImportPage table="contacts" mergeField="email" />
```

### Custom column matching

Map messy real-world spreadsheet headers to your fields with `headerVariations`:

```tsx
<BulkMergeImportPage
  table="clients"
  mergeField="name"
  path="/clients/import"
  fieldOverrides={{
    name: {
      csvImport: {
        headerVariations: ["name", "company name", "company"],
      },
    },
    phone: {
      csvImport: {
        headerVariations: ["phone", "phone number", "phone 1"],
      },
    },
  }}
/>
```

### Splitting a full-name column

Use `initialTransform` to split a combined name column into first/last name
fields when no dedicated columns are present:

```tsx
<BulkMergeImportPage
  table="client_contacts"
  mergeField="email"
  fieldOverrides={{
    first_name: {
      csvImport: {
        headerVariations: ["first name", "name", "contact name"],
        initialTransform: sql`case
          when exists (select 1 from header where lower(trim(value)) in ('first_name', 'first name', 'firstname')) then 'none'
          else 'extract_first_name'
        end`,
      },
    },
    last_name: {
      csvImport: {
        headerVariations: ["last name", "name", "contact name"],
        initialTransform: sql`case
          when exists (select 1 from header where lower(trim(value)) in ('last_name', 'last name', 'lastname')) then 'none'
          else 'extract_last_name'
        end`,
      },
    },
  }}
/>
```

### Insert-only fields

Set `neverUpdate` for fields that should be written when creating records but
left untouched on existing ones (for example, a creation source):

```tsx
<BulkMergeImportPage
  table="leads"
  mergeField="email"
  fieldOverrides={{
    source: { constant: true, neverUpdate: true },
  }}
/>
```

## See Also

- [Solution Page Templates](./page_templates.md) - Reference table for all routed page templates
- [DatagridPage](./datagrid.md) - Table CRUD where imports usually land
- [Form](./form.md) - For custom single-record mutation flows
</content>
</invoke>
