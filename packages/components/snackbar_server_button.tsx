import { CurrentRefetchICtxKey } from "std/ictx";
import { sql } from "../std/sql_utils";
import { Data } from "std/data";
import type { DomStatements, UiServerStatements } from "std/statements";
import { Show, useOptionalICtx, useState, wrapCurrentComponent } from "std/ui";
import { Button } from "./button";
import type { ButtonProps } from "./button";
import { Snackbar } from "./snackbar";

export interface SnackbarServerButtonProps extends ButtonProps {
  serverProc: (s: UiServerStatements) => void;
  successMessage: string;
  errorMessage: string;
  disableRefetch?: boolean;
}

/**
 A button that executes a server procedure and shows loading, success and error states via snackbars.

 @category UI Component
 */
export function SnackbarServerButton(props: SnackbarServerButtonProps) {
  const {
    // deno-lint-ignore no-unused-vars
    serverProc,
    // deno-lint-ignore no-unused-vars
    successMessage,
    // deno-lint-ignore no-unused-vars
    errorMessage,
    disableRefetch,
    ...buttonProps
  } = props;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("proc_waiting", false);
        s.defScalar("proc_error", {
          expr: sql.null,
          type: "String",
          allowNoRead: true,
        });
        s.defScalar("proc_success", false);
      }}
    >
      <Button
        {...buttonProps}
        loading={sql`proc_waiting`}
        onClick={(s) => {
          s.returnIf(sql`proc_waiting`);
          s.setScalar("proc_waiting", true);
          s.setScalar("proc_error", sql.null);
          s.setScalar("proc_success", false);
          s.commitUiTreeChanges();
          s.tryServer({
            body: (s) => {
              props.serverProc(s);
              if (!disableRefetch) {
                useOptionalICtx(CurrentRefetchICtxKey)?.triggerRefetch(s);
              }
              s.setScalar("proc_success", true);
            },
            errorName: "error",
            catch: (s) => {
              s.setScalar(
                "proc_error",
                sql.concat(sql`error.type`, ": ", sql`error.message`),
              );
            },
          });
          s.setScalar("proc_waiting", false);
          s.commitUiTreeChanges();
          s.sleep(3500);
          s.setScalar("proc_waiting", false);
          s.setScalar("proc_error", sql.null);
          s.setScalar("proc_success", false);
        }}
      />
      <Show when={sql`proc_success`}>
        <Snackbar
          startIcon="CheckCircle"
          color="success"
          variant="soft"
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
        >
          {props.successMessage}
        </Snackbar>
      </Show>
      <Show when={sql`proc_error is not null`}>
        <Snackbar
          startIcon="Error"
          color="danger"
          variant="soft"
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
        >
          {sql`proc_error`}
        </Snackbar>
      </Show>
    </Data>
  );
}

export function useSnackbarProcState(opts: {
  name: string;
  successMessage: string;
  disableRefetch?: boolean;
}) {
  const waitingScalar = `${opts.name}_waiting`;
  const errorScalar = `${opts.name}_error`;
  const successScalar = `${opts.name}_success`;
  useState((s) => {
    s.defScalar(waitingScalar, false);
    s.defScalar(errorScalar, {
      expr: sql.null,
      type: "String",
    });
    s.defScalar(successScalar, false);
  });
  wrapCurrentComponent((node) => {
    return (
      <>
        {node}
        <Show when={sql.ref(successScalar)}>
          <Snackbar
            startIcon="CheckCircle"
            color="success"
            variant="soft"
            // temporary hack until this works better in datagrid
            popover="manual"
            anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
          >
            {opts.successMessage}
          </Snackbar>
        </Show>
        <Show when={sql.isNotNull(sql.ref(errorScalar))}>
          <Snackbar
            startIcon="Error"
            color="danger"
            variant="soft"
            // temporary hack until this works better in datagrid
            popover="manual"
            anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
          >
            {sql.ref(errorScalar)}
          </Snackbar>
        </Show>
      </>
    );
  });
  return {
    procWaiting: sql.ref(waitingScalar),
    procError: sql.ref(errorScalar),
    procSuccess: sql.ref(successScalar),
    doServerProc: (s: DomStatements, f: (s: UiServerStatements) => void) => {
      s.returnIf(sql.ref(waitingScalar));
      s.setScalar(waitingScalar, true);
      s.setScalar(errorScalar, sql.null);
      s.setScalar(successScalar, false);
      s.commitUiTreeChanges();
      s.tryServer({
        body: (s) => {
          f(s);
          if (!opts.disableRefetch) {
            useOptionalICtx(CurrentRefetchICtxKey)?.triggerRefetch(s);
          }
          s.setScalar(successScalar, true);
        },
        errorName: "error",
        catch: (s) => {
          s.setScalar(
            errorScalar,
            sql.concat(sql`error.type`, ": ", sql`coalesce(error.message, '')`),
          );
        },
      });
      s.setScalar(waitingScalar, false);
      s.commitUiTreeChanges();
      s.sleep(3500);
      s.setScalar(waitingScalar, false);
      s.setScalar(errorScalar, sql.null);
      s.setScalar(successScalar, false);
    },
  };
}
