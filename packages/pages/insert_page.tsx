import { Input } from "components/input";
import { getHrefToRecordOptional } from "std/shared_contexts";
import { sql } from "std/sql_utils";
import type { AnyExpr } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Route } from "std/ui";
import type { Node } from "std/ui";
import { getTableBaseUrl } from "std/utils/url";
import { Form } from "std/form";
import type { FormContext, WriteProcExtensions } from "std/form";
import { singularize } from "std/inflectors";
import type { StringExpr } from "std/jsx-dev-runtime";

/** Props for {@link InsertPage}. See its JSDoc for the full description. */
export interface InsertPageProps extends WriteProcExtensions {
  /** Name of the table records will be inserted into. */
  table: string;
  /** Form contents (typically field components). */
  children: Node;
  /** Override the auto-derived route path. */
  path?: string;
  /** Document title. Defaults to `Add <singular table display name>`. */
  title?: StringExpr;
  /** Navigate to the newly-inserted record's detail page after submit. */
  navigateAfterSubmit?: boolean;
  /** When true, the form inserts multiple records (insertMany flow). */
  many?: boolean;
  /** Server-side default values written for every insert. */
  values?: Record<string, AnyExpr>;
  /** Node rendered in place of the form after a successful insert. */
  afterSuccessNode?: Node;
  /** Wraps the route content (outside the Form). Useful for adding layout wrappers like sidebars. */
  wrapper?: (children: Node) => Node;
}

/**
 Renders an insert page for a specified table.

 This component creates a route for inserting new records into a database table.
 It provides options for single or multiple inserts, custom navigation after submission,
 and various hooks for transaction handling.

 **Self-routing: do NOT wrap in a Route component.**

 @category Page Component

 @param table - The name of the table to insert records into
 @param many - Whether to allow inserting multiple records
 @param children - The child components to render within the insert form
 @param path - Custom path for the insert page route (default: /{table}/add)
 @param title - Document title override
 @param afterSubmitClientSuccess - Function to run after successful client-side submission
 @param afterTransactionCommit - Function to run after transaction commit
 @param afterTransactionStart - Function to run after transaction start
 @param beforeSubmitClient - Function to run before client-side submission
 @param beforeTransactionCommit - Function to run before transaction commit
 @param beforeTransactionStart - Function to run before transaction start
 @param navigateAfterSubmit - Whether to navigate to the newly inserted record after submission
 @param values - Default values for the insert form
 @param afterSuccessNode - Node to render after successful insertion

 @examples
[Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
*/
export function InsertPage({
  table,
  many,
  children,
  path,
  title,
  afterSubmitClientSuccess,
  afterTransactionCommit,
  afterTransactionStart,
  beforeSubmitClient,
  beforeTransactionCommit,
  beforeTransactionStart,
  navigateAfterSubmit,
  values,
  afterSuccessNode,
  wrapper,
}: InsertPageProps) {
  const pathBase = getTableBaseUrl(table);
  const tableModel = system.db.tables[table];
  if (!tableModel) {
    throw new Error(`Table ${table} not found`);
  }
  const routePath = path ?? `${pathBase}/add`;
  const updatedBeforeTransactionCommit = (
    s: UiServerStatements,
    ctx: FormContext,
  ) => {
    if (navigateAfterSubmit) {
      s.defScalar(
        "auto_inserted_record_id",
        sql`last_record_id(${tableModel.identWithDb})`,
      );
    }
    beforeTransactionCommit?.(s, ctx);
  };
  const updatedAfterTransactionCommit = (
    s: UiServerStatements,
    ctx: FormContext,
  ) => {
    if (navigateAfterSubmit) {
      const recordId = sql`auto_inserted_record_id`;
      const href = getHrefToRecordOptional(tableModel, recordId);
      if (!href) {
        throw new Error(
          `Table ${tableModel.name} cannot be linked to, you cannot navigate after insert`,
        );
      }
      s.navigate(href);
    }
    afterTransactionCommit?.(s, ctx);
  };
  const content = (
    <Form
      afterSuccessNode={afterSuccessNode}
      afterSubmitClientSuccess={afterSubmitClientSuccess}
      afterTransactionCommit={updatedAfterTransactionCommit}
      afterTransactionStart={afterTransactionStart}
      beforeSubmitClient={beforeSubmitClient}
      beforeTransactionCommit={updatedBeforeTransactionCommit}
      beforeTransactionStart={beforeTransactionStart}
      defaultFieldComponent={Input}
    >
      {many
        ? (
          <Form.InsertMany table={table} values={values}>
            {children}
          </Form.InsertMany>
        )
        : (
          <Form.Insert table={table} values={values}>
            {children}
          </Form.Insert>
        )}
    </Form>
  );
  const wrapped = wrapper ? wrapper(content) : content;
  return (
    <Route
      path={routePath}
      title={title ?? `Add ${singularize(tableModel.displayName)}`}
    >
      {wrapped}
    </Route>
  );
}
