import { sql } from "../std/sql_utils";
import type { NumericExpr } from "../std/sql_utils";
import type {
  DomStatements,
  DomStatementsOrFn,
  IStatementsBase,
  UiServerStatementsOrFn,
} from "std/statements";
import { createStyles } from "std/style_utils";
import { Match, Switch, useState, wrapCurrentComponent } from "std/ui";
import type { Node } from "std/ui";
import { Button } from "./button";
import { IconButton } from "./icon_button";
import { MaterialIcon } from "./material_icon";
import { Snackbar } from "./snackbar";

export interface UndoSnackbarsProps {
  successSnackbarContent: Node;
  afterUndo?: UiServerStatementsOrFn;
  afterUndoClient?: DomStatementsOrFn;
}

const undoTxScalar = sql.ref("snackbar_tx_to_undo");
const currentlyOpenScalar = sql.ref("undo_snackbar_currently_open");

enum SnackbarType {
  Success = 0,
  Failure = 1,
  UndoSuccess = 2,
}

function CloseDecorator() {
  return (
    <IconButton
      icon="Close"
      variant="plain"
      color="harmonize"
      aria-label="Close snackbar"
      onClick={(s) => s.setScalar(currentlyOpenScalar, sql.null)}
    />
  );
}

function UndoSuccessSnackbar() {
  return (
    <Snackbar
      variant="soft"
      color="success"
      harmonize
      startDecorator={<MaterialIcon icon="CheckCircle" />}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      endDecorator={<CloseDecorator />}
    >
      Successfully performed undo
    </Snackbar>
  );
}

function FailureSnackbar() {
  return (
    <Snackbar
      variant="soft"
      color="danger"
      harmonize
      startDecorator={<MaterialIcon icon="Warning" />}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      endDecorator={<CloseDecorator />}
    >
      Unable to perform undo
    </Snackbar>
  );
}

const styles = createStyles({
  successEndDecorator: {
    display: "flex",
    gap: 2,
    ml: 8,
  },
});

export function useUndoSnackbar(props: UndoSnackbarsProps): UndoSnackbar {
  const successSnackbar = (
    <Snackbar
      variant="soft"
      color="success"
      harmonize
      startDecorator={<MaterialIcon icon="CheckCircle" />}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      endDecorator={
        <div sx={styles.successEndDecorator}>
          <Button
            variant="soft"
            color="harmonize"
            onClick={(s) => {
              s.tryServer({
                body: (s) => {
                  s.startTransaction();
                  s.undoTx(undoTxScalar);
                  s.commitTransaction();
                  s.statements(props.afterUndo);
                },
                errorName: "err",
                catch: (s) => {
                  s.setScalar(currentlyOpenScalar, SnackbarType.Failure);
                  s.startTaskWithOpts({
                    detached: true,
                    procedure: (s) => {
                      s.sleep(3000);
                      s.if(
                        sql`${currentlyOpenScalar} = ${SnackbarType.Failure}`,
                        (s) => {
                          s.setScalar(currentlyOpenScalar, sql.null);
                          s.commitUiTreeChanges();
                        },
                      );
                    },
                  });
                  s.return();
                },
              });
              s.setScalar(currentlyOpenScalar, SnackbarType.UndoSuccess);
              s.startTaskWithOpts({
                detached: true,
                procedure: (s) => {
                  s.sleep(3000);
                  s.if(
                    sql`${currentlyOpenScalar} = ${SnackbarType.UndoSuccess}`,
                    (s) => {
                      s.setScalar(currentlyOpenScalar, sql.null);
                      s.commitUiTreeChanges();
                    },
                  );
                },
              });
              s.statements(props.afterUndoClient);
            }}
          >
            Undo
          </Button>
          <IconButton
            icon="Close"
            variant="plain"
            color="harmonize"
            aria-label="Close snackbar"
            onClick={(s) => s.setScalar(currentlyOpenScalar, sql.null)}
          />
        </div>
      }
    >
      {props.successSnackbarContent}
    </Snackbar>
  );
  useState((s) => {
    s.defScalar(currentlyOpenScalar, { type: "TinyUint" });
    s.defScalar(undoTxScalar, { type: "BigUint" });
  });
  wrapCurrentComponent((node) => {
    return (
      <>
        {node}
        <Switch>
          <Match when={sql`${currentlyOpenScalar} = ${SnackbarType.Success}`}>
            {successSnackbar}
          </Match>
          <Match when={sql`${currentlyOpenScalar} = ${SnackbarType.Failure}`}>
            <FailureSnackbar />
          </Match>
          <Match
            when={sql`${currentlyOpenScalar} = ${SnackbarType.UndoSuccess}`}
          >
            <UndoSuccessSnackbar />
          </Match>
        </Switch>
      </>
    );
  });
  return {
    setUndoTx: (s, tx) => {
      s.setScalar(undoTxScalar, tx ?? sql`info.current_tx()`);
    },
    openSuccess: (s) => {
      s.setScalar(currentlyOpenScalar, SnackbarType.Success);
      s.startTaskWithOpts({
        detached: true,
        procedure: (s) => {
          s.sleep(7500);
          s.if(sql`${currentlyOpenScalar} = ${SnackbarType.Success}`, (s) => {
            s.setScalar(currentlyOpenScalar, sql.null);
            s.commitUiTreeChanges();
          });
        },
      });
    },
    closeSuccess: (s) => s.setScalar(currentlyOpenScalar, sql.null),
    delayedCloseSuccess: (s) => {
      s.startTaskWithOpts({
        detached: true,
        procedure: (s) => {
          s.sleep(7500);
          s.if(sql`${currentlyOpenScalar} = ${SnackbarType.Success}`, (s) => {
            s.setScalar(currentlyOpenScalar, sql.null);
            s.commitUiTreeChanges();
          });
        },
      });
    },
    openSuccessWithoutDelayedClose: (s, tx) => {
      s.setScalar(undoTxScalar, tx);
      s.setScalar(currentlyOpenScalar, SnackbarType.Success);
    },
  };
}

export interface UndoSnackbar {
  setUndoTx: <T extends IStatementsBase>(s: T, tx?: NumericExpr) => unknown;
  openSuccess: (s: DomStatements) => unknown;
  openSuccessWithoutDelayedClose: <T extends IStatementsBase>(
    s: T,
    tx: NumericExpr,
  ) => unknown;
  delayedCloseSuccess: (s: DomStatements) => unknown;
  closeSuccess: <T extends IStatementsBase>(s: T) => unknown;
}
