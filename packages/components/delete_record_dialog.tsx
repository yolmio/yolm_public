import {
  CurrentRecordICtxKey,
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
} from "std/ictx";
import { sql } from "../std/sql_utils";
import type { NumericExpr, Sql } from "../std/sql_utils";
import type {
  DomStatementsOrFn,
  StateStatements,
  UiServerStatements,
  UiServerStatementsOrFn,
} from "std/statements";
import { system } from "std/system";
import type { Table } from "std/system";
import { singularize } from "std/inflectors";
import { Each, Show, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { Button } from "./button";
import type { ButtonProps } from "./button";
import { ConfirmDangerDialog } from "./confirm_danger_dialog";
import { useGlobalUndoSnackbar } from "./global_undo_snackbar";
import { IconButton } from "./icon_button";
import type { IconButtonProps } from "./icon_button";
import type { ListItemButtonProps } from "./list";
import { MaterialIcon } from "./material_icon";
import { Menu, useDropdownNode, useDropdownState } from "./menu";
import { resolveDialogBinding } from "./utils";
import type { DialogBinding } from "./utils";

interface RestrictDeleteBlocker {
  name: string;
  label: string;
  childTable: Table;
  fkFieldName: string;
}

interface PendingRestrictDeleteBlocker {
  name: string;
  childTable: Table;
  fkFieldName: string;
  fkFieldLabel: string;
}

interface BaseDeleteRecordDialogProps {
  table?: string;
  recordId?: NumericExpr;
  description?: Node;
  confirmButtonText?: Node;
  beforeSubmitClient?: DomStatementsOrFn;
  beforeTransactionStart?: UiServerStatementsOrFn;
  afterTransactionStart?: UiServerStatementsOrFn;
  beforeTransactionCommit?: UiServerStatementsOrFn;
  afterTransactionCommit?: UiServerStatementsOrFn;
  afterSubmitClient?: DomStatementsOrFn;
  disableAutoRefetch?: boolean;
}

interface DeleteRecordDialogProps
  extends BaseDeleteRecordDialogProps, DialogBinding {}

interface DeleteRecordsDialogProps extends DialogBinding {
  table?: string;
  targetIdsQuery: Sql;
  recordCount: Node;
  description?: Node;
  confirmButtonText?: Node;
  prepareTargetIds?: (s: StateStatements | UiServerStatements) => void;
  deleteRecords?: (
    s: UiServerStatements,
    targetIdsQuery: Sql,
    table: Table,
  ) => void;
  deletedRecordCountScalar?: string;
  beforeSubmitClient?: DomStatementsOrFn;
  beforeTransactionStart?: UiServerStatementsOrFn;
  afterTransactionStart?: UiServerStatementsOrFn;
  beforeTransactionCommit?: UiServerStatementsOrFn;
  afterTransactionCommit?: UiServerStatementsOrFn;
  afterSubmitClient?: DomStatementsOrFn;
  disableAutoRefetch?: boolean;
}

function resolveTable(table?: string) {
  const tableCtx = useOptionalICtx(CurrentTableICtxKey);
  const resolvedTable = table || tableCtx?.currentTable;
  if (!resolvedTable) {
    throw new Error("Table not provided and not found in context");
  }
  let tableModel: Table | undefined;
  if (typeof resolvedTable === "string") {
    tableModel = system.db.tables[resolvedTable];
    if (!tableModel) {
      throw new Error(`Table ${resolvedTable} not found`);
    }
  } else {
    tableModel = resolvedTable;
  }
  return tableModel;
}

function resolveTableAndRecordId(table?: string, recordId?: NumericExpr) {
  const tableModel = resolveTable(table);
  const recordCtx = useOptionalICtx(CurrentRecordICtxKey);
  const resolvedRecordId = recordId || recordCtx?.currentRecordId;
  if (!resolvedRecordId) {
    throw new Error("Record ID not provided and not found in context");
  }
  return { table: tableModel, recordId: resolvedRecordId };
}

function getRestrictDeleteBlockers(table: Table): RestrictDeleteBlocker[] {
  const blockers: PendingRestrictDeleteBlocker[] = [];
  for (const childTable of Object.values(system.db.tables)) {
    for (const field of Object.values(childTable.fields)) {
      if (
        field.type === "ForeignKey" &&
        field.table === table.name &&
        field.onDelete === "Restrict"
      ) {
        blockers.push({
          name: `${childTable.name}_${field.name}`,
          childTable,
          fkFieldName: field.name,
          fkFieldLabel: field.displayName,
        });
      }
    }
  }
  const childTableBlockerCounts = new Map<string, number>();
  for (const blocker of blockers) {
    childTableBlockerCounts.set(
      blocker.childTable.name,
      (childTableBlockerCounts.get(blocker.childTable.name) ?? 0) + 1,
    );
  }
  return blockers.map((blocker) => {
    const hasMultipleBlockersForTable =
      (childTableBlockerCounts.get(blocker.childTable.name) ?? 0) > 1;
    return {
      name: blocker.name,
      label: hasMultipleBlockersForTable
        ? `${blocker.childTable.displayName} (${blocker.fkFieldLabel})`
        : blocker.childTable.displayName,
      childTable: blocker.childTable,
      fkFieldName: blocker.fkFieldName,
    };
  });
}

/**
 * True if any other table has a `Restrict` foreign key pointing at `table`,
 * meaning a row could be blocked from deletion by related child rows.
 * Use to decide whether to surface a delete affordance at all.
 */
export function tableHasRestrictDeleteBlockers(table: Table) {
  return getRestrictDeleteBlockers(table).length > 0;
}

function restrictDeleteBlockerRowsQuery(table: Table, targetIdsQuery: Sql) {
  const blockers = getRestrictDeleteBlockers(table);
  if (blockers.length === 0) {
    return sql`
      select
        '' as name,
        '' as label,
        0::bigint as related_count,
        0::bigint as record_count
      where false
    `;
  }
  return sql.unionAll(
    ...blockers.map((blocker) => {
      const childFk = sql.ref("child", blocker.fkFieldName);
      return sql`
        select
          ${sql.lit(blocker.name)} as name,
          ${sql.lit(blocker.label)} as label,
          (
            select count(*)
            from ${blocker.childTable.identWithDb} as child
            where ${childFk} in (
              select id from (${targetIdsQuery}) as delete_target_ids
            )
          ) as related_count,
          (
            select count(*)
            from (${targetIdsQuery}) as delete_target_ids
            where exists (
              select 1
              from ${blocker.childTable.identWithDb} as child
              where ${childFk} = delete_target_ids.id
            )
          ) as record_count
      `;
    }),
  );
}

function restrictDeleteBlockersQuery(table: Table, targetIdsQuery: Sql) {
  return sql`
    select name, label, related_count, record_count
    from (${restrictDeleteBlockerRowsQuery(table, targetIdsQuery)}) as blockers
    where related_count > 0
    order by label
  `;
}

function throwIfRestrictDeleteBlocked(
  s: UiServerStatements,
  table: Table,
  targetIdsQuery: Sql,
) {
  for (const blocker of getRestrictDeleteBlockers(table)) {
    const childFk = sql.ref("child", blocker.fkFieldName);
    s.if(
      sql`exists (
        select 1
        from ${blocker.childTable.identWithDb} as child
        where ${childFk} in (
          select id from (${targetIdsQuery}) as delete_target_ids
        )
      )`,
      (s) => {
        s.throwError(sql.lit`delete_restrict_blocked`);
      },
    );
  }
}

/**
 * Confirmation dialog for deleting many records at once, identified by
 * `targetIdsQuery`. Wraps {@link ConfirmDangerDialog}; before deleting it
 * checks `Restrict` foreign keys and, if any related rows exist, lists the
 * blocking child tables and disables the confirm button instead of deleting.
 *
 * For deleting a single known record prefer {@link DeleteRecordDialog}.
 *
 * @category Dialog Component
 */
export function DeleteRecordsDialog(props: DeleteRecordsDialogProps) {
  const table = resolveTable(props.table);
  const refetchCtx = useOptionalICtx(CurrentRefetchICtxKey);
  const { open, onClose } = resolveDialogBinding(props);
  return (
    <Show when={open}>
      <Data
        procedure={(s) => {
          props.prepareTargetIds?.(s);
          s.defTable(
            "delete_restrict_blockers",
            restrictDeleteBlockersQuery(table, props.targetIdsQuery),
          );
        }}
      >
        <ConfirmDangerDialog
          open={open}
          onClose={onClose}
          confirmButtonText={props.confirmButtonText}
          disableConfirmButton={sql`exists (select 1 from delete_restrict_blockers)`}
          description={
            <Show
              when={sql`exists (select 1 from delete_restrict_blockers)`}
              fallback={props.description ?? (
                <>
                  Are you sure you want to delete {props.recordCount} records?
                </>
              )}
            >
              <div className="space-y-3">
                <p>
                  Some selected records still have related records. Remove or
                  reassign them before deleting.
                </p>
                <div className="rounded-[6px] border border-divider overflow-hidden">
                  <Each
                    table="delete_restrict_blockers"
                    recordName="blocker"
                  >
                    <div className="flex items-center justify-between gap-4 px-3 py-2 border-b border-divider last:border-b-0">
                      <span className="text-sm font-medium">
                        {sql`blocker.label`}
                      </span>
                      <span className="text-sm text-secondary">
                        {sql`
                          blocker.related_count || ' related ' ||
                          case when blocker.related_count = 1 then 'record' else 'records' end ||
                          ' across ' ||
                          blocker.record_count || ' selected ' ||
                          case when blocker.record_count = 1 then 'record' else 'records' end
                        `}
                      </span>
                    </div>
                  </Each>
                </div>
              </div>
            </Show>
          }
          onConfirm={(s, close) => {
            s.returnIf(sql`dialog_waiting`);
            s.setScalar("dialog_waiting", true);
            s.setScalar("dialog_error", sql.null);
            s.statements(props.beforeSubmitClient);
            s.commitUiTreeChanges();
            s.tryServer({
              body: (s) => {
                s.statements(props.beforeTransactionStart);
                s.startTransaction();
                s.statements(props.afterTransactionStart);
                props.prepareTargetIds?.(s);
                throwIfRestrictDeleteBlocked(s, table, props.targetIdsQuery);
                if (props.deletedRecordCountScalar) {
                  s.setScalar(
                    props.deletedRecordCountScalar,
                    sql`(select count(*) from (${props.targetIdsQuery}) as delete_target_ids)`,
                  );
                }
                if (props.deleteRecords) {
                  props.deleteRecords(s, props.targetIdsQuery, table);
                } else {
                  s.modify(
                    sql`delete from ${table.identWithDb} where id in (
                      select id from (${props.targetIdsQuery}) as delete_target_ids
                    )`,
                  );
                }
                s.statements(props.beforeTransactionCommit);
                s.commitTransaction();
                if (!props.disableAutoRefetch) {
                  refetchCtx?.triggerRefetch(s);
                }
                s.statements(props.afterTransactionCommit);
              },
              errorName: "delete_error",
              catch: (s) => {
                s.setScalar(
                  "dialog_error",
                  sql`
                    case
                      when delete_error.message = 'delete_restrict_blocked'
                      then 'Remove or reassign related records before deleting.'
                      else 'Unable to delete.'
                    end
                  `,
                );
              },
            });
            s.setScalar("dialog_waiting", false);
            s.if(sql`dialog_error is null`, (s) => {
              s.statements(close, props.afterSubmitClient);
            });
          }}
        />
      </Data>
    </Show>
  );
}

/**
 A dialog component for confirming and executing the deletion of a record.

This component provides a confirmation dialog for deleting a record from a specified table.
It handles the deletion process, including pre and post-deletion actions, and manages the UI state.

@category Dialog Component

@param props.table - The name of the table from which to delete the record.
@param props.recordId - The ID of the record to be deleted.
@param props.description - Custom description text for the dialog.
@param props.confirmButtonText - Custom text for the confirm button.
@param props.beforeSubmitClient - Statements to execute before submitting the deletion request.
@param props.beforeTransactionStart - Statements to execute before starting the transaction.
@param props.afterTransactionStart - Statements to execute after starting the transaction.
@param props.beforeTransactionCommit - Statements to execute before committing the transaction.
@param props.afterTransactionCommit - Statements to execute after committing the transaction.
@param props.afterSubmitClient - Statements to execute after submitting the deletion request.
@param props.disableAutoRefetch - Whether to disable automatic refetching after deletion.
@param props.open - Whether the dialog is open.
@param props.onClose - Function to call when the dialog should close.

@examples
[Example](../pages/datagrid_internals/view_drawer.tsx)
 */
export function DeleteRecordDialog(props: DeleteRecordDialogProps) {
  const { table, recordId } = resolveTableAndRecordId(
    props.table,
    props.recordId,
  );
  return (
    <DeleteRecordsDialog
      open={props.open}
      onClose={props.onClose}
      bindRecordField={props.bindRecordField}
      bindScalar={props.bindScalar}
      table={table.name}
      targetIdsQuery={sql`select ${recordId} as id`}
      recordCount={sql`1`}
      confirmButtonText={props.confirmButtonText ?? "Delete"}
      description={props.description ??
        sql
          .lit`Are you sure you want to delete this ${
          singularize(table.displayName.toLowerCase())
        }?`}
      beforeSubmitClient={props.beforeSubmitClient}
      beforeTransactionStart={props.beforeTransactionStart}
      afterTransactionStart={props.afterTransactionStart}
      beforeTransactionCommit={props.beforeTransactionCommit}
      afterTransactionCommit={props.afterTransactionCommit}
      afterSubmitClient={props.afterSubmitClient}
      disableAutoRefetch={props.disableAutoRefetch}
    />
  );
}

function extractDeleteRecordProps(
  props: DeleteRecordDialogProps,
): [DeleteRecordDialogProps, Record<string, any>] {
  const {
    table,
    recordId,
    description,
    confirmButtonText,
    afterSubmitClient: afterDeleteClient,
    beforeSubmitClient: beforeDeleteClient,
    beforeTransactionCommit,
    beforeTransactionStart,
    afterTransactionCommit,
    afterTransactionStart,
    disableAutoRefetch,
    ...rest
  } = props;
  return [
    {
      table,
      recordId,
      description,
      confirmButtonText,
      afterSubmitClient: afterDeleteClient,
      beforeSubmitClient: beforeDeleteClient,
      beforeTransactionCommit,
      beforeTransactionStart,
      afterTransactionCommit,
      afterTransactionStart,
      disableAutoRefetch,
    },
    rest,
  ];
}

/**
 * Button that opens a {@link DeleteRecordDialog} for the given record.
 * Inherits {@link ButtonProps} so it integrates with the standard button
 * styling.
 */
export function DeleteRecordButton(
  props: Omit<ButtonProps, "onClick" | "children"> & {
    children?: Node;
    label?: string;
    globalUndoSnackbarKey?: string;
  } & BaseDeleteRecordDialogProps,
) {
  const [deleteRecordProps, buttonProps] = extractDeleteRecordProps(props);
  let {
    children = props.label ?? "Delete",
    label: _label,
    startIcon,
    startDecorator,
    globalUndoSnackbarKey,
    ...rest
  } = buttonProps;
  if (!(startIcon || startDecorator)) {
    startIcon = "Delete";
  }
  if (globalUndoSnackbarKey) {
    const undoSnackbar = useGlobalUndoSnackbar(globalUndoSnackbarKey);
    const afterSubmitClient = deleteRecordProps.afterSubmitClient;
    deleteRecordProps.afterSubmitClient = (s) => {
      s.statements(undoSnackbar.open);
      s.statements(afterSubmitClient);
    };
    const beforeTransactionCommit = deleteRecordProps.beforeTransactionCommit;
    deleteRecordProps.beforeTransactionCommit = (s) => {
      undoSnackbar.setUndoTx(s, sql`info.current_tx()`);
      s.statements(beforeTransactionCommit);
    };
  }
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("deleting", false);
      }}
    >
      <Button
        variant="soft"
        color="danger"
        startIcon={startIcon}
        startDecorator={startDecorator}
        {...rest}
        onClick={(s) => s.setScalar("deleting", true)}
      >
        {children}
      </Button>
      <DeleteRecordDialog {...deleteRecordProps} bindScalar="deleting" />
    </Data>
  );
}

