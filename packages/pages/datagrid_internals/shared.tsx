import { Button } from "components/button";
import type { ButtonProps } from "components/button";
import { CircularProgress } from "components/circular_progress";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Menu } from "components/menu";
import {
  CurrentRefetchICtxKey,
  DatagridBaseICtxKey,
  DatagridCurrentCellICtxKey,
  DatagridEditICtxKey,
  useCurrentWatchState,
  useToolbarState,
} from "std/ictx";
import type {
  DatagridBaseICtx,
  DatagridCurrentCellICtx,
  DatagridEditICtx,
} from "std/ictx";
import { sql } from "../../std/sql_utils";
import type {
  AnyExpr,
  BooleanExpr,
  NumericExpr,
  Sql,
} from "../../std/sql_utils";
import {
  BasicStatements,
  DomStatements,
  StateStatements,
} from "std/statements";
import type {
  DomStatementsOrFn,
  IStatementsBase,
  UiServerStatementsOrFn,
} from "std/statements";
import { createStyles } from "std/style_utils";
import { system } from "std/system";
import { Conditional, EventHandlers, Show, useICtx, useState } from "std/ui";
import type { Node } from "std/ui";

/**
 * Per-column key/click handlers gathered from datagrid columns and merged
 * into the grid's cell/header event handling by {@link colKeydownHandlers}
 * and {@link colClickHandlers}.
 */
export interface ColumnEventHandlers {
  keydownCellHandler?: DomStatementsOrFn;
  keydownHeaderHandler?: DomStatementsOrFn;
  headerClickHandler?: DomStatementsOrFn;
  cellClickHandler?: DomStatementsOrFn;
}

/** Named datagrid row-height presets; see {@link rowHeightInPixels} for the pixel values. */
export type RowHeight =
  | "extraShort"
  | "short"
  | "medium"
  | "tall"
  | "extraTall";

/** Maps a {@link RowHeight} preset to its pixel height. */
export function rowHeightInPixels(height: RowHeight) {
  switch (height) {
    case "extraShort":
      return 36;
    case "short":
      return 44;
    case "medium":
      return 56;
    case "tall":
      return 88;
    case "extraTall":
      return 128;
  }
}

/**
 * Defines the UI state scalars/records that back inline cell editing in a
 * datagrid (focus position, editing position, saving flag, and the transient
 * error message). Call once when setting up the datagrid's state.
 *
 * @category Helper
 */
export function editFocusState() {
  return new StateStatements()
    .record(
      "focus_state",
      sql`select 0 as column, 0 as row, false as should_focus`,
    )
    .record(
      "editing_state",
      sql`select 0 as column, 0 as row, false as is_editing`,
    )
    .scalarDef({
      name: "start_edit_empty",
      expr: false,
      allowNoRead: true,
    })
    .scalarDef({
      name: "saving_edit",
      expr: false,
      allowNoRead: true,
    })
    .scalarDef({
      name: "display_error_message",
      type: { type: "String", maxLength: 2000 },
      expr: sql.null,
      allowNoRead: true,
    });
}

/**
 * Base datagrid context implementing the focus/edit interaction model.
 * Exposes the focus and editing state, refetch trigger, transient error
 * display, and {@link DatagridBaseContext.updateFieldValueInDb} which runs an
 * inline cell edit as a transaction with error handling and rollback.
 *
 * @category Helper
 */
export class DatagridBaseContext implements DatagridBaseICtx, DatagridEditICtx {
  focusState = {
    column: sql`focus_state.column`,
    row: sql`focus_state.row`,
    shouldFocus: sql`focus_state.should_focus`,
  };
  selectable = false;
  editingState = {
    column: sql`editing_state.column`,
    row: sql`editing_state.row`,
    isEditing: sql`editing_state.is_editing`,
  };
  startEditEmpty = sql.ref("ui.start_edit_empty");
  savingEdit = sql.ref("ui.saving_edit");
  displayErrorMessage = sql.ref("ui.display_error_message");
  refreshKey = sql.ref("ui.dg_refresh_key");

  triggerRefetch = <T extends IStatementsBase>(s: T) => {
    s.increment(this.refreshKey);
  };

  setErrorMessage = <T extends IStatementsBase>(s: T, message: Sql) => {
    s.setScalar(this.displayErrorMessage, message);
  };

