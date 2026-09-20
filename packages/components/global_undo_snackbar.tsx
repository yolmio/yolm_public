import { sql } from "../std/sql_utils";
import type { NumericExpr, Sql } from "../std/sql_utils";
import type { IStatementsBase } from "std/statements";
import { useGlobalNode, useGlobalState } from "std/system";
import { Button } from "./button";
import { IconButton } from "./icon_button";
import { MaterialIcon } from "./material_icon";
import { Snackbar } from "./snackbar";

/**
 Creates a global undo snackbar.

 The snackbar shows a button that will undo a transaction.

 The reason this is global is because it will exist wherever <GlobalNodes> is used and can therefor
 be used across pages. This is primarily useful where we delete the record for the current page and
 want to navigate to another page, but show the undo snackbar on whichever page the user is on.

 @category UI Component
 */
export function useGlobalUndoSnackbar(key: string) {
  const undoTxScalar = sql.ref(`global_undo_tx_${key}`);
  const undoUrlScalar = sql.ref(`global_undo_return_url_${key}`);
  useGlobalState({
    key: `global_undo_${key}`,
    procedure: (s) => {
      s.defScalar(undoTxScalar, {
        type: "BigUint",
        allowNoRead: true,
      });
      s.defScalar(undoUrlScalar, {
        type: {
          type: "String",
          maxLength: 2000,
        },
        allowNoRead: true,
      });
    },
  });
  const undidSnackbar = useGlobalNode({
    key: `global_undo_success_${key}`,
    autoHideDuration: 3_000,
    node: ({ close }) => (
      <Snackbar
        variant="soft"
        color="success"
        startDecorator={<MaterialIcon icon="CheckCircle" />}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        endDecorator={
          <IconButton
            variant="plain"
            color="harmonize"
            icon="Close"
            aria-label="Close snackbar"
            onClick={(s) => {
              s.statements(close);
            }}
          />
        }
      >
        Successfully undid delete
      </Snackbar>
    ),
  });
  const undoFailureSnackbar = useGlobalNode({
    key: `global_undo_failure_${key}`,
    autoHideDuration: 3_000,
    node: ({ close }) => (
      <Snackbar
        variant="soft"
        color="danger"
        startDecorator={<MaterialIcon icon="Warning" />}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        endDecorator={
          <IconButton
            variant="plain"
            color="harmonize"
            icon="Close"
            aria-label="Close snackbar"
            onClick={(s) => {
              s.statements(close);
            }}
          />
        }
      >
        Unable to undo delete
      </Snackbar>
    ),
  });
  const mainSnackbar = useGlobalNode({
    key: `global_undo_${key}`,
    autoHideDuration: 7_500,
    node: ({ close }) => (
      <Snackbar
        variant="soft"
        color="success"
        harmonize
        startDecorator={<MaterialIcon icon="CheckCircle" />}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        endDecorator={
          <>
            <Button
              variant="soft"
              onClick={(s) => {
                s.tryServer({
                  body: (s) => {
                    s.startTransaction();
                    s.undoTx(undoTxScalar);
                    s.commitTransaction();
                    s.navigate(undoUrlScalar);
                  },
                  errorName: "err",
                  catch: (s) => {
                    s.statements(undoFailureSnackbar.open);
                    s.return();
                  },
                });
                s.statements(undidSnackbar.open);
              }}
            >
              Undo
            </Button>
            <IconButton
              variant="plain"
              color="harmonize"
              icon="Close"
              aria-label="Close snackbar"
              onClick={close}
            />
          </>
        }
      >
        Successfully deleted
      </Snackbar>
    ),
  });
  return {
    setUndoTx: <T extends IStatementsBase>(s: T, tx?: NumericExpr) => {
      s.setScalar(undoTxScalar, tx ?? sql`info.current_tx()`);
      s.setScalar(undoUrlScalar, sql`ui.location.pathname`);
    },
    setReturnUrl: <T extends IStatementsBase>(s: T, url: Sql) => {
      s.setScalar(undoUrlScalar, url);
    },
    ...mainSnackbar,
  };
}
