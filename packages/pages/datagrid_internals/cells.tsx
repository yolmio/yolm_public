import { Alert } from "components/alert";
import { Button } from "components/button";
import { Checkbox } from "components/checkbox";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
// import { ImageDialog } from "components/image_dialog";
import { Input } from "components/input";
import { externalUrlHref, Link } from "components/link";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { formatPhoneNumberStringValue } from "components/phone_number_string";
import { RecordSelectDialog } from "components/search_dialog";
import { SelectIcon } from "components/select";
import { SvgIcon } from "components/svg_icon";
import { Typography } from "components/typography";
import {
  ImageSetFieldGroup,
  imageVariantUrl,
  uploadImageSet,
} from "field_groups/image_set";
import {
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
  DatagridBaseICtxKey,
  useCurrentWatchState,
} from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type {
  DomStatements,
  DomStatementsOrFn,
  StateStatements,
} from "std/statements";
import { createStyles, visuallyHiddenStyles } from "std/style_utils";
import { system } from "std/system";
import type {
  BoolField,
  BytesField,
  DateField,
  DecimalField,
  DoubleField,
  DurationUsage,
  EnumField,
  Field,
  ForeignKeyField,
  IntegerField,
  PhoneNumberField,
  RealField,
  StringField,
  TimestampNaiveField,
  TimestampTzField,
  TimestampUtcField,
  UuidField,
} from "std/system";
import { Show, State, useICtx, useState } from "std/ui";
import type { Node } from "std/ui";
import { enumLikeDisplayName } from "std/utils/enum_like";
import { useCellHelper } from "./shared";
import type { DgCellHelper, FieldEditProcConfig } from "./shared";
import { styles as sharedStyles } from "./styles";
import { ImageDialog } from "components/image_dialog";

const styles = createStyles({
  select: {
    border: 0,
    outline: "none",
    background: "none",
    fontSize: "inherit",
    color: "inherit",
    alignSelf: "stretch",
    // make children horizontally aligned
    display: "flex",
    alignItems: "center",
    flex: 1,
    fontFamily: "inherit",
    cursor: "pointer",
    appearance: "none",
  },
  selectIcon: {
    "--icon-font-size": "1.125rem",
    color: "inherit",
    position: "absolute",
    userSelect: "none",
    pointerEvents: "none",
    right: "0.25rem",
    display: "flex",
    alignItems: "center",
    height: "100%",
  },
  selectWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    width: "100%",
  },
  uploadButton: ({ theme }) => {
    return { mx: "auto", "&:focus-within": theme.focus.default };
  },
  checkbox: {
    mx: "auto",
  },
  imgWrapper: {
    width: "100%",
    height: "100%",
    py: 1,
  },
  img: {
    objectFit: "contain",
    width: "100%",
    height: "100%",
    cursor: "pointer",
  },
  nullableForeignKeyWrapper: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  linkedCell: {
    display: "flex",
    alignItems: "center",
    gap: 0.5,
    minWidth: 0,
    width: "100%",
    "& .dg-linked-cell-edit": {
      opacity: 0,
    },
    "&:hover .dg-linked-cell-edit, &:focus-within .dg-linked-cell-edit": {
      opacity: 1,
    },
  },
  linkedCellAnchor: {
    display: "block",
    minWidth: 0,
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  recordCellAnchor: {
    color: "text.primary",
    textDecoration: "underline",
    textDecorationColor: "neutral-300",
    textUnderlineOffset: "2px",
    "&:hover": {
      color: "primary-500",
      textDecorationColor: "primary-400",
    },
  },
  linkedCellEdit: {
    flexShrink: 0,
    "--icon-button-size": "1.25rem",
  },
  secretDialogButtons: {
    display: "flex",
    gap: 2,
    justifyContent: "flex-end",
  },
});

export interface FieldCellRecordLink {
  href: (recordId: NumericExpr) => Sql;
  beforeNavigate?: DomStatementsOrFn;
}

export type FieldCellLink =
  | "mailto"
  | "tel"
  | "url"
  | FieldCellRecordLink;

function fieldCellLinkHref(
  link: FieldCellLink,
  value: Sql,
  recordId: NumericExpr,
) {
  if (typeof link === "object") {
    return link.href(recordId);
  }
  switch (link) {
    case "mailto":
      return sql.concat("mailto:", value);
    case "tel":
      return sql.concat("tel:", value);
    case "url":
      return externalUrlHref(value);
  }
}

function startEditingCell(s: DomStatements, helper: DgCellHelper) {
  s.event.stopPropagation();
  s.modify(
    sql`update ui.focus_state set column = ${helper.column}, row = ${helper.row}, should_focus = false`,
  );
  s.modify(
    sql`update ui.editing_state set column = ${helper.column}, row = ${helper.row}, is_editing = true`,
  );
  s.setScalar("ui.start_edit_empty", false);
}

