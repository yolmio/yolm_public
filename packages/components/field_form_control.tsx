import { countries } from "enums/country";
import { FormControlICtxKey, FormICtxKey } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { AnyExpr, Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import type {
  DecimalUsage,
  DurationUsage,
  Field,
  MoneyUsage,
  StringUsage,
} from "std/system";
import { useICtx, useOptionalICtx, usePhase, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import {
  setFieldTypeIfNotFromModel,
  useFieldHelper,
  useFieldModel,
} from "std/form";
import type { FormFieldHelper } from "std/form";
import { CountrySelect } from "./country_select";
import { DurationInput } from "./duration_input";
import { EnumLikeSelect, EnumSelect } from "./enum_select";
import { Input } from "./input";
import { NumericInput } from "./numeric_input";
import { MaterialIcon } from "./material_icon";
import { formatPhoneNumberStringValue } from "./phone_number_string";
import { SelectTimeZone } from "./select_timezone";
import { SplitDurationInput } from "./split_duration_input";
import { SwitchControl } from "./switch";
import { TableRecordSelect } from "./table_record_select";
import { Textarea } from "./textarea";
import type { Color, Size, Variant } from "./types";
import { getUniqueUiId } from "./utils";
import type { ChangeEventHandlerFn } from "std/event_utils";
import { RichTextSimpleEditor } from "./lexical/components/lexical_editor";

/** Props for {@link FieldFormControl}. */
export interface FieldFormControlProps {
  /** Query used to populate the empty/placeholder state of relation pickers. */
  emptyQuery?: Sql;
  /** WHERE clause restricting the rows offered by a foreign-key picker. */
  where?: Sql;
  /** Predicate to hide individual enum variants by name. */
  filterVariants?: (name: string) => boolean;
  /** Minimum allowed value; wired through to the timestamp/date-time controls. */
  min?: AnyExpr;
  /** Maximum allowed value; wired through to the timestamp/date-time controls. */
  max?: AnyExpr;
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  className?: string;
  /** Field model to render. When omitted, taken from the surrounding form context. */
  field?: Field;
  id?: Sql | string;
  sx?: Style;
  fullWidth?: boolean;
  /** Overrides the form field helper resolved from context. */
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  placeholder?: string | Sql;
  /** Snackbar content shown when a combobox search returns no match. */
  comboboxNotFoundSnackbar?: Node;
  /** Suppress the empty-list state in comboboxes. */
  comboboxNoEmptyList?: boolean;
  endDecorator?: Node;
  /** Focus this control immediately on mount. */
  immediateFocus?: boolean;
  /**
           The minimum number of rows to display in the textarea.
           This is only applicable to multiline fields.
           */
  minRows?: number;
}

/**
 A component that renders an appropriate form control based on the field type.
 It uses the field model from the current context if not provided explicitly.

 @category UI Component

 @param props.emptyQuery - query for empty state
 @param props.where -  WHERE clause for filtering
 @param props.filterVariants
 @param props.min
 @param props.max
 @param props.onChange
 @param props.size
 @param props.field
 @param props.id
 @param props.sx
 @param props.fullWidth
 @param props.fieldHelper

 */
export function FieldFormControl(props: FieldFormControlProps) {
  if (usePhase() === "gather") {
    return [];
  }
  const field = props.field ?? useFieldModel();
  switch (field.type) {
    case "ForeignKey":
      return (
        <ForeignKeyFieldFormControl
          {...props}
          table={field.table}
          fieldHelper={props.fieldHelper}
          endDecorator={props.endDecorator}
        />
      );
    case "Tx":
      return <TxFieldFormControl {...props} />;
    case "TimestampNaive":
      return (
        <TimestampNaiveFieldFormControl
          {...props}
          min={props.min ?? field.min}
          max={props.max ?? field.max}
          fieldHelper={props.fieldHelper}
        />
      );
    case "TimestampUtc":
      return (
        <TimestampUtcFieldFormControl
          {...props}
          min={props.min}
          max={props.max}
          fieldHelper={props.fieldHelper}
        />
      );
    case "TimestampTz":
      return (
        <TimeStampTzFieldFormControl
          {...props}
          min={props.min}
          max={props.max}
          fieldHelper={props.fieldHelper}
        />
      );
    case "Date":
      return (
        <DateFieldFormControl
          {...props}
          fieldHelper={props.fieldHelper}
          endDecorator={props.endDecorator}
        />
      );
    case "Time":
      return (
        <TimeFieldFormControl
          {...props}
          fieldHelper={props.fieldHelper}
        />
      );
    case "TinyUint":
    case "SmallUint":
    case "Uint":
    case "BigUint":
    case "TinyInt":
    case "SmallInt":
    case "Int":
    case "BigInt":
    case "Decimal":
      return (
        <NumericFieldFormControl
          {...props}
          inputMode={field.type === "Decimal" ? "decimal" : "numeric"}
          usage={field.usage}
          fieldHelper={props.fieldHelper}
          endDecorator={props.endDecorator}
          immediateFocus={props.immediateFocus}
        />
      );
    case "Enum":
      return (
        <EnumFieldFormControl
          {...props}
          enumName={field.enum}
          notNull={field.notNull}
          fieldHelper={props.fieldHelper}
          endDecorator={props.endDecorator}
          immediateFocus={props.immediateFocus}
        />
      );
    case "Uuid":
      return (
        <UuidFieldFormControl
          {...props}
          fieldHelper={props.fieldHelper}
        />
      );
    case "String":
      return (
        <StringFieldFormControl
          {...props}
          multiline={field.multiline}
          usage={field.usage}
          fieldHelper={props.fieldHelper}
          endDecorator={props.endDecorator}
          immediateFocus={props.immediateFocus}
        />
      );
    case "Bool":
      return (
        <BoolFieldFormControl
          {...props}
          enumLike={field.enumLike}
          notNull={field.notNull}
          fieldHelper={props.fieldHelper}
          endDecorator={props.endDecorator}
          immediateFocus={props.immediateFocus}
        />
      );
    case "Bytes":
      return (
        <BytesFieldFormControl
          {...props}
          usage={field.usage}
          maxLength={field.maxLength}
          fieldHelper={props.fieldHelper}
        />
      );
    case "PhoneNumber":
      return (
        <PhoneNumberFieldFormControl
          {...props}
          country={field.country}
          endDecorator={props.endDecorator}
          immediateFocus={props.immediateFocus}
        />
      );
    case "Json":
      return <JsonFieldFormControl {...props} />;
    default:
      throw new Error(`Unsupported field type: ${field.type}`);
  }
}

interface StringFieldFormControlProps {
  size?: Size;
  variant?: Variant;
  color?: Color;
  usage?: StringUsage;
  multiline?: boolean;
  id?: Sql | string;
  sx?: Style;
  className?: string;
  onChange?: ChangeEventHandlerFn;
  fullWidth?: boolean;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  placeholder?: string | Sql;
  endDecorator?: Node;
  immediateFocus?: boolean;
  /**
           The minimum number of rows to display in the textarea.
           This is only applicable to multiline fields.
           */
  minRows?: number;
}

function useFormControlId() {
  return useOptionalICtx(FormControlICtxKey)?.id ?? useUniqueId();
}

/**
 * Form control for a `String` field. Renders a {@link Textarea} when the
 * field is multiline, otherwise an {@link Input} adapted to the string usage
 * (email, phone, hex color). Usually reached via {@link FieldFormControl}
 * rather than used directly.
 *
 * @category UI Component
 */
export function StringFieldFormControl(props: StringFieldFormControlProps) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("String");
    return [];
  }
  const {
    size = "md",
    variant = "outlined",
    color = "neutral",
    usage,
    multiline = false,
    id = useFormControlId(),
    sx,
    onChange,
    required,
    immediateFocus,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  if (multiline) {
    return (
      <Textarea
        size={size}
        variant={variant}
        color={color}
        value={fieldHelper.value}
        error={fieldHelper.hasError}
        sx={sx}
        id={id}
        className={className}
        placeholder={props.placeholder}
        required={required}
        onInput={(s) => {
          fieldHelper.setValue(s, sql`target_value`);
          onChange?.(s, sql`target_value`);
        }}
        onBlur={(s) => {
          fieldHelper.setTouched(s, true);
        }}
        endDecorator={props.endDecorator}
        yolmFocusKey={immediateFocus ? sql`0` : sql.null}
        minRows={props.minRows}
      />
    );
  }
  let type: Sql | undefined;
  let inputMode: Sql | undefined;
  let startDecorator: Node | undefined;
  switch (usage?.type) {
    case "Email": {
      inputMode = sql.lit`email`;
      startDecorator = <MaterialIcon icon="Mail" />;
      break;
    }
    case "PhoneNumber": {
      type = sql.lit`tel`;
      inputMode = sql.lit`tel`;
      startDecorator = <MaterialIcon icon="Phone" />;
      break;
    }
    case "HexColor": {
      type = sql.lit`color`;
      break;
    }
  }
  return (
    <Input
      type={type}
      size={size}
      variant={variant}
      color={color}
      value={formatPhoneNumberStringValue(fieldHelper.value, usage)}
      startDecorator={startDecorator}
      error={fieldHelper.hasError}
      className={className}
      sx={sx}
      id={id}
      inputMode={inputMode}
      placeholder={props.placeholder}
      onInput={(s) => {
        const nextValue = formatPhoneNumberStringValue(
          sql`target_value`,
          usage,
        );
        fieldHelper.setValue(s, nextValue);
        onChange?.(s, nextValue);
      }}
      onBlur={(s) => {
        fieldHelper.setTouched(s, true);
      }}
      endDecorator={props.endDecorator}
      yolmFocusKey={immediateFocus ? sql`0` : sql.null}
    />
  );
}

interface JsonFieldFormControlProps {
  size?: Size;
  variant?: Variant;
  color?: Color;
  id?: Sql | string;
  sx?: Style;
  className?: string;
  onChange?: ChangeEventHandlerFn;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  placeholder?: string | Sql;
  minRows?: number;
}

/**
 * Form control for a `Json` field. Edits the raw JSON as text in a
 * {@link Textarea}, parsing the value back to JSON on input (empty input
 * becomes null). For rich-text JSON use {@link LexicalJsonFieldFormControl}.
 *
 * @category UI Component
 */
export function JsonFieldFormControl(props: JsonFieldFormControlProps) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel({ type: "Json" });
    return [];
  }
  const {
    size = "md",
    variant = "outlined",
    color = "neutral",
    id = useFormControlId(),
    sx,
    className,
    onChange,
    required,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  const nextValue =
    sql`case when target_value = '' then null else try_cast(target_value as json) end`;
  return (
    <Textarea
      size={size}
      variant={variant}
      color={color}
      value={sql`cast(${fieldHelper.value} as string)`}
      error={fieldHelper.hasError}
      sx={sx}
      id={id}
      className={className}
      placeholder={props.placeholder}
      required={required}
      onInput={(s) => {
        fieldHelper.setValue(s, nextValue);
        onChange?.(s, nextValue);
      }}
      onBlur={(s) => {
        fieldHelper.setTouched(s, true);
      }}
      minRows={props.minRows ?? 4}
    />
  );
}

