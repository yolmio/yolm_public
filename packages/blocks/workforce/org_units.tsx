import { AutoInsertButton } from "components/auto_insert_dialog";
import { AutoUpdateButton } from "components/auto_update_dialog";
import { Hierarchy } from "components/hierarchy";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { WriteProcExtensions } from "std/form";
import type { WorkforceBlock } from "./index";

/** Organization-scoped hierarchy with child creation and transactional parent validation. */
export function WorkforceOrgUnitHierarchy(
  { workforce }: { workforce: WorkforceBlock },
) {
  const table = workforce.orgUnitsTable;
  if (!table) return null;
  const hooks: WriteProcExtensions = {
    afterTransactionStart: (s) => workforce.assertManagementSession(s),
    beforeTransactionCommit: (s) => {
      s.callStoredProcedure("workforce_validate_org_units", {});
      if (workforce.authRoleMappingsTable) {
        s.callStoredProcedure("workforce_reconcile_auth_rules", {});
      }
    },
  };
  const create = (parent?: Sql) => (
    <AutoInsertButton
      table={table}
      {...hooks}
      ignoreFields={["is_active"]}
      fieldOverrides={{
        parent_org_unit_id: { label: "Parent org unit", initialValue: parent },
        ...(parent && workforce.organizationsTable
          ? {
            workforce_organization_id: {
              initialValue: sql`(select workforce_organization_id from db.${
                sql.ref(table)
              } where id = ${parent})`,
            },
          }
          : {}),
      }}
      size="sm"
      variant="soft"
      startIcon="Add"
    >
      {parent ? "Add child unit" : "Add org unit"}
    </AutoInsertButton>
  );
  return (
    <Hierarchy
      label="Org units"
      expansionParam="expanded_org_units"
      emptyMessage="No org units yet. Add a department or division to get started."
      query={sql`select unit.id, unit.parent_org_unit_id as parent_id, unit.name, unit.name as path_label, unit.is_active as active,
      ${
        workforce.organizationsTable
          ? sql`(select name from db.${
            sql.ref(workforce.organizationsTable)
          } org where org.id = unit.workforce_organization_id)`
          : sql`cast(null as string)`
      } as subtitle
      from db.${sql.ref(table)} unit`}
      headerActions={workforce.opts.enableReferenceDataCreation
        ? create()
        : undefined}
      renderName={(id, name) => (
        <AutoUpdateButton
          table={table}
          recordId={id}
          {...hooks}
          fieldOverrides={{ parent_org_unit_id: { label: "Parent org unit" } }}
          size="sm"
          variant="plain"
        >
          {name}
        </AutoUpdateButton>
      )}
      rowActions={(id) =>
        workforce.opts.enableReferenceDataCreation ? create(id) : undefined}
    />
  );
}