function LinkedCellDisplay(props: {
  helper: DgCellHelper;
  link: FieldCellLink;
  value: Node;
  canEdit: BooleanExpr;
}) {
  const recordLink = typeof props.link === "object";
  const beforeNavigate = typeof props.link === "object"
    ? props.link.beforeNavigate
    : undefined;
  const href = fieldCellLinkHref(
    props.link,
    props.helper.value,
    props.helper.recordId,
  );
  return (
    <Show
      when={sql`${props.helper.value} is not null`}
      fallback={<span sx={sharedStyles.ellipsisSpan}>{props.value}</span>}
    >
      <div sx={styles.linkedCell} className="dg-linked-cell">
        <Link
          href={href}
          sx={recordLink
            ? [styles.linkedCellAnchor, styles.recordCellAnchor]
            : styles.linkedCellAnchor}
          onClick={(s) => {
            s.event.stopPropagation();
            if (typeof props.link === "object") {
              s.if(
                sql`not event.ctrl_key and not event.meta_key and not event.shift_key and not event.alt_key`,
                (s) => {
                  s.event.preventDefault();
                  s.statements(beforeNavigate);
                  s.navigate(href);
                },
              );
            }
          }}
        >
          {props.value}
        </Link>
        <Show when={props.canEdit}>
          <IconButton
            className="dg-linked-cell-edit"
            sx={styles.linkedCellEdit}
            size="xs"
            variant="plain"
            color="neutral"
            icon="Edit"
            aria-label="Edit cell"
            tooltip="Edit"
            onClick={(s) => startEditingCell(s, props.helper)}
          />
        </Show>
      </div>
    </Show>
  );
}

export function ReadOnlyLinkedCell(props: {
  link: FieldCellLink;
  value?: Node;
}) {
  const helper = useCellHelper();
  return (
    <LinkedCellDisplay
      helper={helper}
      link={props.link}
      value={props.value ?? helper.value}
      canEdit={false}
    />
  );
}