interface PhoneNumberFieldFormControlProps {
  size?: Size;
  className?: string;
  id?: Sql | string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  variant?: Variant;
  color?: Color;
  onChange?: ChangeEventHandlerFn;
  required?: boolean;
  country?: string;
  endDecorator?: Node;
  immediateFocus?: boolean;
}

/**
 * Form control for a `PhoneNumber` field. When `country` is set, locks the
 * dialing code and formats input for that country; otherwise renders an
 * editable country-code prefix and guesses the country as the user types.
 * Stores the value in `+<code><digits>` form.
 *
 * @category UI Component
 */
export function PhoneNumberFieldFormControl(
  props: PhoneNumberFieldFormControlProps,
) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("String");
    return [];
  }
  const {
    size = "md",
    variant = "outlined",
    color = "neutral",
    id = useFormControlId(),
    className,
    sx,
    onChange,
    required,
    country,
    endDecorator,
    immediateFocus,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  const countryCodeScalar = `country_code_${getUniqueUiId()}`;
  if (country) {
    const countrySelected = countries.find((c) => c.name === country);
    if (!countrySelected) {
      throw new Error(`Country ${country} not found`);
    }
    return (
      <Input
        startDecorator={countrySelected.flag}
        type="tel"
        value={sql`case when ${fieldHelper.value} = '+' ||${
          sql.lit(countrySelected.countryCode)
        } then '' else phone.format_partial(substring(${fieldHelper.value} from char_length(${
          sql.lit(countrySelected.countryCode)
        }) + 2), country => ${
          sql.lit(country)
        }, disable_country_code => true) end`}
        error={fieldHelper.hasError}
        placeholder={sql`phone.format_partial('1234567890', country => ${
          sql.lit(country)
        }, disable_country_code => true)`}
        size={size}
        id={id}
        className={className}
        sx={sx}
        variant={variant}
        color={color}
        required={required}
        onInput={(s) => {
          const expr = sql`'+' || ${
            sql.lit(countrySelected.countryCode)
          } || phone.format_partial(target_value, country => ${
            sql.lit(country)
          }, disable_country_code => true)`;
          fieldHelper.setValue(
            s,
            expr,
          );
          onChange?.(s, expr);
        }}
        onPaste={(s) => {
          s.defScalar("sanitized_paste", {
            type: "String",
            expr: sql`regex.replace_all(pasted_text, '[^0-9]', '')`,
          });
          s.if(
            sql`char_length(sanitized_paste) = ${
              countrySelected.maxPhoneNumberLength +
              countrySelected.countryCode.length
            }`,
            (s) => {
              s.event.preventDefault();
              s.setScalar(
                "sanitized_paste",
                sql`substring(sanitized_paste from ${countrySelected.countryCode.length} + 1)`,
              );
              fieldHelper.setValue(
                s,
                sql`'+' || ${
                  sql.lit(countrySelected.countryCode)
                } || phone.format_partial(sanitized_paste, country => ${
                  sql.lit(country)
                }, disable_country_code => true)`,
              );
            },
          );
          s.if(
            sql`char_length(sanitized_paste) = ${countrySelected.maxPhoneNumberLength}`,
            (s) => {
              s.event.preventDefault();
              fieldHelper.setValue(
                s,
                sql`'+' || ${
                  sql.lit(countrySelected.countryCode)
                } || phone.format_partial(sanitized_paste, country => ${
                  sql.lit(country)
                }, disable_country_code => true)`,
              );
            },
          );
        }}
        endDecorator={endDecorator}
        yolmFocusKey={immediateFocus ? sql`0` : sql.null}
      />
    );
  }

  return (
    <Data
      noRefetch
      autoWatch={false}
      // watch={[fieldHelper.value]}
      pendingFallback={null}
      errorFallback={null}
      procedure={(s) => {
        s.defScalar(countryCodeScalar, {
          type: { type: "SmallInt" },
          // Default to 1 for us if not filled in
          expr:
            sql`case when ${fieldHelper.value} = '' or ${fieldHelper.value} is null then 1 else phone.country_code(phone.parse(${fieldHelper.value})) end`,
        });
      }}
    >
      <Input
        startDecorator={
          <Input
            color="neutral"
            value={sql`${sql.ref(countryCodeScalar)}`}
            placeholder="1"
            startDecorator={
              <>
                <MaterialIcon icon="Language" color="neutral" /> +
              </>
            }
            size="sm"
            onInput={(s) => {
              s.if(
                sql`target_value != '' and try_cast(target_value as smallint) is not null`,
                (s) => {
                  // Extract phone digits using the OLD country code before overwriting.
                  s.defScalar("phone_digits", {
                    type: "String",
                    expr:
                      sql`substring(${fieldHelper.value} from char_length(cast(${
                        sql.ref(countryCodeScalar)
                      } as string)) + 2)`,
                  });
                  s.setScalar(
                    countryCodeScalar,
                    sql`target_value::smallint`,
                  );
                  fieldHelper.setValue(
                    s,
                    sql`'+' || target_value || phone_digits`,
                  );
                },
              );
            }}
            maxLength={3}
            className="w-[80px]"
          />
        }
        type="tel"
        value={sql`case when ${fieldHelper.value} = '+' || ${
          sql.ref(countryCodeScalar)
        } then '' else phone.format_partial(substring(${fieldHelper.value}
       from char_length(${
          sql.ref(countryCodeScalar)
        }) +2), country => case when ${
          sql.ref(countryCodeScalar)
        } = 1 then 'US' else phone.guess_country(${fieldHelper.value}) end, disable_country_code => true) end`}
        error={fieldHelper.hasError}
        placeholder="(123) 456-7890"
        size={size}
        id={id}
        className={className}
        sx={sx}
        variant={variant}
        color={color}
        required={required}
        onInput={(s) => {
          const expr = sql`'+' || ${
            sql.ref(countryCodeScalar)
          } || phone.format_partial(target_value, country => case when ${
            sql.ref(countryCodeScalar)
          } = 1 then 'US' else phone.guess_country(${fieldHelper.value}) end, disable_country_code => true)`;
          fieldHelper.setValue(
            s,
            expr,
          );
          onChange?.(s, expr);
        }}
        onPaste={(s) => {
          s.if(
            sql`substring(pasted_text from 1 for char_length(${
              sql.ref(countryCodeScalar)
            }) +1) = '+' || ${sql.ref(countryCodeScalar)}`,
            (s) => {
              s.event.preventDefault();
              s.setScalar(
                "pasted_text",
                sql`substring(pasted_text from char_length(${
                  sql.ref(countryCodeScalar)
                }) + 2)`,
              );
              fieldHelper.setValue(
                s,
                sql`'+' || ${
                  sql.ref(countryCodeScalar)
                } || phone.format_partial(pasted_text, country => case when ${
                  sql.ref(countryCodeScalar)
                } = 1 then 'US' else phone.guess_country(${fieldHelper.value}) end, disable_country_code => true)`,
              );
            },
          );
        }}
        endDecorator={endDecorator}
        yolmFocusKey={immediateFocus ? sql`0` : sql.null}
      />
    </Data>
  );
}