  setSavingEdit = <T extends IStatementsBase>(s: T, saving: BooleanExpr) => {
    s.setScalar(this.savingEdit, saving);
  };

  setStartEditEmpty = <T extends IStatementsBase>(s: T, char: BooleanExpr) => {
    s.setScalar(this.startEditEmpty, char);
  };

  displayEditErrorAndRemoveAfter = (
    s: DomStatements,
    message: Sql,
    delay: NumericExpr = 4000,
  ) => {
    this.setErrorMessage(s, message);
    s.startTaskWithOpts({
      detached: true,
      procedure: (s) => {
        s.sleep(delay);
        this.setErrorMessage(s, sql.null);
        s.commitUiTreeChanges();
      },
    });
  };

  doEditTransaction(
    s: DomStatements,
    opts: {
      beforeTransaction?: UiServerStatementsOrFn;
      transactionBody: UiServerStatementsOrFn;
      afterTransaction?: UiServerStatementsOrFn;
      onError: (s: DomStatements, errRecord: string) => unknown;
    },
  ) {
    this.setSavingEdit(s, true);
    this.setErrorMessage(s, sql.null);
    s.commitUiTreeChanges();
    s.try({
      body: (s) => {
        s.server((s) => {
          s.statements(opts.beforeTransaction);
          s.startTransaction();
          s.statements(opts.transactionBody);
          s.commitTransaction();
          s.statements(opts.afterTransaction, this.triggerRefetch);
        });
      },
      errorName: "edit_err",
      catch: (s) => {
        s.debugExpr(
          sql.concat(
            sql`edit_err.type`,
            ":",
            sql`coalesce(edit_err.message, '')`,
            ":",
            sql`coalesce(edit_err.description, '')`,
          ),
        );
        opts.onError(s, "edit_err");
      },
      finally: (s) => this.setSavingEdit(s, false),
    });
  }

  updateFieldValueInDb = (s: DomStatements, opts: UpdateCellFieldOpts) => {
    this.doEditTransaction(s, {
      beforeTransaction: opts.beforeUpdateTransaction?.(
        opts.dbValue,
        opts.recordId,
      ),
      afterTransaction: opts.afterUpdateTransaction?.(
        opts.dbValue,
        opts.recordId,
      ),
      transactionBody: (s) => {
        s.statements(opts.beforeUpdate?.(opts.dbValue, opts.recordId));
        const table = system.db.tables[opts.tableName];
        s.modify(
          sql`update db.${sql.ref(opts.tableName)} set ${
            sql.ref(opts.fieldName)
          } = ${opts.dbValue} where ${table.primaryKeyIdent} = ${opts.recordId}`,
        );
        s.statements(opts.afterUpdate?.(opts.dbValue, opts.recordId));
      },
      onError: (s) => {
        s.statements(opts.resetValue);
        this.displayEditErrorAndRemoveAfter(s, sql.lit`Error saving edit`);
      },
    });
  };
}

/** Options for {@link DatagridBaseContext.updateFieldValueInDb}: which field to write and the rollback statements. */
export interface UpdateCellFieldOpts extends FieldEditProcConfig {
  tableName: string;
  fieldName: string;
  /** Value to write to the field. */
  dbValue: AnyExpr;
  /** Statements that restore the prior value if the update fails. */
  resetValue: DomStatementsOrFn;
  recordId: NumericExpr;
}

/** Factory producing the statements to run around a field edit, given the new value and record id. */
export type FieldEditStatements = (
  newValue: AnyExpr,
  recordId: NumericExpr,
) => UiServerStatementsOrFn;

/** Optional hooks run at each stage of an inline field-edit transaction. */
export interface FieldEditProcConfig {
  /** Runs before the transaction starts (outside it). */
  beforeUpdateTransaction?: FieldEditStatements;
  /** Runs inside the transaction, before the update statement. */
  beforeUpdate?: FieldEditStatements;
  /** Runs inside the transaction, after the update statement. */
  afterUpdate?: FieldEditStatements;
  /** Runs after the transaction commits. */
  afterUpdateTransaction?: FieldEditStatements;
}

