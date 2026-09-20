import { sql } from "std/sql_utils";
import { Data } from "std/data";
import type { DomStatements } from "std/statements";
import { Show } from "std/ui";
import { Button } from "./button";
import type { ButtonProps } from "./button";
import { Snackbar } from "./snackbar";
import type { Color } from "./types";

export interface SnackbarButtonProps extends ButtonProps {
  statementProc: (s: DomStatements) => void;
  successMessage: string;
  successMessageDuration?: number;
  snackbarColor?: Color;
}

/**
 A button that executes a statement and shows a snackbar when it finishes, being able to specify the color of the snackbar.

 @category UI Component
 */
export function SnackbarButton(props: SnackbarButtonProps) {
  const {
    // deno-lint-ignore no-unused-vars
    statementProc,
    // deno-lint-ignore no-unused-vars
    successMessage,
    // deno-lint-ignore no-unused-vars
    successMessageDuration,
    snackbarColor,
    ...buttonProps
  } = props;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("proc_success", false);
      }}
    >
      <Button
        {...buttonProps}
        onClick={(s) => {
          props.statementProc(s);
          s.setScalar("proc_success", true);
        }}
      />
      <Show when={sql`proc_success`}>
        <Snackbar
          startIcon="CheckCircle"
          color={snackbarColor || "success"}
          variant="soft"
          onMount={(s) => {
            s.sleep(props.successMessageDuration || 3500);
            s.setScalar("proc_success", false);
          }}
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
        >
          {props.successMessage}
        </Snackbar>
      </Show>
    </Data>
  );
}
