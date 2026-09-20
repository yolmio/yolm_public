import { Alert } from "components/alert";
import { Button } from "components/button";
import { CircularProgress } from "components/circular_progress";
import { LabelOnLeftFormField } from "components/label_on_left_form_field";
import { Typography } from "components/typography";
import { sql } from "../std/sql_utils";
import type { AnyExpr } from "../std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { containerStyles } from "std/style_utils";
import { createStyles } from "std/style_utils";
import { system } from "std/system";
import { Match, Route, Switch, useSourceMap, useState } from "std/ui";
import type { Node } from "std/ui";
import { Form } from "std/form";
import type { FormContext, WriteProcExtensions } from "std/form";

/** Layout styles for {@link AutoUpdateForm} (centered container + loading/error wrapper). */
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

/** Per-field overrides for {@link AutoUpdateForm}, keyed by field name in `fieldOverrides`. */
export interface FieldOverride {
  label?: Node;
  /** Override the field's pre-filled value (defaults to the existing record value). */
  initialValue?: AnyExpr;
}

/** Props for {@link AutoUpdateForm} / {@link AutoUpdateFormPage}. Extends the {@link WriteProcExtensions} submit hooks. */
export interface AutoUpdateFormPageProps extends WriteProcExtensions {
  /** Table whose record is edited (the form reads `ui.record_id`). */
  table: string;
  /** Route path. Defaults to `/<table base url>/{record_id:id}/edit`. */
  path?: string;
  title?: Node;
  ignoreFields?: string[];
  /** Per-field label/initial-value overrides. */
  fieldOverrides?: Record<string, FieldOverride>;
  /** Stay on the form after a successful save instead of navigating back to the record. */
  disableNavigateAfterUpdate?: boolean;
}

/**
Generates an automatic update form for a specific table.

This component handles the display, submission, and navigation for updating an existing record in a table.

@category Page Component

@param props.table - The name of the table to update.
@param props.path - The URL path for this page. If not provided, it will be generated based on the table name.
@param props.title - The title to display at the top of the form.
@param props.ignoreFields - An array of field names to ignore when generating the form.
@param props.fieldOverrides - An object to override default field configurations.
@param props.disableNavigateAfterUpdate - If true, prevents automatic navigation after a successful update.
@param props.afterTransactionCommit
@param props.beforeSubmitClient
@param props.beforeTransactionStart
@param props.afterTransactionStart
@param props.beforeTransactionCommit
@param props.afterSubmitClientSuccess

*/
export function AutoUpdateForm(props: AutoUpdateFormPageProps) {
  useSourceMap(`AutoUpdateFormPage(table: "${props.table}")`);
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table "${props.table}" not found`);
  }
  const pathBase = table.getBaseUrl();
  const title = props.title ?? `Edit ${table.displayName}`;
  useState({
    procedure: (s) => {
      s.defScalar(
        "record_exists",
        sql`exists (select 1 from db.${
          sql.ref(table.name)
        } where id = ui.record_id)`,
      );
    },
    statusScalar: "status",
    hasDataScalar: "has_data",
  });
  const returnUrl = sql.concat("/", pathBase, "/", sql`record_id`);
  const afterTransactionCommit = (s: UiServerStatements, ctx: FormContext) => {
    props.afterTransactionCommit?.(s, ctx);
    if (!props.disableNavigateAfterUpdate) {
      s.navigate(returnUrl);
    }
  };
  return (
    <div sx={styles.root()}>
      <Switch>
        <Match when={sql`has_data and record_exists`}>
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
              <Form.Update table={table.name} where={sql`id = ui.record_id`}>
                {Object.values(table.fields)
                  .filter((field) =>
                    !props.ignoreFields?.includes(field.name) &&
                    field.type !== "Bytes" &&
                    field.type !== "Json"
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
              </Form.Update>
              <Form.ErrorAlert className="mt-3" mode="all" size="lg" />
              <div className="flex justify-end gap-3">
                <Button variant="outlined" href={returnUrl}>
                  Cancel
                </Button>
                <Form.SubmitButton>Save</Form.SubmitButton>
              </div>
            </Form>
          </div>
        </Match>
        <Match when={sql`has_data and not record_exists`}>
          <div sx={styles.notContentWrapper}>
            <Alert color="danger" startIcon="Report" size="lg">
              No {table.displayName.toLowerCase()} with id
            </Alert>
          </div>
        </Match>
        <Match
          when={sql`status = 'requested' or status = 'fallback_triggered'`}
        >
          <div sx={styles.notContentWrapper}>
            <CircularProgress size="lg" />
          </div>
        </Match>
        <Match when={sql`status = 'failed'`}>
          <div sx={styles.notContentWrapper}>
            <Alert color="danger" startIcon="Report" size="lg">
              Unable to load page
            </Alert>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

/**
Component that generates an automatic update form for a specific table.

**Self-routing: do NOT wrap in a Route component.**

@category Page Component

@examples
[Example](../../examples/northwind/apps/northwind.yolmstaging.net.tsx)
 */
export function AutoUpdateFormPage(props: AutoUpdateFormPageProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table "${props.table}" not found`);
  }
  const pathBase = table.getBaseUrl();
  const path = props.path ?? `/${pathBase}/{record_id:id}/edit`;
  return (
    <Route path={path}>
      <AutoUpdateForm {...props} />
    </Route>
  );
}