/** Options for {@link DgCellHelper.fieldEditorEventHandlers}: identifies the field and its UI validity/dirty expressions. */
export interface FieldEditorHelpersOpts extends FieldEditProcConfig {
  tableName: string;
  fieldName: string;
  /** DB value to write for the edited field. */
  dbValue: AnyExpr;
  /** Value to assign into the in-cell record; defaults to the input's bound `ui.value`. */
  newUiValue?: AnyExpr;
  /** Expression that is true when the edited value is valid. */
  validUiValue: BooleanExpr;
  /** Expression that is true when the edited value differs from the stored one. */
  changedUiValue: BooleanExpr;
  recordId?: NumericExpr;
}

/**
 * Helper exposed to a datagrid column's `cell` render function (via
 * {@link useCellHelper}). Gives access to the current cell's value, field,
 * record id, edit-mode state, and statements for committing inline edits and
 * moving focus. {@link DgCellHelper.fieldEditorEventHandlers} wires up the
 * Enter/Escape/Tab/blur behaviour for an editable cell input.
 *
 * @category Helper
 */
export class DgCellHelper {
  record = sql.ref("dg_record");
  row = sql`${this.record}.iteration_index + 1`;

  constructor(
    private dgContext: DatagridBaseICtx,
    private currentColumnContext: DatagridCurrentCellICtx,
    private editContext: DatagridEditICtx,
  ) {}

  get nextCol() {
    return this.currentColumnContext.nextColumn;
  }

  get recordId() {
    return this.currentColumnContext.recordId;
  }

  get field() {
    return this.currentColumnContext.resultField;
  }

  get value() {
    return this.field ? sql`${this.record}.${this.field}` : sql.null;
  }

  get idField() {
    return this.currentColumnContext.idField;
  }

  get editing() {
    return sql`editing_state.is_editing and editing_state.column = ${this.column} and editing_state.row = ${this.row}`;
  }

  useState = (s: Parameters<typeof useCurrentWatchState>[0]) => {
    useCurrentWatchState(s);
  };

  setValue(s: DomStatements, v: AnyExpr) {
    if (this.field) {
      s.modify(sql`update ${this.record} set ${this.field} = ${v}`);
    }
  }

  get stopEditingAndFocus() {
    return new BasicStatements()
      .modify(sql`update ui.editing_state set is_editing = false`)
      .modify(sql`update ui.focus_state set should_focus = true`);
  }

  get column(): number {
    return this.currentColumnContext.column;
  }

  updateFieldValueInDb(
    s: DomStatements,
    opts: Omit<UpdateCellFieldOpts, "recordId"> & {
      recordId?: NumericExpr;
    },
  ) {
    this.editContext.updateFieldValueInDb(s, {
      ...opts,
      recordId: opts.recordId ?? this.recordId,
    });
  }

  focusNextCell = (s: DomStatements) => {
    s.modify(sql`update ui.editing_state set is_editing = false`);
    s.modify(
      sql`update ui.focus_state set should_focus = true, column = ${this.nextCol}`,
    );
  };

  fieldEditorEventHandlers(opts: FieldEditorHelpersOpts) {
    const editStatements = (s: DomStatements) => {
      s.defScalar("prev_value", this.value);
      this.setValue(s, opts.newUiValue ?? sql`ui.value`);
      this.updateFieldValueInDb(s, {
        ...opts,
        resetValue: (s) => this.setValue(s, sql`prev_value`),
      });
    };
    const displayErrAndExit = (s: DomStatements) => {
      this.dgContext.displayEditErrorAndRemoveAfter(s, sql.lit`Invalid value`);
      s.return();
    };
    return {
      onClick: (s: DomStatements) => s.event.stopPropagation(),
      onKeyDown: {
        detachedFromNode: true,
        procedure: (s: DomStatements) => {
          s.event.stopPropagation();
          s.if(sql`event.key = 'Enter'`, (s) => {
            s.statements(this.stopEditingAndFocus);
            s.unless(opts.validUiValue, displayErrAndExit);
            s.if(opts.changedUiValue, editStatements);
          });
          s.if(sql`event.key = 'Escape'`, this.stopEditingAndFocus);
          s.if(sql`event.key = 'Tab'`, (s) => {
            s.event.preventDefault();
            s.statements(this.focusNextCell);
            s.unless(opts.validUiValue, displayErrAndExit);
            s.if(opts.changedUiValue, editStatements);
          });
        },
      },
      onBlur: {
        detachedFromNode: true,
        procedure: (s: DomStatements) => {
          s.modify(sql`update ui.editing_state set is_editing = false`);
          s.unless(opts.validUiValue, displayErrAndExit);
          s.if(opts.changedUiValue, editStatements);
        },
      },
    };
  }
}