function ForeignKeyCell(
  props: BaseFieldCellOpts & {
    field: ForeignKeyField;
  },
) {
  const helper = useCellHelper();
  const toTable = system.db.tables[props.field.table];
  if (!toTable.recordDisplayName) {
    throw new Error(
      `Unable to display foreign key cell for table ${toTable.name}`,
    );
  }
  const nameExpr = toTable.recordDisplayName.expr(
    ...toTable.recordDisplayName.fields.map((f) => sql`r.${sql.ref(f)}`),
  );
  function getText(s: StateStatements) {
    s.defScalar(
      "text",
      sql`(select ${nameExpr} from ${toTable.identWithDb} as r where id = try_cast(${helper.value} as bigint))`,
    );
  }
  if (props.canEdit === false) {
    useCurrentWatchState(getText);
    return <span sx={sharedStyles.ellipsisSpan}>{sql`text`}</span>;
  }
  const searchConfig = toTable.getSearchConfig();
  if (!searchConfig) {
    throw new Error(
      `No search config for table ${toTable.name} in trying to make datagrid cell for foreign key field ${props.tableName}.${props.field.name}.`,
    );
  }
  const shouldUseEditedText =
    sql`did_edit and ((edited_id is null and ${helper.value} is null) or edited_id = try_cast(${helper.value} as bigint))`;
  useState((s) => {
    s.defScalar("edited_text", {
      type: { type: "String", maxLength: 1000 },
    });
    s.defScalar("edited_id", {
      type: "BigInt",
    });
    s.defScalar("did_edit", false);
  });
  useCurrentWatchState(getText);
  const text = (
    <span
      sx={sharedStyles.ellipsisSpan}
    >
      {sql`case when ${shouldUseEditedText} then edited_text else text end`}
    </span>
  );
  return (
    <>
      {props.field.notNull ? text : (
        <div sx={styles.nullableForeignKeyWrapper}>
          {text}
          <Show when={sql.and(props.canEdit, sql`text is not null`)}>
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              aria-label="Remove field value"
              icon="Close"
              onClick={{
                detachedFromNode: true,
                procedure: (s) => {
                  s.defScalar("prev_id", helper.value);
                  helper.setValue(s, sql.null);
                  helper.updateFieldValueInDb(s, {
                    ...props,
                    dbValue: sql.null,
                    fieldName: props.field.name,
                    resetValue: (s) => helper.setValue(s, sql`prev_id`),
                  });
                },
              }}
            />
          </Show>
        </div>
      )}
      <Show when={sql.and(props.canEdit, helper.editing)}>
        {/*Example_RecordSelectDialog_Start*/}
        <RecordSelectDialog
          onSelect={(id, label) => (s) => {
            s.conditional({
              condition:
                sql`${helper.value} is null or ${id} != try_cast(${helper.value} as bigint)`,
              then: (s) => {
                s.setScalar("edited_id", id);
                s.setScalar("edited_text", label);
                s.setScalar("did_edit", true);
                s.statements(helper.stopEditingAndFocus);
                helper.updateFieldValueInDb(s, {
                  ...props,
                  dbValue: id,
                  fieldName: props.field.name,
                  resetValue: () => {},
                });
              },
              else: helper.stopEditingAndFocus,
            });
          }}
          open
          onClose={(s) => s.statements(helper.stopEditingAndFocus)}
          table={toTable.name}
        />
        {/*Example_RecordSelectDialog_End*/}
      </Show>
    </>
  );
}
function EnumCell(
  props: BaseFieldCellOpts & {
    field: EnumField;
  },
) {
  const helper = useCellHelper();
  const enumModel = system.enums[props.field.enum];
  const display = (
    <span sx={sharedStyles.ellipsisSpan}>
      {enumModel.getDisplayName?.(
        sql`try_cast(${helper.value} as enums.${sql.ref(enumModel.name)})`,
      )}
    </span>
  );
  if (props.canEdit === false) {
    return display;
  }
  const options = Object.values(enumModel.values).map((v) => (
    <option value={v.name}>{v.displayName}</option>
  ));
  if (!props.field.notNull) {
    options.unshift(<option value="">No value</option>);
  }
  const handlers = helper.fieldEditorEventHandlers({
    ...props,
    fieldName: props.field.name,
    dbValue: sql`ui.value`,
    validUiValue: true,
    changedUiValue: props.stringified
      ? sql`case when ${helper.value} is null then value is not null else value is null or try_cast(${helper.value} as enums.${
        sql.ref(enumModel.name)
      }) != value end`
      : sql`case when ${helper.value} is null then value is not null else value is null or ${helper.value} != value end`,
    newUiValue: props.stringified ? sql`cast(value as string)` : sql`value`,
  });
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State
        procedure={(s) =>
          s.defScalar(
            "value",
            sql`try_cast(${helper.value} as enums.${sql.ref(enumModel.name)})`,
          )}
      >
        <div sx={styles.selectWrapper}>
          <select
            sx={styles.select}
            value={sql`value`}
            yolmFocusKey
            {...handlers}
            onInput={(s) => {
              s.setScalar(
                "ui.value",
                sql`try_cast(target_value as enums.${sql.ref(enumModel.name)})`,
              );
            }}
          >
            {options}
          </select>
          <span sx={styles.selectIcon}>
            <SvgIcon>
              <SelectIcon />
            </SvgIcon>
          </span>
        </div>
      </State>
    </Show>
  );
}
function DateCell(
  props: BaseFieldCellOpts & {
    field: DateField;
  },
) {
  const helper = useCellHelper();
  const dateValue = props.stringified
    ? sql`try_cast(${helper.value} as date)`
    : helper.value;
  const display = (
    <span sx={sharedStyles.ellipsisSpan}>
      {props.field.formatExpr(dateValue)}
    </span>
  );
  if (props.canEdit === false) {
    return display;
  }
  const handlers = helper.fieldEditorEventHandlers({
    ...props,
    fieldName: props.field.name,
    tableName: props.tableName,
    dbValue: sql`value`,
    validUiValue: props.field.notNull ? sql`value is not null` : true,
    changedUiValue:
      sql`case when ${dateValue} is null then value is not null else value is null or ${dateValue} != value end`,
  });
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State procedure={(s) => s.defScalar("value", dateValue)}>
        <input
          sx={sharedStyles.cellInput}
          value={sql`value`}
          yolmFocusKey
          type="date"
          {...handlers}
          onInput={(s) => {
            s.setScalar("ui.value", sql`try_cast(target_value as date)`);
          }}
        />
      </State>
    </Show>
  );
}