/**
 * Lightweight phone-number control that formats input via
 * `phone.format_partial` without a separate country-code field. Use for
 * temporary/scratch forms where the full country-aware
 * {@link PhoneNumberFieldFormControl} is overkill.
 *
 * @category UI Component
 */
export function TemporaryPhoneNumberFieldFormControl(
  props: PhoneNumberFieldFormControlProps,
) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("String");
    return [];
  }
  const {
    size = "md",
    variant = "outlined",
    color = "neutral",
    id = useFormControlId(),
    sx,
    onChange,
    required,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    <Input
      startIcon="Phone"
      type="tel"
      value={fieldHelper.value}
      error={fieldHelper.hasError}
      placeholder="+1 (123) 456-7890"
      size={size}
      id={id}
      className={className}
      sx={sx}
      variant={variant}
      color={color}
      required={required}
      onInput={(s) => {
        const expr = sql`phone.format_partial(target_value)`;
        fieldHelper.setValue(s, expr);
        onChange?.(s, expr);
      }}
    />
  );
}

interface ForeignKeyFieldFormControlProps {
  table: string;
  emptyQuery?: Sql;
  where?: Sql;
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  className?: string;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  comboboxNotFoundSnackbar?: Node;
  comboboxNoEmptyList?: boolean;
  endDecorator?: Node;
  immediateFocus?: boolean;
  placeholder?: Sql | string;
}

