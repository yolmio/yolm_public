---
title: Table form controls
description: Configure the default form control used to pick records from a table.
tags:
  - database
  - ui
  - controls
  - combobox
  - select
---

# Table form controls

When a foreign-key field is rendered in a form, the framework needs to
know what kind of picker to show. `TableBuilder.setFormControl(...)`
configures the default for a table; auto-generated forms and the
`<TableRecordSelect>` / `RecordSelectDialog` picker components use it.

The three options:

1. **`"Select"`** — a plain `<select>` element. Best for tables with a
   short, stable list of rows.
2. **`"Combobox"`** — an autocomplete combobox. Best when the user
   needs to search or when the list is too long for a plain select.
3. **A custom render function** — for fully bespoke pickers.

## Plain select

```typescript
db.table("country", (t) => {
  t.string("code", 2).notNull().unique();
  t.string("name", 100).notNull();
  t.setFormControl("Select");
});
```

## Combobox with extra options

The string `"Combobox"` is a shorthand for a default
[`TableComboboxControl`](../../packages/std/system.tsx). Pass an object to
configure it further:

```typescript
db.table("client", (t) => {
  t.string("name", 200).notNull();
  t.setFormControl({
    type: "Combobox",
    where: sql`active`,
    limit: 100,
    dialogInsert: true,
    displayItem: ({ record }) => (
      <Stack direction="row" gap={1}>
        <Avatar text={sql`${record}.name`} />
        <Typography>{sql`${record}.name`}</Typography>
      </Stack>
    ),
  });
});
```

- `where` — restrict the queryable rows.
- `limit` — cap result count (default 50).
- `dialogInsert` — include a "create new" entry that opens an insert
  dialog.
- `displayItem` — custom renderer for each row.

## Custom control

Pass a function to drop in a fully custom picker. It receives a
[`TableControlOpts`](../../packages/std/system.tsx) prop with the value,
selection callback, and metadata it needs:

```typescript
t.setFormControl((opts) => (
  <MyTeamPicker value={opts.value} onSelect={opts.onSelectValue} />
));
```

## Related

- [Auto dialogs](../ui/auto_dialogs.md) — uses these controls automatically
- [Autocomplete](../ui/autocomplete.md) — combobox primitive
- [Custom form controls](./custom_form_controls.md)