/**
 * Hook used inside a datagrid column's `cell` render function. Returns a
 * {@link DgCellHelper} that exposes the current value, edit-mode state,
 * and statements for committing inline edits. Throws when called outside
 * a datagrid cell.
 *
 * @category Hook
 */
export function useCellHelper() {
  const currentColumnContext = useICtx(DatagridCurrentCellICtxKey);
  const dgContext = useICtx(DatagridBaseICtxKey);
  const editContext = useICtx(DatagridEditICtxKey);
  return new DgCellHelper(dgContext, currentColumnContext, editContext);
}

/**
 * Builds the datagrid keydown handler that dispatches to each column's
 * cell/header keydown handler based on the focused cell's row and column.
 *
 * @category Helper
 */
export function colKeydownHandlers(columns: ColumnEventHandlers[]) {
  const statements = new DomStatements();
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (column.keydownHeaderHandler) {
      statements.if(
        sql`cell.row = 0 and cell.column = ${i}`,
        column.keydownHeaderHandler,
      );
    }
    if (column.keydownCellHandler) {
      statements.if(
        sql`cell.row != 0 and cell.column = ${i}`,
        column.keydownCellHandler,
      );
    }
  }
  return statements;
}

/**
 * Builds the datagrid click handler that dispatches to each column's
 * cell/header click handler, branching on whether the header row (row 0)
 * was clicked. Returns an empty statement set when no column defines a
 * click handler.
 *
 * @category Helper
 */
export function colClickHandlers(columns: ColumnEventHandlers[]) {
  const headerStatements = new DomStatements();
  const cellStatements = new DomStatements();
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (column.headerClickHandler) {
      headerStatements.if(sql`cell.column = ${i}`, column.headerClickHandler);
    }
    if (column.cellClickHandler) {
      cellStatements.if(sql`cell.column = ${i}`, column.cellClickHandler);
    }
  }
  if (headerStatements.statementsIsEmpty && cellStatements.statementsIsEmpty) {
    return new DomStatements();
  }
  return new DomStatements().conditional({
    condition: sql`cell.row = 0`,
    then: headerStatements,
    else: cellStatements,
  });
}

/**
 * Defines the `dg_refresh_key` integer scalar that the datagrid increments
 * to trigger a refetch. Call once when setting up the datagrid's state.
 *
 * @category Helper
 */
export function refreshKeyState() {
  return new BasicStatements().scalarDef({
    name: "dg_refresh_key",
    type: "Int",
    expr: 0,
  });
}

/** Props for {@link ResizeableSeperator}. */
export interface ResizeableSeperatorProps {
  /** Minimum width the column may be dragged to. */
  minWidth?: number;
  /** Current column width expression. */
  width: NumericExpr;
  /** Persists the new width as the user drags (throttled to ~60fps). */
  setWidth: (s: DomStatements, width: NumericExpr) => unknown;
}

const styles = createStyles({
  seperatorWrapper: {
    position: "absolute",
    right: -8,
    cursor: "col-resize",
    display: "flex",
    flexDirection: "row",
    justifyContent: "center",
    width: 16,
    zIndex: 1000,
    "& > div": {
      visibility: "hidden",
    },
    "&:hover > div": {
      visibility: "visible",
    },
  },
  seperator: {
    display: "flex",
    alignItems: "center",
    cursor: "col-resize",
    fontSize: "2xl",
    color: "text-secondary",
    zIndex: 1000,
    userSelect: "none",
    height: 36,
    width: 4,
    backgroundColor: "primary-500",
    "&.active": {
      "& > div": {
        visibility: "visible",
      },
    },
  },
});

/**
 * Draggable column-resize handle rendered at a datagrid column's right edge.
 * Tracks the drag via document mouse handlers and throttles width updates.
 *
 * @category UI Component
 */