/**
 * Form control for a `ForeignKey` field. Renders a
 * {@link TableRecordSelect} combobox over the referenced table, optionally
 * filtered by `where`/`emptyQuery`.
 *
 * @category UI Component
 */
export function ForeignKeyFieldFormControl(
  props: ForeignKeyFieldFormControlProps,
) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("BigUint");
    return;
  }
  const {
    table,
    emptyQuery,
    where,
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    comboboxNotFoundSnackbar,
    comboboxNoEmptyList,
    endDecorator,
    immediateFocus,
    placeholder,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    <TableRecordSelect
      tableName={table}
      value={fieldHelper.value}
      emptyQuery={emptyQuery}
      where={where}
      error={fieldHelper.hasError}
      size={size}
      id={id}
      className={className}
      sx={sx}
      onSelectValue={(s, value) => {
        fieldHelper.setValue(s, value);
        onChange?.(s, value);
      }}
      comboboxNotFoundSnackbar={comboboxNotFoundSnackbar}
      comboboxNoEmptyList={comboboxNoEmptyList}
      endDecorator={endDecorator}
      immediateFocus={immediateFocus}
      placeholder={placeholder}
    />
  );
}

interface TxFieldFormControlProps {
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  className?: string;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
}

/**
 * Form control for a `Tx` (transaction id) field. Renders a numeric input.
 * Rarely used directly; reached via {@link FieldFormControl}.
 *
 * @category UI Component
 */
