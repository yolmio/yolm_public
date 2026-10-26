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

A self-routing, four-step wizard that imports a CSV or Excel file into a table.
It maps spreadsheet columns to fields, validates every row, previews the result,
and **merges** the rows: records whose `mergeField` value already exists are
updated, and new values are inserted.

```tsx
import { addBulkMergeImportEnums, BulkMergeImportPage } from "pages/bulk_merge_import";

// core.tsx (optional): the page also calls this itself; it is idempotent.
addBulkMergeImportEnums();

<BulkMergeImportPage
  table="customers"
  mergeField="email"
  ignoreFields={["support_rep"]}
  fieldOverrides={{
    phone: { csvImport: { headerVariations: ["phone number", "phone 1"] } },
    source: { constant: true, neverUpdate: true },
  }}
  afterMerge={(s) => {
    s.modify(sql`update db.customers set imported_at = now() where imported_at is null`);
  }}
/>
```

The page wraps itself in a `<Route>`; do not wrap it in another. The default
path is `/{table base url}/import` (for example `/customers/import`), and the
default document title is `Import <table display name>`. Override them with
`path` and `title`.

## Props

See `BulkMergeImportProps` in `pages/bulk_merge_import` for the full contract.
The non-obvious props:

- `mergeField`: matches file rows to existing records. It always appears first
  in the wizard, must come from the file (`constant` defaults to `false`), and
  is never updated unless `matching` is set.
- `ignoreFields`: fields left out of the wizard. `Bytes` and `Json` fields are
  always left out; every other field is included.
- `authorize(s)`: a server-side hook that runs before the page loads, before
  preview matching, and before the import. Throw from it to deny access.
- `afterMerge(s)`: runs inside the import transaction after the rows are
  merged and before the result counts are computed. Use it for derived writes
  that must be atomic with the import.
- `matching`: optional candidate-based matching. See
  [Matching strategies](#matching-strategies).

## Field configuration

`fieldOverrides` maps a field name to `{ csvImport?, constant?, neverUpdate? }`:

| Option | Default | Behavior |
|---|---|---|
| `csvImport` | Enabled, except for `Ordering` and `Tx` fields and foreign keys to tables that cannot be auto-created | Adds the **From file** source. `true` uses the default matching; a `{ headerVariations?, initialTransform? }` object customizes it; `false` disables it. |
| `constant` | `true`, except for `mergeField` | Adds the **Constant** source: one typed value applied to every row. |
| `neverUpdate` | `false` | Writes the field only on insert, never on update. |

Every field also has a **None** source, which leaves it unset or unchanged.

- `headerVariations` lists extra column headers that auto-map to the field,
  matched case-insensitively after trimming. The field's own name always
  matches. By default the page derives variations from the name (for example
  `first_name` also matches `first name` and `firstname`) and adds special
  handling for `phone`, `phone_number`, `email`, `first_name`, and `last_name`.
- `initialTransform` is a SQL expression evaluated against the `header` table.
  It must return `'none'`, `'extract_first_name'`, or `'extract_last_name'`.
  `first_name` and `last_name` already default to the extract transforms when
  the source column looks like a combined full name. To set this up yourself:

```tsx
first_name: {
  csvImport: {
    headerVariations: ["first name", "name", "contact name"],
    initialTransform: sql`case
      when exists (select 1 from header where lower(trim(value)) in ('first_name', 'first name', 'firstname')) then 'none'
      else 'extract_first_name'
    end`,
  },
},
```

## Wizard flow

1. **Select File**: upload a `.csv`, `.xlsx`, or `.xls` file. For Excel, pick a
   sheet and choose whether the first row holds headers. When `matching` is
   set, the user also picks a matching strategy here.
2. **Select fields**: pick each field's source, its column, and an optional
   transform.
3. **Preview**: choose the import type, review the counts (new, existing,
   ignored, accepted, errors), and resolve errors. Rows can be ignored one at a
   time, or all at once with **Ignore all errors**. Import stays blocked while
   any row that is not ignored has an error.
4. **Import**: one transaction, followed by an added/updated summary.

| Import type | Behavior |
|---|---|
| `merge` (default) | Insert new records and update existing ones. |
| `insert` | Insert only; rows that match an existing record are ignored. |
| `update` | Update only; rows with no match are ignored. |

Validation error types (enum `csv_import_validation_error_type`):
`missing_merge_field`, `duplicate_row` (the merge value repeats in the file),
`missing_required_field` (a `notNull` field with no value and no default),
`invalid_enum`, `invalid_reference`, `invalid_type`, and `too_long`. With
`matching` set, there are also `missing_match_field` and `ambiguous_match`.

**Foreign keys** match the referenced table's `name` field. If that table can
be auto-created (a unique `name` and defaults for every other required field),
missing referenced rows are inserted during the import. Otherwise an unknown
value is an `invalid_reference` error.

## Matching strategies

Without `matching`, rows match only on an exact `mergeField` value. With
`matching` (`BulkMergeImportMatchingConfig`), the user chooses a strategy and
each strategy enables a set of named rules:

```tsx
matching={{
  defaultStrategy: "identity",
  strategies: [
    { name: "identity", displayName: "Email or phone", rules: ["email", "phone"] },
    { name: "email_only", displayName: "Email only", rules: ["email"] },
  ],
  rules: [
    { name: "email", displayName: "Email", sourceField: "email", normalize: (v) => sql`lower(trim(${v}))` },
    { name: "phone", displayName: "Phone", sourceField: "phone", deduplicateRows: false, priority: 1 },
  ],
}}
```

- A rule compares the normalized `sourceField` from the file with
  `targetField` (which defaults to `sourceField`) on existing records.
- A lower `priority` wins; higher-priority-number rules act only as fallbacks
  for each row.
- `deduplicateRows: false` allows the value to repeat within the file.
- A match on a single-field unique column prevents creating a new record.
- When a row matches more than one record, the preview asks the user to merge
  into one of them, create a new record, or ignore the row. Unresolved rows
  are `ambiguous_match` errors.
- A row with no value for any rule in the selected strategy is a
  `missing_match_field` error.

Invalid rule or strategy names and unknown fields throw at generation time.

## See also

- [Solution Page Templates](./page_templates.md): every routed page template.
- [DatagridPage](./datagrid.md): table CRUD, where imports usually land.