export function ResizeableSeperator({
  minWidth,
  setWidth,
  width,
}: ResizeableSeperatorProps) {
  let newValue = sql`start_width + (event.client_x - start_x)`;
  if (typeof minWidth === "number") {
    newValue =
      sql`case when ${newValue} < ${minWidth} then ${minWidth} else ${newValue} end`;
  }
  useState((s) => {
    s.defScalar("start_width", {
      type: "BigInt",
    });
    s.defScalar("start_x", {
      type: "BigInt",
    });
    s.defScalar("pending_width", {
      type: "BigInt",
    });
    s.defScalar("waiting", false);
  });
  return (
    <div
      sx={styles.seperatorWrapper}
      dynamicClass={{
        condition: sql`start_width is not null`,
        classes: "active",
      }}
      onMouseDown={(s) => {
        s.setScalar("start_width", width);
        s.setScalar("start_x", sql`event.client_x`);
      }}
      onClick={(s) => {
        s.event.stopPropagation();
      }}
    >
      <div sx={styles.seperator} />
      <Show when={sql`start_width is not null`}>
        <EventHandlers
          document={{
            mouseMove: (s) => {
              s.setScalar("pending_width", newValue);
              s.unless(sql`waiting`, (s) => {
                s.startTaskWithOpts({
                  detached: true,
                  procedure: (s) => {
                    s.setScalar("waiting", true);
                    s.sleep(16);
                    setWidth(s, sql`pending_width`);
                    s.setScalar("waiting", false);
                  },
                });
              });
            },
            mouseUp: (s) => {
              s.setScalar("start_width", sql.null);
            },
          }}
        />
      </Show>
    </div>
  );
}

function runSimpleServerProc(
  waitingScalar: string,
  proc: UiServerStatementsOrFn,
) {
  return (s: DomStatements) => {
    const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
    const { displayEditErrorAndRemoveAfter } = useICtx(DatagridBaseICtxKey);
    s.returnIf(sql.ref(waitingScalar));
    s.setScalar(waitingScalar, true);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        s.statements(proc);
        s.statements(triggerRefetch);
      },
      errorName: "error",
      catch: (s) => {
        displayEditErrorAndRemoveAfter(
          s,
          sql.concat(
            "Had error: ",
            sql`error.type`,
            ": ",
            sql`coalesce(error.message, '')`,
            " ",
            sql`coalesce(error.description, '')`,
          ),
        );
      },
      finally: (s) => {
        s.setScalar(waitingScalar, false);
      },
    });
  };
}

interface ServerProcButtonProps extends ButtonProps {
  proc: UiServerStatementsOrFn;
}

/**
 * Datagrid toolbar button that runs a server procedure on click, showing a
 * loading state and surfacing errors via the datagrid's transient error
 * message. Refetches the datagrid on success. Must be used inside a datagrid.
 *
 * @category UI Component
 */
export function ServerProcButton(props: ServerProcButtonProps) {
  const { variant = "solid", color = "primary", proc, ...rest } = props;
  useState((s) => {
    s.defScalar("waiting", false);
  });
  return (
    <Button
      variant={variant}
      color={color}
      size="sm"
      onClick={runSimpleServerProc("waiting", proc)}
      loading={sql`waiting`}
      {...rest}
    >
      {props.children}
    </Button>
  );
}

interface ServerProcMenuItemProps {
  children: Node;
  icon?: IconName;
  proc: UiServerStatementsOrFn;
}

/**
 * Datagrid toolbar menu item that runs a server procedure on click, showing
 * a spinner while in progress and refetching on success. Menu-item analogue
 * of {@link ServerProcButton}.
 *
 * @category UI Component
 */
export function ServerProcMenuItem(props: ServerProcMenuItemProps) {
  const { proc } = props;
  const waitingScalar = "server_proc_button_waiting";
  useToolbarState((s) => {
    s.defScalar(waitingScalar, {
      expr: false,
      allowNoRead: true,
    });
  });
  return (
    <Menu.Item onClick={runSimpleServerProc(waitingScalar, proc)}>
      <Conditional
        when={sql`server_proc_button_waiting`}
        then={<CircularProgress size="sm" />}
        else={props.icon ? <MaterialIcon icon={props.icon} /> : undefined}
      />
      {props.children}
    </Menu.Item>
  );
}