export function TxFieldFormControl(props: TxFieldFormControlProps) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("BigInt");
    return;
  }
  const {
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    required,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    <Input
      type="number"
      value={fieldHelper.value}
      error={fieldHelper.hasError}
      size={size}
      id={id}
      className={className}
      sx={sx}
      onInput={(s) => {
        fieldHelper.setValue(s, sql`target_value`);
        onChange?.(s, sql`target_value`);
      }}
      onBlur={(s) => fieldHelper.setTouched(s, true)}
      required={required}
    />
  );
}

interface TimestampNaiveFieldFormControlProps {
  min?: AnyExpr;
  max?: AnyExpr;
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  className?: string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
}

/**
 * Form control for a `TimestampNaive` field (no time zone). Renders a
 * `datetime-local` input and parses input to a timestamp.
 *
 * @category UI Component
 */
export function TimestampNaiveFieldFormControl(
  props: TimestampNaiveFieldFormControlProps,
) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("Timestamp");
    return;
  }
  const {
    min,
    max,
    onChange,
    size = "md",
    id = useFormControlId(),
    className,
    sx,
    required,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    <Input
      type="datetime-local"
      value={sql`case when ${fieldHelper.value} is not null then format.date(${fieldHelper.value}, '%Y-%m-%dT%H:%M') else '' end`}
      error={fieldHelper.hasError}
      size={size}
      id={id}
      className={className}
      min={min as any}
      max={max as any}
      sx={sx}
      onInput={(s) => {
        fieldHelper.setValue(s, sql`try_cast(target_value as timestamp)`);
        onChange?.(s, sql`try_cast(target_value as timestamp)`);
      }}
      onBlur={(s) => fieldHelper.setTouched(s, true)}
      required={required}
    />
  );
}

interface TimestampUtcFieldFormControlProps {
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  min?: AnyExpr;
  max?: AnyExpr;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  className?: string;
}
/**
 * Form control for a `TimestampTz` field. Renders a `datetime-local` input
 * and stores the value as `timestamp with time zone`.
 *
 * @category UI Component
 */
export function TimeStampTzFieldFormControl(
  props: TimestampUtcFieldFormControlProps,
) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("TimestampTz");
    return;
  }
  const {
    min,
    max,
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    required,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    <Input
      type="datetime-local"
      value={sql`case when ${fieldHelper.value} is not null then format.date(${fieldHelper.value}, '%Y-%m-%dT%H:%M') else '' end`}
      error={fieldHelper.hasError}
      size={size}
      required={required}
      id={id}
      className={className}
      min={min as any}
      max={max as any}
      sx={sx}
      onInput={(s) => {
        fieldHelper.setValue(
          s,
          sql`try_cast(target_value as timestamp with time zone)`,
        );
        onChange?.(s, sql`try_cast(target_value as timestamp with time zone)`);
      }}
      onBlur={(s) => fieldHelper.setTouched(s, true)}
    />
  );
}