// this should be improved, but for now it is good enough
function PhoneNumberCell(
  props: BaseFieldCellOpts & {
    field: PhoneNumberField;
  },
) {
  const helper = useCellHelper();
  const phoneValue = props.stringified
    ? sql`phone.parse(${helper.value})`
    : helper.value;
  const display = (
    <span sx={sharedStyles.ellipsisSpan}>
      {sql`phone.format_international(${phoneValue})`}
    </span>
  );
  if (props.canEdit === false) {
    return display;
  }
  const handlers = helper.fieldEditorEventHandlers({
    ...props,
    fieldName: props.field.name,
    tableName: props.tableName,
    dbValue: sql`phone.parse(value)`,
    validUiValue: props.field.notNull
      ? sql`phone.try_parse(value) is not null`
      : true,
    changedUiValue:
      sql`case when ${phoneValue} is null then phone.try_parse(value) is not null else phone.try_parse(value) is null or phone.try_parse(value) != ${phoneValue} end`,
  });
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State
        procedure={(s) => s.defScalar("value", sql`${phoneValue}::string`)}
      >
        <input
          sx={sharedStyles.cellInput}
          value={sql`value`}
          yolmFocusKey
          type="tel"
          {...handlers}
          onInput={(s) => {
            s.setScalar("ui.value", sql`phone.format_partial(target_value)`);
          }}
        />
      </State>
    </Show>
  );
}
function TimestampNaiveCell(
  props: BaseFieldCellOpts & {
    field: TimestampNaiveField;
  },
) {
  const helper = useCellHelper();
  const timestampValue = props.stringified
    ? sql`try_cast(${helper.value} as timestamp)`
    : helper.value;
  const display = (
    <span sx={sharedStyles.ellipsisSpan}>
      {props.field.formatExpr(timestampValue)}
    </span>
  );
  if (props.canEdit === false) {
    return display;
  }
  const handlers = helper.fieldEditorEventHandlers({
    ...props,
    fieldName: props.field.name,
    tableName: props.tableName,
    dbValue: sql`value`,
    validUiValue: props.field.notNull ? sql`value is not null` : true,
    changedUiValue:
      sql`case when ${timestampValue} is null then value is not null else value is null or ${timestampValue} != value end`,
  });
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State procedure={(s) => s.defScalar("value", timestampValue)}>
        <input
          sx={sharedStyles.cellInput}
          value={sql`case when value is not null then format.date(value, '%Y-%m-%dT%H:%M') else '' end`}
          yolmFocusKey
          type="datetime-local"
          {...handlers}
          onInput={(s) => {
            s.setScalar("ui.value", sql`try_cast(target_value as timestamp)`);
          }}
        />
      </State>
    </Show>
  );
}

function TimestampTzCell(
  props: BaseFieldCellOpts & {
    field: TimestampTzField;
  },
) {
  const helper = useCellHelper();
  const timestampValue = props.stringified
    ? sql`try_cast(${helper.value} as timestamptz)`
    : helper.value;
  const display = (
    <span sx={sharedStyles.ellipsisSpan}>
      <State
        procedure={(s) => {
          const table = useICtx(CurrentTableICtxKey).currentTable;
          s.defScalar(
            "value",
            sql`(select ${props.field.ident} from ${table.identWithDb} where ${table.primaryKeyIdent} = ${helper.recordId})`,
          );
          s.defScalar(
            "formatted_value",
            sql`format.date(value, '%-d %b %Y %l:%M%p %Z')`,
          );
        }}
      >
        {sql`formatted_value`}
      </State>
    </span>
  );
  if (props.canEdit === false) {
    return display;
  }
  const handlers = helper.fieldEditorEventHandlers({
    ...props,
    fieldName: props.field.name,
    tableName: props.tableName,
    dbValue: sql`value`,
    validUiValue: props.field.notNull ? sql`value is not null` : true,
    changedUiValue:
      sql`case when ${timestampValue} is null then value is not null else value is null or ${timestampValue} != value end`,
  });
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State procedure={(s) => s.defScalar("value", timestampValue)}>
        <input
          sx={sharedStyles.cellInput}
          value={sql`case when value is not null then format.date(value, '%Y-%m-%dT%H:%M') else '' end`}
          yolmFocusKey
          type="datetime-local"
          {...handlers}
          onInput={(s) => {
            s.setScalar("ui.value", sql`try_cast(target_value as timestamptz)`);
          }}
        />
      </State>
    </Show>
  );
}

function TimestampUtcCell(
  props: BaseFieldCellOpts & {
    field: TimestampUtcField;
  },
) {
  const helper = useCellHelper();
  const timestampValue = props.stringified
    ? sql`try_cast(${helper.value} as timestamptz)`
    : helper.value;
  const display = (
    <span sx={sharedStyles.ellipsisSpan}>
      {props.field.formatExpr(timestampValue)}
    </span>
  );
  if (props.canEdit === false) {
    return display;
  }
  const handlers = helper.fieldEditorEventHandlers({
    ...props,
    fieldName: props.field.name,
    tableName: props.tableName,
    dbValue: sql`value`,
    validUiValue: props.field.notNull ? sql`value is not null` : true,
    changedUiValue:
      sql`case when ${timestampValue} is null then value is not null else value is null or ${timestampValue} != value end`,
  });
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State procedure={(s) => s.defScalar("value", timestampValue)}>
        <input
          sx={sharedStyles.cellInput}
          value={sql`case when value is not null then format.date(value, '%Y-%m-%dT%H:%M') else '' end`}
          yolmFocusKey
          type="datetime-local"
          {...handlers}
          onInput={(s) => {
            s.setScalar("ui.value", sql`try_cast(target_value as timestamptz)`);
          }}
        />
      </State>
    </Show>
  );
}

