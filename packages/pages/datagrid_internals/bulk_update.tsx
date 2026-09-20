import { Alert } from "components/alert";
import { Button } from "components/button";
import { Divider } from "components/divider";

import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { Radio } from "components/radio";
import { RadioGroup } from "components/radio_group";
import { Select } from "components/select";
import { SwitchControl } from "components/switch";
import { Typography } from "components/typography";
import { getUniqueUiId } from "components/utils";
import {
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
  DynamicDatagridICtxKey,
} from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "../../std/sql_utils";
import type {
  DomStatements,
  DomStatementsOrFn,
  IStatementsBase,
} from "std/statements";
import { createStyles } from "std/style_utils";
import type { Field } from "std/system";
import { Data } from "std/data";
import { Match, Show, Switch, useICtx, usePhase, useSourceMap } from "std/ui";
import type { FormFieldHelper } from "std/form";
import {
  defaultInitialValue,
  defaultValidate,
  formFieldType,
  getDbValueFromFormValue,
} from "std/form";

export const styles = createStyles({
  header: {
    fontSize: "1.25em",
    mb: "0.25em",
  },
  modalDialog: {
    backgroundColor: "background-body",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    "--modal-dialog-min-width": "600px",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 4,
    mt: 2,
  },
  fieldForm: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minHeight: 220,
  },
  transformValue: {
    pl: 4,
  },
});

interface BulkUpdateDialogProps {
  onClose: DomStatementsOrFn;
  open: Sql;
}
interface BulkUpdateField {
  name: string;
  field: Field;
  index: number;
  type: ReturnType<typeof formFieldType>;
  initialValue: AnyExpr;
  helper: FormFieldHelper;
}

function createFieldValueForDyn(field: Field, value: AnyExpr): AnyExpr {
  switch (field.type) {
    case "String":
    case "Enum":
    case "Uuid":
      return sql`literal.string(${value})`;
    case "PhoneNumber":
      return sql.concat("phone.parse(", sql`literal.string(${value})`, ")");
    case "TinyInt":
    case "SmallInt":
    case "Int":
    case "BigInt":
    case "TinyUint":
    case "SmallUint":
    case "Uint":
    case "BigUint":
    case "ForeignKey":
    case "Decimal":
    case "Double":
    case "Real":
    case "Tx":
      return sql`literal.number(${value})`;
    case "Date":
      return sql`literal.date(${value})`;
    case "TimestampNaive":
    case "TimestampUtc":
    case "TimestampTz":
    case "Time":
      return sql`literal.timestamp(${value})`;
    case "Bool":
      return sql`literal.bool(${value})`;
    case "Ordering":
    case "Bytes":
    case "Json":
      throw new Error(`${field.type} not implemented for forms`);
    default:
      throw new Error(`Unknown field type: ${(field as Field).type}`);
  }
}