/**
 * Form control for a `TimestampUtc` field. Renders a `datetime-local` input
 * and stores the parsed value at the UTC time zone.
 *
 * @category UI Component
 */
export function TimestampUtcFieldFormControl(
  props: TimestampUtcFieldFormControlProps,
) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("TimestampUtc");
    return;
  }
  const {
    min,
    max,
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    required,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    <Input
      type="datetime-local"
      value={sql`case when ${fieldHelper.value} is not null then format.date(${fieldHelper.value}, '%Y-%m-%dT%H:%M') else '' end`}
      error={fieldHelper.hasError}
      size={size}
      id={id}
      min={min as any}
      max={max as any}
      sx={sx}
      className={className}
      required={required}
      onInput={(s) => {
        // todo: need to add info.timezone()
        fieldHelper.setValue(
          s,
          sql`try_cast(target_value as timestamp) at time zone 'UTC'`,
        );
        onChange?.(
          s,
          sql`try_cast(target_value as timestamp) at time zone 'UTC'`,
        );
      }}
      onBlur={(s) => fieldHelper.setTouched(s, true)}
    />
  );
}

interface DateFieldFormControlProps {
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  className?: string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  endDecorator?: Node;
}

/**
 * Form control for a `Date` field. Renders a `date` input.
 *
 * @category UI Component
 */
export function DateFieldFormControl(props: DateFieldFormControlProps) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("Date");
    return;
  }
  const {
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    required,
    endDecorator,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    <Input
      type="date"
      value={fieldHelper.value}
      error={fieldHelper.hasError}
      size={size}
      id={id}
      className={className}
      sx={sx}
      required={required}
      endDecorator={endDecorator}
      onInput={(s) => {
        fieldHelper.setValue(s, sql`try_cast(target_value as date)`);
        onChange?.(s, sql`try_cast(target_value as date)`);
      }}
      onBlur={(s) => fieldHelper.setTouched(s, true)}
    />
  );
}

interface TimeFieldFormControlProps {
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  className?: string;
}

/**
 * Form control for a `Time` field. Renders a `time` input and parses input
 * with the `%H:%M` format.
 *
 * @category UI Component
 */
export function TimeFieldFormControl(props: TimeFieldFormControlProps) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("Time");
    return;
  }

  // fieldHelper.setValue(s, sql`case when target_value ~ '^\d{2}:\d{2}$' then date.parse_time('%H:%M', target_value) else null end`);

  const {
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    required,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    <Input
      type="time"
      value={sql`case when ${fieldHelper.value} is not null then ${fieldHelper.value}::string else '' end`}
      error={fieldHelper.hasError}
      size={size}
      id={id}
      className={className}
      sx={sx}
      required={required}
      onInput={(s) => {
        fieldHelper.setValue(s, sql`date.parse_time(target_value,'%H:%M')`);
        onChange?.(s, sql`date.parse_time(target_value,'%H:%M')`);
      }}
      onBlur={(s) => fieldHelper.setTouched(s, true)}
    />
  );
}

interface NumericFieldFormControlProps {
  /** Decimal keyboard for money/decimals; integer fields use numeric. */
  inputMode?: "decimal" | "numeric";
  usage?: DecimalUsage | MoneyUsage | DurationUsage;
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  endDecorator?: Node;
  immediateFocus?: boolean;
  className?: string;
}

/**
 * Form control for integer/decimal fields. Renders a {@link NumericInput}
 * (with a currency icon for `Money` usage) or a {@link DurationInput} for
 * `Duration` usage.
 *
 * @category UI Component
 */
