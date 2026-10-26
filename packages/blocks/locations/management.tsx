import { AutoInsertButton } from "components/auto_insert_dialog";
import { AutoUpdateButton } from "components/auto_update_dialog";
import { Hierarchy } from "components/hierarchy";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { WriteProcExtensions } from "std/form";
import type { Node } from "std/ui";
import type { LocationsBlock } from "./index";
import { locationPaths } from "./queries";

export interface LocationManagementProps extends WriteProcExtensions {
  locations: LocationsBlock;
  allowCreate?: boolean;
  /** Override the create action for operational workflows with additional required writes. */
  createAction?: Node;
  rowActions?: (id: Sql) => Node;
}

/** Shared location directory, with the same validation for every management surface. */
export function LocationManagement(props: LocationManagementProps) {
  const validate: WriteProcExtensions["beforeTransactionCommit"] = (
    s,
    form,
  ) => {
    props.beforeTransactionCommit?.(s, form);
    s.callStoredProcedure("validate_location_structure", {});
  };
  const hooks: WriteProcExtensions = {
    beforeSubmitClient: props.beforeSubmitClient,
    beforeTransactionStart: props.beforeTransactionStart,
    afterTransactionStart: props.afterTransactionStart,
    beforeTransactionCommit: validate,
    afterTransactionCommit: props.afterTransactionCommit,
    afterSubmitClientSuccess: props.afterSubmitClientSuccess,
    onSubmitError: props.onSubmitError,
    onSubmitServerError: props.onSubmitServerError,
  };
  const create = (parent?: Sql) => (
    <AutoInsertButton
      table={props.locations.locationsTable}
      {...hooks}
      beforeTransactionCommit={(s, form) => {
        props.locations.opts.afterCreate?.(
          s,
          sql`last_record_id(db.locations)`,
        );
        validate(s, form);
      }}
      ignoreFields={["active", "created_at", "external_system", "external_ref"]}
      fieldOverrides={{
        parent_location_id: { label: "Parent location", initialValue: parent },
      }}
      size="sm"
      variant="soft"
      startIcon="Add"
    >
      {parent ? "Add sublocation" : "Add location"}
    </AutoInsertButton>
  );
  return (
    <Hierarchy
      label="Locations"
      expansionParam="expanded_locations"
      emptyMessage="No locations yet. Add a location to get started."
      query={sql`select n.id, n.parent_location_id as parent_id, n.name, location.active,
        coalesce(n.code || ' · ', '') || n.name as path_label, n.code as subtitle
        from (${locationPaths()}) n join db.locations location on location.id = n.id`}
      headerActions={props.createAction ??
        (props.allowCreate ? create() : undefined)}
      renderName={(id, name) => (
        <AutoUpdateButton
          table={props.locations.locationsTable}
          recordId={id}
          {...hooks}
          ignoreFields={["created_at", "external_system", "external_ref"]}
          fieldOverrides={{ parent_location_id: { label: "Parent location" } }}
          variant="plain"
          size="sm"
        >
          {name}
        </AutoUpdateButton>
      )}
      rowActions={(id) =>
        props.rowActions?.(id) ?? (props.allowCreate ? create(id) : undefined)}
    />
  );
}
