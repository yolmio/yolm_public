import { sql } from "../std/sql_utils";
import { system } from "std/system";
import { Route } from "std/ui";
import type { Node } from "std/ui";
import { getTableBaseUrl } from "std/utils/url";
import { Form } from "std/form";
import type { WriteProcExtensions } from "std/form";
import { singularize } from "std/inflectors";
import type { StringExpr } from "std/jsx-dev-runtime";

/** Props for {@link UpdatePage}. See its JSDoc for the full description. */
export interface UpdatePageProps extends WriteProcExtensions {
  /** Name of the table whose records are being updated. */
  table: string;
  /** Form contents (typically field components). */
  children: Node;
  /** Override the auto-derived route path. */
  path?: string;
  /** Document title. Defaults to `Edit <singular table display name>`. */
  title?: StringExpr;
  /** Wraps the route content (outside the Form). Useful for adding layout wrappers like sidebars. */
  wrapper?: (children: Node) => Node;
}

/**
Renders an update page for a specified table.

This component creates a route for updating existing records in a database table.
It provides options for custom navigation paths and various hooks for transaction handling.

**Self-routing: do NOT wrap in a Route component.**

@category Page Component

@param table - The name of the table to update records in
@param children - The child components to render within the update form
@param path - Custom path for the update page route (default: /{table}/{record_id}/edit)
@param title - Document title override
@param afterSubmitClientSuccess
@param afterTransactionCommit
@param afterTransactionStart
@param beforeSubmitClient
@param beforeTransactionCommit
@param beforeTransactionStart

@examples
[Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
*/
export function UpdatePage({
  table,
  children,
  path,
  title,
  afterSubmitClientSuccess,
  afterTransactionCommit,
  afterTransactionStart,
  beforeSubmitClient,
  beforeTransactionCommit,
  beforeTransactionStart,
  wrapper,
}: UpdatePageProps) {
  const pathBase = getTableBaseUrl(table);
  const routePath = path ?? `/${pathBase}/{record_id:id}/edit`;
  const tableModel = system.db.tables[table];
  const content = (
    <Form
      afterSubmitClientSuccess={afterSubmitClientSuccess}
      afterTransactionCommit={afterTransactionCommit}
      afterTransactionStart={afterTransactionStart}
      beforeSubmitClient={beforeSubmitClient}
      beforeTransactionCommit={beforeTransactionCommit}
      beforeTransactionStart={beforeTransactionStart}
    >
      <Form.Update
        table={table}
        where={sql`${tableModel.primaryKeyIdent} = ui.record_id`}
      >
        {children}
      </Form.Update>
    </Form>
  );
  const wrapped = wrapper ? wrapper(content) : content;
  return (
    <Route
      path={routePath}
      title={title ?? `Edit ${singularize(tableModel.displayName)}`}
    >
      {wrapped}
    </Route>
  );
}