/**
 * Icon-button variant of `DeleteRecordButton` — a single trash-icon
 * button that opens the standard delete-record confirmation dialog and
 * (on confirm) removes the row, optionally posting an undo snackbar to
 * the global snackbar slot named by `globalUndoSnackbarKey`.
 *
 * Use in row toolbars where horizontal space is limited and a labelled
 * `DeleteRecordButton` would crowd the layout.
 */
export function DeleteRecordIconButton(
  props: Omit<IconButtonProps, "onClick" | "aria-label" | "onClose"> & {
    "aria-label"?: string | Sql;
    globalUndoSnackbarKey?: string;
  } & BaseDeleteRecordDialogProps,
) {
  const [deleteRecordProps, iconButtonProps] = extractDeleteRecordProps(props);
  const resolvedTable = resolveTableAndRecordId(
    deleteRecordProps.table,
    deleteRecordProps.recordId,
  ).table;
  let {
    children,
    icon,
    "aria-label": ariaLabel = `Delete ${resolvedTable.displayName}`,
    globalUndoSnackbarKey,
    ...rest
  } = iconButtonProps;
  if (!(icon || children)) {
    icon = "Delete";
  }
  if (globalUndoSnackbarKey) {
    const undoSnackbar = useGlobalUndoSnackbar(globalUndoSnackbarKey);
    const afterSubmitClient = deleteRecordProps.afterSubmitClient;
    deleteRecordProps.afterSubmitClient = (s) => {
      s.statements(undoSnackbar.open);
      s.statements(afterSubmitClient);
    };
    const beforeTransactionCommit = deleteRecordProps.beforeTransactionCommit;
    deleteRecordProps.beforeTransactionCommit = (s) => {
      undoSnackbar.setUndoTx(s, sql`info.current_tx()`);
      s.statements(beforeTransactionCommit);
    };
  }
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("deleting", false);
      }}
    >
      {/*Example_MaterialIcon_Start*/}
      <IconButton
        color="danger"
        aria-label={ariaLabel}
        onClick={(s) => s.setScalar("deleting", true)}
        {...rest}
      >
        <MaterialIcon icon="Delete" />
      </IconButton>
      {/*Example_MaterialIcon_End*/}
      <DeleteRecordDialog {...deleteRecordProps} bindScalar="deleting" />
    </Data>
  );
}

/**
 * Menu item that opens a {@link DeleteRecordDialog} for the current record.
 * Use inside a `Menu.Content` (e.g. a row's "..." actions menu); the
 * table/record default to the surrounding table and record context.
 *
 * @category UI Component
 */
export function DeleteRecordMenuItem(
  props:
    & Omit<ListItemButtonProps, "onClick" | "children">
    & BaseDeleteRecordDialogProps
    & { children?: Node },
) {
  const tableModel = resolveTable(props.table);
  const openScalar = `delete_${tableModel.name}_dialog_open`;
  useDropdownState(openScalar, (s) => {
    s.defScalar(openScalar, false);
  });
  const [deleteRecordProps, buttonProps] = extractDeleteRecordProps(props);
  useDropdownNode(
    openScalar,
    <DeleteRecordDialog {...deleteRecordProps} bindScalar={openScalar} />,
  );
  return (
    <Menu.Item
      onClick={(s) => {
        s.setScalar(openScalar, true);
      }}
      {...buttonProps}
    >
      {props.children ?? "Delete"}
    </Menu.Item>
  );
}