function NumericCell(
  props: BaseFieldCellOpts & {
    field: IntegerField | DecimalField | RealField | DoubleField;
  },
) {
  const helper = useCellHelper();
  let typeName: string;
  switch (props.field.type) {
    case "TinyInt":
    case "TinyUint":
    case "SmallInt":
      typeName = "smallint";
      break;
    case "SmallUint":
    case "Int":
      typeName = "int";
      break;
    case "BigInt":
    case "BigUint":
    case "Uint":
      typeName = "bigint";
      break;
    case "Decimal":
      typeName = `decimal(${props.field.precision}, ${props.field.scale})`;
      break;
    case "Real":
      typeName = "real";
      break;
    case "Double":
      typeName = "double";
      break;
  }
  const numberValue = props.stringified
    ? sql`try_cast(${helper.value} as ${sql(typeName)})`
    : helper.value;
  let formatted = sql`format.decimal(${numberValue})`;
  if (props.field.type === "Decimal" && props.field.usage) {
    if (props.field.usage.type === "Money") {
      formatted = sql`format.currency(${numberValue}, ${
        sql.lit(props.field.usage.currency)
      })`;
    } else if (props.field.usage.type === "Percentage") {
      formatted = sql`format.percent(${numberValue})`;
    }
  }
  const display = props.link
    ? (
      <LinkedCellDisplay
        helper={helper}
        link={props.link}
        value={formatted}
        canEdit={props.canEdit}
      />
    )
    : <span sx={sharedStyles.ellipsisSpan}>{formatted}</span>;
  if (props.canEdit === false) {
    return display;
  }
  const handlers = castEventHandlers(props, props.field, helper, sql(typeName));
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State
        procedure={(s) => {
          s.defScalar(
            "value",
            sql`case when start_edit_empty then '' else cast(${helper.value} as string) end`,
          );
        }}
      >
        <input
          sx={sharedStyles.cellInput}
          value={sql`value`}
          onInput={(s) => s.setScalar("ui.value", sql`target_value`)}
          yolmFocusKey
          type="number"
          {...handlers}
        />
      </State>
    </Show>
  );
}

