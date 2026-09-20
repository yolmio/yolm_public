import { Button } from "components/button";
import { LabelOnLeftFormField } from "components/label_on_left_form_field";
import { Typography } from "components/typography";
import { getHrefToRecord, isTableLinkable } from "std/shared_contexts";
import { sql } from "../std/sql_utils";
import type { AnyExpr } from "../std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { containerStyles } from "std/style_utils";
import { createStyles } from "std/style_utils";
import { system } from "std/system";
import { Data } from "std/data";
import { Route, useSourceMap } from "std/ui";
import type { Node } from "std/ui";
import { Form } from "std/form";
import type { FormContext, WriteProcExtensions } from "std/form";

export const styles = createStyles({
  root: () => [
    containerStyles(),
    {
      mx: "auto",
      my: 8,
      pb: 8,
      display: "flex",
      flexDirection: "column",
    },
  ],
  notContentWrapper: {
    display: "flex",
    justifyContent: "center",
    mt: 16,
  },
});

export interface FieldOverride {
  label?: Node;
  initialValue?: AnyExpr;
}

export interface AutoInsertFormPageProps extends WriteProcExtensions {
  table: string;
  path?: string;
  title?: Node;
  ignoreFields?: string[];
  fieldOverrides?: Record<string, FieldOverride>;
  values?: Record<string, AnyExpr>;
  navigateAfterInsert?: boolean;
  disableNavigateAfterInsert?: boolean;
}

export function AutoInsertForm(props: AutoInsertFormPageProps) {
  useSourceMap(`AutoInsertFormPage(table: "${props.table}")`);
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table "${props.table}" not found`);
  }
  const pathBase = table.getBaseUrl();
  const title = props.title ?? `Add ${table.displayName}`;
  const returnUrl = sql.concat("/", pathBase);
  const afterTransactionCommit = (s: UiServerStatements, ctx: FormContext) => {
    props.afterTransactionCommit?.(s, ctx);
    if (props.navigateAfterInsert && !props.disableNavigateAfterInsert) {
      if (!isTableLinkable(table)) {
        throw new Error(
          `Table ${table.name} cannot be linked to, you cannot navigate after insert`,
        );
      }
      s.defScalar(
        "auto_inserted_record_id",
        sql`last_record_id(${table.identWithDb})`,
      );
      s.navigate(getHrefToRecord(table, sql`auto_inserted_record_id`));
    } else if (!props.disableNavigateAfterInsert) {
      s.navigate(returnUrl);
    }
  };
  return (
    <div sx={styles.root()}>
      <Data procedure={(_s) => {}}>
        <div className="flex flex-col gap-4">
          {title && <Typography level="h2">{title}</Typography>}
          <Form
            beforeSubmitClient={props.beforeSubmitClient}
            beforeTransactionStart={props.beforeTransactionStart}
            afterTransactionStart={props.afterTransactionStart}
            beforeTransactionCommit={props.beforeTransactionCommit}
            afterTransactionCommit={afterTransactionCommit}
            afterSubmitClientSuccess={props.afterSubmitClientSuccess}
          >
            <Form.Insert table={table.name} values={props.values}>
              {Object.values(table.fields)
                .filter(
                  (field) =>
                    !(
                      props.ignoreFields?.includes(field.name) ||
                      (props.values && field.name in props.values) ||
                      field.type === "Bytes" ||
                      field.type === "Json"
                    ),
                )
                .map((field) => {
                  const override = props.fieldOverrides?.[field.name];
                  return (
                    <Form.Field
                      field={field.name}
                      initialValue={override?.initialValue}
                    >
                      <LabelOnLeftFormField label={override?.label} />
                    </Form.Field>
                  );
                })}
            </Form.Insert>
            <Form.ErrorAlert className="mt-3" mode="all" size="lg" />
            <div className="flex justify-end gap-3">
              <Button variant="outlined" href={returnUrl}>
                Cancel
              </Button>
              <Form.SubmitButton>Add</Form.SubmitButton>
            </div>
          </Form>
        </div>
      </Data>
    </div>
  );
}

/**
Automatically generates a page with a form for inserting a new record into a table and handles display, submission and navigation.

 **Self-routing: do NOT wrap in a Route component.**

 @category Page Component

 @prop table - The name of the table to insert into.
 @prop [path] - The URL path for this page. If not provided, it will be generated based on the table name.
 @prop [ignoreFields] - An array of field names to ignore when generating the form.
 @prop [fieldOverrides] - An object to override default field configurations.
 @prop [values] - An object containing initial values for fields.
 @prop [afterSubmitClientSuccess] - A function to be called after a successful submission on the client side.

 */
export function AutoInsertFormPage(props: AutoInsertFormPageProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table "${props.table}" not found`);
  }
  const pathBase = table.getBaseUrl();
  const path = props.path ?? `/${pathBase}/new`;
  return (
    <Route path={path}>
      <AutoInsertForm {...props} />
    </Route>
  );
}
