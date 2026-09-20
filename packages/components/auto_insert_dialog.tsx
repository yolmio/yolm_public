import {
  CurrentRecordICtxKey,
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
} from "std/ictx";
import { singularize } from "std/inflectors";
import { getHrefToRecordOptional } from "std/shared_contexts";
import { sql } from "../std/sql_utils";
import type { NumericExpr } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { AnyExpr } from "../std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { system } from "std/system";
import type { Table } from "std/system";
import { useICtx, useOptionalICtx, usePhase, useUniqueId } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { Form } from "std/form";
import type { WriteProcExtensions } from "std/form";
import type { FormContext } from "std/form";
import { Button } from "./button";
import type { ButtonProps } from "./button";
import { IconButton } from "./icon_button";
import type { IconButtonProps } from "./icon_button";
import { PageKeyboardShortcuts } from "./keyboard_shortcuts";
import { LabelOnLeftFormField } from "./label_on_left_form_field";
import type { ListItemButtonProps } from "./list";
import { Menu, useDropdownNode, useDropdownState } from "./menu";
import { ModalDialog } from "./modal";
import { Typography } from "./typography";
import { resolveDialogBinding } from "./utils";
import type { DialogBinding } from "./utils";

interface BaseAutoInsertDialogProps extends WriteProcExtensions {
  table?: string;
  ignoreFields?: string[];
  fieldOverrides?: Record<string, FieldOverride>;
  values?: Record<string, AnyExpr>;
  navigateAfterInsert?: boolean;
  disableAutoRefetch?: boolean;
  parentRecordId?: NumericExpr;
  parentTable?: string;
  parentField?: string;
  header?: Node;
  /** Custom UI-only fields rendered before the generated database fields. */
  temporaryFields?: Node;
}

interface AutoInsertDialogProps
  extends DialogBinding, BaseAutoInsertDialogProps {}

/** Per-field customization for an auto-generated insert form field. */
export interface FieldOverride {
  /** Replaces the field's auto-derived label. */
  label?: Node;
  /** Pre-fills the field with this expression when the dialog opens. */
  initialValue?: AnyExpr;
}

function resolveTable(table?: string) {
  if (!table) {
    return useICtx(CurrentTableICtxKey).currentTable;
  }
  const tableModel = system.db.tables[table];
  if (!tableModel) {
    throw new Error(`Table ${table} not found`);
  }
  return tableModel;
}

function resolveParentRecord(
  currentTable: Table,
  parentRecordId?: NumericExpr,
  parentTable?: string,
  parentField?: string,
) {
  let recordId = parentRecordId;
  const fromContext = !parentRecordId;
  if (fromContext) {
    recordId = useOptionalICtx(CurrentRecordICtxKey)?.currentRecordId;
  }
  if (!recordId) {
    return;
  }
  if (parentField) {
    return {
      field: parentField,
      value: recordId,
    };
  }
  let table = parentTable;
  if (!parentTable) {
    table = useOptionalICtx(CurrentTableICtxKey)?.parentCurrentTable
      ?.currentTable
      ?.name;
  }
  if (!table) {
    if (fromContext) {
      return;
    }
    throw new Error("Parent record supplied, but was unable to resolve field");
  }
  const tableModel = system.db.tables[table];
  if (!tableModel) {
    throw new Error(`Table ${table} not found`);
  }
  if (currentTable.name === table) {
    return;
  }
  const foreignKeyField = Object.values(currentTable.fields).find(
    (f) => f.type === "ForeignKey" && f.table === table,
  );
  if (!foreignKeyField) {
    return;
  }
  return {
    field: foreignKeyField.name,
    value: recordId,
  };
}

/**
 A component that renders a dialog for inserting a new record into a specified table and includes the logic of inserting the record into the database and optionally navigating to the new record

 @category Dialog Component

 @param props.open - Whether the dialog is open.
 @param props.onClose
 @param props.table - The name of the table to insert into.
 @param props.ignoreFields - Fields to ignore when rendering the form.
 @param props.fieldOverrides - Overrides for field properties.
 @param props.values - Initial values for the form fields.
 @param props.beforeSubmitClient
 @param props.beforeTransactionStart
 @param props.afterTransactionStart
 @param props.beforeTransactionCommit
 @param props.afterTransactionCommit
 @param props.afterSubmitClientSuccess
 @param props.navigateAfterInsert - Whether to navigate to the new record after insertion.
 @param props.disableAutoRefetch - Whether to disable automatic refetching after insertion.
 @param props.parentRecordId
 @param props.parentTable
 @param props.parentField
 @param props.temporaryFields - Custom UI-only fields rendered before the generated database fields.

  @examples

 <AutoInsertDialog
   open={isOpen}
   onClose={handleClose}
   table="customers"
   navigateAfterInsert={true}
 />
 */