function castEventHandlers(
  opts: BaseFieldCellOpts,
  field: Field,
  helpers: DgCellHelper,
  typeName: Sql,
) {
  const { value } = helpers;
  return helpers.fieldEditorEventHandlers({
    ...opts,
    fieldName: field.name,
    tableName: opts.tableName,
    dbValue: field.notNull
      ? sql`cast(value as ${typeName})`
      : sql`try_cast(value as ${typeName})`,
    validUiValue: field.notNull
      ? sql`try_cast(value as ${typeName}) is not null`
      : sql`value = '' or try_cast(value as ${typeName}) is not null`,
    changedUiValue: opts.stringified
      ? sql`case when ${value} is null then value != '' else ${value} != value end`
      : sql`case when ${value} is null then value != '' else cast(${value} as string) != value end`,
    newUiValue: opts.stringified
      ? sql`case when value = '' then null else value end`
      : sql`try_cast(value as ${typeName})`,
  });
}
function StringCell(
  props: BaseFieldCellOpts & {
    field: StringField;
  },
) {
  const helper = useCellHelper();
  const displayValue = formatPhoneNumberStringValue(
    helper.value,
    props.field.usage,
  );
  const display = props.link
    ? (
      <LinkedCellDisplay
        helper={helper}
        link={props.link}
        value={displayValue}
        canEdit={props.canEdit}
      />
    )
    : <span sx={sharedStyles.ellipsisSpan}>{displayValue}</span>;
  if (props.canEdit === false) {
    return display;
  }
  const { field, ...opts } = props;
  const handlers = helper.fieldEditorEventHandlers({
    ...opts,
    fieldName: field.name,
    tableName: opts.tableName,
    dbValue: sql`case when value = '' then null else value end`,
    validUiValue: field.notNull ? sql`value != ''` : true,
    changedUiValue: field.usage?.type === "PhoneNumber"
      ? sql`(${helper.value} is null and ui.value != '') or (ui.value collate Binary) != (${
        formatPhoneNumberStringValue(helper.value, field.usage)
      } collate Binary)`
      : sql`(${helper.value} is null and ui.value != '') or (ui.value collate Binary) != (${helper.value} collate Binary)`,
  });
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State
        procedure={(s) => {
          s.defScalar(
            "value",
            formatPhoneNumberStringValue(
              sql`case when start_edit_empty then '' else ${helper.value} end`,
              field.usage,
            ),
          );
        }}
      >
        <input
          sx={sharedStyles.cellInput}
          value={sql`value`}
          onInput={(s) =>
            s.setScalar(
              "ui.value",
              formatPhoneNumberStringValue(sql`target_value`, field.usage),
            )}
          yolmFocusKey
          type={field.usage?.type === "PhoneNumber" ? "tel" : "text"}
          inputMode={field.usage?.type === "PhoneNumber" ? "tel" : undefined}
          {...handlers}
        />
      </State>
    </Show>
  );
}
function SecretCell(
  props: BaseFieldCellOpts & {
    field: BytesField;
  },
) {
  const helper = useCellHelper();
  const display = <span sx={sharedStyles.ellipsisSpan}>{helper.value}</span>;
  if (props.canEdit === false) {
    return display;
  }
  return (
    <>
      <ModalDialog
        open={sql.and(props.canEdit, helper.editing)}
        onClose={(s) => s.statements(helper.stopEditingAndFocus)}
        onClick={(s) => s.event.stopPropagation()}
        onKeyDown={(s) => s.event.stopPropagation()}
        className="flex flex-col gap-4"
      >
        <State
          procedure={(s) => {
            s.defScalar("value", sql.lit``);
            s.defScalar("waiting", false);
            s.defScalar("error", {
              type: "String",
              expr: sql.null,
              allowNoRead: true,
            });
          }}
        >
          <Typography component="h3" level="inherit">
            Update Secret
          </Typography>
          <FormControl>
            <FormLabel>{sql.lit(props.field.displayName)}</FormLabel>
            <Input
              value={sql`value`}
              autoComplete="off"
              aria-autocomplete="none"
              onInput={(s) => s.setScalar("ui.value", sql`target_value`)}
            />
          </FormControl>
          <Show when={sql`ui.error is not null`}>
            <Alert color="danger">{sql`ui.error`}</Alert>
          </Show>
          <div sx={styles.secretDialogButtons}>
            <Button
              variant="plain"
              color="neutral"
              onClick={(s) => s.statements(helper.stopEditingAndFocus)}
            >
              Cancel
            </Button>
            <Button
              onClick={{
                detachedFromNode: true,
                procedure: (s) => {
                  s.defScalar("prev_value", helper.value);
                  s.statements(helper.stopEditingAndFocus);
                  helper.updateFieldValueInDb(s, {
                    ...props,
                    fieldName: props.field.name,
                    dbValue: sql`crypto.encrypt(ui.value, ${
                      sql.lit(props.field.usage!.encryptionKey)
                    })`,
                    resetValue: (s) => helper.setValue(s, sql`prev_value`),
                  });
                },
              }}
            >
              Update
            </Button>
          </div>
        </State>
      </ModalDialog>
      {display}
    </>
  );
}
function UuidCell(
  props: BaseFieldCellOpts & {
    field: UuidField;
  },
) {
  const helper = useCellHelper();
  const display = <span sx={sharedStyles.ellipsisSpan}>{helper.value}</span>;
  if (props.canEdit === false) {
    return display;
  }
  const handlers = castEventHandlers(props, props.field, helper, sql`uuid`);
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State
        procedure={(s) => {
          s.defScalar(
            "value",
            sql`case when start_edit_empty then '' else cast(${helper.value} as string) end`,
          );
        }}
      >
        <input
          sx={sharedStyles.cellInput}
          value={sql`value`}
          onInput={(s) => s.setScalar("ui.value", sql`target_value`)}
          yolmFocusKey
          type="text"
          {...handlers}
        />
      </State>
    </Show>
  );
}
function BoolCell(
  props: BaseFieldCellOpts & {
    field: BoolField;
  },
) {
  const helper = useCellHelper();
  const { enumLike } = props.field;
  if (enumLike) {
    const display = (
      <span sx={sharedStyles.ellipsisSpan}>
        {enumLikeDisplayName(sql`try_cast(${helper.value} as bool)`, enumLike)}
      </span>
    );
    if (props.canEdit === false) {
      return display;
    }
    const handlers = helper.fieldEditorEventHandlers({
      ...props,
      fieldName: props.field.name,
      dbValue: sql`try_cast(ui.value as bool)`,
      validUiValue: true,
      changedUiValue: props.stringified
        ? sql`case when ${helper.value} is null then value is not null else ${helper.value} != value end`
        : sql`case when ${helper.value} is null then value is not null else cast(${helper.value} as string) != value end`,
      newUiValue: props.stringified
        ? sql`ui.value`
        : sql`try_cast(ui.value as bool)`,
    });
    return (
      <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
        <State
          procedure={(s) =>
            s.defScalar(
              "value",
              props.stringified
                ? helper.value
                : sql`coalesce(cast(${helper.value} as string), '')`,
            )}
        >
          <div sx={styles.selectWrapper}>
            <select
              sx={styles.select}
              value={sql`value`}
              yolmFocusKey
              {...handlers}
              onInput={(s) =>
                s.setScalar("ui.value", sql`target_value`)}
            >
              <option value="true">{sql.lit(enumLike.true)}</option>
              <option value="false">{sql.lit(enumLike.false)}</option>
              {!props.field.notNull && (
                <option value="">
                  {sql.lit(enumLike.null ?? "Unspecified")}
                </option>
              )}
            </select>
            <span sx={styles.selectIcon}>
              <SvgIcon>
                <SelectIcon />
              </SvgIcon>
            </span>
          </div>
        </State>
      </Show>
    );
  }
  return (
    <Checkbox
      sx={styles.checkbox}
      checked={props.stringified ? sql`${helper.value} = 'true'` : helper.value}
      variant="outlined"
      color="neutral"
      tabIndex={-1}
      readOnly={typeof props.canEdit !== "boolean"
        ? props.canEdit
        : props.canEdit === false
        ? true
        : undefined}
      onCheckboxChange={props.canEdit === false
        ? (s) => s.event.preventDefault()
        : {
          detachedFromNode: true,
          procedure: (s) => {
            s.unless(props.canEdit, (s) => {
              s.event.preventDefault();
              s.return();
            });
            s.defScalar("prev_value", helper.value);
            helper.setValue(
              s,
              props.stringified
                ? sql`cast(target_checked as string)`
                : sql`target_checked`,
            );
            helper.updateFieldValueInDb(s, {
              ...props,
              fieldName: props.field.name,
              dbValue: props.stringified
                ? sql`cast(${helper.value} as bool)`
                : helper.value,
              resetValue: (s) => helper.setValue(s, sql`prev_value`),
            });
          },
        }}
    />
  );
}

