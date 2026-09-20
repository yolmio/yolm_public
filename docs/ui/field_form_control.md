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
input control (text, number, date, enum select, foreign-key combobox, boolean
switch, and so on). It is the default control behind `Form.Field`: set it once
on a `Form` and every `Form.Field` without explicit children renders the right
editor automatically.

It must run inside a Form field context. When `field` is omitted it reads the
field model from `useFieldModel()`, and the chosen control resolves its value
binding from `useFieldHelper()`, so place it inside a `Form.Field` (or pass
`field` and `fieldHelper` explicitly). It does not render a label or helper
text - pair it with a labeled field layout (e.g. `FormControl` / `FormLabel`,
or `LabelOnTopFormField`).

```tsx
import { FieldFormControl } from "components/field_form_control";
```

## Usage

The common pattern is to register it as a form's `defaultFieldComponent`, then
let bare `Form.Field` elements render it:

```tsx
import { Form } from "std/form";
import { FieldFormControl } from "components/field_form_control";

<Form defaultFieldComponent={FieldFormControl}>
  <Form.Insert table="entries" values={{ created_at: sql`today()` }}>
    <Form.Field field="title" />
    <Form.Field field="created_at" />
  </Form.Insert>
  <Form.ErrorAlert />
  <Form.SubmitButton>Add new entry</Form.SubmitButton>
</Form>
```

You can also place it explicitly inside a `Form.Field` render function to pass
per-field options such as `size` or a relation `where` clause:

```tsx
<Form.Field field="provider_client_id">
  {() => (
    <FieldRow label="Provider Client ID">
      <FieldFormControl
        size="sm"
        where={sql`provider and id <> ui.record_id`}
      />
    </FieldRow>
  )}
</Form.Field>
```