export function BulkUpdateDialog({ onClose, open }: BulkUpdateDialogProps) {
  if (usePhase() === "gather") {
    return;
  }
  useSourceMap("BulkUpdateDialog");

  const currentTableCtx = useICtx(CurrentTableICtxKey);
  const ctx = useICtx(DynamicDatagridICtxKey);
  const titleId = sql.lit(getUniqueUiId());
  const fieldInputId = sql.lit(getUniqueUiId());

  const fields: BulkUpdateField[] = Object.values(
    currentTableCtx.currentTable.fields,
  )
    .filter((f) => !f.unique)
    .map((f, i) => ({
      name: `field_${i}`,
      field: f,
      index: i,
      type: formFieldType(f),
      initialValue: defaultInitialValue(f),
      helper: {
        value: sql.ref(`field_${i}`),
        setValue: <T extends IStatementsBase>(s: T, value: AnyExpr) =>
          s.setScalar(`field_${i}`, value),
        error: sql`error`,
        hasError: sql`error is not null`,
        setError: <T extends IStatementsBase>(s: T, error: Sql) =>
          s.setScalar("error", error),
        touched: sql.ref(`field_${i}_touched`),
        setTouched: <T extends IStatementsBase>(s: T, touched: BooleanExpr) =>
          s.setScalar(`field_${i}_touched`, touched),
      } as FormFieldHelper,
    }));

  function submit(s: DomStatements) {
    s.returnIf(sql`waiting`);
    s.setScalar("error", sql.null);
    for (const field of fields) {
      s.if(sql`selected_field = ${field.index}`, (s) => {
        defaultValidate(field.field, field.helper, s);
        s.if(
          sql`${sql.ref(`${field.name}_touched`)} = false and ${
            sql.ref(field.name)
          } is not null`,
          (s) => {
            s.setScalar(`${field.name}_touched`, true);
          },
        );
      });
    }
    s.returnIf(sql`error is not null`);
    s.setScalar("waiting", true);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
        for (const field of fields) {
          s.if(sql`selected_field = ${field.index}`, (s) => {
            const baseValue = createFieldValueForDyn(
              field.field,
              getDbValueFromFormValue(field.field, field.helper.value),
            );
            const ctx = useICtx(DynamicDatagridICtxKey);

            const fieldAsString = sql.lit(field.field.ident.toSQL());
            const value = field.field.notNull
              ? sql`case
                  when kind in ('to_value', 'to_null') then ${baseValue}
                  when kind = 'lowercase' then concat('lower(', ${fieldAsString}, ')')
                  when kind = 'uppercase' then concat('upper(', ${fieldAsString}, ')')
                  when kind = 'capitalize' then concat('string.capitalize(', ${fieldAsString}, ')')
                  when kind = 'titleize' then concat('string.titleize(', ${fieldAsString}, ')')
                  end`
              : sql`case
                when kind = 'to_null' then 'null'
                when kind = 'to_value' then ${baseValue}
                when kind = 'lowercase' then concat('lower(', ${fieldAsString}, ')')
                when kind = 'uppercase' then concat('upper(', ${fieldAsString}, ')')
                when kind = 'capitalize' then concat('string.capitalize(', ${fieldAsString}, ')')
                when kind = 'titleize' then concat('string.titleize(', ${fieldAsString}, ')')
                end`;
            s.conditional({
              condition:
                sql`selected_all or not exists (select 1 from selected_row)`,
              then: (s) => {
                s.dynamicModify(
                  sql.concat(
                    `update ${currentTableCtx.currentTable.identWithDb.toSQL()} as record set ${field.field.ident.toSQL()} = `,
                    value,
                    " where ",
                    ctx.buildWherePart(s),
                  ),
                );
              },
              else: (s) => {
                s.dynamicModify(
                  sql.concat(
                    `update ${currentTableCtx.currentTable.identWithDb.toSQL()} as record set ${field.field.ident.toSQL()} = `,
                    value,
                    " where id in (",
                    sql`(select string_agg(id, ',') from selected_row)`,
                    ")",
                  ),
                );
              },
            });
          });
        }
        s.commitTransaction();
        triggerRefetch(s);
      },
      errorName: "service_error",
      catch: (s) => {
        s.setScalar(
          "error",
          sql.concat(
            "Error ",
            sql`service_error.type`,
            sql`coalesce(service_error.message, '')`,
            sql`coalesce(service_error.description, '')`,
          ),
        );
      },
    });
    s.setScalar("waiting", false);
    s.if(sql`error is null`, (s) => {
      s.setScalar("success", true);
    });
  }

  return (
    <ModalDialog
      onClose={onClose}
      open={open}
      size="lg"
      sx={styles.modalDialog}
      role="dialog"
      aria-labelledby={titleId}
    >
      <Data
        autoWatch={false}
        procedure={(s) => {
          s.defScalar("waiting", false);
          s.defScalar("success", false);
          s.defScalar("selected_field", 0);
          s.defScalar("kind", sql`'to_null'`);
          s.defScalar("total_count", { type: "BigUint" });
          for (const f of fields) {
            s.defScalar(f.name, {
              type: f.type,
              expr: f.initialValue,
            });
            s.defScalar(`${f.name}_touched`, false);
          }
          s.defScalar("error", {
            type: { type: "String", maxLength: 65000 },
            expr: sql.null,
            allowNoRead: true,
          });
          s.conditional({
            condition:
              sql`selected_all or not exists (select 1 from selected_row)`,
            then: (s) => {
              s.dynamicQuery({
                query: ctx.buildCountQuery(s),
                columnCount: 1,
                resultTable: "total_count_query",
              });
              s.setScalar(
                "total_count",
                sql`(select field_0 from total_count_query)::bigint`,
              );
            },
            else: (s) => {
              s.setScalar(
                "total_count",
                sql`(select count(*) from selected_row)`,
              );
            },
          });
        }}
      >
        <Typography level="h2" sx={styles.header} id={titleId}>
          {sql.concat("Update ", sql`format.decimal(total_count)`, " records")}
        </Typography>
        <Divider />
        <div sx={styles.fieldForm}>
          <FormControl>
            <FormLabel htmlFor={fieldInputId}>Select field to update</FormLabel>
            <Select
              value={sql`selected_field::string`}
              id={fieldInputId}
              onChange={(s) => {
                s.setScalar(
                  "kind",
                  sql`'to_null'`,
                );
                s.setScalar("selected_field", sql`target_value::smallint`);
              }}
            >
              {fields.map((f, i) => (
                <Select.Option value={i.toString()}>
                  {sql.lit(f.field.displayName)}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
          <Switch>
            {fields.map((field, i) => (
              <Match when={sql`selected_field = ${i}`}>
                <FieldUpdateOptions field={field} />
              </Match>
            ))}
          </Switch>
        </div>
        <Show when={sql`success`}>
          <Alert
            startDecorator={<MaterialIcon icon="Check" />}
            size="sm"
            color="success"
          >
            {sql`'Successfully updated ' || format.decimal(total_count) || ' records'`}
          </Alert>
        </Show>
        <Show when={sql`error is not null`}>
          <Alert size="sm" color="danger">
            {sql`error`}
          </Alert>
        </Show>
        <div sx={styles.actions}>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Close
          </Button>
          <Button loading={sql`waiting`} onClick={submit}>
            Update
          </Button>
        </div>
      </Data>
    </ModalDialog>
  );
}

function FieldUpdateOptions({ field }: { field: BulkUpdateField }) {
  const fieldInputId = sql.lit(getUniqueUiId());

  if (field.field.type === "Bool" && !field.field.enumLike) {
    return (
      <div>
        {/*Example_SwitchControl_Start*/}
        <SwitchControl
          checked={field.helper.value}
          onCheckboxChange={(s) =>
            s.statements((s) => field.helper.setValue(s, sql`target_checked`))}
        />
        {/*Example_SwitchControl_End*/}
      </div>
    );
  }

  const fieldControl = (
    <FormControl>
      <FormLabel htmlFor={fieldInputId}>
        {sql.lit(field.field.displayName)}
      </FormLabel>
      <FieldFormControl
        field={field.field}
        id={fieldInputId}
        fieldHelper={field.helper}
      />
    </FormControl>
  );

  if (field.field.notNull) {
    return fieldControl;
  }

  return (
    <RadioGroup>
      <KindRadio label="Set to empty" kind="to_null" />
      <KindRadio label="Set to value" kind="to_value" />
      {field.field.type === "String" && (
        <Radio
          label="Transform value"
          checked={sql`kind in ('lowercase', 'uppercase', 'capitalize', 'titleize')`}
          onChange={(s) => {
            s.setScalar("kind", sql`'lowercase'`);
          }}
        />
      )}
      <Show when={sql`kind = 'to_value'`}>{fieldControl}</Show>
      {field.field.type === "String" && (
        <Show
          when={sql`kind in ('lowercase', 'uppercase', 'capitalize', 'titleize')`}
        >
          <div sx={styles.transformValue}>
            <RadioGroup>
              <KindRadio label="Lowercase (hello world)" kind="lowercase" />
              <KindRadio label="Uppercase (HELLO WORLD)" kind="uppercase" />
              <KindRadio label="Capitalize (Hello world)" kind="capitalize" />
              <KindRadio label="Titleize (Hello World)" kind="titleize" />
            </RadioGroup>
          </div>
        </Show>
      )}
    </RadioGroup>
  );
}

function KindRadio({ label, kind }: { label: string; kind: string }) {
  return (
    <Radio
      label={sql.lit(label)}
      checked={sql`kind = ${sql.lit(kind)}`}
      onChange={(s) => {
        s.setScalar("kind", sql.lit(kind));
      }}
    />
  );
}