export function AutoInsertDialog(props: AutoInsertDialogProps) {
  const { open, onClose } = resolveDialogBinding(props);
  const tableModel = resolveTable(props.table);
  const refetchCtx = useOptionalICtx(CurrentRefetchICtxKey);
  if (props.navigateAfterInsert) {
    if (!getHrefToRecordOptional(tableModel, sql`0`)) {
      throw new Error(
        `Table ${tableModel.name} cannot be linked to, you cannot navigate after insert`,
      );
    }
  }
  const beforeTransactionCommit = (
    s: UiServerStatements,
    ctx: FormContext,
  ) => {
    if (props.navigateAfterInsert) {
      s.defScalar(
        "auto_inserted_record_id",
        sql`last_record_id(${tableModel.identWithDb})`,
      );
    }
    props.beforeTransactionCommit?.(s, ctx);
  };
  const afterTransactionCommit = (s: UiServerStatements, ctx: FormContext) => {
    if (props.navigateAfterInsert) {
      s.navigate(
        getHrefToRecordOptional(tableModel, sql`auto_inserted_record_id`),
      );
    }
    if (!props.disableAutoRefetch) {
      refetchCtx?.triggerRefetch(s);
    }
    props.afterTransactionCommit?.(s, ctx);
  };
  const afterSubmitClientSuccess = (s: DomStatements, ctx: FormContext) => {
    props.afterSubmitClientSuccess?.(s, ctx);
    s.statements(onClose);
  };
  const values = { ...(props.values ?? {}) };
  const parentRecord = resolveParentRecord(
    tableModel,
    props.parentRecordId,
    props.parentTable,
    props.parentField,
  );
  if (parentRecord) {
    values[parentRecord.field] = parentRecord.value;
  }
  const filteredFields = Object.values(tableModel.fields).filter(
    (field) =>
      !(props.ignoreFields?.includes(field.name) || field.name in values ||
        field.name === "created_at" || field.name === "last_modified_at"),
  );
  // Comboboxes look very weird when focused as soon as the dialog opens, so we don't focus them
  const shouldFocusTitle = filteredFields[0]?.type === "ForeignKey";
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      className="flex flex-col gap-4 p-6"
    >
      {props.header ?? (
        <Typography
          level="title-lg"
          tabIndex={shouldFocusTitle ? 0 : undefined}
        >
          Add {singularize(tableModel.displayName)}
        </Typography>
      )}
      <Form
        beforeSubmitClient={props.beforeSubmitClient}
        beforeTransactionStart={props.beforeTransactionStart}
        afterTransactionStart={props.afterTransactionStart}
        beforeTransactionCommit={beforeTransactionCommit}
        afterTransactionCommit={afterTransactionCommit}
        afterSubmitClientSuccess={afterSubmitClientSuccess}
        onSubmitError={props.onSubmitError}
        onSubmitServerError={props.onSubmitServerError}
      >
        <Form.Insert table={tableModel.name} values={values}>
          {props.temporaryFields}
          {filteredFields.map((field) => {
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
        <div className="flex justify-end gap-3">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.statements(onClose)}
          >
            Cancel
          </Button>
          <Form.SubmitButton>Add</Form.SubmitButton>
        </div>
        <Form.ErrorAlert className="mt-3" mode="all" size="lg" />
      </Form>
    </ModalDialog>
  );
}

function extractAutoInsertProps(
  props: BaseAutoInsertDialogProps,
): [BaseAutoInsertDialogProps, Record<string, any>] {
  const {
    table,
    ignoreFields,
    fieldOverrides,
    values,
    beforeSubmitClient,
    beforeTransactionStart,
    afterTransactionStart,
    beforeTransactionCommit,
    afterTransactionCommit,
    afterSubmitClientSuccess,
    onSubmitError,
    onSubmitServerError,
    navigateAfterInsert,
    header,
    temporaryFields,
    disableAutoRefetch,
    parentRecordId,
    parentTable,
    parentField,
    ...rest
  } = props;
  return [
    {
      table,
      ignoreFields,
      fieldOverrides,
      values,
      beforeSubmitClient,
      beforeTransactionStart,
      afterTransactionStart,
      beforeTransactionCommit,
      afterTransactionCommit,
      afterSubmitClientSuccess,
      onSubmitError,
      onSubmitServerError,
      navigateAfterInsert,
      header,
      temporaryFields,
      disableAutoRefetch,
      parentRecordId,
      parentTable,
      parentField,
    },
    rest,
  ];
}

/**
  A button component that opens a dialog for inserting a new record into a table.
  When clicked, opens a modal dialog with auto-generated form fields based on the table schema.
  The dialog handles validation and submission of the new record.

  @category Dialog Component
 */
export function AutoInsertButton(
  props:
    & Omit<ButtonProps, "onClick">
    & BaseAutoInsertDialogProps
    & {
      addPageKeyboardShortcut?: boolean;
    },
) {
  if (usePhase() === "gather") {
    return;
  }
  const tableModel = resolveTable(props.table);
  const openScalar = `auto_${tableModel.name}_insert_dialog_open`;
  const [autoInsertProps, buttonProps] = extractAutoInsertProps(props);
  const {
    id = props.addPageKeyboardShortcut ? useUniqueId() : undefined,
    addPageKeyboardShortcut: _,
    ...rest
  } = buttonProps;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar(openScalar, false);
      }}
    >
      <Button
        {...(rest as any)}
        id={id}
        onClick={(s) => s.setScalar(openScalar, true)}
      />
      <AutoInsertDialog bindScalar={openScalar} {...autoInsertProps} />
      {props.addPageKeyboardShortcut && (
        <PageKeyboardShortcuts pageAddButtonId={id} />
      )}
    </Data>
  );
}