(`FieldRow` above is a project-local layout component, not part of this
component's API.)

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `field` | `Field` | No | Field model to render. Resolved from the surrounding form context when omitted. |
| `fieldHelper` | `FormFieldHelper` | No | Overrides the field value/error helper resolved from context. |
| `size` | `Size` | No | Control size (`xs` / `sm` / `md` / `lg`). Defaults to `md` in the underlying controls. |
| `onChange` | `ChangeEventHandlerFn` | No | Extra handler called with the new value in addition to writing it to the field helper. |
| `required` | `boolean` | No | Marks the underlying control required. |
| `placeholder` | `string \| Sql` | No | Placeholder for text and relation-picker controls. |
| `id` | `Sql \| string` | No | Element id. Defaults to the surrounding form-control id or a generated id. |
| `className` | `string` | No | Class names for the rendered control. |
| `sx` | `Style` | No | Inline style object for the rendered control. |
| `fullWidth` | `boolean` | No | Present on the props interface but not forwarded to any rendered control today (no visible effect). |
| `endDecorator` | `Node` | No | Trailing decorator node (string/number/date/enum/foreign-key/bool/phone controls). |
| `immediateFocus` | `boolean` | No | Focus the control on mount. |
| `where` | `Sql` | No | WHERE clause limiting rows offered by a `ForeignKey` picker. |
| `emptyQuery` | `Sql` | No | Query populating the empty/placeholder state of a `ForeignKey` picker. |
| `comboboxNotFoundSnackbar` | `Node` | No | Snackbar content shown when a foreign-key combobox search has no match. |
| `comboboxNoEmptyList` | `boolean` | No | Suppress the empty-list state in a foreign-key combobox. |
| `filterVariants` | `(name: string) => boolean` | No | Predicate to hide individual `Enum` variants by name. |
| `min` | `AnyExpr` | No | Minimum value, wired to the timestamp controls. |
| `max` | `AnyExpr` | No | Maximum value, wired to the timestamp controls. |
| `minRows` | `number` | No | Minimum textarea rows; applies to multiline `String` and `Json` fields. |

Several props only affect specific field types (e.g. `where`/`emptyQuery` are
ForeignKey-only, `filterVariants` is Enum-only, `min`/`max` are timestamp-only).
The dispatcher spreads all props to the chosen control, so props that a given
control does not declare are simply ignored for that field type.

## Field-type dispatch

`FieldFormControl` switches on the field's `type` and renders one of the typed
controls below. An unsupported field type throws at generation time.

| Field type | Rendered control |
|------------|------------------|
| `String` | `StringFieldFormControl` (Textarea when multiline; email/phone/hex-color adapt by usage) |
| `TinyUint` / `SmallUint` / `Uint` / `BigUint` / `TinyInt` / `SmallInt` / `Int` / `BigInt` / `Decimal` | `NumericFieldFormControl` (money icon for Money usage, `DurationInput` for Duration usage) |
| `Bool` | `BoolFieldFormControl` (`SwitchControl`, or `EnumLikeSelect` when the field is enum-like) |
| `Enum` | `EnumFieldFormControl` (`SelectTimeZone` for `sys_timezone`, `CountrySelect` for `country`, else `EnumSelect`) |
| `ForeignKey` | `ForeignKeyFieldFormControl` (`TableRecordSelect` combobox) |
| `Date` | `DateFieldFormControl` (`date` input) |
| `Time` | `TimeFieldFormControl` (`time` input) |
| `TimestampNaive` | `TimestampNaiveFieldFormControl` (`datetime-local`) |
| `TimestampUtc` | `TimestampUtcFieldFormControl` (`datetime-local`, stored at UTC) |
| `TimestampTz` | `TimeStampTzFieldFormControl` (`datetime-local`, stored with time zone) |
| `Uuid` | `UuidFieldFormControl` (text input, max 36 chars) |
| `Tx` | `TxFieldFormControl` (numeric input) |
| `Bytes` | `BytesFieldFormControl` (password input for `Secret` usage; renders nothing otherwise) |
| `Json` | `JsonFieldFormControl` (Textarea editing raw JSON) |
| `PhoneNumber` | `PhoneNumberFieldFormControl` (country-aware phone input) |

## Typed variants

Each variant is exported from `components/field_form_control` and can be used
directly when you want to bypass dispatch. Like the dispatcher, they read from
the form field context (or accept an explicit `fieldHelper`) and share the
common styling props `size`, `sx`, `className`, and `onChange` (other props such
as `endDecorator` and `required` are present only on the variants that declare
them). Two variants need an extra required prop:

```tsx
import {
  BoolFieldFormControl,
  EnumFieldFormControl,
  ForeignKeyFieldFormControl,
} from "components/field_form_control";

<ForeignKeyFieldFormControl table="industries" />
<EnumFieldFormControl enumName="us_state" />
<BoolFieldFormControl />
```

| Variant | Required prop |
|---------|---------------|
| `ForeignKeyFieldFormControl` | `table: string` |
| `EnumFieldFormControl` | `enumName: string` |

The remaining dispatch variants - `StringFieldFormControl`,
`JsonFieldFormControl`, `NumericFieldFormControl`, `BoolFieldFormControl`,
`UuidFieldFormControl`, `BytesFieldFormControl`, `TxFieldFormControl`,
`DateFieldFormControl`, `TimeFieldFormControl`, `TimestampNaiveFieldFormControl`,
`TimestampUtcFieldFormControl`, `TimeStampTzFieldFormControl`, and
`PhoneNumberFieldFormControl` - are also exported for direct use.

### Standalone variants (not part of dispatch)

These are exported but not reached by `FieldFormControl`, so they must be used
explicitly:

- `LexicalJsonFieldFormControl` - rich-text editor for a Lexical-shaped JSON
  field. Set `showVariables` to surface the template-variable picker. Use for
  JSON fields whose content is rich text; use `JsonFieldFormControl` for
  arbitrary JSON.
- `SplitDurationFieldFormControl` - edits a duration with separate per-unit
  fields (`SplitDurationInput`).
- `TemporaryPhoneNumberFieldFormControl` - lightweight phone input without a
  separate country-code field, for scratch/temporary forms.

```tsx
import { LexicalJsonFieldFormControl } from "components/field_form_control";

<Form.Field field="content_rich_text_json">
  <LexicalJsonFieldFormControl showVariables />
</Form.Field>
```

## Direct Lexical Editor Components

Use `LexicalJsonFieldFormControl` for form fields. Outside `Form.Field`, import
the direct Lexical components:

```tsx
import {
  LexicalBasicEmailEditor,
  LexicalRichTextDisplay,
  RichTextSimpleEditor,
  type MentionsConfig,
} from "components/lexical/components/lexical_editor";
import { sql } from "std/sql_utils";

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
| `RichTextSimpleEditor` | General Lexical JSON editor. |
| `LexicalBasicEmailEditor` | Richer email-template editor with the full formatting toolbar. |
| `LexicalRichTextDisplay` | Read-only rendering for Lexical JSON. |
| `MentionsConfig` | Type for `@` mention sources. |
| `lexicalRichTextToHtml` | Registers the SQL/JS rich-text-to-HTML support. |

`RichTextSimpleEditor` accepts the common styling props `size`, `variant`,
`color`, `sx`, `className`, `id`, and `style`, plus `value`, `onChange`,
`extendedToolbar`, `showVariables`, `variables`, `variableButtonLabel`, and
`mentions`. `LexicalRichTextDisplay` accepts `value`, `sx`, `className`, and
`id`.

## Common Mistakes

- Rendering `FieldFormControl` outside a `Form.Field` / form field context
  without passing both `field` and `fieldHelper` - `useFieldModel()` /
  `useFieldHelper()` have nothing to resolve.
- Expecting a label or helper text. `FieldFormControl` renders only the input;
  wrap it in a labeled layout (`FormControl` + `FormLabel`, or
  `LabelOnTopFormField`) for labels and validation messages.
- Passing `field` (the field name) as a string. `field` is a `Field` model
  object; identify a field by name with `Form.Field field="..."` instead.
- Using `ForeignKeyFieldFormControl` or `EnumFieldFormControl` directly without
  their required `table` / `enumName` prop.
- Reaching for `LexicalJsonFieldFormControl` or `SplitDurationFieldFormControl`
  through `FieldFormControl` - they are not in the dispatch table and must be
  placed explicitly.