function DurationCell(
  props: BaseFieldCellOpts & {
    field: IntegerField | DecimalField | RealField | DoubleField;
    usage: DurationUsage;
  },
) {
  const helper = useCellHelper();
  if (props.usage.size !== "minutes") {
    throw new Error(`Unsupported duration size: ${props.usage.size}`);
  }
  const display = (
    <span sx={sharedStyles.ellipsisSpan}>
      {sql`fn.display_minutes_duration(try_cast(${helper.value} as bigint))`}
    </span>
  );
  if (props.canEdit === false) {
    return display;
  }
  const bigintValue = props.stringified
    ? sql`try_cast(${helper.value} as bigint)`
    : helper.value;
  const handlers = helper.fieldEditorEventHandlers({
    ...props,
    fieldName: props.field.name,
    dbValue: sql`fn.parse_minutes_duration(ui.input_value)`,
    validUiValue: props.field.notNull
      ? sql`fn.parse_minutes_duration(input_value) is not null`
      : sql`input_value = '' or fn.parse_minutes_duration(input_value) is not null`,
    changedUiValue: props.field.notNull
      ? sql`${bigintValue} != fn.parse_minutes_duration(input_value)`
      : sql`(input_value = '' and ${helper.value} is not null) or (input_value != '' and ${helper.value} is null) or ${bigintValue} != fn.parse_minutes_duration(input_value)`,
    newUiValue: props.stringified
      ? sql`cast(fn.parse_minutes_duration(input_value) as string)`
      : sql`fn.parse_minutes_duration(input_value)`,
  });
  return (
    <Show when={sql.and(props.canEdit, helper.editing)} fallback={display}>
      <State
        procedure={(s) => {
          s.defScalar(
            "value",
            sql`case when
              start_edit_empty then ''
              else fn.display_minutes_duration(try_cast(${helper.value} as bigint))
            end`,
          );
          s.defScalar("input_value", sql`value`);
        }}
      >
        <input
          sx={sharedStyles.cellInput}
          value={sql`value`}
          yolmFocusKey
          inputMode="numeric"
          {...handlers}
          onKeyDown={(s) => {
            s.if(
              sql`not event.ctrl_key and not event.meta_key and char_length(event.key) = 1 and event.key not in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '0', ':')`,
              (s) => {
                s.event.preventDefault();
              },
            );
          }}
          onInput={(s) => {
            s.setScalar("input_value", sql`target_value`);
          }}
          onChange={(s) => {
            s.setScalar(
              "value",
              sql`fn.display_minutes_duration(fn.parse_minutes_duration(target_value))`,
            );
          }}
        />
      </State>
    </Show>
  );
}