/** Props for {@link AutoInsertIconButton}: icon-button props plus the auto-insert dialog options. */
export type AutoInsertIconButtonProps =
  & Omit<
    IconButtonProps,
    "onClick" | "onClose" | "aria-label"
  >
  & {
    "aria-label"?: string | Sql;
    /** Register a page-level keyboard shortcut that opens this dialog. */
    addPageKeyboardShortcut?: boolean;
  }
  & BaseAutoInsertDialogProps;

/**
An iconbutton component that opens a dialog for inserting a new record into a table.
When clicked, opens a modal dialog with auto-generated form fields based on the table schema.
The dialog handles validation and submission of the new record.

@category Dialog Component
 */
export function AutoInsertIconButton(props: AutoInsertIconButtonProps) {
  if (usePhase() === "gather") {
    return;
  }
  const tableModel = resolveTable(props.table);
  const openScalar = `auto_${tableModel.name}_insert_dialog_open`;
  const [autoInsertProps, buttonProps] = extractAutoInsertProps(props);
  let {
    icon,
    children,
    "aria-label": ariaLabel = `Add ${tableModel.displayName}`,
    id = props.addPageKeyboardShortcut ? useUniqueId() : undefined,
    addPageKeyboardShortcut: _,
    ...rest
  } = buttonProps;
  if (!(icon || children)) {
    icon = "Add";
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
        id={id}
        {...(rest as any)}
        onClick={(s) => s.setScalar(openScalar, true)}
      >
        {children}
      </IconButton>
      <AutoInsertDialog bindScalar={openScalar} {...autoInsertProps} />
      {props.addPageKeyboardShortcut && (
        <PageKeyboardShortcuts pageAddButtonId={id} />
      )}
    </Data>
  );
}

AutoInsertIconButton.getSource = () => "AutoInsertIconButton";

/**
 * A {@link Menu} item that opens an {@link AutoInsertDialog} for the table.
 * Use inside a dropdown/menu where an "Add" action should sit alongside
 * other menu items. Defaults its label to "Add".
 *
 * @category Dialog Component
 */
export function AutoInsertMenuItem(
  props:
    & Omit<ListItemButtonProps, "onClick" | "children">
    & BaseAutoInsertDialogProps
    & {
      children?: Node;
    },
) {
  const tableModel = resolveTable(props.table);
  const openScalar = `auto_${tableModel.name}_insert_dialog_open`;
  useDropdownState(openScalar, (s) => {
    s.defScalar(openScalar, false);
  });
  const [autoInsertProps, buttonProps] = extractAutoInsertProps(props);
  useDropdownNode(
    openScalar,
    <AutoInsertDialog bindScalar={openScalar} {...autoInsertProps} />,
  );
  return (
    <Menu.Item
      onClick={(s) => {
        s.setScalar(openScalar, true);
      }}
      {...buttonProps}
    >
      {props.children ?? "Add"}
    </Menu.Item>
  );
}
