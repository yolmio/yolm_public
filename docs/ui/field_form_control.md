---
title: FieldFormControl
description: Form helper that renders the correct input control for a table field's type, plus typed per-type control variants, for use inside a Form.
tags:
  - ui
  - components
  - form
  - form-control
related:
  - ui/form.md
  - ui/form_control.md
  - ui/data.md
  - ui/overview.md
---

# FieldFormControl

`FieldFormControl` inspects a table field's model and renders the matching
editor (text, number, date, enum select, foreign-key combobox, switch, and so
on). It is the usual `defaultFieldComponent` behind bare `Form.Field` elements.

```tsx
import { FieldFormControl } from "components/field_form_control";
```

```tsx
<Form defaultFieldComponent={FieldFormControl}>
  <Form.Insert table="entries" values={{ created_at: sql`today()` }}>
    <Form.Field field="title" />
    <Form.Field field="created_at" />
  </Form.Insert>
  <Form.ErrorAlert />
  <Form.SubmitButton>Add new entry</Form.SubmitButton>
</Form>
```

Place it explicitly inside a `Form.Field` to pass per-field options:

```tsx
<Form.Field field="provider_client_id">
  <FieldFormControl size="sm" where={sql`provider and id <> ui.record_id`} />
</Form.Field>
```

## Binding and context

- The field model comes from `useFieldModel()` and the value/error binding from
  `useFieldHelper()`, so it must sit inside a `Form.Field`, or receive both
  `field` (a `Field` model object, not a name string) and `fieldHelper`.
- It renders only the input. Wrap it in `FormControl` + `FormLabel` or
  `LabelOnTopFormField` for labels and validation messages.
- `onChange` runs in addition to writing the value to the field helper.

## Non-obvious props

The dispatcher spreads all props onto the chosen control; props that control
does not declare are ignored.

- `where` / `emptyQuery`, `comboboxNotFoundSnackbar`, `comboboxNoEmptyList`:
  `ForeignKey` picker only.
- `filterVariants: (name) => boolean`: hides `Enum` variants by name.
- `min` / `max`: timestamp controls only. `TimestampNaive` falls back to the
  field model's `min` / `max`.
- `minRows`: multiline `String` and `Json` textareas.
- `fullWidth`: declared but not forwarded to any control (no effect).

See `FieldFormControlProps` in `components/field_form_control` for the full
contract.

## Field-type dispatch

An unsupported field type throws at generation time.

| Field type | Rendered control |
|------------|------------------|
| `String` | `StringFieldFormControl` (Textarea when multiline; email/phone/hex-color adapt by usage) |
| Integer types and `Decimal` | `NumericFieldFormControl` (`decimal` input mode for `Decimal`, else `numeric`; money icon for Money usage, `DurationInput` for Duration usage) |
| `Bool` | `BoolFieldFormControl` (`SwitchControl`, or `EnumLikeSelect` when the field is enum-like) |
| `Enum` | `EnumFieldFormControl` (`SelectTimeZone` for `sys_timezone`, `CountrySelect` for `country`, else `EnumSelect`) |
| `ForeignKey` | `ForeignKeyFieldFormControl` (`TableRecordSelect` combobox) |
| `Date` / `Time` | `DateFieldFormControl` / `TimeFieldFormControl` |
| `TimestampNaive` | `TimestampNaiveFieldFormControl` (`datetime-local`) |
| `TimestampUtc` | `TimestampUtcFieldFormControl` (`datetime-local`, stored at UTC) |
| `TimestampTz` | `TimeStampTzFieldFormControl` (`datetime-local`, stored with time zone) |
| `Uuid` | `UuidFieldFormControl` (text input, max 36 chars) |
| `Tx` | `TxFieldFormControl` (numeric input) |
| `Bytes` | `BytesFieldFormControl` (password input for `Secret` usage; renders nothing otherwise) |
| `Json` | `JsonFieldFormControl` (Textarea editing raw JSON) |
| `PhoneNumber` | `PhoneNumberFieldFormControl` (country-aware phone input) |

Every control in the table is exported for direct use. Used directly,
`ForeignKeyFieldFormControl` requires `table` and `EnumFieldFormControl`
requires `enumName`:

```tsx
<ForeignKeyFieldFormControl table="industries" />
<EnumFieldFormControl enumName="us_state" />
```

### Standalone variants (not dispatched)

These must be placed explicitly:

- `LexicalJsonFieldFormControl`: rich-text editor for Lexical-shaped JSON;
  `showVariables` surfaces the template-variable picker. Use
  `JsonFieldFormControl` for arbitrary JSON.
- `SplitDurationFieldFormControl`: duration with per-unit fields
  (`SplitDurationInput`).
- `TemporaryPhoneNumberFieldFormControl`: phone input without a separate
  country-code field, for temporary forms.

```tsx
<Form.Field field="content_rich_text_json">
  <LexicalJsonFieldFormControl showVariables />
</Form.Field>
```

## Lexical editors outside forms

Outside `Form.Field`, import from `components/lexical/components/lexical_editor`:

```tsx
<RichTextSimpleEditor
  value={sql`ui.draft_body`}
  onChange={(s, value) => s.setScalar("draft_body", value)}
  extendedToolbar
  showVariables
  variables={{ first_name: "First name" }}
/>

<LexicalRichTextDisplay value={sql`email_templates.body_json`} />
```

| Export | Use |
|--------|-----|
| `RichTextSimpleEditor` | General Lexical JSON editor (`value`, `onChange`, `extendedToolbar`, `showVariables`, `variables`, `variableButtonLabel`, `mentions`). |
| `LexicalBasicEmailEditor` | Email-template editor with the full formatting toolbar. |
| `LexicalRichTextDisplay` | Read-only rendering for Lexical JSON. |
| `MentionsConfig` | Type for `@` mention sources. |
| `lexicalRichTextToHtml` | Registers the SQL/JS rich-text-to-HTML support. |