export function NumericFieldFormControl(props: NumericFieldFormControlProps) {
  if (usePhase() === "gather") {
    // Temporary fields have no schema model to map numeric storage to text.
    // This control always edits text, including incomplete signed decimals.
    setFieldTypeIfNotFromModel("String");
    return;
  }
  const {
    usage,
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    required,
    endDecorator,
    immediateFocus,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  if (usage?.type === "Duration") {
    return (
      <DurationInput
        error={fieldHelper.hasError}
        size={size}
        id={id}
        className={className}
        value={fieldHelper.value}
        sx={sx}
        onChange={(s, v) => {
          fieldHelper.setValue(s, v);
          fieldHelper.setTouched(s, true);
          onChange?.(s, v);
        }}
        onBlur={(s) => fieldHelper.setTouched(s, true)}
        endDecorator={endDecorator}
      />
    );
  }
  return (
    <NumericInput
      inputMode={props.inputMode ?? "decimal"}
      value={fieldHelper.value}
      error={fieldHelper.hasError}
      size={size}
      id={id}
      className={className}
      sx={sx}
      required={required}
      startIcon={usage?.type === "Money" ? "AttachMoney" : undefined}
      onChange={(s, text) => {
        fieldHelper.setValue(s, text);
        onChange?.(s, text);
      }}
      onBlur={(s) => fieldHelper.setTouched(s, true)}
      endDecorator={endDecorator}
      yolmFocusKey={immediateFocus ? sql`0` : sql.null}
    />
  );
}

interface EnumFieldFormControlProps {
  enumName: string;
  notNull?: boolean;
  filterVariants?: (name: string) => boolean;
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  endDecorator?: Node;
  immediateFocus?: boolean;
  className?: string;
}

/**
 * Form control for an `Enum` field. Renders a {@link SelectTimeZone} for
 * `sys_timezone`, a {@link CountrySelect} for `country`, otherwise a generic
 * {@link EnumSelect}.
 *
 * @category UI Component
 */
export function EnumFieldFormControl(props: EnumFieldFormControlProps) {
  if (usePhase() === "gather") {
    return;
  }
  const {
    enumName,
    notNull,
    filterVariants,
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    // required,
    endDecorator,
    immediateFocus,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  if (enumName === "sys_timezone") {
    return (
      <SelectTimeZone
        id={id}
        // required={required}
        value={fieldHelper.value}
        size={size}
        sx={sx}
        onInput={(s) => {
          fieldHelper.setValue(s, sql`target_value::enums.sys_timezone`);
          onChange?.(s, sql`target_value::enums.sys_timezone`);
        }}
        endDecorator={endDecorator}
        nullableLabel={notNull === false ? "Unknown" : undefined}
        compact={notNull === false}
        popoverPlacement={notNull === false ? "bottom" : undefined}
        className={className}
      />
    );
  }
  if (enumName === "country") {
    return (
      <CountrySelect
        enumName={enumName}
        size={size}
        value={fieldHelper.value}
        id={id}
        onInput={(s, newValue) => {
          fieldHelper.setValue(s, newValue);
          onChange?.(s, newValue);
        }}
        endDecorator={endDecorator}
        immediateFocus={immediateFocus}
        className={className}
      />
    );
  }
  return (
    <EnumSelect
      immediateFocus={immediateFocus}
      enum={enumName}
      size={size}
      value={fieldHelper.value}
      id={id}
      filterVariants={filterVariants}
      // required={required}
      onInput={(s) => {
        fieldHelper.setValue(
          s,
          sql`try_cast(target_value as enums.${sql.ref(enumName)})`,
        );
        onChange?.(
          s,
          sql`try_cast(target_value as enums.${sql.ref(enumName)})`,
        );
      }}
      sx={sx}
      endDecorator={endDecorator}
      className={className}
    />
  );
}

interface UuidFieldFormControlProps {
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  className?: string;
}

/**
 * Form control for a `Uuid` field. Renders a text {@link Input} capped at 36
 * characters.
 *
 * @category UI Component
 */
export function UuidFieldFormControl(props: UuidFieldFormControlProps) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("Uuid");
    return;
  }
  const {
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    required,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    <Input
      value={fieldHelper.value}
      error={fieldHelper.hasError}
      size={size}
      id={id}
      maxLength={36}
      required={required}
      onInput={(s) => {
        fieldHelper.setValue(s, sql`target_value`);
        onChange?.(s, sql`target_value`);
      }}
      onBlur={(s) => fieldHelper.setTouched(s, true)}
      sx={sx}
      className={className}
    />
  );
}

interface BoolFieldFormControlProps {
  enumLike?: any;
  notNull?: boolean;
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  endDecorator?: Node;
  immediateFocus?: boolean;
  className?: string;
}

/**
 * Form control for a `Bool` field. Renders a {@link SwitchControl} for plain
 * booleans, or an {@link EnumLikeSelect} when the field defines `enumLike`
 * labels (e.g. yes/no/unknown).
 *
 * @category UI Component
 */
export function BoolFieldFormControl(props: BoolFieldFormControlProps) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("Bool");
    return;
  }
  const {
    enumLike,
    notNull,
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    required,
    endDecorator,
    immediateFocus,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  if (!enumLike) {
    return (
      <SwitchControl
        id={id}
        required={required}
        size={size}
        checked={fieldHelper.value}
        onCheckboxChange={(s) => {
          fieldHelper.setValue(s, sql`target_checked`);
          onChange?.(s, sql`target_checked`);
        }}
        sx={sx}
        endDecorator={endDecorator}
        className={className}
      />
    );
  }
  return (
    <EnumLikeSelect
      id={id}
      enumLike={enumLike}
      size={size}
      notNull={notNull ?? false}
      value={sql`coalesce(cast(${fieldHelper.value} as string), '')`}
      onInput={(s) => {
        fieldHelper.setValue(
          s,
          sql`case when target_value = '' then null else target_value = 'true' end`,
        );
        onChange?.(s, sql`target_value`);
      }}
      sx={sx}
      endDecorator={endDecorator}
      immediateFocus={immediateFocus}
      className={className}
    />
  );
}

