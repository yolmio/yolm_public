import {
  CurrentRecordICtxKey,
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
} from "std/ictx";
import { singularize } from "std/inflectors";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { AnyExpr } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { system } from "std/system";
import type { Table } from "std/system";
import { Match, Switch, useOptionalICtx } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { Form } from "std/form";
import type { WriteProcExtensions } from "std/form";
import type { FormContext } from "std/form";
import { Alert } from "./alert";
import { Button } from "./button";
import type { ButtonProps } from "./button";
import { CircularProgress } from "./circular_progress";
import { IconButton } from "./icon_button";
import type { IconButtonProps } from "./icon_button";
import { LabelOnLeftFormField } from "./label_on_left_form_field";
import type { ListItemButtonProps } from "./list";
import { Menu, useDropdownNode, useDropdownState } from "./menu";
import { ModalDialog } from "./modal";
import { Typography } from "./typography";
import { resolveDialogBinding } from "./utils";
import type { DialogBinding } from "./utils";

interface BaseAutoUpdateDialogProps extends WriteProcExtensions {
  table?: string;
  recordId?: AnyExpr;
  fields?: string[];
  ignoreFields?: string[];
  fieldOverrides?: Record<string, FieldOverride>;
  /** Fixed field values applied when the record is updated. */
  values?: Record<string, AnyExpr>;
  disableAutoRefetch?: boolean;
  parentTable?: string;
  parentField?: string;
  /** Custom field nodes rendered before the generated database fields. */
  temporaryFields?: Node;
}

interface AutoUpdateDialogProps
  extends DialogBinding, BaseAutoUpdateDialogProps {}

/** Per-field customization for an auto-generated update form field. */
export interface FieldOverride {
  /** Replaces the field's auto-derived label. */
  label?: Node;
  /**
   * Initial value forwarded to the field. Note: the update dialog seeds
   * fields from the existing record, so this is currently only applied by
   * the insert dialog (`components/auto_insert_dialog`), not on the update path.
   */
  initialValue?: AnyExpr;
}

function resolveTable(table?: string) {
  const tableCtx = useOptionalICtx(CurrentTableICtxKey);
  const resolvedTable = table || tableCtx?.currentTable;
  if (!resolvedTable) {
    throw new Error("Table not provided and not found in context");
  }
  const tableModel = typeof resolvedTable === "string"
    ? system.db.tables[resolvedTable]
    : resolvedTable;
  if (!tableModel) {
    throw new Error(`Table ${resolvedTable} not found`);
  }
  return tableModel;
}

function resolveTableAndRecordId(table?: string, recordId?: AnyExpr) {
  const tableModel = resolveTable(table);
  const recordCtx = useOptionalICtx(CurrentRecordICtxKey);
  const resolvedRecordId = recordId ?? recordCtx?.currentRecordId;
  if (resolvedRecordId === undefined || resolvedRecordId === null) {
    throw new Error("Record ID not provided and not found in context");
  }
  return { table: tableModel, recordId: resolvedRecordId };
}

function resolveParentField(
  currentTable: Table,
  parentTable?: string,
  parentField?: string,
) {
  if (parentField) {
    return parentField;
  }
  let table = parentTable;
  if (!parentTable) {
    table = useOptionalICtx(CurrentTableICtxKey)?.parentCurrentTable
      ?.currentTable
      ?.name;
  }
  if (!table) {
    return;
  }
  return Object.values(currentTable.fields).find(
    (f) => f.type === "ForeignKey" && f.table === table,
  )?.name;
}

/**
 A component that renders a dialog for updating a record in a specified table and includes the logic of updating the record in the database and optionally refetching the parent table.

 @category Dialog Component

 */
export function AutoUpdateDialog(props: AutoUpdateDialogProps) {
  const { open, onClose } = resolveDialogBinding(props);
  const { table: tableModel, recordId } = resolveTableAndRecordId(
    props.table,
    props.recordId,
  );
  const refetchCtx = useOptionalICtx(CurrentRefetchICtxKey);
  const afterTransactionCommit = (s: UiServerStatements, ctx: FormContext) => {
    if (!props.disableAutoRefetch) {
      refetchCtx?.triggerRefetch(s);
    }
    props.afterTransactionCommit?.(s, ctx);
  };
  const afterSubmitClientSuccess = (s: DomStatements, ctx: FormContext) => {
    props.afterSubmitClientSuccess?.(s, ctx);
    s.statements(onClose);
  };
  const parentField = resolveParentField(
    tableModel,
    props.parentTable,
    props.parentField,
  );
  const filteredFields = Object.values(tableModel.fields).filter(
    (field) =>
      (!props.fields || props.fields.includes(field.name)) &&
      !(
        props.ignoreFields?.includes(field.name) ||
        Object.hasOwn(props.values ?? {}, field.name) ||
        // If we are updating a related record, the default behavior is to not update the foreign key
        parentField === field.name ||
        field.name === "created_at" || field.name === "last_modified_at"
      ),
  );
  // Comboboxes look very weird when focused as soon as the dialog opens, so we don't focus them
  const shouldFocusTitle = filteredFields[0]?.type === "ForeignKey";
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      className="flex flex-col gap-4 p-5"
    >
      <Typography level="title-lg" tabIndex={shouldFocusTitle ? 0 : undefined}>
        Edit {singularize(tableModel.displayName)}
      </Typography>
      <Form
        beforeSubmitClient={props.beforeSubmitClient}
        beforeTransactionStart={props.beforeTransactionStart}
        afterTransactionStart={props.afterTransactionStart}
        beforeTransactionCommit={props.beforeTransactionCommit}
        afterTransactionCommit={afterTransactionCommit}
        afterSubmitClientSuccess={afterSubmitClientSuccess}
        statusScalar="auto_update_status"
      >
        <Switch>
          <Match when={sql`auto_update_status = 'received'`}>
            <Form.Update
              table={tableModel.name}
              where={sql`id = ${recordId}`}
              setFields={props.values}
            >
              {props.temporaryFields}
              {filteredFields.map((field) => {
                const override = props.fieldOverrides?.[field.name];
                return (
                  <Form.Field field={field.name}>
                    <LabelOnLeftFormField label={override?.label} />
                  </Form.Field>
                );
              })}
            </Form.Update>
          </Match>
          <Match when={sql`auto_update_status = 'failed'`}>
            <Alert color="danger">
              Failed to get information from server. Please try again.
            </Alert>
            <Button
              variant="plain"
              color="neutral"
              onClick={(s) => s.statements(onClose)}
            >
              Cancel
            </Button>
          </Match>
          <Match when>
            <CircularProgress />
          </Match>
        </Switch>
        <div className="flex justify-end gap-3">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.statements(onClose)}
          >
            Cancel
          </Button>
          <Form.SubmitButton>Update</Form.SubmitButton>
        </div>
        <Form.ErrorAlert className="mt-3" mode="all" size="lg" />
      </Form>
    </ModalDialog>
  );
}