function ImageSetCell(
  props: BaseFieldCellOpts & {
    group: ImageSetFieldGroup;
  },
) {
  const helper = useCellHelper();
  const dgBase = useICtx(DatagridBaseICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { upload, updateDb } = uploadImageSet(
    props.tableName,
    helper.recordId,
    props.group,
  );
  const table = system.db.tables[props.tableName];
  const variantName = Object.entries(props.group.variants).find(
    ([_, v]) => v.usage === "square_thumbnail",
  )?.[0];
  if (!variantName) {
    throw new Error(
      `No variant square_thumbnail found for image set field group ${props.group.name}`,
    );
  }
  return (
    <Show
      when={sql.isNull(helper.value)}
      fallback={
        <State procedure={(s) => s.defScalar("open", false)}>
          <div sx={styles.imgWrapper}>
            <img
              sx={styles.img}
              alt="Image thumbnail"
              src={imageVariantUrl(
                table,
                variantName,
                helper.recordId,
                helper.value,
              )}
              onClick={(s) => {
                s.setScalar("ui.open", true);
                s.modify(sql`update ui.editing_state set is_editing = false`);
                s.modify(
                  sql`update ui.focus_state set should_focus = false, row = ${helper.row}, column = ${helper.column}`,
                );
              }}
            />
          </div>
          {/*Example_ImageDialog_Start*/}
          <ImageDialog
            open={sql`ui.open or ${helper.editing}`}
            onClose={(s) => {
              s.setScalar("ui.open", false);
              s.statements(helper.stopEditingAndFocus);
            }}
            group={props.group.name}
            tableName={props.tableName}
            recordId={helper.recordId}
            afterReplace={triggerRefetch}
            afterRemove={triggerRefetch}
          />
          {/*Example_ImageDialog_End*/}
        </State>
      }
    >
      <State procedure={(s) => s.defScalar("uploading", false)}>
        <Button
          component="label"
          startDecorator={<MaterialIcon icon="Upload" />}
          sx={styles.uploadButton()}
          size="sm"
          variant="outlined"
          color="neutral"
          loading={sql`uploading`}
          loadingPosition="start"
        >
          <input
            sx={visuallyHiddenStyles}
            accept="image/*"
            type="file"
            tabIndex={-1}
            onFileChange={(s) => {
              s.returnIf(sql`uploading`);
              s.setScalar("uploading", true);
              s.commitUiTreeChanges();
              s.tryServer({
                transferFiles: sql`select uuid from file`,
                body: (s) => {
                  s.statements(upload);
                  s.startTransaction();
                  s.statements(updateDb);
                  s.commitTransaction();
                  triggerRefetch(s);
                },
                errorName: "upload_error",
                catch: (s) =>
                  dgBase.displayEditErrorAndRemoveAfter(
                    s,
                    sql.concat(
                      "Unable to upload image: ",
                      sql`upload_error.type`,
                      ": ",
                      sql`coalesce(upload_error.message, '')`,
                      " ",
                      sql`coalesce(upload_error.description, '')`,
                    ),
                  ),
              });
              s.setScalar("uploading", false);
            }}
          />
          Upload
        </Button>
      </State>
    </Show>
  );
}

export interface FieldCellOpts extends BaseFieldCellOpts {
  field: Field;
}

export interface BaseFieldCellOpts extends FieldEditProcConfig {
  tableName: string;
  stringified: boolean;
  canEdit: BooleanExpr;
  link?: FieldCellLink;
}

export function FieldCell(props: FieldCellOpts) {
  switch (props.field.type) {
    case "ForeignKey":
      return <ForeignKeyCell {...props} field={props.field} />;
    case "Enum":
      return <EnumCell {...props} field={props.field} />;
    case "Date":
      return <DateCell {...props} field={props.field} />;
    case "String":
      return (
        <StringCell
          {...props}
          link={props.link ??
            (props.field.usage?.type === "URL" ? "url" : undefined)}
          field={props.field}
        />
      );
    case "Bool":
      return <BoolCell {...props} field={props.field} />;
    case "TinyInt":
    case "SmallInt":
    case "Int":
    case "BigInt":
    case "TinyUint":
    case "SmallUint":
    case "Uint":
    case "BigUint":
    case "Decimal":
    case "Double":
    case "Real": {
      if ("usage" in props.field && props.field.usage?.type === "Duration") {
        return (
          <DurationCell
            {...props}
            field={props.field}
            usage={props.field.usage}
          />
        );
      }
      return <NumericCell {...props} field={props.field} />;
    }
    case "Uuid": {
      return <UuidCell {...props} field={props.field} />;
    }
    case "TimestampTz":
      return <TimestampTzCell {...props} field={props.field} />;
    case "TimestampNaive":
      return <TimestampNaiveCell {...props} field={props.field} />;
    case "TimestampUtc":
      return <TimestampUtcCell {...props} field={props.field} />;
    case "Bytes": {
      if (props.field.group) {
        const table = system.db.tables[props.tableName];
        const group = table.fieldGroups[props.field.group];
        if (group instanceof ImageSetFieldGroup) {
          return <ImageSetCell {...props} group={group} />;
        }
      }
      if (props.field.usage?.type === "Secret") {
        return <SecretCell {...props} field={props.field} />;
      }
      throw new Error(
        `${props.field.type} fields are not supported, field ${props.field.name}`,
      );
    }
    case "PhoneNumber":
      return <PhoneNumberCell {...props} field={props.field} />;
    case "Ordering":
    case "Time":
    case "Tx":
    case "Json":
      throw new Error(
        `${props.field.type} fields are not supported, field ${props.field.name}`,
      );
  }
}