interface BytesFieldFormControlProps {
  usage?: {
    type: string;
  };
  maxLength?: number;
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  required?: boolean;
  className?: string;
}

/**
 * Form control for a `Bytes` field. Currently only renders a password input
 * for `Secret` usage; returns nothing for other usages.
 *
 * @category UI Component
 */
export function BytesFieldFormControl(props: BytesFieldFormControlProps) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("String");
    return;
  }
  const {
    usage,
    maxLength,
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    required,
    className,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  if (usage?.type === "Secret") {
    return (
      <Input
        type="password"
        value={fieldHelper.value}
        error={fieldHelper.hasError}
        size={size}
        id={id}
        maxLength={maxLength}
        autoComplete="off"
        aria-autocomplete="none"
        required={required}
        onInput={(s) => {
          fieldHelper.setValue(s, sql`target_value`);
          onChange?.(s, sql`target_value`);
        }}
        onBlur={(s) => fieldHelper.setTouched(s, true)}
        sx={sx}
        className={className}
      />
    );
  }
  return null;
}

interface SplitDurationFieldFormControlProps {
  onChange?: ChangeEventHandlerFn;
  size?: Size;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  className?: string;
}

/**
 * Form control that edits a duration via a {@link SplitDurationInput}
 * (separate fields per unit). Not part of the {@link FieldFormControl}
 * dispatch; use it explicitly where split entry is wanted.
 *
 * @category UI Component
 */
export function SplitDurationFieldFormControl(
  props: SplitDurationFieldFormControlProps,
) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel("String");
    return;
  }
  const { onChange, size = "md", sx, className } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  return (
    ////Example_SplitDurationInput_Start
    <SplitDurationInput
      value={fieldHelper.value}
      onChange={(s, value) => {
        fieldHelper.setValue(s, value);
        onChange?.(s, value);
      }}
      error={fieldHelper.hasError}
      size={size}
      sx={sx}
      className={className}
    />
    ////Example_SplitDurationInput_End
  );
}

interface LexicalJsonFieldFormControlProps {
  onChange?: ChangeEventHandlerFn;
  onChangeDebounceMs?: number;
  size?: Size;
  id?: Sql | string;
  sx?: Style;
  fieldHelper?: FormFieldHelper;
  className?: string;
  showVariables?: boolean;
  preserveStoredTextStyles?: boolean;
  preservePastedTextStyles?: boolean;
  documentFormatting?: boolean;
  allowImages?: boolean;
}

/**
 * Form control for editing a Lexical-rich-text-shaped JSON field.
 *
 * Renders the Lexical editor (loaded as a JS module on demand), wired to
 * the surrounding `Form.Field` so its serialized JSON state is committed
 * back into the field. Set `showVariables` when you want to surface the
 * template-variable picker (used by email-template editors).
 *
 * Use inside `Form.Field` for JSON fields whose semantic content is rich
 * text. For arbitrary JSON, use `JsonFieldFormControl` instead.
 */
export function LexicalJsonFieldFormControl(
  props: LexicalJsonFieldFormControlProps,
) {
  if (usePhase() === "gather") {
    setFieldTypeIfNotFromModel({ type: "Json" });
    return;
  }
  const {
    onChange,
    size = "md",
    id = useFormControlId(),
    sx,
    className,
    showVariables,
    preserveStoredTextStyles,
    preservePastedTextStyles,
    documentFormatting,
    allowImages,
    onChangeDebounceMs,
  } = props;
  const fieldHelper = props.fieldHelper ?? useFieldHelper();
  const form = useICtx(FormICtxKey);
  const editorHandleName = getUniqueUiId();
  const editorHandle = sql.lit(editorHandleName);
  const submitContentScalar = `${editorHandleName}_submit_content`;
  form.registerBeforeValidationClient((s) => {
    s.jsCall({
      module: "lexical_editor",
      exportName: "getContent",
      handle: editorHandle,
      argJson: sql`json_build_object('handle', ${editorHandle})`,
      resultJsonScalar: submitContentScalar,
    });
    s.if(
      sql`${sql.ref(submitContentScalar)}->'editorState' is not null`,
      (s) => {
        fieldHelper.setValue(
          s,
          sql`${sql.ref(submitContentScalar)}->'editorState'`,
        );
      },
    );
  });
  return (
    <RichTextSimpleEditor
      onChange={(s, value) => {
        fieldHelper.setValue(s, value);
        onChange?.(s, value);
      }}
      size={size}
      id={id}
      editorHandle={editorHandle}
      sx={sx}
      className={className}
      value={fieldHelper.value}
      showVariables={showVariables}
      preserveStoredTextStyles={preserveStoredTextStyles}
      preservePastedTextStyles={preservePastedTextStyles}
      documentFormatting={documentFormatting}
      allowImages={allowImages}
      onChangeDebounceMs={onChangeDebounceMs}
    />
  );
}