function extractAutoUpdateProps(
  props: BaseAutoUpdateDialogProps,
): [BaseAutoUpdateDialogProps, Record<string, any>] {
  const {
    table,
    recordId,
    fields,
    ignoreFields,
    fieldOverrides,
    values,
    beforeSubmitClient,
    beforeTransactionStart,
    afterTransactionStart,
    beforeTransactionCommit,
    afterTransactionCommit,
    afterSubmitClientSuccess,
    temporaryFields,
    disableAutoRefetch,
    parentTable,
    parentField,
    ...rest
  } = props;
  return [
    {
      table,
      recordId,
      fields,
      ignoreFields,
      fieldOverrides,
      values,
      beforeSubmitClient,
      beforeTransactionStart,
      afterTransactionStart,
      beforeTransactionCommit,
      afterTransactionCommit,
      afterSubmitClientSuccess,
      temporaryFields,
      disableAutoRefetch,
      parentTable,
      parentField,
    },
    rest,
  ];
}

/**
 * A {@link Button} that opens an {@link AutoUpdateDialog} for editing the
 * resolved record. Table and record id are taken from props or the
 * surrounding record/table context.
 *
 * @category Dialog Component
 */
export function AutoUpdateButton(
  props: Omit<ButtonProps, "onClick"> & BaseAutoUpdateDialogProps,
) {
  const tableModel = resolveTable(props.table);
  const openScalar = `auto_${tableModel.name}_update_dialog_open`;
  const [autoUpdateProps, buttonProps] = extractAutoUpdateProps(props);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar(openScalar, false);
      }}
    >
      <Button
        {...(buttonProps as any)}
        onClick={(s) => s.setScalar(openScalar, true)}
      />
      <AutoUpdateDialog bindScalar={openScalar} {...autoUpdateProps} />
    </Data>
  );
}

/**
 * An {@link IconButton} that opens an {@link AutoUpdateDialog} for editing
 * the resolved record. Defaults to an "Edit" icon and an
 * "Edit {table}" aria-label when none are supplied.
 *
 * @category Dialog Component
 */
export function AutoUpdateIconButton(
  props: Omit<IconButtonProps, "onClick" | "onClose" | "aria-label"> & {
    "aria-label"?: string | Sql;
  } & BaseAutoUpdateDialogProps,
) {
  const tableModel = resolveTable(props.table);
  const openScalar = `auto_${tableModel.name}_update_dialog_open`;
  const [autoUpdateProps, buttonProps] = extractAutoUpdateProps(props);
  let {
    icon,
    children,
    "aria-label": ariaLabel = `Edit ${tableModel.displayName}`,
    ...rest
  } = buttonProps;
  if (!(icon || children)) {
    icon = "Edit";
  }
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar(openScalar, false);
      }}
    >
      <IconButton
        icon={icon}
        aria-label={ariaLabel}
        {...(rest as any)}
        onClick={(s) => s.setScalar(openScalar, true)}
      >
        {children}
      </IconButton>
      <AutoUpdateDialog bindScalar={openScalar} {...autoUpdateProps} />
    </Data>
  );
}

/**
 * A {@link Menu} item that opens an {@link AutoUpdateDialog} for the
 * resolved record. Use inside a dropdown/menu where an "Edit" action
 * should sit alongside other menu items. Defaults its label to "Edit".
 *
 * @category Dialog Component
 */
export function AutoUpdateMenuItem(
  props:
    & Omit<ListItemButtonProps, "onClick" | "children">
    & BaseAutoUpdateDialogProps
    & {
      children?: Node;
    },
) {
  const tableModel = resolveTable(props.table);
  const openScalar = `auto_${tableModel.name}_update_dialog_open`;
  useDropdownState(openScalar, (s) => {
    s.defScalar(openScalar, false);
  });
  const [autoUpdateProps, buttonProps] = extractAutoUpdateProps(props);
  useDropdownNode(
    openScalar,
    <AutoUpdateDialog bindScalar={openScalar} {...autoUpdateProps} />,
  );
  return (
    <Menu.Item
      onClick={(s) => {
        s.setScalar(openScalar, true);
      }}
      {...buttonProps}
    >
      {props.children ?? "Edit"}
    </Menu.Item>
  );
}
